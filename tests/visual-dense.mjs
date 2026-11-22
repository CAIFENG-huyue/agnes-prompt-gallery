import { createServer } from "node:http";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const DIST = join(ROOT, "dist-dense");
const SHOT_DIR = join(ROOT, "reports", "visual");
const PORT = Number(process.env.DENSE_PORT || 4331);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const MOBILE = { width: 390, height: 844 };
const DESKTOP = { width: 1440, height: 900 };

const PAGES = [
  { slug: "home", path: "/", kind: "home" },
  { slug: "case-23", path: "/cases/case-23/", kind: "case" },
  { slug: "case-371", path: "/cases/case-371/", kind: "case" },
  { slug: "categories", path: "/categories/", kind: "page" },
  { slug: "category-subject-form", path: "/categories/subject-form/", kind: "page" },
  { slug: "experiments", path: "/experiments/", kind: "page" },
  { slug: "methods", path: "/methods/", kind: "page" },
  { slug: "method-prose-contract-exact-text", path: "/methods/prose-contract-exact-text/", kind: "page" }
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

async function settle(page) {
  await page.evaluate(async () => {
    const step = Math.max(240, Math.floor(window.innerHeight * 0.75));
    for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 40));
    }
    window.scrollTo(0, 0);
    await new Promise((r) => setTimeout(r, 80));
  });
  await page.waitForFunction(
    () => [...document.images].every((image) => image.complete),
    undefined,
    { timeout: 15000 }
  ).catch(() => {});
}

async function measurePage(page, viewport) {
  return page.evaluate((vp) => {
    const broken = [...document.images]
      .filter((image) => image.getBoundingClientRect().width > 0 || image.offsetParent !== null)
      .filter((image) => image.complete && image.naturalWidth === 0)
      .map((image) => image.currentSrc || image.src);
    const steps = document.querySelector(".home-steps");
    const cards = [...document.querySelectorAll(".discovery-card")].map((card) => {
      const box = card.getBoundingClientRect();
      return { top: Math.round(box.top), bottom: Math.round(box.bottom), height: Math.round(box.height) };
    });
    const cover = document.querySelector(".case-cover");
    const coverImage = document.querySelector(".case-cover img");
    const heading = document.querySelector("h1");
    const evidence = document.querySelector("[data-hero-item='evidence']");
    const badge = document.querySelector("[data-hero-item='evidence'] .evidence-badge");
    const boxOf = (el) => {
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      return { top: Math.round(rect.top), bottom: Math.round(rect.bottom), height: Math.round(rect.height), width: Math.round(rect.width) };
    };
    return {
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      bodyText: document.body.innerText,
      broken,
      viewport: vp,
      stepsDisplay: steps ? getComputedStyle(steps).display : null,
      cards,
      cover: boxOf(cover),
      coverNaturalWidth: coverImage ? coverImage.naturalWidth : 0,
      headingFontSize: heading ? Number.parseFloat(getComputedStyle(heading).fontSize) : null,
      heading: boxOf(heading),
      evidence: boxOf(evidence),
      badge: boxOf(badge)
    };
  }, viewport);
}

