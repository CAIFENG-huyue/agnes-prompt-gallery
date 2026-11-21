import path from "node:path";
import { pathToFileURL } from "node:url";
import { recompute } from "./build-conclusions.mjs";
import { canonical, createSchemaValidator, projectRoot, readJson } from "./migrate-experiments.mjs";

const bannedTone = /课程|教学|教程|第[一二三四五六七八九十百\d]+课|学习路径|学习进度|测验|练习|课后|学习目标/iu;
const guideFields = ["guide_id", "case_id", "suitable_for", "unsuitable_for", "common_challenges", "transferable_rule", "guide_version"];
const decisionFields = ["decision_id", "case_id", "prompt_version_id", "decision", "control_target", "before_excerpt", "after_excerpt", "expected_effect", "observed_effect", "evidence_level", "evidence_refs"];
const structureFields = ["guide_id", "title", "intent_ids", "suitable_for", "unsuitable_for", "common_challenges", "transferable_rules", "evidence_level", "guide_version", "evidence"];
const methodFields = ["method_id", "title", "applicable_when", "unsuitable_for", "transferable_rule", "decision", "conclusion_version_ids", "evidence"];
const structureEvidencePatterns = {
  "structure-sheet-view-contract": [
    /结构板|设定资料|结构拆解|拆解图|爆炸图|structure sheet|illustration sheet|technical sheet/iu,
    /多视图|三视图|正面|侧面|背面|orthographic|turnaround|\bfront\b|\bside\b|\bback\b|\btechnical views?\b|\bmulti[ -]view\b/iu
  ],
  "structure-sheet-dimensions": [/尺寸|毫米|dimensions?|size arrows|measurements?/iu],
  "structure-sheet-materials": [/材料|材质|materials? and finishes|material notes/iu]
};

function compact(value) {
  return String(value ?? "").replace(/\s+/gu, " ").trim();
}

function exactFields(record, fields, label, errors) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    errors.push(`${label}：必须是对象`);
    return;
  }
  if (Object.keys(record).length !== fields.length || fields.some((field) => !Object.hasOwn(record, field))) {
    errors.push(`${label}：字段必须且只能为 ${fields.join("、")}`);
  }
}

function uniqueIndex(records, key, label, errors) {
  const result = new Map();
  for (const record of records) {
    if (result.has(record[key])) errors.push(`${label}：重复 ${record[key]}`);
    result.set(record[key], record);
  }
  return result;
}

function allStrings(value, result = []) {
  if (typeof value === "string") result.push(value);
  else if (Array.isArray(value)) value.forEach((item) => allStrings(item, result));
  else if (value && typeof value === "object") Object.values(value).forEach((item) => allStrings(item, result));
  return result;
}

