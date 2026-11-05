// The panel: a draggable bottom sheet on phones (peek, half, full) and a left sidebar on wider screens.
// The sheet animates its height rather than sliding off screen, so whatever is visible is also scrollable (the old
// sheet locked scrolling at the half stop, which hid the layer list). --panel-h tells floating map UI where to sit.

import { $, $$ } from './ui.js';

const mobile = () => matchMedia('(max-width: 720px)').matches;
const sheet = { snap: 'peek', tab: 'tracks' };

function peekHeight() { return $('#panel-head').offsetHeight; }

function snapHeight(snap) {
  const vh = window.innerHeight;
  if (snap === 'full') return vh - 12 - (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--safe-top')) || 0);
  if (snap === 'half') return Math.round(vh * 0.5);
  return peekHeight();
}

function apply(h, animate = true) {
  const panel = $('#panel');
  panel.classList.toggle('dragging', !animate);
  panel.style.height = `${h}px`;
}

export function openSheet(snap) {
  if (!mobile()) { if (snap !== 'peek') document.body.classList.remove('panel-closed'); return; }
  sheet.snap = snap;
  $('#panel').dataset.snap = snap;
  apply(snapHeight(snap));
}

export function showTab(name, expand = true) {
  sheet.tab = name;
  $$('#tabs [role="tab"]').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === name)));
  $$('.panel-section').forEach((s) => { s.hidden = s.id !== `panel-${name}`; });
  document.dispatchEvent(new CustomEvent('bcm:tab', { detail: name }));
  if (expand && mobile() && sheet.snap === 'peek') openSheet('half');
}

function setupDrag() {
  const grab = $('#panel-grab');
  let startY = 0, startH = 0, lastY = 0, lastT = 0, v = 0, id = null, moved = false;
  grab.addEventListener('pointerdown', (e) => {
    if (!mobile()) return;
    id = e.pointerId;
    startY = lastY = e.clientY; lastT = performance.now();
    startH = $('#panel').offsetHeight; v = 0; moved = false;
  });
  grab.addEventListener('pointermove', (e) => {
    if (e.pointerId !== id) return;
    const now = performance.now();
    if (now > lastT) v = (e.clientY - lastY) / (now - lastT);
    lastY = e.clientY; lastT = now;
    // Capture only once it is a drag, so taps still reach the readout and weather buttons inside the grab area.
    if (!moved && Math.abs(e.clientY - startY) > 4) { moved = true; grab.setPointerCapture(id); }
    if (moved) apply(Math.max(peekHeight(), Math.min(snapHeight('full'), startH - (e.clientY - startY))), false);
  });
  const end = (e) => {
    if (e.pointerId !== id) return;
    id = null;
    if (!moved) { if (!e.target.closest('button')) openSheet(sheet.snap === 'peek' ? 'half' : 'peek'); return; }
    const h = $('#panel').offsetHeight, snaps = ['peek', 'half', 'full'];
    let i = snaps.map((s) => Math.abs(snapHeight(s) - h)).reduce((best, d, j, a) => (d < a[best] ? j : best), 0);
    if (v < -0.5 && i < 2) i++; else if (v > 0.5 && i > 0) i--;   // a flick moves one stop
    openSheet(snaps[i]);
  };
  grab.addEventListener('pointerup', end);
  grab.addEventListener('pointercancel', end);
}

export function initSheet() {
  $('#tabs').addEventListener('click', (e) => {
    const tab = e.target.closest('[role="tab"]');
    if (!tab) return;
    if (mobile() && tab.dataset.tab === sheet.tab && sheet.snap !== 'peek') { openSheet('peek'); return; }
    showTab(tab.dataset.tab);
  });
  $('#btn-panel').onclick = () => document.body.classList.toggle('panel-closed');
  setupDrag();
  showTab('tracks', false);
  const relayout = () => {
    if (mobile()) { document.documentElement.style.setProperty('--panel-h', `${peekHeight()}px`); openSheet(sheet.snap); }
    else { $('#panel').style.height = ''; document.documentElement.style.setProperty('--panel-h', '0px'); }
  };
  window.addEventListener('resize', relayout);
  relayout();
}
