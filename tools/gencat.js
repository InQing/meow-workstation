/**
 * 猫咪素材生成器（开发期工具，运行时不需要）
 * 思路：手画少量基础姿势 → 程序化派生全部动画帧 → 输出符合需求 2.2 schema 的 JSON
 * 用法：node tools/gencat.js
 */
const fs = require('fs');
const path = require('path');

const W = 24, H = 24;

/* ---------------- 基础工具 ---------------- */

/** 生成一行：前导点 + 内容 + 自动补齐到 24（保证行长永远正确） */
function row(content, lead = 0) {
  const s = '.'.repeat(lead) + content;
  if (s.length > W) throw new Error(`行超长(${s.length}): ${content}`);
  return s + '.'.repeat(W - s.length);
}

const blank = () => Array(H).fill('.'.repeat(W)).slice();

function setChar(grid, x, y, ch) {
  const g = grid.slice();
  g[y] = g[y].substring(0, x) + ch + g[y].substring(x + 1);
  return g;
}

function replaceAll(grid, from, to) {
  return grid.map((r) => r.split(from).join(to));
}

function shift(grid, dx, dy) {
  const out = blank();
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const ch = grid[y][x];
      if (ch === '.') continue;
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
      out[ny] = out[ny].substring(0, nx) + ch + out[ny].substring(nx + 1);
    }
  }
  return out;
}

/** 只把尾巴区域（x>=TAIL_X）上下平移，实现摆尾 */
const TAIL_X = 19;
function tailShift(grid, dy) {
  const out = grid.map((r) => r.split(''));
  const px = [];
  for (let y = 0; y < H; y++) {
    for (let x = TAIL_X; x < W; x++) {
      if (grid[y][x] !== '.') { px.push([x, y, grid[y][x]]); out[y][x] = '.'; }
    }
  }
  for (const [x, y, ch] of px) {
    const ny = y + dy;
    if (ny >= 0 && ny < H) out[ny][x] = ch;
  }
  return out.map((r) => r.join(''));
}

/** 炸毛：轮廓外侧长尖刺 */
function spikes(grid) {
  const out = grid.map((r) => r.split(''));
  for (let y = 1; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const ch = grid[y][x];
      if (ch === '.') continue;
      if (grid[y - 1][x] === '.' && (x * 5 + y * 3) % 3 === 0) out[y - 1][x] = 'O';
      if (x > 0 && grid[y][x - 1] === '.' && (x * 3 + y * 7) % 4 === 0) out[y][x - 1] = 'O';
      if (x < W - 1 && grid[y][x + 1] === '.' && (x * 7 + y * 5) % 4 === 0) out[y][x + 1] = 'O';
    }
  }
  return out.map((r) => r.join(''));
}

/** 张嘴（干饭 / 哈欠）：鼻子下方开一个口 */
function openMouth(grid) {
  let g = grid.slice();
  for (let y = 11; y <= 13; y++) {
    for (let x = 10; x <= 12; x++) {
      if (g[y][x] === 'F') g = setChar(g, x, y, 'O');
    }
  }
  return g;
}

/** 若干行的整体平移（用于局部变形） */
function shiftRows(rows, dx, dy) {
  const out = Array(rows.length).fill('.'.repeat(W));
  for (let y = 0; y < rows.length; y++) {
    for (let x = 0; x < W; x++) {
      const ch = rows[y][x];
      if (ch === '.') continue;
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || nx >= W || ny < 0 || ny >= rows.length) continue;
      out[ny] = out[ny].substring(0, nx) + ch + out[ny].substring(nx + 1);
    }
  }
  return out;
}

/** 伸懒腰：头肩整体上抬 1px，中间重复一行撑出身长，末尾补回空行保持 24 行 */
function stretchPose(grid) {
  const head = shiftRows(grid.slice(0, 13), 0, -1);
  if (head[12] === '.'.repeat(W)) head[12] = grid[12]; // 补位，避免中间断层
  return [...head, ...grid.slice(13, 23), row('')];
}

/** 翻肚皮：仰躺露肚（手画姿势） */
const LYING = [
  row(''), row(''), row(''), row(''),
  row('OO', 4),
  row('OFFO', 3),
  row('OFFFOO', 2),
  row('OFEEFFOOO', 2),
  row('OFFFPPFFOO', 2),
  row('OFFFFFFFFFOO', 2),
  row('OWWWWWWWWWWWWOO', 3),
  row('OWWWWWWWWWWWWWWO', 4),
  row('OWWWWWWWWWWWWWWWO', 4),
  row('OWWWWWWWWWWWWWWWO', 4),
  row('OWWWWWWWWWWWWWWO', 4),
  row('OFFFFFFFFFFFFFFO', 4),
  row('OFFFFFFFFFFFFFFO', 4),
  row('OOOOOOOOOOOOOOO', 4),
  row(''), row(''), row(''), row(''), row(''), row(''),
];

