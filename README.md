# 喵工位 · meow-workstation

一只透明的猫趴在你桌面上（内置像素猫，或你上传的图片）。它不打扰你——你专注，它就在旁边安静地漏沙；你摸鱼，它就陪你玩两局。

> Electron 桌宠 · 番茄钟 · 好感养成 · 集卡 · 游戏中心  
> 项目标识 `meow-workstation`（英文）/ `喵工位`（显示名）

---

## 给玩家

### 跑起来

需要 Node.js 18+。

```bash
npm install
npm start
```

> **npm 12 注意**：根目录的 `.npmrc` 把 registry 指向 npmmirror —— `package-lock.json` 里的 tarball 主机就是它；主机不一致会被 npm 12 的 `allow-remote=none` 当成 remote 包拒装（`EALLOWREMOTE`）。electron 的安装脚本（下载二进制）已预批在 `package.json` 的 `allowScripts`；**换 electron 大版本后要重新 `npm install-scripts approve electron`**，否则二进制不会下载。

不打包、不安装，`npm start` 就是 `electron .`。首次启动时猫出现在屏幕**右下角**，托盘同时出现一个猫图标。

想让它开机自启，把 `npm start` 做成快捷方式丢进启动目录即可（自带打包在[计划](docs/PLAN.md)里）。

### 怎么用

| 操作         | 效果                            |
| ---------- | ----------------------------- |
| 拖猫身体       | 移动位置（贴边或高 DPI 屏也不会跑偏）         |
| 拖右下角手柄     | 调整大小（每格 4~16 像素，自动记住）         |
| 点一下猫       | 摸头：+2 好感，8 秒冷却                |
| 猫下方按钮行     | 🐟 喂鱼干 / 📖 打开面板 / 🍅 开始·暂停番茄 |
| 右键猫 / 右键托盘 | 菜单：开关番茄、跳过阶段、打开面板、隐藏、退出       |
| 单击托盘图标     | 显示 / 隐藏猫                      |

按钮行平时隐藏，鼠标移到猫身上才浮现。摸头摸太勤（1 分钟内超过 5 次）它会嫌弃你，接下来 30 秒不理你。

### 桌宠形象

内置 5 只像素猫；也可以上传你自己的图片当桌宠（面板 →「桌宠」页）：

