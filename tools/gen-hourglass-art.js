/**
 * 从 resources/沙漏花环-*.svg 提取番茄沙漏的矢量几何，生成 src/pet/hourglassArt.js
 *   用法： node tools/gen-hourglass-art.js
 *
 * 两张源图（彩色 / 墨绿单色）的路径数据完全一致，只有配色不同，
 * 所以只存一份几何 + 三套配色（专注 / 休息 / 暂停）。
 * 源 SVG 改动后重跑本脚本即可。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC_NORMAL = path.join(ROOT, 'resources', '沙漏花环-1-森林木语.svg');
const SRC_PAUSE = path.join(ROOT, 'resources', '沙漏花环-4-墨绿单色.svg');
const OUT = path.join(ROOT, 'src', 'pet', 'hourglassArt.js');

/** 整张图（花环 + 沙漏）的包围盒，来自 Electron 里 getBBox 实测 */
const BOUNDS = { x: 828, y: 1444, w: 2547, h: 2430 };

/** 逐条抽出 <path> 的 id / d / transform / style 里的填充色 */
function parse(file) {
  const text = fs.readFileSync(file, 'utf8');
  const list = [];
  let defs = 0;
  for (const m of text.matchAll(/<path\b[^>]*>/g)) {
    const tag = m[0];
    const pick = (re) => {
      const r = tag.match(re);
      return r ? r[1] : '';
    };
    const id = pick(/\sid="([^"]*)"/) || 'defs' + defs++;
    const d = pick(/\sd="([^"]*)"/);
    const tr = pick(/transform="matrix\(([^)]*)\)"/);
    const fill = pick(/style="fill:(#[0-9A-Fa-f]{6})/);
    if (!d) continue;
    list.push({
      id,
      d,
      m: tr ? tr.split(',').map(Number) : null,
      fill,
    });
  }
  return list;
}

const normal = parse(SRC_NORMAL);
const pause = parse(SRC_PAUSE);

const byId = (list) => Object.fromEntries(list.map((p) => [p.id, p]));
const N = byId(normal);
const P = byId(pause);

// ---- 一致性自检：几何必须完全一致，否则就不是「同图换色」了 ----
const shared = normal.map((p) => p.id).filter((id) => id.startsWith('path') || id === 'ring' || id === 'frame');
for (const id of shared) {
  if (!P[id] || P[id].d !== N[id].d) throw new Error(`几何不一致：${id} —— 两张源图的路径数据必须相同`);
  if (JSON.stringify(P[id].m) !== JSON.stringify(N[id].m)) throw new Error(`矩阵不一致：${id}`);
}
if (N.ring.d !== N.frame.d) throw new Error('ring 与 frame 应当是同一条路径');

/**
 * 静态装饰层：花环叶片 / 浆果 / 闪光。
 * ⚠️ 丢掉 path14 —— 那是原图画好的静态沙，沙量要由进度驱动，我们用自己画的动态沙。
 */
const deco = ['path2', 'path3', 'path4', 'path5', 'path6', 'path7', 'path8', 'path9',
  'path10', 'path11', 'path12', 'path13', 'path15', 'path16', 'path17']
  .map((id) => {
    const n = N[id];
    return {
      id,
      d: n.d,
      m: n.m,
      c: [n.fill, P[id].fill],   // [彩色, 墨绿]
    };
  });

if (N.path14 === undefined) throw new Error('没找到 path14（原图的静态沙），源文件结构变了吗？');

const art = {
  bounds: BOUNDS,
  glass: N.defs0.d,                          // 沙漏外轮廓（原 clipPath#hgClip）
  art: N.ring.d,                             // 花环 + 沙漏外壳共用一条路径（原 ring / frame）
  artMatrix: N.ring.m,
  deco,
  palette: {
    // 专注：木框 + 彩色花环，沙是金色
    work: { wreath: N.ring.fill, shell: N.frame.fill, sand: N.path14.fill },
    // 休息：沙漏本体不动，只把沙换成湖蓝（比原版 #4a90d9 更清透，贴平涂插画的调子）
    break: { wreath: N.ring.fill, shell: N.frame.fill, sand: '#30ADCB' },
    // 暂停：整只换成墨绿单色版（对应 resources/沙漏花环-4-墨绿单色.svg）
    pause: { wreath: P.ring.fill, shell: P.frame.fill, sand: P.path14.fill },
  },
};

const out = `/**
 * 番茄沙漏矢量几何 —— 由 tools/gen-hourglass-art.js 从 resources/沙漏花环-*.svg 提取生成，请勿手改
 *
 * 坐标系：全部落在 4096×5476 的原始画布里，每条路径自带 matrix。
 *   glass     沙漏外轮廓（原 clipPath#hgClip）。它同时是「沙漏区域」的定义：
 *             ⚠️ art 这一条路径把花环和沙漏外壳画在一起，所以：
 *                · 画花环 = 填 art + 挖掉 glass
 *                · 画外壳 = 裁到 glass + 填 art（腔体在 art 里本来就是镂空，沙正好透出来）
 *   art       花环 + 沙漏外壳共用的路径（原 ring / frame，两者数据完全相同）
 *   deco      散装的叶片 / 浆果 / 闪光，直接压在最上层。
 *             ⚠️ 原 path14 是画好的静态沙，已被丢弃 —— 沙量由番茄进度驱动，用我们自己的动态沙。
 *   palette   三套配色：work 彩色 / break 彩色但沙换成蓝 / pause 墨绿单色
 */
window.MGW_HG_ART = ${JSON.stringify(art)};
`;

fs.writeFileSync(OUT, out, 'utf8');
console.log(`wrote ${path.relative(ROOT, OUT)}  ${(out.length / 1024).toFixed(1)} KB`);
console.log(`  glass ${art.glass.length} / art ${art.art.length} / deco ${deco.length} 条`);
console.log('  palette:', JSON.stringify(art.palette));
