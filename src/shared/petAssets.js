/**
 * 图片桌宠 · 纯逻辑层（UMD）
 * - 槽位表、居中裁方形、归一化参数、pet.json 校验、当前来源解析
 * - 不碰 DOM / fs / IPC：主进程与渲染层共用，node 直接自测（tools/pet-assets-selftest.js）
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./config.js'));
  } else {
    root.MGW_PetAssets = factory(root.MGW_CONFIG);
  }
})(typeof self !== 'undefined' ? self : this, function (CONFIG) {
  const SLOTS = CONFIG.petSlots.order;
  const DEFAULT_SLOT = 'default';
  const PET_ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
  const SLOT_FILE_RE = /^[a-z0-9][a-z0-9_-]*\.png$/i;

  /** 居中裁成方形：返回裁切矩形（源图已是方形时 size = 原边长、x=y=0） */
  function centerCropRect(w, h) {
    const size = Math.min(w, h);
    return { x: Math.floor((w - size) / 2), y: Math.floor((h - size) / 2), size };
  }

  /** 导入前的合法性检查（图片太小 / 读不出来） */
  function validateSource(w, h, opt) {
    const minSide = (opt && opt.minSide) || CONFIG.imagePet.minSide;
    if (!(w > 0) || !(h > 0)) return { ok: false, message: '图片读不出来（格式不支持？）' };
    if (Math.min(w, h) < minSide) return { ok: false, message: `图片太小了，至少 ${minSide}×${minSide}` };
    return { ok: true };
  }

  /**
   * 归一化计划：先居中裁方形，再限长边（只缩不放）
   * @returns {{crop:{x:number,y:number,size:number}, target:number, cropped:boolean, resized:boolean}}
   */
  function normalizePlan(w, h, opt) {
    const maxSide = (opt && opt.maxSide) || CONFIG.imagePet.maxSide;
    const crop = centerCropRect(w, h);
    const target = Math.min(crop.size, maxSide);
    return { crop, target, cropped: crop.size !== w || crop.size !== h, resized: target !== crop.size };
  }

  /** 槽位 → 实际文件名（未上传的状态回落默认图；连默认图都没有则 null） */
  function resolveSlot(slots, slot) {
    const s = slots || {};
    return s[slot] || s[DEFAULT_SLOT] || null;
  }

  /** 存档 → 当前桌宠来源（兼容旧档 currentCat；永远返回可用值） */
  function resolveSource(save) {
    const pet = save && save.currentPet;
    if (pet && typeof pet === 'object' && (pet.type === 'builtin' || pet.type === 'image') &&
        typeof pet.ref === 'string' && pet.ref) {
      return { type: pet.type, ref: pet.ref };
    }
    return { type: 'builtin', ref: (save && save.currentCat) || 'orange' };
  }

  /** 校验宠物 id（IPC 入参，防 '../' 之类路径穿越） */
  function isValidPetId(id) {
    return typeof id === 'string' && PET_ID_RE.test(id);
  }

  function isValidSlot(slot) {
    return SLOTS.indexOf(slot) >= 0;
  }

  /** 名字清洗：压缩空白、去首尾、截到 24 字；空则回落 fallback（读档与重命名共用） */
  function cleanName(raw, fallback) {
    const s = String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim().slice(0, 24);
    return s || fallback || '';
  }

  /** pet.json 校验 + 规范化：坏档返回 null（上层当「宠物不存在」处理） */
  function parsePetJson(raw, fallbackId) {
    if (!raw || typeof raw !== 'object') return null;
    const id = typeof raw.id === 'string' && raw.id ? raw.id : fallbackId;
    if (!id) return null;
    const inSlots = (raw.slots && typeof raw.slots === 'object') ? raw.slots : {};
    const slots = {};
    for (const k of SLOTS) {
      const v = inSlots[k];
      if (typeof v === 'string' && SLOT_FILE_RE.test(v)) slots[k] = v;
    }
    if (!slots[DEFAULT_SLOT]) return null;   // 默认形象是必传项
    return { id, name: cleanName(raw.name, id), createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : '', slots };
  }

  /** 新建宠物 id：时间戳 + 随机尾（目录名安全；rand 可注入，便于自测） */
  function newPetId(nowMs, rand) {
    const t = Math.floor(nowMs == null ? Date.now() : nowMs).toString(36);
    const r = Math.floor((rand == null ? Math.random() : rand) * 46656).toString(36).padStart(3, '0');
    return 'p-' + t + '-' + r;
  }

  /** 槽位文件名：固定「槽位名.png」，替换即覆盖，永不起冲突 */
  function slotFileName(slot) {
    return slot + '.png';
  }

  return {
    SLOTS, DEFAULT_SLOT,
    centerCropRect, validateSource, normalizePlan,
    resolveSlot, resolveSource, parsePetJson, cleanName,
    isValidPetId, isValidSlot, newPetId, slotFileName,
  };
});
