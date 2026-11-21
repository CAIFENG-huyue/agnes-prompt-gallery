import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const defaultExperimentsRoot = "/workspace/agent/agnes/experiments";
const H1_CASE_NUMBERS = [23, 153, 226, 270, 353, 371, 379, 387, 389, 475];
const H2_OVERLAY_REPS = [2, 3, 4, 5, 6];
const SCHEMA_FILES = [
  "common.schema.json",
  "prompt-version.schema.json",
  "experiment-version.schema.json",
  "run.schema.json",
  "score-revision.schema.json",
  "conclusion-version.schema.json"
];

export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

export async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function parseCsv(text) {
  const rows = [];
  let field = "";
  let row = [];
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((cell) => cell !== "")) rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  const [header, ...body] = rows;
  return body.map((cells) => Object.fromEntries(header.map((name, i) => [name, cells[i] ?? ""])));
}

export function createSchemaValidator(schemas) {
  const resolve = (reference, currentPath) => {
    const hashIndex = reference.indexOf("#");
    const filePart = hashIndex === -1 ? reference : reference.slice(0, hashIndex);
    const fragment = hashIndex === -1 ? "" : reference.slice(hashIndex + 1);
    const targetPath = filePart ? path.resolve(path.dirname(currentPath), filePart) : currentPath;
    let target = schemas.get(targetPath);
    if (!target) throw new Error(`未加载的 Schema 引用：${reference}`);
    if (fragment) {
      for (const token of fragment.slice(1).split("/")) {
        target = target?.[token.replaceAll("~1", "/").replaceAll("~0", "~")];
      }
    }
    if (target === undefined) throw new Error(`无法解析 Schema 引用：${reference}`);
    return { schema: target, schemaPath: targetPath };
  };
  const matchesType = (value, type) => {
    if (type === "null") return value === null;
    if (type === "array") return Array.isArray(value);
    if (type === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
    if (type === "integer") return Number.isInteger(value);
    if (type === "number") return typeof value === "number" && Number.isFinite(value);
    return typeof value === type;
  };
  const visit = (value, schema, schemaPath, instancePath, errors) => {
    if (!schema || typeof schema !== "object") return;
    if (schema.$ref) {
      const resolved = resolve(schema.$ref, schemaPath);
      visit(value, resolved.schema, resolved.schemaPath, instancePath, errors);
      return;
    }
    if (schema.anyOf) {
      const branches = schema.anyOf.map((branch) => {
        const branchErrors = [];
        visit(value, branch, schemaPath, instancePath, branchErrors);
        return branchErrors;
      });
      if (!branches.some((branchErrors) => branchErrors.length === 0)) {
        errors.push(`${instancePath}: 不满足 anyOf 任一分支`);
      }
      return;
    }
    if (schema.type && !matchesType(value, schema.type)) {
      errors.push(`${instancePath}: 类型应为 ${schema.type}`);
      return;
    }
    if (schema.enum && !schema.enum.includes(value)) errors.push(`${instancePath}: 不在枚举内`);
    if (typeof value === "string") {
      if (schema.minLength && value.length < schema.minLength) errors.push(`${instancePath}: 字符串过短`);
      if (schema.maxLength && value.length > schema.maxLength) errors.push(`${instancePath}: 字符串过长`);
      if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push(`${instancePath}: 不匹配 ${schema.pattern}`);
    }
    if (typeof value === "number") {
      if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${instancePath}: 小于 minimum`);
      if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${instancePath}: 大于 maximum`);
    }
    if (Array.isArray(value)) {
      if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${instancePath}: 元素不足`);
      if (schema.uniqueItems) {
        const seen = new Set(value.map(canonical));
        if (seen.size !== value.length) errors.push(`${instancePath}: 元素不唯一`);
      }
      if (schema.items) value.forEach((item, index) => visit(item, schema.items, schemaPath, `${instancePath}[${index}]`, errors));
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      for (const key of schema.required ?? []) {
        if (!(key in value)) errors.push(`${instancePath}: 缺少必填字段 ${key}`);
      }
      for (const [key, item] of Object.entries(value)) {
        if (schema.properties && key in schema.properties) {
          visit(item, schema.properties[key], schemaPath, `${instancePath}.${key}`, errors);
        } else if (schema.additionalProperties === false) {
          errors.push(`${instancePath}: 存在额外字段 ${key}`);
        }
      }
      for (const [key, deps] of Object.entries(schema.dependentRequired ?? {})) {
        if (key in value) {
          for (const dep of deps) if (!(dep in value)) errors.push(`${instancePath}: ${key} 依赖 ${dep}`);
        }
      }
    }
  };
  return (value, schemaFile, label) => {
    const schemaPath = path.join(projectRoot, "schemas", schemaFile);
    const schema = schemas.get(schemaPath);
    if (!schema) throw new Error(`未加载 Schema：${schemaFile}`);
    const errors = [];
    visit(value, schema, schemaPath, label, errors);
    return errors;
  };
}

export async function loadSchemas() {
  const schemas = new Map();
  for (const fileName of SCHEMA_FILES) {
    schemas.set(path.join(projectRoot, "schemas", fileName), await readJson(path.join(projectRoot, "schemas", fileName)));
  }
  return schemas;
}

function renderProse(spec) {
  const parts = [
    `${spec.ref_contract}。`,
    "构图、姿态、光线、背景和全部文字一律由下述提示词决定。",
    `画幅：${spec.ratio}。`,
    `画面：${spec.canvas}。`,
    `主体：${spec.subject}。`,
    `必须出现：${spec.elements.join("；")}；一处不缺。`
  ];
  if (spec.texts.length) {
    parts.push(`文字逐字如下：${spec.texts.map((t) => `${t.where} 写“${t.text}”（${t.style}）`).join("；")}；错字、漏字、乱码即不合格。`);
  } else {
    parts.push("画面内不出现任何文字、字母或数字；所有标签位置留白。");
  }
  for (const c of spec.counts) {
    let line = `数量：${c.item} 严格 ${c.rows} 行×${c.cols} 列，共 ${c.rows * c.cols} 件`;
    if (c.labels.length) line += `；标签按序为 ${c.labels.join("、")}`;
    parts.push(`${line}；不得增删、错位或串行。`);
  }
  parts.push(`版式：${spec.layout}。`);
  parts.push(`风格：${spec.style.join("、")}。`);
  parts.push(`限制：${spec.negatives.join("；")}。`);
  return parts.join("");
}

function renderStructured(spec) {
  const lines = ["[REFERENCE]"];
  (spec.refs ?? []).forEach((_, index) => lines.push(`参考图 ${index + 1}: 见随附图片`));
  lines.push(spec.ref_contract, "", "[CANVAS]", `ratio: ${spec.ratio}`, spec.canvas, "", "[SUBJECT]", spec.subject, "", "[ELEMENTS]");
  spec.elements.forEach((e, index) => lines.push(`${index + 1}. ${e}`));
  lines.push("", "[TEXT — EXACT]");
  for (const t of spec.texts) lines.push(`- "${t.text}" @ ${t.where} | ${t.style}`);
  lines.push("", "[LAYOUT]");
  for (const c of spec.counts) {
    let line = `${c.item}: rows=${c.rows}, cols=${c.cols}, total=${c.rows * c.cols}`;
    if (c.labels.length) line += `; labels: ${c.labels.join(", ")}`;
    lines.push(line);
  }
  lines.push(spec.layout, "", "[STYLE]");
  for (const st of spec.style) lines.push(`- ${st}`);
  lines.push("", "[NEGATIVE]");
  for (const n of spec.negatives) lines.push(`- ${n}`);
  return lines.join("\n");
}

function toSpecContract(spec) {
  return {
    ratio: spec.ratio,
    refs: spec.refs ?? [],
    ref_contract: spec.ref_contract,
    canvas: spec.canvas,
    subject: spec.subject,
    elements: spec.elements,
    texts: spec.texts.map((t) => ({ text: t.text, where: t.where, style: t.style })),
    counts: spec.counts.map((c) => ({ item: c.item, rows: c.rows, cols: c.cols, labels: c.labels })),
    layout: spec.layout,
    style: spec.style.join("、"),
    negatives: spec.negatives
  };
}

function parseNumber(text) {
  const match = String(text).match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/i);
  if (!match) throw new Error(`无法解析数字：${text}`);
  return Number(match[0]);
}

function parseHitsTotal(text) {
  const match = text.match(/(\d+)\s*\/\s*(\d+)/);
  if (!match) throw new Error(`无法解析 hits/total：${text}`);
  return { hits: Number(match[1]), total: Number(match[2]) };
}

function parseInterval(text) {
  const match = text.match(/\[\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\]/);
  if (!match) throw new Error(`无法解析区间：${text}`);
  return [parseNumber(match[1]), parseNumber(match[2])];
}

function sectionLines(markdown, heading) {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start === -1) throw new Error(`results 文档缺少小节：${heading}`);
  const out = [];
  for (let i = start + 1; i < lines.length && !lines[i].startsWith("## "); i++) out.push(lines[i]);
  return out;
}

function tableRows(lines) {
  return lines.filter((line) => line.startsWith("|") && !/^\|[\s-|]+\|$/.test(line)).map((line) => line.split("|").slice(1, -1).map((cell) => cell.trim()));
}

export function parseH1Report(markdown) {
  const primary = tableRows(sectionLines(markdown, "## Primary: text fulfillment (case-level)"));
  const arms = {};
  for (const cells of primary) {
    if (cells[0] === "prose" || cells[0] === "structured") {
      const { hits, total } = parseHitsTotal(cells[2]);
      arms[cells[0]] = { n_images: parseNumber(cells[1]), text_hits: hits, text_total: total, rate: parseNumber(cells[3]), wilson95: parseInterval(cells[4]) };
    }
  }
  const metric = Object.fromEntries(primary.filter((cells) => cells.length === 2).map((cells) => [cells[0], cells[1]]));
  const gateLines = sectionLines(markdown, "## Key secondary: hard-gate pass (underpowered; hierarchical)");
  const gate = tableRows(gateLines);
  const gateArms = {};
  for (const cells of gate) {
    if (cells[0] === "prose" || cells[0] === "structured") {
      gateArms[cells[0]] = { n_images: parseNumber(cells[1]), passes: parseNumber(cells[2]), pass_rate: parseNumber(cells[3]), wilson95: parseInterval(cells[4]) };
    }
  }
  const gateMetric = Object.fromEntries(gate.filter((cells) => cells.length === 2).map((cells) => [cells[0], cells[1]]));
  const mcnemar = gateMetric["McNemar p (b=0, c=1)"] ?? gateMetric[Object.keys(gateMetric).find((key) => key.startsWith("McNemar p"))];
  const mcnemarKey = Object.keys(gateMetric).find((key) => key.startsWith("McNemar p"));
  const mcnemarMatch = mcnemarKey.match(/b=(\d+), c=(\d+)/);
  const exploratory = {};
  for (const cells of tableRows(sectionLines(markdown, "## Exploratory secondary outcomes (Holm)"))) {
    if (cells[0] === "outcome") continue;
    exploratory[cells[0]] = { effect_pp: parseNumber(cells[1]), p: parseNumber(cells[2]), p_holm: parseNumber(cells[3]) };
  }
  const perCase = [];
  for (const cells of tableRows(sectionLines(markdown, "## Per-case text fulfillment (after recheck corrections)"))) {
    if (cells[0] === "case") continue;
    const prose = parseHitsTotal(cells[1]);
    const structured = parseHitsTotal(cells[2]);
    perCase.push({
      case_id: `case-${cells[0]}`,
      prose: { ...prose, rate: parseNumber(cells[1].split("=")[1]) },
      structured: { ...structured, rate: parseNumber(cells[2].split("=")[1]) },
      diff_pp: parseNumber(cells[3])
    });
  }
  const decisionLine = markdown.split(/\r?\n/).find((line) => line.startsWith("**Decision:**"));
  return {
    arms,
    n_cases: parseNumber(metric["cases (paired)"]),
    effect_pp: parseNumber(metric["text fulfillment effect (structured - prose)"]),
    bootstrap95_pp: parseInterval(metric["bootstrap 95% CI"]),
    permutation_p: parseNumber(metric["permutation p (exact sign-flip)"]),
    gee_text: metric["GEE text_hits/text_total"],
    hard_gate: {
      arms: gateArms,
      effect_pp: parseNumber(gateMetric["hard-gate pass effect"]),
      bootstrap95_pp: parseInterval(gateMetric["bootstrap 95% CI"]),
      permutation_p: parseNumber(gateMetric["permutation p"]),
      mcnemar: { b: Number(mcnemarMatch[1]), c: Number(mcnemarMatch[2]), p: parseNumber(mcnemar) },
      power_at_15pp_n10: parseNumber(gateMetric["power at 15pp, n=10"]),
      gee_pass: gateMetric["GEE pass ~ variant"]
    },
    exploratory,
    per_case: perCase,
    decision: decisionLine.replace("**Decision:**", "").trim()
  };
}

export function parseH2Report(markdown) {
  const rows = tableRows(sectionLines(markdown, "## Manipulation check"));
  const arms = {};
  for (const cells of rows) {
    if (cells[0] === "arm") continue;
    const key = cells[0].startsWith("A") ? "in-image" : "overlay";
    const { hits, total } = parseHitsTotal(cells[1]);
    arms[key] = {
      exact_slots_hits: hits,
      exact_slots_total: total,
      exact_slots_rate_text: cells[1],
      per_image_exact: cells[2].split("/").map(Number),
      portraits: cells[3].split("/").map(Number),
      grid: cells[4].split("/").map(Number)
    };
  }
  const band = markdown.match(/Blank band was usable in \*\*(\d+)\/(\d+)\*\*/);
  const collision = markdown.match(/No text-on-portrait collision in \*\*(\d+)\/(\d+)\*\*/);
  const caveats = sectionLines(markdown, "## Caveats").filter((line) => line.startsWith("- ")).map((line) => line.slice(2).trim());
  return {
    arms,
    band_usable: [Number(band[1]), Number(band[2])],
    no_collision: [Number(collision[1]), Number(collision[2])],
    guide_line_defect: "r6",
    caveats
  };
}

export async function buildMigration(experimentsRoot) {
  const mapping = (await readFile(path.join(experimentsRoot, "mapping-h1.jsonl"), "utf8"))
    .split(/\r?\n/).filter((line) => line.trim()).map((line) => JSON.parse(line));
  const scores = parseCsv(await readFile(path.join(experimentsRoot, "scores-h1.csv"), "utf8"));
  const h1Report = parseH1Report(await readFile(path.join(experimentsRoot, "results-h1.md"), "utf8"));
  const h2Report = parseH2Report(await readFile(path.join(experimentsRoot, "results-h2.md"), "utf8"));
  const specs = new Map();
  for (const caseNumber of H1_CASE_NUMBERS) {
    specs.set(caseNumber, await readJson(path.join(experimentsRoot, "specs", "h1", `case-${caseNumber}.json`)));
  }
  const h2Spec = await readJson(path.join(experimentsRoot, "specs", "h2", "case-226.json"));
  const quarantine = [];
  const addQuarantine = (sourcePath, reason, caseId = null) => {
    quarantine.push({
      record_id: `quarantine-${String(quarantine.length + 1).padStart(3, "0")}`,
      source_path: sourcePath,
      case_id: caseId,
      reason,
      disposition: "archive-only"
    });
  };
  const mappingByBlind = new Map();
  for (const record of mapping) {
    if (mappingByBlind.has(record.blind_id)) throw new Error(`mapping 重复 blind_id：${record.blind_id}`);
    mappingByBlind.set(record.blind_id, record);
  }
  const scoreByBlind = new Map();
  for (const record of scores) {
    if (scoreByBlind.has(record.blind_id)) throw new Error(`scores 重复 blind_id：${record.blind_id}`);
    scoreByBlind.set(record.blind_id, record);
  }
  const seenTriples = new Set();
  for (const record of mapping) {
    const triple = `${record.case_id}|${record.variant}|${record.rep}`;
    if (seenTriples.has(triple)) throw new Error(`mapping 重复运行：${triple}`);
    seenTriples.add(triple);
    if (!specs.has(record.case_id)) {
      addQuarantine(`E/mapping-h1.jsonl#${record.blind_id}`, "mapping 中的 case_id 不在 specs/h1 冻结集合内，无法回连提示词版本", null);
    }
    if (!["prose", "structured"].includes(record.variant)) throw new Error(`未知 variant：${record.variant}`);
  }
  const promptVersions = [];
  const promptVersionIds = new Set();
  const makePromptVersion = (caseNumber, versionNo, parentVersionId, text, changeNote, spec) => {
    const promptVersionId = `case-${caseNumber}/pv-${String(versionNo).padStart(3, "0")}`;
    promptVersionIds.add(promptVersionId);
    promptVersions.push({
      prompt_version_id: promptVersionId,
      case_id: `case-${caseNumber}`,
      version_no: versionNo,
      parent_version_id: parentVersionId,
      text,
      content_sha256: sha256(text),
      change_note: changeNote,
      spec: toSpecContract(spec)
    });
    return promptVersionId;
  };
  for (const caseNumber of H1_CASE_NUMBERS) {
    const spec = specs.get(caseNumber);
    makePromptVersion(caseNumber, 2, `case-${caseNumber}/pv-001`, renderProse(spec), "H1 prose 臂：specs/h1 冻结 spec 经 render_prose 渲染的契约段落；pv-001 为 T03 导入的原始案例提示词", spec);
    makePromptVersion(caseNumber, 3, `case-${caseNumber}/pv-002`, renderStructured(spec), "H1 structured 臂：同一 spec 经 render_structured 渲染，内容一致仅组织形式不同", spec);
  }
  makePromptVersion(226, 4, "case-226/pv-002", renderProse(h2Spec), "H2-226 叠字臂：specs/h2/case-226.json，texts=[] 且每格保留两行等高空白题注区，供 PIL 后叠字", h2Spec);

  const runs = [];
  const runByBlind = new Map();
  const h1Runs = mapping.filter((record) => specs.has(record.case_id));
  h1Runs.sort((a, b) => a.case_id - b.case_id || a.variant.localeCompare(b.variant) || a.rep - b.rep);
  for (const record of h1Runs) {
    const imagePath = path.join(experimentsRoot, "images", "h1", `${record.blind_id}.png`);
    if (!existsSync(imagePath)) throw new Error(`mapping 有记录但结果图缺失：${record.blind_id}`);
    const score = scoreByBlind.get(record.blind_id);
    if (!score) addQuarantine(`E/mapping-h1.jsonl#${record.blind_id}`, "mapping 有记录但 scores-h1.csv 无评分，Run 保留但不进入任何汇总数字", `case-${record.case_id}`);
    const run = {
      run_id: `run-h1-${record.case_id}-${record.variant}-${record.rep}`,
      experiment_version_id: "h1/ev-001",
      arm_id: record.variant,
      case_id: `case-${record.case_id}`,
      prompt_version_id: `case-${record.case_id}/pv-${record.variant === "prose" ? "002" : "003"}`,
      rep: record.rep,
      blind_id: record.blind_id,
      result_asset_ids: [record.blind_id]
    };
    runs.push(run);
    runByBlind.set(record.blind_id, run);
  }
  for (const score of scores) {
    if (!mappingByBlind.has(score.blind_id)) {
      addQuarantine(`E/scores-h1.csv#${score.blind_id}`, "评分记录不在 mapping-h1.jsonl 中；禁止由图片或哈希反推 blind_id，故隔离且不计入数字", null);
    }
  }
  const h1ImageFiles = (await readdir(path.join(experimentsRoot, "images", "h1"))).filter((name) => name.endsWith(".png"));
  for (const name of h1ImageFiles) {
    const blindId = name.slice(0, -4);
    if (!mappingByBlind.has(blindId)) {
      addQuarantine(`E/images/h1/${name}`, "结果图不在 mapping-h1.jsonl 中；禁止由图片或哈希猜 blind_id，故隔离且不计入数字", null);
    }
  }
  const overlayRuns = [];
  for (const rep of H2_OVERLAY_REPS) {
    const overlayId = `h2-226-r${rep}-overlay`;
    const baseId = `h2-226-r${rep}`;
    for (const assetId of [overlayId, baseId]) {
      if (!existsSync(path.join(experimentsRoot, "images", "h2", `${assetId}.png`))) throw new Error(`H2-226 结果图缺失：${assetId}`);
    }
    const run = {
      run_id: `run-h2-226-overlay-${rep}`,
      experiment_version_id: "h2-226/ev-001",
      arm_id: "overlay",
      case_id: "case-226",
      prompt_version_id: "case-226/pv-004",
      rep,
      blind_id: overlayId,
      result_asset_ids: [overlayId, baseId]
    };
    runs.push(run);
    overlayRuns.push(run);
  }
  const controlRuns = h1Runs.filter((record) => record.case_id === 226 && record.variant === "prose")
    .sort((a, b) => a.rep - b.rep).map((record) => runByBlind.get(record.blind_id).run_id);
  if (controlRuns.length !== 5) throw new Error("H2-226 对照臂必须复用 H1 case-226 prose 的 5 次运行");

  const scoreRevisions = [];
  for (const run of runs) {
    if (run.experiment_version_id !== "h1/ev-001") continue;
    const score = scoreByBlind.get(run.blind_id);
    if (!score) continue;
    const numeric = (key) => {
      const value = Number(score[key]);
      if (!Number.isFinite(value)) throw new Error(`评分字段 ${key} 非数字：${run.blind_id}`);
      return value;
    };
    scoreRevisions.push({
      score_id: `score-${run.blind_id}-1`,
      run_id: run.run_id,
      revision: 1,
      supersedes_id: null,
      g1: numeric("G1"),
      g2: numeric("G2"),
      g3: numeric("G3"),
      g4: numeric("G4"),
      text_hits: numeric("text_hits"),
      text_total: numeric("text_total"),
      elements_hits: numeric("elements_hits"),
      elements_total: numeric("elements_total"),
      count_error: numeric("count_error"),
      notes: score.notes,
      scorer: score.scorer,
      scored_at: `${score.ts}Z`,
      is_current: true,
      evidence_asset_ids: [run.blind_id]
    });
  }
  scoreRevisions.sort((a, b) => a.score_id.localeCompare(b.score_id));

  const h2Archive = (await readdir(path.join(experimentsRoot, "images", "h2"))).sort();
  for (const name of h2Archive) {
    const assetId = name.replace(/\.(png|jpg)$/, "");
    if (/^h2-226-r[2-6](-overlay)?$/.test(assetId)) continue;
    if (/^h2-353-r[1-5](-overlay)?$/.test(assetId)) {
      addQuarantine(`E/images/h2/${name}`, "H2-353 只有生成与叠字素材，results-h2.md 未给出其结果；按 plan-v2 仅存档，不产生结论也不进入数字", "case-353");
    } else if (assetId === "h2-pilot-226-1") {
      addQuarantine(`E/images/h2/${name}`, "单张早期试点图，不属于 results-h2.md 冻结的每臂 5 张设计，也无 mapping 可回连", "case-226");
    } else {
      addQuarantine(`E/images/h2/${name}`, "拼版展示素材，不是逐 Run 结果图，无法回连任何 Run", null);
    }
  }

  const experimentVersions = [
    {
      experiment_version_id: "h1/ev-001",
      experiment_id: "h1",
      version_no: 1,
      hypothesis: "分段结构化提示词（元素编号＋逐槽字符串）相比散文契约段落能提高图内文字逐字达成率（structured − prose 为正）。",
      design: {
        source: {
          mapping: "E/mapping-h1.jsonl",
          scores: "E/scores-h1.csv",
          results: "E/results-h1.md",
          specs: "E/specs/h1/"
        },
        case_ids: H1_CASE_NUMBERS.map((n) => `case-${n}`),
        reps_per_arm: 5,
        n_images: 100,
        blinding: "全部 blind_id 直接来自 mapping-h1.jsonl；未由图片文件或内容哈希反推归属",
        scoring_notes: "scores-h1.csv 已并入 results-h1.md ‘Scoring reliability’ 所述 20% 盲重复核修正；scorer=agent-recheck 的行为复核后评分，本次迁移作为各 Run 的 revision 1 当前评分",
        analysis: {
          effect: "对每案例先取每臂 per-image text_hits/text_total 的均值，再计算 structured − prose，最后对 10 个案例取算术平均，单位 pp",
          wilson_z: 1.959963984540054,
          bootstrap: { resamples: 10000, seed: 20261121, method: "案例级配对重采样，percentile 线性插值 2.5/97.5；RNG 复现 numpy PCG64(SeedSequence(seed)) 的 integers(0,10) 序列（analyze.py 口径）" },
          permutation: "双侧精确符号翻转，10 案例共 1024 种符号组合，|mean| >= |observed| - 1e-12 计数",
          gee: "原文 GEE 由 statsmodels 拟合，仅作为 design.reported 的存档文字，不在本生成器中重算"
        },
        reported: h1Report
      },
      arms: [
        { arm_id: "prose", label: "散文契约段落提示词", prompt_version_ids: H1_CASE_NUMBERS.map((n) => `case-${n}/pv-002`) },
        { arm_id: "structured", label: "分段结构化提示词", prompt_version_ids: H1_CASE_NUMBERS.map((n) => `case-${n}/pv-003`) }
      ],
      model: "agnes-image-2.5-flash",
      primary_metric: "text_fulfillment_case_level_effect_pp",
      secondary_metrics: ["hard_gate_pass", "requirement_fulfillment", "element_recall", "text_exact", "count_correct"],
      rubric_version: "h1-g1-g4-text-elements-count-v1",
      status: "frozen"
    },
    {
      experiment_version_id: "h2-226/ev-001",
      experiment_id: "h2-226",
      version_no: 1,
      hypothesis: "对具有可预测空白题注带的版式，无字底图加 PIL 叠字比模型直接生成图内文字获得更高的逐字槽位达成率。",
      design: {
        source: { results: "E/results-h2.md", spec: "E/specs/h2/case-226.json", images: "E/images/h2/" },
        single_case: "case-226",
        reps_per_arm: 5,
        n_images: 10,
        feasibility_pilot: true,
        powered_test: false,
        blinded: false,
        blind_id_policy: "H2 未施盲；overlay 各 Run 的 blind_id 字段记录来源运行标识 h2-226-r{2..6}-overlay，与 results-h2.md 的 r2–r6 一一对应，未由哈希猜测",
        control_runs: {
          experiment_version_id: "h1/ev-001",
          arm_id: "prose",
          case_id: "case-226",
          run_ids: controlRuns,
          note: "Arm A 复用 H1 case-226 prose 的 5 次运行及其盲评评分，不重复生成图片"
        },
        overlay: {
          font: "Noto Serif CJK SC Bold",
          placement: "内容底部空白带检测加人工核对",
          result_assets: "每个 overlay Run 的 result_asset_ids 依次为叠字结果图与对应无字底图",
          arm_b_text: "文字由 PIL 确定性构造，100% 逐字是操纵检查而非独立胜利"
        },
        reported: h2Report
      },
      arms: [
        { arm_id: "in-image", label: "Arm A：H1 prose 提示词，模型直接生成图内文字", prompt_version_ids: ["case-226/pv-002"] },
        { arm_id: "overlay", label: "Arm B：同 spec 但 texts=[] 并保留两行空白题注，PIL 后叠字", prompt_version_ids: ["case-226/pv-004"] }
      ],
      model: "agnes-image-2.5-flash",
      primary_metric: "exact_text_slot_fulfillment",
      secondary_metrics: ["per_image_exact_text", "portrait_count", "grid_layout", "band_usability", "text_portrait_collision"],
      rubric_version: "h2-226-manipulation-check-v1",
      status: "frozen"
    }
  ];

  return {
    promptVersions,
    experimentVersions,
    runs,
    scoreRevisions,
    quarantine: {
      policy: "唯一可信盲标映射是 E/mapping-h1.jsonl；禁止由图片或内容哈希猜 blind_id。无法回连 Case/PromptVersion/Run 或缺乏结果文档支持的记录只存档，不进入任何展示数字。",
      generated_by: "tools/migrate-experiments.mjs",
      records: quarantine
    },
    stats: {
      mapping_records: mapping.length,
      score_rows: scores.length,
      h1_runs: h1Runs.length,
      h2_overlay_runs: overlayRuns.length,
      h2_control_run_ids: controlRuns,
      score_revisions: scoreRevisions.length,
      quarantine_records: quarantine.length
    }
  };
}

