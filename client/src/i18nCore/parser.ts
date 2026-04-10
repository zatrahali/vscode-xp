/**
 * Parse rule directories: metainfo, rule.co, formula.xp, raw test events.
 * Port of i18n_ai_assistant/parser.py
 */

import * as fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import type { ReferenceResearch } from './reference-types';
import { buildAllowedPlaceholders } from './placeholder-allowlist';

export type RuleType = 'correlation' | 'normalization';

export interface ParsedContext {
  ruleDir: string;
  ruleType: RuleType;
  correlationName: string | null;
  formulaId: string | null;
  ruleCodePath: string | null;
  ruleCodeText: string;
  metainfoPath: string | null;
  metainfoFull: Record<string, unknown>;
  existingEventDescriptions: Array<Record<string, unknown>>;
  rawEvents: Array<Record<string, unknown>>;
  /** URLs from metainfo ExpertContext.References (http/https only, deduped) */
  expertReferences: string[];
  /** Set after optional fetch + summarization LLM in generatePayloadFromContext */
  referenceResearch?: ReferenceResearch;
  hints: {
    switch_blocks: Array<{ variable: string; cases: Array<[string, string]> }>;
    has_status_success_failure: boolean;
    dollar_fields_sample: string[];
  };
  /** Field paths allowed inside `{...}` in descriptions (rule $fields + test_conds*.tc + norm*.js). */
  allowedPlaceholders: string[];
}

/**
 * Read ExpertContext.References from parsed metainfo (list of URL strings).
 */
export function extractExpertReferences(full: Record<string, unknown>): string[] {
  const ec = full['ExpertContext'];
  if (!ec || typeof ec !== 'object' || Array.isArray(ec)) {
    return [];
  }
  const refs = (ec as Record<string, unknown>)['References'];
  if (!Array.isArray(refs)) {
    return [];
  }
  const out: string[] = [];
  for (const item of refs) {
    if (typeof item !== 'string' || !item.trim()) {
      continue;
    }
    try {
      const u = new URL(item.trim());
      if (u.protocol === 'http:' || u.protocol === 'https:') {
        out.push(u.href);
      }
    } catch {
      continue;
    }
  }
  return [...new Set(out)];
}

export function detectRuleType(ruleDir: string): RuleType {
  if (fs.existsSync(path.join(ruleDir, 'rule.co'))) {
    return 'correlation';
  }
  if (fs.existsSync(path.join(ruleDir, 'formula.xp'))) {
    return 'normalization';
  }
  throw new Error(
    `No rule.co or formula.xp in ${ruleDir}. Expected a correlation or normalization rule directory.`
  );
}

export function parseMetainfo(
  metaPath: string
): { full: Record<string, unknown>; eventDescriptions: Array<Record<string, unknown>> } {
  if (!fs.existsSync(metaPath)) {
    return { full: {}, eventDescriptions: [] };
  }
  const raw = fs.readFileSync(metaPath, 'utf8');
  const data = (yaml.load(raw) as Record<string, unknown>) || {};
  let eds = data.EventDescriptions;
  if (!Array.isArray(eds)) {
    eds = [];
  }
  return {
    full: data,
    eventDescriptions: eds as Array<Record<string, unknown>>
  };
}

function extractCorrelationName(text: string): string | null {
  const m = /^\s*rule\s+([A-Za-z0-9_]+)\s*:/m.exec(text);
  return m ? m[1]! : null;
}

function extractFormulaId(text: string): string | null {
  const m = /^\s*id\s*=\s*"([^"]+)"/m.exec(text);
  return m ? m[1]! : null;
}

function extractSwitchAssignments(text: string): Array<{
  variable: string;
  cases: Array<[string, string]>;
}> {
  const results: Array<{ variable: string; cases: Array<[string, string]> }> = [];
  const pattern = /\$(\w+)\s*=\s*switch\b([\s\S]*?)\bendswitch/gi;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(text)) !== null) {
    const varName = m[1]!;
    const body = m[2]!;
    const cases: Array<[string, string]> = [];
    for (const line of body.split('\n')) {
      const t = line.trim();
      if (!t.toLowerCase().startsWith('case ')) {
        continue;
      }
      const rest = t.slice(5).trim();
      const parts = [...rest.matchAll(/"([^"]*)"|'([^']*)'/g)];
      const flat: string[] = [];
      for (const mm of parts) {
        flat.push(mm[1] !== undefined ? mm[1]! : mm[2]!);
      }
      if (flat.length >= 2) {
        cases.push([flat[0]!, flat[flat.length - 1]!]);
      } else if (flat.length === 1) {
        cases.push([flat[0]!, flat[0]!]);
      }
    }
    if (cases.length) {
      results.push({ variable: varName, cases });
    }
  }
  return results;
}

