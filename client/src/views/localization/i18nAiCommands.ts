import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import * as vscode from 'vscode';

import { adapters, validateRuleDirectory, type LangMode } from '../../i18nCore';

import type { Configuration } from '../../models/configuration';
import { Correlation } from '../../models/content/correlation';
import { Normalization } from '../../models/content/normalization';
import type { RuleBaseItem } from '../../models/content/ruleBaseItem';
import { getI18nAiOutputChannel, logI18nAi } from './i18nAiOutput';
import { applyI18nPayloadToRule } from './i18nPayloadMapper';
import { I18nAiService, ruleDirectorySupportsI18nCore } from './i18nAiService';
import { getOpenAiApiKeyForI18nAi, setOpenAiApiKeyForI18nAi } from './i18nAiSecrets';
import { LocalizationEditorViewProvider } from './localizationEditorViewProvider';

const CMD_GENERATE = 'i18nAi.generateLocalization';
const CMD_PREVIEW = 'i18nAi.previewLocalization';
const CMD_VALIDATE = 'i18nAi.validateLocalizationIds';
const CMD_SET_KEY = 'i18nAi.setApiKey';

function isAiTargetRuleType(rule: RuleBaseItem): boolean {
  return rule instanceof Correlation || rule instanceof Normalization;
}

function assertRuleForAi(rule: RuleBaseItem): void {
  if (!isAiTargetRuleType(rule)) {
    throw new Error(
      'AI localization is only available for correlation and normalization rules (rule.co / formula.xp).'
    );
  }
}

export function initI18nAiCommands(config: Configuration): void {
  const ctx = config.getContext();
  ctx.subscriptions.push(getI18nAiOutputChannel());
  const service = new I18nAiService(config);

  ctx.subscriptions.push(
    vscode.commands.registerCommand(CMD_SET_KEY, async () => {
      const key = await vscode.window.showInputBox({
        title: 'OpenAI-compatible API key',
        prompt: 'Stored in VS Code secret storage (xp.i18nAi.openaiApiKey)',
        password: true,
        ignoreFocusOut: true
      });
      await setOpenAiApiKeyForI18nAi(ctx.secrets, key);
      if (key?.trim()) {
        vscode.window.showInformationMessage('i18n AI API key saved.');
      } else {
        vscode.window.showInformationMessage('i18n AI API key cleared.');
      }
    })
  );

  ctx.subscriptions.push(
    vscode.commands.registerCommand(CMD_GENERATE, async (rule: RuleBaseItem) => {
      try {
        assertRuleForAi(rule);
        if (!ruleDirectorySupportsI18nCore(rule.getDirectoryPath())) {
          vscode.window.showErrorMessage(
            'AI localization requires rule.co or formula.xp in the rule folder.'
          );
          return;
        }
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: 'i18n AI: generating localization…',
            cancellable: true
          },
          async (_progress, token) => {
            const ac = new AbortController();
            const sub = token.onCancellationRequested(() => ac.abort());
            try {
              const payload = await service.generatePayloadForRule(rule, {
                signal: ac.signal,
                onReferenceResearchNote: (msg) => {
                  logI18nAi('info', msg);
                }
              });
              applyI18nPayloadToRule(rule, payload);
              await LocalizationEditorViewProvider.provider.showLocalizationEditor(rule);
              vscode.window.showInformationMessage(
                'i18n AI: localization generated. Review and click Save to write files.'
              );
            } finally {
              sub.dispose();
            }
          }
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logI18nAi('error', msg);
        vscode.window.showErrorMessage(`i18n AI: ${msg}`);
      }
    })
  );

  ctx.subscriptions.push(
    vscode.commands.registerCommand(CMD_PREVIEW, async (rule: RuleBaseItem) => {
      try {
        assertRuleForAi(rule);
        const ruleDir = rule.getDirectoryPath();
        if (!ruleDir || !ruleDirectorySupportsI18nCore(ruleDir)) {
          vscode.window.showErrorMessage(
            'Preview requires a rule folder with rule.co or formula.xp.'
          );
          return;
        }
        const apiKey = await getOpenAiApiKeyForI18nAi(ctx.secrets, true);
        if (!apiKey) {
          vscode.window.showErrorMessage('i18n AI: API key required.');
          return;
        }
        const payload = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: 'i18n AI: generating preview…',
            cancellable: true
          },
          async (_progress, token) => {
            const ac = new AbortController();
            const sub = token.onCancellationRequested(() => ac.abort());
            try {
              return await service.generatePayloadForRule(rule, {
                signal: ac.signal,
                onReferenceResearchNote: (msg) => logI18nAi('info', msg)
              });
            } finally {
              sub.dispose();
            }
          }
        );

        const lang = service.getLangMode() as LangMode;
        const files = adapters.createNodeFileAccess();
        const changes = await adapters.planMergeChangesAsync(
          ruleDir,
          payload,
          lang,
          files
        );

        const out = getI18nAiOutputChannel();
        out.clear();
        out.show(true);
        if (changes.length === 0) {
          out.appendLine('No YAML changes (merge result identical to current files).');
          return;
        }

        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xp-i18n-ai-'));
        let openedDiff = false;
        for (const ch of changes) {
          const base = path.basename(ch.path);
          const beforePath = path.join(tmp, `before-${base}`);
          const afterPath = path.join(tmp, `after-${base}`);
          fs.writeFileSync(beforePath, ch.before, 'utf8');
          fs.writeFileSync(afterPath, ch.after, 'utf8');
          out.appendLine(`--- ${ch.path} ---`);
          out.appendLine(`Before: ${beforePath}`);
          out.appendLine(`After:  ${afterPath}`);
          if (!openedDiff) {
            openedDiff = true;
            await vscode.commands.executeCommand(
              'vscode.diff',
              vscode.Uri.file(beforePath),
              vscode.Uri.file(afterPath),
              `i18n AI: ${base}`
            );
          }
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logI18nAi('error', msg);
        vscode.window.showErrorMessage(`i18n AI preview: ${msg}`);
      }
    })
  );

  ctx.subscriptions.push(
    vscode.commands.registerCommand(CMD_VALIDATE, async (rule: RuleBaseItem) => {
      try {
        const ruleDir = rule.getDirectoryPath();
        if (!ruleDir) {
          vscode.window.showErrorMessage('No rule directory.');
          return;
        }
        const { ok, report } = validateRuleDirectory(ruleDir);
        const doc = await vscode.workspace.openTextDocument({
          content: JSON.stringify(report, null, 2),
          language: 'json'
        });
        await vscode.window.showTextDocument(doc, { preview: true });
        if (ok) {
          vscode.window.showInformationMessage('LocalizationId alignment: OK');
        } else {
          vscode.window.showWarningMessage(
            'LocalizationId alignment: issues found (see JSON report)'
          );
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logI18nAi('error', msg);
        vscode.window.showErrorMessage(`i18n AI validate: ${msg}`);
      }
    })
  );
}

export const I18nAiCommandIds = {
  generateLocalization: CMD_GENERATE,
  previewLocalization: CMD_PREVIEW,
  validateLocalizationIds: CMD_VALIDATE,
  setApiKey: CMD_SET_KEY
} as const;