/** 眨眼 / 眯眼：眼睛 E → 深色横线 O */
const blink = (g) => replaceAll(g, 'E', 'O');
/** 半睁（嫌弃）：上眼皮压下来 */
function squint(grid) {
  let g = blink(grid);
  return g;
}

/* ---------------- 基础姿势（手画，仅此两份） ---------------- */

/** 坐姿（默认） */
const SIT = [
  row(''), row(''),
  row('O..........O', 5),
  row('OO........OO', 5),
  row('OFFO......OFFO', 5),
  row('OFFFFFFFFFFFFO', 5),
  row('OFFFFFFFFFFFFFFO', 4),
  row('OFFFEEFFFFEEFFFO', 4),
  row('OFFFFFFFFFFFFFFO', 4),
  row('OFFFFFFFFFFFFFFO', 4),
  row('OFFFFFFPPFFFFFFO', 4),
  row('OFFFFFFFFFFFFFFFFO', 3),
  row('OFFFFFFFFFFFFFFFFO', 3),
  row('OFFFFFFFFFFFFFFFFFFFO', 1),
  row('OFFFFWWWWWWWWWWWWFFFFO', 1),
  row('OFFFFWWWWWWWWWWWWFFFFO', 1),
  row('OFFFFWWWWWWWWWWWWFFFFO', 1),
  row('OFFFFFFFFFFFFFFO.OFFO', 2),
  row('OFFFFFFFFFFFFFFO.OFFO', 2),
  row('OFFFFFFFFFFFFFFO.OFFO', 2),
  row('OFFFFFFFFFFFFFFO.OFFO', 2),
  row('OFFFWWWWWWWWWFFO.OFO', 2),
  row('OWWWWWWWWWWWWWO...OOO', 2),
  row(''),
];

/** 趴姿（打盹 / 陪工共用，眼睛不同） */
const CROUCH = [
  row(''), row(''),
  row('O..............O', 5),
  row('OO............OO', 5),
  row('OFFO......OFFO', 5),
  row('OFFFFFFFFFFFFO', 5),
  row('OFFFFFFFFFFFFFFO', 4),
  row('OFFFEEFFFFEEFFFO', 4),
  row('OFFFFFFFFFFFFFFO', 4),
  row('OFFFFFFPPFFFFFFO', 4),
  row('OFFFFFFFFFFFFFFO', 4),
  row('OOOFFFFFFFFFFFFOOO', 2),
  row('OFFFFFFFFFFFFFFFFFFO', 2),
  row('OFFWWWWWWWWWWWWWWFFO', 1),
  row('OFWWWWWWWWWWWWWWWWFO', 1),
  row('OFWWWWWWWWWWWWWWWWFO', 1),
  row('OWWWWWWWWWWWWWWWWWO', 1),
  row('OOOOOOOOOOOOOOOOOO', 2),
  row(''), row(''), row(''), row(''), row(''), row(''),
];

const CROUCH_DOWN = shift(CROUCH, 0, 2); // 整体下移，视觉上"趴"在窗口底部

/* ---------------- 猫定义：模板 + 调色板 + 斑纹 ---------------- */

const BASE_PALETTE = {
  '.': null, O: '#3a2a1e', F: '#f5a340', f: '#d9822b', W: '#fff4e6',
  E: '#2b8a3e', P: '#e88aa0', B: '#2b2b2b', G: '#c8e66b',
};

/**
 * pattern 规则：
 *   rect: [x0,y0,x1,y1] 矩形内、字符等于 from 的格子 → to
 *   rows: 指定行（数组）上、字符等于 from 的格子 → to
 *   every: 每 N 行（从 y0 起）→ to
 */
function applyPattern(grid, rules = []) {
  let g = grid.map((r) => r.split(''));
  for (const rule of rules) {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (g[y][x] !== rule.from) continue;
        if (rule.rect) {
          const [x0, y0, x1, y1] = rule.rect;
          if (x < x0 || x > x1 || y < y0 || y > y1) continue;
        }
        if (rule.rows && !rule.rows.includes(y)) continue;
        if (rule.every && rule.from !== undefined) {
          if (rule.rows === undefined && (y - (rule.startY || 0)) % rule.every !== 0) continue;
        }
        g[y][x] = rule.to;
      }
    }
  }
  return g.map((r) => r.join(''));
}