function extractStatusBranches(text: string): boolean {
  return (
    /\bstatus\s*=\s*["']success["']/i.test(text) &&
    /\bstatus\s*=\s*["']failure["']/i.test(text)
  );
}

function extractDollarAssigns(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(/\$(\w+(?:\.\w+)*)/g)) {
    found.add(m[1]!);
  }
  return [...found].sort();
}

export function parseRuleCode(
  codePath: string,
  ruleType: RuleType
): {
  text: string;
  correlation_name?: string;
  formula_id?: string;
  switch_blocks?: Array<{ variable: string; cases: Array<[string, string]> }>;
  has_status_success_failure?: boolean;
  dollar_fields?: string[];
} {
  const text = fs.readFileSync(codePath, 'utf8');
  const out: ReturnType<typeof parseRuleCode> = { text };
  if (ruleType === 'correlation') {
    const cn = extractCorrelationName(text);
    if (cn) {
      out.correlation_name = cn;
    }
    out.switch_blocks = extractSwitchAssignments(text);
    out.dollar_fields = extractDollarAssigns(text);
  } else {
    const fid = extractFormulaId(text);
    if (fid) {
      out.formula_id = fid;
    }
    out.has_status_success_failure = extractStatusBranches(text);
    out.dollar_fields = extractDollarAssigns(text);
  }
  return out;
}

export function parseRawEvents(testsDir: string): Array<Record<string, unknown>> {
  if (!fs.existsSync(testsDir) || !fs.statSync(testsDir).isDirectory()) {
    return [];
  }
  const events: Array<Record<string, unknown>> = [];
  const names = fs.readdirSync(testsDir).filter((n) => n.startsWith('raw_') && n.endsWith('.txt'));
  for (const n of names.sort()) {
    try {
      const p = path.join(testsDir, n);
      const raw = fs.readFileSync(p, 'utf8').trim();
      if (!raw) {
        continue;
      }
      const obj = JSON.parse(raw) as unknown;
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
        events.push(obj as Record<string, unknown>);
      }
    } catch {
      continue;
    }
  }
  return events;
}

export function buildContext(ruleDir: string): ParsedContext {
  const resolved = path.resolve(ruleDir);
  const rtype = detectRuleType(resolved);
  const metaPath = path.join(resolved, 'metainfo.yaml');
  const { full, eventDescriptions } = fs.existsSync(metaPath)
    ? parseMetainfo(metaPath)
    : { full: {}, eventDescriptions: [] };

  const codePath = rtype === 'correlation' ? path.join(resolved, 'rule.co') : path.join(resolved, 'formula.xp');
  const codeInfo = parseRuleCode(codePath, rtype);
  const raw = parseRawEvents(path.join(resolved, 'tests'));

  const dollarFields = codeInfo.dollar_fields ?? [];
  const expertReferences = extractExpertReferences(full);
  const allowedPlaceholders = buildAllowedPlaceholders(
    resolved,
    rtype === 'normalization' ? [] : dollarFields
  );

  return {
    ruleDir: resolved,
    ruleType: rtype,
    correlationName: codeInfo.correlation_name ?? null,
    formulaId: codeInfo.formula_id ?? null,
    ruleCodePath: codePath,
    ruleCodeText: codeInfo.text,
    metainfoPath: fs.existsSync(metaPath) ? metaPath : null,
    metainfoFull: full,
    existingEventDescriptions: eventDescriptions,
    rawEvents: raw,
    expertReferences,
    hints: {
      switch_blocks: codeInfo.switch_blocks ?? [],
      has_status_success_failure: codeInfo.has_status_success_failure ?? false,
      dollar_fields_sample: dollarFields.slice(0, 80)
    },
    allowedPlaceholders
  };
}