async function main() {
  await mkdir(SHOT_DIR, { recursive: true });
  const server = await startServer();
  const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const report = { generatedAt: new Date().toISOString(), checks: [], pages: [], failures: [] };

  const context = await browser.newContext({ viewport: MOBILE, deviceScaleFactor: 1 });
  const page = await context.newPage();

  for (const def of PAGES) {
    const errors = [];
    await page.goto(`${ORIGIN}${def.path}`, { waitUntil: "load" });
    await page.waitForTimeout(250);
    await settle(page);
    const m = await measurePage(page, MOBILE);

    if (m.scrollWidth > MOBILE.width) errors.push(`横向滚动 scrollWidth=${m.scrollWidth}`);
    if (m.broken.length) errors.push(`图片未加载：${m.broken.slice(0, 3).join(", ")}`);

    if (def.kind === "home") {
      const visibleCards = m.cards.filter((card) => card.top < MOBILE.height - 56);
      const fourInFirstScreen = m.cards.filter((card) => card.top < MOBILE.height && card.top + 40 < MOBILE.height);
      if (m.stepsDisplay !== "none") errors.push(`01/02/03 步骤卡仍显示：display=${m.stepsDisplay}`);
      if (/说任务/.test(m.bodyText) || /看匹配/.test(m.bodyText)) errors.push("body.innerText 仍含步骤卡文案");
      if (fourInFirstScreen.length < 4) errors.push(`首屏案例卡不足 4 张：${fourInFirstScreen.length}`);
      report.checks.push({
        id: "home-first-screen",
        pass: errors.length === 0,
        visibleCards: visibleCards.length,
        fourInFirstScreen: fourInFirstScreen.length,
        scrollWidth: m.scrollWidth,
        cards: m.cards.slice(0, 6)
      });
    }

    if (def.kind === "case") {
      if (!m.cover) errors.push("缺少封面");
      else {
        if (m.cover.height > 240) errors.push(`封面高度 ${m.cover.height} > 240`);
        if (m.cover.top >= MOBILE.height) errors.push("首屏看不到封面");
      }
      if (m.coverNaturalWidth <= 0) errors.push("封面 naturalWidth=0");
      if (m.headingFontSize && m.headingFontSize > 24) errors.push(`标题字号 ${m.headingFontSize} > 24`);
      if (!m.heading || m.heading.top >= MOBILE.height) errors.push("首屏看不到标题");
      if (!m.badge || m.badge.top >= MOBILE.height) errors.push("首屏看不到证据级别");
      report.checks.push({
        id: `case-first-screen-${def.slug}`,
        pass: errors.length === 0,
        coverHeight: m.cover?.height ?? null,
        coverNaturalWidth: m.coverNaturalWidth,
        headingFontSize: m.headingFontSize,
        evidenceVisible: Boolean(m.badge && m.badge.top < MOBILE.height)
      });
    }

    await page.screenshot({ path: join(SHOT_DIR, `dense-${def.slug}-390.png`) });
    await page.screenshot({ path: join(SHOT_DIR, `dense-${def.slug}-390-full.png`), fullPage: true });

    report.pages.push({
      slug: def.slug,
      path: def.path,
      pass: errors.length === 0,
      scrollWidth: m.scrollWidth,
      errors
    });
    if (errors.length) report.failures.push({ slug: def.slug, errors });
  }

  // Desktop structure regression: two-column sticky case page + visible steps on home.
  const desktopContext = await browser.newContext({ viewport: DESKTOP, deviceScaleFactor: 1 });
  const desktopPage = await desktopContext.newPage();
  await desktopPage.goto(`${ORIGIN}/cases/case-23/`, { waitUntil: "load" });
  await desktopPage.waitForTimeout(300);
  const desktopCase = await desktopPage.evaluate(() => {
    const pageEl = document.querySelector("[data-case-page]");
    const cover = document.querySelector(".case-cover");
    const intro = document.querySelector("[data-hero-item='title']");
    const style = pageEl ? getComputedStyle(pageEl) : null;
    return {
      display: style?.display,
      columns: style?.gridTemplateColumns,
      coverPosition: cover ? getComputedStyle(cover).position : null,
      coverLeft: cover ? Math.round(cover.getBoundingClientRect().left) : null,
      introLeft: intro ? Math.round(intro.getBoundingClientRect().left) : null
    };
  });
  const desktopErrors = [];
  if (desktopCase.display !== "grid") desktopErrors.push(`案例页桌面不是双栏：display=${desktopCase.display}`);
  if (desktopCase.coverPosition !== "sticky") desktopErrors.push(`桌面封面未 sticky：${desktopCase.coverPosition}`);
  if (desktopCase.coverLeft === null || desktopCase.introLeft === null || desktopCase.coverLeft >= desktopCase.introLeft) {
    desktopErrors.push("桌面封面不在左栏");
  }
  await desktopPage.screenshot({ path: join(SHOT_DIR, "dense-case-1440.png") });
  await desktopPage.goto(`${ORIGIN}/`, { waitUntil: "load" });
  await desktopPage.waitForTimeout(300);
  const stepsVisible = await desktopPage.locator(".home-steps").isVisible();
  if (!stepsVisible) desktopErrors.push("桌面首页步骤卡被隐藏");
  await desktopPage.screenshot({ path: join(SHOT_DIR, "dense-home-1440.png") });

  report.desktop = { ...desktopCase, stepsVisible, pass: desktopErrors.length === 0, errors: desktopErrors };
  if (desktopErrors.length) report.failures.push({ slug: "desktop", errors: desktopErrors });

  await writeFile(join(ROOT, "reports", "visual", "dense-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({
    pages: report.pages.map((item) => `${item.pass ? "PASS" : "FAIL"} ${item.slug} sw=${item.scrollWidth}`),
    desktop: report.desktop.pass ? "PASS" : report.desktop.errors,
    failures: report.failures
  }, null, 2));

  await browser.close();
  server.close();
  process.exitCode = report.failures.length === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
