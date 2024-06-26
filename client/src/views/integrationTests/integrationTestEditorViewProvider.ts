import * as fs from 'fs';
import * as vscode from 'vscode';
import * as path from 'path';

import { DialogHelper } from '../../helpers/dialogHelper';
import { MustacheFormatter } from '../mustacheFormatter';
import { EventMimeType, TestHelper } from '../../helpers/testHelper';
import { IntegrationTest } from '../../models/tests/integrationTest';
import { Correlation } from '../../models/content/correlation';
import { Enrichment } from '../../models/content/enrichment';
import { RuleBaseItem } from '../../models/content/ruleBaseItem';
import { Configuration } from '../../models/configuration';
import { FileSystemHelper } from '../../helpers/fileSystemHelper';
import { TestStatus } from '../../models/tests/testStatus';
import { ExceptionHelper } from '../../helpers/exceptionHelper';
import { XpException } from '../../models/xpException';
import { Enveloper } from '../../models/enveloper';
import { ExtensionState } from '../../models/applicationState';
import { Log } from '../../extension';
import { ShowTestResultsDiffCommand } from './showTestResultsDiffCommand';
import { RunIntegrationTestsCommand } from './runIntegrationTestsCommand';
import { NormalizeRawEventsCommand } from './normalizeRawEventsCommand';
import { GetExpectedEventCommand } from './getExpectEventCommand';
import { StringHelper } from '../../helpers/stringHelper';
import { SaveAllCommand } from './saveAllCommand';
import { Aggregation } from '../../models/content/aggregation';
import { ShowActualEventCommand } from './showActualEventCommand';

export class IntegrationTestEditorViewProvider {

	public static readonly viewId = 'IntegrationTestEditorView';
	public static readonly onTestSelectionChangeCommand = "IntegrationTestEditorView.onTestSelectionChange";

	private _view?: vscode.WebviewPanel;
	private rule: RuleBaseItem;

	public constructor(
		private readonly config: Configuration,
		private readonly _templatePath: string) {
	}

