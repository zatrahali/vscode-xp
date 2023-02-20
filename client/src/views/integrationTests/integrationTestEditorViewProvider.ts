import * as fs from 'fs';
import * as vscode from 'vscode';
import * as path from 'path';

import { ExtensionHelper } from '../../helpers/extensionHelper';
import { MustacheFormatter } from '../mustacheFormatter';
import { TestHelper } from '../../helpers/testHelper';
import { IntegrationTest } from '../../models/tests/integrationTest';
import { Correlation } from '../../models/content/correlation';
import { Enrichment } from '../../models/content/enrichment';
import { RuleBaseItem } from '../../models/content/ruleBaseItem';
import { Configuration } from '../../models/configuration';
import { Normalizer } from '../../models/tests/normalizer';
import { UnitTestsRunner } from '../../models/tests/unitTestsRunner';
import { FileSystemHelper } from '../../helpers/fileSystemHelper';
import { IntegrationTestRunner } from '../../models/tests/integrationTestRunner';
import { RegExpHelper } from '../../helpers/regExpHelper';
import { FastTest } from '../../models/tests/fastTest';
import { VsCodeApiHelper } from '../../helpers/vsCodeApiHelper';
import { TestStatus } from '../../models/tests/testStatus';
import { SiemJOutputParser } from './siemJOutputParser';
import { ModuleTestOutputParser } from '../modularTestsEditor/modularTestOutputParser';
import { ExceptionHelper } from '../../helpers/exceptionHelper';
import { Interface } from 'readline';
import { XpExtentionException } from '../../models/xpException';

export class IntegrationTestEditorViewProvider  {

	public static readonly viewId = 'IntegrationTestEditorView';
	public static readonly onTestSelectionChangeCommand = "IntegrationTestEditorView.onTestSelectionChange";

	private _view?: vscode.WebviewPanel;
	private _rule: RuleBaseItem;

	public constructor(
		private readonly _config: Configuration,
		private readonly _templatePath: string) {
	}

	public static init(config: Configuration) {

		// Форма создания визуалиации интеграционных тестов.
		const templatePath = path.join(
			ExtensionHelper.getExtentionPath(), 
			path.join("client", "templates", "IntegrationTestEditor.html")
		);

		const provider = new IntegrationTestEditorViewProvider(config, templatePath);

		// Открытие формы тестов.
		config.getContext().subscriptions.push(
			vscode.commands.registerCommand(
				IntegrationTestEditorViewProvider.showEditorCommand, 
				async (rule: Correlation) => {
					// Обновляем интеграционные тесты для того, чтобы можно было увидеть актуальные тесты при их модификации на ЖД.
					rule.reloadIntegrationalTests();
					provider.showEditor(rule);
				}
			)
		);

		config.getContext().subscriptions.push(
			vscode.commands.registerCommand(
				IntegrationTestEditorViewProvider.onTestSelectionChangeCommand, 
				async (test: IntegrationTest) => {
					vscode.commands.executeCommand(IntegrationTestEditorViewProvider.showEditorCommand);
				}
			)
		);
	}

	public static readonly showEditorCommand = "IntegrationTestEditorView.showEditor";
	public async showEditor(rule: Correlation|Enrichment)  {

		if(this._view) {
			this._rule = null;
			this._view.dispose();
		}

		if(!(rule instanceof Correlation || rule instanceof Enrichment)) {
			return;
		}

		this._rule = rule;

		// Создать и показать панель.
		const viewTitle = `Тесты '${this._rule.getName()}'`;
		this._view = vscode.window.createWebviewPanel(
			IntegrationTestEditorViewProvider.viewId,
			viewTitle,
			vscode.ViewColumn.One, 
			{
				retainContextWhenHidden : true,
				enableFindWidget : true
			});

		this._view.webview.options = {
			enableScripts: true
		};

		this._view.webview.onDidReceiveMessage(
			this.receiveMessageFromWebView,
			this
		);

		await this.updateView();
	}

