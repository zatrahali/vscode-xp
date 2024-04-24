import * as vscode from 'vscode';

import { DialogHelper } from '../../../helpers/dialogHelper';
import { Correlation } from '../../../models/content/correlation';
import { ContentItemStatus, RuleBaseItem } from '../../../models/content/ruleBaseItem';
import { ContentTreeProvider } from '../contentTreeProvider';
import { Configuration } from '../../../models/configuration';
import { RunIntegrationTestDialog } from '../../runIntegrationDialog';
import { SiemJOutputParser} from '../../../models/siemj/siemJOutputParser';
import { CompilationType, IntegrationTestRunner, IntegrationTestRunnerOptions } from '../../../models/tests/integrationTestRunner';
import { ContentTreeBaseItem } from '../../../models/content/contentTreeBaseItem';
import { Enrichment } from '../../../models/content/enrichment';
import { Log } from '../../../extension';
import { Normalization } from '../../../models/content/normalization';
import { TestStatus } from '../../../models/tests/testStatus';
import { BaseUnitTest } from '../../../models/tests/baseUnitTest';
import { ViewCommand } from './viewCommand';
import { OperationCanceledException } from '../../../models/operationCanceledException';

/**
 * Проверяет контент по требованиям. В настоящий момент реализована только проверка интеграционных тестов и локализаций.
 * TODO: учесть обновление дерева контента пользователем во время операции.
 * TODO: после обновления дерева статусы item-ам присваиваться не будут, нужно обновить список обрабатываемых рулей.
 */
export class ContentCheckingCommand extends ViewCommand {
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
			const totalChildItems = this.getChildrenRecursively(this.parentItem, token);
			const rules = totalChildItems.filter(i => (i instanceof RuleBaseItem)).map<RuleBaseItem>(r => r as RuleBaseItem);
			if(rules.length === 0) {
				DialogHelper.showInfo(`В директории ${this.parentItem.getName()} не найдено контента для проверки`);
				return;
			}

			const testRunner = await this.buildAllArtifacts(rules,
				{
					progress: progress,
					cancellationToken: token
				}
			);

			for(const rule of rules) {
				// Игнорируем все, кроме правил корреляции, обогащения и нормализации
				if(!(rule instanceof Correlation) && !(rule instanceof Enrichment) && !(rule instanceof Normalization)) {
					continue;
				}

				if(rule instanceof Correlation) {
					await this.testCorrelation(
						rule,
						testRunner,
						{
							progress: progress,
							cancellationToken: token
						}
					);
				}

				if(rule instanceof Enrichment) {
					await this.testEnrichment(
						rule,
						testRunner,
						{
							progress: progress,
							cancellationToken: token
						}
					);
				}

				if(rule instanceof Normalization) {
					await this.testNormalization(
						rule,
						{
							progress: progress,
							cancellationToken: token
						}
					);
				}

				await ContentTreeProvider.refresh(rule);
			}

