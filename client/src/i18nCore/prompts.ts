/**
 * Prompt templates — port of i18n_ai_assistant/prompts.py + corporate rules from system_prompt.jinja2
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ParsedContext } from './parser';
import { filterTaxonomyForPlaceholders } from './taxonomy-lookup';

export const SYSTEM_PROMPT = `You are an expert SIEM knowledge-base editor. Your task is to produce localization metadata for correlation or normalization rules.

Output MUST be a single JSON object (no markdown fences) with this exact schema:
{
  "event_descriptions_metainfo": [
    {"Criteria": "string", "LocalizationId": "string"}
  ],
  "description_ru": "string",
  "description_en": "string",
  "event_descriptions_ru": [
    {"LocalizationId": "string", "EventDescription": "string"}
  ],
  "event_descriptions_en": [
    {"LocalizationId": "string", "EventDescription": "string"}
  ]
}

Rules:
1. metainfo Criteria syntax: use \`correlation_name = "Name"\` for correlation rules; for normalization use \`id = "PT_..."\` and add \`and field = value\` / \`and field != null\` as needed. Match the rule logic (multiple branches => multiple Criteria).
2. LocalizationId naming:
   - Correlation: corrname_<RuleName> or corrname_<RuleName>_<suffix> for variants (_2, _3, or semantic suffix like _create).
   - Normalization: often <id>_success / <id>_failure when status branches exist; else single id matching rule id.
3. Every LocalizationId in event_descriptions_metainfo must appear in both event_descriptions_ru and event_descriptions_en with the same id.
4. EventDescription and description_* use placeholders in curly braces ONLY for field paths listed in context JSON key \`allowed_placeholders\`. Do not use any {field} that is not in that list. Do not invent fields.
5. description_ru / description_en: one short general sentence about the rule (threat/use case), consistent with ExpertContext style when provided. Description answers: what the correlation detects, attacker impact if successful, possible next steps. Strict max 400 characters per description_*.
6. Use professional Russian and English security/SIEM tone.
7. If the context JSON includes \`reference_research\` (summarized external references), use it only as background on threat semantics and attack narrative. Do NOT copy long URLs verbatim. Do NOT invent Criteria, LocalizationId, or SIEM field placeholders from the research text — only use placeholders from \`allowed_placeholders\` (and rule logic), not from research text alone.
8. If the context JSON includes \`taxonomy_field_descriptions\`, use it to understand the semantic meaning of each allowed placeholder. Write EventDescription text that reflects each field's purpose per these descriptions.
9. Workflow (generation order): (a) Criteria and LocalizationId in event_descriptions_metainfo, (b) description_en, (c) description_ru, (d) EventDescription strings in English per id, (e) EventDescription strings in Russian per id.
10. Branching: each branch in the rule needs its own localization. If \`rule\` uses multiple events with \`or\`, each needs a localization. If \`on\` blocks use if/else affecting subject, object, action, reason, correlation_type, importance — create a localization per case.
11. EventDescription: one sentence when possible; target under 120 characters, hard max 400. Focus on what happened and with whom/what, not raw syntax. Avoid unnecessary jargon unless standard (e.g. bruteforce). English: active voice, past or present perfect. Russian: professional terminology; prefer "узел" over "хост", "пользователь" over "юзер", "учетная запись" over "аккаунт", "изменение" over "модификация", "злоумышленник" over "атакующий", "попытка войти" over "попытка входа"; "срабатывание правила" / "регистрация события" instead of casual "сработка"; "добавление в список исключений" instead of "вайтлистинг"; "вспомогательное правило" for subrule context.
12. CVE-related rules: name as "уязвимость <CVE-ID> (<optional name>)"; describe as "(Возможная) эксплуатация уязвимости <CVE-ID> (<name>) в программе/системе <product>, что может привести к <impact>". Do not use "zero-day" or "трендовая [уязвимость]".
13. Russian "потенциальный" vs "возможный": potential = conditions may enable something in the future; possible = something may have happened but certainty is unclear. Pattern for uncertainty: "<Событие>, что может указывать на / может быть признаком <вредоносная активность>".
14. If one EventDescription describes failure, description_* should not imply only success — use "попытка" / "attempt" where appropriate.
15. For {reason} in text, prefer phrasing like "Контекст события: {reason}", "Комментарий: {reason}", or "Причина: {reason}" as fits. Do not start with "Правило обнаружило..." / "Обнаружено..." / "The rule detected" (tautology). Put the most alarming fact first: what happened, how detected, possible impact.
16. Punctuation: if Description or EventDescription is a single sentence, no trailing period. If two or more sentences: English — period after each sentence; Russian — period after each sentence except the last.
17. Quotes: use straight double quotes "" for Russian and English locales when quotes are needed. Omit quotes around plain numbers, paths, emails, typical usernames, and many service names when unambiguous; use quotes when special characters or document titles require separation. English may need quotes where Russian omits for certain lowercase words that are English dictionary words.
18. Apostrophe in single-quoted YAML-style strings: double the apostrophe (e.g. user''s).
19. XP \`copy_fields($a.x, b.x)\` copies all child fields (e.g. hash.md5, sha1, sha256, imphash) in one instruction, equivalent to assigning each child field explicitly.
`;

/** Compact multi-criteria correlation few-shot (Exchange reason branches) as user/assistant chat pair. */
export const MULTI_CRITERIA_FEW_SHOT = {
  user: [
    'Generate localization JSON for this correlation rule.',
    '',
    'Context (JSON):',
    JSON.stringify(
      {
        rule_type: 'correlation',
        correlation_name: 'Exchange_Journal_Rule_Actions',
        formula_id: null,
        rule_code:
          'rule Exchange_Journal_Rule_Actions:\n  correlation_type = "Exchange"\n  ...\nemit {\n  switch $reason\n    case "create"\n    case "modify"\n    case "remove"\n  endswitch\n}',
        metainfo_existing: {},
        raw_events_sample: []
      },
      null,
      2
    )
  ].join('\n'),
  assistant: JSON.stringify({
    event_descriptions_metainfo: [
      {
        Criteria: 'correlation_name = "Exchange_Journal_Rule_Actions" and reason = "create"',
        LocalizationId: 'corrname_Exchange_Journal_Rule_Actions_create'
      },
      {
        Criteria: 'correlation_name = "Exchange_Journal_Rule_Actions" and reason = "modify"',
        LocalizationId: 'corrname_Exchange_Journal_Rule_Actions_modify'
      },
      {
        Criteria: 'correlation_name = "Exchange_Journal_Rule_Actions" and reason = "remove"',
        LocalizationId: 'corrname_Exchange_Journal_Rule_Actions_remove'
      }
    ],
    description_ru:
      'Правило срабатывает при создании, изменении или удалении правила журнала в Exchange.',
    description_en:
      'The rule fires when a journal rule is created, modified, or removed in Exchange.',
    event_descriptions_ru: [
      {
        LocalizationId: 'corrname_Exchange_Journal_Rule_Actions_create',
        EventDescription:
          'Пользователь {subject.account.name} создал правило журнала "{object.name}" в системе Exchange на узле {event_src.host}'
      },
      {
        LocalizationId: 'corrname_Exchange_Journal_Rule_Actions_modify',
        EventDescription:
          'Пользователь {subject.account.name} изменил правило журнала "{object.name}" в системе Exchange на узле {event_src.host}'
      },
      {
        LocalizationId: 'corrname_Exchange_Journal_Rule_Actions_remove',
        EventDescription:
          'Пользователь {subject.account.name} удалил правило журнала "{object.name}" в системе Exchange на узле {event_src.host}'
      }
    ],
    event_descriptions_en: [
      {
        LocalizationId: 'corrname_Exchange_Journal_Rule_Actions_create',
        EventDescription:
          'User {subject.account.name} created journal rule "{object.name}" in Exchange on host {event_src.host}'
      },
      {
        LocalizationId: 'corrname_Exchange_Journal_Rule_Actions_modify',
        EventDescription:
          'User {subject.account.name} modified journal rule "{object.name}" in Exchange on host {event_src.host}'
      },
      {
        LocalizationId: 'corrname_Exchange_Journal_Rule_Actions_remove',
        EventDescription:
          'User {subject.account.name} removed journal rule "{object.name}" in Exchange on host {event_src.host}'
      }
    ]
  })
};

