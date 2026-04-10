export type { RuleType, ParsedContext } from './parser';
export {
  detectRuleType,
  parseMetainfo,
  parseRuleCode,
  parseRawEvents,
  buildContext,
  extractExpertReferences
} from './parser';

export type {
  ReferenceResearch,
  ReferenceResearchSummary,
  ReferenceSource
} from './reference-types';

export {
  fetchReferenceSources,
  summarizeReferencesWithLlm,
  hasUsableReferenceContent,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_MAX_SOURCES,
  DEFAULT_MAX_CHARS_PER_SOURCE
} from './reference-research';

export type { I18nLlmPayload } from './payload-schema';
export {
  I18nLlmPayloadSchema,
  MetainfoEventRowSchema,
  I18nEventRowSchema,
  validatePayload
} from './payload-schema';

export * from './prompts';

export { filterTaxonomyForPlaceholders } from './taxonomy-lookup';

export type { LangMode, ApplySummary, PlannedFileChange, MetaRow, I18nRow } from './merge';
export {
  mergeI18nDoc,
  mergeMetainfoEventDescriptionsDoc,
  dumpYaml,
  dumpI18nYaml,
  normalizeI18nScalarLine,
  normalizeI18nDocForDump,
  applyPayloadFs,
  planMergeChanges
} from './merge';

export type { ValidateReport } from './validate';
export { validateRuleDirectory } from './validate';

export type { LlmClientOptions } from './llm-client';
export { generatePayloadFromContext } from './llm-client';

export { buildAllowedPlaceholders, extractQuotedJsonKeys } from './placeholder-allowlist';
export {
  collectAllPayloadPlaceholders,
  validatePayloadPlaceholders
} from './placeholder-validate';

export type { FetchFailureStage } from './network-errors';
export {
  formatErrorChain,
  summarizeFetchFailure,
  summarizeHttpFailure
} from './network-errors';

export { runGeneratePipeline, runPreviewPlan } from './orchestration';

export * as adapters from './adapters/index';
