/**
 * 番茄钟（主进程）· 逻辑自测：stub 掉 electron，不启动 app、不碰 userData
 *   node tools/pomodoro-selftest.js
 *
 * 重点验证「暂停 → 广播 running:false」这条链（老大报的：暂停后桌宠头顶进度条不消失）。
 * 另含：摸鱼超限（pomodoro:distracted）→ 本番茄结算打折 / 新番茄清零。
 * 渲染层那边由 tools/pet-smoke.js 验证（收到 running:false 就隐藏进度条）。
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const Module = require('module');

/* ---- stub electron ---- */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mgw-pomodoro-'));
const sent = [];          // 广播出去的 pomodoro:state / pomodoro:done
const notices = [];       // 系统通知（stub，用来断言打折文案）
const handlers = {};      // ipcMain.on 注册表

const fakeElectron = {
  ipcMain: {
    on: (ch, fn) => { handlers[ch] = fn; },
    handle: () => {},
  },
  Notification: class {
    constructor(o) { notices.push(o); }
    static isSupported() { return true; }   // 让 notify() 真的走构造，好断言文案
    show() {}
  },
  BrowserWindow: {
    getAllWindows: () => [{
      isDestroyed: () => false,
      webContents: { isDestroyed: () => false, send: (ch, d) => sent.push({ ch, d }) },
    }],
  },
  app: { getPath: () => tmp, on: () => {} },
};

const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return fakeElectron;
  return origLoad.apply(this, arguments);
};

const pomodoro = require(path.join(__dirname, '..', 'src', 'main', 'pomodoro.js'));
const save = require(path.join(__dirname, '..', 'src', 'main', 'save.js'));

let fails = 0;
function check(name, ok, extra) {
  if (!ok) fails++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra != null ? '  → ' + extra : ''}`);
}
const lastState = () => [...sent].reverse().find((m) => m.ch === 'pomodoro:state');

save.initSave();
const states = [];
pomodoro.init({ tooltip: (p) => states.push(p) });

console.log('--- 1. 开始 → 广播 running:true ---');
handlers['pomodoro:start']();
let s = lastState().d;
check('phase=work / running=true', s.phase === 'work' && s.running === true, JSON.stringify(s));
check('duration 取自 settings.workMin', s.duration === 25 * 60, s.duration + 's');

console.log('\n--- 2. 暂停 → 广播 running:false（这是桌宠收进度条的依据）---');
sent.length = 0;
states.length = 0;
handlers['pomodoro:start']();          // togglePause：运行中 → 暂停
s = lastState() ? lastState().d : null;
check('暂停后有状态广播', !!s);
check('running=false', s && s.running === false, JSON.stringify(s));
check('phase 仍是 work（暂停不等于结束）', s && s.phase === 'work', s && s.phase);
check('tooltip 钩子也收到同一份状态', states.length === 1 && states[0].running === false, JSON.stringify(states[0] || null));
check('进度条隐藏判据成立（!running）', !!s && !s.running);

console.log('\n--- 3. 继续 → 广播 running:true ---');
sent.length = 0;
handlers['pomodoro:start']();
s = lastState().d;
check('running=true', s.running === true, JSON.stringify(s));

console.log('\n--- 4. 跳过 → 结算 + 进入休息 ---');
sent.length = 0;
handlers['pomodoro:skip']();
const done = [...sent].reverse().find((m) => m.ch === 'pomodoro:done');
check('广播 pomodoro:done(work)', done && done.d.phase === 'work', done && JSON.stringify(done.d.reward));
const after = lastState().d;
check('跳过工作后自动进休息', after.phase === 'break' && after.running === true, JSON.stringify(after));

console.log('\n--- 5. 休息结束 → idle + running:false ---');
sent.length = 0;
handlers['pomodoro:skip']();           // 跳过休息
s = lastState().d;
check('phase=idle', s.phase === 'idle', JSON.stringify(s));
check('running=false（进度条同样要隐藏）', s.running === false);

console.log('\n--- 6. 状态查询（ipcMain handle 的兜底数据源）---');
const q = pomodoro.getState();
check('getState 与广播同源', q.phase === 'idle' && q.running === false, JSON.stringify(q));

console.log('\n--- 7. 摸鱼超限 → 本番茄结算打折（金币/好感减半、无券）---');
sent.length = 0;
notices.length = 0;
handlers['pomodoro:start']();          // idle → 开新番茄
handlers['pomodoro:distracted']();     // 桌宠报告：本番茄摸鱼超限
handlers['pomodoro:skip']();           // 跳过工作 → 结算
const pDone = [...sent].reverse().find((m) => m.ch === 'pomodoro:done');
console.log('[penalty done]', pDone && JSON.stringify(pDone.d));
check('done 带 distracted 标记', pDone && pDone.d.distracted === true, pDone && JSON.stringify(pDone.d));
check('金币减半（30 → 15）', pDone && pDone.d.reward.coins === 15, pDone && JSON.stringify(pDone.d.reward));
check('不送券（0）', pDone && pDone.d.reward.tickets === 0, pDone && JSON.stringify(pDone.d.reward));
check('好感减半（10 → 5）', pDone && pDone.d.reward.affection === 5, pDone && JSON.stringify(pDone.d.reward));
check('通知文案写明「奖励打折」', notices.some((n) => String(n.body).includes('奖励打折')), JSON.stringify(notices.map((n) => n.body)));
check('通知文案不提好感', notices.every((n) => !String(n.body).includes('好感')), JSON.stringify(notices.map((n) => n.body)));

console.log('\n--- 8. 新番茄清零：奖励恢复正常 ---');
sent.length = 0;
notices.length = 0;
handlers['pomodoro:skip']();           // 结束休息 → idle
handlers['pomodoro:start']();          // 开新番茄（摸鱼标记清零）
handlers['pomodoro:skip']();           // 结算
const nDone = [...sent].reverse().find((m) => m.ch === 'pomodoro:done');
console.log('[normal done]', nDone && JSON.stringify(nDone.d));
check('恢复 30 金币 / 1 券 / 10 好感',
  nDone && nDone.d.reward.coins === 30 && nDone.d.reward.tickets === 1 && nDone.d.reward.affection === 10,
  nDone && JSON.stringify(nDone.d.reward));
check('不再标记 distracted', nDone && nDone.d.distracted === false, nDone && String(nDone.d.distracted));
check('正常通知文案照旧（不提打折）',
  notices.some((n) => String(n.body).includes('+30 金币 +1 券')) && notices.every((n) => !String(n.body).includes('打折')),
  JSON.stringify(notices.map((n) => n.body)));

/* 清理临时存档目录 */
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* noop */ }

console.log(`\n${fails === 0 ? 'ALL PASS' : fails + ' FAILED'}`);
process.exit(fails === 0 ? 0 : 1);
