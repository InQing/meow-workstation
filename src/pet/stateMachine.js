/**
 * 猫咪状态机：持续态 + 一次性态（清单收敛在 shared/config.js 的 petStates）
 * 持续态：idle（待机）/ sleep（打盹）/ work（番茄中陪工）
 * 一次性：happy / shock / annoyed / eat / stretch —— 播完自动回持续态
 * 定时态：belly（翻肚皮）由 playFor(ms) 手动定时
 */
(function () {
  const cfg = window.MGW_CONFIG;
  const ONCE = cfg.petStates.once;
  const SUSTAIN = cfg.petStates.sustain;

  const S = {
    renderer: null,
    base: 'idle',      // 持续态基准（番茄开始时主进程/UI 会设成 work）
    current: 'idle',
    listeners: [],
  };

  function emit(next) {
    for (const fn of S.listeners) fn(next, S.base);
  }

  /** 切换持续态 */
  function setBase(name) {
    if (!SUSTAIN.includes(name)) {
      console.warn('[stateMachine] not a persistent state:', name);
      return;
    }
    S.base = name;
    S.current = name;
    S.renderer.play(name);
    emit(name);
  }

  /** 播放一次性状态，播完回 base */
  function once(name) {
    if (!ONCE.includes(name)) {
      console.warn('[stateMachine] not a one-shot state:', name);
      return;
    }
    S.current = name;
    emit(name);
    S.renderer.once(name, () => {
      S.current = S.base;
      S.renderer.play(S.base);
      emit(S.base);
    });
  }

  /** 播放指定时长后回落到持续态（用于循环动画，如翻肚皮） */
  function playFor(name, ms = 3000) {
    S.current = name;
    emit(name);
    S.renderer.play(name);
    if (S.timerId) clearTimeout(S.timerId);
    S.timerId = setTimeout(() => {
      S.current = S.base;
      S.renderer.play(S.base);
      emit(S.base);
    }, ms);
  }

  /** 统一入口：自动判断类型 */
  function set(name) {
    if (ONCE.includes(name)) once(name);
    else setBase(name);
  }

  window.StateMachine = {
    init(renderer) { S.renderer = renderer; return this; },
    set,
    setBase,
    once,
    playFor,
    onChange: (fn) => S.listeners.push(fn),
    get current() { return S.current; },
    get base() { return S.base; },
  };
})();
