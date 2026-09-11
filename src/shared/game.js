/**
 * 喵工位 · 鱼干突袭 —— 纯逻辑层（UMD，node 可直接 require 自测）
 *
 * 只算不碰 DOM：出怪类型、combo 倍率、单次命中结算、局末金币结算。
 * UI（src/panel/tabs/game.js）只负责定时器、定位、渲染。
 *
 * 规则（2026-09-10 定稿，同日复查调整）：
 *   一局 20s；鱼干 +8 / 金鱼 +20 / 炸弹 -12；概率 70% / 15% / 15%
 *   存留时长：鱼干 1.5s、金鱼 0.8s、炸弹 2s
 *   combo：连续命中累加，每 5 连 +0.25 倍，上限 ×2（只加成正向得分），炸弹不吃加成
 *   结算：金币 = floor(得分 × coinsPerScore)，负分不倒扣
 *   结算评价：reactFor(score) → best / praise / ok / roast（供猫猫夸夸或吐槽）
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MGW_Game = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const TYPES = ['fish', 'gold', 'bomb'];

  /** 按权重抽一个目标类型。r ∈ [0,1) */
  function rollType(r, targets) {
    let acc = 0;
    for (const t of TYPES) {
      const w = (targets[t] && targets[t].weight) || 0;
      acc += w;
      if (r < acc) return t;
    }
    return TYPES[0];
  }

  /** 该目标类型的存留时长（ms） */
  function aliveMsOf(type, cfg) {
    const t = cfg.targets[type];
    return (t && t.aliveMs) || 1500;
  }

  /** 出怪间隔（ms），cfg.spawn.minMs ~ maxMs 之间 */
  function spawnGap(r, cfg) {
    const s = cfg.spawn || {};
    const min = s.minMs != null ? s.minMs : 380;
    const max = s.maxMs != null ? s.maxMs : 620;
    return Math.round(min + (max - min) * r);
  }

  /** 当前 combo 对应的得分倍率 */
  function multiplierOf(combo, cfg) {
    const c = cfg.combo || {};
    const step = c.step || 5;
    const add = c.addPerStep != null ? c.addPerStep : 0.25;
    const max = c.maxMult != null ? c.maxMult : 2;
    const mult = 1 + Math.floor(Math.max(0, combo) / step) * add;
    // 浮点收敛到 2 位，避免 1.2500000000000002 之类
    return Math.min(max, Math.round(mult * 100) / 100);
  }

  function newState() {
    return {
      score: 0,      // 本局得分（可为负）
      combo: 0,      // 当前连击
      bestCombo: 0,  // 本局最高连击
      hits: 0,       // 命中的鱼干 / 金鱼数
      bombs: 0,      // 误点的炸弹数
      breaks: 0,     // combo 被炸断的次数
      expired: 0,    // 超时消失的目标数（不算失误，不断 combo）
    };
  }

  /**
   * 命中一次目标。直接改传入的 state，并返回本次结果。
   * @returns {{type:string, delta:number, mult:number, combo:number, bomb:boolean}}
   */
  function hit(state, type, cfg) {
    const t = cfg.targets[type];
    const base = (t && t.score) || 0;

    if (type === 'bomb') {
      state.score += base;                  // 负分，不吃倍率
      state.combo = 0;
      state.bombs += 1;
      state.breaks += 1;
      return { type, delta: base, mult: 1, combo: 0, bomb: true };
    }

    const mult = multiplierOf(state.combo, cfg);
    const delta = Math.round(base * mult);
    state.score += delta;
    state.combo += 1;
    state.hits += 1;
    if (state.combo > state.bestCombo) state.bestCombo = state.combo;
    return { type, delta, mult, combo: state.combo, bomb: false };
  }

  /** 目标超时自己消失：不计失误、不断 combo */
  function expire(state) {
    state.expired += 1;
    return state;
  }

  /** 局末结算：得分 → 金币（负分不倒扣） */
  function settle(score, cfg) {
    const rate = cfg.coinsPerScore != null ? cfg.coinsPerScore : 0.5;
    return { earned: Math.max(0, Math.floor(score * rate)), score };
  }

  /**
   * 结算评价分档（决定猫猫夸夸还是吐槽）
   * @returns {'best'|'praise'|'ok'|'roast'}
   */
  function reactFor(score, cfg, opts) {
    const r = (cfg && cfg.react) || {};
    const praise = r.praise != null ? r.praise : 260;
    const ok = r.ok != null ? r.ok : 90;
    if (opts && opts.newBest) return 'best';
    if (score >= praise) return 'praise';
    if (score >= ok) return 'ok';
    return 'roast';
  }

  /** 落盘 patch：金币累加 + 最高分取大（patchSave 是覆盖语义，必须传绝对值） */
  function settlePatch(save, score, cfg) {
    const r = settle(score, cfg);
    const s = save || {};
    const prevBest = (s.stats && s.stats.bestGameScore) || 0;
    const best = Math.max(prevBest, score);
    const newBest = score > prevBest && score > 0;
    return {
      coins: (s.coins || 0) + r.earned,
      stats: { bestGameScore: best },
      earned: r.earned,
      newBest,
      react: reactFor(score, cfg, { newBest }),
    };
  }

  /** 目标在场地内的随机落点（百分比，留边距防止贴边溢出） */
  function randomSpot(rx, ry, cfg) {
    const o = (cfg && cfg.spot) || {};
    const min = o.minPct != null ? o.minPct : 7;
    const max = o.maxPct != null ? o.maxPct : 93;
    return { x: min + (max - min) * rx, y: min + (max - min) * ry };
  }

  return {
    TYPES,
    rollType, aliveMsOf, spawnGap, multiplierOf,
    newState, hit, expire, settle, reactFor, settlePatch, randomSpot,
  };
});
