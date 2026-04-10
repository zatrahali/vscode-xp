/**
 * Extension-agnostic adapters for embedding this core in VS Code (vscode-xp) or other hosts.
 */

import type { I18nLlmPayload } from '../payload-schema';
import type { ParsedContext } from '../parser';
import type { LangMode } from '../merge';

/** Resolves the active rule directory and optional pre-parsed context. */
export interface RuleContextProvider {
  getRuleDirectory(): Promise<string | undefined>;
  /** If the host already has a parsed rule object, it can supply context to skip filesystem parse. */
  getParsedContext?(): Promise<ParsedContext | undefined>;
}

/** Abstract filesystem for preview/apply (VS Code workspace.fs or Node fs). */
export interface FileAccess {
  exists(path: string): Promise<boolean>;
  readText(path: string): Promise<string | undefined>;
  writeText(path: string, content: string): Promise<void>;
  mkdirp(path: string): Promise<void>;
}

export interface LlmGenerationService {
  generatePayload(ctx: ParsedContext): Promise<I18nLlmPayload>;
}

export interface PreviewApplyOptions {
  ruleDir: string;
  payload: I18nLlmPayload;
  lang: LangMode;
}