export function checkReferences(migration, experimentsRoot) {
  const problems = [];
  const pvIds = new Set(migration.promptVersions.map((pv) => pv.prompt_version_id));
  const evById = new Map(migration.experimentVersions.map((ev) => [ev.experiment_version_id, ev]));
  const runIds = new Set(migration.runs.map((run) => run.run_id));
  const blindIds = new Set();
  const usedAssets = new Set();
  for (const ev of migration.experimentVersions) {
    for (const arm of ev.arms) {
      for (const pvId of arm.prompt_version_ids) {
        if (!pvIds.has(pvId)) problems.push(`${ev.experiment_version_id}/${arm.arm_id} 引用不存在的 ${pvId}`);
      }
    }
  }
  for (const run of migration.runs) {
    const ev = evById.get(run.experiment_version_id);
    if (!ev) { problems.push(`${run.run_id} 引用不存在的实验版本`); continue; }
    const arm = ev.arms.find((item) => item.arm_id === run.arm_id);
    if (!arm) problems.push(`${run.run_id} 的 arm_id 不在实验版本臂集合内`);
    else if (!arm.prompt_version_ids.includes(run.prompt_version_id)) problems.push(`${run.run_id} 的提示词版本未列入该臂`);
    if (!pvIds.has(run.prompt_version_id)) problems.push(`${run.run_id} 引用不存在的提示词版本`);
    if (blindIds.has(run.blind_id)) problems.push(`blind_id 重复：${run.blind_id}`);
    blindIds.add(run.blind_id);
    for (const assetId of run.result_asset_ids) {
      usedAssets.add(assetId);
      const directory = run.experiment_version_id === "h1/ev-001" ? "h1" : "h2";
      if (!existsSync(path.join(experimentsRoot, "images", directory, `${assetId}.png`))) {
        problems.push(`${run.run_id} 的结果图不存在：${assetId}`);
      }
    }
  }
  const currentByRun = new Map();
  for (const score of migration.scoreRevisions) {
    if (!runIds.has(score.run_id)) problems.push(`${score.score_id} 引用不存在的 Run`);
    if (score.is_current) {
      if (currentByRun.has(score.run_id)) problems.push(`${score.run_id} 有多条当前评分`);
      currentByRun.set(score.run_id, score.score_id);
    }
    for (const assetId of score.evidence_asset_ids) usedAssets.add(assetId);
  }
  for (const record of migration.quarantine.records) {
    const assetId = path.basename(record.source_path).replace(/\.(png|jpg)$/, "");
    if (usedAssets.has(assetId)) problems.push(`隔离记录仍被引用：${record.source_path}`);
  }
  return problems;
}

