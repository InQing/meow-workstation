# 喵工位 · meow-workstation

一只透明的像素猫趴在你桌面上。它不打扰你，只是陪着——你专注，它就安静地漏沙；你摸鱼，它就陪你玩两局。

> 项目标识：`meow-workstation`（英文）/ `喵工位`（显示名）

## 它是什么

Electron 桌面宠物 + 番茄钟 + 养成。核心是**用「被猫看着」这件事，把专注变成一件有反馈的事**。

| 模块 | 内容 |
|---|---|
| 桌宠 | 透明置顶无边框窗，像素猫 + 待机动画 + 气泡台词 |
| 番茄钟 | 猫左侧的实时沙漏；专注 / 休息双相位 |
| 好感养成 | 投喂、互动累积好感，分等级解锁台词与动作 |
| 集卡 | 17 张卡图鉴、抽卡保底、金币经济（图案待接入） |
| 游戏中心 | 鱼干突袭（限时接物）、反应力测试（5 次取平均） |
| 面板 | 复古街机 CRT 风格：图鉴 / 抽卡 / 游戏 / 设置 |

## 跑起来

```bash
npm install
npm start
```

无需打包，`npm start` 即 `electron .`。桌面右下角出现猫，右键有调试菜单，拖右下角手柄可调大小。

## 自测

```bash
npm test                      # 四个纯逻辑层自测（无需 electron）
```

UI 冒烟需要 electron：

```bash
unset ELECTRON_RUN_AS_NODE && MGW_DISABLE_GPU=1 ./node_modules/electron/dist/electron.exe tools/panel-smoke.js
unset ELECTRON_RUN_AS_NODE && MGW_DISABLE_GPU=1 ./node_modules/electron/dist/electron.exe tools/pet-smoke.js
unset ELECTRON_RUN_AS_NODE && MGW_DISABLE_GPU=1 ./node_modules/electron/dist/electron.exe tools/win-bounds-drift-probe.js
```

截图产物落在 `tools/_smoke/`。注意：**沙箱里面板游戏页的截图合成帧严重滞后**，游戏相关验收一律看 DOM 断言，别信截图。

## 目录

```
main.js                  主进程入口（窗口、IPC、菜单）
preload.js               渲染层契约层
src/
  shared/                纯逻辑层（UMD，node 可 require 自测）
    config.js            全局数值配置 —— 改数值只改这里
    gacha.js             抽卡
    games/               小游戏逻辑：fish.js（鱼干突袭）、reflex.js（反应力测试）
    audio.js             音效（当前全局关闭）
  main/                  主进程模块（存档等）
  pet/                   桌宠窗口（index.html / pet.js / pet.css / catRenderer.js）
  panel/                 面板窗口
    tabs/                图鉴 / 抽卡 / 游戏中心 / 设置
    tabs/games/          游戏 UI：fish.js、reflex.js（与 shared/games/ 一一对应）
assets/                  台词池 speech.json、图案素材
tools/                   自测与冒烟脚本
```

## 开发约定

- **先出方案、批准再动手**；只读动作不受限。
- **音效全局关闭**（摸鱼场景不宜发声）：`src/shared/audio.js` 保留但零调用，新功能不要引入音效。
- **console 日志一律英文**：Windows 终端 GBK 会乱码。
- **桌宠尺寸唯一真理是 `config.petMetrics(scale)` 的请求值**，永远不要把 `getBounds()` 回报的尺寸当期望值（高 DPI 下会累积漂移）。窗口尺寸一律 `setBounds`，不用 `setPosition`。
- **透明窗样式铁律**：pet.css 不加 `transition` / `animation` / `transform` / `opacity` 渐变；显隐用 `visibility`。
- **渲染层不能 `require('fs')`**：素材一律走主进程 `ipcMain.handle('assets:read')`。
- `patchSave` 是**覆盖语义**，经济变动要写 `coins: (st.coins||0) + delta`。

## ⚠️ 不要动的东西

- `src/main/save.js` 的存档文件名 **必须保持 `miaogongwei-save.json`**。它是运行期数据文件名，改名等于清档（好感、金币、集卡进度全丢）。项目标识改名时不要顺手把它带上。
