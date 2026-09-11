/**
 * 喵工位 — 抽卡纯逻辑（无 DOM、无 IPC，可被 node require 做自测）
 *
 * 加载方式：
 *   主进程/node:  const Gacha = require('./src/shared/gacha.js')
 *   渲染页:       <script src="../shared/gacha.js"></script> → 全局 MGW_Gacha
 *
 * 设计约定：
 * - compute() 只「算」不「写」，返回一个可直接交给 patchSave 的 patch；
 *   真正的落盘由调用方完成（渲染层用乐观更新，见 panel-core.js）。
 * - patch 是覆盖语义，所有数值都基于传入 save 的现值重新计算。
 * - rng 可注入，默认 Math.random（自测里传种子随机数）。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.MGW_Gacha = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  const RARITIES = ['N', 'R', 'SR', 'SSR'];

  function levelOf(affection, thresholds) {
    let lv = 1;
    for (let i = 0; i < thresholds.length; i++) if (affection >= thresholds[i]) lv = i + 1;
    return lv;
  }

  /** 按累计概率摇一个稀有度；rates 形如 { N:0.6, R:0.3, SR:0.09, SSR:0.01 } */
  function rollRarity(rates, rng) {
    const r = (rng || Math.random)();
    let acc = 0;
    for (const key of RARITIES) {
      acc += rates[key] || 0;
      if (r < acc) return key;
    }
    return 'N'; // 浮点误差兜底
  }

  /** 在卡池里按稀有度随机取一张；该稀有度无卡则退到全池 */
  function pickCard(cardList, rarity, rng) {
    const pool = cardList.filter((c) => c.rarity === rarity);
    const list = pool.length ? pool : cardList;
    return list[Math.floor((rng || Math.random)() * list.length)];
  }

  /**
   * 计算一次抽卡的所有结果，不落盘。
   * @param {object} opts
   *   cardList  卡池数组（assets/cards.json 的 cards）
   *   save      当前存档快照
   *   config    MGW_CONFIG
   *   pool      'normal' | 'premium'
   *   payWith   'tickets' | 'coins'
   *   rng       可选，随机源
   * @returns {{ok:boolean, reason?:string, card?, rarity?, dup?, dupCoins?, forced?, patch?, pityAfter?}}
   */
  function compute(opts) {
    const { cardList, save, config, pool, payWith } = opts;
    const rng = opts.rng || Math.random;
    const g = config.gacha;

    if (!Array.isArray(cardList) || !cardList.length) return { ok: false, reason: 'no_cards' };
    if (pool !== 'normal' && pool !== 'premium') return { ok: false, reason: 'bad_pool' };
    if (payWith !== 'tickets' && payWith !== 'coins') return { ok: false, reason: 'bad_pay' };

    const isPremium = pool === 'premium';
    const cfg = isPremium ? g.premium : g.normal;

    // 解锁校验：高级池需好感 Lv5
    if (isPremium) {
      const lv = levelOf(save.affection || 0, config.affectionLevels);
      if (lv < g.premium.unlockLevel) return { ok: false, reason: 'locked', needLevel: g.premium.unlockLevel };
    }
    // 付费校验
    if (payWith === 'tickets') {
      if (isPremium) return { ok: false, reason: 'bad_pay' }; // 高级池只收金币
      if ((save.tickets || 0) < g.normal.costTickets) return { ok: false, reason: 'no_tickets' };
    } else {
      if ((save.coins || 0) < cfg.costCoins) return { ok: false, reason: 'no_coins' };
    }

    // 稀有度：第 pityLimit 抽强制 SSR
    const pity = save.pity || 0;
    const forced = pity + 1 >= g.pityLimit;
    const rarity = forced ? 'SSR' : rollRarity(cfg.rates, rng);
    const card = pickCard(cardList, rarity, rng);

    const owned = (save.cards && save.cards[card.id]) || 0;
    const dup = owned > 0;
    const dupCoins = dup ? (g.dupToCoins[rarity] || 0) : 0;

    const patch = {
      cards: { [card.id]: owned + 1 },
      pity: rarity === 'SSR' ? 0 : pity + 1,
      stats: { draws: ((save.stats && save.stats.draws) || 0) + 1 },
    };
    if (payWith === 'tickets') patch.tickets = (save.tickets || 0) - g.normal.costTickets;
    else patch.coins = (save.coins || 0) - cfg.costCoins;

    if (dup) patch.coins = ((patch.coins != null) ? patch.coins : (save.coins || 0)) + dupCoins;

    return { ok: true, card, rarity, dup, dupCoins, forced, patch, pityAfter: patch.pity };
  }

  /** 单张卡的"重复价值"（图鉴详情里用） */
  function dupValue(rarity, config) {
    return (config.gacha.dupToCoins && config.gacha.dupToCoins[rarity]) || 0;
  }

  return { RARITIES, levelOf, rollRarity, pickCard, compute, dupValue };
});