async function main() {
  const args = process.argv.slice(2);
  const check = args.includes("--check");
  const experimentsRoot = args.includes("--experiments") ? args[args.indexOf("--experiments") + 1] : defaultExperimentsRoot;
  const migration = await buildMigration(experimentsRoot);
  const schemas = await loadSchemas();
  const validate = createSchemaValidator(schemas);
  const schemaErrors = [];
  migration.promptVersions.forEach((pv) => schemaErrors.push(...validate(pv, "prompt-version.schema.json", pv.prompt_version_id)));
  migration.experimentVersions.forEach((ev) => schemaErrors.push(...validate(ev, "experiment-version.schema.json", ev.experiment_version_id)));
  migration.runs.forEach((run) => schemaErrors.push(...validate(run, "run.schema.json", run.run_id)));
  migration.scoreRevisions.forEach((score) => schemaErrors.push(...validate(score, "score-revision.schema.json", score.score_id)));
  const referenceProblems = checkReferences(migration, experimentsRoot);
  const externalNotes = [];
  const casePvPath = path.join(projectRoot, "content", "prompt-versions", "cases.json");
  const experimentPvIds = new Set(migration.promptVersions.map((pv) => pv.prompt_version_id));
  if (existsSync(casePvPath)) {
    const casePvIds = new Set((await readJson(casePvPath)).map((pv) => pv.prompt_version_id));
    for (const pv of migration.promptVersions) {
      if (casePvIds.has(pv.prompt_version_id)) referenceProblems.push(`与 T03 原始提示词版本主键冲突：${pv.prompt_version_id}`);
      if (pv.parent_version_id && !experimentPvIds.has(pv.parent_version_id) && !casePvIds.has(pv.parent_version_id)) {
        referenceProblems.push(`${pv.prompt_version_id} 的父版本不存在：${pv.parent_version_id}`);
      }
    }
    for (const caseNumber of H1_CASE_NUMBERS) {
      if (!casePvIds.has(`case-${caseNumber}/pv-001`)) referenceProblems.push(`T03 缺少原始提示词版本 case-${caseNumber}/pv-001，无法挂载实验版本沿革`);
    }
  } else {
    externalNotes.push("未找到 content/prompt-versions/cases.json（T03 产物）；实验提示词版本按原始提示词=pv-001 的约定从 pv-002 起编号，父版本外部引用未校验");
  }
  const targets = [
    ["content/prompt-versions/experiments.json", migration.promptVersions],
    ["content/experiment-versions.json", migration.experimentVersions],
    ["content/runs.json", migration.runs],
    ["content/score-revisions.json", migration.scoreRevisions],
    ["content/evidence-quarantine.json", migration.quarantine]
  ];
  const drift = [];
  for (const [relative, value] of targets) {
    const targetPath = path.join(projectRoot, relative);
    if (check) {
      if (!existsSync(targetPath)) { drift.push(`${relative} 不存在，请先运行 node tools/migrate-experiments.mjs`); continue; }
      const onDisk = await readJson(targetPath);
      if (canonical(onDisk) !== canonical(value)) drift.push(`${relative} 与源数据重建结果不一致`);
    } else {
      await writeJson(targetPath, value);
    }
  }
  const summary = {
    mode: check ? "check" : "write",
    h1_runs: migration.stats.h1_runs,
    h2_overlay_runs: migration.stats.h2_overlay_runs,
    prompt_versions: migration.promptVersions.length,
    score_revisions: migration.scoreRevisions.length,
    quarantine_records: migration.stats.quarantine_records,
    schema_errors: schemaErrors.length,
    orphan_references: referenceProblems.length,
    drift: drift.length,
    notes: externalNotes
  };
  console.log(JSON.stringify(summary, null, 2));
  for (const problem of [...schemaErrors, ...referenceProblems, ...drift]) console.error(problem);
  if (schemaErrors.length || referenceProblems.length || drift.length) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
