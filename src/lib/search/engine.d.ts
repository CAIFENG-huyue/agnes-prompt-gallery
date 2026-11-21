import type {
  ParsedSearchQuery,
  SearchBuildInput,
  SearchIndex,
  SearchOptions,
  SearchResult
} from "./types.js";

export declare function buildSearchIndex(input: SearchBuildInput): SearchIndex;
export declare function assertValidSearchIndex(index: SearchIndex): void;
export declare function parseSearchQuery(index: SearchIndex, query: string): ParsedSearchQuery;
export declare function compareSearchResults(
  left: Pick<SearchResult, "case_id" | "scores">,
  right: Pick<SearchResult, "case_id" | "scores">
): number;
export declare function searchIndex(
  index: SearchIndex,
  query: string,
  options?: SearchOptions
): SearchResult[];