/** Normalization success/failure branching few-shot as user/assistant chat pair. */
export const NORMALIZATION_FEW_SHOT = {
  user: [
    'Generate localization JSON for this normalization rule.',
    '',
    'Context (JSON):',
    JSON.stringify(
      {
        rule_type: 'normalization',
        correlation_name: null,
        formula_id: 'PT_Microsoft_Exchange_customeventcollector_mailbox_audit_Move',
        rule_code:
          'rule PT_Microsoft_Exchange_customeventcollector_mailbox_audit_Move:\n  ...\n  if status == "success" then ...\n  else ... status == "failure" ...',
        metainfo_existing: {},
        raw_events_sample: []
      },
      null,
      2
    )
  ].join('\n'),
  assistant: JSON.stringify({
    event_descriptions_metainfo: [
      {
        Criteria:
          'id = "PT_Microsoft_Exchange_customeventcollector_mailbox_audit_Move" and status = "success"',
        LocalizationId: 'PT_Microsoft_Exchange_customeventcollector_mailbox_audit_Move_success'
      },
      {
        Criteria:
          'id = "PT_Microsoft_Exchange_customeventcollector_mailbox_audit_Move" and status = "failure"',
        LocalizationId: 'PT_Microsoft_Exchange_customeventcollector_mailbox_audit_Move_failure'
      }
    ],
    description_ru: 'Попытка переместить сообщение в папку почтового ящика',
    description_en: 'Attempt to move a message to a mailbox folder',
    event_descriptions_ru: [
      {
        LocalizationId: 'PT_Microsoft_Exchange_customeventcollector_mailbox_audit_Move_success',
        EventDescription:
          'Пользователь {subject.name} ({subject.type}) переместил сообщение в папку "{object.path}" почтового ящика {datafield1} на узле {event_src.host}'
      },
      {
        LocalizationId: 'PT_Microsoft_Exchange_customeventcollector_mailbox_audit_Move_failure',
        EventDescription:
          'Пользователь {subject.name} ({subject.type}) не смог переместить сообщение в папку "{object.path}" почтового ящика {datafield1} на узле {event_src.host}'
      }
    ],
    event_descriptions_en: [
      {
        LocalizationId: 'PT_Microsoft_Exchange_customeventcollector_mailbox_audit_Move_success',
        EventDescription:
          'User {subject.name} ({subject.type}) moved a message to folder "{object.path}" in mailbox {datafield1} on host {event_src.host}'
      },
      {
        LocalizationId: 'PT_Microsoft_Exchange_customeventcollector_mailbox_audit_Move_failure',
        EventDescription:
          'User {subject.name} ({subject.type}) failed to move a message to folder "{object.path}" in mailbox {datafield1} on host {event_src.host}'
      }
    ]
  })
};