			DialogHelper.showInfo(this.config.getMessage("View.ObjectTree.Message.ContentChecking.CompletedSuccessfully", this.parentItem.getName()));
		});
	}

	private async buildAllArtifacts(
		rules: RuleBaseItem[],
		options: {progress: any, cancellationToken: vscode.CancellationToken}
	) : Promise<IntegrationTestRunner> {
		const unionOptions = new IntegrationTestRunnerOptions();
		unionOptions.tmpFilesPath = this.integrationTestTmpFilesPath;
		unionOptions.cancellationToken = options.cancellationToken;

		// Собираем обобщенные настройки для компиляции графа корреляции.
		let correlationBuildingConfigured = false;
		let enrichmentBuildingConfigured = false;
		for(const rule of rules) {
			// Сбрасываем статус для правила в дереве объектов.
			rule.setStatus(ContentItemStatus.Default);
			ContentTreeProvider.refresh(rule);

			if(options.cancellationToken.isCancellationRequested) {
				throw new OperationCanceledException(this.config.getMessage("OperationWasAbortedByUser"));
			}

			if(rule instanceof Correlation) {
				const statusMessage = this.config.getMessage("View.ObjectTree.Progress.ContentChecking.GetDependencies", rule.getName());
				Log.info(statusMessage);
				options.progress.report({ message: statusMessage});
				
				const ritd = new RunIntegrationTestDialog(this.config, {cancellationToken: options.cancellationToken});
				const ruleRunOptions = await ritd.getIntegrationTestRunOptionsForSingleRule(rule);
				unionOptions.union(ruleRunOptions);

				correlationBuildingConfigured = true;
			}

			if(rule instanceof Enrichment && !enrichmentBuildingConfigured) {
				const ruleRunOptions = await this.enrichmentBuildingConfigurationForAllEnrichment(rule);
				unionOptions.union(ruleRunOptions);

				enrichmentBuildingConfigured = true;
			}
		}

		const outputParser = new SiemJOutputParser();
		const testRunner = new IntegrationTestRunner(this.config, outputParser);

		if(correlationBuildingConfigured || enrichmentBuildingConfigured) {
			const statusMessage = this.config.getMessage("View.ObjectTree.Progress.ContentChecking.BuildAllArtifacts");
			Log.info(statusMessage);
			options.progress.report({ message: statusMessage});
			
			await testRunner.compileArtifacts(unionOptions);
		}
		
		// TODO: проверить результаты сборки артефактов
		return testRunner;
	}

	private async enrichmentBuildingConfigurationForAllEnrichment(rule: Enrichment): Promise<IntegrationTestRunnerOptions> {
		const testRunnerOptions = new IntegrationTestRunnerOptions();
		const result = await this.askTheUser();

		testRunnerOptions.currPackagePath = rule.getPackagePath(this.config);
		
		switch(result) {
			case this.config.getMessage("View.ObjectTree.Message.ContentChecking.ChoosingCorrelationCompilation.CurrentPackage"): {
				testRunnerOptions.correlationCompilation = CompilationType.CurrentPackage;
				break;
			}

			case this.config.getMessage("View.ObjectTree.Message.ContentChecking.ChoosingCorrelationCompilation.AllPackages"): {
				testRunnerOptions.correlationCompilation = CompilationType.AllPackages;
				break;
			}
			
			case this.config.getMessage("View.ObjectTree.Message.ContentChecking.ChoosingCorrelationCompilation.DontCompile"): {
				testRunnerOptions.correlationCompilation = CompilationType.DontCompile;
				break;
			}
		}

		return testRunnerOptions;
	}

	private async askTheUser(): Promise<string> {
		const result = await DialogHelper.showInfo(
			this.config.getMessage("View.ObjectTree.Message.ContentChecking.ChoosingCorrelationCompilation"),
			this.config.getMessage("View.ObjectTree.Message.ContentChecking.ChoosingCorrelationCompilation.CurrentPackage"),
			this.config.getMessage("View.ObjectTree.Message.ContentChecking.ChoosingCorrelationCompilation.DontCompile"),
			this.config.getMessage("View.ObjectTree.Message.ContentChecking.ChoosingCorrelationCompilation.AllPackages")
		);

		if(!result) {
			throw new OperationCanceledException(this.config.getMessage("OperationWasAbortedByUser"));
		}

		return result;
	}

	private async testNormalization(
		rule: RuleBaseItem,
		options: {progress: any, cancellationToken: vscode.CancellationToken}
	) {
		const statusMessage = this.config.getMessage("View.ObjectTree.Progress.ContentChecking.NormalizationChecking", rule.getName());
		Log.info(statusMessage);
		options.progress.report({ message: statusMessage});

		if(options.cancellationToken.isCancellationRequested) {
			throw new OperationCanceledException(this.config.getMessage("OperationWasAbortedByUser"));
		}

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
			const message = this.config.getMessage("View.ObjectTree.ItemStatus.TestsPassed");
			Log.debug(message);
			rule.setStatus(ContentItemStatus.Verified, message);
		} else {
			const message = this.config.getMessage("View.ObjectTree.ItemStatus.TestsFailed");
			Log.debug(message);
			rule.setStatus(ContentItemStatus.Unverified, message);		
		}
	}

	private async testCorrelation(
		rule: RuleBaseItem,
		runner: IntegrationTestRunner,
		options: {progress: any, cancellationToken: vscode.CancellationToken}
	) {
		const statusMessage = this.config.getMessage("View.ObjectTree.Progress.ContentChecking.CorrelationChecking", rule.getName());
		Log.info(statusMessage);
		options.progress.report({ message: statusMessage});

		if(options.cancellationToken.isCancellationRequested) {
			throw new OperationCanceledException(this.config.getMessage("OperationWasAbortedByUser"));
		}

		const siemjResult = await runner.run(rule);
		if (siemjResult.testsStatus) {
			const message = this.config.getMessage("View.ObjectTree.ItemStatus.TestsPassed");
			Log.debug(message);
			rule.setStatus(ContentItemStatus.Verified, message);
		} else {
			const message = this.config.getMessage("View.ObjectTree.ItemStatus.TestsFailed");
			Log.debug(message);
			rule.setStatus(ContentItemStatus.Unverified, message);	
		}

		// TODO: временно отключены тесты локализаций, так как siemkb_tests.exe падает со следующей ошибкой:
		// TEST_RULES :: log4cplus:ERROR Unable to open file: C:\Users\user\AppData\Local\Temp\eXtraction and Processing\tmp\5239e794-c14a-7526-113c-52479c1694d6\AdAstra_TraceMode_File_Suspect_Operation_Inst_Fldr\2024-04-18_19-06-45_unknown_sdk_227gsqqu\AdAstra_TraceMode_File_Suspect_Operation_Inst_Fldr\tests\raw_events_4_norm_enr.log
		// TEST_RULES :: Error: SDK: Cannot open fpta db C:\Users\user\AppData\Local\Temp\eXtraction and Processing\tmp\5239e794-c14a-7526-113c-52479c1694d6\AdAstra_TraceMode_File_Suspect_Operation_Inst_Fldr\2024-04-18_19-06-45_unknown_sdk_227gsqqu\AdAstra_TraceMode_File_Suspect_Operation_Inst_Fldr\tests\raw_events_4_fpta.db : it's not exists
		// const testTmpDirectory = path.join(this.options.tmpFilesPath, rule.getName());

		// options.progress.report({ message: `Проверка локализации правила ${rule.getName()}`});
		// const ruleTmpFilesRuleName = path.join(this.integrationTestTmpFilesPath, rule.getName());
		// if(!fs.existsSync(ruleTmpFilesRuleName)) {
		// 	throw new XpException("Не найдены результаты выполнения интеграционных тестов");
		// }

		// const siemjManager = new SiemjManager(this.config, options.cancellationToken);
		// const locExamples = await siemjManager.buildLocalizationExamples(rule, ruleTmpFilesRuleName);

		// if (locExamples.length === 0) {
		// 	rule.setStatus(ContentItemStatus.Unverified, "Локализации не были получены");
		// 	return;
		// }

		// const verifiedLocalization = locExamples.some(le => TestHelper.isDefaultLocalization(le.ruText));
		// if(verifiedLocalization) {
		// 	rule.setStatus(
		// 		ContentItemStatus.Unverified,
		// 		"Локализация не прошла проверку, обнаружен пример локализации по умолчанию"
		// 	);
		// } else {
		// 	rule.setStatus(
		// 		ContentItemStatus.Verified,
		// 		"Интеграционные тесты и локализации прошли проверку"
		// 	);
		// }

		// rule.setLocalizationExamples(locExamples);
	}

	private async testEnrichment(
		rule: RuleBaseItem,
		runner: IntegrationTestRunner,
		options: {progress: any, cancellationToken: vscode.CancellationToken}
	) {
		const statusMessage = this.config.getMessage("View.ObjectTree.Progress.ContentChecking.EnrichmentChecking", rule.getName());
		Log.info(statusMessage);
		options.progress.report({ message: statusMessage});

		if(options.cancellationToken.isCancellationRequested) {
			throw new OperationCanceledException(this.config.getMessage("OperationWasAbortedByUser"));
		}

		const siemjResult = await runner.run(rule);
		
		if (siemjResult.testsStatus) {
			const message = this.config.getMessage("View.ObjectTree.ItemStatus.TestsPassed");
			Log.debug(message);
			rule.setStatus(ContentItemStatus.Verified, message);
		} else {
			const message = this.config.getMessage("View.ObjectTree.ItemStatus.TestsFailed");
			Log.debug(message);
			rule.setStatus(ContentItemStatus.Unverified, message);	
		}
	}

	private getChildrenRecursively(parentItem: ContentTreeBaseItem, cancellationToken: vscode.CancellationToken): ContentTreeBaseItem[] {
		if(cancellationToken.isCancellationRequested) {
			throw new OperationCanceledException(this.config.getMessage("OperationWasAbortedByUser"));
		}

		const items = parentItem.getChildren();
		const totalItems: ContentTreeBaseItem[] = [];

		totalItems.push(...items);
		for(const item of items) {
			const childItems = this.getChildrenRecursively(item, cancellationToken);
			totalItems.push(...childItems);
		}
		return totalItems;
	}

	private integrationTestTmpFilesPath: string;
}