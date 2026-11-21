import { loadContent } from "../../lib/content/loaders.js";
import type {
  Asset,
  Case,
  Category,
  Classification,
  Decision,
  EvidenceLevel,
  Fingerprint,
  Guide,
  PromptVersion,
  Run,
  ScoreRevision
} from "../../lib/content/types.js";

export interface ResponsiveImage {
  sourceAssetId: string;
  assets: Asset[];
  src: string;
  srcSet: string;
  width: number;
  height: number;
}

export interface RunView {
  run: Run;
  score: ScoreRevision | null;
  images: ResponsiveImage[];
}

export interface DecisionView {
  decision: Decision;
  anchor: string;
  runs: RunView[];
}

export interface FingerprintItem {
  key: string;
  label: string;
  value: string;
  detail: string;
}

export interface CasePageModel {
  caseData: Case;
  category: Category;
  classification: Classification;
  fingerprint: Fingerprint;
  fingerprintItems: FingerprintItem[];
  guide: Guide;
  decisions: DecisionView[];
  prompts: PromptVersion[];
  cover: ResponsiveImage;
  evidenceLevels: EvidenceLevel[];
}

const layoutLabels: Record<string, string> = {
  "analysis-sheet": "分析说明板",
  "card-collection": "卡片集合",
  "data-card": "数据设定卡",
  "exploded-view": "分解爆炸图",
  "freeform-collage": "自由拼贴",
  "icon-canvas": "图标画布",
  "modular-grid": "模块网格",
  "modular-infographic": "模块信息图",
  "multi-view-grid": "多视图网格",
  "network-map": "关系网络图",
  "packaging-label": "包装与标签",
  "poster-hierarchy": "海报传播层级",
  "poster-series": "系列海报",
  "single-subject": "单主体构图",
  "spatial-scene": "空间叙事场景",
  "split-screen": "分屏对照",
  "storyboard-sheet": "多格分镜",
  timeline: "时间线",
  "ui-page": "单页界面",
  "ui-system": "界面系统"
};

const roleLabels: Record<string, string> = {
  annotation: "标注",
  badge: "徽章",
  brand: "品牌",
  caption: "图注",
  data_value: "数据值",
  description: "正文说明",
  dimension_annotation: "尺寸标注",
  instruction: "步骤说明",
  label: "标签",
  material_notes: "材料说明",
  price: "价格",
  subtitle: "副标题",
  temporal_label: "时间标签",
  title: "标题",
  ui_control: "界面控件"
};

function required<T>(value: T | undefined, message: string): T {
  if (value === undefined) {
    throw new Error(message);
  }
  return value;
}

function groupBy<T>(items: T[], getKey: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = getKey(item);
    const group = groups.get(key);
    if (group) {
      group.push(item);
    } else {
      groups.set(key, [item]);
    }
  }
  return groups;
}

export function anchorId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "-");
}

function responsiveImage(sourceAssetId: string, assets: Asset[] | undefined): ResponsiveImage {
  const candidates = required(assets, `缺少派生图片：${sourceAssetId}`)
    .filter((asset) => [360, 640, 960].includes(asset.width))
    .sort((a, b) => a.width - b.width);
  const widths = new Set(candidates.map((asset) => asset.width));
  for (const width of [360, 640, 960]) {
    if (!widths.has(width)) {
      throw new Error(`派生图片缺少 ${width}w：${sourceAssetId}`);
    }
  }
  const medium = required(candidates.find((asset) => asset.width === 640), `缺少 640w：${sourceAssetId}`);
  return {
    sourceAssetId,
    assets: candidates,
    src: medium.uri,
    srcSet: candidates.map((asset) => `${asset.uri} ${asset.width}w`).join(", "),
    width: medium.width,
    height: medium.height
  };
}

function fingerprintItems(fingerprint: Fingerprint): FingerprintItem[] {
  const requiredSlots = fingerprint.text_slots.filter((slot) => slot.required);
  const roles = requiredSlots.map((slot) => roleLabels[slot.role] ?? slot.role);
  const roleSummary = roles.length > 0
    ? `${roles.slice(0, 3).join("、")}${roles.length > 3 ? ` 等 ${roles.length} 类` : ""}`
    : "没有必填文字槽，重点核对画面结构";
  return [
    {
      key: "layout",
      label: "版式与画幅",
      value: layoutLabels[fingerprint.layout] ?? fingerprint.layout,
      detail: `画幅 ${fingerprint.ratio}`
    },
    {
      key: "text-slots",
      label: "文字槽位",
      value: requiredSlots.length > 0 ? `${requiredSlots.length} 个必填` : "无必填文字槽",
      detail: roleSummary
    },
    {
      key: "input-mode",
      label: "输入与关系",
      value: fingerprint.input_mode === "text_and_image" ? "文字＋参考图" : "仅文字输入",
      detail: `${fingerprint.subject_count} 个明确主体 · ${fingerprint.relations.length} 条结构关系`
    }
  ];
}

