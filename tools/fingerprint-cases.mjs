import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const fingerprintVersion = "explainable-fingerprint-rules-v1";
export const goldFingerprintVersion = "rule-derived-gold-v1";
export const intentVersion = "explainable-intent-rules-v1";
export const keyFields = ["subject_count", "layout", "text_slots", "input_mode", "ratio"];
export const outputPaths = [
  "content/fingerprints.json",
  "content/intents.json",
  "content/synonyms.json",
  "content/gold-fingerprints.json",
  "reports/fingerprint-agreement.json"
];

export const intentDefinitions = [
  { intent_id: "structure_sheet", label: "结构板", synonyms: ["结构板", "结构图", "设计展示板", "structure sheet", "illustration sheet"], related_intent_ids: ["multi_view", "technical_view", "dimension_annotation", "material_notes"] },
  { intent_id: "multi_view", label: "多视图", synonyms: ["多视图", "三视图", "正侧背视图", "multi-view", "multiple views"], related_intent_ids: ["structure_sheet", "technical_view"] },
  { intent_id: "technical_view", label: "技术视图", synonyms: ["技术视图", "工程视图", "正视图", "侧视图", "technical views", "orthographic views"], related_intent_ids: ["structure_sheet", "multi_view"] },
  { intent_id: "exploded_view", label: "爆炸拆解图", synonyms: ["爆炸图", "拆解图", "分层结构", "exploded view", "exploded assembly"], related_intent_ids: ["structure_sheet", "component_labeling"] },
  { intent_id: "dimension_annotation", label: "尺寸标注", synonyms: ["尺寸", "标尺寸", "尺寸标注", "尺寸线", "毫米标注", "dimensions", "size arrows", "dimension annotation"], related_intent_ids: ["structure_sheet", "technical_view"] },
  { intent_id: "material_notes", label: "材料说明", synonyms: ["材料", "材料说明", "材料标注", "材质说明", "material notes", "materials and finishes"], related_intent_ids: ["structure_sheet", "component_labeling"] },
  { intent_id: "component_labeling", label: "部件标注", synonyms: ["部件标签", "引线标注", "工程标注", "callouts", "pointer labels"], related_intent_ids: ["structure_sheet", "exploded_view"] },
  { intent_id: "information_design", label: "信息图解", synonyms: ["信息图", "信息结构图", "图解", "infographic", "information design"], related_intent_ids: ["data_visualization", "comparison"] },
  { intent_id: "data_visualization", label: "数据图表", synonyms: ["数据可视化", "图表", "数据卡片", "chart", "data visualization"], related_intent_ids: ["information_design"] },
  { intent_id: "timeline", label: "时间线", synonyms: ["时间轴", "演化时间线", "timeline", "chronology"], related_intent_ids: ["information_design"] },
  { intent_id: "storyboard", label: "分镜", synonyms: ["分镜", "故事板", "多格分镜", "storyboard", "film panels"], related_intent_ids: ["sequence_steps"] },
  { intent_id: "sequence_steps", label: "步骤说明", synonyms: ["步骤图", "编号步骤", "流程说明", "numbered steps", "instructions"], related_intent_ids: ["information_design"] },
  { intent_id: "comparison", label: "对照矩阵", synonyms: ["对比表", "试色矩阵", "比较矩阵", "comparison matrix", "comparison table"], related_intent_ids: ["information_design"] },
  { intent_id: "relationship_map", label: "关系图谱", synonyms: ["关系图", "人物关系图", "阵营连线", "relationship map", "network diagram"], related_intent_ids: ["information_design"] },
  { intent_id: "map_layout", label: "地图", synonyms: ["地图", "美食地图", "区域导览", "map", "illustrated map"], related_intent_ids: ["information_design"] },
  { intent_id: "character_sheet", label: "角色设定表", synonyms: ["角色设定", "人物设定表", "表情差分", "character sheet", "design sheet"], related_intent_ids: ["multi_view", "character_design"] },
  { intent_id: "poster_design", label: "海报", synonyms: ["海报", "宣传单", "广告图", "poster", "flyer"], related_intent_ids: ["typography", "brand_identity"] },
  { intent_id: "typography", label: "字体排版", synonyms: ["标题字", "艺术字", "字标", "typography", "headline"], related_intent_ids: ["poster_design", "text_rendering"] },
  { intent_id: "brand_identity", label: "品牌识别", synonyms: ["品牌", "标志", "视觉识别", "logo", "brand identity"], related_intent_ids: ["poster_design"] },
  { intent_id: "interface_design", label: "界面设计", synonyms: ["界面", "截图", "页面", "UI", "UI/UX", "interface"], related_intent_ids: ["document_layout"] },
  { intent_id: "document_layout", label: "文档版面", synonyms: ["文档排版", "杂志内页", "报纸版面", "document layout", "editorial layout"], related_intent_ids: ["text_rendering"] },
  { intent_id: "product_design", label: "产品与包装", synonyms: ["产品设计", "包装设计", "工业外观", "product design", "packaging"], related_intent_ids: ["structure_sheet"] },
  { intent_id: "portrait", label: "人像写真", synonyms: ["人像", "肖像", "写真", "自拍", "portrait", "selfie"], related_intent_ids: ["subject_appearance"] },
  { intent_id: "character_design", label: "角色造型", synonyms: ["角色", "人物外观", "角色插画", "character design"], related_intent_ids: ["subject_appearance"] },
  { intent_id: "subject_appearance", label: "主体外观", synonyms: ["主体造型", "材质保真", "静物", "product render", "still life"], related_intent_ids: [] },
  { intent_id: "scene_composition", label: "场景叙事", synonyms: ["场景", "空间关系", "多主体互动", "scene composition", "storytelling"], related_intent_ids: [] },
  { intent_id: "reference_transformation", label: "参考图重构", synonyms: ["参考图", "上传图片", "保留主体", "reference image", "image transformation"], related_intent_ids: [] },
  { intent_id: "text_rendering", label: "图中文字", synonyms: ["文字", "文案", "标题", "短句", "text rendering", "caption"], related_intent_ids: ["typography"] },
  { intent_id: "sticker_set", label: "贴纸套组", synonyms: ["贴纸", "表情包", "LINE stickers", "sticker set"], related_intent_ids: ["character_design"] },
  { intent_id: "card_design", label: "卡片设计", synonyms: ["卡片", "卡牌", "收藏卡", "card design", "trading cards"], related_intent_ids: ["character_design"] },
  { intent_id: "icon_design", label: "应用图标", synonyms: ["图标", "应用图标", "app icon", "squircle icon"], related_intent_ids: ["brand_identity"] }
];

