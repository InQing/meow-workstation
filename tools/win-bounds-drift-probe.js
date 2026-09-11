/**
 * 窗口尺寸探针（Windows / 高 DPI）—— 拖动漂移 & ±1 取整抖动的复现与回归
 *
 * 两轮报障，根因是同一个家族：
 *
 *  [二次报障] 拖猫往左上移动，底部三个图标和右下角缩放手柄一起往右下漂，越拖越远。
 *    根因：显示缩放 ≠ 100%（本机 dpr = 1.5）时窗口矩形要按设备像素取整，
 *    只调 setPosition 挪位置会让窗口尺寸每移动一次 +1px。猫画在画布左上角所以看着不动，
 *    贴下边 / 右下角的图标与手柄就一路往下掉。
 *    修法：pet:move 改用 setBounds，把位置和宽高一起写死（每帧重写一遍）。
 *
 *  [三次报障] 拖动时控制台不停刷：
 *      [main] pet window resized while dragging: 213x246
 *      [main] pet window size drifted during drag: 213x246 -> restored 212x246
 *    根因：Chromium 把物理像素转回 DIP 用 floor(左)/ceil(右)，同一块恒定物理尺寸的
 *    窗口只要位置在动，getBounds() 回报的尺寸就在 ±1 内抖（dpr=1.5 实测：请求恒定
 *    212x245 → 回报 212x246 / 213x246）。这是取整噪声，不是 resize。
 *    更坑的是**反馈回路**：把回报值当下一帧的请求值，窗口会真的逐帧长大
 *    （12 帧 213x246 → 224x257）—— 所以 petSize 必须记「请求值」而不是 getBounds 回报值。
 *
 * 跑法（不加载页面，几秒出结果）：
 *   ./node_modules/electron/dist/electron.exe tools/win-bounds-drift-probe.js
 *
 * 期望：
 *   1. setPosition 尺寸一路变大 → setBounds 全程恒定（老结论仍在）
 *   2. 恒定请求下回报只在 [W, W+1] × [H, H+1] 内抖，绝不累积
 *   3. 反馈回路会逐帧变大（反面教材，INFO）
 *
 * ⚠️ 只用不透明窗口：沙箱里 transparent:true 的窗口一建就把进程带崩（无栈退出），
 *    而 DIP 换算逻辑与透明与否无关，不影响结论。
 */
const { app, BrowserWindow, screen } = require('electron');
const path = require('path');

const CFG = require(path.join(__dirname, '..', 'src', 'shared', 'config.js'));

// 沙箱里 GPU 进程会反复崩，攒够几次直接 FATAL 把主进程带走（探针跑到一半就没输出了）。
// 本探针只量窗口矩形，不需要 GPU —— 开局关掉。
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-gpu-compositing');
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('in-process-gpu');

