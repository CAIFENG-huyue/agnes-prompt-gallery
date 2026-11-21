import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const classifierVersion = "explainable-rules-v1";
export const outputPath = "content/classifications.json";

const categoryIds = new Set([
  "interface-document",
  "information-diagram",
  "graphic-communication",
  "scene-narrative",
  "subject-form"
]);

const reviewedOverrides = new Map([
  ["case-525", {
    primary_category_id: "subject-form",
    rationale: "时尚 campaign 只是风格修饰，全篇核心为单人身份和肖像质感，未设置标题或品牌传播槽位",
    evidence_excerpt: "close-up portrait；Preserve his natural facial identity（campaign 仅为风格修饰）"
  }],
  ["case-487", {
    primary_category_id: "information-diagram",
    rationale: "角色设定表只是跨镜头一致性参考，连续商业分镜及逐镜头对应才是核心",
    evidence_excerpt: "Fast cuts……Every shot builds……consistent across all shots（需逐镜头核对）"
  }]
]);

const rules = [
  {
    id: "R1.1",
    categoryId: "interface-document",
    pattern: /\bui\s*\/?\s*ux\b|user interface|interface design|interface mockup|mobile social media app|ui mockup|ui design system|ui_(?:elements|layout|overlays)|livestream ui|live stream interface|live-streaming e-commerce interface|video game screenshot|game screenshot mockup|用户界面|界面设计系统|ui设计系统|直播(?:间)?界面|中控界面/iu,
    rationale: "界面或 UI 直接规定了页面的阅读流、操作流或控件组织",
    confidence: 0.98
  },
  {
    id: "R1.2",
    categoryId: "interface-document",
    pattern: /landing page|webpage|web page|website (?:ui|design|homepage|layout)|homepage ui|mobile app (?:ui|interface|screen)|app interface|dashboard (?:ui|interface|design|layout)|navigation bar|status bar|reply bar|screenshot of a (?:douyin|tiktok|bilibili)|douyin live stream interface|x post page|小红书主页|朋友圈|推特主页|微博|直播截图|抖音[^。\n]{0,12}截图|抖音直播间|哔哩哔哩直播|社交截图|游戏截图|详情页|网页|网站页面|移动端|导航栏|状态栏|手机截图|内容截图/iu,
    rationale: "页面、导航或截图结构以阅读和操作路径为核心",
    confidence: 0.96
  },
  {
    id: "R1.3",
    categoryId: "interface-document",
    pattern: /magazine spread|book interior|document layout|newsletter layout|newspaper layout|resume layout|cv layout|publication layout|reading flow|prescription|cookbook page|textbook|campus daily newspaper|restaurant menu|handwritten notes|杂志内页|书籍内页|文档排版|报纸版面|阅读顺序|出版物版面|处方|药方|课本|教材|菜单|日报|老黄历|单日历|手写.*笔记|杂志风格双页/iu,
    rationale: "连续出版物或文档版面要求按阅读流组织内容",
    confidence: 0.94
  },
  {
    id: "R2.1",
    categoryId: "information-diagram",
    pattern: /infographic|information graphic|information visualization|data visualization|map infographic|food map|信息图|信息结构图|图解|结构板|关系图谱|关系图|手绘.{0,12}地图|地图.{0,20}标注|地图.{0,20}\d+\s*个|区域地图|图谱|详解图|讲解图|解说图/iu,
    rationale: "信息图或图解要求逐槽核对信息及绑定关系",
    confidence: 0.98
  },
  {
    id: "R2.2",
    categoryId: "information-diagram",
    pattern: /exploded (?:view|vertical|assembly)|character relationship map|relationship map|character sheet|character design sheet|design sheet|scene reference board|analysis sheet|pose-and-light|technical views|cutaway|blueprint|schematic|size arrows|dimension annotation|callout_labels|engineering callouts|technical callouts|annotation lines|pointer lines|设定资料|设定表|三面图|3面図|分解图|拆解图|尺寸标注|爆炸图/iu,
    rationale: "多视图、拆解、标注或分析槽位需要逐一对应",
    confidence: 0.97
  },
  {
    id: "R2.3",
    categoryId: "information-diagram",
    pattern: /timeline|storyboard|comic panels|comparison matrix|comparison table|highlight card|score breakdown|steps_count|numbered steps|numbered panels|\d+-panel|\d+ panel|panel collage|panel grid|vocabulary poster|learning card|nine-grid|时间线|时间轴|分镜生成|生成分镜|分镜脚本|多格分镜|对照矩阵|步骤图|学习卡|图鉴|九宫格/iu,
    rationale: "时间、步骤、分镜或对照结构以顺序和槽位绑定为核心",
    confidence: 0.96
  },
  {
    id: "R2.4",
    categoryId: "information-diagram",
    pattern: /avatar grid|portrait grid|character avatar grid|character portrait grid|grid of circular portraits|text labels centered below|text labels below each|portraits?[\s\S]{0,80}labels?|头像下面有|谥号和名字/iu,
    rationale: "重复头像或人物槽位必须与数量及文字标签绑定",
    confidence: 0.96
  },
  {
    id: "R2.5",
    categoryId: "information-diagram",
    pattern: /brand identity system presentation board|design grid|色彩规范|字体规范|最小使用尺寸|安全留白|错误使用示例|技术规格|工程信息/iu,
    rationale: "规范板将色彩、字体、尺寸或示例拆成可核对槽位",
    confidence: 0.94
  },
  {
    id: "R2.6",
    categoryId: "information-diagram",
    pattern: /exactly \d+ distinct piles|attach \d+ .*labels|each (?:column|panel|card|item)|line stickers|4 fashion items|4 款时尚单品|四款时尚单品|strict 50\/50 split|\d+ distinct full-body|\d+[- ]frame|\d+\s*套|四国|十国|三联|名牌标注姓名|依次展开|每一列|每个色号|按照\s*SSR\s+SR\s+R\s+分级|卡面设计和人物介绍|技能设计/iu,
    rationale: "每个重复单元都有明确数量、标签或说明的绑定要求",
    confidence: 0.93
  },
  {
    id: "R3.1",
    categoryId: "graphic-communication",
    pattern: /campaign poster|advertisement poster|advertising poster|travel poster|city poster|poster illustration|poster design|海报|宣传单|广告图|广告照片/iu,
    rationale: "海报或广告以标题、品牌和视觉注意层级为核心",
    confidence: 0.97
  },
  {
    id: "R3.2",
    categoryId: "graphic-communication",
    pattern: /thumbnail|book cover|album cover|magazine cover|flyer|banner design|promotional banner|typography poster|bold typography|logotype|logo design|brand identity|\bvi system\b|packaging (?:label|design|poster|branding)|product packaging label|typography integrated|app icon|封面|字体设计|字标|品牌设计|包装设计|vi 系统|视觉识别系统|印章设计|手举牌|t 恤图形|t-shirt graphic/iu,
    rationale: "封面、字标、品牌或横幅依靠传播层级组织视觉注意",
    confidence: 0.95
  },
  {
    id: "R3.3",
    categoryId: "graphic-communication",
    pattern: /campaign|product ad|high cta|main headline|giant headline|large, bold|bold retro typography|elegant typography|amazon a\+|主标题|大标题|品牌|卖点/iu,
    rationale: "广告文案、标题或品牌卖点构成主要传播层级",
    confidence: 0.92
  },
  {
    id: "R4.1",
    categoryId: "scene-narrative",
    pattern: /between two|two young|two focal subjects|two characters|multiple small|multiple characters|group of people|\bcrowd\b|battle|dogfight|chasing|trying to catch|interacting with|doing different activities|getting (?:her|his) hair styled|hairstylist|couple|spatial relationships?|双人|多人|群像|追逐|战斗|对决|枪战|奇幻对话|情侣|互动|逗弄一只/iu,
    rationale: "多个主体的动作、追逐或互动关系构成场景核心",
    confidence: 0.94
  },
  {
    id: "R4.2",
    categoryId: "scene-narrative",
    pattern: /cinematic .*scene|worldbuilding|storytelling|ancient imperial palace|grand, dark gothic hall|livestream|直播月下起舞|快递驿站|建筑空间|空间场景|室内空间|山水画卷|璀璨夜景|街景|地铁站台/iu,
    rationale: "空间重构、世界设定或情节动作优先于单主体外观",
    confidence: 0.91
  },
  {
    id: "R5.1",
    categoryId: "subject-form",
    pattern: /portrait|product|character|still life|fashion photograph|selfie|app icon|人像|肖像|写真|静物|商品|角色|主体|自拍/iu,
    rationale: "未命中更高优先级结构，核心落在主体外观、材质或风格保真",
    confidence: 0.84
  }
];

