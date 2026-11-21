import { createServer } from "node:http";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const DIST = join(ROOT, "dist");
const OUT = join(ROOT, "reports", "visual");
const BASE = "/agnes-prompt-gallery";
const PORT = Number(process.env.VISUAL_PORT || 4390);
const ORIGIN = `http://127.0.0.1:${PORT}`;

const PAGES = [
  { slug: "home", path: "/", kind: "home" },
  { slug: "case-475", path: "/cases/case-475/", kind: "case" },
  { slug: "case-23", path: "/cases/case-23/", kind: "case" },
  { slug: "case-512", path: "/cases/case-512/", kind: "case" },
  { slug: "categories", path: "/categories/", kind: "listing" },
  { slug: "category-subject-form", path: "/categories/subject-form/", kind: "listing" },
  { slug: "experiments", path: "/experiments/", kind: "evidence" },
  { slug: "methods", path: "/methods/", kind: "method" }
];

const VIEWPORTS = [
  { name: "390x844", width: 390, height: 844, mobile: true },
  { name: "1440x900", width: 1440, height: 900, mobile: false }
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
  ".ico": "image/x-icon",
  ".xml": "application/xml; charset=utf-8"
};

function startServer() {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, ORIGIN);
      const pathname = decodeURIComponent(url.pathname);
      if (!pathname.startsWith(BASE)) {
        res.writeHead(404, { "content-type": "text/plain" });
        res.end("not found");
        return;
      }
      const relative = pathname.slice(BASE.length) || "/";
      let filePath = join(DIST, normalize(relative).replace(/^(\.\.[/\\])+/, ""));
      try {
        const info = await stat(filePath);
        if (info.isDirectory()) filePath = join(filePath, "index.html");
      } catch {
        if (!extname(filePath)) filePath = `${filePath.replace(/\/$/, "")}/index.html`;
      }
      const body = await readFile(filePath);
      res.writeHead(200, {
        "content-type": MIME[extname(filePath)] || "application/octet-stream",
        "cache-control": "no-store"
      });
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

async function autoScroll(page) {
  await page.evaluate(async () => {
    const step = Math.max(240, Math.floor(window.innerHeight * 0.75));
    const limit = document.documentElement.scrollHeight;
    for (let y = 0; y < limit; y += step) {
      window.scrollTo(0, y);
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
    window.scrollTo(0, 0);
    await new Promise((resolve) => setTimeout(resolve, 150));
  });
  await page.waitForFunction(
    () => [...document.images].every((image) => image.complete),
    undefined,
    { timeout: 20000 }
  ).catch(() => {});
}

async function snapshot(page, viewport, slug) {
  const prefix = join(OUT, `${slug}-${viewport.name}`);
  await page.screenshot({ path: `${prefix}-fold.png` });
  await page.screenshot({ path: `${prefix}.png`, fullPage: true });
  return [`reports/visual/${slug}-${viewport.name}-fold.png`, `reports/visual/${slug}-${viewport.name}.png`];
}

async function measure(page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    return {
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
      innerWidth: window.innerWidth
    };
  });
}

async function checkImages(page, errors) {
  const broken = await page.$$eval("img", (images) => images
    .filter((image) => !image.closest("details:not([open])"))
    .filter((image) => !image.closest("[hidden]"))
    .filter((image) => {
      const style = getComputedStyle(image);
      const rect = image.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden"
        && image.offsetParent !== null && rect.width > 0 && rect.height > 0;
    })
    .filter((image) => !image.complete || image.naturalWidth === 0)
    .map((image) => ({ src: image.currentSrc || image.src, alt: image.alt })));
  if (broken.length > 0) errors.push(`图片 naturalWidth=0：${JSON.stringify(broken.slice(0, 6))}`);
}