const BASE = {
  width: 276, height: 350, show: true, frame: false, resizable: false, movable: false,
  skipTaskbar: true, hasShadow: false, fullscreenable: false,
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let failed = 0;
function check(name, cond, detail) {
  console.log((cond ? 'ok   ' : 'FAIL ') + name + (detail ? '  [' + detail + ']' : ''));
  if (!cond) failed++;
}

app.on('window-all-closed', () => { /* 别在探针中途退出 */ });
setTimeout(() => { console.error('TIMEOUT'); app.exit(1); }, 60000);

async function makeWin(size) {
  const w = new BrowserWindow(Object.assign({}, BASE, { width: size.w, height: size.h }));
  await wait(450);
  return w;
}

/* 1. setPosition vs setBounds：老结论 —— 只有 setBounds 写死宽高才不漂 */
async function probeMove(tag, mode) {
  const w = await makeWin({ w: BASE.width, h: BASE.height });
  const s0 = w.getBounds();
  const sizes = [];
  for (let i = 1; i <= 12; i++) {
    const b = w.getBounds();
    if (mode === 'setPosition') w.setPosition(b.x - 3, b.y - 2);
    else w.setBounds({ x: b.x - 3, y: b.y - 2, width: s0.width, height: s0.height });
    const nb = w.getBounds();
    sizes.push(nb.width + 'x' + nb.height);
  }
  const uniq = Array.from(new Set(sizes));
  console.log(`[${tag} / ${mode}] ${sizes[0]} -> ${sizes[sizes.length - 1]} | ${sizes.join(' ')}`);
  if (mode !== 'setPosition') {
    check('setBounds 拖动全程尺寸恒定', uniq.length === 1, uniq.join(' / '));
  } else {
    // 这台机器上应当能看到累积；若系统不再这样取整也无妨（写法仍然正确）
    console.log(`[${tag}] INFO setPosition 出现 ${uniq.length} 种尺寸 → ${uniq[uniq.length - 1]}`);
  }
  w.destroy();
  await wait(150);
  return sizes;
}

/* 2. 恒定请求下的回报抖动：必须只在 +1 以内，绝不累积 */
async function probeJitter(label, size) {
  const w = await makeWin(size);
  let resizes = 0;
  w.on('resize', () => { resizes++; });
  const ws = [], hs = [];
  for (let i = 0; i < 18; i++) {
    const b = w.getBounds();
    // 步长 1px：把各种物理坐标奇偶都踩一遍
    w.setBounds({ x: b.x - 1, y: b.y - 1, width: size.w, height: size.h });
    const nb = w.getBounds();
    ws.push(nb.width); hs.push(nb.height);
  }
  const uniq = Array.from(new Set(ws.map((v, i) => v + 'x' + hs[i])));
  const maxW = Math.max.apply(null, ws), maxH = Math.max.apply(null, hs);
  console.log(`[jitter ${label}] 请求恒定 ${size.w}x${size.h} → 回报 ${uniq.join(' / ')} | resize 事件 ${resizes} 次`);
  check(`恒定请求不累积（${label}）`, maxW <= size.w + 1 && maxH <= size.h + 1,
    `max ${maxW}x${maxH} vs 请求 ${size.w}x${size.h}`);
  w.destroy();
  await wait(150);
}

/* 3. 反面教材：把回报值当下一帧请求值 → 逐帧长大 */
async function probeFeedback(label, size) {
  const w = await makeWin(size);
  const seq = [];
  let cur = { w: size.w, h: size.h };
  for (let i = 0; i < 12; i++) {
    const b = w.getBounds();
    w.setBounds({ x: b.x - 1, y: b.y - 1, width: cur.w, height: cur.h });
    const nb = w.getBounds();
    cur = { w: nb.width, h: nb.height };
    seq.push(cur.w + 'x' + cur.h);
  }
  const grew = cur.w > size.w || cur.h > size.h;
  console.log(`[feedback ${label}] ${seq[0]} ... ${seq[seq.length - 1]}` +
    (grew ? '  ← 逐帧长大：期望尺寸绝不能记 getBounds() 的回报值' : ''));
  w.destroy();
  await wait(150);
}

app.whenReady().then(async () => {
  const d = screen.getPrimaryDisplay();
  console.log('display scaleFactor =', d.scaleFactor, '/ workArea =', JSON.stringify(d.workAreaSize));

  for (const s of [7, 8]) {
    const m = CFG.petMetrics(s);
    console.log(`petMetrics(${s}) = ${m.width}x${m.height}`);
  }

  const dim = (s) => { const m = CFG.petMetrics(s); return { w: m.width, h: m.height }; };

  await probeMove('opaque', 'setPosition');
  await probeMove('opaque', 'setBounds  ');
  await probeJitter('7格 212x245', dim(7));
  await probeJitter('8格 242x280', dim(8));
  await probeFeedback('7格', dim(7));

  console.log(failed ? failed + ' FAILED' : 'ALL PASS');
  app.exit(failed ? 1 : 0);
}).catch((e) => { console.error('failed:', e); app.exit(2); });
