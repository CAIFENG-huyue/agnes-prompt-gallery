import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertValidSearchIndex,
  compareSearchResults,
  parseSearchQuery,
  searchIndex
} from "../src/lib/search/engine.js";

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const reportPath = "reports/search-eval.json";
const HARD_QUERY = "企鹅饼干礼盒结构板，带尺寸和材料说明";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function rounded(value) {
  return Number(value.toFixed(6));
}

function matchesRelevance(document, relevance) {
  if (relevance.layouts && !relevance.layouts.includes(document.layout)) return false;
  if (relevance.input_mode && document.input_mode !== relevance.input_mode) return false;
  if (relevance.subject_count !== undefined && document.subject_count !== relevance.subject_count) return false;
  if (relevance.any_text_slot && document.text_slots.length === 0) return false;
  if (!(relevance.required_slots ?? []).every((slotId) => document.text_slots.some((slot) => slot.slot_id === slotId))) return false;
  return (relevance.required_intents ?? []).every((intentId) => document.intents.includes(intentId));
}

function validateGold(gold, index) {
  assert(gold.query_count === 25 && gold.queries.length === 25, "检索金标必须恰好包含 25 条查询");
  assert(new Set(gold.queries.map((query) => query.query_id)).size === 25, "检索金标 query_id 必须唯一");
  assert(new Set(gold.queries.map((query) => query.query)).size === 25, "检索金标查询文本必须唯一");
  const hardQueries = gold.queries.filter((query) => query.hard_scenario);
  assert(hardQueries.length === 1 && hardQueries[0].query === HARD_QUERY, "企鹅硬场景必须唯一且查询文本固定");
  for (const query of gold.queries) {
    assert(Number.isInteger(query.min_top5_hits) && query.min_top5_hits >= 1 && query.min_top5_hits <= 5, `${query.query_id} 的 Top5 命中门槛不合法`);
    assert(query.confirmed_case_ids.length >= query.min_top5_hits, `${query.query_id} 的确认案例少于命中门槛`);
    const parsed = parseSearchQuery(index, query.query);
    assert(query.expected_intent_ids.every((intentId) => parsed.direct_intent_ids.includes(intentId)), `${query.query_id} 未能从查询解析出预期意图`);
    for (const caseId of query.confirmed_case_ids) {
      const document = index.documents[caseId];
      assert(document, `${query.query_id} 引用了未知案例 ${caseId}`);
      assert(matchesRelevance(document, query.relevance), `${query.query_id} 的确认案例 ${caseId} 不满足相关性条件`);
    }
  }
}

function precedenceChecks() {
  const result = (caseId, structure, intent, text) => ({ case_id: caseId, scores: { structure, intent, text } });
  return [
    {
      check: "structure_precedes_intent_and_text",
      passed: compareSearchResults(result("case-a", 0.01, 0, 0), result("case-b", 0, 1000, 1000)) < 0
    },
    {
      check: "intent_precedes_text_when_structure_ties",
      passed: compareSearchResults(result("case-a", 100, 0.01, 0), result("case-b", 100, 0, 1000)) < 0
    },
    {
      check: "text_breaks_structure_and_intent_ties",
      passed: compareSearchResults(result("case-a", 100, 100, 0.01), result("case-b", 100, 100, 0)) < 0
    }
  ];
}

export async function evaluate() {
  const [index, gold] = await Promise.all([
    readFile(path.join(projectRoot, "generated", "search-index.json"), "utf8").then(JSON.parse),
    readFile(path.join(projectRoot, "quality", "search-gold.json"), "utf8").then(JSON.parse)
  ]);
  assertValidSearchIndex(index);
  validateGold(gold, index);
  const queryReports = gold.queries.map((query) => {
    const top5 = searchIndex(index, query.query, { limit: 5 });
    const relevantResults = top5.filter((result) => matchesRelevance(index.documents[result.case_id], query.relevance));
    const reasonsPassed = top5.every((result) => result.reasons.length > 0 && result.reasons.every((reason) => reason.text.trim().length > 0));
    const orderingPassed = top5.slice(1).every((result, position) => compareSearchResults(top5[position], result) <= 0);
    const hits = relevantResults.length;
    const confirmedHits = top5.filter((result) => query.confirmed_case_ids.includes(result.case_id)).length;
    return {
      query_id: query.query_id,
      query: query.query,
      hard_scenario: query.hard_scenario === true,
      expected_intent_ids: query.expected_intent_ids,
      min_top5_hits: query.min_top5_hits,
      top5_relevant_hits: hits,
      top5_relevant_case_ids: relevantResults.map((result) => result.case_id),
      confirmed_recall_at_5: rounded(confirmedHits / query.confirmed_case_ids.length),
      reasons_passed: reasonsPassed,
      ordering_passed: orderingPassed,
      passed: hits >= query.min_top5_hits && reasonsPassed && orderingPassed,
      top5
    };
  });
  const orderingChecks = precedenceChecks();
  const hardReport = queryReports.find((query) => query.hard_scenario);
  const totalResults = queryReports.reduce((sum, query) => sum + query.top5.length, 0);
  const resultsWithReasons = queryReports.reduce((sum, query) => sum + query.top5.filter((result) => result.reasons.length > 0).length, 0);
  const orderingPassed = queryReports.every((query) => query.ordering_passed) && orderingChecks.every((check) => check.passed);
  const penguinPassed = hardReport.top5_relevant_hits >= 3 && hardReport.top5.length > 0 && hardReport.reasons_passed;
  const passed = queryReports.every((query) => query.passed) && orderingPassed && penguinPassed && resultsWithReasons === totalResults;
  return {
    task_id: "T09",
    status: passed ? "passed" : "failed",
    passed,
    tool: "tools/evaluate-search.mjs",
    gold_version: gold.gold_version,
    index_version: index.index_version,
    ranking: index.ranking,
    query_count: queryReports.length,
    queries_passed: queryReports.filter((query) => query.passed).length,
    metrics: {
      mean_confirmed_recall_at_5: rounded(queryReports.reduce((sum, query) => sum + query.confirmed_recall_at_5, 0) / queryReports.length),
      results_with_reasons: resultsWithReasons,
      total_results: totalResults,
      reason_coverage: rounded(resultsWithReasons / (totalResults || 1))
    },
    ordering: {
      policy: "依次比较 structure、intent、text 分数；仅当前项相同才比较下一项，最后按 case_id 稳定排序。",
      synthetic_checks: orderingChecks,
      passed: orderingPassed
    },
    penguin_hard_scenario: {
      query: HARD_QUERY,
      required_same_structure_hits: 3,
      actual_same_structure_hits: hardReport.top5_relevant_hits,
      same_structure_case_ids: hardReport.top5_relevant_case_ids,
      all_results_have_reasons: hardReport.reasons_passed,
      passed: penguinPassed,
      top5: hardReport.top5
    },
    queries: queryReports
  };
}

async function main() {
  assert(process.argv.length === 2, "用法：node tools/evaluate-search.mjs");
  const report = await evaluate();
  await writeFile(path.join(projectRoot, reportPath), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`检索评估${report.passed ? "通过" : "失败"}：${report.queries_passed}/${report.query_count} 条查询达标，命中原因覆盖 ${report.metrics.results_with_reasons}/${report.metrics.total_results}`);
  console.log(`企鹅题 Top5 同结构命中：${report.penguin_hard_scenario.actual_same_structure_hits}/5（要求 ≥3），案例：${report.penguin_hard_scenario.same_structure_case_ids.join("、")}`);
  console.log(`排序策略：${report.ranking.priority.join(" > ")}（${report.ranking.method}）`);
  if (!report.passed) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
