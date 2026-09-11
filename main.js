/**
 * 喵工位 — 主进程
 * 职责：窗口管理、托盘、IPC 中枢、时间源（番茄钟）
 */
const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, screen, shell, dialog } = require('electron');

const config = require('./src/shared/config.js');
const save = require('./src/main/save.js');
const pomodoro = require('./src/main/pomodoro.js');
const pets = require('./src/main/pets.js');
const presence = require('./src/main/presence.js');
const PetAssets = require('./src/shared/petAssets.js');

let petWin = null;
let panelWin = null;
let tray = null;
let pm = null; // 番茄钟控制句柄

// 拖动窗口期（毫秒时间戳）。仅用于诊断：拖动中窗口尺寸不该变，变了就是漂移的真凶
let petMovingUntil = 0;
// 桌宠窗口的期望尺寸（建窗 / pet:resize 时写入）。拖动中每次都按它把尺寸写死
let petSize = { w: 0, h: 0 };
// 本轮拖动是否已经就"尺寸漂了"告警过（一轮只提醒一次，别刷屏）
let petSizeWarned = false;
// DIP ↔ 物理像素往返取整的容差。dpr ≠ 1 时 Chromium 用 floor(左)/ceil(右) 换算，
// 同一块恒定物理尺寸的窗口只要位置在动，getBounds() 的回报值就在 ±1 内抖
// （实测 dpr=1.5：请求恒定 212x245 → 回报 212x246 / 213x246）。这是取整噪声，
// 不是真的 resize —— 判"漂移"必须留这个容差，否则每次拖动都误报刷屏。
const PET_SIZE_TOL = 1;

/* 托盘 tooltip：显示番茄剩余时间 */
function updateTrayTooltip(p) {
  if (!tray) return;
  if (p.phase === 'idle' || !p.running) {
    tray.setToolTip(config.appName);
    return;
  }
  const mm = Math.floor(p.remaining / 60);
  const ss = String(p.remaining % 60).padStart(2, '0');
  tray.setToolTip(`${config.appName} · ${p.phase === 'work' ? '专注中' : '休息中'} ${mm}:${ss}`);
}

/* ---------------- 窗口 ---------------- */

