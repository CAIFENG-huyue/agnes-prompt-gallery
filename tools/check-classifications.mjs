import path from "node:path";
import { fileURLToPath } from "node:url";
import { classifierVersion, readJson, selectAuditSampleIds } from "./classify-cases.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const classificationFields = [
  "case_id",
  "primary_category_id",
  "confidence",
  "rationale",
  "evidence_excerpt",
  "classifier_version",
  "review_status"
];
const reviewStatuses = new Set(["unreviewed", "reviewed", "gold_arbitrated"]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function validateRecord(record, categoryIds, expectedVersion, label, errors) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    errors.push(`${label}：必须是对象`);
    return;
  }
  const keys = Object.keys(record);
  if (keys.length !== classificationFields.length || classificationFields.some((field) => !Object.hasOwn(record, field))) {
    errors.push(`${label}：必须且只能包含 ${classificationFields.join("、")}`);
  }
  if (typeof record.case_id !== "string" || !record.case_id) errors.push(`${label}：case_id 必须非空`);
  if (!categoryIds.has(record.primary_category_id)) errors.push(`${label}：一级分类不属于 taxonomy 五类`);
  if (typeof record.confidence !== "number" || !Number.isFinite(record.confidence) || record.confidence < 0 || record.confidence > 1) {
    errors.push(`${label}：confidence 必须在 0 到 1 之间`);
  }
  for (const field of ["rationale", "evidence_excerpt", "classifier_version"]) {
    if (typeof record[field] !== "string" || !record[field].trim()) errors.push(`${label}：${field} 必须非空`);
  }
  if (typeof record.evidence_excerpt === "string" && Array.from(record.evidence_excerpt).length > 260) {
    errors.push(`${label}：evidence_excerpt 必须是不超过 260 字的短句`);
  }
  if (record.classifier_version !== expectedVersion) errors.push(`${label}：classifier_version 应为 ${expectedVersion}`);
  if (!reviewStatuses.has(record.review_status)) errors.push(`${label}：review_status 无效`);
}

function indexUnique(records, expectedIds, label, errors) {
  const byId = new Map();
  for (const record of records) {
    if (byId.has(record.case_id)) errors.push(`${label}：重复 case_id ${record.case_id}`);
    byId.set(record.case_id, record);
  }
  for (const id of expectedIds) {
    if (!byId.has(id)) errors.push(`${label}：缺少 ${id}`);
  }
  for (const id of byId.keys()) {
    if (!expectedIds.has(id)) errors.push(`${label}：存在集合外 case_id ${id}`);
  }
  return byId;
}

async function main() {
  const [cases, taxonomy, goldCaseIds, classifications, goldClassifications, agreement] = await Promise.all([
    readJson(path.join(projectRoot, "content", "cases.json")),
    readJson(path.join(projectRoot, "content", "taxonomy.json")),
    readJson(path.join(projectRoot, "content", "gold-case-ids.json")),
    readJson(path.join(projectRoot, "content", "classifications.json")),
    readJson(path.join(projectRoot, "content", "gold-classifications.json")),
    readJson(path.join(projectRoot, "reports", "classification-agreement.json"))
  ]);
  const errors = [];
  if (!Array.isArray(cases) || cases.length !== 541) errors.push(`案例必须为 541 条，实际为 ${cases?.length}`);
  if (!Array.isArray(classifications)) errors.push("classifications.json 顶层必须是数组");
  if (!Array.isArray(goldClassifications)) errors.push("gold-classifications.json 顶层必须是数组");
  if (errors.length > 0) throw new Error(errors.join("\n"));
  const categoryIds = new Set(taxonomy.categories.map((category) => category.category_id));
  if (categoryIds.size !== 5) errors.push("taxonomy 必须恰好包含五个唯一一级分类");
  const caseIds = new Set(cases.map((item) => item.case_id));
  const goldIds = new Set(goldCaseIds);
  if (goldCaseIds.length !== 60 || goldIds.size !== 60) errors.push("金标 ID 必须为 60 个唯一值");
  if (goldClassifications.length !== 60) errors.push(`金标分类必须为 60 条，实际为 ${goldClassifications.length}`);
  for (const id of goldIds) {
    if (!caseIds.has(id)) errors.push(`金标 ID 不在案例中：${id}`);
  }

  const productionById = indexUnique(classifications, caseIds, "生产分类", errors);
  const goldById = indexUnique(goldClassifications, goldIds, "金标分类", errors);
  classifications.forEach((record, index) => validateRecord(record, categoryIds, classifierVersion, `生产分类[${index}]`, errors));
  goldClassifications.forEach((record, index) => {
    validateRecord(record, categoryIds, "manual-gold-v1", `金标分类[${index}]`, errors);
    if (record.review_status !== "reviewed") errors.push(`金标分类[${index}]：单人判定只能标 reviewed`);
  });

  const mismatches = [];
  for (const id of goldIds) {
    const production = productionById.get(id);
    const gold = goldById.get(id);
    if (!production || !gold) continue;
    if (production.review_status !== "reviewed") errors.push(`${id}：生产金标记录必须已复核`);
    if (production.primary_category_id !== gold.primary_category_id) {
      mismatches.push(`${id}：生产=${production.primary_category_id}，金标=${gold.primary_category_id}`);
    }
  }
  const correct = goldIds.size - mismatches.length;
  const accuracy = correct / goldIds.size;
  if (accuracy < 0.95) errors.push(`金标准确率不足 95%：${correct}/${goldIds.size}\n${mismatches.join("\n")}`);

  const auditSampleIds = selectAuditSampleIds(cases, goldCaseIds);
  if (auditSampleIds.size !== 49) errors.push(`非金标抽审样本必须为 49 条，实际为 ${auditSampleIds.size}`);
  for (const id of auditSampleIds) {
    if (productionById.get(id)?.review_status !== "reviewed") errors.push(`${id}：非金标抽审记录必须标 reviewed`);
  }

  if (agreement.task_id !== "T04" || agreement.status !== "pending_external_review") errors.push("一致性报告必须是 T04 待外部复核模板");
  for (const field of ["annotator_a_id", "annotator_b_id", "arbitrator_id", "cohens_kappa"]) {
    if (agreement[field] !== null) errors.push(`一致性模板 ${field} 必须为 null`);
  }
  for (const field of ["independent_annotations", "arbitrated_annotations"]) {
    if (!Array.isArray(agreement[field]) || agreement[field].length !== 0) errors.push(`一致性模板 ${field} 必须为空数组`);
  }

  assert(errors.length === 0, `分类校验失败\n${errors.join("\n")}`);
  const counts = Object.fromEntries([...categoryIds].map((id) => [id, classifications.filter((item) => item.primary_category_id === id).length]));
  console.log(`✓ 覆盖与唯一性：${productionById.size}/${caseIds.size}，每条恰好一个五类 primary_category_id`);
  console.log(`✓ 金标：${goldById.size}/60，生产一致 ${correct}/60，准确率 ${(accuracy * 100).toFixed(2)}%`);
  console.log(`✓ 非金标同人抽审：${auditSampleIds.size} 条，固定哈希可复现`);
  console.log(`✓ 各类数量：${JSON.stringify(counts)}`);
  console.log("✓ 双人标注、仲裁与 Cohen’s κ：空模板，待外部流程填写");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
