import path from 'path';
import type { I18nLlmPayload } from '../payload-schema';
import type { LangMode, ApplySummary } from '../merge';
import { dumpI18nYaml, dumpYaml, mergeI18nDoc, mergeMetainfoEventDescriptionsDoc } from '../merge';
import type { FileAccess } from './types';

/**
 * Apply payload using async FileAccess (VS Code workspace).
 */
export async function applyPayloadAsync(
  ruleDir: string,
  payload: I18nLlmPayload,
  lang: LangMode,
  dryRun: boolean,
  files: FileAccess
): Promise<ApplySummary> {
  const resolved = path.resolve(ruleDir);
  const metaPath = path.join(resolved, 'metainfo.yaml');
  const i18nDir = path.join(resolved, 'i18n');
  const pathsRu = path.join(i18nDir, 'i18n_ru.yaml');
  const pathsEn = path.join(i18nDir, 'i18n_en.yaml');

  const metaRows = payload.event_descriptions_metainfo;
  const ruRows = payload.event_descriptions_ru;

  const summary: ApplySummary = { dry_run: dryRun, written: [], skipped: [] };

  if (dryRun) {
    summary.would_merge_meta = metaRows.length;
    summary.would_merge_ru = lang === 'ru' || lang === 'both';
    summary.would_merge_en = lang === 'en' || lang === 'both';
    return summary;
  }

  if (!(await files.exists(metaPath))) {
    throw new Error(`metainfo.yaml is required to merge EventDescriptions: ${metaPath}`);
  }

  const metaPrev = (await files.readText(metaPath)) ?? '';
  const mergedMeta = mergeMetainfoEventDescriptionsDoc(metaPrev, metaRows);
  await files.writeText(metaPath, dumpYaml(mergedMeta));
  summary.written.push(metaPath);

  if (lang === 'ru' || lang === 'both') {
    await files.mkdirp(i18nDir);
    const prev = (await files.exists(pathsRu)) ? (await files.readText(pathsRu)) ?? '' : undefined;
    const docRu = mergeI18nDoc(prev, payload.description_ru, ruRows);
    await files.writeText(pathsRu, dumpI18nYaml(docRu));
    summary.written.push(pathsRu);
  }

  if (lang === 'en' || lang === 'both') {
    await files.mkdirp(i18nDir);
    const prev = (await files.exists(pathsEn)) ? (await files.readText(pathsEn)) ?? '' : undefined;
    const docEn = mergeI18nDoc(prev, payload.description_en, payload.event_descriptions_en);
    await files.writeText(pathsEn, dumpI18nYaml(docEn));
    summary.written.push(pathsEn);
  }

  return summary;
}
