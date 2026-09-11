/**
 * 面板 · 图鉴 tab
 * 17 张卡收集进度 + 按稀有度分组网格 + 点开看详情（大图 / 描述 / 拥有数）
 * 卡面图案暂为占位（素材待老大上传）。
 */
(function () {
  const P = window.MGW_Panel;
  let rootEl = null;

  function render(root) {
    rootEl = root;
    root.innerHTML = '';

    const total = P.cards.length;
    const got = P.collected();

    const head = P.el('div', 'sec-head');
    head.appendChild(P.el('h2', 'sec-title', '卡牌图鉴'));
    head.appendChild(P.el('div', 'dim', `已收集 ${got} / ${total}`));
    root.appendChild(head);

    const bar = P.el('div', 'progress');
    const fill = P.el('i');
    fill.style.width = (total ? (got / total) * 100 : 0).toFixed(1) + '%';
    bar.appendChild(fill);
    root.appendChild(bar);

    const sub = P.el('div', 'dim');
    sub.textContent = P.state.order
      .map((r) => `${r} ${P.collectedOf(r)}/${P.cardsOf(r).length}`)
      .join('　');
    root.appendChild(sub);

    for (const r of P.state.order) {
      const list = P.cardsOf(r);
      if (!list.length) continue;
      const color = P.rarityColor(r);

      const group = P.el('div', 'rar-group');
      const h = P.el('div', 'rar-head');
      const tag = P.el('span', 'rar-tag', r);
      tag.style.setProperty('--rbg', color.bg);
      tag.style.setProperty('--rtext', color.text);
      h.appendChild(tag);
      h.appendChild(P.el('span', 'dim', `${P.collectedOf(r)} / ${list.length}`));
      group.appendChild(h);

      const grid = P.el('div', 'grid');
      list.forEach((card, i) => {
        const locked = P.owned(card.id) === 0;
        const face = P.cardFace(card, { locked });
        face.style.setProperty('--i', String(i));   // 入场错峰用
        face.tabIndex = 0;
        face.setAttribute('role', 'button');
        face.setAttribute('aria-label', (locked ? '未收集：' : '') + card.name + ' ' + card.rarity);
        face.addEventListener('click', () => openDetail(card, locked));
        face.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(card, locked); }
        });
        grid.appendChild(face);
      });
      group.appendChild(grid);
      root.appendChild(group);
    }
  }

  function openDetail(card, locked) {
    const sheet = document.createElement('div');
    const detail = P.el('div', 'detail');
    detail.appendChild(P.cardFace(card, { locked, large: true }));

    const meta = P.el('div', 'meta');
    meta.appendChild(P.el('h2', null, locked ? '??? · ' + card.rarity : card.name));
    if (locked) {
      meta.appendChild(P.el('p', 'desc', '还没收集到这张卡。去抽卡页碰碰运气吧。'));
    } else {
      meta.appendChild(P.el('p', 'desc', card.desc || ''));
      const n = P.owned(card.id);
      const dup = P.CONFIG.gacha.dupToCoins[card.rarity] || 0;
      meta.appendChild(P.el('div', 'kv',
        `稀有度 ${card.rarity}　拥有 ${n} 张\n再次抽到重复卡 → +${dup} 金币`));
    }
    detail.appendChild(meta);
    sheet.appendChild(detail);

    const row = P.el('div', 'close-row');
    const btn = P.el('button', 'btn primary', '关闭');
    btn.addEventListener('click', P.closeSheet);
    row.appendChild(btn);
    sheet.appendChild(row);

    P.openSheet(sheet);
  }

  /** 存档变化（抽到新卡等）时刷新网格 */
  function onSave() { if (rootEl) render(rootEl); }

  window.MGW_TabCollection = { render, onSave };
})();
