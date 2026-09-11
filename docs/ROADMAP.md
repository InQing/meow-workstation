# 后期计划

> 记录「还有什么没做、为什么、做到什么程度算完」。**改需求时先来这里对一下**，避免重复决策。

---

## 现状

核心玩法已闭环，`npm start` 可跑，已推 GitHub。阶段全景：

| 阶段  | 内容                              | 状态 |
| --- | ------------------------------- | -- |
| 1–2 | 桌宠窗口、像素猫渲染、状态机、拖动与缩放            | ✅  |
| 3   | 番茄钟（主进程时间源 + 三路同步 + 托盘 tooltip） | ✅  |
| 4   | 好感养成（摸头 / 喂食 / 等级解锁）            | ✅  |
| 5   | 面板 + 集卡（17 卡图鉴、抽卡保底、设置）         | ✅  |
| 6   | 视觉改造：复古街机 CRT                   | ✅  |
| 7   | 游戏中心 + 鱼干突袭                     | ✅  |
| 8   | 反应力测试；番茄进度条 → 左侧沙漏              | ✅  |
| —   | 项目命名、README、架构文档、推 GitHub       | ✅  |

**没做完的共同点**：大部分是「等素材」或「等打包」，功能层面基本没有阻塞项。

---

## 后期需求-优先级总览

