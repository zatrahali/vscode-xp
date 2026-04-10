import * as vscode from 'vscode';

const CHANNEL_NAME = 'i18n AI Assistant';

let channel: vscode.OutputChannel | undefined;

export function getI18nAiOutputChannel(): vscode.OutputChannel {
  if (!channel) {
    channel = vscode.window.createOutputChannel(CHANNEL_NAME);
  }
  return channel;
}

export function showI18nAiOutputOnError(): void {
  const cfg = vscode.workspace.getConfiguration('xpConfig');
  const show = cfg.get<boolean>('i18nAi.showOutputOnError');
  if (show !== false) {
    getI18nAiOutputChannel().show(true);
  }
}

export function logI18nAi(level: 'error' | 'warn' | 'info' | 'debug', message: string): void {
  const ch = getI18nAiOutputChannel();
  const line = `[${level}] ${message}`;
  ch.appendLine(line);
  if (level === 'error') {
    showI18nAiOutputOnError();
  }
}
