import { z } from 'zod';

/** One row in metainfo EventDescriptions */
export const MetainfoEventRowSchema = z.object({
  Criteria: z.string(),
  LocalizationId: z.string()
});

/** One row in i18n EventDescriptions */
export const I18nEventRowSchema = z.object({
  LocalizationId: z.string(),
  EventDescription: z.string()
});

/** Canonical LLM JSON output (same keys as Python generator._validate_payload). */
export const I18nLlmPayloadSchema = z.object({
  event_descriptions_metainfo: z.array(MetainfoEventRowSchema),
  description_ru: z.string(),
  description_en: z.string(),
  event_descriptions_ru: z.array(I18nEventRowSchema),
  event_descriptions_en: z.array(I18nEventRowSchema)
});

export type I18nLlmPayload = z.infer<typeof I18nLlmPayloadSchema>;

export function validatePayload(data: unknown): I18nLlmPayload {
  const parsed = I18nLlmPayloadSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error(`Invalid LLM payload: ${parsed.error.message}`);
  }
  const v = parsed.data;
  const metaIds = new Set(v.event_descriptions_metainfo.map((e) => e.LocalizationId));
  const ruIds = new Set(v.event_descriptions_ru.map((e) => e.LocalizationId));
  const enIds = new Set(v.event_descriptions_en.map((e) => e.LocalizationId));
  if (metaIds.size !== ruIds.size || metaIds.size !== enIds.size) {
    throw new Error(
      `LocalizationId mismatch: metainfo=${[...metaIds].sort()}, ru=${[...ruIds].sort()}, en=${[...enIds].sort()}`
    );
  }
  for (const id of metaIds) {
    if (!ruIds.has(id) || !enIds.has(id)) {
      throw new Error(`LocalizationId mismatch for id=${id}`);
    }
  }
  return v;
}
