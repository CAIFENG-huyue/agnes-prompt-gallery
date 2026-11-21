import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { readFile, stat, mkdir, rm, writeFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const DIST = join(ROOT, "dist-e2e");
const OUT_DIR = join(ROOT, "reports");
const SHOT_DIR = join(OUT_DIR, "e2e-360");
const PORT = Number(process.env.E2E_PORT || 4321);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const VIEWPORT = { width: 360, height: 800 };

const PAGES = [
  { slug: "home", path: "/", kind: "home" },
  { slug: "categories", path: "/categories/", kind: "listing" },
  { slug: "category-subject-form", path: "/categories/subject-form/", kind: "listing" },
  { slug: "category-scene-narrative", path: "/categories/scene-narrative/", kind: "listing" },
  { slug: "category-graphic-communication", path: "/categories/graphic-communication/", kind: "listing" },
  { slug: "category-information-diagram", path: "/categories/information-diagram/", kind: "listing" },
  { slug: "category-interface-document", path: "/categories/interface-document/", kind: "listing" },
  { slug: "case-23", path: "/cases/case-23/", kind: "case" },
  { slug: "case-371", path: "/cases/case-371/", kind: "case" },
  { slug: "case-2", path: "/cases/case-2/", kind: "case" },
  { slug: "experiments", path: "/experiments/", kind: "evidence" },
  { slug: "method-prose-contract-exact-text", path: "/methods/prose-contract-exact-text/", kind: "method" },
  { slug: "method-blank-band-deterministic-overlay", path: "/methods/blank-band-deterministic-overlay/", kind: "method" }
];

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon"
};

function startServer() {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, ORIGIN);
      let filePath = join(DIST, normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, ""));
      try {
        const info = await stat(filePath);
        if (info.isDirectory()) filePath = join(filePath, "index.html");
      } catch {
        if (!extname(filePath)) filePath = `${filePath.replace(/\/$/, "")}/index.html`;
      }
      const body = await readFile(filePath);
      res.writeHead(200, { "content-type": MIME[extname(filePath)] || "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
    }
  });
  return new Promise((resolveServer, reject) => {
    server.on("error", reject);
    server.listen(PORT, "127.0.0.1", () => resolveServer(server));
  });
}

async function firstScreenVisible(page, selector) {
  const handle = await page.$(selector);
  if (!handle) return { visible: false, reason: "missing element" };
  const box = await handle.boundingBox();
  if (!box || box.width === 0 || box.height === 0) return { visible: false, reason: "zero box" };
  return {
    visible: box.y < VIEWPORT.height && box.y + Math.min(box.height, 48) <= VIEWPORT.height,
    top: Math.round(box.y),
    height: Math.round(box.height)
  };
}

async function measure(page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const overflow = [];
    for (const el of document.querySelectorAll("body *")) {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.right > window.innerWidth + 0.5) {
        const style = getComputedStyle(el);
        if (style.position === "fixed" || style.position === "absolute") continue;
        overflow.push({
          tag: el.tagName.toLowerCase(),
          cls: typeof el.className === "string" ? el.className.slice(0, 80) : "",
          right: Math.round(rect.right),
          width: Math.round(rect.width)
        });
        if (overflow.length >= 8) break;
      }
    }
    return {
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
      bodyScrollWidth: document.body.scrollWidth,
      overflow
    };
  });
}

function fail(list, message) {
  list.push(message);
}

async function checkPage(page, def, shotDir) {
  const errors = [];
  await page.goto(`${ORIGIN}${def.path}`, { waitUntil: "load" });
  await page.waitForTimeout(300);

  const metrics = await measure(page);
  if (metrics.scrollWidth > VIEWPORT.width) {
    fail(errors, `横向溢出：scrollWidth=${metrics.scrollWidth} > 360${metrics.overflow.length ? `；溢出元素 ${JSON.stringify(metrics.overflow)}` : ""}`);
  }
  if (metrics.clientWidth !== VIEWPORT.width) {
    fail(errors, `视口宽度异常：clientWidth=${metrics.clientWidth}，期望 360`);
  }

  if (def.kind === "case") {
    const checks = [
      ["标题", "h1"],
      ["通俗分类", "[data-hero-item='category']"],
      ["适合/不适合", "[data-hero-item='fit']"],
      ["证据级别", "[data-hero-item='evidence'] .evidence-badge"]
    ];
    for (const [label, selector] of checks) {
      const result = await firstScreenVisible(page, selector);
      if (!result.visible) fail(errors, `首屏不可见：${label}（${result.reason ?? `top=${result.top}`}）`);
    }

    const promptDetails = page.locator("details[data-prompt-version]").first();
    if ((await promptDetails.count()) === 0) {
      fail(errors, "缺少提示词折叠块");
    } else {
      const summary = promptDetails.locator("summary").first();
      await summary.click();
      if (!(await promptDetails.evaluate((el) => el.open))) fail(errors, "提示词展开失败");
      await summary.click();
      if (await promptDetails.evaluate((el) => el.open)) fail(errors, "提示词收起失败");
    }
  }

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(150);
  await page.screenshot({ path: join(shotDir, `${def.slug}-fold.png`) });
  await page.screenshot({ path: join(shotDir, `${def.slug}.png`), fullPage: true });

  return {
    slug: def.slug,
    path: def.path,
    kind: def.kind,
    scrollWidth: metrics.scrollWidth,
    clientWidth: metrics.clientWidth,
    pass: errors.length === 0,
    errors,
    screenshot: `reports/e2e-360/${def.slug}.png`,
    foldScreenshot: `reports/e2e-360/${def.slug}-fold.png`
  };
}

