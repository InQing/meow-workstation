/**
 * 图片桌宠渲染器：dataURL（主进程归一化过的 PNG）→ Canvas 铺满「24 格宠物显示盒」
 * 与 CatRenderer 同接口（mount / loadPet / play / once / resize / isOpaqueAt / stop），
 * pet.js 按 currentPet.type 分流，状态机无感知。
 * v1 静态：状态只决定画哪张图；动效扩展方向为图集（spritesheet），接口不变。
 */
(function () {
  const CONFIG = window.MGW_CONFIG;
  const A = window.MGW_PetAssets;
  const DEF = CONFIG.petMetrics(CONFIG.petSize.defaultScale);
  const ALPHA_RES = 96;   // 点击穿透 alpha 采样分辨率（P1 用）

  const S = {
    canvas: null,
    ctx: null,
    dpr: 1,
    pet: null,             // { id, name, slots: { slot: dataURL } }
    images: {},            // slot → Image（已解码）
    currentAnim: 'idle',
    timer: 0,
    onEnd: null,
    scale: DEF.scale,
    offsetX: DEF.offsetX,
    offsetY: DEF.offsetY,
    catW: DEF.catW,
    vw: DEF.width,
    vh: DEF.height,
    alphaCache: null,      // { slot, data } —— 当前状态的 alpha 采样
  };

  function fitCanvas() {
    if (!S.canvas) return;
    const dpr = window.devicePixelRatio || 1;
    S.dpr = dpr;
    S.canvas.width = Math.round(S.vw * dpr);
    S.canvas.height = Math.round(S.vh * dpr);
    S.canvas.style.width = S.vw + 'px';
    S.canvas.style.height = S.vh + 'px';
    S.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function loadImage(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  /** 该状态实际画哪张图：自己的槽位 → 默认形象 */
  function imageFor(name) {
    return S.images[name] || S.images[A.DEFAULT_SLOT] || null;
  }

  function drawCurrent() {
    const ctx = S.ctx;
    if (!ctx) return;
    ctx.clearRect(0, 0, S.vw, S.vh);
    const img = imageFor(S.currentAnim);
    if (!img) return;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, S.offsetX, S.offsetY, S.catW, S.catW);
  }

  /** 载入一只图片桌宠（dataURL 已在主进程归一化：方形 PNG） */
  async function loadPet(data) {
    S.pet = data || null;
    S.images = {};
    S.alphaCache = null;
    const slots = (data && data.slots) || {};
    for (const slot of Object.keys(slots)) {
      const img = await loadImage(slots[slot]);
      if (img) S.images[slot] = img;
    }
    play('idle');
    return api;
  }

  function play(name) {
    if (CONFIG.petSlots.order.indexOf(name) < 0) {
      console.warn('[imageRenderer] unknown animation:', name);
      return false;
    }
    S.currentAnim = name;
    drawCurrent();
    return true;
  }

  /** 单次态：图片没有帧，用 config 的时长兜结束回调（状态机靠它回持续态） */
  function once(name, cb) {
    if (!play(name)) return;
    if (S.timer) clearTimeout(S.timer);
    S.onEnd = cb || null;
    S.timer = setTimeout(() => {
      S.timer = 0;
      const fn = S.onEnd;
      S.onEnd = null;
      if (fn) fn(name);
    }, CONFIG.petStates.onceMs[name] || 1000);
  }

  function stop() {
    if (S.timer) { clearTimeout(S.timer); S.timer = 0; }
    S.onEnd = null;
  }

  function resize(m) {
    S.scale = m.scale;
    S.offsetX = m.offsetX;
    S.offsetY = m.offsetY;
    S.catW = m.catW;
    S.vw = m.width;
    S.vh = m.height;
    S.alphaCache = null;
    fitCanvas();
    drawCurrent();
    return api;
  }

  function mount(canvas) {
    S.canvas = canvas;
    S.ctx = canvas.getContext('2d');
    fitCanvas();
    drawCurrent();
    return api;
  }

  /** 点击穿透（P1）：把当前图采样成 ALPHA_RES 网格，按窗口坐标查 alpha */
  function isOpaqueAt(x, y) {
    const img = imageFor(S.currentAnim);
    if (!img) return false;
    if (!S.alphaCache || S.alphaCache.slot !== S.currentAnim) {
      const c = document.createElement('canvas');
      c.width = c.height = ALPHA_RES;
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0, ALPHA_RES, ALPHA_RES);
      S.alphaCache = { slot: S.currentAnim, data: g.getImageData(0, 0, ALPHA_RES, ALPHA_RES).data };
    }
    const u = (x - S.offsetX) / S.catW;
    const v = (y - S.offsetY) / S.catW;
    if (u < 0 || v < 0 || u >= 1 || v >= 1) return false;
    const px = Math.min(ALPHA_RES - 1, Math.floor(u * ALPHA_RES));
    const py = Math.min(ALPHA_RES - 1, Math.floor(v * ALPHA_RES));
    return S.alphaCache.data[(py * ALPHA_RES + px) * 4 + 3] > 8;
  }

  const api = {
    mount, loadPet, play, once, resize, isOpaqueAt, stop, drawCurrent,
    has: (slot) => !!S.images[slot],
    image: (slot) => S.images[slot] || null,
    getState: () => ({
      anim: S.currentAnim,
      petId: S.pet && S.pet.id,
      slots: Object.keys(S.images),
      scale: S.scale,
      vw: S.vw,
      vh: S.vh,
    }),
    setOffset: (x, y) => { S.offsetX = x; S.offsetY = y; },
  };

  window.ImageRenderer = api;
})();
