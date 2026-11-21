import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSearchIndex } from "../src/lib/search/engine.js";

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const outputPath = "generated/search-index.json";
const inputPaths = {
  cases: "content/cases.json",
  classifications: "content/classifications.json",
  fingerprints: "content/fingerprints.json",
  intents: "content/intents.json",
  synonyms: "content/synonyms.json",
  taxonomy: "content/taxonomy.json"
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function serialize(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export async function buildDataset() {
  const entries = await Promise.all(Object.entries(inputPaths).map(async ([name, relativePath]) => {
    const text = await readFile(path.join(projectRoot, relativePath), "utf8");
    return [name, { text, value: JSON.parse(text) }];
  }));
  const inputs = Object.fromEntries(entries);
  const sourceSha256 = Object.fromEntries(entries.map(([name, item]) => [name, createHash("sha256").update(item.text).digest("hex")]));
  return buildSearchIndex({
    cases: inputs.cases.value,
    classifications: inputs.classifications.value,
    fingerprints: inputs.fingerprints.value,
    intents: inputs.intents.value,
    synonyms: inputs.synonyms.value,
    taxonomy: inputs.taxonomy.value,
    sourceSha256
  });
}

async function main() {
  const args = process.argv.slice(2);
  assert(args.length === 0 || (args.length === 1 && args[0] === "--check"), "用法：node tools/build-search-index.mjs [--check]");
  const checkMode = args[0] === "--check";
  const index = await buildDataset();
  const expected = serialize(index);
  const destination = path.join(projectRoot, outputPath);
  if (checkMode) {
    let actual;
    try {
      actual = await readFile(destination, "utf8");
    } catch (error) {
      throw new Error(`无法读取 ${outputPath}：${error.message}`);
    }
    assert(actual === expected, `${outputPath} 与输入数据不一致，请重新运行 node tools/build-search-index.mjs`);
  } else await writeFile(destination, expected, "utf8");
  const documents = Object.keys(index.documents).length;
  const postings = Object.fromEntries(Object.entries(index.inverted).map(([kind, values]) => [kind, Object.keys(values).length]));
  console.log(`${checkMode ? "索引一致性检查通过" : "静态检索索引生成完成"}：${documents} 个案例，结构/意图/文本倒排项 ${postings.structure}/${postings.intent}/${postings.text}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
