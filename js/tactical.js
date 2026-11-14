/* CORRELATE — tactical chrome on top of the shared engine.
 * Loaded after app.js. Drives the four HUD readouts on the scope, the TARGET DAY
 * lock status and the status bar by reading the window.Correlate hook on every
 * 'correlate:render' event. It never mutates metric or entry data.
 */
(() => {
  'use strict';
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  /* ---------- readouts ---------- */
  const hasEntry = (state, key) => {
    const e = state.entries[key]; if (!e) return false;
    return state.metrics.some(m => e[m.id]);
  };
  function streak(C, state) {
    const d = new Date(C.today + 'T00:00:00');
    let n = 0;
    if (!hasEntry(state, C.iso(d))) d.setDate(d.getDate() - 1);   // today may not be logged yet
    while (hasEntry(state, C.iso(d)) && n < 3650) { n++; d.setDate(d.getDate() - 1); }
    return n;
  }

  function refresh() {
    const C = window.Correlate; if (!C) return;
    const state = C.state, view = C.view;
    const todayD = new Date(C.today + 'T00:00:00');

    // month readouts: logged days vs elapsed days, average score per logged day
    const daysInMonth = new Date(view.y, view.m + 1, 0).getDate();
    let elapsed = 0, logged = 0, scoreSum = 0;
    for (let d = 1; d <= daysInMonth; d++) {
      const dt = new Date(view.y, view.m, d);
      if (dt > todayD) break;
      elapsed++;
      const key = C.iso(dt);
      if (hasEntry(state, key)) { logged++; scoreSum += C.dayScore(key).sum; }
    }
    $('.js-hud-logged').textContent = `${logged} / ${elapsed}`;
    $('.js-hud-logged-sub').textContent = elapsed ? `DAYS THIS MONTH · ${Math.round(logged / elapsed * 100)}% COVERAGE` : 'MONTH NOT STARTED';
    $('.js-hud-score').textContent = logged ? (scoreSum / logged).toFixed(1) : '—';

    // lock = selected day
    const sel = new Date(C.selected + 'T00:00:00');
    const sc = C.dayScore(C.selected);
    const isToday = C.selected === C.today;
    const lock = $('.js-hud-lock');
    lock.textContent = sel.toLocaleDateString('en-US', { weekday: 'short', day: '2-digit', month: 'short' }).toUpperCase();
    lock.classList.toggle('hud__red', sc.n === 0);
    lock.classList.toggle('hud__amber', sc.n > 0 && sc.n < state.metrics.length);
    $('.js-hud-lock-sub').textContent = `${sc.n} OF ${state.metrics.length} LOGGED · SCORE ${sc.sum}`;
    const ls = $('.js-lock-status');
    ls.textContent = isToday ? 'LOCK · TODAY' : 'LOCKED';
    ls.classList.toggle('today', isToday);
    ls.classList.toggle('locked', !isToday);

    // status bar
    const totalDays = Object.keys(state.entries).filter(k => hasEntry(state, k)).length;
    $('.js-st-metrics').textContent = state.metrics.length;
    $('.js-st-options').textContent = state.metrics.reduce((a, m) => a + m.options.length, 0);
    $('.js-st-days').textContent = totalDays;
    $('.js-st-streak').textContent = streak(C, state);
  }

  document.addEventListener('correlate:render', refresh);
  refresh();
})();