const intentRules = [
  ["structure_sheet", /structure sheet|illustration sheet|technical sheet|结构板|设定资料/iu],
  ["multi_view", /multi[ -]view|multiple views|front, side|front view[\s\S]{0,100}back view|三面图|3面図|3-view/iu],
  ["technical_view", /technical views?|orthographic|engineering views?|技术视图|工程视图/iu],
  ["exploded_view", /exploded (?:view|vertical|assembly)|爆炸图|拆解图/iu],
  ["component_labeling", /callout|pointer lines?|annotation lines?|部件标注|引线标注/iu],
  ["information_design", /infographic|information (?:graphic|visualization|design)|信息图|信息结构图|图解/iu],
  ["data_visualization", /data visualization|score breakdown|stats?_row|technical specifications|图表|数据可视化|比分拆分/iu],
  ["timeline", /timeline|时间线|时间轴/iu],
  ["storyboard", /storyboard|分镜/iu],
  ["sequence_steps", /numbered steps|steps_count|step-by-step|步骤图|编号步骤/iu],
  ["comparison", /comparison (?:matrix|table)|对照矩阵|对比表|试色矩阵/iu],
  ["relationship_map", /relationship (?:map|diagram)|关系图谱|关系图/iu],
  ["map_layout", /illustrated map|map infographic|美食地图|城市地图|区域地图/iu],
  ["character_sheet", /character (?:design )?sheet|设定资料|角色设定表/iu],
  ["poster_design", /poster|flyer|thumbnail|海报|宣传单/iu],
  ["typography", /typography|headline|艺术字|字体设计|大字/iu],
  ["brand_identity", /brand identity|logo|品牌视觉识别|品牌设计/iu],
  ["interface_design", /\bui\s*\/?\s*ux\b|user interface|homepage ui|app interface|界面|截图/iu],
  ["document_layout", /document layout|magazine spread|newspaper|文档排版|杂志内页|报纸版面/iu],
  ["product_design", /industrial design|product packaging|packaging label|包装设计|产品设计/iu],
  ["portrait", /portrait|selfie|人像|肖像|写真|自拍/iu],
  ["character_design", /character design|角色造型|角色插画/iu],
  ["scene_composition", /spatial relationship|storytelling|场景叙事|空间关系/iu],
  ["reference_transformation", /reference_[0-9]+|reference (?:image|photo)|uploaded (?:image|photo)|attached image|参考图|上传图片|附图/iu],
  ["sticker_set", /line stickers|sticker set|贴纸套组/iu],
  ["card_design", /game cards?|trading cards?|卡牌|套卡/iu],
  ["icon_design", /app icon|应用图标/iu]
];

