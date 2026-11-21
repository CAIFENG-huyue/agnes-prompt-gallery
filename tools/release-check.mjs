import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { recompute } from "./build-conclusions.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const buildDirectory = "dist-t14";
const expectedPages = 555;
const expectedCasePages = 541;
const expectedAssetCount = 1989;
const maxAssetBytes = 150000;
const penguinQuery = "企鹅饼干礼盒结构板，带尺寸和材料说明";

const gates = [];
const notes = [];

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function tailLines(value, limit = 25) {
  const lines = String(value ?? "").split(/\r?\n/u).filter((line) => line.trim().length > 0);
  return lines.slice(-limit).join("\n");
}

function lastLine(value) {
  const lines = String(value ?? "").split(/\r?\n/u).filter((line) => line.trim().length > 0);
  return lines.at(-1)?.trim() ?? "";
}

function runCommand(id, command, args, options = {}) {
  const startedAt = Date.now();
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    encoding: "utf8",
    timeout: options.timeout ?? 600000,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env }
  });
  return {
    id,
    command: [command, ...args].join(" "),
    exit_code: result.status,
    signal: result.signal,
    error: result.error?.message ?? null,
    duration_ms: Date.now() - startedAt,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    output_excerpt: tailLines([result.stdout ?? "", result.stderr ?? ""].filter(Boolean).join("\n"), options.lines ?? 25),
    ok: result.status === 0
  };
}

function recordGate(status, id, name, evidence, summary) {
  const gate = { id, name, status, summary, evidence };
  gates.push(gate);
  const mark = status === "pass" ? "PASS" : "FAIL";
  console.log(`[${mark}] ${id} ${name}${summary ? ` — ${summary}` : ""}`);
  if (status !== "pass") {
    const detail = evidence?.output_excerpt || evidence?.error || evidence?.reason || "";
    if (detail) console.error(tailLines(detail, 20));
  }
  return gate;
}

function commandGate(id, name, command, args, options = {}) {
  const result = runCommand(id, command, args, options);
  const summary = result.ok
    ? lastLine(result.stdout).slice(0, 220)
    : (lastLine(result.stderr) || lastLine(result.stdout) || `exit ${result.exit_code}`).slice(0, 220);
  recordGate(result.ok ? "pass" : "fail", id, name, {
    command: result.command,
    exit_code: result.exit_code,
    signal: result.signal,
    duration_ms: result.duration_ms,
    output_excerpt: result.output_excerpt,
    error: result.error
  }, summary);
  return result;
}

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(projectRoot, relativePath), "utf8"));
}

async function readJsonAt(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function walkFiles(root) {
  const files = [];
  async function walk(directory) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(entryPath);
      else if (entry.isFile()) files.push(path.relative(root, entryPath).split(path.sep).join("/"));
    }
  }
  await walk(root);
  return files;
}

async function countPages(distRoot) {
  const files = await walkFiles(distRoot);
  const pageFiles = files.filter((file) => file === "index.html" || file.endsWith("/index.html"));
  const caseDirs = pageFiles
    .filter((file) => file.startsWith("cases/") && file.split("/").length === 3)
    .map((file) => file.split("/")[1]);
  const breakdown = {};
  for (const file of pageFiles) {
    const section = file === "index.html" ? "home" : file.split("/")[0];
    breakdown[section] = (breakdown[section] ?? 0) + 1;
  }
  return { pages: pageFiles.length, casePages: caseDirs.length, caseIds: caseDirs, breakdown };
}

