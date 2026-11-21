import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateFingerprints, fingerprintVersion, goldFingerprintVersion, intentDefinitions, intentVersion, keyFields, layoutValues, readJson, relationValues, slotIdValues, slotRoles } from "./fingerprint-cases.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fingerprintFields = ["case_id", "subject_count", "layout", "relations", "text_slots", "input_mode", "ratio", "confidence", "evidence_excerpt", "fingerprint_version"];
const intentFields = ["case_id", "intents", "confidence", "evidence_excerpt", "intent_version"];
const synonymFields = ["intent_id", "label", "synonyms", "related_intent_ids"];
const inputModes = new Set(["text_only", "text_and_image"]);
const ratioPattern = /^(?:\d+(?:\.\d+)?:\d+(?:\.\d+)?|original|custom)$/;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function validateExactFields(record, fields, label, errors) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    errors.push(`${label}：必须是对象`);
    return;
  }
  if (Object.keys(record).length !== fields.length || fields.some((field) => !Object.hasOwn(record, field))) errors.push(`${label}：必须且只能包含 ${fields.join("、")}`);
}

function validateFingerprint(record, expectedVersion, label, errors) {
  validateExactFields(record, fingerprintFields, label, errors);
  if (!record || typeof record !== "object" || Array.isArray(record)) return;
  if (typeof record.case_id !== "string" || !record.case_id) errors.push(`${label}：case_id 必须非空`);
  if (!Number.isInteger(record.subject_count) || record.subject_count < 0) errors.push(`${label}：subject_count 必须是非负整数`);
  if (!layoutValues.includes(record.layout)) errors.push(`${label}：layout 不在枚举内（${record.layout}）`);
  if (!inputModes.has(record.input_mode)) errors.push(`${label}：input_mode 无效`);
  if (typeof record.ratio !== "string" || !ratioPattern.test(record.ratio)) errors.push(`${label}：ratio 无效`);
  if (typeof record.confidence !== "number" || !Number.isFinite(record.confidence) || record.confidence < 0 || record.confidence > 1) errors.push(`${label}：confidence 必须在 0 到 1 之间`);
  if (typeof record.evidence_excerpt !== "string" || !record.evidence_excerpt.trim()) errors.push(`${label}：evidence_excerpt 必须非空`);
  if (Array.from(record.evidence_excerpt ?? "").length > 260) errors.push(`${label}：evidence_excerpt 必须是不超过 260 字的短句`);
  if (record.fingerprint_version !== expectedVersion) errors.push(`${label}：fingerprint_version 应为 ${expectedVersion}`);
  if (!Array.isArray(record.relations)) errors.push(`${label}：relations 必须是数组`);
  else {
    const relations = new Set();
    for (const [index, relation] of record.relations.entries()) {
      validateExactFields(relation, ["source_slot", "relation", "target_slot"], `${label}.relations[${index}]`, errors);
      for (const field of ["source_slot", "relation", "target_slot"]) if (typeof relation?.[field] !== "string" || !relation[field].trim()) errors.push(`${label}.relations[${index}]：${field} 必须非空`);
      if (!relationValues.includes(relation?.relation)) errors.push(`${label}.relations[${index}]：relation 不在枚举内（${relation?.relation}）`);
      const key = JSON.stringify([relation?.source_slot, relation?.relation, relation?.target_slot]);
      if (relations.has(key)) errors.push(`${label}：relations 存在重复项`);
      relations.add(key);
    }
  }
  if (!Array.isArray(record.text_slots)) errors.push(`${label}：text_slots 必须是数组`);
  else {
    const slotIds = new Set();
    for (const [index, slot] of record.text_slots.entries()) {
      validateExactFields(slot, slot && Object.hasOwn(slot, "content") ? ["slot_id", "role", "required", "content"] : ["slot_id", "role", "required"], `${label}.text_slots[${index}]`, errors);
      if (!slotIdValues.includes(slot?.slot_id)) errors.push(`${label}.text_slots[${index}]：slot_id 不在枚举内（${slot?.slot_id}）`);
      if (slot?.role !== slotRoles[slot?.slot_id]) errors.push(`${label}.text_slots[${index}]：role 与 slot_id 枚举不匹配`);
      if (typeof slot?.required !== "boolean") errors.push(`${label}.text_slots[${index}]：required 必须是布尔值`);
      if (Object.hasOwn(slot ?? {}, "content") && (typeof slot.content !== "string" || !slot.content.trim())) errors.push(`${label}.text_slots[${index}]：content 存在时必须非空`);
      if (slotIds.has(slot?.slot_id)) errors.push(`${label}：重复 text slot ${slot?.slot_id}`);
      slotIds.add(slot?.slot_id);
    }
  }
}

