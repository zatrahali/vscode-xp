/**
 * LocalizationId alignment — port of cli.cmd_validate
 */

import yaml from 'js-yaml';
import path from 'path';
import * as fs from 'fs';

export interface ValidateReport {
  metainfo_localization_ids: string[];
  missing_in_i18n_ru: string[];
  missing_in_i18n_en: string[];
  extra_in_i18n_ru_not_in_metainfo: string[];
  extra_in_i18n_en_not_in_metainfo: string[];
}

function idsFromMetainfo(meta: Record<string, unknown>): Set<string> {
  const eds = meta.EventDescriptions;
  if (!Array.isArray(eds)) {
    return new Set();
  }
  const out = new Set<string>();
  for (const x of eds) {
    if (x && typeof x === 'object' && 'LocalizationId' in x) {
      const lid = (x as { LocalizationId?: string }).LocalizationId;
      if (lid) {
        out.add(String(lid));
      }
    }
  }
  return out;
}

function idsFromI18nFile(filePath: string): Set<string> {
  if (!fs.existsSync(filePath)) {
    return new Set();
  }
  const doc = yaml.load(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown> | undefined;
  if (!doc) {
    return new Set();
  }
  const eds = doc.EventDescriptions;
  if (!Array.isArray(eds)) {
    return new Set();
  }
  const out = new Set<string>();
  for (const x of eds) {
    if (x && typeof x === 'object' && 'LocalizationId' in x) {
      const lid = (x as { LocalizationId?: string }).LocalizationId;
      if (lid) {
        out.add(String(lid));
      }
    }
  }
  return out;
}

export function validateRuleDirectory(ruleDir: string): { ok: boolean; report: ValidateReport } {
  const resolved = path.resolve(ruleDir);
  const metaPath = path.join(resolved, 'metainfo.yaml');
  if (!fs.existsSync(metaPath)) {
    throw new Error(`Missing ${metaPath}`);
  }
  const meta = (yaml.load(fs.readFileSync(metaPath, 'utf8')) as Record<string, unknown>) || {};
  const metaIds = idsFromMetainfo(meta);
  const ruPath = path.join(resolved, 'i18n', 'i18n_ru.yaml');
  const enPath = path.join(resolved, 'i18n', 'i18n_en.yaml');
  const ruIds = idsFromI18nFile(ruPath);
  const enIds = idsFromI18nFile(enPath);

  const missingRu = [...metaIds].filter((id) => !ruIds.has(id)).sort();
  const missingEn = [...metaIds].filter((id) => !enIds.has(id)).sort();
  const extraRu = [...ruIds].filter((id) => !metaIds.has(id)).sort();
  const extraEn = [...enIds].filter((id) => !metaIds.has(id)).sort();

  const report: ValidateReport = {
    metainfo_localization_ids: [...metaIds].sort(),
    missing_in_i18n_ru: missingRu,
    missing_in_i18n_en: missingEn,
    extra_in_i18n_ru_not_in_metainfo: extraRu,
    extra_in_i18n_en_not_in_metainfo: extraEn
  };

  const ok = missingRu.length === 0 && missingEn.length === 0;
  return { ok, report };
}
