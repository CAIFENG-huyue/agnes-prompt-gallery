import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { recompute } from "./build-conclusions.mjs";
import {
  canonical,
  createSchemaValidator,
  projectRoot,
  readJson,
  sha256,
  writeJson
} from "./migrate-experiments.mjs";

export const guideVersion = "evidence-derived-guides-v1";
export const generatorVersion = "build-guides.mjs@1.0.0";
export const outputFiles = [
  "content/case-guides.json",
  "content/decisions.json",
  "content/structure-guides.json",
  "content/methods.json"
];

const bannedTone = /课程|教学|教程|第[一二三四五六七八九十百\d]+课|学习路径|学习进度|测验|练习|课后|学习目标/iu;
const layoutLabels = {
  "single-subject": "单主体构图",
  "poster-hierarchy": "海报传播层级",
  "ui-page": "页面阅读与操作流",
  "modular-infographic": "模块信息图",
  "modular-grid": "模块网格",
  "spatial-scene": "空间叙事场景",
  "storyboard-sheet": "分镜序列",
  "network-map": "关系网络",
  "multi-view-grid": "多视图网格",
  "exploded-view": "爆炸拆解布局",
  timeline: "时间线",
  "freeform-collage": "自由拼贴",
  "analysis-sheet": "分析展示板",
  "split-screen": "分屏对照",
  "icon-canvas": "图标画布",
  "data-card": "数据卡",
  "packaging-label": "包装标签",
  "ui-system": "界面系统",
  "card-collection": "卡片集合",
  "comic-grid": "漫画网格",
  "poster-series": "海报系列"
};
const slotLabels = {
  dimensions: "尺寸标注",
  materials: "材料说明",
  brand: "品牌字标",
  title: "主标题",
  subtitle: "副标题",
  labels: "对象标签",
  annotations: "引线标注",
  body: "正文说明",
  instructions: "步骤说明",
  data: "数据值",
  ui_controls: "界面控件",
  caption: "短句题注",
  badge: "徽章",
  temporal: "时间信息",
  price: "价格",
  assembly: "装配体",
  canvas: "画布",
  cards: "卡片",
  "character-nodes": "角色节点",
  collection: "集合",
  "component-layers": "部件层",
  "destination-posters": "目标海报",
  "detail-views": "细节视图",
  events: "事件",
  "information-modules": "信息模块",
  "input-image": "参考图",
  "light-annotations": "光影标注",
  "lower-slot": "下槽位",
  "main-view": "主视图",
  "panel-sequence": "分格序列",
  pose: "姿态",
  process: "流程",
  product: "产品",
  "relationship-edges": "关系连线",
  "repeated-slots": "重复槽位",
  series: "系列",
  "storyboard-panels": "分镜格",
  timeline: "时间线",
  "ui-page": "页面",
  "upper-slot": "上槽位"
};
const intentLabels = {
  structure_sheet: "结构板",
  multi_view: "多视图",
  technical_view: "技术视图",
  exploded_view: "爆炸拆解",
  dimension_annotation: "尺寸标注",
  material_notes: "材料说明",
  component_labeling: "部件标注",
  information_design: "信息图解",
  data_visualization: "数据图表",
  timeline: "时间线",
  storyboard: "分镜",
  sequence_steps: "步骤序列",
  comparison: "对照矩阵",
  relationship_map: "关系图谱",
  map_layout: "地图",
  character_sheet: "角色设定表",
  poster_design: "海报",
  typography: "字体排版",
  brand_identity: "品牌识别",
  interface_design: "界面",
  document_layout: "文档版面",
  product_design: "产品与包装",
  portrait: "人像",
  character_design: "角色造型",
  subject_appearance: "主体外观",
  scene_composition: "场景叙事",
  reference_transformation: "参考图重构",
  text_rendering: "图中文字",
  sticker_set: "贴纸套组",
  card_design: "卡片设计",
  icon_design: "图标"
};
const relationLabels = {
  transformed_into: "转换为",
  complemented_by: "由…补充",
  decomposed_into: "拆解为",
  ordered_as: "排序为",
  ordered_on: "排列于",
  connected_by: "通过…连接",
  contrasted_with: "与…对照",
  partitioned_into: "分区为",
  contains: "包含",
  analyzed_by: "由…分析",
  annotated_by: "由…标注",
  described_by: "由…说明",
  titled_by: "以…为标题",
  subtitled_by: "以…为副标题",
  branded_by: "由…标识品牌",
  explained_by: "由…解释",
  quantified_by: "由…量化",
  operated_through: "通过…操作",
  captioned_by: "由…题注",
  badged_by: "由…标记徽章",
  scheduled_by: "由…标记时间",
  priced_by: "由…标价"
};
const categoryRules = {
  "information-diagram": {
    acceptance: "槽位数量、顺序与标注绑定",
    rule: "逐槽固定对象、位置和内容，再核对数量与顺序",
    mismatch: "只需要无字氛围图，不需要核对标签、数据或部件关系时"
  },
  "graphic-communication": {
    acceptance: "标题、品牌与卖点的视觉层级",
    rule: "先固定标题与品牌的注意层级，再安排主体和辅助信息",
    mismatch: "核心验收是工程尺寸、逐格操作或多视图对应，而不是传播层级时"
  },
  "interface-document": {
    acceptance: "阅读顺序、控件位置与操作路径",
    rule: "先固定阅读和操作路径，再绑定控件、正文与状态",
    mismatch: "只需要一张主体插画，不需要页面阅读或控件操作时"
  },
  "scene-narrative": {
    acceptance: "主体间位置、动作与情节关系",
    rule: "先固定主体之间的位置和动作，再补充光线与风格",
    mismatch: "只需要单主体材质保真或严格工程标注，不需要空间叙事时"
  },
  "subject-form": {
    acceptance: "主体识别特征、材质与视角",
    rule: "先固定主体识别特征、材质和视角，再补充背景与风格",
    mismatch: "必须逐槽核对复杂文字、界面操作或多格对应关系时"
  }
};
const layoutChallenges = {
  "single-subject": "主体识别特征、材质和视角必须同时稳定，背景细节不能抢走主体轮廓。",
  "poster-hierarchy": "主标题、主体与辅助卖点需要分层，装饰元素不能压过第一阅读点。",
  "ui-page": "导航、正文、控件与状态要沿同一阅读路径排列，不能只拼出界面外观。",
  "modular-infographic": "模块数量、模块内文字和跨模块对应关系要分别核对，不能只看整体像信息图。",
  "modular-grid": "网格行列、每格内容和标签顺序需要绑定，增减一格都会破坏对应关系。",
  "spatial-scene": "主体之间的遮挡、方向和动作要一致，单个体积正确并不等于空间关系正确。",
  "storyboard-sheet": "格序、动作连续性和每格题注必须共同核对，换序后故事含义会改变。",
  "network-map": "节点名称、连线路径与关系方向必须对应，线条增多不能替代关系准确。",
  "multi-view-grid": "各视图必须共享同一主体、比例和命名，视角标签与局部细节不能串位。",
  "exploded-view": "拆解层级、部件归属和引线终点要同时成立，部件散开不代表装配关系清楚。",
  timeline: "时间节点、先后顺序和节点说明必须绑定，不能只保留一条装饰性轴线。",
  "freeform-collage": "自由布局仍需保留主次与标注归属，元素自然散落不能变成关系含混。",
  "analysis-sheet": "分析结论、证据局部和对应标签要形成闭环，装饰性面板不能替代结论依据。",
  "split-screen": "两侧必须保持可比条件，差异应来自被比较项而不是无关视角或光线变化。",
  "icon-canvas": "图标轮廓、网格占位和风格约束要统一，单个图标精致不能掩盖整组不一致。",
  "data-card": "数值、单位和指标标签必须绑定，视觉强调不能改变数值含义。",
  "packaging-label": "产品主体、标签文字与功能说明要各自归位，包装质感不能掩盖信息错配。",
  "ui-system": "多个界面之间要复用同一控件语义与状态命名，不能逐屏随意换布局。",
  "card-collection": "每张卡的共有槽位与差异内容要分离，系列风格不能抹掉单卡身份。",
  "comic-grid": "格序、对白归属和动作方向必须一致，画面热闹不能替代叙事对应。",
  "poster-series": "系列共用版式与单张变量要分开固定，统一风格不能造成内容串版。"
};
const slotChallenges = {
  dimensions: "尺寸数值、单位、尺寸线起止和对应视图必须绑定；只写“标尺寸”无法判断高、宽、深分别属于哪条边。",
  materials: "材料名称、表面处理和所指部件要一一对应；只堆材质词不能说明哪个部件使用该材料。",
  brand: "品牌字形、拼写和所在位置需要固定，品牌风格化不能改成另一组字。",
  title: "标题文字、位置和视觉优先级要同时成立，字体效果不能掩盖错字或漏字。",
  subtitle: "副标题与主标题的层级和归属要清楚，不能相互串位或合并。",
  labels: "标签必须指向正确对象，文字全对但挂到邻近对象仍然是错配。",
  annotations: "引线起点、终点和短注内容要共同核对，线穿过主体或指错部件都会改变含义。",
  body: "正文内容、模块归属和阅读顺序要稳定，不能为填满版面生成无关段落。",
  instructions: "步骤编号、先后次序和对应操作要一致，缺少任一项都会破坏可执行性。",
  data: "数值、单位和指标名称必须作为同一槽位核对，不能只看数字是否出现。",
  ui_controls: "控件名称、位置与状态要对应操作路径，装饰按钮不能替代可用层级。",
  caption: "短句要绑定所指主体或格子，相同短句放错位置会改变叙事。",
  badge: "徽章文字、形状与附着对象需要一致，不能挤占标题或主体。",
  temporal: "时间文本与时间线或状态位置要对应，不能把时间格式当成装饰数字。",
  price: "价格数字、货币符号和商品对象必须绑定，不能与促销标签混放。"
};
const slotPatterns = {
  dimensions: /size arrows|dimension annotations?|dimensions? in millimeters|measurements?|黄金比例测量|尺寸标注|尺寸线|毫米尺寸|标尺寸|尺寸|毫米|dimension/iu,
  materials: /materials and finishes|material (?:notes|annotations|specifications)|show materials|材料说明|材料标注|材质说明|材料|材质|material notes/iu,
  brand: /品牌|brand|logo/iu,
  title: /main[_ ]title|main headline|headline|large bold text|bold typography|bold sans-serif|text: bold|title|大标题|主标题|标题|艺术字|文字写着|字体/iu,
  subtitle: /副标题|标语|宣传语|subtitle|subheadline|slogan|catchphrase/iu,
  labels: /callout_labels|text labels|labels? below|labels? centered below|character name|text labels with|with their .*names|标签|谥号和名字|人物介绍|分级|labels?|callout/iu,
  annotations: /technical annotations|engineering callouts|annotations? across|labels and arrows|handwritten annotations|标注|注解|引线|annotations?|pointer/iu,
  body: /(?:detailed|brief|short) descriptions?|body (?:text|copy)|game summary|description of|text blocks?|说明文字|正文|内容简介|说明|body|description/iu,
  instructions: /步骤|用法|instructions?|numbered steps|numbered panels|steps_count|step-by-step/iu,
  data: /exact stats|stats?_row|statistics|score breakdown|technical specifications|values|数据|数值|比分拆分|data|stats/iu,
  ui_controls: /控件|导航|按钮|controls?|navigation|buttons?|input field/iu,
  caption: /playful captions|short handwritten|short phrase|motivational copy|caption|短句|短语|题注/iu,
  badge: /徽章|badge/iu,
  temporal: /时间|日期|timestamp|date/iu,
  price: /价格|price/iu
};
const layoutEvidencePatterns = {
  "single-subject": /主体|人像|肖像|自拍|角色|人物|少女|女子|女性|男性|学生|产品|静物|动物|皮肤|女装|连衣裙|服装|眼镜|文案|真迹|画作|书法|蒙娜丽莎|书签|黑板|诗词|意境|长卷|小鸟|花枝|小狗|照片|纸艺|包装|橡皮|时尚|目录|分身|portrait|selfie|character|subject|product|still life|woman|man|girl|boy|animal|skin|avatar|car|vehicle|photoreal|fashion|dress|glasses|artwork|painting|calligraphy|Mona Lisa|bookmark|blackboard|poem|poetry|scroll|bird|dog|paper|eraser|catalog|3D|photograph|look like|snapshot|everyday life|candid/iu,
  "poster-hierarchy": /海报|广告|宣传|封面|网站|印章|手举牌|品牌|poster|campaign|flyer|advertisement|thumbnail|icons?|详情图|Amazon|detail images|website|seal|sign|brand/iu,
  "ui-page": /界面|截图|页面|直播间|抖音|导航|控件|朋友圈|药方|微博|详情[图页]|日历|日报|菜单|黄历|课本|网页|手记|笔记|UI|interface|homepage|screenshot|social media|WeChat Moments|prescription|microblog|calendar|newspaper|menu|almanac|textbook|webpage|journal/iu,
  "modular-infographic": /信息图|信息结构|图解|模块|三联画|地图|详解|讲解|技术|肖像|panel|manga|diagram|slide|atlas|triptych|map|technical|frame|portrait|マップ|観光/iu,
  "modular-grid": /网格|矩阵|九宫格|多格|grid|matrix|panels|stickers|fashion items/iu,
  "spatial-scene": /场景|空间|互动|动作|背景|直播|起舞|月下|对决|皇宫|驿站|枪战|世界|对话|奇幻|发布|发廊|插画|地铁|站台|庭院|俯拍|猫咪|scene|spatial|storytelling|between|dancing|dance|livestream|battle|versus|palace|gun|world|conversation|fantasy|Apple Park|launch|salon|illustration|station|platform|cat|overhead/iu,
  "storyboard-sheet": /分镜|故事板|storyboard/iu,
  "network-map": /关系图|关系图谱|节点|连线|relationship (?:map|diagram)|network/iu,
  "multi-view-grid": /多视图|三视图|正面|侧面|背面|设定资料|character (?:design )?sheet|technical views?|multi[ -]view|front, side|3面図|3-view|illustration sheet/iu,
  "exploded-view": /爆炸图|拆解图|分解|部件|exploded (?:view|vertical|assembly)/iu,
  timeline: /时间线|时间轴|timeline/iu,
  "freeform-collage": /拼贴|手账|自由|无网格|无顺序|sketchbook|scrapbook|collage/iu,
  "analysis-sheet": /分析板|姿态分析|光影分析|pose-and-light analysis sheet/iu,
  "split-screen": /分屏|上下.*分区|strict 50\/50 split|top half|bottom half/iu,
  "icon-canvas": /图标|app icon|squircle icon/iu,
  "data-card": /数据卡|比分|highlight card|score breakdown/iu,
  "packaging-label": /包装|标签|packaging label/iu,
  "ui-system": /界面设计系统|UI design system/iu,
  "card-collection": /卡牌|套卡|卡片|game cards?/iu,
  "comic-grid": /漫画|多格|comic panels|multiple panels/iu,
  "poster-series": /海报系列|poster illustration series|poster series/iu
};

