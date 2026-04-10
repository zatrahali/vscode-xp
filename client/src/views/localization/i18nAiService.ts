import * as fs from 'fs';
import * as path from 'path';

import { buildContext, generatePayloadFromContext, type LlmClientOptions } from '../../i18nCore';
import type { I18nLlmPayload } from '../../i18nCore/payload-schema';

import type { Configuration } from '../../models/configuration';
import type { RuleBaseItem } from '../../models/content/ruleBaseItem';

import { getOpenAiApiKeyForI18nAi } from './i18nAiSecrets';

export type I18nAiLangMode = 'ru' | 'en' | 'both';

export type FetchReferencesMode = 'off' | 'auto' | 'required';

function readI18nAiSettings(config: Configuration): {
  baseUrl: string;
  model: string;
  temperature: number;
  lang: I18nAiLangMode;
  fetchReferences: FetchReferencesMode;
  referenceFetchTimeoutMs: number;
  referenceMaxSources: number;
  referenceMaxCharsPerSource: number;
} {
  const ws = config.getWorkspaceConfiguration();
  const baseUrl =
    ws.get<string>('i18nAi.openaiBaseUrl') ?? 'https://api.openai.com/v1';
  const model = ws.get<string>('i18nAi.model') ?? 'gpt-4o';
  const temperature = ws.get<number>('i18nAi.temperature') ?? 0.2;
  const lang = (ws.get<string>('i18nAi.lang') as I18nAiLangMode) ?? 'both';
  const fetchReferences =
    (ws.get<string>('i18nAi.fetchReferences') as FetchReferencesMode) ?? 'auto';
  const referenceFetchTimeoutMs =
    ws.get<number>('i18nAi.referenceFetchTimeoutMs') ?? 10000;
  const referenceMaxSources = ws.get<number>('i18nAi.referenceMaxSources') ?? 5;
  const referenceMaxCharsPerSource =
    ws.get<number>('i18nAi.referenceMaxCharsPerSource') ?? 12000;

  return {
    baseUrl,
    model,
    temperature,
    lang,
    fetchReferences,
    referenceFetchTimeoutMs,
    referenceMaxSources,
    referenceMaxCharsPerSource
  };
}

/** Core parser only supports directories with rule.co or formula.xp. */
export function ruleDirectorySupportsI18nCore(ruleDir: string): boolean {
  const co = path.join(ruleDir, 'rule.co');
  const xp = path.join(ruleDir, 'formula.xp');
  return fs.existsSync(co) || fs.existsSync(xp);
}

export class I18nAiService {
  constructor(private readonly config: Configuration) {}

  getLangMode(): I18nAiLangMode {
    return readI18nAiSettings(this.config).lang;
  }

  async generatePayloadForRule(
    rule: RuleBaseItem,
    options: {
      signal?: AbortSignal;
      onReferenceResearchNote?: (message: string) => void;
    } = {}
  ): Promise<I18nLlmPayload> {
    const ruleDir = rule.getDirectoryPath();
    if (!ruleDir) {
      throw new Error('Rule directory is not set');
    }
    if (!ruleDirectorySupportsI18nCore(ruleDir)) {
      throw new Error(
        'AI localization requires a correlation rule (rule.co) or normalization rule (formula.xp) in the rule folder.'
      );
    }

    const apiKey = await getOpenAiApiKeyForI18nAi(
      this.config.getContext().secrets,
      true
    );
    if (!apiKey) {
      throw new Error('API key is required for i18n AI');
    }

    const s = readI18nAiSettings(this.config);
    const llm: LlmClientOptions = {
      apiKey,
      baseUrl: s.baseUrl,
      model: s.model,
      temperature: s.temperature,
      signal: options.signal,
      fetchReferences: s.fetchReferences,
      referenceFetchTimeoutMs: s.referenceFetchTimeoutMs,
      referenceMaxSources: s.referenceMaxSources,
      referenceMaxCharsPerSource: s.referenceMaxCharsPerSource,
      onReferenceResearchNote: options.onReferenceResearchNote
    };

    const ctx = buildContext(ruleDir);
    return generatePayloadFromContext(ctx, llm);
  }
}
