# Agnes Bench 数据契约

## 1. 边界与存储

本站是静态构建的数据视图。`content/` 保存人工、规则或批处理产生的源数据，`generated/` 保存可重建的派生数据；页面和加载器只读这两个目录，不在运行时请求接口，也不在代码中内置案例。

`schemas/` 使用 JSON Schema 2020-12。`content/taxonomy.json` 是唯一一级分类定义；案例原始 `category/styles/scenes` 仅保留在 `Case.source`，不参与五类冲突判定。`schemas/examples/contract-example.json` 是合成结构示例，不是案例、实验或结论数据，禁止导入展示内容。

## 2. 分类与关联

一级分类固定为 `subject-form`、`scene-narrative`、`graphic-communication`、`information-diagram`、`interface-document`。每条 `Classification` 恰有一个 `primary_category_id`，并记录证据短句、置信度、分类器版本和复核状态。

冲突按 `interface-document → information-diagram → graphic-communication → scene-narrative → subject-form` 依次判断，即先操作流，再逐槽核对、传播层级、空间叙事，最后主体造型。`decision_order` 与该顺序一致。

`Case.case_id` 是内容关联主键。`Classification`、`Fingerprint`、`Guide`、`Decision` 都通过 `case_id` 回连；意图、多视图和网格等是可多选结构属性，不扩张一级分类。

## 3. 实体文件

| Schema | 对应内容 | 关键约束 |
|---|---|---|
| `taxonomy.schema.json` / `category.schema.json` | `content/taxonomy.json` | 五类齐全，通俗解释和使用场景必填 |
| `case.schema.json` | `content/cases.json` | 主键、封面与来源必填，分类和指纹不重复内嵌 |
| `classification.schema.json` | `content/classifications.json` | 一个案例一条当前一级分类，保留模型与复核信息 |
| `fingerprint.schema.json` | `content/fingerprints.json` | 主体数、布局、关系、文本槽、输入方式和比例显式记录 |
| `guide.schema.json` | `content/case-guides.json` | 适合、不适合、共性难点和迁移写法均至少一项 |
| `asset.schema.json` | 来源资产与 `generated/assets.json` | URI、尺寸、内容哈希和来源必填 |
| `prompt-version.schema.json` | `content/prompt-versions/*.json` | 文本内容变化追加 `pv-nnn`，旧版本不可覆盖 |
| `experiment-version.schema.json` | `content/experiment-versions.json` | 实验臂、模型或评分口径变化追加 `ev-nnn` |
| `run.schema.json` | `content/runs.json` | 绑定实验版本、臂、案例、提示词版本、盲标和结果图 |
| `score-revision.schema.json` | `content/score-revisions.json` | 评分修订追加，保留被替代修订和证据图 |
| `decision.schema.json` | `content/decisions.json` | 决策、控制目标、前后短证据、换法影响和证据级别必填 |
| `conclusion-version.schema.json` | `generated/conclusions.json` | 结论由指定实验版本和评分快照生成，不手改历史数字 |

集合文件的元素分别符合对应 Schema；文件集合名称不表示可以省略字段。未映射或无法回连的证据进入隔离清单，不进入展示数字。

## 4. 版本规则

- `PromptVersion.prompt_version_id` 使用 `case-id/pv-nnn`，`version_no` 从 1 递增。首版 `parent_version_id=null`，后续版本指向直接父版本；`content_sha256` 对完整文本计算。
- `ExperimentVersion.experiment_version_id` 使用 `experiment-id/ev-nnn`。每次冻结实验设计后不再原地修改；`arms[].prompt_version_ids` 必须显式列出输入版本。
- `Run` 不可脱离 `experiment_version_id` 和 `prompt_version_id` 存在。`blind_id` 只来自可信映射，禁止由图片或哈希猜测；`result_asset_ids` 至少一项。
- `ScoreRevision.revision` 从 1 递增。首版 `supersedes_id=null`，后续版本指向被替代评分；同一 Run 只能有一个 `is_current=true`，历史修订保留。
- `ConclusionVersion` 记录 `source_experiment_version_ids`、`score_snapshot_hash`、`generator_version` 和 `evidence_run_ids`。它是指定历史输入的生成视图，旧 ID 与旧快照必须可重算。

## 5. 证据规则

`Decision.evidence_level` 只有三种：

- `tested`：有受控实验支持，`observed_effect` 必填，`evidence_refs` 至少引用一个 `run`。
- `observed`：有实际结果观察但不宣称受控因果，`observed_effect` 必填，且至少引用一个 `run`。
- `inferred`：由提示词和结构规则推断，`observed_effect` 必须为 `null`，至少引用一个 `prompt_version`，不得包装成实测。

所有证据引用使用既有实体 ID。`Run.result_asset_ids` 连接具体结果图，`ScoreRevision.evidence_asset_ids` 连接评分所依据的图，`ConclusionVersion.evidence_run_ids` 使每个汇总数字可逐 Run 下钻。短摘录只保留支撑判断的必要片段，完整提示词默认折叠且不提供整段复制入口。

## 6. 校验与共享示例

在仓库根执行：

```sh
node tools/validate-contracts.mjs
```

校验器无第三方运行时依赖，会检查五类及冲突顺序、全部合成示例、跨实体引用和关键反向用例。它会逐项删除 `Decision`、`Run`、`ScoreRevision`、`ConclusionVersion` 的证据或版本字段并要求 Schema 拒绝，同时检查推断与实测的证据语义。新增实体字段时，应同步更新 Schema、合成示例和本文件。
