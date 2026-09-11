/**
 * 面板 · 抽卡 tab
 * 普通池（1 券 / 150 金币）+ 高级池（200 金币，好感 Lv5 解锁）
 * 逻辑全部走 src/shared/gacha.js（已自测），这里只管 UI 与落盘。
 */
(function () {
  const P = window.MGW_Panel;
  const G = window.MGW_Gacha;

  const refs = {};
  let rootEl = null;
  let busy = false;
  let lastResult = null;

  function reasonText(r) {
    switch (r.reason) {
      case 'no_coins': return '金币不够';
      case 'no_tickets': return '抽卡券不够';
      case 'locked': return `高级池需要好感 Lv${r.needLevel}`;
      case 'bad_pay': return '这个卡池不收这种货币';
      case 'no_cards': return '卡池是空的';
      default: return '抽不了：' + r.reason;
    }
  }

  function render(root) {
    rootEl = root;
    root.innerHTML = '';
    const g = P.CONFIG.gacha;

    const head = P.el('div', 'sec-head');
    head.appendChild(P.el('h2', 'sec-title', '抽卡'));
    head.appendChild(P.el('div', 'dim', `普通池 N${pct(g.normal.rates.N)} / R${pct(g.normal.rates.R)} / SR${pct(g.normal.rates.SR)} / SSR${pct(g.normal.rates.SSR)}`));
    root.appendChild(head);

    const row = P.el('div', 'pool-row');

    /* 普通池 */
    const normal = P.el('div', 'pool');
    normal.appendChild(P.el('h3', null, '普通池'));
    normal.appendChild(P.el('p', 'cost', `${g.normal.costTickets} 抽卡券 或 ${g.normal.costCoins} 金币 · 单抽`));
    const nBtns = P.el('div', 'btns');
    refs.btnTicket = P.el('button', 'btn primary');
    refs.btnTicket.textContent = `🎟️ 用券抽（${g.normal.costTickets}）`;
    refs.btnTicket.addEventListener('click', () => doDraw('normal', 'tickets'));
    refs.btnCoin = P.el('button', 'btn');
    refs.btnCoin.textContent = `🪙 用金币抽（${g.normal.costCoins}）`;
    refs.btnCoin.addEventListener('click', () => doDraw('normal', 'coins'));
    nBtns.appendChild(refs.btnTicket);
    nBtns.appendChild(refs.btnCoin);
    normal.appendChild(nBtns);
    row.appendChild(normal);

    /* 高级池 */
    const premium = P.el('div', 'pool');
    refs.premiumPool = premium;
    const ph = P.el('h3');
    ph.appendChild(document.createTextNode('高级池'));
    refs.premiumTag = P.el('span', 'rar-tag', 'SR/SSR 概率更高');
    refs.premiumTag.style.setProperty('--rbg', '#efe6ff');
    refs.premiumTag.style.setProperty('--rtext', '#6b3fc4');
    ph.appendChild(refs.premiumTag);
    premium.appendChild(ph);
    refs.premiumCost = P.el('p', 'cost', `${g.premium.costCoins} 金币 · 单抽`);
    premium.appendChild(refs.premiumCost);
    const pBtns = P.el('div', 'btns');
    refs.btnPremium = P.el('button', 'btn primary', `🪙 抽一次（${g.premium.costCoins}）`);
    refs.btnPremium.addEventListener('click', () => doDraw('premium', 'coins'));
    pBtns.appendChild(refs.btnPremium);
    premium.appendChild(pBtns);
    row.appendChild(premium);

    root.appendChild(row);

    /* 保底进度 */
    const pity = P.el('div', 'pity-box');
    refs.pityText = P.el('div', 'sec-title');
    pity.appendChild(refs.pityText);
    const pbar = P.el('div', 'progress');
    refs.pityFill = P.el('i');
    pbar.appendChild(refs.pityFill);
    pity.appendChild(pbar);
    pity.appendChild(P.el('div', 'dim', `保底计数两个池共用；第 ${g.pityLimit} 抽必出 SSR`));
    root.appendChild(pity);

    /* 结果区 */
    const wrap = P.el('div', 'result-wrap');
    refs.result = wrap;
    root.appendChild(wrap);

    refresh();
    if (lastResult) paintResult(lastResult, false);
    else wrap.appendChild(P.el('div', 'hint', '抽一张试试手气 🎴'));
  }

  function pct(v) { return Math.round(v * 100) + '%'; }

  /** 只更新状态文案 / 按钮可用性，不重建 DOM（避免打断动画） */
  function refresh() {
    const s = P.save || {};
    const g = P.CONFIG.gacha;
    const lv = P.levelOf(s.affection);
    const unlocked = lv >= g.premium.unlockLevel;

    if (refs.btnTicket) refs.btnTicket.disabled = busy || (s.tickets || 0) < g.normal.costTickets;
    if (refs.btnCoin) refs.btnCoin.disabled = busy || (s.coins || 0) < g.normal.costCoins;
    if (refs.btnPremium) refs.btnPremium.disabled = busy || !unlocked || (s.coins || 0) < g.premium.costCoins;

    if (refs.premiumCost) {
      refs.premiumCost.textContent = unlocked
        ? `${g.premium.costCoins} 金币 · 单抽（概率 N${pct(g.premium.rates.N)} / R${pct(g.premium.rates.R)} / SR${pct(g.premium.rates.SR)} / SSR${pct(g.premium.rates.SSR)}）`
        : `未解锁：好感 Lv${g.premium.unlockLevel} 开启（当前 Lv${lv}）`;
    }
    if (refs.premiumTag) refs.premiumTag.textContent = unlocked ? '已解锁' : `Lv${g.premium.unlockLevel} 解锁`;
    if (refs.premiumPool) refs.premiumPool.classList.toggle('locked', !unlocked);

    if (refs.pityText) {
      const pity = s.pity || 0;
      const left = Math.max(0, g.pityLimit - pity);
      refs.pityText.textContent = `保底进度 ${pity} / ${g.pityLimit} · 再抽 ${left} 次必出 SSR`;
    }
    if (refs.pityFill) {
      const pity = s.pity || 0;
      refs.pityFill.style.width = ((pity / g.pityLimit) * 100).toFixed(1) + '%';
    }
  }

  async function doDraw(pool, payWith) {
    if (busy) return;
    const r = G.compute({ cardList: P.cards, save: P.save, config: P.CONFIG, pool, payWith });
    if (!r.ok) { P.toast(reasonText(r)); refresh(); return; }

    busy = true;
    setBusyUI(true);

    await P.applyPatch(r.patch);   // 触发 onSave → refresh()
    lastResult = r;
    paintResult(r, true);
    P.toast(r.dup ? `重复卡 → +${r.dupCoins} 金币` : `新卡入册：${r.card.name}`, 2600);

    setTimeout(() => { busy = false; setBusyUI(false); refresh(); }, 650);
  }

  function setBusyUI(v) {
    if (!v) { refresh(); return; }   // 解禁：交给 refresh 按真实资源判断
    for (const b of [refs.btnTicket, refs.btnCoin, refs.btnPremium]) if (b) b.disabled = true;
  }

  function paintResult(r, animate) {
    const wrap = refs.result;
    if (!wrap) return;
    wrap.innerHTML = '';

    const face = P.cardFace(r.card, { large: true, reveal: animate });
    wrap.appendChild(face);

    const line = P.el('div', 'result-line');
    line.appendChild(P.el('b', r.dup ? 'dup' : 'new', r.rarity + ' · ' + (r.dup ? '重复' : '新卡')));
    line.appendChild(document.createTextNode(' ' + r.card.name));
    if (r.dup) line.appendChild(P.el('span', 'good', `　+${r.dupCoins} 金币`));
    if (r.forced) line.appendChild(P.el('span', 'good', '　（保底触发）'));
    wrap.appendChild(line);

    // 结果卡可能落在视口外，抽完顺手滚到可见处
    if (animate && typeof wrap.scrollIntoView === 'function') {
      try { wrap.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e) { /* 环境不支持就忽略 */ }
    }
  }

  function onSave() { refresh(); }

  window.MGW_TabDraw = { render, onSave };
})();
