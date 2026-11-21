import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const sourceRoot = "/workspace/repos/awesome-gpt-image-2/data";
export const mappingPath = "/workspace/agent/agnes/experiments/mapping-h1.jsonl";
export const outputPaths = [
  "content/cases.json",
  "content/prompt-versions/cases.json",
  "content/source-assets.json",
  "content/gold-case-ids.json"
];

const expectedCaseCount = 541;
const expectedCategoryCount = 13;
const goldCaseCount = 60;
const goldSalt = "agnes-bench-t03-gold-v1";
const reportPath = path.join(projectRoot, "reports", "import.json");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function serialize(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, serialize(value), "utf8");
}

function numericSourceId(caseId) {
  return Number(caseId.slice("case-".length));
}

function compareCaseIds(left, right) {
  return numericSourceId(left) - numericSourceId(right);
}

function inspectPng(data, filePath) {
  const signature = "89504e470d0a1a0a";
  assert(data.length >= 33 && data.subarray(0, 8).toString("hex") === signature, `PNG 文件头无效：${filePath}`);
  assert(data.subarray(12, 16).toString("ascii") === "IHDR", `PNG 缺少 IHDR：${filePath}`);
  const width = data.readUInt32BE(16);
  const height = data.readUInt32BE(20);
  assert(width > 0 && height > 0, `PNG 尺寸无效：${filePath}`);
  return { format: "png", width, height };
}

