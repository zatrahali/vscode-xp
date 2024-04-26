import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import { TestHelper } from '../../helpers/testHelper';
import { ContentItemStatus, RuleBaseItem } from '../../models/content/ruleBaseItem';
import { Configuration } from '../../models/configuration';
import { DialogHelper } from '../../helpers/dialogHelper';
import { ContentTreeProvider } from '../contentTree/contentTreeProvider';
import { SiemjManager } from '../../models/siemj/siemjManager';
import { XpException } from '../../models/xpException';
import { SiemJOutputParser } from '../../models/siemj/siemJOutputParser';
import { RunIntegrationTestDialog } from '../runIntegrationDialog';
import { LocalizationEditorViewProvider } from './localizationEditorViewProvider';
import { ExceptionHelper } from '../../helpers/exceptionHelper';
import { FileSystemHelper } from '../../helpers/fileSystemHelper';
import { OperationCanceledException } from '../../models/operationCanceledException';
import { RuleCommandParams, ViewCommand } from '../../models/command/command';
import { LocalizationExample } from '../../models/content/localization';
import { Log } from '../../extension';
import { IntegrationTestRunner } from '../../models/tests/integrationTestRunner';

/**
 * Команда выполняющая сборку всех графов: нормализации, агрегации, обогащения и корреляции.
 */
export class CheckLocalizationCommand extends ViewCommand {
	constructor(
		private provider: LocalizationEditorViewProvider,
		private params: RuleCommandParams) {
		super();
	}

	public async execute(): Promise<void> {
		try {
			if(!TestHelper.isTestedLocalizationsRule(this.params.rule)) {
				DialogHelper.showInfo(
					"В настоящий момент поддерживается проверка локализаций только для корреляций. Если вам требуется поддержка других правил, можете добавить или проверить наличие подобного [Issue](https://github.com/Security-Experts-Community/vscode-xp/issues).");					
				return;
			}

			// Сбрасываем статус правила в исходный
			this.params.rule.setStatus(ContentItemStatus.Default);
			await ContentTreeProvider.refresh(this.params.rule);

			const localizations = this.params.message.localizations;
			await this.provider.saveLocalization(localizations, false);
			
			const locExamples = await this.getLocalizationExamples();

			if (locExamples.length === 0) {
				DialogHelper.showInfo(
					"По имеющимся событиям не отработала ни одна локализация. Проверьте, что интеграционные тесты проходят, корректны критерии локализации. После исправлений повторите.");
				return;
			}

			const isDefaultLocalization = locExamples.some(le => TestHelper.isDefaultLocalization(le.ruText));
			if(isDefaultLocalization) {
				DialogHelper.showError("Обнаружена локализация по умолчанию. Исправьте/добавьте нужные критерии локализаций и повторите");
				this.params.rule.setStatus(ContentItemStatus.Unverified, "Локализация не прошла проверку, обнаружен пример локализации по умолчанию");
			} else {
				this.params.rule.setStatus(ContentItemStatus.Verified, "Интеграционные тесты и локализации прошли проверку");
			}

			await ContentTreeProvider.refresh(this.params.rule);

			this.params.rule.setLocalizationExamples(locExamples);
			this.provider.showLocalizationEditor(this.params.rule, true);
		}
		catch(error) {
			ExceptionHelper.show(error, "Неожиданная ошибка тестирования локализаций");

			// Если произошла отмена операции, мы не очищаем временные файлы.
			if(error instanceof OperationCanceledException) {
				return;	
			}
			
			try {
				await FileSystemHelper.deleteAllSubDirectoriesAndFiles(this.params.tmpDirPath);
			}
			catch(error) {
				Log.warn("Ошибка очистки временных файлов интеграционных тестов", error);
			}
		}
	}

	private async getLocalizationExamples(): Promise<LocalizationExample[]> {
		return await vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			cancellable: true,
		}, async (progress, token) => {
				
			let result: string;
			
			if(fs.existsSync(this.params.tmpDirPath)) {
				const subDirItems = await fs.promises.readdir(this.params.tmpDirPath, { withFileTypes: true });

				if(subDirItems.length > 0) {
					result = await DialogHelper.showInfo(
						"Обнаружены результаты предыдущего запуска интеграционных тестов. Если вы модифицировали только правила локализации, то можно использовать предыдущие результаты. В противном случае необходимо запустить интеграционные тесты еще раз.", 
						CheckLocalizationCommand.USE_OLD_TESTS_RESULT,
						CheckLocalizationCommand.RESTART_TESTS);
	
					// Если пользователь закрыл диалог, завершаем работу.
					if(!result) {
						throw new OperationCanceledException(this.params.config.getMessage("OperationWasAbortedByUser"));
					}
				}
			}

			if(!result || result === CheckLocalizationCommand.RESTART_TESTS) {
				progress.report({ message: `Получение зависимостей правила для корректной сборки графа корреляций` });
				const ritd = new RunIntegrationTestDialog(this.params.config, {tmpFilesPath: this.params.tmpDirPath, cancellationToken: token});
				const options = await ritd.getIntegrationTestRunOptionsForSingleRule(this.params.rule);
				options.cancellationToken = token;

				progress.report({ message: `Получение корреляционных событий на основе интеграционных тестов правила` });
				const outputParser = new SiemJOutputParser();
				const testRunner = new IntegrationTestRunner(this.params.config, outputParser);
				const siemjResult = await testRunner.runOnce(this.params.rule, options);

				if (!siemjResult.testsStatus) {
					throw new XpException("Не все интеграционные тесты прошли. Для получения тестовых локализации необходимо чтобы успешно проходили все интеграционные тесты");
				}
			}

			progress.report({ message: `Генерация локализаций на основе корреляционных событий из интеграционных тестов`});
			const siemjManager = new SiemjManager(this.params.config);
			const locExamples = await siemjManager.buildLocalizationExamples(this.params.rule, this.params.tmpDirPath);

			return locExamples;
		});
	}

	public static readonly USE_OLD_TESTS_RESULT = "Использовать";
	public static readonly RESTART_TESTS = "Повторить";
}