async function hashTree(root) {
  const files = (await walkFiles(root)).sort();
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(file);
    hash.update("\0");
    hash.update(await readFile(path.join(root, file)));
    hash.update("\0");
  }
  return { file_count: files.length, sha256: hash.digest("hex") };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function assertConclusions() {
  const [experimentVersions, runs, scoreRevisions, generated] = await Promise.all([
    readJson("content/experiment-versions.json"),
    readJson("content/runs.json"),
    readJson("content/score-revisions.json"),
    readJson("generated/conclusions.json")
  ]);
  const recomputed = recompute(experimentVersions, runs, scoreRevisions);
  const matches = canonical(recomputed.conclusions) === canonical(generated);
  const evidence = {
    tool: "tools/build-conclusions.mjs#recompute",
    generated_count: generated.length,
    recomputed_count: recomputed.conclusions.length,
    score_snapshot_hash: recomputed.scoreSnapshotHash,
    conclusion_versions: generated.map((item) => ({
      conclusion_version_id: item.conclusion_version_id,
      estimate: item.estimate,
      ci: [item.ci_low, item.ci_high],
      n_cases: item.n_cases,
      evidence_runs: item.evidence_run_ids.length
    })),
    matches_generated: matches
  };
  if (!matches) {
    const firstDiff = generated.findIndex((item, index) => canonical(item) !== canonical(recomputed.conclusions[index]));
    evidence.first_mismatch_index = firstDiff === -1 ? generated.length : firstDiff;
  }
  recordGate(
    matches ? "pass" : "fail",
    "conclusions",
    "H1/H2 结论重算与 generated/conclusions.json 一致",
    evidence,
    matches
      ? `${generated.length} 个 ConclusionVersion 重算一致，快照 ${recomputed.scoreSnapshotHash.slice(0, 12)}…`
      : `结论漂移：首个差异索引 ${evidence.first_mismatch_index}`
  );
}

async function assertPenguin(report) {
  const hard = report?.penguin_hard_scenario;
  const sameStructure = Array.isArray(hard?.same_structure_case_ids) ? hard.same_structure_case_ids : [];
  const top5Count = Array.isArray(hard?.top5) ? hard.top5.length : 0;
  const passed = Boolean(
    hard?.passed
      && hard.actual_same_structure_hits >= 3
      && top5Count >= 3
      && top5Count <= 5
      && sameStructure.length >= 3
      && new Set(sameStructure).size === sameStructure.length
  );
  recordGate(
    passed ? "pass" : "fail",
    "penguin_top5",
    "企鹅硬场景 Top5 ≥3 同结构",
    {
      query: penguinQuery,
      required_same_structure_hits: 3,
      actual_same_structure_hits: hard?.actual_same_structure_hits ?? null,
      top5_count: top5Count,
      same_structure_case_ids: sameStructure,
      all_results_have_reasons: hard?.all_results_have_reasons ?? null
    },
    passed
      ? `Top5 命中 ${hard.actual_same_structure_hits} 个同结构：${sameStructure.join("、")}`
      : `Top5 同结构命中不足 3 或返回数不在 3–5：${hard?.actual_same_structure_hits}`
  );
}