| 优先级    | 事项                                | 阻塞谁        | 工作量        |
| ------ | --------------------------------- | ---------- | ---------- |
| **P0** | [卡面图案接入](#p0-1-卡面图案接入)            | 集卡玩法的"完成度" | 中（接口已预留）   |
| **P0** | [猫图案接入 + 选猫入口](#p0-2-猫图案接入--选猫入口) | 桌宠的本质卖点    | 中（缺 UI 入口） |
| **P1** | [透明区点击穿透](#p1-1-透明区点击穿透)          | 日常使用手感     | 小（接口已预留）   |
| **P1** | [打包成 exe](#p1-2-打包成-exe)          | 给别人用       | 中          |
| **P2** | [鱼干突袭加破纪录奖金](#p2-1-鱼干突袭补破纪录奖金)    | 玩法平衡       | 小          |
| **P2** | [内容扩展](#p2-2-内容扩展)                | 留存         | 大          |
| **P3** | [工程债清理](#已知工程债)                   | 维护成本       | 小          |

---

## P0-1 卡面图案接入

**现状**：`src/panel/panel-core.js` 的 `cardFace()` 只画占位（🐾 + 「图案待接入」）。`assets/cards.json` 里 17 张卡已经带全字段：

```json
{ "id": "orange_worker", "name": "橘猫·打工人", "rarity": "N",
  "cat": "orange", "pose": "work", "accessory": null,
  "bg": "#fdf0dc", "desc": "工位常驻，陪工第一名。", "sparkle": false }
```

**接入方式**：把 `cardFace()` 里的占位 `<span>` 换成 canvas 渲染 —— 按 `card.cat` 读 `assets/cats/<cat>.json`，取 `animations[card.pose].frames[0]`，叠 `accessory` 层，铺 `card.bg` 底色。**接口不用变**，`cardFace()` 的调用方（图鉴、抽卡动画、详情弹层）都不用动。

**注意**：

- 渲染层读素材走 `window.mgw.readJson()`（不能 `require`）；已读过的猫图建议在 `panel-core` 里做个缓存，图鉴一屏 17 张会重复读。
- 未拥有的卡继续走剪影（`locked` 分支已经是 `?` 占位，改成暗色剪影更好）。
- `cards.json` 里有引用但**尚无素材**的 cat（`white` / `rainbow` 等），要有兜底，别渲染成空白。

**验收**：图鉴 17 张卡都能看到图案；未拥有的是剪影；抽卡翻牌动画里能看到图案。

---

## P0-2 猫图案接入 + 选猫入口

**现状**：`assets/cats/` 下有 5 只（orange / cow / black / calico / tabby），都是 `tools/gencat.js` 程序化生成的**占位**。素材 schema：

```
{ id, name, size: 24, palette: { 字符: "#rrggbb" }, animations: {...} }
每帧 = 24 行 × 24 字符；'.' 表示透明；palette 通常 8 色
动画 9 组：idle / sleep / work / happy / shock / annoyed / eat / stretch / belly
```

**接入方式**：`src/pet/pet.js` 的 `loadCat(id)` 已经是**按需读取**（`assets/cats/<id>.json`，有 `catCache` 缓存）—— 换素材只要**覆盖同名文件**，代码一行不用改。

**但缺一个玩家能用的入口**：`loadCat()` 目前只被两处调用 —— 启动时读 `save.currentCat`，以及右键菜单的调试项 `MGW_DEBUG.setCat()`。普通玩家没有切猫的办法。

**要做**：面板里加「选猫」入口（放图鉴 tab 顶部，或独立一格）。候选：拥有该猫对应卡才解锁，能顺手把集卡和桌宠连起来。

**验收**：玩家能自己在面板里换猫；换完立刻生效并重启保持；被锁的猫有明确提示。

> 素材制作工具链：`tools/png2grid.js`（生图 → 24×24 网格）、`tools/render-preview.js`（渲染放大 PNG 看效果）、`tools/gencat.js`（程序化派生动画帧）。

---

## P1-1 透明区点击穿透

**问题**：桌宠窗口的鼠标命中判定是**整个窗口矩形**，包括透明区域。窗口现在 242px 宽（左留白 4.5 格站沙漏、右留白 1.75 格），透明遮挡面积比早期更大。鼠标划过猫旁边的空白会挡住下层窗口的点击。

**接口已预留**：`src/pet/catRenderer.js:151` 有 `isOpaqueAt(x, y)` —— 判断画布某点是不是不透明像素。

**思路**：Electron 的 `win.setIgnoreMouseEvents(true, { forward: true })` 可以让窗口对鼠标"透明"但仍收到 `mousemove`，据此动态开关：

```
渲染层 mousemove → 命中测试（猫身 / 沙漏 / 气泡 / 按钮栏 / 手柄 任一） → 通知主进程
  命中   → setIgnoreMouseEvents(false)   // 正常接收点击
  未命中 → setIgnoreMouseEvents(true, {forward:true})  // 穿透
```

**注意**：

- **不能整窗 ignore**，否则按钮栏、拖拽手柄全点不到。
- 按钮栏是 hover 浮现的 —— 鼠标移出猫身后它自己会隐，但判断命中时要把它算进去，否则"刚移向按钮就消失"。
- 拖动过程中必须保持不 ignore，不然拖到一半事件断了。
- 换个平台/DPI 行为可能不同，**必须实机验证**（`transparent` 窗口在沙箱里连量矩形都会崩，见 `electron-ui-smoke` skill）。

**验收**：鼠标划过猫旁边的空白能点到下层窗口；点猫身、按钮、手柄、拖拽全部照常。

---

## P1-2 打包成 exe

**现状**：不打包，`npm start` 直接跑。

**选型**：`electron-builder`（配置简单、产物全）或 `electron-forge`。

**必须注意的三件事**：

1. **`productName` 决定 `userData` 目录** —— 现在是「喵工位」，打包后必须保持同名，否则读不到开发期的存档。改名前先迁档。
2. **`save.js` 的 `miaogongwei-save.json` 文件名不能动**（见 README 禁区）。
3. 需要准备 icon（`build/icon.ico`，多尺寸）。当前托盘图标是程序化生成的 16×16 PNG base64，正式版应该换成真素材。

另外打包后 `app.isPackaged` 为 true，`assets/` 要确认被打进 asar 且 `assets:read` 的路径解析仍然正确（目前用 `path.resolve(__dirname, ...)` 限制在 assets 内，asar 下需验证）。

**验收**：双击安装/免安装版能跑；存档落在 `%APPDATA%\喵工位\`；托盘、通知、置顶都正常。

---

## P2-1 鱼干突袭补破纪录奖金

**现状**：反应力测试有「破纪录奖金递增」（第 N 次破纪录 = 40×N，封顶 400），**鱼干突袭只有基础结算**（金币 = 得分 × 0.10），缺少"越破越值钱"的正反馈。

**要做**：给鱼干也加同款机制。`config.fish` 加两个键（`baseCoins` / `recordCoinsStep`），`src/shared/games/fish.js` 的结算函数对齐 `reflex.js` 的写法，`stats` 里记录 `gameBreaks`。

**注意**：改数值要同步 `tools/fish-selftest.js` 的断言，以及 `tools/panel-smoke.js` 里硬编码的期望金币数。

---

## P2-2 内容扩展

按性价比排：

1. **更多小游戏** —— 结构已经完全铺好，照[架构文档的约定](ARCHITECTURE.md#四模块与全局名)加即可：逻辑 `shared/games/<name>.js`、UI `tabs/games/<name>.js`、配置 `config.<name>`、自测 `tools/<name>-selftest.js`。候选：记忆翻牌、24 点、点泡泡、抄单词。
2. **成就系统** —— 复用 `stats`，达成条件集中放 `config`，弹 toast + 桌宠演出。
3. **数据统计页** —— `pomodoro.total` / `today` 已有，加一个简单的周视图（纯 DOM 柱状图即可，不要引图表库）。
4. **新台词与天气/时段感知**（早上/深夜不同台词）—— `speech.json` 加键，`pet.js` 的 `say()` 按时间分池。

---

## 已知工程债

| # | 问题                                                                                                                                               | 影响                                                  | 修法                                     |
| - | ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------- | -------------------------------------- |
| 1 | **`pngjs` 未写进 `package.json`** —— `tools/png2grid.js` 和 `tools/render-preview.js` 都 require 它，但依赖表里只有 electron。（已实测：`node_modules/pngjs` 存在但未声明） | 新克隆 → `npm install` → 这两个工具**直接报错**，而 README 还在推荐它们 | `npm i -D pngjs`，或把这两个脚本改成可选工具并注明      |
| 2 | **`DEFAULT_SAVE` 与运行时键不同步** —— `settings.petScale`、`stats.bestReflexMs`、`stats.reflexBreaks` 是功能写入的，没进默认档                                        | 靠 `mergeDeep` 兜住，能跑；但默认值语义不清，`save.js` 读起来会漏        | 补进 `src/main/save.js` 的 `DEFAULT_SAVE` |
| 3 | **`audio.js` 保留但零调用**                                                                                                                            | 低（注释已说明），但容易让新人以为可以去用                               | 要么删，要么在文件头明确标「预留，勿调用」                  |
| 4 | **桌宠 hover 判定是整个窗口** —— 左留白加宽后透明区更大                                                                                                              | 鼠标从猫左侧划过容易误弹按钮栏                                     | 与 P1-1 的点击穿透一起做，收敛到猫身轮廓                |
| 5 | **`MGW_` 前缀与项目名不一致** —— MGW = MiaoGongWei，现已改名 meow-workstation，40+ 处                                                                            | 纯观感问题                                               | **刻意不改**：内部符号，收益低、漏改即崩                 |
| 6 | `tools/_smoke/` 截图产物无清理机制                                                                                                                        | 低，已被 `.gitignore`                                   | 加个 `npm run clean:smoke`               |
| 7 | `assets/ref/` 存着早期 AI 生图参考（实测 248KB）                                                                                                             | 无                                                   | 已随仓库公开；不想要就删                           |

---

## 待拍板

需要老大决定的开放问题：

1. **面板要不要加「选猫」页？** —— 没有入口的话，5 只猫只有调试菜单能切（见 P0-2）。
2. **高级池概率是否要调？** —— 当前 SR 20% / SSR 5%（普通池是 9% / 1%），偏高，可能让普通池失去意义。
3. **要不要做云存档 / 多设备同步？** —— 现在是纯本地单机。
4. **有没有打包分发的目标平台？** —— 只 Windows，还是也要 macOS。
