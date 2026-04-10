import type { I18nLlmPayload } from '../../i18nCore/payload-schema';

import { Localization } from '../../models/content/localization';
import type { RuleBaseItem } from '../../models/content/ruleBaseItem';

/**
 * Maps an LLM payload into the in-memory rule model (same shape as the localization editor).
 */
export function applyI18nPayloadToRule(rule: RuleBaseItem, payload: I18nLlmPayload): void {
  rule.setRuDescription(payload.description_ru.trim());
  rule.setEnDescription(payload.description_en.trim());

  const ruById = new Map(
    payload.event_descriptions_ru.map((e) => [e.LocalizationId, e.EventDescription])
  );
  const enById = new Map(
    payload.event_descriptions_en.map((e) => [e.LocalizationId, e.EventDescription])
  );

  const localizations: Localization[] = [];
  for (const row of payload.event_descriptions_metainfo) {
    const loc = Localization.create(
      row.Criteria.trim(),
      (ruById.get(row.LocalizationId) ?? '').trim(),
      (enById.get(row.LocalizationId) ?? '').trim()
    );
    loc.setLocalizationId(row.LocalizationId);
    localizations.push(loc);
  }
  rule.setLocalizationTemplates(localizations);
}
