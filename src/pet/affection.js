/**
 * 好感度 / 经济（渲染层）
 * - 摸头：+2 好感，8s 冷却；1 分钟内超 5 次 → 嫌弃 + 30s 零收益
 * - 喂鱼干：15 金币 → +6 好感
 * - 等级 Lv1–10 与解锁物
 * ⚠️ patch 是覆盖语义，所有变动必须基于存档现值计算后再写
 */
(function () {
  const CONFIG = window.MGW_CONFIG;

  const UNLOCKS = {
    2:  { key: 'speech2', label: '新台词包：话变多了' },
    3:  { key: 'stretch', label: '新动作：伸懒腰' },
    5:  { key: 'premium', label: '高级卡池解锁' },
    7:  { key: 'belly',   label: '新动作：翻肚皮' },
    10: { key: 'king',    label: '称号：猫王' },
  };

  const S = {
    getSave: () => ({}),
    applyPatch: () => ({}),
    taps: [],
    lastAwardAt: 0,
    penaltyUntil: 0,
    onLevelUp: null,
  };

  function levelOf(affection) {
    const th = CONFIG.affectionLevels;
    let lv = 1;
    for (let i = 0; i < th.length; i++) if (affection >= th[i]) lv = i + 1;
    return lv;
  }

  function unlockedKeys(save) {
    return (save && save.unlocks) || [];
  }

  function has(key) {
    return unlockedKeys(S.getSave()).includes(key);
  }

  /** 两个等级之间新增的解锁项 */
  function diffUnlocks(fromLv, toLv) {
    const known = new Set(unlockedKeys(S.getSave()));
    const added = [];
    for (let lv = fromLv + 1; lv <= toLv; lv++) {
      const u = UNLOCKS[lv];
      if (u && !known.has(u.key)) { added.push({ lv, ...u }); known.add(u.key); }
    }
    return added;
  }

  /** 增加好感，返回 { level, leveledUp, unlocked } */
  function addAffection(n) {
    const sv = S.getSave();
    const before = levelOf(sv.affection || 0);
    const next = (sv.affection || 0) + n;
    const after = levelOf(next);
    const patch = { affection: next };

    if (after > before) {
      const added = diffUnlocks(before, after);
      if (added.length) {
        patch.unlocks = [...unlockedKeys(sv), ...added.map((u) => u.key)];
      }
      S.applyPatch(patch);
      return { level: after, leveledUp: true, unlocked: added };
    }
    S.applyPatch(patch);
    return { level: after, leveledUp: false, unlocked: [] };
  }

  /** 摸头 */
  function pet() {
    const cfg = CONFIG.petting;
    const now = Date.now();

    if (now < S.penaltyUntil) return { ok: false, reason: 'penalty' };

    S.taps = S.taps.filter((t) => now - t < cfg.spamWindowSec * 1000);
    S.taps.push(now);
    if (S.taps.length > cfg.spamThreshold) {
      S.penaltyUntil = now + cfg.penaltySec * 1000;
      S.taps = [];
      return { ok: false, reason: 'spam' };
    }
    if (now - S.lastAwardAt < cfg.cooldownSec * 1000) {
      return { ok: false, reason: 'cooldown' };
    }
    S.lastAwardAt = now;
    return { ok: true, ...addAffection(cfg.affection) };
  }

  /** 喂鱼干 */
  function feed() {
    const cfg = CONFIG.feeding;
    const sv = S.getSave();
    if ((sv.coins || 0) < cfg.costCoins) return { ok: false, reason: 'poor' };
    // 扣钱与加好感合并一次写入，避免中间态
    const next = levelOf((sv.affection || 0) + cfg.affection);
    const before = levelOf(sv.affection || 0);
    const patch = {
      coins: (sv.coins || 0) - cfg.costCoins,
      affection: (sv.affection || 0) + cfg.affection,
    };
    let unlocked = [];
    if (next > before) {
      const added = diffUnlocks(before, next);
      if (added.length) patch.unlocks = [...unlockedKeys(sv), ...added.map((u) => u.key)];
      unlocked = added;
    }
    S.applyPatch(patch);
    return { ok: true, level: next, leveledUp: next > before, unlocked };
  }

  /** 台词池（Lv2 解锁后 idle 台词扩充） */
  function poolFor(key, speech) {
    const base = (speech && speech[key]) || [];
    if (key === 'idle' && has('speech2')) {
      return base.concat(speech.idle2 || []);
    }
    return base;
  }

  /** 已解锁的可随机闲晃动作 */
  function idleActions() {
    const list = [];
    if (has('stretch')) list.push('stretch');
    if (has('belly')) list.push('belly');
    return list;
  }

  window.Affection = {
    init(opts) {
      Object.assign(S, opts);
      return this;
    },
    pet, feed, addAffection, levelOf, has, poolFor, idleActions,
    level: () => levelOf(S.getSave().affection || 0),
    get unlockList() { return UNLOCKS; },
  };
})();
