/**
 * Build allowlist of {placeholder} tokens from test_conds*.tc, norm*.js, and rule-code $fields
 * only when those $fields also appear in test_conds*.tc (correlation). Normalization passes
 * an empty dollarFields list so $fields from formula.xp never enter the allowlist.
 */

import * as fs from 'fs';
import path from 'path';

const KEY_RE = /"([^"]+)":/g;

/** Keys like "event_src.host" or "datafield1" from JSON-like text */
export function extractQuotedJsonKeys(text: string): string[] {
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  KEY_RE.lastIndex = 0;
  while ((m = KEY_RE.exec(text)) !== null) {
    const k = m[1]!;
    if (/^[a-zA-Z_][a-zA-Z0-9_.]*$/.test(k)) {
      out.add(k);
    }
  }
  return [...out];
}

function tryParseJsonKeys(filePath: string): string[] {
  try {
    const raw = fs.readFileSync(filePath, 'utf8').trim();
    if (!raw) {
      return [];
    }
    const obj = JSON.parse(raw) as unknown;
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      return Object.keys(obj as Record<string, unknown>);
    }
  } catch {
    // fall through to regex scan
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return extractQuotedJsonKeys(raw);
  } catch {
    return [];
  }
}

function collectFromTestsDir(ruleDir: string, dollarFields: string[]): Set<string> {
  const out = new Set<string>();
  const tcKeys = new Set<string>();

  const testsDir = path.join(ruleDir, 'tests');
  if (!fs.existsSync(testsDir) || !fs.statSync(testsDir).isDirectory()) {
    return out;
  }
  const names = fs.readdirSync(testsDir);
  for (const name of names) {
    const p = path.join(testsDir, name);
    let st: fs.Stats;
    try {
      st = fs.statSync(p);
    } catch {
      continue;
    }
    if (!st.isFile()) {
      continue;
    }
    if (name.startsWith('test_conds') && name.endsWith('.tc')) {
      try {
        const text = fs.readFileSync(p, 'utf8');
        for (const k of extractQuotedJsonKeys(text)) {
          tcKeys.add(k);
          out.add(k);
        }
      } catch {
        continue;
      }
    }
    if (name.toLowerCase().endsWith('.js') && /^norm/i.test(name)) {
      for (const k of tryParseJsonKeys(p)) {
        out.add(k);
      }
    }
  }

  for (const d of dollarFields) {
    if (tcKeys.has(d)) {
      out.add(d);
    }
  }

  return out;
}

/**
 * Sorted unique field paths allowed inside `{...}` in EventDescription / Description.
 */
export function buildAllowedPlaceholders(ruleDir: string, dollarFieldsFromCode: string[]): string[] {
  const set = collectFromTestsDir(path.resolve(ruleDir), dollarFieldsFromCode);
  return [...set].sort();
}