async function collectLinks(page, defs) {
  const links = new Set();
  for (const def of defs) {
    await page.goto(`${ORIGIN}${def.path}`, { waitUntil: "load" });
    const hrefs = await page.$$eval("a[href]", (anchors) => anchors.map((a) => a.getAttribute("href")));
    for (const href of hrefs) {
      if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) continue;
      const resolved = new URL(href, `${ORIGIN}${def.path}`);
      if (resolved.origin !== ORIGIN) continue;
      links.add(resolved.pathname + resolved.search);
    }
  }
  return [...links].sort();
}

function buildSite() {
  const result = spawnSync("npx", ["--yes", "astro", "build", "--outDir", "dist-e2e"], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 600000,
    maxBuffer: 64 * 1024 * 1024
  });
  if (result.status !== 0) {
    throw new Error(`astro build 失败（exit ${result.status}）：\n${result.stderr || result.stdout}`);
  }
  const pages = result.stdout.match(/(\d+)\s+page\(s\) built/u)?.[1];
  console.log(`[build] dist-e2e：${pages ?? "?"} page(s)`);
}

async function main() {
  await mkdir(SHOT_DIR, { recursive: true });
  try {
    buildSite();
  } catch (error) {
    await rm(DIST, { recursive: true, force: true });
    throw error;
  }
  const server = await startServer();
  const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const results = [];
  try {
    for (const def of PAGES) {
      try {
        results.push(await checkPage(page, def, SHOT_DIR));
      } catch (error) {
        results.push({
          slug: def.slug,
          path: def.path,
          kind: def.kind,
          scrollWidth: null,
          pass: false,
          errors: [`执行异常：${error.message}`]
        });
      }
    }

    const allLinks = await collectLinks(page, PAGES);
    const step = Math.max(1, Math.floor(allLinks.length / 50));
    const sampled = [];
    for (let i = 0; i < allLinks.length && sampled.length < 50; i += step) sampled.push(allLinks[i]);
    for (let i = 0; i < allLinks.length && sampled.length < 50; i += 1) sampled.push(allLinks[i]);
    const uniqueSampled = [...new Set(sampled)].slice(0, 50);

    const linkChecks = [];
    for (const link of uniqueSampled) {
      const response = await context.request.get(`${ORIGIN}${link}`, { maxRedirects: 3 });
      linkChecks.push({ path: link, status: response.status(), pass: response.status() === 200 });
    }

    const linkFailures = linkChecks.filter((item) => !item.pass);
    const failed = results.filter((item) => !item.pass);
    const widths = results.map((item) => item.scrollWidth).filter((value) => typeof value === "number");
    const report = {
      generatedAt: new Date().toISOString(),
      viewport: VIEWPORT,
      baseUrl: ORIGIN,
      build: "dist-e2e",
      summary: {
        pages: results.length,
        passed: results.length - failed.length,
        failed: failed.length,
        linksChecked: linkChecks.length,
        linkFailures: linkFailures.length,
        maxScrollWidth: Math.max(...widths),
        pass: failed.length === 0 && linkFailures.length === 0
      },
      pages: results,
      links: {
        discovered: allLinks.length,
        checked: linkChecks.length,
        failures: linkFailures,
        items: linkChecks
      }
    };
    await writeFile(join(OUT_DIR, "e2e.json"), `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report.summary, null, 2));
    for (const item of results) {
      console.log(`${item.pass ? "PASS" : "FAIL"} ${item.path} scrollWidth=${item.scrollWidth}${item.errors.length ? ` :: ${item.errors.join(" | ")}` : ""}`);
    }
    if (linkFailures.length) console.log("LINK FAILURES", linkFailures);
    process.exitCode = report.summary.pass ? 0 : 1;
  } finally {
    await browser.close();
    server.close();
    await rm(DIST, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
