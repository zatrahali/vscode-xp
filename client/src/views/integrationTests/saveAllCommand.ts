import * as os from 'os';

import { DialogHelper } from '../../helpers/dialogHelper';
import { ExceptionHelper } from '../../helpers/exceptionHelper';
import { TestHelper } from '../../helpers/testHelper';
import { Command, CommandParams } from '../../models/command/command';
import { RuleBaseItem } from '../../models/content/ruleBaseItem';
import { XpException } from '../../models/xpException';
import { IntegrationTest } from '../../models/tests/integrationTest';

export interface SaveAllCommandParams extends CommandParams {
	testNumber: number;
	tests : any[];
}

export class SaveAllCommand extends Command {
	constructor(private params: SaveAllCommandParams) {
		super();
	}

	public async execute(): Promise<boolean> {
		const config = this.params.config;
		try {
			// Номер активного теста.
			const activeTestNumberString = this.params.testNumber;
			if (!activeTestNumberString) {
				throw new XpException(`Не задан номер активного теста`);
			}

			// В данном руле сохраняются в памяти нормализованные события.
			const rule = this.params.rule;
			const newTests = await this.getNewTests();

			rule.setIntegrationTests(newTests);
			await rule.saveIntegrationTests();

			DialogHelper.showInfo(config.getMessage("View.IntegrationTests.Message.TestsSavedSuccessfully"));
			return true;
		}
		catch (error) {
			ExceptionHelper.show(error, config.getMessage("View.IntegrationTests.Message.FailedToSaveTests"));
			return false;
		}
	}
	
	private async getNewTests(): Promise<IntegrationTest[]> {
		const plainTests = this.params.tests as any[];

		// Проверяем, что все тесты - нормальные
		plainTests.forEach((plainTest, index) => {
			// Сырые события.
			let rawEvents = plainTest?.rawEvents;
			rawEvents = rawEvents ? rawEvents.trim() : "";
			if (!rawEvents || rawEvents == "") {
				throw new XpException(`Попытка сохранения теста №${plainTest.number ?? 0} без сырых событий`);
			}

			// Код теста.
			const testCode = plainTest?.testCode;
			if (!testCode || testCode == "") {
				throw new XpException("Попытка сохранения теста без тестового кода событий");
			}
		});

		if (!plainTests.length) {
			return [];
		}

		const newTests = plainTests.map((plainTest, index) => {
			const number = index + 1;
			const test = IntegrationTest.create(number);

			// Сырые события.
			let rawEvents = plainTest?.rawEvents;

			// Из textarea новые строки только \n, поэтому надо их поправить под систему.
			rawEvents = rawEvents.replace(/(?<!\\)\n/gm, os.EOL);
			test.setRawEvents(rawEvents);

			// Код теста.
			let testCode = plainTest?.testCode;

			// Из textarea новые строки только \n, поэтому надо их поправить под систему.
			testCode = testCode.replace(/(?<!\\)\n/gm, os.EOL);
			let compressedCode: string;
			try {
				compressedCode = TestHelper.compressTestCode(testCode);
			}
			catch(error) {
				throw new XpException("Ошибка корректности JSON в коде теста. Внесите исправления и повторите", error);
			}
			
			test.setTestCode(compressedCode);

			// Нормализованные события.
			const normEvents = plainTest?.normEvents;
			if (normEvents) {
				test.setNormalizedEvents(TestHelper.compressTestCode(normEvents));
			}

			return test;
		});

		return newTests;
	}
}