/**
 * OpenAI-compatible chat completions client
 */

import { stripJsonFence, parseJsonObject } from './json-utils';
import type { ParsedContext } from './parser';
import { validatePayload, type I18nLlmPayload } from './payload-schema';
import { validatePayloadPlaceholders } from './placeholder-validate';
import { buildMessagesForContext } from './prompts';
import {
  DEFAULT_MAX_CHARS_PER_SOURCE,
  DEFAULT_MAX_SOURCES,
  DEFAULT_TIMEOUT_MS,
  fetchReferenceSources,
  hasUsableReferenceContent,
  summarizeReferencesWithLlm
} from './reference-research';
import {
  formatErrorChain,
  summarizeFetchFailure,
  summarizeHttpFailure
} from './network-errors';

export interface LlmClientOptions {
  apiKey: string;
  baseUrl?: string;
  model: string;
  temperature?: number;
  signal?: AbortSignal;
  /** Whether to fetch ExpertContext.References and summarize before main LLM. Default: auto */
  fetchReferences?: 'off' | 'auto' | 'required';
  referenceFetchTimeoutMs?: number;
  referenceMaxSources?: number;
  referenceMaxCharsPerSource?: number;
  /** Status updates for reference enrichment (disabled, skipped, failure, success). */
  onReferenceResearchNote?: (message: string) => void;
}

const DEFAULT_BASE = 'https://api.openai.com/v1';

async function maybeEnrichWithReferences(
  ctx: ParsedContext,
  opts: LlmClientOptions
): Promise<ParsedContext> {
  const mode = opts.fetchReferences ?? 'auto';
  if (mode === 'off') {
    opts.onReferenceResearchNote?.(
      `References: not used (fetchReferences=off). URLs in metainfo: ${ctx.expertReferences.length}.`
    );
    return ctx;
  }
  if (ctx.expertReferences.length === 0) {
    opts.onReferenceResearchNote?.(
      'References: none in metainfo (ExpertContext.References empty); skipping fetch.'
    );
    return ctx;
  }

  const timeoutMs = opts.referenceFetchTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxSources = opts.referenceMaxSources ?? DEFAULT_MAX_SOURCES;
  const maxCharsPerSource = opts.referenceMaxCharsPerSource ?? DEFAULT_MAX_CHARS_PER_SOURCE;

  const sources = await fetchReferenceSources(ctx.expertReferences, {
    timeoutMs,
    maxSources,
    maxCharsPerSource,
    signal: opts.signal
  });

  if (!hasUsableReferenceContent(sources)) {
    const msg =
      'ExpertContext.References: no usable content fetched from URLs (network/block/empty).';
    if (mode === 'required') {
      throw new Error(msg);
    }
    opts.onReferenceResearchNote?.(msg);
    return ctx;
  }

  try {
    const summary = await summarizeReferencesWithLlm(sources, opts);
    opts.onReferenceResearchNote?.(
      'References: summarized and attached to prompt (reference_research in context).'
    );
    return {
      ...ctx,
      referenceResearch: {
        urls: ctx.expertReferences.slice(0, maxSources),
        sources,
        summary
      }
    };
  } catch (e) {
    if (mode === 'required') {
      throw e;
    }
    opts.onReferenceResearchNote?.(
      `Reference summarization skipped: ${formatErrorChain(e)}`
    );
    return ctx;
  }
}

export async function generatePayloadFromContext(
  ctx: ParsedContext,
  opts: LlmClientOptions
): Promise<I18nLlmPayload> {
  const working = await maybeEnrichWithReferences(ctx, opts);

  const messages = buildMessagesForContext(working);
  const url = `${(opts.baseUrl ?? DEFAULT_BASE).replace(/\/$/, '')}/chat/completions`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${opts.apiKey}`
      },
      signal: opts.signal,
      body: JSON.stringify({
        model: opts.model,
        temperature: opts.temperature ?? 0.2,
        response_format: { type: 'json_object' },
        messages
      })
    });
  } catch (e) {
    throw new Error(summarizeFetchFailure('main-llm', url, e));
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(summarizeHttpFailure('main-llm', url, res.status, text.slice(0, 2000)));
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>;
  };
  const raw = data.choices?.[0]?.message?.content ?? '';
  const cleaned = stripJsonFence(raw);
  const obj = parseJsonObject(cleaned);
  const validated = validatePayload(obj);
  validatePayloadPlaceholders(validated, new Set(working.allowedPlaceholders));
  return validated;
}
