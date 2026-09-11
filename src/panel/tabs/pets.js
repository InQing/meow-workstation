/**
 * 面板 · 桌宠 tab
 * 内置猫切换 + 我的猫（上传 / 改名 / 删除 / 10 个槽位：默认形象 + 9 状态）
 * 图片由主进程归一化存到 userData/pets/，这里只拿 dataURL 显示
 */
(function () {
  const P = window.MGW_Panel;
  const CONFIG = P.CONFIG;
  const A = window.MGW_PetAssets;

  let rootEl = null;
  const refs = {};
  let custom = [];          // pets:list 结果
  let editing = null;       // 正在编辑槽位的图片桌宠 id
  const catCache = {};

  function currentSource() { return A.resolveSource(P.save); }

  function render(root) {
    rootEl = root;
    root.innerHTML = '';

    const head = P.el('div', 'sec-head');
    head.appendChild(P.el('h2', 'sec-title', '桌宠'));
    head.appendChild(P.el('div', 'dim', '内置像素猫与你自己上传的猫，点一下即切换'));
    root.appendChild(head);

    refs.builtin = P.el('div', 'pet-grid');
    root.appendChild(section('内置猫', refs.builtin));

    refs.custom = P.el('div', 'pet-grid');
    const addBtn = P.el('button', 'btn primary pet-add', '＋ 上传新桌宠');
    addBtn.addEventListener('click', onUpload);
    const customSec = section('我的猫', refs.custom);
    customSec.appendChild(addBtn);
    root.appendChild(customSec);

    refs.slots = P.el('div');
    root.appendChild(refs.slots);

    refresh();
  }

  function section(title, bodyEl) {
    const box = P.el('div', 'pet-sec');
    box.appendChild(P.el('div', 'sec-title', title));
    box.appendChild(bodyEl);
    return box;
  }

  /** 拉列表 + 重画三块（页面每次显示 / 存档变化都会走这里） */
  async function refresh() {
    if (!rootEl) return;
    custom = await window.mgw.petsList();
    renderBuiltin();
    renderCustom();
    renderSlots();
  }

  /* ---------------- 内置猫 ---------------- */

  function renderBuiltin() {
    const cur = currentSource();
    refs.builtin.innerHTML = '';
    for (const cat of CONFIG.builtinCats) {
      const active = cur.type === 'builtin' && cur.ref === cat.id;
      const card = P.el('div', 'pet-card' + (active ? ' active' : ''));
      const thumb = P.el('div', 'thumb');
      const cv = document.createElement('canvas');
      cv.width = cv.height = 24;
      thumb.appendChild(cv);
      card.appendChild(thumb);
      card.appendChild(P.el('div', 'pname', cat.name));
      card.addEventListener('click', async () => {
        const r = await window.mgw.petsSelect({ type: 'builtin', ref: cat.id });
        if (r && r.ok === false) { P.toast(r.message || '切换失败'); return; }
        await P.refreshSave();
        P.toast('已换成' + cat.name);
        refresh();
      });
      refs.builtin.appendChild(card);
      drawCatThumb(cv, cat.id);   // 异步补画（素材读完才有）
    }
  }

  /** 内置猫缩略图：素材是 24×24 字符网格，取 idle 首帧逐格画到 24×24 canvas */
  async function drawCatThumb(canvas, id) {
    try {
      if (!catCache[id]) catCache[id] = await window.mgw.readJson('assets/cats/' + id + '.json');
      const data = catCache[id];
      const grid = data.animations.idle.frames[0].grid;
      const g = canvas.getContext('2d');
      g.clearRect(0, 0, 24, 24);
      for (let y = 0; y < grid.length; y++) {
        for (let x = 0; x < grid[y].length; x++) {
          const color = data.palette[grid[y][x]];
          if (!color) continue;
          g.fillStyle = color;
          g.fillRect(x, y, 1, 1);
        }
      }
    } catch (e) { /* 素材缺失就不画，留空底色 */ }
  }

  /* ---------------- 我的猫（上传的图片桌宠） ---------------- */

  function renderCustom() {
    const cur = currentSource();
    refs.custom.innerHTML = '';
    if (!custom.length) {
      refs.custom.appendChild(P.el('div', 'dim', '还没有自己的猫 —— 点下面的按钮上传一张透明底方形图（PNG/WebP 最好）'));
    }
    for (const pet of custom) {
      const active = cur.type === 'image' && cur.ref === pet.id;
      const card = P.el('div', 'pet-card' + (active ? ' active' : ''));
      const thumb = P.el('div', 'thumb');
      if (pet.thumb) {
        const im = document.createElement('img');
        im.src = pet.thumb;
        thumb.appendChild(im);
      }
      card.appendChild(thumb);
      card.appendChild(P.el('div', 'pname', pet.name));
      card.addEventListener('click', async () => {
        editing = pet.id;                       // 点卡片 = 切换 + 展开槽位编辑
        const r = await window.mgw.petsSelect({ type: 'image', ref: pet.id });
        if (r && r.ok === false) { P.toast(r.message || '切换失败'); return; }
        await P.refreshSave();
        refresh();
      });

      // 改名 / 删除（内置猫没有名字，也没有这两颗按钮）
      const actions = P.el('div', 'pcard-actions');
      const renameBtn = P.el('button', 'pbtn', '改名');
      renameBtn.addEventListener('click', (e) => { e.stopPropagation(); openRename(pet); });
      const del = P.el('button', 'pbtn danger', '删除');
      del.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!window.confirm(`删除「${pet.name}」？图片文件会一起删掉。`)) return;
        const r = await window.mgw.petsRemove(pet.id);
        if (!r.ok) { P.toast(r.message || '删除失败'); return; }
        if (editing === pet.id) editing = null;
        await P.refreshSave();
        P.toast('已删除');
        refresh();
      });
      actions.appendChild(renameBtn);
      actions.appendChild(del);
      card.appendChild(actions);
      refs.custom.appendChild(card);
    }
  }

  /* ---------------- 改名（只有图片桌宠有名字） ---------------- */

  function openRename(pet) {
    const box = P.el('div', 'rename-box');
    box.appendChild(P.el('div', 'sec-title', `给「${pet.name}」改个名字`));

    const field = P.el('div', 'field');
    field.appendChild(P.el('div', 'label', '名字'));
    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 24;
    input.value = pet.name;
    field.appendChild(input);
    box.appendChild(field);

    const row = P.el('div', 'sheet-actions');
    const cancel = P.el('button', 'btn', '取消');
    const ok = P.el('button', 'btn primary', '保存');
    row.appendChild(cancel);
    row.appendChild(ok);
    box.appendChild(row);

    const submit = async () => {
      const r = await window.mgw.petsRename(pet.id, input.value);
      if (!r || r.ok === false) { P.toast((r && r.message) || '改名失败'); return; }
      P.closeSheet();
      P.toast(`已改名为「${r.pet ? r.pet.name : input.value}」`);
      refresh();
    };
    ok.addEventListener('click', submit);
    cancel.addEventListener('click', () => P.closeSheet());
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });

    P.openSheet(box);
    setTimeout(() => { input.focus(); input.select(); }, 0);
  }

  /* ---------------- 槽位（默认形象 + 9 状态） ---------------- */

  // refresh() 会被并发触发（点卡片 + onSave 各一次）→ 用序号作废过期结果，
  // 否则两次异步渲染会在同一个容器里各追加一份（槽位卡片变 20 个）
  let slotSeq = 0;

  async function renderSlots() {
    const seq = ++slotSeq;
    refs.slots.innerHTML = '';
    if (!editing) return;
    const data = await window.mgw.petsGet(editing, { thumb: true });
    if (seq !== slotSeq) return;                 // 期间又刷新过 → 本次作废
    if (!data) { editing = null; return; }
    refs.slots.innerHTML = '';

    const head = P.el('div', 'sec-head');
    head.appendChild(P.el('div', 'sec-title', `「${data.name}」的状态图`));
    head.appendChild(P.el('div', 'dim', '不传的状态自动用「默认形象」；建议透明底方形图'));
    refs.slots.appendChild(head);

    const grid = P.el('div', 'slot-grid');
    for (const slot of A.SLOTS) {
      const filled = !!data.slots[slot];
      const card = P.el('div', 'slot-card' + (filled ? '' : ' empty'));
      const thumb = P.el('div', 'thumb sm');
      if (filled) {
        const im = document.createElement('img');
        im.src = data.slots[slot];
        thumb.appendChild(im);
      } else {
        thumb.appendChild(P.el('span', 'dim', '用默认'));
      }
      card.appendChild(thumb);
      card.appendChild(P.el('div', 'pname', CONFIG.petSlots.labels[slot]));

      const row = P.el('div', 'slot-actions');
      const up = P.el('button', 'btn', filled ? '替换' : '上传');
      up.addEventListener('click', async () => {
        const r = await window.mgw.petsSetSlot(editing, slot);
        if (!r) return;                                   // 用户取消选图
        if (r.ok === false) { P.toast(r.message || '导入失败'); return; }
        P.toast(r.warning || '已保存');
        refresh();
      });
      row.appendChild(up);

      if (slot !== A.DEFAULT_SLOT) {
        const clr = P.el('button', 'btn', '清除');
        clr.disabled = !filled;
        clr.addEventListener('click', async () => {
          const r = await window.mgw.petsClearSlot(editing, slot);
          if (!r.ok) { P.toast(r.message || '清除失败'); return; }
          P.toast('已清除，回落到默认形象');
          refresh();
        });
        row.appendChild(clr);
      }
      card.appendChild(row);
      grid.appendChild(card);
    }
    refs.slots.appendChild(grid);
  }

  /* ---------------- 新建 ---------------- */

  async function onUpload() {
    const r = await window.mgw.petsCreate();
    if (!r) return;                                       // 用户取消选图
    if (r.ok === false) { P.toast(r.message || '导入失败'); return; }
    editing = r.pet.id;
    await window.mgw.petsSelect({ type: 'image', ref: r.pet.id });
    await P.refreshSave();
    P.toast(r.warning || `已创建「${r.pet.name}」`);
    refresh();
  }

  window.MGW_TabPets = { render, onSave: () => refresh() };
})();
