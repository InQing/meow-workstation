/**
 * 面板入口：tab 调度 + 顶栏资源刷新
 */
(function () {
  const P = window.MGW_Panel;

  const TABS = {
    collection: window.MGW_TabCollection,
    draw: window.MGW_TabDraw,
    game: window.MGW_TabGame,
    settings: window.MGW_TabSettings,
  };

  const pages = {};
  document.querySelectorAll('.page').forEach((p) => { pages[p.dataset.page] = p; });
  let current = 'collection';

  function updateRes() {
    const s = P.save || {};
    const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
    set('res-coins', s.coins || 0);
    set('res-tickets', s.tickets || 0);
    set('res-affection', 'Lv' + P.levelOf(s.affection));
    set('res-tomato', `${(s.pomodoro && s.pomodoro.today) || 0} / ${(s.pomodoro && s.pomodoro.total) || 0}`);
  }

  function renderCurrent() {
    const mod = TABS[current];
    if (mod && mod.render) mod.render(pages[current]);
  }

  function show(tab) {
    if (!TABS[tab]) tab = 'collection';
    // 离开当前 tab 时给它一个收摊机会（游戏 tab 靠这个中止本局，不结算）
    const prev = TABS[current];
    if (tab !== current && prev && prev.onHide) {
      try { prev.onHide(); } catch (e) { console.error('[panel] tab onHide failed:', e.message); }
    }
    current = tab;
    document.querySelectorAll('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    for (const k of Object.keys(pages)) pages[k].classList.toggle('active', k === tab);
    renderCurrent();
  }

  document.querySelectorAll('.nav-btn').forEach((b) => {
    b.addEventListener('click', () => show(b.dataset.tab));
  });

  const overlay = document.getElementById('overlay');
  overlay.addEventListener('click', (e) => { if (e.target === overlay) P.closeSheet(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') P.closeSheet(); });

  // 桌宠点 📖 打开面板时指定 tab
  window.mgw.onPanelNavigate((tab) => show(tab));

  // 存档变化：刷新顶栏 + 当前 tab 的局部状态
  P.on(() => {
    updateRes();
    const mod = TABS[current];
    if (mod && mod.onSave) mod.onSave();
  });

  P.boot()
    .then(() => { updateRes(); show('collection'); console.log('[panel] ready'); })
    .catch((err) => console.error('[panel] boot failed:', err));
})();
