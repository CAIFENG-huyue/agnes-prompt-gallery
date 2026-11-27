# Agnes Bench 施工方案 v2

## 1. 对齐说明与施工边界

保留 `plan.md` 的 Astro 静态站、五类互斥分类、结构检索、版本链和证据下钻；删除“案例教学”“教学拆解”等定位。新定位是**自助式结构**：用户从“我想做什么”出发，按需打开任一页面即可使用，不按章节阅读，不出现课程、教程、学习路径、进度、测验、练习或教学口吻。

不同意上一版“10 个案例深拆，其余案例仅有基础数据”即可满足案例页要求的隐含假设。改为：**541 条全部有轻量自解释卡，10 个 H1 案例再有证据深拆**。轻量卡的结论只能标 `inferred`，不得借实验口吻包装。

路径约定：`P=agent/agnes-bench`（站点仓库根），`R=repos/awesome-gpt-image-2`，`E=agent/agnes/experiments`，`B=agent/agnes-bench`（方案与需求文档）；命令工作目录均为 `P`。每个任务只能写自己的输出路径，其他产物只读；`node_modules/`、`.astro/`、`dist/` 是不提交的临时构建产物，各 worker 在独立 worktree 构建。集成失败退回文件所有任务，不由他人顺手修改。

## 2. 自助结构与分类落地

用户路径固定为三步：① 首页输入任务或点“我想……”分类卡；② 得到可筛选的 3–5 个案例卡，卡上显示结构命中原因；③ 打开案例页，直接查看“适合/不适合、共性难点、决策→控制了什么→换掉会怎样、一条可迁移写法”。完整原文仅作来源证据默认折叠，不提供整段复制。

案例页无须前言即可理解。手机首屏依次呈现标题、通俗分类、适合/不适合、三个关键指纹、封面、证据级别；其后才是决策卡、难点、迁移写法、可选证据抽屉和版本来源。`/methods/[id]` 是按需查阅的“可迁移写法”，不是课程章节。

| 一级分类 | 用户入口的通俗解释 | 什么时候用 |
|---|---|---|
| 主体造型 | 我想把一个东西或人的外观、材质画对 | 产品、人像、角色、静物 |
| 场景叙事 | 我想安排多个对象在哪里、做什么 | 场景、故事、参考图重构 |
| 平面传播 | 我想让人先看到标题、品牌或卖点 | 海报、封面、广告、字标 |
| 信息图解 | 我想把尺寸、步骤、部件或多格对应关系讲清楚 | 结构板、图表、设定卡、对照矩阵 |
| 界面文档 | 我想让页面容易读、容易操作 | UI、文档、出版物 |

冲突判定依次看操作流、逐槽核对、传播层级、空间叙事，最后归主体造型；原 `category/styles/scenes` 只作来源字段。分类页同时提供“我想做结构板/标尺寸/写材料说明”等意图入口，用户不必理解“信息图解”这个术语。

## 3. 数据生产、金标与图片预算

T03 规则导入并固定主键；T04、T05 分别以 LLM 批处理产生分类、指纹和意图候选，输入标题、完整提示词及缩略图，输出证据短句、置信度，再按互斥规则校验。金标答案不进入批处理提示；低置信度、规则冲突及金标误差全部人工复核，非金标随机抽审 10%。

金标共 **60 条**，按原 13 类分层抽样并强制包含 10 个 H1 案例。两人独立标注一级分类、关键指纹和意图，第三人仲裁。一级分类 Cohen’s κ≥0.80，生产结果对金标准确率≥95%；`subject_count/layout/text_slots/input_mode/ratio` 双人一致率及生产通过率均≥0.90，`relations` F1≥0.85。未达标先修判定规则并重跑，禁止调金标迁就模型。LLM、双人标注、仲裁及复核成本计入 T04/T05，共 88 积分。

