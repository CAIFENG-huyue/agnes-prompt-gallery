import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const DIST = join(ROOT, "dist-e2e");
const OUT_DIR = join(ROOT, "reports");
const SHOT_DIR = join(OUT_DIR, "visual");
const PORT = Number(process.env.E2E_PORT || 4321);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const MOBILE = { width: 390, height: 844 };
const DESKTOP = { width: 1440, height: 900 };

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
  console.log(`[build] dist-e2e：${result.stdout.match(/(\d+)\s+page\(s\) built/u)?.[1] ?? "?"} page(s)`);
}

async function measureOverflow(page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const overflow = [];
    for (const element of document.querySelectorAll("body *")) {
      const rect = element.getBoundingClientRect();
      if (rect.width > 0 && rect.right > window.innerWidth + 0.5) {
        const style = getComputedStyle(element);
        if (style.position === "fixed" || style.position === "absolute") continue;
        overflow.push({
          tag: element.tagName.toLowerCase(),
          cls: typeof element.className === "string" ? element.className.slice(0, 60) : "",
          right: Math.round(rect.right)
        });
        if (overflow.length >= 5) break;
      }
    }
    return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth, overflow };
  });
}

async function waitForImages(page, selector) {
  await page.waitForFunction((query) => {
    const images = [...document.querySelectorAll(query)];
    return images.length > 0 && images.every((image) => image.complete);
  }, selector, { timeout: 15000 }).catch(() => {});
}

async function homeChecks(page, errors) {
  await page.goto(`${ORIGIN}/`, { waitUntil: "load" });
  await page.waitForTimeout(250);
  const overflow = await measureOverflow(page);
  if (overflow.scrollWidth > MOBILE.width) {
    errors.push(`首页横向溢出 ${overflow.scrollWidth} > ${MOBILE.width}：${JSON.stringify(overflow.overflow)}`);
  }

  const filter = await page.evaluate(() => {
    const selects = [...document.querySelectorAll("[data-filter-bar] select")];
    return selects.map((select) => {
      const rect = select.getBoundingClientRect();
      return { name: select.dataset.filter, top: Math.round(rect.top), height: Math.round(rect.height) };
    });
  });
  if (filter.length !== 3 || filter.some((item) => item.height === 0 || item.top >= MOBILE.height)) {
    errors.push(`筛选项不可见或不完整：${JSON.stringify(filter)}`);
  }

  await waitForImages(page, ".case-card__media img");
  const cards = await page.evaluate((viewportHeight) => {
    const list = [...document.querySelectorAll(".case-card")].filter((card) => !card.hidden);
    const visible = list.filter((card) => {
      const rect = card.getBoundingClientRect();
      return rect.top < viewportHeight && rect.bottom > 0;
    });
    return {
      rendered: list.length,
      visible: visible.length,
      images: visible.map((card) => {
        const image = card.querySelector("img");
        return image
          ? { src: image.getAttribute("src"), naturalWidth: image.naturalWidth, complete: image.complete }
          : { src: null, naturalWidth: 0, complete: false };
      })
    };
  }, MOBILE.height);
  if (cards.rendered < 4 || cards.visible < 4) {
    errors.push(`首页首屏卡片不足 4 张：rendered=${cards.rendered} visible=${cards.visible}`);
  }
  if (cards.images.some((image) => !image.src || !image.src.startsWith("/results/"))) {
    errors.push(`首页卡片主图未指向 /results/：${JSON.stringify(cards.images)}`);
  }
  if (cards.images.some((image) => !image.complete || image.naturalWidth <= 0)) {
    errors.push(`首页卡片主图未加载：${JSON.stringify(cards.images)}`);
  }
  await page.screenshot({ path: join(SHOT_DIR, "casefirst-home-390x844.png") });
  return { cards, filter, scrollWidth: overflow.scrollWidth };
}

async function caseChecks(page, errors) {
  await page.goto(`${ORIGIN}/cases/case-23/`, { waitUntil: "load" });
  await page.waitForTimeout(250);
  const overflow = await measureOverflow(page);
  if (overflow.scrollWidth > MOBILE.width) {
    errors.push(`case-23 横向溢出 ${overflow.scrollWidth} > ${MOBILE.width}`);
  }
  const text = await page.evaluate(() => document.body.textContent ?? "");
  if (!text.includes("本站生成")) errors.push("case-23 缺少「本站生成」");
  if (!text.includes("开源项目原图")) errors.push("case-23 缺少「开源项目原图」");
  if (!text.includes("freestylefly/awesome-gpt-image-2")) errors.push("case-23 未写明开源项目名");
  const gateLinks = await page.locator(".related li a").count();
  if (gateLinks < 5) errors.push(`case-23 同门槛案例链接不足 5 条：${gateLinks}`);
  const generated = await page.evaluate(() => {
    const image = document.querySelector(".gen-figure img");
    return image ? { naturalWidth: image.naturalWidth, complete: image.complete } : null;
  });
  if (!generated || generated.naturalWidth <= 0) errors.push(`case-23 本站生成图未加载：${JSON.stringify(generated)}`);
  await page.screenshot({ path: join(SHOT_DIR, "casefirst-case-23-390x844.png") });
  return { gateLinks, generated, scrollWidth: overflow.scrollWidth };
}

