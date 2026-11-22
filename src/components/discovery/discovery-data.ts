import { loadContent, loadTaxonomy } from "../../lib/content/index.js";
import type { Asset, Category, Guide } from "../../lib/content/types.js";
import { searchStaticIndex, staticSearchIndex } from "../../lib/search/index.js";
import type { SearchDocument } from "../../lib/search/types.js";
import type {
  CategoryIntentLink,
  DiscoveryCard,
  DiscoveryData,
  DiscoveryFilterOption,
  DiscoveryFilterOptions,
  DiscoveryImage
} from "./discovery-types.js";
import { PENGUIN_QUERY } from "./discovery-types.js";

const layoutLabels: Record<string, string> = {
  "multi-view-grid": "多视图网格",
  "exploded-view": "爆炸拆解布局",
  "modular-infographic": "模块化信息图",
  "analysis-sheet": "分析板布局",
  "storyboard-sheet": "分镜板布局",
  "comic-grid": "漫画多格布局",
  timeline: "时间线布局",
  "network-map": "关系网络布局",
  "poster-hierarchy": "海报层级布局",
  "poster-series": "海报系列布局",
  "ui-page": "界面页面布局",
  "ui-system": "界面系统布局",
  "single-subject": "单主体布局",
  "spatial-scene": "空间场景布局",
  "modular-grid": "模块网格布局",
  "card-collection": "卡片合集布局",
  "icon-canvas": "图标画布布局",
  "packaging-label": "包装标签布局",
  "split-screen": "分屏对照布局"
};

const inputLabels: Record<string, string> = {
  text_only: "纯文字输入",
  text_and_image: "文字 + 参考图",
  image_only: "参考图输入"
};

const slotLabels: Record<string, string> = {
  dimensions: "尺寸",
  materials: "材料",
  instructions: "步骤",
  data: "数值",
  ui_controls: "操作控件",
  brand: "品牌",
  title: "标题",
  subtitle: "副标题",
  labels: "部件标签",
  annotations: "注解",
  body: "正文",
  temporal: "时间"
};

const categoryIntentIds: Record<string, string[]> = {
  "subject-form": ["product_design", "character_design", "subject_appearance"],
  "scene-narrative": ["scene_composition", "reference_transformation", "storyboard"],
  "graphic-communication": ["typography", "brand_identity", "poster_design"],
  "information-diagram": ["structure_sheet", "dimension_annotation", "material_notes"],
  "interface-document": ["interface_design", "document_layout", "text_rendering"]
};

let dataPromise: Promise<DiscoveryData> | undefined;

function compareCaseIds(left: string, right: string): number {
  return left.localeCompare(right, "en", { numeric: true });
}

function labelFor(labels: Record<string, string>, value: string): string {
  return labels[value] ?? value.replaceAll("-", " ");
}

function buildImage(caseId: string, title: string, assets: Asset[]): DiscoveryImage {
  const variants = assets.filter((asset) => (
    asset.kind === "derived_case_image"
    && asset.source_asset_id === `asset-${caseId}`
    && asset.format === "webp"
  ));
  const byWidth = new Map(variants.map((asset) => [asset.width, asset]));
  const requiredWidths = [360, 640, 960] as const;
  for (const width of requiredWidths) {
    if (!byWidth.has(width)) throw new Error(`${caseId} 缺少 ${width}w WebP 卡片图片`);
  }
  const fallback = byWidth.get(640)!;
  return {
    src: fallback.uri,
    srcSet: requiredWidths.map((width) => `${byWidth.get(width)!.uri} ${width}w`).join(", "),
    sizes: "(max-width: 63.99rem) 100vw, (max-width: 79.99rem) 46vw, 35rem",
    width: fallback.width,
    height: fallback.height,
    alt: `${title}原案例配图`
  };
}

function structuralReason(document: SearchDocument): string {
  const slots = [...new Set(document.text_slots.map((slot) => labelFor(slotLabels, slot.slot_id)))];
  const detail = slots.length > 0
    ? `含${slots.slice(0, 4).join("、")}独立槽位`
    : `记录 ${document.subject_count} 个主体`;
  return `${labelFor(layoutLabels, document.layout)}；${detail}`;
}