export async function getCasePageModels(): Promise<CasePageModel[]> {
  const [
    taxonomy,
    cases,
    classifications,
    fingerprints,
    guides,
    decisions,
    casePromptVersions,
    experimentPromptVersions,
    runs,
    scoreRevisions,
    assets
  ] = await Promise.all([
    loadContent("taxonomy"),
    loadContent("cases"),
    loadContent("classifications"),
    loadContent("fingerprints"),
    loadContent("guides"),
    loadContent("decisions"),
    loadContent("casePromptVersions"),
    loadContent("experimentPromptVersions"),
    loadContent("runs"),
    loadContent("scoreRevisions"),
    loadContent("assets")
  ]);

  const categories = new Map(taxonomy.categories.map((category) => [category.category_id, category]));
  const classificationsByCase = new Map(classifications.map((item) => [item.case_id, item]));
  const fingerprintsByCase = new Map(fingerprints.map((item) => [item.case_id, item]));
  const guidesByCase = new Map(guides.map((item) => [item.case_id, item]));
  const decisionsByCase = groupBy(decisions, (item) => item.case_id);
  const runsById = new Map(runs.map((run) => [run.run_id, run]));
  const currentScoresByRun = new Map(
    scoreRevisions.filter((score) => score.is_current).map((score) => [score.run_id, score])
  );
  const assetsBySource = groupBy(
    assets.filter((asset) => asset.source_asset_id !== undefined),
    (asset) => asset.source_asset_id as string
  );
  const prompts = [...casePromptVersions, ...experimentPromptVersions];
  const promptIds = new Set(prompts.map((prompt) => prompt.prompt_version_id));
  const promptsByCase = groupBy(prompts, (prompt) => prompt.case_id);
  const evidenceOrder: EvidenceLevel[] = ["inferred", "tested", "observed"];

  return cases.map((caseData) => {
    const caseId = caseData.case_id;
    const classification = required(classificationsByCase.get(caseId), `缺少分类：${caseId}`);
    const fingerprint = required(fingerprintsByCase.get(caseId), `缺少指纹：${caseId}`);
    const guide = required(guidesByCase.get(caseId), `缺少指南：${caseId}`);
    const category = required(categories.get(classification.primary_category_id), `缺少分类定义：${caseId}`);
    const caseDecisions = required(decisionsByCase.get(caseId), `缺少决策卡：${caseId}`);
    const casePrompts = required(promptsByCase.get(caseId), `缺少提示词：${caseId}`)
      .slice()
      .sort((a, b) => a.version_no - b.version_no);

    const decisionViews = caseDecisions.map((decision) => {
      if (!promptIds.has(decision.prompt_version_id)) {
        throw new Error(`决策卡缺少提示词版本：${decision.decision_id}`);
      }
      const decisionRuns = decision.evidence_refs
        .filter((ref) => ref.entity_type === "run")
        .map((ref) => required(runsById.get(ref.entity_id), `决策卡引用了不存在的 Run：${ref.entity_id}`))
        .map((run): RunView => ({
          run,
          score: currentScoresByRun.get(run.run_id) ?? null,
          images: run.result_asset_ids.map((assetId) => responsiveImage(assetId, assetsBySource.get(assetId)))
        }));
      return { decision, anchor: anchorId(decision.decision_id), runs: decisionRuns };
    });
    const levels = new Set(decisionViews.map((item) => item.decision.evidence_level));

    return {
      caseData,
      category,
      classification,
      fingerprint,
      fingerprintItems: fingerprintItems(fingerprint),
      guide,
      decisions: decisionViews,
      prompts: casePrompts,
      cover: responsiveImage(caseData.cover_asset_id, assetsBySource.get(caseData.cover_asset_id)),
      evidenceLevels: evidenceOrder.filter((level) => levels.has(level))
    };
  });
}