	private async updateView(focusTestNumber?: number) : Promise<void> {

		const intergrationalTest = this._rule.getIntegrationTests();

		// TODO: Унифицировать добавление во все вьюшки пути к расширению.
		// Побрасываем специальный путь для доступа к ресурсам.
		const config = Configuration.get();

		const resoucesUri = config.getExtentionUri();
		const extensionBaseUri = this._view.webview.asWebviewUri(resoucesUri);

		const plain = {
			"IntegrationalTests" : [],
			"ExtensionBaseUri" : extensionBaseUri, 
			"RuleName" : this._rule.getName(),
			"ActiveTestNumber" : focusTestNumber == null ? 1 : focusTestNumber,
		};

		try {
			// Если тестов нет, то создаём пустую форму для первого теста
			if (intergrationalTest.length === 0){
				plain["IntegrationalTests"].push({
					"TestNumber" : 1,
					"RawEvents" : '',
					"NormEvent" : '',
					"TestCode" : `expect 1 {"correlation_name" : "${this._rule.getName()}"}`,
					"TestOutput" : '',
					"JsonedTestObject" : '',
					"TestStatus" : '',
				});
			}
			else{
				intergrationalTest.forEach(it => {
					const jsonedTestObject = JSON.stringify(it);

					const formattedTestCode = TestHelper.formatTestCodeAndEvents(it.getTestCode());
					const formattedNormalizedEvents = TestHelper.formatTestCodeAndEvents(it.getNormalizedEvents());

					let testStatusStyle : string;
					const testStatus = it.getStatus();
					switch(testStatus) {
						case TestStatus.Unknown: {
							testStatusStyle = "";
							break;
						}
						case TestStatus.Success: {
							testStatusStyle = "success";
							break;
						}
						case TestStatus.Failed: {
							testStatusStyle = "failure";
							break;
						}
					}

					plain["IntegrationalTests"].push({
						"TestNumber" : it.getNumber(),
						"RawEvents" : it.getRawEvents(),
						"NormEvent" : formattedNormalizedEvents,
						"TestCode" : formattedTestCode,
						"TestOutput" : it.getOutput(),
						"JsonedTestObject" : jsonedTestObject,
						"TestStatus" : testStatusStyle,
					});
				});
			}

			const template = await FileSystemHelper.readContentFile(this._templatePath);
			const formatter = new MustacheFormatter(template);
			const htmlContent = formatter.format(plain);

			this._view.webview.html = htmlContent;
		}
		catch(error) {
			ExtensionHelper.showError("Ошибка открытия интеграционных тестов.", error);
		}
	}

	private async receiveMessageFromWebView(message: any) {
		switch (message.command) {
			case 'normalize': {
				if(!message.test) {
					ExtensionHelper.showUserError("Сохраните тест перед запуском нормализации сырых событий и повторите.");
					return;
				}

				// Актуализируем сырые события в тесте из вьюшки.
				const rawEvents = message.rawEvents;
				const currTest = IntegrationTest.convertFromObject(message.test);
				currTest.setRawEvents(rawEvents);
				await currTest.save();

				return this.normalizeRawEvents(currTest);
			}
			case 'fastTest': {
				return this.fastTest(message);
			}
			case 'fullTest': {
				const result = await this.runFullTests(message);
				if(!result) {
					return;
				}
				
				const activeTestNumber = this.getActiveTestNumber(message);
				this.updateView(activeTestNumber);
				break;
			}
			case 'saveTest': {
				
				const currTest = IntegrationTest.convertFromObject(message.test);
				try {
					await this.saveTest(message);
				}
				catch(error) {
					ExceptionHelper.show(error, `Ошибка сохранения теста №${currTest}.`);
					return;
				}

				const activeTestNumber = this.getActiveTestNumber(message);
				this.updateView(activeTestNumber);
				return;
			}
			case 'saveAllTests': {
				try {
					await this.saveAllTests(message);
					ExtensionHelper.showUserInfo(`Сохранение всех тестов успешно завершено.`);
				
					// Добавляем в DOM новый тест.
					const activeTestNumber = this.getActiveTestNumber(message);
					this.updateView(activeTestNumber);
				}
				catch(error) {
					ExceptionHelper.show(error, `Ошибка сохранения теста`);
				}
				return;
			}

			case 'addEnvelope': {
				return this.addEnvelope(message);
			}

			case 'cleanTestCode': {
				return this.cleanTestCode(message);
			}

			default: {
				ExtensionHelper.showUserInfo("Данная команда в настоящий момент не поддерживается. Stay tuned!");
			}
		}
	}

	private getActiveTestNumber(message : any) : number {
		const activeTestNumberString = message?.activeTestNumber;
		if(!activeTestNumberString) {
			ExtensionHelper.showUserError(`Не задан номер активного теста.`);
			return;
		}

		const activeTestNumber = parseInt(activeTestNumberString);
		return activeTestNumber;
	}

	private async cleanTestCode(message: any) {
		if(!message.test) {
			ExtensionHelper.showUserError("Сохраните тест перед запуском нормализации сырых событий и повторите.");
			return;
		}
		
		let test: IntegrationTest; 
		try {
			const testCode = message?.testCode;
			if(!testCode) {
				throw new Error("Ошибка получения кода теста из UI.");
			}

			test = IntegrationTest.convertFromObject(message.test);

			// Обновляем и сохраняем тест.
			const cleanedTestCode = TestHelper.cleanTestCode(testCode);

			this._view.webview.postMessage({
				'command': 'updateTestCode',
				'cleanedTestCode': cleanedTestCode
			});
		}
		catch (error) {
			ExtensionHelper.showError(`Ошибка при очистке кода теста №${test.getNumber()}`, error.message);
		}
	}

