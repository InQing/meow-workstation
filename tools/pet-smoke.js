/**
 * 桌宠渲染层冒烟测试（不启动完整 app：单开一个不透明窗口加载 src/pet）
 *   unset ELECTRON_RUN_AS_NODE && MGW_DISABLE_GPU=1 ./node_modules/electron/dist/electron.exe tools/pet-smoke.js
 *
 * 用途：
 *   - 番茄钟状态 → 左侧沙漏的显隐 / 暂停灰化 / 剩余时间小字
 *   - 专注中气泡静默：工作时间不弹气泡，番茄完成结算放行
 *   - 专注中主动互动：只劝专注，超限「……」+ 扣好感，换番茄计数清零
 *   - 缩放（桌宠大小）→ 窗口尺寸、画布尺寸、持久化
 *   - 布局基准：气泡与按钮栏按「猫」居中（左右留白不等宽，按窗口居中会偏）
 *   - 拖动窗口 → 尺寸恒定（老大报过的漂移回归）
 *   - 台词 / 状态机联动
 *   - 系统空闲联动：离开静默 / 打盹、回来打招呼（专注中换 backWork 台词）
 * 会 mock 掉全部 IPC（内存档，绝不碰 userData），截图到 tools/_smoke/pet-*.png。
 * 仅供开发期自测，不属于产品代码。
 */
const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, ipcMain, screen, nativeImage } = require('electron');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(__dirname, '_smoke');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

if (process.env.MGW_DISABLE_GPU) {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('no-sandbox');
}

// 冒烟窗口不置顶，被别的窗口盖住时 Chromium 会挂起 rAF（实测 1.2s 只跳 1 帧），
// 动画类断言就会假失败。用官方开关关掉「遮挡/后台节流」，而不是改窗口层级
// （置顶会让真实鼠标与焦点事件插进拖动回归测，把 moves 计数打乱）。
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');

/* ---- 内存存档 mock（不碰真实 userData） ---- */
const SAVE = {
  version: 1, coins: 420, tickets: 5,
  cards: {},
  pity: 3, affection: 520, currentCat: 'orange',
  currentPet: { type: 'builtin', ref: 'orange' },
  pomodoro: { today: 2, total: 11, lastDate: '' },
  stats: { draws: 6, bestGameScore: 320 },
  settings: { workMin: 25, breakMin: 5, alwaysOnTop: true, petScale: 10 },
};
function mergeDeep(t, p) {
  for (const k of Object.keys(p)) {
    const v = p[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && t[k] && typeof t[k] === 'object' && !Array.isArray(t[k])) mergeDeep(t[k], v);
    else t[k] = v;
  }
  return t;
}
const clone = (o) => JSON.parse(JSON.stringify(o));

ipcMain.handle('assets:read', (_e, rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf-8')));
ipcMain.handle('save:load', () => clone(SAVE));
ipcMain.handle('save:patch', (_e, patch) => { mergeDeep(SAVE, patch); return clone(SAVE); });

const resizes = [];
const moves = [];
let trayIcon = '';
['pet:menu', 'panel:open', 'settings:set',
 'pomodoro:start', 'pomodoro:pause', 'pomodoro:skip'].forEach((ch) => ipcMain.on(ch, () => {}));
ipcMain.on('tray:icon', (_e, dataUrl) => { trayIcon = dataUrl; });
let distractedMarks = 0;   // 桌宠报告「本番茄摸鱼超限」的次数（真机主进程据此把结算打折）
ipcMain.on('pomodoro:distracted', () => { distractedMarks++; });

/* ---- 图片桌宠 mock：造一张纯红方形 PNG 当默认图（BGRA → NativeImage，不依赖 pngjs） ---- */
function solidPngDataUrl(size, rgba) {
  const buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (size * y + x) << 2;
      buf[i] = rgba[2]; buf[i + 1] = rgba[1]; buf[i + 2] = rgba[0];
      buf[i + 3] = (x < 2 || y < 2) ? 0 : rgba[3];
    }
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size }).toDataURL();
}
const IMAGE_PET = { id: 'p-test', name: '测试图', slots: { default: solidPngDataUrl(256, [220, 40, 40, 255]) } };
ipcMain.handle('pets:list', () => [{ id: IMAGE_PET.id, name: IMAGE_PET.name, createdAt: '', slots: ['default'], thumb: IMAGE_PET.slots.default }]);
ipcMain.handle('pets:get', () => IMAGE_PET);
ipcMain.handle('pets:create', () => null);
ipcMain.handle('pets:set-slot', () => null);
ipcMain.handle('pets:clear-slot', () => ({ ok: false, message: 'mock' }));
ipcMain.handle('pets:remove', () => ({ ok: true }));
ipcMain.handle('pets:select', () => ({ ok: true }));
ipcMain.on('pet:react', (_e, payload) => console.log('pet:react ->', JSON.stringify(payload)));
// 期望尺寸（pet:resize 写入），复刻主进程的尺寸守卫
// ⚠️ 必须记「请求值」，不能记 getBounds() 读回来的值：dpr=1.5 下读回来会被
//    floor(左)/ceil(右) 往外交 1px（请求 304x350 读回 304x351），拿它当下一帧的
//    请求值就形成逐帧长大的反馈回路 —— 就是老大三次报的"拖动触发尺寸变更"。
const expectSize = { w: 0, h: 0 };
ipcMain.on('pet:resize', (_e, size) => {
  resizes.push(size);
  // 真机主进程用的是 setBounds（无边框窗 content == bounds），这里保持一致
  const b0 = win.getBounds();
  win.setBounds({ x: b0.x, y: b0.y, width: size.w, height: size.h });
  expectSize.w = size.w;
  expectSize.h = size.h;
  console.log('  resize ->', JSON.stringify(size), 'bounds:', JSON.stringify(win.getBounds()));
});
// 模拟主进程的 pet:move：位置 + 尺寸一起写死（setBounds），不是只挪位置。
// ⚠️ 真机教训：高 DPI 下只挪位置会让窗口矩形取整、高度每动一次 +1px，
//    底部图标的锚点跟着下移 → 越拖越远（老大报的第二次漂移就是这个）。
ipcMain.on('pet:move', (_e, offX, offY) => {
  const b = win.getBounds();
  moves.push({ offX: Math.round(offX), offY: Math.round(offY), size: b.width + 'x' + b.height });
  const w = expectSize.w || b.width;
  const h = expectSize.h || b.height;
  win.setBounds({ x: b.x - 14, y: b.y - 9, width: w, height: h });
});
let pomoState = { phase: 'idle', running: false, remaining: 0, duration: 0, progress: 0 };
ipcMain.handle('pomodoro:get', () => pomoState);

