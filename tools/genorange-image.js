/**
 * 用生图坐姿网格覆盖 orange.json（生图版橘猫试看效果）
 * 用法：node tools/genorange-image.js
 * 说明：坐姿来自 ImageGen 生图 → k-means 提取调色板 → 24×24 网格；动画用 gencat 的变换派生
 */
const fs = require('fs');
const path = require('path');

const W = 24, H = 24;

// 生图提取的调色板（k-means 语义映射）
const PALETTE = { '.': null, O: '#251b10', B: '#483014', F: '#e79136', f: '#d17a36', W: '#f1eee6', E: '#4a792d', P: '#e88aa0' };

// 生图坐姿（k-means 输出，鼻子/阴影误判 E 已手动改 B）
const SIT = [
  '...WBfBO........OBfBO...',
  '....BffBBBBBBBBBBfffO...',
  '....BBBFfBffffBfFBBfO...',
  '....BBBfFffffffFfBBfO...',
  '...WBffFFffffffFFffBO...',
  '....BfFFFFffffFFFFfB....',
  '...WBfFFffFFfFffFFfBO...',
  '....BFFfEEfFFfEEfFFBO...',
  '....BfFEEEEFFEEEEffBO...',
  '....BfFfEEfFFfEEfFfBO...',
  '...WBfFFffEEEEffFFfBB...',
  '....BffFFEWWWWEFFffB....',
  '.....BfffFfBBfFfffB.....',
  '.....BBffffBBffffBB.....',
  '.....BffffBBBBffffB.....',
  '.....BfFFffFFffFFfB.....',
  '....BfffFFffffFFfffB....',
  '....BfFfffffffFffFfB....',
  '....BfFFBffffffffFfBO...',
  '....BfFfffBfffFfFffBO...',
  '....BfFffffBBBBfffFfO...',
  '....BfFFffFffffffFfBB...',
  '....BBfFFfffffffffBB....',
  '.....BBBBBBBBBBBBBB.....',
];

/* ---------------- 变换函数（自 gencat.js 复制） ---------------- */

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
function replaceAll(grid, from, to) { return grid.map((r) => r.split(from).join(to)); }
function shift(grid, dx, dy) {
  const out = blank();
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const ch = grid[y][x];
    if (ch === '.') continue;
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
    out[ny] = out[ny].substring(0, nx) + ch + out[ny].substring(nx + 1);
  }
  return out;
}
const TAIL_X = 19;
function tailShift(grid, dy) {
  const out = grid.map((r) => r.split(''));
  const px = [];
  for (let y = 0; y < H; y++) for (let x = TAIL_X; x < W; x++) {
    if (grid[y][x] !== '.') { px.push([x, y, grid[y][x]]); out[y][x] = '.'; }
  }
  for (const [x, y, ch] of px) { const ny = y + dy; if (ny >= 0 && ny < H) out[ny][x] = ch; }
  return out.map((r) => r.join(''));
}
function spikes(grid) {
  const out = grid.map((r) => r.split(''));
  for (let y = 1; y < H; y++) for (let x = 0; x < W; x++) {
    const ch = grid[y][x];
    if (ch === '.') continue;
    if (grid[y - 1][x] === '.' && (x * 5 + y * 3) % 3 === 0) out[y - 1][x] = 'O';
    if (x > 0 && grid[y][x - 1] === '.' && (x * 3 + y * 7) % 4 === 0) out[y][x - 1] = 'O';
    if (x < W - 1 && grid[y][x + 1] === '.' && (x * 7 + y * 5) % 4 === 0) out[y][x + 1] = 'O';
  }
  return out.map((r) => r.join(''));
}
function openMouth(grid) {
  let g = grid.slice();
  for (let y = 11; y <= 13; y++) for (let x = 10; x <= 12; x++) {
    if (g[y][x] === 'F' || g[y][x] === 'W' || g[y][x] === 'f') g = setChar(g, x, y, 'O');
  }
  return g;
}
function shiftRows(rows, dx, dy) {
  const out = Array(rows.length).fill('.'.repeat(W));
  for (let y = 0; y < rows.length; y++) for (let x = 0; x < W; x++) {
    const ch = rows[y][x];
    if (ch === '.') continue;
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || nx >= W || ny < 0 || ny >= rows.length) continue;
    out[ny] = out[ny].substring(0, nx) + ch + out[ny].substring(nx + 1);
  }
  return out;
}
function stretchPose(grid) {
  const head = shiftRows(grid.slice(0, 13), 0, -1);
  if (head[12] === '.'.repeat(W)) head[12] = grid[12];
  return [...head, ...grid.slice(13, 23), row('')];
}
const blink = (g) => replaceAll(g, 'E', 'O');

// 翻肚皮：手画躺姿（生图无此姿势，沿用 gencat 的 LYING，配色已适配生图调色板）
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

function framesOf(list) { return list.map(([grid, ms]) => ({ grid, ms })); }

function buildAnimations() {
  return {
    idle: {
      loop: true,
      frames: framesOf([
        [tailShift(SIT, 0), 500],
        [tailShift(SIT, -1), 380],
        [tailShift(SIT, 0), 500],
        [blink(tailShift(SIT, 0)), 160],
      ]),
    },
    sleep: {
      loop: true,
      frames: framesOf([
        [blink(SIT), 900],
        [blink(shift(SIT, 0, 1)), 900],
      ]),
    },
    work: {
      loop: true,
      frames: framesOf([
        [SIT, 800],
        [shift(SIT, 0, 1), 800],
        [blink(SIT), 200],
      ]),
    },
    happy: {
      loop: false,
      frames: framesOf([
        [shift(SIT, 0, -3), 120],
        [shift(SIT, 0, -5), 140],
        [shift(SIT, 0, -2), 120],
        [SIT, 160],
        [shift(SIT, 0, -3), 140],
        [SIT, 200],
      ]),
    },
    shock: {
      loop: false,
      frames: framesOf([
        [spikes(SIT), 120],
        [spikes(shift(SIT, 0, -1)), 120],
        [spikes(SIT), 160],
        [SIT, 200],
      ]),
    },
    annoyed: {
      loop: false,
      frames: framesOf([
        [blink(SIT), 700],
        [blink(shift(SIT, 0, 1)), 700],
        [SIT, 200],
      ]),
    },
    eat: {
      loop: false,
      frames: framesOf([
        [openMouth(SIT), 220],
        [shift(SIT, 0, 1), 200],
        [openMouth(SIT), 220],
        [SIT, 200],
      ]),
    },
    stretch: {
      loop: false,
      frames: framesOf([
        [stretchPose(SIT), 420],
        [stretchPose(shift(SIT, 0, -1)), 420],
        [stretchPose(SIT), 320],
        [SIT, 240],
      ]),
    },
    belly: {
      loop: true,
      frames: framesOf([
        [shift(LYING, 0, 2), 900],
        [shift(LYING, 0, 3), 900],
      ]),
    },
  };
}

function main() {
  const data = {
    id: 'orange',
    name: '橘猫',
    size: [W, H],
    palette: PALETTE,
    animations: buildAnimations(),
  };
  const out = path.join(__dirname, '..', 'assets', 'cats', 'orange.json');
  fs.writeFileSync(out, JSON.stringify(data, null, 1), 'utf-8');
  const n = Object.values(data.animations).reduce((a, an) => a + an.frames.length, 0);
  console.log(`generated image-based orange.json — ${Object.keys(data.animations).length} states / ${n} frames -> ${out}`);
}

main();
