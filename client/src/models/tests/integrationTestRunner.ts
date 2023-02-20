import * as fs from 'fs';
import * as vscode from 'vscode';

import { ExtensionHelper } from '../../helpers/extensionHelper';
import { ProcessHelper } from '../../helpers/processHelper';
import { SiemjConfigHelper } from '../../helpers/siemjConfigHelper';
import { TestHelper } from '../../helpers/testHelper';
import { VsCodeApiHelper } from '../../helpers/vsCodeApiHelper';
import { SiemJOutputParser } from '../../views/integrationTests/siemJOutputParser';
import { Configuration } from '../configuration';
import { RuleBaseItem } from '../content/ruleBaseItem';
import { IntegrationTest } from './integrationTest';
import { TestStatus } from './testStatus';

export class IntegrationTestRunner {

	constructor(private _config: Configuration, private _outputParser: SiemJOutputParser) {
	}

	public async run(rule : RuleBaseItem) : Promise<IntegrationTest[]> {

		const integrationTests = rule.getIntegrationTests();
		if(integrationTests.length == 0) {
			throw new Error("Не заданы тесты для запуска");
		}

		// Хотя бы у одного теста есть сырые события и код теста.
		const atLeastOneTestIsValid = integrationTests.some( it => {
			if(!it.getRawEvents()) {
				return false;
			}

			if(!it.getTestCode()) {
				return false;
			}

			return true;
		});

		if(!atLeastOneTestIsValid) {
			ExtensionHelper.showUserError("Ни один тест не содержит нужного заполнения. Заполните поле сырых событий, код теста и запустите тесты повторно.");
			return;
		}

		// Если у нас в правиле используются сабрули, то надо собрать полный граф корреляций.
		const ruleCode = await rule.getRuleCode();
		const isContainsSubrules = TestHelper.isRuleCodeContainsSubrules(ruleCode);

		// Если в правиле используются сабрули, тогда собираем весь граф корреляций.
		let siemjConfContent = "";
		if(isContainsSubrules) { 
			siemjConfContent = SiemjConfigHelper.getTestConfigForRuleWithSubrules(rule, this._config);

		} else {
			siemjConfContent = SiemjConfigHelper.getTestConfig(rule, this._config);
		}

		if(!siemjConfContent) {
			ExtensionHelper.showUserError("Не удалось сгенерировать siemj.conf для заданного правила и тестов.");
			return;
		}

		const siemjConfigPath = this._config.getTmpSiemjConfigPath();
		// Централизованно сохраняем конфигурационный файл для siemj.
		await SiemjConfigHelper.saveSiemjConfig(siemjConfContent, siemjConfigPath);

		// Очищаем и показываем окно Output.
		this._config.getOutputChannel().clear();
		
		// Типовая команда выглядит так:
		// "C:\\Work\\-=SIEM=-\\PTSIEMSDK_GUI.4.0.0.738\\tools\\siemj.exe" -c C:\\Work\\-=SIEM=-\\PTSIEMSDK_GUI.4.0.0.738\\temp\\siemj.conf main
		const siemjExePath = this._config.getSiemjPath();
		const siemJOutput = await ProcessHelper.ExecuteWithArgsWithRealtimeOutput(
			siemjExePath,
			["-c", siemjConfigPath, "main"],
			this._config.getOutputChannel());

		const ruleFileUri = vscode.Uri.file(rule.getRuleFilePath());

		if(siemJOutput.includes(this.TEST_SUCCESS_SUBSTRING)) {
			integrationTests.forEach(it => it.setStatus(TestStatus.Success));

			// Убираем ошибки по текущему правилу.
			this._config.getDiagnosticCollection().set(ruleFileUri, []);

			await this.clearTmpFiles(this._config);
		} else {
			this._config.getOutputChannel().show();
			this._config.getDiagnosticCollection().clear();

			let ruleFileDiagnostics = this._outputParser.parse(siemJOutput);

			// Фильтруем диагностики по текущему правилу.
			ruleFileDiagnostics = ruleFileDiagnostics.filter(rfd => {
				const path = rfd.Uri.path;
				return path.includes(rule.getName());
			});

			ruleFileDiagnostics = await this._outputParser.correctDiagnosticBeginCharRanges(ruleFileDiagnostics);

			for (const rfd of ruleFileDiagnostics) {
				this._config.getDiagnosticCollection().set(rfd.Uri, rfd.Diagnostics);
			}
		}

		return integrationTests;
	}

	private async clearTmpFiles(config : Configuration) : Promise<void> {
		const siemjConfigPath = config.getTmpSiemjConfigPath();

		// Очищаем временные файлы.
		await fs.promises.access(siemjConfigPath).then(
			() => { 
				return fs.promises.unlink(siemjConfigPath); 
			}
		);
	}

	private readonly TEST_SUCCESS_SUBSTRING = "All tests OK";
}