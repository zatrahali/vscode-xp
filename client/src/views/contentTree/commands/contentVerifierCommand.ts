import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

import { DialogHelper } from '../../../helpers/dialogHelper';
import { Correlation } from '../../../models/content/correlation';
import { ContentItemStatus, RuleBaseItem } from '../../../models/content/ruleBaseItem';
import { ContentTreeProvider } from '../contentTreeProvider';
import { TestHelper } from '../../../helpers/testHelper';
import { SiemjManager } from '../../../models/siemj/siemjManager';
import { Configuration } from '../../../models/configuration';
import { RunIntegrationTestDialog } from '../../runIntegrationDialog';
import { SiemJOutputParser, SiemjExecutionResult } from '../../../models/siemj/siemJOutputParser';
import { IntegrationTestRunner, IntegrationTestRunnerOptions } from '../../../models/tests/integrationTestRunner';
import { ContentTreeBaseItem } from '../../../models/content/contentTreeBaseItem';
import { ExceptionHelper } from '../../../helpers/exceptionHelper';
import { Enrichment } from '../../../models/content/enrichment';
import { Log } from '../../../extension';
import { FileSystemHelper } from '../../../helpers/fileSystemHelper';
import { Normalization } from '../../../models/content/normalization';
import { TestStatus } from '../../../models/tests/testStatus';
import { BaseUnitTest } from '../../../models/tests/baseUnitTest';
import { ViewCommand } from './viewCommand';
import { XpException } from '../../../models/xpException';

/**
 * Проверяет контент по требованиям. В настоящий момент реализована только проверка интеграционных тестов и локализаций.
 * TODO: учесть обновление дерева контента пользователем во время операции.
 * TODO: после обновления дерева статусы item-ам присваиваться не будут, нужно обновить список обрабатываемых рулей.
 */
export class ContentVerifierCommand extends ViewCommand {
	constructor(private readonly config: Configuration, private parentItem: ContentTreeBaseItem) {
		super();
	}

