# 一级分类可解释规则

## 1. 输入与边界

分类器为 `tools/classify-cases.mjs`，版本为 `explainable-rules-v1`。每条案例只读取 `Case.title` 与首个 `PromptVersion.text`，不调用外部模型或网络服务，不读取 `Case.source.original_category/styles/scenes`，也不读取金标答案。分类结果遵循 `schemas/classification.schema.json`，每条恰好一个 `primary_category_id`。

判定使用标题和完整提示词中的关键词及结构线索。结构线索包括 UI 控件、阅读流、重复槽位、数量、顺序、标签绑定、多视图、拆解、标注、传播标题，以及多主体动作。命中后保留命中规则编号、理由和原文附近不超过 180 字符的短摘录。

## 2. 冲突顺序

严格按 `content/taxonomy.json` 的顺序短路判定，而不是统计各类关键词数量：

| 顺序 | 一级分类 | 核心问题 | 不能被次要线索覆盖的情况 |
|---:|---|---|---|
| 1 | `interface-document` | 是否以页面阅读流或操作流为核心？ | UI 中即使有图表，仍归界面文档 |
| 2 | `information-diagram` | 是否必须逐槽核对数量、顺序、标注或绑定？ | 信息图即使采用海报风格，仍归信息图解 |
| 3 | `graphic-communication` | 是否以标题、品牌、卖点或注意层级为核心？ | 海报中有人物或场景，不因此改归场景叙事 |
| 4 | `scene-narrative` | 是否以多主体空间关系、动作或情节为核心？ | 写实或风格词不改变空间叙事核心 |
| 5 | `subject-form` | 是否主要要求一个主体的外观、材质或风格保真？ | 前四类均未命中时作为兜底 |

## 3. 规则表

规则编号与代码一一对应；同一优先级内按编号递增匹配。

| 规则 | 分类 | 代表线索 | 判定依据 |
|---|---|---|---|
| R1.1 | 界面文档 | `UI/UX`、`interface mockup`、`ui_layout/ui_overlays`、`livestream UI`、`直播间界面`、`中控界面` | 明确指定界面及交互组织；不因通用标题“界面”直接命中 |
| R1.2 | 界面文档 | `landing page`、`web page`、`navigation/status bar`、社交或直播`截图`、`朋友圈`、`详情页` | 页面导航、状态和操作路径；单纯直播内容不必然算 UI |
| R1.3 | 界面文档 | `magazine spread`、`cookbook page`、`textbook`、`prescription`、`课本`、`菜单`、`日报` | 连续阅读版面与文档，而非单张封面 |
| R2.1 | 信息图解 | `infographic`、`data visualization`、`map infographic`、带地点标注的`地图`、`结构板`、`关系图` | 显式信息图与图解；地图仅作场景道具时不命中 |
| R2.2 | 信息图解 | `exploded view/assembly`、`character/design sheet`、`scene reference board`、`pointer lines`、`拆解图` | 多视图、拆解和标注绑定 |
| R2.3 | 信息图解 | `timeline`、`storyboard`、`comparison matrix`、`N-panel`、`numbered panels`、`分镜生成` | 顺序、分镜和对照槽位；标题写“分镜”但原文为单幅画时不命中 |
| R2.4 | 信息图解 | `avatar/portrait grid`、`labels below each`、`头像下面有` | 人物数量与姓名标签对应 |
| R2.5 | 信息图解 | `brand identity system presentation board`、`色彩规范`、`字体规范`、`安全留白` | 品牌规范板的独立说明槽位；不因普通 `color palette` 命中 |
| R2.6 | 信息图解 | `exactly N … labels`、`each panel/card`、`strict 50/50 split`、`N 套`、`名牌标注姓名`、`SSR SR R 分级` | 重复单元的数量、顺序与说明绑定 |
| R3.1 | 平面传播 | `campaign/travel/city poster`、`海报`、`宣传单`、`广告图` | 海报广告传播目的明确 |
| R3.2 | 平面传播 | `thumbnail`、`cover`、`flyer`、`bold typography`、`brand identity`、`packaging label/design`、`app icon` | 封面、字标、品牌和包装传播层级；包装仅描述材质时不命中 |
| R3.3 | 平面传播 | `campaign`、`main/giant headline`、`high CTA`、`主标题`、`卖点` | 标题、CTA 或卖点吸引注意；普通“广告风格”不足以命中 |
| R4.1 | 场景叙事 | `two characters`、`multiple characters`、`battle`、`chasing`、`couple`、`hairstylist`、`情侣`、`逗弄一只` | 多主体动作及相互关系；`crowded` 不会误命中 `crowd` |
| R4.2 | 场景叙事 | `cinematic scene`、`worldbuilding`、`palace`、`直播起舞`、`建筑空间`、`室内空间` | 空间重构、世界设定或情节 |
| R5.1 | 主体造型 | `portrait`、`product`、`character`、`selfie`、`人像`、`商品` | 主体保真且没有更高优先级核心 |
| R5.0 | 主体造型 | 无以上命中 | 可解释兜底，使用较低置信度 |

## 4. 置信度、复核与金标

规则置信度表示规则证据强弱，不代表外部标注一致性。显式结构规则通常为 0.94–0.98，传播与场景规则为 0.91–0.97，主体关键词为 0.84，兜底为 0.72。金标 60 条由本任务执行者逐条阅读标题和完整提示词后独立判定，写入 `content/gold-classifications.json`，`review_status=reviewed`；不虚构第二标注者或仲裁人。

`node tools/check-classifications.mjs` 比较生产分类与这 60 条判定，要求至少 57/60（95%）一致。若不足，先补充通用规则并重跑；仅对仍有歧义的案例使用 `reviewedOverrides` 逐条修正。每条修正必须在 `rationale` 写明复核理由，并在 `evidence_excerpt` 保留支持该判断的短句。禁止为了让生产结果通过而修改金标。

非金标按 `SHA-256("agnes-bench-t04-review-v1:case-id")` 排序抽取 49 条（481 条的 10% 向上取整），由同一执行者复核并标记 `reviewed`，抽样过程可重现。当前两条逐条修正为：`case-525` 的 campaign 仅是肖像风格修饰，改归主体造型；`case-487` 的 character sheet 只是跨镜头参考，连续商业分镜仍归信息图解。修正理由与短证据随分类记录保存。

双人独立标注和 Cohen’s κ 由外部流程负责，`reports/classification-agreement.json` 只提供待填模板，不把单人结果伪装成双人一致性。