- 选一张**透明底方形图**（PNG/WebP 最好）：非方形会自动居中裁方，超过 1024px 自动缩小，统一转 PNG 存到 `%APPDATA%\喵工位\pets\`（不进仓库）
- 一个图片桌宠 = 1 张必传的**默认形象** + 9 个状态槽位（待机 / 打盹 / 专注 / 开心 / 炸毛 / 嫌弃 / 干饭 / 伸懒腰 / 翻肚皮）；某个状态没传图，就自动用默认形象
- 「我的猫」里的每只都能**改名 / 删除**；内置猫不参与改名（它们的名字是固定的）
- 图片桌宠是静态的（单张图）；让它动起来的方案（图集帧动画）在[后期计划](docs/PLAN.md)里

### 玩法

**番茄钟** — 猫左侧有个沙漏：**上半的沙就是剩余时间**，漏完即到点。专注 25 分钟 → 自动进 5 分钟休息，到点弹系统通知。完成一个番茄：**+30 金币、+1 抽卡券、+10 好感**。暂停时沙漏灰掉静止、小字显示「暂停」（能分清"暂停"和"这局结束了"）。时长在面板「设置」里改。**专注期间气泡静默**：摸头、喂食、游戏反应都不冒话，只有沙漏安静陪工；暂停 / 继续 / 番茄完成的提示照常。

**好感养成** — 摸头、喂鱼干、完成番茄都涨好感，Lv1~Lv10。升级解锁新台词与动作。

**集卡** — 17 张猫卡（N 6 / R 5 / SR 4 / SSR 2）。

| 池子            | 价格             | 概率                              |
| ------------- | -------------- | ------------------------------- |
| 普通            | 1 抽卡券 或 150 金币 | N 60% / R 30% / SR 9% / SSR 1%  |
| 高级（好感 Lv5 解锁） | 200 金币         | N 40% / R 35% / SR 20% / SSR 5% |

**50 抽内必出 SSR**（保底）。重复卡自动转金币（N 20 / R 60 / SR 200 / SSR 800）。

> 卡面图案尚未接入，图鉴里是占位图案 —— 功能完整可玩，等你上传素材。

**游戏中心** — 面板「游戏」页里选：

- **鱼干突袭** — 20 秒内点鱼干、躲炸弹。金鱼分最高但只停 0.8 秒；连击每 5 连涨一档倍率（上限 ×2）。金币 = 得分 × 0.10。
- **反应力测试** — 5 次取平均。变色前点算抢跑，本次作废重来。每局基础 10 金币，**破纪录奖金递增**（第 N 次破纪录 = 40×N，封顶 400）。

结算时桌面上的猫会跟着夸你或吐槽你。

---

## 给开发者

### 技术栈

**Electron 33 + 原生 JS**。无框架、无构建步骤、无 CDN（面板带 CSP，离线必须能跑）。

纯逻辑层写成 UMD 模块，所以**不需要 Electron 就能跑自测**——这是这套结构的核心好处：数值和判定逻辑全在 `src/shared/`，可以拿 node 直接测。

### 目录结构

```
main.js                 主进程入口：窗口、托盘、菜单、IPC 中枢
preload.js              契约层：白名单 API → window.mgw（contextIsolation）
src/
  shared/               纯逻辑层（UMD，node 可 require 自测）
    config.js           全局数值表 —— 改数值只改这里（含桌宠状态 / 槽位 / 内置猫清单）
    petAssets.js        图片桌宠纯逻辑：裁方形、校验、来源解析、pet.json 校验
    gacha.js            抽卡：概率、保底、重复转金币
    games/              小游戏逻辑
      fish.js           鱼干突袭（MGW_Fish）
      reflex.js         反应力测试（MGW_Reflex）
    audio.js            音效（当前全局关闭，零调用）
  main/                 主进程模块
    save.js             存档：深合并 patch、2s 防抖、写前备份、跨天清零
    pomodoro.js         番茄钟：唯一时间源，250ms tick 广播
    pets.js             图片桌宠仓库：userData/pets/、导入归一化（nativeImage）
  pet/                  桌宠窗口
    index.html
    pet.js              组装：气泡、沙漏、缩放、IPC 绑定、桌宠来源分流
    catRenderer.js      画像素猫：24×24 网格 → Canvas 整数倍缩放
    imageRenderer.js    画图片桌宠：单图铺满 24 格显示盒（与 catRenderer 同接口）
    stateMachine.js     状态机（持续态 / 一次性态 / 定时态，清单在 config）
    affection.js        好感与经济：摸头、喂食、等级解锁
    dragHandler.js      拖动（阈值判定，区分点击与拖拽）
    pet.css
  panel/                面板窗口
    index.html
    panel-core.js       公共层：MGW_Panel（存档、稀有度、卡面、弹层）
    panel.js            tab 调度
    tabs/               图鉴 / 抽卡 / 桌宠 / 游戏中心 / 设置
    tabs/games/         游戏 UI（fish.js、reflex.js —— 与 shared/games/ 一一对应）
    panel.css
