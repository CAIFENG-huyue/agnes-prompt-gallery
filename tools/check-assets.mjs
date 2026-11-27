import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const caseImagesRoot = "repos/awesome-gpt-image-2/data/images";
const experimentImagesRoot = "agent/agnes/experiments/images";
const assetRoot = path.join(projectRoot, "public/assets");
const manifestPath = path.join(projectRoot, "generated/assets.json");
const reportPath = path.join(projectRoot, "reports/assets.json");
const tiers = [
  { name: "360w", width: 360, quality: 72, maxBytes: 45000 },
  { name: "640w", width: 640, quality: 78, maxBytes: 90000 },
  { name: "960w", width: 960, quality: 80, maxBytes: 150000 }
];
const expectedCounts = { cases: 541, h1: 100, h2: 22 };
const assetFields = ["asset_id", "uri", "kind", "sha256", "width", "height", "source_url", "source_asset_id", "format"];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function serialize(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

function compareNames(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function inspectWebP(data, label) {
  assert(data.length >= 20, `${label}：WebP 文件过短`);
  assert(data.subarray(0, 4).toString("ascii") === "RIFF", `${label}：缺少 RIFF 文件头`);
  assert(data.subarray(8, 12).toString("ascii") === "WEBP", `${label}：缺少 WEBP 标识`);
  assert(data.readUInt32LE(4) + 8 === data.length, `${label}：RIFF 长度不一致`);
  let offset = 12;
  let canvas = null;
  let bitstream = null;
  while (offset + 8 <= data.length) {
    const chunkType = data.subarray(offset, offset + 4).toString("ascii");
    const chunkSize = data.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + chunkSize;
    assert(end <= data.length, `${label}：${chunkType} 块越界`);
    if (chunkType === "VP8X") {
      assert(chunkSize >= 10, `${label}：VP8X 块过短`);
      canvas = {
        width: 1 + data.readUIntLE(start + 4, 3),
        height: 1 + data.readUIntLE(start + 7, 3)
      };
    } else if (chunkType === "VP8 ") {
      assert(chunkSize >= 10, `${label}：VP8 块过短`);
      assert(data[start + 3] === 0x9d && data[start + 4] === 0x01 && data[start + 5] === 0x2a, `${label}：VP8 帧头无效`);
      bitstream = {
        width: data.readUInt16LE(start + 6) & 0x3fff,
        height: data.readUInt16LE(start + 8) & 0x3fff
      };
    } else if (chunkType === "VP8L") {
      assert(chunkSize >= 5 && data[start] === 0x2f, `${label}：VP8L 块无效`);
      const bits = data.readUInt32LE(start + 1);
      bitstream = {
        width: 1 + (bits & 0x3fff),
        height: 1 + ((bits >>> 14) & 0x3fff)
      };
    }
    offset = end + (chunkSize % 2);
  }
  const dimensions = canvas ?? bitstream;
  assert(dimensions && dimensions.width > 0 && dimensions.height > 0, `${label}：缺少有效尺寸`);
  if (canvas && bitstream) {
    assert(canvas.width === bitstream.width && canvas.height === bitstream.height, `${label}：画布与码流尺寸不一致`);
  }
  return dimensions;
}

function sourcePathFromUri(uri) {
  assert(uri.startsWith("file://"), `来源资产不是 file URI：${uri}`);
  return fileURLToPath(uri);
}

async function experimentFiles(group) {
  const directory = path.join(experimentImagesRoot, group);
  const entries = await readdir(directory, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && /\.(?:jpe?g|png)$/iu.test(entry.name))
    .map((entry) => entry.name)
    .sort(compareNames);
  assert(files.length === expectedCounts[group], `${group} 源图数量应为 ${expectedCounts[group]}，实际为 ${files.length}`);
  return files.map((name) => path.join(directory, name));
}

async function collectSources(report) {
  const sourceAssets = await readJson(path.join(projectRoot, "content/source-assets.json"));
  assert(Array.isArray(sourceAssets) && sourceAssets.length === expectedCounts.cases, "T03 来源资产必须为 541 条");
  const reportSources = new Map(report.sources.map((source) => [source.source_asset_id, source]));
  assert(reportSources.size === 663 && report.sources.length === 663, "报告来源清单必须为 663 个唯一 ID");
  const sources = [];
  for (const item of sourceAssets) {
    const filePath = sourcePathFromUri(item.uri);
    assert(path.dirname(filePath) === caseImagesRoot, `案例源图越界：${filePath}`);
    sources.push({
      sourceAssetId: item.asset_id,
      group: "cases",
      path: filePath,
      uri: item.uri,
      sourceUrl: item.source_url,
      report: reportSources.get(item.asset_id)
    });
  }
  for (const group of ["h1", "h2"]) {
    for (const filePath of await experimentFiles(group)) {
      const sourceAssetId = path.basename(filePath, path.extname(filePath));
      const uri = pathToFileURL(filePath).href;
      sources.push({
        sourceAssetId,
        group,
        path: filePath,
        uri,
        sourceUrl: uri,
        report: reportSources.get(sourceAssetId)
      });
    }
  }
  assert(new Set(sources.map((source) => source.sourceAssetId)).size === 663, "来源资产 ID 存在重复");
  for (const source of sources) {
    const record = source.report;
    assert(record, `报告缺少来源资产：${source.sourceAssetId}`);
    const data = await readFile(source.path);
    assert(record.group === source.group && record.uri === source.uri, `来源记录不匹配：${source.sourceAssetId}`);
    assert(record.sha256 === sha256(data), `来源哈希已变化：${source.path}`);
    assert(record.bytes === data.length, `来源体积不匹配：${source.path}`);
    assert(Number.isInteger(record.width) && record.width > 0 && Number.isInteger(record.height) && record.height > 0, `来源尺寸无效：${source.sourceAssetId}`);
  }
  return sources;
}

function outputLocation(source, tier) {
  const stem = path.basename(source.path, path.extname(source.path));
  const relative = source.group === "cases"
    ? path.join("assets/cases", `${stem}-${tier.width}.webp`)
    : path.join("assets/experiments", source.group, `${stem}-${tier.width}.webp`);
  return {
    path: path.join(projectRoot, "public", relative),
    uri: `/${relative.split(path.sep).join("/")}`
  };
}

async function listFiles(directory) {
  const files = [];
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(entryPath));
    else if (entry.isFile()) files.push(entryPath);
  }
  return files;
}