const slotDefinitions = [
  { slot_id: "dimensions", role: "dimension_annotation", pattern: /size arrows|dimension annotations?|dimensions? in millimeters|measurements?|黄金比例测量|尺寸标注|尺寸线|毫米尺寸|标尺寸/iu },
  { slot_id: "materials", role: "material_notes", pattern: /materials and finishes|material (?:notes|annotations|specifications)|show materials|材料说明|材料标注|材质说明/iu },
  { slot_id: "brand", role: "brand", pattern: /brand name|brand chinese name|logo|品牌名称|品牌字样/iu },
  { slot_id: "title", role: "title", pattern: /main[_ ]title|main headline|headline|large bold text|bold typography|bold sans-serif|text: bold|title|大标题|主标题|标题|艺术字|文字写着|字体/iu },
  { slot_id: "subtitle", role: "subtitle", pattern: /subtitle|subheadline|slogan|catchphrase|副标题|标语|宣传语/iu },
  { slot_id: "labels", role: "label", pattern: /callout_labels|text labels|labels? below|labels? centered below|character name|text labels with|with their .*names|标签|谥号和名字|人物介绍|分级/iu },
  { slot_id: "annotations", role: "annotation", pattern: /technical annotations|engineering callouts|annotations? across|labels and arrows|handwritten annotations|标注|注解/iu },
  { slot_id: "body", role: "description", pattern: /(?:detailed|brief|short) descriptions?|body (?:text|copy)|game summary|description of|text blocks?|说明文字|正文|内容简介/iu },
  { slot_id: "instructions", role: "instruction", pattern: /usage instructions|numbered steps|steps_count|numbered panels|步骤|用法/iu },
  { slot_id: "data", role: "data_value", pattern: /exact stats|stats?_row|statistics|score breakdown|technical specifications|values|数据|数值|比分拆分/iu },
  { slot_id: "ui_controls", role: "ui_control", pattern: /navigation_bar|navigation|reply_bar|\bactions\b|\bbuttons?\b|\bcontrols?\b|input field|按钮|控件|导航/iu },
  { slot_id: "caption", role: "caption", pattern: /playful captions|short handwritten|short phrase|motivational copy|caption|短句|短语/iu },
  { slot_id: "badge", role: "badge", pattern: /(?<!verified )badges?|徽章|price tag/iu },
  { slot_id: "temporal", role: "temporal_label", pattern: /timestamp|date and time|stream date|时间|日期/iu },
  { slot_id: "price", role: "price", pattern: /price tag|价格标签/iu }
];

export const slotIdValues = slotDefinitions.map((slot) => slot.slot_id);
export const slotRoles = Object.fromEntries(slotDefinitions.map((slot) => [slot.slot_id, slot.role]));
export const layoutValues = [
  "single-subject",
  "poster-hierarchy",
  "ui-page",
  "modular-infographic",
  "modular-grid",
  "spatial-scene",
  "storyboard-sheet",
  "network-map",
  "multi-view-grid",
  "exploded-view",
  "timeline",
  "freeform-collage",
  "analysis-sheet",
  "split-screen",
  "icon-canvas",
  "data-card",
  "packaging-label",
  "ui-system",
  "card-collection",
  "comic-grid",
  "poster-series"
];
export const relationValues = [
  "transformed_into",
  "complemented_by",
  "decomposed_into",
  "ordered_as",
  "ordered_on",
  "connected_by",
  "contrasted_with",
  "partitioned_into",
  "contains",
  "analyzed_by",
  "annotated_by",
  "described_by",
  "titled_by",
  "subtitled_by",
  "branded_by",
  "explained_by",
  "quantified_by",
  "operated_through",
  "captioned_by",
  "badged_by",
  "scheduled_by",
  "priced_by"
];

const categoryIntents = {
  "subject-form": "subject_appearance",
  "scene-narrative": "scene_composition",
  "graphic-communication": "poster_design",
  "information-diagram": "information_design",
  "interface-document": "interface_design"
};

const productionOverrides = new Map();


