# Agnes 提示词画廊（agnes-prompt-gallery）

**Prompt as Code for Agnes AI** —— 一个完全基于**真实实测**的 Agnes 生图/生视频提示词库。每个案例都附带真实调用产生的成品（图/视频）、完整提示词与参数，可直接复制复用。

> 灵感来源：[awesome-gpt-image-2](https://github.com/freestylefly/awesome-gpt-image-2)（Prompt-as-Code 思路）。区别：本库**只收亲测案例**——每条提示词都用 Agnes API 真实跑过，图/视频即为该提示词的真实产出。

## ✨ 特点

- 🧪 **100% 实测（链路）**：案例 = 真实调用记录（提示词 + 参数 + 成品 + 备注），不是转抄社区
- ⏳ **评分进行中**：所有案例当前为「在建」状态——生成链路已验证，但提示词**效果好坏以用户评分为准**，评分完成后才转「已确认」
- 🖼️ **双模态**：图片（`agnes-image-2.5-flash`）+ 视频（`agnes-video-v2.0` 帧制 / `agnes-video-2.5-flash` 秒制）
- 🔁 **图→视频联动**：视频案例可直接引用图片案例作为参考图（如 VID-002 ← IMG-001）
- 📦 **结构化存储**：每案例一个 JSON，机器可读，Agent/脚本可批量消费
- 🌐 **零依赖静态站**：`build_site.py` 一键生成可浏览网站（分类筛选 / 大图预览 / 视频播放 / 一键复制）

## 📂 目录结构

```
agnes-prompt-gallery/
├── README.md
├── cases/
│   ├── image/          # 图片案例（IMG-XXX.json）
│   └── video/          # 视频案例（VID-XXX.json）
├── assets/
│   ├── image/          # 图片成品（本地备份）
│   └── video/          # 视频成品（本地备份）
├── templates/
│   └── README.md       # 结构化提示词模板协议（可复用骨架）
├── build_site.py       # 静态网站生成器
└── site/               # 生成的网站（index.html）
```

## 🗂️ 案例字段（JSON Schema）

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 案例编号（IMG-001 / VID-001） |
| `type` | string | `image` / `video` |
| `date` | string | 实测日期 |
| `model` | string | 模型 id |
| `engine` / `mode` | string | 视频专属：引擎（v2.0 / 2.5-flash）与模式（text / keyframe / reference） |
| `category` | string | 分类（见下方分类体系） |
| `scene` | string | 场景 |
| `style` | string | 风格标签 |
| `title` | string | 案例标题 |
| `prompt` | string | **完整提示词原文** |
| `negative_prompt` | string/null | 负向提示（仅 v2.0 支持） |
| `params` | object | 关键参数（图片：size/ratio；视频：帧制或秒制参数） |
| `output` | string | 本地产物路径 |
| `url` | string | Agnes CDN 输出链接（网站展示用） |
| `rating` | int/null | 主观评分 1-5（未评分为 null） |
| `status` | string | 案例状态：`在建`（链路已通、效果待评分）/ `已确认`（已评分） |
| `notes` | string | 实测备注：技术链路情况 + 观察点（待评分确认） |

## 🏷️ 分类体系（随案例增长扩充）

**图片**：摄影写实 · 海报排版 · 电商产品 · 插画艺术 · 人物角色 · 文字设计 · 其他
**视频**：风景运镜 · 人物动态 · 产品展示 · 参考图动态化 · 其他

## 🚀 如何复用

1. 浏览 `site/index.html`（或仓库 Pages），按分类找到想要的案例
2. 复制完整 prompt（保留结构：主体→动作→环境→光线→镜头→风格→画质）
3. 调 Agnes API（OpenAI 兼容，`https://api.agnes-ai.cn/v1`）或用你自己的 agent skill 生成

## ➕ 如何添加案例

1. 用提示词真实调用 Agnes 生成（免费档：v2.0 无限期免费，2.5-flash 限时免费）
2. 保存成品到 `assets/`，按上方 Schema 写 `cases/**/XXX.json`
3. 跑 `python3 build_site.py` 重新生成网站
4. 提交 PR

## ⚠️ 免费政策与时效

- `agnes-video-v2.0`：**无限期免费**
- `agnes-video-2.5-flash`：**限时免费**（到期后未订阅调用会失败，不会扣费）
- 政策会变，使用前建议核对官方定价页

## License

MIT
