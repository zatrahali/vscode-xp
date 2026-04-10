/**
 * Fetch external URLs from ExpertContext.References, clean HTML, summarize via LLM.
 */

import { stripJsonFence, parseJsonObject } from './json-utils';
import {
  summarizeFetchFailure,
  summarizeHttpFailure
} from './network-errors';
import type {
  ReferenceResearchSummary,
  ReferenceSource
} from './reference-types';

export type { ReferenceSource, ReferenceResearchSummary } from './reference-types';
export type { ReferenceResearch } from './reference-types';

/** Subset of LlmClientOptions needed for summarization (avoids circular import with llm-client). */
export interface ReferenceSummaryCallOptions {
  apiKey: string;
  baseUrl?: string;
  model: string;
  temperature?: number;
  signal?: AbortSignal;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_SOURCES = 5;
const DEFAULT_MAX_CHARS_PER_SOURCE = 12_000;

const REFERENCE_SUMMARY_SYSTEM = `You are a cybersecurity analyst. You receive short text excerpts from external reference pages (blogs, vendor advisories, research).
Output a single JSON object (no markdown fences) with this exact schema:
{
  "threat_summary": "string",
  "tactics": ["string"],
  "keywords": ["string"]
}

Rules:
1. Base the content ONLY on the provided excerpts. If excerpts are empty or unhelpful, set threat_summary to a brief note that external context was unavailable, and use empty arrays for tactics and keywords.
2. threat_summary: 3–6 short sentences (max ~600 characters) describing attack technique, impact, and what the rule is about — in English.
3. tactics: MITRE-style short labels when inferable from text (e.g. "Credential Access"); otherwise empty array.
4. keywords: 5–15 relevant technical terms from the excerpts.
5. Do NOT output YAML, i18n strings, Criteria, or placeholder field names for SIEM.`;

function stripHtmlToText(html: string): string {
  let s = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, ' ');
  s = s.replace(/<[^>]+>/g, ' ');
  s = s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
  return s.replace(/\s+/g, ' ').trim();
}

function extractTitle(html: string): string | undefined {
  const m = /<title[^>]*>([^<]*)<\/title>/i.exec(html);
  if (m?.[1]) {
    return stripHtmlToText(m[1]).slice(0, 300) || undefined;
  }
  const h = /<h1[^>]*>([^<]*)<\/h1>/i.exec(html);
  if (h?.[1]) {
    return stripHtmlToText(h[1]).slice(0, 300) || undefined;
  }
  return undefined;
}

function mergeAbortSignals(a: AbortSignal, b: AbortSignal): AbortSignal {
  if (a.aborted || b.aborted) {
    const c = new AbortController();
    c.abort();
    return c.signal;
  }
  const c = new AbortController();
  const onAbort = (): void => {
    c.abort();
  };
  a.addEventListener('abort', onAbort, { once: true });
  b.addEventListener('abort', onAbort, { once: true });
  return c.signal;
}

async function fetchOneUrl(
  url: string,
  timeoutMs: number,
  maxChars: number,
  signal?: AbortSignal
): Promise<ReferenceSource> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  const merged = signal ? mergeAbortSignals(signal, ctrl.signal) : ctrl.signal;
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: merged,
      headers: {
        'User-Agent': 'i18n-kb-assistant/1.0 (reference research)',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      return {
        url,
        text_snippet: '',
        fetch_error: summarizeHttpFailure(
          'reference-fetch',
          url,
          res.status,
          errBody.slice(0, 800)
        )
      };
    }
    const ct = res.headers.get('content-type') ?? '';
    const raw = await res.text();
    if (!/html|xml|text\/plain/i.test(ct) && !/<[a-z][\s\S]*>/i.test(raw.slice(0, 500))) {
      return {
        url,
        text_snippet: raw.slice(0, maxChars).trim(),
        title: undefined
      };
    }
    const title = extractTitle(raw);
    const text = stripHtmlToText(raw).slice(0, maxChars);
    return { url, title, text_snippet: text };
  } catch (e) {
    return {
      url,
      text_snippet: '',
      fetch_error: summarizeFetchFailure('reference-fetch', url, e)
    };
  } finally {
    clearTimeout(t);
  }
}

export async function fetchReferenceSources(
  urls: string[],
  opts: {
    timeoutMs: number;
    maxSources: number;
    maxCharsPerSource: number;
    signal?: AbortSignal;
  }
): Promise<ReferenceSource[]> {
  const limited = [...new Set(urls)].slice(0, opts.maxSources);
  const out: ReferenceSource[] = [];
  for (const url of limited) {
    out.push(await fetchOneUrl(url, opts.timeoutMs, opts.maxCharsPerSource, opts.signal));
  }
  return out;
}

function parseSummaryJson(raw: string): ReferenceResearchSummary {
  const obj = parseJsonObject(stripJsonFence(raw)) as Record<string, unknown>;
  const threat =
    typeof obj.threat_summary === 'string' ? obj.threat_summary : '';
  const tactics = Array.isArray(obj.tactics)
    ? obj.tactics.filter((x): x is string => typeof x === 'string')
    : [];
  const keywords = Array.isArray(obj.keywords)
    ? obj.keywords.filter((x): x is string => typeof x === 'string')
    : [];
  return { threat_summary: threat, tactics, keywords };
}

export async function summarizeReferencesWithLlm(
  sources: ReferenceSource[],
  opts: ReferenceSummaryCallOptions
): Promise<ReferenceResearchSummary> {
  const payload = {
    sources: sources.map((s) => ({
      url: s.url,
      title: s.title ?? null,
      text_snippet: s.fetch_error ? `[fetch failed: ${s.fetch_error}]` : s.text_snippet,
      fetch_error: s.fetch_error ?? null
    }))
  };
  const userContent = `Summarize the following reference material for SIEM rule authoring context:\n\n${JSON.stringify(payload, null, 2)}`;
  const base = (opts.baseUrl ?? 'https://api.openai.com/v1').replace(/\/$/, '');
  const url = `${base}/chat/completions`;
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
        messages: [
          { role: 'system', content: REFERENCE_SUMMARY_SYSTEM },
          { role: 'user', content: userContent }
        ]
      })
    });
  } catch (e) {
    throw new Error(summarizeFetchFailure('reference-summary', url, e));
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      summarizeHttpFailure('reference-summary', url, res.status, text.slice(0, 1500))
    );
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>;
  };
  const raw = data.choices?.[0]?.message?.content ?? '';
  return parseSummaryJson(raw);
}

export function hasUsableReferenceContent(sources: ReferenceSource[]): boolean {
  return sources.some((s) => s.text_snippet.length > 50 && !s.fetch_error);
}

export { DEFAULT_TIMEOUT_MS, DEFAULT_MAX_SOURCES, DEFAULT_MAX_CHARS_PER_SOURCE };
