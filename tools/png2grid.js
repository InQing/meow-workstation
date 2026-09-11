/**
 * 生图 PNG → 24×24 字符网格（开发期工具）
 * v2：k-means 自动提取生图真实调色板 → 语义映射，替代 v1 的固定最近邻（生图偏暗会碎）
 * 用法：node tools/png2grid.js [图片路径]
 */
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const SRC = process.argv[2] ||
  path.join(__dirname, '..', 'assets', 'ref', 'A_cute_orange_tabby_cat_sittin_2026-09-10T02-26-02.png');
const W = 24, H = 24;

const png = PNG.sync.read(fs.readFileSync(SRC));
const { width, height, data } = png;

const px = (x, y) => {
  const i = (y * width + x) << 2;
  return [data[i], data[i + 1], data[i + 2]];
};

// ---- 背景 = 连通边缘的接近纯白 ----
const isBg = (r, g, b) => r >= 238 && g >= 238 && b >= 238;
const bg = new Uint8Array(width * height);
const stack = [];
for (let x = 0; x < width; x++) { stack.push(x, (height - 1) * width + x); }
for (let y = 0; y < height; y++) { stack.push(y * width, y * width + width - 1); }
while (stack.length) {
  const idx = stack.pop();
  if (bg[idx]) continue;
  const x = idx % width, y = (idx / width) | 0;
  const [r, g, b] = px(x, y);
  if (!isBg(r, g, b)) continue;
  bg[idx] = 1;
  if (x > 0) stack.push(idx - 1);
  if (x < width - 1) stack.push(idx + 1);
  if (y > 0) stack.push(idx - width);
  if (y < height - 1) stack.push(idx + width);
}

// ---- 猫包围盒 ----
let minX = width, minY = height, maxX = 0, maxY = 0;
for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
  if (!bg[y * width + x]) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
}
const bw = maxX - minX + 1, bh = maxY - minY + 1;
console.log(`bbox ${bw}×${bh}`);

// ---- 收集非背景像素（抽样加速 k-means）----
const colors = [];
for (let y = minY; y <= maxY; y += 2) for (let x = minX; x <= maxX; x += 2) {
  if (!bg[y * width + x]) colors.push(px(x, y));
}

// ---- k-means 聚类 ----
function lum(c) { return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]; }
function kmeans(cs, k, iters = 12) {
  const sorted = cs.slice().sort((a, b) => lum(a) - lum(b));
  let centers = [];
  for (let i = 0; i < k; i++) centers.push(sorted[Math.floor((i * (sorted.length - 1)) / (k - 1))].slice());
  for (let it = 0; it < iters; it++) {
    const sums = centers.map(() => [0, 0, 0, 0]);
    for (const c of cs) {
      let bi = 0, bd = Infinity;
      for (let i = 0; i < k; i++) {
        const d = (c[0] - centers[i][0]) ** 2 + (c[1] - centers[i][1]) ** 2 + (c[2] - centers[i][2]) ** 2;
        if (d < bd) { bd = d; bi = i; }
      }
      sums[bi][0] += c[0]; sums[bi][1] += c[1]; sums[bi][2] += c[2]; sums[bi][3]++;
    }
    for (let i = 0; i < k; i++) {
      if (sums[i][3] > 0) centers[i] = [sums[i][0] / sums[i][3], sums[i][1] / sums[i][3], sums[i][2] / sums[i][3]];
    }
  }
  const counts = new Array(k).fill(0);
  for (const c of cs) {
    let bi = 0, bd = Infinity;
    for (let i = 0; i < k; i++) {
      const d = (c[0] - centers[i][0]) ** 2 + (c[1] - centers[i][1]) ** 2 + (c[2] - centers[i][2]) ** 2;
      if (d < bd) { bd = d; bi = i; }
    }
    counts[bi]++;
  }
  return centers.map((c, i) => ({ rgb: c.map(Math.round), count: counts[i] }));
}

