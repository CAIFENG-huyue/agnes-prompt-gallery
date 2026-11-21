import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distRoot = process.argv[2]
  ? path.resolve(projectRoot, process.argv[2])
  : path.join(projectRoot, "dist");
const expectedCaseCount = 541;
const evidenceOrder = ["inferred", "tested", "observed"];
const badgeLabels = {
  inferred: "结构推断",
  tested: "受控实验",
  observed: "结果观察"
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsText(html, value, label) {
  assert(html.includes(value) || html.includes(escapeHtml(value)), `${label}缺失或不一致：${value}`);
}

function groupBy(items, getKey) {
  const groups = new Map();
  for (const item of items) {
    const key = getKey(item);
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  return groups;
}

async function readJson(...segments) {
  return JSON.parse(await readFile(path.join(projectRoot, ...segments), "utf8"));
}

const [
  cases,
  classifications,
  taxonomy,
  fingerprints,
  guides,
  decisions,
  casePromptVersions,
  experimentPromptVersions,
  assets,
  runs,
  scoreRevisions
] = await Promise.all([
  readJson("content", "cases.json"),
  readJson("content", "classifications.json"),
  readJson("content", "taxonomy.json"),
  readJson("content", "fingerprints.json"),
  readJson("content", "case-guides.json"),
  readJson("content", "decisions.json"),
  readJson("content", "prompt-versions", "cases.json"),
  readJson("content", "prompt-versions", "experiments.json"),
  readJson("generated", "assets.json"),
  readJson("content", "runs.json"),
  readJson("content", "score-revisions.json")
]);

assert(cases.length === expectedCaseCount, `案例总数应为 ${expectedCaseCount}，实际为 ${cases.length}`);

const cssFiles = (await readdir(path.join(distRoot, "_astro"))).filter((file) => file.endsWith(".css"));
const css = (await Promise.all(
  cssFiles.map((file) => readFile(path.join(distRoot, "_astro", file), "utf8"))
)).join("\n");

const categories = new Map(taxonomy.categories.map((item) => [item.category_id, item]));
const classificationsByCase = new Map(classifications.map((item) => [item.case_id, item]));
const fingerprintsByCase = new Map(fingerprints.map((item) => [item.case_id, item]));
const guidesByCase = new Map(guides.map((item) => [item.case_id, item]));
const decisionsByCase = groupBy(decisions, (item) => item.case_id);
const promptsByCase = groupBy(
  [...casePromptVersions, ...experimentPromptVersions],
  (item) => item.case_id
);
const runsById = new Map(runs.map((item) => [item.run_id, item]));
const currentScoresByRun = new Map(
  scoreRevisions.filter((item) => item.is_current).map((item) => [item.run_id, item])
);
const assetsBySource = groupBy(
  assets.filter((item) => item.source_asset_id !== undefined),
  (item) => item.source_asset_id
);

function assetVariants(sourceAssetId) {
  const variants = assetsBySource.get(sourceAssetId) ?? [];
  const widths = new Map(variants.map((item) => [item.width, item]));
  for (const width of [360, 640, 960]) {
    assert(widths.has(width), `派生图片 ${sourceAssetId} 缺少 ${width}w`);
  }
  return widths;
}

function checkHero(caseData, guide, category, fingerprint, created) {
  const { html } = created;
  const heroOrder = [...html.matchAll(/data-hero-item="([^"]+)"/g)].map((match) => match[1]);
  const expectedOrder = ["title", "category", "fit", "fingerprints", "cover", "evidence"];
  assert(
    JSON.stringify(heroOrder) === JSON.stringify(expectedOrder),
    `${caseData.case_id} 移动首屏区块顺序应为 ${expectedOrder.join(" → ")}，实际为 ${heroOrder.join(" → ")}`
  );

  const heading = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
  assert(heading, `${caseData.case_id} 缺少标题`);
  assert(heading[1].trim() === escapeHtml(caseData.title).trim(), `${caseData.case_id} 标题不一致`);

  const hero = html.slice(html.indexOf('class="case-hero"'), html.indexOf('id="decisions"'));
  assert(hero.includes("通俗分类"), `${caseData.case_id} 缺少通俗分类标签`);
  containsText(hero, category.name, `${caseData.case_id} 通俗分类`);
  containsText(hero, category.plain_explanation, `${caseData.case_id} 分类解释`);

  const fit = hero.slice(hero.indexOf('data-hero-item="fit"'), hero.indexOf('data-hero-item="fingerprints"'));
  assert(fit.includes("<h2") && fit.includes("适合") && fit.includes("不适合"), `${caseData.case_id} 缺少适合/不适合`);
  assert(guide.suitable_for.length > 0 && guide.unsuitable_for.length > 0, `${caseData.case_id} 指南适合/不适合为空`);
  for (const item of guide.suitable_for) containsText(fit, item, `${caseData.case_id} 适合项`);
  for (const item of guide.unsuitable_for) containsText(fit, item, `${caseData.case_id} 不适合项`);

  const fingerprintKeys = [...html.matchAll(/data-fingerprint-item="([^"]+)"/g)].map((match) => match[1]);
  assert(fingerprintKeys.length === 3, `${caseData.case_id} 关键指纹应为 3 个，实际为 ${fingerprintKeys.length}`);
  assert(
    JSON.stringify(fingerprintKeys) === JSON.stringify(["layout", "text-slots", "input-mode"]),
    `${caseData.case_id} 关键指纹顺序不正确：${fingerprintKeys.join(",")}`
  );
  assert(html.includes('href="#fingerprint-evidence"'), `${caseData.case_id} 指纹未链接到结构依据`);
  assert(html.includes('id="fingerprint-evidence"'), `${caseData.case_id} 缺少指纹依据详情`);
  assert(html.includes("主体数量"), `${caseData.case_id} 缺少主体数量依据`);
  containsText(html, fingerprint.ratio, `${caseData.case_id} 画幅`);

  const widths = assetVariants(caseData.cover_asset_id);
  const coverTag = html.match(/<img[^>]*data-case-cover[^>]*>/);
  assert(coverTag, `${caseData.case_id} 缺少封面图`);
  const cover = coverTag[0];
  assert(cover.includes(`src="${widths.get(640).uri}"`), `${caseData.case_id} 封面未使用 640w`);
  for (const width of [360, 640, 960]) {
    assert(cover.includes(widths.get(width).uri), `${caseData.case_id} 封面 srcset 缺少 ${width}w`);
  }
  assert(cover.includes("srcset=") && cover.includes("sizes="), `${caseData.case_id} 封面缺少响应式属性`);
  assert(cover.includes(`width="${widths.get(640).width}"`), `${caseData.case_id} 封面宽度属性不匹配`);
}

function checkEvidenceLevels(caseData, caseDecisions, created) {
  const { html } = created;
  const expectedLevels = evidenceOrder.filter((level) => (
    caseDecisions.some((item) => item.evidence_level === level)
  ));
  const pageLevels = html.match(/data-page-evidence="([^"]*)"/);
  assert(pageLevels, `${caseData.case_id} 首屏缺少证据级别`);
  assert(
    pageLevels[1] === expectedLevels.join(" "),
    `${caseData.case_id} 证据级别应为 ${expectedLevels.join(" ") || "无"}，实际为 ${pageLevels[1]}`
  );

  const section = html.slice(html.indexOf('aria-label="证据级别"'), html.indexOf('id="decisions"'));
  for (const level of expectedLevels) {
    assert(section.includes(`data-evidence-level="${level}"`), `${caseData.case_id} 缺少 ${level} 证据级别徽章`);
    assert(section.includes(`evidence-badge--${level}`), `${caseData.case_id} 的 ${level} 徽章缺少独立样式`);
    assert(section.includes(badgeLabels[level]), `${caseData.case_id} 缺少 ${level} 徽章文案`);
  }

  assert(
    expectedLevels.length === 1 && expectedLevels[0] === "inferred"
      ? html.includes("本页只有结构推断，未做实测")
      : html.includes("结构推断、受控实验与单次结果观察分别标注"),
    `${caseData.case_id} 未说明推断与实测的区别`
  );

  for (const level of expectedLevels) {
    const rule = css.match(new RegExp(`\\.evidence-badge--${level}\\s*\\{[^}]*\\}`));
    assert(rule, `构建样式缺少 .evidence-badge--${level}`);
  }
  const backgrounds = ["tested", "observed", "inferred"].map((level) => {
    const rule = css.match(new RegExp(`\\.evidence-badge--${level}\\s*\\{[^}]*\\}`))?.[0] ?? "";
    return rule.match(/background:\s*([^;]+)/)?.[1]?.trim();
  });
  assert(new Set(backgrounds).size === 3, "推断、受控实验、结果观察的徽章背景色必须可区分");
}

function checkDecisions(caseData, caseDecisions, created) {
  const { html, ids } = created;
  for (const decision of caseDecisions) {
    const anchor = decision.decision_id.replace(/[^a-zA-Z0-9_-]+/g, "-");
    const cardMatch = html.match(
      new RegExp(`<article[^>]*data-decision-id="${escapeRegExp(decision.decision_id)}"[^>]*>([\\s\\S]*?)</article>`)
    );
    assert(cardMatch, `${caseData.case_id} 缺少决策卡 ${decision.decision_id}`);
    const card = cardMatch[0];
    const opening = card.slice(0, card.indexOf(">") + 1);
    assert(
      opening.includes(`data-evidence-level="${decision.evidence_level}"`),
      `${caseData.case_id} 决策卡 ${decision.decision_id} 证据级别不一致`
    );

    containsText(card, decision.decision, `${caseData.case_id}/${decision.decision_id} 决策`);
    containsText(card, decision.control_target, `${caseData.case_id}/${decision.decision_id} 控制目标`);
    containsText(card, decision.expected_effect, `${caseData.case_id}/${decision.decision_id} 换法影响`);

    if (decision.evidence_level === "inferred") {
      assert(!card.includes("data-observed-effect"), `${caseData.case_id} 推断卡不得展示实测结果`);
      assert(!card.includes("受控实验结果") && !card.includes("单 Run 结果观察"), `${caseData.case_id} 推断卡不得使用实测口吻`);
    } else {
      assert(decision.observed_effect, `${caseData.case_id}/${decision.decision_id} 实测卡缺少 observed_effect`);
      assert(card.includes("data-observed-effect"), `${caseData.case_id}/${decision.decision_id} 未区分实测结果`);
      containsText(card, decision.observed_effect, `${caseData.case_id}/${decision.decision_id} 实测结果`);
      assert(
        card.includes(decision.evidence_level === "tested" ? "受控实验结果" : "单 Run 结果观察"),
        `${caseData.case_id}/${decision.decision_id} 实测标签不正确`
      );
      assert(
        card.includes(`data-numeric-drilldown="evidence-${anchor}"`),
        `${caseData.case_id}/${decision.decision_id} 实测数字缺少下钻链接`
      );
    }

    const drawerTag = html.match(new RegExp(`<details[^>]*id="evidence-${escapeRegExp(anchor)}"[^>]*>`));
    assert(drawerTag, `${caseData.case_id} 缺少决策证据抽屉 ${decision.decision_id}`);
    assert(!/\sopen(?=[\s>=])/.test(drawerTag[0]), `${caseData.case_id} 证据抽屉不应默认展开`);
    assert(ids.has(`evidence-${anchor}`), `${caseData.case_id} 证据抽屉锚点缺失`);

    const drawer = html.slice(
      html.indexOf(`id="evidence-${anchor}"`),
      html.indexOf("</details>", html.indexOf(`id="evidence-${anchor}"`))
    );
    containsText(drawer, decision.before_excerpt, `${caseData.case_id}/${decision.decision_id} 前证据`);
    containsText(drawer, decision.after_excerpt, `${caseData.case_id}/${decision.decision_id} 后证据`);
    assert(
      drawer.includes(`href="#prompt-${decision.prompt_version_id.replace(/[^a-zA-Z0-9_-]+/g, "-")}"`),
      `${caseData.case_id}/${decision.decision_id} 未链接到对应提示词版本`
    );

    const runRefs = decision.evidence_refs.filter((ref) => ref.entity_type === "run");
    for (const ref of runRefs) {
      const run = runsById.get(ref.entity_id);
      assert(run, `${caseData.case_id}/${decision.decision_id} 引用了不存在的 Run ${ref.entity_id}`);
      assert(drawer.includes(`data-run-id="${run.run_id}"`), `${caseData.case_id}/${decision.decision_id} 缺少 Run ${run.run_id}`);
      const score = currentScoresByRun.get(run.run_id);
      if (score) {
        assert(drawer.includes(`data-score-id="${score.score_id}"`), `${caseData.case_id}/${decision.decision_id} 缺少当前评分 ${score.score_id}`);
      }
      for (const assetId of run.result_asset_ids) {
        assert(drawer.includes(`data-result-image="${assetId}"`), `${caseData.case_id}/${decision.decision_id} 缺少结果图 ${assetId}`);
        assetVariants(assetId);
      }
    }
  }
}

function checkPrompts(caseData, prompts, created) {
  const { html } = created;
  const promptDetails = [...html.matchAll(/<details[^>]*data-prompt-version="([^"]+)"[^>]*>/g)];
  assert(
    promptDetails.length === prompts.length,
    `${caseData.case_id} 提示词版本数应为 ${prompts.length}，实际为 ${promptDetails.length}`
  );
  for (const prompt of prompts) {
    const match = promptDetails.find((item) => item[1] === prompt.prompt_version_id);
    assert(match, `${caseData.case_id} 缺少提示词版本 ${prompt.prompt_version_id}`);
    assert(!/\sopen(?=[\s>=])/.test(match[0]), `${caseData.case_id} 完整提示词必须默认折叠：${prompt.prompt_version_id}`);
    containsText(html, prompt.text, `${caseData.case_id} 提示词原文 ${prompt.prompt_version_id}`);
    assert(html.includes(prompt.content_sha256), `${caseData.case_id} 缺少提示词哈希 ${prompt.prompt_version_id}`);
  }
  assert(!/navigator\.clipboard|data-copy|复制整段|复制提示词/.test(html), `${caseData.case_id} 不得提供整段复制入口`);
}

function checkSelfExplanation(caseData, guide, created) {
  const { html } = created;
  assert(guide.common_challenges.length > 0 && guide.transferable_rule, `${caseData.case_id} 指南内容为空`);
  for (const challenge of guide.common_challenges) {
    containsText(html, challenge, `${caseData.case_id} 共性难点`);
  }
  containsText(html, guide.transferable_rule, `${caseData.case_id} 迁移写法`);
  assert(html.includes('data-self-explanation="common-challenges"'), `${caseData.case_id} 缺少共性难点区块`);
  assert(html.includes('data-self-explanation="transferable-rule"'), `${caseData.case_id} 缺少迁移写法区块`);
  assert(html.includes("<article class=\"case-page\""), `${caseData.case_id} 缺少案例页根元素`);
  assert(html.includes('name="viewport"'), `${caseData.case_id} 缺少移动端 viewport`);
}

const caseIds = new Set(cases.map((item) => item.case_id));
const distCaseDirs = (await readdir(path.join(distRoot, "cases"), { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);
assert(
  distCaseDirs.length === expectedCaseCount,
  `dist/cases 应产出 ${expectedCaseCount} 个页面目录，实际为 ${distCaseDirs.length}`
);
for (const caseId of caseIds) {
  assert(distCaseDirs.includes(caseId), `缺少案例页 ${caseId}`);
}

let testedDecisions = 0;
let observedDecisions = 0;
let inferredDecisions = 0;
let checkedPages = 0;

for (const caseData of cases) {
  const caseId = caseData.case_id;
  const classification = classificationsByCase.get(caseId);
  const fingerprint = fingerprintsByCase.get(caseId);
  const guide = guidesByCase.get(caseId);
  const caseDecisions = decisionsByCase.get(caseId);
  const prompts = (promptsByCase.get(caseId) ?? []).slice().sort((a, b) => a.version_no - b.version_no);
  assert(classification, `${caseId} 缺少分类`);
  assert(fingerprint, `${caseId} 缺少指纹`);
  assert(guide, `${caseId} 缺少指南`);
  assert(caseDecisions && caseDecisions.length > 0, `${caseId} 缺少决策卡`);
  const category = categories.get(classification.primary_category_id);
  assert(category, `${caseId} 引用了不存在的分类 ${classification.primary_category_id}`);

  const file = path.join(distRoot, "cases", caseId, "index.html");
  const html = await readFile(file, "utf8");
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
  const missingFragments = [
    ...new Set(
      [...html.matchAll(/href="#([^"]+)"/g)]
        .map((match) => match[1])
        .filter((fragment) => !ids.has(fragment))
    )
  ];
  assert(missingFragments.length === 0, `${caseId} 页内锚点失效：${missingFragments.join(", ")}`);

  const created = { html, ids };
  checkSelfExplanation(caseData, guide, created);
  checkHero(caseData, guide, category, fingerprint, created);
  checkEvidenceLevels(caseData, caseDecisions, created);
  checkDecisions(caseData, caseDecisions, created);
  checkPrompts(caseData, prompts, created);

  for (const decision of caseDecisions) {
    if (decision.evidence_level === "tested") testedDecisions += 1;
    else if (decision.evidence_level === "observed") observedDecisions += 1;
    else inferredDecisions += 1;
  }
  checkedPages += 1;
}

console.log(
  `案例页验收通过：${checkedPages} 页全部存在；每页含标题、通俗分类、适合/不适合、3 个关键指纹、响应式封面与证据级别。`
);
console.log(
  `推断/实测可辨：${inferredDecisions} 张推断卡、${testedDecisions} 张受控实验卡、${observedDecisions} 张结果观察卡，徽章与卡片样式分别可区分。`
);
console.log("全部提示词版本默认折叠、无整段复制入口；实测数字与评分均链接到页内 Run、评分修订和结果图。");
