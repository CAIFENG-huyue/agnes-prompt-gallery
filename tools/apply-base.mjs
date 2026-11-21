import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const DIST = path.resolve(process.argv[2] ?? "dist");
const RAW = (process.env.BASE_PATH ?? "").trim();
const PREFIX = RAW && RAW !== "/" ? `/${RAW.replace(/^\/+|\/+$/g, "")}` : "";

if (!PREFIX) {
  console.log("apply-base: BASE_PATH 未设置，跳过");
  process.exit(0);
}

const ROOTS = ["assets", "cases", "categories", "methods", "experiments"];

function rewriteText(text) {
  let out = text;
  for (const root of ROOTS) {
    out = out.replaceAll(`"/${root}/`, `"${PREFIX}/${root}/`);
    out = out.replaceAll(`'/${root}/`, `'${PREFIX}/${root}/`);
    out = out.replaceAll(`(/${root}/`, `(${PREFIX}/${root}/`);
  }
  out = out.replaceAll('href="/"', `href="${PREFIX}/"`);
  out = out.replaceAll('action="/"', `action="${PREFIX}/"`);
  return out;
}

function rewriteHtml(text) {
  const out = rewriteText(text);
  const bare = PREFIX.replace(/^\//, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const attr = new RegExp(`(\\b(?:href|src|action|poster)=")\\/(?!\\/|${bare}/)`, "g");
  return out.replace(attr, `$1${PREFIX}/`);
}

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  let changed = 0;
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      changed += await walk(full);
      continue;
    }
    const ext = path.extname(entry.name);
    if (![".html", ".js", ".json", ".xml"].includes(ext)) continue;
    if (entry.name === "sitemap.xml") continue;
    const before = await readFile(full, "utf8");
    const after = ext === ".html" ? rewriteHtml(before) : rewriteText(before);
    if (after !== before) {
      await writeFile(full, after, "utf8");
      changed += 1;
    }
  }
  return changed;
}

const changed = await walk(DIST);
const sample = PREFIX;
console.log(`apply-base: 前缀 ${sample}，改写 ${changed} 个文件`);
