/**
 * 抽卡逻辑自测（node 直接跑，无需 electron）
 *   node tools/gacha-selftest.js
 *
 * 验证：概率分布 / 50 抽保底 / 重复卡转金币 / 资源与解锁校验 / patch 累计正确性
 * 输出全部英文（Windows 终端 GBK 解码，中文会乱码）。
 */
const path = require('path');
const ROOT = path.join(__dirname, '..');

const config = require(path.join(ROOT, 'src/shared/config.js'));
const Gacha = require(path.join(ROOT, 'src/shared/gacha.js'));
const cardFile = require(path.join(ROOT, 'assets/cards.json'));
const CARDS = cardFile.cards;

let failures = 0;
function check(name, cond, detail) {
  const tag = cond ? 'PASS' : 'FAIL';
  if (!cond) failures++;
  console.log(`[${tag}] ${name}${detail ? ' -- ' + detail : ''}`);
}

/** 可复现的种子随机（mulberry32） */
function seeded(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function emptySave(over) {
  return Object.assign({
    coins: 100000, tickets: 100000, cards: {}, pity: 0, affection: 0,
    stats: { draws: 0, bestGameScore: 0 },
  }, over || {});
}

console.log('=== card pool ===');
const byRarity = {};
for (const c of CARDS) byRarity[c.rarity] = (byRarity[c.rarity] || 0) + 1;
console.log('total:', CARDS.length, ' N:', byRarity.N, ' R:', byRarity.R, ' SR:', byRarity.SR, ' SSR:', byRarity.SSR);
check('17 cards total', CARDS.length === 17, 'got ' + CARDS.length);
check('N x6', byRarity.N === 6);
check('R x5', byRarity.R === 5);
check('SR x4', byRarity.SR === 4);
check('SSR x2', byRarity.SSR === 2);
check('unique ids', new Set(CARDS.map((c) => c.id)).size === CARDS.length);
check('every card has bg+desc', CARDS.every((c) => c.bg && c.desc && c.name));

console.log('\n=== rarity distribution (normal pool, 200k rolls, no pity) ===');
{
  const rng = seeded(12345);
  const N = 200000;
  const hit = { N: 0, R: 0, SR: 0, SSR: 0 };
  for (let i = 0; i < N; i++) hit[Gacha.rollRarity(config.gacha.normal.rates, rng)]++;
  const rates = config.gacha.normal.rates;
  for (const r of Gacha.RARITIES) {
    const got = hit[r] / N;
    const dev = Math.abs(got - rates[r]) / rates[r];
    check(`rate ${r} ~= ${(rates[r] * 100).toFixed(1)}%`,
      dev < 0.06,
      `got ${(got * 100).toFixed(2)}% (dev ${(dev * 100).toFixed(1)}%)`);
  }
}

console.log('\n=== pity: SSR within every 50 draws (300k draws) ===');
{
  const rng = seeded(999);
  const save = emptySave({ cards: {}, coins: 1e12 }); // 金币管够，本段只测保底
  let sinceSSR = 0, maxGap = 0, ssrCount = 0;
  const N = 300000;
  for (let i = 0; i < N; i++) {
    const r = Gacha.compute({ cardList: CARDS, save, config, pool: 'normal', payWith: 'coins', rng });
    if (!r.ok) { check('draw ok', false, r.reason); break; }
    Object.assign(save, {
      coins: r.patch.coins, pity: r.patch.pity,
      cards: Object.assign({}, save.cards, r.patch.cards),
      stats: r.patch.stats,
    });
    sinceSSR++;
    if (r.rarity === 'SSR') {
      maxGap = Math.max(maxGap, sinceSSR);
      sinceSSR = 0;
      ssrCount++;
      if (r.pityAfter !== 0) check('pity reset on SSR', false, 'pityAfter=' + r.pityAfter);
    }
  }
  check('max SSR gap <= pityLimit', maxGap <= config.gacha.pityLimit, 'maxGap=' + maxGap);
  check('SSR count positive', ssrCount > 0, 'ssr=' + ssrCount);
  check('pity counter in range', save.pity >= 0 && save.pity < config.gacha.pityLimit, 'pity=' + save.pity);
}

console.log('\n=== forced SSR on the 50th draw ===');
{
  const save = emptySave({ pity: config.gacha.pityLimit - 1 });
  const r = Gacha.compute({ cardList: CARDS, save, config, pool: 'normal', payWith: 'coins', rng: seeded(1) });
  check('50th draw is SSR', r.rarity === 'SSR' && r.forced === true, 'rarity=' + r.rarity);
  check('pity reset to 0', r.patch.pity === 0);
}

console.log('\n=== duplicate -> coins ===');
{
  // 先把每张卡都塞一张进存档，则之后每抽必是重复
  const allOwned = {};
  for (const c of CARDS) allOwned[c.id] = 1;
  const save = emptySave({ cards: allOwned, coins: 10, tickets: 10, pity: 0 });
  const r = Gacha.compute({ cardList: CARDS, save, config, pool: 'normal', payWith: 'tickets', rng: seeded(7) });
  const expect = 10 - config.gacha.normal.costTickets * 0 + config.gacha.dupToCoins[r.rarity];
  check('duplicate detected', r.dup === true);
  check('coins = spent 0 (ticket pay) + dup value', r.patch.coins === expect, `got ${r.patch.coins} expect ${expect} (${r.rarity})`);
  check('ticket consumed', r.patch.tickets === 9);
  check('card count incremented', r.patch.cards[r.card.id] === 2);
}

console.log('\n=== guards ===');
{
  const poor = emptySave({ coins: 0, tickets: 0 });
  check('no tickets -> reason', Gacha.compute({ cardList: CARDS, save: poor, config, pool: 'normal', payWith: 'tickets' }).reason === 'no_tickets');
  check('no coins -> reason', Gacha.compute({ cardList: CARDS, save: poor, config, pool: 'normal', payWith: 'coins' }).reason === 'no_coins');
  const lowLv = emptySave({ affection: 0 });
  const lk = Gacha.compute({ cardList: CARDS, save: lowLv, config, pool: 'premium', payWith: 'coins' });
  check('premium locked below Lv5', lk.ok === false && lk.reason === 'locked', 'needLevel=' + lk.needLevel);
  const hiLv = emptySave({ affection: config.affectionLevels[4] });
  check('premium unlocked at Lv5', Gacha.compute({ cardList: CARDS, save: hiLv, config, pool: 'premium', payWith: 'coins', rng: seeded(3) }).ok === true);
  check('premium rejects tickets', Gacha.compute({ cardList: CARDS, save: hiLv, config, pool: 'premium', payWith: 'tickets' }).reason === 'bad_pay');
}

console.log('\n=== stats.draws accumulates (patch semantics) ===');
{
  const save = emptySave({ stats: { draws: 41, bestGameScore: 88 } });
  const r = Gacha.compute({ cardList: CARDS, save, config, pool: 'normal', payWith: 'coins', rng: seeded(5) });
  check('draws 41 -> 42', r.patch.stats.draws === 42);
  check('bestGameScore untouched in patch', !('bestGameScore' in r.patch.stats));
}

console.log('\n=== premium pool rates ===');
{
  const rng = seeded(4242);
  const N = 200000;
  const hit = { N: 0, R: 0, SR: 0, SSR: 0 };
  for (let i = 0; i < N; i++) hit[Gacha.rollRarity(config.gacha.premium.rates, rng)]++;
  for (const r of Gacha.RARITIES) {
    const got = hit[r] / N, exp = config.gacha.premium.rates[r];
    check(`premium ${r} ~= ${(exp * 100).toFixed(0)}%`, Math.abs(got - exp) / exp < 0.06, `got ${(got * 100).toFixed(2)}%`);
  }
}

console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'));
process.exit(failures === 0 ? 0 : 1);