/** Prototype shots.json assistant payload (nested Description / EventDescriptions). */
interface PrototypeAssistantPayload {
  Description: { ru: string; en: string };
  EventDescriptions: Record<
    string,
    { Criteria: string; EventDescription: { ru: string; en: string } }
  >;
}

/** Convert prototype assistant JSON string to this extension's flat I18nLlmPayload JSON string. */
export function convertPrototypeAssistantToFlat(assistantStr: string): string {
  const a = JSON.parse(assistantStr) as PrototypeAssistantPayload;
  const event_descriptions_metainfo: Array<{ Criteria: string; LocalizationId: string }> = [];
  const event_descriptions_ru: Array<{ LocalizationId: string; EventDescription: string }> = [];
  const event_descriptions_en: Array<{ LocalizationId: string; EventDescription: string }> = [];
  for (const [id, row] of Object.entries(a.EventDescriptions)) {
    event_descriptions_metainfo.push({ Criteria: row.Criteria, LocalizationId: id });
    event_descriptions_ru.push({
      LocalizationId: id,
      EventDescription: row.EventDescription.ru
    });
    event_descriptions_en.push({
      LocalizationId: id,
      EventDescription: row.EventDescription.en
    });
  }
  return JSON.stringify({
    event_descriptions_metainfo,
    description_ru: a.Description.ru,
    description_en: a.Description.en,
    event_descriptions_ru,
    event_descriptions_en
  });
}

