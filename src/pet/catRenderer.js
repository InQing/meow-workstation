/**
 * 猫咪渲染器：加载 assets/cats/*.json → 播放动画帧 → 整数倍缩放 Canvas 绘制
 * 每帧是完整网格（需求 2.2 schema），palette 里字符→颜色，'.' 为透明
 * 尺寸：由 config.petMetrics(scale) 给出（scale = 每格像素），窗口/画布/绘制原点三者一致
 */
(function () {
  const CONFIG = window.MGW_CONFIG;

  const DEF = CONFIG.petMetrics(CONFIG.petSize.defaultScale);

  const S = {
    canvas: null,
    ctx: null,
    dpr: 1,
    cat: null,
    animations: {},
    currentAnim: 'idle',
    frames: [],
    frameIdx: 0,
    elapsed: 0,
    lastTs: 0,
    playing: false,
    onEnd: null,          // 非循环动画播完回调
    scale: DEF.scale,
    offsetX: DEF.offsetX,
    offsetY: DEF.offsetY,
    vw: DEF.width,        // 画布 CSS 宽度（= 桌宠窗口宽度）
    vh: DEF.height,       // 画布 CSS 高度
    currentGrid: null,    // 当前帧（点击穿透检测用）
  };

  function fitCanvas(canvas, ctx) {
    const dpr = window.devicePixelRatio || 1;
    S.dpr = dpr;
    canvas.width = Math.round(S.vw * dpr);
    canvas.height = Math.round(S.vh * dpr);
    canvas.style.width = S.vw + 'px';
    canvas.style.height = S.vh + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
  }

  /** 按新的尺寸换算（config.petMetrics 的返回值）重排画布与绘制原点 */
  function resize(m) {
    S.scale = m.scale;
    S.offsetX = m.offsetX;
    S.offsetY = m.offsetY;
    S.vw = m.width;
    S.vh = m.height;
    if (!S.canvas) return api;
    fitCanvas(S.canvas, S.ctx);
    drawCurrent();
    return api;
  }

  function mount(canvas) {
    S.canvas = canvas;
    S.ctx = canvas.getContext('2d');
    fitCanvas(canvas, S.ctx);
    requestAnimationFrame(tick);
    return api;
  }

  /** 载入一只猫的素材数据 */
  function loadCat(catData) {
    S.cat = catData;
    S.animations = catData.animations || {};
    play('idle');
    return api;
  }

  /** 切换动画；loop 播完停在最后一帧并触发 onEnd */
  function play(name) {
    const anim = S.animations[name];
    if (!anim) {
      console.warn('[catRenderer] unknown animation:', name);
      return false;
    }
    S.currentAnim = name;
    S.frames = anim.frames;
    S.frameIdx = 0;
    S.elapsed = 0;
    S.playing = true;
    drawCurrent();
    return true;
  }

  /** 一次性播放（不循环），结束回落到 idle */
  function once(name, cb) {
    if (!play(name)) return;
    S.onEnd = cb || null;
  }

  function drawGrid(grid) {
    const ctx = S.ctx;
    const palette = S.cat.palette;
    ctx.clearRect(0, 0, S.vw, S.vh);
    if (!grid) return;
    for (let y = 0; y < grid.length; y++) {
      const row = grid[y];
      for (let x = 0; x < row.length; x++) {
        const color = palette[row[x]];
        if (!color) continue; // '.' 透明
        ctx.fillStyle = color;
        ctx.fillRect(S.offsetX + x * S.scale, S.offsetY + y * S.scale, S.scale, S.scale);
      }
    }
  }

  function drawCurrent() {
    const f = S.frames[S.frameIdx];
    S.currentGrid = f ? f.grid : null;
    drawGrid(S.currentGrid);
  }

  function tick(ts) {
    if (!S.lastTs) S.lastTs = ts;
    const dt = ts - S.lastTs;
    S.lastTs = ts;

    if (S.playing && S.frames.length) {
      const before = S.frameIdx;
      S.elapsed += dt;
      let f = S.frames[S.frameIdx];
      let guard = 0;
      while (S.elapsed >= f.ms && guard++ < 64) {
        S.elapsed -= f.ms;
        const anim = S.animations[S.currentAnim];
        if (S.frameIdx + 1 < S.frames.length) {
          S.frameIdx++;
        } else if (anim && anim.loop) {
          S.frameIdx = 0;
        } else {
          // 播完：停在最后一帧（下面的重绘条件会兜住这一次）
          S.playing = false;
          const cb = S.onEnd;
          S.onEnd = null;
          if (cb) cb(S.currentAnim);
          break;
        }
        f = S.frames[S.frameIdx];
      }
      // 只有帧真的换了才重绘。待机动画虽然循环，但一秒才换几帧，
      // 没必要 60fps 重画整块透明画布——拖动窗口时那是白给合成器添活。
      if (!S.playing || S.frameIdx !== before) drawCurrent();
    }
    requestAnimationFrame(tick);
  }

  /** 给定窗口内坐标，判断该像素是否有猫（阶段 7 点击穿透用） */
  function isOpaqueAt(x, y) {
    if (!S.currentGrid) return false;
    const gx = Math.floor((x - S.offsetX) / S.scale);
    const gy = Math.floor((y - S.offsetY) / S.scale);
    if (gx < 0 || gy < 0 || gy >= S.currentGrid.length) return false;
    const row = S.currentGrid[gy];
    if (gx >= row.length) return false;
    return row[gx] !== '.';
  }

  const api = {
    mount, loadCat, play, once, isOpaqueAt, drawGrid, resize,
    getState: () => ({
      anim: S.currentAnim,
      frame: S.frameIdx,
      frames: S.frames.length,
      playing: S.playing,
      catId: S.cat && S.cat.id,
      scale: S.scale,
      vw: S.vw,
      vh: S.vh,
    }),
    setOffset: (x, y) => { S.offsetX = x; S.offsetY = y; },
    get grid() { return S.currentGrid; },
  };

  window.CatRenderer = api;
})();
