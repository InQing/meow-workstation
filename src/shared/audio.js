/**
 * 程序化音效（Web Audio 合成，不引入任何音频文件）
 * 阶段 3：alarm（闹钟）/ cheer（欢呼）
 * 后续：coin（金币）/ flip（翻牌）/ boom（爆炸）
 */
(function () {
  let ctx = null;
  let master = null;
  let volume = 0.5;
  let disabled = false; // 音频设备不可用（如无音频设备的环境）→ 永久静音，避免带崩渲染进程

  function ensure() {
    if (disabled) return null;
    try {
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) { disabled = true; return null; }
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = volume;
        master.connect(ctx.destination);
      }
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    } catch (e) {
      console.warn('[audio] audio unavailable, muted:', e.message);
      disabled = true;
      return null;
    }
  }

  /** 单个音符：可选频率滑动 */
  function tone({ freq, to = null, dur = 0.15, type = 'sine', gain = 0.25, at = 0 }) {
    const c = ensure();
    if (!c) return;
    const t0 = c.currentTime + at;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (to) osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  /** 噪声（爆炸/尘土感） */
  function noise({ dur = 0.3, gain = 0.2, at = 0, lowpass = 1200 }) {
    const c = ensure();
    if (!c) return;
    const t0 = c.currentTime + at;
    const len = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = c.createBufferSource();
    src.buffer = buf;
    const filter = c.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = lowpass;
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter); filter.connect(g); g.connect(master);
    src.start(t0);
  }

  const SOUNDS = {
    // 闹钟：两声下行 beep
    alarm: () => {
      tone({ freq: 880, to: 660, dur: 0.18, type: 'square', gain: 0.22 });
      tone({ freq: 880, to: 660, dur: 0.18, type: 'square', gain: 0.22, at: 0.26 });
    },
    // 欢呼：上行琶音
    cheer: () => {
      [523, 659, 784, 1047].forEach((f, i) =>
        tone({ freq: f, dur: 0.16, type: 'triangle', gain: 0.2, at: i * 0.075 }));
    },
    // 金币：经典两连跳
    coin: () => {
      tone({ freq: 988, dur: 0.07, type: 'square', gain: 0.18 });
      tone({ freq: 1319, dur: 0.16, type: 'square', gain: 0.16, at: 0.06 });
    },
    // 翻牌
    flip: () => {
      noise({ dur: 0.12, gain: 0.12, lowpass: 3000 });
      tone({ freq: 620, to: 900, dur: 0.1, type: 'triangle', gain: 0.12 });
    },
    // 爆炸
    boom: () => {
      tone({ freq: 220, to: 40, dur: 0.35, type: 'sawtooth', gain: 0.22 });
      noise({ dur: 0.4, gain: 0.18, lowpass: 900 });
    },
  };

  function play(name) {
    const fn = SOUNDS[name];
    if (!fn) { console.warn('[audio] unknown sound:', name); return; }
    try { fn(); } catch (e) { console.warn('[audio] play failed:', e.message); }
  }

  window.MGW_Audio = {
    play,
    setVolume(v) { volume = v; if (master) master.gain.value = v; },
    unlock() { ensure(); },   // 首次用户交互时调用（浏览器自动播放策略）
    names: Object.keys(SOUNDS),
  };
})();
