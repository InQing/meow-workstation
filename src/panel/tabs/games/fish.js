/**
 * 面板 · 游戏中心 → 鱼干突袭（阶段 6）
 *
 * 规则（2026-09-10 定稿，同日复查调整）：
 *   20 秒一局；随机位置冒头：鱼干 +8（70%）/ 金鱼 +20（15%）/ 炸弹 -12（15%）
 *   存留时长：鱼干 1.5s / 金鱼 0.8s / 炸弹 2s；出怪 240~400ms（密集，提神）
 *   连续命中累加 combo，每 5 连 +0.25 倍（上限 ×2，只加成正向得分）
 *   点到炸弹：combo 清零 + 桌宠炸毛
 *   结算：金币 = floor(得分 × 0.10)；按得分分档由猫猫夸夸 / 吐槽；记录最高分
 *
 * 全部数值与判定走 src/shared/game.js（已自测），这里只做计时、定位与渲染。
 * 音效：无（摸鱼场景，老大要求去音效）。
 */
(function () {
  const P = window.MGW_Panel;
  const G = window.MGW_Game;

  const cfg = () => P.CONFIG.game;
  const ICON = { fish: '🐟', gold: '🐠', bomb: '💣' };
  /* 结算评价台词（分档 key 与 shared/game.js 的 reactFor 一致） */
  const PET_LINE = {
    start: '上吧，鱼干归你',
    shock: '喵啊！炸弹别碰！',
    over: '这局完了，还来？',
    best: '新纪录！本喵服了',
    praise: '喵！手速可以啊～',
    ok: '还行，中规中矩',
    roast: '就这？鱼干都替你着急',
  };

  const refs = {};
  let rootEl = null;
  let running = false;
  let state = null;
  let endAt = 0;
  let rafId = 0;
  let spawnTimer = 0;
  let endTimer = 0;      // rAF 被节流（窗口失焦/被遮挡）时的结算兜底
  let petLineTimer = 0;
  const alive = new Set();   // { el, type, timer }

  /* ---------------- 渲染 ---------------- */

  function render(root) {
    stopGame();          // 重进 tab 一律重置本局
    rootEl = root;
    root.innerHTML = '';
    const c = cfg();

    const head = P.el('div', 'sec-head');
    head.appendChild(P.el('h2', 'sec-title', '鱼干突袭'));
    head.appendChild(P.el('div', 'dim',
      `${c.durationSec} 秒限时 · 鱼干 +${c.targets.fish.score} / 金鱼 +${c.targets.gold.score} / 炸弹 ${c.targets.bomb.score}` +
      ` · 金币 = 得分 × ${c.coinsPerScore}`));
    root.appendChild(head);

    const wrap = P.el('div', 'game-wrap');

    /* HUD */
    const hud = P.el('div', 'game-hud');
    const timeBox = P.el('div', 'g-time');
    timeBox.appendChild(P.el('span', 'g-label', '剩余'));
    refs.timeText = P.el('b', 'g-time-num', c.durationSec.toFixed(1));
    timeBox.appendChild(refs.timeText);
    hud.appendChild(timeBox);

    const scoreBox = P.el('div', 'g-score');
    scoreBox.appendChild(P.el('span', 'g-label', '得分'));
    refs.scoreNum = P.el('b', 'g-score-num', '0');
    scoreBox.appendChild(refs.scoreNum);
    hud.appendChild(scoreBox);

    refs.comboPill = P.el('div', 'combo-pill', '连击 0');
    hud.appendChild(refs.comboPill);

    const best = (P.save && P.save.stats && P.save.stats.bestGameScore) || 0;
    refs.bestText = P.el('div', 'g-best dim', `最高分 ${best}`);
    hud.appendChild(refs.bestText);
    wrap.appendChild(hud);

    /* 时间条 */
    const bar = P.el('div', 'g-timebar');
    refs.timeFill = P.el('i');
    refs.timeFill.style.width = '100%';
    bar.appendChild(refs.timeFill);
    wrap.appendChild(bar);

    /* 场地 */
    const arena = P.el('div', 'arena');
    refs.arena = arena;
    refs.targets = P.el('div', 'g-targets');
    arena.appendChild(refs.targets);
    arena.appendChild(buildWatcher());

    refs.cover = P.el('div', 'g-cover');
    arena.appendChild(refs.cover);
    wrap.appendChild(arena);

    root.appendChild(wrap);

    // 重进一律回到「开始」页：切走时本局已被 onHide 中止（不结算不刷分），
    // 再钉着上一局的结算卡会让人以为「卡在结算页出不来」（老大报过）。
    paintIntro();
  }

  /** 角落围观的桌宠位（图案留空：emoji 占位，等素材接入后换 canvas） */
  function buildWatcher() {
    const box = P.el('div', 'pet-watch');
    refs.petWatch = box;      // 出怪要避让它（见 safeSpot）
    refs.petFace = P.el('div', 'pet-face', '🐱');
    box.appendChild(refs.petFace);
    refs.petLine = P.el('div', 'pet-say', PET_LINE.over);
    box.appendChild(refs.petLine);
    return box;
  }

  function paintIntro() {
    refs.cover.innerHTML = '';
    const card = P.el('div', 'g-card');
    card.appendChild(P.el('div', 'g-card-title', '🐟 鱼干突袭'));
    const ul = P.el('ul', 'g-rules');
    const c = cfg();
    const avgMs = (c.spawn.minMs + c.spawn.maxMs) / 2;
    ul.appendChild(P.el('li', null, `限时 ${c.durationSec} 秒，点掉冒头的鱼干（约每 ${(avgMs / 1000).toFixed(1)} 秒冒一个，别眨眼）`));
    ul.appendChild(P.el('li', null, `🐟 鱼干 +${c.targets.fish.score}（停留 ${c.targets.fish.aliveMs / 1000}s）`));
    ul.appendChild(P.el('li', null, `🐠 金鱼 +${c.targets.gold.score}（只停 ${c.targets.gold.aliveMs / 1000}s，手要快）`));
    ul.appendChild(P.el('li', null, `💣 炸弹 ${c.targets.bomb.score}（别点，最多连击清零）`));
    ul.appendChild(P.el('li', null, '连击每 5 次 +0.25 倍得分，最高 ×2'));
    ul.appendChild(P.el('li', null, `结算金币 = 得分 × ${c.coinsPerScore}，打崩了不倒扣`));
    card.appendChild(ul);
    const btn = P.el('button', 'btn primary big', '开始');
    btn.addEventListener('click', startGame);
    card.appendChild(btn);
    refs.cover.appendChild(card);
    refs.cover.classList.remove('hidden');
    setPetLine('start');
  }

  function paintResult(res) {
    refs.cover.innerHTML = '';
    const card = P.el('div', 'g-card');
    card.appendChild(P.el('div', 'g-card-title', '本局结算'));

    const rows = P.el('div', 'g-result-grid');
    rows.appendChild(cell('得分', String(res.score)));
    rows.appendChild(cell('最高连击', String(res.bestCombo)));
    rows.appendChild(cell('命中', String(res.hits)));
    rows.appendChild(cell('误点炸弹', String(res.bombs)));
    rows.appendChild(cell('获得金币', '+' + res.earned));
    rows.appendChild(cell('最高分', String(res.best)));
    card.appendChild(rows);

    if (res.newBest) card.appendChild(P.el('div', 'g-flag', '🏆 新纪录'));

    // 猫猫按得分夸夸 / 吐槽
    const say = P.el('div', 'g-say ' + (res.react || 'ok'));
    say.appendChild(P.el('span', 'g-say-face', res.react === 'roast' ? '😾' : '🐱'));
    say.appendChild(P.el('span', null, PET_LINE[res.react] || PET_LINE.over));
    card.appendChild(say);

    card.appendChild(P.el('div', 'dim', res.earned > 0 ? '金币已入账' : '得分太低，这局没金币'));

    const btn = P.el('button', 'btn primary big', '再来一局');
    btn.addEventListener('click', startGame);
    card.appendChild(btn);

    refs.cover.appendChild(card);
    refs.cover.classList.remove('hidden');
  }

  function cell(k, v) {
    const d = P.el('div', 'g-res-cell');
    d.appendChild(P.el('div', 'k', k));
    d.appendChild(P.el('div', 'v', v));
    return d;
  }

  /* ---------------- 一局流程 ---------------- */

  function startGame() {
    stopGame();
    const c = cfg();
    state = G.newState();
    running = true;
    endAt = Date.now() + c.durationSec * 1000;
    refs.cover.classList.add('hidden');
    refs.arena.classList.remove('shake');
    updateHud();
    setPetLine('start');
    scheduleSpawn();
    // 以真实时间为准；窗口被遮挡时 rAF 会掉帧甚至停摆，所以另挂一条定时器保证一定结算
    if (endTimer) clearTimeout(endTimer);
    endTimer = setTimeout(() => { if (running) finish(); }, c.durationSec * 1000 + 80);
    rafId = requestAnimationFrame(tick);
  }

  function tick() {
    if (!running) return;
    const c = cfg();
    const left = Math.max(0, endAt - Date.now());
    refs.timeText.textContent = (left / 1000).toFixed(1);
    refs.timeFill.style.width = ((left / (c.durationSec * 1000)) * 100).toFixed(1) + '%';
    if (left <= 0) { finish(); return; }
    rafId = requestAnimationFrame(tick);
  }

  function scheduleSpawn() {
    if (!running) return;
    spawnTimer = setTimeout(spawnOne, G.spawnGap(Math.random(), cfg()));
  }

  function spawnOne() {
    if (!running) return;
    const c = cfg();
    if (alive.size < (c.spawn.maxAlive || 6)) {
      addTarget(G.rollType(Math.random(), c.targets), safeSpot());
    }
    scheduleSpawn();
  }

  /* 落点避让：左下角蹲着围观的桌宠，鱼干冒在它底下会被挡住 ——
     看不见就点不着（老大报过"鱼干出在最左下角被阿橘挡住"）。
     randomSpot 是纯逻辑、不知道 DOM，所以避让放在这一层用真实矩形算。
     重抽是拒绝采样：禁区只占场地一小块，1~2 次就能逃出去，6 次兜底。 */
  const WATCH_PAD = 34;   // 半个目标（29px）+ 余量

  function underWatcher(spot) {
    const arena = refs.arena, watch = refs.petWatch;
    if (!arena || !watch) return false;
    const a = arena.getBoundingClientRect();
    const w = watch.getBoundingClientRect();
    if (!a.width || !a.height || !w.width) return false;
    const x = a.left + (spot.x / 100) * a.width;
    const y = a.top + (spot.y / 100) * a.height;
    return x + WATCH_PAD > w.left && x - WATCH_PAD < w.right &&
           y + WATCH_PAD > w.top && y - WATCH_PAD < w.bottom;
  }

  function safeSpot() {
    const c = cfg();
    for (let i = 0; i < 6; i++) {
      const spot = G.randomSpot(Math.random(), Math.random(), c);
      if (!underWatcher(spot)) return spot;
    }
    return G.randomSpot(Math.random(), Math.random(), c);   // 兜底：禁区再大也得有落点
  }

  function addTarget(type, spot) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'target ' + type;
    el.style.left = spot.x + '%';
    el.style.top = spot.y + '%';
    el.textContent = ICON[type];
    el.setAttribute('aria-label', type);

    const rec = { el, type, spot, timer: 0 };
    // 反应力游戏用 pointerdown：比 click 少一次判定延迟
    el.addEventListener('pointerdown', (ev) => { ev.preventDefault(); onHit(rec); });

    rec.timer = setTimeout(() => {
      if (!alive.has(rec)) return;
      removeTarget(rec);
      G.expire(state);   // 超时溜走：不算失误、不断连击
    }, G.aliveMsOf(type, cfg()));

    alive.add(rec);
    refs.targets.appendChild(el);
  }

  function onHit(rec) {
    if (!running || !alive.has(rec)) return;
    removeTarget(rec);
    const r = G.hit(state, rec.type, cfg());
    floatText(rec.spot, (r.delta >= 0 ? '+' : '') + r.delta, r.bomb ? 'bad' : 'good');
    if (r.bomb) {
      shakeArena();
      setPetLine('shock', 1600);
      petReact('shock');
    }
    updateHud();
  }

  function removeTarget(rec) {
    if (rec.timer) clearTimeout(rec.timer);
    alive.delete(rec);
    if (rec.el.parentNode) rec.el.parentNode.removeChild(rec.el);
  }

  function floatText(spot, text, kind) {
    const f = P.el('div', 'float ' + kind, text);
    f.style.left = spot.x + '%';
    f.style.top = spot.y + '%';
    refs.targets.appendChild(f);
    setTimeout(() => f.remove(), 700);
  }

  function shakeArena() {
    const a = refs.arena;
    a.classList.remove('shake');
    void a.offsetWidth;   // 重启动画
    a.classList.add('shake');
  }

  function updateHud() {
    if (!state) return;
    refs.scoreNum.textContent = String(state.score);
    const mult = G.multiplierOf(state.combo, cfg());
    refs.comboPill.textContent = `连击 ${state.combo}` + (mult > 1 ? ` ×${mult}` : '');
    refs.comboPill.classList.toggle('hot', mult > 1);
  }

  async function finish() {
    running = false;
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    if (spawnTimer) { clearTimeout(spawnTimer); spawnTimer = 0; }
    if (endTimer) { clearTimeout(endTimer); endTimer = 0; }
    for (const rec of Array.from(alive)) removeTarget(rec);

    const c = cfg();
    const patch = G.settlePatch(P.save, state.score, c);

    const result = {
      score: state.score,
      bestCombo: state.bestCombo,
      hits: state.hits,
      bombs: state.bombs,
      earned: patch.earned,
      best: patch.stats.bestGameScore,
      newBest: patch.newBest,
      react: patch.react,
    };

    paintResult(result);

    // 猫猫演出：按得分分档（best / praise / ok / roast），桌宠窗口同步
    setPetLine(patch.react, 3200);
    petReact({ kind: patch.react, game: 'fish', score: state.score, best: patch.newBest });

    try {
      await P.applyPatch({ coins: patch.coins, stats: patch.stats });
    } catch (e) {
      console.error('[fish] settle failed:', e.message);
      P.toast('结算写入失败，金币可能没到账');
    }
  }

  function stopGame() {
    running = false;
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    if (spawnTimer) { clearTimeout(spawnTimer); spawnTimer = 0; }
    if (endTimer) { clearTimeout(endTimer); endTimer = 0; }
    for (const rec of Array.from(alive)) removeTarget(rec);
  }

  /* ---------------- 桌宠联动 ---------------- */

  function petReact(msg) {
    try { if (window.mgw.petReact) window.mgw.petReact(msg); } catch (e) { /* 桌宠没开就忽略 */ }
  }

  function setPetLine(key, ms) {
    if (!refs.petLine) return;
    const txt = PET_LINE[key] || '';
    refs.petLine.textContent = txt;
    refs.petLine.classList.remove('hidden');
    if (refs.petFace) {
      refs.petFace.classList.remove('shock', 'happy', 'annoyed');
      if (key === 'shock') refs.petFace.classList.add('shock');
      else if (key === 'roast') refs.petFace.classList.add('annoyed');
      else if (key === 'best' || key === 'praise' || key === 'ok') refs.petFace.classList.add('happy');
    }
    if (petLineTimer) clearTimeout(petLineTimer);
    if (ms) petLineTimer = setTimeout(() => {
      if (!refs.petLine) return;
      refs.petLine.textContent = PET_LINE.over;
      if (refs.petFace) refs.petFace.classList.remove('shock', 'happy', 'annoyed');
    }, ms);
  }

  /* ---------------- 对外 ---------------- */

  function onSave() {
    // 比赛中不重建 DOM（会打断本局），只刷新最高分
    if (running || !refs.bestText) return;
    const best = (P.save && P.save.stats && P.save.stats.bestGameScore) || 0;
    refs.bestText.textContent = `最高分 ${best}`;
  }

  /** 切走 tab 或退出游戏 → 中止本局（老板来了立刻收摊，不结算、不刷分） */
  function onHide() { stopGame(); }

  window.MGW_GameFish = { render, onSave, onHide };
})();
