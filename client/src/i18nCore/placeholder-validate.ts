/**
 * Validate {placeholder} tokens in LLM payload against an allowlist.
 */

import type { I18nLlmPayload } from './payload-schema';

const PLACEHOLDER_RE = /\{([^{}]+)\}/g;

function collectPlaceholdersInString(s: string): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  PLACEHOLDER_RE.lastIndex = 0;
  while ((m = PLACEHOLDER_RE.exec(s)) !== null) {
    const inner = m[1]!.trim();
    if (inner.length > 0) {
      out.push(inner);
    }
  }
  return out;
}

export function collectAllPayloadPlaceholders(payload: I18nLlmPayload): string[] {
  const found: string[] = [];
  found.push(...collectPlaceholdersInString(payload.description_ru));
  found.push(...collectPlaceholdersInString(payload.description_en));
  for (const row of payload.event_descriptions_ru) {
    found.push(...collectPlaceholdersInString(row.EventDescription));
  }
  for (const row of payload.event_descriptions_en) {
    found.push(...collectPlaceholdersInString(row.EventDescription));
  }
  return found;
}

export function validatePayloadPlaceholders(
  payload: I18nLlmPayload,
  allowed: ReadonlySet<string>
): void {
  const tokens = collectAllPayloadPlaceholders(payload);
  const invalid = [...new Set(tokens.filter((t) => !allowed.has(t)))];
  if (invalid.length === 0) {
    return;
  }
  const sample = [...allowed].slice(0, 40).join(', ');
  const more = allowed.size > 40 ? ` … (+${allowed.size - 40} more)` : '';
  throw new Error(
    `Invalid placeholders in generated localization (not in rule code / test_conds / norm*.js): ${invalid.join(', ')}. ` +
      `Allowed (${allowed.size}) e.g.: ${sample}${more}`
  );
}