const fallbackRule = {
  id: "R5.0",
  categoryId: "subject-form",
  rationale: "未发现阅读流、逐槽结构、传播层级或多主体叙事，按主体造型兜底",
  confidence: 0.72
};

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

function excerptAround(text, index, length) {
  const start = Math.max(0, index - 45);
  const end = Math.min(text.length, index + length + 90);
  return compact(text.slice(start, end)).slice(0, 180);
}

function applyRule(text, rule) {
  const match = rule.pattern.exec(text);
  if (!match) return null;
  return {
    primary_category_id: rule.categoryId,
    confidence: rule.confidence,
    rationale: `${rule.id}：${rule.rationale}；命中“${compact(match[0]).slice(0, 60)}”`,
    evidence_excerpt: excerptAround(text, match.index, match[0].length)
  };
}

export function classifyText(title, prompt) {
  assert(categoryIds.has(fallbackRule.categoryId), "兜底分类不在五类中");
  const text = `${title}\n${prompt}`;
  for (const rule of rules) {
    const result = applyRule(text, rule);
    if (result) return result;
  }
  return {
    primary_category_id: fallbackRule.categoryId,
    confidence: fallbackRule.confidence,
    rationale: `${fallbackRule.id}：${fallbackRule.rationale}`,
    evidence_excerpt: compact(title || prompt).slice(0, 180)
  };
}

