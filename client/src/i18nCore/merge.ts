/**
 * Smart merge — port of i18n_ai_assistant/merger.py
 */

import yaml from 'js-yaml';
import path from 'path';
import type { I18nLlmPayload } from './payload-schema';

/** metainfo / generic — avoid folded `>` scalars on long Criteria */
const YAML_DUMP_OPTS: yaml.DumpOptions = {
  indent: 2,
  lineWidth: -1,
  noRefs: true,
  sortKeys: false,
  quotingType: '"',
  forceQuotes: false
};

/**
 * i18n: js-yaml with indent 2 keeps `- LocalizationId` on one line; indent 4 alone splits `-` onto its own line.
 * We dump with indent 2, then add +2 spaces to the EventDescriptions block so list items match KB style (4 spaces before `-`).
 *
 * forceQuotes: js-yaml uses block scalars (>-, |) whenever a string still contains newlines;
 * LLM payloads occasionally leave stray \\n. Forcing quotes disables block styles entirely.
 * quotingType "'" matches KB i18n style (see normalization_formulas examples).
 */
const YAML_I18N_DUMP_OPTS: yaml.DumpOptions = {
  indent: 2,
  lineWidth: -1,
  noRefs: true,
  sortKeys: false,
  quotingType: "'",
  forceQuotes: true
};

/** Shift EventDescriptions subtree by +2 spaces (2 + 2 = 4 before `-`). */
function postIndentI18nEventDescriptionsBlock(yamlText: string): string {
  const lines = yamlText.split('\n');
  const out: string[] = [];
  let afterEventDescriptions = false;
  for (const line of lines) {
    if (!afterEventDescriptions) {
      out.push(line);
      if (line.trimEnd() === 'EventDescriptions:') {
        afterEventDescriptions = true;
      }
      continue;
    }
    if (line === '') {
      out.push(line);
      continue;
    }
    out.push(`  ${line}`);
  }
  return out.join('\n');
}

/**
 * Collapse newlines / runs of whitespace for stable single-line YAML scalars
 * (no `>-`, no wrapped EventDescription).
 */
