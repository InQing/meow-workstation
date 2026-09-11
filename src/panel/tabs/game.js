/**
 * 面板 · 游戏中心（列表页）
 *
 * 2026-09-10 老大定：游戏 tab 不再直接放某一个游戏，而是先列出来让玩家选，
 * 点进去进入具体游戏，游戏页左上角可以返回列表。
 *
 * 子游戏在 tabs/games/ 下，各自暴露 render(root) / onSave() / onHide()，
 * 本模块只负责列表渲染、进出调度与把钩子透传下去（切走 tab 也要中止子游戏本局）。
 */
(function () {
  const P = window.MGW_Panel;

  const GAMES = [
    {
      key: 'fish', icon: '🐟', name: '鱼干突袭',
      desc: '20 秒限时，点掉冒头的鱼干；炸弹别碰',
      get: () => window.MGW_GameFish,
    },
    {
      key: 'reflex', icon: '⚡', name: '反应力测试',
      desc: '变色就点，5 次测出你的真实手速',
      get: () => window.MGW_GameReflex,
    },
  ];

  let rootEl = null;
  let currentMod = null;

  /* ---------------- 列表页 ---------------- */

  function render(root) {
    leave();               // 重进 tab 一律回到列表，不继承上次的游戏页
    rootEl = root;
    paintList();
  }

  function paintList() {
    currentMod = null;
    rootEl.innerHTML = '';

    const head = P.el('div', 'sec-head');
    head.appendChild(P.el('h2', 'sec-title', '游戏'));
    head.appendChild(P.el('div', 'dim', '摸鱼专用 · 成绩计入金币与纪录'));
    rootEl.appendChild(head);

    const grid = P.el('div', 'game-list');
    for (const g of GAMES) grid.appendChild(buildCard(g));
    rootEl.appendChild(grid);
  }

  function buildCard(g) {
    const card = P.el('button', 'game-card');
    card.type = 'button';

    card.appendChild(P.el('span', 'gc-icon', g.icon));

    const body = P.el('div', 'gc-body');
    body.appendChild(P.el('div', 'gc-name', g.name));
    body.appendChild(P.el('div', 'gc-desc', g.desc));
    body.appendChild(P.el('div', 'gc-rec', recordText(g)));
    card.appendChild(body);

    card.appendChild(P.el('span', 'gc-go', '进入 ›'));
    card.addEventListener('click', () => openGame(g));
    return card;
  }

  /** 列表页显示的纪录（真源在 save.stats） */
  function recordText(g) {
    const s = (P.save && P.save.stats) || {};
    if (g.key === 'fish') {
      const b = s.bestGameScore || 0;
      return b ? `最高分 ${b}` : '还没玩过';
    }
    const b = s.bestReflexMs || 0;
    return b ? `最佳平均 ${b} ms` : '还没测过';
  }

  /* ---------------- 进出子游戏 ---------------- */

  function openGame(g) {
    const mod = g.get();
    if (!mod || !mod.render) return;
    currentMod = mod;

    rootEl.innerHTML = '';

    const bar = P.el('div', 'game-back');
    const back = P.el('button', 'game-back-btn');
    back.type = 'button';
    back.textContent = '← 游戏列表';
    back.addEventListener('click', () => { leave(); paintList(); });
    bar.appendChild(back);
    bar.appendChild(P.el('span', 'gb-title', g.icon + ' ' + g.name));
    rootEl.appendChild(bar);

    const holder = P.el('div', 'game-holder');
    rootEl.appendChild(holder);
    mod.render(holder);
  }

  /** 收摊：离开子游戏（切走 tab、返回列表、重进都会走这里） */
  function leave() {
    if (currentMod && currentMod.onHide) {
      try { currentMod.onHide(); } catch (e) { console.error('[game] onHide failed:', e.message); }
    }
    currentMod = null;
  }

  /* ---------------- 对外 ---------------- */

  function onSave() {
    // 在子游戏里 → 交给它局部刷新；在列表页 → 重绘（纪录文案会变）
    if (currentMod) {
      if (currentMod.onSave) {
        try { currentMod.onSave(); } catch (e) { console.error('[game] onSave failed:', e.message); }
      }
      return;
    }
    if (rootEl) paintList();
  }

  /** 切走 tab → 中止子游戏本局（老板来了立刻收摊） */
  function onHide() { leave(); }

  window.MGW_TabGame = { render, onSave, onHide };
})();