	async execute() : Promise<void> {
		this.integrationTestTmpFilesPath = this.config.getRandTmpSubDirectoryPath();

		return await vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			cancellable: true,
		}, async (progress, token) => {

			// Сбрасываем статус правил в исходный
			// TODO: Добавить поддержку других типов
			// const items = parentItem.getChildren();
			const totalChildItems = this.getChildrenRecursively(this.parentItem);
			const rules = totalChildItems.filter(i => (i instanceof RuleBaseItem)).map<RuleBaseItem>(r => r as RuleBaseItem);
			if(rules.length === 0) {
				DialogHelper.showInfo(`В директории ${this.parentItem.getName()} не найдено контента для проверки`);
				return;
			}

			const testRunner = await this.buildAllArtifacts(rules, {progress: progress, cancellationToken: token});
			for(const rule of rules) {
				progress.report({ message: `Проверка правила ${rule.getName()}`});
				await this.testCorrelation(rule, testRunner, progress);
				await ContentTreeProvider.refresh(rule);
			}

			// TODO: Обновление статуса ведет к обновлению дерева и утраты управления состоянием узлов.
			// for(const rule of rules) {
			// 	rule.setStatus(ContentItemStatus.Default);
			// }
			// ContentTreeProvider.refresh(parentItem);
			//
			// Log.info(`В ${this.parentItem.getName()} директории начата проверка ${rules.length} правил`);
			// try {
			// 	for(const rule of rules) {
			// 		progress.report({ message: `Проверка правила ${rule.getName()}`});
			// 		await this.testRule(rule, progress, token);
			// 		await ContentTreeProvider.refresh(rule);
			// 	}

			// 	DialogHelper.showInfo(`Проверка директории ${this.parentItem.getName()} завершена`);
			// }
			// catch(error) {
			// 	ExceptionHelper.show(error, "Неожиданная ошибка проверки контента");
			// }
		});

		// TODO: Удалить временную директорию this._integrationTestTmpFilesPath
	}

	private async buildAllArtifacts(
		rules: RuleBaseItem[],
		options: {progress: any, cancellationToken: vscode.CancellationToken}
	) : Promise<IntegrationTestRunner> {
		// Подбираем настройки сборки графа корреляции
		const unionOptions = new IntegrationTestRunnerOptions();
		unionOptions.tmpFilesPath = this.integrationTestTmpFilesPath;

		for(const rule of rules) {
			if(rule instanceof Correlation) {
				options.progress.report({ message: `Получение зависимостей правила ${rule.getName()} для корректной сборки графа корреляций`});
				const ritd = new RunIntegrationTestDialog(this.config);
				const ruleRunOptions = await ritd.getIntegrationTestRunOptions(rule);
				unionOptions.union(ruleRunOptions);
			}
		}

		const outputParser = new SiemJOutputParser();
		const testRunner = new IntegrationTestRunner(this.config, outputParser);

		// TODO: проверить результаты сборки артефактов
		options.progress.report({ message: `Сборка артефактов для всех правил`});
		const siemjResult = await testRunner.compileArtifacts(unionOptions);
		return testRunner;
	}

	private async testCorrelation(
		rule: RuleBaseItem,
		runner: IntegrationTestRunner,
		progress: any) {

		progress.report({ message: `Проверка интеграционных тестов правила ${rule.getName()}`});
		const siemjResult = await runner.run(rule);
		
		if (!siemjResult.testsStatus) {
			rule.setStatus(ContentItemStatus.Unverified, "Интеграционные тесты не прошли проверку");
			return;
		}
		rule.setStatus(ContentItemStatus.Verified, "Интеграционные тесты прошли проверку");

		progress.report({ message: `Проверка локализации правила ${rule.getName()}`});
			
		const ruleTmpFilesRuleName = path.join(this.integrationTestTmpFilesPath, rule.getName());
		if(!fs.existsSync(ruleTmpFilesRuleName)) {
			throw new XpException("Не найдены результаты выполнения интеграционных тестов");
		}

		const siemjManager = new SiemjManager(this.config);
		const locExamples = await siemjManager.buildLocalizationExamples(rule, ruleTmpFilesRuleName);

		if (locExamples.length === 0) {
			rule.setStatus(ContentItemStatus.Unverified, "Локализации не были получены");
			return;
		}

		const verifiedLocalization = locExamples.some(le => TestHelper.isDefaultLocalization(le.ruText));
		if(verifiedLocalization) {
			rule.setStatus(
				ContentItemStatus.Unverified,
				"Локализация не прошла проверку, обнаружен пример локализации по умолчанию"
			);
		} else {
			rule.setStatus(
				ContentItemStatus.Verified,
				"Интеграционные тесты и локализации прошли проверку"
			);
		}

		rule.setLocalizationExamples(locExamples);
	}

	private getChildrenRecursively(parentItem: ContentTreeBaseItem): ContentTreeBaseItem[] {
		const items = parentItem.getChildren();
		const totalItems:  ContentTreeBaseItem[] = [];
		totalItems.push(...items);
		for(const item of items) {
			const childItems = this.getChildrenRecursively(item);
			totalItems.push(...childItems);
		}
		return totalItems;
	}

	private async testRule(rule: RuleBaseItem, progress: any, cancellationToken: vscode.CancellationToken) {
		// В отдельную директорию положим все временные файлы, чтобы не путаться.
		if(fs.existsSync(this.integrationTestTmpFilesPath)) {
			await FileSystemHelper.deleteAllSubDirectoriesAndFiles(this.integrationTestTmpFilesPath);
		}
		
		const ruleTmpFilesRuleName = path.join(this.integrationTestTmpFilesPath, rule.getName());
		if(!fs.existsSync(ruleTmpFilesRuleName)) {
			await fs.promises.mkdir(ruleTmpFilesRuleName, {recursive: true});
		}

		// Тестирование нормализаций
		if(rule instanceof Normalization) {
			const tests = rule.getUnitTests();

			// Сбрасываем результаты предыдущих тестов.
			tests.forEach(t => t.setStatus(TestStatus.Unknown));
			const testHandler = async (unitTest : BaseUnitTest) => {
				const rule = unitTest.getRule();
				const testRunner = rule.getUnitTestRunner();
				return testRunner.run(unitTest);
			};
	
			// Запускаем все тесты
			for (let test of tests) {
				try {
					test = await testHandler(test);
				}
				catch(error) {
					test.setStatus(TestStatus.Failed);
					Log.error(error);
				} 
			}

			// Проверяем результаты тестов и меняем статус в UI.
			if(tests.every(t => t.getStatus() === TestStatus.Success)) {
				rule.setStatus(ContentItemStatus.Verified, "Тесты прошли проверку");
				return;
			}
			rule.setStatus(ContentItemStatus.Unverified, "Тесты не прошли проверку");

			ContentTreeProvider.refresh(rule);
		}

		if(rule instanceof Correlation || rule instanceof Enrichment) {
			progress.report({ message: `Получение зависимостей правила ${rule.getName()} для корректной сборки графа корреляций` });
			const ritd = new RunIntegrationTestDialog(this.config, ruleTmpFilesRuleName);
			const options = await ritd.getIntegrationTestRunOptions(rule);
			options.cancellationToken = cancellationToken;
	
			progress.report({ message: `Проверка интеграционных тестов правила ${rule.getName()}`});
			const outputParser = new SiemJOutputParser();
			const testRunner = new IntegrationTestRunner(this.config, outputParser);
	
			// TODO: исключить лишнюю сборку артефактов
			const siemjResult = await testRunner.runOnce(rule, options);
	
			if (!siemjResult.testsStatus) {
				rule.setStatus(ContentItemStatus.Unverified, "Интеграционные тесты не прошли проверку");
				return;
			}

			rule.setStatus(ContentItemStatus.Verified, "Интеграционные тесты прошли проверку");
		}

		if(rule instanceof Correlation) {
			progress.report({ message: `Проверка локализаций правила ${rule.getName()}`});
			
			const siemjManager = new SiemjManager(this.config);
			const locExamples = await siemjManager.buildLocalizationExamples(rule, ruleTmpFilesRuleName);

			if (locExamples.length === 0) {
				rule.setStatus(ContentItemStatus.Unverified, "Локализации не были получены");
				return;
			}

			const verifiedLocalization = locExamples.some(le => TestHelper.isDefaultLocalization(le.ruText));
			if(verifiedLocalization) {
				rule.setStatus(ContentItemStatus.Unverified, "Локализация не прошла проверку, обнаружен пример локализации по умолчанию");
			} else {
				rule.setStatus(ContentItemStatus.Verified, "Интеграционные тесты и локализации прошли проверку");
			}

			rule.setLocalizationExamples(locExamples);
		}
	}

	private integrationTestTmpFilesPath: string
}