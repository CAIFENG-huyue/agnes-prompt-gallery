import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REVIEW_FILES = [
  { file: "agent/agnes/pipeline/review.jsonl", source: "review" },
  { file: "agent/agnes/pipeline/review-flash.jsonl", source: "review-flash" },
  { file: "agent/agnes/pipeline/review-final.jsonl", source: "review-final" }
];
const PATTERNS_FILE = "agent/agnes/pipeline/patterns.json";

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(projectRoot, relativePath), "utf8"));
}

async function readJsonl(file) {
  const text = await readFile(file, "utf8");
  return text
    .split(/\r?\n/u)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
}

function numericCaseId(value) {
  const text = String(value);
  const prefixed = text.match(/^case-(\d+)$/u);
  if (prefixed) return Number(prefixed[1]);
  if (/^\d+$/u.test(text)) return Number(text);
  return null;
}

function caseIdOf(id) {
  return `case-${id}`;
}

function byNumber(left, right) {
  return left - right;
}

function countBy(items, getKey) {
  const counts = new Map();
  for (const item of items) {
    const key = getKey(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

async function buildVerdicts(caseIds) {
  const verdicts = new Map();
  for (const { file, source } of REVIEW_FILES) {
    const rows = await readJsonl(file);
    for (const row of rows) {
      const id = numericCaseId(row.case_id);
      if (id === null || !caseIds.has(id)) continue;
      verdicts.set(id, {
        case_id: caseIdOf(id),
        verdict: String(row.verdict),
        gates: Array.isArray(row.gates) ? [...new Set(row.gates.map(String))] : [],
        note: typeof row.note === "string" ? row.note.trim() : "",
        source
      });
    }
  }
  return [...verdicts.values()].sort((left, right) => byNumber(numericCaseId(left.case_id), numericCaseId(right.case_id)));
}

function buildPatterns(verdicts, classifications) {
  const categoryByCase = new Map(classifications.map((item) => [item.case_id, item.primary_category_id]));
  const categoryIds = [...new Set(classifications.map((item) => item.primary_category_id))];

  const categories = categoryIds
    .map((category) => {
      const rows = verdicts.filter((item) => categoryByCase.get(item.case_id) === category);
      const pass = rows.filter((item) => item.verdict === "PASS" || item.verdict === "PASS-WEAK").length;
      const fail = rows.filter((item) => item.verdict === "FAIL").length;
      const review = rows.filter((item) => item.verdict === "REVIEW").length;
      const n = rows.length;
      return {
        category,
        n,
        pass,
        fail,
        review,
        pass_rate: n > 0 ? Number(((pass / n) * 100).toFixed(1)) : 0
      };
    })
    .sort((left, right) => right.n - left.n || left.category.localeCompare(right.category));

  const gateNames = [...new Set(verdicts.flatMap((item) => item.gates))];
  const gates = gateNames
    .map((gate) => {
      const rows = verdicts.filter((item) => item.gates.includes(gate));
      const examples = rows
        .slice(0, 6)
        .map((item) => ({
          case_id: numericCaseId(item.case_id),
          note: item.note,
          category: categoryByCase.get(item.case_id)
        }));
      const categoryCounts = countBy(rows, (item) => categoryByCase.get(item.case_id));
      return {
        gate,
        n: rows.length,
        examples,
        categories: [...categoryCounts.entries()].sort((left, right) => right[1] - left[1])
      };
    })
    .sort((left, right) => right.n - left.n || left.gate.localeCompare(right.gate));

  const totals = {
    PASS: verdicts.filter((item) => item.verdict === "PASS").length,
    "PASS-WEAK": verdicts.filter((item) => item.verdict === "PASS-WEAK").length,
    FAIL: verdicts.filter((item) => item.verdict === "FAIL").length,
    REVIEW: verdicts.filter((item) => item.verdict === "REVIEW").length,
    BLOCKED: verdicts.filter((item) => item.verdict === "BLOCKED").length
  };

  return { totals, judged: verdicts.length, categories, gates };
}

function assertPatternsMatch(derived, reference) {
  const totalsMatch = ["PASS", "BLOCKED", "FAIL", "PASS-WEAK", "REVIEW"]
    .every((key) => derived.totals[key] === reference.totals[key]);
  const categoriesMatch = reference.categories.every((expected) => {
    const actual = derived.categories.find((item) => item.category === expected.category);
    return actual
      && actual.n === expected.n
      && actual.pass === expected.pass
      && actual.fail === expected.fail
      && actual.review === expected.review;
  });
  const gatesMatch = reference.gates.every((expected) => (
    derived.gates.find((item) => item.gate === expected.gate)?.n === expected.n
  ));
  if (!totalsMatch || !categoriesMatch || !gatesMatch) {
    throw new Error("生成的规律与参考 patterns.json 不一致，请检查判定数据版本");
  }
}

async function main() {
  const [cases, classifications] = await Promise.all([
    readJson("content/cases.json"),
    readJson("content/classifications.json")
  ]);
  const caseIds = new Set(cases.map((item) => numericCaseId(item.case_id)).filter((id) => id !== null));
  const verdicts = await buildVerdicts(caseIds);
  const patterns = buildPatterns(verdicts, classifications);
  const reference = JSON.parse(await readFile(PATTERNS_FILE, "utf8"));
  assertPatternsMatch(patterns, reference);

  await writeFile(
    path.join(projectRoot, "content", "verdicts.json"),
    `${JSON.stringify(verdicts, null, 2)}\n`,
    "utf8"
  );
  await writeFile(
    path.join(projectRoot, "content", "patterns.json"),
    `${JSON.stringify(patterns, null, 2)}\n`,
    "utf8"
  );
  console.log(`verdicts.json：${verdicts.length} 条；patterns.json：${patterns.categories.length} 类、${patterns.gates.length} 个失败门槛；与参考 patterns.json 计数一致。`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
