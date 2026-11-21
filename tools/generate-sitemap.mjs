import { readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const DIST = path.resolve("dist");
const SITE = process.env.SITE_URL ?? "https://caifeng-huyue.github.io";

if (!existsSync(path.join(DIST, "index.html"))) {
  console.error("dist/index.html 不存在，请先执行 astro build");
  process.exit(1);
}

async function collect(dir, prefix = "") {
  const entries = await readdir(dir, { withFileTypes: true });
  const urls = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      urls.push(...(await collect(path.join(dir, entry.name), `${prefix}${entry.name}/`)));
    } else if (entry.name === "index.html") {
      urls.push(`${SITE}/${prefix}`);
    }
  }
  return urls;
}

const urls = (await collect(DIST)).sort();
const xml = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ...urls.map((url) => `  <url><loc>${url}</loc></url>`),
  "</urlset>",
  ""
].join("\n");

await writeFile(path.join(DIST, "sitemap.xml"), xml, "utf8");
await writeFile(
  path.join(DIST, "robots.txt"),
  `User-agent: *\nAllow: /\nSitemap: ${SITE}/sitemap.xml\n`,
  "utf8"
);

console.log(`sitemap.xml: ${urls.length} 条 URL`);
