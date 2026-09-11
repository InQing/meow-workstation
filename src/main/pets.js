/**
 * 图片桌宠仓库（主进程）
 * - 存 userData/pets/<petId>/：pet.json + default.png + <状态>.png
 * - 导入归一化：居中裁方形 → 限长边（只缩不放）→ 统一 PNG（保留 alpha）
 * - 纯计算（裁切矩形 / 校验 / 结构解析）在 src/shared/petAssets.js，本文件只做 fs + nativeImage
 */
const fs = require('fs');
const path = require('path');
const { app, nativeImage } = require('electron');

const config = require('../shared/config.js');
const PetAssets = require('../shared/petAssets.js');

const PET_JSON = 'pet.json';

function petsRoot() { return path.join(app.getPath('userData'), 'pets'); }
function petDir(id) { return path.join(petsRoot(), id); }
function petJsonPath(id) { return path.join(petDir(id), PET_JSON); }

/** 目录名 → 元数据（坏档当不存在，跳过） */
function readMeta(id) {
  if (!PetAssets.isValidPetId(id)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(petJsonPath(id), 'utf-8'));
    return PetAssets.parsePetJson(raw, id);
  } catch (err) {
    return null;
  }
}

/** 图片 → dataURL；传 side 即缩略图（只缩不放） */
function imageDataUrl(filePath, side) {
  let img = nativeImage.createFromPath(filePath);
  if (img.isEmpty()) return null;
  if (side) {
    const { width, height } = img.getSize();
    const target = Math.min(side, Math.max(width, height));
    if (target !== width || target !== height) {
      img = img.resize({ width: target, height: target, quality: 'best' });
    }
  }
  return img.toDataURL();
}

/** 全部图片桌宠（新建的在前；thumb 给面板列表用） */
function listPets() {
  let names = [];
  try { names = fs.readdirSync(petsRoot()); } catch (err) { return []; }
  const out = [];
  for (const n of names) {
    const meta = readMeta(n);
    if (!meta) continue;
    out.push({
      id: meta.id,
      name: meta.name,
      createdAt: meta.createdAt,
      slots: Object.keys(meta.slots),
      thumb: imageDataUrl(path.join(petDir(meta.id), meta.slots[PetAssets.DEFAULT_SLOT]), config.imagePet.thumbSide),
    });
  }
  out.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return out;
}

/** 某只桌宠的全部图片（槽位 → dataURL；坏图跳过；默认图丢了 → null） */
function getPetImages(id, opts) {
  const meta = readMeta(id);
  if (!meta) return null;
  const side = (opts && opts.thumb) ? config.imagePet.thumbSide : 0;
  const out = { id: meta.id, name: meta.name, slots: {} };
  for (const slot of Object.keys(meta.slots)) {
    const url = imageDataUrl(path.join(petDir(id), meta.slots[slot]), side);
    if (url) out.slots[slot] = url;
  }
  if (!out.slots[PetAssets.DEFAULT_SLOT]) return null;
  return out;
}

/** 单张图归一化：{ ok, png, warning } 或 { ok:false, message } */
function normalizeImage(srcPath) {
  const img = nativeImage.createFromPath(srcPath);
  if (img.isEmpty()) return { ok: false, message: '图片读不出来（格式不支持？）' };
  const { width, height } = img.getSize();
  const v = PetAssets.validateSource(width, height, config.imagePet);
  if (!v.ok) return v;
  const plan = PetAssets.normalizePlan(width, height, config.imagePet);
  let out = img;
  if (plan.cropped) {
    out = out.crop({ x: plan.crop.x, y: plan.crop.y, width: plan.crop.size, height: plan.crop.size });
  }
  if (plan.resized) {
    out = out.resize({ width: plan.target, height: plan.target, quality: 'best' });
  }
  // 没有透明像素的图当桌宠会是一整块实心方块 —— 不拦截，只提示
  const bmp = out.getBitmap();
  let hasAlpha = false;
  for (let i = 3; i < bmp.length; i += 4) {
    if (bmp[i] < 250) { hasAlpha = true; break; }
  }
  const notes = [];
  if (plan.cropped) notes.push('已自动居中裁成方形');
  if (!hasAlpha) notes.push('这张图没有透明区域，桌宠会是一整块方形');
  return { ok: true, png: out.toPNG(), warning: notes.join('；') };
}