async function checkShell(page, viewport, kind, errors) {
  const shell = await page.evaluate(() => {
    const tabbar = document.querySelector(".tabbar");
    const topbar = document.querySelector(".topbar");
    const segmented = document.querySelector(".segmented");
    const desktopNav = document.querySelector(".desktop-nav");
    const bodyPadding = Number.parseFloat(getComputedStyle(document.body).paddingBottom) || 0;
    const visible = (el) => {
      if (!el) return false;
      const style = getComputedStyle(el);
      return style.display !== "none" && style.visibility !== "hidden";
    };
    return {
      tabVisible: visible(tabbar),
      tabHeight: tabbar ? Math.round(tabbar.getBoundingClientRect().height) : 0,
      topbarVisible: visible(topbar),
      segmentedVisible: visible(segmented),
      desktopNavVisible: visible(desktopNav),
      bodyPadding: Math.round(bodyPadding)
    };
  });
  if (!shell.topbarVisible) errors.push("顶部 App Bar 不可见");
  if (viewport.mobile) {
    if (!shell.tabVisible) errors.push("移动端缺少底部 Tab Bar");
    if (kind === "home" && !shell.segmentedVisible) errors.push("移动端首页缺少精选/全部分段");
    if (shell.bodyPadding + 1 < shell.tabHeight) {
      errors.push(`底部 Tab Bar 遮挡正文：bodyPadding=${shell.bodyPadding} < tabHeight=${shell.tabHeight}`);
    }
  } else {
    if (shell.tabVisible) errors.push("桌面端不应显示底部 Tab Bar");
    if (!shell.desktopNavVisible) errors.push("桌面端缺少横向导航");
  }
}