function indexUnique(records, expectedIds, label, errors) {
  const byId = new Map();
  for (const record of records) {
    if (byId.has(record.case_id)) errors.push(`${label}：重复 case_id ${record.case_id}`);
    byId.set(record.case_id, record);
  }
  for (const id of expectedIds) if (!byId.has(id)) errors.push(`${label}：缺少 ${id}`);
  for (const id of byId.keys()) if (!expectedIds.has(id)) errors.push(`${label}：存在集合外 case_id ${id}`);
  return byId;
}

function validateIntent(record, knownIntentIds, label, errors) {
  validateExactFields(record, intentFields, label, errors);
  if (!Array.isArray(record.intents) || record.intents.length === 0) errors.push(`${label}：intents 必须是非空数组`);
  else {
    if (new Set(record.intents).size !== record.intents.length) errors.push(`${label}：intents 不得重复`);
    for (const id of record.intents) if (!knownIntentIds.has(id)) errors.push(`${label}：未知意图 ${id}`);
  }
  if (typeof record.confidence !== "number" || record.confidence < 0 || record.confidence > 1) errors.push(`${label}：confidence 必须在 0 到 1 之间`);
  if (typeof record.evidence_excerpt !== "string" || !record.evidence_excerpt.trim()) errors.push(`${label}：evidence_excerpt 必须非空`);
  if (record.intent_version !== intentVersion) errors.push(`${label}：intent_version 应为 ${intentVersion}`);
}

