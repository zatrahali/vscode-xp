import * as vscode from 'vscode';

const SECRET_KEY = 'xp.i18nAi.openaiApiKey';

export async function getOpenAiApiKeyForI18nAi(
  secrets: vscode.SecretStorage,
  promptIfMissing: boolean
): Promise<string | undefined> {
  let key = await secrets.get(SECRET_KEY);
  if (key && key.trim()) {
    return key.trim();
  }
  if (!promptIfMissing) {
    return undefined;
  }
  key = await vscode.window.showInputBox({
    title: 'OpenAI-compatible API key',
    prompt: 'Enter API key for i18n AI (stored in VS Code secret storage)',
    password: true,
    ignoreFocusOut: true
  });
  if (!key?.trim()) {
    return undefined;
  }
  await secrets.store(SECRET_KEY, key.trim());
  return key.trim();
}

export async function setOpenAiApiKeyForI18nAi(
  secrets: vscode.SecretStorage,
  apiKey: string | undefined
): Promise<void> {
  if (!apiKey?.trim()) {
    await secrets.delete(SECRET_KEY);
    return;
  }
  await secrets.store(SECRET_KEY, apiKey.trim());
}
