/**
 * 喵工位 · 反应力测试 —— 纯逻辑层（UMD，node 可直接 require 自测）
 *
 * 只算不碰 DOM：等待时长、成绩记录、抢跑、平均分档、局末金币结算。
 * UI（src/panel/tabs/games/reflex.js）只负责定时器、状态机与渲染。
 *
 * 规则（2026-09-10 老大定）：
 *   测 5 次取平均；每次随机等待 1.0~3.5s 后变色，变色到点击的间隔 = 本次成绩
 *   变色前点了 = 抢跑：本次作废、重新计时，并记一次犯规（结算显示）
 *   金币 = 基础 10 + 破纪录奖金；破纪录奖金线性增长 = 40 × 第几次破纪录
 *   （第 5 次破纪录 = 200，上限 400）。首次测出成绩即视为第 1 次破纪录。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MGW_Reflex = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  /** 本局状态 */
  function newState() {
    return {
      times: [],   // 已完成的成绩（ms），按轮次顺序
      fouls: 0,    // 抢跑次数（作废重来，不计入 times）
    };
  }

  /** 本次的随机等待时长（ms），cfg.waitMs.min ~ max 之间 */
  function waitGap(r, cfg) {
    const w = cfg.waitMs || {};
    const min = w.min != null ? w.min : 1000;
    const max = w.max != null ? w.max : 3500;
    return Math.round(min + (max - min) * r);
  }

  /** 记一次有效成绩 */
  function record(state, ms) {
    state.times.push(Math.max(0, Math.round(ms)));
    return state;
  }

  /** 抢跑：本次作废，只记犯规 */
  function foul(state) {
    state.fouls += 1;
    return state;
  }

  /** 是否已测满 */
  function isDone(state, cfg) {
    return state.times.length >= (cfg.rounds || 5);
  }

  /** 平均反应（ms），没成绩返回 null */
  function average(state) {
    const t = state.times;
    if (!t.length) return null;
    let sum = 0;
    for (const v of t) sum += v;
    return Math.round(sum / t.length);
  }

  /** 最快 / 最慢一次；没成绩返回 null */
  function bestOf(state) { return state.times.length ? Math.min.apply(null, state.times) : null; }
  function worstOf(state) { return state.times.length ? Math.max.apply(null, state.times) : null; }

  /** 分档（只影响文案与评价，不影响金币） */
  function gradeFor(avgMs, cfg) {
    const list = cfg.grades || [];
    for (const g of list) {
      if (avgMs <= g.maxMs) return { key: g.key, label: g.label };
    }
    const last = list[list.length - 1];
    return last ? { key: last.key, label: last.label } : { key: 'normal', label: '正常' };
  }

  /** 结算评价（决定猫猫夸还是吐槽）：越小越好，破纪录优先 */
  function reactFor(avgMs, cfg, opts) {
    const r = (cfg && cfg.react) || {};
    const praise = r.praise != null ? r.praise : 260;
    const ok = r.ok != null ? r.ok : 400;
    if (opts && opts.newBest) return 'best';
    if (avgMs <= praise) return 'praise';
    if (avgMs <= ok) return 'ok';
    return 'roast';
  }

  /** 破纪录奖金 = step × 第几次破纪录（封顶 max） */
  function recordBonus(breaks, cfg) {
    const step = cfg.recordCoinsStep != null ? cfg.recordCoinsStep : 40;
    const max = cfg.recordCoinsMax != null ? cfg.recordCoinsMax : 400;
    return Math.min(max, step * Math.max(0, breaks));
  }

  /**
   * 局末结算 patch（patchSave 是覆盖语义，必须传绝对值）
   * @returns {{coins:number, stats:object, earned:number, bonus:number,
   *            avgMs:number, bestMs:number, worstMs:number,
   *            newBest:boolean, breaks:number, fouls:number,
   *            grade:object, react:string}}
   */
  function settlePatch(save, state, cfg) {
    const s = save || {};
    const avg = average(state);
    if (avg == null) {
      // 没测出成绩（比如全程抢跑）：只入账基础金币，不动纪录
      const earned0 = cfg.baseCoins != null ? cfg.baseCoins : 10;
      return {
        coins: (s.coins || 0) + earned0,
        stats: {
          bestReflexMs: (s.stats && s.stats.bestReflexMs) || 0,
          reflexBreaks: (s.stats && s.stats.reflexBreaks) || 0,
        },
        earned: earned0, bonus: 0, avgMs: null, bestMs: null, worstMs: null,
        newBest: false, breaks: (s.stats && s.stats.reflexBreaks) || 0,
        fouls: state.fouls, grade: null, react: 'roast',
      };
    }

    const prev = (s.stats && s.stats.bestReflexMs) || 0;
    // 首次测出成绩（prev === 0）也算破纪录，让玩家第一局就有正反馈
    const newBest = prev === 0 || avg < prev;
    const best = newBest ? avg : prev;
    const prevBreaks = (s.stats && s.stats.reflexBreaks) || 0;
    const breaks = prevBreaks + (newBest ? 1 : 0);
    const bonus = newBest ? recordBonus(breaks, cfg) : 0;
    const base = cfg.baseCoins != null ? cfg.baseCoins : 10;
    const earned = base + bonus;

    return {
      coins: (s.coins || 0) + earned,
      stats: { bestReflexMs: best, reflexBreaks: breaks },
      earned, bonus,
      avgMs: avg,
      bestMs: bestOf(state),
      worstMs: worstOf(state),
      newBest, breaks,
      fouls: state.fouls,
      grade: gradeFor(avg, cfg),
      react: reactFor(avg, cfg, { newBest }),
    };
  }

  return {
    newState, waitGap, record, foul, isDone,
    average, bestOf, worstOf,
    gradeFor, reactFor, recordBonus, settlePatch,
  };
});
