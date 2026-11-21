export type EvidenceLevel = "tested" | "observed" | "inferred";
export type EditorialStatus = "imported" | "enriched" | "reviewed" | "published";
export type ReviewStatus = "unreviewed" | "reviewed" | "gold_arbitrated";
export type ExperimentStatus = "draft" | "active" | "frozen" | "superseded";
export type EvidenceEntityType =
  | "case"
  | "asset"
  | "prompt_version"
  | "experiment_version"
  | "run"
  | "score_revision";

export interface Category {
  category_id: string;
  name: string;
  plain_explanation: string;
  definition: string;
  when_to_use: string;
  decision_order: number;
  acceptance_focus: string;
  intent_examples: string[];
}

export interface Taxonomy {
  schema_version: "1.0.0";
  taxonomy_id: string;
  version_no: number;
  categories: Category[];
  conflict_resolution: string[];
}

export interface CaseSource {
  repository: string;
  source_label: string;
  source_url: string;
  github_url: string;
  original_category: string;
  styles: string[];
  scenes: string[];
}

export interface Case {
  case_id: string;
  title: string;
  image_alt?: string;
  cover_asset_id: string;
  featured?: boolean;
  editorial_status: EditorialStatus;
  source: CaseSource;
}

export interface Classification {
  case_id: string;
  primary_category_id: string;
  confidence: number;
  rationale: string;
  evidence_excerpt: string;
  classifier_version: string;
  review_status: ReviewStatus;
}

export interface FingerprintRelation {
  source_slot: string;
  relation: string;
  target_slot: string;
}

export interface FingerprintTextSlot {
  slot_id: string;
  role: string;
  required: boolean;
  content?: string;
}

export interface Fingerprint {
  case_id: string;
  subject_count: number;
  layout: string;
  relations: FingerprintRelation[];
  text_slots: FingerprintTextSlot[];
  input_mode: string;
  ratio: string;
  confidence: number;
  evidence_excerpt: string;
  fingerprint_version: string;
}

export interface Guide {
  guide_id: string;
  case_id: string;
  suitable_for: string[];
  unsuitable_for: string[];
  common_challenges: string[];
  transferable_rule: string;
  guide_version: string;
}

export interface Asset {
  asset_id: string;
  uri: string;
  kind: string;
  sha256: string;
  width: number;
  height: number;
  source_url: string;
  source_asset_id?: string;
  format?: "webp" | "jpeg" | "png";
}

export interface PromptText {
  text: string;
  where: string;
  style: string;
}

export interface PromptCount {
  item: string;
  rows: number | null;
  cols: number | null;
  labels: string[];
}

export interface PromptSpec {
  ratio: string | null;
  refs: string[];
  ref_contract: string | null;
  canvas: string | null;
  subject: string | null;
  elements: string[];
  texts: PromptText[];
  counts: PromptCount[];
  layout: string | null;
  style: string | null;
  negatives: string[];
}

export interface PromptVersion {
  prompt_version_id: string;
  case_id: string;
  version_no: number;
  parent_version_id: string | null;
  text: string;
  content_sha256: string;
  change_note: string;
  spec: PromptSpec;
}

export interface ExperimentArm {
  arm_id: string;
  label: string;
  prompt_version_ids: string[];
}

export interface ExperimentVersion {
  experiment_version_id: string;
  experiment_id: string;
  version_no: number;
  hypothesis: string;
  design: Record<string, unknown>;
  arms: ExperimentArm[];
  model: string;
  primary_metric: string;
  secondary_metrics: string[];
  rubric_version: string;
  status: ExperimentStatus;
}

export interface Run {
  run_id: string;
  experiment_version_id: string;
  arm_id: string;
  case_id: string;
  prompt_version_id: string;
  rep: number;
  blind_id: string;
  result_asset_ids: string[];
  seed?: number;
  created_at?: string;
}

export interface ScoreRevision {
  score_id: string;
  run_id: string;
  revision: number;
  supersedes_id: string | null;
  g1: number;
  g2: number;
  g3: number;
  g4: number;
  text_hits: number;
  text_total: number;
  elements_hits: number;
  elements_total: number;
  count_error: number;
  notes: string;
  scorer: string;
  scored_at: string;
  is_current: boolean;
  evidence_asset_ids: string[];
}

export interface EvidenceRef {
  entity_type: EvidenceEntityType;
  entity_id: string;
}

export interface Decision {
  decision_id: string;
  case_id: string;
  prompt_version_id: string;
  decision: string;
  control_target: string;
  before_excerpt: string;
  after_excerpt: string;
  expected_effect: string;
  observed_effect: string | null;
  evidence_level: EvidenceLevel;
  evidence_refs: EvidenceRef[];
}

export interface ConclusionVersion {
  conclusion_version_id: string;
  conclusion_id: string;
  version_no: number;
  source_experiment_version_ids: string[];
  score_snapshot_hash: string;
  metric: string;
  estimate: number;
  unit: string;
  ci_low: number;
  ci_high: number;
  ci_method: string;
  ci_level: number;
  p_value?: number;
  p_method?: string;
  n_cases: number;
  n_images: number;
  limitations: string[];
  generator_version: string;
  evidence_run_ids: string[];
}

export interface ContentTypeMap {
  taxonomy: Taxonomy;
  cases: Case[];
  classifications: Classification[];
  fingerprints: Fingerprint[];
  guides: Guide[];
  decisions: Decision[];
  casePromptVersions: PromptVersion[];
  experimentPromptVersions: PromptVersion[];
  experimentVersions: ExperimentVersion[];
  runs: Run[];
  scoreRevisions: ScoreRevision[];
  assets: Asset[];
  conclusions: ConclusionVersion[];
}
