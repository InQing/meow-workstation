/**
 * 存档（主进程）· 逻辑自测：stub 掉 electron，用临时 userData，不碰真实档
 *   node tools/save-selftest.js
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const Module = require('module');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mgw-save-'));

const fakeElectron = {
  ipcMain: { on: () => {}, handle: () => {} },
  app: {
    getPath: () => tmp,
    on: () => {},
  },
};

const origLoad = Module._load;
Module._load = function (request) {
  if (request === 'electron') return fakeElectron;
  return origLoad.apply(this, arguments);
};

const SAVE_PATH = path.join(__dirname, '..', 'src', 'main', 'save.js');
const config = require(path.join(__dirname, '..', 'src', 'shared', 'config.js'));
const SAVE_FILE = path.join(tmp, 'miaogongwei-save.json');

let fails = 0;
function check(name, ok, extra) {
  if (!ok) fails++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra != null ? '  → ' + extra : ''}`);
}

console.log('--- 1. 初始档：运行时字段齐全 ---');
const save = require(SAVE_PATH);
save.initSave();
let st = save.getSave();
check('currentPet 默认内置橘猫', JSON.stringify(st.currentPet) === '{"type":"builtin","ref":"orange"}', JSON.stringify(st.currentPet));
check('settings.petScale 在默认档里', st.settings.petScale === config.petSize.defaultScale, st.settings.petScale);
check('stats 反应力字段在默认档里', st.stats.bestReflexMs === 0 && st.stats.reflexBreaks === 0, JSON.stringify(st.stats));
check('首次启动落盘', fs.existsSync(SAVE_FILE));

console.log('\n--- 2. 旧档迁移：没有 currentPet → 按 currentCat 推导 ---');
fs.writeFileSync(SAVE_FILE, JSON.stringify({ coins: 7, currentCat: 'cow', settings: { workMin: 30 } }), 'utf-8');
delete require.cache[require.resolve(SAVE_PATH)];   // 模拟重启：重新读档
const save2 = require(SAVE_PATH);
save2.initSave();
st = save2.getSave();
check('迁移成奶牛猫', JSON.stringify(st.currentPet) === '{"type":"builtin","ref":"cow"}', JSON.stringify(st.currentPet));
check('旧字段保留', st.currentCat === 'cow', st.currentCat);
check('旧设置合并保留 + 补默认', st.settings.workMin === 30 && st.settings.petScale === config.petSize.defaultScale, JSON.stringify(st.settings));
check('金币保留', st.coins === 7, st.coins);

console.log('\n--- 3. 深合并 patch：逐键覆盖、同层不丢 ---');
save2.patchSave({ settings: { petScale: 12 } });
check('嵌套新值生效', save2.getSave().settings.petScale === 12);
check('同层旧键不丢', save2.getSave().settings.workMin === 30);
save2.flushNow();
const onDisk = JSON.parse(fs.readFileSync(SAVE_FILE, 'utf-8'));
check('flush 后落盘', onDisk.settings.petScale === 12 && !!onDisk.currentPet, JSON.stringify(onDisk.settings));

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
