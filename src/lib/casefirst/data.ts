import { readContentJson, readOptionalContentJson } from "../content/read-json.js";

export type Verdict = "PASS" | "PASS-WEAK" | "FAIL" | "REVIEW" | "BLOCKED" | "UNREVIEWED";
export type VerdictBucket = "pass" | "fail" | "review" | "unreviewed";

export interface VerdictRecord {
  case_id: string;
  verdict: string;
  gates: string[];
  note: string;
  source: string;
}

export interface PatternCategory {
  category: string;
  n: number;
  pass: number;
  fail: number;
  review: number;
  pass_rate: number;
}

export interface PatternGateExample {
  case_id: number;
  note: string;
  category: string;
}

export interface PatternGate {
  gate: string;
  n: number;
  examples: PatternGateExample[];
  categories: [string, number][];
}

export interface Patterns {
  totals: Record<string, number>;
  judged: number;
  categories: PatternCategory[];
  gates: PatternGate[];
}

interface CaseRecord {
  case_id: string;
  title: string;
  source: {
    repository: string;
    source_url: string;
    github_url: string;
    original_category: string;
  };
}

interface ClassificationRecord {
  case_id: string;
  primary_category_id: string;
}

interface TaxonomyCategory {
  category_id: string;
  name: string;
  plain_explanation: string;
}

interface Taxonomy {
  categories: TaxonomyCategory[];
}

interface PromptVersionRecord {
  case_id: string;
  version_no: number;
  text: string;
}

interface PromptTranslationRecord {
  case_id: string;
  zh: string;
}

interface ResultVariant {
  file: string;
  width: number;
  height: number;
}

interface ResultEntry {
  case_id: string;
  width: number;
  height: number;
  main: ResultVariant;
  variants: Record<string, ResultVariant>;
}

export interface CaseImage {
  src: string;
  srcSet: string;
  width: number;
  height: number;
  alt: string;
}

export interface CatalogCase {
  id: number;
  caseId: string;
  href: string;
  title: string;
  categoryId: string;
  categoryName: string;
  categoryExplanation: string;
  verdict: Verdict;
  bucket: VerdictBucket;
  gates: string[];
  topGates: string[];
  note: string;
  promptText: string;
  promptTextZh: string;
  image: CaseImage | null;
  sourceImage: CaseImage | null;
  sourceLink: string;
  repository: string;
  sourceLabel: string;
}

export interface Catalog {
  cases: CatalogCase[];
  byId: Map<string, CatalogCase>;
  categories: TaxonomyCategory[];
  categoryNames: Map<string, string>;
}

export const GATE_LABELS: Record<string, string> = {
  TEXT_WRONG: "文字错误",
  MISSING_ELEMENT: "缺少元素",
  COUNT_WRONG: "数量错误",
  ANATOMY: "结构解剖错误",
  STYLE_WEAK: "风格偏弱",
  UI_INCOMPLETE: "界面不完整",
  RELATION_WRONG: "关系错误",
  REF_MISMATCH: "参考不一致",
  CONTENT_BLOCKED: "内容拦截",
  CONTENT_POLICY: "内容合规",
  COMPOSITION: "构图问题"
};

export function gateLabel(gate: string): string {
  return GATE_LABELS[gate] ?? gate;
}

export function verdictBucket(verdict: string): VerdictBucket {
  if (verdict === "PASS" || verdict === "PASS-WEAK") return "pass";
  if (verdict === "FAIL") return "fail";
  if (verdict === "REVIEW" || verdict === "BLOCKED") return "review";
  return "unreviewed";
}

const verdictRank: Record<string, number> = {
  PASS: 0,
  "PASS-WEAK": 1,
  FAIL: 2,
  REVIEW: 3,
  BLOCKED: 4,
  UNREVIEWED: 5
};

function num(value: string): number {
  return Number(String(value).replace(/^case-/u, ""));
}

function resultSrcSet(variants: Record<string, ResultVariant>): string {
  return ["640", "960", "1200"]
    .map((key) => variants[key])
    .filter((variant): variant is ResultVariant => Boolean(variant))
    .map((variant) => `/results/${variant.file} ${variant.width}w`)
    .join(", ");
}

let catalogPromise: Promise<Catalog> | null = null;

