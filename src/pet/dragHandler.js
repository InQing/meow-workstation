/**
 * 拖动 / 点击判定（阶段 1）
 * 规则：mousedown 后移动超过 5px → 拖动模式，通知主进程跟随鼠标；否则 mouseup 视为点击（摸头）
 */
(function () {
  const DRAG_THRESHOLD = 5;
  const MOVE_THROTTLE_MS = 10;

  function attach(el, { onTap } = {}) {
    let start = null;
    let dragging = false;
    let moved = false;
    let lastSend = 0;

    el.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      start = {
        screenX: e.screenX,
        screenY: e.screenY,
        // 鼠标相对窗口左上角（无边框透明窗口：clientX/Y 即窗口内坐标）
        offsetX: e.clientX,
        offsetY: e.clientY,
      };
      dragging = false;
      moved = false;
      el.style.cursor = 'grabbing';
      e.preventDefault();
    });

    window.addEventListener('mousemove', (e) => {
      if (!start) return;
      const dx = e.screenX - start.screenX;
      const dy = e.screenY - start.screenY;

      if (!moved && Math.hypot(dx, dy) > DRAG_THRESHOLD) {
        moved = true;
        dragging = true;
      }
      if (!dragging) return;

      const now = Date.now();
      if (now - lastSend < MOVE_THROTTLE_MS) return;
      lastSend = now;
      // 只传「鼠标在窗口内的偏移」，绝对位置交给主进程用 getCursorScreenPoint 算，
      // 避免 screenX(物理px) 与 clientX(DIP) 在 DPI 缩放下单位不一致导致拖动漂移
      window.mgw.movePet(start.offsetX, start.offsetY);
    });

    window.addEventListener('mouseup', (e) => {
      if (!start) return;
      const wasDragging = dragging;
      start = null;
      dragging = false;
      el.style.cursor = 'grab';
      if (!wasDragging && e.button === 0 && onTap) onTap(e);
    });

    // 鼠标移出窗口后松开也能收尾
    window.addEventListener('blur', () => { start = null; dragging = false; });
  }

  window.MGW_Drag = { attach, DRAG_THRESHOLD };
})();
