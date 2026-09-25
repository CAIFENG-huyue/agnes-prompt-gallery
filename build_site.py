#!/usr/bin/env python3
"""
agnes-prompt-gallery 网站生成器。
读取 cases/{image,video}/*.json，生成 site/index.html（单文件、零依赖、深色主题）。
用法：python3 build_site.py
"""
import json
import os
import html

ROOT = os.path.dirname(os.path.abspath(__file__))
CASES_DIR = os.path.join(ROOT, "cases")
SITE_DIR = os.path.join(ROOT, "site")


def load_cases():
    cases = []
    for sub in ("image", "video"):
        d = os.path.join(CASES_DIR, sub)
        if not os.path.isdir(d):
            continue
        for fn in sorted(os.listdir(d)):
            if fn.endswith(".json"):
                with open(os.path.join(d, fn), encoding="utf-8") as f:
                    cases.append(json.load(f))
    # 新的在前（按 id 倒序、视频在后同序）
    cases.sort(key=lambda c: (c["type"], c["id"]), reverse=True)
    return cases


def media_tag(c, cls="case-media"):
    url = html.escape(c.get("url") or "")
    if c["type"] == "image":
        return f'<img class="{cls}" src="{url}" loading="lazy" alt="{html.escape(c["title"])}">'
    return (f'<video class="{cls}" src="{url}" muted loop preload="metadata" '
            f'playsinline></video>')


