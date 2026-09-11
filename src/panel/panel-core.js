/**
 * 喵工位 · 面板 —— 公共层
 * 负责：加载卡片数据 / 存档读写（乐观更新）/ 稀有度样式 / 卡面占位渲染 / 弹层与提示
 *
 * 卡面图案尚未接入（老大后期自己上传）：cardFace() 只画占位，
 * 后续换成 canvas 渲染 cats/<cat>.json + accessories/<accessory>.json 即可，接口不变。
 */
(function () {
  const CONFIG = window.MGW_CONFIG;

  /* 稀有度色板（暗色机箱适配；与 panel.css 的 --r-* 令牌一一对应）
     拉明明度差，保证「已拥有 N」与「未解锁剪影」一眼可分 */
  const RARITY = {
    N:   { text: '#cbbda6', bg: '#2e261d', ring: '#7a6750' },
    R:   { text: '#8fdcff', bg: '#14303d', ring: '#3f86a8' },
    SR:  { text: '#cdb2ff', bg: '#2a2044', ring: '#7351bd' },
    SSR: { text: '#ffda6b', bg: '#3a2b0e', ring: '#b08a1e' },
  };

  const S = {
    save: null,
    cards: [],
    byId: {},
    order: ['N', 'R', 'SR', 'SSR'],
    listeners: [],
  };

  /* ---------------- 存档 ---------------- */

  function mergeDeep(target, patch) {
    for (const k of Object.keys(patch)) {
      const v = patch[k];
      if (v && typeof v === 'object' && !Array.isArray(v) &&
          target[k] && typeof target[k] === 'object' && !Array.isArray(target[k])) {
        mergeDeep(target[k], v);
      } else {
        target[k] = v;
      }
    }
    return target;
  }

  async function boot() {
    const file = await window.mgw.readJson('assets/cards.json');
    S.cards = file.cards || [];
    S.order = file.rarityOrder || S.order;
    S.byId = {};
    for (const c of S.cards) S.byId[c.id] = c;
    S.save = await window.mgw.loadSave();
    return S;
  }

  async function refreshSave() {
    S.save = await window.mgw.loadSave();
    emit();
    return S.save;
  }

  /** 乐观更新：先本地合并（防连点读旧值），再用主进程快照兜底 */
  async function applyPatch(patch) {
    if (S.save) mergeDeep(S.save, patch);
    S.save = await window.mgw.patchSave(patch);
    emit();
    return S.save;
  }

  function on(fn) { S.listeners.push(fn); return () => { S.listeners = S.listeners.filter((f) => f !== fn); }; }
  function emit() { for (const fn of S.listeners) { try { fn(S.save); } catch (e) { console.error('[panel] listener failed:', e.message); } } }

  /* ---------------- 查询 ---------------- */

  function levelOf(aff) { return window.MGW_Gacha.levelOf(aff || 0, CONFIG.affectionLevels); }
  function owned(id) { return (S.save && S.save.cards && S.save.cards[id]) || 0; }
  function collected() { return S.cards.filter((c) => owned(c.id) > 0).length; }
  function cardsOf(rarity) { return S.cards.filter((c) => c.rarity === rarity); }
  function collectedOf(rarity) { return cardsOf(rarity).filter((c) => owned(c.id) > 0).length; }

  /* ---------------- 卡面（图案留空 → 占位） ---------------- */

  /**
   * @param {object} card
   * @param {object} [opts] { locked:boolean, large:boolean, reveal:boolean }
   */
  function cardFace(card, opts) {
    const o = opts || {};
    const rar = RARITY[card.rarity] || RARITY.N;
    const el = document.createElement('div');
    el.className = 'face' + (o.locked ? ' locked' : '') + (o.large ? ' large' : '') + (o.reveal ? ' reveal' : '');
    if (card.rarity === 'SSR' && !o.locked) el.classList.add('ssr');
    el.dataset.rarity = card.rarity;
    el.style.setProperty('--fbg', rar.bg);
    el.style.setProperty('--rtext', rar.text);
    el.style.setProperty('--rbg', rar.bg);
    el.style.setProperty('--ring', rar.ring);

    // 图案占位：等老大上传卡面素材后替换
    const art = document.createElement('div');
    art.className = 'face-art';
    const ph = document.createElement('span');
    ph.className = 'ph';
    ph.textContent = o.locked ? '?' : '🐾';
    art.appendChild(ph);
    if (!o.locked && o.large) {
      const hint = document.createElement('span');
      hint.className = 'ph-hint';
      hint.textContent = '图案待接入';
      art.appendChild(hint);
    }

    const foot = document.createElement('div');
    foot.className = 'face-foot';
    const name = document.createElement('span');
    name.className = 'face-name';
    name.textContent = o.locked ? '???' : card.name;
    const tag = document.createElement('span');
    tag.className = 'face-rar';
    tag.textContent = card.rarity;
    foot.appendChild(name);
    foot.appendChild(tag);

    el.appendChild(art);
    el.appendChild(foot);

    const n = owned(card.id);
    if (n > 1) {
      const cnt = document.createElement('span');
      cnt.className = 'face-count';
      cnt.textContent = '×' + n;
      el.appendChild(cnt);
    }
    return el;
  }

  function rarityColor(rarity) { return RARITY[rarity] || RARITY.N; }

  /* ---------------- 提示 / 弹层 ---------------- */

  let toastTimer = null;
  function toast(msg, ms) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hidden'), ms || 2200);
  }

  function openSheet(node) {
    const sheet = document.getElementById('sheet');
    sheet.innerHTML = '';
    sheet.appendChild(node);
    document.getElementById('overlay').classList.remove('hidden');
  }
  function closeSheet() {
    document.getElementById('overlay').classList.add('hidden');
    document.getElementById('sheet').innerHTML = '';
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  window.MGW_Panel = {
    CONFIG, RARITY,
    state: S,
    boot, refreshSave, applyPatch, on,
    levelOf, owned, collected, cardsOf, collectedOf,
    cardFace, rarityColor, toast, openSheet, closeSheet, el,
    get save() { return S.save; },
    get cards() { return S.cards; },
    get cardById() { return S.byId; },
  };
})();