function compact(value) {
  return String(value ?? "").replace(/\s+/gu, " ").trim();
}

function clip(value, maxLength) {
  return Array.from(compact(value)).slice(0, maxLength).join("");
}

function safeExcerpt(value, patterns = [], maxLength = 160) {
  const source = compact(value);
  if (!source) throw new Error("证据摘录来源为空");
  const limit = Math.max(1, Math.min(maxLength, Math.floor(Array.from(source).length * 0.65)));
  const candidates = [];
  for (const pattern of patterns) {
    const match = pattern.exec(source);
    if (!match) continue;
    const start = Math.max(0, match.index - 36);
    const end = Math.min(source.length, match.index + match[0].length + 112);
    candidates.push(source.slice(start, end));
  }
  if (patterns.length > 0 && candidates.length === 0) throw new Error(`目标模式在证据来源中零命中：${clip(source, 40)}`);
  if (patterns.length === 0) {
    const stride = Math.max(1, limit);
    for (let start = 0; start < source.length; start += stride) candidates.push(source.slice(start, start + limit));
  }
  for (const candidate of candidates) {
    const result = clip(candidate, limit);
    if (result && !bannedTone.test(result)) return result;
  }
  throw new Error(`无法取得不含禁用语气的短证据：${clip(source, 40)}`);
}