/**
 * 写槽位图片 + 更新 pet.json。
 * ⚠️ meta 由调用方给：新建时 pet.json 里还没有 default 槽位，用 readMeta 会判定「坏档」自锁
 * （parsePetJson 要求 default 必存在），所以不能在里面重新读档。
 */
function persistSlot(id, slot, png, meta) {
  const file = PetAssets.slotFileName(slot);
  fs.writeFileSync(path.join(petDir(id), file), png);
  meta.slots[slot] = file;
  fs.writeFileSync(petJsonPath(id), JSON.stringify(meta, null, 2), 'utf-8');
  return { id: meta.id, name: meta.name, createdAt: meta.createdAt, slots: Object.keys(meta.slots) };
}

/** 用一张图建新桌宠（默认形象槽位） */
function createFrom(srcPath) {
  const norm = normalizeImage(srcPath);
  if (!norm.ok) return norm;
  const id = PetAssets.newPetId();
  fs.mkdirSync(petDir(id), { recursive: true });
  const meta = {
    id,
    name: path.basename(srcPath, path.extname(srcPath)).slice(0, 24),
    createdAt: new Date().toISOString(),
    slots: {},
  };
  fs.writeFileSync(petJsonPath(id), JSON.stringify(meta, null, 2), 'utf-8');
  return { ok: true, pet: persistSlot(id, PetAssets.DEFAULT_SLOT, norm.png, meta), warning: norm.warning };
}

/** 写入 / 替换某槽位 */
function setSlot(id, slot, srcPath) {
  if (!PetAssets.isValidPetId(id)) return { ok: false, message: '宠物 id 不合法' };
  if (!PetAssets.isValidSlot(slot)) return { ok: false, message: '槽位不合法' };
  const meta = readMeta(id);
  if (!meta) return { ok: false, message: '这只桌宠不在了' };
  const norm = normalizeImage(srcPath);
  if (!norm.ok) return norm;
  return { ok: true, pet: persistSlot(id, slot, norm.png, meta), warning: norm.warning };
}

/** 清掉某槽位（默认形象不可清） */
function clearSlot(id, slot) {
  if (!PetAssets.isValidPetId(id)) return { ok: false, message: '宠物 id 不合法' };
  if (!PetAssets.isValidSlot(slot)) return { ok: false, message: '槽位不合法' };
  if (slot === PetAssets.DEFAULT_SLOT) return { ok: false, message: '默认形象不能删' };
  const meta = readMeta(id);
  if (!meta) return { ok: false, message: '这只桌宠不在了' };
  const file = meta.slots[slot];
  if (file) {
    delete meta.slots[slot];
    try { fs.unlinkSync(path.join(petDir(id), file)); } catch (err) { /* 文件没了就算了 */ }
    fs.writeFileSync(petJsonPath(id), JSON.stringify(meta, null, 2), 'utf-8');
  }
  return { ok: true, pet: { id: meta.id, name: meta.name, createdAt: meta.createdAt, slots: Object.keys(meta.slots) } };
}

/** 重命名（只有图片桌宠能改；内置猫不在这个仓库里） */
function rename(id, name) {
  if (!PetAssets.isValidPetId(id)) return { ok: false, message: '宠物 id 不合法' };
  const meta = readMeta(id);
  if (!meta) return { ok: false, message: '这只桌宠不在了' };
  const clean = PetAssets.cleanName(name, '');
  if (!clean) return { ok: false, message: '名字不能为空' };
  if (clean === meta.name) return { ok: true, pet: { id: meta.id, name: meta.name, createdAt: meta.createdAt, slots: Object.keys(meta.slots) } };
  meta.name = clean;
  fs.writeFileSync(petJsonPath(id), JSON.stringify(meta, null, 2), 'utf-8');
  return { ok: true, pet: { id: meta.id, name: meta.name, createdAt: meta.createdAt, slots: Object.keys(meta.slots) } };
}

/** 删除整只桌宠（目录一起删） */
function removePet(id) {
  if (!PetAssets.isValidPetId(id)) return { ok: false, message: '宠物 id 不合法' };
  try {
    fs.rmSync(petDir(id), { recursive: true, force: true });
  } catch (err) {
    return { ok: false, message: '删不掉：' + err.message };
  }
  return { ok: true };
}

function exists(id) { return !!readMeta(id); }

module.exports = { petsRoot, listPets, getPetImages, createFrom, setSlot, clearSlot, rename, removePet, exists };