function readShotsJson(): string {
  const bundled = path.join(__dirname, 'data', 'shots.json');
  if (fs.existsSync(bundled)) {
    return fs.readFileSync(bundled, 'utf8');
  }
  throw new Error(`shots.json not found at ${bundled}`);
}

let cobaltFewShotCache: { user: string; assistant: string } | null = null;

function getCobaltStrikeFewShot(): { user: string; assistant: string } {
  if (!cobaltFewShotCache) {
    const shots = JSON.parse(readShotsJson()) as Array<{ human: string; assistant: string }>;
    const first = shots[0]!;
    cobaltFewShotCache = {
      user: first.human,
      assistant: convertPrototypeAssistantToFlat(first.assistant)
    };
  }
  return cobaltFewShotCache;
}

/** @internal — tests */
export function _resetFewShotCacheForTests(): void {
  cobaltFewShotCache = null;
}

export function contextSummaryForLlm(
  ruleType: string,
  correlationName: string | null,
  formulaId: string | null,
  ruleCodeExcerpt: string,
  metainfoExcerpt: Record<string, unknown>,
  rawEventsSample: Array<Record<string, unknown>>,
  maxCodeChars = 24000
): Record<string, unknown> {
  let code = ruleCodeExcerpt;
  if (code.length > maxCodeChars) {
    code = code.slice(0, maxCodeChars) + '\n... [truncated]';
  }
  return {
    rule_type: ruleType,
    correlation_name: correlationName,
    formula_id: formulaId,
    rule_code: code,
    metainfo_existing: metainfoExcerpt,
    raw_events_sample: rawEventsSample.slice(0, 3)
  };
}

export function buildUserPrompt(ctxSummary: Record<string, unknown>): string {
  return [
    'Generate localization JSON for the following rule.',
    '',
    'Context (JSON):',
    JSON.stringify(ctxSummary, null, 2),
    '',
    'Return only the JSON object.'
  ].join('\n');
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Messages for OpenAI-compatible chat: system + three few-shot user/assistant pairs (Cobalt Strike,
 * multi-criteria correlation, normalization) + final user prompt with context JSON only.
 */
export function buildMessagesForContext(ctx: ParsedContext): ChatMessage[] {
  const metaExcerpt = {
    ExpertContext: ctx.metainfoFull.ExpertContext,
    ContentAutoName: ctx.metainfoFull.ContentAutoName,
    existing_EventDescriptions: ctx.existingEventDescriptions
  };
  const summary = contextSummaryForLlm(
    ctx.ruleType,
    ctx.correlationName,
    ctx.formulaId,
    ctx.ruleCodeText,
    metaExcerpt,
    ctx.rawEvents
  );
  (summary as Record<string, unknown>).parser_hints = ctx.hints;
  (summary as Record<string, unknown>).allowed_placeholders = ctx.allowedPlaceholders;

  const taxonomyDescriptions = filterTaxonomyForPlaceholders(ctx.allowedPlaceholders);
  if (Object.keys(taxonomyDescriptions).length > 0) {
    (summary as Record<string, unknown>).taxonomy_field_descriptions = taxonomyDescriptions;
  }

  if (ctx.referenceResearch) {
    (summary as Record<string, unknown>).reference_research = {
      threat_summary: ctx.referenceResearch.summary.threat_summary,
      tactics: ctx.referenceResearch.summary.tactics,
      keywords: ctx.referenceResearch.summary.keywords,
      source_urls: ctx.referenceResearch.urls
    };
  }

  const cobalt = getCobaltStrikeFewShot();
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content:
        'The following JSON contains correlation rule code (and optional description). Respond with the localization JSON only.\n\n' +
        cobalt.user
    },
    { role: 'assistant', content: cobalt.assistant },
    { role: 'user', content: MULTI_CRITERIA_FEW_SHOT.user },
    { role: 'assistant', content: MULTI_CRITERIA_FEW_SHOT.assistant },
    { role: 'user', content: NORMALIZATION_FEW_SHOT.user },
    { role: 'assistant', content: NORMALIZATION_FEW_SHOT.assistant },
    { role: 'user', content: buildUserPrompt(summary) }
  ];
}