async function patternsChecks(page, errors, patterns) {
  await page.goto(`${ORIGIN}/patterns/`, { waitUntil: "load" });
  await page.waitForTimeout(200);
  const overflow = await measureOverflow(page);
  if (overflow.scrollWidth > MOBILE.width) {
    errors.push(`规律页横向溢出 ${overflow.scrollWidth} > ${MOBILE.width}`);
  }
  const rows = await page.evaluate(() => {
    const tables = [...document.querySelectorAll(".data-table")];
    const text = (table) => [...table.querySelectorAll("tbody tr")].map((row) => row.innerText.replace(/\s+/g, " ").trim());
    return { category: tables[0] ? text(tables[0]) : [], gate: tables[1] ? text(tables[1]) : [] };
  });

  const category = patterns.categories.find((item) => item.category === "information-diagram");
  const gate = patterns.gates.find((item) => item.gate === "TEXT_WRONG");
  const categoryRow = rows.category.find((row) => row.includes("information-diagram")) ?? "";
  const gateRow = rows.gate.find((row) => row.includes("TEXT_WRONG")) ?? "";
  if (!categoryRow.includes(`${category.pass} / ${category.n}`) || !categoryRow.includes(`${category.pass_rate.toFixed(1)}%`)) {
    errors.push(`规律页分类数字不一致：期望 ${category.pass}/${category.n} ${category.pass_rate}%，实际「${categoryRow}」`);
  }
  if (!gateRow.includes(String(gate.n))) {
    errors.push(`规律页门槛频次不一致：期望 ${gate.gate}=${gate.n}，实际「${gateRow}」`);
  }
  await page.screenshot({ path: join(SHOT_DIR, "casefirst-patterns-390x844.png") });
  return {
    sampled: {
      category: { expected: { pass: category.pass, n: category.n, rate: category.pass_rate }, row: categoryRow },
      gate: { expected: { gate: gate.gate, n: gate.n }, row: gateRow }
    },
    scrollWidth: overflow.scrollWidth
  };
}

async function conclusionsChecks(page, errors) {
  await page.goto(`${ORIGIN}/conclusions/`, { waitUntil: "load" });
  await page.waitForTimeout(200);
  const overflow = await measureOverflow(page);
  if (overflow.scrollWidth > MOBILE.width) {
    errors.push(`结论页横向溢出 ${overflow.scrollWidth} > ${MOBILE.width}`);
  }
  const text = await page.evaluate(() => document.body.textContent ?? "");
  for (const required of ["已评审", "通过率", "未评审", "agnes-image-2.5-flash", "REVIEW"]) {
    if (!text.includes(required)) errors.push(`结论页缺少「${required}」`);
  }
  await page.screenshot({ path: join(SHOT_DIR, "casefirst-conclusions-390x844.png") });
  return { scrollWidth: overflow.scrollWidth };
}

async function desktopHomeChecks(page, errors) {
  await page.setViewportSize(DESKTOP);
  await page.goto(`${ORIGIN}/`, { waitUntil: "load" });
  await page.waitForTimeout(250);
  const overflow = await measureOverflow(page);
  if (overflow.scrollWidth > DESKTOP.width) {
    errors.push(`桌面首页横向溢出 ${overflow.scrollWidth} > ${DESKTOP.width}`);
  }
  const cards = await page.locator(".case-card:visible").count();
  if (cards < 4) errors.push(`桌面首页卡片不足 4 张：${cards}`);
  await page.screenshot({ path: join(SHOT_DIR, "casefirst-home-1440x900.png") });
  return { cards, scrollWidth: overflow.scrollWidth };
}

async function main() {
  await mkdir(SHOT_DIR, { recursive: true });
  buildSite();
  const patterns = JSON.parse(await readFile(join(ROOT, "content", "patterns.json"), "utf8"));
  const server = await startServer();
  const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const context = await browser.newContext({ viewport: MOBILE, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  const evidence = {};
  try {
    evidence.home = await homeChecks(page, errors);
    evidence.case23 = await caseChecks(page, errors);
    evidence.patterns = await patternsChecks(page, errors, patterns);
    evidence.conclusions = await conclusionsChecks(page, errors);
    evidence.desktopHome = await desktopHomeChecks(page, errors);
  } catch (error) {
    errors.push(`执行异常：${error instanceof Error ? error.message : String(error)}`);
  } finally {
    await browser.close();
    server.close();
    await rm(DIST, { recursive: true, force: true });
  }

  const report = {
    generatedAt: new Date().toISOString(),
    viewports: { mobile: MOBILE, desktop: DESKTOP },
    screenshots: [
      "reports/visual/casefirst-home-390x844.png",
      "reports/visual/casefirst-case-23-390x844.png",
      "reports/visual/casefirst-patterns-390x844.png",
      "reports/visual/casefirst-conclusions-390x844.png",
      "reports/visual/casefirst-home-1440x900.png"
    ],
    passed: errors.length === 0,
    errors,
    evidence
  };
  await writeFile(join(OUT_DIR, "casefirst-e2e.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ passed: report.passed, errors, evidence }, null, 2));
  if (!report.passed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
