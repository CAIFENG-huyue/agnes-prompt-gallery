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
  const gateCopy = await page.evaluate(() => {
    const text = document.body.innerText;
    const pass = [...document.querySelectorAll('.case-card[data-verdict="pass"] .case-card__gates')][0];
    const fail = [...document.querySelectorAll('.case-card[data-verdict="fail"] .case-card__gates')][0];
    return {
      staleCopy: text.includes("无失败门槛"),
      passText: pass?.textContent?.trim() ?? "",
      passColor: pass ? getComputedStyle(pass).color : "",
      failText: fail?.textContent?.trim() ?? "",
      failColor: fail ? getComputedStyle(fail).color : ""
    };
  });
  if (gateCopy.staleCopy) errors.push("首页仍出现「无失败门槛」");
  if (gateCopy.passText !== "无门槛失败") errors.push(`PASS 卡门槛文案错误：${gateCopy.passText}`);
  if (gateCopy.failColor === gateCopy.passColor) errors.push(`FAIL/PASS 门槛颜色未区分：${JSON.stringify(gateCopy)}`);
  await page.screenshot({ path: join(SHOT_DIR, "casefirst-home-390x844.png") });
  return { cards, filter, gateCopy, scrollWidth: overflow.scrollWidth };
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

  const top = await page.evaluate((viewportHeight) => {
    const title = document.querySelector(".case-head h1");
    const meta = document.querySelector(".case-head__meta");
    const image = document.querySelector(".gen-figure img");
    if (!title || !meta || !image) return null;
    const titleRect = title.getBoundingClientRect();
    const imageRect = image.getBoundingClientRect();
    return {
      title: title.textContent?.trim(),
      meta: meta.textContent?.replace(/\s+/g, " ").trim(),
      titleTop: Math.round(titleRect.top),
      titleAboveImage: titleRect.bottom <= imageRect.top,
      titleVisible: titleRect.top >= 0 && titleRect.bottom <= viewportHeight
    };
  }, MOBILE.height);
  if (!top) {
    errors.push("case-23 首屏缺少标题或元信息");
  } else {
    if (!top.titleAboveImage) errors.push(`案例标题不在图片上方：${JSON.stringify(top)}`);
    if (!top.titleVisible) errors.push(`案例标题不在首屏：${JSON.stringify(top)}`);
    if (!(top.meta ?? "").includes("FAIL")) errors.push(`首屏元信息缺少判定：${top.meta}`);
  }
  await page.screenshot({ path: join(SHOT_DIR, "casefirst-case-23-top-390x844.png") });
  await page.screenshot({ path: join(SHOT_DIR, "casefirst-case-23-390x844.png") });

  const related = await page.evaluate(() => [...document.querySelectorAll(".related li a")]
    .map((anchor) => ({ href: anchor.getAttribute("href"), text: anchor.textContent?.trim() ?? "" }))
    .filter((item) => item.href));
  if (related.length < 5) errors.push(`case-23 同门槛案例链接不足 5 条：${related.length}`);
  if (related.some((item) => !item.href.startsWith("/cases/case-"))) errors.push(`同门槛链接地址异常：${JSON.stringify(related)}`);
  const firstHref = related[0]?.href;
  if (firstHref) {
    await page.locator(".related li a").first().click();
    await page.waitForTimeout(150);
    const navigated = new URL(page.url()).pathname;
    if (navigated !== firstHref) errors.push(`同门槛案例不可点：${firstHref} → ${navigated}`);
    await page.goBack({ waitUntil: "load" });
  }

  const generated = await page.evaluate(() => {
    const image = document.querySelector(".gen-figure img");
    return image ? { naturalWidth: image.naturalWidth, complete: image.complete } : null;
  });
  if (!generated || generated.naturalWidth <= 0) errors.push(`case-23 本站生成图未加载：${JSON.stringify(generated)}`);
  return { gateLinks: related.length, related, top, generated, scrollWidth: overflow.scrollWidth };
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

async function desktopCaseChecks(page, errors) {
  await page.setViewportSize(DESKTOP);
  await page.goto(`${ORIGIN}/cases/case-23/`, { waitUntil: "load" });
  await page.waitForTimeout(300);
  const layout = await page.evaluate(() => {
    const detail = document.querySelector(".case-detail");
    const compare = document.querySelector("[data-compare]");
    return {
      columns: detail ? getComputedStyle(detail).gridTemplateColumns.split(" ").filter(Boolean).length : 0,
      compareDisplay: compare ? getComputedStyle(compare).display : "missing"
    };
  });
  if (layout.columns !== 2) errors.push(`桌面案例页不再是两栏：${JSON.stringify(layout)}`);
  if (layout.compareDisplay === "none" || layout.compareDisplay === "missing") errors.push(`桌面拖动对比未显示：${JSON.stringify(layout)}`);

  const sync = await page.evaluate(() => {
    const range = document.querySelector("[data-compare-range]");
    const clip = document.querySelector("[data-compare-clip]");
    const divider = document.querySelector("[data-compare-divider]");
    const source = document.querySelector(".compare__stage > img");
    const generated = document.querySelector(".compare__clip img");
    if (!range || !clip || !divider || !source || !generated) return null;
    const setValue = (value) => {
      range.value = String(value);
      range.dispatchEvent(new Event("input", { bubbles: true }));
      return { clipPath: clip.style.clipPath, dividerLeft: divider.style.left };
    };
    const left = setValue(20);
    const right = setValue(80);
    setValue(50);
    return {
      left,
      right,
      sourceNatural: source.naturalWidth,
      generatedNatural: generated.naturalWidth
    };
  });
  if (!sync) {
    errors.push("桌面对比组件结构缺失");
  } else {
    if (!sync.left.clipPath.includes("80%") || sync.left.dividerLeft !== "20%") {
      errors.push(`拖到 20 时裁切未同步：${JSON.stringify(sync.left)}`);
    }
    if (!sync.right.clipPath.includes("20%") || sync.right.dividerLeft !== "80%") {
      errors.push(`拖到 80 时裁切未同步：${JSON.stringify(sync.right)}`);
    }
    if (sync.sourceNatural <= 0 || sync.generatedNatural <= 0) {
      errors.push(`对照图未加载：${JSON.stringify(sync)}`);
    }
  }

  await page.evaluate(() => {
    const block = document.querySelector(".source-block");
    if (block) {
      const top = block.getBoundingClientRect().top + window.scrollY;
      window.scrollTo(0, Math.max(0, top - 64));
    }
  });
  await page.waitForTimeout(250);
  const compareVisible = await page.evaluate(() => {
    const compare = document.querySelector("[data-compare]");
    if (!compare) return null;
    const rect = compare.getBoundingClientRect();
    return { top: Math.round(rect.top), bottom: Math.round(rect.bottom), inViewport: rect.top >= 0 && rect.top < window.innerHeight };
  });
  if (!compareVisible?.inViewport) errors.push(`对照截图未落在视口内：${JSON.stringify(compareVisible)}`);
  await page.screenshot({ path: join(SHOT_DIR, "casefirst-case-23-compare-1440x900.png") });
  return { layout, sync, compareVisible, scrollWidth: await page.evaluate(() => document.documentElement.scrollWidth) };
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
    evidence.desktopCase = await desktopCaseChecks(page, errors);
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
      "reports/visual/casefirst-case-23-top-390x844.png",
      "reports/visual/casefirst-case-23-390x844.png",
      "reports/visual/casefirst-case-23-compare-1440x900.png",
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