const CATS = [
  {
    id: 'orange', name: '橘猫',
    palette: { O: '#3a2a1e', F: '#f5a340', f: '#d9822b', W: '#fff4e6', E: '#2b8a3e', P: '#e88aa0', B: '#c9761f' },
    pattern: [{ from: 'F', every: 3, startY: 13, rect: [3, 13, 20, 22], to: 'f' }], // 肚子侧浅条纹
  },
  {
    id: 'cow', name: '奶牛猫',
    palette: { O: '#2b2b2b', F: '#f7f7f5', f: '#e0e0da', W: '#ffffff', E: '#4a90d9', P: '#e88aa0', B: '#2b2b2b' },
    pattern: [
      { from: 'F', rect: [5, 5, 12, 8], to: 'B' },    // 头顶黑斑
      { from: 'F', rect: [2, 13, 7, 17], to: 'B' },   // 身侧黑斑
      { from: 'F', rect: [19, 17, 22, 22], to: 'B' }, // 尾巴黑
    ],
  },
  {
    id: 'black', name: '黑猫',
    palette: { O: '#15151a', F: '#3d3d46', f: '#2a2a31', W: '#5a5a66', E: '#c8e66b', P: '#e88aa0', B: '#1b1b21' },
    pattern: [],
  },
  {
    id: 'calico', name: '三花猫',
    palette: { O: '#2b2b2b', F: '#f7f7f5', f: '#e0e0da', W: '#fff4e6', E: '#2b8a3e', P: '#e88aa0', B: '#f5a340' },
    pattern: [
      { from: 'F', rect: [5, 5, 11, 9], to: 'B' },    // 头顶橘斑
      { from: 'F', rect: [14, 12, 18, 16], to: 'B' }, // 身侧橘斑
      { from: 'F', rect: [2, 14, 6, 18], to: 'O' },   // 黑斑
    ],
  },
  {
    id: 'tabby', name: '狸花猫',
    palette: { O: '#3a2a1e', F: '#9a8f7a', f: '#6e6553', W: '#efe7d6', E: '#2b8a3e', P: '#e88aa0', B: '#5c5344' },
    pattern: [{ from: 'F', every: 2, startY: 6, rect: [2, 6, 22, 22], to: 'f' }], // 全身条纹
  },
];

/* ---------------- 动画装配 ---------------- */

function framesOf(list) {
  return list.map(([grid, ms]) => ({ grid, ms }));
}

function buildAnimations(cat) {
  const paint = (g) => applyPattern(g, cat.pattern);

  const sit = paint(SIT);
  const crouch = paint(CROUCH_DOWN);

  return {
    idle: {
      loop: true,
      frames: framesOf([
        [tailShift(sit, 0), 500],
        [tailShift(sit, -1), 380],
        [tailShift(sit, 0), 500],
        [blink(tailShift(sit, 0)), 160],   // 眨眼
      ]),
    },
    sleep: {
      loop: true,
      frames: framesOf([
        [blink(crouch), 900],
        [blink(shift(crouch, 0, 1)), 900],  // 呼吸起伏
      ]),
    },
    work: {
      loop: true,
      frames: framesOf([
        [crouch, 800],
        [shift(crouch, 0, 1), 800],
        [blink(crouch), 200],
      ]),
    },
    happy: {
      loop: false,
      frames: framesOf([
        [shift(sit, 0, -3), 120],
        [shift(sit, 0, -5), 140],
        [shift(sit, 0, -2), 120],
        [sit, 160],
        [shift(sit, 0, -3), 140],
        [sit, 200],
      ]),
    },
    shock: {
      loop: false,
      frames: framesOf([
        [spikes(sit), 120],
        [spikes(shift(sit, 0, -1)), 120],
        [spikes(sit), 160],
        [sit, 200],
      ]),
    },
    annoyed: {
      loop: false,
      frames: framesOf([
        [squint(sit), 700],
        [squint(shift(sit, 0, 1)), 700],
        [sit, 200],
      ]),
    },
    eat: {
      loop: false,
      frames: framesOf([
        [openMouth(sit), 220],
        [shift(sit, 0, 1), 200],
        [openMouth(sit), 220],
        [sit, 200],
      ]),
    },
    // 解锁动作：Lv3 伸懒腰
    stretch: {
      loop: false,
      frames: framesOf([
        [stretchPose(sit), 420],
        [stretchPose(shift(sit, 0, -1)), 420],
        [stretchPose(sit), 320],
        [sit, 240],
      ]),
    },
    // 解锁动作：Lv7 翻肚皮
    belly: {
      loop: true,
      frames: framesOf([
        [paint(shift(LYING, 0, 2)), 900],
        [paint(shift(LYING, 0, 3)), 900],   // 呼吸起伏
      ]),
    },
  };
}

/* ---------------- 输出 ---------------- */

function main() {
  const outDir = path.join(__dirname, '..', 'assets', 'cats');
  fs.mkdirSync(outDir, { recursive: true });

  for (const cat of CATS) {
    const data = {
      id: cat.id,
      name: cat.name,
      size: [W, H],
      palette: { '.': null, ...BASE_PALETTE, ...cat.palette },
      animations: buildAnimations(cat),
    };
    const file = path.join(outDir, `${cat.id}.json`);
    fs.writeFileSync(file, JSON.stringify(data, null, 1), 'utf-8');
    const n = Object.values(data.animations).reduce((a, an) => a + an.frames.length, 0);
    console.log(`generated ${cat.name}(${cat.id}) — 7 states / ${n} frames -> assets/cats/${cat.id}.json`);
  }
}

main();
