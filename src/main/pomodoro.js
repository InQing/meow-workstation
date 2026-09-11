/**
 * 番茄钟（主进程 = 唯一时间源）
 * - 时间戳差值计时，避免休眠/节流漂移
 * - 1250ms tick → 广播 pomodoro:state{phase,remaining,running,duration}
 * - 工作结束：结算 + 通知 + 广播 pomodoro:done，自动进入休息
 * - 休息结束：只通知，不自动开始下一个番茄
 */
const { ipcMain, Notification, BrowserWindow } = require('electron');
const config = require('../shared/config.js');
const save = require('./save.js');

const TICK_MS = 250;

const S = {
  phase: 'idle',       // idle | work | break
  running: false,
  durationMs: 0,
  remainMs: 0,
  endAt: 0,
  timer: null,
  distracted: false,   // 本番茄被桌宠标记「摸鱼超限」→ 结算打折（内存态，不写存档）
  hooks: { tooltip: null },
};

function todayStr() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function payload() {
  return {
    phase: S.phase,
    running: S.running,
    remaining: Math.ceil(S.remainMs / 1000),
    duration: Math.ceil(S.durationMs / 1000),
    // 0~1 浮点进度，渲染层直接用，避免整数秒除法丢精度导致进度条几乎不动
    progress: S.durationMs > 0 ? 1 - S.remainMs / S.durationMs : 0,
  };
}

function send(channel, data) {
  for (const w of BrowserWindow.getAllWindows()) {
    // 逐个 try：某个窗口的 webContents 异常不能连累后面的窗口（桌宠靠这条消息收起进度条）
    try {
      if (!w.isDestroyed() && !w.webContents.isDestroyed()) w.webContents.send(channel, data);
    } catch (e) {
      console.error('[pomodoro] send failed:', channel, e.message);
    }
  }
}

function broadcast() {
  const p = payload();
  send('pomodoro:state', p);
  if (S.hooks.tooltip) S.hooks.tooltip(p);
}

function notify(title, body) {
  try {
    if (Notification.isSupported()) new Notification({ title, body }).show();
  } catch (e) {
    console.error('[pomodoro] notify failed:', e.message);
  }
}

function clearTimer() {
  if (S.timer) { clearInterval(S.timer); S.timer = null; }
}

function setTimer() {
  clearTimer();
  S.timer = setInterval(() => {
    if (!S.running) return;
    S.remainMs = Math.max(0, S.endAt - Date.now());
    broadcast();
    if (S.remainMs <= 0) complete();
  }, TICK_MS);
}

/** 开始一个阶段：work / break */
function start(phase = 'work') {
  const st = save.getSave();
  const minutes = phase === 'work' ? st.settings.workMin : st.settings.breakMin;
  S.phase = phase;
  S.durationMs = Math.max(1, Number(minutes) || 1) * 60 * 1000;
  S.remainMs = S.durationMs;
  S.endAt = Date.now() + S.remainMs;
  S.running = true;
  S.distracted = false;   // 新阶段开始：摸鱼标记清零（结算已在上一个 complete 里读过）
  console.log(`[pomodoro] start ${phase}, ${minutes} min`);
  setTimer();
  broadcast();
}

/** 暂停 / 继续（同一入口，按当前 running 切换） */
function togglePause() {
  if (S.phase === 'idle') return start('work');
  if (S.running) {
    S.running = false;
    S.remainMs = Math.max(0, S.endAt - Date.now());
    clearTimer();
    broadcast();
  } else {
    S.endAt = Date.now() + S.remainMs;
    S.running = true;
    setTimer();
    broadcast();
  }
}

/** 跳过当前阶段 */
function skip() {
  if (S.phase === 'idle') return;
  complete({ skipped: true });
}

/** 阶段结束 */
function complete({ skipped = false } = {}) {
  clearTimer();
  S.running = false;
  const finished = S.phase;
  const st = save.getSave();

  if (finished === 'work') {
    const today = todayStr();
    const baseToday = st.pomodoro.lastDate === today ? st.pomodoro.today : 0;
    // 摸鱼超限（桌宠报告过）→ 结算打折：金币 / 好感按比例、无券
    const pen = config.pomodoro.distractedPenalty;
    const reward = S.distracted
      ? {
          coins: Math.floor(config.pomodoro.rewardCoins * pen.coinRate),
          tickets: pen.tickets,
          affection: Math.floor(config.pomodoro.rewardAffection * pen.affectionRate),
        }
      : {
          coins: config.pomodoro.rewardCoins,
          tickets: config.pomodoro.rewardTickets,
          affection: config.pomodoro.rewardAffection,
        };
    // patch 是覆盖语义，这里必须基于存档现值累加
    save.patchSave({
      coins: (st.coins || 0) + reward.coins,
      tickets: (st.tickets || 0) + reward.tickets,
      affection: (st.affection || 0) + reward.affection,
      pomodoro: { today: baseToday + 1, total: st.pomodoro.total + 1, lastDate: today },
    });
    console.log('[pomodoro] work done, reward:', JSON.stringify(reward), 'distracted:', S.distracted);
    if (S.distracted) {
      notify('番茄完成 🍅（摸鱼太多）', `奖励打折：+${reward.coins} 金币，没有券，去休息 ${st.settings.breakMin} 分钟`);
    } else {
      notify('番茄完成 🍅', `+${reward.coins} 金币 +${reward.tickets} 券，去休息 ${st.settings.breakMin} 分钟`);
    }
    send('pomodoro:done', { phase: 'work', reward, distracted: S.distracted, skipped, total: st.pomodoro.total + 1 });
    start('break'); // 自动进入休息
  } else if (finished === 'break') {
    notify('休息结束', '回来干活啦，老大');
    send('pomodoro:done', { phase: 'break', skipped });
    S.phase = 'idle';
    S.remainMs = 0;
    S.durationMs = 0;
    broadcast();
  }
}

function init(hooks = {}) {
  S.hooks = Object.assign(S.hooks, hooks);
  ipcMain.on('pomodoro:start', () => togglePause());
  ipcMain.on('pomodoro:pause', () => { if (S.running) togglePause(); });
  ipcMain.on('pomodoro:skip', () => skip());
  // 桌宠报告「本番茄摸鱼超限」：只在 work 阶段收（避免收尾时插进来的迟到消息），
  // 按布尔处理一次即可，新阶段 start() 会自动清零
  ipcMain.on('pomodoro:distracted', () => {
    if (S.phase !== 'work' || S.distracted) return;
    S.distracted = true;
    console.log('[pomodoro] distracted flagged: this work phase will pay a reduced reward');
  });
  return { start, togglePause, skip, getState: payload };
}

module.exports = { init, start, getState: payload };
