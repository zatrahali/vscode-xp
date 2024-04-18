import * as vscode from 'vscode';

import { Command, CommandParams } from '../../models/command/command';
import { TestHelper } from '../../helpers/testHelper';
import { DialogHelper } from '../../helpers/dialogHelper';
import { RunIntegrationTestDialog } from '../runIntegrationDialog';
import { SiemJOutputParser } from '../../models/siemj/siemJOutputParser';
import { IntegrationTestRunner } from '../../models/tests/integrationTestRunner';
import { TestStatus } from '../../models/tests/testStatus';
import { ContentItemStatus } from '../../models/content/ruleBaseItem';
import { Log } from '../../extension';
import { ContentTreeProvider } from '../contentTree/contentTreeProvider';

export class RunIntegrationTestsCommand extends Command {

	constructor(private params: CommandParams) {
		super();
	}
	
	public async execute(): Promise<boolean> {
		return vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			cancellable: true,
		}, async (progress, cancellationToken: vscode.CancellationToken) => {

			const tests = this.params.rule.getIntegrationTests();
			const ruleName = this.params.rule.getName();
			const config = this.params.config;
			if (tests.length == 0) {
				DialogHelper.showInfo(config.getMessage("View.IntegrationTests.Message.NoTestsFound", ruleName));
				return false;
			}

			// Уточняем информацию для пользователей если в правиле обнаружено использование сабрулей.
			const ruleCode = await this.params.rule.getRuleCode();
			if (TestHelper.isRuleCodeContainsSubrules(ruleCode)) {
				const progressMessage = config.getMessage("View.IntegrationTests.Progress.RunAllTestsWithSubrules", ruleName);
				Log.info(progressMessage);
				progress.report({message: progressMessage});
			} else {
				const progressMessage = config.getMessage("View.IntegrationTests.Progress.RunAllTests", ruleName);
				Log.info(progressMessage);
				progress.report({message: progressMessage});
			}

			const ritd = new RunIntegrationTestDialog(config, this.params.tmpDirPath);
			const testRunnerOptions = await ritd.getIntegrationTestRunOptionsForSingleRule(this.params.rule);
			testRunnerOptions.cancellationToken = cancellationToken;

			const outputParser = new SiemJOutputParser();
			const testRunner = new IntegrationTestRunner(config, outputParser);
			const siemjResult = await testRunner.runOnce(this.params.rule, testRunnerOptions);

			config.resetDiagnostics(siemjResult.fileDiagnostics);

			const executedIntegrationTests = this.params.rule.getIntegrationTests();
			if(executedIntegrationTests.every(it => it.getStatus() === TestStatus.Success)) {
				// Задаём и обновляем статус элемента дерева
				this.params.rule.setStatus(
					ContentItemStatus.Verified,
					config.getMessage("View.ObjectTree.ItemStatus.TestsPassed")
				);

				DialogHelper.showInfo(config.getMessage("View.IntegrationTests.Message.TestsPassed", ruleName));
				await ContentTreeProvider.refresh(this.params.rule);
				return true;
			} 

			if(executedIntegrationTests.some(it => it.getStatus() === TestStatus.Success)) {
				this.params.rule.setStatus(
					ContentItemStatus.Unverified,
					config.getMessage("View.ObjectTree.ItemStatus.TestsFailed")
				);

				DialogHelper.showWarning(config.getMessage("View.IntegrationTests.Message.NotAllTestsWereSuccessful", ruleName));
				await ContentTreeProvider.refresh(this.params.rule);
				return true;
			} 

			this.params.rule.setStatus(ContentItemStatus.Default);
			DialogHelper.showError(config.getMessage("View.IntegrationTests.Message.AllTestsFailed", ruleName));
			ContentTreeProvider.refresh(this.params.rule);
			return true;
		});
	}
}