function inspectJpeg(data, filePath) {
  assert(data.length >= 4 && data[0] === 0xff && data[1] === 0xd8, `JPEG 文件头无效：${filePath}`);
  const sofMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  let offset = 2;
  while (offset + 3 < data.length) {
    if (data[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (offset < data.length && data[offset] === 0xff) offset += 1;
    if (offset >= data.length) break;
    const marker = data[offset];
    offset += 1;
    if (marker === 0xda || marker === 0xd9) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    assert(offset + 2 <= data.length, `JPEG 段长度缺失：${filePath}`);
    const segmentLength = data.readUInt16BE(offset);
    assert(segmentLength >= 2 && offset + segmentLength <= data.length, `JPEG 段长度无效：${filePath}`);
    if (sofMarkers.has(marker)) {
      assert(segmentLength >= 7, `JPEG SOF 段无效：${filePath}`);
      const height = data.readUInt16BE(offset + 3);
      const width = data.readUInt16BE(offset + 5);
      assert(width > 0 && height > 0, `JPEG 尺寸无效：${filePath}`);
      return { format: "jpeg", width, height };
    }
    offset += segmentLength;
  }
  throw new Error(`JPEG 缺少尺寸段：${filePath}`);
}

async function inspectImage(filePath) {
  const data = await readFile(filePath);
  assert(data.length > 0, `图片为空：${filePath}`);
  const metadata = data.subarray(0, 8).toString("hex") === "89504e470d0a1a0a"
    ? inspectPng(data, filePath)
    : inspectJpeg(data, filePath);
  return { ...metadata, sha256: sha256(data) };
}

function emptySpec() {
  return {
    ratio: null,
    refs: [],
    ref_contract: null,
    canvas: null,
    subject: null,
    elements: [],
    texts: [],
    counts: [],
    layout: null,
    style: null,
    negatives: []
  };
}

function allocateGoldCaseIds(sortedCases, h1SourceIds, categories) {
  const groups = new Map(categories.map((category) => [category, []]));
  for (const sourceCase of sortedCases) {
    assert(groups.has(sourceCase.category), `案例 ${sourceCase.id} 的原始类别不在 13 类清单中`);
    groups.get(sourceCase.category).push(sourceCase);
  }

  const allocations = categories.map((category) => {
    const population = groups.get(category).length;
    const exactQuota = population * goldCaseCount / sortedCases.length;
    return { category, population, quota: Math.max(1, Math.floor(exactQuota)), remainder: exactQuota - Math.floor(exactQuota) };
  });
  let remaining = goldCaseCount - allocations.reduce((sum, item) => sum + item.quota, 0);
  assert(remaining >= 0, "金标分层配额超过 60");
  const remainderOrder = [...allocations].sort((left, right) => right.remainder - left.remainder || left.category.localeCompare(right.category));
  for (let index = 0; index < remaining; index += 1) remainderOrder[index].quota += 1;
  remaining = 0;

  const goldCaseIds = [];
  const strata = [];
  for (const allocation of allocations) {
    const group = groups.get(allocation.category);
    const mandatory = group.filter((item) => h1SourceIds.has(item.id)).sort((left, right) => left.id - right.id);
    assert(mandatory.length <= allocation.quota, `${allocation.category} 的 H1 数量超过分层配额`);
    const candidates = group
      .filter((item) => !h1SourceIds.has(item.id))
      .sort((left, right) => {
        const hashOrder = sha256(`${goldSalt}:case-${left.id}`).localeCompare(sha256(`${goldSalt}:case-${right.id}`));
        return hashOrder || left.id - right.id;
      });
    const selected = [...mandatory, ...candidates.slice(0, allocation.quota - mandatory.length)]
      .map((item) => `case-${item.id}`)
      .sort(compareCaseIds);
    goldCaseIds.push(...selected);
    strata.push({
      original_category: allocation.category,
      population: allocation.population,
      quota: allocation.quota,
      h1_count: mandatory.length,
      selected_case_ids: selected
    });
  }
  goldCaseIds.sort(compareCaseIds);
  assert(goldCaseIds.length === goldCaseCount && new Set(goldCaseIds).size === goldCaseCount, "金标抽样结果不是 60 个唯一案例");
  return { goldCaseIds, strata };
}

export async function buildImport() {
  const sourceCasesPath = path.join(sourceRoot, "cases.json");
  const imagesDirectory = path.join(sourceRoot, "images");
  const [sourceRaw, mappingRaw] = await Promise.all([
    readFile(sourceCasesPath, "utf8"),
    readFile(mappingPath, "utf8")
  ]);
  const source = JSON.parse(sourceRaw);
  const mapping = mappingRaw.split(/\r?\n/u).filter((line) => line.trim()).map((line) => JSON.parse(line));

  assert(Array.isArray(source.cases) && source.cases.length === expectedCaseCount, "源案例数量不是 541");
  assert(source.totalCases === expectedCaseCount, "源 totalCases 不是 541");
  assert(Array.isArray(source.categories) && source.categories.length === expectedCategoryCount, "源类别数量不是 13");
  assert(new Set(source.categories).size === expectedCategoryCount, "源类别清单存在重复");
  assert(mapping.length === 100, "H1 映射记录不是 100 条");

  const sourceIds = new Set(source.cases.map((item) => item.id));
  assert(sourceIds.size === expectedCaseCount, "源案例 id 不唯一");
  const h1SourceIds = new Set(mapping.map((item) => item.case_id));
  assert(h1SourceIds.size === 10, "H1 映射的去重 case_id 数量不是 10");
  for (const sourceId of h1SourceIds) assert(sourceIds.has(sourceId), `H1 case_id 不存在于源案例：${sourceId}`);

  const sortedCases = [...source.cases].sort((left, right) => left.id - right.id);
  const cases = [];
  const promptVersions = [];
  const sourceAssets = [];
  const sourceUrlFallbackCaseIds = [];

  for (const sourceCase of sortedCases) {
    assert(Number.isInteger(sourceCase.id) && sourceCase.id > 0, "源案例 id 必须是正整数");
    for (const field of ["title", "imageAlt", "sourceLabel", "githubUrl", "prompt", "category"]) {
      assert(typeof sourceCase[field] === "string" && sourceCase[field].length > 0, `案例 ${sourceCase.id} 缺少 ${field}`);
    }
    assert(typeof sourceCase.sourceUrl === "string", `案例 ${sourceCase.id} 的 sourceUrl 不是字符串`);
    const sourceUrl = sourceCase.sourceUrl || sourceCase.githubUrl;
    if (!sourceCase.sourceUrl) sourceUrlFallbackCaseIds.push(`case-${sourceCase.id}`);
    assert(Array.isArray(sourceCase.styles) && Array.isArray(sourceCase.scenes), `案例 ${sourceCase.id} 的 styles/scenes 不是数组`);
    assert(typeof sourceCase.featured === "boolean", `案例 ${sourceCase.id} 的 featured 不是布尔值`);
    const caseId = `case-${sourceCase.id}`;
    const assetId = `asset-${caseId}`;
    const imageName = path.basename(sourceCase.image);
    assert(imageName === sourceCase.image.slice("/images/".length), `案例 ${sourceCase.id} 的图片路径无效`);
    assert(new RegExp(`^case${sourceCase.id}\\.(?:jpg|png)$`, "u").test(imageName), `案例 ${sourceCase.id} 的图片名与 id 不匹配`);
    const imagePath = path.join(imagesDirectory, imageName);
    const image = await inspectImage(imagePath);
    const extensionFormat = path.extname(imageName) === ".png" ? "png" : "jpeg";
    assert(image.format === extensionFormat, `案例 ${sourceCase.id} 的图片扩展名与内容格式不一致`);

    cases.push({
      case_id: caseId,
      title: sourceCase.title,
      image_alt: sourceCase.imageAlt,
      cover_asset_id: assetId,
      featured: sourceCase.featured,
      editorial_status: "imported",
      source: {
        repository: source.repository,
        source_label: sourceCase.sourceLabel,
        source_url: sourceUrl,
        github_url: sourceCase.githubUrl,
        original_category: sourceCase.category,
        styles: [...sourceCase.styles],
        scenes: [...sourceCase.scenes]
      }
    });
    promptVersions.push({
      prompt_version_id: `${caseId}/pv-001`,
      case_id: caseId,
      version_no: 1,
      parent_version_id: null,
      text: sourceCase.prompt,
      content_sha256: sha256(sourceCase.prompt),
      change_note: "从 awesome-gpt-image-2 导入原始提示词",
      spec: emptySpec()
    });
    sourceAssets.push({
      asset_id: assetId,
      uri: pathToFileURL(imagePath).href,
      kind: "source_case_image",
      sha256: image.sha256,
      width: image.width,
      height: image.height,
      source_url: sourceUrl,
      format: image.format
    });
  }

  const { goldCaseIds, strata } = allocateGoldCaseIds(sortedCases, h1SourceIds, source.categories);
  const documents = {
    "content/cases.json": cases,
    "content/prompt-versions/cases.json": promptVersions,
    "content/source-assets.json": sourceAssets,
    "content/gold-case-ids.json": goldCaseIds
  };
  const outputHashes = Object.fromEntries(outputPaths.map((outputPath) => [outputPath, sha256(serialize(documents[outputPath]))]));
  const details = {
    source: {
      cases_path: sourceCasesPath,
      images_directory: imagesDirectory,
      mapping_path: mappingPath,
      cases_sha256: sha256(sourceRaw),
      mapping_sha256: sha256(mappingRaw),
      mapping_records: mapping.length,
      readable_source_images: sourceAssets.length,
      source_url_fallback_case_ids: sourceUrlFallbackCaseIds
    },
    gold: {
      count: goldCaseIds.length,
      category_count: strata.length,
      selection_method: "按原 13 类比例分配 60 条配额；H1 强制入选；其余按 SHA-256(agnes-bench-t03-gold-v1:case-id) 排序抽取",
      h1_case_ids: [...h1SourceIds].map((id) => `case-${id}`).sort(compareCaseIds),
      strata
    },
    outputs: outputHashes
  };
  return { documents, details };
}

async function main() {
  const args = process.argv.slice(2);
  assert(args.length === 0 || (args.length === 1 && args[0] === "--check"), "用法：node tools/import-cases.mjs [--check]");
  const checkMode = args[0] === "--check";
  const { documents, details } = await buildImport();

  if (checkMode) {
    const mismatches = [];
    for (const outputPath of outputPaths) {
      let actual;
      try {
        actual = await readFile(path.join(projectRoot, outputPath), "utf8");
      } catch (error) {
        mismatches.push(`${outputPath}：${error.message}`);
        continue;
      }
      if (actual !== serialize(documents[outputPath])) mismatches.push(`${outputPath}：与源数据重建结果不一致`);
    }
    assert(mismatches.length === 0, `导入检查失败\n${mismatches.join("\n")}`);
  } else {
    for (const outputPath of outputPaths) await writeJson(path.join(projectRoot, outputPath), documents[outputPath]);
  }

  const report = {
    task_id: "T03",
    status: "passed",
    import: {
      command: `node tools/import-cases.mjs${checkMode ? " --check" : ""}`,
      mode: checkMode ? "check" : "write",
      case_count: documents["content/cases.json"].length,
      prompt_version_count: documents["content/prompt-versions/cases.json"].length,
      source_asset_count: documents["content/source-assets.json"].length,
      unique_case_id_count: new Set(documents["content/cases.json"].map((item) => item.case_id)).size
    },
    ...details
  };
  await writeJson(reportPath, report);
  console.log(`通过：${report.import.case_count} 个案例、${report.import.prompt_version_count} 个原始提示词版本、${report.import.source_asset_count} 张原图`);
  console.log(`通过：金标 ${details.gold.count} 条，覆盖 ${details.gold.category_count} 个原始类别，包含 ${details.gold.h1_case_ids.length} 个 H1 case_id`);
  console.log(`${checkMode ? "导入一致性检查" : "导入"}完成，报告：reports/import.json`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