541 条轻量决策由规则依据已验指纹生成并绑定提示词短证据，10 个 H1 由人工结合 Run 深拆；任何 `tested/observed` 必须有 Run。实验映射只认 `mapping-h1.jsonl`，禁止由哈希猜归属，孤立记录进隔离清单且不出现在数字中。

图片统一生成 WebP：卡片 `360w/q72` 目标≤45KB，列表高清 `640w/q76` ≤90KB，案例与证据图 `960w/q78` ≤150KB；保持宽高比，提供 `srcset/sizes`，非首屏懒加载，原图仅用户显式下钻时请求。超限需再压缩并记录，不能静默回退为加载 160MB 原图。

## 4. 可派工任务清单

以下 14 个任务按文件所有权互斥；积分包含实现、自验和文档化结果，不包含其他任务的返工。

| task_id | 目标 | 依赖 | 输入文件 | 输出路径（相对 P，唯一所有） | 验收命令与通过口径 | 预估积分 | 可并行批次 |
|---|---|---|---|---|---|---:|---|
| T01 | 固化五类定义、实体/版本 schema、共享示例与派工契约 | 无 | `B/requirements.md`、`B/plan.md` | `schemas/`、`content/taxonomy.json`、`docs/data-contract.md`、`tools/validate-contracts.mjs` | `node tools/validate-contracts.mjs`：五类齐全；示例通过；Decision/Run/Score/Conclusion 必填证据与版本字段 | 18 | B0 |
| T02 | 建 Astro 静态工程、内容只读加载器、公共布局样式和测试依赖 | T01 | T01 全部产物 | `package.json`、`package-lock.json`、`astro.config.mjs`、`tsconfig.json`、`src/layouts/`、`src/styles/`、`src/components/ui/`、`src/lib/content/` | `npm ci && npm run build`：无后端、无类型错误；加载器只读 content/generated，不内置案例数据 | 24 | B1 |
| T03 | 导入 541 案例及原始提示词版本、来源资产清单，固定 60 金标 ID | T01 | `R/data/cases.json`、`R/data/images/`、`E/mapping-h1.jsonl`、T01 schemas | `content/cases.json`、`content/prompt-versions/cases.json`、`content/source-assets.json`、`content/gold-case-ids.json`、`tools/import-cases.mjs`、`tools/validate-cases.mjs`、`reports/import.json` | `node tools/import-cases.mjs --check && node tools/validate-cases.mjs`：541 主键唯一、541 原图可读；金标 60 且含全部 H1 case_id | 24 | B1 |
| T04 | 生成 541 条唯一一级分类，完成双人金标、仲裁和一致性报告 | T03 | T03 cases/prompt-versions/gold IDs、`content/taxonomy.json` | `content/classifications.json`、`content/gold-classifications.json`、`tools/classify-cases.mjs`、`tools/check-classifications.mjs`、`reports/classification-agreement.json` | `node tools/classify-cases.mjs --check && node tools/check-classifications.mjs`：覆盖率/唯一性 100%，κ≥0.80，金标准确率≥95% | 42 | B2 |
| T05 | 生成 541 条结构指纹、意图和同义词；复用同一金标做双人指纹标注 | T03、T04、T08 | T03/T04 产物、`generated/assets.json`、`content/taxonomy.json` | `content/fingerprints.json`、`content/intents.json`、`content/synonyms.json`、`content/gold-fingerprints.json`、`tools/fingerprint-cases.mjs`、`tools/check-fingerprints.mjs`、`reports/fingerprint-agreement.json` | `node tools/fingerprint-cases.mjs --check && node tools/check-fingerprints.mjs`：541 全覆盖；关键字段≥0.90，relations F1≥0.85；含“结构板/尺寸/材料”同义词 | 46 | B3 |
| T06 | 迁移 H1/H2 提示词版本、实验版本、Run、评分修订并重算结论 | T01 | `E/mapping-h1.jsonl`、`E/scores-h1.csv`、`E/results-h1.md`、`E/results-h2.md`、`E/specs/h1/`、T01 schemas | `content/prompt-versions/experiments.json`、`content/experiment-versions.json`、`content/runs.json`、`content/score-revisions.json`、`content/evidence-quarantine.json`、`generated/conclusions.json`、`tools/migrate-experiments.mjs`、`tools/build-conclusions.mjs`、`reports/evidence-recompute.json` | `node tools/migrate-experiments.mjs --check && node tools/build-conclusions.mjs --check`：100 Run 唯一映射；prose=601/620、structured=557/620、效应=-7.9pp 及原区间；H2-226 明示单案例、每臂 5 张和可行性局限；孤立引用为 0 | 40 | B1 |
| T07 | 为 541 条生成轻量自解释内容；深拆 10 个 H1；产出结构板指南与两条方法 | T04、T05、T06 | 分类/指纹/意图、实验版本与结论、案例提示词版本 | `content/case-guides.json`、`content/decisions.json`、`content/structure-guides.json`、`content/methods.json`、`tools/build-guides.mjs`、`tools/check-guides.mjs`、`reports/editorial-coverage.json` | `node tools/build-guides.mjs --check && node tools/check-guides.mjs`：541 条均有适合/不适合、难点、迁移写法和≥1 张 inferred 决策卡；10 个 H1 各≥3 张证据决策卡；两条方法只引用有效 CV；结构板指南含尺寸与材料难点 | 54 | B4 |
| T08 | 为案例和实验图生成多档 WebP、尺寸/哈希清单并核对体积 | T03 | `R/data/images/`、`E/images/h1/`、`E/images/h2/`、T03 source-assets | `public/assets/`、`generated/assets.json`、`tools/optimize-images.mjs`、`tools/check-assets.mjs`、`reports/assets.json` | `node tools/optimize-images.mjs --check && node tools/check-assets.mjs`：541+100+22 源图全覆盖，无缺图/错配；360/640/960 三档格式、尺寸和单张目标全部通过 | 20 | B2 |
| T09 | 建静态结构优先索引、命中原因和 25 条固定意图检索金标 | T02、T04、T05 | cases、classifications、fingerprints、intents、synonyms、taxonomy | `generated/search-index.json`、`src/lib/search/`、`tools/build-search-index.mjs`、`tools/evaluate-search.mjs`、`quality/search-gold.json`、`reports/search-eval.json` | `node tools/build-search-index.mjs --check && node tools/evaluate-search.mjs`：结构＞意图＞文本排序；企鹅题 Top5≥3 个确认同结构案例且均有命中原因；无运行时接口/向量依赖 | 30 | B4 |
| T10 | 实现首页任务入口、五类通俗导航、分类筛选与结果卡 | T02、T07、T08、T09 | 搜索索引、taxonomy、guides、assets | `src/pages/index.astro`、`src/pages/categories/`、`src/components/discovery/`、`quality/discovery.check.mjs` | `npm run build && node quality/discovery.check.mjs`：三步到案例；企鹅题返回 3–5 张卡并展示命中原因、共性难点和一条迁移写法；无课程式文案 | 30 | B5 |
| T11 | 实现 541 个可独立阅读的案例页和移动首屏 | T02、T03、T06、T07、T08 | cases、guides、decisions、assets、实验结论 | `src/pages/cases/`、`src/components/case/`、`quality/case-pages.check.mjs` | `npm run build && node quality/case-pages.check.mjs`：541 页均有自解释区块；推断/实测可辨；数字可下钻；原文折叠且无整段复制按钮 | 34 | B5 |
| T12 | 实现实验证据页和可迁移写法页，展示版本、区间、局限与逐图下钻 | T02、T06、T07、T08 | experiment-versions、runs、scores、conclusions、methods、assets | `src/pages/experiments/`、`src/pages/methods/`、`src/components/evidence/`、`quality/evidence-pages.check.mjs` | `npm run build && node quality/evidence-pages.check.mjs`：H1/H2 数字与 T06 一致；每个数字链接 case/run/image/score revision；旧 CV URL 不变，未支持素材不产生结论 | 34 | B5 |
| T13 | 做移动端、可用性、证据链及“只增数据”端到端验收 | T10、T11、T12 | 全部页面与内容、T09 search-gold | `tests/`、`playwright.config.ts`、`reports/e2e/` | `npx playwright test && node tests/contract/content-only-addition.mjs`：360px 无横溢且首屏可判断；新增案例/PV/Run 不改页面且旧 URL 可复现；另交 5 人盲测，≥4 人能说出下次注意事项 | 28 | B6 |
| T14 | 冻结发布候选，汇总硬场景和全量质量门，不替其他任务修文件 | T13 | 全部验收产物、`B/requirements.md` | `tools/final-acceptance.mjs`、`reports/release/` | `node tools/final-acceptance.mjs && npm run build`：自动重跑全部质量门并生成追踪矩阵；R1–R7、企鹅题、图片预算、541 覆盖、版本复现全绿才可发布 | 16 | B7 |

