import rawSearchIndex from "../../../generated/search-index.json";
import { searchIndex } from "./engine.js";
import type { SearchIndex, SearchOptions, SearchResult } from "./types.js";

export const staticSearchIndex = rawSearchIndex as unknown as SearchIndex;

export function searchStaticIndex(query: string, options?: SearchOptions): SearchResult[] {
  return searchIndex(staticSearchIndex, query, options);
}

export {
  assertValidSearchIndex,
  buildSearchIndex,
  compareSearchResults,
  parseSearchQuery,
  searchIndex
} from "./engine.js";
export type {
  ParsedSearchQuery,
  SearchBuildInput,
  SearchDocument,
  SearchIndex,
  SearchOptions,
  SearchReason,
  SearchResult,
  SearchScores,
  SearchSynonym
} from "./types.js";
