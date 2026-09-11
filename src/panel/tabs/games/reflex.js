/**
 * 面板 · 游戏中心 → 反应力测试
 *
 * 规则（2026-09-10 老大定）：
 *   整块场地就是一块点击板，三态切换：
 *     待机（暗）→ 点开始 → 等待（暗红 + 呼吸，随机 1.0~3.5s）→ 行动（点亮，立刻点）
 *   成绩 = 变色到点击的间隔；变色前点了 = 抢跑，本次作废、重新计时、记一次犯规
 *   测 5 次取平均 → 分档（闪电/敏锐/正常/迟钝/树懒）
 *   金币 = 基础 10 + 破纪录奖金 40 × 第几次破纪录（第 5 次 = 200，封顶 400）
 *
 * 全部数值与判定走 src/shared/reflex.js（已自测），这里只做状态机、计时与渲染。
 * 计时用 performance.now()；音效：无（摸鱼场景）。
 */
(function () {
  const P = window.MGW_Panel;
  const R = window.MGW_Reflex;

  const cfg = () => P.CONFIG.reflex;

  const GRADE_HINT = {
    bolt: '比绝大多数人都快',
    sharp: '快于多数人',
    normal: '正常人的水平',
    slow: '有点慢了',
    sloth: '……醒醒',
  };

  /* 结算评价台词（key 与 shared/reflex.js 的 reactFor 一致） */
  const PET_LINE = {
    start: '手放好，别抢跑',
    foul: '急什么，还没变色呢',
    over: '测完了，还来？',
    best: '新纪录！这反应我服',
    praise: '喵！反应挺快啊～',
    ok: '还行，普通人的水平',
    roast: '……你是用尾巴点的吗',
  };

  const refs = {};
  let rootEl = null;
  let state = null;
  let phase = 'idle';       // idle | waiting | go | result
  let goAt = 0;
  let waitTimer = 0;
  let nextTimer = 0;
  let petLineTimer = 0;

  /* ---------------- 渲染 ---------------- */

  function render(root) {
    stopRound();             // 重进一律重置本局
    rootEl = root;
    root.innerHTML = '';
    const c = cfg();

    const head = P.el('div', 'sec-head');
    head.appendChild(P.el('h2', 'sec-title', '反应力测试'));
    head.appendChild(P.el('div', 'dim',
      `${c.rounds} 次取平均 · 变色后立刻点 · 金币 ${c.baseCoins} + 破纪录奖金`));
    root.appendChild(head);

    const wrap = P.el('div', 'game-wrap');

    /* HUD */
    const hud = P.el('div', 'game-hud');
    const roundBox = P.el('div', 'g-time');
    roundBox.appendChild(P.el('span', 'g-label', '轮次'));
    refs.roundText = P.el('b', 'g-time-num', `0/${c.rounds}`);
    roundBox.appendChild(refs.roundText);
    hud.appendChild(roundBox);

    const fastBox = P.el('div', 'g-score');
    fastBox.appendChild(P.el('span', 'g-label', '本局最快'));
    refs.fastText = P.el('b', 'g-score-num', '—');
    fastBox.appendChild(refs.fastText);
    hud.appendChild(fastBox);

    refs.foulPill = P.el('div', 'combo-pill', '抢跑 0');
    hud.appendChild(refs.foulPill);

    const best = (P.save && P.save.stats && P.save.stats.bestReflexMs) || 0;
    refs.bestText = P.el('div', 'g-best dim', best ? `最佳平均 ${best} ms` : '还没测过');
    hud.appendChild(refs.bestText);
    wrap.appendChild(hud);

    /* 5 颗状态灯 */
    const lights = P.el('div', 'r-lights');
    refs.lights = [];
    for (let i = 0; i < c.rounds; i++) {
      const box = P.el('div', 'r-light');
      const dot = P.el('i', 'r-dot');
      const num = P.el('span', 'r-num', '—');
      box.appendChild(dot);
      box.appendChild(num);
      lights.appendChild(box);
      refs.lights.push({ box, dot, num });
    }
    wrap.appendChild(lights);

    /* 场地：整块就是点击板 */
    const arena = P.el('div', 'arena r-arena');
    refs.arena = arena;

    refs.pad = P.el('button', 'r-pad idle');
    refs.pad.type = 'button';
    refs.padText = P.el('div', 'r-pad-text', '');
    refs.padSub = P.el('div', 'r-pad-sub', '');
    refs.pad.appendChild(refs.padText);
    refs.pad.appendChild(refs.padSub);
    // pointerdown 比 click 少一次判定延迟，成绩才准
    refs.pad.addEventListener('pointerdown', (ev) => { ev.preventDefault(); onPad(); });
    arena.appendChild(refs.pad);

    arena.appendChild(buildWatcher());

    refs.cover = P.el('div', 'g-cover');
    arena.appendChild(refs.cover);
    wrap.appendChild(arena);

    root.appendChild(wrap);

    state = R.newState();
    paintIdlePad();
    paintHud();
    paintIntro();
  }

  /** 角落围观的桌宠位（emoji 占位，等素材接入后换 canvas） */
  function buildWatcher() {
    const box = P.el('div', 'pet-watch');
    refs.petWatch = box;
    refs.petFace = P.el('div', 'pet-face', '🐱');
    box.appendChild(refs.petFace);
    refs.petLine = P.el('div', 'pet-say', PET_LINE.over);
    box.appendChild(refs.petLine);
    return box;
  }

  function setPad(state_, text, sub) {
    refs.pad.className = 'r-pad ' + state_;
    refs.padText.textContent = text;
    refs.padSub.textContent = sub || '';
  }

  function paintIdlePad() {
    setPad('idle', '准备好了吗', `${cfg().rounds} 次 · 取平均`);
  }

  function paintIntro() {
    refs.cover.innerHTML = '';
    const card = P.el('div', 'g-card');
    card.appendChild(P.el('div', 'g-card-title', '⚡ 反应力测试'));
    const ul = P.el('ul', 'g-rules');
    const c = cfg();
    ul.appendChild(P.el('li', null, `一共测 ${c.rounds} 次，取平均反应时间（越小越好）`));
    ul.appendChild(P.el('li', null, `场地变色的瞬间点下去，中间随机等 ${(c.waitMs.min / 1000).toFixed(1)}~${(c.waitMs.max / 1000).toFixed(1)} 秒`));
    ul.appendChild(P.el('li', null, '变色前点了算抢跑：这一次作废、重新计时（会记犯规数）'));
    ul.appendChild(P.el('li', null, `每局基础 ${c.baseCoins} 金币；破了平均纪录还有奖金（第 5 次破纪录 = ${c.recordCoinsStep * 5}）`));
    card.appendChild(ul);
    const btn = P.el('button', 'btn primary big', '开始');
    btn.addEventListener('click', startRound);
    card.appendChild(btn);
    refs.cover.appendChild(card);
    refs.cover.classList.remove('hidden');
    setPetLine('start');
  }

  function paintResult(res) {
    refs.cover.innerHTML = '';
    const card = P.el('div', 'g-card r-card');   // r-card：压紧内距，整卡要装进 320px 场地
    card.appendChild(P.el('div', 'g-card-title', '本局结算'));

    const rows = P.el('div', 'g-result-grid');
    rows.appendChild(cell('平均反应', res.avgMs + ' ms'));
    rows.appendChild(cell('最快一次', res.bestMs + ' ms'));
    rows.appendChild(cell('最慢一次', res.worstMs + ' ms'));
    rows.appendChild(cell('抢跑', String(res.fouls)));
    rows.appendChild(cell('获得金币', '+' + res.earned));
    rows.appendChild(cell('历史最佳', res.best + ' ms'));
    card.appendChild(rows);

    if (res.grade) {
      card.appendChild(P.el('div', 'r-grade ' + res.grade.key,
        res.grade.label + ' · ' + (GRADE_HINT[res.grade.key] || '')));
    }
    if (res.newBest) {
      card.appendChild(P.el('div', 'g-flag', `🏆 第 ${res.breaks} 次破纪录  +${res.bonus}`));
    }

    // 猫猫按平均反应夸夸 / 吐槽
    const say = P.el('div', 'g-say ' + (res.react || 'ok'));
    say.appendChild(P.el('span', 'g-say-face', res.react === 'roast' ? '😾' : '🐱'));
    say.appendChild(P.el('span', null, PET_LINE[res.react] || PET_LINE.over));
    card.appendChild(say);

    const btn = P.el('button', 'btn primary big', '再来一局');
    btn.addEventListener('click', startRound);
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

  function startRound() {
    stopRound();
    state = R.newState();
    refs.cover.classList.add('hidden');
    paintHud();
    paintLights();
    setPetLine('start');
    nextRound();
  }

  /** 进入「等待变色」态：随机等 1.0~3.5s 后点亮 */
  function nextRound() {
    phase = 'waiting';
    setPad('wait', '等…别急', '变色就点');
    const c = cfg();
    if (waitTimer) clearTimeout(waitTimer);
    waitTimer = setTimeout(goPhase, R.waitGap(Math.random(), c));
  }

  function goPhase() {
    if (phase !== 'waiting') return;
    phase = 'go';
    goAt = performance.now();
    setPad('go', '点！', '');
    // 重绘一次，确保「点亮」这一帧真的送到屏幕（不然可能在节流窗口里被吃掉）
    void refs.pad.offsetWidth;
  }

  function onPad() {
    if (phase === 'waiting') {
      // 抢跑：本次作废，重新计时
      R.foul(state);
      phase = 'fouling';
      setPad('foul', '抢跑了！', '这次不算，重来');
      paintHud();
      if (waitTimer) { clearTimeout(waitTimer); waitTimer = 0; }
      scheduleNext(1100, () => nextRound());
      return;
    }
    if (phase !== 'go') return;

    const ms = Math.round(performance.now() - goAt);
    R.record(state, ms);
    phase = 'hit';
    setPad('hit', String(ms), 'ms');
    paintHud();
    paintLights();

    if (R.isDone(state, cfg())) {
      scheduleNext(900, finish);
    } else {
      scheduleNext(900, nextRound);
    }
  }

  /** 用一条定时器串起「短暂停顿后继续」，切换 / 中止时统一清干净 */
  function scheduleNext(ms, fn) {
    if (nextTimer) clearTimeout(nextTimer);
    nextTimer = setTimeout(() => { nextTimer = 0; fn(); }, ms);
  }

  async function finish() {
    phase = 'result';
    if (waitTimer) { clearTimeout(waitTimer); waitTimer = 0; }
    if (nextTimer) { clearTimeout(nextTimer); nextTimer = 0; }

    const c = cfg();
    const patch = R.settlePatch(P.save, state, c);

    paintResult({
      avgMs: patch.avgMs,
      bestMs: patch.bestMs,
      worstMs: patch.worstMs,
      fouls: patch.fouls,
      earned: patch.earned,
      bonus: patch.bonus,
      best: patch.stats.bestReflexMs,
      breaks: patch.breaks,
      newBest: patch.newBest,
      grade: patch.grade,
      react: patch.react,
    });

    setPetLine(patch.react, 3200);
    petReact({ kind: patch.react, game: 'reflex', score: patch.avgMs, best: patch.newBest });

    try {
      await P.applyPatch({ coins: patch.coins, stats: patch.stats });
    } catch (e) {
      console.error('[reflex] settle failed:', e.message);
      P.toast('结算写入失败，金币可能没到账');
    }
  }

  function stopRound() {
    phase = 'idle';
    if (waitTimer) { clearTimeout(waitTimer); waitTimer = 0; }
    if (nextTimer) { clearTimeout(nextTimer); nextTimer = 0; }
    if (refs.pad) paintIdlePad();
  }

  /* ---------------- HUD / 状态灯 ---------------- */

  function paintHud() {
    if (!refs.roundText || !state) return;
    const c = cfg();
    refs.roundText.textContent = `${state.times.length}/${c.rounds}`;
    const fast = R.bestOf(state);
    refs.fastText.textContent = fast == null ? '—' : fast + ' ms';
    refs.foulPill.textContent = `抢跑 ${state.fouls}`;
    refs.foulPill.classList.toggle('hot', state.fouls > 0);
  }

  function paintLights() {
    if (!refs.lights || !state) return;
    refs.lights.forEach((L, i) => {
      const v = state.times[i];
      L.num.textContent = v == null ? '—' : String(v);
      L.box.classList.toggle('on', v != null);
    });
  }

  /* ---------------- 桌宠联动 ---------------- */

  function petReact(msg) {
    try { if (window.mgw.petReact) window.mgw.petReact(msg); } catch (e) { /* 桌宠没开就忽略 */ }
  }

  function setPetLine(key, ms) {
    if (!refs.petLine) return;
    refs.petLine.textContent = PET_LINE[key] || '';
    refs.petLine.classList.remove('hidden');
    if (refs.petFace) {
      refs.petFace.classList.remove('shock', 'happy', 'annoyed');
      if (key === 'roast') refs.petFace.classList.add('annoyed');
      else if (key === 'foul') refs.petFace.classList.add('shock');
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
    // 只在没在测的时候刷新历史最佳，避免打断本局
    if (phase !== 'idle' && phase !== 'result') return;
    if (!refs.bestText) return;
    const best = (P.save && P.save.stats && P.save.stats.bestReflexMs) || 0;
    refs.bestText.textContent = best ? `最佳平均 ${best} ms` : '还没测过';
  }

  /** 切走 tab / 退出游戏 → 中止本局（不结算、不刷分） */
  function onHide() { stopRound(); }

  window.MGW_GameReflex = { render, onSave, onHide };
})();
