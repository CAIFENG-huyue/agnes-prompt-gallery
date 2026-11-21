import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { searchIndex } from "../src/lib/search/engine.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distRoot = process.argv[2]
  ? path.resolve(projectRoot, process.argv[2])
  : path.join(projectRoot, "dist");
const hardQuery = "企鹅饼干礼盒结构板，带尺寸和材料说明";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function escapeHtml(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function articleFor(html, caseId) {
  const match = html.match(new RegExp(`<article class="discovery-card" data-case-id="${caseId}">([\\s\\S]*?)</article>`));
  assert(match, `首页缺少 ${caseId} 的静态结果卡`);
  return match[0];
}

function containsText(html, value, label) {
  assert(html.includes(value) || html.includes(escapeHtml(value)), `结果卡缺少${label}：${value}`);
}

const [index, taxonomy, guides, assets, gold, home, clientSource] = await Promise.all([
  readFile(path.join(projectRoot, "generated", "search-index.json"), "utf8").then(JSON.parse),
  readFile(path.join(projectRoot, "content", "taxonomy.json"), "utf8").then(JSON.parse),
  readFile(path.join(projectRoot, "content", "case-guides.json"), "utf8").then(JSON.parse),
  readFile(path.join(projectRoot, "generated", "assets.json"), "utf8").then(JSON.parse),
  readFile(path.join(projectRoot, "quality", "search-gold.json"), "utf8").then(JSON.parse),
  readFile(path.join(distRoot, "index.html"), "utf8"),
  readFile(path.join(projectRoot, "src", "components", "discovery", "discovery-client.ts"), "utf8")
]);

const hardGold = gold.queries.find((query) => query.hard_scenario && query.query === hardQuery);
assert(hardGold, "检索金标缺少固定企鹅题");
const results = searchIndex(index, hardQuery, { limit: 5 });
assert(results.length >= 3 && results.length <= 5, `企鹅题应返回 3–5 张卡，实际为 ${results.length}`);
const sameStructureHits = results.filter((result) => hardGold.confirmed_case_ids.includes(result.case_id));
assert(sameStructureHits.length >= 3, `企鹅题确认同结构案例不足 3 个：${sameStructureHits.length}`);

const renderedIds = [...home.matchAll(/<article class="discovery-card" data-case-id="(case-[^"]+)"/g)].map((match) => match[1]);
assert(renderedIds.length === results.length, `首页静态结果卡应为 ${results.length} 张，实际为 ${renderedIds.length}`);
assert(renderedIds.every((caseId, position) => caseId === results[position].case_id), "首页静态卡片顺序与结构优先检索不一致");
assert(hardGold.confirmed_case_ids.filter((caseId) => renderedIds.includes(caseId)).length >= 3, "首页静态卡片未呈现至少 3 个确认同结构案例");

assert(home.includes('name="q"'), "首页缺少任务输入框");
assert(home.includes('data-step="1"') && home.includes('data-step="2"') && home.includes('data-step="3"'), "首页未明确三步到案例路径");
assert(home.indexOf("[data-discovery-form]") === -1, "构建 HTML 不应保留源码选择器");
const formPosition = home.indexOf('data-discovery-form');
const resultsPosition = home.indexOf('id="home-discovery-results"');
const firstCasePosition = home.indexOf(`href="/cases/${results[0].case_id}/"`);
assert(formPosition >= 0 && resultsPosition > formPosition && firstCasePosition > resultsPosition, "任务输入、结果区和案例链接的三步顺序不正确");

const guidesByCase = new Map(guides.map((guide) => [guide.case_id, guide]));
for (const result of results) {
  const article = articleFor(home, result.case_id);
  const guide = guidesByCase.get(result.case_id);
  assert(guide, `${result.case_id} 缺少指南`);
  assert(result.reasons.length > 0, `${result.case_id} 缺少检索命中原因`);
  assert(article.includes("为什么命中"), `${result.case_id} 未显示命中原因标题`);
  assert(article.includes("共性难点"), `${result.case_id} 未显示共性难点`);
  assert(article.includes("一条迁移写法"), `${result.case_id} 未显示一条迁移写法`);
  assert(article.includes(`href="/cases/${result.case_id}/"`), `${result.case_id} 缺少案例链接`);
  for (const reason of result.reasons) containsText(article, reason.text, `${result.case_id} 命中原因`);
  containsText(article, guide.common_challenges[0], `${result.case_id} 共性难点`);
  containsText(article, guide.transferable_rule, `${result.case_id} 迁移写法`);
  const variants = assets.filter((asset) => (
    asset.kind === "derived_case_image"
    && asset.source_asset_id === `asset-${result.case_id}`
    && [360, 640, 960].includes(asset.width)
  ));
  assert(new Set(variants.map((asset) => asset.width)).size === 3, `${result.case_id} 缺少三档卡片图片`);
  for (const asset of variants) assert(article.includes(asset.uri), `${result.case_id} 卡片未引用 ${asset.width}w 图片`);
  assert(article.includes("srcset=") && article.includes("sizes="), `${result.case_id} 缺少响应式图片属性`);
}

assert(taxonomy.categories.length === 5, "一级分类必须为五类");
for (const category of taxonomy.categories) {
  assert(home.includes(`href="/categories/${category.category_id}/"`), `首页缺少 ${category.name} 入口`);
  const categoryHtml = await readFile(path.join(distRoot, "categories", category.category_id, "index.html"), "utf8");
  assert(categoryHtml.includes("data-discovery-filter=\"intent\""), `${category.name} 缺少意图筛选`);
  assert(categoryHtml.includes("data-discovery-filter=\"layout\""), `${category.name} 缺少版式筛选`);
  assert(categoryHtml.includes("data-discovery-filter=\"input\""), `${category.name} 缺少输入方式筛选`);
  assert(categoryHtml.includes("data-discovery-filter=\"slot\""), `${category.name} 缺少槽位筛选`);
  assert(categoryHtml.includes("/cases/"), `${category.name} 没有静态案例链接`);
}

const categoryIndex = await readFile(path.join(distRoot, "categories", "index.html"), "utf8");
assert(taxonomy.categories.every((category) => categoryIndex.includes(category.plain_explanation)), "分类目录缺少通俗解释");
const forbiddenCopy = ["课程", "教程", "学习路径", "学习进度", "测验", "练习", "复制整段", "复制提示词"];
for (const phrase of forbiddenCopy) {
  assert(!home.includes(phrase) && !categoryIndex.includes(phrase), `页面含禁用文案：${phrase}`);
}
assert(!/\bfetch\s*\(|XMLHttpRequest|\/api\//.test(clientSource), "发现交互不得请求运行时接口");
assert(clientSource.includes("searchStaticIndex"), "客户端未复用静态结构检索");

console.log(`发现页验收通过：${taxonomy.categories.length} 个分类入口，企鹅题 ${renderedIds.length} 张卡，确认同结构 ${sameStructureHits.length} 个。`);
console.log("每张企鹅题结果卡均含命中原因、共性难点、一条迁移写法、案例链接和三档 WebP。");