async function checkHomeModes(page, viewport, errors, slug) {
  if (!viewport.mobile) return;
  const all = page.locator('[data-home-mode-value="all"]').first();
  const featured = page.locator('[data-home-mode-value="featured"]').first();
  if ((await all.count()) === 0) {
    errors.push("首页缺少“全部”分段");
    return;
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await all.click();
  await page.waitForTimeout(300);
  const state = await page.evaluate(() => {
    const allPanel = document.querySelector('[data-home-mode-panel="all"]');
    const featuredPanel = document.querySelector('[data-home-mode-panel="featured"]');
    return {
      allVisible: allPanel ? getComputedStyle(allPanel).display !== "none" : false,
      featuredHidden: featuredPanel ? getComputedStyle(featuredPanel).display === "none" : false
    };
  });
  if (!state.allVisible || !state.featuredHidden) errors.push("“全部”分段未切换内容");
  await page.screenshot({ path: join(OUT, `${slug}-${viewport.name}-all.png`) });
  await featured.click();
  await page.waitForTimeout(200);
}

async function checkSearch(page, errors) {
  const hasSearch = await page.evaluate(() => Boolean(document.querySelector(".discovery-search-shell")));
  if (!hasSearch) return;
  const before = await page.evaluate(() => {
    const shell = document.querySelector(".discovery-search-shell");
    const results = document.querySelector(".discovery-results");
    return {
      position: getComputedStyle(shell).position,
      shellBottom: shell.getBoundingClientRect().bottom + window.scrollY,
      resultsTop: results ? results.getBoundingClientRect().top + window.scrollY : null
    };
  });
  if (before.position === "fixed" || before.position === "absolute") {
    errors.push(`搜索区浮层化：position=${before.position}`);
  }
  if (before.resultsTop !== null && before.resultsTop + 1 < before.shellBottom) {
    errors.push("搜索结果与搜索区重叠");
  }
  const input = page.locator("[data-discovery-query]").first();
  await input.scrollIntoViewIfNeeded();
  await input.fill("企鹅 结构板");
  await page.waitForTimeout(450);
  const after = await page.evaluate(() => {
    const shell = document.querySelector(".discovery-search-shell");
    const results = document.querySelector(".discovery-results");
    return {
      gap: Math.round(results.getBoundingClientRect().top - shell.getBoundingClientRect().bottom)
    };
  });
  if (after.gap < -1) errors.push(`搜索输入后结果压住搜索区：gap=${after.gap}`);
  await page.waitForTimeout(300);
  await checkImages(page, errors);
}

async function checkCaseMobile(page, viewport, errors, slug) {
  const firstScreen = await page.evaluate(() => {
    const cover = document.querySelector("[data-hero-item='cover']");
    const image = document.querySelector(".case-cover img");
    const heading = document.querySelector("h1");
    const coverRect = cover ? cover.getBoundingClientRect() : null;
    return {
      coverTop: coverRect ? Math.round(coverRect.top) : null,
      coverWidth: coverRect ? Math.round(coverRect.width) : 0,
      naturalWidth: image ? image.naturalWidth : 0,
      headingTop: heading ? Math.round(heading.getBoundingClientRect().top) : null,
      innerWidth: window.innerWidth
    };
  });
  if (firstScreen.naturalWidth <= 0) errors.push("首屏封面未加载：naturalWidth=0");
  if (firstScreen.coverTop === null || firstScreen.coverTop >= viewport.height) {
    errors.push(`首屏封面不可见：top=${firstScreen.coverTop}`);
  }
  if (firstScreen.headingTop === null || firstScreen.headingTop >= viewport.height) {
    errors.push(`首屏标题不可见：top=${firstScreen.headingTop}`);
  }
  if (firstScreen.coverWidth < firstScreen.innerWidth - 2) {
    errors.push(`封面非全宽：width=${firstScreen.coverWidth} < ${firstScreen.innerWidth}`);
  }

  for (const name of ["decisions", "evidence", "prompts"]) {
    await page.locator(`[data-case-tab="${name}"]`).first().click();
    await page.waitForTimeout(300);
    const state = await page.evaluate(() => {
      const pageEl = document.querySelector("[data-case-page]");
      const panels = [...document.querySelectorAll("[data-case-panel]")];
      const visible = panels.filter((panel) => getComputedStyle(panel).display !== "none");
      const archive = document.querySelector("[data-prompt-archive]");
      return {
        active: pageEl?.dataset.activePanel ?? null,
        visiblePanels: visible.map((panel) => panel.dataset.casePanel),
        archiveOpen: archive ? archive.open : null
      };
    });
    if (state.active !== name) errors.push(`分段未激活：期望 ${name}，实际 ${state.active}`);
    const visibleGroups = [...new Set(state.visiblePanels)];
    if (visibleGroups.length !== 1 || visibleGroups[0] !== name) {
      errors.push(`分段 ${name} 可见面板异常：${JSON.stringify(state.visiblePanels)}`);
    }
    if (name === "prompts" && !state.archiveOpen) errors.push("提示词面板未展开");
    if (slug === "case-475") {
      await page.screenshot({ path: join(OUT, `case-475-${viewport.name}-tab-${name}.png`) });
    }
  }

  const prompt = page.locator("details[data-prompt-version]").first();
  if ((await prompt.count()) === 0) {
    errors.push("提示词面板缺少版本");
  } else {
    await prompt.locator("summary").first().click();
    await page.waitForTimeout(200);
    if (!(await prompt.locator("pre").first().isVisible())) errors.push("提示词展开后正文不可见");
    await page.screenshot({ path: join(OUT, `${slug}-${viewport.name}-prompt.png`) });
    await prompt.locator("summary").first().click();
  }

  if ((await page.locator(".case-prompt-cta").count()) !== 0) {
    errors.push("仍存在 fixed 提示词按钮");
  }

  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(300);
  const bottom = await page.evaluate(() => {
    const tabbar = document.querySelector(".tabbar");
    const footer = document.querySelector(".site-footer");
    const panels = [...document.querySelectorAll("[data-case-panel]")]
      .filter((panel) => getComputedStyle(panel).display !== "none");
    const panel = panels[0] ?? null;
    const tabbarRect = tabbar ? tabbar.getBoundingClientRect() : null;
    return {
      tabbarTop: tabbarRect ? Math.round(tabbarRect.top) : null,
      panelBottom: panel ? Math.round(panel.getBoundingClientRect().bottom) : null,
      footerBottom: footer ? Math.round(footer.getBoundingClientRect().bottom) : null
    };
  });
  if (bottom.tabbarTop === null) {
    errors.push("底部 Tab Bar 缺失");
  } else {
    if (bottom.panelBottom !== null && bottom.panelBottom > bottom.tabbarTop + 1) {
      errors.push(`最后内容与固定底栏交叠：panelBottom=${bottom.panelBottom} > tabbarTop=${bottom.tabbarTop}`);
    }
    if (bottom.footerBottom !== null && bottom.footerBottom > bottom.tabbarTop + 1) {
      errors.push(`页脚与固定底栏交叠：footerBottom=${bottom.footerBottom} > tabbarTop=${bottom.tabbarTop}`);
    }
  }
}

async function checkCaseDesktop(page, viewport, errors, slug) {
  const layout = await page.evaluate(() => {
    const hero = document.querySelector(".case-hero");
    const cover = document.querySelector("[data-hero-item='cover']");
    const title = document.querySelector("[data-hero-item='title']");
    const coverRect = cover.getBoundingClientRect();
    const titleRect = title.getBoundingClientRect();
    return {
      heroDisplay: getComputedStyle(hero).display,
      coverLeft: Math.round(coverRect.left),
      coverRight: Math.round(coverRect.right),
      titleLeft: Math.round(titleRect.left),
      coverWidth: Math.round(coverRect.width)
    };
  });
  if (layout.heroDisplay !== "contents") errors.push("桌面案例页未进入两栏布局");
  if (!(layout.coverRight <= layout.titleLeft + 2)) {
    errors.push(`桌面案例页图片未在左栏：coverRight=${layout.coverRight} titleLeft=${layout.titleLeft}`);
  }
  if (layout.coverWidth > viewport.width * 0.55) errors.push("桌面左栏图片过宽");

  await page.evaluate(() => window.scrollTo(0, 1400));
  await page.waitForTimeout(400);
  const sticky = await page.evaluate(() => {
    const cover = document.querySelector("[data-hero-item='cover']");
    const rect = cover.getBoundingClientRect();
    return { top: Math.round(rect.top), bottom: Math.round(rect.bottom) };
  });
  if (sticky.top < 50 || sticky.top > 140) errors.push(`桌面图片未 sticky：top=${sticky.top}`);
  if (sticky.bottom < 200) errors.push("桌面 sticky 图片已滚出视口");

  await page.evaluate(() => window.scrollTo(0, 0));
  const summary = page.locator("[data-prompt-archive] > summary").first();
  await summary.click();
  await page.waitForTimeout(250);
  const archiveOpen = await page.locator("[data-prompt-archive]").first().evaluate((el) => el.open);
  if (!archiveOpen) errors.push("桌面提示词折叠面板无法展开");
  const prompt = page.locator("details[data-prompt-version]").first();
  await prompt.locator("summary").first().click();
  if (!(await prompt.evaluate((el) => el.open))) errors.push("桌面提示词版本无法展开");
  await page.screenshot({ path: join(OUT, `${slug}-${viewport.name}-prompt.png`) });
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const server = await startServer();
  const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const results = [];
  try {
    for (const viewport of VIEWPORTS) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: 1,
        isMobile: viewport.mobile,
        hasTouch: viewport.mobile
      });
      const page = await context.newPage();
      for (const def of PAGES) {
        const errors = [];
        const shots = [];
        try {
          await page.goto(`${ORIGIN}${BASE}${def.path}`, { waitUntil: "load" });
          await page.waitForTimeout(400);
          await page.evaluate(() => {
            for (const image of document.images) image.loading = "eager";
          });
          await autoScroll(page);
          await page.waitForTimeout(200);

          const metrics = await measure(page);
          if (metrics.scrollWidth > viewport.width) {
            errors.push(`横向溢出：scrollWidth=${metrics.scrollWidth} > ${viewport.width}`);
          }
          await checkImages(page, errors);
          await checkShell(page, viewport, def.kind, errors);

          await page.evaluate(() => window.scrollTo(0, 0));
          await page.waitForTimeout(200);
          shots.push(...await snapshot(page, viewport, def.slug));

          if (def.kind === "home") {
            await checkHomeModes(page, viewport, errors, def.slug);
          }
          if (def.kind === "home" || def.kind === "listing") {
            await checkSearch(page, errors);
          }
          if (def.kind === "case") {
            await page.evaluate(() => window.scrollTo(0, 0));
            if (viewport.mobile) await checkCaseMobile(page, viewport, errors, def.slug);
            else await checkCaseDesktop(page, viewport, errors, def.slug);
          }
        } catch (error) {
          errors.push(`执行异常：${error.message}`);
        }
        results.push({
          slug: def.slug,
          viewport: viewport.name,
          path: `${BASE}${def.path}`,
          screenshots: shots,
          pass: errors.length === 0,
          errors
        });
        console.log(`${errors.length === 0 ? "PASS" : "FAIL"} ${viewport.name} ${def.slug}${errors.length ? ` :: ${errors.join(" | ")}` : ""}`);
      }
      await context.close();
    }
    const summary = {
      generatedAt: new Date().toISOString(),
      base: `${ORIGIN}${BASE}`,
      viewports: VIEWPORTS.map(({ name, width, height }) => ({ name, width, height })),
      pages: results.length,
      passed: results.filter((item) => item.pass).length,
      failed: results.filter((item) => !item.pass).length,
      pass: results.every((item) => item.pass),
      results
    };
    await writeFile(join(OUT, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
    console.log(JSON.stringify({ pages: summary.pages, passed: summary.passed, failed: summary.failed }, null, 2));
    process.exitCode = summary.pass ? 0 : 1;
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
