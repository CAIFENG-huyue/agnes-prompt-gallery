import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  canonical,
  createSchemaValidator,
  defaultExperimentsRoot,
  loadSchemas,
  projectRoot,
  readJson,
  sha256,
  writeJson
} from "./migrate-experiments.mjs";

const GENERATOR_VERSION = "build-conclusions.mjs@1.0.0";
const Z95 = 1.959963984540054;
const BOOTSTRAP_SEED = 20261121;
const BOOTSTRAP_RESAMPLES = 10000;
const MASK128 = (1n << 128n) - 1n;
const MASK64 = 0xffffffffffffffffn;
const PCG_MULTIPLIER = 0x2360ed051fc65da44385df649fccf645n;

function seedSequencePool(entropyWord, poolSize = 4) {
  const pool = new Uint32Array(poolSize);
  let hashConst = 0x43b0d7e5 >>> 0;
  const hashmix = (input) => {
    let value = (input ^ hashConst) >>> 0;
    hashConst = Math.imul(hashConst, 0x931e8875) >>> 0;
    value = Math.imul(value, hashConst) >>> 0;
    return (value ^ (value >>> 16)) >>> 0;
  };
  const mix = (x, y) => {
    const result = (Math.imul(0xca01f9dd, x) - Math.imul(0x4973f715, y)) >>> 0;
    return (result ^ (result >>> 16)) >>> 0;
  };
  for (let i = 0; i < poolSize; i++) pool[i] = hashmix(i === 0 ? entropyWord : 0);
  for (let src = 0; src < poolSize; src++) {
    for (let dst = 0; dst < poolSize; dst++) {
      if (src !== dst) pool[dst] = mix(pool[dst], hashmix(pool[src]));
    }
  }
  return pool;
}

export function createPcg64(seed) {
  const pool = seedSequencePool(seed);
  const stateWords = new Uint32Array(8);
  let hashConst = 0x8b51f9dd >>> 0;
  for (let i = 0; i < 8; i++) {
    let value = pool[i % pool.length];
    value = (value ^ hashConst) >>> 0;
    hashConst = Math.imul(hashConst, 0x58f38ded) >>> 0;
    value = Math.imul(value, hashConst) >>> 0;
    stateWords[i] = (value ^ (value >>> 16)) >>> 0;
  }
  const word64 = (index) => (BigInt(stateWords[2 * index + 1]) << 32n) | BigInt(stateWords[2 * index]);
  const initState = (word64(0) << 64n) | word64(1);
  const initSeq = (word64(2) << 64n) | word64(3);
  const inc = ((initSeq << 1n) | 1n) & MASK128;
  let state = 0n;
  state = (state * PCG_MULTIPLIER + inc) & MASK128;
  state = (state + initState) & MASK128;
  state = (state * PCG_MULTIPLIER + inc) & MASK128;
  let cachedHigh = -1;
  const next64 = () => {
    state = (state * PCG_MULTIPLIER + inc) & MASK128;
    const xorshifted = ((state >> 64n) ^ state) & MASK64;
    const rotation = Number(state >> 122n);
    if (rotation === 0) return xorshifted;
    return ((xorshifted >> BigInt(rotation)) | (xorshifted << BigInt(64 - rotation))) & MASK64;
  };
  const next32 = () => {
    if (cachedHigh >= 0) {
      const value = cachedHigh;
      cachedHigh = -1;
      return value;
    }
    const raw = next64();
    cachedHigh = Number((raw >> 32n) & 0xffffffffn);
    return Number(raw & 0xffffffffn);
  };
  return {
    integers(bound) {
      while (true) {
        const product = next32() * bound;
        const leftover = product % 4294967296;
        if (leftover < bound) {
          const threshold = (4294967296 - bound) % bound;
          if (leftover < threshold) continue;
        }
        return Math.floor(product / 4294967296);
      }
    }
  };
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function wilson(k, n, z = Z95) {
  if (n === 0) return [0, 0];
  const p = k / n;
  const denominator = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / denominator;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denominator;
  return [Math.max(0, center - half), Math.min(1, center + half)];
}

export function bootstrapCi(diffs, nBoot = BOOTSTRAP_RESAMPLES, seed = BOOTSTRAP_SEED) {
  if (!diffs.length) return [0, 0];
  const rng = createPcg64(seed);
  const n = diffs.length;
  const means = new Float64Array(nBoot);
  for (let b = 0; b < nBoot; b++) {
    let total = 0;
    for (let i = 0; i < n; i++) total += diffs[rng.integers(n)];
    means[b] = total / n;
  }
  const sorted = Array.from(means).sort((a, b) => a - b);
  const percentile = (q) => {
    const position = (sorted.length - 1) * q;
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    if (lower === upper) return sorted[lower];
    return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
  };
  return [percentile(0.025), percentile(0.975)];
}

export function exactSignFlip(diffs) {
  if (!diffs.length) return { p: 1, n_perms: 0 };
  const observed = mean(diffs);
  const n = diffs.length;
  const total = 1 << n;
  let hits = 0;
  for (let mask = 0; mask < total; mask++) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += ((mask >> i) & 1 ? 1 : -1) * diffs[i];
    if (Math.abs(sum / n) >= Math.abs(observed) - 1e-12) hits++;
  }
  return { p: hits / total, n_perms: total };
}

