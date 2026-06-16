import * as vscode from 'vscode';
import { Log } from '../extension';

/**
 * Рекомендация установки официального расширения EditorConfig (EditorConfig.EditorConfig),
 * чтобы файлы XP-контента корректно форматировались в соответствии с `.editorconfig`
 * (indent_style/size, end_of_line, charset, trim_trailing_whitespace, insert_final_newline).
 *
 * Само расширение XP не реализует логику EditorConfig, а лишь предлагает пользователю
 * поставить проверенное расширение, когда он открывает файл XP-контента.
 */
export class EditorConfigRecommendation {
  /** Идентификатор официального расширения EditorConfig в Marketplace. */
  private static readonly ExtensionId = 'EditorConfig.EditorConfig';

  /** Ключ в globalState, по которому запоминается, что пользователь отказался от рекомендации. */
  private static readonly DismissedStateKey = 'xp.editorConfigRecommendation.dismissed';

  /** Идентификаторы языков XP-контента, для которых актуальна поддержка `.editorconfig`. */
  private static readonly XpLanguageIds = ['xp', 'en', 'co', 'test', 'agr', 'flt'];

  /** Расширения файлов XP-контента, которые регистрируются как yaml (.tl/.wld) или иное. */
  private static readonly XpFileExtensions = ['.xp', '.en', '.co', '.sc', '.tc', '.agr', '.flt', '.tl', '.wld'];

  public static init(context: vscode.ExtensionContext): void {
    // Если расширение уже установлено или пользователь отказался — ничего не делаем.
    if (this.isEditorConfigInstalled() || this.isDismissed(context)) {
      return;
    }

    // Проверяем уже открытые документы на момент активации.
    for (const document of vscode.workspace.textDocuments) {
      if (this.isXpDocument(document)) {
        void this.recommend(context);
        return;
      }
    }

    // Подписываемся на открытие новых документов.
    const subscription = vscode.workspace.onDidOpenTextDocument((document) => {
      if (this.isEditorConfigInstalled() || this.isDismissed(context)) {
        subscription.dispose();
        return;
      }

      if (this.isXpDocument(document)) {
        subscription.dispose();
        void this.recommend(context);
      }
    });

    context.subscriptions.push(subscription);
  }

  private static isEditorConfigInstalled(): boolean {
    return vscode.extensions.getExtension(this.ExtensionId) !== undefined;
  }

  private static isDismissed(context: vscode.ExtensionContext): boolean {
    return context.globalState.get<boolean>(this.DismissedStateKey, false);
  }

  private static isXpDocument(document: vscode.TextDocument): boolean {
    if (document.uri.scheme !== 'file') {
      return false;
    }

    if (this.XpLanguageIds.includes(document.languageId)) {
      return true;
    }

    // .tl/.wld регистрируются как yaml, поэтому дополнительно проверяем расширение файла.
    const lowerCasePath = document.uri.fsPath.toLowerCase();
    return this.XpFileExtensions.some((extension) => lowerCasePath.endsWith(extension));
  }

  private static async recommend(context: vscode.ExtensionContext): Promise<void> {
    const installAction = 'Установить';
    const dontShowAgainAction = 'Больше не показывать';

    const selectedAction = await vscode.window.showInformationMessage(
      'Для корректного применения настроек `.editorconfig` (отступы, переносы строк, кодировка) ' +
        'к файлам XP-контента рекомендуется установить расширение EditorConfig.',
      installAction,
      dontShowAgainAction
    );

    if (selectedAction === installAction) {
      try {
        await vscode.commands.executeCommand(
          'workbench.extensions.installExtension',
          this.ExtensionId
        );
        Log.info(`The '${this.ExtensionId}' extension installation was requested`);
      } catch (error) {
        Log.warn(`Failed to install the '${this.ExtensionId}' extension`, error);
        // В качестве запасного варианта открываем страницу расширения в Marketplace.
        await vscode.commands.executeCommand(
          'workbench.extensions.search',
          `@id:${this.ExtensionId}`
        );
      }
    } else if (selectedAction === dontShowAgainAction) {
      await context.globalState.update(this.DismissedStateKey, true);
    }
  }
}