function createPetWindow() {
  // 尺寸跟随上次拖动结果（settings.petScale，单位：每格像素）
  const st = save.getSave() || {};
  const m = config.petMetrics((st.settings && st.settings.petScale) || config.petSize.defaultScale);
  const width = m.width, height = m.height;
  // 期望尺寸 = 换算公式算出来的值（建窗那一刻就定死，别等渲染层上报）
  petSize = { w: width, h: height };
  petWin = new BrowserWindow({
    width,
    height,
    transparent: true,
    frame: false,
    resizable: false,
    movable: false,          // 由 renderer 拖动时自行 setPosition
    skipTaskbar: true,
    hasShadow: false,
    fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  petWin.setAlwaysOnTop(true, 'screen-saver');

  // 首启动放在屏幕右下角。⚠️ 同样是 setBounds 而不是 setPosition：无边框窗在高 DPI 下
  // 只挪位置会顺手把矩形取整、尺寸 +1px（见下方 pet:move 的长注释）。
  const { bounds } = screen.getPrimaryDisplay();
  petWin.setBounds({
    x: bounds.width - width - 24,
    y: bounds.height - height - 80,
    width,
    height,
  });

  petWin.loadFile(path.join(__dirname, 'src', 'pet', 'index.html'));
  // 渲染层就绪后主动推一次番茄状态（渲染层可能错过启动期的广播）
  petWin.webContents.on('did-finish-load', () => {
    if (pm) petWin.webContents.send('pomodoro:state', pm.getState());
  });
  // 渲染进程崩溃自动重启（最多 3 次），避免桌宠白屏
  let crashCount = 0;
  petWin.webContents.on('render-process-gone', (_e, details) => {
    console.error('[main] pet renderer exited:', details.reason);
    if (crashCount++ < 3 && petWin && !petWin.isDestroyed()) setTimeout(() => petWin.reload(), 600);
  });
  petWin.on('closed', () => { petWin = null; });
  // 诊断：拖动过程中窗口尺寸必须恒定。一旦有 resize 插进来，底部/右下角锚定的
  // 图标与缩放手柄就会往右下跑（老大报的漂移），这里直接把真凶打出来。
  // ⚠️ 偏差 ≤ PET_SIZE_TOL 的是 DIP 取整噪声（见文件头的容差注释），不算漂移。
  petWin.on('resize', () => {
    const w = petWin;
    if (!w || w.isDestroyed()) return;
    if (Date.now() < petMovingUntil && petSize.w > 0) {
      const s = w.getSize();
      if (Math.abs(s[0] - petSize.w) > PET_SIZE_TOL || Math.abs(s[1] - petSize.h) > PET_SIZE_TOL) {
        console.warn('[main] pet window resized while dragging:', s[0] + 'x' + s[1],
          '(expected', petSize.w + 'x' + petSize.h + ')');
      }
    }
  });
  return petWin;
}

function createPanelWindow(tab) {
  if (panelWin) {
    panelWin.show();
    panelWin.focus();
    if (tab) panelWin.webContents.send('panel:navigate', tab);
    return panelWin;
  }
  const { width, height } = config.window.panel;
  panelWin = new BrowserWindow({
    width,
    height,
    title: config.appName + ' · 面板',
    autoHideMenuBar: true,
    backgroundColor: '#14100c',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  panelWin.loadFile(path.join(__dirname, 'src', 'panel', 'index.html'));
  panelWin.on('closed', () => { panelWin = null; });
  if (tab) panelWin.webContents.once('did-finish-load', () => {
    panelWin.webContents.send('panel:navigate', tab);
  });
  return panelWin;
}

/* ---------------- 菜单 ---------------- */

/* ---------------- 调试菜单：切换猫 / 强制切状态（验收用，保留给以后预览素材） ---------------- */
const CAT_LIST = config.builtinCats;   // 清单收敛到 shared/config.js（面板「桌宠」页共用）
const STATE_LIST = config.petStates.sustain.concat(config.petStates.once, config.petStates.timed);

function runInPet(js) {
  if (petWin && !petWin.isDestroyed()) petWin.webContents.executeJavaScript(`window.${js}`);
}

/** 调试菜单：图片桌宠（每次弹菜单现查，刚上传的立刻能选） */
function imagePetDebugItems() {
  const list = pets.listPets();
  if (!list.length) return [{ label: '（还没上传过）', enabled: false }];
  return list.map((p) => ({
    label: p.name,
    click: () => runInPet(`MGW_DEBUG.setPet('image', ${JSON.stringify(p.id)})`),
  }));
}

function debugSubmenu() {
  return {
    label: '调试',
    submenu: [
      {
        label: '切换猫',
        submenu: CAT_LIST.map((c) => ({
          label: c.name,
          click: () => runInPet(`MGW_DEBUG.setCat('${c.id}')`),
        })),
      },
      { label: '切换图片桌宠', submenu: imagePetDebugItems() },
      {
        label: '切换状态',
        submenu: STATE_LIST.map((s) => ({
          label: s,
          click: () => runInPet(`MGW_DEBUG.setState('${s}')`),
        })),
      },
      { label: '重置桌宠大小', click: () => runInPet(`MGW_DEBUG.setScale(${config.petSize.defaultScale})`) },
    ],
  };
}

function petContextMenu() {
  return Menu.buildFromTemplate([
    { label: '开始 / 暂停番茄', click: () => pm && pm.togglePause() },
    { label: '跳过当前阶段', click: () => pm && pm.skip() },
    { label: '打开面板', click: () => createPanelWindow('collection') },
    debugSubmenu(),
    { type: 'separator' },
    { label: '隐藏桌宠', click: () => petWin && petWin.hide() },
    { label: '退出', click: () => app.quit() },
  ]);
}

function trayMenu() {
  return Menu.buildFromTemplate([
    {
      label: petWin && petWin.isVisible() ? '隐藏桌宠' : '显示桌宠',
      click: () => {
        if (!petWin) createPetWindow();
        else if (petWin.isVisible()) petWin.hide();
        else petWin.show();
      },
    },
    { label: '开始 / 暂停番茄', click: () => pm && pm.togglePause() },
    { label: '跳过当前阶段', click: () => pm && pm.skip() },
    { label: '打开面板', click: () => createPanelWindow('collection') },
    debugSubmenu(),
    { type: 'separator' },
    { label: '关于喵工位', click: () => shell.openExternal('about:blank') },
    { label: '退出', click: () => app.quit() },
  ]);
}

function createTray() {
  const icon = nativeImage.createFromDataURL(TEMP_TRAY_ICON);
  tray = new Tray(icon);
  tray.setToolTip(config.appName);
  tray.setContextMenu(trayMenu());
  tray.on('click', () => {
    if (!petWin) createPetWindow();
    else if (petWin.isVisible()) petWin.hide();
    else petWin.show();
    tray.setContextMenu(trayMenu());
  });
}

/* 托盘图标：程序化生成的 16×16 PNG（不引入素材文件，渲染层画好后也会替换它） */
const TEMP_TRAY_ICON =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAp0lEQVR42u2SsQ3CMBRE9yQ4' +
  'B5gAJIMHkGQwACaDB5BkMAAegCSDCUAyGACSwQAgGTwASQaFhk0mFnl9S1s/2acdWQ8JgU8N8Ao4B74CL4EHwAPgFfAIeAG8' +
  'AF4CL4EXwIvgBfgLvAP+Bp4AtwDXgIvgbnq3xHQB64Bd4A7wEngPvAdeB98A74H3wPvgfXAP+AOcBF8C74F3wDvgHfAPeA+' +
  '8B94D7wP3gfvAPeA+8B94D7wP3gfvAPeA+8B94D7wP3gfvAPeA+8B9AAAAAASUVORK5CYII=';

/* ---------------- IPC 契约（一次定死，后续阶段只填实现） ---------------- */

function registerIpc() {
  save.initSave(); // save:load / save:patch

  // 素材读取（限制在 assets/ 目录内，防止路径穿越）
  ipcMain.handle('assets:read', (_e, relPath) => {
    const full = path.resolve(__dirname, relPath);
    const root = path.resolve(__dirname, 'assets');
    if (!full.startsWith(root)) throw new Error('非法素材路径: ' + relPath);
    return JSON.parse(fs.readFileSync(full, 'utf-8'));
  });

  // 窗口控制：offX/offY 是鼠标在窗口内的偏移（DIP，与 clientX 同单位）。
  // 用 getCursorScreenPoint 取当前鼠标 DIP 坐标减偏移，得到窗口左上角，
  // 规避 screenX(物理px) 与 clientX(DIP) 在 DPI 缩放下的单位错位。
  //
  // ⚠️⚠️ 必须用 setBounds 把「位置 + 尺寸」一起写死，不能只 setPosition。
  //   高 DPI（125% / 150%）下窗口矩形要取整，只挪位置会让高度每移动一次 +1px：
  //   猫画在画布左上角所以它不动，而贴下边的图标栏、贴右下角的缩放手柄每动一次就往下掉
  //   1px —— 表现就是"往左上拖猫，图标和手柄往右下漂，越拖越远"（老大 2026-09-10 第二次报障）。
  //   每帧按记录下来的期望尺寸重写一遍，尺寸就不可能累积。
  //   实测（本机 dpr=1.5，同一份窗口参数）：只 setPosition 连移 12 次 → 宽 278 涨到 289；
  //   换成 setBounds 写死宽高 → 全程恒定 278×352。
  ipcMain.on('pet:move', (_e, offX, offY) => {
    if (!petWin || petWin.isDestroyed()) return;
    const pt = screen.getCursorScreenPoint();
    const b = petWin.getBounds();
    const x = Math.round(pt.x - offX);
    const y = Math.round(pt.y - offY);
    const now = Date.now();
    if (now >= petMovingUntil) petSizeWarned = false;   // 上一次拖动已结束 → 新一轮
    petMovingUntil = now + 400;

    const w = petSize.w > 0 ? petSize.w : b.width;
    const h = petSize.h > 0 ? petSize.h : b.height;
    // ±PET_SIZE_TOL 以内是 DIP 取整噪声，不是漂移，别报警也别"修正"（每帧 setBounds 已经写死了）
    const drifted = Math.abs(w - b.width) > PET_SIZE_TOL || Math.abs(h - b.height) > PET_SIZE_TOL;
    if (drifted && !petSizeWarned) {
      petSizeWarned = true;
      console.warn('[main] pet window size drifted during drag:',
        b.width + 'x' + b.height, '-> restored', w + 'x' + h);
    }
    petWin.setBounds({ x, y, width: w, height: h });
  });
  // 缩放：按窗口中心锚定改尺寸，并夹在工作区内（别把猫推出屏幕）
  ipcMain.on('pet:resize', (_e, size) => {
    if (!petWin || petWin.isDestroyed() || !size) return;
    const w = Math.max(80, Math.round(size.w));
    const h = Math.max(80, Math.round(size.h));
    const b = petWin.getBounds();
    const cx = b.x + b.width / 2;
    const cy = b.y + b.height / 2;
    const { workArea } = screen.getDisplayNearestPoint({ x: Math.round(cx), y: Math.round(cy) });
    const x = Math.min(Math.max(Math.round(cx - w / 2), workArea.x), workArea.x + workArea.width - w);
    const y = Math.min(Math.max(Math.round(cy - h / 2), workArea.y), workArea.y + workArea.height - h);
    petWin.setBounds({ x, y, width: w, height: h });
    // 期望尺寸记「请求值」，不要用 getBounds() 读回来的值 —— dpr=1.5 时读回来会被
    // floor/ceil 往外交 1px（请求 212x245 读回 212x246），拿它当下一帧的请求值会
    // 让窗口真的比设计高 1 物理像素，并形成逐帧长大的反馈回路
    // （探针实测：12 帧 213x246 → 224x257，这就是当初漂移的成因）。
    petSize = { w, h };
  });
  ipcMain.on('pet:menu', () => {
    petContextMenu().popup(); // 不传坐标 = 弹在当前鼠标位置
  });
  ipcMain.on('tray:icon', (_e, dataUrl) => {
    if (tray) tray.setImage(nativeImage.createFromDataURL(dataUrl));
  });

  // 面板
  ipcMain.on('panel:open', (_e, tab) => createPanelWindow(tab));

  // 桌宠围观反应（游戏 tab → pet 窗口）：happy 欢呼 / shock 炸毛
  ipcMain.on('pet:react', (_e, kind) => {
    if (petWin && !petWin.isDestroyed()) petWin.webContents.send('pet:react', kind);
  });

  /* ---- 图片桌宠：存 userData/pets/，不走 assets/（那里被锁死在仓库内） ---- */
  const pickImageFile = async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const r = await dialog.showOpenDialog(win, {
      title: '选择桌宠图片（建议透明底方形）',
      properties: ['openFile'],
      filters: [{ name: '图片', extensions: ['png', 'webp', 'jpg', 'jpeg'] }],
    });
    return r.canceled || !r.filePaths.length ? null : r.filePaths[0];
  };

  ipcMain.handle('pets:list', () => pets.listPets());
  ipcMain.handle('pets:get', (_e, id, opts) => pets.getPetImages(id, opts));
  ipcMain.handle('pets:create', async (e) => {
    const file = await pickImageFile(e);
    return file ? pets.createFrom(file) : null;
  });
  ipcMain.handle('pets:set-slot', async (e, id, slot) => {
    const file = await pickImageFile(e);
    if (!file) return null;
    const r = pets.setSlot(id, slot, file);
    if (r.ok) broadcastPetChangedIfCurrent(id);
    return r;
  });
  ipcMain.handle('pets:clear-slot', (_e, id, slot) => {
    const r = pets.clearSlot(id, slot);
    if (r.ok) broadcastPetChangedIfCurrent(id);
    return r;
  });
  ipcMain.handle('pets:rename', (_e, id, name) => pets.rename(id, name));
  ipcMain.handle('pets:remove', (_e, id) => {
    const r = pets.removePet(id);
    const cur = PetAssets.resolveSource(save.getSave());
    if (r.ok && cur.type === 'image' && cur.ref === id) {   // 删了正在出场的 → 回退橘猫
      const fallback = { type: 'builtin', ref: 'orange' };
      save.patchSave({ currentPet: fallback, currentCat: 'orange' });
      broadcastAll('pet:changed', fallback);
    }
    return r;
  });
  ipcMain.handle('pets:select', (_e, src) => {
    const s = PetAssets.resolveSource({ currentPet: src });
    if (s.type === 'image') {
      if (!pets.exists(s.ref)) return { ok: false, message: '这只桌宠不在了' };
      save.patchSave({ currentPet: s });
    } else {
      const ref = config.builtinCats.some((c) => c.id === s.ref) ? s.ref : 'orange';
      save.patchSave({ currentPet: { type: 'builtin', ref }, currentCat: ref });
    }
    broadcastAll('pet:changed', PetAssets.resolveSource(save.getSave()));
    return { ok: true };
  });

  // 设置（阶段 1：落盘 + 立刻生效的部分）
  ipcMain.on('settings:set', (_e, patch) => {
    const next = save.patchSave({ settings: patch });
    if (petWin && 'alwaysOnTop' in patch) {
      petWin.setAlwaysOnTop(!!next.settings.alwaysOnTop, 'screen-saver');
    }
    broadcastAll('settings:changed', next.settings);
  });

  pm = pomodoro.init({ tooltip: updateTrayTooltip });
  // 渲染层主动查询当前番茄状态（广播丢失/窗口刚起时的兜底）
  ipcMain.handle('pomodoro:get', () => pomodoro.getState());

  // 在场状态（系统空闲联动）：变化时广播；只驱动桌宠表现，不影响番茄钟
  presence.init({ onState: (ev) => broadcastAll('presence:state', ev) });
  ipcMain.handle('presence:get', () => presence.getState());   // 渲染层启动 / 回焦时兜底拉取
}

/** 正在出场的图片桌宠被改动（换槽位图）→ 通知 pet 窗重载 */
function broadcastPetChangedIfCurrent(id) {
  const cur = PetAssets.resolveSource(save.getSave());
  if (cur.type === 'image' && cur.ref === id) broadcastAll('pet:changed', cur);
}

function broadcastAll(channel, payload) {
  for (const w of BrowserWindow.getAllWindows()) {
    try {
      if (!w.isDestroyed() && !w.webContents.isDestroyed()) w.webContents.send(channel, payload);
    } catch (e) {
      console.error('[main] broadcast failed:', channel, e.message);
    }
  }
}

/* ---------------- 生命周期 ---------------- */

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (petWin) { petWin.show(); petWin.focus(); }
  });

  // 默认走正常硬件加速：透明窗口 + 正常 GPU 是标准用法，能保证拖动时合成层不漂移。
  // 之前这里无条件禁用了 GPU（disable-gpu 与 disable-software-rasterizer 互相矛盾，
  // 既不用 GPU 也不用软件光栅化），导致窗口拖动时 absolute/transform 元素
  // （头顶进度条、底部按钮）合成层错位、越拖越漂。
  // 现在只在显式 MGW_DISABLE_GPU=1（无 GPU 的沙箱/虚拟机）时才降级软件渲染。
  if (process.env.MGW_DISABLE_GPU) {
    app.disableHardwareAcceleration();
    app.commandLine.appendSwitch('disable-gpu');
    app.commandLine.appendSwitch('disable-gpu-compositing');
    app.commandLine.appendSwitch('no-sandbox');
    app.commandLine.appendSwitch('in-process-gpu');
  }

  app.whenReady().then(() => {
    // 先注册 IPC / 读档，再建窗：桌宠窗口尺寸要用存档里的 petScale
    registerIpc();
    createTray();
    createPetWindow();
  });

  app.on('window-all-closed', () => {
    // 桌宠：pet 关了就退出；有托盘时不依赖窗口保活
    app.quit();
  });
}

module.exports = { broadcastAll };
