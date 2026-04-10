/**
 * XP taxonomy field descriptions (Russian) — filtered by allowed placeholders.
 * Data file: client/src/i18nCore/data/taxonomy-fields.json → copied to client/out/data at build.
 */

import * as fs from 'fs';
import * as path from 'path';

function readTaxonomyJson(): string {
  const bundled = path.join(__dirname, 'data', 'taxonomy-fields.json');
  if (fs.existsSync(bundled)) {
    return fs.readFileSync(bundled, 'utf8');
  }
  throw new Error(`taxonomy-fields.json not found at ${bundled}`);
}

let taxonomyCache: Record<string, string> | null = null;

function getFullTaxonomy(): Record<string, string> {
  if (!taxonomyCache) {
    taxonomyCache = JSON.parse(readTaxonomyJson()) as Record<string, string>;
  }
  return taxonomyCache;
}

/**
 * Subset of taxonomy descriptions for field paths in `allowedPlaceholders`.
 */
export function filterTaxonomyForPlaceholders(
  allowedPlaceholders: string[]
): Record<string, string> {
  const all = getFullTaxonomy();
  const result: Record<string, string> = {};
  for (const field of allowedPlaceholders) {
    const desc = all[field];
    if (desc !== undefined) {
      result[field] = desc;
    }
  }
  return result;
}

/** @internal — tests */
export function _resetTaxonomyCacheForTests(): void {
  taxonomyCache = null;
}