const placeholderTopics = new Set([
  "type", "theme", "hair color", "subject", "quantity", "platform", "format", "subject description",
  "celebrity", "action type", "character", "reference", "main headline", "popular science encyclopedia image",
  "图像生成案例图"
]);

function isPlaceholderTopic(value) {
  const normalized = compact(value);
  return !normalized || placeholderTopics.has(normalized.toLowerCase()) || /^\{argument\b|\.\.\.|…/iu.test(normalized);
}

function safeTopic(caseRecord) {
  for (const value of [caseRecord.image_alt, caseRecord.title]) {
    const normalized = compact(value);
    if (bannedTone.test(normalized) || isPlaceholderTopic(normalized)) continue;
    return clip(normalized, 52);
  }
  return caseRecord.case_id;
}

function indexUnique(records, key, label) {
  const result = new Map();
  for (const record of records) {
    if (result.has(record[key])) throw new Error(`${label}重复 ${record[key]}`);
    result.set(record[key], record);
  }
  return result;
}

function slotName(id) {
  return slotLabels[id] ?? id.replaceAll("-", " ");
}

function relationName(relation) {
  const source = slotName(relation.source_slot);
  const target = slotName(relation.target_slot);
  const template = relationLabels[relation.relation] ?? relation.relation;
  return template.includes("…") ? `${source}${template.replace("…", target)}` : `${source}${template}${target}`;
}

function ref(entity_type, entity_id) {
  return { entity_type, entity_id };
}

function uniqueRefs(refs) {
  return [...new Map(refs.map((item) => [`${item.entity_type}:${item.entity_id}`, item])).values()];
}

function caseNumber(caseId) {
  const value = Number(caseId.slice(5));
  return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
}

function makeTransferableRule(topic, categoryId, fingerprint, intentIds) {
  const layout = layoutLabels[fingerprint.layout] ?? fingerprint.layout;
  const slots = fingerprint.text_slots.map((slot) => slotName(slot.slot_id));
  const slotPhrase = slots.length ? slots.slice(0, 4).join("、") : "主体、视角与构图";
  const relation = fingerprint.relations[0] ? relationName(fingerprint.relations[0]) : categoryRules[categoryId].rule;
  const hasDimensions = intentIds.includes("dimension_annotation") || slots.includes("尺寸标注");
  const hasMaterials = intentIds.includes("material_notes") || slots.includes("材料说明");
  if (hasDimensions || hasMaterials) {
    const controls = [];
    if (hasDimensions) controls.push("将尺寸按“视图—部位—数值—单位—箭头起止”绑定");
    if (hasMaterials) controls.push("将材料按“部件—材料—表面处理”绑定");
    return `迁移“${topic}”的${layout}时，先固定各视图与主体比例，再${controls.join("，")}；只替换主体和参数，不沿用原案例数值，也不把无归属的标注词当作完成。`;
  }
  if (slots.length) {
    return `迁移“${topic}”时保留${layout}，把${slotPhrase}拆成独立的“对象—位置—内容”槽位，并用“${relation}”约束对应关系；移除槽位绑定后，应重新核对${categoryRules[categoryId].acceptance}。`;
  }
  if (fingerprint.relations.length) {
    return `迁移“${topic}”时先固定${layout}，再显式保留“${relation}”；若删去这条关系，只保留相近风格，无法保证${categoryRules[categoryId].acceptance}。`;
  }
  const intentFocus = intentIds.slice(0, 3).map((id) => intentLabels[id] ?? id).join("、") || categoryRules[categoryId].acceptance;
  return `迁移“${topic}”时以${layout}承载${intentFocus}，${categoryRules[categoryId].rule}；如果只替换题材词而漏掉这些结构约束，应重新核对${categoryRules[categoryId].acceptance}。`;
}

function makeGuide(caseRecord, classification, fingerprint, intentRecord, promptVersion) {
  const topic = safeTopic(caseRecord);
  const category = categoryRules[classification.primary_category_id];
  const layout = layoutLabels[fingerprint.layout] ?? fingerprint.layout;
  const slots = fingerprint.text_slots.map((slot) => slotName(slot.slot_id));
  const slotPhrase = slots.length ? slots.slice(0, 4).join("、") : category.acceptance;
  const ratio = fingerprint.ratio === "custom" ? "另行锁定画幅" : `保持 ${fingerprint.ratio} 画幅`;
  const suitableFor = [`需要处理“${topic}”这类${layout}任务，并核对${slotPhrase}且${ratio}时。`];
  if (intentRecord.intents.includes("structure_sheet")) suitableFor.push("需要把主视图、技术视图、部件标注或材料说明放在同一张结构板上时。");
  else if (intentRecord.intents.includes("reference_transformation")) suitableFor.push("已有参考图，并需要区分哪些主体特征保留、哪些版式或文字由新需求决定时。");
  const unsuitableFor = [];
  if (fingerprint.text_slots.some((slot) => slot.slot_id === "dimensions")) unsuitableFor.push("无法提供具体尺寸对象、数值或单位，只想生成无标注氛围图时。");
  else if (fingerprint.text_slots.some((slot) => slot.slot_id === "materials")) unsuitableFor.push("只需要材质观感，不需要把材料与表面处理标到具体部件时。");
  else unsuitableFor.push(category.mismatch + "。");
  unsuitableFor.push(fingerprint.input_mode === "text_and_image"
    ? "没有可用参考图，或希望脱离参考主体重新设计时；当前输入契约会失去依据。"
    : "需要严格复刻一张既有图片的主体，而当前只有文字输入、没有参考图契约时。");
  const commonChallenges = [layoutChallenges[fingerprint.layout] ?? `${layout}需要显式固定主次和对应关系。`];
  for (const slot of fingerprint.text_slots) {
    const challenge = slotChallenges[slot.slot_id];
    if (challenge && !commonChallenges.includes(challenge)) commonChallenges.push(challenge);
    if (commonChallenges.length >= 3) break;
  }
  if (commonChallenges.length < 3 && fingerprint.relations.length) {
    commonChallenges.push(`“${relationName(fingerprint.relations[0])}”需要逐对象核对，不能仅凭相似风格推断关系已经成立。`);
  }
  if (commonChallenges.length < 3) {
    commonChallenges.push(fingerprint.input_mode === "text_and_image"
      ? "参考图提供的主体特征与文字新增的构图要求要分开描述，避免后一个要求覆盖前一个。"
      : `当前指纹的画幅为 ${fingerprint.ratio}，迁移时不能把未确定的画布约束当成已知条件。`);
  }
  return {
    guide_id: `${caseRecord.case_id}/guide-001`,
    case_id: caseRecord.case_id,
    suitable_for: suitableFor,
    unsuitable_for: unsuitableFor,
    common_challenges: commonChallenges.slice(0, 4),
    transferable_rule: makeTransferableRule(topic, classification.primary_category_id, fingerprint, intentRecord.intents),
    guide_version: guideVersion
  };
}

export function inferredFocus(fingerprint, intentRecord) {
  const slotIds = new Set(fingerprint.text_slots.map((slot) => slot.slot_id));
  if (slotIds.has("dimensions")) return {
    decision: "尺寸值、单位、箭头起止与所属视图",
    target: "高、宽、深等尺寸与具体视图边界的对应",
    weak: "“加上尺寸”这类无归属要求",
    risk: "数字错位、单位缺失或箭头挂到另一视图",
    patterns: [slotPatterns.dimensions],
    afterPatterns: [/技术视图|正视图|侧视图|technical views?|orthographic/iu, slotPatterns.dimensions]
  };
  if (slotIds.has("materials")) return {
    decision: "材料、表面处理与部件归属",
    target: "每条材料短注所指向的部件和表面",
    weak: "没有部件归属的材质形容词",
    risk: "材料堆叠在错误部件上或遗漏表面处理",
    patterns: [slotPatterns.materials],
    afterPatterns: [/部件|结构|component|part|packaging/iu, slotPatterns.materials]
  };
  if (intentRecord.intents.includes("multi_view")) return {
    decision: "视图清单、视角命名与同一主体比例",
    target: "正面、侧面、背面或其他技术视图的齐全与一致",
    weak: "只写“多视图”而不限定视角",
    risk: "重复视角、缺失视角或同一标签对应不同主体",
    patterns: [/多视图|三视图|正面|侧面|背面|视图|视角|设定资料|front, side|front view|side view|back view|multi[ -]view|multiple views|3面図|3-view|character (?:design )?sheet|view/iu],
    afterPatterns: [/侧面|背面|side|back view|technical views?|视图|视角|view|设定资料|character (?:design )?sheet|3面図|3-view|illustration sheet/iu]
  };
  if (fingerprint.text_slots.length) {
    const slot = fingerprint.text_slots[0].slot_id;
    return {
      decision: `${slotName(slot)}的内容、位置与对象绑定`,
      target: `${slotName(slot)}不被移到其他对象或模块`,
      weak: `只要求出现${slotName(slot)}而不指定归属`,
      risk: "文字出现但对象、顺序或位置错配",
      patterns: [slotPatterns[slot] ?? /文字|标注|text|label/iu],
      afterPatterns: [
        ...(fingerprint.relations.length ? [/位置|布局|版式|顶部|底部|上方|下方|居中|左侧|右侧|layout|position|below|above|left|right|top|bottom/iu] : []),
        slotPatterns[slot] ?? /文字|text/iu
      ]
    };
  }
  if (fingerprint.input_mode === "text_and_image") return {
    decision: "参考图保留项与文字新增项的边界",
    target: "主体身份、姿态或材质不因新增风格要求而漂移",
    weak: "只写“参考此图”而不说明保留什么",
    risk: "参考主体被重绘成另一对象，或新增文字覆盖原图约束",
    patterns: [/reference_[0-9]+|reference (?:image|photo|portrait)|provided (?:input )?image|provided reference|uploaded (?:image|photo|portrait|logo|selfie)|attached (?:image|reference)|same appearance as the reference|using the uploaded|using the attached|based on this character|用户上传自拍|参考图|上传图片|上传自拍|附图|このキャラクターと背景/iu],
    afterPatterns: [
      /保留|保持|preserve|retain|same/iu,
      /reference_[0-9]+|reference (?:image|photo|portrait)|provided (?:input )?image|provided reference|uploaded (?:image|photo|portrait|logo|selfie)|attached (?:image|reference)|same appearance as the reference|using the uploaded|using the attached|based on this character|用户上传自拍|参考图|上传图片|上传自拍|附图|このキャラクターと背景/iu
    ]
  };
  return {
    decision: `${layoutLabels[fingerprint.layout] ?? fingerprint.layout}的主次与构图边界`,
    target: categoryRules[inferCategoryFromLayout(fingerprint.layout)].acceptance,
    weak: "只替换题材和风格词",
    risk: "构图主次或对象数量变化，原任务的关键约束丢失",
    patterns: [layoutEvidencePatterns[fingerprint.layout] ?? /构图|画面|主体|layout|composition|subject/iu],
    afterPatterns: [
      /风格|材质|背景|style|material|background/iu,
      layoutEvidencePatterns[fingerprint.layout] ?? /构图|画面|主体|layout|composition|subject/iu
    ]
  };
}

function inferCategoryFromLayout(layout) {
  if (["ui-page", "ui-system"].includes(layout)) return "interface-document";
  if (["poster-hierarchy", "poster-series", "packaging-label", "icon-canvas"].includes(layout)) return "graphic-communication";
  if (["spatial-scene", "storyboard-sheet", "comic-grid", "freeform-collage"].includes(layout)) return "scene-narrative";
  if (["single-subject"].includes(layout)) return "subject-form";
  return "information-diagram";
}

export function makeInferredDecision(caseRecord, fingerprint, intentRecord, promptVersion) {
  const topic = safeTopic(caseRecord);
  const focus = inferredFocus(fingerprint, intentRecord);
  const evidenceSources = [
    promptVersion.text,
    caseRecord.title,
    ...(!isPlaceholderTopic(caseRecord.image_alt) ? [caseRecord.image_alt] : [])
  ].filter(Boolean);
  const extract = (patterns, field) => {
    const problems = [];
    for (const source of evidenceSources) {
      try {
        return safeExcerpt(source, patterns);
      } catch (error) {
        problems.push(error instanceof Error ? error.message : String(error));
      }
    }
    throw new Error(`${caseRecord.case_id} ${field}: ${problems.join("；")}`);
  };
  return {
    decision_id: `${caseRecord.case_id}/decision-inferred-structure`,
    case_id: caseRecord.case_id,
    prompt_version_id: promptVersion.prompt_version_id,
    decision: `为“${topic}”固定${focus.decision}；${focus.weak}不足以作为约束。`,
    control_target: focus.target,
    before_excerpt: extract(focus.patterns, "before_excerpt"),
    after_excerpt: extract(focus.afterPatterns, "after_excerpt"),
    expected_effect: `推断可把${focus.target}变成可核对项；若改成${focus.weak}，容易${focus.risk}。此卡没有引用 Run，结论仅为 inferred。`,
    observed_effect: null,
    evidence_level: "inferred",
    evidence_refs: [ref("case", caseRecord.case_id), ref("prompt_version", promptVersion.prompt_version_id)]
  };
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function effectText(value) {
  const rounded = Number(value.toFixed(2));
  return `${rounded > 0 ? "+" : ""}${rounded}pp`;
}

function observationFocus(notes) {
  if (/尺寸|材料|箭头|色板|技术视图/iu.test(notes)) return {
    target: "尺寸、材料、色板与技术视图的槽位绑定",
    risk: "标注错挂、视图数量漂移或材料归属丢失",
    patterns: [/尺寸|材料|色板|技术视图|dimensions?|materials?/iu]
  };
  if (/顺序|倒置|错位|串行|行列|一行|两行|每列|每行/iu.test(notes)) return {
    target: "行列顺序、对象位置与文字标签的对应",
    risk: "行列增减、顺序颠倒或标签挂到相邻对象",
    patterns: [/版式|行|列|顺序|layout|rows?|cols?/iu]
  };
  if (/多一个|少|缺|数量|应\s*\d|不得超过|严格/iu.test(notes)) return {
    target: "元素数量与指定布局约束",
    risk: "元素增删后仍被文字高分掩盖",
    patterns: [/数量|必须出现|严格|elements?|counts?/iu]
  };
  if (/主体|身份|人脸|角色|姿态|参考/iu.test(notes)) return {
    target: "参考主体与派生元素的一致性",
    risk: "主体身份或姿态变化但装饰元素仍然齐全",
    patterns: [/主体|参考|身份|姿态|subject|reference/iu]
  };
  return {
    target: "逐字文字与其所在槽位",
    risk: "错字、乱码或漏字被整体视觉效果掩盖",
    patterns: [/文字|文本|text|title|标签/iu]
  };
}

function selectObservation(rows) {
  return [...rows].sort((left, right) => {
    const severity = (row) => {
      const score = row.score;
      return (score.text_total - score.text_hits) * 1000
        + (score.elements_total - score.elements_hits) * 100
        + score.count_error * 10
        + [score.g1, score.g2, score.g3, score.g4].filter((value) => value !== 1).length;
    };
    return severity(right) - severity(left) || left.run.rep - right.run.rep;
  })[0];
}

function makeH1Decisions(caseRecord, h1, promptVersions, runs, currentScoreByRun) {
  const caseId = caseRecord.case_id;
  const prosePv = promptVersions.get(`${caseId}/pv-002`);
  const structuredPv = promptVersions.get(`${caseId}/pv-003`);
  if (!prosePv || !structuredPv) throw new Error(`${caseId} 缺少 H1 双臂提示词版本`);
  const caseRuns = runs.filter((run) => run.experiment_version_id === h1.experiment_version_id && run.case_id === caseId);
  if (!caseRuns.length) throw new Error(`${caseId} 没有 H1 Run`);
  const rows = caseRuns.map((run) => {
    const score = currentScoreByRun.get(run.run_id);
    if (!score) throw new Error(`${run.run_id} 缺少当前评分`);
    return { run, score };
  });
  const armRows = (arm) => rows.filter((row) => row.run.arm_id === arm);
  const proseRows = armRows("prose");
  const structuredRows = armRows("structured");
  if (!proseRows.length || !structuredRows.length) throw new Error(`${caseId} H1 双臂 Run 不完整`);
  const sum = (items, field) => items.reduce((total, row) => total + row.score[field], 0);
  const rate = (items) => mean(items.map((row) => row.score.text_hits / row.score.text_total));
  const effect = (rate(structuredRows) - rate(proseRows)) * 100;
  const topic = clip(prosePv.spec.subject || safeTopic(caseRecord), 68);
  const sharedRefs = [ref("experiment_version", h1.experiment_version_id), ref("prompt_version", prosePv.prompt_version_id), ref("prompt_version", structuredPv.prompt_version_id)];
  const comparison = {
    decision_id: `${caseId}/decision-h1-prose-contract`,
    case_id: caseId,
    prompt_version_id: prosePv.prompt_version_id,
    decision: `对“${topic}”保持同一 spec 的散文契约，不把仅改成分段结构化当作逐字文本的默认改进。`,
    control_target: `同一 spec 下 ${prosePv.spec.texts.length} 个文字槽的逐字达成，只改变提示词组织形式`,
    before_excerpt: safeExcerpt(prosePv.text, [/文字逐字如下/iu, /主体：/iu]),
    after_excerpt: safeExcerpt(structuredPv.text, [/\[TEXT — EXACT\]/iu, /\[ELEMENTS\]/iu]),
    expected_effect: "原假设是结构化组织提高逐字达成；是否采纳必须由同 spec、同模型的双臂 Run 判定，不能从分段外观推断。",
    observed_effect: `H1 本案例当前评分：prose ${sum(proseRows, "text_hits")}/${sum(proseRows, "text_total")}，structured ${sum(structuredRows, "text_hits")}/${sum(structuredRows, "text_total")}；按逐 Run 文字达成率先求臂内均值，structured−prose=${effectText(effect)}（每臂 ${proseRows.length} 次 Run；仅本案例，不外推）。`,
    evidence_level: "tested",
    evidence_refs: uniqueRefs([
      ...sharedRefs,
      ...caseRuns.map((run) => ref("run", run.run_id)),
      ...rows.map((row) => ref("score_revision", row.score.score_id))
    ])
  };
  const observations = [prosePv, structuredPv].map((promptVersion) => {
    const arm = promptVersion === prosePv ? "prose" : "structured";
    const selected = selectObservation(armRows(arm));
    const focus = observationFocus(selected.score.notes);
    const matchedElement = promptVersion.spec.elements.find((element) => focus.patterns.some((pattern) => pattern.test(element))) ?? promptVersion.spec.elements[0] ?? topic;
    return {
      decision_id: `${caseId}/decision-h1-observed-${arm}`,
      case_id: caseId,
      prompt_version_id: promptVersion.prompt_version_id,
      decision: `把“${clip(matchedElement, 56)}”与${focus.target}分开验收；即使文字总分较高，也保留逐图核对。`,
      control_target: focus.target,
      before_excerpt: safeExcerpt(promptVersion.text, focus.patterns),
      after_excerpt: safeExcerpt(selected.score.notes),
      expected_effect: `预期能暴露${focus.risk}；若只看文字汇总分，具体的对象或结构错配会被掩盖。`,
      observed_effect: `${arm} 的 ${selected.run.run_id} 当前评分：文字 ${selected.score.text_hits}/${selected.score.text_total}，元素 ${selected.score.elements_hits}/${selected.score.elements_total}，count_error=${selected.score.count_error}；记录“${compact(selected.score.notes)}”。仅为单 Run 观察，不作受控因果结论。`,
      evidence_level: "observed",
      evidence_refs: [
        ref("experiment_version", h1.experiment_version_id),
        ref("prompt_version", promptVersion.prompt_version_id),
        ref("run", selected.run.run_id),
        ref("score_revision", selected.score.score_id)
      ]
    };
  });
  return [comparison, ...observations];
}

function structureSources(intentId, intents, fingerprints, casePromptVersions, patterns) {
  const fingerprintByCase = new Map(fingerprints.map((item) => [item.case_id, item]));
  const pvByCase = new Map(casePromptVersions.map((item) => [item.case_id, item]));
  const relevantSlot = intentId === "dimension_annotation" ? "dimensions" : intentId === "material_notes" ? "materials" : null;
  return intents.filter((item) => item.intents.includes(intentId)).sort((left, right) => {
    const score = (item) => {
      const fp = fingerprintByCase.get(item.case_id);
      const slotScore = relevantSlot && fp.text_slots.some((slot) => slot.slot_id === relevantSlot) ? 10 : 0;
      const relationScore = fp.relations.filter((relation) => !relevantSlot || relation.target_slot === relevantSlot).length;
      return slotScore + relationScore + item.intents.filter((id) => ["structure_sheet", "multi_view", "technical_view", "dimension_annotation", "material_notes"].includes(id)).length;
    };
    return score(right) - score(left) || caseNumber(left.case_id) - caseNumber(right.case_id);
  }).slice(0, 3).map((item) => {
    const pv = pvByCase.get(item.case_id);
    return {
      case_id: item.case_id,
      prompt_version_id: pv.prompt_version_id,
      excerpt: safeExcerpt(pv.text, patterns)
    };
  });
}

function makeStructureGuides(intents, fingerprints, casePromptVersions) {
  const viewEvidence = structureSources("structure_sheet", intents, fingerprints, casePromptVersions, [
    /结构板|设定资料|结构拆解|拆解图|爆炸图|structure sheet|illustration sheet|technical sheet/iu,
    /多视图|三视图|正面|侧面|背面|orthographic|turnaround|\bfront\b|\bside\b|\bback\b|\btechnical views?\b|\bmulti[ -]view\b/iu
  ]);
  const dimensionEvidence = structureSources("dimension_annotation", intents, fingerprints, casePromptVersions, [/尺寸|毫米|dimensions?|size arrows|measurements?/iu]);
  const materialEvidence = structureSources("material_notes", intents, fingerprints, casePromptVersions, [/材料|材质|materials? and finishes|material notes/iu]);
  return [
    {
      guide_id: "structure-sheet-view-contract",
      title: "结构板：先锁视图，再放标注",
      intent_ids: ["structure_sheet", "multi_view", "technical_view"],
      suitable_for: ["包装、产品或角色需要同时展示主视觉、正侧背视图、拆解细节与部件标签时。"],
      unsuitable_for: ["只有单一氛围图需求，或各视图可以更换主体、比例和视角定义时。"],
      common_challenges: [
        "多视图不是把同一主体复制多次：正、侧、背或顶、底视图必须有各自视角，并保持主体特征与比例一致。",
        "主视觉、技术视图、结构草图与局部放大需要独立槽位；视图数量齐全但标签串位仍不合格。",
        "引线和文字要指向对应部件，不能因版面拥挤而跨过其他视图或改变归属。"
      ],
      transferable_rules: [
        "先列视图清单，再为每个视图写视角、主体比例、可见部件和允许出现的标注；最后才安排主视觉与装饰。",
        "把“视图—部件—标签”作为同一核对单元；删掉任一视图后，同步删除只属于该视图的尺寸与材料短注。"
      ],
      evidence_level: "inferred",
      guide_version: guideVersion,
      evidence: viewEvidence
    },
    {
      guide_id: "structure-sheet-dimensions",
      title: "尺寸标注：数值必须落到视图与边界",
      intent_ids: ["structure_sheet", "dimension_annotation", "technical_view"],
      suitable_for: ["需要核对高、宽、深、直径或展开尺寸，并能指出尺寸线两端所夹视图边界时。"],
      unsuitable_for: ["尚未确定尺寸对象或单位，只希望画面出现工程感数字时。"],
      common_challenges: [
        "尺寸数值、单位、尺寸线起止与对应视图必须一起核对；只有数字没有箭头目标，无法判断高、宽、深属于哪条边。",
        "透视图中的视觉长度不能替代正交视图尺寸；同一尺寸重复出现在多个视图时还要检查是否互相矛盾。",
        "尺寸文字可能正确但箭头挂错，也可能箭头位置正确但单位缺失，因此不能把文字命中当作尺寸完成。"
      ],
      transferable_rules: [
        "每条尺寸都按“所属视图—测量部位—数值—单位—尺寸线起止”登记；迁移主体时重新提供参数，不复制原案例数值。",
        "把尺寸槽位与材料短注、色板分开，避免尺寸值漂到色块或邻近部件；没有明确测量边界的数字不进入结构板。"
      ],
      evidence_level: "inferred",
      guide_version: guideVersion,
      evidence: dimensionEvidence
    },
    {
      guide_id: "structure-sheet-materials",
      title: "材料标注：材料词必须绑定部件与表面",
      intent_ids: ["structure_sheet", "material_notes", "component_labeling"],
      suitable_for: ["不同部件使用不同材料、涂层、纸张、塑料或金属，并需要分别说明表面处理时。"],
      unsuitable_for: ["只需要整体材质风格，或尚未确定各部件材料，无法写出归属关系时。"],
      common_challenges: [
        "材料名称、颜色、表面处理与部件归属要同时成立；“哑光、金属、纸质”等词没有部件指向时无法验收。",
        "材料短注与引线终点可能错配，尤其在外壳、内衬、接缝和透明件相邻时，不能只看材料词是否出现。",
        "视觉质感与文字说明需要一致；写成透明材料却画成不透明表面，仍属于材料表达冲突。"
      ],
      transferable_rules: [
        "每条材料短注按“部件—材料—颜色或表面处理—引线目标”登记，同一部件的多种处理归并到同一槽位。",
        "将材料槽位与尺寸槽位分离；换材料时只更新对应部件及其表面表现，不顺手改动无关视图的尺寸。"
      ],
      evidence_level: "inferred",
      guide_version: guideVersion,
      evidence: materialEvidence
    }
  ];
}

function methodEvidence(cv) {
  const evidence = {
    conclusion_version_id: cv.conclusion_version_id,
    metric: cv.metric,
    estimate: cv.estimate,
    unit: cv.unit,
    ci_low: cv.ci_low,
    ci_high: cv.ci_high,
    ci_method: cv.ci_method,
    ci_level: cv.ci_level,
    n_cases: cv.n_cases,
    n_images: cv.n_images,
    limitations: cv.limitations,
    source_experiment_version_ids: cv.source_experiment_version_ids,
    score_snapshot_hash: cv.score_snapshot_hash,
    evidence_run_ids: cv.evidence_run_ids
  };
  if (Object.hasOwn(cv, "p_value")) {
    evidence.p_value = cv.p_value;
    evidence.p_method = cv.p_method;
  }
  return evidence;
}

function makeMethods(validConclusions) {
  const h1cv = validConclusions.get("h1-text-fulfillment/cv-001");
  const h2cv = validConclusions.get("h2-226-overlay-exact-text/cv-001");
  return [
    {
      method_id: "prose-contract-exact-text",
      title: "逐字文字的散文契约",
      applicable_when: [
        "图内文字需要逐字核对，且比较时能保持需求 spec、模型与评分口径不变。",
        "需要决定是否只改变提示词组织形式，而不是同时增删文字、元素或布局。"
      ],
      unsuitable_for: [
        "把该结论直接外推到其他模型、其他案例分布或尺寸与材料结构板。",
        "把结构化分段当成无需 Run 验证的默认改进。"
      ],
      transferable_rule: "先冻结同一份需求 spec，再把文字内容、所在位置、样式和数量写成散文契约；是否改成结构化分段由对应 Run 决定，不由分段外观决定。",
      decision: "在 H1 的证据范围内，不采纳“只把同一 spec 改成结构化分段”的优化，保留散文契约；正向或零差异的单案例也不被抹平。",
      conclusion_version_ids: [h1cv.conclusion_version_id],
      evidence: [methodEvidence(h1cv)]
    },
    {
      method_id: "blank-band-deterministic-overlay",
      title: "可预测空白带的确定性叠字",
      applicable_when: [
        "版式存在可稳定检测的空白题注带，并且底图与合成图都能逐张核对。",
        "文字可以由确定性排版工具生成，且不需要模型同时绘制文字笔画。"
      ],
      unsuitable_for: [
        "文字与尺寸箭头、界面控件、项目符号或复杂结构纠缠，无法划出稳定空白带。",
        "需要据此宣称普遍优于图内文字，或无法保留底图、叠字图与位置核对记录。"
      ],
      transferable_rule: "把底图的文字槽清空并保留明确的空白题注带，再用确定性工具叠字；同时保存无字底图、合成结果和空白带位置核对，发现残留导线或碰撞时不得放行。",
      decision: "对可预测空白带，可采用无字底图加确定性后期叠字；当前结论只是单案例可行性证据，且叠字文字是确定性构造，不作盲比优胜声明。",
      conclusion_version_ids: [h2cv.conclusion_version_id],
      evidence: [methodEvidence(h2cv)]
    }
  ];
}

function selectAuditSampleIds(cases, h1CaseIds, structureGuides, classifications) {
  const selected = [];
  const add = (id) => {
    if (id && !selected.includes(id) && selected.length < 20) selected.push(id);
  };
  h1CaseIds.forEach(add);
  structureGuides.flatMap((guide) => guide.evidence.map((item) => item.case_id)).forEach(add);
  const classificationByCase = new Map(classifications.map((item) => [item.case_id, item.primary_category_id]));
  for (const categoryId of Object.keys(categoryRules)) {
    const match = cases.find((item) => classificationByCase.get(item.case_id) === categoryId && !selected.includes(item.case_id));
    if (match) add(match.case_id);
  }
  for (const item of cases) add(item.case_id);
  return selected;
}

function assertNoBannedTone(outputs) {
  const serialized = JSON.stringify(outputs);
  const match = bannedTone.exec(serialized);
  if (match) throw new Error(`输出含禁用语气词：${match[0]}`);
}

export function buildGuides(input) {
  const {
    cases,
    classifications,
    fingerprints,
    intents,
    casePromptVersions,
    experimentPromptVersions,
    experimentVersions,
    runs,
    scoreRevisions,
    conclusions
  } = input;
  if (cases.length !== 541) throw new Error(`案例数必须为 541，实际为 ${cases.length}`);
  const caseById = indexUnique(cases, "case_id", "案例");
  const classificationById = indexUnique(classifications, "case_id", "分类");
  const fingerprintById = indexUnique(fingerprints, "case_id", "指纹");
  const intentById = indexUnique(intents, "case_id", "意图");
  const casePvById = indexUnique(casePromptVersions, "case_id", "原始提示词版本");
  const allPromptVersions = [...casePromptVersions, ...experimentPromptVersions];
  const promptById = indexUnique(allPromptVersions, "prompt_version_id", "提示词版本");
  for (const caseId of caseById.keys()) {
    for (const [map, label] of [[classificationById, "分类"], [fingerprintById, "指纹"], [intentById, "意图"], [casePvById, "原始提示词版本"]]) {
      if (!map.has(caseId)) throw new Error(`${caseId} 缺少${label}`);
    }
  }
  const h1 = experimentVersions.find((item) => item.experiment_version_id === "h1/ev-001");
  if (!h1) throw new Error("缺少 h1/ev-001");
  const currentScoreByRun = new Map();
  for (const score of scoreRevisions.filter((item) => item.is_current)) {
    if (currentScoreByRun.has(score.run_id)) throw new Error(`${score.run_id} 有多个当前评分`);
    currentScoreByRun.set(score.run_id, score);
  }
  const recomputed = recompute(experimentVersions, runs, scoreRevisions);
  const requiredCvIds = ["h1-text-fulfillment/cv-001", "h2-226-overlay-exact-text/cv-001"];
  const validConclusions = new Map();
  for (const id of requiredCvIds) {
    const published = conclusions.find((item) => item.conclusion_version_id === id);
    const valid = recomputed.conclusions.find((item) => item.conclusion_version_id === id);
    if (!published || !valid || canonical(published) !== canonical(valid)) throw new Error(`ConclusionVersion 无效或不是当前可重算版本：${id}`);
    validConclusions.set(id, valid);
  }
  const guides = cases.map((caseRecord) => makeGuide(
    caseRecord,
    classificationById.get(caseRecord.case_id),
    fingerprintById.get(caseRecord.case_id),
    intentById.get(caseRecord.case_id),
    casePvById.get(caseRecord.case_id)
  ));
  const decisions = cases.map((caseRecord) => makeInferredDecision(
    caseRecord,
    fingerprintById.get(caseRecord.case_id),
    intentById.get(caseRecord.case_id),
    casePvById.get(caseRecord.case_id)
  ));
  for (const caseId of h1.design.case_ids) {
    decisions.push(...makeH1Decisions(caseById.get(caseId), h1, promptById, runs, currentScoreByRun));
  }
  const structureGuides = makeStructureGuides(intents, fingerprints, casePromptVersions);
  const methods = makeMethods(validConclusions);
  const outputs = { guides, decisions, structureGuides, methods };
  assertNoBannedTone(outputs);
  return { ...outputs, h1CaseIds: h1.design.case_ids, validConclusionIds: requiredCvIds };
}

async function validateSchemas(outputs) {
  const schemaFiles = ["common.schema.json", "guide.schema.json", "decision.schema.json"];
  const schemas = new Map();
  for (const fileName of schemaFiles) schemas.set(path.join(projectRoot, "schemas", fileName), await readJson(path.join(projectRoot, "schemas", fileName)));
  const validate = createSchemaValidator(schemas);
  const errors = [];
  for (const guide of outputs.guides) errors.push(...validate(guide, "guide.schema.json", guide.guide_id));
  for (const decision of outputs.decisions) errors.push(...validate(decision, "decision.schema.json", decision.decision_id));
  if (errors.length) throw new Error(`Schema 校验失败\n${errors.join("\n")}`);
}

async function main() {
  const check = process.argv.slice(2).includes("--check");
  const inputPaths = {
    cases: "content/cases.json",
    classifications: "content/classifications.json",
    fingerprints: "content/fingerprints.json",
    intents: "content/intents.json",
    casePromptVersions: "content/prompt-versions/cases.json",
    experimentPromptVersions: "content/prompt-versions/experiments.json",
    experimentVersions: "content/experiment-versions.json",
    runs: "content/runs.json",
    scoreRevisions: "content/score-revisions.json",
    conclusions: "generated/conclusions.json"
  };
  const entries = await Promise.all(Object.entries(inputPaths).map(async ([key, file]) => [key, await readJson(path.join(projectRoot, file))]));
  const input = Object.fromEntries(entries);
  const outputs = buildGuides(input);
  await validateSchemas(outputs);
  const outputValues = {
    "content/case-guides.json": outputs.guides,
    "content/decisions.json": outputs.decisions,
    "content/structure-guides.json": outputs.structureGuides,
    "content/methods.json": outputs.methods
  };
  const drift = [];
  for (const [file, value] of Object.entries(outputValues)) {
    const target = path.join(projectRoot, file);
    if (check) {
      if (!existsSync(target)) drift.push(`${file} 不存在`);
      else if (canonical(await readJson(target)) !== canonical(value)) drift.push(`${file} 与当前输入的重构结果不一致`);
    } else {
      await writeJson(target, value);
    }
  }
  const distribution = Object.fromEntries(["inferred", "tested", "observed"].map((level) => [level, outputs.decisions.filter((item) => item.evidence_level === level).length]));
  const inferredCases = new Set(outputs.decisions.filter((item) => item.evidence_level === "inferred").map((item) => item.case_id));
  const h1Coverage = Object.fromEntries(outputs.h1CaseIds.map((caseId) => {
    const cards = outputs.decisions.filter((item) => item.case_id === caseId);
    return [caseId, {
      total: cards.length,
      run_backed: cards.filter((item) => item.evidence_refs.some((itemRef) => itemRef.entity_type === "run")).length,
      evidence_levels: Object.fromEntries(["inferred", "tested", "observed"].map((level) => [level, cards.filter((item) => item.evidence_level === level).length]))
    }];
  }));
  const auditSample = selectAuditSampleIds(input.cases, outputs.h1CaseIds, outputs.structureGuides, input.classifications);
  const checks = [
    { id: "guides.cover_all_cases", pass: outputs.guides.length === input.cases.length && new Set(outputs.guides.map((item) => item.case_id)).size === input.cases.length },
    { id: "decisions.inferred_cover_all_cases", pass: inferredCases.size === input.cases.length },
    { id: "decisions.non_inferred_have_runs", pass: outputs.decisions.filter((item) => item.evidence_level !== "inferred").every((item) => item.evidence_refs.some((itemRef) => itemRef.entity_type === "run")) },
    { id: "h1.three_run_backed_cards_each", pass: Object.values(h1Coverage).every((item) => item.run_backed >= 3) },
    { id: "structure.dimensions_and_materials", pass: outputs.structureGuides.some((item) => item.intent_ids.includes("dimension_annotation")) && outputs.structureGuides.some((item) => item.intent_ids.includes("material_notes")) },
    { id: "methods.two_with_valid_cv", pass: outputs.methods.length === 2 && outputs.methods.every((method) => method.conclusion_version_ids.every((id) => outputs.validConclusionIds.includes(id))) },
    { id: "audit.sample_size", pass: auditSample.length === 20 }
  ];
  const report = {
    task_id: "T07",
    tool: "tools/build-guides.mjs",
    generator_version: generatorVersion,
    mode: check ? "check" : "write",
    generated_at: new Date().toISOString(),
    inputs: Object.fromEntries(Object.entries(input).map(([key, value]) => [key, { path: inputPaths[key], sha256: sha256(canonical(value)) }])),
    coverage: {
      cases: input.cases.length,
      case_guides: outputs.guides.length,
      inferred_case_coverage: inferredCases.size,
      h1_cases: outputs.h1CaseIds.length,
      h1_decisions: h1Coverage,
      structure_guides: outputs.structureGuides.length,
      methods: outputs.methods.length
    },
    decisions: {
      total: outputs.decisions.length,
      evidence_level_distribution: distribution,
      run_backed: outputs.decisions.filter((item) => item.evidence_refs.some((itemRef) => itemRef.entity_type === "run")).length
    },
    valid_conclusion_version_ids: outputs.validConclusionIds,
    audit: {
      sample_case_ids: auditSample,
      basis: "10 个 H1，加结构板、尺寸、材料证据案例，再按五类补足；只抽样核对规则与短证据，不展开全量提示词"
    },
    checks,
    drift,
    passed: checks.every((item) => item.pass) && drift.length === 0
  };
  await writeJson(path.join(projectRoot, "reports", "editorial-coverage.json"), report);
  console.log(JSON.stringify({
    mode: report.mode,
    case_guides: outputs.guides.length,
    inferred_case_coverage: inferredCases.size,
    h1_cases: outputs.h1CaseIds.length,
    decisions: report.decisions,
    structure_guides: outputs.structureGuides.length,
    methods: outputs.methods.length,
    audit_sample: auditSample.length,
    drift
  }, null, 2));
  for (const item of checks.filter((item) => !item.pass)) console.error(`FAIL ${item.id}`);
  for (const item of drift) console.error(`DRIFT ${item}`);
  if (!report.passed) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
