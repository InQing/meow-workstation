/**
 * 在场状态（系统空闲联动）· 纯逻辑（UMD，node 可 require 自测）
 * - 空闲秒数 → active / away / sleeping（阈值见 config.presence）
 * - createTracker：只在状态变化时产出事件（主进程据此广播，不用每秒给渲染层发消息）
 * - 锁屏 / 休眠由主进程用 force('sleeping') 直判；「回到 active」的事件带本次离开总时长 awayMs
 * - 不碰 electron / DOM：系统的轮询与事件监听在主进程壳（src/main/presence.js）
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.MGW_Presence = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  /** 空闲秒数 → 在场状态（负数 / NaN 容错为 active） */
  function computeState(idleSec, cfg) {
    const sec = Math.max(0, Number(idleSec) || 0);
    if (sec >= cfg.sleepSec) return 'sleeping';
    if (sec >= cfg.awaySec) return 'away';
    return 'active';
  }

  /**
   * 在场状态追踪器
   *   update(idleSec[, now])  用最新空闲秒数推进一步；无变化返回 null
   *   force(state[, now])     系统事件直判（锁屏 / 休眠 → sleeping）；无变化返回 null
   * 事件：{ state, prev, idleSec, awayMs } —— awayMs 仅「回到 active」时非 0
   */
  function createTracker(cfg) {
    const S = {
      state: 'active',
      idleSec: 0,
      awayStartAt: 0,   // 本次离开的起点（从「最后一次输入」算，ms 时间戳）
    };

    function transition(next, now) {
      if (next === S.state) return null;
      const prev = S.state;
      const awayMs = next === 'active' ? Math.max(0, now - S.awayStartAt) : 0;
      // 离开起点 = 当前时刻 - 已空闲时长（不是「检测到的时刻」，否则会少算一段）
      if (next !== 'active' && prev === 'active') S.awayStartAt = now - S.idleSec * 1000;
      S.state = next;
      return { state: next, prev, idleSec: S.idleSec, awayMs };
    }

    return {
      update(idleSec, now) {
        const at = Number.isFinite(now) ? now : Date.now();
        S.idleSec = Math.max(0, Number(idleSec) || 0);
        return transition(computeState(S.idleSec, cfg), at);
      },
      force(state, now) {
        const at = Number.isFinite(now) ? now : Date.now();
        return transition(state, at);
      },
      get state() { return S.state; },
      snapshot() { return { state: S.state, idleSec: S.idleSec }; },
    };
  }

  return { computeState, createTracker };
});
