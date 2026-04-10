import path from 'path';
import type { I18nLlmPayload } from '../payload-schema';
import type { LangMode } from '../merge';
import {
  dumpI18nYaml,
  dumpYaml,
  mergeI18nDoc,
  mergeMetainfoEventDescriptionsDoc,
  type PlannedFileChange
} from '../merge';
import type { FileAccess } from './types';

/**
 * Compute planned file changes using async FileAccess (e.g. VS Code `workspace.fs`).
 */
export async function planMergeChangesAsync(
  ruleDir: string,
  payload: I18nLlmPayload,
  lang: LangMode,
  files: FileAccess
): Promise<PlannedFileChange[]> {
  const resolved = path.resolve(ruleDir);
  const metaPath = path.join(resolved, 'metainfo.yaml');
  const pathsRu = path.join(resolved, 'i18n', 'i18n_ru.yaml');
  const pathsEn = path.join(resolved, 'i18n', 'i18n_en.yaml');

  const changes: PlannedFileChange[] = [];

  if (await files.exists(metaPath)) {
    const before = (await files.readText(metaPath)) ?? '';
    const after = dumpYaml(mergeMetainfoEventDescriptionsDoc(before, payload.event_descriptions_metainfo));
    if (after !== before) {
      changes.push({ path: metaPath, before, after });
    }
  }

  if (lang === 'ru' || lang === 'both') {
    const before = (await files.exists(pathsRu)) ? (await files.readText(pathsRu)) ?? '' : '';
    const after = dumpI18nYaml(
      mergeI18nDoc(before || undefined, payload.description_ru, payload.event_descriptions_ru)
    );
    if (after !== before) {
      changes.push({ path: pathsRu, before, after });
    }
  }

  if (lang === 'en' || lang === 'both') {
    const before = (await files.exists(pathsEn)) ? (await files.readText(pathsEn)) ?? '' : '';
    const after = dumpI18nYaml(
      mergeI18nDoc(before || undefined, payload.description_en, payload.event_descriptions_en)
    );
    if (after !== before) {
      changes.push({ path: pathsEn, before, after });
    }
  }

  return changes;
}