async function main() {
  const [cases, goldCaseIds, fingerprints, intents, synonyms, goldFingerprints, agreement] = await Promise.all([
    readJson(path.join(projectRoot, "content", "cases.json")),
    readJson(path.join(projectRoot, "content", "gold-case-ids.json")),
    readJson(path.join(projectRoot, "content", "fingerprints.json")),
    readJson(path.join(projectRoot, "content", "intents.json")),
    readJson(path.join(projectRoot, "content", "synonyms.json")),
    readJson(path.join(projectRoot, "content", "gold-fingerprints.json")),
    readJson(path.join(projectRoot, "reports", "fingerprint-agreement.json"))
  ]);
  const errors = [];
  if (!Array.isArray(cases) || cases.length !== 541) errors.push(`案例必须为 541 条，实际为 ${cases?.length}`);
  for (const [value, label] of [[fingerprints, "fingerprints.json"], [intents, "intents.json"], [synonyms, "synonyms.json"], [goldFingerprints, "gold-fingerprints.json"]]) if (!Array.isArray(value)) errors.push(`${label} 顶层必须是数组`);
  if (errors.length > 0) throw new Error(errors.join("\n"));
  const caseIds = new Set(cases.map((item) => item.case_id));
  const goldIds = new Set(goldCaseIds);
  if (goldCaseIds.length !== 60 || goldIds.size !== 60) errors.push("金标 ID 必须为 60 个唯一值");
  if (goldFingerprints.length !== 60) errors.push(`金标指纹必须为 60 条，实际为 ${goldFingerprints.length}`);
  const productionById = indexUnique(fingerprints, caseIds, "生产指纹", errors);
  indexUnique(intents, caseIds, "生产意图", errors);
  indexUnique(goldFingerprints, goldIds, "金标指纹", errors);
  fingerprints.forEach((record, index) => validateFingerprint(record, fingerprintVersion, `生产指纹[${index}]`, errors));
  goldFingerprints.forEach((record, index) => validateFingerprint(record, goldFingerprintVersion, `金标指纹[${index}]`, errors));

  const knownIntentIds = new Set();
  synonyms.forEach((record, index) => {
    validateExactFields(record, synonymFields, `同义词[${index}]`, errors);
    if (knownIntentIds.has(record.intent_id)) errors.push(`同义词：重复 intent_id ${record.intent_id}`);
    knownIntentIds.add(record.intent_id);
    if (typeof record.label !== "string" || !record.label.trim()) errors.push(`同义词[${index}]：label 必须非空`);
    if (!Array.isArray(record.synonyms) || record.synonyms.length === 0 || record.synonyms.some((term) => typeof term !== "string" || !term.trim())) errors.push(`同义词[${index}]：synonyms 必须是非空字符串数组`);
    if (!Array.isArray(record.related_intent_ids) || record.related_intent_ids.some((id) => !intentDefinitions.some((intent) => intent.intent_id === id))) errors.push(`同义词[${index}]：related_intent_ids 含未知意图`);
  });
  for (const intent of intentDefinitions) if (!knownIntentIds.has(intent.intent_id)) errors.push(`同义词缺少 ${intent.intent_id}`);
  intents.forEach((record, index) => validateIntent(record, knownIntentIds, `生产意图[${index}]`, errors));
  const allTerms = new Set(synonyms.flatMap((record) => [record.label, ...record.synonyms]));
  for (const term of ["结构板", "尺寸标注", "材料说明", "技术视图", "多视图"]) if (!allTerms.has(term)) errors.push(`同义词必须包含“${term}”`);
  const structure = synonyms.find((record) => record.intent_id === "structure_sheet");
  for (const id of ["multi_view", "technical_view", "dimension_annotation", "material_notes"]) if (!structure?.related_intent_ids.includes(id)) errors.push(`结构板必须关联 ${id}`);

  const metrics = evaluateFingerprints(fingerprints, goldFingerprints, goldCaseIds);
  for (const field of keyFields) if (metrics.key_fields[field].rate < 0.9) errors.push(`${field} 金标自评通过率不足 90%：${metrics.key_fields[field].passed}/60`);
  if (metrics.relations.f1 < 0.85) errors.push(`relations 金标自评 F1 不足 0.85：${metrics.relations.f1}`);
  if (agreement.task_id !== "T05" || agreement.status !== "pending_external_review") errors.push("一致性报告必须是 T05 待外部复核状态");
  if (JSON.stringify(agreement.self_assessment) !== JSON.stringify(metrics)) errors.push("报告 self_assessment 与实时重算结果不一致");
  if (agreement.coverage?.case_count !== 541 || agreement.coverage?.fingerprint_count !== 541 || agreement.coverage?.intent_count !== 541 || agreement.coverage?.gold_fingerprint_count !== 60) errors.push("报告覆盖数字无效");
  for (const field of ["annotator_a_id", "annotator_b_id", "arbitrator_id"]) if (agreement[field] !== null) errors.push(`外部一致性字段 ${field} 必须为 null`);
  for (const field of ["independent_annotations", "arbitrated_annotations"]) if (!Array.isArray(agreement[field]) || agreement[field].length !== 0) errors.push(`外部一致性字段 ${field} 必须为空数组`);
  for (const field of [...keyFields, "relations_f1"]) if (agreement.key_field_agreement?.[field] !== null) errors.push(`外部一致率 ${field} 必须为 null`);

  assert(errors.length === 0, `指纹校验失败\n${errors.join("\n")}`);
  console.log(`✓ 覆盖与唯一性：指纹 ${productionById.size}/${caseIds.size}，意图 ${intents.length}/${caseIds.size}，金标 ${goldFingerprints.length}/60`);
  for (const field of keyFields) console.log(`✓ ${field} 自评：${metrics.key_fields[field].passed}/60，${(metrics.key_fields[field].rate * 100).toFixed(2)}%`);
  console.log(`✓ relations 自评：TP=${metrics.relations.true_positive}，FP=${metrics.relations.false_positive}，FN=${metrics.relations.false_negative}，F1=${metrics.relations.f1}`);
  console.log(`✓ 意图与同义词：${knownIntentIds.size} 个意图，结构板/尺寸标注/材料说明/技术视图/多视图齐全`);
  console.log("✓ 双人独立标注、仲裁与外部一致率：空模板，未伪造");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