const clusters = kmeans(colors, 8).sort((a, b) => b.count - a.count);
console.log('--- clusters (by freq desc) ---');
clusters.forEach((c, i) => {
  const [r, g, b] = c.rgb;
  const hex = '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
  console.log(`  #${i} ${hex} freq${c.count} lum${lum(c.rgb).toFixed(0)}`);
});

// ---- 语义分类 ----
function classify(cl) {
  return cl.map((c) => {
    const [r, g, b] = c.rgb;
    const L = lum(c.rgb);
    let tag = null;
    if (g > r * 1.08 && g > b * 1.05) tag = 'E';                 // 绿眼（含虹膜黄绿高光）
    else if (r > 150 && r > g * 1.15 && b > g * 1.1) tag = 'P';   // 粉腮红/鼻
    else if (L > 220) tag = 'W';                                  // 奶油白
    return { ...c, tag, L };
  });
}
const tagged = classify(clusters);
const rest = tagged.filter((t) => !t.tag).sort((a, b) => a.L - b.L);
// 剩余（橘棕系）：最暗→O 轮廓，次暗→B 深阴影，其余亮→暗 F/f
if (rest.length) rest[0].tag = 'O';
if (rest.length > 1) rest[1].tag = 'B';
const mid = rest.slice(2).sort((a, b) => b.L - a.L);
mid.forEach((t, i) => { t.tag = i === 0 ? 'F' : 'f'; });

const colorMap = {}; // 聚类 rgb 字符串 -> 字符
const palette = { '.': null };
for (const t of tagged) {
  const key = t.rgb.join(',');
  colorMap[key] = t.tag;
  palette[t.tag] = '#' + t.rgb.map((v) => v.toString(16).padStart(2, '0')).join('');
}
console.log('--- char mapping ---', JSON.stringify(palette));

function nearestTag(r, g, b) {
  let best = '.', bd = Infinity;
  for (const t of tagged) {
    const d = (r - t.rgb[0]) ** 2 + (g - t.rgb[1]) ** 2 + (b - t.rgb[2]) ** 2;
    if (d < bd) { bd = d; best = t.tag; }
  }
  return best;
}

// ---- 缩放进 24×24（底部对齐、水平居中）----
const scale = Math.min(W / bw, H / bh);
const cw = bw * scale, ch = bh * scale;
const ox = (W - cw) / 2, oy = H - ch;

const grid = [];
for (let ty = 0; ty < H; ty++) {
  let rowStr = '';
  for (let tx = 0; tx < W; tx++) {
    const sx0 = minX + (tx - ox) / scale;
    const sy0 = minY + (ty - oy) / scale;
    const sx1 = sx0 + 1 / scale;
    const sy1 = sy0 + 1 / scale;
    let r = 0, g = 0, b = 0, n = 0;
    for (let y = Math.max(0, Math.floor(sy0)); y <= Math.min(height - 1, Math.floor(sy1)); y++) {
      for (let x = Math.max(0, Math.floor(sx0)); x <= Math.min(width - 1, Math.floor(sx1)); x++) {
        const cx = x + 0.5, cy = y + 0.5;
        if (cx < sx0 || cx > sx1 || cy < sy0 || cy > sy1) continue;
        if (bg[y * width + x]) continue;
        const [pr, pg, pb] = px(x, y);
        r += pr; g += pg; b += pb; n++;
      }
    }
    rowStr += n > 0 ? nearestTag(r / n, g / n, b / n) : '.';
  }
  grid.push(rowStr);
}

console.log('\n--- 24x24 grid preview ---');
console.log(grid.join('\n'));
console.log('\n--- pasteable SIT const ---');
console.log('const SIT_GEN = [');
grid.forEach((r) => console.log(`  '${r}',`));
console.log('];');
console.log('\n--- palette (for orange.json) ---');
console.log(JSON.stringify(palette, null, 0));