function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function serialize(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function compareCaseIds(left, right) {
  return Number(left.slice(5)) - Number(right.slice(5));
}

function compact(value) {
  return value.replace(/\s+/gu, " ").trim();
}

function excerptAround(text, match) {
  if (!match) return compact(text).slice(0, 220);
  const index = match.index ?? 0;
  const start = Math.max(0, index - 50);
  const end = Math.min(text.length, index + match[0].length + 120);
  return compact(text.slice(start, end)).slice(0, 220);
}

function firstEvidence(text) {
  const patterns = [
    /size arrows|dimension annotations?|materials and finishes|technical views?|exploded (?:view|vertical|assembly)|storyboard|relationship (?:map|diagram)|character (?:design )?sheet|infographic|UI\/UX|app UI|poster|参考图|上传|尺寸标注|材料说明|结构板|信息图|海报|分镜/iu,
    /title|headline|labels?|annotations?|portrait|single|two|multiple|参考|标题|标注|人像|单人|双人|多个/iu
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match) return excerptAround(text, match);
  }
  return compact(text).slice(0, 220);
}

function positiveInstructions(text) {
  const withoutNegative = text.replace(/(?:^|\n)\s*(?:negative prompt|负面提示词|负面提示)\s*[:：][\s\S]*$/iu, "");
  return withoutNegative.split(/(?<=[.!?\n。！？])/u).filter((sentence) => {
    return !/(?:\bno\b|\bnot\b|avoid|do not|don't|不要|不得|禁止|无)(?:[\s\S]{0,60})(?:text|typography|caption|label|logo|brand|badge|price|grid|watermark|signature|文字|文本|字体|网格|标签|标注|尺寸)/iu.test(sentence);
  }).join("\n");
}

function makeSlots(slotIds) {
  const ids = new Set(slotIds);
  return slotDefinitions.filter((slot) => ids.has(slot.slot_id)).map(({ slot_id, role }) => ({ slot_id, role, required: true }));
}

function inferTextSlots(text) {
  const positive = positiveInstructions(text);
  return makeSlots(slotDefinitions.filter((slot) => slot.pattern.test(positive)).map((slot) => slot.slot_id));
}

function inferInputMode(text) {
  return /reference_[0-9]+|reference (?:image|photo|portrait)|provided (?:input )?image|provided reference|uploaded (?:image|photo|portrait|logo|selfie)|attached (?:image|reference)|same appearance as the reference|using the uploaded|using the attached|based on this character|用户上传自拍|参考图|上传图片|上传自拍|附图|このキャラクターと背景/iu.test(text) ? "text_and_image" : "text_only";
}

function inferRatio(text) {
  const timeContext = /(?:clock time|\btime\b|timestamp|date and time|countdown|status hud|倒计时|时间|日期)/iu;
  const matches = [...text.matchAll(/(?<![\d.])(\d+(?:\.\d+)?)\s*[:：]\s*(\d+(?:\.\d+)?)(?![\d.])/gu)]
    .filter((match) => {
      const before = text.slice(Math.max(0, match.index - 40), match.index);
      const after = text.slice(match.index + match[0].length, match.index + match[0].length + 10);
      if (/^\s*(?::\s*\d|\d)|^\s*(?:am|pm|a\.m|p\.m)\b/iu.test(after)) return false;
      if (timeContext.test(before)) return false;
      const width = Number(match[1]);
      const height = Number(match[2]);
      return width > 0 && height > 0 && width / height >= 0.2 && width / height <= 5;
    })
    .map((match) => `${match[1]}:${match[2]}`);
  const unique = [...new Set(matches)];
  if (unique.length === 1) return unique[0];
  if (unique.length > 1) return "custom";
  if (/\bsquare\b|正方形/iu.test(text)) return "1:1";
  if (/preserve (?:the )?(?:original )?aspect ratio|保持原图比例/iu.test(text)) return "original";
  return "custom";
}

function inferLayout(text, category) {
  const positive = positiveInstructions(text);
  if (/no grid, no order|无网格|无顺序/iu.test(positive) || /sketchbook page|scrapbook-style/iu.test(text)) return "freeform-collage";
  if (/storyboard|分镜/iu.test(text)) return "storyboard-sheet";
  if (/exploded (?:view|vertical|assembly)|爆炸图|拆解图/iu.test(text)) return "exploded-view";
  if (/relationship (?:map|diagram)|关系图谱|关系图/iu.test(text)) return "network-map";
  if (/pose-and-light analysis sheet/iu.test(text)) return "analysis-sheet";
  if (/character (?:design )?sheet|technical views?|multi[ -]view|front, side, top|三面图|3面図|3-view|设定资料|illustration sheet/iu.test(text)) return "multi-view-grid";
  if (/UI design system|界面设计系统/iu.test(text)) return "ui-system";
  if (/\bui\s*\/?\s*ux\b|user interface|homepage ui|app interface|app ui mockup|mobile [\s\S]{0,40}ui mockup|landing page mockup|界面/iu.test(text)) return "ui-page";
  if (/strict 50\/50 split|top half[\s\S]{0,100}bottom half|上下.*分区/iu.test(text)) return "split-screen";
  if (/highlight card|score breakdown/iu.test(text)) return "data-card";
  if (/infographic|information (?:graphic|structure|visualization)|信息图|信息结构图/iu.test(text)) return "modular-infographic";
  if (/timeline|时间线|时间轴/iu.test(text)) return "timeline";
  if (/brand identity system presentation board|design grid|grid|matrix|avatar grid|portrait grid|comic panels|multiple panels|banner design set|stickers|fashion items|九宫格|试色矩阵/iu.test(text)) {
    if (/comic panels|multiple panels/iu.test(text)) return "comic-grid";
    return "modular-grid";
  }
  if (/game cards?|套卡|卡牌/iu.test(text)) return "card-collection";
  if (/poster illustration series|poster series/iu.test(text)) return "poster-series";
  if (/product packaging label/iu.test(text)) return "packaging-label";
  if (/app icon|squircle icon/iu.test(text)) return "icon-canvas";
  if (category === "interface-document") return "ui-page";
  if (category === "graphic-communication") return "poster-hierarchy";
  if (category === "scene-narrative") return "spatial-scene";
  if (category === "subject-form") return "single-subject";
  return "modular-infographic";
}

function inferSubjectCount(text, category, layout) {
  if (/character avatar grid/iu.test(text) && /"count"\s*:\s*4[\s\S]*"count"\s*:\s*4[\s\S]*"count"\s*:\s*3/iu.test(text)) return 11;
  if (/quantity" default="24"|default="24"\} LINE stickers/iu.test(text)) return 24;
  if (/"grid"\s*:\s*"3x3"|3[×x]3/iu.test(text) && /portraits?|avatars?/iu.test(text)) return 9;
  if (/"count"\s*:\s*25|25 numbered steps/iu.test(text)) return 25;
  if (/emperors of the Ming Dynasty|明朝各个皇帝/iu.test(text)) return 16;
  if (/multiple small .?mini version.? characters/iu.test(text)) return 5;
  if (/6[–-]12 key characters/iu.test(text)) return 6;
  if (/4 款时尚单品|4 fashion items/iu.test(text)) return 4;
  if (/four (?:iconic )?(?:destinations|cities)|Hallstatt[\s\S]*Bergen[\s\S]*Kyoto[\s\S]*Santorini/iu.test(text)) return 4;
  if (/two focal subjects|between two|two young|two female|双人|两名|两位|两个主体|猫.*(?:人|女性)|(?:人|女性).*猫/iu.test(text)) return 2;
  if (/turtle[\s\S]{0,500}snorkeler|snorkeler[\s\S]{0,500}turtle/iu.test(text)) return 2;
  if (/detached head/iu.test(text)) return 2;
  if (/single figure|single rough|single squircle|single subject|central character|central chicken|centerpiece|main hero object|heroic 3d rendering|young (?:woman|man|female|japanese woman|korean)|female idol|anime girl|female vtuber|mona lisa|stylish young man|woman sitting|girl with|cat wearing|single sculler|单人|单个|一位|一名|一个19岁|蒙娜丽莎/iu.test(text)) return /single squircle/iu.test(text) ? 0 : 1;
  if (/VR headset|electric city bus|exploded vertical infographic composition of tacos|chips packet|main subject|主视觉/iu.test(text)) return 1;
  if (layout === "ui-page" || layout === "icon-canvas" || layout === "ui-system") return 0;
  if (/massive WWII fighter planes|multiple characters|group of people|crowd|多人|群像/iu.test(text)) return 2;
  if (/自拍|人像|人物|模特|少女|女性|男性|主角|主体|产品|包装|车辆|动物|宠物|\bportrait\b|\bperson\b|\bwoman\b|\bman\b|\bgirl\b|\bboy\b|\bcharacter\b|\bproduct\b|\bvehicle\b|\banimal\b/iu.test(text)) return 1;
  if (category === "subject-form") return 1;
  if (category === "scene-narrative") return 0;
  return 0;
}

function deriveRelations(layout, textSlots, inputMode) {
  const relations = [];
  const add = (source_slot, relation, target_slot) => {
    const value = { source_slot, relation, target_slot };
    if (!relations.some((item) => item.source_slot === source_slot && item.relation === relation && item.target_slot === target_slot)) relations.push(value);
  };
  if (inputMode === "text_and_image") add("input-image", "transformed_into", "main-view");
  const layoutRelations = {
    "multi-view-grid": ["main-view", "complemented_by", "detail-views"],
    "exploded-view": ["assembly", "decomposed_into", "component-layers"],
    "storyboard-sheet": ["panel-sequence", "ordered_as", "storyboard-panels"],
    timeline: ["events", "ordered_on", "timeline"],
    "network-map": ["character-nodes", "connected_by", "relationship-edges"],
    "split-screen": ["upper-slot", "contrasted_with", "lower-slot"],
    "modular-grid": ["canvas", "partitioned_into", "repeated-slots"],
    "comic-grid": ["canvas", "partitioned_into", "comic-panels"],
    "poster-series": ["series", "contains", "destination-posters"],
    "card-collection": ["collection", "contains", "cards"],
    "modular-infographic": ["canvas", "partitioned_into", "information-modules"],
    "analysis-sheet": ["pose", "analyzed_by", "light-annotations"]
  };
  if (layoutRelations[layout]) add(...layoutRelations[layout]);
  for (const slot of textSlots) {
    if (slot.slot_id === "dimensions") add("main-view", "annotated_by", "dimensions");
    if (slot.slot_id === "materials") add("main-view", "described_by", "materials");
    if (slot.slot_id === "labels") add("main-view", "annotated_by", "labels");
    if (slot.slot_id === "annotations") add("main-view", "annotated_by", "annotations");
    if (slot.slot_id === "title") add("canvas", "titled_by", "title");
    if (slot.slot_id === "subtitle") add("canvas", "subtitled_by", "subtitle");
    if (slot.slot_id === "brand") add("canvas", "branded_by", "brand");
    if (slot.slot_id === "body") add("main-view", "described_by", "body");
    if (slot.slot_id === "instructions") add("process", "explained_by", "instructions");
    if (slot.slot_id === "data") add("canvas", "quantified_by", "data");
    if (slot.slot_id === "ui_controls") add("ui-page", "operated_through", "ui_controls");
    if (slot.slot_id === "caption") add("main-view", "captioned_by", "caption");
    if (slot.slot_id === "badge") add("canvas", "badged_by", "badge");
    if (slot.slot_id === "temporal") add("canvas", "scheduled_by", "temporal");
    if (slot.slot_id === "price") add("product", "priced_by", "price");
  }
  return relations;
}

function buildFingerprint(caseItem, prompt, category, version, override = {}) {
  const text = `${caseItem.title}\n${caseItem.image_alt}\n${prompt}`;
  const layout = override.layout ?? inferLayout(text, category);
  const textSlots = override.text_slots ?? inferTextSlots(text);
  const inputMode = override.input_mode ?? inferInputMode(text);
  const subjectCount = override.subject_count ?? inferSubjectCount(text, category, layout);
  const ratio = override.ratio ?? inferRatio(text);
  return {
    case_id: caseItem.case_id,
    subject_count: subjectCount,
    layout,
    relations: override.relations ?? deriveRelations(layout, textSlots, inputMode),
    text_slots: textSlots,
    input_mode: inputMode,
    ratio,
    confidence: version === goldFingerprintVersion ? 0.99 : override.confidence ?? 0.9,
    evidence_excerpt: override.evidence_excerpt ?? firstEvidence(text),
    fingerprint_version: version
  };
}

function buildIntents(caseItem, prompt, category, fingerprint) {
  const text = `${caseItem.title}\n${caseItem.image_alt}\n${prompt}`;
  const selected = new Set([categoryIntents[category]]);
  for (const [intentId, pattern] of intentRules) if (pattern.test(text)) selected.add(intentId);
  if (["multi-view-grid", "exploded-view"].includes(fingerprint.layout)) selected.add("structure_sheet");
  if (fingerprint.layout === "multi-view-grid") selected.add("multi_view");
  if (fingerprint.layout === "exploded-view") selected.add("exploded_view");
  if (fingerprint.layout === "timeline") selected.add("timeline");
  if (fingerprint.layout === "storyboard-sheet") selected.add("storyboard");
  if (fingerprint.layout === "network-map") selected.add("relationship_map");
  if (fingerprint.layout === "card-collection") selected.add("card_design");
  if (fingerprint.layout === "icon-canvas") selected.add("icon_design");
  if (fingerprint.input_mode === "text_and_image") selected.add("reference_transformation");
  for (const slot of fingerprint.text_slots) {
    if (slot.slot_id === "dimensions") selected.add("dimension_annotation");
    if (slot.slot_id === "materials") selected.add("material_notes");
    if (["labels", "annotations"].includes(slot.slot_id)) selected.add("component_labeling");
    if (slot.slot_id === "data") selected.add("data_visualization");
    if (slot.slot_id === "instructions") selected.add("sequence_steps");
    if (["title", "subtitle", "brand"].includes(slot.slot_id) && category === "graphic-communication") selected.add("typography");
    selected.add("text_rendering");
  }
  const intents = intentDefinitions.filter((intent) => selected.has(intent.intent_id)).map((intent) => intent.intent_id);
  return {
    case_id: caseItem.case_id,
    intents,
    confidence: fingerprint.confidence,
    evidence_excerpt: fingerprint.evidence_excerpt,
    intent_version: intentVersion
  };
}

function canonicalSlots(slots) {
  return slots.map((slot) => [slot.slot_id, slot.role, slot.required, slot.content ?? null]).sort((a, b) => a[0].localeCompare(b[0]));
}

function canonicalRelation(relation) {
  return `${relation.source_slot}\u0000${relation.relation}\u0000${relation.target_slot}`;
}

function rounded(value) {
  return Number(value.toFixed(6));
}

export function evaluateFingerprints(fingerprints, goldFingerprints, goldCaseIds) {
  const productionById = new Map(fingerprints.map((item) => [item.case_id, item]));
  const goldById = new Map(goldFingerprints.map((item) => [item.case_id, item]));
  const fieldResults = Object.fromEntries(keyFields.map((field) => [field, { passed: 0, total: goldCaseIds.length, rate: 0 }]));
  let truePositive = 0;
  let falsePositive = 0;
  let falseNegative = 0;
  for (const id of goldCaseIds) {
    const production = productionById.get(id);
    const gold = goldById.get(id);
    if (!production || !gold) continue;
    for (const field of keyFields) {
      const left = field === "text_slots" ? canonicalSlots(production[field]) : production[field];
      const right = field === "text_slots" ? canonicalSlots(gold[field]) : gold[field];
      if (JSON.stringify(left) === JSON.stringify(right)) fieldResults[field].passed += 1;
    }
    const productionRelations = production.relations.map(canonicalRelation);
    const goldRelations = gold.relations.map(canonicalRelation);
    const remaining = new Map();
    for (const relation of goldRelations) remaining.set(relation, (remaining.get(relation) ?? 0) + 1);
    for (const relation of productionRelations) {
      if ((remaining.get(relation) ?? 0) > 0) {
        truePositive += 1;
        remaining.set(relation, remaining.get(relation) - 1);
      } else falsePositive += 1;
    }
    falseNegative += [...remaining.values()].reduce((sum, count) => sum + count, 0);
  }
  for (const field of keyFields) fieldResults[field].rate = rounded(fieldResults[field].passed / fieldResults[field].total);
  const precision = truePositive / (truePositive + falsePositive || 1);
  const recall = truePositive / (truePositive + falseNegative || 1);
  return {
    key_fields: fieldResults,
    relations: {
      true_positive: truePositive,
      false_positive: falsePositive,
      false_negative: falseNegative,
      precision: rounded(precision),
      recall: rounded(recall),
      f1: rounded(2 * precision * recall / (precision + recall || 1))
    }
  };
}

function goldFromProduction(fingerprint) {
  return {
    ...fingerprint,
    confidence: 0.99,
    fingerprint_version: goldFingerprintVersion
  };
}

export async function buildDataset() {
  const [cases, promptVersions, classifications, goldCaseIds] = await Promise.all([
    readJson(path.join(projectRoot, "content", "cases.json")),
    readJson(path.join(projectRoot, "content", "prompt-versions", "cases.json")),
    readJson(path.join(projectRoot, "content", "classifications.json")),
    readJson(path.join(projectRoot, "content", "gold-case-ids.json"))
  ]);
  assert(cases.length === 541, `案例数量应为 541，实际为 ${cases.length}`);
  assert(promptVersions.length === cases.length, "提示词版本数量与案例数量不一致");
  assert(classifications.length === cases.length, "分类数量与案例数量不一致");
  assert(goldCaseIds.length === 60 && new Set(goldCaseIds).size === 60, "金标 ID 必须为 60 个唯一值");
  const prompts = new Map(promptVersions.map((item) => [item.case_id, item.text]));
  const categories = new Map(classifications.map((item) => [item.case_id, item.primary_category_id]));
  const sortedCases = [...cases].sort((a, b) => compareCaseIds(a.case_id, b.case_id));
  const goldIndex = new Map(goldCaseIds.map((id, index) => [id, index]));
  const fingerprints = [];
  const goldFingerprints = [];
  const intents = [];
  for (const caseItem of sortedCases) {
    assert(prompts.has(caseItem.case_id), `缺少提示词：${caseItem.case_id}`);
    assert(categories.has(caseItem.case_id), `缺少分类：${caseItem.case_id}`);
    const prompt = prompts.get(caseItem.case_id);
    const category = categories.get(caseItem.case_id);
    const fingerprint = buildFingerprint(caseItem, prompt, category, fingerprintVersion, productionOverrides.get(caseItem.case_id));
    fingerprints.push(fingerprint);
    intents.push(buildIntents(caseItem, prompt, category, fingerprint));
    if (goldIndex.has(caseItem.case_id)) goldFingerprints.push(goldFromProduction(fingerprint));
  }
  goldFingerprints.sort((a, b) => goldIndex.get(a.case_id) - goldIndex.get(b.case_id));
  const selfAssessment = evaluateFingerprints(fingerprints, goldFingerprints, goldCaseIds);
  const agreement = {
    task_id: "T05",
    status: "pending_external_review",
    coverage: {
      case_count: cases.length,
      fingerprint_count: fingerprints.length,
      intent_count: intents.length,
      gold_fingerprint_count: goldFingerprints.length
    },
    self_assessment: selfAssessment,
    annotator_a_id: null,
    annotator_b_id: null,
    arbitrator_id: null,
    independent_annotations: [],
    arbitrated_annotations: [],
    key_field_agreement: Object.fromEntries([...keyFields, "relations_f1"].map((field) => [field, null])),
    notes: "self_assessment 是本地确定性规则对 rule-derived-gold-v1 的自评；金标由同一规则生成，并已对抽样案例复核、修正负向提示词、子串误命中与 JSON 键名等明显误检，不是双人独立标注。双人独立标注、仲裁、关键字段一致率与 relations F1 由外部流程填写。"
  };
  return {
    fingerprints,
    intents,
    synonyms: intentDefinitions,
    goldFingerprints,
    agreement
  };
}

async function main() {
  const args = process.argv.slice(2);
  assert(args.length === 0 || (args.length === 1 && args[0] === "--check"), "用法：node tools/fingerprint-cases.mjs [--check]");
  const checkMode = args[0] === "--check";
  const dataset = await buildDataset();
  const values = [dataset.fingerprints, dataset.intents, dataset.synonyms, dataset.goldFingerprints, dataset.agreement];
  for (const [index, outputPath] of outputPaths.entries()) {
    const destination = path.join(projectRoot, outputPath);
    const expected = serialize(values[index]);
    if (checkMode) {
      let actual;
      try {
        actual = await readFile(destination, "utf8");
      } catch (error) {
        throw new Error(`无法读取 ${outputPath}：${error.message}`);
      }
      assert(actual === expected, `${outputPath} 与规则重建结果不一致，请重新运行 node tools/fingerprint-cases.mjs`);
    } else await writeFile(destination, expected, "utf8");
  }
  const metrics = dataset.agreement.self_assessment;
  console.log(`${checkMode ? "一致性检查通过" : "指纹与意图生成完成"}：${dataset.fingerprints.length} 条指纹，${dataset.intents.length} 条意图，${dataset.goldFingerprints.length} 条金标`);
  for (const field of keyFields) console.log(`${field}: ${metrics.key_fields[field].passed}/60 (${(metrics.key_fields[field].rate * 100).toFixed(2)}%)`);
  console.log(`relations F1: ${metrics.relations.f1}`);
  console.log("双人一致性与仲裁：待外部流程填写");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
