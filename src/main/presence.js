/**
 * 在场状态（主进程壳 = 唯一判定源）
 * - powerMonitor.getSystemIdleTime() 轮询：空闲秒数 → active / away / sleeping（判定复用 shared/presence.js）
 * - 锁屏 / 休眠直接判 sleeping，不等阈值；解锁 / 唤醒立刻重算
 * - 只在状态变化时回调一次（渲染层据此安静 / 打盹 / 迎接）
 * - 只驱动桌宠表现，不影响番茄钟：人在不在，番茄照跑
 */
const { powerMonitor } = require('electron');
const config = require('../shared/config.js');
const Presence = require('../shared/presence.js');

const S = {
  tracker: null,
  timer: null,
  onState: null,
  // 锁屏期间跳过轮询：锁屏那一刻系统空闲会被清零，照常轮询会把状态误拉回 active
  locked: false,
};

function emit(ev) {
  if (ev && S.onState) S.onState(ev);
}

function poll() {
  if (!S.tracker || S.locked) return;
  emit(S.tracker.update(powerMonitor.getSystemIdleTime()));
}

function init(hooks = {}) {
  S.onState = hooks.onState || null;
  S.tracker = Presence.createTracker(config.presence);

  powerMonitor.on('lock-screen', () => { S.locked = true; emit(S.tracker.force('sleeping')); });
  powerMonitor.on('unlock-screen', () => { S.locked = false; poll(); });
  powerMonitor.on('suspend', () => emit(S.tracker.force('sleeping')));
  powerMonitor.on('resume', () => poll());

  S.timer = setInterval(poll, Math.max(1, config.presence.pollSec) * 1000);
  return { getState };
}

function getState() {
  return S.tracker ? S.tracker.snapshot() : { state: 'active', idleSec: 0 };
}

module.exports = { init, getState };
