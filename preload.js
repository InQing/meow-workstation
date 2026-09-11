/**
 * 喵工位 — preload（契约层）
 * 全部 IPC 通道集中在此定义（只增不改）：渲染层永远不直连 ipcRenderer。
 * contextIsolation: true，仅白名单 API 暴露给渲染层。
 */
const { contextBridge, ipcRenderer } = require('electron');

const listeners = new Map();

function on(channel, cb) {
  const wrapped = (_e, payload) => cb(payload);
  listeners.set(cb, wrapped);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
}

contextBridge.exposeInMainWorld('mgw', {
  /* --- 静态素材：读取 assets/ 下的 JSON（主进程代理，限制在 assets 目录内） --- */
  readJson: (relPath) => ipcRenderer.invoke('assets:read', relPath),

  /* --- 图片桌宠（存 userData/pets/，不进仓库 assets/） --- */
  petsList: () => ipcRenderer.invoke('pets:list'),
  petsGet: (id, opts) => ipcRenderer.invoke('pets:get', id, opts),
  petsCreate: () => ipcRenderer.invoke('pets:create'),
  petsSetSlot: (id, slot) => ipcRenderer.invoke('pets:set-slot', id, slot),
  petsClearSlot: (id, slot) => ipcRenderer.invoke('pets:clear-slot', id, slot),
  petsRename: (id, name) => ipcRenderer.invoke('pets:rename', id, name),
  petsRemove: (id) => ipcRenderer.invoke('pets:remove', id),
  petsSelect: (source) => ipcRenderer.invoke('pets:select', source),
  onPetChanged: (cb) => on('pet:changed', cb),

  /* --- 存档 --- */
  loadSave: () => ipcRenderer.invoke('save:load'),
  patchSave: (patch) => ipcRenderer.invoke('save:patch', patch),

  /* --- 设置 --- */
  setSettings: (patch) => ipcRenderer.send('settings:set', patch),
  onSettingsChanged: (cb) => on('settings:changed', cb),

  /* --- 窗口 / 托盘 --- */
  movePet: (offX, offY) => ipcRenderer.send('pet:move', offX, offY), // 传窗口内偏移，非绝对坐标
  resizePet: (w, h) => ipcRenderer.send('pet:resize', { w, h }),     // 缩放：主进程按中心锚定改窗口
  showPetMenu: () => ipcRenderer.send('pet:menu'),
  setTrayIcon: (dataUrl) => ipcRenderer.send('tray:icon', dataUrl),

  /* --- 面板 --- */
  openPanel: (tab) => ipcRenderer.send('panel:open', tab),
  onPanelNavigate: (cb) => on('panel:navigate', cb),

  /* --- 桌宠联动：面板（游戏）→ 主进程转发 → pet 窗口切状态 --- */
  petReact: (kind) => ipcRenderer.send('pet:react', kind),
  onPetReact: (cb) => on('pet:react', cb),

  /* --- 番茄钟 --- */
  pomodoroStart: () => ipcRenderer.send('pomodoro:start'),
  pomodoroPause: () => ipcRenderer.send('pomodoro:pause'),
  pomodoroSkip: () => ipcRenderer.send('pomodoro:skip'),
  pomodoroGet: () => ipcRenderer.invoke('pomodoro:get'),   // 主动拉一次状态（兜底广播丢失）
  pomodoroDistracted: () => ipcRenderer.send('pomodoro:distracted'),   // 本番茄摸鱼超限 → 结算打折
  onPomodoroState: (cb) => on('pomodoro:state', cb),
  onPomodoroDone: (cb) => on('pomodoro:done', cb),

  /* --- 在场状态（系统空闲联动）：→ 桌宠安静 / 打盹 / 回归打招呼 --- */
  presenceGet: () => ipcRenderer.invoke('presence:get'),   // 兜底拉取（启动 / 回焦）
  onPresenceState: (cb) => on('presence:state', cb),
});