def build_html(cases):
    cats = []
    for c in cases:
        if c["category"] not in cats:
            cats.append(c["category"])
    cat_chips = "".join(
        f'<button class="chip" data-cat="{html.escape(cat)}">{html.escape(cat)}</button>'
        for cat in cats
    )
    cards = []
    for i, c in enumerate(cases):
        badge = "视频" if c["type"] == "video" else "图片"
        params = " · ".join(f"{k}={v}" for k, v in c.get("params", {}).items())
        cards.append(f'''
<article class="card" data-type="{c["type"]}" data-cat="{html.escape(c["category"])}" data-idx="{i}">
  {media_tag(c)}
  <div class="card-body">
    <div class="card-top"><span class="badge {"v" if c["type"]=="video" else "i"}">{badge}</span>
      <span class="badge {"s2" if c.get("status")=="已确认" else "s"}">{"✅" if c.get("status")=="已确认" else "⏳"} {html.escape(c.get("status","在建"))}</span>
      <span class="cat">{html.escape(c["category"])}</span></div>
    <h3>{html.escape(c["title"])}</h3>
    <p class="meta">{html.escape(c["model"])} · {html.escape(c["date"])}</p>
    <p class="params">{html.escape(params)}</p>
  </div>
</article>''')
    cards_html = "".join(cards)
    cases_json = json.dumps(cases, ensure_ascii=False)

    return f'''<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Agnes 提示词画廊</title>
<style>
:root{{--bg:#0f1115;--card:#171a21;--card2:#1e222b;--tx:#e8eaed;--tx2:#9aa0aa;
--acc:#6ea8fe;--acc2:#3ddc97;--bd:#262b35;--radius:14px}}
*{{box-sizing:border-box;margin:0;padding:0}}
body{{background:var(--bg);color:var(--tx);font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;line-height:1.6}}
.wrap{{max-width:1200px;margin:0 auto;padding:32px 20px 80px}}
header h1{{font-size:28px;letter-spacing:1px}}
header .sub{{color:var(--tx2);margin-top:6px;font-size:14px}}
header .sub a{{color:var(--acc);text-decoration:none}}
.stats{{display:flex;gap:18px;margin:18px 0 22px;color:var(--tx2);font-size:13px}}
.stats b{{color:var(--tx);font-size:17px;margin-right:4px}}
.filters{{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:22px}}
.chip{{background:var(--card);border:1px solid var(--bd);color:var(--tx2);
padding:7px 14px;border-radius:999px;cursor:pointer;font-size:13px;transition:.15s}}
.chip:hover{{color:var(--tx);border-color:var(--acc)}}
.chip.on{{background:var(--acc);border-color:var(--acc);color:#0b1020;font-weight:600}}
.grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));gap:18px}}
.card{{background:var(--card);border:1px solid var(--bd);border-radius:var(--radius);
overflow:hidden;cursor:pointer;transition:.18s;display:flex;flex-direction:column}}
.card:hover{{transform:translateY(-3px);border-color:var(--acc);box-shadow:0 8px 28px rgba(0,0,0,.45)}}
.case-media{{width:100%;height:180px;object-fit:cover;display:block;background:#000}}
.card-body{{padding:14px 16px 16px}}
.card-top{{display:flex;gap:8px;align-items:center;margin-bottom:6px}}
.badge{{font-size:11px;padding:2px 8px;border-radius:6px;font-weight:600}}
.badge.i{{background:rgba(110,168,254,.16);color:var(--acc)}}
.badge.v{{background:rgba(61,220,151,.16);color:var(--acc2)}}
.badge.s{{background:rgba(255,179,0,.16);color:#ffb300}}
.badge.s2{{background:rgba(61,220,151,.16);color:var(--acc2)}}
.cat{{font-size:12px;color:var(--tx2)}}
.card h3{{font-size:15px;font-weight:600}}
.meta{{font-size:12px;color:var(--tx2);margin-top:4px}}
.params{{font-size:12px;color:var(--tx2);margin-top:2px;word-break:break-all;
display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}}
/* 模态 */
.overlay{{position:fixed;inset:0;background:rgba(0,0,0,.72);display:none;
align-items:center;justify-content:center;padding:24px;z-index:50}}
.overlay.show{{display:flex}}
.modal{{background:var(--card2);border:1px solid var(--bd);border-radius:18px;
max-width:860px;width:100%;max-height:92vh;overflow:auto;padding:22px}}
.modal .media-lg{{width:100%;max-height:460px;object-fit:contain;background:#000;
border-radius:12px;display:block}}
.modal h2{{font-size:20px;margin:16px 0 4px}}
.mrow{{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0}}
.tag{{font-size:12px;background:var(--card);border:1px solid var(--bd);
color:var(--tx2);padding:4px 10px;border-radius:8px}}
.tag b{{color:var(--tx);font-weight:500}}
.prompt-box{{position:relative;margin-top:12px}}
.prompt-box pre{{background:#0b0d12;border:1px solid var(--bd);border-radius:10px;
padding:14px;font-size:13px;white-space:pre-wrap;word-break:break-word;color:#cfe3ff;font-family:ui-monospace,Menlo,Consolas,monospace}}
.copy{{position:absolute;top:10px;right:10px;background:var(--acc);color:#0b1020;border:0;
border-radius:8px;padding:6px 12px;font-size:12px;cursor:pointer;font-weight:600}}
.copy:active{{transform:scale(.96)}}
.notes{{font-size:13px;color:var(--tx2);margin-top:12px;border-left:3px solid var(--acc2);
padding-left:10px}}
.close{{float:right;background:none;border:0;color:var(--tx2);font-size:22px;cursor:pointer}}
.empty{{text-align:center;color:var(--tx2);padding:60px 0;display:none}}
footer{{color:var(--tx2);font-size:12px;text-align:center;margin-top:50px}}
</style>
</head>
<body>
<div class="wrap">
<header>
  <h1>🎨 Agnes 提示词画廊</h1>
  <p class="sub">Prompt as Code · 全部案例真实实测 · 灵感来自
    <a href="https://github.com/freestylefly/awesome-gpt-image-2" target="_blank">awesome-gpt-image-2</a></p>
</header>
<div class="stats">
  <span><b>{len(cases)}</b>案例</span>
  <span><b>{sum(1 for c in cases if c["type"]=="image")}</b>图片</span>
  <span><b>{sum(1 for c in cases if c["type"]=="video")}</b>视频</span>
  <span><b>{len(cats)}</b>分类</span>
</div>
<div class="filters">
  <button class="chip on" data-type="all">全部</button>
  <button class="chip" data-type="image">图片</button>
  <button class="chip" data-type="video">视频</button>
  <span style="width:12px"></span>
  <button class="chip on" data-cat="__all">所有分类</button>
  {cat_chips}
</div>
<div class="grid" id="grid">{cards_html}</div>
<div class="empty" id="empty">该筛选下暂无案例</div>
<footer>Agnes Prompt Gallery · MIT License · 数据随实测持续更新</footer>
</div>

<div class="overlay" id="ov"><div class="modal" id="modal"></div></div>

<script>
const CASES = {cases_json};
const ov = document.getElementById('ov'), modal = document.getElementById('modal');
const state = {{type:'all', cat:'__all'}};

function applyFilters() {{
  let shown = 0;
  document.querySelectorAll('.card').forEach(el => {{
    const okT = state.type==='all' || el.dataset.type===state.type;
    const okC = state.cat==='__all' || el.dataset.cat===state.cat;
    const show = okT && okC;
    el.style.display = show ? '' : 'none';
    if (show) shown++;
  }});
  document.getElementById('empty').style.display = shown ? 'none' : 'block';
}}
document.querySelectorAll('.chip').forEach(ch => ch.addEventListener('click', () => {{
  if (ch.dataset.type) {{
    state.type = ch.dataset.type;
    document.querySelectorAll('.chip[data-type]').forEach(x => x.classList.toggle('on', x===ch));
  }} else {{
    state.cat = ch.dataset.cat;
    document.querySelectorAll('.chip[data-cat]').forEach(x => x.classList.toggle('on', x===ch));
  }}
  applyFilters();
}}));

function esc(s) {{ const d = document.createElement('div'); d.textContent = s ?? ''; return d.innerHTML; }}
function openCase(i) {{
  const c = CASES[i];
  const media = c.type==='image'
    ? `<img class="media-lg" src="${{esc(c.url)}}" alt="">`
    : `<video class="media-lg" src="${{esc(c.url)}}" controls autoplay loop playsinline></video>`;
  const tags = [
    ['模型', c.model], ['分类', c.category], ['场景', c.scene], ['风格', c.style],
    ['日期', c.date], ['状态', c.status || '在建'], ['评分', c.rating ? (c.rating + ' / 5') : '待评分']
  ].map(([k,v]) => v ? `<span class="tag"><b>${{k}}:</b> ${{esc(v)}}</span>` : '').join('');
  const params = Object.entries(c.params||{{}}).map(([k,v]) => `<span class="tag"><b>${{esc(k)}}:</b> ${{esc(v)}}</span>`).join('');
  modal.innerHTML = `
    <button class="close" onclick="closeModal()">✕</button>
    ${{media}}
    <h2>${{esc(c.id)}} · ${{esc(c.title)}}</h2>
    <div class="mrow">${{tags}}${{params}}</div>
    <div class="prompt-box">
      <button class="copy" onclick="copyPrompt(this, ${{i}})">复制 Prompt</button>
      <pre>${{esc(c.prompt)}}</pre>
    </div>
    ${{c.notes ? `<div class="notes">📝 ${{esc(c.notes)}}</div>` : ''}}
    ${{c.negative_prompt ? `<div class="notes">🚫 负向: ${{esc(c.negative_prompt)}}</div>` : ''}}
  `;
  ov.classList.add('show');
  document.body.style.overflow = 'hidden';
}}
function closeModal() {{ ov.classList.remove('show'); document.body.style.overflow=''; }}
function copyPrompt(btn, i) {{
  const t = CASES[i].prompt;
  const done = () => {{ btn.textContent='✅ 已复制'; setTimeout(()=>btn.textContent='复制 Prompt',1200); }};
  if (navigator.clipboard) navigator.clipboard.writeText(t).then(done);
  else {{
    const ta = document.createElement('textarea'); ta.value = t;
    document.body.appendChild(ta); ta.select(); document.execCommand('copy');
    ta.remove(); done();
  }}
}}
document.querySelectorAll('.card').forEach(el =>
  el.addEventListener('click', () => openCase(+el.dataset.idx)));
ov.addEventListener('click', e => {{ if (e.target===ov) closeModal(); }});
document.addEventListener('keydown', e => {{ if (e.key==='Escape') closeModal(); }});
// 视频卡片 hover 预览
document.querySelectorAll('video.case-media').forEach(v => {{
  const card = v.closest('.card');
  card.addEventListener('mouseenter', () => v.play().catch(()=>{{}}));
  card.addEventListener('mouseleave', () => {{ v.pause(); v.currentTime = 0; }});
}});
</script>
</body>
</html>'''


def main():
    cases = load_cases()
    os.makedirs(SITE_DIR, exist_ok=True)
    out = os.path.join(SITE_DIR, "index.html")
    with open(out, "w", encoding="utf-8") as f:
        f.write(build_html(cases))
    print(f"site built: {out} ({len(cases)} cases)")


if __name__ == "__main__":
    main()
