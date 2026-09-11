/**
 * 喵工位 — 存档模块（主进程）
 * - 存 userData/miaogongwei-save.json，写前留 backup
 * - 2s 防抖写盘，退出前强制落盘
 * - patch 深合并；读档时跨天自动清零 today
 */
const fs = require('fs');
const path = require('path');
const { app, ipcMain } = require('electron');

const config = require('../shared/config.js');

const SAVE_FILE = 'miaogongwei-save.json';
const BACKUP_FILE = 'miaogongwei-save.backup.json';

const DEFAULT_SAVE = {
  version: 1,
  coins: 120,
  tickets: 3,
  cards: {},                  // { cardId: count }
  pity: 0,                    // 抽卡保底计数
  affection: 18,              // 好感度
  currentCat: 'orange',       // 旧字段：内置猫 id（保留兼容，选内置猫时同步写）
  currentPet: { type: 'builtin', ref: 'orange' }, // 当前桌宠来源：内置猫 | 上传的图片
  pomodoro: { today: 0, total: 0, lastDate: '' },
  stats: { draws: 0, bestGameScore: 0, bestReflexMs: 0, reflexBreaks: 0 },
  settings: { workMin: 25, breakMin: 5, volume: 0.5, alwaysOnTop: true, petScale: config.petSize.defaultScale },
};

let state = null;
let dirty = false;
let flushTimer = null;

function savePath() { return path.join(app.getPath('userData'), SAVE_FILE); }
function backupPath() { return path.join(app.getPath('userData'), BACKUP_FILE); }

function mergeDeep(target, patch) {
  for (const key of Object.keys(patch)) {
    const pv = patch[key];
    if (pv && typeof pv === 'object' && !Array.isArray(pv) &&
        target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])) {
      mergeDeep(target[key], pv);
    } else {
      target[key] = pv;
    }
  }
  return target;
}

function todayStr() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function loadFromDisk() {
  try {
    if (fs.existsSync(savePath())) {
      const raw = JSON.parse(fs.readFileSync(savePath(), 'utf-8'));
      state = mergeDeep(JSON.parse(JSON.stringify(DEFAULT_SAVE)), raw);
      // 旧档迁移：没有 currentPet 的档按 currentCat 推导一次（之后以 currentPet 为准）
      if (!raw.currentPet) state.currentPet = { type: 'builtin', ref: raw.currentCat || 'orange' };
    } else {
      state = JSON.parse(JSON.stringify(DEFAULT_SAVE));
    }
  } catch (err) {
    console.error('[save] load failed, using defaults:', err.message);
    state = JSON.parse(JSON.stringify(DEFAULT_SAVE));
  }
  // 跨天清零今日番茄
  const today = todayStr();
  if (state.pomodoro.lastDate !== today) {
    state.pomodoro.today = 0;
    state.pomodoro.lastDate = today;
  }
  return state;
}

function writeToDisk() {
  try {
    const dir = path.dirname(savePath());
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(savePath())) {
      fs.copyFileSync(savePath(), backupPath()); // 写前 backup
    }
    fs.writeFileSync(savePath(), JSON.stringify(state, null, 2), 'utf-8');
    dirty = false;
  } catch (err) {
    console.error('[save] write failed:', err.message);
  }
}

function flushNow() {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  if (dirty) writeToDisk();
}

function patchSave(patch) {
  mergeDeep(state, patch);
  dirty = true;
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(flushNow, 2000); // 2s 防抖
  return JSON.parse(JSON.stringify(state)); // 返回快照，渲染层以此为权威
}

function getSave() { return state; }

function initSave() {
  loadFromDisk();
  console.log('[save] save path:', savePath());
  if (!fs.existsSync(savePath())) writeToDisk(); // 首次启动落一份初始档
  ipcMain.handle('save:load', () => JSON.parse(JSON.stringify(state)));
  ipcMain.handle('save:patch', (_e, patch) => patchSave(patch));
  app.on('before-quit', flushNow);
}

module.exports = { initSave, getSave, patchSave, flushNow };
