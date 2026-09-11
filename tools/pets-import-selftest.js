/**
 * 图片桌宠导入管线 · 自测（真 nativeImage；临时 userData，不碰真实档）
 *   unset ELECTRON_RUN_AS_NODE && MGW_DISABLE_GPU=1 ./node_modules/electron/dist/electron.exe tools/pets-import-selftest.js
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { app, nativeImage } = require('electron');

if (process.env.MGW_DISABLE_GPU) {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('no-sandbox');
}

let fails = 0;
function check(name, ok, extra) {
  if (!ok) fails++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra != null ? '  → ' + extra : ''}`);
}

/** 造测试 PNG（BGRA 原始像素 → NativeImage → 落盘，不依赖 pngjs）：
    可选前 4 行/列透明，便于验证裁切与 alpha 保留 */
function makePng(file, w, h, rgba, transparentCorner) {
  const buf = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (w * y + x) << 2;
      buf[i] = rgba[2]; buf[i + 1] = rgba[1]; buf[i + 2] = rgba[0];
      buf[i + 3] = (transparentCorner && (x < 4 || y < 4)) ? 0 : rgba[3];
    }
  }
  fs.writeFileSync(file, nativeImage.createFromBitmap(buf, { width: w, height: h }).toPNG());
  return file;
}

app.whenReady().then(() => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mgw-pets-'));
  app.setPath('userData', tmp);
  const pets = require(path.join(__dirname, '..', 'src', 'main', 'pets.js'));
  const PetAssets = require(path.join(__dirname, '..', 'src', 'shared', 'petAssets.js'));

  console.log('--- 1. 创建（横图 → 居中裁方 + 保留 alpha）---');
  const wide = makePng(path.join(tmp, 'wide.png'), 512, 256, [220, 40, 40, 255], true);
  const created = pets.createFrom(wide);
  check('创建成功', created.ok === true, JSON.stringify(created));
  check('提示已裁方', /裁成方形/.test(created.warning || ''), created.warning);
  const id = (created.pet || {}).id;
  check('pet.json 记了 default 槽位', !!id && created.pet.slots.includes('default'), JSON.stringify(created.pet && created.pet.slots));
  if (!id) { console.log('\n创建失败，后续用例跳过'); app.exit(1); return; }

  const stored = nativeImage.createFromPath(path.join(pets.petsRoot(), id, 'default.png'));
  const size = stored.getSize();
  check('落盘 256×256 方形', size.width === 256 && size.height === 256, JSON.stringify(size));
  const b = stored.getBitmap();
  const off = (128 * 256 + 128) * 4;
  const px = [b[off], b[off + 1], b[off + 2], b[off + 3]];
  check('中心像素是红色', (px[0] > 200 && px[1] < 60) || (px[2] > 200 && px[1] < 60), px.join(','));
  check('透明行被保留（顶行 alpha=0）', b[3] === 0, 'a=' + b[3]);

  console.log('\n--- 2. 超长边 → 缩到 1024 ---');
  const big = makePng(path.join(tmp, 'big.png'), 2000, 2000, [40, 200, 60, 255], false);
  const bigPet = pets.createFrom(big);
  check('创建成功', bigPet.ok === true, JSON.stringify(bigPet && bigPet.message));
  const bigSize = nativeImage.createFromPath(path.join(pets.petsRoot(), bigPet.pet.id, 'default.png')).getSize();
  check('缩到 1024×1024', bigSize.width === 1024 && bigSize.height === 1024, JSON.stringify(bigSize));
  check('无透明像素会提示', /没有透明区域/.test(bigPet.warning || ''), bigPet.warning);

  console.log('\n--- 3. 太小拒绝 ---');
  const small = makePng(path.join(tmp, 'small.png'), 64, 64, [0, 0, 0, 255], false);
  const smallR = pets.createFrom(small);
  check('64×64 → 拒绝并给中文原因', smallR.ok === false && /太小/.test(smallR.message), JSON.stringify(smallR));

  console.log('\n--- 4. 槽位：写入 / 读取 / 回落 / 清除 ---');
  const face = makePng(path.join(tmp, 'face.png'), 256, 256, [30, 60, 220, 255], true);
  const setR = pets.setSlot(id, 'happy', face);
  check('写入 happy 槽位', setR.ok === true && setR.pet.slots.includes('happy'), JSON.stringify(setR.pet && setR.pet.slots));
  const imgs = pets.getPetImages(id);
  check('取图含 default + happy', !!imgs.slots.default && !!imgs.slots.happy, JSON.stringify(Object.keys(imgs.slots)));
  const meta = JSON.parse(fs.readFileSync(path.join(pets.petsRoot(), id, 'pet.json'), 'utf-8'));
  check('未上传状态回落默认图', PetAssets.resolveSlot(meta.slots, 'sleep') === 'default.png');
  const clearDefault = pets.clearSlot(id, 'default');
  check('默认形象不可清', clearDefault.ok === false, clearDefault.message);
  const clearHappy = pets.clearSlot(id, 'happy');
  check('清 happy → 槽位消失', clearHappy.ok === true && !clearHappy.pet.slots.includes('happy'), JSON.stringify(clearHappy.pet.slots));
  check('清掉的文件真被删', !fs.existsSync(path.join(pets.petsRoot(), id, 'happy.png')));

  console.log('\n--- 5. 列表 / 缩略图 ---');
  const list = pets.listPets();
  check('列表含 2 只（新的在前）', list.length === 2 && list[0].id === bigPet.pet.id, list.map((p) => p.name).join(' / '));
  check('列表带 128 缩略图', String(list[0].thumb).startsWith('data:image/png') && !!list[0].slots.length);
  const thumbs = pets.getPetImages(id, { thumb: true });
  check('thumb 取图可用', !!thumbs.slots.default);

  console.log('\n--- 5b. 重命名（只有图片桌宠能改）---');
  const rn = pets.rename(id, '  橘座  ');
  check('改名成功 + 去空白', rn.ok === true && rn.pet.name === '橘座', JSON.stringify(rn));
  check('新名字已落盘', JSON.parse(fs.readFileSync(path.join(pets.petsRoot(), id, 'pet.json'), 'utf-8')).name === '橘座');
  check('空名字被拒', pets.rename(id, '   ').ok === false, JSON.stringify(pets.rename(id, '   ')));
  check('不存在的桌宠改名被拒', pets.rename('p-nope', 'x').ok === false);
  check('非法 id 改名被拒', pets.rename('../etc', 'x').ok === false);

  console.log('\n--- 6. 路径安全 / 删除 ---');
  check('非法 id 被拒', pets.setSlot('../etc', 'idle', face).ok === false && pets.removePet('a/b').ok === false);
  const rm = pets.removePet(bigPet.pet.id);
  check('删除成功且目录没了', rm.ok === true && !fs.existsSync(path.join(pets.petsRoot(), bigPet.pet.id)));
  check('列表回落 1 只', pets.listPets().length === 1);
  check('不存在的宠物取图为 null', pets.getPetImages('p-nope') === null);

  console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
  app.exit(fails ? 1 : 0);
}).catch((err) => {
  console.error('pets import selftest failed:', err);
  app.exit(2);
});
