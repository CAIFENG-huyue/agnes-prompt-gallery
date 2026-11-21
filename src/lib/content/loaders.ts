import type { ContentRoot } from "./read-json.js";
import { readContentJson, readOptionalContentJson } from "./read-json.js";
import type { ContentTypeMap } from "./types.js";

export const contentFiles = {
  taxonomy: { root: "content", file: "taxonomy.json" },
  cases: { root: "content", file: "cases.json" },
  classifications: { root: "content", file: "classifications.json" },
  fingerprints: { root: "content", file: "fingerprints.json" },
  guides: { root: "content", file: "case-guides.json" },
  decisions: { root: "content", file: "decisions.json" },
  casePromptVersions: { root: "content", file: "prompt-versions/cases.json" },
  experimentPromptVersions: { root: "content", file: "prompt-versions/experiments.json" },
  experimentVersions: { root: "content", file: "experiment-versions.json" },
  runs: { root: "content", file: "runs.json" },
  scoreRevisions: { root: "content", file: "score-revisions.json" },
  assets: { root: "generated", file: "assets.json" },
  conclusions: { root: "generated", file: "conclusions.json" }
} as const satisfies Record<keyof ContentTypeMap, { root: ContentRoot; file: string }>;

export type ContentName = keyof typeof contentFiles;

export function loadContent<Name extends ContentName>(name: Name): Promise<ContentTypeMap[Name]> {
  const descriptor = contentFiles[name];
  return readContentJson<ContentTypeMap[Name]>(descriptor.root, descriptor.file);
}

export function loadOptionalContent<Name extends ContentName>(
  name: Name
): Promise<ContentTypeMap[Name] | null> {
  const descriptor = contentFiles[name];
  return readOptionalContentJson<ContentTypeMap[Name]>(descriptor.root, descriptor.file);
}

export function loadTaxonomy(): Promise<ContentTypeMap["taxonomy"]> {
  return loadContent("taxonomy");
}

export function loadCases(): Promise<ContentTypeMap["cases"]> {
  return loadContent("cases");
}
