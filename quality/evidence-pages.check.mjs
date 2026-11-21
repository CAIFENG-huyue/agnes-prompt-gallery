import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distRoot = process.argv[2]
  ? path.resolve(projectRoot, process.argv[2])
  : path.join(projectRoot, "dist");

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

function attr(tag, name) {
  return tag.match(new RegExp(`${escapeRegExp(name)}="([^"]*)"`))?.[1];
}

function formatSigned(value) {
  const formatted = Math.abs(value).toFixed(2);
  return value > 0 ? `+${formatted}` : value < 0 ? `−${formatted}` : "0.00";
}

function formatPercent(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function conclusionPath(id) {
  return `/experiments/${id.split("/").map(encodeURIComponent).join("/")}/`;
}

function distFileForConclusion(id) {
  return path.join(distRoot, "experiments", ...id.split("/"), "index.html");
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

const [conclusions, experiments, runs, scores, assets, methods] = await Promise.all([
  readJson("generated", "conclusions.json"),
  readJson("content", "experiment-versions.json"),
  readJson("content", "runs.json"),
  readJson("content", "score-revisions.json"),
  readJson("generated", "assets.json"),
  readJson("content", "methods.json")
]);

const conclusionById = new Map(conclusions.map((item) => [item.conclusion_version_id, item]));
const experimentById = new Map(experiments.map((item) => [item.experiment_version_id, item]));
const runById = new Map(runs.map((item) => [item.run_id, item]));
const scoresByRun = groupBy(scores, (item) => item.run_id);
const assetsBySource = groupBy(
  assets.filter((item) => item.source_asset_id !== undefined),
  (item) => item.source_asset_id
);

function reportedArms(conclusion) {
  const experiment = experimentById.get(conclusion.source_experiment_version_ids.at(-1));
  assert(experiment, `${conclusion.conclusion_version_id} 缺少来源实验版本`);
  const reported = experiment.design?.reported ?? {};
  if (conclusion.metric === "hard_gate_pass_effect_structured_minus_prose") {
    return { mode: "hard-gate", arms: reported.hard_gate?.arms ?? {} };
  }
  if (conclusion.conclusion_id === "h2-226-overlay-exact-text") {
    return { mode: "exact-slots", arms: reported.arms ?? {} };
  }
  return { mode: "text", arms: reported.arms ?? {} };
}

const paths = conclusions.map((item) => conclusionPath(item.conclusion_version_id));
assert(new Set(paths).size === paths.length, "ConclusionVersion 永久地址必须唯一");
assert(conclusions.length > 0, "generated/conclusions.json 为空");

const experimentDirs = (await readdir(path.join(distRoot, "experiments"), { withFileTypes: true }))
  .filter((entry) => entry.isDirectory());
let versionPages = 0;
for (const directory of experimentDirs) {
  const children = await readdir(path.join(distRoot, "experiments", directory.name), { withFileTypes: true });
  versionPages += children.filter((child) => child.isDirectory()).length;
}
assert(
  versionPages === conclusions.length,
  `实验页版本地址应为 ${conclusions.length} 个，实际为 ${versionPages}`
);

const indexHtml = await readFile(path.join(distRoot, "experiments", "index.html"), "utf8");
const indexIds = [...indexHtml.matchAll(/data-conclusion-version="([^"]+)"/g)].map((match) => match[1]);
assert(indexIds.length === conclusions.length, `实验索引应展示 ${conclusions.length} 个结论版本，实际为 ${indexIds.length}`);
assert(
  new Set(indexIds).size === indexIds.length && indexIds.every((id) => conclusionById.has(id)),
  "实验索引包含未知或重复的 ConclusionVersion"
);
assert(!indexHtml.includes("latest"), "实验索引不得用 latest 指向可变版本");

let testedDrilldowns = 0;
let missingScoreRuns = 0;

for (const conclusion of conclusions) {
  const id = conclusion.conclusion_version_id;
  const expectedPath = conclusionPath(id);
  const html = await readFile(distFileForConclusion(id), "utf8");
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
  const missingFragments = [
    ...new Set(
      [...html.matchAll(/href="#([^"]+)"/g)]
        .map((match) => match[1])
        .filter((fragment) => !ids.has(fragment))
    )
  ];
  assert(missingFragments.length === 0, `${id} 页内锚点失效：${missingFragments.join(", ")}`);

  const canonical = html.match(/<link rel="canonical" href="([^"]+)"/);
  assert(canonical, `${id} 缺少 canonical 永久地址`);
  assert(canonical[1] === expectedPath, `${id} 的 canonical 应为 ${expectedPath}，实际为 ${canonical[1]}`);
  assert(!/<meta[^>]+http-equiv="refresh"/i.test(html), `${id} 不得用重定向改写旧版本地址`);

  const summaryMatches = [...html.matchAll(/<article[^>]*class="evidence-card evidence-summary"[^>]*>/g)];
  assert(summaryMatches.length === 1, `${id} 应恰好有一个结论原值摘要，实际为 ${summaryMatches.length}`);
  const summary = summaryMatches[0][0];
  assert(attr(summary, "data-conclusion-version") === id, `${id} 摘要指向了其他结论版本`);

  const expectedAttributes = {
    "data-estimate": String(conclusion.estimate),
    "data-unit": conclusion.unit,
    "data-ci-low": String(conclusion.ci_low),
    "data-ci-high": String(conclusion.ci_high),
    "data-ci-level": String(conclusion.ci_level),
    "data-p-value": conclusion.p_value === undefined ? "not-estimated" : String(conclusion.p_value),
    "data-n-cases": String(conclusion.n_cases),
    "data-n-images": String(conclusion.n_images),
    "data-n-runs": String(conclusion.evidence_run_ids.length),
    "data-score-snapshot": conclusion.score_snapshot_hash,
    "data-generator": conclusion.generator_version
  };
  for (const [name, value] of Object.entries(expectedAttributes)) {
    assert(attr(summary, name) === value, `${id} 的 ${name} 应为 ${value}，实际为 ${attr(summary, name)}`);
  }

  containsText(html, `快照原值 ${conclusion.estimate} ${conclusion.unit}`, `${id} 结论原值`);
  assert(html.includes(formatSigned(conclusion.estimate)), `${id} 可见估计值未按原值格式化`);
  containsText(html, `[${conclusion.ci_low}, ${conclusion.ci_high}] ${conclusion.unit}`, `${id} 区间`);
  if (conclusion.ci_level > 0) {
    assert(html.includes(`${conclusion.ci_level * 100}% 区间`), `${id} 缺少 ${conclusion.ci_level * 100}% 区间标签`);
  } else {
    assert(html.includes("未估计抽样置信区间"), `${id} 必须明示未估计抽样置信区间`);
  }
  if (conclusion.p_value === undefined) {
    assert(html.includes("没有 p 值"), `${id} 必须明示没有 p 值`);
    assert(!/\bp\s*=\s*[0-9.]+/.test(html), `${id} 不得生成不存在的 p 值`);
  } else {
    assert(html.includes(`p = ${conclusion.p_value}`), `${id} 的 p 值与结论原值不一致`);
  }
  containsText(html, `${conclusion.n_cases} 个案例`, `${id} 样本案例量`);
  containsText(html, `${conclusion.n_images} 张实验图`, `${id} 样本图片量`);
  containsText(html, `${conclusion.evidence_run_ids.length} 个证据 Run`, `${id} 证据 Run 量`);
  containsText(html, conclusion.ci_method, `${id} 区间方法`);
  if (conclusion.p_method === undefined) {
    assert(html.includes("未做有功效的假设检验"), `${id} 必须说明未做有功效的假设检验`);
  } else {
    containsText(html, conclusion.p_method, `${id} 检验方法`);
  }
  assert(conclusion.limitations.length > 0, `${id} 必须有局限说明`);
  assert(html.includes("局限与解释边界"), `${id} 缺少局限区块`);
  for (const limitation of conclusion.limitations) {
    containsText(html, limitation, `${id} 局限`);
  }

  const drilldowns = Object.fromEntries(
    [...html.matchAll(/data-drilldown="([^"]+)" href="([^"]+)"/g)].map((match) => [match[1], match[2]])
  );
  for (const kind of ["case", "run", "image", "score-revision"]) {
    assert(drilldowns[kind], `${id} 缺少 ${kind} 下钻链接`);
    assert(drilldowns[kind].startsWith(`${expectedPath}#`), `${id} 的 ${kind} 下钻未指向本版本地址`);
    const fragment = drilldowns[kind].slice(expectedPath.length + 1);
    assert(ids.has(fragment), `${id} 的 ${kind} 下钻目标 #${fragment} 不存在`);
    testedDrilldowns += 1;
  }
  assert(
    drilldowns.case.endsWith(`#${attr(summary, "data-evidence-case")}`),
    `${id} 的 case 下钻与摘要案例不一致`
  );
  assert(
    drilldowns.run.endsWith(`#${attr(summary, "data-evidence-run")}`),
    `${id} 的 run 下钻与摘要 Run 不一致`
  );
  assert(
    drilldowns.image.endsWith(`#image-${attr(summary, "data-evidence-image")}`),
    `${id} 的 image 下钻与摘要图片不一致`
  );
  const evidenceScore = attr(summary, "data-evidence-score");
  const scoreFragment = drilldowns["score-revision"].split("#").at(-1);
  assert(
    evidenceScore === "not-available" ? scoreFragment === "score-boundary" : scoreFragment === evidenceScore,
    `${id} 的 score revision 下钻与摘要评分不一致`
  );

  assert(conclusion.evidence_run_ids.length > 0, `${id} 没有证据 Run，不得生成结论`);
  const expectedRunIds = new Set(conclusion.evidence_run_ids);
  const pageRunIds = new Set([...html.matchAll(/data-run-id="([^"]+)"/g)].map((match) => match[1]));
  for (const runId of expectedRunIds) {
    assert(pageRunIds.has(runId), `${id} 缺少证据 Run ${runId}`);
  }
  for (const runId of pageRunIds) {
    assert(expectedRunIds.has(runId), `${id} 展示了结论未引用的 Run ${runId}`);
  }

  const sourceExperiments = new Set(conclusion.source_experiment_version_ids);
  const distinctCases = new Set();
  for (const runId of expectedRunIds) {
    const run = runById.get(runId);
    assert(run, `${id} 引用了不存在的 Run ${runId}`);
    assert(
      sourceExperiments.has(run.experiment_version_id),
      `${id} 的 Run ${runId} 不属于结论声明的实验版本`
    );
    distinctCases.add(run.case_id);
  }
  assert(
    distinctCases.size === conclusion.n_cases,
    `${id} 的 n_cases=${conclusion.n_cases} 与证据 Run 覆盖的 ${distinctCases.size} 个案例不一致`
  );

  const expectedScores = new Set(
    scores.filter((score) => expectedRunIds.has(score.run_id)).map((score) => score.score_id)
  );
  const pageScores = new Set([...html.matchAll(/data-score-id="([^"]+)"/g)].map((match) => match[1]));
  for (const scoreId of expectedScores) {
    assert(pageScores.has(scoreId), `${id} 缺少评分修订 ${scoreId}`);
  }
  for (const scoreId of pageScores) {
    assert(expectedScores.has(scoreId), `${id} 展示了结论未引用的评分 ${scoreId}`);
  }
  for (const score of scores.filter((item) => expectedRunIds.has(item.run_id))) {
    const tag = html.match(new RegExp(`<section[^>]*data-score-id="${escapeRegExp(score.score_id)}"[^>]*>`))?.[0];
    assert(tag, `${id} 缺少评分修订区块 ${score.score_id}`);
    assert(attr(tag, "data-score-revision") === String(score.revision), `${id} 的 ${score.score_id} revision 不一致`);
    assert(attr(tag, "data-current") === String(score.is_current), `${id} 的 ${score.score_id} 当前标记不一致`);
  }

  const runsWithoutScores = [...expectedRunIds].filter((runId) => !(scoresByRun.get(runId) ?? []).length);
  const missingBlocks = [...html.matchAll(/<section[^>]*data-score-revision="missing"[^>]*>/g)];
  assert(
    missingBlocks.length === runsWithoutScores.length,
    `${id} 无评分 Run 的缺口标注应为 ${runsWithoutScores.length} 个，实际为 ${missingBlocks.length}`
  );
  if (runsWithoutScores.length > 0) {
    assert(html.includes("无逐图 ScoreRevision"), `${id} 必须明示无逐图评分`);
    for (const runId of runsWithoutScores) {
      assert(
        missingBlocks.some((match) => attr(match[0], "data-run-id") === runId),
        `${id} 的 Run ${runId} 缺少无评分说明`
      );
    }
    missingScoreRuns += runsWithoutScores.length;
  }

  const expectedAssets = new Set(
    [...expectedRunIds].flatMap((runId) => runById.get(runId).result_asset_ids)
  );
  const pageAssets = new Set([...html.matchAll(/data-source-asset-id="([^"]+)"/g)].map((match) => match[1]));
  for (const assetId of expectedAssets) {
    const variants = assetsBySource.get(assetId) ?? [];
    const widths = new Map(variants.map((variant) => [variant.width, variant]));
    for (const width of [360, 640, 960]) {
      assert(widths.has(width), `${id} 的证据图 ${assetId} 缺少 ${width}w`);
    }
    const figureTag = html.match(new RegExp(`<figure[^>]*id="image-${escapeRegExp(assetId)}"[^>]*>`))?.[0];
    assert(figureTag, `${id} 缺少结果图锚点 image-${assetId}`);
    for (const width of [360, 640, 960]) {
      assert(
        figureTag.includes(widths.get(width).asset_id),
        `${id} 的结果图 ${assetId} 缺少 ${width}w 资产引用`
      );
    }
    const figure = html.slice(html.indexOf(figureTag), html.indexOf("</figure>", html.indexOf(figureTag)));
    for (const width of [360, 640, 960]) {
      assert(figure.includes(widths.get(width).uri), `${id} 的结果图 ${assetId} 未引用 ${width}w URI`);
    }
  }
  for (const assetId of pageAssets) {
    assert(expectedAssets.has(assetId), `${id} 展示了结论未引用的图片 ${assetId}`);
  }

  const report = reportedArms(conclusion);
  assert(Object.keys(report.arms).length > 0, `${id} 缺少臂级汇总数字`);
  for (const [armId, arm] of Object.entries(report.arms)) {
    const cardTag = html.match(
      new RegExp(`<article[^>]*data-arm-report="${escapeRegExp(armId)}"[^>]*>`)
    )?.[0];
    assert(cardTag, `${id} 缺少臂 ${armId} 的汇总卡`);
    const card = html.slice(html.indexOf(cardTag), html.indexOf("</article>", html.indexOf(cardTag)));
    const numericAttributes = {
      "data-n-images": arm.n_images,
      "data-text-hits": arm.text_hits,
      "data-text-total": arm.text_total,
      "data-passes": arm.passes,
      "data-ci-low": arm.wilson95?.[0],
      "data-ci-high": arm.wilson95?.[1],
      "data-exact-slots-hits": arm.exact_slots_hits,
      "data-exact-slots-total": arm.exact_slots_total
    };
    for (const [name, value] of Object.entries(numericAttributes)) {
      if (value === undefined) continue;
      assert(attr(cardTag, name) === String(value), `${id} 臂 ${armId} 的 ${name} 应为 ${value}`);
    }
    const rate = arm.rate ?? arm.pass_rate;
    if (rate !== undefined) {
      assert(attr(cardTag, "data-rate") === String(rate), `${id} 臂 ${armId} 的通过率不一致`);
      assert(card.includes(formatPercent(rate)), `${id} 臂 ${armId} 缺少 ${formatPercent(rate)} 展示`);
    }
    if (arm.per_image_exact) {
      assert(
        attr(cardTag, "data-per-image-exact") === arm.per_image_exact.join("/"),
        `${id} 臂 ${armId} 的逐图全对数字不一致`
      );
    }
    const displayValue = report.mode === "hard-gate"
      ? `${arm.passes}/${arm.n_images}`
      : report.mode === "exact-slots"
        ? `${arm.exact_slots_hits}/${arm.exact_slots_total}`
        : `${arm.text_hits}/${arm.text_total}`;
    assert(card.includes(`data-report-value="${displayValue}"`), `${id} 臂 ${armId} 未展示 ${displayValue}`);
    const valueTag = card.match(/<a[^>]*data-report-value="[^"]*"[^>]*>/)?.[0];
    assert(valueTag, `${id} 臂 ${armId} 的数字缺少下钻链接`);
    const href = attr(valueTag, "href");
    assert(href?.startsWith(expectedPath), `${id} 臂 ${armId} 的数字未链接到本版本`);
    assert(ids.has(href.split("#").at(-1)), `${id} 臂 ${armId} 的数字下钻目标不存在`);
  }

  assert(
    html.includes(`v${conclusion.version_no}；此地址不指向 latest`),
    `${id} 必须声明固定版本号且不指向 latest`
  );
  assert(html.includes(`href="${expectedPath}"`), `${id} 缺少指向自身永久地址的链接`);
  assert(html.includes(conclusion.score_snapshot_hash), `${id} 缺少评分快照哈希`);
  assert(html.includes(conclusion.generator_version), `${id} 缺少生成器版本`);

  if (conclusion.conclusion_id === "h2-226-overlay-exact-text") {
    for (const phrase of ["单案例", "可行性", "未施盲", "不能据此宣称普遍优胜"]) {
      assert(html.includes(phrase), `${id} 必须说明 H2 的 ${phrase} 限制`);
    }
  }
}

for (const method of methods) {
  assert(method.conclusion_version_ids.length > 0, `方法 ${method.method_id} 必须绑定结论版本`);
  for (const id of method.conclusion_version_ids) {
    assert(conclusionById.has(id), `方法 ${method.method_id} 引用了不存在的结论版本 ${id}`);
  }
}
const methodsIndex = await readFile(path.join(distRoot, "methods", "index.html"), "utf8");
for (const match of methodsIndex.matchAll(/data-conclusion-version="([^"]+)"/g)) {
  assert(conclusionById.has(match[1]), `方法索引展示了无证据支撑的结论 ${match[1]}`);
}

assert(indexHtml.includes("/experiments/"), "实验索引缺少版本页入口");
for (const conclusion of conclusions) {
  assert(
    indexHtml.includes(`href="${conclusionPath(conclusion.conclusion_version_id)}"`),
    `实验索引缺少 ${conclusion.conclusion_version_id} 的固定地址`
  );
}

console.log(
  `实验页验收通过：${conclusions.length} 个 ConclusionVersion 页面，${testedDrilldowns} 个数字下钻链接全部落到页内 case/run/image/score revision。`
);
console.log("估计值、区间、p 值、样本量、快照哈希、检验方法与局限均与 generated/conclusions.json 完全一致。");
console.log(
  `永久地址与 canonical 一致且不指向 latest；无评分 Run 的 ${missingScoreRuns} 处缺口被明确标注，未生成替代评分或结论。`
);
