/**
 * 鱼干突袭 · 纯逻辑自测（node tools/fish-selftest.js，不需要 electron）
 * 校验：出怪权重 / 存留时长 / combo 倍率 / 炸弹惩罚 / 金币结算 / 评价分档 / 落盘 patch
 * 另含「初版 vs 现在」的密度与收益对比（老大要求：目标更密，但单局收益更低）
 */
const path = require('path');

const config = require(path.join(__dirname, '..', 'src', 'shared', 'config.js'));
const G = require(path.join(__dirname, '..', 'src', 'shared', 'games', 'fish.js'));

const cfg = config.fish;

let fails = 0;
function check(name, ok, extra) {
  const tag = ok ? 'ok  ' : 'FAIL';
  if (!ok) fails++;
  console.log(`${tag} ${name}${extra != null ? '  → ' + extra : ''}`);
}
function near(a, b, tol) { return Math.abs(a - b) <= tol; }

console.log('--- 1. 数值是否落进 config ---');
check('限时 20s', cfg.durationSec === 20, cfg.durationSec + 's');
check('结算系数 0.10', cfg.coinsPerScore === 0.10, cfg.coinsPerScore);
check('鱼干停留 1.5s', cfg.targets.fish.aliveMs === 1500, cfg.targets.fish.aliveMs + 'ms');
check('金鱼停留 0.8s', cfg.targets.gold.aliveMs === 800, cfg.targets.gold.aliveMs + 'ms');
check('炸弹停留 2s', cfg.targets.bomb.aliveMs === 2000, cfg.targets.bomb.aliveMs + 'ms');
check('分值 8 / 20 / -12', cfg.targets.fish.score === 8 && cfg.targets.gold.score === 20 && cfg.targets.bomb.score === -12);
check('权重合计 = 1', near(cfg.targets.fish.weight + cfg.targets.gold.weight + cfg.targets.bomb.weight, 1, 1e-9));
check('出怪间隔比初版更密', cfg.spawn.minMs < 380 && cfg.spawn.maxMs < 620, `${cfg.spawn.minMs}~${cfg.spawn.maxMs}ms`);

console.log('\n--- 2. 出怪概率（20 万次）---');
const N = 200000;
const cnt = { fish: 0, gold: 0, bomb: 0 };
for (let i = 0; i < N; i++) cnt[G.rollType(Math.random(), cfg.targets)]++;
const pFish = cnt.fish / N, pGold = cnt.gold / N, pBomb = cnt.bomb / N;
check('鱼干 ≈ 70%', near(pFish, 0.70, 0.01), (pFish * 100).toFixed(2) + '%');
check('金鱼 ≈ 15%', near(pGold, 0.15, 0.01), (pGold * 100).toFixed(2) + '%');
check('炸弹 ≈ 15%', near(pBomb, 0.15, 0.01), (pBomb * 100).toFixed(2) + '%');
check('边界 r=0 → 第一个类型', G.rollType(0, cfg.targets) === 'fish');
check('边界 r=0.999999 → 落在最后一个类型', G.rollType(0.999999, cfg.targets) === 'bomb');

console.log('\n--- 3. 存留时长 / 出怪节奏 / 落点 ---');
check('aliveMsOf 取值正确',
  G.aliveMsOf('fish', cfg) === 1500 && G.aliveMsOf('gold', cfg) === 800 && G.aliveMsOf('bomb', cfg) === 2000);
let gapOk = true, gapMin = Infinity, gapMax = -Infinity;
for (let i = 0; i <= 1000; i++) {
  const g = G.spawnGap(i / 1000, cfg);
  gapMin = Math.min(gapMin, g); gapMax = Math.max(gapMax, g);
  if (g < cfg.spawn.minMs || g > cfg.spawn.maxMs) gapOk = false;
}
check('出怪间隔落在配置区间内', gapOk, `实测 ${gapMin}~${gapMax}ms`);
const spot = G.randomSpot(0, 1, {});
check('落点边距 7%~93%', spot.x === 7 && spot.y === 93, `${spot.x}% / ${spot.y}%`);

