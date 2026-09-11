/**
 * 喵工位 — 全局数值配置（需求 1.8 数值表全量落盘，改这里即改全部）
 * 加载方式：
 *   主进程:  const config = require('./src/shared/config.js')
 *   渲染页:  <script src="../shared/config.js"></script> → 全局 MGW_CONFIG
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.MGW_CONFIG = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  /* 桌宠尺寸换算（主进程建窗 / 渲染层绘制共用一套公式，避免两边各算各的）
     以「一格素材 = scale 像素」为基准：窗口 = 24 格猫 + 四周留白（单位都是 CSS px） */
  const PET = {
    defaultScale: 8,   // 默认每格 8px → 窗口 242×280
    minScale: 4,
    maxScale: 16,
    grid: 24,          // 素材网格 24×24
    padL: 4.5,         // 左侧留白（格）：站番茄沙漏
    padR: 1.75,        // 右侧留白（格）：与旧版一致
    topY: 7,           // 头顶留白（格）：放气泡
    bottomY: 4,        // 底部留白（格）：放按钮栏与缩放手柄
    hourglass: { w: 3.5, h: 6 },   // 沙漏本体（格），竖直摆在左侧留白里
  };

  function clampScale(s) {
    const n = Math.round(Number(s));
    if (!isFinite(n)) return PET.defaultScale;
    return Math.min(PET.maxScale, Math.max(PET.minScale, n));
  }

  /**
   * scale → 布局换算（主进程建窗 / 渲染层画布·沙漏·居中基准共用这一份）
   *   猫占中间 24 格；左留白站沙漏，右留白给缩放手柄留呼吸。
   *   offsetX = 猫的左边界 = 左留白宽。⚠️ 气泡和按钮栏必须以「猫」为基准居中，
   *   不能按窗口居中 —— 左右留白不等宽，按窗口居中会整体往右偏。
   */
  function petMetrics(scale) {
    const s = clampScale(scale);
    const padL = Math.round(PET.padL * s);
    const padR = Math.round(PET.padR * s);
    const catW = PET.grid * s;
    return {
      scale: s,
      offsetX: padL,
      offsetY: PET.topY * s,
      padL,
      padR,
      catW,
      width: catW + padL + padR,
      height: catW + (PET.topY + PET.bottomY) * s,
      hourglass: { w: Math.round(PET.hourglass.w * s), h: Math.round(PET.hourglass.h * s) },
    };
  }

  return {
    appName: '喵工位',

    petSize: PET,
    petMetrics,

    window: {
      pet:   { width: 242, height: 280 },   // = petMetrics(defaultScale)，兼容旧引用
      panel: { width: 900, height: 640 },
    },

    catGrid: 24, // 猫咪像素网格 24×24

    /* 桌宠状态清单（像素猫 / 图片桌宠 / 面板槽位 / 调试菜单共用一份） */
    petStates: {
      sustain: ['idle', 'sleep', 'work'],                    // 持续态（setBase）
      once: ['happy', 'shock', 'annoyed', 'eat', 'stretch'], // 单次态（播完回持续态）
      timed: ['belly'],                                      // 定时态（playFor(ms) 手动定时）
      // 图片桌宠没有帧：单次态用这个时长兜结束回调（对齐像素猫实测总时长）
      onceMs: { happy: 880, shock: 600, annoyed: 1600, eat: 840, stretch: 1400 },
    },

    /* 图片桌宠的图片槽位：default 必传，其余 9 个状态可空（空则回落 default） */
    petSlots: {
      order: ['default', 'idle', 'sleep', 'work', 'happy', 'shock', 'annoyed', 'eat', 'stretch', 'belly'],
      labels: {
        default: '默认形象', idle: '待机', sleep: '打盹', work: '专注',
        happy: '开心', shock: '炸毛', annoyed: '嫌弃', eat: '干饭',
        stretch: '伸懒腰', belly: '翻肚皮',
      },
    },

    /* 图片桌宠导入归一化（主进程 nativeImage 用） */
    imagePet: {
      maxSide: 1024,   // 超过则等比缩小（不放大）
      minSide: 96,     // 小于此边长直接拒绝（放大会糊）
      thumbSide: 128,  // 面板列表 / 槽位缩略图边长
      traySide: 32,    // 托盘图标边长
    },

    /* 内置像素猫（面板「桌宠」页 / 主进程调试菜单共用） */
    builtinCats: [
      { id: 'orange', name: '橘猫' },
      { id: 'cow', name: '奶牛猫' },
      { id: 'black', name: '黑猫' },
      { id: 'calico', name: '三花猫' },
      { id: 'tabby', name: '狸花猫' },
    ],

    // 番茄钟
    pomodoro: {
      workMin: 25,
      breakMin: 5,
      rewardCoins: 30,      // 工作完成 +30 金币
      rewardTickets: 1,    // +1 抽卡券
      rewardAffection: 10, // +10 好感
    },

    // 失焦摸鱼检测（仅工作阶段生效，同一番茄限 1 次吐槽）
    away: {
      pollSec: 5,          // 轮询间隔
      thresholdSec: 30,    // 失焦满 30s 触发吐槽
    },

    // 摸头
    petting: {
      affection: 2,        // +2 好感
      cooldownSec: 8,      // 冷却 8 秒
      spamThreshold: 5,    // 1 分钟内狂摸超过 5 次
      spamWindowSec: 60,
      penaltySec: 30,      // 嫌弃后 30 秒零收益
    },

    // 喂鱼干
    feeding: {
      costCoins: 15,       // 15 金币
      affection: 6,         // → +6 好感
    },

    // 抽卡
    gacha: {
      normal: {
        costTickets: 1,    // 1 券
        costCoins: 150,    // 或 150 金币
        rates: { N: 0.60, R: 0.30, SR: 0.09, SSR: 0.01 },
      },
      premium: {
        costCoins: 200,    // 高级池 200 金币/抽
        unlockLevel: 5,    // 好感 Lv5 解锁
        rates: { N: 0.40, R: 0.35, SR: 0.20, SSR: 0.05 }, // 默认值，可调
      },
      pityLimit: 50,       // 50 抽内必出 SSR
      dupToCoins: { N: 20, R: 60, SR: 200, SSR: 800 }, // 重复卡转金币
    },

    // 鱼干突袭（2026-09-10 定稿；同日复查：出怪更密、单局收益下调）
    fish: {
      durationSec: 20,       // 一局 20 秒
      targets: {
        fish: { score: 8,   weight: 0.70, aliveMs: 1500 }, // 普通鱼干：停留 1.5s
        gold: { score: 20,  weight: 0.15, aliveMs: 800 },  // 金鱼：只停 0.8s（更难，分值更高）
        bomb: { score: -12, weight: 0.15, aliveMs: 2000 }, // 炸弹：停 2s，留足躲避时间
      },
      // 出怪间隔（毫秒，越小越密）：20s 约 60 个目标，比初版密约 1.5 倍——提神用
      spawn: { minMs: 240, maxMs: 400, maxAlive: 7 },
      // combo 倍率：每连击 step 次 +addPerStep 倍，上限 maxMult；只作用于正向得分，炸弹不吃加成
      combo: { step: 5, addPerStep: 0.25, maxMult: 2 },
      coinsPerScore: 0.10,   // 金币 = floor(得分 × 0.10)：密度↑但单价↓，单局总收益约为初版四成
      // 结算评价分档（猫猫夸夸 / 吐槽）：score ≥ praise → 夸；≥ ok → 一般；否则吐槽；破纪录另算
      react: { praise: 300, ok: 140 },
    },

    // 反应力测试（2026-09-10 老大定）：5 次取平均；变色前点算抢跑
    reflex: {
      rounds: 5,                          // 一局测几次
      waitMs: { min: 1000, max: 3500 },   // 变色前的随机等待，防预判
      baseCoins: 10,                      // 每局基础金币
      recordCoinsStep: 40,                // 破纪录奖金 = step × 第几次破纪录（第 5 次 = 200）
      recordCoinsMax: 400,                // 封顶，避免无限膨胀
      // 分档只影响文案与评价，不影响金币（人类平均约 250ms）
      grades: [
        { key: 'bolt',   maxMs: 200,      label: '闪电' },
        { key: 'sharp',  maxMs: 260,      label: '敏锐' },
        { key: 'normal', maxMs: 330,      label: '正常' },
        { key: 'slow',   maxMs: 450,      label: '迟钝' },
        { key: 'sloth',  maxMs: Infinity, label: '树懒' },
      ],
      // 猫猫评价：avg ≤ praise 夸；≤ ok 一般；否则吐槽；破纪录另算
      react: { praise: 260, ok: 400 },
    },

    // 好感度等级阈值 Lv1–10
    affectionLevels: [0, 50, 150, 300, 500, 800, 1200, 1700, 2300, 3000],
  };
});
