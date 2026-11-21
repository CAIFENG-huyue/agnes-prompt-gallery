import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { buildImport, outputPaths, projectRoot, readJson, serialize } from "./import-cases.mjs";

const schemaDirectory = path.join(projectRoot, "schemas");
const schemaFiles = ["common.schema.json", "case.schema.json", "asset.schema.json", "prompt-version.schema.json"];
const schemas = new Map();

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function matchesType(value, type) {
  if (type === "null") return value === null;
  if (type === "array") return Array.isArray(value);
  if (type === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
  if (type === "integer") return Number.isInteger(value);
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  return typeof value === type;
}

function resolveReference(reference, currentSchemaPath) {
  const hashIndex = reference.indexOf("#");
  const filePart = hashIndex === -1 ? reference : reference.slice(0, hashIndex);
  const fragment = hashIndex === -1 ? "" : reference.slice(hashIndex + 1);
  const targetPath = filePart ? path.resolve(path.dirname(currentSchemaPath), filePart) : currentSchemaPath;
  let target = schemas.get(targetPath);
  assert(target, `未加载的 Schema 引用：${reference}`);
  if (fragment) {
    assert(fragment.startsWith("/"), `不支持的 Schema 片段：${reference}`);
    for (const token of fragment.slice(1).split("/")) {
      target = target?.[token.replaceAll("~1", "/").replaceAll("~0", "~")];
      assert(target !== undefined, `无法解析 Schema 引用：${reference}`);
    }
  }
  return { schema: target, schemaPath: targetPath };
}

function validateValue(value, schema, schemaPath, instancePath, errors) {
  if (schema.$ref) {
    const resolved = resolveReference(schema.$ref, schemaPath);
    validateValue(value, resolved.schema, resolved.schemaPath, instancePath, errors);
  }
  if (schema.anyOf) {
    const matched = schema.anyOf.some((branch) => {
      const branchErrors = [];
      validateValue(value, branch, schemaPath, instancePath, branchErrors);
      return branchErrors.length === 0;
    });
    if (!matched) errors.push(`${instancePath}：不匹配 anyOf 的任何分支`);
  }
  if (schema.enum && !schema.enum.some((candidate) => canonical(candidate) === canonical(value))) {
    errors.push(`${instancePath}：值不在枚举中`);
  }
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((type) => matchesType(value, type))) {
      errors.push(`${instancePath}：类型应为 ${types.join(" 或 ")}`);
      return;
    }
  }
  if (typeof value === "string") {
    const length = Array.from(value).length;
    if (schema.minLength !== undefined && length < schema.minLength) errors.push(`${instancePath}：字符串为空或过短`);
    if (schema.maxLength !== undefined && length > schema.maxLength) errors.push(`${instancePath}：字符串过长`);
    if (schema.pattern && !new RegExp(schema.pattern, "u").test(value)) errors.push(`${instancePath}：不匹配 ${schema.pattern}`);
  }
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${instancePath}：小于最小值 ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${instancePath}：大于最大值 ${schema.maximum}`);
  }
  if (Array.isArray(value)) {
    if (schema.uniqueItems && new Set(value.map(canonical)).size !== value.length) errors.push(`${instancePath}：数组项不唯一`);
    if (schema.items) value.forEach((item, index) => validateValue(item, schema.items, schemaPath, `${instancePath}[${index}]`, errors));
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    for (const key of schema.required ?? []) {
      if (!Object.hasOwn(value, key)) errors.push(`${instancePath}：缺少必填字段 ${key}`);
    }
    const properties = schema.properties ?? {};
    for (const [key, subschema] of Object.entries(properties)) {
      if (Object.hasOwn(value, key)) validateValue(value[key], subschema, schemaPath, `${instancePath}.${key}`, errors);
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!Object.hasOwn(properties, key)) errors.push(`${instancePath}：存在未声明字段 ${key}`);
      }
    }
  }
}

function validateSchema(value, schemaFile, label) {
  const schemaPath = path.join(schemaDirectory, schemaFile);
  const errors = [];
  validateValue(value, schemas.get(schemaPath), schemaPath, "$", errors);
  assert(errors.length === 0, `${label} 未通过 ${schemaFile}\n${errors.slice(0, 20).join("\n")}`);
}

function uniqueCount(values) {
  return new Set(values).size;
}

async function main() {
  for (const schemaFile of schemaFiles) {
    const schemaPath = path.join(schemaDirectory, schemaFile);
    schemas.set(schemaPath, await readJson(schemaPath));
  }

  const { documents: expected, details } = await buildImport();
  const actual = {};
  for (const outputPath of outputPaths) {
    actual[outputPath] = await readJson(path.join(projectRoot, outputPath));
    assert(isDeepStrictEqual(actual[outputPath], expected[outputPath]), `${outputPath} 与确定性重建结果不一致`);
  }

  const cases = actual["content/cases.json"];
  const promptVersions = actual["content/prompt-versions/cases.json"];
  const sourceAssets = actual["content/source-assets.json"];
  const goldCaseIds = actual["content/gold-case-ids.json"];

  assert(cases.length === 541 && uniqueCount(cases.map((item) => item.case_id)) === 541, "Case 必须为 541 个唯一主键");
  assert(promptVersions.length === 541 && uniqueCount(promptVersions.map((item) => item.prompt_version_id)) === 541, "PromptVersion 必须为 541 个唯一版本");
  assert(sourceAssets.length === 541 && uniqueCount(sourceAssets.map((item) => item.asset_id)) === 541, "来源资产必须为 541 个唯一 ID");
  assert(goldCaseIds.length === 60 && uniqueCount(goldCaseIds) === 60, "金标必须为 60 个唯一 case_id");

  cases.forEach((item, index) => {
    validateSchema(item, "case.schema.json", `Case[${index}]`);
    assert(!Object.hasOwn(item, "primary_category_id") && !Object.hasOwn(item, "category"), `${item.case_id} 不得内嵌一级分类或原 category`);
  });
  promptVersions.forEach((item, index) => {
    validateSchema(item, "prompt-version.schema.json", `PromptVersion[${index}]`);
    const digest = createHash("sha256").update(item.text).digest("hex");
    assert(item.content_sha256 === digest, `${item.prompt_version_id} 的提示词哈希不匹配`);
    assert(item.version_no === 1 && item.parent_version_id === null, `${item.prompt_version_id} 不是原始首版`);
  });
  sourceAssets.forEach((item, index) => validateSchema(item, "asset.schema.json", `Asset[${index}]`));

  const caseById = new Map(cases.map((item) => [item.case_id, item]));
  const promptByCaseId = new Map(promptVersions.map((item) => [item.case_id, item]));
  const assetById = new Map(sourceAssets.map((item) => [item.asset_id, item]));
  for (const item of cases) {
    assert(promptByCaseId.has(item.case_id), `${item.case_id} 缺少原始提示词版本`);
    assert(assetById.get(item.cover_asset_id), `${item.case_id} 的封面资产不存在`);
    assert(details.gold.strata.some((stratum) => stratum.original_category === item.source.original_category), `${item.case_id} 的原类别无效`);
  }
  for (const item of promptVersions) {
    assert(caseById.has(item.case_id), `${item.prompt_version_id} 无法回连 Case`);
    assert(item.prompt_version_id === `${item.case_id}/pv-001`, `${item.prompt_version_id} 的 ID 规则错误`);
  }
  for (const goldCaseId of goldCaseIds) assert(caseById.has(goldCaseId), `金标 case_id 不存在：${goldCaseId}`);

  const h1CaseIds = details.gold.h1_case_ids;
  assert(h1CaseIds.every((caseId) => goldCaseIds.includes(caseId)), "金标缺少 H1 case_id");
  const goldCategories = new Set(goldCaseIds.map((caseId) => caseById.get(caseId).source.original_category));
  assert(goldCategories.size === 13, "金标未覆盖全部 13 个原始类别");
  for (const stratum of details.gold.strata) {
    const selected = goldCaseIds.filter((caseId) => caseById.get(caseId).source.original_category === stratum.original_category);
    assert(selected.length === stratum.quota, `${stratum.original_category} 的金标分层配额不符`);
  }

  const reportPath = path.join(projectRoot, "reports", "import.json");
  let report = {};
  try {
    report = await readJson(reportPath);
  } catch (error) {
    assert(error.code === "ENOENT", `无法读取导入报告：${error.message}`);
  }
  report.task_id = "T03";
  report.status = "passed";
  report.validation = {
    command: "node tools/validate-cases.mjs",
    status: "passed",
    schema_case_count: cases.length,
    schema_prompt_version_count: promptVersions.length,
    schema_source_asset_count: sourceAssets.length,
    readable_source_images: details.source.readable_source_images,
    gold_case_count: goldCaseIds.length,
    gold_category_count: goldCategories.size,
    gold_h1_case_count: h1CaseIds.length,
    deterministic_output_match: true
  };
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, serialize(report), "utf8");

  console.log(`通过：${cases.length} 个 Case、${promptVersions.length} 个 PromptVersion、${sourceAssets.length} 个来源资产符合 Schema 与关联约束`);
  console.log(`通过：${details.source.readable_source_images} 张原图可读，尺寸、格式、哈希与清单一致`);
  console.log(`通过：金标 ${goldCaseIds.length} 条，覆盖 ${goldCategories.size} 个原始类别，包含全部 ${h1CaseIds.length} 个 H1 case_id`);
  console.log("案例校验完成，报告：reports/import.json");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