console.log('\n--- 4. combo 倍率阶梯与上限 ---');
const steps = [[0, 1], [4, 1], [5, 1.25], [9, 1.25], [10, 1.5], [14, 1.5], [19, 1.75], [20, 2], [999, 2]];
for (const [combo, want] of steps) {
  const got = G.multiplierOf(combo, cfg);
  check(`combo ${combo} → ×${want}`, got === want, '×' + got);
}

console.log('\n--- 5. 命中结算 ---');
const st = G.newState();
const seq = [];
for (let i = 0; i < 6; i++) seq.push(G.hit(st, 'fish', cfg).delta);
check('前 5 连 ×1 → 每次 +8', seq.slice(0, 5).every((d) => d === 8), seq.slice(0, 5).join(','));
check('第 6 连（combo=5）→ +10', seq[5] === 10, '+' + seq[5]);
check('累计得分 40 + 10 = 50', st.score === 50, st.score);
check('combo = 6 / bestCombo = 6', st.combo === 6 && st.bestCombo === 6, `${st.combo} / ${st.bestCombo}`);
check('hits 计数 = 6', st.hits === 6, st.hits);

console.log('\n--- 6. 炸弹惩罚 ---');
const st2 = G.newState();
for (let i = 0; i < 8; i++) G.hit(st2, 'gold', cfg);
const beforeScore = st2.score, beforeCombo = st2.combo;
const bombRes = G.hit(st2, 'bomb', cfg);
check('炸弹 delta = -12（不吃倍率）', bombRes.delta === -12, bombRes.delta);
check('combo 清零', st2.combo === 0);
check('保留最高连击记录', st2.bestCombo === beforeCombo, `${st2.bestCombo} / ${beforeCombo}`);
check('得分下降 12', st2.score === beforeScore - 12, `${beforeScore} → ${st2.score}`);
check('炸弹计数 + 断连计数', st2.bombs === 1 && st2.breaks === 1);
const st3 = G.newState();
for (let i = 0; i < 30; i++) G.hit(st3, 'gold', cfg);
const b2 = G.hit(st3, 'bomb', cfg);
check('combo 拉满后炸弹仍固定 -12', b2.delta === -12, b2.delta);
check('倍率字段对炸弹恒为 1', b2.mult === 1 && b2.bomb === true);

console.log('\n--- 7. 超时消失不算失误 ---');
const st4 = G.newState();
for (let i = 0; i < 5; i++) G.hit(st4, 'fish', cfg);
G.expire(st4); G.expire(st4);
check('combo 不受超时影响', st4.combo === 5, st4.combo);
check('expired 计数 = 2', st4.expired === 2);

console.log('\n--- 8. 局末结算（金币 = floor(得分 × 0.10)）---');
const cases = [[200, 20], [199, 19], [40, 4], [12, 1], [0, 0], [-30, 0], [-12, 0]];
for (const [score, want] of cases) {
  const r = G.settle(score, cfg);
  check(`得分 ${score} → ${want} 金币`, r.earned === want, r.earned);
}
check('负分不倒扣（不会被扣币）', G.settle(-999, cfg).earned === 0);

console.log('\n--- 9. 评价分档（猫猫夸夸 / 吐槽）---');
check('破纪录优先 → best', G.reactFor(120, cfg, { newBest: true }) === 'best');
check('高分 → praise', G.reactFor(400, cfg) === 'praise');
check('边界 praise(300) → praise', G.reactFor(300, cfg) === 'praise');
check('边界 praise-1 → ok', G.reactFor(299, cfg) === 'ok');
check('边界 ok(140) → ok', G.reactFor(140, cfg) === 'ok');
check('低分 → roast', G.reactFor(139, cfg) === 'roast');
check('0 分 → roast', G.reactFor(0, cfg) === 'roast');

