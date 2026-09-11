# 桌宠生图提示词（hatch-pet 抄录 · 中英对照）

> 来源：[`openai/skills`](https://github.com/openai/skills) 仓库 `skills/.curated/hatch-pet`，提示词由 [`scripts/prepare_pet_run.py`](https://github.com/openai/skills/blob/main/skills/.curated/hatch-pet/scripts/prepare_pet_run.py) 装配。
> 整理：2026-09-11。方案背景见 [PLAN.md「方案备忘：图片桌宠动效」](PLAN.md#方案备忘图片桌宠动效--图集spritesheet)。

**原工作流（怎么用这套提示词）**：

- 三种模板：`base`（主形象，先出 1 张）→ `row`（每个状态 1 条横带，共 9 条）→ `retry`（仅接口报 Bad Request 时重试一次，压缩版）；
- 发给模型时必须**附带图片**：base 附参考图（若有）；row 必须附 canonical base（基准形象图，锁身份）+ layout guide（帧数/间距参考图）+ 原参考图；
- 提示词刻意精简：长期规则（政策、QA）留在工作流文档里，不写进 prompt；
- 变量 `{...}` 由脚本按参数装配，清单见文末。

---

## 一、Base 提示词（主形象 · 1 张）

**English**

```
Create one clean full-body reference sprite for Codex pet {display_name}.

Pet identity: {pet_notes}.
Style: {style_contract}
{brand_block}
Place a single centered pose on a perfectly flat pure {chroma_name} {chroma_key} chroma-key background. Keep the full pet visible, compact, readable at 192x208, and easy to animate. Preserve approved reference identity cues. No scenery, text, borders, checkerboard transparency, shadows, glows, detached effects, or extra props. Keep {chroma_key} and close colors out of the pet, props, highlights, and effects.
```

**中文**

```
为 Codex 宠物 {display_name} 创建一张干净的全身参考精灵图。

宠物设定：{pet_notes}。
风格：{style_contract}
{brand_block}
让宠物以单个居中姿势站在完全纯平的 {chroma_name} {chroma_key} 色度键背景上。保持全身可见、紧凑、在 192x208 尺寸下可辨认、便于制作动画。保留已确认的参考形象特征。不要场景、文字、边框、棋盘格透明底、阴影、光晕、游离特效或额外道具。宠物本体、道具、高光和特效中都不要出现 {chroma_key} 及其相近颜色。
```

> `{brand_block}`：有品牌素材时为 `Brand inspiration: {brand_line}` 一行（brand_line 与 brand_name/brand_brief 组合，含 "do not copy readable logos..." 警示语），否则为空行。

## 二、Row 提示词（每状态 1 条 · 共 9 条）

**English**

```
Create one horizontal animation strip for Codex pet `{pet_id}`, state `{state}`.

Use the attached canonical base for identity. Use the attached layout guide only for slot count, spacing, centering, and padding; do not draw the guide.

Output exactly {frames} full-body frames in one left-to-right row on flat pure {chroma_name} {chroma_key}. Treat the row as {frames} invisible equal-width slots: one centered complete pose per slot, evenly spaced, with no overlap, clipping, empty slots, labels, or borders.

Identity: same pet in every frame: {pet_notes}. Preserve silhouette, face, proportions, markings, palette, material, style, and props.
Style: {style_contract}
Animation continuity: keep apparent pet scale and baseline stable within the row unless the state itself intentionally changes vertical position, such as `jumping`. Move the pose within the slot instead of redrawing the pet larger or smaller frame to frame.

State action: {state_prompt}

State requirements:
{state_requirements}

Clean extraction: crisp opaque edges, safe padding, no scenery, text, guide marks, checkerboard, shadows, glows, motion blur, speed lines, dust, detached effects, stray pixels, or chroma-key colors inside the pet.
```

**中文**

```
为 Codex 宠物 `{pet_id}` 创建一条水平动画条带，状态为 `{state}`。

用附带的 canonical base 锁定形象。附带的 layout guide 仅用于确定格数、间距、居中和留白；不要画出参考线本身。

输出恰好 {frames} 个全身帧，排成从左到右的一行，放在纯平的 {chroma_name} {chroma_key} 背景上。把这一行视为 {frames} 个等宽的隐形格位：每格一个居中的完整姿势，均匀分布，不重叠、不裁切、不留空格、无标签、无边框。

形象：每一帧都是同一只宠物：{pet_notes}。保持剪影、脸、比例、斑纹、配色、材质、风格和道具一致。
风格：{style_contract}
动画连续性：行内保持宠物的表观大小和基线稳定，除非状态本身有意改变垂直位置（如 `jumping`）。通过移动格位内的姿势来做动作，不要逐帧把宠物画大或画小。

状态动作：{state_prompt}

状态要求：
{state_requirements}

干净抠图：边缘不透明且清晰、留足安全边距；无场景、文字、参考线痕迹、棋盘格、阴影、光晕、动态模糊、速度线、尘土、游离特效、杂散像素；宠物内部不得出现色度键颜色。
```

## 三、Retry 提示词（重试压缩版 · 每状态 1 条）

**English**

```
Create Codex pet row `{state}` for `{pet_id}`: exactly {frames} full-body frames in one horizontal strip on flat pure {chroma_name} {chroma_key}.

Use the attached canonical base for identity and the layout guide only for spacing. Same pet in every frame: {pet_notes}. Preserve silhouette, face, palette, material, proportions, markings, and props.

Keep apparent pet scale and baseline stable within the row unless the state itself intentionally changes vertical position, such as `jumping`.

Action: {state_prompt}

State requirements:
{state_requirements}

One centered complete pose per invisible slot. No text, boxes, guide marks, scenery, shadows, glows, motion blur, speed lines, dust, detached effects, stray pixels, or {chroma_key} colors in the pet.
```

**中文**

```
为 `{pet_id}` 创建 Codex 宠物行 `{state}`：恰好 {frames} 个全身帧，排成一条水平条带，放在纯平的 {chroma_name} {chroma_key} 背景上。

用附带的 canonical base 锁定形象，layout guide 仅用于间距参考。每一帧都是同一只宠物：{pet_notes}。保持剪影、脸、配色、材质、比例、斑纹和道具一致。

行内保持宠物的表观大小和基线稳定，除非状态本身有意改变垂直位置（如 `jumping`）。

动作：{state_prompt}

状态要求：
{state_requirements}

每个隐形格位一个居中的完整姿势。无文字、无方框、无参考线痕迹、无场景、无阴影、无光晕、无动态模糊、无速度线、无尘土、无游离特效、无杂散像素；宠物内部不得出现 {chroma_key} 颜色。
```

---

## 四、拼装零件

### 4.1 风格契约 `{style_contract}`

规则：`PET_SAFE_STYLE` 固定前缀 + 风格预设文本（+ 可选用户风格备注）。

**PET_SAFE_STYLE（固定前缀）**

```
Pet-safe sprite: compact full-body mascot, readable in a 192x208 cell, clear silhouette, simple face, stable palette/materials, and crisp edges for chroma-key extraction.
```

> 宠物安全精灵图：紧凑的全身吉祥物，在 192x208 格内可辨认；剪影清晰、面部简单、配色与材质稳定、边缘利落，便于色度键抠图。

**风格预设（9 种）**

- `auto` — Infer the most appropriate pet-safe style from the user request and reference images, then keep that exact style consistent across every row.
  - 根据用户请求和参考图推断最合适的宠物安全风格，然后在所有行中保持该风格完全一致。
- `pixel` — Pixel-art-adjacent digital mascot with a chunky silhouette, simple dark outline, limited palette, flat cel shading, and visible stepped edges.
  - 接近像素风的数字吉祥物：敦实剪影、简洁深色描边、有限配色、平面赛璐璐上色、可见的阶梯状边缘。
- `plush` — Soft plush toy mascot with rounded stitched forms, fuzzy fabric feel, simple sewn details, and readable toy-like proportions.
  - 柔软毛绒玩具吉祥物：圆润的缝合形体、绒布质感、简单的缝线细节、易读的玩具比例。
- `clay` — Handmade clay or polymer-clay mascot with rounded sculpted forms, soft material texture, simple features, and clean readable edges.
  - 手工黏土/塑泥吉祥物：圆润的雕塑形体、柔和的材质纹理、简洁五官、干净易读的边缘。
- `sticker` — Polished sticker mascot with bold clean shapes, crisp outline, flat colors, and minimal highlight detail.
  - 精致贴纸吉祥物：大胆干净的形块、利落描边、平涂颜色、极简高光。
- `flat-vector` — Flat vector-style mascot with simple geometric forms, crisp color areas, clean outline, and minimal shading.
  - 扁平矢量风格吉祥物：简洁几何形、利落的色块、干净的描边、极少的明暗。
- `3d-toy` — Stylized 3D toy mascot with smooth rounded forms, simple materials, clear silhouette, and no photoreal complexity.
  - 风格化 3D 玩具吉祥物：光滑圆润的形体、简单材质、清晰剪影，无照片级复杂度。
- `painterly` — Painterly mascot with simplified brush texture, readable forms, stable palette, and enough edge clarity for clean extraction.
  - 手绘笔触吉祥物：简化的笔刷质感、易读的形体、稳定的配色，边缘清晰度足够干净抠图。
- `brand-inspired` — Brand-inspired mascot using approved public or user-provided brand cues such as colors, mascot themes, and vibe while avoiding readable text or logo copying unless explicitly approved.
  - 品牌启发式吉祥物：使用经批准的公开或用户提供的品牌线索（配色、吉祥物主题、气质），避免复制可读文字或 logo，除非明确批准。

### 4.2 状态动作 `{state_prompt}`（9 条）

- `idle` — Calm low-distraction resting loop: subtle breathing, tiny blink, slight head/body bob, and only quiet persona-preserving motion.
  - 平静、低干扰的休息循环：轻微呼吸、小眨眼、头部/身体轻晃，只有安静且保持个性的动作。
- `running-right` — Dragging-right loop: show directional movement to the right through body and limb poses only.
  - 向右拖拽循环：仅通过身体和四肢的姿势表现向右的方向性移动。
- `running-left` — Dragging-left loop: show directional movement to the left through body and limb poses only.
  - 向左拖拽循环：仅通过身体和四肢的姿势表现向左的方向性移动。
- `waving` — Greeting loop: paw or limb down, raised, tilted, and returning in a friendly attention gesture.
  - 打招呼循环：爪子或肢体放下、抬起、倾斜、收回，做友好的致意手势。
- `jumping` — Hover jump loop: anticipation, lift, airborne peak, descent, and settle through body height.
  - 悬空跳跃循环：预备、起跳、空中最高点、下落、落定，通过身体高度表现。
- `failed` — Blocked/failed loop: slumped or deflated reaction with sad or closed eyes.
  - 受阻/失败循环：垂头丧气或泄气的反应，悲伤或闭眼。
- `waiting` — Needs-input loop: expectant asking pose for approval, help, or user input.
  - 等待输入循环：期待式的询问姿态，等待批准、帮助或用户输入。
- `running` — Working loop: focused active-task processing, thinking, typing, scanning, or effortful concentration; not literal foot-running, jogging, sprinting, treadmill motion, raised knees, long steps, pumping arms, or directional travel.
  - 工作循环：专注地处理任务——思考、打字、扫描或费力专注；不是字面意义上的跑步、慢跑、冲刺、跑步机动作、抬膝、大步幅、摆臂或方向性位移。
- `review` — Ready-review loop: focused inspection of completed output with lean, blink, narrowed eyes, head tilt, or paw pose.
  - 审查循环：专注检查完成的输出，用前倾、眨眼、眯眼、歪头或爪子姿势表现。

### 4.3 状态硬性要求 `{state_requirements}`（29 条）

> 装配时逐条以 `- ` 拼接到 Row / Retry 提示词里。

**[idle]**

- CRITICAL: idle is the low-distraction baseline state and the first frame is also used as the reduced-motion static pet.
  - 关键：idle 是低干扰的基准状态，其第一帧还用作减弱动效模式下的静态宠物。
- Use only subtle idle motion: gentle breathing, a tiny blink, a slight head or body bob, a very small material sway, or another quiet motion that fits the pet persona.
  - 只使用细微的待机动作：轻柔呼吸、小眨眼、头部或身体轻晃、极小的材质摆动，或其他符合宠物个性的安静动作。
- Keep the pet essentially in the same pose, facing direction, silhouette, markings, palette, and prop state across all 6 frames.
  - 全部 6 帧中，宠物保持基本相同的姿势、朝向、剪影、斑纹、配色和道具状态。
- Idle variation must stay calm but still read as animation; do not repeat effectively identical copies across the loop.
  - 待机变化必须保持平静但仍能读出动画感；不要在循环中重复实际上相同的画面。
- Do not show waving, walking, running, jumping, talking, working, reviewing, emotional reactions, large gestures, item interactions, or new props.
  - 不要出现挥手、走动、奔跑、跳跃、说话、工作、审查、情绪反应、大幅手势、物品互动或新道具。
- Feet, base, body, or object anchor should remain planted or nearly planted.
  - 脚、底座、身体或物体锚点应保持落地或基本落地。
- The first and last frames should be very close visually so the loop feels calm and does not pop.
  - 首帧和末帧在视觉上应非常接近，让循环平静、不跳变。

**[waving]**

- Show the greeting through paw, hand, wing, or limb pose only.
  - 只用爪子、手、翅膀或肢体的姿势表现打招呼。
- Do not draw wave marks, motion arcs, lines, sparkles, symbols, or floating effects around the gesture.
  - 不要把挥手线、动作弧线、线条、闪光、符号或漂浮特效画在手势周围。

**[jumping]**

- Show the jump through pose and vertical body position only: anticipation, lift, airborne peak, descent, settle.
  - 只用姿势和身体垂直位置表现跳跃：预备、起跳、空中最高点、下落、落定。
- Do not draw ground shadows, contact shadows, drop shadows, oval shadows, landing marks, dust, smears, bounce pads, or motion marks under the pet.
  - 不要在宠物下方画地面阴影、接触阴影、投影、椭圆阴影、落点痕迹、尘土、涂抹、弹跳垫或动作痕迹。
- Keep the background outside the pet perfectly flat chroma key with no darker key-colored patches.
  - 宠物以外的背景保持完全纯平的色度键，不得有更深的键色斑块。

**[failed]**

- Show failure through slumped pose, drooping ears/limbs, closed or sad eyes, and lower body position.
  - 用耷拉的姿势、下垂的耳朵/四肢、闭合或悲伤的眼睛、更低的身体位置表现失败。
- Tears, small smoke puffs, or tiny stars are allowed only if attached to or overlapping the pet silhouette and kept inside the same frame slot.
  - 眼泪、小烟团或小星星只有附着在宠物剪影上或与其重叠、且不超出同一格位时才允许。
- Do not draw red X marks, floating symbols, detached stars, separated smoke clouds, falling tear drops, dust, or other loose effects.
  - 不要画红色 X 记号、漂浮符号、分离的星星、脱离的烟团、下落的泪滴、尘土或其他松散特效。

**[waiting]**

- Show that Codex needs approval, help, or user input through an expectant asking pose.
  - 用期待式的询问姿态表现「Codex 需要批准、帮助或用户输入」。
- Keep the motion patient and readable, without turning it into ordinary idle or review.
  - 动作保持耐心、易读，不要变成普通的待机或审查。

**[running]**

- Show the pet actively working or processing, as if running a task: focused posture, busy hands or paws, purposeful bobbing, thinking motion, tool or prop motion only if already part of the pet identity, or other non-locomotion activity.
  - 表现宠物正在工作或处理中，像在执行任务：专注的姿态、忙碌的手爪、有目的的身体起伏、思考动作，仅当道具已是宠物设定的一部分时才可动道具，或其他非位移类活动。
- Do not show literal foot-running, jogging, sprinting, treadmill motion, raised knees, long steps, pumping arms, directional travel, speed lines, dust clouds, floor shadows, motion trails, or detached motion effects.
  - 不要出现字面意义上的跑步、慢跑、冲刺、跑步机动作、抬膝、大步幅、摆臂、方向性位移、速度线、尘土云、地面阴影、运动拖尾或游离动作特效。

**[review]**

- Show review through lean, blink, narrowed eyes, head tilt, or paw/hand position.
  - 用前倾、眨眼、眯眼、歪头或爪子/手的位置表现审查。
- Do not add magnifying glasses, papers, code, UI, punctuation, symbols, or other new props unless they already exist in the base pet identity.
  - 不要添加放大镜、纸张、代码、UI、标点、符号或其他新道具，除非它们已存在于基础宠物设定里。

**[running-right]**

- Show directional drag movement to the right through body, limb, and prop movement only.
  - 只用身体、四肢和道具的运动表现向右的拖拽移动。
- The row must unmistakably face and travel right.
  - 这一行必须明确无误地朝右、向右移动。
- The movement cadence must alternate visibly across the 8 frames instead of repeating one nearly static stride.
  - 8 帧的动作节奏必须明显交替，不能重复一个近乎静止的步态。
- Do not draw speed lines, dust clouds, floor shadows, motion trails, or detached motion effects.
  - 不要画速度线、尘土云、地面阴影、运动拖尾或游离动作特效。

**[running-left]**

- Show directional drag movement to the left through body, limb, and prop movement only.
  - 只用身体、四肢和道具的运动表现向左的拖拽移动。
- The row must unmistakably face and travel left.
  - 这一行必须明确无误地朝左、向左移动。
- The movement cadence must alternate visibly across the 8 frames instead of repeating one nearly static stride.
  - 8 帧的动作节奏必须明显交替，不能重复一个近乎静止的步态。
- Do not draw speed lines, dust clouds, floor shadows, motion trails, or detached motion effects.
  - 不要画速度线、尘土云、地面阴影、运动拖尾或游离动作特效。

### 4.4 色度键 `{chroma_name}` / `{chroma_key}`

- 候选（6 个）：`magenta #FF00FF`（无参考图时的默认）、`cyan #00FFFF`、`yellow #FFFF00`、`blue #0000FF`、`orange #FF7F00`、`green #00FF00`
- 自动挑选：采样参考图非透明像素 → 对每个候选色计算「与 1% 分位最近像素的距离」→ 选距离最大者（即与宠物配色冲突最小的键色）；可用 `--chroma-key #RRGGBB` 手动指定

---

## 五、变量清单

| 变量 | 含义 | 来源 |
| --- | --- | --- |
| `{display_name}` | 宠物显示名 | 参数传入或推断 |
| `{pet_notes}` | 宠物设定描述 | `--pet-notes` 或从描述 / 参考图推断 |
| `{style_contract}` | 风格契约 | PET_SAFE_STYLE + 预设（4.1） |
| `{chroma_name}` / `{chroma_key}` | 色度键名 / 色值 | 自动挑选或 `--chroma-key` |
| `{brand_block}` | 品牌灵感段（可选） | `--brand-*` 参数 |
| `{pet_id}` | 宠物标识 slug | 由名称生成 |
| `{state}` | 状态名 | 9 个固定状态 |
| `{frames}` | 帧数 | 行定义（4 / 5 / 6 / 8 帧） |
| `{state_prompt}` | 状态动作 | STATE_PROMPTS（4.2） |
| `{state_requirements}` | 状态硬性要求 | STATE_REQUIREMENTS（4.3） |

---

## 六、使用要点（整理者注）

1. **短提示词**：政策 / QA 长文不塞进 prompt，只留画面必要约束，保证模型注意力；
2. **身份靠图**：Row 不重复外貌长描述，只说 `Use the attached canonical base for identity`——一致性由参考图保证；
3. **布局靠图**：帧数 / 间距 / 居中 / 留白靠 layout guide 图片传达，文字只强调「别把参考线画出来」；
4. **负面约束写细**：一切会毁掉抠图和身份的东西都在 prompt 里点名（阴影、光晕、速度线、漂浮物、chroma 近似色、逐帧尺寸跳变）；
5. **尺度稳定单列一条**：`keep apparent pet scale and baseline stable within the row` 是帧动画不抖的关键约束。

---

## 七、应用示例：初始图 → 单状态动画（以「打盹」为例）

> 场景：给一张初始图，只要一个状态（如打盹）的动画。
> 原理：hatch-pet 的修复流程本来就是「只重生成一行」——单状态 = **基准锁身份 + 只跑 1 条 Row**，原流程 10 个生成任务只用 1~2 个。

### 7.1 三步配方

① **先决定基准怎么来**（Row 提示词第一句 `Use the attached canonical base for identity` 全靠它）：

| 情况 | 做法 |
|---|---|
| 初始图就是目标形象、风格直接可用 | 它就是 canonical base，直接进 ②（能附图的环境直接附） |
| 初始图只是参考（风格要统一 / 要净化） | 先用 Base 模板生成 1 张基准精灵图，迭代到满意 |
| 环境不支持附图（即无图生图） | 读图 → 把特征提炼成文字（品种 / 毛色 / 斑纹分布 / 体态 / 风格）→ 写进下游提示词 |

② **填一条 Row 提示词**——只改 4 处，其余原样保留（身份行、尺度稳定行、干净抠图行、负面清单都是有效约束）：

| 变量 | 打盹场景 | 说明 |
|---|---|---|
| `{state}` | `sleep` | |
| `{frames}` | `4` | 低动态循环 4~6 帧就够（idle 也才 6 帧） |
| `{state_prompt}` | 打盹动作描述 | 照 idle 的写法改写 |
| `{state_requirements}` | 打盹专属要求 | 照 idle 的要求逐条改写 |

⚠️ `{chroma_key}` 选色要**避开宠物身上的颜色**——橘猫不能选 orange `#FF7F00`，选 magenta `#FF00FF` 或 cyan。

③ **后处理**：横排条带 → 切帧 → 验透明底 / 无残留 → 入库。只要静态图可省略（见 7.4 第 2 条）。

> 说明：7.2 / 7.3 示例中，`[...]` 标出的部分即原来由变量填充的位置——使用时整体替换成自己的值；直接复制提示词时记得把方括号去掉。

### 7.2 示例 · Base 提示词（初始图需重绘成基准时才用）

**English**

```
Create one clean full-body reference sprite for [Orange].

Pet identity: [a chubby orange tabby cat with a soft rounded body, darker orange stripes, white chest patch, big sleepy amber eyes, and a thick fluffy tail].
Style: [Pet-safe sprite: compact full-body mascot, readable in a 192x208 cell, clear silhouette, simple face, stable palette/materials, and crisp edges for chroma-key extraction. Style `plush`: Soft plush toy mascot with rounded stitched forms, fuzzy fabric feel, simple sewn details, and readable toy-like proportions.]

Place a single centered pose on a perfectly flat pure [magenta] [#FF00FF] chroma-key background. Keep the full pet visible, compact, readable at 192x208, and easy to animate. Preserve approved reference identity cues. No scenery, text, borders, checkerboard transparency, shadows, glows, detached effects, or extra props. Keep [#FF00FF] and close colors out of the pet, props, highlights, and effects.
```

**中文**

```
为 [Orange] 创建一张干净的全身参考精灵图。

宠物设定：[一只胖乎乎的橘色虎斑猫，身体圆润柔软，深橘色条纹，胸口有白色斑块，一双困倦的琥珀色大眼睛，尾巴又粗又蓬松]。
风格：[宠物安全精灵图：紧凑的全身吉祥物，在 192x208 格内可辨认；剪影清晰、面部简单、配色与材质稳定、边缘利落，便于色度键抠图。风格 `plush`：柔软毛绒玩具吉祥物——圆润的缝合形体、绒布质感、简单的缝线细节、易读的玩具比例。]

让宠物以单个居中姿势站在完全纯平的 [magenta] [#FF00FF] 色度键背景上。保持全身可见、紧凑、在 192x208 尺寸下可辨认、便于制作动画。保留已确认的参考形象特征。不要场景、文字、边框、棋盘格透明底、阴影、光晕、游离特效或额外道具。宠物本体、道具、高光和特效中都不要出现 [#FF00FF] 及其相近颜色。
```

> `Pet identity` 段是从初始图提炼的特征；想保持初始图原风格，把预设换成 `auto`。

### 7.3 示例 · Sleep 行提示词（4 帧，变量已填）

**English**

```
Create one horizontal animation strip for Codex pet `[orange]`, state `[sleep]`.

Use the attached canonical base for identity. Use the attached layout guide only for slot count, spacing, centering, and padding; do not draw the guide.

Output exactly [4] full-body frames in one left-to-right row on flat pure [magenta] [#FF00FF]. Treat the row as [4] invisible equal-width slots: one centered complete pose per slot, evenly spaced, with no overlap, clipping, empty slots, labels, or borders.

Identity: same pet in every frame: [a chubby orange tabby cat with a soft rounded body, darker orange stripes, white chest patch, big sleepy amber eyes, and a thick fluffy tail]. Preserve silhouette, face, proportions, markings, palette, material, style, and props.
Style: [Pet-safe sprite: compact full-body mascot, readable in a 192x208 cell, clear silhouette, simple face, stable palette/materials, and crisp edges for chroma-key extraction. Style `plush`: Soft plush toy mascot with rounded stitched forms, fuzzy fabric feel, simple sewn details, and readable toy-like proportions.]
Animation continuity: keep apparent pet scale and baseline stable within the row unless the state itself intentionally changes vertical position, such as `jumping`. Move the pose within the slot instead of redrawing the pet larger or smaller frame to frame.

State action: [Sleeping loop: the cat settles into a curled or loafed resting pose with closed eyes, slow deep breathing, and only a tiny ear or tail-tip twitch; calm and low-distraction.]

State requirements:
[- Keep the cat essentially in the same pose, facing direction, silhouette, markings, palette, and prop state across all 4 frames; a slight breathing rise and fall is enough.
- Use only subtle sleeping motion: slow breathing, closed eyes, a tiny ear twitch or tail-tip flick. The loop must still read as animation, not near-identical copies.
- Do not show waking, standing, stretching, walking, emotional reactions, large gestures, or new props.
- The first and last frames should be very close visually so the loop feels calm and does not pop.]

Clean extraction: crisp opaque edges, safe padding, no scenery, text, guide marks, checkerboard, shadows, glows, motion blur, speed lines, dust, detached effects, stray pixels, or chroma-key colors inside the pet.
```

**中文**

```
为 Codex 宠物 `[orange]` 创建一条水平动画条带，状态为 `[sleep]`。

用附带的 canonical base 锁定形象。附带的 layout guide 仅用于确定格数、间距、居中和留白；不要画出参考线本身。

输出恰好 [4] 个全身帧，排成从左到右的一行，放在纯平的 [magenta] [#FF00FF] 背景上。把这一行视为 [4] 个等宽的隐形格位：每格一个居中的完整姿势，均匀分布，不重叠、不裁切、不留空格、无标签、无边框。

形象：每一帧都是同一只宠物：[一只胖乎乎的橘色虎斑猫，身体圆润柔软，深橘色条纹，胸口有白色斑块，一双困倦的琥珀色大眼睛，尾巴又粗又蓬松]。保持剪影、脸、比例、斑纹、配色、材质、风格和道具一致。
风格：[宠物安全精灵图：紧凑的全身吉祥物，在 192x208 格内可辨认；剪影清晰、面部简单、配色与材质稳定、边缘利落，便于色度键抠图。风格 `plush`：柔软毛绒玩具吉祥物——圆润的缝合形体、绒布质感、简单的缝线细节、易读的玩具比例。]
动画连续性：行内保持宠物的表观大小和基线稳定，除非状态本身有意改变垂直位置（如 `jumping`）。通过移动格位内的姿势来做动作，不要逐帧把宠物画大或画小。

状态动作：[打盹循环：猫蜷起身子或揣手趴好进入休息姿势，闭眼、缓慢深呼吸，只有极小的耳朵或尾巴尖抽动；平静、低干扰。]

状态要求：
[- 全部 4 帧中，猫保持基本相同的姿势、朝向、剪影、斑纹、配色和道具状态；有轻微的呼吸起伏就够了。
- 只使用细微的打盹动作：缓慢呼吸、闭眼、耳朵轻抽或尾巴尖轻摆。循环仍要读得出动画感，不能是几乎相同的复制品。
- 不要出现醒来、站立、伸懒腰、走动、情绪反应、大幅手势或新道具。
- 首帧和末帧在视觉上应非常接近，让循环平静、不跳变。]

干净抠图：边缘不透明且清晰、留足安全边距；无场景、文字、参考线痕迹、棋盘格、阴影、光晕、动态模糊、速度线、尘土、游离特效、杂散像素；宠物内部不得出现色度键颜色。
```

> 四条 State requirements 由 idle 的要求逐条改写而来：句式和颗粒度照抄，只换语义。
> 环境不能附 layout guide 图时，把 `Use the attached layout guide ...` 一句删掉即可——格位布局由 `Treat the row as 4 invisible equal-width slots` 那段文字兜住。

### 7.4 三个提醒

1. **无图生图环境**：「发一张图 → 生成动画」实际是「读图 → 特征文字 → 文生图」，结果是**神似**（特征对，细节不保证 1:1）；风格越简单（贴纸 / 像素 / 扁平），复刻越稳。
2. **只要静态打盹图**：不需要 Row 模板——Base 模板里 `Place a single centered pose` 后加一句 `Show the cat in a curled sleeping pose with closed eyes.` 即可。
3. **另一条路（不用这套提示词）**：图生视频特效（如 `napme`「倒头就是睡」模板）可直接「传图 → 动起来」，但产物是视频、可控性差、不好切精灵帧——适合做着玩，不适合做桌宠资源。