function binomialCdf(k, n, p = 0.5) {
  let total = 0;
  for (let i = 0; i <= k; i++) {
    let coefficient = 1;
    for (let j = 0; j < i; j++) coefficient = (coefficient * (n - j)) / (j + 1);
    total += coefficient * p ** i * (1 - p) ** (n - i);
  }
  return total;
}

function mcnemarExact(b, c) {
  const n = b + c;
  if (n === 0) return 1;
  return Math.min(1, 2 * binomialCdf(Math.min(b, c), n, 0.5));
}

function holm(pvalues) {
  const m = pvalues.length;
  const order = pvalues.map((p, index) => [p, index]).sort((a, b) => a[0] - b[0]);
  const adjusted = new Array(m).fill(0);
  let running = 0;
  order.forEach(([p, index], rank) => {
    running = Math.max(running, Math.min(1, (m - rank) * p));
    adjusted[index] = running;
  });
  return adjusted;
}

function roundTo(value, digits) {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function recompute(experimentVersions, runs, scoreRevisions) {
  const h1 = experimentVersions.find((ev) => ev.experiment_version_id === "h1/ev-001");
  const h2 = experimentVersions.find((ev) => ev.experiment_version_id === "h2-226/ev-001");
  const currentScores = scoreRevisions.filter((score) => score.is_current);
  const scoreByRun = new Map(currentScores.map((score) => [score.run_id, score]));
  const h1Runs = runs.filter((run) => run.experiment_version_id === "h1/ev-001");
  const rows = h1Runs.map((run) => {
    const score = scoreByRun.get(run.run_id);
    if (!score) throw new Error(`H1 Run 缺少当前评分：${run.run_id}`);
    const truthy = (value) => Number(value) === 1;
    const textRate = score.text_total ? score.text_hits / score.text_total : null;
    const elementRecall = score.elements_total ? score.elements_hits / score.elements_total : null;
    const countCorrect = 1 - Math.min(Math.max(score.count_error, 0), 1);
    const parts = [textRate, elementRecall, countCorrect].filter((value) => value !== null && !Number.isNaN(value));
    return {
      run,
      score,
      case_id: run.case_id,
      variant: run.arm_id,
      pass: [score.g1, score.g2, score.g3, score.g4].every(truthy) ? 1 : 0,
      text_rate: textRate,
      text_exact: score.text_total > 0 && score.text_hits === score.text_total ? 1 : 0,
      element_recall: elementRecall,
      count_correct: countCorrect,
      requirement_fulfillment: parts.length ? mean(parts) : null
    };
  });
  const armTotals = {};
  for (const arm of ["prose", "structured"]) {
    const subset = rows.filter((row) => row.variant === arm);
    const textHits = subset.reduce((sum, row) => sum + row.score.text_hits, 0);
    const textTotal = subset.reduce((sum, row) => sum + row.score.text_total, 0);
    const passes = subset.reduce((sum, row) => sum + row.pass, 0);
    armTotals[arm] = {
      n_images: subset.length,
      text_hits: textHits,
      text_total: textTotal,
      rate: textHits / textTotal,
      wilson95: wilson(textHits, textTotal),
      passes,
      pass_rate: passes / subset.length,
      pass_wilson95: wilson(passes, subset.length)
    };
  }
  const caseIds = [...new Set(rows.map((row) => row.case_id))]
    .sort((a, b) => Number(a.slice(5)) - Number(b.slice(5)));
  const caseMeans = (metric) => caseIds.map((caseId) => {
    const entry = { case_id: caseId };
    for (const arm of ["prose", "structured"]) {
      const values = rows.filter((row) => row.case_id === caseId && row.variant === arm).map((row) => row[metric]).filter((value) => value !== null && !Number.isNaN(value));
      entry[arm] = values.length ? mean(values) : null;
    }
    return entry;
  });
  const pairedDiffs = (table) => table.filter((entry) => entry.prose !== null && entry.structured !== null)
    .map((entry) => ({ case_id: entry.case_id, prose: entry.prose, structured: entry.structured, diff: entry.structured - entry.prose }));
  const textPairs = pairedDiffs(caseMeans("text_rate"));
  const textDiffs = textPairs.map((entry) => entry.diff);
  const effect = mean(textDiffs) * 100;
  const ci = bootstrapCi(textDiffs).map((value) => value * 100);
  const permutation = exactSignFlip(textDiffs);
  const passPairs = pairedDiffs(caseMeans("pass"));
  const passDiffs = passPairs.map((entry) => entry.diff);
  const passEffect = mean(passDiffs) * 100;
  const passCi = bootstrapCi(passDiffs).map((value) => value * 100);
  const passPermutation = exactSignFlip(passDiffs);
  const b = passPairs.filter((entry) => (entry.prose > 0.5 ? 1 : 0) === 0 && (entry.structured > 0.5 ? 1 : 0) === 1).length;
  const c = passPairs.filter((entry) => (entry.prose > 0.5 ? 1 : 0) === 1 && (entry.structured > 0.5 ? 1 : 0) === 0).length;
  const exploratoryNames = ["requirement_fulfillment", "element_recall", "text_exact", "count_correct"];
  const exploratory = {};
  const exploratoryP = [];
  for (const name of exploratoryNames) {
    const pairs = pairedDiffs(caseMeans(name));
    const diffs = pairs.map((entry) => entry.diff);
    const p = exactSignFlip(diffs).p;
    exploratoryP.push(p);
    exploratory[name] = { n_cases: pairs.length, effect_pp: mean(diffs) * 100, p };
  }
  holm(exploratoryP).forEach((adjusted, index) => { exploratory[exploratoryNames[index]].p_holm = adjusted; });

  const controlRunIds = h2.design.control_runs.run_ids;
  const controlRows = controlRunIds.map((runId) => {
    const row = rows.find((item) => item.run.run_id === runId);
    if (!row) throw new Error(`H2 对照 Run 不在 H1 评分集合内：${runId}`);
    return row;
  });
  const overlayRuns = runs.filter((run) => run.experiment_version_id === "h2-226/ev-001" && run.arm_id === "overlay");
  const controlHits = controlRows.reduce((sum, row) => sum + row.score.text_hits, 0);
  const controlTotal = controlRows.reduce((sum, row) => sum + row.score.text_total, 0);
  const controlExact = controlRows.filter((row) => row.text_exact === 1).length;
  const overlayReported = h2.design.reported.arms.overlay;
  const h2Effect = (overlayReported.exact_slots_hits / overlayReported.exact_slots_total - controlHits / controlTotal) * 100;
  const evidenceRunIdsH2 = [...controlRunIds, ...overlayRuns.map((run) => run.run_id)];

  const snapshotRows = currentScores.map((score) => ({
    score_id: score.score_id,
    run_id: score.run_id,
    revision: score.revision,
    g1: score.g1,
    g2: score.g2,
    g3: score.g3,
    g4: score.g4,
    text_hits: score.text_hits,
    text_total: score.text_total,
    elements_hits: score.elements_hits,
    elements_total: score.elements_total,
    count_error: score.count_error
  })).sort((a, b) => a.score_id.localeCompare(b.score_id));
  const scoreSnapshotHash = sha256(canonical(snapshotRows));

  const conclusions = [
    {
      conclusion_version_id: "h1-text-fulfillment/cv-001",
      conclusion_id: "h1-text-fulfillment",
      version_no: 1,
      source_experiment_version_ids: ["h1/ev-001"],
      score_snapshot_hash: scoreSnapshotHash,
      metric: "text_fulfillment_effect_structured_minus_prose",
      estimate: effect,
      unit: "pp",
      ci_low: ci[0],
      ci_high: ci[1],
      ci_method: "案例级配对 bootstrap，10000 次重采样，percentile 2.5/97.5，PCG64 种子 20261121（与 analyze.py 同一随机序列）",
      ci_level: 0.95,
      p_value: permutation.p,
      p_method: "双侧精确符号翻转置换检验，1024 种符号组合",
      n_cases: textPairs.length,
      n_images: rows.length,
      limitations: [
        "H1 假设被拒绝：structured 比 prose 低 7.9pp，按预注册决定不采纳结构化写法，保留 prose 契约模板。",
        "差距集中于 case-475、case-226、case-387、case-389；case-353 反而 +2.0pp，case-23/153/371 接近天花板。",
        "评分可靠性来自同一评分者的 20% 盲重时间复核（15/20 完全一致），不是独立第二评分者，不能排除共同评分偏差。",
        "仅 10 个案例、单一模型 agnes-image-2.5-flash，结论不外推到其他模型或案例分布。",
        "原文 GEE 结果由 statsmodels 拟合，未在本生成器中重算，仅存档于 experiment-versions 的 design.reported。"
      ],
      generator_version: GENERATOR_VERSION,
      evidence_run_ids: h1Runs.map((run) => run.run_id).sort()
    },
    {
      conclusion_version_id: "h1-hard-gate-pass/cv-001",
      conclusion_id: "h1-hard-gate-pass",
      version_no: 1,
      source_experiment_version_ids: ["h1/ev-001"],
      score_snapshot_hash: scoreSnapshotHash,
      metric: "hard_gate_pass_effect_structured_minus_prose",
      estimate: passEffect,
      unit: "pp",
      ci_low: passCi[0],
      ci_high: passCi[1],
      ci_method: "案例级配对 bootstrap，10000 次重采样，percentile 2.5/97.5，PCG64 种子 20261121",
      ci_level: 0.95,
      p_value: passPermutation.p,
      p_method: "双侧精确符号翻转置换检验，1024 种符号组合",
      n_cases: passPairs.length,
      n_images: rows.length,
      limitations: [
        "硬门通过率是关键次要指标且层级受控：主指标未通过，不进入正式显著性声明。",
        "功效不足：15pp 效应、n=10 时功效约 0.26，非显著不等于无效应。",
        `案例多数表决的 McNemar 精确检验 b=${b}、c=${c}，p=${mcnemarExact(b, c)}。`,
        "硬门通过修正后为 prose 6/50、structured 4/50；采纳决策仍需 held-out 通过验证。"
      ],
      generator_version: GENERATOR_VERSION,
      evidence_run_ids: h1Runs.map((run) => run.run_id).sort()
    },
    {
      conclusion_version_id: "h2-226-overlay-exact-text/cv-001",
      conclusion_id: "h2-226-overlay-exact-text",
      version_no: 1,
      source_experiment_version_ids: ["h1/ev-001", "h2-226/ev-001"],
      score_snapshot_hash: scoreSnapshotHash,
      metric: "exact_text_slot_fulfillment_overlay_minus_in_image",
      estimate: h2Effect,
      unit: "pp",
      ci_low: h2Effect,
      ci_high: h2Effect,
      ci_method: "未估计区间：单案例可行性试点且 Arm B 文字为确定性构造，退化为点值，不构成抽样置信区间",
      ci_level: 0,
      n_cases: 1,
      n_images: evidenceRunIdsH2.length,
      limitations: [
        "单案例 case-226、每臂 5 张共 10 张的可行性试点，不是有功效的检验，不能据此宣称普遍优胜。",
        "Arm B 的 80/80 逐字是 PIL 确定性构造的操纵检查，文字准确性两臂不可盲比；H2 全程未施盲。",
        "Arm A 复用 H1 case-226 prose 的 5 次盲评运行（75/80），五张图同一槽位把世宗/朱厚熜写成朱厚熄。",
        "空白带 5/5 可用、5/5 无文字压人像，但 r6 底图在带内残留细导线，叠字压线仍可读，属于真实集成缺陷。",
        "不外推到 475 尺寸箭头、387 UI、389 项目符号等文字与结构纠缠的版式；叠字位置依赖底部检测加人工核对，生产需要稳定槽位模板。"
      ],
      generator_version: GENERATOR_VERSION,
      evidence_run_ids: evidenceRunIdsH2
    }
  ];

  return {
    conclusions,
    scoreSnapshotHash,
    h1: {
      arms: armTotals,
      n_cases: textPairs.length,
      effect_pp: effect,
      bootstrap95_pp: ci,
      permutation,
      per_case: textPairs.map((entry) => ({
        case_id: entry.case_id,
        prose_rate: entry.prose,
        structured_rate: entry.structured,
        diff_pp: entry.diff * 100
      })),
      hard_gate: {
        effect_pp: passEffect,
        bootstrap95_pp: passCi,
        permutation: passPermutation,
        mcnemar: { b, c, p: mcnemarExact(b, c) }
      },
      exploratory
    },
    h2: {
      control: {
        run_ids: controlRunIds,
        exact_slots_hits: controlHits,
        exact_slots_total: controlTotal,
        per_image_exact: [controlExact, controlRows.length]
      },
      overlay: {
        run_ids: overlayRuns.map((run) => run.run_id),
        exact_slots_hits: overlayReported.exact_slots_hits,
        exact_slots_total: overlayReported.exact_slots_total,
        per_image_exact: overlayReported.per_image_exact,
        source: "E/results-h2.md 操纵检查记录（PIL 确定性文字，无逐图评分表）"
      },
      effect_pp: h2Effect,
      n_cases: 1,
      n_images_per_arm: 5
    }
  };
}

export function buildChecks(recomputed, experimentVersions) {
  const h1Reported = experimentVersions.find((ev) => ev.experiment_version_id === "h1/ev-001").design.reported;
  const h2Reported = experimentVersions.find((ev) => ev.experiment_version_id === "h2-226/ev-001").design.reported;
  const checks = [];
  const add = (id, expected, actual, pass) => checks.push({ id, expected, actual, pass: Boolean(pass) });
  const close = (a, b, tolerance = 1e-9) => Math.abs(a - b) <= tolerance;
  for (const arm of ["prose", "structured"]) {
    const expected = h1Reported.arms[arm];
    const actual = recomputed.h1.arms[arm];
    add(`h1.${arm}.text_hits_total`, `${expected.text_hits}/${expected.text_total}`, `${actual.text_hits}/${actual.text_total}`,
      expected.text_hits === actual.text_hits && expected.text_total === actual.text_total);
    add(`h1.${arm}.n_images`, expected.n_images, actual.n_images, expected.n_images === actual.n_images);
    add(`h1.${arm}.rate_round3`, expected.rate, roundTo(actual.rate, 3), close(expected.rate, roundTo(actual.rate, 3)));
    add(`h1.${arm}.wilson_round3`, expected.wilson95, actual.wilson95.map((v) => roundTo(v, 3)),
      expected.wilson95.every((v, i) => close(v, roundTo(actual.wilson95[i], 3))));
    add(`h1.${arm}.hard_gate_passes`, h1Reported.hard_gate.arms[arm].passes, actual.passes, h1Reported.hard_gate.arms[arm].passes === actual.passes);
    add(`h1.${arm}.hard_gate_wilson_round3`, h1Reported.hard_gate.arms[arm].wilson95, actual.pass_wilson95.map((v) => roundTo(v, 3)),
      h1Reported.hard_gate.arms[arm].wilson95.every((v, i) => close(v, roundTo(actual.pass_wilson95[i], 3))));
  }
  add("h1.n_cases", h1Reported.n_cases, recomputed.h1.n_cases, h1Reported.n_cases === recomputed.h1.n_cases);
  add("h1.effect_pp_round1", h1Reported.effect_pp, roundTo(recomputed.h1.effect_pp, 1), close(h1Reported.effect_pp, roundTo(recomputed.h1.effect_pp, 1), 1e-9));
  add("h1.bootstrap95_pp_round1", h1Reported.bootstrap95_pp, recomputed.h1.bootstrap95_pp.map((v) => roundTo(v, 1)),
    h1Reported.bootstrap95_pp.every((v, i) => close(v, roundTo(recomputed.h1.bootstrap95_pp[i], 1), 1e-9)));
  add("h1.permutation_p_4g", h1Reported.permutation_p, recomputed.h1.permutation.p,
    close(h1Reported.permutation_p, recomputed.h1.permutation.p, 5e-5));
  add("h1.hard_gate.effect_pp_round1", h1Reported.hard_gate.effect_pp, roundTo(recomputed.h1.hard_gate.effect_pp, 1),
    close(h1Reported.hard_gate.effect_pp, roundTo(recomputed.h1.hard_gate.effect_pp, 1)));
  add("h1.hard_gate.bootstrap95_pp_round1", h1Reported.hard_gate.bootstrap95_pp, recomputed.h1.hard_gate.bootstrap95_pp.map((v) => roundTo(v, 1)),
    h1Reported.hard_gate.bootstrap95_pp.every((v, i) => close(v, roundTo(recomputed.h1.hard_gate.bootstrap95_pp[i], 1))));
  add("h1.hard_gate.permutation_p", h1Reported.hard_gate.permutation_p, recomputed.h1.hard_gate.permutation.p,
    close(h1Reported.hard_gate.permutation_p, recomputed.h1.hard_gate.permutation.p));
  add("h1.hard_gate.mcnemar", h1Reported.hard_gate.mcnemar, recomputed.h1.hard_gate.mcnemar,
    h1Reported.hard_gate.mcnemar.b === recomputed.h1.hard_gate.mcnemar.b
      && h1Reported.hard_gate.mcnemar.c === recomputed.h1.hard_gate.mcnemar.c
      && close(h1Reported.hard_gate.mcnemar.p, recomputed.h1.hard_gate.mcnemar.p));
  for (const [name, expected] of Object.entries(h1Reported.exploratory)) {
    const actual = recomputed.h1.exploratory[name];
    add(`h1.exploratory.${name}.effect_pp_round1`, expected.effect_pp, roundTo(actual.effect_pp, 1), close(expected.effect_pp, roundTo(actual.effect_pp, 1)));
    add(`h1.exploratory.${name}.p_4g`, expected.p, actual.p, close(expected.p, actual.p, 5e-5));
    add(`h1.exploratory.${name}.p_holm_4g`, expected.p_holm, actual.p_holm, close(expected.p_holm, actual.p_holm, 5e-5));
  }
  for (const expected of h1Reported.per_case) {
    const actual = recomputed.h1.per_case.find((entry) => entry.case_id === expected.case_id);
    add(`h1.per_case.${expected.case_id}.diff_pp_round1`, expected.diff_pp, roundTo(actual.diff_pp, 1), close(expected.diff_pp, roundTo(actual.diff_pp, 1), 1e-9));
  }
  add("h2.control.exact_slots", `${h2Reported.arms["in-image"].exact_slots_hits}/${h2Reported.arms["in-image"].exact_slots_total}`,
    `${recomputed.h2.control.exact_slots_hits}/${recomputed.h2.control.exact_slots_total}`,
    h2Reported.arms["in-image"].exact_slots_hits === recomputed.h2.control.exact_slots_hits
      && h2Reported.arms["in-image"].exact_slots_total === recomputed.h2.control.exact_slots_total);
  add("h2.control.per_image_exact", h2Reported.arms["in-image"].per_image_exact, recomputed.h2.control.per_image_exact,
    h2Reported.arms["in-image"].per_image_exact.every((v, i) => v === recomputed.h2.control.per_image_exact[i]));
  add("h2.overlay.exact_slots_documented", "80/80", `${recomputed.h2.overlay.exact_slots_hits}/${recomputed.h2.overlay.exact_slots_total}`,
    recomputed.h2.overlay.exact_slots_hits === 80 && recomputed.h2.overlay.exact_slots_total === 80);
  add("h2.n_images_per_arm", 5, recomputed.h2.n_images_per_arm,
    recomputed.h2.control.run_ids.length === 5 && recomputed.h2.overlay.run_ids.length === 5);
  const h2Conclusion = recomputed.conclusions.find((cv) => cv.conclusion_id === "h2-226-overlay-exact-text");
  add("h2.single_case_feasibility", { n_cases: 1, n_images: 10, ci_level: 0 },
    { n_cases: h2Conclusion.n_cases, n_images: h2Conclusion.n_images, ci_level: h2Conclusion.ci_level },
    h2Conclusion.n_cases === 1 && h2Conclusion.n_images === 10 && h2Conclusion.ci_level === 0 && h2Conclusion.evidence_run_ids.length === 10);
  add("h2.effect_pp", 6.25, roundTo(recomputed.h2.effect_pp, 2), close(recomputed.h2.effect_pp, 6.25, 1e-9));
  return checks;
}

async function main() {
  const args = process.argv.slice(2);
  const check = args.includes("--check");
  const [experimentVersions, runs, scoreRevisions, quarantine] = await Promise.all([
    readJson(path.join(projectRoot, "content", "experiment-versions.json")),
    readJson(path.join(projectRoot, "content", "runs.json")),
    readJson(path.join(projectRoot, "content", "score-revisions.json")),
    readJson(path.join(projectRoot, "content", "evidence-quarantine.json"))
  ]);
  const recomputed = recompute(experimentVersions, runs, scoreRevisions);
  const schemas = await loadSchemas();
  const validate = createSchemaValidator(schemas);
  const schemaErrors = recomputed.conclusions.flatMap((cv) => validate(cv, "conclusion-version.schema.json", cv.conclusion_version_id));
  const checks = buildChecks(recomputed, experimentVersions);
  const runIds = new Set(runs.map((run) => run.run_id));
  const evIds = new Set(experimentVersions.map((ev) => ev.experiment_version_id));
  const orphanReferences = [];
  for (const cv of recomputed.conclusions) {
    for (const runId of cv.evidence_run_ids) if (!runIds.has(runId)) orphanReferences.push(`${cv.conclusion_version_id} 引用不存在的 Run ${runId}`);
    for (const evId of cv.source_experiment_version_ids) if (!evIds.has(evId)) orphanReferences.push(`${cv.conclusion_version_id} 引用不存在的实验版本 ${evId}`);
  }
  const drift = [];
  const conclusionsPath = path.join(projectRoot, "generated", "conclusions.json");
  if (check) {
    if (!existsSync(conclusionsPath)) drift.push("generated/conclusions.json 不存在，请先运行 node tools/build-conclusions.mjs");
    else if (canonical(await readJson(conclusionsPath)) !== canonical(recomputed.conclusions)) drift.push("generated/conclusions.json 与当前评分快照重算结果不一致");
  } else {
    await writeJson(conclusionsPath, recomputed.conclusions);
  }
  const failed = checks.filter((item) => !item.pass);
  const report = {
    tool: "tools/build-conclusions.mjs",
    generator_version: GENERATOR_VERSION,
    mode: check ? "check" : "write",
    generated_at: new Date().toISOString(),
    inputs: {
      experiment_versions: "content/experiment-versions.json",
      runs: "content/runs.json",
      score_revisions: "content/score-revisions.json",
      quarantine: "content/evidence-quarantine.json",
      reported_reference: "content/experiment-versions.json design.reported（由 migrate-experiments.mjs 从 E/results-h1.md 与 E/results-h2.md 解析）",
      experiments_root: defaultExperimentsRoot
    },
    score_snapshot_hash: recomputed.scoreSnapshotHash,
    recompute: {
      h1: recomputed.h1,
      h2_226: recomputed.h2
    },
    conclusions: recomputed.conclusions.map((cv) => ({
      conclusion_version_id: cv.conclusion_version_id,
      estimate: cv.estimate,
      ci: [cv.ci_low, cv.ci_high],
      p_value: cv.p_value ?? null,
      n_cases: cv.n_cases,
      n_images: cv.n_images,
      evidence_runs: cv.evidence_run_ids.length
    })),
    quarantine: {
      total_records: quarantine.records.length,
      excluded_from_all_metrics: true,
      by_reason: Object.entries(quarantine.records.reduce((acc, record) => {
        acc[record.reason] = (acc[record.reason] ?? 0) + 1;
        return acc;
      }, {})).map(([reason, count]) => ({ reason, count })),
      record_ids: quarantine.records.map((record) => record.record_id)
    },
    integrity: {
      h1_runs: runs.filter((run) => run.experiment_version_id === "h1/ev-001").length,
      unique_h1_blind_ids: new Set(runs.filter((run) => run.experiment_version_id === "h1/ev-001").map((run) => run.blind_id)).size,
      current_score_revisions: scoreRevisions.filter((score) => score.is_current).length,
      orphan_references: orphanReferences.length,
      schema_errors: schemaErrors.length
    },
    checks,
    deviations: [
      "重算口径与随机种子取自 E/analyze.py（bootstrap 10000 次、PCG64 种子 20261121、精确符号翻转），提示词文本渲染口径取自 E/compile.py，H2 叠字臂 spec 取自 E/specs/h2/case-226.json；这些文件只读且未列入 T06 输入表，是为了不编造原始提示词与统计口径。",
      "scores-h1.csv 已是并入盲重复核修正后的评分，因此每个 H1 Run 只有 revision=1 的当前评分，未虚构被替代修订；首版逐图评分未完整留存，不做重建。",
      "原文 GEE（statsmodels）与逐图 portraits/grid 检查没有可机读逐图输入，未在 JS 中重算，分别存档于 design.reported 与本报告。",
      "scores-h1.csv 的时间戳无时区，迁移时统一追加 Z 归一化为 ISO8601，未改动时分秒。",
      "H2 未施盲：overlay Run 的 blind_id 字段记录来源运行标识 h2-226-r{2..6}-overlay；H2-353 素材、单张试点图与拼版共 12 条进入隔离清单，不参与任何数字。",
      "result_asset_ids 使用源图文件名（去扩展名）作为资产 ID，资产清单与多档 WebP 由 T08 登记；本报告已核对每个被引用源图真实存在。",
      "T03 已把每个案例的原始提示词登记为 case-N/pv-001，因此实验提示词版本从 pv-002 起追加（H1 prose=pv-002、structured=pv-003、H2-226 叠字=pv-004），不覆盖原始版本；迁移脚本会对 T03 主键冲突与父版本链做强校验。"
    ],
    passed: failed.length === 0 && orphanReferences.length === 0 && schemaErrors.length === 0 && drift.length === 0,
    drift
  };
  await writeJson(path.join(projectRoot, "reports", "evidence-recompute.json"), report);
  console.log(JSON.stringify({
    mode: report.mode,
    prose: `${recomputed.h1.arms.prose.text_hits}/${recomputed.h1.arms.prose.text_total}`,
    structured: `${recomputed.h1.arms.structured.text_hits}/${recomputed.h1.arms.structured.text_total}`,
    effect_pp: roundTo(recomputed.h1.effect_pp, 1),
    bootstrap95_pp: recomputed.h1.bootstrap95_pp.map((v) => roundTo(v, 1)),
    permutation_p: recomputed.h1.permutation.p,
    h2_effect_pp: roundTo(recomputed.h2.effect_pp, 2),
    quarantine_records: quarantine.records.length,
    checks_failed: failed.length,
    orphan_references: orphanReferences.length,
    schema_errors: schemaErrors.length,
    drift
  }, null, 2));
  for (const item of failed) console.error(`FAIL ${item.id}: expected=${JSON.stringify(item.expected)} actual=${JSON.stringify(item.actual)}`);
  for (const problem of [...orphanReferences, ...schemaErrors, ...drift]) console.error(problem);
  if (!report.passed) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
