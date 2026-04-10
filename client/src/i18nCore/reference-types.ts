/**
 * Types for ExpertContext.References enrichment (no runtime deps on parser/llm).
 */

export interface ReferenceSource {
  url: string;
  title?: string;
  text_snippet: string;
  fetch_error?: string;
}

export interface ReferenceResearchSummary {
  threat_summary: string;
  tactics: string[];
  keywords: string[];
}

/** Attached to ParsedContext after fetch + summarization LLM */
export interface ReferenceResearch {
  urls: string[];
  sources: ReferenceSource[];
  summary: ReferenceResearchSummary;
}
