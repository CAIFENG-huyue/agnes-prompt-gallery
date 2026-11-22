# 发布矩阵（T14）

- 生成时间：2026-11-22T00:49:02.865Z
- 基线提交（门禁执行时 HEAD）：`d2022195c139f1b4fdbea3f062f953cd85282847`（master）
- 门禁结果：**全部通过**
- 门禁命令：`node tools/release-check.mjs`

## 构建产物

- 构建命令：`npx --yes astro build --outDir dist-t14`
- 输出目录：`dist-t14/`（临时发布候选，已在 `.gitignore` 中忽略，不覆盖 `dist/`）
- 构建耗时：6074 ms
- 总页数：555（案例页 541）
- 静态资源：public/assets 下 1989 张 WebP，构建时原样复制到 `dist-t14/assets/`

## 页数

| 区块 | 页数 |
|---|---:|
| cases | 541 |
| categories | 6 |
| experiments | 4 |
| home | 1 |
| methods | 3 |
| **合计** | **555** |

案例页覆盖 `dist-t14/cases/` 下 541 个目录，与 `content/cases.json` 的 541 条记录一一对应。

## 资源体积

- 资产总数：1989（期望 1989）
- 单文件上限：150000 B；实测最大 149982 B（`/assets/cases/case274-960.webp`）
- 总量：126032078 B（120.19 MiB）
- 缺图：0

| 档位 | 数量 | 单张上限 | 档位总量 | 超限 |
|---|---:|---:|---:|---:|
| 360w | 663 | 45000 B | 15335664 B | 0 |
| 640w | 663 | 90000 B | 39521734 B | 0 |
| 960w | 663 | 150000 B | 71174680 B | 0 |

## 校验清单

| 门禁 | 状态 | 命令/方法 | 证据摘要 |
|---|---|---|---|
| 契约与五类定义校验 | pass | `node tools/validate-contracts.mjs` | 契约校验通过：分类、示例、版本字段和证据字段均有效 |
| 案例、提示词版本与来源资产校验 | pass | `node tools/validate-cases.mjs` | 案例校验完成，报告：reports/import.json |
| 一级分类与金标一致性 | pass | `node tools/check-classifications.mjs` | ✓ 独立标注 8 条争议记录，Cohen’s κ=0.8262，状态 passed_with_boundary_notes |
| 结构指纹、意图与同义词 | pass | `node tools/check-fingerprints.mjs` | ✓ 双人独立标注、仲裁与外部一致率：空模板，未伪造 |
| 案例指南、决策卡与实验证据 | pass | `node tools/check-guides.mjs` | ✓ 无禁用语气、无整段提示词、无孤立证据引用，构建漂移为空 |
| 多档 WebP 资产完整性与档位预算 | pass | `node tools/check-assets.mjs` | 总体积 126032078 字节，最终超限 0 张，报告：reports/assets.json |
| H1/H2 结论重算与 generated/conclusions.json 一致 | pass | `tools/build-conclusions.mjs#recompute` | 3 个 ConclusionVersion 重算一致，快照 7b13f2915a41… |
| 结构优先检索与 25 条金标 | pass | `node tools/evaluate-search.mjs` | 排序策略：structure > intent > text（lexicographic） |
| 检索评估报告汇总 | pass | `reports/search-eval.json` | 25/25 查询达标，命中原因覆盖 125/125 |
| 企鹅硬场景 Top5 ≥3 同结构 | pass | `reports/search-eval.json` | Top5 命中 3 个同结构：case-475、case-512、case-310 |
| 静态构建（dist-t14） | pass | `npx --yes astro build --outDir dist-t14` | 555 页构建完成（6074 ms） |
| 页数与案例覆盖（555 页 / 541 案例） | pass | `遍历 dist-t14/index.html` | 555 页，其中案例页 541；{"cases":541,"categories":6,"experiments":4,"home":1,"methods":3} |
| 首页发现与企鹅题结果卡 | pass | `node quality/discovery.check.mjs dist-t14` | 每张企鹅题结果卡均含命中原因、共性难点、一条迁移写法、案例链接和三档 WebP。 |
| 541 个案例页自解释与移动首屏 | pass | `node quality/case-pages.check.mjs dist-t14` | 全部提示词版本默认折叠、无整段复制入口；实测数字与评分均链接到页内 Run、评分修订和结果图。 |
| 实验证据页与结论下钻 | pass | `node quality/evidence-pages.check.mjs dist-t14` | 永久地址与 canonical 一致且不指向 latest；无评分 Run 的 5 处缺口被明确标注，未生成替代评分或结论。 |
| 资源预算：单文件 ≤150KB、总量、缺图=0 | pass | `generated/assets.json + public/assets` | 1989 张，单张最大 149982 B（/assets/cases/case274-960.webp），总量 120.19 MiB，缺图 0 |
| 只增数据契约测试（541 → 542 → 541） | pass | `临时追加数据 + 两次 astro build` | 合成案例使案例页 541→542 且 src 未变；git restore 后复建 542→541 |

## 只增数据契约测试

- 方法：在临时目录 `/tmp/agnes-t14-contract-Gssc9z` 构建，仓库内只临时追加数据行，结束后 `git restore` 还原。
- 追加文件：`content/cases.json`、`content/prompt-versions/cases.json`，以及案例页渲染所必需的 `classifications.json`、`fingerprints.json`、`case-guides.json`、`decisions.json` 同 case_id 数据行。
- 断言：案例页 541 → 542，旧 541 个案例 URL 全部保留，`src/` 目录哈希与 `git status -- src` 均无变化。
- 还原：`git restore` 后内容字节与基线一致，复建页数回到 555 / 案例页 541；临时构建目录已删除。

## 已知局限

- 案例页模型要求同一 `case_id` 同时具备分类、指纹、指南、决策卡和提示词版本；只往 `cases.json` 追加一行不会渲染新页，因此契约测试同步追加这些数据行，但仍不改任何 `src/` 代码。
- 单文件资源预算按 150,000 字节执行（与 `tools/check-assets.mjs` 的 960w 档位一致），不是 153,600 字节的 KiB 口径。
- `reports/release.json` 与各校验脚本产出的 `reports/*.json` 是证据文件，会随门禁运行更新。
- 本门禁不执行 Playwright 端到端与 5 人盲测；这些属于 T13 的独立验收产物。
- `dist-t14/` 仅作发布候选，不提交、不覆盖 `dist/`，也不代表部署产物。

## 回滚方式

1. 撤销发布门禁提交：`git revert <release-commit>`（或 `git reset --hard <上一个通过提交>`）。
2. 只回滚内容改动：`git restore --source=<上一个通过提交> -- content/ generated/`，然后重新执行 `node tools/release-check.mjs`。
3. 清理临时构建：`rm -rf dist-t14`。
4. 若线上已使用该候选：重新运行 `npx --yes astro build --outDir dist-t14` 并部署上一通过提交构建出的目录；旧版本 URL 为固定路径，不做重定向或覆盖。

