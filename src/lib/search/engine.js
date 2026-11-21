const INDEX_VERSION = "structure-first-static-v1";
const GENERATOR_VERSION = "t09-search-v1";
const SCORE_KINDS = ["structure", "intent", "text"];
const STOP_TOKENS = new Set([
  "about", "and", "case", "create", "design", "for", "from", "generate", "image", "make", "the", "with",
  "一张", "一个", "一套", "我想", "我要", "帮我", "制作", "生成", "设计", "案例", "图片", "图像", "信息", "可视", "风格"
]);
const LAYOUT_LABELS = {
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
const SLOT_LABELS = {
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
  body: "正文"
};
const INTENT_STRUCTURES = {
  structure_sheet: [
    { kind: "layout", values: ["multi-view-grid", "exploded-view", "modular-infographic", "analysis-sheet"] }
  ],
  multi_view: [{ kind: "layout", values: ["multi-view-grid"] }],
  technical_view: [{ kind: "layout", values: ["multi-view-grid"] }],
  exploded_view: [{ kind: "layout", values: ["exploded-view"] }],
  dimension_annotation: [{ kind: "slot", values: ["dimensions"] }],
  material_notes: [{ kind: "slot", values: ["materials"] }],
  component_labeling: [{ kind: "slot_any", values: ["labels", "annotations"] }],
  information_design: [{ kind: "category", values: ["information-diagram"] }],
  data_visualization: [{ kind: "slot", values: ["data"] }],
  timeline: [
    { kind: "layout", values: ["timeline"] },
    { kind: "slot", values: ["temporal"] }
  ],
  storyboard: [{ kind: "layout", values: ["storyboard-sheet", "comic-grid"] }],
  sequence_steps: [{ kind: "slot", values: ["instructions"] }],
  comparison: [{ kind: "layout", values: ["modular-infographic", "split-screen"] }],
  relationship_map: [{ kind: "layout", values: ["network-map"] }],
  map_layout: [{ kind: "relation", values: ["partitioned_into"] }],
  character_sheet: [{ kind: "layout", values: ["multi-view-grid"] }],
  poster_design: [{ kind: "layout", values: ["poster-hierarchy", "poster-series"] }],
  typography: [{ kind: "slot_any", values: ["title", "subtitle"] }],
  brand_identity: [{ kind: "slot", values: ["brand"] }],
  interface_design: [{ kind: "layout", values: ["ui-page", "ui-system"] }],
  document_layout: [{ kind: "slot_any", values: ["title", "subtitle", "body"] }],
  portrait: [
    { kind: "layout", values: ["single-subject"] },
    { kind: "subject_count", values: ["1"] }
  ],
  subject_appearance: [{ kind: "layout", values: ["single-subject"] }],
  scene_composition: [{ kind: "layout", values: ["spatial-scene"] }],
  reference_transformation: [{ kind: "input_mode", values: ["text_and_image"] }],
  text_rendering: [{ kind: "text_slots", values: ["any"] }],
  sticker_set: [{ kind: "layout", values: ["modular-grid"] }],
  card_design: [{ kind: "layout", values: ["card-collection", "modular-grid"] }],
  icon_design: [{ kind: "layout", values: ["icon-canvas"] }]
};
const EXPLICIT_STRUCTURES = [
  { kind: "slot", values: ["ui_controls"], pattern: /\b(?:buttons?|controls?|navigation)\b|按钮|控件|导航/iu },
  { kind: "slot", values: ["dimensions"], pattern: /尺寸|标尺寸|dimensions?/iu },
  { kind: "slot", values: ["materials"], pattern: /材料说明|材料标注|材质说明|material notes/iu },
  { kind: "slot", values: ["instructions"], pattern: /步骤|numbered steps|instructions/iu },
  { kind: "slot", values: ["data"], pattern: /数值|数据|data values?/iu },
  { kind: "slot", values: ["brand"], pattern: /品牌|brand/iu },
  { kind: "slot", values: ["title"], pattern: /标题|title|headline/iu },
  { kind: "input_mode", values: ["text_and_image"], pattern: /参考图|上传图片|reference image/iu }
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function normalizeText(value) {
  return String(value ?? "").normalize("NFKC").toLowerCase().replace(/[_-]+/gu, " ").replace(/\s+/gu, " ").trim();
}

function compareCaseIds(left, right) {
  return left.localeCompare(right, "en", { numeric: true });
}

function rounded(value) {
  return Number(value.toFixed(6));
}

function addHanTokens(sequence, tokens) {
  if (sequence.length < 2) return;
  if (sequence.length <= 6 && !STOP_TOKENS.has(sequence)) tokens.add(sequence);
  for (let index = 0; index < sequence.length - 1; index += 1) {
    const token = sequence.slice(index, index + 2);
    if (!STOP_TOKENS.has(token)) tokens.add(token);
  }
}

function tokenizeText(value) {
  const normalized = normalizeText(value);
  const tokens = new Set();
  for (const match of normalized.matchAll(/[a-z0-9]+(?:\.[a-z0-9]+)?/giu)) {
    const token = match[0];
    if (token.length > 1 && !STOP_TOKENS.has(token)) tokens.add(token);
  }
  for (const match of normalized.matchAll(/\p{Script=Han}+/gu)) addHanTokens(match[0], tokens);
  return [...tokens].sort();
}

function uniqueSorted(values) {
  return [...new Set(values)].sort(compareCaseIds);
}

function addPosting(inverted, key, caseId) {
  if (!inverted[key]) inverted[key] = [];
  inverted[key].push(caseId);
}

function finalizeInverted(inverted) {
  return Object.fromEntries(Object.entries(inverted).sort(([left], [right]) => left.localeCompare(right)).map(([key, ids]) => [key, uniqueSorted(ids)]));
}

function requirementKey(requirement) {
  return `${requirement.kind}:${[...requirement.values].sort().join("|")}`;
}

function makeRequirements(directIntentIds, normalizedQuery = "") {
  const requirements = new Map();
  const addRequirement = (template, sourceId) => {
    const key = requirementKey(template);
    if (!requirements.has(key)) requirements.set(key, { kind: template.kind, values: template.values, source_intent_ids: [] });
    requirements.get(key).source_intent_ids.push(sourceId);
  };
  for (const intentId of directIntentIds) {
    for (const template of INTENT_STRUCTURES[intentId] ?? []) addRequirement(template, intentId);
  }
  for (const template of EXPLICIT_STRUCTURES) {
    if (template.pattern.test(normalizedQuery)) addRequirement(template, "query");
  }
  return [...requirements.values()];
}

function requirementPostingKeys(requirement) {
  if (requirement.kind === "layout") return requirement.values.map((value) => `layout:${value}`);
  if (requirement.kind === "slot" || requirement.kind === "slot_any") return requirement.values.map((value) => `slot:${value}`);
  if (requirement.kind === "category") return requirement.values.map((value) => `category:${value}`);
  if (requirement.kind === "input_mode") return requirement.values.map((value) => `input_mode:${value}`);
  if (requirement.kind === "subject_count") return requirement.values.map((value) => `subject_count:${value}`);
  if (requirement.kind === "relation") return requirement.values.map((value) => `relation:${value}`);
  if (requirement.kind === "text_slots") return ["text_slots:any"];
  return [];
}

function matchRequirement(document, requirement) {
  if (requirement.kind === "layout" && requirement.values.includes(document.layout)) {
    return { key: `layout:${document.layout}`, label: LAYOUT_LABELS[document.layout] ?? document.layout };
  }
  if (requirement.kind === "slot") {
    const slot = document.text_slots.find((item) => item.slot_id === requirement.values[0]);
    if (slot) return { key: `slot:${slot.slot_id}`, label: `${SLOT_LABELS[slot.slot_id] ?? slot.slot_id}独立槽位`, slotId: slot.slot_id };
  }
  if (requirement.kind === "slot_any") {
    const slot = document.text_slots.find((item) => requirement.values.includes(item.slot_id));
    if (slot) return { key: `slot:${slot.slot_id}`, label: `${SLOT_LABELS[slot.slot_id] ?? slot.slot_id}独立槽位`, slotId: slot.slot_id };
  }
  if (requirement.kind === "category" && requirement.values.includes(document.category_id)) {
    return { key: `category:${document.category_id}`, label: `分类为${document.category_name}` };
  }
  if (requirement.kind === "input_mode" && requirement.values.includes(document.input_mode)) {
    return { key: `input_mode:${document.input_mode}`, label: "参考图输入" };
  }
  if (requirement.kind === "subject_count" && requirement.values.includes(String(document.subject_count))) {
    return { key: `subject_count:${document.subject_count}`, label: `主体数量为 ${document.subject_count}` };
  }
  if (requirement.kind === "relation") {
    const relation = document.relations.find((item) => requirement.values.includes(item.relation));
    if (relation) return { key: `relation:${relation.relation}`, label: `${relation.source_slot} → ${relation.relation} → ${relation.target_slot}` };
  }
  if (requirement.kind === "text_slots" && document.text_slots.length > 0) {
    return { key: "text_slots:any", label: `${document.text_slots.length} 个独立文字槽位` };
  }
  return null;
}

function getStructureMatches(document, requirements) {
  return requirements.map((requirement) => matchRequirement(document, requirement)).filter(Boolean);
}

function structureReason(matches) {
  if (matches.length === 0) return null;
  const slotIds = new Set(matches.map((match) => match.slotId).filter(Boolean));
  const hasDualSlots = slotIds.has("dimensions") && slotIds.has("materials");
  const labels = matches.filter((match) => !hasDualSlots || !["dimensions", "materials"].includes(match.slotId)).map((match) => match.label);
  if (hasDualSlots) labels.unshift("尺寸、材料均有独立槽位");
  return { kind: "structure", text: `结构命中：${[...new Set(labels)].join("；")}` };
}

function mapByCaseId(items, label) {
  const result = new Map();
  for (const item of items) {
    assert(item && typeof item.case_id === "string", `${label} 缺少 case_id`);
    assert(!result.has(item.case_id), `${label} 出现重复 case_id：${item.case_id}`);
    result.set(item.case_id, item);
  }
  return result;
}

export function buildSearchIndex(input) {
  const { cases, classifications, fingerprints, intents, synonyms, taxonomy } = input;
  assert(Array.isArray(cases) && cases.length > 0, "案例集合不能为空");
  const classificationById = mapByCaseId(classifications, "分类");
  const fingerprintById = mapByCaseId(fingerprints, "指纹");
  const intentById = mapByCaseId(intents, "意图");
  const categoryById = new Map(taxonomy.categories.map((category) => [category.category_id, category]));
  const intentIds = new Set(synonyms.map((item) => item.intent_id));
  assert(intentIds.size === synonyms.length, "同义词 intent_id 必须唯一");
  const documents = {};
  const structureInverted = {};
  const intentInverted = {};
  const textInverted = {};
  for (const caseItem of [...cases].sort((left, right) => compareCaseIds(left.case_id, right.case_id))) {
    const caseId = caseItem.case_id;
    const classification = classificationById.get(caseId);
    const fingerprint = fingerprintById.get(caseId);
    const intentItem = intentById.get(caseId);
    assert(classification && fingerprint && intentItem, `案例 ${caseId} 缺少分类、指纹或意图`);
    const category = categoryById.get(classification.primary_category_id);
    assert(category, `案例 ${caseId} 引用了未知分类`);
    assert(intentItem.intents.every((intentId) => intentIds.has(intentId)), `案例 ${caseId} 引用了未知意图`);
    const text = [caseItem.title, caseItem.image_alt, ...(caseItem.source?.styles ?? []), ...(caseItem.source?.scenes ?? []), category.name, category.when_to_use].filter(Boolean).join(" ");
    const document = {
      case_id: caseId,
      title: caseItem.title,
      category_id: category.category_id,
      category_name: category.name,
      layout: fingerprint.layout,
      subject_count: fingerprint.subject_count,
      input_mode: fingerprint.input_mode,
      ratio: fingerprint.ratio,
      intents: [...intentItem.intents].sort(),
      text_slots: fingerprint.text_slots.map(({ slot_id, role, required }) => ({ slot_id, role, required })),
      relations: fingerprint.relations.map(({ source_slot, relation, target_slot }) => ({ source_slot, relation, target_slot })),
      text_tokens: tokenizeText(text),
      title_tokens: tokenizeText(`${caseItem.title} ${caseItem.image_alt ?? ""}`)
    };
    documents[caseId] = document;
    addPosting(structureInverted, `layout:${document.layout}`, caseId);
    addPosting(structureInverted, `category:${document.category_id}`, caseId);
    addPosting(structureInverted, `input_mode:${document.input_mode}`, caseId);
    addPosting(structureInverted, `subject_count:${document.subject_count}`, caseId);
    if (document.text_slots.length > 0) addPosting(structureInverted, "text_slots:any", caseId);
    for (const slot of document.text_slots) {
      addPosting(structureInverted, `slot:${slot.slot_id}`, caseId);
      addPosting(structureInverted, `role:${slot.role}`, caseId);
    }
    for (const relation of document.relations) {
      addPosting(structureInverted, `relation:${relation.relation}`, caseId);
      addPosting(structureInverted, `relation_target:${relation.relation}:${relation.target_slot}`, caseId);
    }
    for (const intentId of document.intents) addPosting(intentInverted, intentId, caseId);
    for (const token of document.text_tokens) addPosting(textInverted, token, caseId);
  }
  assert(classificationById.size === cases.length && fingerprintById.size === cases.length && intentById.size === cases.length, "分类、指纹、意图必须与案例一一对应");
  const index = {
    index_version: INDEX_VERSION,
    generator_version: GENERATOR_VERSION,
    source_sha256: input.sourceSha256 ?? {},
    ranking: {
      priority: ["structure", "intent", "text"],
      method: "lexicographic",
      long_prompt_included: false,
      runtime_services: false,
      vector_model: false
    },
    synonyms: synonyms.map(({ intent_id, label, synonyms: terms, related_intent_ids }) => ({
      intent_id,
      label,
      synonyms: [...terms],
      related_intent_ids: [...related_intent_ids]
    })),
    documents,
    inverted: {
      structure: finalizeInverted(structureInverted),
      intent: finalizeInverted(intentInverted),
      text: finalizeInverted(textInverted)
    }
  };
  assertValidSearchIndex(index);
  return index;
}

export function assertValidSearchIndex(index) {
  assert(index?.index_version === INDEX_VERSION, "检索索引版本不受支持");
  assert(index.generator_version === GENERATOR_VERSION, "检索生成器版本不受支持");
  assert(JSON.stringify(index.ranking?.priority) === JSON.stringify(SCORE_KINDS), "排序优先级必须为结构、意图、文本");
  assert(index.ranking.method === "lexicographic", "排序必须使用字典序");
  assert(index.ranking.long_prompt_included === false && index.ranking.runtime_services === false && index.ranking.vector_model === false, "索引必须排除长提示词、运行时服务与向量模型");
  const documents = Object.values(index.documents ?? {});
  assert(documents.length > 0, "静态索引没有文档");
  for (const document of documents) {
    assert(document.case_id && index.documents[document.case_id] === document, "文档主键不一致");
    assert(Array.isArray(document.intents) && Array.isArray(document.text_slots) && Array.isArray(document.relations), `文档 ${document.case_id} 结构字段不完整`);
    assert(Array.isArray(document.text_tokens) && Array.isArray(document.title_tokens), `文档 ${document.case_id} 文本索引不完整`);
  }
  for (const kind of SCORE_KINDS) {
    for (const [key, ids] of Object.entries(index.inverted?.[kind] ?? {})) {
      assert(Array.isArray(ids) && ids.length > 0, `${kind} 倒排项 ${key} 为空`);
      assert(new Set(ids).size === ids.length, `${kind} 倒排项 ${key} 有重复文档`);
      assert(ids.every((id) => index.documents[id]), `${kind} 倒排项 ${key} 引用了未知文档`);
    }
  }
}

export function parseSearchQuery(index, query) {
  const normalized = normalizeText(query);
  const directMatches = new Map();
  const matchedTerms = new Set();
  for (const definition of index.synonyms) {
    const terms = [definition.label, ...definition.synonyms].map(normalizeText).filter(Boolean).sort((left, right) => right.length - left.length);
    const term = terms.find((candidate) => normalized.includes(candidate));
    if (term) {
      directMatches.set(definition.intent_id, term);
      matchedTerms.add(term);
    }
  }
  const directIntentIds = [...directMatches.keys()].sort();
  const relatedIntentIds = new Set();
  for (const definition of index.synonyms) {
    if (!directMatches.has(definition.intent_id)) continue;
    for (const relatedId of definition.related_intent_ids) if (!directMatches.has(relatedId)) relatedIntentIds.add(relatedId);
  }
  let residual = normalized;
  for (const term of [...matchedTerms].sort((left, right) => right.length - left.length)) residual = residual.split(term).join(" ");
  const requirements = makeRequirements(directIntentIds, normalized);
  return {
    direct_intent_ids: directIntentIds,
    related_intent_ids: [...relatedIntentIds].sort(),
    text_tokens: tokenizeText(residual),
    structure_requirements: requirements.map((requirement) => ({
      kind: requirement.kind,
      values: [...requirement.values],
      source_intent_id: [...requirement.source_intent_ids].sort()[0]
    }))
  };
}

export function compareSearchResults(left, right) {
  for (const kind of SCORE_KINDS) {
    const difference = right.scores[kind] - left.scores[kind];
    if (Math.abs(difference) > 1e-9) return difference;
  }
  return compareCaseIds(left.case_id, right.case_id);
}

export function searchIndex(index, query, options = {}) {
  assertValidSearchIndex(index);
  const parsed = parseSearchQuery(index, query);
  const requirements = parsed.structure_requirements;
  const candidateIds = new Set();
  const addCandidates = (ids) => {
    for (const id of ids ?? []) candidateIds.add(id);
  };
  for (const requirement of requirements) {
    for (const key of requirementPostingKeys(requirement)) addCandidates(index.inverted.structure[key]);
  }
  for (const intentId of [...parsed.direct_intent_ids, ...parsed.related_intent_ids]) addCandidates(index.inverted.intent[intentId]);
  for (const token of parsed.text_tokens) addCandidates(index.inverted.text[token]);
  const labels = new Map(index.synonyms.map((item) => [item.intent_id, item.label]));
  const documentCount = Object.keys(index.documents).length;
  const results = [];
  for (const caseId of candidateIds) {
    const document = index.documents[caseId];
    const structureMatches = getStructureMatches(document, requirements);
    const directIntentHits = parsed.direct_intent_ids.filter((intentId) => document.intents.includes(intentId));
    const relatedIntentHits = parsed.related_intent_ids.filter((intentId) => document.intents.includes(intentId));
    const structureScore = requirements.length === 0 ? 0 : 100 * structureMatches.length / requirements.length;
    const intentScore = (parsed.direct_intent_ids.length === 0 ? 0 : 100 * directIntentHits.length / parsed.direct_intent_ids.length) + relatedIntentHits.length * 5;
    let textScore = 0;
    const textHits = [];
    for (const token of parsed.text_tokens) {
      if (!document.text_tokens.includes(token)) continue;
      const documentFrequency = index.inverted.text[token]?.length ?? 1;
      const titleMultiplier = document.title_tokens.includes(token) ? 2 : 1;
      const weight = (Math.log((documentCount + 1) / (documentFrequency + 1)) + 1) * titleMultiplier;
      textScore += weight;
      textHits.push({ token, weight });
    }
    if (structureScore === 0 && intentScore === 0 && textScore === 0) continue;
    const reasons = [];
    const structural = structureReason(structureMatches);
    if (structural) reasons.push(structural);
    if (directIntentHits.length > 0) reasons.push({ kind: "intent", text: `意图命中：${directIntentHits.map((id) => labels.get(id) ?? id).join("、")}` });
    if (relatedIntentHits.length > 0) reasons.push({ kind: "intent", text: `关联意图：${relatedIntentHits.map((id) => labels.get(id) ?? id).join("、")}` });
    if (textHits.length > 0) {
      const terms = textHits.sort((left, right) => right.weight - left.weight || left.token.localeCompare(right.token)).slice(0, 4).map((hit) => hit.token);
      reasons.push({ kind: "text", text: `文本命中：标题、替代文本、分类或来源标签包含“${terms.join("、")}”` });
    }
    results.push({
      case_id: caseId,
      title: document.title,
      category_id: document.category_id,
      category_name: document.category_name,
      layout: document.layout,
      intents: [...document.intents],
      scores: {
        structure: rounded(structureScore),
        intent: rounded(intentScore),
        text: rounded(textScore)
      },
      reasons,
      matched_intent_ids: directIntentHits,
      matched_structure: structureMatches.map((match) => match.key)
    });
  }
  results.sort(compareSearchResults);
  const requestedLimit = options.limit ?? 5;
  const limit = Math.max(1, Math.min(50, Math.trunc(requestedLimit)));
  return results.slice(0, limit);
}
