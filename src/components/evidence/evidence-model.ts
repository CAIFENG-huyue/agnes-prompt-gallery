import { loadContent, readContentJson } from "../../lib/content/index.js";
import type {
  Asset,
  Case,
  ConclusionVersion,
  EvidenceLevel,
  ExperimentVersion,
  PromptVersion,
  Run,
  ScoreRevision
} from "../../lib/content/index.js";

export interface MethodRecord {
  method_id: string;
  title: string;
  applicable_when: string[];
  unsuitable_for: string[];
  transferable_rule: string;
  decision: string;
  conclusion_version_ids: string[];
  evidence: Array<Record<string, unknown>>;
}

export interface ArmReport {
  n_images?: number;
  text_hits?: number;
  text_total?: number;
  passes?: number;
  pass_rate?: number;
  rate?: number;
  wilson95?: [number, number];
  exact_slots_hits?: number;
  exact_slots_total?: number;
  exact_slots_rate_text?: string;
  per_image_exact?: [number, number];
}

export interface PerCaseReport {
  case_id: string;
  prose: { hits: number; total: number; rate: number };
  structured: { hits: number; total: number; rate: number };
  diff_pp: number;
}

export interface ExperimentDesignShape extends Record<string, unknown> {
  reps_per_arm?: number;
  n_images?: number;
  blinding?: string;
  scoring_notes?: string;
  blinded?: boolean;
  feasibility_pilot?: boolean;
  powered_test?: boolean;
  single_case?: string;
  blind_id_policy?: string;
  reported?: {
    arms?: Record<string, ArmReport>;
    per_case?: PerCaseReport[];
    hard_gate?: { arms: Record<string, ArmReport> };
  };
}

export interface EvidenceData {
  conclusions: ConclusionVersion[];
  experiments: ExperimentVersion[];
  runs: Run[];
  scores: ScoreRevision[];
  assets: Asset[];
  promptVersions: PromptVersion[];
  cases: Case[];
  methods: MethodRecord[];
  conclusionById: Map<string, ConclusionVersion>;
  experimentById: Map<string, ExperimentVersion>;
  runById: Map<string, Run>;
  promptById: Map<string, PromptVersion>;
  caseById: Map<string, Case>;
  scoresByRun: Map<string, ScoreRevision[]>;
  assetsBySource: Map<string, Asset[]>;
}

export interface ConclusionPresentation {
  title: string;
  shortTitle: string;
  direction: string;
  description: string;
  level: EvidenceLevel;
}

export interface EvidenceEntryPoint {
  run: Run;
  score?: ScoreRevision;
  imageId?: string;
}

export function conclusionPath(id: string): string {
  return `/experiments/${id.split("/").map(encodeURIComponent).join("/")}/`;
}

export function imageAnchor(sourceAssetId: string): string {
  return `image-${sourceAssetId}`;
}

export function versionAnchor(kind: string, id: string): string {
  return `${kind}-${id.replaceAll("/", "-")}`;
}

export function designOf(experiment: ExperimentVersion): ExperimentDesignShape {
  return experiment.design as ExperimentDesignShape;
}

export function presentationFor(conclusion: ConclusionVersion): ConclusionPresentation {
  const presentations: Record<string, ConclusionPresentation> = {
    "text_fulfillment_effect_structured_minus_prose": {
      title: "H1 · 图内文字逐字达成",
      shortTitle: "逐字文字达成",
      direction: "structured − prose",
      description: "只改变提示词组织形式的主指标比较；负值表示 structured 低于 prose。",
      level: "tested"
    },
    "hard_gate_pass_effect_structured_minus_prose": {
      title: "H1 · 硬门通过率",
      shortTitle: "硬门通过率",
      direction: "structured − prose",
      description: "层级受控的关键次要指标；主指标未通过，不作正式显著性声明。",
      level: "tested"
    },
    "exact_text_slot_fulfillment_overlay_minus_in_image": {
      title: "H2-226 · 空白带确定性叠字",
      shortTitle: "确定性叠字",
      direction: "overlay − in-image",
      description: "单案例、未施盲的可行性观察；确定性文字是操纵检查，不是普遍优胜证据。",
      level: "observed"
    }
  };
  return presentations[conclusion.metric] ?? {
    title: conclusion.conclusion_id,
    shortTitle: conclusion.conclusion_id,
    direction: conclusion.metric.replaceAll("_", " "),
    description: "该页面只呈现此结论版本及其明确引用的实验 Run。",
    level: "observed"
  };
}

export async function loadMethods(): Promise<MethodRecord[]> {
  return readContentJson<MethodRecord[]>("content", "methods.json");
}

