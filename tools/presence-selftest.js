/**
 * 在场状态（系统空闲联动）· 逻辑自测：纯换算 + 状态变化检测，不碰 electron / userData
 *   node tools/presence-selftest.js
 *
 * 产品契约（config.presence）：空闲秒数 → active / away / sleeping；
 * 只在状态变化时产出事件；锁屏 / 休眠由主进程 force('sleeping') 直判；
 * 「回到 active」的事件要带本次离开总时长（渲染层据此挑招呼台词）。
 * 第 5 节用 stub electron 验证主进程壳（src/main/presence.js）的事件接线。
 */
const path = require('path');
const Presence = require(path.join(__dirname, '..', 'src', 'shared', 'presence.js'));

const CFG = { pollSec: 5, awaySec: 120, sleepSec: 900 };

let fails = 0;
function check(name, ok, extra) {
  if (!ok) fails++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra != null ? '  → ' + extra : ''}`);
}

console.log('--- 1. computeState：空闲秒数 → 在场状态（含边界）---');
check('0s → active', Presence.computeState(0, CFG) === 'active');
check('119s → active（差 1 秒不算离开）', Presence.computeState(119, CFG) === 'active');
check('120s → away（恰好到阈值）', Presence.computeState(120, CFG) === 'away');
check('899s → away', Presence.computeState(899, CFG) === 'away');
check('900s → sleeping（恰好到阈值）', Presence.computeState(900, CFG) === 'sleeping');
check('3600s → sleeping', Presence.computeState(3600, CFG) === 'sleeping');
check('负数 → active（容错）', Presence.computeState(-5, CFG) === 'active');
check('NaN → active（容错）', Presence.computeState(NaN, CFG) === 'active');

console.log('\n--- 2. tracker：只在状态变化时产出事件 ---');
const t = Presence.createTracker(CFG);
check('初始 active', t.state === 'active', t.state);
check('active 内变化不产出（0s → 119s）', t.update(0, 1000) === null && t.update(119, 2000) === null);

const evAway = t.update(120, 1000000);
check('离开：产出 away 事件（prev=active）',
  !!evAway && evAway.state === 'away' && evAway.prev === 'active', JSON.stringify(evAway));
check('away 事件里 awayMs 还是 0（人还没回来）', !!evAway && evAway.awayMs === 0, evAway && evAway.awayMs);
check('away 内变化不产出（300s）', t.update(300, 1001000) === null);

const evSleep = t.update(900, 1002000);
check('更久：产出 sleeping 事件（prev=away）',
  !!evSleep && evSleep.state === 'sleeping' && evSleep.prev === 'away', JSON.stringify(evSleep));
check('sleeping 内变化不产出（1200s）', t.update(1200, 1003000) === null);

const evBack = t.update(0, 1600000);
check('回来：产出 active 事件（prev=sleeping）',
  !!evBack && evBack.state === 'active' && evBack.prev === 'sleeping', JSON.stringify(evBack));
// 离开起点 = 判定离开的 1000000 - 已空闲的 120s = 880000（即「最后一次输入」时刻）
check('回来事件带本次离开总时长（12 分钟 = 720000ms）', !!evBack && evBack.awayMs === 720000, evBack && evBack.awayMs);
check('回到 active 后重复 update 不产出', t.update(0, 1601000) === null);
check('snapshot 反映当前状态',
  JSON.stringify(t.snapshot()) === JSON.stringify({ state: 'active', idleSec: 0 }),
  JSON.stringify(t.snapshot()));

console.log('\n--- 3. 锁屏 / 休眠：force(\'sleeping\') 直判，不等阈值 ---');
const t2 = Presence.createTracker(CFG);
const evLock = t2.force('sleeping', 5000);
check('锁屏直判 sleeping（prev=active）',
  !!evLock && evLock.state === 'sleeping' && evLock.prev === 'active', JSON.stringify(evLock));
check('重复 force 同一状态不产出', t2.force('sleeping', 6000) === null);
const evUnlock = t2.update(0, 8000);
check('解锁后重算回 active，离开时长从锁屏那刻算起（3000ms）',
  !!evUnlock && evUnlock.state === 'active' && evUnlock.awayMs === 3000, JSON.stringify(evUnlock));

console.log('\n--- 4. force 通用性 + snapshot ---');
const t3 = Presence.createTracker(CFG);
const evForce = t3.force('away', 1000);
check('force(away) 也走同一套变化检测', !!evForce && evForce.state === 'away' && evForce.prev === 'active', JSON.stringify(evForce));
check('同状态 force 不产出', t3.force('away', 1500) === null);
check('force 不改 idleSec（snapshot 兜底值）', t3.snapshot().idleSec === 0, JSON.stringify(t3.snapshot()));

console.log('\n--- 5. 主进程壳：锁屏 / 休眠 / 解锁的事件接线（stub electron）---');
const Module = require('module');
const handlers = {};
const fakeElectron = {
  powerMonitor: {
    on: (ev, fn) => { handlers[ev] = fn; },
    getSystemIdleTime: () => 0,
  },
};
const origLoad = Module._load;
Module._load = function (request) {
  if (request === 'electron') return fakeElectron;
  return origLoad.apply(this, arguments);
};
const mainPresence = require(path.join(__dirname, '..', 'src', 'main', 'presence.js'));
Module._load = origLoad;

const events = [];
mainPresence.init({ onState: (e) => events.push(e) });
check('init 后状态为 active', mainPresence.getState().state === 'active', JSON.stringify(mainPresence.getState()));
check('锁屏 / 休眠 / 解锁 / 唤醒事件都已注册',
  !!handlers['lock-screen'] && !!handlers['suspend'] && !!handlers['unlock-screen'] && !!handlers['resume']);

handlers['lock-screen']();
check('锁屏 → 直判 sleeping（不等阈值）',
  events.length === 1 && events[0].state === 'sleeping' && events[0].prev === 'active', JSON.stringify(events));
handlers['suspend']();
check('休眠时已是 sleeping → 不重复广播', events.length === 1, events.length);
handlers['unlock-screen']();
check('解锁 → 立刻重算回 active（带 prev 与离开时长）',
  events.length === 2 && events[1].state === 'active' && events[1].prev === 'sleeping' && typeof events[1].awayMs === 'number',
  JSON.stringify(events[1]));
check('壳的 getState 与 tracker 同源', mainPresence.getState().state === 'active', JSON.stringify(mainPresence.getState()));

console.log(`\n${fails === 0 ? 'ALL PASS' : fails + ' FAILED'}`);
process.exit(fails === 0 ? 0 : 1);