export function selectAuditSampleIds(cases, goldCaseIds) {
  const goldIds = new Set(goldCaseIds);
  const sampleSize = Math.ceil((cases.length - goldIds.size) * 0.1);
  return new Set(cases.filter((item) => !goldIds.has(item.case_id)).sort((left, right) => {
    const leftHash = createHash("sha256").update(`agnes-bench-t04-review-v1:${left.case_id}`).digest("hex");
    const rightHash = createHash("sha256").update(`agnes-bench-t04-review-v1:${right.case_id}`).digest("hex");
    return leftHash.localeCompare(rightHash) || compareCaseIds(left.case_id, right.case_id);
  }).slice(0, sampleSize).map((item) => item.case_id));
}

export async function buildClassifications() {
  const [cases, promptVersions, goldCaseIds, taxonomy] = await Promise.all([
    readJson(path.join(projectRoot, "content", "cases.json")),
    readJson(path.join(projectRoot, "content", "prompt-versions", "cases.json")),
    readJson(path.join(projectRoot, "content", "gold-case-ids.json")),
    readJson(path.join(projectRoot, "content", "taxonomy.json"))
  ]);
  assert(cases.length === 541, `案例数量应为 541，实际为 ${cases.length}`);
  assert(promptVersions.length === cases.length, "提示词版本数量与案例数量不一致");
  assert(taxonomy.categories.length === 5, "一级分类必须为五类");
  assert(taxonomy.categories.every((category) => categoryIds.has(category.category_id)), "taxonomy 含未知一级分类");
  const prompts = new Map(promptVersions.map((item) => [item.case_id, item.text]));
  const goldIds = new Set(goldCaseIds);
  const auditSampleIds = selectAuditSampleIds(cases, goldCaseIds);
  assert(auditSampleIds.size === 49, `非金标抽审样本应为 49 条，实际为 ${auditSampleIds.size}`);
  const classifications = [...cases].sort((a, b) => compareCaseIds(a.case_id, b.case_id)).map((item) => {
    assert(prompts.has(item.case_id), `缺少提示词：${item.case_id}`);
    const override = reviewedOverrides.get(item.case_id);
    const result = override ?? classifyText(item.title, prompts.get(item.case_id));
    assert(categoryIds.has(result.primary_category_id), `未知分类：${item.case_id}`);
    return {
      case_id: item.case_id,
      primary_category_id: result.primary_category_id,
      confidence: override ? 0.99 : result.confidence,
      rationale: override ? `人工复核修正：${result.rationale}` : result.rationale,
      evidence_excerpt: result.evidence_excerpt,
      classifier_version: classifierVersion,
      review_status: override || goldIds.has(item.case_id) || auditSampleIds.has(item.case_id) ? "reviewed" : "unreviewed"
    };
  });
  assert(new Set(classifications.map((item) => item.case_id)).size === 541, "分类结果 case_id 不唯一");
  return classifications;
}

async function main() {
  const args = process.argv.slice(2);
  assert(args.length === 0 || (args.length === 1 && args[0] === "--check"), "用法：node tools/classify-cases.mjs [--check]");
  const checkMode = args[0] === "--check";
  const classifications = await buildClassifications();
  const destination = path.join(projectRoot, outputPath);
  if (checkMode) {
    let actual;
    try {
      actual = await readFile(destination, "utf8");
    } catch (error) {
      throw new Error(`无法读取 ${outputPath}：${error.message}`);
    }
    assert(actual === serialize(classifications), `${outputPath} 与规则重建结果不一致，请重新运行 node tools/classify-cases.mjs`);
  } else {
    await writeFile(destination, serialize(classifications), "utf8");
  }
  const counts = Object.fromEntries([...categoryIds].map((id) => [id, classifications.filter((item) => item.primary_category_id === id).length]));
  console.log(`${checkMode ? "一致性检查通过" : "分类生成完成"}：${classifications.length} 条，每条唯一一级分类`);
  console.log(JSON.stringify(counts));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