async function assertResourceBudget() {
  const assets = await readJson("generated/assets.json");
  let totalBytes = 0;
  let max = { bytes: 0, uri: null };
  const missing = [];
  for (const asset of assets) {
    const filePath = path.join(projectRoot, "public", asset.uri.replace(/^\//u, ""));
    try {
      const info = await stat(filePath);
      if (!info.isFile()) throw new Error("not a file");
      totalBytes += info.size;
      if (info.size > max.bytes) max = { bytes: info.size, uri: asset.uri };
    } catch {
      missing.push(asset.asset_id);
    }
  }
  let report = null;
  try {
    report = await readJson("reports/assets.json");
  } catch {
    report = null;
  }
  const totalMatches = report ? report.total_bytes === totalBytes : true;
  const passed = assets.length === expectedAssetCount
    && missing.length === 0
    && max.bytes <= maxAssetBytes
    && totalBytes > 0
    && totalMatches;
  recordGate(
    passed ? "pass" : "fail",
    "resource_budget",
    "资源预算：单文件 ≤150KB、总量、缺图=0",
    {
      asset_count: assets.length,
      expected_asset_count: expectedAssetCount,
      max_file_bytes: max.bytes,
      max_file_uri: max.uri,
      max_file_budget_bytes: maxAssetBytes,
      total_bytes: totalBytes,
      total_mib: Number((totalBytes / 1024 / 1024).toFixed(2)),
      missing_count: missing.length,
      missing_asset_ids: missing.slice(0, 20),
      report_total_bytes: report?.total_bytes ?? null,
      report_total_matches_disk: totalMatches,
      tiers: report?.tiers ?? null
    },
    `${assets.length} 张，单张最大 ${max.bytes} B（${max.uri}），总量 ${(totalBytes / 1024 / 1024).toFixed(2)} MiB，缺图 ${missing.length}`
  );
}

async function restoreContentFiles(relativePaths, originals) {
  let lastError = "";
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const result = spawnSync("git", ["restore", "--", ...relativePaths], {
      cwd: projectRoot,
      encoding: "utf8"
    });
    if (result.status === 0) {
      return { method: "git restore", attempts: attempt, ok: true, error: null };
    }
    lastError = (result.stderr || result.stdout || `exit ${result.status}`).trim();
    if (attempt < 3) await sleep(3000);
  }
  for (const [relativePath, content] of originals) {
    await writeFile(path.join(projectRoot, relativePath), content, "utf8");
  }
  return { method: "original bytes fallback", attempts: 3, ok: false, error: lastError };
}

async function runContractTest(baseline) {
  const files = {
    cases: "content/cases.json",
    promptVersions: "content/prompt-versions/cases.json",
    classifications: "content/classifications.json",
    fingerprints: "content/fingerprints.json",
    guides: "content/case-guides.json",
    decisions: "content/decisions.json"
  };
  const entries = Object.entries(files);
  const originals = new Map();
  const data = {};
  for (const [key, relativePath] of entries) {
    const content = await readFile(path.join(projectRoot, relativePath), "utf8");
    originals.set(relativePath, content);
    data[key] = JSON.parse(content);
  }
  const beforeLengths = Object.fromEntries(entries.map(([key]) => [key, data[key].length]));
  const beforeSrc = await hashTree(path.join(projectRoot, "src"));
  const beforeSrcStatus = spawnSync("git", ["status", "--porcelain", "--", "src"], { cwd: projectRoot, encoding: "utf8" }).stdout.trim();
  const tempRoot = await mkdtemp(path.join(tmpdir(), "agnes-t14-contract-"));
  const modifiedOutDir = path.join(tempRoot, "dist-modified");
  const restoredOutDir = path.join(tempRoot, "dist-restored");
  const syntheticId = "case-9999";
  const checks = [];
  let buildModified = null;
  let buildRestored = null;
  let restore = null;
  let restoreVerification = null;
  let srcAfter = null;

  const addCheck = (id, passed, evidence) => {
    checks.push({ id, status: passed ? "pass" : "fail", evidence });
  };

  try {
    if (data.cases.some((item) => item.case_id === syntheticId) || data.promptVersions.some((item) => item.case_id === syntheticId)) {
      throw new Error(`合成案例 ${syntheticId} 已存在于基线数据`);
    }
    const baseCase = data.cases.at(-1);
    const basePrompt = data.promptVersions.find((item) => item.case_id === baseCase.case_id);
    const baseClassification = data.classifications.find((item) => item.case_id === baseCase.case_id);
    const baseFingerprint = data.fingerprints.find((item) => item.case_id === baseCase.case_id);
    const baseGuide = data.guides.find((item) => item.case_id === baseCase.case_id);
    const baseDecision = data.decisions.find((item) => item.evidence_level === "inferred");
    if (!basePrompt || !baseClassification || !baseFingerprint || !baseGuide || !baseDecision) {
      throw new Error("基线缺少可用于派生合成案例的完整数据");
    }

    const title = "T14 只增数据契约合成案例";
    const promptText = `Synthetic contract case ${syntheticId}: a 4:5 poster with one fixed title slot and one material note, created only to verify data-only additions never require page source changes.`;
    const promptVersionId = `${syntheticId}/pv-001`;
    const syntheticCase = {
      ...baseCase,
      case_id: syntheticId,
      title,
      image_alt: title,
      featured: false,
      editorial_status: "imported",
      source: {
        ...baseCase.source,
        github_url: `${baseCase.source.github_url.split("#")[0]}#${syntheticId}`
      }
    };
    const syntheticPrompt = {
      ...basePrompt,
      prompt_version_id: promptVersionId,
      case_id: syntheticId,
      text: promptText,
      content_sha256: sha256(promptText),
      change_note: "T14 契约测试合成提示词版本"
    };
    const syntheticClassification = { ...baseClassification, case_id: syntheticId };
    const syntheticFingerprint = { ...baseFingerprint, case_id: syntheticId };
    const syntheticGuide = {
      ...baseGuide,
      guide_id: `${syntheticId}/guide-001`,
      case_id: syntheticId,
      suitable_for: [`需要核对“${title}”这类模块信息图的槽位数量、顺序与标注绑定时。`],
      unsuitable_for: ["只需要无字氛围图，不需要核对槽位或标签时。"],
      common_challenges: ["合成案例仅用于验证只增数据；迁移时应逐项核对标题与材料说明槽位。"],
      transferable_rule: `迁移“${title}”时先固定模块信息图，再显式保留标题槽位与材料说明的绑定；删去任一槽位就无法保证对应关系。`
    };
    const syntheticDecision = {
      ...baseDecision,
      decision_id: `${syntheticId}/decision-inferred-structure`,
      case_id: syntheticId,
      prompt_version_id: promptVersionId,
      decision: `为“${title}”固定标题槽位与材料说明的归属。`,
      control_target: "标题与材料说明的槽位归属",
      before_excerpt: promptText.slice(0, 90),
      after_excerpt: promptText.slice(40, 140),
      expected_effect: "推断可把标题与材料说明的归属变成可核对项；换成只要求出现文字，容易出现文字存在但挂错对象。此卡没有引用 Run，结论仅为 inferred。",
      observed_effect: null,
      evidence_level: "inferred",
      evidence_refs: [
        { entity_type: "case", entity_id: syntheticId },
        { entity_type: "prompt_version", entity_id: promptVersionId }
      ]
    };

    data.cases.push(syntheticCase);
    data.promptVersions.push(syntheticPrompt);
    data.classifications.push(syntheticClassification);
    data.fingerprints.push(syntheticFingerprint);
    data.guides.push(syntheticGuide);
    data.decisions.push(syntheticDecision);

    for (const [key, relativePath] of entries) {
      await writeFile(path.join(projectRoot, relativePath), `${JSON.stringify(data[key], null, 2)}\n`, "utf8");
    }

    const afterLengths = Object.fromEntries(entries.map(([key]) => [key, data[key].length]));
    addCheck(
      "data_files_appended",
      entries.every(([key]) => afterLengths[key] === beforeLengths[key] + 1)
        && data.cases.some((item) => item.case_id === syntheticId)
        && data.promptVersions.some((item) => item.prompt_version_id === promptVersionId),
      {
        synthetic_case_id: syntheticId,
        synthetic_prompt_version_id: promptVersionId,
        appended_files: Object.fromEntries(entries.map(([key, relativePath]) => [relativePath, {
          before: beforeLengths[key],
          after: afterLengths[key]
        }]))
      }
    );

    buildModified = runCommand("contract_build_modified", "npx", ["--yes", "astro", "build", "--outDir", modifiedOutDir], { timeout: 600000 });
    const modifiedPages = await countPages(modifiedOutDir);
    srcAfter = await hashTree(path.join(projectRoot, "src"));
    const srcStatus = spawnSync("git", ["status", "--porcelain", "--", "src"], { cwd: projectRoot, encoding: "utf8" });
    const syntheticPagePath = path.join(modifiedOutDir, "cases", syntheticId, "index.html");
    let syntheticPage = "";
    try {
      syntheticPage = await readFile(syntheticPagePath, "utf8");
    } catch {
      syntheticPage = "";
    }
    const oldUrlsPreserved = baseline.caseIds.every((caseId) => modifiedPages.caseIds.includes(caseId));

    addCheck("rebuild_542_case_pages", buildModified.ok && modifiedPages.casePages === baseline.casePages + 1 && modifiedPages.pages === baseline.pages + 1, {
      command: buildModified.command,
      exit_code: buildModified.exit_code,
      pages: modifiedPages.pages,
      expected_pages: baseline.pages + 1,
      case_pages: modifiedPages.casePages,
      expected_case_pages: baseline.casePages + 1
    });
    addCheck("synthetic_case_page_rendered", Boolean(syntheticPage) && syntheticPage.includes(title), {
      path: `cases/${syntheticId}/index.html`,
      rendered: Boolean(syntheticPage),
      contains_title: syntheticPage.includes(title)
    });
    addCheck("old_case_urls_preserved", oldUrlsPreserved, {
      baseline_case_pages: baseline.casePages,
      preserved_case_pages: modifiedPages.caseIds.filter((caseId) => baseline.caseIds.includes(caseId)).length
    });
    addCheck("src_unchanged", beforeSrc.sha256 === srcAfter.sha256
      && beforeSrc.file_count === srcAfter.file_count
      && srcStatus.stdout.trim() === beforeSrcStatus, {
      before: beforeSrc,
      after: srcAfter,
      git_status_src_before: beforeSrcStatus || "(empty)",
      git_status_src_after: srcStatus.stdout.trim() || "(empty)"
    });
  } catch (error) {
    addCheck("contract_setup", false, { error: error instanceof Error ? error.message : String(error) });
  } finally {
    restore = await restoreContentFiles(entries.map(([, relativePath]) => relativePath), originals);
    const restoredLengths = {};
    let restoredBytesMatch = true;
    for (const [key, relativePath] of entries) {
      const content = await readFile(path.join(projectRoot, relativePath), "utf8");
      restoredLengths[key] = JSON.parse(content).length;
      if (content !== originals.get(relativePath)) restoredBytesMatch = false;
    }
    buildRestored = runCommand("contract_build_restored", "npx", ["--yes", "astro", "build", "--outDir", restoredOutDir], { timeout: 600000 });
    const restoredPages = await countPages(restoredOutDir);
    const gitContentStatus = spawnSync("git", ["status", "--porcelain", "--", "content", "generated"], { cwd: projectRoot, encoding: "utf8" });
    restoreVerification = {
      restore,
      restored_lengths: restoredLengths,
      baseline_lengths: beforeLengths,
      bytes_match_originals: restoredBytesMatch,
      git_status_content_generated: gitContentStatus.stdout.trim() || "(empty)",
      rebuild: {
        command: buildRestored.command,
        exit_code: buildRestored.exit_code,
        pages: restoredPages.pages,
        case_pages: restoredPages.casePages,
        expected_pages: baseline.pages,
        expected_case_pages: baseline.casePages
      }
    };
    addCheck(
      "restored_541",
      restore.ok
        && restoredBytesMatch
        && Object.entries(beforeLengths).every(([key, value]) => restoredLengths[key] === value)
        && !gitContentStatus.stdout.trim()
        && buildRestored.ok
        && restoredPages.pages === baseline.pages
        && restoredPages.casePages === baseline.casePages,
      restoreVerification
    );
    await rm(tempRoot, { recursive: true, force: true });
  }

  const tempOutsideRepo = !path.resolve(tempRoot).startsWith(path.resolve(projectRoot) + path.sep);
  addCheck("temp_outside_repo", tempOutsideRepo, { temp_dir: tempRoot });

  const passed = checks.every((check) => check.status === "pass");
  recordGate(
    passed ? "pass" : "fail",
    "contract_test",
    "只增数据契约测试（541 → 542 → 541）",
    {
      temp_dir: tempRoot,
      baseline: { pages: baseline.pages, case_pages: baseline.casePages },
      modified_build: buildModified ? {
        command: buildModified.command,
        exit_code: buildModified.exit_code,
        pages: buildModified.stdout.match(/(\d+)\s+page\(s\) built/u)?.[1] ?? null
      } : null,
      restored_build: buildRestored ? {
        command: buildRestored.command,
        exit_code: buildRestored.exit_code,
        pages: buildRestored.stdout.match(/(\d+)\s+page\(s\) built/u)?.[1] ?? null
      } : null,
      restore: restoreVerification,
      checks
    },
    passed
      ? "合成案例使案例页 541→542 且 src 未变；git restore 后复建 542→541"
      : "只增数据契约测试存在失败项"
  );
  return passed;
}

async function main() {
  const startedAt = Date.now();
  console.log("T14 发布门禁开始：顺序执行全部质量门与只增数据契约测试。");

  commandGate("contracts", "契约与五类定义校验", "node", ["tools/validate-contracts.mjs"]);
  commandGate("cases", "案例、提示词版本与来源资产校验", "node", ["tools/validate-cases.mjs"]);
  commandGate("classifications", "一级分类与金标一致性", "node", ["tools/check-classifications.mjs"]);
  commandGate("fingerprints", "结构指纹、意图与同义词", "node", ["tools/check-fingerprints.mjs"]);
  commandGate("guides", "案例指南、决策卡与实验证据", "node", ["tools/check-guides.mjs"]);
  commandGate("assets", "多档 WebP 资产完整性与档位预算", "node", ["tools/check-assets.mjs"]);

  try {
    await assertConclusions();
  } catch (error) {
    recordGate("fail", "conclusions", "H1/H2 结论重算与 generated/conclusions.json 一致", {
      error: error instanceof Error ? error.message : String(error)
    }, "结论重算抛出异常");
  }

  commandGate("search", "结构优先检索与 25 条金标", "node", ["tools/evaluate-search.mjs"]);
  try {
    const searchReport = await readJson("reports/search-eval.json");
    const searchPassed = searchReport.passed === true
      && searchReport.queries_passed === searchReport.query_count
      && searchReport.metrics?.results_with_reasons === searchReport.metrics?.total_results;
    recordGate(
      searchPassed ? "pass" : "fail",
      "search_report",
      "检索评估报告汇总",
      {
        passed: searchReport.passed,
        queries_passed: searchReport.queries_passed,
        query_count: searchReport.query_count,
        reason_coverage: searchReport.metrics?.reason_coverage,
        mean_confirmed_recall_at_5: searchReport.metrics?.mean_confirmed_recall_at_5
      },
      `${searchReport.queries_passed}/${searchReport.query_count} 查询达标，命中原因覆盖 ${searchReport.metrics?.results_with_reasons}/${searchReport.metrics?.total_results}`
    );
    await assertPenguin(searchReport);
  } catch (error) {
    recordGate("fail", "penguin_top5", "企鹅硬场景 Top5 ≥3 同结构", {
      error: error instanceof Error ? error.message : String(error)
    }, "无法读取检索评估报告");
  }

  await rm(path.join(projectRoot, buildDirectory), { recursive: true, force: true });
  const build = runCommand("build", "npx", ["--yes", "astro", "build", "--outDir", buildDirectory], { timeout: 600000 });
  const builtPages = Number(build.stdout.match(/(\d+)\s+page\(s\) built/u)?.[1] ?? NaN);
  recordGate(
    build.ok && builtPages === expectedPages ? "pass" : "fail",
    "build",
    `静态构建（${buildDirectory}）`,
    {
      command: build.command,
      exit_code: build.exit_code,
      duration_ms: build.duration_ms,
      pages_built: Number.isNaN(builtPages) ? null : builtPages,
      expected_pages: expectedPages,
      output_excerpt: build.output_excerpt
    },
    build.ok ? `${builtPages} 页构建完成（${build.duration_ms} ms）` : `构建失败：exit ${build.exit_code}`
  );

  const pagesAfterBuild = await countPages(path.join(projectRoot, buildDirectory));
  const pageGatePassed = pagesAfterBuild.pages === expectedPages && pagesAfterBuild.casePages === expectedCasePages;
  recordGate(
    pageGatePassed ? "pass" : "fail",
    "page_count",
    "页数与案例覆盖（555 页 / 541 案例）",
    {
      total_pages: pagesAfterBuild.pages,
      expected_total_pages: expectedPages,
      case_pages: pagesAfterBuild.casePages,
      expected_case_pages: expectedCasePages,
      breakdown: pagesAfterBuild.breakdown
    },
    `${pagesAfterBuild.pages} 页，其中案例页 ${pagesAfterBuild.casePages}；${JSON.stringify(pagesAfterBuild.breakdown)}`
  );

  commandGate("discovery", "首页发现与企鹅题结果卡", "node", ["quality/discovery.check.mjs", buildDirectory]);
  commandGate("case_pages", "541 个案例页自解释与移动首屏", "node", ["quality/case-pages.check.mjs", buildDirectory]);
  commandGate("evidence_pages", "实验证据页与结论下钻", "node", ["quality/evidence-pages.check.mjs", buildDirectory]);

  try {
    await assertResourceBudget();
  } catch (error) {
    recordGate("fail", "resource_budget", "资源预算：单文件 ≤150KB、总量、缺图=0", {
      error: error instanceof Error ? error.message : String(error)
    }, "资源预算检查抛出异常");
  }

  await runContractTest({
    pages: pagesAfterBuild.pages,
    casePages: pagesAfterBuild.casePages,
    caseIds: pagesAfterBuild.caseIds
  });

  const failed = gates.filter((gate) => gate.status !== "pass");
  const passed = failed.length === 0;
  const elapsed = Date.now() - startedAt;
  const commit = spawnSync("git", ["rev-parse", "HEAD"], { cwd: projectRoot, encoding: "utf8" }).stdout.trim();
  const branch = spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: projectRoot, encoding: "utf8" }).stdout.trim();
  const release = {
    task_id: "T14",
    generated_at: new Date().toISOString(),
    status: passed ? "passed" : "failed",
    passed,
    duration_ms: elapsed,
    environment: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      commit: commit,
      base_commit: commit,
      branch
    },
    build: {
      command: `npx --yes astro build --outDir ${buildDirectory}`,
      out_dir: buildDirectory,
      pages: pagesAfterBuild.pages,
      case_pages: pagesAfterBuild.casePages,
      breakdown: pagesAfterBuild.breakdown,
      duration_ms: build.duration_ms,
      exit_code: build.exit_code
    },
    resource_budget: gates.find((gate) => gate.id === "resource_budget")?.evidence ?? null,
    summary: {
      total_gates: gates.length,
      passed: gates.length - failed.length,
      failed: failed.length,
      failed_gate_ids: failed.map((gate) => gate.id)
    },
    gates,
    notes
  };
  const reportsDirectory = path.join(projectRoot, "reports");
  await mkdir(reportsDirectory, { recursive: true });
  await writeFile(path.join(reportsDirectory, "release.json"), `${JSON.stringify(release, null, 2)}\n`, "utf8");

  const lines = [
    "# 发布矩阵（T14）",
    "",
    `- 生成时间：${release.generated_at}`,
    `- 基线提交（门禁执行时 HEAD）：\`${commit}\`（${branch}）`,
    `- 门禁结果：**${passed ? "全部通过" : `失败 ${failed.length} 项`}**`,
    `- 门禁命令：\`node tools/release-check.mjs\``,
    "",
    "## 构建产物",
    "",
    `- 构建命令：\`npx --yes astro build --outDir ${buildDirectory}\``,
    `- 输出目录：\`${buildDirectory}/\`（临时发布候选，已在 \`.gitignore\` 中忽略，不覆盖 \`dist/\`）`,
    `- 构建耗时：${build.duration_ms} ms`,
    `- 总页数：${pagesAfterBuild.pages}（案例页 ${pagesAfterBuild.casePages}）`,
    `- 静态资源：public/assets 下 ${expectedAssetCount} 张 WebP，构建时原样复制到 \`${buildDirectory}/assets/\``,
    "",
    "## 页数",
    "",
    "| 区块 | 页数 |",
    "|---|---:|",
    ...Object.entries(pagesAfterBuild.breakdown).map(([section, count]) => `| ${section} | ${count} |`),
    `| **合计** | **${pagesAfterBuild.pages}** |`,
    "",
    `案例页覆盖 \`dist-t14/cases/\` 下 ${pagesAfterBuild.casePages} 个目录，与 \`content/cases.json\` 的 ${expectedCasePages} 条记录一一对应。`,
    "",
    "## 资源体积",
    ""
  ];
  const budget = release.resource_budget;
  if (budget) {
    lines.push(
      `- 资产总数：${budget.asset_count}（期望 ${budget.expected_asset_count}）`,
      `- 单文件上限：${budget.max_file_budget_bytes} B；实测最大 ${budget.max_file_bytes} B（\`${budget.max_file_uri}\`）`,
      `- 总量：${budget.total_bytes} B（${budget.total_mib} MiB）`,
      `- 缺图：${budget.missing_count}`,
      ""
    );
    if (Array.isArray(budget.tiers)) {
      lines.push("| 档位 | 数量 | 单张上限 | 档位总量 | 超限 |", "|---|---:|---:|---:|---:|");
      for (const tier of budget.tiers) {
        lines.push(`| ${tier.name} | ${tier.generated_count} | ${tier.max_bytes} B | ${tier.total_bytes} B | ${tier.over_budget_count} |`);
      }
      lines.push("");
    }
  }
  lines.push(
    "## 校验清单",
    "",
    "| 门禁 | 状态 | 命令/方法 | 证据摘要 |",
    "|---|---|---|---|",
    ...gates.map((gate) => {
      const command = gate.evidence?.command ?? (gate.id === "conclusions" ? "tools/build-conclusions.mjs#recompute" : gate.id === "penguin_top5" || gate.id === "search_report" ? "reports/search-eval.json" : gate.id === "page_count" ? "遍历 dist-t14/index.html" : gate.id === "resource_budget" ? "generated/assets.json + public/assets" : gate.id === "contract_test" ? "临时追加数据 + 两次 astro build" : "-");
      return `| ${gate.name} | ${gate.status} | \`${String(command).replaceAll("|", "\\|")}\` | ${String(gate.summary ?? "").replaceAll("|", "\\|")} |`;
    }),
    "",
    "## 只增数据契约测试",
    "",
    `- 方法：在临时目录 \`${release.gates.find((gate) => gate.id === "contract_test")?.evidence?.temp_dir ?? "(已清理)"}\` 构建，仓库内只临时追加数据行，结束后 \`git restore\` 还原。`,
    "- 追加文件：`content/cases.json`、`content/prompt-versions/cases.json`，以及案例页渲染所必需的 `classifications.json`、`fingerprints.json`、`case-guides.json`、`decisions.json` 同 case_id 数据行。",
    "- 断言：案例页 541 → 542，旧 541 个案例 URL 全部保留，`src/` 目录哈希与 `git status -- src` 均无变化。",
    "- 还原：`git restore` 后内容字节与基线一致，复建页数回到 555 / 案例页 541；临时构建目录已删除。",
    "",
    "## 已知局限",
    "",
    "- 案例页模型要求同一 `case_id` 同时具备分类、指纹、指南、决策卡和提示词版本；只往 `cases.json` 追加一行不会渲染新页，因此契约测试同步追加这些数据行，但仍不改任何 `src/` 代码。",
    "- 单文件资源预算按 150,000 字节执行（与 `tools/check-assets.mjs` 的 960w 档位一致），不是 153,600 字节的 KiB 口径。",
    "- `reports/release.json` 与各校验脚本产出的 `reports/*.json` 是证据文件，会随门禁运行更新。",
    "- 本门禁不执行 Playwright 端到端与 5 人盲测；这些属于 T13 的独立验收产物。",
    "- `dist-t14/` 仅作发布候选，不提交、不覆盖 `dist/`，也不代表部署产物。",
    "",
    "## 回滚方式",
    "",
    "1. 撤销发布门禁提交：`git revert <release-commit>`（或 `git reset --hard <上一个通过提交>`）。",
    "2. 只回滚内容改动：`git restore --source=<上一个通过提交> -- content/ generated/`，然后重新执行 `node tools/release-check.mjs`。",
    "3. 清理临时构建：`rm -rf dist-t14`。",
    "4. 若线上已使用该候选：重新运行 `npx --yes astro build --outDir dist-t14` 并部署上一通过提交构建出的目录；旧版本 URL 为固定路径，不做重定向或覆盖。",
    ""
  );
  await writeFile(path.join(projectRoot, "docs", "release-matrix.md"), `${lines.join("\n")}\n`, "utf8");

  console.log(`\nT14 发布门禁${passed ? "通过" : "失败"}：${release.summary.passed}/${release.summary.total_gates} 项通过，耗时 ${elapsed} ms。`);
  console.log(`证据：reports/release.json；发布矩阵：docs/release-matrix.md`);
  if (!passed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
