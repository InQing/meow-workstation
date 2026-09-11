/**
 * 面板窗口冒烟测试（不启动桌宠，只把 src/panel 拉起来截图）
 *   unset ELECTRON_RUN_AS_NODE && MGW_DISABLE_GPU=1 electron tools/panel-smoke.js
 * 会 mock 掉存档 IPC（内存档），截图到 tools/_smoke/*.png，并收集渲染层 console 输出。
 * 仅供开发期自测，不属于产品代码。
 */
const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, ipcMain } = require('electron');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(__dirname, '_smoke');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

if (process.env.MGW_DISABLE_GPU) {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('no-sandbox');
}

/* ---- 内存存档 mock（不碰真实 userData） ---- */
const SAVE = {
  version: 1, coins: 420, tickets: 5,
  cards: { orange_worker: 2, cow_nap: 1, space_cat: 1, aju_cat: 1 },
  pity: 49, affection: 520, currentCat: 'orange',   // pity=49 → 下一抽必出 SSR（验证保底 + 金光）
  pomodoro: { today: 2, total: 11, lastDate: '' },
  stats: { draws: 6, bestGameScore: 0 },
  settings: { workMin: 25, breakMin: 5, volume: 0.5, alwaysOnTop: true },
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
['panel:open', 'panel:navigate', 'pet:move', 'pet:menu', 'tray:icon', 'settings:set',
 'pomodoro:start', 'pomodoro:pause', 'pomodoro:skip'].forEach((ch) => ipcMain.on(ch, () => {}));

const reacts = [];   // 游戏 tab 发给桌宠的反应：{kind, score, best}
ipcMain.on('pet:react', (_e, payload) => { reacts.push(payload); console.log('pet:react ->', JSON.stringify(payload)); });

const logs = [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let win = null;

async function ensurePainted() {
  for (let i = 0; i < 30; i++) {
    const img = await win.webContents.capturePage();
    if (img.getSize().width > 0) return img;
    await wait(300);
  }
  return null;
}

async function shot(name) {
  await wait(250);
  await win.webContents.capturePage();   // 丢一帧，等合成跟上
  await wait(200);
  const img = await win.webContents.capturePage();
  if (!img || img.getSize().width === 0) { console.log('shot', name, 'EMPTY'); return; }
  const size = img.getSize();
  fs.writeFileSync(path.join(OUT, name + '.png'), img.toPNG());
  console.log('shot', name, size.width + 'x' + size.height);
}

async function js(code) {
  try { return await win.webContents.executeJavaScript(code); }
  catch (e) { return 'ERR: ' + e.message.split('\n')[0]; }
}

setTimeout(() => { console.error('TIMEOUT'); printLogs(); app.exit(1); }, 90000);

function printLogs() {
  console.log('--- renderer console (' + logs.length + ') ---');
  logs.forEach((l) => console.log('  ' + l));
}

app.whenReady().then(async () => {
  win = new BrowserWindow({
    width: 900, height: 640, show: true, backgroundColor: '#14100c',
    webPreferences: {
      preload: path.join(ROOT, 'preload.js'),
      contextIsolation: true, nodeIntegration: false,
      offscreen: process.env.MGW_OFFSCREEN === '1',
    },
  });

  win.webContents.on('console-message', (...a) => {
    const details = a[1];
    if (details && typeof details === 'object' && details.message) logs.push(`[${details.level}] ${details.message}`);
    else logs.push(`[${a[1]}] ${a[2]}`);
  });
  win.webContents.on('did-fail-load', (_e, code, desc) => { logs.push(`did-fail-load ${code} ${desc}`); });
  win.webContents.on('render-process-gone', (_e, d) => { logs.push('renderer gone: ' + d.reason); });

  await win.loadFile(path.join(ROOT, 'src', 'panel', 'index.html'));
  await ensurePainted();
  await wait(800);

  console.log('nav count:', await js(`document.querySelectorAll('.nav-btn').length`));
  console.log('cards loaded:', await js(`(window.MGW_Panel && window.MGW_Panel.cards.length) || 'no Panel'`));
  console.log('save coins:', await js(`(window.MGW_Panel && window.MGW_Panel.save && window.MGW_Panel.save.coins) || 'no save'`));
  console.log('collection faces:', await js(`document.querySelectorAll('.page[data-page="collection"] .face').length`));
  await shot('01-collection');

  console.log('nav->draw:', await js(`document.querySelector('.nav-btn[data-tab="draw"]').click(); true`));
  await wait(400);
  console.log('draw buttons:', await js(`document.querySelectorAll('.page[data-page="draw"] .btn').length`));
  await shot('02-draw');

  console.log('draw click:', await js(`(()=>{const b=document.querySelector('.page[data-page="draw"] .btn.primary'); if(!b) return 'no-btn'; b.click(); return 'clicked';})()`));
  await wait(1400);
  console.log('after draw -> coins', SAVE.coins, 'tickets', SAVE.tickets, 'pity', SAVE.pity, 'cards', JSON.stringify(SAVE.cards));
  console.log('result line:', await js(`(document.querySelector('.page[data-page="draw"] .result-line')||{}).textContent || 'none'`));
  await shot('03-draw-result');

  console.log('premium click:', await js(`(()=>{const bs=[...document.querySelectorAll('.page[data-page="draw"] .btn.primary')]; const b=bs[bs.length-1]; if(!b) return 'no-btn'; const d=b.disabled; b.click(); return 'disabled-at-click:'+d;})()`));
  await wait(1300);
  console.log('after premium -> coins', SAVE.coins, 'pity', SAVE.pity);
  console.log('result line:', await js(`(document.querySelector('.page[data-page="draw"] .result-line')||{}).textContent || 'none'`));
  await shot('04-draw-premium');

  await js(`document.querySelector('.nav-btn[data-tab="settings"]').click(); true`);
  await wait(400);
  console.log('settings fields:', await js(`document.querySelectorAll('.page[data-page="settings"] .field').length`));
  console.log('audio row:', await js(`(document.querySelector('.page[data-page="settings"] .static-val')||{}).textContent || 'MISSING'`));
  console.log('volume sliders left:', await js(`document.querySelectorAll('.page[data-page="settings"] input[type="range"]').length`));
  await shot('05-settings');

  /* ---- 游戏 tab：现在是「游戏中心」列表页，先选游戏再进 ---- */
  /** 从游戏列表点进某个游戏（按卡片标题匹配） */
  const enterGame = async (name) => js(`(() => {
    const card = [...document.querySelectorAll('.page[data-page="game"] .game-card')]
      .find((c) => (c.querySelector('.gc-name') || {}).textContent === ${JSON.stringify(name)});
    if (!card) return 'no-card';
    card.click();
    return card.querySelector('.gc-name').textContent;
  })()`);

  await js(`document.querySelector('.nav-btn[data-tab="game"]').click(); true`);
  await wait(400);
  console.log('game list:', await js(`[...document.querySelectorAll('.page[data-page="game"] .game-card .gc-name')].map((e) => e.textContent).join(' / ')`));
  await shot('09-game-list');
  console.log('enter fish:', await enterGame('鱼干突袭'));
  await wait(300);
  console.log('game intro button:', await js(`!!document.querySelector('.page[data-page="game"] .g-cover .btn.big')`));
  await shot('09b-game-intro');

  await js(`window.MGW_CONFIG.fish.durationSec = 12; true`);
  await js(`document.querySelector('.page[data-page="game"] .g-cover .btn.big').click(); true`);
  await wait(1500);
  console.log('targets on field:', await js(`document.querySelectorAll('.page[data-page="game"] .target').length`));
  await shot('10-game-play');

  console.log('hits:', await js(`(()=>{ const t=[...document.querySelectorAll('.page[data-page="game"] .target')]; let n=0; for(const el of t){ el.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true})); n++; if(n>=4) break; } return n; })()`));
  await wait(400);
  console.log('hud score:', await js(`(document.querySelector('.page[data-page="game"] .g-score-num')||{}).textContent`));
  console.log('combo pill:', await js(`(document.querySelector('.page[data-page="game"] .combo-pill')||{}).textContent`));
  await shot('11-game-hit');

  // 把出怪权重改成全炸弹，验证「点到炸弹 → combo 清零 + 桌宠炸毛」
  await js(`window.MGW_CONFIG.fish.targets.fish.weight = 0; window.MGW_CONFIG.fish.targets.gold.weight = 0; window.MGW_CONFIG.fish.targets.bomb.weight = 1; true`);
  await wait(2600);   // 等场上旧目标过期，确保点到的就是炸弹
  console.log('bomb hit:', await js(`(()=>{ const el=document.querySelector('.page[data-page="game"] .target.bomb'); if(!el) return 'no-bomb'; el.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true})); return 'hit-bomb'; })()`));
  await wait(300);
  console.log('combo after bomb:', await js(`(document.querySelector('.page[data-page="game"] .combo-pill')||{}).textContent`));
  await shot('12-game-bomb');

  // 等本局结束（限时 12s）→ 结算
  await wait(7600);
  console.log('game cover visible:', await js(`(()=>{const c=document.querySelector('.page[data-page="game"] .g-cover'); return c && !c.classList.contains('hidden');})()`));
  console.log('result title:', await js(`(document.querySelector('.page[data-page="game"] .g-card-title')||{}).textContent`));
  console.log('result grid:', await js(`(document.querySelector('.page[data-page="game"] .g-result-grid')||{}).textContent`));
  console.log('cat say:', await js(`(()=>{const e=document.querySelector('.page[data-page="game"] .g-say');return e?e.className.replace('g-say ','')+' | '+e.textContent:null;})()`));
  console.log('after game -> coins', SAVE.coins, 'bestGameScore', SAVE.stats.bestGameScore);
  console.log('settle react payload:', JSON.stringify(reacts[reacts.length - 1]));
  await shot('13-game-result');

  // 第二轮：只出鱼干 + 分档归零 → 猫猫夸夸（praise）
  await js(`window.MGW_CONFIG.fish.durationSec = 3; window.MGW_CONFIG.fish.targets.fish.weight = 1; window.MGW_CONFIG.fish.targets.bomb.weight = 0; window.MGW_CONFIG.fish.react = { praise: 0, ok: 0 }; true`);
  await js(`document.querySelector('.page[data-page="game"] .g-cover .btn.big').click(); true`);
  await wait(1200);
  await js(`(()=>{ for (const el of document.querySelectorAll('.page[data-page="game"] .target')) el.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true})); return true; })()`);
  await wait(3200);
  console.log('praise say:', await js(`(()=>{const e=document.querySelector('.page[data-page="game"] .g-say');return e?e.className.replace('g-say ','')+' | '+e.textContent:null;})()`));
  console.log('praise react payload:', JSON.stringify(reacts[reacts.length - 1]));
  await shot('14-game-praise');

  // 切走 tab 应中止本局（不结算、不刷分），且重进 tab 回到「游戏列表」
  await js(`document.querySelector('.page[data-page="game"] .g-cover .btn.big').click(); true`);
  await wait(600);
  await js(`document.querySelector('.nav-btn[data-tab="collection"]').click(); true`);
  await wait(300);
  const coinsBeforeLeave = SAVE.coins;
  await js(`document.querySelector('.nav-btn[data-tab="game"]').click(); true`);
  await wait(400);
  console.log('re-enter tab -> list:', await js(`document.querySelectorAll('.page[data-page="game"] .game-card').length`));
  await enterGame('鱼干突袭');
  await wait(300);
  console.log('re-enter game shows intro:', await js(`(document.querySelector('.page[data-page="game"] .g-card-title')||{}).textContent`));
  console.log('coins unchanged after re-enter:', SAVE.coins === coinsBeforeLeave, SAVE.coins);

  /* ---- 游戏回归（老大报过的两条：卡在结算页出不去 / 鱼干出在围观位底下） ---- */
  // ① 结算卡片必须整个装进场地。卡片（6 格 + 评价 + 按钮）比 arena 高时会被
  //    arena 的 overflow:hidden 切掉底部按钮 → 卡在结算页点不动「再来一局」。
  await js(`window.MGW_CONFIG.fish.durationSec = 2; true`);
  await js(`document.querySelector('.page[data-page="game"] .g-cover .btn.big').click(); true`);
  await wait(2900);
  const fit = await js(`(() => {
    const p = document.querySelector('.page[data-page="game"]');
    const ar = p.querySelector('.arena').getBoundingClientRect();
    const card = p.querySelector('.g-card').getBoundingClientRect();
    const btn = p.querySelector('.g-cover .btn.big');
    const br = btn.getBoundingClientRect();
    return JSON.stringify({ arenaH: Math.round(ar.height), cardH: Math.round(card.height),
      btn: btn.textContent, btnInArena: br.bottom <= ar.bottom + 1 && br.top >= ar.top - 1 });
  })()`);
  console.log('settle card fits arena:', fit);
  await shot('15-game-result-fit');

  // ② 重进 tab 回到「开始」页（不能继续摆着上一局的结算卡 —— 那正是"出不去"的来源）
  await js(`document.querySelector('.nav-btn[data-tab="collection"]').click(); true`);
  await wait(300);
  await js(`document.querySelector('.nav-btn[data-tab="game"]').click(); true`);
  await wait(400);
  await enterGame('鱼干突袭');
  await wait(300);
  console.log('re-enter after settle ->', await js(`(document.querySelector('.page[data-page="game"] .g-card-title')||{}).textContent`));

  // ③ 出怪落点避开左下角围观位：注入「交替返回禁区点 / 安全点」，正确的避让会丢掉前者
  await js(`(() => {
    let n = 0;
    window.MGW_Fish.randomSpot = function () {
      n++;
      return (n % 2 === 1) ? { x: 3, y: 87 } : { x: 60, y: 40 };
    };
    return true;
  })()`);
  await js(`document.querySelector('.nav-btn[data-tab="collection"]').click(); true`);
  await wait(300);
  await js(`document.querySelector('.nav-btn[data-tab="game"]').click(); true`);
  await wait(400);
  await enterGame('鱼干突袭');
  await wait(300);
  await js(`window.MGW_CONFIG.fish.durationSec = 3; true`);
  await js(`document.querySelector('.page[data-page="game"] .g-cover .btn.big').click(); true`);
  await wait(2700);
  console.log('spawn spots avoid watcher:', await js(`(() => {
    const p = document.querySelector('.page[data-page="game"]');
    const pts = [...p.querySelectorAll('.target')].map((e) => e.style.left + ',' + e.style.top);
    return JSON.stringify({ points: pts, allSafe: pts.length > 0 && pts.every((s) => s === '60%,40%') });
  })()`));

  /* ---- 反应力测试（新游戏）：三态切换 / 抢跑作废 / 5 次结算 / 破纪录奖金 ---- */
  await js(`document.querySelector('.nav-btn[data-tab="game"]').click(); true`);
  await wait(400);
  console.log('enter reflex:', await enterGame('反应力测试'));
  await wait(300);
  console.log('reflex intro:', await js(`(document.querySelector('.page[data-page="game"] .g-card-title')||{}).textContent`));
  await shot('16-reflex-intro');

  // 开始 → 进入「等待变色」态
  await js(`document.querySelector('.page[data-page="game"] .g-cover .btn.big').click(); true`);
  await wait(300);
  console.log('reflex wait state:', await js(`(()=>{const p=document.querySelector('.r-pad'); return p.className+' | '+p.querySelector('.r-pad-text').textContent;})()`));

  // 抢跑：等待态里直接点 → 本次作废 + 记一次犯规 + 重新计时
  await js(`document.querySelector('.r-pad').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true})); true`);
  await wait(150);
  console.log('reflex foul state:', await js(`(()=>{const p=document.querySelector('.r-pad'); return p.className+' | '+p.querySelector('.r-pad-text').textContent+' | '+(document.querySelector('.combo-pill')||{}).textContent;})()`));
  await shot('17-reflex-foul');

  // 轮询等「点亮」再点（模拟真人：不能靠定时器猜，等待时长是随机的）
  const waitGoAndHit = async (timeoutMs) => {
    const t0 = Date.now();
    while (Date.now() - t0 < (timeoutMs || 6000)) {
      const isGo = await js(`document.querySelector('.r-pad').classList.contains('go')`);
      if (isGo) {
        const txt = await js(`document.querySelector('.r-pad .r-pad-text').textContent`);
        await js(`document.querySelector('.r-pad').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true})); true`);
        return txt;
      }
      await wait(60);
    }
    return 'TIMEOUT';
  };

  const hits = [];
  for (let i = 0; i < 5; i++) {
    hits.push(await waitGoAndHit(6000));
    await wait(1000);            // 等 900ms 的停顿走完，进入下一轮等待
  }
  console.log('reflex hits:', hits.join(' , '));

  await wait(1500);              // 第 5 次后的停顿 → 结算
  console.log('reflex result:', await js(`(document.querySelector('.page[data-page="game"] .g-result-grid')||{}).textContent`));
  console.log('reflex grade:', await js(`(document.querySelector('.page[data-page="game"] .r-grade')||{}).textContent`));
  console.log('reflex lights:', await js(`[...document.querySelectorAll('.r-light')].map((e) => e.textContent).join(' / ')`));
  console.log('reflex react payload:', JSON.stringify(reacts[reacts.length - 1]));
  console.log('after reflex -> coins', SAVE.coins, 'bestReflexMs', SAVE.stats.bestReflexMs, 'breaks', SAVE.stats.reflexBreaks);
  console.log('reflex card fits arena:', await js(`(() => {
    const p = document.querySelector('.page[data-page="game"]');
    const ar = p.querySelector('.arena').getBoundingClientRect();
    const btn = p.querySelector('.g-cover .btn.big');
    const br = btn.getBoundingClientRect();
    return JSON.stringify({ arenaH: Math.round(ar.height), cardH: Math.round(p.querySelector('.g-card').getBoundingClientRect().height),
      btn: btn.textContent, btnInArena: br.bottom <= ar.bottom + 1 && br.top >= ar.top - 1 });
  })()`));
  await shot('18-reflex-result');

  // 返回游戏列表（列表页纪录文案应更新）
  console.log('back to list:', await js(`(() => {
    const b = document.querySelector('.game-back-btn');
    if (!b) return 'no-back';
    b.click();
    return document.querySelectorAll('.page[data-page="game"] .game-card').length;
  })()`));
  await wait(200);
  console.log('list records:', await js(`[...document.querySelectorAll('.page[data-page="game"] .gc-rec')].map((e) => e.textContent).join(' | ')`));
  await shot('19-game-list-records');

  await js(`document.querySelector('.nav-btn[data-tab="collection"]').click(); true`);
  await wait(400);
  console.log('back to collection faces:', await js(`document.querySelectorAll('.page[data-page="collection"] .face').length`));
  console.log('open detail:', await js(`(()=>{const f=document.querySelector('.page[data-page="collection"] .face'); if(!f) return 'no-face'; f.click(); return 'clicked';})()`));
  await wait(600);
  console.log('sheet open:', await js(`!document.getElementById('overlay').classList.contains('hidden')`));
  await shot('06-detail');

  // 窄窗：验证构成不崩（skill 自检项）
  await js(`document.getElementById('overlay').click(); true`);
  win.setSize(700, 620);
  await wait(700);
  await shot('07-narrow-collection');
  await js(`document.querySelector('.nav-btn[data-tab="draw"]').click(); true`);
  await wait(500);
  await shot('08-narrow-draw');

  console.log('pet reactions:', JSON.stringify(reacts));
  printLogs();
  app.quit();
}).catch((err) => { console.error('smoke failed:', err); printLogs(); app.exit(2); });
