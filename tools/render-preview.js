/**
 * 预览脚本：把某只猫的某状态渲染成放大 PNG（白底，方便看效果）
 * 用法：node tools/render-preview.js <catId> [state] [frameIndex] [scale]
 * 例：  node tools/render-preview.js orange idle 0 16
 */
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const catId = process.argv[2] || 'orange';
const state = process.argv[3] || 'idle';
const frameIdx = parseInt(process.argv[4] || '0', 10);
const S = parseInt(process.argv[5] || '16', 10);

const cat = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'assets', 'cats', catId + '.json'), 'utf8'));
const anim = cat.animations[state];
if (!anim) { console.error('no such state:', state); process.exit(1); }
const frame = anim.frames[frameIdx];
if (!frame) { console.error('no such frame:', frameIdx); process.exit(1); }
const grid = frame.grid;
const pal = cat.palette;

const size = 24 * S;
const png = new PNG({ width: size, height: size });
function hex(c) {
  if (!c) return [255, 255, 255, 255]; // 透明 → 白底
  return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16), 255];
}
for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++) {
  const [r, g, b, a] = hex(pal[grid[y][x]]);
  for (let dy = 0; dy < S; dy++) for (let dx = 0; dx < S; dx++) {
    const i = ((y * S + dy) * size + (x * S + dx)) * 4;
    png.data[i] = r; png.data[i + 1] = g; png.data[i + 2] = b; png.data[i + 3] = a;
  }
}
const out = path.join(__dirname, '..', 'assets', 'ref', `${catId}-${state}-${frameIdx}.png`);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, PNG.sync.write(png));
console.log('rendered ->', out);