assets/
  cards.json            17 张卡的定义（cat / pose / accessory / bg）
  cats/*.json           猫的像素素材（24×24 网格 + palette + 动画帧）
  speech.json           台词池
tools/                  自测、冒烟、素材工具（见下）
docs/                   架构文档、后期计划
```

**分层约定**：逻辑层只管「算」，UI 层只管「画和计时」。`src/shared/` 里不出现 DOM，`src/panel/tabs/` 里不出现概率计算。跟着这个走，新功能就自带自测能力。

### 命令

```bash
npm start          # 跑起来

npm test           # 六个纯逻辑层自测（不需要 electron）
```

UI 冒烟需要 electron（走真窗、真 DOM，跑完出截图到 `tools/_smoke/`）：

```bash
unset ELECTRON_RUN_AS_NODE && MGW_DISABLE_GPU=1 ./node_modules/electron/dist/electron.exe tools/panel-smoke.js
unset ELECTRON_RUN_AS_NODE && MGW_DISABLE_GPU=1 ./node_modules/electron/dist/electron.exe tools/pet-smoke.js
unset ELECTRON_RUN_AS_NODE && MGW_DISABLE_GPU=1 ./node_modules/electron/dist/electron.exe tools/win-bounds-drift-probe.js
unset ELECTRON_RUN_AS_NODE && MGW_DISABLE_GPU=1 ./node_modules/electron/dist/electron.exe tools/pets-import-selftest.js
```

写新自测时记得加进 `package.json` 的 `test` 脚本，别让它变成没人跑的孤儿。

素材工具（开发期用，运行时不需要）：

| 工具                                                             | 用途                                |
| -------------------------------------------------------------- | --------------------------------- |
| `node tools/render-preview.js <catId> [state] [frame] [scale]` | 把某只猫某状态渲染成放大 PNG，白底好看效果           |
| `node tools/png2grid.js [图片]`                                  | 生图 PNG → 24×24 字符网格（k-means 提调色板） |
| `node tools/gencat.js`                                         | 程序化派生猫的全部动画帧 → 输出素材 JSON          |

> `render-preview.js` 与 `png2grid.js` 依赖 `pngjs`，已写进 `devDependencies`，`npm install` 后即可用。

### 开发约定

- **音效全局关闭**（摸鱼场景不宜发声）：`audio.js` 保留但零调用，**新功能不要引入音效**。
- **console 日志一律英文**：Windows 终端 GBK 会乱码。
- **数值一律进 `src/shared/config.js`**：不要在业务代码里散落魔法数字，否则没法调、没法测。
- **`patchSave` 是覆盖语义**：经济变动必须写 `coins: (st.coins || 0) + delta`，不能写 `coins: delta`。
- **渲染层不能 `require`**：素材一律走主进程 `ipcMain.handle('assets:read')`（路径被限制在 `assets/` 内）。
- **用户素材不进 `assets/`**：图片桌宠一律存 `userData/pets/`，走 `pets:*` 通道；导入前先过 `shared/petAssets.js` 的校验与归一化计算。
- **改产品逻辑时同步 grep 冒烟脚本**：`tools/*-smoke.js` 里有 mock 的主进程逻辑和硬编码的期望值，容易漏改，漏了就是「测的和跑的不是一回事」。

### ⚠️ 禁区

- **`src/main/save.js` 的存档文件名必须保持 `miaogongwei-save.json`**。它是运行期数据文件名，改名 = 清档（好感、金币、集卡进度全丢）。项目标识改名时不要顺手带上它。
- **不要改 `package.json` 的 `productName`**。「喵工位」决定了 `userData` 目录名（`%APPDATA%\喵工位\`），改了就读不到旧存档。要改必须先迁存档。
- **透明窗样式铁律**：`pet.css` 不加 `transition` / `animation` / `transform` / `opacity` 渐变，显隐只用 `visibility` —— 会提升合成层，引发拖动漂移。
- **桌宠窗口位置和尺寸一律 `setBounds`，永远不用 `setPosition`**。高 DPI 下只挪位置会顺手把矩形取整、尺寸 +1px，累积起来就是「越拖越漂」。
- **桌宠尺寸的唯一真理是 `config.petMetrics(scale)` 算出来的请求值**，永远不要把 `getBounds()` 的回报值当期望尺寸（同样会形成反馈回路）。

### 文档

| 文档                                           | 内容                         |
| -------------------------------------------- | -------------------------- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 进程模型、IPC 通道、数据流、四条硬约束的来龙去脉 |
| [docs/PLAN.md](docs/PLAN.md)                 | 待办优先级、素材接入路径、已知工程债、已砍需求    |
