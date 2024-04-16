import * as fs from 'fs';
import * as vscode from 'vscode';

import { DialogHelper } from '../../helpers/dialogHelper';
import { LocalizationExample } from '../../models/content/localization';
import { RuleBaseItem } from '../../models/content/ruleBaseItem';
import { Configuration } from '../../models/configuration';
import { XpException } from '../../models/xpException';
import { SiemjManager } from '../../models/siemj/siemjManager';
import { SiemJOutputParser} from '../../models/siemj/siemJOutputParser';
import { IntegrationTestRunner } from '../../models/tests/integrationTestRunner';
import { RunIntegrationTestDialog } from '../runIntegrationDialog';
import { OperationCanceledException } from '../../models/operationCanceledException';

export class LocalizationExamplesGenerator {
	constructor(
		private readonly config: Configuration,
		private readonly integrationTestTmpFilesPath: string
	) { }
	
	private async getLocalizationExamples(rule: RuleBaseItem): Promise<LocalizationExample[]> {
		return await vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			cancellable: true,
		}, async (progress, token : vscode.CancellationToken) => {
				
			let result: string;
			
			if(fs.existsSync(this.integrationTestTmpFilesPath)) {
				const subDirItems = await fs.promises.readdir(this.integrationTestTmpFilesPath, { withFileTypes: true });

				if(subDirItems.length > 0) {
					result = await DialogHelper.showInfo(
						"Обнаружены результаты предыдущего запуска интеграционных тестов. Если вы модифицировали только правила локализации, то можно использовать предыдущие результаты. В противном случае необходимо запустить интеграционные тесты еще раз.", 
						"Использовать",
						"Повторить");
	
					// Если пользователь закрыл диалог, завершаем работу.
					if(!result) {
						throw new OperationCanceledException(this.config.getMessage("OperationWasAbortedByUser"));
					}
				}
			}

			if(!result || result === "Повторить") {
				progress.report({ message: `Получение зависимостей правила для корректной сборки графа корреляций` });
				const ritd = new RunIntegrationTestDialog(this.config, this.integrationTestTmpFilesPath);
				const options = await ritd.getIntegrationTestRunOptions(rule);
				options.cancellationToken = token;

				progress.report({ message: `Получение корреляционных событий на основе интеграционных тестов правила` });
				const outputParser = new SiemJOutputParser();
				const testRunner = new IntegrationTestRunner(this.config, outputParser);
				const siemjResult = await testRunner.runOnce(rule, options);

				if (!siemjResult.testsStatus) {
					throw new XpException("Не все интеграционные тесты прошли. Для получения тестовых локализации необходимо чтобы успешно проходили все интеграционные тесты");
				}
			}

			progress.report({ message: `Генерация локализаций на основе корреляционных событий из интеграционных тестов`});
			const siemjManager = new SiemjManager(this.config);
			const locExamples = await siemjManager.buildLocalizationExamples(rule, this.integrationTestTmpFilesPath);

			return locExamples;
		});
	}

	private async getEventsForLocalization(rule: RuleBaseItem, progress: any, token : vscode.CancellationToken) {
		progress.report({ message: `Получение зависимостей правила для корректной сборки графа корреляций` });
		const ritd = new RunIntegrationTestDialog(this.config, this.integrationTestTmpFilesPath);
		const options = await ritd.getIntegrationTestRunOptions(rule);
		options.cancellationToken = token;

		progress.report({ message: `Получение корреляционных событий на основе интеграционных тестов правила` });
		const outputParser = new SiemJOutputParser();
		const testRunner = new IntegrationTestRunner(this.config, outputParser);
		const siemjResult = await testRunner.runOnce(rule, options);

		if (!siemjResult.testsStatus) {
			throw new XpException("Не все интеграционные тесты прошли. Для получения тестовых локализации необходимо чтобы успешно проходили все интеграционные тесты");
		}
	}
}