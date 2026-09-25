# Agnes 结构化提示词模板协议

> Prompt as Code：把散文式提示词拆成**可组合的原子段**，按槽位填变量即可稳定复现。
> 以下骨架均来自本库实测案例的归纳，随案例增长持续修订。

## 通用图片骨架（agnes-image-2.5-flash）

```
[画质总纲] + [主体] + [主体细节] + [环境/背景] + [光线] + [镜头/构图] + [风格词] + [负面约束(可选)]
```

| 槽位 | 实测有效词 |
|---|---|
| 画质总纲 | 超写实 / photorealistic / ultra-detailed / 2K高清 |
| 光线 | cinematic soft light / 柔和逆光 / golden hour |
| 镜头 | 85mm / 浅景深虚化 / 居中构图 / 大量留白 |
| 风格 | Studio Ghibli watercolor / 扁平设计 / 电商主图风格 |
| 中文文字渲染 | 用「」引号包住要渲染的文字，如 大字标题「夏日限定」 |

### 实测案例映射

- 摄影写实 → IMG-001：`A serene mountain lake at sunrise, photorealistic, cinematic soft light, 85mm`
- 海报排版 → IMG-002：中文海报（「」文字 + 大量留白 + 扁平设计）
- 插画艺术 → IMG-003：`watercolor + soft visible brush strokes + hand-painted texture` 三词叠加
- 电商产品 → IMG-004：`低饱和高级质感 + 浅景深虚化 + 电商主图风格`（中文长 prompt 直出可用）

## 视频骨架 A：v2.0 帧制（text-to-video）

```
[镜头运动] + [主体] + [环境] + [时间/氛围]
```

| 槽位 | 实测有效词 |
|---|---|
| 镜头运动 | drone shot slowly rising / slow push-in / pan left |
| 时间氛围 | at dawn / at sunset / misty |

- 实测案例 → VID-001：`A drone shot slowly rising over a misty pine forest at dawn`
- 参数：`num_frames` 需满足 8n+1 且 ≤441；`frame_rate` 1-60；支持 `negative_prompt`；分辨率最高 1080p

## 视频骨架 B：2.5-flash 秒制（reference 钉场景）

```
[运镜方式] + [场景主体] + [氛围细节(雾/涟漪/光)] + [视差/物理感]
```

- 实测案例 → VID-002：`Slow cinematic push-in over the mountain lake..., mist drifting..., gentle ripples catching the golden light, subtle parallax between foreground rocks and background peaks`
- 参数：`seconds` 4-12（字符串）、固定 720P、`mode=reference` 传 ≤5 张参考图
- 实测发现：`video_id == task_id`；非 text 模式轮询必须带 `model_name`

## 已知翻车点（持续记录）

- （待补充）使用中发现的失败模式记到这里，附案例 id
