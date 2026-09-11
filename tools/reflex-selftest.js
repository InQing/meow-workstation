/**
 * 反应力测试 —— 纯逻辑自测（不需要 electron / 真实存档）
 *   node tools/reflex-selftest.js
 */
const R = require('../src/shared/reflex.js');
const CFG = require('../src/shared/config.js').reflex;

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('ok   ' + name + (extra ? '  ' + extra : '')); }
  else { fail++; console.log('FAIL ' + name + (extra ? '  ' + extra : '')); }
}
function eq(name, actual, expect) {
  check(name, actual === expect, 'got ' + JSON.stringify(actual) + ' want ' + JSON.stringify(expect));
}

console.log('=== reflex: wait gap ===');
eq('r=0 -> min', R.waitGap(0, CFG), 1000);
eq('r=1 -> max', R.waitGap(1, CFG), 3500);
const gaps = Array.from({ length: 200 }, (_, i) => R.waitGap(i / 200, CFG));
check('all gaps inside [1000,3500]', gaps.every((g) => g >= 1000 && g <= 3500),
  'min ' + Math.min.apply(null, gaps) + ' max ' + Math.max.apply(null, gaps));

console.log('\n=== reflex: record / average ===');
let st = R.newState();
[200, 250, 300].forEach((ms) => R.record(st, ms));
eq('average 200/250/300', R.average(st), 250);
eq('best', R.bestOf(st), 200);
eq('worst', R.worstOf(st), 300);
eq('not done at 3/5', R.isDone(st, CFG), false);
R.record(st, 260); R.record(st, 240);
eq('done at 5/5', R.isDone(st, CFG), true);
eq('average rounds to int', R.average(st), 250);
eq('empty -> null', R.average(R.newState()), null);

console.log('\n=== reflex: foul does not count ===');
st = R.newState();
R.foul(st); R.foul(st); R.record(st, 300);
eq('fouls counted', st.fouls, 2);
eq('times ignore fouls', st.times.length, 1);
eq('average ignores fouls', R.average(st), 300);

console.log('\n=== reflex: grades ===');
const g = (ms) => R.gradeFor(ms, CFG).key;
eq('200 -> bolt', g(200), 'bolt');
eq('201 -> sharp', g(201), 'sharp');
eq('260 -> sharp', g(260), 'sharp');
eq('261 -> normal', g(261), 'normal');
eq('330 -> normal', g(330), 'normal');
eq('331 -> slow', g(331), 'slow');
eq('450 -> slow', g(450), 'slow');
eq('451 -> sloth', g(451), 'sloth');

console.log('\n=== reflex: record bonus (linear, capped) ===');
eq('1st break', R.recordBonus(1, CFG), 40);
eq('5th break', R.recordBonus(5, CFG), 200);
eq('20th break capped', R.recordBonus(20, CFG), 400);
eq('0 break', R.recordBonus(0, CFG), 0);

console.log('\n=== reflex: settle patch ===');
function play(times, fouls) {
  const s = R.newState();
  times.forEach((t) => R.record(s, t));
  for (let i = 0; i < (fouls || 0); i++) R.foul(s);
  return s;
}

// 首次测出成绩 = 第 1 次破纪录：10 + 40 = 50
let p = R.settlePatch({ coins: 100, stats: {} }, play([240, 260, 250, 255, 245]), CFG);
eq('first run avg', p.avgMs, 250);
eq('first run newBest', p.newBest, true);
eq('first run breaks', p.breaks, 1);
eq('first run earned', p.earned, 50);
eq('first run coins (cover semantics)', p.coins, 150);
eq('first run best saved', p.stats.bestReflexMs, 250);
eq('first run grade', p.grade.key, 'sharp');
eq('first run react', p.react, 'best');

// 破纪录（更快）：prev 250 -> avg 200，breaks 2 -> 10 + 80
p = R.settlePatch({ coins: 0, stats: { bestReflexMs: 250, reflexBreaks: 1 } }, play([200, 200, 200, 200, 200]), CFG);
eq('2nd break earned', p.earned, 90);
eq('2nd break bonus', p.bonus, 80);
eq('2nd break count', p.breaks, 2);
eq('2nd break best', p.stats.bestReflexMs, 200);
eq('2nd break react', p.react, 'best');

// 未破纪录（更慢）：只有基础 10，breaks 与纪录都不动
p = R.settlePatch({ coins: 50, stats: { bestReflexMs: 200, reflexBreaks: 2 } }, play([300, 320, 310, 305, 315]), CFG);
eq('no break earned', p.earned, 10);
eq('no break bonus', p.bonus, 0);
eq('no break count kept', p.breaks, 2);
eq('no break best kept', p.stats.bestReflexMs, 200);
eq('no break coins', p.coins, 60);
eq('no break react', p.react, 'ok');

// 全程抢跑：给基础金币，纪录不动
p = R.settlePatch({ coins: 10, stats: { bestReflexMs: 200, reflexBreaks: 2 } }, play([], 3), CFG);
eq('all foul earned', p.earned, 10);
eq('all foul avg null', p.avgMs, null);
eq('all foul best kept', p.stats.bestReflexMs, 200);
eq('all foul breaks kept', p.stats.reflexBreaks, 2);
eq('all foul fouls', p.fouls, 3);

console.log('\n=== reflex: react thresholds ===');
eq('newBest -> best', R.reactFor(500, CFG, { newBest: true }), 'best');
eq('260 -> praise', R.reactFor(260, CFG, {}), 'praise');
eq('400 -> ok', R.reactFor(400, CFG, {}), 'ok');
eq('401 -> roast', R.reactFor(401, CFG, {}), 'roast');

console.log('\n' + (fail ? fail + ' FAILED, ' + pass + ' passed' : 'ALL PASS (' + pass + ')'));
process.exit(fail ? 1 : 0);
