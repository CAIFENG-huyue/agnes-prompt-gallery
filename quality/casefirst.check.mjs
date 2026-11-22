import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distRoot = process.argv[2]
  ? path.resolve(projectRoot, process.argv[2])
  : path.join(projectRoot, "dist");
const expectedCasePages = 541;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function readDist(...segments) {
  return readFile(path.join(distRoot, ...segments), "utf8");
}

const [home, casePage, patternsPage, conclusionsPage, patterns] = await Promise.all([
  readDist("index.html"),
  readDist("cases", "case-23", "index.html"),
  readDist("patterns", "index.html"),
  readDist("conclusions", "index.html"),
  readFile(path.join(projectRoot, "content", "patterns.json"), "utf8").then(JSON.parse)
]);

assert((home.match(/<select data-filter="(category|verdict|gate)"/g) ?? []).length === 3, "首页缺少分类/判定/门槛三个筛选");
const cardIds = [...home.matchAll(/class="case-card"/g)].length;
assert(cardIds >= expectedCasePages, `首页案例流不足 ${expectedCasePages} 张，实际 ${cardIds}`);
const cardImages = [...home.matchAll(/src="(\/results\/case-\d+\.webp)"/g)].map((match) => match[1]);
assert(cardImages.length >= expectedCasePages - 3, `首页本站生成图数量异常：${cardImages.length}`);
for (const uri of cardImages.slice(0, 40)) {
  const filePath = path.join(projectRoot, "public", uri.replace(/^\//u, ""));
  const info = await stat(filePath);
  assert(info.isFile() && info.size > 0, `首页主图缺失：${uri}`);
}
assert(home.includes("未评审"), "首页缺少未评审角标状态");
assert(!home.includes("上游"), "首页出现含糊表述「上游」");
assert(!home.includes("案例封面"), "首页出现「案例封面」表述");

assert(casePage.includes("本站生成"), "案例页缺少「本站生成」");
assert(casePage.includes("开源项目原图"), "案例页缺少「开源项目原图」");
assert(casePage.includes("freestylefly/awesome-gpt-image-2"), "案例页未写明开源项目名");
assert(casePage.includes("原链接"), "案例页缺少原链接");
const relatedLinks = [...casePage.matchAll(/href="\/cases\/case-\d+\/"/g)].length;
assert(relatedLinks >= 5, `case-23 同门槛案例链接不足 5 条：${relatedLinks}`);
assert(casePage.includes("提示词全文"), "案例页缺少提示词全文");
assert(!casePage.includes("上游"), "案例页出现含糊表述「上游」");
assert(!casePage.includes("案例封面"), "案例页出现「案例封面」表述");

const categorySample = patterns.categories.find((item) => item.category === "information-diagram");
const gateSample = patterns.gates.find((item) => item.gate === "TEXT_WRONG");
assert(categorySample && gateSample, "patterns.json 缺少抽样项");
assert(
  patternsPage.includes(`${categorySample.pass} / ${categorySample.n}`)
    && patternsPage.includes(`${categorySample.pass_rate.toFixed(1)}%`),
  "规律页分类通过率与 patterns.json 不一致"
);
assert(
  new RegExp(`TEXT_WRONG<\\/code>[\\s\\S]*?<strong[^>]*>${gateSample.n}<\\/strong>`).test(patternsPage),
  "规律页门槛频次与 patterns.json 不一致"
);
assert((patternsPage.match(/href="\/cases\/case-\d+\/"/g) ?? []).length >= 5, "规律页缺少代表案例链接");

for (const required of ["已评审", "通过率", "未评审", "agnes-image-2.5-flash", "REVIEW"]) {
  assert(conclusionsPage.includes(required), `结论页缺少「${required}」`);
}
assert(!conclusionsPage.includes("上游"), "结论页出现含糊表述「上游」");

console.log(`案例优先验收通过：首页 ${cardIds} 张卡、case-23 对照块与 ${relatedLinks} 条同门槛链接、规律页 ${categorySample.pass}/${categorySample.n} 与 ${gateSample.gate}=${gateSample.n}、结论页总盘齐全。`);
