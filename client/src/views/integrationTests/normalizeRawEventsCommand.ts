import * as vscode from 'vscode';

import { DialogHelper } from '../../helpers/dialogHelper';
import { Command, CommandParams } from '../../models/command/command';
import { SiemjManager } from '../../models/siemj/siemjManager';
import { IntegrationTest } from '../../models/tests/integrationTest';
import { ExceptionHelper } from '../../helpers/exceptionHelper';

export interface NormalizeRawEventsParams extends CommandParams {
	isEnrichmentRequired: boolean;
	test: IntegrationTest;
}

export class NormalizeRawEventsCommand extends Command {
	constructor(private params: NormalizeRawEventsParams) {
		super();
	}

	public async execute(): Promise<boolean> {
		const rawEventsFilePath = this.params.test.getRawEventsFilePath();

		await vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			cancellable: true
		}, async (progress, cancellationToken: vscode.CancellationToken) => {

			try {
				const siemjManager = new SiemjManager(this.params.config, cancellationToken);
				let normEvents: string;
				if (this.params.isEnrichmentRequired) {
					progress.report({message: `Нормализация и обогащение необработанных событий для теста №${this.params.test.getNumber()}`});
					normEvents = await siemjManager.normalizeAndEnrich(this.params.rule, rawEventsFilePath);
				} else {
					progress.report({message: `Нормализация необработанных событий для теста №${this.params.test.getNumber()}`});
					normEvents = await siemjManager.normalize(this.params.rule, rawEventsFilePath);
				}

				this.params.test.setNormalizedEvents(normEvents);
			}
			catch (error) {
				ExceptionHelper.show(error, "Не удалось нормализовать события. Необходимо [перекомпилировать нормализации](command:xp.contentTree.buildNormalizations), проверить формат необработанных событий и их конвертов, проверить наличие соответствующей нормализации");
				return;
			}

			// Обновление теста.
			const tests = this.params.rule.getIntegrationTests();
			const ruleTestIndex = tests.findIndex(it => it.getNumber() == this.params.test.getNumber());
			if (ruleTestIndex == -1) {
				DialogHelper.showError("Не удалось обновить интеграционный тест");
				return;
			}

			// Выводим статус.
			if (this.params.isEnrichmentRequired) {
				DialogHelper.showInfo(`Нормализация и обогащение сырых событий теста №${this.params.test.getNumber()} завершено успешно`);
			} else {
				DialogHelper.showInfo(`Нормализация сырых событий теста №${this.params.test.getNumber()} завершена успешно`);
			}

			// Обновляем правило.
			tests[ruleTestIndex] = this.params.test;
		});

		return Promise.resolve(true);
	}
}