function buildCard(
  document: SearchDocument,
  guide: Guide | undefined,
  assets: Asset[]
): DiscoveryCard {
  if (!guide) throw new Error(`${document.case_id} 缺少案例指南`);
  const challenge = guide.common_challenges.find((item) => item.trim().length > 0);
  if (!challenge || !guide.transferable_rule.trim()) {
    throw new Error(`${document.case_id} 的共性难点或迁移写法为空`);
  }
  return {
    caseId: document.case_id,
    title: document.title,
    categoryId: document.category_id,
    categoryName: document.category_name,
    href: `/cases/${document.case_id}/`,
    layout: document.layout,
    layoutLabel: labelFor(layoutLabels, document.layout),
    inputMode: document.input_mode,
    intents: document.intents,
    textSlots: [...new Set(document.text_slots.map((slot) => slot.slot_id))],
    reasons: [{ kind: "structure", text: structuralReason(document) }],
    reasonHeading: "结构特征",
    challenge,
    transferableRule: guide.transferable_rule,
    image: buildImage(document.case_id, document.title, assets)
  };
}

async function buildDiscoveryData(): Promise<DiscoveryData> {
  const [taxonomy, guides, assets] = await Promise.all([
    loadTaxonomy(),
    loadContent("guides"),
    loadContent("assets")
  ]);
  const guidesByCase = new Map(guides.map((guide) => [guide.case_id, guide]));
  const documents = Object.values(staticSearchIndex.documents).sort((left, right) => (
    compareCaseIds(left.case_id, right.case_id)
  ));
  const cards = Object.fromEntries(documents.map((document) => [
    document.case_id,
    buildCard(document, guidesByCase.get(document.case_id), assets)
  ])) as Record<string, DiscoveryCard>;
  const categoryCounts = Object.fromEntries(taxonomy.categories.map((category) => [category.category_id, 0]));
  for (const document of documents) categoryCounts[document.category_id] += 1;
  const penguinCards = searchStaticIndex(PENGUIN_QUERY, { limit: 5 }).map((result) => {
    const card = cards[result.case_id];
    if (!card) throw new Error(`企鹅题结果 ${result.case_id} 缺少卡片数据`);
    return { ...card, reasons: result.reasons, reasonHeading: "为什么命中" as const };
  });
  return { categories: taxonomy.categories, categoryCounts, cards, penguinCards };
}

export function getDiscoveryData(): Promise<DiscoveryData> {
  dataPromise ??= buildDiscoveryData();
  return dataPromise;
}

function sortedOptions(values: Set<string>, labels: Record<string, string>): DiscoveryFilterOption[] {
  return [...values]
    .map((value) => ({ value, label: labelFor(labels, value) }))
    .sort((left, right) => left.label.localeCompare(right.label, "zh-CN"));
}

export function getFilterOptions(cards: DiscoveryCard[]): DiscoveryFilterOptions {
  const intentLabels = Object.fromEntries(staticSearchIndex.synonyms.map((synonym) => [synonym.intent_id, synonym.label]));
  return {
    intents: sortedOptions(new Set(cards.flatMap((card) => card.intents)), intentLabels),
    layouts: sortedOptions(new Set(cards.map((card) => card.layout)), layoutLabels),
    inputs: sortedOptions(new Set(cards.map((card) => card.inputMode)), inputLabels),
    slots: sortedOptions(new Set(cards.flatMap((card) => card.textSlots)), slotLabels)
  };
}

export function getCategoryIntentLinks(category: Category): CategoryIntentLink[] {
  const ids = categoryIntentIds[category.category_id] ?? [];
  return ids.map((intentId, index) => {
    const synonym = staticSearchIndex.synonyms.find((item) => item.intent_id === intentId);
    if (!synonym) throw new Error(`${category.category_id} 引用了未知意图 ${intentId}`);
    return {
      label: category.intent_examples[index] ?? `我想做${synonym.label}`,
      intentId
    };
  });
}
