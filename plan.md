# Agnes Bench 实施方案

## 1. 架构与信息架构

采用 Astro 静态构建，内容与派生结果分离；运行时无数据库、无服务器。页面只有五种：`/` 任务入口与分类导航、`/categories/[id]` 分类检索、`/cases/[id]` 案例教学、`/experiments/[id]` 实验证据、`/methods/[id]` 可迁移方法。

文件规划：`content/` 存 `taxonomy.json`、`cases.json`、`prompt-versions.json`、`decisions.json`、`experiments.json`、`runs.json`、`score-revisions.json`、`assets.json`、`synonyms.json`；`generated/` 存构建生成的 `search-index.json`、`conclusions.json`；`public/assets/` 存案例及实验图片；`src/pages/` 仅含上述通用路由。新增内容只改 `content/` 与图片，不改页面。

## 2. 分类体系

一级分类固定五类，以“最不能失败的验收对象”而非题材、风格分类。

| 分类 | 一句话定义 | 什么时候用 |
|---|---|---|
| 主体造型 | 以一个主体的外观、材质或风格保真为核心 | 产品、人像、角色、静物 |
| 场景叙事 | 以多主体的空间关系、动作或情节为核心 | 场景、故事、参考图重构 |
| 平面传播 | 以标题、品牌和视觉注意的层级为核心 | 海报、封面、广告、字标 |
| 信息图解 | 以多个槽位的数量、顺序、标注及绑定关系为核心 | 图表、技术板、设定卡、对照矩阵 |
| 界面文档 | 以页面中的阅读流或操作流为核心 | UI、文档、出版物 |

每条案例仅有一个必填 `primary_category_id`。冲突时依次判断：是否重操作流；是否必须逐槽核对；是否重传播层级；是否重空间叙事；否则归主体造型。原 `category/styles/scenes` 仅留作来源字段。意图、多视图、网格等另作可多选筛选项，不再扩张一级分类。

## 3. 数据模型（字段级）

| 实体 | 主键与核心字段 |
|---|---|
| Category | `category_id`、`name`、`definition`、`when_to_use`、`decision_order` |
| Case | `case_id`（如 `case-475`）、`title`、`cover_asset_id`、`primary_category_id`、`intent_ids[]`、`editorial_status`、`fingerprint{subject_count,layout,relations[],text_slots,input_mode,ratio}`、`source{repository,source_label,source_url,github_url,original_category,styles,scenes}` |
| Asset | `asset_id`、`uri`、`kind`、`sha256`、`width`、`height`、`source_url` |
| PromptVersion | `prompt_version_id`（`case-475/pv-001`）、`case_id`、`version_no`、`parent_version_id`、`text`、`content_sha256`、`change_note`、`spec{ratio,refs,ref_contract,canvas,subject,elements,texts[{text,where,style}],counts[{item,rows,cols,labels}],layout,style,negatives}` |
| ExperimentVersion | `experiment_version_id`（`h1/ev-001`）、`experiment_id`、`version_no`、`hypothesis`、`design`、`arms[{arm_id,label,prompt_version_ids[]}]`、`model`、`primary_metric`、`secondary_metrics[]`、`rubric_version`、`status` |
| Run | `run_id`、`experiment_version_id`、`arm_id`、`case_id`、`prompt_version_id`、`rep`、`blind_id`、`result_asset_ids[]`、可选 `seed` |
| ScoreRevision | `score_id`、`run_id`、`revision`、`supersedes_id`、G1–G4、`text_hits/text_total`、`elements_hits/elements_total`、`count_error`、`notes`、`scorer`、`scored_at`、`is_current` |
| Decision | `decision_id`、`case_id`、`prompt_version_id`、`decision`、`control_target`、`before_excerpt`、`after_excerpt`、`expected_effect`、`observed_effect`、`evidence_level(tested/observed/inferred)`、`evidence_refs[]` |
| ConclusionVersion | `conclusion_version_id`、`conclusion_id`、`version_no`、`source_experiment_version_ids[]`、`score_snapshot_hash`、`metric`、`estimate`、`unit`、`ci_low/ci_high/ci_method/ci_level`、可选 `p_value/p_method`、`n_cases/n_images`、`limitations[]`、`generator_version`、`evidence_run_ids[]` |

现有 CSV 只有 `blind_id`，没有案例、实验臂映射；迁移时必须补齐 Run 映射并做唯一性校验，禁止从哈希猜归属。未映射记录进入隔离清单，不支撑任何展示数字。

## 4. 页面区块与交互

- **首页**：自然语言任务框、五个分类卡（定义与“什么时候用”）、两条有证据的方法；不设置“热门提示词”。
- **分类页**：意图与结构指纹组合筛选；卡片展示封面、分类、结构标签、难点、证据级别及“命中原因”，而非提示词预览。
- **案例页**：手机首屏依次放标题、分类、三个关键指纹、适合/不适合、封面和证据徽标。向下依次是共性难点；“决策→控制结果→换掉会怎样”卡片；A/B 图与指标证据抽屉；一条抽象迁移规则；版本时间线与来源。完整原文默认折叠、无复制按钮，前后对照只展示必要短片段。
- **实验页**：问题、设计、评分口径、汇总结论、逐案例表、逐图评分与复核记录。数字可下钻到 Run 和原图；同时显示样本量、区间、检验方法及局限。
- **方法页**：适用条件、决策卡、反例和结论版本。叙述可编辑，数值只能由 ConclusionVersion 注入；未做单变量实验的决策明确标“推断”。

## 5. 无后端检索与版本规则

三者分工：一级分类收窄任务，结构指纹做精确过滤，构建期倒排索引检索标题、意图、结构定义和同义词；长提示词不参与主要排序。排序依次为结构匹配、意图匹配、文本匹配，`synonyms.json` 维护“结构板→多视图/技术视图/尺寸标注”等任务词。MVP 不引入向量模型。

提示词内容变化追加 `pv`，不可原地覆盖；实验臂、模型或评分口径变化追加 `ev`；评分修订追加 ScoreRevision。构建时从指定 `ev` 和当前评分快照重算并追加 `cv`，方法页固定引用 `cv`，因此旧数字、旧图和旧解释均可复现。

## 6. MVP 与验收

**只做**：541 条全部导入并完成一级分类和基础指纹；10 个 H1 案例完整教学拆解；H1 及结果文档明确记录的 H2-226 证据页；由数据生成“结构化写法与逐字文本”“规则字幕带与后期叠字”两条方法；五种响应式页面及静态检索。其余未在结果文档说明的素材只存档，不形成结论。

**验收**：
1. 541 条主键唯一、图片有效、恰有一个一级分类；10 个教学案例的决策均含控制目标、换法和证据级别，推断不得冒充实测。
2. 固定任务检索集人工验收；“企鹅饼干礼盒结构板、尺寸和材料说明”Top 5 至少返回 3 个经确认的同结构案例，并显示命中原因。
3. H1 重算必须得到 prose 601/620、structured 557/620、效应 -7.9pp 及原区间；H2 明示单案例、每臂 5 张和可行性局限。每个数字均能下钻到具体图、评分及修订，孤立证据为零。
4. 新增案例、提示词版本和实验只增数据；旧 URL 不变，新构建产生新结论版本，旧快照可重算。
5. 360px 宽首屏可判断适用性且无横向滚动；静态产物可直接部署，检索无需接口。

**明确砍掉**：541 条全量深拆、一键复制、在线生成/编辑、向量检索、账号评论收藏、模型排行榜及后台系统。
