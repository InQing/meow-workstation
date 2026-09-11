/**
 * pet 窗总装：素材加载 → 渲染 → 状态机 → 交互 → 台词 → 尺寸
 * 阶段 2：动画/状态/台词/悬停按钮栏；阶段 3-4 接入番茄与好感；阶段 6 游戏联动；阶段 7 缩放
 */
(function () {
  const cfg = window.MGW_CONFIG;

  const canvas = document.getElementById('cat');
  const bubbleEl = document.getElementById('bubble');
  const actionsEl = document.getElementById('actions');
  const hgEl = document.getElementById('hourglass');
  const hgCanvas = document.getElementById('hourglass-canvas');
  const hgText = document.getElementById('hourglass-text');
  const gripEl = document.getElementById('grip');
  const sizeTipEl = document.getElementById('size-tip');

  let SAVE = null;
  let SPEECH = null;
  let PET = null;            // 当前桌宠来源 { type, ref }
  let R = null;              // 当前渲染器（CatRenderer | ImageRenderer）
  const catCache = {};

  let bubbleTimer = null;
  let lastInteraction = Date.now();
  let lastChatty = Date.now();
  // 番茄专注进行中（phase=work 且 running）：气泡一律不弹，专注结束后也不补弹
  let pomoWorking = false;
  // 在场状态（主进程 presence:state 广播）：away / sleeping 时同样静默，回来要打招呼
  let presence = 'active';

  /* ---------------- 台词 ---------------- */

  /** 立刻收起气泡（进入专注时用：正挂着的也不留） */
  function hideBubble() {
    if (bubbleTimer) { clearTimeout(bubbleTimer); bubbleTimer = null; }
    bubbleEl.classList.add('hidden');
  }

  /**
   * 显示气泡。专注进行中 / 人不在工位时静默（不弹、不排队）；
   * 「状态切换本身」的反馈（暂停/继续、番茄完成、回来打招呼）用 opts.force 放行
   */
  function sayText(text, ms = 2400, opts) {
    if ((pomoWorking || presence !== 'active') && !(opts && opts.force)) return;
    bubbleEl.textContent = text;
    bubbleEl.classList.remove('hidden');
    if (bubbleTimer) clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(() => bubbleEl.classList.add('hidden'), ms);
  }

  function say(key, ms = 2400, opts) {
    if (!SPEECH) return;
    const pool = Affection.poolFor(key, SPEECH);
    if (!pool.length) return;
    sayText(pool[Math.floor(Math.random() * pool.length)], ms, opts);
  }

  /* ---------------- 桌宠素材（内置猫 / 图片桌宠） ---------------- */

  /**
   * 加载当前桌宠：按来源分流渲染器（两者同接口），状态机 / 互动逻辑无感知
   * @param {{type:'builtin'|'image', ref:string}} [src] 缺省用存档
   */
  async function loadPet(src) {
    const source = src || window.MGW_PetAssets.resolveSource(SAVE);
    document.body.classList.toggle('image-pet', source.type === 'image');

    if (source.type === 'image') {
      const data = await window.mgw.petsGet(source.ref);
      if (!data) {                       // 图片宠物被删 / 文件损坏 → 回退内置橘猫
        sayText('这张图片找不到了，先变回橘猫', 2600);
        return loadPet({ type: 'builtin', ref: 'orange' });
      }
      CatRenderer.stop();
      ImageRenderer.mount(canvas);
      await ImageRenderer.loadPet(data);
      R = ImageRenderer;
    } else {
      const id = source.ref;
      if (!catCache[id]) catCache[id] = await window.mgw.readJson('assets/cats/' + id + '.json');
      if (!catCache[id]) return loadPet({ type: 'builtin', ref: 'orange' });
      ImageRenderer.stop();
      CatRenderer.mount(canvas);
      CatRenderer.loadCat(catCache[id]);
      R = CatRenderer;
    }

    PET = source;
    StateMachine.init(R);
    StateMachine.setBase('idle');
    applyScale(scale);                   // 新渲染器按当前尺寸重排画布
    window.mgw.setTrayIcon(await makeTrayIcon());
    // 重启保持当前桌宠；内置猫同步写旧字段 currentCat
    await applyPatch(Object.assign(
      { currentPet: source },
      source.type === 'builtin' ? { currentCat: source.ref } : {}
    ));
    return source;
  }

  /* ---------------- 尺寸：拖动右下角手柄缩放（settings.petScale 持久化） ---------------- */

  const rootEl = document.documentElement;
  let scale = cfg.petSize.defaultScale;
  let tipTimer = null;

  function tipScale(s) {
    sizeTipEl.textContent = `大小 ${s}`;
    sizeTipEl.classList.remove('hidden');
    if (tipTimer) clearTimeout(tipTimer);
    tipTimer = setTimeout(() => sizeTipEl.classList.add('hidden'), 1000);
  }

  /**
   * 应用尺寸：--s（CSS 全部按它算）+ 画布重排 + 主进程窗口跟随
   * @param {number} next 每格像素
   * @param {object} [opts] { persist:boolean 落盘, tip:boolean 显示数值 }
   */
  function applyScale(next, opts) {
    const o = opts || {};
    const m = cfg.petMetrics(next);
    scale = m.scale;
    rootEl.style.setProperty('--s', m.scale + 'px');
    rootEl.style.setProperty('--padl', m.padL + 'px');   // 气泡 / 按钮栏的居中基准（猫的中线）
    rootEl.style.setProperty('--padr', m.padR + 'px');
    if (R) R.resize(m);
    HG.size = m.hourglass;   // 沙漏跟着缩放重排画布
    fitHourglass();
    if (window.mgw.resizePet) window.mgw.resizePet(m.width, m.height);
    if (o.tip) tipScale(m.scale);
    if (o.persist) applyPatch({ settings: { petScale: m.scale } });
    return m;
  }

  function bindGrip() {
    let active = false, changed = false, startS = scale, startX = 0, startY = 0;

    function onMove(e) {
      if (!active) return;
      const delta = ((e.screenX - startX) + (e.screenY - startY)) / 2;
      const next = Math.round(startS + delta / 9);   // 约拖 9px 变一格
      if (next !== scale) { changed = true; applyScale(next, { tip: true }); }
    }

    function stop() {
      if (!active) return;
      active = false;
      document.body.classList.remove('resizing');
      if (changed) applyScale(scale, { persist: true, tip: true });
    }

    gripEl.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      active = true;
      changed = false;
      startS = scale;
      startX = e.screenX;
      startY = e.screenY;
      document.body.classList.add('resizing');
      // 拖出窗口也能继续收到事件；合成事件没有 pointerId 时忽略
      try { gripEl.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
    });
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
  }

  /* ---------------- 托盘图标（程序化生成，跟随当前猫配色） ---------------- */

  async function makeTrayIcon() {
    // 图片桌宠：直接用默认形象缩一张（走 canvas，不依赖像素网格）
    if (PET && PET.type === 'image' && ImageRenderer.has(window.MGW_PetAssets.DEFAULT_SLOT)) {
      const side = cfg.imagePet.traySide;
      const c = document.createElement('canvas');
      c.width = c.height = side;
      const g = c.getContext('2d');
      g.imageSmoothingEnabled = true;
      g.drawImage(ImageRenderer.image(window.MGW_PetAssets.DEFAULT_SLOT), 0, 0, side, side);
      return c.toDataURL('image/png');
    }
    // 内置像素猫：程序化画 16×16（原逻辑）
    const c = document.createElement('canvas');
    c.width = c.height = 16;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    const pal = PET && catCache[PET.ref] ? catCache[PET.ref].palette : null;
    g.fillStyle = '#3a2a1e';
    g.fillRect(3, 2, 2, 2);
    g.fillRect(11, 2, 2, 2);
    g.fillStyle = (pal && pal.F) || '#f5a340';
    g.fillRect(2, 4, 12, 9);
    g.fillStyle = '#3a2a1e';
    g.fillRect(2, 4, 12, 1);
    g.fillRect(2, 12, 12, 1);
    g.fillRect(1, 5, 1, 7);
    g.fillRect(14, 5, 1, 7);
    g.fillStyle = (pal && pal.E) || '#2b8a3e';
    g.fillRect(5, 7, 2, 2);
    g.fillRect(9, 7, 2, 2);
    return c.toDataURL('image/png');
  }

  /* ---------------- 交互 ---------------- */

  function touch() {
    lastInteraction = Date.now();
    if (StateMachine.current === 'sleep') {
      StateMachine.setBase('idle');
      // force：刚被点醒说明人就在跟前，不该被「在场状态还没刷新到 active」拦掉这句
      say('idle', 1600, { force: true });
    }
  }

  function reportLevelUp(r) {
    if (r.unlocked && r.unlocked.length) {
      sayText(r.unlocked.map((u) => `Lv${u.lv} 解锁：${u.label}`).join('　'), 4200);
      const keys = r.unlocked.map((u) => u.key);
      if (keys.includes('stretch')) setTimeout(() => StateMachine.once('stretch'), 2300);
      if (keys.includes('belly')) setTimeout(() => StateMachine.playFor('belly', 4000), 2300);
    } else {
      sayText(`好感度 Lv${r.level}`, 2600);
    }
  }

  /* ---------------- 专注中的主动互动：先劝、再不理 ---------------- */

  // 同一个番茄内累计的主动互动次数（摸头 / 喂食）；由 onPomoState 在换番茄时清零
  // flagged：是否已把「摸鱼超限」告诉主进程（结算打折用，只发一次）
  const focusPoke = { count: 0, flagged: false };

  /** 互动计数清零（进入新的工作阶段 / 离开工作阶段时调用） */
  function focusPokeReset() {
    focusPoke.count = 0;
    focusPoke.flagged = false;
  }

  /**
   * 专注中被打扰（摸头 / 喂食）：不给任何收益，只弹一句「劝专注」；
   * 超过 nagLimit 次 → 每次都是「……」+ 嫌弃 + 扣好感，并让主进程把本番茄结算打折
   * @returns {{ok:boolean, reason:'nag'|'distracted', count:number}}
   */
  function focusInteract() {
    const ic = cfg.pomodoro.interact;
    focusPoke.count++;

    if (focusPoke.count > ic.nagLimit) {
      StateMachine.once('annoyed');
      sayText('……', 2600, { force: true });
      Affection.addAffection(-ic.penaltyAffection);
      if (!focusPoke.flagged) {          // 标记只发一次；主进程按布尔处理
        focusPoke.flagged = true;
        if (window.mgw.pomodoroDistracted) window.mgw.pomodoroDistracted();
      }
      return { ok: false, reason: 'distracted', count: focusPoke.count };
    }
    say('focusNag', 2600, { force: true });
    return { ok: true, reason: 'nag', count: focusPoke.count };
  }

  function onTap() {
    touch();
    // 专注中：摸鱼不给收益，只劝你专心（顺带计数，见 focusInteract）
    if (pomoWorking) return focusInteract();
    const r = Affection.pet();
    if (r.ok) {
      StateMachine.once('happy');
      say('pet');
      if (r.leveledUp) reportLevelUp(r);
    } else if (r.reason === 'cooldown') {
      StateMachine.once('happy');   // 冷却中：反应照给，好感不给
      say('pet');
    } else if (r.reason === 'spam') {
      StateMachine.once('annoyed');
      say('annoyed', 3200);
    } else {
      StateMachine.once('annoyed');
      sayText('……（假装没看见）', 2200);
    }
    return r;
  }

  function doFeed() {
    // 专注中：猫不吃（不扣金币也不加好感），走同一条劝专注路径
    if (pomoWorking) return focusInteract();
    const r = Affection.feed();
    if (r.ok) {
      StateMachine.once('eat');
      say('feed');
      if (r.leveledUp) reportLevelUp(r);
    } else {
      sayText(`金币不够啦（要 ${cfg.feeding.costCoins}）`, 2400);
    }
    return r;
  }

  /* ---------------- 待机行为：久了打盹 / 偶尔冒话 ---------------- */

  function startIdleWatch() {
    setInterval(() => {
      const idleMs = Date.now() - lastInteraction;
      if (StateMachine.base === 'idle' && idleMs > 20000 && StateMachine.current !== 'sleep') {
        StateMachine.setBase('sleep');
        return;
      }
      if (Date.now() - lastChatty > 45000) {   // 低频闲聊
        lastChatty = Date.now();
        say(StateMachine.base === 'sleep' ? 'sleep' : 'idle', 2600);
        return;
      }
      // 解锁的新动作：偶尔自己玩一下
      const acts = Affection.idleActions();
      if (acts.length && StateMachine.base === 'idle' &&
          StateMachine.current === 'idle' && Math.random() < 0.25) {
        const a = acts[Math.floor(Math.random() * acts.length)];
        if (a === 'belly') StateMachine.playFor('belly', 3600);
        else StateMachine.once(a);
      }
    }, 3000);
  }

  /* ---------------- 番茄钟 UI ---------------- */

  function mmss(sec) {
    const m = Math.floor(sec / 60);
    const s = Math.max(0, sec % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  /* ---------------- 番茄沙漏（站在猫的左侧留白里） ----------------
   * 沙漏的隐喻：上半的沙 = 剩余时间，漏完即到点。
   * 用 canvas 而不是 CSS 拼三角 —— 透明窗口上「不加 transform / transition / 动画」
   * 是硬规矩，canvas 只改像素内容、不会新建合成层，零风险。
   * 暂停：沙子静止 + 整体退色（比"凭空消失"更能说明是暂停，而不是这局结束了）。
   */

  const HG_SAND = { work: '#f2994a', break: '#4a90d9' };
  const HG_DIM = '#b9ada1';      // 暂停：沙子退色
  // 轮廓画两遍：先铺一层米白粗线当衬底，再用深棕细线压中线。
  // 单色线在透明窗口上必糊 —— 深色主题吃掉深棕（老大在 VSCode dark 下只看得见橙沙），
  // 浅色壁纸吃掉米白；两色叠着画才能「深色背景看见白边、浅色背景看见棕线」。
  const HG_INK = '#3a2a1e';                        // 主线：浅色背景靠它
  const HG_HALO = 'rgba(255, 252, 245, 0.92)';     // 衬底：深色主题/壁纸靠它
  const HG_DIM_INK = '#9c9187';                    // 暂停：主线退色
  const HG_DIM_HALO = 'rgba(240, 234, 225, 0.72)'; // 暂停：衬底也压暗

  const HG = {
    p: 1,                        // 剩余比例 0~1
    phase: 'work',
    running: false,
    size: cfg.petMetrics(cfg.petSize.defaultScale).hourglass,
    ctx: null,
    timer: 0,
  };

  function fitHourglass() {
    const dpr = window.devicePixelRatio || 1;
    const w = HG.size.w;
    const h = HG.size.h;
    hgCanvas.width = Math.round(w * dpr);
    hgCanvas.height = Math.round(h * dpr);
    hgCanvas.style.width = w + 'px';
    hgCanvas.style.height = h + 'px';
    HG.ctx = hgCanvas.getContext('2d');
    HG.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawHourglass();
  }

  function drawHourglass() {
    const ctx = HG.ctx;
    if (!ctx) return;
    const W = HG.size.w;
    const H = HG.size.h;
    ctx.clearRect(0, 0, W, H);

    const cx = W / 2;
    const top = H * 0.03;
    const bot = H * 0.97;
    const waist = H / 2;
    const half = W * 0.42;
    const lw = Math.max(1, W * 0.06);
    const upper = waist - top;
    const lower = bot - waist;
    const sand = HG.running ? (HG_SAND[HG.phase] || HG_SAND.work) : HG_DIM;
    const ink = HG.running ? HG_INK : HG_DIM_INK;
    const halo = HG.running ? HG_HALO : HG_DIM_HALO;

    /** 上下两个尖端相对的三角（外框路径，画两遍用） */
    const traceGlass = () => {
      ctx.beginPath();
      ctx.moveTo(cx - half, top);
      ctx.lineTo(cx + half, top);
      ctx.lineTo(cx, waist);
      ctx.closePath();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx - half, bot);
      ctx.lineTo(cx + half, bot);
      ctx.lineTo(cx, waist);
      ctx.closePath();
      ctx.stroke();
    };

    // ① 轮廓衬底（米白粗线）打在最底层：随后被沙盖住内侧，只在外侧留一圈亮边。
    //    没有它，深色主题 / 深色壁纸下整个沙漏只剩橙色沙（老大在 VSCode dark 下看到的就是这样）。
    //    ⚠️ 必须画在沙「之前」，否则粗线会啃掉沙的轮廓（实测 p=50% 时下仓少了两成像素）。
    ctx.lineJoin = 'round';
    const haloPad = Math.max(1.6, W * 0.08);
    ctx.lineWidth = lw + haloPad * 2;
    ctx.strokeStyle = halo;
    traceGlass();

    // ② 上半：剩余。沙量 ∝ 高度²（三角形面积），所以按 sqrt 映射 —— 漏沙节奏才对
    if (HG.p > 0.002) {
      const hh = upper * Math.sqrt(HG.p);
      const hw = half * (hh / upper);
      ctx.fillStyle = sand;
      ctx.beginPath();
      ctx.moveTo(cx - hw, waist - hh);
      ctx.lineTo(cx + hw, waist - hh);
      ctx.lineTo(cx, waist);
      ctx.closePath();
      ctx.fill();
    }

    // ③ 下半：已落。沙面水平地往上堆，堆高 d 由「面积 = q × 满仓面积」反解：
    //   下仓是上尖下宽的倒三角，距底 d 处半宽 = half*(1 - d/lower)；
    //   沙堆是底半宽 half、顶半宽 hwTop 的梯形，面积 = (half + hwTop) * d。
    //   代入 hwTop = half*(1 - d/lower)，面积 = half*lower*(2u - u²)（u = d/lower），
    //   令它 = q*half*lower → u² - 2u + q = 0 → u = 1 - sqrt(1-q)。
    //   ⚠️ 旧版写成 d = lower*sqrt(q)：q=10% 时会画成 53% 满，看着「下面涨得比上面漏得快」。
    const q = 1 - HG.p;
    if (q > 0.002) {
      const d = lower * (1 - Math.sqrt(Math.max(0, 1 - q)));
      const hwTop = half * (1 - d / lower);
      ctx.fillStyle = sand;
      ctx.beginPath();
      ctx.moveTo(cx - half, bot);
      ctx.lineTo(cx + half, bot);
      ctx.lineTo(cx + hwTop, bot - d);
      ctx.lineTo(cx - hwTop, bot - d);
      ctx.closePath();
      ctx.fill();
    }

    // ④ 沙流：只有真的在漏的时候才画（相位抖动 ≈ 一粒粒往下落）
    if (HG.running && HG.p > 0.002 && HG.p < 0.999) {
      const t = (Date.now() % 500) / 500;
      ctx.strokeStyle = sand;
      ctx.lineWidth = Math.max(1, lw * 0.7);
      ctx.beginPath();
      ctx.moveTo(cx, waist + 0.5);
      ctx.lineTo(cx, waist + 3 + t * lower * 0.16);
      ctx.stroke();
    }

    // ⑤ 轮廓主线（深棕细线）压在沙上：浅色壁纸靠它认出轮廓
    ctx.lineWidth = lw;
    ctx.strokeStyle = ink;
    traceGlass();
  }

  /** 播放中每 120ms 重画一次（沙子在漏）；暂停 / 隐藏时一次都不画 */
  function startHourglassLoop() {
    if (HG.timer) return;
    HG.timer = setInterval(() => {
      if (HG.running && !hgEl.classList.contains('hidden')) drawHourglass();
    }, 120);
  }

  /** 只有「专注 / 休息」才显示沙漏；暂停保留但静止退色，结束（idle）才收起 */
  function updateHourglass(p) {
    if (!p || p.phase === 'idle') {
      hgEl.classList.add('hidden');
      HG.running = false;
      return;
    }
    const progress = p.progress != null ? p.progress
      : (p.duration ? (1 - p.remaining / p.duration) : 0);
    HG.p = Math.max(0, Math.min(1, 1 - progress));   // 上半的沙 = 剩余
    HG.phase = p.phase;
    HG.running = !!p.running;
    hgEl.dataset.phase = p.phase;
    hgEl.dataset.paused = p.running ? '0' : '1';
    hgText.textContent = p.running ? mmss(p.remaining) : '暂停';
    hgEl.classList.remove('hidden');
    drawHourglass();
  }

  let prevPomo = null;

  function onPomoState(p) {
    updateHourglass(p);

    // 专注进行中：气泡静默。标志先更新，下面的暂停反馈（此刻 running=false）才不会被误拦
    const working = p.phase === 'work' && p.running;
    const wasWorking = pomoWorking;
    pomoWorking = working;

    // 专注期互动计数：只在进入新番茄 / 离开工作阶段时清零
    // （暂停→继续算同一个番茄，不清 —— 否则一暂停就能重置计数）
    if (p.phase !== 'work' || !prevPomo || prevPomo.phase !== 'work') focusPokeReset();

    // 暂停 / 继续时给一句反馈，避免"进度条突然没了"造成的困惑
    const paused = p.phase !== 'idle' && !p.running;
    let resumedNow = false;
    if (prevPomo) {
      const wasPaused = prevPomo.phase !== 'idle' && !prevPomo.running;
      if (paused && !wasPaused) sayText('⏸ 番茄已暂停', 2000);
      else if (!paused && p.running && wasPaused) {
        sayText('▶ 继续专注', 1600, { force: true });   // 专注刚恢复，放行这一句
        resumedNow = true;
      }
    }
    prevPomo = { phase: p.phase, running: p.running };

    // 刚进入专注：把还挂着的气泡立刻收掉（「继续专注」这句除外，它刚弹出来）
    if (working && !wasWorking && !resumedNow) hideBubble();

    // 状态机：专注中趴窝陪工，休息/结束回待机（人不在工位就直接睡）
    if (p.phase === 'work' && p.running) {
      if (StateMachine.base !== 'work') StateMachine.setBase('work');
    } else if (p.phase !== 'work' && StateMachine.base === 'work') {
      StateMachine.setBase(presence === 'sleeping' ? 'sleep' : 'idle');
    }
  }

  /** 主动拉一次番茄状态：广播万一没到达（窗口刚起、消息丢失）也能自愈 */
  async function syncPomodoro() {
    if (!window.mgw.pomodoroGet) return;
    try {
      const p = await window.mgw.pomodoroGet();
      if (p) onPomoState(p);
    } catch (e) { /* 主进程没响应就等下一次广播 */ }
  }

  /* ---------------- 在场状态（系统空闲联动）：离开安静 / 打盹，回来打招呼 ---------------- */

  /**
   * 主进程按系统空闲时间判定 active / away / sleeping，只在变化时广播。
   * - 人不在：气泡静默（sayText 已拦）；长时间离开让猫也去睡（专注中保持 work 不动）
   * - 回来：先从打盹里醒来、伸个懒腰，再按离开时长挑招呼台词；专注中换「继续工作」（force 放行）
   */
  function onPresenceState(ev) {
    if (!ev || !ev.state) return;
    presence = ev.state;

    if (presence === 'away') return;
    if (presence === 'sleeping') {
      if (!pomoWorking) StateMachine.setBase('sleep');
      return;
    }

    // 回到 active：只有真的「离开过」才迎接（兜底拉取 / 启动对齐不带 prev，不打招呼）
    if (!ev.prev || ev.prev === 'active') return;
    const awayMs = ev.awayMs || 0;
    if (awayMs < cfg.presence.awaySec * 1000) return;   // 离开太短（如锁屏秒回）不打扰

    lastInteraction = Date.now();   // 人回来了，别让 20 秒闲置逻辑立刻又把猫哄睡
    if (StateMachine.base === 'sleep') StateMachine.setBase('idle');   // 先从打盹里醒来
    StateMachine.once('stretch');                                       // 再伸个懒腰
    if (pomoWorking) {
      say('backWork', 3200, { force: true });
      return;
    }
    say(awayMs >= cfg.presence.sleepSec * 1000 ? 'backLong' : 'backSoon', 3200, { force: true });
  }

  /** 主动拉一次在场状态：窗口刚起 / 回焦时兜底（广播丢失也能对齐） */
  async function syncPresence() {
    if (!window.mgw.presenceGet) return;
    try {
      const p = await window.mgw.presenceGet();
      if (p) onPresenceState(p);
    } catch (e) { /* 主进程没响应就等下一次广播 */ }
  }

  function bindPresence() {
    window.mgw.onPresenceState(onPresenceState);
    window.addEventListener('focus', syncPresence);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) syncPresence();
    });
  }

  function bindPomodoro() {
    window.mgw.onPomodoroState(onPomoState);

    window.mgw.onPomodoroDone((d) => {
      if (d.phase === 'work') {
        StateMachine.once('happy');
        const r = d.reward || {};
        // 摸鱼超限的番茄：文案挑明打折（不提好感，也不提券）
        const line = d.distracted
          ? `🍅 番茄完成……摸鱼太多，奖励打折 +${r.coins}金币`
          : `🍅 番茄完成 +${r.coins}金币 +${r.tickets}券`;
        // 主进程「先发 pomodoro:done 再切休息」，此刻标志还是专注中 → 结算必须放行
        sayText(line, 3600, { force: true });
      } else if (d.phase === 'break') {
        say('idle', 3000);
      }
    });

    // 窗口重新获得焦点时对齐一次（防止长时间后台后状态不同步）
    window.addEventListener('focus', syncPomodoro);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) syncPomodoro();
    });
  }

  /** 深合并（用于本地乐观更新） */
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

  /**
   * 写档：先本地合并（避免连续调用读到旧值互相覆盖），
   * 再用主进程返回的权威快照兜底
   */
  async function applyPatch(patch) {
    mergeDeep(SAVE, patch);
    SAVE = await window.mgw.patchSave(patch);
    return SAVE;
  }

  function bindSettings() {
    // 面板改设置后立刻生效（置顶由主进程处理；音效已全局关闭，不再有音量）
    window.mgw.onSettingsChanged((st) => {
      if (!st) return;
      if (SAVE && SAVE.settings) mergeDeep(SAVE.settings, st);
    });
  }

  /** 游戏 tab 的桌宠演出：结算按得分夸夸 / 吐槽，点到炸弹炸毛
      台词池按 msg.game 分——鱼干突袭说鱼，反应力测试说手速 */
  const REACT_POOL = { best: 'gameBest', praise: 'gamePraise', ok: 'gameOk', roast: 'gameRoast' };
  const REACT_POOL_REFLEX = { best: 'reflexBest', praise: 'reflexPraise', ok: 'reflexOk', roast: 'reflexRoast' };

  function bindGameReact() {
    window.mgw.onPetReact((msg) => {
      const obj = msg && typeof msg === 'object' ? msg : null;
      const kind = obj ? obj.kind : msg;

      if (kind === 'shock') {
        StateMachine.once('shock');
        sayText('喵啊！那是炸弹！', 2200);
        return;
      }
      if (kind === 'happy') {           // 兼容旧事件
        StateMachine.once('happy');
        say('happy', 2600);
        return;
      }
      const table = obj && obj.game === 'reflex' ? REACT_POOL_REFLEX : REACT_POOL;
      const pool = table[kind];
      if (!pool) return;
      StateMachine.once(kind === 'roast' ? 'annoyed' : 'happy');
      say(pool, 3200);
    });
  }

  function bindActions() {
    actionsEl.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      touch();
      switch (btn.dataset.act) {
        case 'feed':
          doFeed();
          break;
        case 'panel':
          window.mgw.openPanel('collection');
          break;
        case 'pomodoro':
          window.mgw.pomodoroStart();   // 开始 / 暂停（主进程按当前状态切换）
          break;
      }
    });
  }

  /* ---------------- 启动 ---------------- */

  async function boot() {
    SAVE = await window.mgw.loadSave();
    SPEECH = await window.mgw.readJson('assets/speech.json');   // ⚠️ 必须 await：invoke 返回 Promise

    Affection.init({
      getSave: () => SAVE,
      applyPatch,
    });
    // 尺寸先摆好（--s / 窗口），loadPet 挂载渲染器后会按同一套 metrics 重排画布
    applyScale((SAVE.settings && SAVE.settings.petScale) || cfg.petSize.defaultScale);
    await loadPet(window.MGW_PetAssets.resolveSource(SAVE));

    window.MGW_Drag.attach(canvas, { onTap });
    canvas.addEventListener('mousemove', touch);
    bindActions();
    bindGrip();
    bindPomodoro();
    bindPresence();
    bindSettings();
    bindGameReact();
    // 面板切换 / 删除 / 换槽位图 → 主进程广播，桌宠即时换形象
    window.mgw.onPetChanged((src) => { loadPet(src).catch((e) => console.error('[pet] loadPet failed:', e)); });
    startHourglassLoop();

    canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      window.mgw.showPetMenu();
    });

    startIdleWatch();
    await syncPomodoro();   // 先对齐番茄状态：专注中重启（崩溃重载）也不该冒打招呼气泡
    await syncPresence();   // 再对齐在场状态：人不在工位时，开场白也要静默
    say('idle', 3000);

    // 托盘「调试」菜单调用
    window.MGW_DEBUG = {
      setCat: (id) => loadPet({ type: 'builtin', ref: id }),
      setPet: (type, ref) => loadPet({ type, ref }),
      reloadPet: () => loadPet(PET),
      setState: (st) => StateMachine.set(st),
      playFor: (st, ms) => StateMachine.playFor(st, ms),
      setScale: (s) => applyScale(s, { persist: true, tip: true }),
      say,
      tapResult: () => onTap(),
      feedResult: () => doFeed(),
      addAff: (n) => Affection.addAffection(n),
      setAffection: async (n) => applyPatch({ affection: n }),
      resetProgress: async () => applyPatch({ affection: 0, unlocks: [] }),
      get save() { return SAVE; },
      get level() { return Affection.level(); },
      get info() {
        const st = R ? R.getState() : {};
        return { pet: PET, anim: st.anim, level: Affection.level(), scale };
      },
    };
    console.log('[pet] started, pet:', JSON.stringify(PET), 'scale:', scale);
  }

  boot().catch((err) => console.error('[pet] boot failed:', err));
})();
