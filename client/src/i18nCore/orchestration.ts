import * as fs from 'fs';
import { buildContext } from './parser';
import { generatePayloadFromContext, type LlmClientOptions } from './llm-client';
import { applyPayloadFs, planMergeChanges, type LangMode } from './merge';
import type { I18nLlmPayload } from './payload-schema';

export async function runGeneratePipeline(
  ruleDir: string,
  llm: LlmClientOptions,
  lang: LangMode,
  dryRun: boolean
): Promise<{ payload: I18nLlmPayload; applySummary: ReturnType<typeof applyPayloadFs> }> {
  const ctx = buildContext(ruleDir);
  const payload = await generatePayloadFromContext(ctx, llm);
  const applySummary = applyPayloadFs(ruleDir, payload, lang, dryRun, fs);
  return { payload, applySummary };
}

export function runPreviewPlan(ruleDir: string, payload: I18nLlmPayload, lang: LangMode) {
  return planMergeChanges(
    ruleDir,
    payload,
    lang,
    (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : undefined),
    (p) => fs.existsSync(p)
  );
}