export function normalizeI18nScalarLine(value: unknown): string {
  if (value == null) {
    return '';
  }
  // Collapse line terminators (incl. U+2028/U+2029 — not matched by \s in JS regex).
  return String(value)
    .replace(/\r\n/g, '\n')
    .replace(/[\n\u000B\u000C\u0085\u2028\u2029]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normalize Description + EventDescriptions[].EventDescription before dump.
 */
export function normalizeI18nDocForDump(doc: Record<string, unknown>): void {
  if (doc.Description !== undefined && doc.Description !== null) {
    doc.Description = normalizeI18nScalarLine(doc.Description);
  }
  const eds = doc.EventDescriptions;
  if (!Array.isArray(eds)) {
    return;
  }
  for (const item of eds) {
    if (item && typeof item === 'object' && 'EventDescription' in item) {
      const row = item as Record<string, unknown>;
      row.EventDescription = normalizeI18nScalarLine(row.EventDescription);
    }
  }
}

function loadYaml(content: string | undefined): Record<string, unknown> {
  if (!content || !content.trim()) {
    return {};
  }
  const doc = yaml.load(content);
  if (doc && typeof doc === 'object' && !Array.isArray(doc)) {
    return doc as Record<string, unknown>;
  }
  return {};
}

export function dumpYaml(data: Record<string, unknown>): string {
  return yaml.dump(data, YAML_DUMP_OPTS);
}

/** Serialize i18n_ru / i18n_en: KB style (4-space list indent, no folded block scalars). */
export function dumpI18nYaml(data: Record<string, unknown>): string {
  normalizeI18nDocForDump(data);
  const raw = yaml.dump(data, YAML_I18N_DUMP_OPTS);
  return postIndentI18nEventDescriptionsBlock(raw);
}

function existingI18nIds(doc: Record<string, unknown>): Set<string> {
  const eds = doc.EventDescriptions;
  if (!Array.isArray(eds)) {
    return new Set();
  }
  const out = new Set<string>();
  for (const item of eds) {
    if (item && typeof item === 'object' && 'LocalizationId' in item) {
      const lid = (item as { LocalizationId?: string }).LocalizationId;
      if (lid) {
        out.add(String(lid));
      }
    }
  }
  return out;
}

function existingMetaIds(rows: Array<Record<string, unknown>>): Set<string> {
  const out = new Set<string>();
  for (const row of rows) {
    const lid = row.LocalizationId;
    if (lid) {
      out.add(String(lid));
    }
  }
  return out;
}

export interface MetaRow {
  Criteria?: string;
  LocalizationId?: string;
}

export interface I18nRow {
  LocalizationId?: string;
  EventDescription?: string;
}

/**
 * Merge generated content into i18n document (in memory).
 * Description: keep existing if non-empty; else set from generated.
 * EventDescriptions: upsert by LocalizationId — new rows are appended; existing ids get EventDescription replaced from the payload (regenerate / Generate).
 */
export function mergeI18nDoc(
  existingYaml: string | undefined,
  description: string | null | undefined,
  newEventRows: I18nRow[]
): Record<string, unknown> {
  const doc = loadYaml(existingYaml);

  if (
    description &&
    (!doc.Description || !String(doc.Description).trim())
  ) {
    doc.Description = normalizeI18nScalarLine(description);
  }

  let existing: Array<Record<string, unknown>> = Array.isArray(doc.EventDescriptions)
    ? (doc.EventDescriptions as Array<Record<string, unknown>>)
    : [];
  const indexById = new Map<string, number>();
  for (let i = 0; i < existing.length; i++) {
    const r = existing[i];
    const lid = r && typeof r === 'object' ? (r as { LocalizationId?: string }).LocalizationId : undefined;
    if (lid) {
      indexById.set(String(lid), i);
    }
  }

  for (const row of newEventRows) {
    const lid = row.LocalizationId;
    if (!lid) {
      continue;
    }
    const normalized = normalizeI18nScalarLine(row.EventDescription ?? '');
    const key = String(lid);
    if (indexById.has(key)) {
      const i = indexById.get(key)!;
      existing[i] = { ...existing[i], LocalizationId: lid, EventDescription: normalized };
    } else {
      existing.push({ LocalizationId: lid, EventDescription: normalized });
      indexById.set(key, existing.length - 1);
    }
  }

  doc.EventDescriptions = existing;
  return doc;
}

export function mergeMetainfoEventDescriptionsDoc(
  existingYaml: string,
  newRows: MetaRow[]
): Record<string, unknown> {
  const fullDoc = loadYaml(existingYaml);
  let existing: Array<Record<string, unknown>> = Array.isArray(fullDoc.EventDescriptions)
    ? (fullDoc.EventDescriptions as Array<Record<string, unknown>>)
    : [];
  const known = existingMetaIds(existing);
  for (const row of newRows) {
    const lid = row.LocalizationId;
    if (!lid || known.has(String(lid))) {
      continue;
    }
    existing.push({
      Criteria: row.Criteria ?? '',
      LocalizationId: lid
    });
    known.add(String(lid));
  }
  fullDoc.EventDescriptions = existing;
  return fullDoc;
}

export type LangMode = 'ru' | 'en' | 'both';

export interface ApplySummary {
  dry_run: boolean;
  written: string[];
  skipped: string[];
  would_merge_meta?: number;
  would_merge_ru?: boolean;
  would_merge_en?: boolean;
}

/** Apply with synchronous file read (Node fs). */
export function applyPayloadFs(
  ruleDir: string,
  payload: I18nLlmPayload,
  lang: LangMode,
  dryRun: boolean,
  fs: {
    existsSync: (p: string) => boolean;
    readFileSync: (p: string, enc: BufferEncoding) => string;
    writeFileSync: (p: string, content: string) => void;
    mkdirSync: (p: string, opts?: { recursive?: boolean }) => void;
  }
): ApplySummary {
  const resolved = path.resolve(ruleDir);
  const metaPath = path.join(resolved, 'metainfo.yaml');
  const i18nDir = path.join(resolved, 'i18n');
  const pathsRu = path.join(i18nDir, 'i18n_ru.yaml');
  const pathsEn = path.join(i18nDir, 'i18n_en.yaml');

  const metaRows = payload.event_descriptions_metainfo;
  const ruRows = payload.event_descriptions_ru;
  const enRows = payload.event_descriptions_en;

  const summary: ApplySummary = { dry_run: dryRun, written: [], skipped: [] };

  if (dryRun) {
    summary.would_merge_meta = metaRows.length;
    summary.would_merge_ru = lang === 'ru' || lang === 'both';
    summary.would_merge_en = lang === 'en' || lang === 'both';
    return summary;
  }

  if (!fs.existsSync(metaPath)) {
    throw new Error(`metainfo.yaml is required to merge EventDescriptions: ${metaPath}`);
  }

  const metaPrev = fs.readFileSync(metaPath, 'utf8');
  const mergedMeta = mergeMetainfoEventDescriptionsDoc(metaPrev, metaRows);
  fs.writeFileSync(metaPath, dumpYaml(mergedMeta));
  summary.written.push(metaPath);

  if (lang === 'ru' || lang === 'both') {
    if (!fs.existsSync(i18nDir)) {
      fs.mkdirSync(i18nDir, { recursive: true });
    }
    const prev = fs.existsSync(pathsRu) ? fs.readFileSync(pathsRu, 'utf8') : undefined;
    const docRu = mergeI18nDoc(prev, payload.description_ru, ruRows);
    fs.writeFileSync(pathsRu, dumpI18nYaml(docRu));
    summary.written.push(pathsRu);
  }

  if (lang === 'en' || lang === 'both') {
    if (!fs.existsSync(i18nDir)) {
      fs.mkdirSync(i18nDir, { recursive: true });
    }
    const prev = fs.existsSync(pathsEn) ? fs.readFileSync(pathsEn, 'utf8') : undefined;
    const docEn = mergeI18nDoc(prev, payload.description_en, enRows);
    fs.writeFileSync(pathsEn, dumpI18nYaml(docEn));
    summary.written.push(pathsEn);
  }

  return summary;
}

export interface PlannedFileChange {
  /** Absolute or normalized path */
  path: string;
  /** Previous file content (empty if file did not exist) */
  before: string;
  /** Content after merge */
  after: string;
}

/**
 * Compute file contents after merge without writing (for preview / diff).
 */
export function planMergeChanges(
  ruleDir: string,
  payload: I18nLlmPayload,
  lang: LangMode,
  readFile: (p: string) => string | undefined,
  existsSync: (p: string) => boolean
): PlannedFileChange[] {
  const resolved = path.resolve(ruleDir);
  const metaPath = path.join(resolved, 'metainfo.yaml');
  const i18nDir = path.join(resolved, 'i18n');
  const pathsRu = path.join(i18nDir, 'i18n_ru.yaml');
  const pathsEn = path.join(i18nDir, 'i18n_en.yaml');

  const changes: PlannedFileChange[] = [];

  if (existsSync(metaPath)) {
    const before = readFile(metaPath) ?? '';
    const after = dumpYaml(mergeMetainfoEventDescriptionsDoc(before, payload.event_descriptions_metainfo));
    if (after !== before) {
      changes.push({ path: metaPath, before, after });
    }
  }

  if (lang === 'ru' || lang === 'both') {
    const before = existsSync(pathsRu) ? readFile(pathsRu) ?? '' : '';
    const after = dumpI18nYaml(
      mergeI18nDoc(before || undefined, payload.description_ru, payload.event_descriptions_ru)
    );
    if (after !== before) {
      changes.push({ path: pathsRu, before, after });
    }
  }

  if (lang === 'en' || lang === 'both') {
    const before = existsSync(pathsEn) ? readFile(pathsEn) ?? '' : '';
    const after = dumpI18nYaml(
      mergeI18nDoc(before || undefined, payload.description_en, payload.event_descriptions_en)
    );
    if (after !== before) {
      changes.push({ path: pathsEn, before, after });
    }
  }

  return changes;
}
