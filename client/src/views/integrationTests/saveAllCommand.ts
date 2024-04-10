import * as os from 'os';

import { DialogHelper } from '../../helpers/dialogHelper';
import { ExceptionHelper } from '../../helpers/exceptionHelper';
import { TestHelper } from '../../helpers/testHelper';
import { Command, CommandParams } from '../../models/command/command';
import { RuleBaseItem } from '../../models/content/ruleBaseItem';
import { XpException } from '../../models/xpException';

export interface SaveAllCommandParams extends CommandParams {
	testNumber: number;
	tests : any[];
}

export class SaveAllCommand extends Command {
	constructor(private params: SaveAllCommandParams) {
		super();
	}

	public async execute(): Promise<boolean> {
		try {
			// В данном руле сохраняются в памяти нормализованные события.
			this.params.rule = await this.saveAllTests(this.params.rule);
			DialogHelper.showInfo(`Все тесты сохранены`);
			return true;
		}
		catch (error) {
			ExceptionHelper.show(error, `Не удалось сохранить тест`);
			return false;
		}
	}
	
	private async saveAllTests(rule: RuleBaseItem): Promise<RuleBaseItem> {
		// Номер активного теста.
		const activeTestNumberString = this.params.testNumber;
		if (!activeTestNumberString) {
			throw new XpException(`Не задан номер активного теста`);
		}

		const plainTests = this.params.tests as any[];

		// Количество тестов уменьшилось, удаляем старые и записываем новые.
		if (rule.getIntegrationTests().length > plainTests.length) {
			const promises = rule.getIntegrationTests()
				.map(it => it.remove());

			await Promise.all(promises);
		}

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

		if (plainTests.length) {
			// Очищаем интеграционные тесты.
			rule.clearIntegrationTests();

			const tests = plainTests.map((plainTest, index) => {
				const test = rule.createIntegrationTest();

				const number = index + 1;
				test.setNumber(number);

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

			rule.setIntegrationTests(tests);
			await rule.saveIntegrationTests();
			return rule;
		}
	}
}