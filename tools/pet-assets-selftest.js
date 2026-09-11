/**
 * 图片桌宠纯逻辑 · 自测：不启动 Electron、不碰 userData
 *   node tools/pet-assets-selftest.js
 */
const path = require('path');
const PetAssets = require(path.join(__dirname, '..', 'src', 'shared', 'petAssets.js'));
const CONFIG = require(path.join(__dirname, '..', 'src', 'shared', 'config.js'));

let fails = 0;
function check(name, ok, extra) {
  if (!ok) fails++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra != null ? '  → ' + extra : ''}`);
}

console.log('--- 1. 居中裁方形 ---');
let r = PetAssets.centerCropRect(500, 500);
check('方形：不裁', r.x === 0 && r.y === 0 && r.size === 500, JSON.stringify(r));
r = PetAssets.centerCropRect(2000, 800);
check('横图：左右各裁 600', r.x === 600 && r.y === 0 && r.size === 800, JSON.stringify(r));
r = PetAssets.centerCropRect(800, 2000);
check('竖图：上下各裁 600', r.x === 0 && r.y === 600 && r.size === 800, JSON.stringify(r));
r = PetAssets.centerCropRect(11, 4);
check('奇数差：向下取整', r.x === 3 && r.y === 0 && r.size === 4, JSON.stringify(r));

console.log('\n--- 2. 归一化计划（只缩不放）---');
let p = PetAssets.normalizePlan(500, 500);
check('500 → 不裁不缩', !p.cropped && !p.resized && p.target === 500, JSON.stringify(p));
p = PetAssets.normalizePlan(4000, 3000);
check('4000×3000 → 裁 3000 后缩到 1024', p.cropped && p.resized && p.crop.size === 3000 && p.target === 1024, JSON.stringify(p));
p = PetAssets.normalizePlan(600, 2000);
check('600×2000 → 裁 600，不缩', p.cropped && !p.resized && p.target === 600, JSON.stringify(p));

console.log('\n--- 3. 导入校验 ---');
check('0 尺寸 → 坏图', PetAssets.validateSource(0, 0).ok === false);
check('50×2000 → 太小（min 96）', PetAssets.validateSource(50, 2000).ok === false);
check('200×150 → 通过（会被裁方）', PetAssets.validateSource(200, 150).ok === true);

console.log('\n--- 4. 槽位回落 ---');
const slots = { default: 'default.png', happy: 'happy.png' };
check('无槽位 → 回落默认图', PetAssets.resolveSlot(slots, 'idle') === 'default.png');
check('有槽位 → 用槽位图', PetAssets.resolveSlot(slots, 'happy') === 'happy.png');
check('空槽位表 → null', PetAssets.resolveSlot({}, 'idle') === null);

console.log('\n--- 5. 来源解析（旧档兼容）---');
check('旧档只有 currentCat', JSON.stringify(PetAssets.resolveSource({ currentCat: 'cow' })) === '{"type":"builtin","ref":"cow"}');
check('新档图片宠物', PetAssets.resolveSource({ currentPet: { type: 'image', ref: 'p-abc' } }).type === 'image');
check('坏档回落橘猫', PetAssets.resolveSource({ currentPet: { type: 'nope', ref: 'x' } }).ref === 'orange');
check('空档回落橘猫', PetAssets.resolveSource(null).ref === 'orange');

console.log('\n--- 6. pet.json 校验 ---');
const good = PetAssets.parsePetJson({ id: 'p-1', name: '  我的猫  ', slots: { default: 'default.png', idle: 'idle.png' } });
check('合法档：名字去空格', good && good.name === '我的猫' && good.slots.idle === 'idle.png', JSON.stringify(good));
check('缺默认图 → null', PetAssets.parsePetJson({ id: 'p-1', slots: { idle: 'idle.png' } }) === null);
const dirty = PetAssets.parsePetJson({ id: 'p-2', slots: { default: 'default.png', idle: '../evil.png', sleep: 'sleep.gif' } });
check('非法槽位文件被丢弃', dirty && dirty.slots.idle === undefined && dirty.slots.sleep === undefined, JSON.stringify(dirty && dirty.slots));
const named = PetAssets.parsePetJson({ id: 'p-3', name: 'x'.repeat(99), slots: { default: 'default.png' } }, 'p-fallback');
check('名字截断到 24 字', named && named.name.length === 24, named && named.name.length);
check('缺 id 用目录名兜底', PetAssets.parsePetJson({ slots: { default: 'default.png' } }, 'p-dir').id === 'p-dir');

console.log('\n--- 7. id / 路径安全 ---');
const id1 = PetAssets.newPetId(1700000000000, 0.5);
const id2 = PetAssets.newPetId(1700000000000, 0.9);
check('id 形如 p-xxx-yyy', /^p-[a-z0-9]+-[a-z0-9]{3}$/.test(id1), id1);
check('同时间不同随机 → 不同 id', id1 !== id2, `${id1} / ${id2}`);
check('合法 id 通过', PetAssets.isValidPetId(id1) === true && PetAssets.isValidPetId('p-abc') === true);
check('路径穿越被拒', PetAssets.isValidPetId('../etc') === false && PetAssets.isValidPetId('a/b') === false && PetAssets.isValidPetId('') === false);
check('槽位白名单', PetAssets.isValidSlot('happy') === true && PetAssets.isValidSlot('default') === true && PetAssets.isValidSlot('nope') === false);
check('槽位文件名固定', PetAssets.slotFileName('idle') === 'idle.png');

console.log('\n--- 7b. 名字清洗（改名用）---');
check('压缩空白 + 去首尾', PetAssets.cleanName('  我的  猫  ') === '我的 猫');
check('空名字回落 fallback', PetAssets.cleanName('   ', 'p-x') === 'p-x');
check('超长截到 24 字', PetAssets.cleanName('x'.repeat(99)).length === 24);
check('非字符串容错', PetAssets.cleanName(null, 'p-y') === 'p-y');

console.log('\n--- 8. config 契约 ---');
const st = CONFIG.petStates;
const allStates = st.sustain.concat(st.once, st.timed);
check('槽位顺序 = default + 9 状态', CONFIG.petSlots.order.length === 10 && CONFIG.petSlots.order[0] === 'default' && allStates.every((s) => CONFIG.petSlots.order.includes(s)), CONFIG.petSlots.order.length);
check('9 个状态都有标签', allStates.every((s) => !!CONFIG.petSlots.labels[s]), JSON.stringify(CONFIG.petSlots.labels));
check('单次态都有 onceMs', st.once.every((s) => st.onceMs[s] > 0), JSON.stringify(st.onceMs));
check('内置猫清单齐全', CONFIG.builtinCats.length >= 5 && CONFIG.builtinCats.every((c) => c.id && c.name));
check('图片参数合理', CONFIG.imagePet.maxSide > CONFIG.imagePet.minSide && CONFIG.imagePet.thumbSide > 0);

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