export async function loadEvidenceData(): Promise<EvidenceData> {
  const [conclusions, experiments, runs, scores, assets, promptVersions, cases, methods] = await Promise.all([
    loadContent("conclusions"),
    loadContent("experimentVersions"),
    loadContent("runs"),
    loadContent("scoreRevisions"),
    loadContent("assets"),
    loadContent("experimentPromptVersions"),
    loadContent("cases"),
    loadMethods()
  ]);
  const scoresByRun = new Map<string, ScoreRevision[]>();
  for (const score of scores) {
    const revisions = scoresByRun.get(score.run_id) ?? [];
    revisions.push(score);
    scoresByRun.set(score.run_id, revisions);
  }
  for (const revisions of scoresByRun.values()) revisions.sort((a, b) => a.revision - b.revision);
  const assetsBySource = new Map<string, Asset[]>();
  for (const asset of assets) {
    if (!asset.source_asset_id) continue;
    const variants = assetsBySource.get(asset.source_asset_id) ?? [];
    variants.push(asset);
    assetsBySource.set(asset.source_asset_id, variants);
  }
  for (const variants of assetsBySource.values()) variants.sort((a, b) => a.width - b.width);
  return {
    conclusions,
    experiments,
    runs,
    scores,
    assets,
    promptVersions,
    cases,
    methods,
    conclusionById: new Map(conclusions.map((item) => [item.conclusion_version_id, item])),
    experimentById: new Map(experiments.map((item) => [item.experiment_version_id, item])),
    runById: new Map(runs.map((item) => [item.run_id, item])),
    promptById: new Map(promptVersions.map((item) => [item.prompt_version_id, item])),
    caseById: new Map(cases.map((item) => [item.case_id, item])),
    scoresByRun,
    assetsBySource
  };
}

export function comparisonArmId(conclusion: ConclusionVersion, run: Run): string {
  if (conclusion.conclusion_id === "h2-226-overlay-exact-text") {
    return run.experiment_version_id === "h2-226/ev-001" ? "overlay" : "in-image";
  }
  return run.arm_id;
}

export function runsForConclusion(conclusion: ConclusionVersion, data: EvidenceData): Run[] {
  const armOrder = new Map(["prose", "in-image", "structured", "overlay"].map((id, index) => [id, index]));
  return conclusion.evidence_run_ids.map((id) => {
    const run = data.runById.get(id);
    if (!run) throw new Error(`结论 ${conclusion.conclusion_version_id} 引用了不存在的 Run：${id}`);
    return run;
  }).sort((a, b) => {
    const caseOrder = a.case_id.localeCompare(b.case_id, "en", { numeric: true });
    if (caseOrder) return caseOrder;
    const aArm = armOrder.get(comparisonArmId(conclusion, a)) ?? 99;
    const bArm = armOrder.get(comparisonArmId(conclusion, b)) ?? 99;
    return aArm - bArm || a.rep - b.rep || a.run_id.localeCompare(b.run_id);
  });
}

export function groupRunsByCase(conclusion: ConclusionVersion, data: EvidenceData): Array<[string, Run[]]> {
  const groups = new Map<string, Run[]>();
  for (const run of runsForConclusion(conclusion, data)) {
    const group = groups.get(run.case_id) ?? [];
    group.push(run);
    groups.set(run.case_id, group);
  }
  return [...groups.entries()];
}

export function evidenceEntryPoint(conclusion: ConclusionVersion, data: EvidenceData): EvidenceEntryPoint | undefined {
  const run = runsForConclusion(conclusion, data)[0];
  if (!run) return undefined;
  return {
    run,
    score: data.scoresByRun.get(run.run_id)?.find((item) => item.is_current) ?? data.scoresByRun.get(run.run_id)?.[0],
    imageId: run.result_asset_ids[0]
  };
}

export function promptVersionsForConclusion(conclusion: ConclusionVersion, data: EvidenceData): PromptVersion[] {
  const ids = [...new Set(runsForConclusion(conclusion, data).map((run) => run.prompt_version_id))];
  return ids.map((id) => {
    const prompt = data.promptById.get(id);
    if (!prompt) throw new Error(`Run 引用了不存在的 PromptVersion：${id}`);
    return prompt;
  }).sort((a, b) => a.prompt_version_id.localeCompare(b.prompt_version_id, "en", { numeric: true }));
}

export function experimentsForConclusion(conclusion: ConclusionVersion, data: EvidenceData): ExperimentVersion[] {
  return conclusion.source_experiment_version_ids.map((id) => {
    const experiment = data.experimentById.get(id);
    if (!experiment) throw new Error(`结论引用了不存在的 ExperimentVersion：${id}`);
    return experiment;
  });
}

export function reportForConclusion(conclusion: ConclusionVersion, experiments: ExperimentVersion[]) {
  const experiment = experiments.at(-1);
  const reported = experiment ? designOf(experiment).reported : undefined;
  if (conclusion.metric === "hard_gate_pass_effect_structured_minus_prose") {
    return { arms: reported?.hard_gate?.arms ?? {}, mode: "hard-gate" as const };
  }
  if (conclusion.conclusion_id === "h2-226-overlay-exact-text") {
    return { arms: reported?.arms ?? {}, mode: "exact-slots" as const };
  }
  return { arms: reported?.arms ?? {}, mode: "text" as const };
}

export function perCaseForConclusion(conclusion: ConclusionVersion, experiments: ExperimentVersion[]): PerCaseReport[] {
  if (conclusion.metric !== "text_fulfillment_effect_structured_minus_prose") return [];
  return experiments[0] ? designOf(experiments[0]).reported?.per_case ?? [] : [];
}

export function formatSigned(value: number): string {
  const formatted = Math.abs(value).toFixed(2);
  return value > 0 ? `+${formatted}` : value < 0 ? `−${formatted}` : "0.00";
}

export function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}