console.log('\n--- 10. 落盘 patch（覆盖语义 → 传绝对值）---');
const saveA = { coins: 100, stats: { bestGameScore: 150 } };
const pa = G.settlePatch(saveA, 200, cfg);
check('金币累加 100 + 20 = 120', pa.coins === 120, pa.coins);
check('最高分刷新 150 → 200', pa.stats.bestGameScore === 200);
check('newBest = true', pa.newBest === true);
check('newBest → react=best', pa.react === 'best', pa.react);
const pb = G.settlePatch(saveA, 100, cfg);
check('低分不覆盖最高分（仍 150）', pb.stats.bestGameScore === 150);
check('低分 newBest = false', pb.newBest === false);
check('低分金币 100 + 10 = 110', pb.coins === 110, pb.coins);
const pc = G.settlePatch({ coins: 10, stats: { bestGameScore: 0 } }, -50, cfg);
check('负分：金币不变、最高分不变', pc.coins === 10 && pc.stats.bestGameScore === 0);
check('负分不会判成破纪录', pc.newBest === false && pc.react === 'roast', pc.react);

/* ---------------- 11. 密度 & 收益：初版 vs 现在 ---------------- */

const OLD = {
  durationSec: 20,
  targets: {
    fish: { score: 10, weight: 0.70, aliveMs: 1500 },
    gold: { score: 30, weight: 0.15, aliveMs: 800 },
    bomb: { score: -15, weight: 0.15, aliveMs: 2000 },
  },
  spawn: { minMs: 380, maxMs: 620 },
  combo: { step: 5, addPerStep: 0.25, maxMult: 2 },
  coinsPerScore: 0.25,
};

/** 固定种子的整局模拟：返回 { spawned, score, coins, react }
 *  玩家模型：命中率 金鱼 90% / 鱼干 85% / 手滑点炸弹 10%，
 *  但受「手速上限」约束（每秒最多 2.2 次点击）——否则会高估真人收益 */
function simulate(c, seed = 42) {
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const st = G.newState();
  let t = 0, spawned = 0, budget = Math.floor(2.2 * c.durationSec);
  while (t < c.durationSec * 1000) {
    t += G.spawnGap(rnd(), c);
    if (t >= c.durationSec * 1000) break;
    spawned++;
    const type = G.rollType(rnd(), c.targets);
    const wantClick = type === 'gold' ? rnd() < 0.9 : type === 'fish' ? rnd() < 0.85 : rnd() < 0.1;
    if (wantClick && budget > 0) { budget--; G.hit(st, type, c); }
  }
  const patch = G.settlePatch({ coins: 0, stats: { bestGameScore: 700 } }, st.score, c);
  return { spawned, score: st.score, coins: patch.earned, react: patch.react, combo: st.bestCombo };
}

console.log('\n--- 11. 初版 vs 现在（同一玩家、同一种子）---');
const sims = [];
for (let s = 1; s <= 5; s++) sims.push({ old: simulate(OLD, s * 977), now: simulate(cfg, s * 977) });
const avg = (arr, k) => Math.round(arr.reduce((a, b) => a + b[k], 0) / arr.length);
const oldAvg = { spawned: avg(sims.map((x) => x.old), 'spawned'), coins: avg(sims.map((x) => x.old), 'coins'), score: avg(sims.map((x) => x.old), 'score') };
const newAvg = { spawned: avg(sims.map((x) => x.now), 'spawned'), coins: avg(sims.map((x) => x.now), 'coins'), score: avg(sims.map((x) => x.now), 'score') };
console.log(`   初版：出怪 ${oldAvg.spawned} 个 / 得分 ${oldAvg.score} / 金币 ${oldAvg.coins}`);
console.log(`   现在：出怪 ${newAvg.spawned} 个 / 得分 ${newAvg.score} / 金币 ${newAvg.coins}`);
check('目标更频繁（出怪数增加 ≥30%）', newAvg.spawned >= oldAvg.spawned * 1.3, `${oldAvg.spawned} → ${newAvg.spawned}`);
check('单局总收益更低', newAvg.coins < oldAvg.coins, `${oldAvg.coins} → ${newAvg.coins} 金币`);
check('单局收益不至于归零（≥8 金币）', newAvg.coins >= 8, newAvg.coins + ' 金币');
check('整局数值均有限', sims.every((x) => Number.isFinite(x.now.score) && Number.isFinite(x.now.coins)));
console.log(`   现在 5 局评价：${sims.map((x) => x.now.react).join(' / ')}`);

console.log(`\n${fails === 0 ? 'ALL PASS' : fails + ' FAILED'}`);
process.exit(fails === 0 ? 0 : 1);