async function main() {
  const manifest = await readJson(manifestPath);
  const report = await readJson(reportPath);
  assert(Array.isArray(manifest) && manifest.length === 1989, "generated/assets.json 必须包含 1989 条派生资产");
  assert(Array.isArray(report.outputs) && report.outputs.length === 1989, "报告必须包含 1989 条输出明细");
  const sources = await collectSources(report);
  const assetIds = new Set();
  const expectedPaths = new Set();
  const actualTierCounts = Object.fromEntries(tiers.map((tier) => [tier.name, 0]));
  const actualTierBytes = Object.fromEntries(tiers.map((tier) => [tier.name, 0]));
  let totalBytes = 0;
  let overBudgetCount = 0;
  let index = 0;

  for (const source of sources) {
    for (const tier of tiers) {
      const entry = manifest[index];
      const outcome = report.outputs[index];
      const location = outputLocation(source, tier);
      const assetId = `${source.sourceAssetId}-${tier.width}w`;
      const height = Math.max(1, Math.round(source.report.height * tier.width / source.report.width));
      assert(entry && typeof entry === "object" && !Array.isArray(entry), `清单项无效：${index}`);
      assert(Object.keys(entry).length === assetFields.length && assetFields.every((key) => Object.hasOwn(entry, key)), `清单字段必须严格符合 Asset Schema：${assetId}`);
      assert(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/u.test(entry.asset_id) && entry.asset_id.length <= 160, `资产 ID 无效：${assetId}`);
      assert(entry.asset_id === assetId, `资产 ID 错配：${assetId}`);
      assert(!assetIds.has(assetId), `资产 ID 重复：${assetId}`);
      assetIds.add(assetId);
      assert(entry.uri === location.uri, `资产 URI 错配：${assetId}`);
      assert(entry.kind === (source.group === "cases" ? "derived_case_image" : "derived_experiment_image"), `资产类型错配：${assetId}`);
      assert(entry.source_url === source.sourceUrl && entry.source_asset_id === source.sourceAssetId, `来源回连错配：${assetId}`);
      assert(entry.format === "webp", `格式字段不是 WebP：${assetId}`);
      const data = await readFile(location.path);
      const dimensions = inspectWebP(data, assetId);
      assert(entry.width === tier.width && entry.height === height, `清单尺寸错配：${assetId}`);
      assert(dimensions.width === tier.width && dimensions.height === height, `实际尺寸或宽高比错配：${assetId}`);
      assert(entry.sha256 === sha256(data), `输出哈希错配：${assetId}`);
      assert(data.length <= tier.maxBytes, `${assetId} 超过 ${tier.maxBytes} 字节：${data.length}`);
      assert(outcome.asset_id === assetId && outcome.uri === location.uri, `报告输出错配：${assetId}`);
      assert(outcome.bytes === data.length && outcome.sha256 === entry.sha256, `报告体积或哈希错配：${assetId}`);
      assert(outcome.width === tier.width && outcome.height === height, `报告尺寸错配：${assetId}`);
      assert(outcome.target_quality === tier.quality && Number.isInteger(outcome.quality) && outcome.quality >= 0 && outcome.quality <= tier.quality, `报告质量参数错配：${assetId}`);
      assert(outcome.over_budget === false, `报告仍标记超预算：${assetId}`);
      expectedPaths.add(location.path);
      actualTierCounts[tier.name] += 1;
      actualTierBytes[tier.name] += data.length;
      totalBytes += data.length;
      if (data.length > tier.maxBytes) overBudgetCount += 1;
      index += 1;
    }
  }

  const actualPaths = new Set(await listFiles(assetRoot));
  assert(actualPaths.size === expectedPaths.size && [...expectedPaths].every((filePath) => actualPaths.has(filePath)), "public/assets 存在缺图或额外文件");
  assert(report.task_id === "T08" && report.generator === "tools/optimize_images.py", "报告任务或生成器字段错配");
  assert(report.generated_count === 1989 && report.total_bytes === totalBytes, "报告总数或总体积不一致");
  assert(report.over_budget_count === overBudgetCount && overBudgetCount === 0, "报告超限统计不一致");
  assert(report.source_counts.cases === 541 && report.source_counts.h1 === 100 && report.source_counts.h2 === 22 && report.source_counts.total === 663, "报告来源覆盖统计不一致");
  for (const tier of tiers) {
    const tierReport = report.tiers.find((item) => item.name === tier.name);
    assert(tierReport, `报告缺少档位：${tier.name}`);
    assert(tierReport.width === tier.width && tierReport.quality === tier.quality && tierReport.max_bytes === tier.maxBytes, `档位参数错配：${tier.name}`);
    assert(tierReport.generated_count === actualTierCounts[tier.name] && tierReport.total_bytes === actualTierBytes[tier.name], `档位统计错配：${tier.name}`);
    assert(tierReport.over_budget_count === 0, `档位仍有超限图片：${tier.name}`);
  }

  report.status = "passed";
  report.validation = {
    command: "node tools/check-assets.mjs",
    status: "passed",
    source_image_count: 663,
    generated_count: 1989,
    total_bytes: totalBytes,
    over_budget_count: overBudgetCount,
    schema_valid: true,
    webp_dimensions_valid: true,
    source_coverage_valid: true,
    hashes_valid: true
  };
  await writeFile(reportPath, serialize(report), "utf8");
  console.log("通过：541+100+22 张源图全覆盖，1989 张 WebP 的 Schema、尺寸、哈希和体积均有效");
  console.log(`总体积 ${totalBytes} 字节，最终超限 ${overBudgetCount} 张，报告：reports/assets.json`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