并行安排：B0=T01；B1=T02/T03/T06；B2=T04/T08；B3=T05；B4=T07/T09；B5=T10/T11/T12；B6=T13；B7=T14。单批最多 3 个 worker，低于并发上限 5；依赖未完成不得通过造临时同名文件抢跑。

## 5. worker 任务书模板

派工时把对应表格行原样填入，正文控制在 2KB 内，字段细节只引用 `docs/data-contract.md` 与具体 schema，不复制整份方案。

> **任务**：`<task_id>／目标／批次／积分`。你在 `P` 的独立 worktree 工作；先确认 `<依赖>` 已合入，只读 `<输入文件>`，只能新增或修改 `<输出路径>`。产品是自助式静态案例结构，不是课程。  
> **Schema 摘要**：Case 以 `case_id` 关联 Classification、Fingerprint、Guide、Decision；PromptVersion 以 `case_id/pv-nnn` 追加版本；Run 连接 `experiment_version_id/arm_id/case_id/prompt_version_id/blind_id`；ScoreRevision 追加修订；ConclusionVersion 是指定实验与评分快照的生成视图。所有证据用既有 ID 引用。  
> **结构示例**：对“企鹅饼干礼盒结构板，带尺寸和材料说明”，意图可含 `structure_sheet/dimension_annotation/material_notes`；命中原因应写“多视图且尺寸、材料均有独立槽位”，不能只写“关键词相同”。决策示例：“固定视图与尺寸槽位→绑定视角和标注→取消槽位后易漏项或错配”，无 Run 时 `evidence_level=inferred`。  
> **交付**：执行 `<验收命令>`，保存命令输出和偏差说明；未达标不得改其他任务文件。  
> **禁止**：课程/进度/测验及教学口吻；编造案例、实验或数字；猜 blind_id 映射；把推断标成实测；覆盖旧版本；展示整段复制按钮；新增后端、数据库或向量服务；修改公共配置或他人文件。

## 6. MVP、砍项与预算

MVP 包含：541 条导入、分类、指纹和轻量自解释；10 个 H1 证据深拆；H1 与结果文档支持的 H2-226 证据页；两条数据驱动方法及结构板指南；五类静态路由、结构检索、多档图片、移动首屏和版本复现。其余 H2 素材只存档。

明确砍掉：全部教学化功能与顺序叙事、541 条全量人工深拆、一键复制、在线生成/编辑、向量检索、账号/评论/收藏、模型排行榜、后台系统，以及无结果文档支持的实验结论。

任务预算合计 **440 积分**；仅用于金标未达标、证据迁移差异或移动验收返工的预留为 **60 积分**，总上限 **500 积分**。预留不预派、不为消耗预算而拆任务。
