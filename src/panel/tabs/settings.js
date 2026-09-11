/**
 * 面板 · 设置 tab
 * 工作/休息时长、音量、置顶开关；改动即时落盘（settings:set → 主进程 patchSave + 广播）
 */
(function () {
  const P = window.MGW_Panel;
  let rootEl = null;
  const refs = {};

  function render(root) {
    rootEl = root;
    root.innerHTML = '';
    const s = P.save || {};
    const st = s.settings || {};

    const head = P.el('div', 'sec-head');
    head.appendChild(P.el('h2', 'sec-title', '设置'));
    head.appendChild(P.el('div', 'dim', '改动即时生效并自动保存'));
    root.appendChild(head);

    const form = P.el('div', 'form');
    form.appendChild(numberField('番茄工作时长', '分钟，默认 25', st.workMin, 1, 120, (v) => push({ workMin: v })));
    form.appendChild(numberField('番茄休息时长', '分钟，默认 5', st.breakMin, 1, 120, (v) => push({ breakMin: v })));
    form.appendChild(staticField('音效', '已关闭：摸鱼场景一律不出声（番茄完成、抽卡、游戏都没有声音）'));
    form.appendChild(checkField('窗口置顶', '关掉后桌宠会被其他窗口盖住', st.alwaysOnTop !== false, (v) => push({ alwaysOnTop: v })));
    root.appendChild(form);

    const hr = P.el('div', 'hr');
    root.appendChild(hr);

    const sHead = P.el('div', 'sec-head');
    sHead.appendChild(P.el('div', 'sec-title', '进度'));
    root.appendChild(sHead);

    const list = P.el('div', 'stat-list');
    const lv = P.levelOf(s.affection);
    const nxt = P.CONFIG.affectionLevels[lv] ;
    list.appendChild(cell('好感等级', `Lv${lv}` + (nxt != null ? `　距下一级 ${Math.max(0, nxt - (s.affection || 0))}` : '　已满级')));
    list.appendChild(cell('已收集卡牌', `${P.collected()} / ${P.cards.length}`));
    list.appendChild(cell('番茄（今日 / 累计）', `${(s.pomodoro && s.pomodoro.today) || 0} / ${(s.pomodoro && s.pomodoro.total) || 0}`));
    list.appendChild(cell('累计抽卡', String((s.stats && s.stats.draws) || 0)));
    root.appendChild(list);
  }

  function push(patch) {
    window.mgw.setSettings(patch);
    P.toast('已保存');
  }

  function numberField(label, sub, value, min, max, onChange) {
    const f = P.el('div', 'field');
    const left = P.el('div');
    left.appendChild(P.el('div', 'label', label));
    left.appendChild(P.el('span', 'sub', sub));
    f.appendChild(left);
    const input = document.createElement('input');
    input.type = 'number';
    input.min = String(min);
    input.max = String(max);
    input.value = String(value == null ? '' : value);
    input.addEventListener('change', () => {
      let v = parseInt(input.value, 10);
      if (!Number.isFinite(v)) v = min;
      v = Math.max(min, Math.min(max, v));
      input.value = String(v);
      onChange(v);
    });
    f.appendChild(input);
    return f;
  }

  /** 只读说明行（音效已按老大要求全局关闭） */
  function staticField(label, note) {
    const f = P.el('div', 'field');
    const left = P.el('div');
    left.appendChild(P.el('div', 'label', label));
    left.appendChild(P.el('span', 'sub', note));
    f.appendChild(left);
    f.appendChild(P.el('span', 'static-val', '🔇 关'));
    return f;
  }

  function checkField(label, sub, checked, onChange) {
    const f = P.el('div', 'field');
    const left = P.el('div');
    left.appendChild(P.el('div', 'label', label));
    left.appendChild(P.el('span', 'sub', sub));
    f.appendChild(left);
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = !!checked;
    input.addEventListener('change', () => onChange(input.checked));
    f.appendChild(input);
    return f;
  }

  function cell(k, v) {
    const c = P.el('div', 'stat-cell');
    c.appendChild(P.el('div', 'k', k));
    c.appendChild(P.el('div', 'v', v));
    return c;
  }

  window.MGW_TabSettings = { render };
})();
