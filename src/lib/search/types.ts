export type SearchScoreKind = "structure" | "intent" | "text";

export interface SearchScores {
  structure: number;
  intent: number;
  text: number;
}

export interface SearchReason {
  kind: SearchScoreKind;
  text: string;
}

export interface SearchTextSlot {
  slot_id: string;
  role: string;
  required: boolean;
}

export interface SearchRelation {
  source_slot: string;
  relation: string;
  target_slot: string;
}

export interface SearchDocument {
  case_id: string;
  title: string;
  category_id: string;
  category_name: string;
  layout: string;
  subject_count: number;
  input_mode: string;
  ratio: string;
  intents: string[];
  text_slots: SearchTextSlot[];
  relations: SearchRelation[];
  text_tokens: string[];
  title_tokens: string[];
}

export interface SearchSynonym {
  intent_id: string;
  label: string;
  synonyms: string[];
  related_intent_ids: string[];
}

export interface SearchIndex {
  index_version: "structure-first-static-v1";
  generator_version: "t09-search-v1";
  source_sha256: Record<string, string>;
  ranking: {
    priority: ["structure", "intent", "text"];
    method: "lexicographic";
    long_prompt_included: false;
    runtime_services: false;
    vector_model: false;
  };
  synonyms: SearchSynonym[];
  documents: Record<string, SearchDocument>;
  inverted: {
    structure: Record<string, string[]>;
    intent: Record<string, string[]>;
    text: Record<string, string[]>;
  };
}

export interface SearchResult {
  case_id: string;
  title: string;
  category_id: string;
  category_name: string;
  layout: string;
  intents: string[];
  scores: SearchScores;
  reasons: SearchReason[];
  matched_intent_ids: string[];
  matched_structure: string[];
}

export interface ParsedSearchQuery {
  direct_intent_ids: string[];
  related_intent_ids: string[];
  text_tokens: string[];
  structure_requirements: Array<{
    kind: string;
    values: string[];
    source_intent_id: string;
  }>;
}

export interface SearchOptions {
  limit?: number;
}

export interface SearchBuildInput {
  cases: Array<Record<string, unknown>>;
  classifications: Array<Record<string, unknown>>;
  fingerprints: Array<Record<string, unknown>>;
  intents: Array<Record<string, unknown>>;
  synonyms: SearchSynonym[];
  taxonomy: Record<string, unknown>;
  sourceSha256?: Record<string, string>;
}