	private async addEnvelope(message: any) {
		
		let rawEvents = message?.rawEvents as string;
		if(!rawEvents) {
			return ExtensionHelper.showUserInfo("Не заданы сырые события для теста. Добавьте их и повторите.");
		}

		rawEvents = rawEvents.trim();
		if(TestHelper.isEnvelopedEvents(rawEvents)) {
			return ExtensionHelper.showUserInfo("Конверт для событий уже добавлен.");
		}

		const mimeType = message?.mimeType as string;
		if(!mimeType) {
			ExtensionHelper.showUserInfo("Не задан mime. Добавьте задайте его и повторите.");
			return;
		}

		// Сжали список событий и обернули в конверт.
		const compressedRawEvents = TestHelper.compressRawEvents(rawEvents);
		const envelopedRawEvents = TestHelper.addEnvelope(compressedRawEvents, mimeType);
		const envelopedRawEventsString = envelopedRawEvents.join('\n');

		this._view.webview.postMessage({
			'command': 'updateRawEvents',
			'rawEvents': envelopedRawEventsString
		});
	}

	private async normalizeRawEvents(test: IntegrationTest) {

		const rawEventsFilePath = test.getRawEventsFilePath();

		vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			cancellable: false,
			title: `Нормализация событий для теста №${test.getNumber()}`
		}, async (progress) => {

			try {
				const normalizer = new Normalizer(this._config);
				const normEvents = await normalizer.Normalize(this._rule, rawEventsFilePath);
				test.setNormalizedEvents(normEvents);
			}
			catch(error) {
				ExceptionHelper.show(error, "Не удалось нормализовать событие.");
				this._config.getOutputChannel().show();
				return;
			}

			// Обновление теста.
			const tests = this._rule.getIntegrationTests();
			const ruleTestIndex = tests.findIndex(it => it.getNumber() == test.getNumber());
			if(ruleTestIndex == -1) {
				ExtensionHelper.showUserError("Не удалось обновить интеграционный тест.");
				return;
			}

			ExtensionHelper.showUserInfo("Нормализация события успешно завершена.");

			// Обновляем правило.
			tests[ruleTestIndex] = test;
			this.updateView(test.getNumber());
		});
	}

	async fastTest(message: any) {

		await VsCodeApiHelper.saveRuleCodeFile(this._rule);

		const currTest = IntegrationTest.convertFromObject(message.test);
		let integrationalTestSimplifiedContent = "";
		let normalizedEvents = "";
		try {
			normalizedEvents = currTest.getNormalizedEvents();
			if(!normalizedEvents) {
				ExtensionHelper.showUserError("Нет нормализованных событий. Сначала нормализуйте сырые события, а потом запускайте быстрый тест.");
				return;
			}

			// Временно создать модульный тест путём добавления к интеграционному нормализованного события в конец файла.
			// Убираем фильтр по полям в тесте, так как в модульном тесте нет обогащения, поэтому проверяем только сработку теста.
			const integrationalTestPath = currTest.getTestCodeFilePath();
			const integrationalTestContent = await FileSystemHelper.readContentFile(integrationalTestPath);
			integrationalTestSimplifiedContent = integrationalTestContent.replace(
				RegExpHelper.getExpectSection(), 
				"expect $1 {}");
		}
		catch (error) {
			ExtensionHelper.showError("Ошибка формирования кода модульного теста из интеграционного.", error.message);
			return;
		}

		vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			cancellable: false,
			title: `Запущен быстрый тест №${currTest.getNumber()}`
		}, async (progress) => {

			const modularTestContent = `${integrationalTestSimplifiedContent}\n\n${normalizedEvents}`;

			// Сохраняем модульный тест во временный файл.
			const randTmpPath = Configuration.get().getRandTmpSubDirectoryPath();
			await fs.promises.mkdir(randTmpPath);

			const fastTestFilePath = path.join(randTmpPath, "fast_test.sc");
			await FileSystemHelper.writeContentFile(fastTestFilePath, modularTestContent);

			// Создаем временный модульный тест для быстрого тестирования.
			const fastTest = new FastTest();
			fastTest.setRuleDirectoryPath(currTest.getRuleDirectoryPath());
			fastTest.setTestPath(fastTestFilePath);
			
			const testFileName = this._rule.getRuleFileName();
			fastTest.setRuleFileName(testFileName);
			fastTest.setRule(this._rule);

			const parser = new ModuleTestOutputParser();
			const testRunner = new UnitTestsRunner(this._config, parser);

			try {
				const resultTest = await testRunner.run(fastTest);

				switch (resultTest.getStatus()) {
					case TestStatus.Success: {
						ExtensionHelper.showUserInfo(`Быстрый тест ${resultTest.getNumber()} завершился успешно.`);
						break;
					}
					case TestStatus.Failed: {
						ExtensionHelper.showUserError(`Быстрый тест ${resultTest.getNumber()} завершился неуспешно.`);
						break;
					}
				}

				// Обновление теста.
				const tests = this._rule.getIntegrationTests();
				const ruleTestIndex = tests.findIndex( it => it.getNumber() == resultTest.getNumber());
				if(ruleTestIndex == -1) {
					ExtensionHelper.showUserError("Не удалось обновить интеграционный тест.");
					return;
				}

				// Переносим данные из быстрого теста в модульный.
				// При этом вывод теста содержит событие, подходящее под expect секцию, поэтому очищаем его как и код теста.
				const result = resultTest.getOutput();
				const clearedResult = TestHelper.cleanTestCode(result);

				// Вывод в тесте пока только храниться, а мы обновим его непосредственно.
				tests[ruleTestIndex].setOutput(clearedResult);
				this._config.getOutputChannel().clear();
				this._config.getOutputChannel().append(clearedResult);

				// Удаляем временные файлы.
				return fs.promises.rmdir(randTmpPath, {recursive : true});
			} 
			catch(error) {
				ExceptionHelper.show(error, 'Ошибка запуска быстрых тестов.');
			}
		});
	}

	private async runFullTests(message: any) : Promise<boolean> {

		return vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			cancellable: false,
			title: `Интеграционные тесты для правила '${this._rule.getName()}'`
		}, async (progress) => {

			await VsCodeApiHelper.saveRuleCodeFile(this._rule);

			const outputParse = new SiemJOutputParser();
			const testRunner = new IntegrationTestRunner(this._config, outputParse);

			let tests : IntegrationTest [] = [];
			try {
				// Сохраняем активные тесты.
				const rule = await TestHelper.saveAllTest(message, this._rule);
				tests = rule.getIntegrationTests();
			}
			catch(error) {
				ExceptionHelper.show(error, `Ошибка сохранения тестов.`);
				return false;
			}

			if(tests.length == 0) {
				ExtensionHelper.showUserInfo(`Тестов для правила '${this._rule.getName()}' не обнаружено`);
				return false;
			}

			// Проверяем конфигурацию.
			if(!fs.existsSync(this._config.getSiemSdkDirectoryPath())) {
				ExtensionHelper.showUserError(`Заданный в настройках расширения путь '${this._config.getSiemSdkDirectoryPath()}' недоступен. Запуск тестов, нормализация событий и т.д. будут невозможны.`);
				await VsCodeApiHelper.openSettings(this._config.getExtentionSettingsPrefix());
				return;
			}

			if(!fs.existsSync(this._config.getBuildToolsDirectoryPath())) {
				ExtensionHelper.showUserError(`Заданный в настройках расширения путь '${this._config.getBuildToolsDirectoryPath()}' недоступен. Запуск тестов, нормализация событий и т.д. будут невозможны.`);
				await VsCodeApiHelper.openSettings(this._config.getExtentionSettingsPrefix());
				return;
			}

			// const taxonomy = `C:\\Work\\-=SIEM=-\\PTSIEMSDK_GUI.4.0.0.738\\packages\\taxonomy\\develop\\25.0.579\\taxonomy.json`;
			if(!fs.existsSync(this._config.getTaxonomyFullPath())) {
				ExtensionHelper.showUserError(`Заданный в настройках путь '${this._config.getTaxonomyFullPath()}' к файлу таксономии недоступен. Запуск тестов, нормализация событий и т.д. будут невозможны.`);
				await VsCodeApiHelper.openSettings(this._config.getExtentionSettingsPrefix());
				return;
			}

			try {
				const executedTests = await testRunner.run(this._rule);

				if(executedTests.every(it => it.getStatus() === TestStatus.Success)) {
					ExtensionHelper.showUserInfo(`Интеграционные тесты завершились успешно.`);
					return true;
				} 
				ExtensionHelper.showUserError(`Интеграционные тесты завершились неуспешно.`);
			}
			catch(error) {
				ExceptionHelper.show(error, `Ошибка запуска тестов`);
				return false;
			}
		});
	}

	async saveTest(message: any) : Promise<IntegrationTest> {
		// Обновляем и сохраняем тест.
		const test = await TestHelper.saveTest(this._rule, message);
		ExtensionHelper.showUserInfo(`Сохранение теста №${test.getNumber()} успешно завершено.`);
		return test;
	}

	async saveAllTests(message: any) {

		// Номер активного теста.
		const activeTestNumberString = message?.activeTestNumber;
		if(!activeTestNumberString) {
			throw new XpExtentionException(`Не задан номер активного теста.`);
		}

		await TestHelper.saveAllTest(message, this._rule);
	}
}