async function buildCatalog(): Promise<Catalog> {
  const [cases, classifications, taxonomy, prompts, results, verdicts, promptZh] = await Promise.all([
    readContentJson<CaseRecord[]>("content", "cases.json"),
    readContentJson<ClassificationRecord[]>("content", "classifications.json"),
    readContentJson<Taxonomy>("content", "taxonomy.json"),
    readContentJson<PromptVersionRecord[]>("content", "prompt-versions/cases.json"),
    readContentJson<ResultEntry[]>("generated", "results.json"),
    readContentJson<VerdictRecord[]>("content", "verdicts.json"),
    readOptionalContentJson<PromptTranslationRecord[]>("content", "prompt-zh.json")
  ]);

  const categories = taxonomy.categories;
  const categoryNames = new Map(categories.map((item) => [item.category_id, item.name]));
  const categoryExplanations = new Map(categories.map((item) => [item.category_id, item.plain_explanation]));
  const classificationByCase = new Map(classifications.map((item) => [item.case_id, item.primary_category_id]));
  const resultByCase = new Map(results.map((item) => [item.case_id, item]));
  const verdictByCase = new Map(verdicts.map((item) => [item.case_id, item]));
  const promptZhByCase = new Map((promptZh ?? []).map((item) => [item.case_id, item.zh]));

  const latestPrompt = new Map<string, PromptVersionRecord>();
  for (const prompt of prompts) {
    const current = latestPrompt.get(prompt.case_id);
    if (!current || prompt.version_no > current.version_no) latestPrompt.set(prompt.case_id, prompt);
  }

  const catalogCases: CatalogCase[] = cases.map((item) => {
    const id = num(item.case_id);
    const result = resultByCase.get(item.case_id) ?? null;
    const verdict = verdictByCase.get(item.case_id);
    const finalVerdict = (verdict?.verdict ?? "UNREVIEWED") as Verdict;
    const categoryId = classificationByCase.get(item.case_id) ?? "";
    const main = result?.main;
    const image: CaseImage | null = main
      ? {
          src: `/results/${main.file}`,
          srcSet: resultSrcSet(result.variants),
          width: main.width,
          height: main.height,
          alt: `${item.title}：本站生成图`
        }
      : null;
    const sourceImage: CaseImage | null = result
      ? {
          src: `/assets/cases/case${id}-960.webp`,
          srcSet: `/assets/cases/case${id}-360.webp 360w, /assets/cases/case${id}-640.webp 640w, /assets/cases/case${id}-960.webp 960w`,
          width: 960,
          height: Math.max(1, Math.round((result.height * 960) / result.width)),
          alt: `${item.title}：开源项目原图`
        }
      : null;

    return {
      id,
      caseId: item.case_id,
      href: `/cases/${item.case_id}/`,
      title: item.title,
      categoryId,
      categoryName: categoryNames.get(categoryId) ?? categoryId,
      categoryExplanation: categoryExplanations.get(categoryId) ?? "",
      verdict: finalVerdict,
      bucket: verdictBucket(finalVerdict),
      gates: verdict?.gates ?? [],
      topGates: (verdict?.gates ?? []).slice(0, 2),
      note: verdict?.note ?? "",
      promptText: latestPrompt.get(item.case_id)?.text ?? "",
      promptTextZh: promptZhByCase.get(item.case_id) ?? "",
      image,
      sourceImage,
      sourceLink: item.source.github_url || item.source.source_url,
      repository: item.source.repository,
      sourceLabel: item.source.original_category
    };
  });

  catalogCases.sort((left, right) => {
    const missing = Number(!left.image) - Number(!right.image);
    if (missing !== 0) return missing;
    const rank = (verdictRank[left.verdict] ?? 9) - (verdictRank[right.verdict] ?? 9);
    return rank !== 0 ? rank : left.id - right.id;
  });

  return {
    cases: catalogCases,
    byId: new Map(catalogCases.map((item) => [item.caseId, item])),
    categories,
    categoryNames
  };
}

export function getCatalog(): Promise<Catalog> {
  if (!catalogPromise) catalogPromise = buildCatalog();
  return catalogPromise;
}

let patternsPromise: Promise<Patterns> | null = null;

export function getPatterns(): Promise<Patterns> {
  if (!patternsPromise) patternsPromise = readContentJson<Patterns>("content", "patterns.json");
  return patternsPromise;
}

export function verdictLabel(caseItem: CatalogCase): string {
  return caseItem.verdict === "UNREVIEWED" ? "未评审" : caseItem.verdict;
}

export function sameGateCases(catalog: Catalog, caseItem: CatalogCase, limit = 5): CatalogCase[] {
  const collected = new Map<string, CatalogCase>();
  const add = (item: CatalogCase | undefined): void => {
    if (!item || item.caseId === caseItem.caseId || collected.has(item.caseId)) return;
    if (!item.image) return;
    collected.set(item.caseId, item);
  };

  for (const gate of caseItem.gates) {
    for (const item of catalog.cases) {
      if (collected.size >= limit) break;
      if (item.gates.includes(gate)) add(item);
    }
  }
  for (const item of catalog.cases) {
    if (collected.size >= limit) break;
    if (item.categoryId === caseItem.categoryId) add(item);
  }
  return [...collected.values()].slice(0, limit);
}

export function findCategoryCase(catalog: Catalog, categoryId: string, bucket: VerdictBucket): CatalogCase | null {
  return catalog.cases.find((item) => item.categoryId === categoryId && item.bucket === bucket && item.image) ?? null;
}
