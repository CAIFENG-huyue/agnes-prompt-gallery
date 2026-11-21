import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const schemaDirectory = path.join(projectRoot, "schemas");
const schemaFiles = [
  "common.schema.json",
  "category.schema.json",
  "taxonomy.schema.json",
  "case.schema.json",
  "classification.schema.json",
  "fingerprint.schema.json",
  "guide.schema.json",
  "asset.schema.json",
  "prompt-version.schema.json",
  "experiment-version.schema.json",
  "run.schema.json",
  "score-revision.schema.json",
  "decision.schema.json",
  "conclusion-version.schema.json"
];
const schemas = new Map();

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

for (const fileName of schemaFiles) {
  const filePath = path.join(schemaDirectory, fileName);
  schemas.set(filePath, await readJson(filePath));
}

function canonical(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(",")}]`;
  }
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
  const targetPath = filePart
    ? path.resolve(path.dirname(currentSchemaPath), filePart)
    : currentSchemaPath;
  const rootSchema = schemas.get(targetPath);
  if (!rootSchema) {
    throw new Error(`未加载的 Schema 引用：${reference}`);
  }
  let target = rootSchema;
  if (fragment) {
    if (!fragment.startsWith("/")) {
      throw new Error(`不支持的 Schema 片段：${reference}`);
    }
    for (const token of fragment.slice(1).split("/")) {
      const key = token.replaceAll("~1", "/").replaceAll("~0", "~");
      target = target?.[key];
      if (target === undefined) {
        throw new Error(`无法解析 Schema 引用：${reference}`);
      }
    }
  }
  return { schema: target, schemaPath: targetPath };
}

function validateValue(value, schema, schemaPath, instancePath, errors) {
  if (schema === true) return true;
  if (schema === false) {
    errors.push(`${instancePath}：Schema 禁止该值`);
    return false;
  }
  if (!schema || typeof schema !== "object") {
    throw new Error(`无效 Schema：${schemaPath}`);
  }

  const initialErrorCount = errors.length;

  if (schema.$ref) {
    const resolved = resolveReference(schema.$ref, schemaPath);
    validateValue(value, resolved.schema, resolved.schemaPath, instancePath, errors);
  }

  if (schema.allOf) {
    for (const subschema of schema.allOf) {
      validateValue(value, subschema, schemaPath, instancePath, errors);
    }
  }

  if (schema.anyOf) {
    const matched = schema.anyOf.some((subschema) => {
      const branchErrors = [];
      validateValue(value, subschema, schemaPath, instancePath, branchErrors);
      return branchErrors.length === 0;
    });
    if (!matched) errors.push(`${instancePath}：不匹配 anyOf 的任何分支`);
  }

  if (schema.oneOf) {
    const matches = schema.oneOf.filter((subschema) => {
      const branchErrors = [];
      validateValue(value, subschema, schemaPath, instancePath, branchErrors);
      return branchErrors.length === 0;
    }).length;
    if (matches !== 1) errors.push(`${instancePath}：oneOf 匹配数为 ${matches}，应为 1`);
  }

  if (schema.not) {
    const branchErrors = [];
    validateValue(value, schema.not, schemaPath, instancePath, branchErrors);
    if (branchErrors.length === 0) errors.push(`${instancePath}：不应匹配 not Schema`);
  }

  if (schema.if) {
    const conditionErrors = [];
    validateValue(value, schema.if, schemaPath, instancePath, conditionErrors);
    const branch = conditionErrors.length === 0 ? schema.then : schema.else;
    if (branch) validateValue(value, branch, schemaPath, instancePath, errors);
  }

  if (schema.const !== undefined && canonical(value) !== canonical(schema.const)) {
    errors.push(`${instancePath}：应为常量 ${JSON.stringify(schema.const)}`);
  }

  if (schema.enum && !schema.enum.some((candidate) => canonical(candidate) === canonical(value))) {
    errors.push(`${instancePath}：值 ${JSON.stringify(value)} 不在枚举中`);
  }

  if (schema.type) {
    const allowedTypes = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!allowedTypes.some((type) => matchesType(value, type))) {
      errors.push(`${instancePath}：类型应为 ${allowedTypes.join(" 或 ")}`);
      return errors.length === initialErrorCount;
    }
  }

  if (typeof value === "string") {
    const length = Array.from(value).length;
    if (schema.minLength !== undefined && length < schema.minLength) {
      errors.push(`${instancePath}：长度不能小于 ${schema.minLength}`);
    }
    if (schema.maxLength !== undefined && length > schema.maxLength) {
      errors.push(`${instancePath}：长度不能大于 ${schema.maxLength}`);
    }
    if (schema.pattern && !(new RegExp(schema.pattern, "u").test(value))) {
      errors.push(`${instancePath}：不匹配模式 ${schema.pattern}`);
    }
  }

  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) {
      errors.push(`${instancePath}：不能小于 ${schema.minimum}`);
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      errors.push(`${instancePath}：不能大于 ${schema.maximum}`);
    }
    if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) {
      errors.push(`${instancePath}：必须大于 ${schema.exclusiveMinimum}`);
    }
    if (schema.exclusiveMaximum !== undefined && value >= schema.exclusiveMaximum) {
      errors.push(`${instancePath}：必须小于 ${schema.exclusiveMaximum}`);
    }
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push(`${instancePath}：至少需要 ${schema.minItems} 项`);
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      errors.push(`${instancePath}：最多允许 ${schema.maxItems} 项`);
    }
    if (schema.uniqueItems) {
      const uniqueValues = new Set(value.map(canonical));
      if (uniqueValues.size !== value.length) errors.push(`${instancePath}：数组项必须唯一`);
    }
    if (schema.items) {
      value.forEach((item, index) => {
        validateValue(item, schema.items, schemaPath, `${instancePath}[${index}]`, errors);
      });
    }
    if (schema.contains) {
      const matches = value.filter((item) => {
        const branchErrors = [];
        validateValue(item, schema.contains, schemaPath, instancePath, branchErrors);
        return branchErrors.length === 0;
      }).length;
      const minimum = schema.minContains ?? 1;
      if (matches < minimum) errors.push(`${instancePath}：contains 至少应匹配 ${minimum} 项`);
      if (schema.maxContains !== undefined && matches > schema.maxContains) {
        errors.push(`${instancePath}：contains 最多应匹配 ${schema.maxContains} 项`);
      }
    }
  }

  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    for (const requiredKey of schema.required ?? []) {
      if (!Object.hasOwn(value, requiredKey)) errors.push(`${instancePath}：缺少必填字段 ${requiredKey}`);
    }
    for (const [key, dependencies] of Object.entries(schema.dependentRequired ?? {})) {
      if (Object.hasOwn(value, key)) {
        for (const dependency of dependencies) {
          if (!Object.hasOwn(value, dependency)) {
            errors.push(`${instancePath}：字段 ${key} 依赖 ${dependency}`);
          }
        }
      }
    }
    const properties = schema.properties ?? {};
    for (const [key, subschema] of Object.entries(properties)) {
      if (Object.hasOwn(value, key)) {
        validateValue(value[key], subschema, schemaPath, `${instancePath}.${key}`, errors);
      }
    }
    for (const [key, item] of Object.entries(value)) {
      if (Object.hasOwn(properties, key)) continue;
      if (schema.additionalProperties === false) {
        errors.push(`${instancePath}：存在未声明字段 ${key}`);
      } else if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
        validateValue(item, schema.additionalProperties, schemaPath, `${instancePath}.${key}`, errors);
      }
    }
  }

  return errors.length === initialErrorCount;
}

function validateWith(value, schemaFile) {
  const schemaPath = path.join(schemaDirectory, schemaFile);
  const errors = [];
  validateValue(value, schemas.get(schemaPath), schemaPath, "$", errors);
  return errors;
}

function assertCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function assertValid(value, schemaFile, label) {
  const errors = validateWith(value, schemaFile);
  assertCondition(errors.length === 0, `${label} 未通过 ${schemaFile}\n${errors.join("\n")}`);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

async function main() {
  const taxonomy = await readJson(path.join(projectRoot, "content", "taxonomy.json"));
  const fixture = await readJson(path.join(schemaDirectory, "examples", "contract-example.json"));

  assertValid(taxonomy, "taxonomy.schema.json", "五类定义");
  assertCondition(fixture.fixture_kind === "synthetic-contract-fixture", "共享示例必须明确标记为合成数据");

  const expectedCategories = new Map([
    ["subject-form", "主体造型"],
    ["scene-narrative", "场景叙事"],
    ["graphic-communication", "平面传播"],
    ["information-diagram", "信息图解"],
    ["interface-document", "界面文档"]
  ]);
  const actualIds = taxonomy.categories.map((category) => category.category_id);
  assertCondition(new Set(actualIds).size === 5, "一级分类 ID 必须唯一");
  for (const [categoryId, name] of expectedCategories) {
    const category = taxonomy.categories.find((item) => item.category_id === categoryId);
    assertCondition(category?.name === name, `缺少分类或名称错误：${categoryId}`);
  }
  const expectedOrder = [
    "interface-document",
    "information-diagram",
    "graphic-communication",
    "scene-narrative",
    "subject-form"
  ];
  assertCondition(canonical(taxonomy.conflict_resolution) === canonical(expectedOrder), "五类冲突判定顺序错误");
  for (const categoryId of expectedOrder) {
    const category = taxonomy.categories.find((item) => item.category_id === categoryId);
    assertCondition(category.decision_order === expectedOrder.indexOf(categoryId) + 1, `decision_order 错误：${categoryId}`);
  }
  console.log("✓ 五类齐全，通俗定义与冲突顺序通过");

  const exampleSchemas = {
    case: "case.schema.json",
    classification: "classification.schema.json",
    fingerprint: "fingerprint.schema.json",
    guide: "guide.schema.json",
    asset: "asset.schema.json",
    promptVersion: "prompt-version.schema.json",
    experimentVersion: "experiment-version.schema.json",
    run: "run.schema.json",
    scoreRevision: "score-revision.schema.json",
    decision: "decision.schema.json",
    conclusionVersion: "conclusion-version.schema.json"
  };
  for (const [key, schemaFile] of Object.entries(exampleSchemas)) {
    assertValid(fixture[key], schemaFile, `共享示例 ${key}`);
  }
  console.log(`✓ ${Object.keys(exampleSchemas).length} 个共享实体示例通过`);

  assertCondition(fixture.case.cover_asset_id === fixture.asset.asset_id, "Case 封面引用不一致");
  assertCondition(fixture.classification.case_id === fixture.case.case_id, "Classification 案例引用不一致");
  assertCondition(fixture.fingerprint.case_id === fixture.case.case_id, "Fingerprint 案例引用不一致");
  assertCondition(fixture.guide.case_id === fixture.case.case_id, "Guide 案例引用不一致");
  assertCondition(fixture.promptVersion.case_id === fixture.case.case_id, "PromptVersion 案例引用不一致");
  assertCondition(fixture.run.case_id === fixture.case.case_id, "Run 案例引用不一致");
  assertCondition(fixture.run.prompt_version_id === fixture.promptVersion.prompt_version_id, "Run 提示词版本引用不一致");
  assertCondition(fixture.run.experiment_version_id === fixture.experimentVersion.experiment_version_id, "Run 实验版本引用不一致");
  assertCondition(fixture.experimentVersion.arms.some((arm) => arm.arm_id === fixture.run.arm_id && arm.prompt_version_ids.includes(fixture.run.prompt_version_id)), "Run 未落入声明的实验臂");
  assertCondition(fixture.run.result_asset_ids.includes(fixture.asset.asset_id), "Run 结果图引用不一致");
  assertCondition(fixture.scoreRevision.run_id === fixture.run.run_id, "ScoreRevision Run 引用不一致");
  assertCondition(fixture.scoreRevision.evidence_asset_ids.every((id) => fixture.run.result_asset_ids.includes(id)), "评分证据图必须属于对应 Run");
  assertCondition(fixture.decision.case_id === fixture.case.case_id, "Decision 案例引用不一致");
  assertCondition(fixture.decision.prompt_version_id === fixture.promptVersion.prompt_version_id, "Decision 提示词版本引用不一致");
  assertCondition(fixture.conclusionVersion.source_experiment_version_ids.includes(fixture.run.experiment_version_id), "ConclusionVersion 未引用 Run 所属实验版本");
  assertCondition(fixture.conclusionVersion.evidence_run_ids.includes(fixture.run.run_id), "ConclusionVersion Run 引用不一致");
  console.log("✓ 跨实体 ID 与证据引用通过");

  const requiredAssertions = {
    decision: {
      schema: "decision.schema.json",
      fields: ["decision_id", "case_id", "prompt_version_id", "evidence_level", "evidence_refs"]
    },
    run: {
      schema: "run.schema.json",
      fields: ["run_id", "experiment_version_id", "case_id", "prompt_version_id", "blind_id", "result_asset_ids"]
    },
    scoreRevision: {
      schema: "score-revision.schema.json",
      fields: ["score_id", "run_id", "revision", "supersedes_id", "scored_at", "is_current", "evidence_asset_ids"]
    },
    conclusionVersion: {
      schema: "conclusion-version.schema.json",
      fields: ["conclusion_version_id", "version_no", "source_experiment_version_ids", "score_snapshot_hash", "generator_version", "evidence_run_ids"]
    }
  };
  let negativeCount = 0;
  for (const [key, assertion] of Object.entries(requiredAssertions)) {
    const schema = schemas.get(path.join(schemaDirectory, assertion.schema));
    for (const field of assertion.fields) {
      assertCondition(schema.required.includes(field), `${assertion.schema} 未将 ${field} 声明为必填`);
      const invalid = clone(fixture[key]);
      delete invalid[field];
      assertCondition(validateWith(invalid, assertion.schema).length > 0, `${assertion.schema} 不应接受缺失 ${field}`);
      negativeCount += 1;
    }
  }
  console.log(`✓ Decision/Run/Score/Conclusion 的 ${negativeCount} 项证据与版本必填反向校验通过`);

  const testedWithoutRun = clone(fixture.decision);
  testedWithoutRun.evidence_level = "tested";
  testedWithoutRun.observed_effect = "合成观察，不代表真实实验";
  assertCondition(validateWith(testedWithoutRun, "decision.schema.json").length > 0, "tested Decision 缺少 Run 证据时必须失败");

  const inferredWithObservation = clone(fixture.decision);
  inferredWithObservation.observed_effect = "推断不得携带实测效果";
  assertCondition(validateWith(inferredWithObservation, "decision.schema.json").length > 0, "inferred Decision 携带 observed_effect 时必须失败");

  const inferredWithoutPrompt = clone(fixture.decision);
  inferredWithoutPrompt.evidence_refs = [{ entity_type: "case", entity_id: "case-000" }];
  assertCondition(validateWith(inferredWithoutPrompt, "decision.schema.json").length > 0, "inferred Decision 缺少提示词版本证据时必须失败");
  console.log("✓ tested/observed/inferred 证据语义反向校验通过");
  console.log("契约校验通过：分类、示例、版本字段和证据字段均有效");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