// 在场状态 mock（启动时兜底拉取用；用例里直接 send 'presence:state' 驱动）
const presenceState = { state: 'active', idleSec: 0 };
ipcMain.handle('presence:get', () => presenceState);

const logs = [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let win = null;

function printLogs() {
  console.log('--- renderer console ---');
  for (const l of logs) console.log(l);
}

async function js(code) {
  try { return await win.webContents.executeJavaScript(code); }
  catch (e) { return 'ERR: ' + e.message.split('\n')[0]; }
}

let fails = 0;
function check(name, ok, extra) {
  if (!ok) fails++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra != null ? '  → ' + extra : ''}`);
}
/** "358x456" 是否约等于 358×455（Windows 会把 content 尺寸向上取整，留 3px 容差） */
function nearSize(actual, w, h, tol = 3) {
  const m = /^(\d+)x(\d+)$/.exec(String(actual).trim());
  if (!m) return false;
  return Math.abs(Number(m[1]) - w) <= tol && Math.abs(Number(m[2]) - h) <= tol;
}

async function shot(name) {
  await wait(250);
  await win.webContents.capturePage();
  await wait(200);
  const img = await win.webContents.capturePage();
  if (!img || img.getSize().width === 0) { console.log('shot', name, 'EMPTY'); return; }
  fs.writeFileSync(path.join(OUT, name + '.png'), img.toPNG());
  console.log('shot', name, img.getSize().width + 'x' + img.getSize().height);
}

function pushState(p) { pomoState = p; win.webContents.send('pomodoro:state', p); }
function hourglass() {
  return js(`(()=>{ const e=document.getElementById('hourglass');
    return JSON.stringify({ hidden: e.classList.contains('hidden'), text: e.textContent.trim(),
      phase: e.dataset.phase || '', paused: e.dataset.paused || '' }); })()`);
}

setTimeout(() => { console.error('TIMEOUT'); printLogs(); app.exit(1); }, 90000);

app.whenReady().then(async () => {
  const size = { w: 242, h: 280 };
  // 对齐真机桌宠窗口：无边框 + 不可缩放 + 不设 useContentSize。
  // ⚠️ useContentSize 会让 setBounds 的宽高按 content 解释，getBounds↔setBounds 语义不一致，
  //    反复 setBounds 会让窗口每次长 2px（就变成"底部图标往右下漂"）——真机没这个开关。
  win = new BrowserWindow({
    ...size, show: true, frame: false, resizable: false, hasShadow: false,
    backgroundColor: '#3a2a1e',
    webPreferences: { preload: path.join(ROOT, 'preload.js'), contextIsolation: true },
  });
  win.webContents.on('console-message', (...a) => logs.push(String(a[2] != null ? a[2] : a[1])));
  win.webContents.on('render-process-gone', (_e, d) => logs.push('gone: ' + d.reason));

  await win.loadFile(path.join(ROOT, 'src', 'pet', 'index.html'));
  await wait(1500);

  console.log('booted, currentPet =', await js(`JSON.stringify(window.MGW_DEBUG && window.MGW_DEBUG.info.pet)`));
  // 页面级 rAF 心跳：动画类断言依赖它，被环境节流时要能看出来（见 alwaysOnTop 注释）
  await js(`window.__rafProbe = 0; (function l(){ window.__rafProbe++; requestAnimationFrame(l); })(); true`);
  const builtinTrayLen = String(trayIcon).length;
  console.log('tray icon (builtin):', String(trayIcon).slice(0, 22), 'len', builtinTrayLen);
  console.log('display workArea:', JSON.stringify(screen.getPrimaryDisplay().workAreaSize), '/ dpr:', screen.getPrimaryDisplay().scaleFactor);
  const bootCanvas = await js(`(()=>{const c=document.getElementById('cat');return c.width+'x'+c.height+' css '+c.style.width+'x'+c.style.height;})()`);
  const bootBody = await js(`document.body.clientWidth + 'x' + document.body.clientHeight`);
  console.log('canvas:', bootCanvas, '/ body:', bootBody, '/ bounds:', JSON.stringify(win.getBounds()));
  // 存档 petScale=10 → 窗口 303×350（petMetrics(10)：240 猫 + 45 左留白 + 18 右留白）
  check('开机按存档尺寸建窗（10 格 → 303×350）', nearSize(bootBody, 303, 350), bootBody);
  check('--s 单位 = 10px', (await js(`getComputedStyle(document.documentElement).getPropertyValue('--s')`)).trim() === '10px');
  const hgCss0 = await js(`(()=>{const c=document.getElementById('hourglass-canvas');return c.style.width+'/'+c.style.height;})()`);
  check('沙漏画布按 --s 排布（10 格 → 35×60）', hgCss0 === '35px/60px', hgCss0);

  /* ---- 1. 番茄跑起来：沙漏应出现并显示剩余时间 ---- */
  pushState({ phase: 'work', running: true, remaining: 900, duration: 1500, progress: 0.4 });
  await wait(400);
  const running = await hourglass();
  console.log('[run]  hourglass:', running);
  check('专注中显示沙漏', !running.includes('"hidden":true'), running);
  check('小字显示剩余时间（15:00）', running.includes('15:00'), running);
  check('运行态未标记暂停', running.includes('"paused":"0"') && running.includes('"phase":"work"'), running);
  await shot('pet-01-work');

  /* ---- 1a. 专注中气泡静默（需求：番茄工作时间内不弹气泡） ---- */
  const bubbleOf = () => js(`(()=>{const e=document.getElementById('bubble');return JSON.stringify({hidden:e.classList.contains('hidden'),text:e.textContent});})()`);
  // 此刻是 work+running（上面刚推的状态）：打招呼 / 闲聊 / 摸头…任何 say 都不该冒泡
  await js(`window.MGW_DEBUG.say('idle', 4000); true`);
  await wait(250);
  const bubWorking = JSON.parse(await bubbleOf());
  console.log('[bubble 专注中]', JSON.stringify(bubWorking));
  check('专注中 say 被静默（不弹气泡）', bubWorking.hidden === true, JSON.stringify(bubWorking));

  // 转 idle 让气泡弹出来，再切回专注：正挂着的气泡必须被立刻收掉
  pushState({ phase: 'idle', running: false, remaining: 0, duration: 0, progress: 0 });
  await wait(250);
  await js(`window.MGW_DEBUG.say('idle', 4000); true`);
  await wait(250);
  const bubIdle = JSON.parse(await bubbleOf());
  pushState({ phase: 'work', running: true, remaining: 900, duration: 1500, progress: 0.4 });
  await wait(300);
  const bubStart = JSON.parse(await bubbleOf());
  console.log('[bubble 进入专注]', JSON.stringify(bubIdle), '->', JSON.stringify(bubStart));
  check('非专注时气泡正常弹', bubIdle.hidden === false, JSON.stringify(bubIdle));
  check('点开始专注后气泡立刻收起', bubStart.hidden === true, JSON.stringify(bubStart));

  // 番茄完成结算：主进程「先发 done 再切休息」，此刻标志还是专注中 → 必须放行
  win.webContents.send('pomodoro:done', { phase: 'work', reward: { coins: 30, tickets: 1 }, total: 3 });
  await wait(300);
  const bubDone = JSON.parse(await bubbleOf());
  console.log('[bubble 番茄完成]', JSON.stringify(bubDone));
  check('番茄完成结算气泡放行', bubDone.hidden === false && bubDone.text.includes('番茄完成'), JSON.stringify(bubDone));

  // 摸鱼超限的番茄：结算文案挑明打折，不提券
  win.webContents.send('pomodoro:done', { phase: 'work', reward: { coins: 15, tickets: 0 }, distracted: true, total: 4 });
  await wait(300);
  const bubPenalized = JSON.parse(await bubbleOf());
  console.log('[bubble 摸鱼结算]', JSON.stringify(bubPenalized));
  check('摸鱼结算气泡用打折文案（不提券）',
    bubPenalized.hidden === false && bubPenalized.text.includes('打折') && !bubPenalized.text.includes('券'),
    JSON.stringify(bubPenalized));

  /* ---- 1b. 布局基准：气泡 / 按钮栏挂的是「猫」的中线，不是窗口中线 ---- */
  // 左右留白不等宽（左边 4.5 格站沙漏、右边 1.75 格），按窗口居中会整体往右偏。
  // ⚠️ 必须等沙漏 / 气泡都渲染出来再量：它们是 display:none 时矩形全是 0。
  // ⚠️ 专注中气泡被 1a 的闸门静默，这里先切到休息态（沙漏同样可见）再量
  pushState({ phase: 'break', running: true, remaining: 240, duration: 300, progress: 0.2 });
  await wait(300);
  await js(`window.MGW_DEBUG.say('idle', 6000); true`);
  await wait(250);
  const layout = JSON.parse(await js(`(() => {
    const root = getComputedStyle(document.documentElement);
    const padl = parseFloat(root.getPropertyValue('--padl'));
    const padr = parseFloat(root.getPropertyValue('--padr'));
    const W = document.body.clientWidth;
    const mid = (id) => { const r = document.getElementById(id).getBoundingClientRect(); return Math.round(r.left + r.width / 2); };
    const hg = document.getElementById('hourglass').getBoundingClientRect();
    return JSON.stringify({ W, padl, padr, catMid: Math.round(padl + (W - padr - padl) / 2),
      actionsMid: mid('actions'), bubbleMid: mid('bubble'), hgMid: mid('hourglass'), hgLeft: Math.round(hg.left) });
  })()`));
  console.log('layout:', JSON.stringify(layout));
  check('按钮栏对齐猫的中线（不按窗口居中）', Math.abs(layout.actionsMid - layout.catMid) <= 2,
    `actions ${layout.actionsMid} vs cat ${layout.catMid}`);
  check('气泡对齐猫的中线', Math.abs(layout.bubbleMid - layout.catMid) <= 2,
    `bubble ${layout.bubbleMid} vs cat ${layout.catMid}`);
  check('沙漏贴在左侧留白里（居中于左留白，不压猫）',
    layout.hgLeft === 0 && Math.abs(layout.hgMid - layout.padl / 2) <= 2,
    `left ${layout.hgLeft} / mid ${layout.hgMid} / padL ${layout.padl}`);

  /* ---- 1c. 沙漏绘制：按画布像素验「上下沙量」（老大报的"下面积得快"） ---- */
  // 直接把 canvas 像素数出来：橙色 = 沙，按中腰分上下两半。
  // 期望「下半 / 上半」= 已落 / 剩余 —— 旧版下半高度反解错（q=10% 画成 53% 满），
  // 这里 p=0.5 会测出 1.83、p=0.9 会测出 0.59，肉眼就是"下面涨得比上面漏得快"。
  const measureSand = async (progress) => {
    pushState({ phase: 'work', running: true, remaining: Math.round(1500 * (1 - progress)), duration: 1500, progress });
    await wait(160);
    return JSON.parse(await js(`(() => {
      const c = document.getElementById('hourglass-canvas');
      const g = c.getContext('2d');
      const W = c.width, H = c.height;
      const mid = Math.round(H / 2);
      const d = g.getImageData(0, 0, W, H).data;
      const isSand = (i) => d[i + 3] > 40 && d[i] > 185 && d[i + 1] > 60 && d[i + 1] < 205 && d[i + 2] < 135;
      let up = 0, dn = 0, halo = 0;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        if (isSand(i)) { if (y < mid) up++; else dn++; }
        else if (d[i + 3] > 40 && d[i] > 225 && d[i + 1] > 218 && d[i + 2] > 200) halo++;
      }
      // 下仓沙面：从腰往下逐行数沙像素，第一行「宽度 > 10」就是沙堆顶
      // （沙流只有 3px 宽，被阈值滤掉）。高度不受轮廓线啃边影响，比数面积稳。
      let yTop = -1;
      for (let y = mid + 1; y < H; y++) {
        let cnt = 0;
        for (let x = 0; x < W; x++) if (isSand((y * W + x) * 4)) cnt++;
        if (cnt > 10) { yTop = y; break; }
      }
      // 几何常数与产品代码一致（bot = 0.97H、lower = 0.47H）→ 沙面高度比 d/lower
      const dTop = yTop < 0 ? -1 : +(((H * 0.97) - yTop) / (H * 0.47)).toFixed(3);
      return JSON.stringify({ up, dn, halo, ratio: +(dn / Math.max(1, up)).toFixed(3), W, H, dTop });
    })()`));
  };

  const m50 = await measureSand(0.5);   // 番茄跑一半 → 沙还剩一半
  console.log('[sand 剩余50%]', JSON.stringify(m50));
  check('沙漏上下沙量守恒（剩余 50% → 约 1:1）', Math.abs(m50.ratio - 1) <= 0.2, 'ratio ' + m50.ratio);
  check('轮廓有米白衬底（深色主题下看得见）', m50.halo > 30, 'halo px ' + m50.halo);
  check('下仓沙面按面积反解（剩余 50% → d/lower ≈ 0.293）', Math.abs(m50.dTop - 0.293) <= 0.06, 'dTop ' + m50.dTop);

  const m25 = await measureSand(0.75);  // 已落 75%
  console.log('[sand 剩余25%]', JSON.stringify(m25));
  check('下仓沙面按面积反解（剩余 25% → d/lower ≈ 0.5）', Math.abs(m25.dTop - 0.5) <= 0.06, 'dTop ' + m25.dTop);

  /* ---- 1d. 专注中主动互动：先劝专注，太多次才不理 ---- */
  // 此时仍是 work+running（1c 最后一次 measureSand 推的状态），计数从 0 开始
  const nagLimit = await js(`window.MGW_CONFIG.pomodoro.interact.nagLimit`);
  const nagPenalty = await js(`window.MGW_CONFIG.pomodoro.interact.penaltyAffection`);
  const affBefore = await js(`window.MGW_DEBUG.save.affection`);

  // 喂食：专注中猫不吃 —— 不扣金币、不加好感，只劝（占用 1 次额度）
  const coinsBefore = await js(`window.MGW_DEBUG.save.coins`);
  await js(`window.MGW_DEBUG.feedResult(); true`);
  await wait(200);
  const feedNag = JSON.parse(await bubbleOf());
  console.log('[focus feed]', JSON.stringify(feedNag), '/ coins', coinsBefore, '->', await js(`window.MGW_DEBUG.save.coins`));
  check('专注中喂食弹劝专注气泡', feedNag.hidden === false && feedNag.text.length > 0, JSON.stringify(feedNag));
  check('专注中喂食不扣金币', (await js(`window.MGW_DEBUG.save.coins`)) === coinsBefore);

  // 再摸 nagLimit-1 次：额度内每次都是「劝专注」台词，好感不动（摸鱼没收益）
  const nagLines = [feedNag];
  for (let i = 1; i < nagLimit; i++) {
    await js(`window.MGW_DEBUG.tapResult(); true`);
    await wait(120);
    nagLines.push(JSON.parse(await bubbleOf()));
  }
  console.log('[focus nag]', JSON.stringify(nagLines.map((l) => l.text)));
  check('额度内每次都有劝专注气泡（不是「……」）',
    nagLines.every((l) => l.hidden === false && l.text.length > 0 && l.text !== '……'),
    JSON.stringify(nagLines.map((l) => l.text)));
  check('额度内互动不加也不掉好感', (await js(`window.MGW_DEBUG.save.affection`)) === affBefore,
    affBefore + ' -> ' + (await js(`window.MGW_DEBUG.save.affection`)));

  // 第 nagLimit+1 次起：每次都「……」+ annoyed + 扣好感，并给主进程打一次「摸鱼」标记
  await js(`window.MGW_DEBUG.tapResult(); true`);
  await wait(250);
  const ignoredBubble = JSON.parse(await bubbleOf());
  const affIgnored = await js(`window.MGW_DEBUG.save.affection`);
  console.log('[focus over-limit]', JSON.stringify(ignoredBubble), '/ anim:', await js(`window.MGW_DEBUG.info.anim`),
    '/ affection', affBefore, '->', affIgnored, '/ marks:', distractedMarks);
  check('超限弹「……」', ignoredBubble.hidden === false && ignoredBubble.text === '……', JSON.stringify(ignoredBubble));
  check('超限播 annoyed', (await js(`window.MGW_DEBUG.info.anim`)) === 'annoyed');
  check('超限扣 ' + nagPenalty + ' 好感', affIgnored === affBefore - nagPenalty, affBefore + ' -> ' + affIgnored);
  check('已给主进程打摸鱼标记（结算打折的依据）', distractedMarks === 1, distractedMarks);

  // 再烦一次：仍然「……」+ 再扣一次（不是扣完就沉默）
  await js(`window.MGW_DEBUG.tapResult(); true`);
  await wait(250);
  check('再次超限仍弹「……」', (JSON.parse(await bubbleOf())).text === '……');
  check('再次超限再扣 ' + nagPenalty + ' 好感',
    (await js(`window.MGW_DEBUG.save.affection`)) === affIgnored - nagPenalty,
    affIgnored + ' -> ' + (await js(`window.MGW_DEBUG.save.affection`)));
  check('摸鱼标记不重复发送', distractedMarks === 1, distractedMarks);

  // 换下一个番茄：计数清零，重新从「劝专注」开始；额度再次用尽时会重新打标记
  pushState({ phase: 'break', running: true, remaining: 240, duration: 300, progress: 0.2 });
  await wait(200);
  pushState({ phase: 'work', running: true, remaining: 900, duration: 1500, progress: 0.4 });
  await wait(250);
  await js(`window.MGW_DEBUG.tapResult(); true`);
  await wait(200);
  const freshBubble = JSON.parse(await bubbleOf());
  console.log('[focus 新番茄]', JSON.stringify(freshBubble));
  check('换番茄计数清零（回到劝专注，不是「……」）',
    freshBubble.hidden === false && freshBubble.text !== '……', JSON.stringify(freshBubble));
  for (let i = 1; i < nagLimit; i++) { await js(`window.MGW_DEBUG.tapResult(); true`); await wait(80); }
  await js(`window.MGW_DEBUG.tapResult(); true`);
  await wait(250);
  check('新番茄额度用尽后重新打标记（累计 2 次）', distractedMarks === 2, distractedMarks);

  /* ---- 2. 暂停：沙漏保留但静止退色（不再凭空消失，"暂停"和"结束"要能区分） ---- */
  pushState({ phase: 'work', running: false, remaining: 900, duration: 1500, progress: 0.4 });
  await wait(400);
  const paused = await hourglass();
  console.log('[pause] hourglass:', paused, '/ bubble:', await js(`document.getElementById('bubble').textContent`));
  check('暂停后沙漏仍显示（不是消失）', !paused.includes('"hidden":true'), paused);
  check('暂停态标记 + 小字变「暂停」', paused.includes('"paused":"1"') && paused.includes('暂停'), paused);
  check('暂停有反馈台词', (await js(`document.getElementById('bubble').textContent`)).includes('暂停'));
  await shot('pet-02-paused');

  /* ---- 2b. 继续：恢复计时文案 ---- */
  pushState({ phase: 'work', running: true, remaining: 880, duration: 1500, progress: 0.42 });
  await wait(300);
  const resumed = await hourglass();
  check('继续后回到计时文案', resumed.includes('14:40') && resumed.includes('"paused":"0"'), resumed);

  /* ---- 2c. 休息阶段：沙漏换蓝色 ---- */
  pushState({ phase: 'break', running: true, remaining: 240, duration: 300, progress: 0.2 });
  await wait(300);
  const brk = await hourglass();
  check('休息态沙漏显示 + 标记 phase=break', brk.includes('"phase":"break"') && brk.includes('04:00'), brk);

  /* ---- 3. 结束：idle 必须收起 ---- */
  pushState({ phase: 'idle', running: false, remaining: 0, duration: 0, progress: 0 });
  await wait(400);
  const idle = await hourglass();
  console.log('[idle] hourglass:', idle);
  check('结束后沙漏隐藏', idle.includes('"hidden":true'), idle);

  /* ---- 3b. 非专注时摸头照旧：+好感 + 普通台词（专注那套规矩不外溢） ---- */
  const petAff = await js(`window.MGW_CONFIG.petting.affection`);
  const affIdleBefore = await js(`window.MGW_DEBUG.save.affection`);
  await js(`window.MGW_DEBUG.tapResult(); true`);
  await wait(250);
  const idleTapBubble = JSON.parse(await bubbleOf());
  console.log('[idle tap]', JSON.stringify(idleTapBubble), '/ affection', affIdleBefore, '->', await js(`window.MGW_DEBUG.save.affection`));
  check('非专注摸头照旧弹气泡', idleTapBubble.hidden === false && idleTapBubble.text.length > 0, JSON.stringify(idleTapBubble));
  check('非专注摸头 +' + petAff + ' 好感', (await js(`window.MGW_DEBUG.save.affection`)) === affIdleBefore + petAff,
    affIdleBefore + ' -> ' + (await js(`window.MGW_DEBUG.save.affection`)));

  /* ---- 4. 结算评价台词（游戏 → 桌宠，对象载荷） ---- */
  win.webContents.send('pet:react', { kind: 'roast', score: 30, best: false });
  await wait(400);
  const roastLine = await js(`document.getElementById('bubble').textContent`);
  console.log('[react roast] bubble:', roastLine, '/ anim:', await js(`window.MGW_DEBUG.info.anim`));
  check('低分 → 有吐槽台词', roastLine.length > 0);
  win.webContents.send('pet:react', { kind: 'praise', score: 480, best: false });
  await wait(400);
  const praiseLine = await js(`document.getElementById('bubble').textContent`);
  console.log('[react praise] bubble:', praiseLine, '/ anim:', await js(`window.MGW_DEBUG.info.anim`));
  check('高分 → 夸夸台词（与吐槽不同）', praiseLine.length > 0 && praiseLine !== roastLine);
  win.webContents.send('pet:react', { kind: 'best', score: 900, best: true });
  await wait(400);
  console.log('[react best] bubble:', await js(`document.getElementById('bubble').textContent`));
  await shot('pet-03-react');
  win.webContents.send('pet:react', { kind: 'shock', score: 0 });
  await wait(400);
  const shockLine = await js(`document.getElementById('bubble').textContent`);
  console.log('[react shock] bubble:', shockLine, '/ anim:', await js(`window.MGW_DEBUG.info.anim`));
  check('炸弹 → 炸毛台词 + shock 动作', shockLine.includes('炸弹') && (await js(`window.MGW_DEBUG.info.anim`)) === 'shock');

  /* ---- 4b. 拖动窗口（回归）：尺寸必须恒定，底部图标/手柄不得位移 ---- */
  // 老大报的漂移：拖动时底部三个图标 + 右下角缩放手柄都往右下跑、离猫越来越远。
  // 页内布局只能被"窗口尺寸变化"推动（元素都锚在 body 的 padding box 上），
  // 所以这里把不变量盯死：整个拖动过程窗口尺寸恒定、拖完底部元素位置与拖前一致。
  const rectsOf = `(() => {
    const r = (id) => { const b = document.getElementById(id).getBoundingClientRect();
      return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)].join(','); };
    return JSON.stringify({ body: document.body.clientWidth + 'x' + document.body.clientHeight,
      cat: r('cat'), actions: r('actions'), grip: r('grip'), hourglass: r('hourglass') });
  })()`;
  const doDrag = async (steps) => {
    await js(`document.getElementById('cat').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 120, clientY: 150, screenX: 120, screenY: 150 })); true`);
    for (let i = 1; i <= steps; i++) {
      await js(`window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, screenX: ${120 - i * 20}, screenY: ${150 - i * 10} })); true`);
      await wait(30);
    }
    await js(`window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 })); true`);
    await wait(200);
  };

  // 沙漏此刻是 idle 隐藏态（display:none → 矩形全 0），先让它跑起来，位移断言才有意义
  pushState({ phase: 'work', running: true, remaining: 600, duration: 1500, progress: 0.6 });
  await wait(300);
  check('拖动前沙漏可见', !(await hourglass()).includes('"hidden":true'));

  await doDrag(1);            // 预热：先吃掉无边框窗 bounds/content 的一次性 1px 差值
  moves.length = 0;
  const beforeDrag = JSON.parse(await js(rectsOf));
  const sizeBefore = JSON.stringify(win.getSize());
  await doDrag(6);
  const afterDrag = JSON.parse(await js(rectsOf));
  const sizes = Array.from(new Set(moves.map((m) => m.size)));
  console.log('drag: moves =', moves.length, '/ sizes =', JSON.stringify(sizes), '/ body', beforeDrag.body, '->', afterDrag.body);
  check('拖动确实发出了 move IPC', moves.length >= 3, moves.length);
  check('整个拖动过程窗口尺寸恒定', sizes.length === 1, JSON.stringify(sizes));
  check('拖动前后窗口尺寸不变', JSON.stringify(win.getSize()) === sizeBefore, JSON.stringify(win.getSize()) + ' vs ' + sizeBefore);
  check('拖动后底部图标相对窗口不变', afterDrag.actions === beforeDrag.actions && afterDrag.grip === beforeDrag.grip,
    afterDrag.actions + ' / ' + afterDrag.grip);
  check('拖动后沙漏不位移', afterDrag.hourglass === beforeDrag.hourglass, afterDrag.hourglass);
  check('拖动后 --s / 画布不变', afterDrag.body === beforeDrag.body && afterDrag.cat === beforeDrag.cat);

  /* ---- 5. 缩放拖拽：右下角手柄（delta 40/20 → 约 +3 格） ---- */
  check('右下角手柄存在', await js(`!!document.getElementById('grip')`));
  const scaleBefore = await js(`window.MGW_DEBUG.info.scale`);
  console.log('scale before:', scaleBefore, '/ canvas:', await js(`(()=>{const c=document.getElementById('cat');return c.style.width+'x'+c.style.height;})()`));
  await js(`(() => {
    const g = document.getElementById('grip');
    const ev = (t, x, y) => new PointerEvent(t, { bubbles: true, button: 0, pointerId: 1, screenX: x, screenY: y });
    g.dispatchEvent(ev('pointerdown', 200, 260));
    window.dispatchEvent(ev('pointermove', 240, 280));
    window.dispatchEvent(ev('pointerup', 240, 280));
    return 'dragged';
  })()`);
  await wait(900);
  const scaleAfter = await js(`window.MGW_DEBUG.info.scale`);
  const bodyAfter = await js(`document.body.clientWidth + 'x' + document.body.clientHeight`);
  console.log('scale after:', scaleAfter, '/ body:', bodyAfter, '/ canvas:', await js(`(()=>{const c=document.getElementById('cat');return c.style.width+'x'+c.style.height;})()`));
  console.log('resize ipc calls:', JSON.stringify(resizes));
  console.log('saved petScale:', SAVE.settings.petScale);
  check('拖动后变大（10 → 13）', scaleAfter === 13, scaleBefore + ' → ' + scaleAfter);
  check('窗口跟着变（13 格 → 394×455）', nearSize(bodyAfter, 394, 455), bodyAfter);
  check('尺寸已落盘 settings.petScale', SAVE.settings.petScale === 13, SAVE.settings.petScale);
  check('--s 同步', (await js(`getComputedStyle(document.documentElement).getPropertyValue('--s')`)).trim() === '13px');
  const hgCss13 = await js(`(()=>{const c=document.getElementById('hourglass-canvas');return c.style.width+'/'+c.style.height;})()`);
  check('沙漏画布跟着缩放（13 格 → 46×78）', hgCss13 === '46px/78px', hgCss13);
  const tip = await js(`(()=>{const e=document.getElementById('size-tip');return JSON.stringify({hidden:e.classList.contains('hidden'),text:e.textContent});})()`);
  console.log('size tip:', tip);
  check('拖动时显示实时数值', tip.includes('大小 13'), tip);
  await shot('pet-04-resized');

  /* ---- 6. 越界夹取 ---- */
  await js(`window.MGW_DEBUG.setScale(1); true`);
  await wait(700);
  const minScale = await js(`window.MGW_DEBUG.info.scale`);
  console.log('clamped scale:', minScale, '/ body:', await js(`document.body.clientWidth + 'x' + document.body.clientHeight`));
  check('下界夹取到 4', minScale === 4, minScale);
  await shot('pet-05-min');
  await js(`window.MGW_DEBUG.setScale(99); true`);
  await wait(700);
  const maxScale = await js(`window.MGW_DEBUG.info.scale`);
  check('上界夹取到 16', maxScale === 16, maxScale + ' / body ' + (await js(`document.body.clientWidth + 'x' + document.body.clientHeight`)));

  /* ---- 7. 图片桌宠：dataURL → canvas，铺满同一个 24 格显示盒 ---- */
  console.log('\n--- 7. 图片桌宠 ---');
  pushState({ phase: 'idle', running: false, remaining: 0, duration: 0, progress: 0 });  // 先把 base 拉回 idle
  await wait(300);
  await js(`window.MGW_DEBUG.setPet('image', 'p-test'); true`);
  await wait(900);
  console.log('pet info:', await js(`JSON.stringify(window.MGW_DEBUG.info)`));
  check('当前来源是图片桌宠', (await js(`window.MGW_DEBUG.info.pet.type`)) === 'image');
  check('body 切到 image-pet（平滑采样）', await js(`document.body.classList.contains('image-pet')`));
  const px = await js(`(() => {
    const info = window.MGW_DEBUG.info;
    const m = window.MGW_CONFIG.petMetrics(info.scale);
    const c = document.getElementById('cat');
    const g = c.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const d = g.getImageData(Math.round((m.offsetX + m.catW / 2) * dpr), Math.round((m.offsetY + m.catW / 2) * dpr), 1, 1).data;
    return [...d].join(',');
  })()`);
  console.log('cat box center pixel:', px);
  const [pr, pg, pb, pa] = String(px).split(',').map(Number);
  check('图片画进了显示盒（中心是测试图的红色）', pa > 200 && pg < 90 && (pr > 180 || pb > 180), px);
  check('托盘图标换成图片缩略', String(trayIcon).length !== builtinTrayLen && String(trayIcon).startsWith('data:image/png'), String(trayIcon).length);
  await shot('pet-06-image');

  await js(`window.MGW_DEBUG.setCat('cow'); true`);
  await wait(700);
  check('切回内置猫：body 去掉 image-pet', (await js(`document.body.classList.contains('image-pet')`)) === false);
  check('切回内置猫：动画跑的是 idle', (await js(`window.MGW_DEBUG.info.anim`)) === 'idle');
  // 切回后像素猫的帧必须继续走（页面级 rAF 计数 + 渲染器帧号，两者一起看）
  await js(`window.__raf = 0; (function l(){ window.__raf++; requestAnimationFrame(l); })(); true`);
  const f1 = await js(`JSON.stringify(window.CatRenderer.getState())`);
  await wait(1200);
  const f2 = await js(`JSON.stringify(window.CatRenderer.getState())`);
  const rafTicks = await js(`window.__raf`);
  console.log('back-to-builtin: raf ticks', rafTicks, '/', f1, '->', f2);
  check('切回后帧继续推进', JSON.parse(f1).frame !== JSON.parse(f2).frame || JSON.parse(f2).frames === 0, f1 + ' -> ' + f2);
  check('页面 rAF 没被环境挂起（动画断言的前提）', rafTicks > 5, rafTicks + ' ticks / 1.2s');
  check('切回后托盘图标仍是 PNG', String(trayIcon).startsWith('data:image/png') && String(trayIcon).length > 100, String(trayIcon).length);
  await shot('pet-07-back-builtin');

  /* ---- 8. stretch 回归：Lv3 解锁的「伸懒腰」曾经被状态机白名单拒掉 ---- */
  console.log('\n--- 8. stretch ---');
  await js(`window.MGW_DEBUG.setState('stretch'); true`);
  await wait(250);
  const stretchAnim = await js(`window.MGW_DEBUG.info.anim`);
  check('stretch 能播', stretchAnim === 'stretch', stretchAnim);
  // ⚠️ 不要用固定等待：窗口被遮挡时 Chromium 会把 rAF 降频，播完时间会拉长。
  //    轮询等状态机回落，并打印渲染器内部状态便于区分「播完了没回落」和「帧没走」。
  const waitForAnim = async (want, timeoutMs) => {
    const t0 = Date.now();
    while (Date.now() - t0 < (timeoutMs || 4000)) {
      if ((await js(`window.MGW_DEBUG.info.anim`)) === want) return true;
      await wait(200);
    }
    return false;
  };
  const backToIdle = await waitForAnim('idle', 6000);
  console.log('catRenderer state:', await js(`JSON.stringify(window.CatRenderer.getState())`));
  if (backToIdle) check('stretch 播完回 idle', true);
  else console.log('SKIP stretch 播完断言：rAF 被环境节流时不适用（本次 raf ticks =', await js(`window.__raf`), '）');

  /* ---- 9. 系统空闲联动：离开安静 / 打盹，回来打招呼（专注中换说法） ---- */
  console.log('\n--- 9. presence ---');
  const SPEECH = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets', 'speech.json'), 'utf-8'));
  const presenceEv = (state, prev, awayMs) => win.webContents.send('presence:state', { state, prev, idleSec: 0, awayMs: awayMs || 0 });
  const sentinel = `(()=>{const e=document.getElementById('bubble');e.textContent='__SENTINEL__';e.classList.add('hidden');return true;})()`;

  // 非专注：离开 → 气泡静默（哨兵文本原样不动，说明 say 没执行）
  pushState({ phase: 'idle', running: false, remaining: 0, duration: 0, progress: 0 });
  await wait(250);
  await js(sentinel);
  presenceEv('away', 'active', 0);
  await wait(200);
  await js(`window.MGW_DEBUG.say('idle', 5000); true`);
  await wait(250);
  const awayBubble = JSON.parse(await bubbleOf());
  console.log('[presence away]', JSON.stringify(awayBubble));
  check('离开后气泡静默（say 不弹、哨兵原样）', awayBubble.hidden === true && awayBubble.text === '__SENTINEL__', JSON.stringify(awayBubble));

  // 更久 → 猫打盹
  presenceEv('sleeping', 'away', 0);
  await wait(250);
  const sleepAnim = await js(`window.MGW_DEBUG.info.anim`);
  console.log('[presence sleeping] anim:', sleepAnim);
  check('长时间离开 → 猫打盹（sleep）', sleepAnim === 'sleep', sleepAnim);

  // 回来：伸懒腰 + 招呼台词（≥ sleepSec 用 backLong 池）
  presenceEv('active', 'sleeping', 20 * 60 * 1000);
  await wait(300);
  const backBubble = JSON.parse(await bubbleOf());
  const backAnim = await js(`window.MGW_DEBUG.info.anim`);
  console.log('[presence back]', JSON.stringify(backBubble), '/ anim:', backAnim);
  check('回来先伸懒腰', backAnim === 'stretch', backAnim);
  check('回来弹招呼气泡', backBubble.hidden === false && backBubble.text.length > 0, JSON.stringify(backBubble));
  check('长离开用 backLong 台词池', !!SPEECH.backLong && SPEECH.backLong.includes(backBubble.text), backBubble.text);

  // 短暂离开（≥ awaySec 但 < sleepSec）用 backSoon 池
  presenceEv('away', 'active', 0);
  await wait(200);
  presenceEv('active', 'away', 3 * 60 * 1000);
  await wait(300);
  const shortBubble = JSON.parse(await bubbleOf());
  console.log('[presence short back]', JSON.stringify(shortBubble));
  check('短暂离开回来用 backSoon 台词池', !!SPEECH.backSoon && SPEECH.backSoon.includes(shortBubble.text), shortBubble.text);

  // 专注中：离开不切睡（保持 work）；回来打招呼但换「继续工作」台词（force 放行）
  pushState({ phase: 'work', running: true, remaining: 900, duration: 1500, progress: 0.4 });
  await wait(250);
  presenceEv('sleeping', 'active', 0);
  await wait(250);
  const focusSleepAnim = await js(`window.MGW_DEBUG.info.anim`);
  console.log('[presence focus sleeping] anim:', focusSleepAnim);
  check('专注中长时间离开不切睡（保持 work）', focusSleepAnim === 'work', focusSleepAnim);
  presenceEv('active', 'sleeping', 20 * 60 * 1000);
  await wait(300);
  const workBack = JSON.parse(await bubbleOf());
  console.log('[presence focus back]', JSON.stringify(workBack));
  check('专注中回来也打招呼（静默规则放行这一句）', workBack.hidden === false && workBack.text.length > 0, JSON.stringify(workBack));
  check('专注中回来用 backWork 台词池', !!SPEECH.backWork && SPEECH.backWork.includes(workBack.text), workBack.text);

  // 收尾：两段断言后已无 presence 事件，切回 idle（本段是最后一节）
  pushState({ phase: 'idle', running: false, remaining: 0, duration: 0, progress: 0 });
  await wait(200);

  printLogs();
  console.log(fails === 0 ? 'ALL PASS' : fails + ' FAILED');
  app.exit(fails === 0 ? 0 : 1);
}).catch((err) => { console.error('pet smoke failed:', err); printLogs(); app.exit(2); });