	public static init(config: Configuration) : void {

		// Форма создания визуализации интеграционных тестов.
		const templatePath = path.join(
			config.getExtensionPath(),
			path.join("client", "templates", "IntegrationTestEditor.html")
		);

		const provider = new IntegrationTestEditorViewProvider(config, templatePath);

		// Открытие формы тестов.
		config.getContext().subscriptions.push(
			vscode.commands.registerCommand(
				IntegrationTestEditorViewProvider.showEditorCommand,
				async (rule: Correlation | Enrichment) => {
					// Обновляем интеграционные тесты для того, чтобы можно было увидеть актуальные тесты при их модификации на ЖД.
					if (!rule) {
						DialogHelper.showError("Правило еще не успело загрузится. Повторите еще раз");
						return;
					}

					// TODO: обновление интеграционных тестов с диска сбрасывает их статус. Можно использовать watcher для этого.
					rule.reloadIntegrationTests();
					return provider.showEditor(rule);
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
	public async showEditor(rule: Correlation|Enrichment|Aggregation) : Promise<void> {

		Log.debug(`Редактор интеграционных тестов открыт для правила ${rule.getName()}`);

		if (this._view) {
			Log.debug(`Открытый ранее редактор интеграционных тестов для правила ${this.rule.getName()} был автоматически закрыт`);

			this.rule = null;
			this._view.dispose();
		}

		if (!(rule instanceof Correlation || rule instanceof Enrichment || rule instanceof Aggregation)) {
			DialogHelper.showWarning(`Редактор интеграционных тестов не поддерживает правил кроме корреляций, обогащений и агрегаций`);
			return;
		}

		this.rule = rule;

		// Создать и показать панель.
		const viewTitle = this.config.getMessage("View.IntegrationTests.Title", this.rule.getName());
		this._view = vscode.window.createWebviewPanel(
			IntegrationTestEditorViewProvider.viewId,
			viewTitle,
			vscode.ViewColumn.One,
			{
				retainContextWhenHidden: true,
				enableFindWidget: true,
				enableScripts: true,
				localResourceRoots: [vscode.Uri.joinPath(this.config.getExtensionUri(), "client", "out")]
			});

		// Создаем временную директорию для результатов тестов, которая посмотреть почему не прошли тесты.
		this.testsTmpFilesPath = this.config.getRandTmpSubDirectoryPath();

		this._view.onDidDispose(async (e: void) => {
			this._view = undefined;
			await FileSystemHelper.recursivelyDeleteDirectory(this.testsTmpFilesPath);
		},
			this);

		this._view.webview.options = {
			enableScripts: true
		};

		this._view.webview.onDidReceiveMessage(
			this.receiveMessageFromWebView,
			this
		);

		await this.updateView();
	}

	/**
	 * Удаляет директорию в с временными файлами интеграционных тестов, который нужны для выявления ошибок в тестах.
	 */
	private async updateView(focusTestNumber?: number): Promise<void> {

		// Пользователь уже закрыл вьюшку.
		if (!this._view) {
			return;
		}

		const resultFocusTestNumber = focusTestNumber ?? 1;
		Log.debug(`WebView ${IntegrationTestEditorViewProvider.name} была загружена/обновлена. Текущий тест №${resultFocusTestNumber ?? "1"}`);

		const resourcesUri = this.config.getExtensionUri();
		const extensionBaseUri = this._view.webview.asWebviewUri(resourcesUri);

		const webviewUri = FileSystemHelper.getUri(this._view.webview, this.config.getExtensionUri(), ["client", "out", "ui.js"]);

		const plain = {
			"IntegrationTests": [],
			"ExtensionBaseUri": extensionBaseUri,
			"RuleName": this.rule.getName(),
			"ActiveTestNumber": resultFocusTestNumber,

			// Локализация вьюшки
			"Locale" : {
				"Test" : this.config.getMessage('View.IntegrationTests.Test'),
				"SaveAll" : this.config.getMessage('View.IntegrationTests.SaveAll'),
				"RunAllTests" : this.config.getMessage('View.IntegrationTests.RunAllTests'),
				"RawEvents" : this.config.getMessage('View.IntegrationTests.RawEvents'),
				"WordWrap" : this.config.getMessage('View.IntegrationTests.WordWrap'),
				"WrapRawEvents" : this.config.getMessage('View.IntegrationTests.WrapRawEventsInAnEnvelope'),
				"Normalize" : this.config.getMessage('View.IntegrationTests.Normalize'),
				"NormalizeAndEnrich" : this.config.getMessage('View.IntegrationTests.NormalizeAndEnrich'),
				"NormalizedEvents" : this.config.getMessage('View.IntegrationTests.NormalizedEvents'),
				"TestCondition" : this.config.getMessage('View.IntegrationTests.ConditionForPassingTheTest'),
				"ShowActualEvent" : this.config.getMessage('View.IntegrationTests.ShowActualEvent'),
				"GetExpectedEvent" : this.config.getMessage('View.IntegrationTests.GetExpectedEvent'),
				"CompareResults" : this.config.getMessage('View.IntegrationTests.CompareYourResults'),
				"ClearExpectedEvent" : this.config.getMessage('View.IntegrationTests.ClearExpectedEvent'),
			}
		};

		try {
			const integrationTest = this.rule.getIntegrationTests();

			// Если тестов нет, то создаем пустую форму для первого теста
			if (integrationTest.length === 0) {
				plain["IntegrationTests"].push({
					"TestNumber": 1,
					"RawEvents": '',
					"NormEvents": '',
					"TestCode": `expect 1 {"correlation_name" : "${this.rule.getName()}"}`,
					"TestOutput": '',
					"JsonedTestObject": '',
					"TestStatus": ''
				});
			}
			else {
				for(const it of integrationTest) {
					const jsonedTestObject = JSON.stringify(it);

					const rawEvents = it.getRawEvents();
					const formattedTestCode = TestHelper.formatTestCodeAndEvents(it.getTestCode());
					const formattedNormalizedEvents = TestHelper.formatTestCodeAndEvents(it.getNormalizedEvents());

					plain["IntegrationTests"].push({
						"TestNumber": it.getNumber(),
						"RawEvents": rawEvents,
						"NormEvents": formattedNormalizedEvents,
						"TestCode": formattedTestCode,
						"TestOutput": it.getOutput(),
						"JsonedTestObject": jsonedTestObject,
						"TestStatus": this.testStatusToUiStyle(it),
						"IsFailed" : it.getStatus() === TestStatus.Failed,
						"CanGetExpectedEvent": this.canGetExpectedEvent(it)
					});
				}
			}

			const template = await FileSystemHelper.readContentFile(this._templatePath);
			const formatter = new MustacheFormatter(template);
			const htmlContent = formatter.format(plain);
			this._view.webview.html = htmlContent;
		}
		catch (error) {
			DialogHelper.showError("Не удалось открыть интеграционные тесты", error);
		}
	}

	/**
	 * Функция возвращает значение, показывающее возможность получить ожидаемое событие
	 * @param it интеграционный тест
	 * @returns возможно ли для данного теста получить ожидаемое событие
	 */
	private canGetExpectedEvent(it: IntegrationTest): boolean {
		if(TestHelper.isNegativeTest(it.getTestCode())) {
			return false;
		}

		if(it.getStatus() === TestStatus.Success || it.getStatus() === TestStatus.Failed) {
			return true;
		}

		if(it.getNormalizedEvents()) {
			return true;
		} 
	}

	private testStatusToUiStyle(it: IntegrationTest) : string {
		const testStatus = it.getStatus();
		switch (testStatus) {
			case TestStatus.Unknown: {
				return "";
			}
			case TestStatus.Success: {
				return "success";
			}
			case TestStatus.Failed: {
				return "failure";
			}
		}
	}

	private async receiveMessageFromWebView(message: any) {

		if (ExtensionState.get().isExecutedState()) {
			DialogHelper.showWarning(
				Configuration.get().getMessage("WaitForCommandToFinishExecuting")
			);
			return true;
		}

		try {
			ExtensionState.get().startExecutionState();
			await this.executeCommand(message);
		}
		catch (error) {
			ExceptionHelper.show(error, `Ошибка выполнения команды '${message.command}'`);
			return true;
		}
		finally {
			ExtensionState.get().stopExecutionState();
		}
	}

	private async executeCommand(message: any) {
		// События, не требующие запуска утилит.
		switch (message.command) {
			// TODO: не используется, надо удалить
			case 'saveTest': {
				const currTest = IntegrationTest.convertFromObject(message.test);
				try {
					await this.saveTest(message);
				}
				catch (error) {
					ExceptionHelper.show(error, `Не удалось сохранить тест №${currTest}.`);
					return;
				}

				const activeTestNumber = this.getSelectedTestNumber(message);
				this.updateView(activeTestNumber);
				return;
			}

			case 'saveAllTests': {
				if (!message?.activeTestNumber) {
					DialogHelper.showError('Внутренняя ошибка. Номер теста не передан в запросе на backend');
					return;
				}

				const activeTestNumber = parseInt(message?.activeTestNumber);
				if (!activeTestNumber) {
					throw new XpException(`Переданное значение ${message?.activeTestNumber} не является номером интеграционного теста`);
				}

				const command = new SaveAllCommand( {
						config : this.config,
						rule: this.rule,
						tmpDirPath: this.testsTmpFilesPath,
						testNumber: activeTestNumber,
						tests: message.tests}
				);
				
				const result = await command.execute();
				// Если сохранение прошло успешно, тогда обновляем окно.
				if(result) {
					this.updateView(activeTestNumber);
				}
				
				break;
			}

			case 'addEnvelope': {
				let rawEvents = message?.rawEvents as string;
				rawEvents = StringHelper.replaceIrregularSymbols(rawEvents);
				const mimeType = message?.mimeType as EventMimeType;

				return vscode.window.withProgress({
					location: vscode.ProgressLocation.Notification,
					cancellable: false,
					title: this.config.getMessage('View.IntegrationTests.Progress.AddingEnvelope')
				}, async (progress) => {
					try {
						return this.addEnvelope(rawEvents, mimeType);
					}
					catch (error) {
						ExceptionHelper.show(error, this.config.getMessage("View.IntegrationTests.Message.DefaultErrorAddingEnvelope"));
					}
				});
			}

			case 'lastTest': {
				this.lastTest();
				return;
			}

			// case 'cleanTestCode': {
			// 	return this.cleanTestCode(message);
			// }


			// Команды с запуском утилит.
			case "NormalizeRawEventsCommand": {
				try {
					if (typeof message?.isEnrichmentRequired !== "boolean" ) {
						DialogHelper.showInfo("Не задан параметр обогащения событий");
						return true;
					}
					const isEnrichmentRequired = message?.isEnrichmentRequired as boolean;
	
					// Актуализируем сырые события в тесте из вьюшки.
					const currTest = await this.saveTestFromUI(message);
					const command = new NormalizeRawEventsCommand({
						config: this.config,
						isEnrichmentRequired: isEnrichmentRequired,
						rule: this.rule,
						test: currTest
					});
	
					await command.execute();
					this.updateView(currTest.getNumber());
					return true;
				}
				catch(error) {
					ExceptionHelper.show(error, 'Ошибка нормализации событий');
				}
				break;
			}

			case "ShowTestResultsDiffCommand": {
				if (!message?.selectedTestNumber) {
					DialogHelper.showError('Номер теста не передан в запросе на back-end');
					return;
				}

				try {
					const selectedTestNumber = parseInt(message?.selectedTestNumber);
					if (!selectedTestNumber) {
						throw new XpException(`Переданное значение ${message?.activeTestNumber} не является номером интеграционного теста`);
					}

					const currTest = await this.saveTestFromUI(message);

					const command = new ShowTestResultsDiffCommand( {
							config : this.config,
							rule: this.rule,
							test: currTest,
							tmpDirPath: this.testsTmpFilesPath,
							testNumber: selectedTestNumber
						}
					);
					await command.execute();
				}
				catch (error) {
					ExceptionHelper.show(error, "Ошибка сравнения фактического и ожидаемого события");
				}
				break;
			}

			case "GetExpectedEventCommand": {
				if (!message?.selectedTestNumber) {
					DialogHelper.showError('Внутренняя ошибка. Номер теста не передан в запросе на backend');
					return;
				}

				try {
					const selectedTestNumber = parseInt(message?.selectedTestNumber);
					if (!selectedTestNumber) {
						throw new XpException(`Переданное значение ${message?.activeTestNumber} не является номером интеграционного теста`);
					}

					const currTest = await this.saveTestFromUI(message);
					const command = new GetExpectedEventCommand({
						config: this.config,
						rule: this.rule,
						test: currTest,
						testNumber: selectedTestNumber,
						tmpDirPath: this.testsTmpFilesPath
					});

					await command.execute(this);
					return true;
				}
				catch(error) {
					ExceptionHelper.show(error, 'Ошибка обновления ожидаемого события');
				}
				break;
			}

			case "ShowActualEventCommand": {
				if (!message?.selectedTestNumber) {
					DialogHelper.showError('Внутренняя ошибка. Номер теста не передан в запросе на backend');
					return;
				}

				try {
					const selectedTestNumber = parseInt(message?.selectedTestNumber);
					if (!selectedTestNumber) {
						throw new XpException(`Переданное значение ${message?.activeTestNumber} не является номером интеграционного теста`);
					}

					
					const currTest = await this.saveTestFromUI(message);
					const command = new ShowActualEventCommand({
						config: this.config,
						rule: this.rule,
						test: currTest,
						testNumber: selectedTestNumber,
						tmpDirPath: this.testsTmpFilesPath
					});

					await command.execute();
					return true;
				}
				catch(error) {
					ExceptionHelper.show(error, 'Ошибка обновления ожидаемого события');
				}
				break;
			}			

			case "RunIntegrationTestsCommand": {
				// Сохраняем актуальное состояние тестов из вьюшки.
				let rule: RuleBaseItem;
				try {
					rule = await this.saveAllTests(message);
					Log.info(`Все тесты правила ${this.rule.getName()} сохранены`);
				}
				catch (error) {
					ExceptionHelper.show(error, `Не удалось сохранить тесты`);
					return true;
				}

				try {
					await FileSystemHelper.recursivelyDeleteDirectory(this.testsTmpFilesPath);

					const command = new RunIntegrationTestsCommand({
						config: this.config,
						rule: rule,
						tmpDirPath: this.testsTmpFilesPath
					});

					const shouldUpdateViewAfterTestsRunned = await command.execute();
					// Обновляем только в том случае, если есть что нового показать пользователю.
					if (shouldUpdateViewAfterTestsRunned) {
						await this.updateView(this.getSelectedTestNumber(message));
					}
				}
				catch(error) {
					ExceptionHelper.show(error, `Не удалось выполнить тесты`);
				}

				return true;
			}
			default: {
				DialogHelper.showError(`Команда ${message?.command} не найдена`);
			}
		}
	}

	private async saveAllTests(message: any) : Promise<RuleBaseItem> {
		if (!message?.activeTestNumber) {
			DialogHelper.showError('Внутренняя ошибка. Номер теста не передан в запросе на backend');
			return;
		}

		const activeTestNumber = parseInt(message?.activeTestNumber);
		if (!activeTestNumber) {
			throw new XpException(`Переданное значение ${message?.activeTestNumber} не является номером интеграционного теста`);
		}

		const command = new SaveAllCommand( {
				config : this.config,
				rule: this.rule,
				tmpDirPath: this.testsTmpFilesPath,
				testNumber: activeTestNumber,
				tests: message.tests}
		);
		
		const result = await command.execute();
		// Если сохранение прошло успешно, тогда обновляем окно.
		if(result) {
			this.updateView(activeTestNumber);
		}
		return this.rule;
	}

	private lastTest() {
		DialogHelper.showWarning(this.config.getMessage("View.IntegrationTests.Message.LastTestCannotBeDeleted"));
	}

	private async saveTestFromUI(message: any) : Promise<IntegrationTest> {
		let rawEvents = message?.rawEvents;
		if (!rawEvents) {
			throw new XpException(this.config.getMessage("View.IntegrationTests.Message.RawEventsAreNotDefined"));
		}

		const test = message?.test;
		if (!test) {
			throw new XpException(this.config.getMessage("View.IntegrationTests.Message.SaveTheTestBefore"));
		}

		const currTest = IntegrationTest.convertFromObject(test);
		rawEvents = TestHelper.compressJsonRawEvents(rawEvents);
		currTest.setRawEvents(rawEvents);
		await currTest.save();
		return currTest;
	}

	private getSelectedTestNumber(message: any): number {
		const activeTestNumberString = message?.activeTestNumber;
		if (!activeTestNumberString) {
			DialogHelper.showError(`The number of the active test is not set`);
			return;
		}

		const activeTestNumber = parseInt(activeTestNumberString);
		return activeTestNumber;
	}

	public async addEnvelope(rawEvents: string, mimeType: EventMimeType): Promise<void> {
		let envelopedRawEventsString: string;
		try {
			const envelopedEvents = Enveloper.addEnvelope(rawEvents, mimeType);
			envelopedRawEventsString = envelopedEvents.join(IntegrationTestEditorViewProvider.TEXTAREA_END_OF_LINE);
		}
		catch (error) {
			ExceptionHelper.show(error, this.config.getMessage("View.IntegrationTests.Message.DefaultErrorAddingEnvelope"));
			return;
		}

		await this.updateCurrentTestRawEvent(envelopedRawEventsString);
	}

	async saveTest(message: any): Promise<IntegrationTest> {
		// Обновляем и сохраняем тест.
		const test = await TestHelper.saveIntegrationTest(this.rule, message);
		DialogHelper.showInfo(`Тест №${test.getNumber()} сохранен`);
		return test;
	}

	public async updateTestCode(newTestCode: string, testNumber?: number): Promise<boolean> {
		return this._view.webview.postMessage({
			'command': 'updateTestCode',
			'newTestCode': newTestCode,
			'testNumber': testNumber
		});
	}

	public async updateCurrentTestRawEvent(rawEvents: string): Promise<boolean> {
		return this._view.webview.postMessage({
			'command': 'updateRawEvents',
			'rawEvents': rawEvents
		});
	}

	private testsTmpFilesPath: string;

	public static TEXTAREA_END_OF_LINE = "\n";
}