function isExcerptOf(excerpt, sources) {
  const needle = compact(excerpt);
  return needle.length > 0 && sources.some((source) => compact(source).includes(needle));
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function effectText(value) {
  const rounded = Number(value.toFixed(2));
  return `${rounded > 0 ? "+" : ""}${rounded}pp`;
}

function validateEvidenceRef(itemRef, indexes, label, errors) {
  exactFields(itemRef, ["entity_type", "entity_id"], label, errors);
  const index = {
    case: indexes.caseById,
    prompt_version: indexes.promptById,
    experiment_version: indexes.evById,
    run: indexes.runById,
    score_revision: indexes.scoreById
  }[itemRef?.entity_type];
  if (!index) errors.push(`${label}：不允许或无法核验的实体类型 ${itemRef?.entity_type}`);
  else if (!index.has(itemRef.entity_id)) errors.push(`${label}：孤立引用 ${itemRef.entity_type}/${itemRef.entity_id}`);
}

function validateMethodEvidence(snapshot, cv, label, errors) {
  const fields = [
    "conclusion_version_id", "metric", "estimate", "unit", "ci_low", "ci_high", "ci_method", "ci_level",
    "n_cases", "n_images", "limitations", "source_experiment_version_ids", "score_snapshot_hash", "evidence_run_ids"
  ];
  if (Object.hasOwn(cv, "p_value")) fields.push("p_value", "p_method");
  for (const field of fields) {
    if (canonical(snapshot?.[field]) !== canonical(cv[field])) errors.push(`${label}：${field} 与有效 ConclusionVersion 不一致`);
  }
  for (const field of Object.keys(snapshot ?? {})) if (!fields.includes(field)) errors.push(`${label}：存在非 CV 证据字段 ${field}`);
}

async function main() {
  const paths = {
    cases: "content/cases.json",
    classifications: "content/classifications.json",
    fingerprints: "content/fingerprints.json",
    intents: "content/intents.json",
    casePromptVersions: "content/prompt-versions/cases.json",
    experimentPromptVersions: "content/prompt-versions/experiments.json",
    experimentVersions: "content/experiment-versions.json",
    runs: "content/runs.json",
    scoreRevisions: "content/score-revisions.json",
    conclusions: "generated/conclusions.json",
    guides: "content/case-guides.json",
    decisions: "content/decisions.json",
    structureGuides: "content/structure-guides.json",
    methods: "content/methods.json",
    report: "reports/editorial-coverage.json"
  };
  const input = Object.fromEntries(await Promise.all(Object.entries(paths).map(async ([key, file]) => [key, await readJson(path.join(projectRoot, file))])));
  const errors = [];
  for (const key of ["cases", "classifications", "fingerprints", "intents", "guides", "decisions", "structureGuides", "methods"]) {
    if (!Array.isArray(input[key])) errors.push(`${key} 顶层必须是数组`);
  }
  if (errors.length) throw new Error(errors.join("\n"));
  const schemas = new Map();
  for (const fileName of ["common.schema.json", "guide.schema.json", "decision.schema.json"]) {
    schemas.set(path.join(projectRoot, "schemas", fileName), await readJson(path.join(projectRoot, "schemas", fileName)));
  }
  const validate = createSchemaValidator(schemas);
  const caseById = uniqueIndex(input.cases, "case_id", "案例", errors);
  const promptById = uniqueIndex([...input.casePromptVersions, ...input.experimentPromptVersions], "prompt_version_id", "提示词版本", errors);
  const evById = uniqueIndex(input.experimentVersions, "experiment_version_id", "实验版本", errors);
  const runById = uniqueIndex(input.runs, "run_id", "Run", errors);
  const scoreById = uniqueIndex(input.scoreRevisions, "score_id", "评分修订", errors);
  const indexes = { caseById, promptById, evById, runById, scoreById };
  if (input.cases.length !== 541 || caseById.size !== 541) errors.push(`案例必须为 541 个唯一主键，实际为 ${caseById.size}`);
  const guideByCase = uniqueIndex(input.guides, "case_id", "案例指南", errors);
  const guideById = uniqueIndex(input.guides, "guide_id", "案例指南 ID", errors);
  if (input.guides.length !== 541 || guideByCase.size !== 541 || guideById.size !== 541) errors.push("案例指南必须为 541 条且 case_id、guide_id 均唯一");
  for (const caseId of caseById.keys()) if (!guideByCase.has(caseId)) errors.push(`缺少案例指南 ${caseId}`);
  for (const [index, guide] of input.guides.entries()) {
    const label = `case-guides[${index}]`;
    exactFields(guide, guideFields, label, errors);
    errors.push(...validate(guide, "guide.schema.json", label));
    if (!caseById.has(guide.case_id)) errors.push(`${label}：案例不存在 ${guide.case_id}`);
    if (guide.guide_version !== "evidence-derived-guides-v1") errors.push(`${label}：guide_version 无效`);
    if (Array.from(guide.transferable_rule ?? "").length > 360) errors.push(`${label}：迁移写法过长`);
    if (!/尺寸|材料|视图|槽位|主体|画幅|标题|参考图|阅读|操作|关系|网格|构图|叙事|标注|控件|序列|层级/iu.test(guide.transferable_rule ?? "")) {
      errors.push(`${label}：迁移写法缺少可核验的结构约束`);
    }
  }
  const decisionById = uniqueIndex(input.decisions, "decision_id", "决策 ID", errors);
  if (decisionById.size !== input.decisions.length) errors.push("决策 ID 必须唯一");
  if (input.decisions.length !== 571) errors.push(`决策总数应为 571（541 推断 + 10 受控 + 20 观察），实际为 ${input.decisions.length}`);
  const decisionsByCase = new Map();
  for (const decision of input.decisions) {
    if (!decisionsByCase.has(decision.case_id)) decisionsByCase.set(decision.case_id, []);
    decisionsByCase.get(decision.case_id).push(decision);
  }
  const h1 = evById.get("h1/ev-001");
  if (!h1) errors.push("缺少 h1/ev-001");
  const h1CaseIds = new Set(h1?.design.case_ids ?? []);
  if (h1CaseIds.size !== 10) errors.push("H1 案例必须为 10 个");
  const currentScoreByRun = new Map();
  for (const score of input.scoreRevisions.filter((item) => item.is_current)) {
    if (currentScoreByRun.has(score.run_id)) errors.push(`${score.run_id} 有多个当前评分`);
    currentScoreByRun.set(score.run_id, score);
  }
  for (const [index, decision] of input.decisions.entries()) {
    const label = `decisions[${index}] ${decision.decision_id}`;
    exactFields(decision, decisionFields, label, errors);
    errors.push(...validate(decision, "decision.schema.json", label));
    const prompt = promptById.get(decision.prompt_version_id);
    if (!caseById.has(decision.case_id)) errors.push(`${label}：案例不存在`);
    if (!prompt) errors.push(`${label}：提示词版本不存在`);
    else if (prompt.case_id !== decision.case_id) errors.push(`${label}：prompt_version_id 与 case_id 不匹配`);
    if (!Array.isArray(decision.evidence_refs)) continue;
    decision.evidence_refs.forEach((itemRef, refIndex) => validateEvidenceRef(itemRef, indexes, `${label}.evidence_refs[${refIndex}]`, errors));
    const runRefs = decision.evidence_refs.filter((itemRef) => itemRef.entity_type === "run");
    const promptRefs = decision.evidence_refs.filter((itemRef) => itemRef.entity_type === "prompt_version");
    const scoreRefs = decision.evidence_refs.filter((itemRef) => itemRef.entity_type === "score_revision");
    const referencedPrompts = promptRefs.map((itemRef) => promptById.get(itemRef.entity_id)).filter(Boolean);
    if (decision.evidence_level === "inferred") {
      if (decision.observed_effect !== null) errors.push(`${label}：inferred 的 observed_effect 必须为 null`);
      if (!promptRefs.some((itemRef) => itemRef.entity_id === decision.prompt_version_id)) errors.push(`${label}：inferred 必须引用自身提示词版本`);
      if (runRefs.length) errors.push(`${label}：轻量 inferred 卡不得混入 Run 证据`);
      if (h1CaseIds.has(decision.case_id) && decision.prompt_version_id !== `${decision.case_id}/pv-001`) errors.push(`${label}：轻量卡必须引用原始 pv-001`);
    } else if (["tested", "observed"].includes(decision.evidence_level)) {
      if (!compact(decision.observed_effect)) errors.push(`${label}：非 inferred 必须有 observed_effect`);
      if (!runRefs.length) errors.push(`${label}：${decision.evidence_level} 必须有 Run`);
      if (!scoreRefs.length) errors.push(`${label}：${decision.evidence_level} 必须有当前评分修订`);
      for (const runRef of runRefs) {
        const run = runById.get(runRef.entity_id);
        if (run && run.case_id !== decision.case_id) errors.push(`${label}：Run 案例不匹配 ${runRef.entity_id}`);
        if (run && !currentScoreByRun.has(run.run_id)) errors.push(`${label}：Run 缺少当前评分 ${run.run_id}`);
      }
      if (!runRefs.some((itemRef) => runById.get(itemRef.entity_id)?.prompt_version_id === decision.prompt_version_id)) {
        errors.push(`${label}：至少一个 Run 必须使用 decision.prompt_version_id`);
      }
      for (const scoreRef of scoreRefs) {
        const score = scoreById.get(scoreRef.entity_id);
        if (!score?.is_current) errors.push(`${label}：只能引用当前评分 ${scoreRef.entity_id}`);
        if (score && !runRefs.some((itemRef) => itemRef.entity_id === score.run_id)) errors.push(`${label}：评分未绑定所引 Run ${scoreRef.entity_id}`);
      }
      if (!h1CaseIds.has(decision.case_id)) errors.push(`${label}：非 H1 案例不得标 ${decision.evidence_level}`);
    } else {
      errors.push(`${label}：未知证据级别 ${decision.evidence_level}`);
    }
    if (Array.from(decision.before_excerpt ?? "").length > 180 || Array.from(decision.after_excerpt ?? "").length > 180) errors.push(`${label}：证据摘录超过 180 字`);
    const sourceCase = caseById.get(decision.case_id);
    const beforeSources = [
      ...(referencedPrompts.length ? referencedPrompts.map((item) => item.text) : [prompt?.text ?? ""]),
      ...(decision.evidence_level === "inferred" ? [sourceCase?.title ?? "", sourceCase?.image_alt ?? ""] : [])
    ];
    if (!isExcerptOf(decision.before_excerpt, beforeSources)) errors.push(`${label}：before_excerpt 不是所引案例或提示词的真实短摘录`);
    const afterSources = decision.evidence_level === "observed"
      ? scoreRefs.map((itemRef) => scoreById.get(itemRef.entity_id)?.notes ?? "")
      : beforeSources;
    if (!isExcerptOf(decision.after_excerpt, afterSources)) errors.push(`${label}：after_excerpt 与所引证据不匹配`);
    for (const source of [prompt?.text ?? ""]) {
      if (compact(source).length > 20 && compact(decision.before_excerpt) === compact(source)) errors.push(`${label}：不得复制整段提示词`);
      if (compact(source).length > 20 && compact(decision.after_excerpt) === compact(source)) errors.push(`${label}：不得复制整段提示词`);
    }
    if (decision.evidence_level === "tested" && h1) {
      const expectedRuns = input.runs.filter((run) => run.experiment_version_id === h1.experiment_version_id && run.case_id === decision.case_id);
      if (runRefs.length !== expectedRuns.length) errors.push(`${label}：受控比较必须引用本案例全部 H1 Run`);
      const arms = new Set(runRefs.map((itemRef) => runById.get(itemRef.entity_id)?.arm_id));
      if (!arms.has("prose") || !arms.has("structured")) errors.push(`${label}：受控比较必须覆盖双臂`);
      const rows = expectedRuns.map((run) => ({ run, score: currentScoreByRun.get(run.run_id) })).filter((row) => row.score);
      const armRows = (arm) => rows.filter((row) => row.run.arm_id === arm);
      const prose = armRows("prose");
      const structured = armRows("structured");
      if (prose.length && structured.length) {
        const sum = (items, field) => items.reduce((total, row) => total + row.score[field], 0);
        const rate = (items) => mean(items.map((row) => row.score.text_hits / row.score.text_total));
        const effect = (rate(structured) - rate(prose)) * 100;
        const expected = `H1 本案例当前评分：prose ${sum(prose, "text_hits")}/${sum(prose, "text_total")}，structured ${sum(structured, "text_hits")}/${sum(structured, "text_total")}；按逐 Run 文字达成率先求臂内均值，structured−prose=${effectText(effect)}（每臂 ${prose.length} 次 Run；仅本案例，不外推）。`;
        if (decision.observed_effect !== expected) errors.push(`${label}：H1 数值未按当前 Run 与评分重算`);
      }
    }
    if (decision.evidence_level === "observed") {
      if (runRefs.length !== 1 || scoreRefs.length !== 1) errors.push(`${label}：单 Run 观察卡必须恰有一个 Run 与一个当前评分`);
      const score = scoreById.get(scoreRefs[0]?.entity_id);
      if (score) {
        for (const token of [`文字 ${score.text_hits}/${score.text_total}`, `元素 ${score.elements_hits}/${score.elements_total}`, `count_error=${score.count_error}`, compact(score.notes)]) {
          if (!decision.observed_effect?.includes(token)) errors.push(`${label}：observed_effect 缺少真实评分内容 ${token}`);
        }
      }
    }
  }
  for (const caseId of caseById.keys()) {
    const cards = decisionsByCase.get(caseId) ?? [];
    if (!cards.some((card) => card.evidence_level === "inferred" && card.prompt_version_id === `${caseId}/pv-001`)) errors.push(`${caseId} 缺少原始提示词 inferred 决策卡`);
    if (!h1CaseIds.has(caseId) && cards.some((card) => card.evidence_level !== "inferred")) errors.push(`${caseId} 无 H1 Run，不得出现非 inferred 卡`);
  }
  for (const caseId of h1CaseIds) {
    const cards = decisionsByCase.get(caseId) ?? [];
    const runBacked = cards.filter((card) => card.evidence_refs.some((itemRef) => itemRef.entity_type === "run"));
    if (cards.length < 4 || runBacked.length < 3) errors.push(`${caseId} 必须有 1 张 inferred 与至少 3 张 Run 证据卡`);
    for (const level of ["tested", "observed"]) {
      const expected = level === "tested" ? 1 : 2;
      if (cards.filter((card) => card.evidence_level === level).length !== expected) errors.push(`${caseId} 的 ${level} 卡数量应为 ${expected}`);
    }
  }
  const structureIds = uniqueIndex(input.structureGuides, "guide_id", "结构板指南", errors);
  if (structureIds.size !== 3) errors.push("结构板指南必须包含视图、尺寸、材料三条");
  for (const required of ["structure-sheet-view-contract", "structure-sheet-dimensions", "structure-sheet-materials"]) if (!structureIds.has(required)) errors.push(`缺少结构板指南 ${required}`);
  for (const [index, guide] of input.structureGuides.entries()) {
    const label = `structure-guides[${index}]`;
    exactFields(guide, structureFields, label, errors);
    if (guide.evidence_level !== "inferred") errors.push(`${label}：结构板指南只能标 inferred`);
    if (guide.guide_version !== "evidence-derived-guides-v1") errors.push(`${label}：guide_version 无效`);
    if (!Array.isArray(guide.evidence) || !guide.evidence.length) errors.push(`${label}：缺少提示词证据`);
    for (const [evidenceIndex, evidence] of (guide.evidence ?? []).entries()) {
      exactFields(evidence, ["case_id", "prompt_version_id", "excerpt"], `${label}.evidence[${evidenceIndex}]`, errors);
      const prompt = promptById.get(evidence.prompt_version_id);
      if (!prompt || prompt.case_id !== evidence.case_id || evidence.prompt_version_id !== `${evidence.case_id}/pv-001`) errors.push(`${label}：证据必须回连本案例原始 pv-001`);
      if (prompt && !isExcerptOf(evidence.excerpt, [prompt.text])) errors.push(`${label}：结构板摘录不在原提示词中`);
      const targetPatterns = structureEvidencePatterns[guide.guide_id] ?? [];
      if (targetPatterns.length && !targetPatterns.some((pattern) => pattern.test(evidence.excerpt ?? ""))) errors.push(`${label}：结构板摘录未命中本指南的结构目标词`);
      if (Array.from(evidence.excerpt ?? "").length > 180) errors.push(`${label}：结构板摘录过长`);
    }
  }
  const dimensionText = JSON.stringify(structureIds.get("structure-sheet-dimensions") ?? {});
  const materialText = JSON.stringify(structureIds.get("structure-sheet-materials") ?? {});
  if (!/尺寸/iu.test(dimensionText) || /单位|毫米/iu.test(dimensionText) === false || /箭头|尺寸线/iu.test(dimensionText) === false || /视图|边界/iu.test(dimensionText) === false) {
    errors.push("尺寸指南必须写出数值、单位、箭头起止与视图边界的难点");
  }
  if (!/材料/iu.test(materialText) || /部件/iu.test(materialText) === false || /表面|处理|质感/iu.test(materialText) === false || /归属|绑定|对应/iu.test(materialText) === false) {
    errors.push("材料指南必须写出材料、表面处理与部件归属的难点");
  }
  const methodById = uniqueIndex(input.methods, "method_id", "方法", errors);
  if (methodById.size !== 2) errors.push("方法必须恰好两条且 ID 唯一");
  const recomputed = recompute(input.experimentVersions, input.runs, input.scoreRevisions);
  const validCvById = new Map(recomputed.conclusions.map((cv) => [cv.conclusion_version_id, cv]));
  const publishedCvById = new Map(input.conclusions.map((cv) => [cv.conclusion_version_id, cv]));
  for (const [index, method] of input.methods.entries()) {
    const label = `methods[${index}]`;
    exactFields(method, methodFields, label, errors);
    if (!Array.isArray(method.conclusion_version_ids) || !method.conclusion_version_ids.length) errors.push(`${label}：必须引用有效 CV`);
    if (!Array.isArray(method.evidence) || method.evidence.length !== method.conclusion_version_ids?.length) errors.push(`${label}：每个 CV 引用必须恰有一份证据快照`);
    for (const cvId of method.conclusion_version_ids ?? []) {
      const valid = validCvById.get(cvId);
      const published = publishedCvById.get(cvId);
      if (!valid || !published || canonical(valid) !== canonical(published)) {
        errors.push(`${label}：无效、陈旧或不可重算的 CV ${cvId}`);
        continue;
      }
      const snapshots = method.evidence.filter((item) => item.conclusion_version_id === cvId);
      if (snapshots.length !== 1) errors.push(`${label}：CV ${cvId} 的证据快照数量不为 1`);
      else validateMethodEvidence(snapshots[0], valid, `${label}.evidence(${cvId})`, errors);
    }
  }
  for (const required of ["prose-contract-exact-text", "blank-band-deterministic-overlay"]) if (!methodById.has(required)) errors.push(`缺少方法 ${required}`);
  const outputStrings = allStrings({ guides: input.guides, decisions: input.decisions, structureGuides: input.structureGuides, methods: input.methods });
  for (const value of outputStrings) {
    const match = bannedTone.exec(value);
    if (match) errors.push(`输出含禁用语气词“${match[0]}”：${compact(value).slice(0, 80)}`);
  }
  const promptTexts = [...input.casePromptVersions, ...input.experimentPromptVersions].map((item) => compact(item.text)).filter((text) => text.length > 20);
  for (const value of outputStrings) if (promptTexts.includes(compact(value))) errors.push(`输出存在整段提示词：${compact(value).slice(0, 60)}`);
  const distribution = Object.fromEntries(["inferred", "tested", "observed"].map((level) => [level, input.decisions.filter((item) => item.evidence_level === level).length]));
  if (distribution.inferred !== 541 || distribution.tested !== 10 || distribution.observed !== 20) errors.push(`证据级别分布错误：${JSON.stringify(distribution)}`);
  const report = input.report;
  if (report.task_id !== "T07" || report.passed !== true || report.drift?.length !== 0) errors.push("editorial-coverage 报告必须 passed=true 且 drift 为空");
  if (report.coverage?.case_guides !== 541 || report.coverage?.inferred_case_coverage !== 541 || report.coverage?.h1_cases !== 10) errors.push("报告覆盖数与实际要求不一致");
  if (report.decisions?.total !== input.decisions.length || canonical(report.decisions?.evidence_level_distribution) !== canonical(distribution)) errors.push("报告决策数或证据级别分布与文件不一致");
  if (report.audit?.sample_case_ids?.length !== 20 || new Set(report.audit.sample_case_ids).size !== 20) errors.push("报告抽样必须为 20 个唯一案例");
  if (errors.length) throw new Error(`T07 校验失败（${errors.length} 项）\n${errors.slice(0, 80).join("\n")}${errors.length > 80 ? `\n另有 ${errors.length - 80} 项` : ""}`);
  console.log(`✓ 案例指南：${guideByCase.size}/541；原始提示词 inferred 覆盖 ${distribution.inferred}/541`);
  console.log(`✓ H1：${h1CaseIds.size}/10，每例 1 张 inferred、1 张 tested、2 张 observed`);
  console.log(`✓ 决策：${input.decisions.length} 张；${JSON.stringify(distribution)}；Run 与当前评分回链有效`);
  console.log(`✓ 结构板指南：视图、尺寸、材料 ${structureIds.size} 条；尺寸单位/箭头与材料部件归属难点齐全`);
  console.log(`✓ 方法：${methodById.size} 条；仅引用当前可重算的有效 ConclusionVersion`);
  console.log("✓ 无禁用语气、无整段提示词、无孤立证据引用，构建漂移为空");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
