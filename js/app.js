/* Correlate — shared engine: data model, default metrics, calendar and graph views, day entry.
 * Both front-ends (index.html and tactical.html) load this file over the same markup ids.
 * A small read-only hook is exposed as window.Correlate and a 'correlate:render' event fires
 * after every render so a skin can drive extra chrome without touching the data.
 */
(function () {
  // Everything the app persists lives in ONE localStorage object under STORE:
  //   { version, metrics, entries, settings: { theme, metricsCollapsed, visible, view } }
  const STORE = 'correlate.v1';
  const STORE_VERSION = 3;   // v1: seeded sample entries; v2: empty log; v3: adds the Stress metric once
  const LEGACY = { data: 'correlate.mock.v1', theme: 'correlate.theme' };   // pre-consolidation keys, migrated once
  const DOW = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

  // ---------- helpers ----------
  const pad = n => String(n).padStart(2, '0');
  const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const fromIso = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const uid = () => Math.random().toString(36).slice(2, 9);
  const luminance = hex => {
    const c = hex.replace('#', '');
    const [r, g, b] = [0, 2, 4].map(i => parseInt(c.substr(i, 2), 16) / 255)
      .map(v => v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const isLight = hex => luminance(hex) > 0.5;
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ---------- default metrics (no entries: the log starts empty) ----------
  function defaultMetrics() {
    return [
      { id: 'walk', name: 'Walking', options: [
        { id: 'w1', label: '1 mile', color: '#a9d6b6', value: 1 },
        { id: 'w2', label: '2 miles', color: '#5fb37e', value: 2 },
        { id: 'w3', label: '3 miles', color: '#1f7a4d', value: 3 } ] },
      { id: 'sleep', name: 'Sleep', options: [
        { id: 's1', label: 'Under 6h', color: '#c9d4f1', value: 1 },
        { id: 's2', label: '6–7h', color: '#8fa6e6', value: 2 },
        { id: 's3', label: '7–8h', color: '#4f6ed9', value: 3 },
        { id: 's4', label: '8h+', color: '#2743b0', value: 4 } ] },
      { id: 'mood', name: 'Mood', options: [
        { id: 'm1', label: 'Low', color: '#f2d3b9', value: 1 },
        { id: 'm2', label: 'Flat', color: '#eba266', value: 2 },
        { id: 'm3', label: 'Good', color: '#d8712a', value: 3 },
        { id: 'm4', label: 'Great', color: '#a8480f', value: 4 } ] },
      { id: 'caff', name: 'Caffeine', options: [
        { id: 'c0', label: 'None', color: '#e5d9f1', value: 0 },
        { id: 'c1', label: '1 cup', color: '#b693dd', value: 1 },
        { id: 'c2', label: '2 cups', color: '#8a5bc9', value: 2 },
        { id: 'c3', label: '3+ cups', color: '#5c2e9e', value: 3 } ] },
      stressMetric(),
    ];
  }
  function stressMetric() {
    return { id: 'stress', name: 'Stress', options: [
      { id: 'st0', label: 'Calm', color: '#f5d6d7', value: 0 },
      { id: 'st1', label: 'Low', color: '#e48b8e', value: 1 },
      { id: 'st2', label: 'Moderate', color: '#d24146', value: 2 },
      { id: 'st3', label: 'High', color: '#ba2c30', value: 3 },
      { id: 'st4', label: 'Overwhelmed', color: '#701a1d', value: 4 } ] };
  }
  // ---------- state ----------
  const today = new Date(); today.setHours(0, 0, 0, 0);
  let state = load();
  let view = { y: today.getFullYear(), m: today.getMonth() };
  let selected = iso(today);
  let editing = new Set();

  function defaultSettings() { return { theme: 'system', metricsCollapsed: false, visible: null, view: 'calendar', graph: defaultGraph() }; }   // visible: null = all metrics, else [ids]
  function defaultGraph() { return { period: '30d', to: null, from: null, customTo: null, res: 'auto' }; }   // to: anchor day for presets (null = today)
  function normalise(s) {
    // fill in anything missing so the rest of the app can rely on the full shape
    const out = { version: STORE_VERSION, metrics: [], entries: {}, settings: defaultSettings() };
    if (s && Array.isArray(s.metrics)) out.metrics = s.metrics;
    if (s && s.entries && typeof s.entries === 'object' && (s.version || 1) >= 2) out.entries = s.entries;   // v1 entries were sample data
    if ((s && s.version || 1) < 3 && !out.metrics.some(m => m.id === 'stress')) out.metrics.push(stressMetric());   // one-time addition
    if (s && s.settings && typeof s.settings === 'object') {
      out.settings = { ...out.settings, ...s.settings }; delete out.settings.corr;
      if (!Array.isArray(out.settings.visible)) out.settings.visible = null;
      if (out.settings.view !== 'graph') out.settings.view = 'calendar';
      const g = { ...defaultGraph(), ...(out.settings.graph && typeof out.settings.graph === 'object' ? out.settings.graph : {}) };
      if (!['30d', '90d', '180d', '1y', 'all', 'custom'].includes(g.period)) g.period = '30d';
      if (!['auto', 'daily', 'weekly'].includes(g.res)) g.res = 'auto';
      out.settings.graph = g;
    }
    return out;
  }
  function load() {
    try {
      const raw = localStorage.getItem(STORE);
      if (raw) {
        const s = JSON.parse(raw);
        if (s && s.metrics && s.entries) {
          const out = normalise(s);
          if ((s.version || 1) < STORE_VERSION) localStorage.setItem(STORE, JSON.stringify(out));   // persist the upgrade now
          return out;
        }
      }
      // one-shot migration from the two older keys
      const legacyRaw = localStorage.getItem(LEGACY.data);
      const legacyTheme = localStorage.getItem(LEGACY.theme);
      if (legacyRaw || legacyTheme) {
        const legacy = legacyRaw ? JSON.parse(legacyRaw) : null;
        const s = normalise(legacy && legacy.metrics && legacy.entries ? legacy : freshData());
        if (legacyTheme) s.settings.theme = legacyTheme;
        localStorage.setItem(STORE, JSON.stringify(s));
        localStorage.removeItem(LEGACY.data); localStorage.removeItem(LEGACY.theme);
        return s;
      }
    } catch (e) { /* storage unavailable or corrupt; run in memory */ }
    return normalise(freshData());
  }
  function freshData() { return { version: STORE_VERSION, metrics: defaultMetrics(), entries: {} }; }
  function save() {
    try { localStorage.setItem(STORE, JSON.stringify(state)); } catch (e) { /* ignore */ }
  }
  const metricById = id => state.metrics.find(m => m.id === id);
  const optionOf = (metric, optId) => metric.options.find(o => o.id === optId);
  const dayScore = (date, metrics = state.metrics) => {
    const e = state.entries[date] || {};
    let sum = 0, n = 0;
    for (const m of metrics) { const o = e[m.id] && optionOf(m, e[m.id]); if (o) { sum += Number(o.value) || 0; n++; } }
    return { sum, n };
  };
  // calendar filter: which metrics get a lane in each day cell
  const isVisible = m => state.settings.visible === null || state.settings.visible.includes(m.id);
  const visibleMetrics = () => state.metrics.filter(isVisible);
  function setVisible(ids) {
    // store null when everything is visible so newly added metrics show up automatically
    state.settings.visible = ids !== null && ids.length === state.metrics.length && state.metrics.every(m => ids.includes(m.id)) ? null : ids;
    save(); renderLegend(); renderCalendar();
  }
  function setView(mode) {
    state.settings.view = mode === 'graph' ? 'graph' : 'calendar'; save(); renderCalendar();
  }


  // ---------- colour picker (8 hues × 8 shades) ----------
  const HUES = [
    { name: 'Red', h: 358, s: 62 }, { name: 'Orange', h: 24, s: 70 }, { name: 'Amber', h: 42, s: 72 }, { name: 'Green', h: 140, s: 45 },
    { name: 'Teal', h: 178, s: 48 }, { name: 'Blue', h: 218, s: 62 }, { name: 'Violet', h: 262, s: 55 }, { name: 'Magenta', h: 322, s: 55 },
  ];
  const SHADES = [90, 81, 72, 63, 54, 45, 36, 27];   // HSL lightness, light → dark
  const hslToHex = (h, s, l) => {
    s /= 100; l /= 100;
    const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
    const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return '#' + [f(0), f(8), f(4)].map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
  };
  const hexToRgb = hex => { const c = hex.replace('#', ''); return [0, 2, 4].map(i => parseInt(c.substr(i, 2), 16)); };
  const PALETTE = HUES.map(hue => SHADES.map(l => hslToHex(hue.h, hue.s, l)));   // [col][row]
  const isHex = v => /^#[0-9a-f]{6}$/i.test(v);
  function nearestCell(hex) {
    if (!isHex(hex)) return null;
    const [r, g, b] = hexToRgb(hex); let best = null, bd = Infinity;
    PALETTE.forEach((col, ci) => col.forEach((c, ri) => {
      const [r2, g2, b2] = hexToRgb(c); const d = (r - r2) ** 2 + (g - g2) ** 2 + (b - b2) ** 2;
      if (d < bd) { bd = d; best = { ci, ri, exact: d === 0 }; }
    }));
    return best;
  }

  let picker = null, pickerState = null;
  function ensurePicker() {
    if (picker) return picker;
    picker = document.createElement('div');
    picker.className = 'cpick'; picker.hidden = true; picker.setAttribute('role', 'dialog'); picker.setAttribute('aria-label', 'Choose a colour');
    picker.innerHTML = `<div class="cpick-grid" role="grid">${SHADES.map((l, ri) => PALETTE.map((col, ci) =>
        `<button type="button" class="cpick-cell" role="gridcell" data-ci="${ci}" data-ri="${ri}" data-hex="${col[ri]}" style="--c:${col[ri]}" title="${HUES[ci].name} ${ri + 1}" aria-label="${HUES[ci].name} shade ${ri + 1}"></button>`).join('')).join('')}</div>`;
    document.body.appendChild(picker);
    picker.addEventListener('click', ev => {
      const cell = ev.target.closest('.cpick-cell'); if (!cell) return;
      choose(cell.dataset.hex); closePicker();
    });
    picker.addEventListener('keydown', ev => {
      const cell = ev.target.closest('.cpick-cell'); if (!cell) { if (ev.key === 'Escape') closePicker(); return; }
      let ci = +cell.dataset.ci, ri = +cell.dataset.ri;
      if (ev.key === 'ArrowRight') ci = Math.min(HUES.length - 1, ci + 1);
      else if (ev.key === 'ArrowLeft') ci = Math.max(0, ci - 1);
      else if (ev.key === 'ArrowDown') ri = Math.min(SHADES.length - 1, ri + 1);
      else if (ev.key === 'ArrowUp') ri = Math.max(0, ri - 1);
      else if (ev.key === 'Escape') { closePicker(); return; }
      else return;
      ev.preventDefault();
      const next = picker.querySelector(`.cpick-cell[data-ci="${ci}"][data-ri="${ri}"]`); next.focus(); choose(next.dataset.hex);
    });
    document.addEventListener('pointerdown', ev => {
      if (!picker.hidden && !picker.contains(ev.target) && ev.target !== pickerState?.anchor) closePicker();
    });
    window.addEventListener('resize', closePicker);
    return picker;
  }
  function choose(hex) {
    if (!pickerState) return;
    pickerState.onPick(hex);
    markCurrent(hex);
  }
  function markCurrent(hex) {
    const near = nearestCell(hex);
    picker.querySelectorAll('.cpick-cell').forEach(c => {
      const on = near && +c.dataset.ci === near.ci && +c.dataset.ri === near.ri;
      c.classList.toggle('current', !!on); c.classList.toggle('approx', !!on && !near.exact);
      c.tabIndex = on ? 0 : -1;
    });
    if (near === null) picker.querySelector('.cpick-cell').tabIndex = 0;
  }
  function openPicker(anchor, current, onPick) {
    ensurePicker();
    if (pickerState && pickerState.anchor === anchor) { closePicker(); return; }
    pickerState = { anchor, onPick };
    picker.hidden = false;
    markCurrent(current);
    const r = anchor.getBoundingClientRect(), pw = picker.offsetWidth, ph = picker.offsetHeight;
    let left = Math.max(8, Math.min(r.left, window.innerWidth - pw - 8));
    let top = r.bottom + 6; if (top + ph > window.innerHeight - 8) top = Math.max(8, r.top - ph - 6);
    picker.style.left = left + 'px'; picker.style.top = top + 'px';
    anchor.setAttribute('aria-expanded', 'true');
    (picker.querySelector('.cpick-cell.current') || picker.querySelector('.cpick-cell')).focus();
  }
  function closePicker() {
    if (!picker || picker.hidden) return;
    picker.hidden = true;
    if (pickerState) { pickerState.anchor.setAttribute('aria-expanded', 'false'); pickerState.anchor.focus(); }
    pickerState = null;
  }


  // ---------- reordering (metric cards, and options within a metric) ----------
  let drag = null;   // { kind: 'metric' | 'option', id, metricId }
  function reorder(list, id, toIndex) {
    const from = list.findIndex(x => x.id === id);
    if (from < 0) return false;
    toIndex = Math.max(0, Math.min(list.length - 1, toIndex));
    if (from === toIndex) return false;
    const [item] = list.splice(from, 1);
    list.splice(toIndex, 0, item);
    save(); renderAll();
    return true;
  }
  function clearDropMarks() { document.querySelectorAll('.drop-before, .drop-after').forEach(c => c.classList.remove('drop-before', 'drop-after')); }
  // el: the draggable row/card; grip: the only element that starts a drag; spec: { kind, id, metricId, list(), label }
  function wireDrag(el, grip, spec) {
    const mine = () => drag && drag.kind === spec.kind && drag.metricId === spec.metricId;
    const dropIndex = ev => {
      const r = el.getBoundingClientRect(); const before = ev.clientY < r.top + r.height / 2;
      const list = spec.list();
      const from = list.findIndex(x => x.id === drag.id);
      let to = list.findIndex(x => x.id === spec.id); if (!before) to++;
      if (from < to) to--;                       // account for the gap the dragged item leaves behind
      return { to, before };
    };
    grip.addEventListener('pointerdown', () => { el.draggable = true; });
    grip.addEventListener('pointerup', () => { el.draggable = false; });
    el.addEventListener('dragstart', ev => {
      if (!el.draggable) { ev.preventDefault(); return; }
      ev.stopPropagation();
      drag = { kind: spec.kind, id: spec.id, metricId: spec.metricId }; closePicker();
      ev.dataTransfer.effectAllowed = 'move'; ev.dataTransfer.setData('text/plain', spec.id);
      requestAnimationFrame(() => el.classList.add('dragging'));
    });
    el.addEventListener('dragend', ev => { ev.stopPropagation(); drag = null; el.draggable = false; el.classList.remove('dragging'); clearDropMarks(); });
    el.addEventListener('dragover', ev => {
      if (!mine()) return;                       // an option never drops onto a metric card, and vice versa
      ev.preventDefault(); ev.stopPropagation(); ev.dataTransfer.dropEffect = 'move';
      clearDropMarks();
      if (drag.id !== spec.id) el.classList.add(dropIndex(ev).before ? 'drop-before' : 'drop-after');
    });
    el.addEventListener('dragleave', ev => { if (!el.contains(ev.relatedTarget)) el.classList.remove('drop-before', 'drop-after'); });
    el.addEventListener('drop', ev => {
      if (!mine()) return;
      ev.preventDefault(); ev.stopPropagation();
      const id = drag.id; const { to } = dropIndex(ev);
      drag = null; clearDropMarks();
      if (id !== spec.id) reorder(spec.list(), id, to);
      const g = document.getElementById('grip-' + id); if (g) g.focus();
    });
    grip.addEventListener('keydown', ev => {
      if (ev.key !== 'ArrowUp' && ev.key !== 'ArrowDown') return;
      ev.preventDefault(); ev.stopPropagation();
      const list = spec.list(); const i = list.findIndex(x => x.id === spec.id);
      if (reorder(list, spec.id, ev.key === 'ArrowUp' ? i - 1 : i + 1)) toast(`${spec.label()} moved ${ev.key === 'ArrowUp' ? 'up' : 'down'}`);
      const g = document.getElementById('grip-' + spec.id); if (g) g.focus();
    });
  }
  function makeGrip(id, label) {
    const grip = document.createElement('button'); grip.type = 'button'; grip.className = 'grip'; grip.id = 'grip-' + id;
    grip.title = 'Drag to reorder (or use ↑ ↓)'; grip.setAttribute('aria-label', `Reorder ${label}: drag, or press up or down`);
    grip.innerHTML = '<i></i><i></i><i></i><i></i><i></i><i></i>';
    return grip;
  }

  // ---------- render: metrics ----------
  function renderMetrics() {
    closePicker();
    const host = document.getElementById('metric-list');
    host.innerHTML = '';
    for (const m of state.metrics) {
      const isEd = editing.has(m.id);
      const card = document.createElement('div'); card.className = 'metric'; card.dataset.id = m.id;
      const head = document.createElement('div'); head.className = 'metric-head';
      const grip = makeGrip(m.id, m.name);
      head.appendChild(grip);
      wireDrag(card, grip, { kind: 'metric', id: m.id, metricId: null, list: () => state.metrics, label: () => m.name });
      if (isEd) {
        const inp = document.createElement('input'); inp.className = 'name-input'; inp.value = m.name; inp.id = 'name-' + m.id;
        inp.setAttribute('aria-label', 'Metric name');
        inp.oninput = () => { m.name = inp.value; save(); renderCalendar(); renderInspector(); };
        head.appendChild(inp);
        const done = document.createElement('button'); done.className = 'btn small primary'; done.textContent = 'Done';
        done.onclick = () => { editing.delete(m.id); renderAll(); };
        head.appendChild(done);
      } else {
        const nm = document.createElement('span'); nm.className = 'name'; nm.textContent = m.name; head.appendChild(nm);
        const ed = document.createElement('button'); ed.className = 'btn small'; ed.textContent = 'Edit';
        ed.onclick = () => { editing.add(m.id); renderMetrics(); };
        head.appendChild(ed);
      }
      card.appendChild(head);

      const opts = document.createElement('div'); opts.className = 'options';
      for (const o of m.options) {
        const row = document.createElement('div'); row.className = 'opt' + (isEd ? ' editing' : ''); row.dataset.id = o.id;
        const ogrip = makeGrip(o.id, o.label);
        row.appendChild(ogrip);
        wireDrag(row, ogrip, { kind: 'option', id: o.id, metricId: m.id, list: () => m.options, label: () => o.label });
        if (isEd) {
          const c = document.createElement('button'); c.type = 'button'; c.className = 'swatch-btn'; c.id = `color-${o.id}`;
          c.style.setProperty('--c', o.color); c.title = 'Choose colour'; c.setAttribute('aria-label', `Colour for ${o.label}`);
          c.setAttribute('aria-haspopup', 'dialog'); c.setAttribute('aria-expanded', 'false');
          c.onclick = () => openPicker(c, o.color, hex => {
            o.color = hex; c.style.setProperty('--c', hex); save(); renderCalendar(); renderInspector(); renderLegend();
          });
          const l = document.createElement('input'); l.type = 'text'; l.value = o.label; l.id = `label-${o.id}`; l.placeholder = 'Option'; l.setAttribute('aria-label', 'Option label');
          l.oninput = () => { o.label = l.value; save(); renderCalendar(); renderInspector(); };
          const v = document.createElement('input'); v.type = 'number'; v.value = o.value; v.id = `value-${o.id}`; v.step = '0.5'; v.setAttribute('aria-label', 'Value');
          v.oninput = () => { o.value = Number(v.value) || 0; save(); renderCalendar(); renderInspector(); };
          const x = document.createElement('button'); x.className = 'x'; x.innerHTML = '&times;'; x.title = 'Remove option';
          x.onclick = () => {
            m.options = m.options.filter(q => q.id !== o.id);
            for (const d in state.entries) if (state.entries[d][m.id] === o.id) delete state.entries[d][m.id];
            save(); renderAll();
          };
          row.append(c, l, v, x);
        } else {
          const sw = document.createElement('span'); sw.className = 'swatch'; sw.style.background = o.color;
          const lb = document.createElement('span'); lb.className = 'label'; lb.textContent = o.label;
          const vl = document.createElement('span'); vl.className = 'val num'; vl.textContent = o.value;
          row.append(sw, lb, vl);
        }
        opts.appendChild(row);
      }
      card.appendChild(opts);

      if (isEd) {
        const foot = document.createElement('div'); foot.className = 'metric-foot';
        const add = document.createElement('button'); add.className = 'btn small'; add.textContent = '+ Option';
        add.onclick = () => {
          const last = m.options[m.options.length - 1];
          m.options.push({ id: uid(), label: 'New option', color: last ? last.color : '#3450d4', value: last ? (Number(last.value) || 0) + 1 : 1 });
          save(); renderAll();
        };
        const dup = document.createElement('button'); dup.className = 'btn small'; dup.textContent = 'Duplicate';
        dup.title = 'Copy this metric and its options';
        dup.onclick = () => {
          const copy = { id: uid(), name: `${m.name} (copy)`, options: m.options.map(o => ({ ...o, id: uid() })) };
          const at = state.metrics.findIndex(x => x.id === m.id);
          state.metrics.splice(at + 1, 0, copy); if (state.settings.visible) state.settings.visible.push(copy.id);
          editing.delete(m.id); editing.add(copy.id);
          save(); renderAll(); toast(`Duplicated ${m.name}`);
          const inp = document.getElementById('name-' + copy.id); if (inp) { inp.focus(); inp.select(); }
        };
        const del = document.createElement('button'); del.className = 'btn small'; del.textContent = 'Delete'; del.title = 'Delete this metric and its logged days';
        del.onclick = () => {
          state.metrics = state.metrics.filter(q => q.id !== m.id);
          if (state.settings.visible) state.settings.visible = state.settings.visible.filter(id => id !== m.id);
          for (const d in state.entries) delete state.entries[d][m.id];
          editing.delete(m.id);
          save(); renderAll(); toast(`Removed ${m.name}`);
        };
        foot.append(add, dup, del);
        card.appendChild(foot);
      }
      host.appendChild(card);
    }
  }

  function renderLegend() {
    const btn = document.getElementById('metric-filter'); if (!btn) return;
    const vis = visibleMetrics(), all = state.metrics.length;
    btn.textContent = vis.length === all ? 'All metrics' : vis.length === 1 ? vis[0].name : `${vis.length} of ${all} metrics`;
    btn.classList.toggle('filtered', vis.length !== all);
    const menu = document.querySelector('.filter-menu'); if (menu) fillFilterMenu(menu);   // keep an open menu in sync
  }
  function fillFilterMenu(menu) {
    const vis = visibleMetrics(), allOn = vis.length === state.metrics.length;
    menu.innerHTML = `<label class="all"><input type="checkbox" data-all ${allOn ? 'checked' : ''}${!allOn && vis.length ? ' data-mixed' : ''}><span>All</span></label>` +
      state.metrics.map(m => {
        const stops = m.options.map(o => o.color).join(', ');
        return `<label><input type="checkbox" data-id="${m.id}" ${isVisible(m) ? 'checked' : ''}><i style="background: linear-gradient(90deg, ${stops || 'var(--lane-empty)'})"></i><span>${esc(m.name)}</span></label>`;
      }).join('');
    const mixed = menu.querySelector('[data-mixed]'); if (mixed) mixed.indeterminate = true;
  }
  function openFilterMenu(btn) {
    closeMenus();
    const menu = document.createElement('div');
    menu.className = 'menu filter-menu'; menu.setAttribute('role', 'group'); menu.setAttribute('aria-label', 'Metrics shown');
    fillFilterMenu(menu);
    menu.addEventListener('change', e => {
      const cb = e.target; if (!(cb instanceof HTMLInputElement)) return;
      if (cb.hasAttribute('data-all')) { setVisible(cb.checked ? null : []); return; }
      const ids = new Set(visibleMetrics().map(m => m.id));
      if (cb.checked) ids.add(cb.dataset.id); else ids.delete(cb.dataset.id);
      setVisible(state.metrics.map(m => m.id).filter(id => ids.has(id)));
    });
    document.body.appendChild(menu);
    const r = btn.getBoundingClientRect();
    menu.style.top = `${r.bottom + 6}px`;
    menu.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - menu.offsetWidth - 8))}px`;
    btn.setAttribute('aria-expanded', 'true');
    menu.querySelector('input').focus();
  }
  {
    const btn = document.getElementById('metric-filter');
    if (btn) btn.addEventListener('click', () => { if (document.querySelector('.filter-menu')) closeMenus(); else openFilterMenu(btn); });
  }

  // ---------- render: calendar ----------
  function renderCalendar() {
    const graphMode = state.settings.view === 'graph';
    document.getElementById('month-title').textContent = `${MONTHS[view.m]} ${view.y}`;
    const monthnav = document.querySelector('.monthnav'); if (monthnav) monthnav.hidden = graphMode;   // month stepping and Today belong to the calendar
    renderGraphControls(graphMode);
    const grid = document.getElementById('grid'), graph = document.getElementById('graph'), dow = document.querySelector('.dow');
    document.querySelectorAll('#view-switch [data-view]').forEach(b => {
      const on = b.dataset.view === (graphMode ? 'graph' : 'calendar');
      b.classList.toggle('on', on); b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    grid.hidden = graphMode; if (dow) dow.hidden = graphMode; graph.hidden = !graphMode;
    if (graphMode) { grid.innerHTML = ''; renderGraph(); emit(); return; }
    graph.innerHTML = '';
    grid.innerHTML = '';
    const first = new Date(view.y, view.m, 1);
    const daysInMonth = new Date(view.y, view.m + 1, 0).getDate();
    for (let i = 0; i < first.getDay(); i++) { const b = document.createElement('div'); b.className = 'day blank'; grid.appendChild(b); }
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(view.y, view.m, d); const key = iso(date);
      const cell = document.createElement('button'); cell.type = 'button';
      cell.className = 'day' + (key === iso(today) ? ' today' : '') + (key === selected ? ' selected' : '') + (date > today ? ' future' : '');
      cell.setAttribute('aria-label', `${DOW[date.getDay()]} ${MONTHS[view.m]} ${d}`);
      const shown = visibleMetrics();
      const sc = dayScore(key);   // the score always covers every metric, filtered or not
      const e = state.entries[key] || {};
      const lanes = shown.map(m => {
        const o = e[m.id] && optionOf(m, e[m.id]);
        if (!o) return `<div class="lane empty" title="${esc(m.name)}: not logged">&nbsp;</div>`;
        return `<div class="lane${isLight(o.color) ? ' dim' : ''}" style="--c:${o.color}" title="${esc(m.name)}: ${esc(o.label)} (${o.value})">${esc(o.label)}</div>`;
      }).join('');
      cell.innerHTML = `<div class="day-head"><span class="d num">${d}</span><span class="score num">${sc.n ? sc.sum : ''}</span></div><div class="lanes">${lanes}</div>`;
      cell.onclick = () => { selected = key; renderCalendar(); renderInspector(); };
      grid.appendChild(cell);
    }
    emit();
  }

  // ---------- render: graph ----------
  // The graph has its own time window (settings.graph), independent of the calendar's month:
  // presets end on an anchor day (today unless panned), Custom is an explicit range, All spans the log.
  // Resolution is daily or weekly (auto: weekly above 180 days). Daily columns that don't fit the pane
  // scroll horizontally behind a pinned label gutter. Each strip: the day score first (always), then
  // one per visible metric; y is the option's rank within its metric (lowest value at the bottom).
  const svgNS = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs = {}, text) => {
    const n = document.createElementNS(svgNS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (text !== undefined) n.textContent = text;
    return n;
  };
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const PERIOD_DAYS = { '30d': 30, '90d': 90, '180d': 180, '1y': 365 };
  const PERIOD_LABEL = { '30d': 'Last 30 days', '90d': 'Last 90 days', '180d': 'Last 180 days', '1y': 'Last year', all: 'All days', custom: 'Custom range' };
  const shortDate = d => `${MONTHS[d.getMonth()].slice(0, 3)} ${d.getDate()}`;
  const longDate = d => `${shortDate(d)}, ${d.getFullYear()}`;

  function graphRange() {
    const g = state.settings.graph;
    const anchor = today;
    let from, to;
    if (g.period === 'custom' && g.from && g.customTo) { from = fromIso(g.from); to = fromIso(g.customTo); if (from > to) [from, to] = [to, from]; }
    else if (g.period === 'all') {
      const keys = Object.keys(state.entries).filter(k => state.metrics.some(m => state.entries[k][m.id])).sort();
      to = today; from = keys.length ? fromIso(keys[0]) : addDays(today, -29);
      if (keys.length && fromIso(keys[keys.length - 1]) > to) to = fromIso(keys[keys.length - 1]);
      if (addDays(from, 29) > to) from = addDays(to, -29);           // never narrower than a month
    } else { const n = PERIOD_DAYS[g.period] || 30; to = anchor; from = addDays(to, -(n - 1)); }
    const days = Math.round((to - from) / 86400000) + 1;
    const res = g.res === 'daily' || g.res === 'weekly' ? g.res : (days > 180 ? 'weekly' : 'daily');
    return { from, to, days, res };
  }
  function graphTitle() {
    const g = state.settings.graph, r = graphRange();
    const span = `${longDate(r.from)} – ${longDate(r.to)}`;
    if (g.period === 'custom' || g.period === 'all') return span;
    return PERIOD_LABEL[g.period];
  }
  // columns: one per day, or one per week (Sunday-start, clipped to the range)
  function graphColumns(r) {
    const cols = [];
    if (r.res === 'daily') {
      for (let d = new Date(r.from); d <= r.to; d = addDays(d, 1)) cols.push({ from: new Date(d), to: new Date(d), keys: [iso(d)] });
    } else {
      let start = new Date(r.from);
      while (start <= r.to) {
        const end = addDays(start, 6 - start.getDay());                  // through Saturday
        const to = end > r.to ? new Date(r.to) : end;
        const keys = []; for (let d = new Date(start); d <= to; d = addDays(d, 1)) keys.push(iso(d));
        cols.push({ from: new Date(start), to, keys });
        start = addDays(to, 1);
      }
    }
    return cols;
  }

  let graphTip = null;
  function renderGraph() {
    const host = document.getElementById('graph'); host.innerHTML = '';
    const shown = visibleMetrics();
    if (!state.metrics.length) { host.innerHTML = `<p class="graph-empty">No metrics yet. Add one from the metrics pane.</p>`; return; }
    const r = graphRange(), cols = graphColumns(r), N = cols.length, weekly = r.res === 'weekly';
    const hostW = Math.max(320, host.clientWidth || 600);
    // left gutter wide enough for the longest label it has to pin when the graph scrolls
    const longest = Math.max(9, ...shown.map(m => m.name.length), ...shown.flatMap(m => m.options.map(o => o.label.length)));
    const L = Math.min(180, Math.max(96, 14 + longest * 6.6)), R = 14, TOP = 6, HEAD = 22, PLOT = 68, GAP = 16, AXIS = 44;
    const minCol = weekly ? 11 : 12;
    const fits = (hostW - L - R) / N >= minCol;
    const colW = fits ? (hostW - L - R) / N : (weekly ? 16 : 14);
    const W = fits ? hostW : Math.ceil(L + N * colW + R);
    const rowH = HEAD + PLOT + GAP, strips = shown.length + 1;
    const H = TOP + strips * rowH + AXIS;
    const x = i => L + (i + 0.5) * colW;
    const todayKey = iso(today);
    const colOf = key => cols.findIndex(c => c.keys.includes(key));

    const svg = el('svg', { class: 'graph-svg', viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', 'aria-label': `Day score and ${shown.map(m => m.name).join(', ')}, ${graphTitle()}` });
    const under = el('g'), marks = el('g'), over = el('g');
    svg.append(under, marks, over);
    const plotTop = TOP, plotBottom = TOP + strips * rowH - GAP;

    // backgrounds: weekends (daily), the selected column, today
    const selIdx = colOf(selected), todayIdx = colOf(todayKey);
    cols.forEach((c, i) => {
      if (!weekly && (c.from.getDay() === 0 || c.from.getDay() === 6)) under.append(el('rect', { class: 'g-weekend', x: L + i * colW, y: plotTop, width: colW, height: plotBottom - plotTop }));
      if (i === selIdx) under.append(el('rect', { class: 'g-selected', x: L + i * colW, y: plotTop - 2, width: colW, height: plotBottom - plotTop + 4 }));
    });
    // month boundaries
    cols.forEach((c, i) => {
      if (i > 0 && c.from.getDate() <= (weekly ? 7 : 1) && c.from.getMonth() !== cols[i - 1].from.getMonth()) {
        under.append(el('line', { class: 'g-month', x1: L + i * colW, x2: L + i * colW, y1: plotTop, y2: plotBottom + 6 }));
      }
    });

    // per-column aggregates: {v, lo, hi, n} on a rank scale (metrics) or score scale
    const agg = (vals) => vals.length ? { v: vals.reduce((a, b) => a + b, 0) / vals.length, lo: Math.min(...vals), hi: Math.max(...vals), n: vals.length } : null;
    const drawSeries = (series, y, lineClass, ptClass, colorOf) => {
      // series[i] = aggregate or null; band for weekly spread, line through means, points
      if (weekly) {
        let band = '';
        series.forEach((a, i) => { if (a && a.hi > a.lo) band += `M${(x(i) - colW * 0.28).toFixed(1)} ${y(a.hi).toFixed(1)} h${(colW * 0.56).toFixed(1)} V${y(a.lo).toFixed(1)} h${(-colW * 0.56).toFixed(1)} Z `; });
        if (band) marks.append(el('path', { class: 'g-band', d: band.trim(), style: `fill:${colorOf(null)}` }));
      }
      let d = '', prev = false;
      series.forEach((a, i) => { if (!a) { prev = false; return; } d += (prev ? ' L' : ' M') + `${x(i).toFixed(1)} ${y(a.v).toFixed(1)}`; prev = true; });
      if (d) marks.append(el('path', { class: 'g-line ' + lineClass, d: d.trim(), style: `stroke:${colorOf(null)}` }));
      series.forEach((a, i) => { if (a) marks.append(el('circle', { class: 'g-pt ' + ptClass, cx: x(i), cy: y(a.v), r: weekly ? 4 : 4.5, style: `fill:${colorOf(a)}` })); });
    };

    // day score strip (every metric counts, whatever the filter says), scaled to this window
    {
      const top = TOP + HEAD, bottom = top + PLOT;
      const series = cols.map(c => agg(c.keys.map(k => dayScore(k)).filter(s => s.n).map(s => s.sum)));
      let maxScore = Math.max(0, ...series.filter(Boolean).map(a => a.hi));
      if (maxScore <= 0) maxScore = Math.max(1, state.metrics.reduce((a, m) => a + Math.max(0, ...m.options.map(o => Number(o.value) || 0)), 0));
      const stepRaw = maxScore / 4, mag = Math.pow(10, Math.floor(Math.log10(stepRaw)));
      const tick = [1, 2, 2.5, 5, 10].map(v => v * mag).find(v => v >= stepRaw) || mag;
      const yMax = Math.ceil(maxScore / tick) * tick;
      const y = v => bottom - (Math.min(yMax, Math.max(0, v)) / yMax) * PLOT;
      under.append(el('text', { class: 'g-title', x: L, y: top - 8 }, weekly ? 'Day score · weekly avg' : 'Day score'));
      for (let v = 0; v <= yMax + 1e-9; v += tick) {
        under.append(el('line', { class: 'g-grid', x1: L, x2: W - R, y1: y(v), y2: y(v) }));
        under.append(el('text', { class: 'g-ylabel num', x: L - 8, y: y(v) + 3.5 }, String(Math.round(v * 100) / 100)));
      }
      drawSeries(series, y, 'g-score-line', 'g-score-pt', () => 'var(--accent)');
    }

    shown.forEach((m, i) => {
      const top = TOP + (i + 1) * rowH + HEAD, bottom = top + PLOT;
      const opts = [...m.options].sort((a, b) => (Number(a.value) || 0) - (Number(b.value) || 0));
      const rank = new Map(opts.map((o, k) => [o.id, k]));
      const k = opts.length;
      const y = v => k > 1 ? bottom - v * (PLOT / (k - 1)) : (top + bottom) / 2;
      under.append(el('text', { class: 'g-title', x: L, y: top - 8 }, m.name + (weekly ? ' · weekly avg' : '')));
      const step = k > 1 ? PLOT / (k - 1) : PLOT;
      opts.forEach((o, ri) => {
        under.append(el('line', { class: 'g-grid', x1: L, x2: W - R, y1: y(ri), y2: y(ri) }));
        if (step >= 13 || ri === 0 || ri === k - 1) under.append(el('text', { class: 'g-ylabel', x: L - 8, y: y(ri) + 3.5 }, o.label));
      });
      const mid = opts[Math.floor((k - 1) / 2)];
      const series = cols.map(c => agg(c.keys.map(key => { const e = state.entries[key] || {}; const o = e[m.id] && optionOf(m, e[m.id]); return o && rank.has(o.id) ? rank.get(o.id) : null; }).filter(v => v !== null)));
      const colorOf = a => a && !weekly ? opts[Math.round(a.v)].color : (mid ? mid.color : 'currentColor');
      drawSeries(series, y, '', '', colorOf);
    });

    // axis: dates on one row, month names on another; today marked
    const axisY = plotBottom + 18, monthY = plotBottom + 36;
    const every = colW >= 20 ? 1 : colW >= 11 ? 2 : colW >= 6 ? 5 : 10;
    let lastMonthLabelEnd = -Infinity;
    cols.forEach((c, i) => {
      const isToday = i === todayIdx;
      if (!weekly) {
        // daily: day numbers (thinned to the column width), today boxed
        const show = c.from.getDate() % every === 0 || c.from.getDate() === 1 || isToday;
        if (isToday) over.append(el('rect', { class: 'g-today', x: x(i) - 9, y: axisY - 12, width: 18, height: 16 }));
        if (show) over.append(el('text', { class: 'g-day' + (isToday ? ' today' : '') + (i === selIdx ? ' sel' : ''), x: x(i), y: axisY }, String(c.from.getDate())));
      } else if (isToday) {
        over.append(el('rect', { class: 'g-today', x: x(i) - 3, y: axisY - 10, width: 6, height: 6 }));   // weekly: a small tick for this week
      }
      // month names where a month begins (weekly: the week containing the 1st), skipping any that would collide
      const monthStartsHere = i === 0 || (weekly ? c.keys.some(k => k.endsWith('-01')) && !(i > 0 && cols[i - 1].keys.some(k => k.endsWith('-01'))) : c.from.getDate() === 1);
      if (monthStartsHere) {
        const d = weekly ? fromIso(c.keys.find(k => k.endsWith('-01')) || c.keys[0]) : c.from;
        const withYear = i === 0 || d.getMonth() === 0;
        const mLabel = withYear ? `${MONTHS[d.getMonth()].slice(0, 3)} ${d.getFullYear()}` : MONTHS[d.getMonth()].slice(0, 3);
        const lx = L + i * colW + 3, lw = mLabel.length * 6.8;
        if (lx >= lastMonthLabelEnd + 6) { over.append(el('text', { class: 'g-monthlabel', x: lx, y: weekly ? axisY : monthY }, mLabel)); lastMonthLabelEnd = lx + lw; }
      }
    });

    // hover crosshair + click-to-select columns
    const cross = el('line', { class: 'g-cross', y1: plotTop, y2: plotBottom, x1: -10, x2: -10 });
    over.append(cross);
    cols.forEach((c, i) => {
      const hit = el('rect', { class: 'g-hit', x: L + i * colW, y: plotTop, width: colW, height: plotBottom - plotTop + AXIS });
      hit.addEventListener('mouseenter', ev => { cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); showGraphTip(c, weekly, ev); });
      hit.addEventListener('mousemove', ev => placeGraphTip(ev));
      hit.addEventListener('mouseleave', () => { cross.setAttribute('x1', -10); cross.setAttribute('x2', -10); hideGraphTip(); });
      hit.addEventListener('click', () => {
        // daily: that day. weekly: the week's last logged day, else its last day in range
        const logged = c.keys.filter(k => state.entries[k] && state.metrics.some(m => state.entries[k][m.id]));
        selected = weekly ? (logged[logged.length - 1] || c.keys[c.keys.length - 1]) : c.keys[0];
        const d = fromIso(selected); view = { y: d.getFullYear(), m: d.getMonth() };   // keep the calendar in step
        renderCalendar(); renderInspector();
      });
      over.append(hit);
    });

    // scroll wrapper + pinned gutter (titles and y labels repeated on an opaque strip)
    const scroll = document.createElement('div'); scroll.className = 'graph-scroll' + (fits ? '' : ' scrolls');
    scroll.append(svg); host.append(scroll);
    if (!fits) {
      const gutter = el('svg', { class: 'graph-gutter', viewBox: `0 0 ${L} ${H}`, width: L, height: H, 'aria-hidden': 'true' });
      gutter.append(el('rect', { class: 'g-gutter-bg', x: 0, y: 0, width: L - 2, height: H }));
      under.querySelectorAll('.g-title, .g-ylabel').forEach(t => {
        const c = t.cloneNode(true);
        if (c.classList.contains('g-title')) { c.setAttribute('x', 8); c.textContent = c.textContent.replace(' · weekly avg', ''); }
        gutter.append(c);
      });
      host.append(gutter);
      // open on the most recent columns (today / the selected day) unless the user has scrolled before
      const target = selIdx >= 0 ? selIdx : (todayIdx >= 0 ? todayIdx : N - 1);
      scroll.scrollLeft = Math.max(0, L + (target + 1) * colW + R - scroll.clientWidth);
    }
  }
  function showGraphTip(col, weekly, ev) {
    if (!graphTip) { graphTip = document.createElement('div'); graphTip.className = 'graph-tip'; }
    const title = weekly ? `Week of ${shortDate(col.from)} – ${shortDate(col.to)}` : `${DOW[col.from.getDay()].slice(0, 3)} ${longDate(col.from)}`;
    const scores = col.keys.map(k => dayScore(k)).filter(s => s.n).map(s => s.sum);
    const scoreTxt = !scores.length ? '—' : weekly ? `${(scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1)} avg · ${scores.length}d` : String(scores[0]);
    const rows = visibleMetrics().map(m => {
      const opts = [...m.options].sort((a, b) => (Number(a.value) || 0) - (Number(b.value) || 0));
      const rank = new Map(opts.map((o, k) => [o.id, k]));
      const vals = col.keys.map(k => { const e = state.entries[k] || {}; const o = e[m.id] && optionOf(m, e[m.id]); return o && rank.has(o.id) ? rank.get(o.id) : null; }).filter(v => v !== null);
      let txt = '—', color = 'transparent';
      if (vals.length) {
        const mean = vals.reduce((a, b) => a + b, 0) / vals.length; const near = opts[Math.round(mean)];
        color = near.color;
        txt = weekly ? `≈ ${near.label} · ${vals.length}d` : near.label;
      }
      return `<div class="graph-tip-row"><i style="background:${color};${vals.length ? '' : 'border:1px solid var(--line-strong)'}"></i><span>${esc(m.name)}</span><b>${esc(txt)}</b></div>`;
    }).join('');
    graphTip.innerHTML = `<div class="graph-tip-date">${esc(title)}</div><div class="graph-tip-row score"><i></i><span>Day score</span><b>${esc(scoreTxt)}</b></div>${rows}`;
    document.body.append(graphTip);
    placeGraphTip(ev);
  }
  function placeGraphTip(ev) {
    if (!graphTip || !graphTip.isConnected) return;
    const w = graphTip.offsetWidth, h = graphTip.offsetHeight, pad = 8, off = 14;
    let left = ev.clientX + off, top = ev.clientY + off;
    if (left + w > window.innerWidth - pad) left = ev.clientX - off - w;
    if (top + h > window.innerHeight - pad) top = ev.clientY - off - h;
    graphTip.style.left = `${Math.max(pad, left)}px`; graphTip.style.top = `${Math.max(pad, top)}px`;
  }
  function hideGraphTip() { if (graphTip) graphTip.remove(); }
  window.addEventListener('resize', () => { if (state.settings.view === 'graph') renderGraph(); });

  // ---------- render: inspector ----------
  // A new day usually looks like the one before it, so an unlogged metric's chip row rests on the most
  // recent earlier value (looking back up to a week) instead of at its start.
  function priorOption(m, dateKey) {
    const d = fromIso(dateKey);
    for (let back = 1; back <= 7; back++) {
      d.setDate(d.getDate() - 1);
      const e = state.entries[iso(d)];
      const o = e && e[m.id] && optionOf(m, e[m.id]);
      if (o) return o;
    }
    return null;
  }
  function renderInspector() {
    const host = document.getElementById('inspector');
    const date = fromIso(selected);
    const e = state.entries[selected] || {};
    const sc = dayScore(selected);
    const rel = Math.round((today - date) / 86400000);
    const relText = rel === 0 ? 'Today' : rel === 1 ? 'Yesterday' : rel > 0 ? `${rel} days ago` : `In ${-rel} day${rel === -1 ? '' : 's'}`;
    let html = `<div class="eyebrow">Day entry</div>
      <h2 class="insp-date">${DOW[date.getDay()]}, ${MONTHS[date.getMonth()]} ${date.getDate()}</h2>
      <p class="insp-sub">${relText} · ${sc.n} of ${state.metrics.length} metrics logged</p>
      <div class="insp-score"><span class="v">${sc.sum}</span><span class="l">day score (sum of option values)</span></div>`;
    for (const m of state.metrics) {
      const cur = e[m.id] && optionOf(m, e[m.id]);
      const prior = cur ? null : priorOption(m, selected);
      html += `<div class="entry" data-m="${m.id}"><div class="row"><h3>${esc(m.name)}</h3><span class="cur">${cur ? esc(cur.label) : 'not logged'}</span></div><div class="chips">`;
      for (const o of m.options) {
        const on = cur && cur.id === o.id;
        const anchor = !on && prior && prior.id === o.id;   // unmarked; only steers where the row rests
        html += `<button type="button" class="chip${on ? ' on' : ''}${on && isLight(o.color) ? ' dim' : ''}" data-m="${m.id}" data-o="${o.id}" style="--c:${o.color}" aria-pressed="${on ? 'true' : 'false'}"${anchor ? ' data-anchor' : ''}><i></i>${esc(o.label)}</button>`;
      }
      html += `</div></div>`;
    }
    html += `<div class="insp-foot"><button class="btn ghost small" id="clear-day">Clear this day</button></div>`;
    host.innerHTML = html;
    host.querySelectorAll('.chip').forEach(btn => {
      btn.onclick = () => {
        const mid = btn.dataset.m, oid = btn.dataset.o;
        const day = state.entries[selected] || (state.entries[selected] = {});
        if (day[mid] === oid) delete day[mid]; else day[mid] = oid;
        save(); renderCalendar(); renderInspector();
      };
    });
    document.getElementById('clear-day').onclick = () => { delete state.entries[selected]; save(); renderCalendar(); renderInspector(); };
    centreChips();
    emit();
  }

  // Each metric's chips sit on one horizontally scrolling row. After a render, restore where the row was
  // scrolled to (renderInspector rebuilds it), then glide so the selected chip sits in the middle; the
  // browser clamps to [0, max], so first/last/near-edge options park at the ends. Rows that fit stay put.
  const rowScroll = new Map();
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  function centreChips() {
    document.querySelectorAll('#inspector .entry').forEach(entry => {
      const row = entry.querySelector('.chips'); if (!row) return;
      const fits = row.scrollWidth <= row.clientWidth + 1;
      row.classList.toggle('fits', fits);
      if (fits) { row.scrollLeft = 0; return; }
      const saved = rowScroll.get(entry.dataset.m); if (saved !== undefined) row.scrollLeft = saved;
      const on = entry.querySelector('.chip.on') || entry.querySelector('.chip[data-anchor]');
      let target = 0;
      if (on) {
        const rr = row.getBoundingClientRect(), cr = on.getBoundingClientRect();
        target = Math.round(row.scrollLeft + (cr.left + cr.width / 2) - (rr.left + rr.width / 2));
      }
      row.scrollTo({ left: target, behavior: reduceMotion.matches ? 'auto' : 'smooth' });
    });
  }
  window.addEventListener('resize', centreChips);

  // ---------- misc ----------
  let toastTimer;
  function toast(msg) {
    const t = document.getElementById('toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
  }
  function renderAll() { renderMetrics(); renderLegend(); renderCalendar(); renderInspector(); }


  // ---------- theme (light / dark / system) ----------
  // Same scheme as the mindmap app: one icon button opens a Light / Dark / System menu, the
  // effective theme is always stamped on <html>, and system mode follows the OS live.
  const ICONS = {
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>',
    moon: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
    monitor: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>',
    check: '<path d="M20 6L9 17l-5-5"/>',
  };
  const icon = name =>
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
  const $$ = sel => [...document.querySelectorAll(sel)];

  const THEME_MODES = ['light', 'dark', 'system'];
  const THEME_LABEL = { light: 'Light', dark: 'Dark', system: 'System' };
  const THEME_ICON = { light: 'sun', dark: 'moon', system: 'monitor' };
  const darkMQ = window.matchMedia('(prefers-color-scheme: dark)');
  const themeToggle = document.getElementById('theme-toggle');   // absent in the tactical UI, which is always dark
  let themeMode = THEME_MODES.includes(state.settings.theme) ? state.settings.theme : 'system';

  const effectiveTheme = () => (themeMode === 'system' ? (darkMQ.matches ? 'dark' : 'light') : themeMode);

  function applyTheme(mode, { animate = true } = {}) {
    themeMode = THEME_MODES.includes(mode) ? mode : 'system';
    if (state.settings.theme !== themeMode) { state.settings.theme = themeMode; save(); }
    const eff = effectiveTheme();
    const html = document.documentElement;
    if (animate && html.dataset.theme !== eff) {
      html.classList.add('theme-transition');
      clearTimeout(applyTheme.timer);
      applyTheme.timer = setTimeout(() => html.classList.remove('theme-transition'), 400);
    }
    html.dataset.theme = eff;
    html.style.colorScheme = eff;
    $$('.theme-toggle').forEach(b => {
      b.innerHTML = icon(THEME_ICON[themeMode]);
      b.title = `Theme: ${THEME_LABEL[themeMode]}${themeMode === 'system' ? ` (${eff})` : ''}`;
      b.setAttribute('aria-label', b.title);
    });
    $$('.theme-menu button').forEach(b => b.classList.toggle('current', b.dataset.mode === themeMode));
  }
  function closeMenus() {
    $$('.menu').forEach(m => m.remove());
    const f = document.getElementById('metric-filter'); if (f) f.setAttribute('aria-expanded', 'false');
  }
  function openThemeMenu(btn) {
    closeMenus();
    const menu = document.createElement('div');
    menu.className = 'menu theme-menu';
    menu.setAttribute('role', 'menu');
    menu.innerHTML = THEME_MODES.map(m =>
      `<button type="button" role="menuitemradio" aria-checked="${m === themeMode}" data-mode="${m}" class="${m === themeMode ? 'current' : ''}">${icon(THEME_ICON[m])}${THEME_LABEL[m]}<span class="menu-check">${icon('check')}</span></button>`).join('');
    menu.addEventListener('click', e => {
      const b = e.target.closest('[data-mode]');
      if (!b) return;
      applyTheme(b.dataset.mode);
      closeMenus();
      btn.focus();
    });
    document.body.appendChild(menu);
    const r = btn.getBoundingClientRect();
    menu.style.top = `${r.bottom + 6}px`;
    menu.style.left = `${Math.max(8, Math.min(r.right - menu.offsetWidth, window.innerWidth - menu.offsetWidth - 8))}px`;
    menu.querySelector('.current').focus();
  }
  if (themeToggle) {
    darkMQ.addEventListener('change', () => { if (themeMode === 'system') applyTheme('system'); });
    applyTheme(themeMode, { animate: false });
    themeToggle.addEventListener('click', () => { if (document.querySelector('.theme-menu')) closeMenus(); else openThemeMenu(themeToggle); });
  }
  document.addEventListener('click', e => { if (!e.target.closest('.menu, .theme-toggle, #metric-filter')) closeMenus(); });

  // ---------- skin hook ----------
  const api = {
    get state() { return state; },
    get selected() { return selected; },
    get view() { return { ...view, mode: state.settings.view }; },
    get today() { return iso(today); },
    dayScore, iso,
  };
  window.Correlate = api;
  let emitQueued = false;
  function emit() {
    if (emitQueued) return; emitQueued = true;
    requestAnimationFrame(() => { emitQueued = false; document.dispatchEvent(new CustomEvent('correlate:render', { detail: api })); });
  }

  document.getElementById('prev').onclick = () => { view.m--; if (view.m < 0) { view.m = 11; view.y--; } renderCalendar(); };
  document.getElementById('next').onclick = () => { view.m++; if (view.m > 11) { view.m = 0; view.y++; } renderCalendar(); };
  document.getElementById('today-btn').onclick = () => { view = { y: today.getFullYear(), m: today.getMonth() }; selected = iso(today); renderCalendar(); renderInspector(); };

  // ---------- graph controls ----------
  function renderGraphControls(show) {
    const box = document.getElementById('graph-controls'); if (!box) return;
    box.hidden = !show; if (!show) return;
    const g = state.settings.graph, r = graphRange();
    box.querySelectorAll('[data-period]').forEach(b => { const on = b.dataset.period === g.period; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
    box.querySelectorAll('[data-res]').forEach(b => { const on = b.dataset.res === r.res; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
    const custom = document.getElementById('custom-range'); custom.hidden = g.period !== 'custom';
    const fromI = document.getElementById('range-from'), toI = document.getElementById('range-to');
    if (document.activeElement !== fromI) fromI.value = iso(r.from);
    if (document.activeElement !== toI) toI.value = iso(r.to);
  }
  {
    const box = document.getElementById('graph-controls');
    if (box) {
      box.querySelectorAll('[data-period]').forEach(b => b.onclick = () => {
        const g = state.settings.graph, r = graphRange();
        g.period = b.dataset.period; g.res = 'auto';
        if (g.period === 'custom') { g.from = iso(r.from); g.customTo = iso(r.to); }
        save(); renderCalendar();
      });
      box.querySelectorAll('[data-res]').forEach(b => b.onclick = () => { state.settings.graph.res = b.dataset.res; save(); renderCalendar(); });
      const onRange = () => {
        const g = state.settings.graph, f = document.getElementById('range-from').value, t = document.getElementById('range-to').value;
        if (!f || !t) return;
        g.period = 'custom'; g.from = f; g.customTo = t; g.res = 'auto'; save(); renderCalendar();
      };
      document.getElementById('range-from').onchange = onRange; document.getElementById('range-to').onchange = onRange;
    }
  }
  // ---------- metrics pane collapse ----------
  const metricsToggle = document.getElementById('metrics-toggle');   // a skin may omit it
  function applyMetricsCollapsed(collapsed, persist) {
    if (!metricsToggle) return;
    const pane = document.querySelector('.pane.left'), app = document.querySelector('.app');
    pane.classList.toggle('collapsed', collapsed); app.classList.toggle('metrics-collapsed', collapsed);
    metricsToggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    metricsToggle.textContent = collapsed ? '>' : '<';
    metricsToggle.title = collapsed ? 'Expand metrics' : 'Collapse metrics';
    if (collapsed) closePicker();
    if (persist && state.settings.metricsCollapsed !== collapsed) { state.settings.metricsCollapsed = collapsed; save(); }
    centreChips();   // the calendar and day entry widths may have changed
  }
  if (metricsToggle) {
    metricsToggle.onclick = () => applyMetricsCollapsed(!state.settings.metricsCollapsed, true);
    applyMetricsCollapsed(!!state.settings.metricsCollapsed, false);
  }

  document.querySelectorAll('#view-switch [data-view]').forEach(b => { b.onclick = () => setView(b.dataset.view); });

  document.getElementById('add-metric').onclick = () => {
    if (state.settings.metricsCollapsed) applyMetricsCollapsed(false, true);
    const m = { id: uid(), name: 'New metric', options: [
      { id: uid(), label: 'Low', color: '#c9cfe0', value: 1 },
      { id: uid(), label: 'Medium', color: '#7f8fc7', value: 2 },
      { id: uid(), label: 'High', color: '#3450d4', value: 3 } ] };
    state.metrics.push(m); if (state.settings.visible) state.settings.visible.push(m.id); editing.add(m.id); save(); renderAll();
    const inp = document.getElementById('name-' + m.id); if (inp) { inp.focus(); inp.select(); }
  };

  document.addEventListener('scroll', e => {
    const el = e.target;
    if (el instanceof Element && el.classList.contains('chips')) {          // remember chip-row positions across re-renders
      const entry = el.closest('.entry'); if (entry) rowScroll.set(entry.dataset.m, el.scrollLeft);
      return;
    }
    closePicker(); hideGraphTip();                                            // panes scroll independently
    $$('.menu:not(.filter-menu)').forEach(m => m.remove());                   // the filter menu stays open while its choices re-render the view
  }, true);

  document.addEventListener('keydown', ev => {
    if (ev.key === 'Escape' && document.querySelector('.menu')) {   // menus close from anywhere, including a focused checkbox
      closeMenus(); const f = document.getElementById('metric-filter'); if (f && ev.target.closest && ev.target.closest('.filter-menu')) f.focus(); else if (themeToggle && ev.target.closest && ev.target.closest('.theme-menu')) themeToggle.focus();
      ev.preventDefault(); return;
    }
    const t = ev.target; if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if ((ev.metaKey || ev.ctrlKey) && ev.shiftKey && ev.key.toLowerCase() === 'l') {
      if (themeToggle) { ev.preventDefault(); applyTheme(effectiveTheme() === 'dark' ? 'light' : 'dark'); }
      return;
    }
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    const calMode = state.settings.view !== 'graph';
    if (ev.key === 'ArrowLeft' && calMode) { document.getElementById('prev').click(); ev.preventDefault(); }
    else if (ev.key === 'ArrowRight' && calMode) { document.getElementById('next').click(); ev.preventDefault(); }
    else if ((ev.key === 't' || ev.key === 'T') && calMode) { document.getElementById('today-btn').click(); }
    else if (ev.key === 'g' || ev.key === 'G') { setView(state.settings.view === 'graph' ? 'calendar' : 'graph'); }
  });

  renderAll();
})();
