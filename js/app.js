/* ══════════════════════════════════════════════════════════════
   ForgeBase · app.js — boot + shell wiring: theme/lang, projects,
   palette, terminal, assistant drawer, notifications, search,
   keyboard shortcuts.
   ══════════════════════════════════════════════════════════════ */
'use strict';
(function () {
const FB = window.FB;
const $ = FB.$, $$ = FB.$$;

/* ── theme + lang ─────────────────────────────────────── */
function wireChrome() {
  document.documentElement.setAttribute('data-theme', FB.prefs.theme);
  $('#themeBtn').onclick = () => { FB.setTheme(FB.prefs.theme === 'dark' ? 'light' : 'dark'); drawCharts(); };
  $('#langBtn').onclick = () => { FB.setLang(FB.prefs.lang === 'ar' ? 'en' : 'ar'); FB.rerender(); drawCharts(); };
  $('#collapseBtn').onclick = () => $('#sidebar').classList.toggle('collapsed');
  $('#menuBtn').onclick = () => { $('#sidebar').classList.add('open'); $('#sidebarScrim').classList.add('show'); };
  $('#sidebarScrim').onclick = () => { $('#sidebar').classList.remove('open'); $('#sidebarScrim').classList.remove('show'); };
  // (confirm-modal buttons are wired in core.js so the promise resolves)
  const sel = $('#projectSelector');
  sel.onchange = () => FB.switchProject(sel.value);
  $('#newProjectBtn').onclick = () => FB.v.newProject();
  $('#assistantBtn').onclick = () => toggleDrawer('#assistantDrawer', true);
  $('#asstClose').onclick = () => toggleDrawer('#assistantDrawer', false);
  $('#notifBtn').onclick = () => { toggleDrawer('#notifPanel', true); FB.notifications.forEach((n) => (n.read = true)); $('#notifDot').classList.add('hidden'); renderNotifs(); };
  $('#notifClose').onclick = () => toggleDrawer('#notifPanel', false);
  $('#notifClear').onclick = () => { FB.notifications = []; renderNotifs(); };
  $('#cmdkBtn').onclick = openPalette;
  $('#terminalBtn').onclick = () => toggleTerm();
  $('#termClose').onclick = () => toggleTerm(false);
  $('#termClear').onclick = () => { $('#termOut').innerHTML = ''; };
  $('#docsBtn2').onclick = () => FB.go('docs');
  // AI build box
  const runBuild = () => { const v = $('#aiBuildInput').value.trim(); FB.go('builder' + (v ? '?prompt=' + encodeURIComponent(v) : '')); setTimeout(() => { const bp = $('#buildPrompt'); if (bp && v) { bp.value = v; FB.v.buildPlan(); } }, 60); };
  $('#aiBuildBtn').onclick = runBuild;
  $('#aiBuildInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') runBuild(); });
  // global search
  $('#globalSearch').addEventListener('keydown', (e) => { if (e.key === 'Enter') globalSearch(e.target.value); });
  $('#globalSearch').addEventListener('input', FB.debounce((e) => { if (e.target.value.trim()) globalSearch(e.target.value, true); }, 450));
  // terminal input
  $('#termIn').addEventListener('keydown', (e) => { if (e.key === 'Enter') { const v = e.target.value; e.target.value = ''; termPrint('› ' + v, 'cmd'); FB.cmd.exec(v, termPrint); } });
  // assistant input
  $('#asstSend').onclick = asstSend;
  $('#asstIn').addEventListener('keydown', (e) => { if (e.key === 'Enter') asstSend(); });
  // palette input
  $('#paletteInput').addEventListener('input', renderPalette);
  $('#paletteInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { const first = $('#paletteList li'); if (first) first.click(); }
    if (e.key === 'Escape') closePalette();
  });
  $('#palette').addEventListener('click', (e) => { if (e.target.id === 'palette') closePalette(); });
  // keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    const tag = (document.activeElement || {}).tagName;
    const typing = /INPUT|TEXTAREA|SELECT/.test(tag || '');
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); }
    else if (e.key === '/' && !typing) { e.preventDefault(); $('#globalSearch').focus(); }
    else if (e.key === '`' && !typing) { e.preventDefault(); toggleTerm(); }
    else if (e.key === 'Escape') { closePalette(); toggleDrawer('#assistantDrawer', false); toggleDrawer('#notifPanel', false); FB.closeModal(); }
  });
  window.addEventListener('hashchange', () => FB.rerender());
  renderAsstSuggest();
}
function drawCharts() { setTimeout(() => $$('canvas[data-chart], #chReq').forEach((cv) => { try { const fn = FB.views[FB.route()]; } catch { /* ignore */ } }), 50); }
function toggleDrawer(sel, force) {
  const el = $(sel);
  const show = force !== undefined ? force : el.classList.contains('hidden');
  el.classList.toggle('hidden', !show);
  if (show && sel === '#assistantDrawer') setTimeout(() => $('#asstIn').focus(), 60);
}
function toggleTerm(force) {
  const el = $('#terminal');
  const show = force !== undefined ? force : el.classList.contains('hidden');
  el.classList.toggle('hidden', !show);
  if (show) setTimeout(() => $('#termIn').focus(), 60);
}
function termPrint(line, cls) {
  const o = $('#termOut');
  o.innerHTML += '<div class="' + (cls || '') + '">' + FB.esc(line) + '</div>';
  o.scrollTop = o.scrollHeight;
}

/* ── command palette ──────────────────────────────────── */
const PALETTE_CMDS = [
  { t: 'Go: Overview', run: () => FB.go('overview') }, { t: 'Go: App Builder', run: () => FB.go('builder') },
  { t: 'Go: Database', run: () => FB.go('database') }, { t: 'Go: Authentication', run: () => FB.go('auth') },
  { t: 'Go: Storage', run: () => FB.go('storage') }, { t: 'Go: Hosting', run: () => FB.go('hosting') },
  { t: 'Go: Functions', run: () => FB.go('functions') }, { t: 'Go: API & SDK', run: () => FB.go('api') },
  { t: 'Go: Security Rules', run: () => FB.go('rules') }, { t: 'Go: Users', run: () => FB.go('users') },
  { t: 'Go: AI Agents', run: () => FB.go('agents') }, { t: 'Go: AI Providers', run: () => FB.go('providers') },
  { t: 'Go: Code Editor', run: () => FB.go('editor') }, { t: 'Go: Analytics', run: () => FB.go('analytics') },
  { t: 'Go: Logs', run: () => FB.go('logs') }, { t: 'Go: Extensions', run: () => FB.go('extensions') },
  { t: 'Go: Settings', run: () => FB.go('settings') }, { t: 'Go: Documentation', run: () => FB.go('docs') },
  { t: 'Create project…', run: () => FB.v.newProject() },
  { t: 'Create collection…', run: () => { FB.go('database'); setTimeout(() => FB.v.colCreate(), 80); } },
  { t: 'Create function…', run: () => { FB.go('functions'); setTimeout(() => FB.v.fnCreate(), 80); } },
  { t: 'Deploy (preview)', run: async () => { toggleTerm(true); termPrint('› deploy', 'cmd'); await FB.cmd.exec('deploy', termPrint); } },
  { t: 'Show logs', run: () => FB.go('logs') },
  { t: 'Generate security rules', run: async () => { FB.builder.genRules('general'); FB.go('rules'); } },
  { t: 'Analyze database', run: async () => { toggleTerm(true); await FB.cmd.exec('analyze database', termPrint); } },
  { t: 'Run tests', run: async () => { toggleTerm(true); await FB.cmd.exec('run tests', termPrint); } },
  { t: 'Toggle theme', run: () => $('#themeBtn').click() },
  { t: 'Switch language ع/EN', run: () => $('#langBtn').click() },
];
function openPalette() { $('#palette').classList.remove('hidden'); $('#paletteInput').value = ''; renderPalette(); setTimeout(() => $('#paletteInput').focus(), 30); }
function closePalette() { $('#palette').classList.add('hidden'); }
function renderPalette() {
  const q = $('#paletteInput').value.trim().toLowerCase();
  const items = PALETTE_CMDS.filter((c) => !q || c.t.toLowerCase().includes(q));
  const nl = q && !items.length ? [{ t: '🤖 AI: "' + $('#paletteInput').value.trim() + '" (Enter to run)', ai: $('#paletteInput').value.trim() }] : items;
  $('#paletteList').innerHTML = nl.map((c, i) => '<li data-i="' + i + '">' + FB.esc(c.t) + '</li>').join('') || '<li class="muted">No matches</li>';
  $$('#paletteList li').forEach((li) => {
    li.onclick = async () => {
      const item = nl[+li.dataset.i];
      closePalette();
      if (item.ai) { toggleTerm(true); termPrint('› ' + item.ai, 'cmd'); await FB.cmd.exec(item.ai, termPrint); }
      else await item.run();
    };
  });
}

/* ── global search ────────────────────────────────────── */
function globalSearch(q, live) {
  q = (q || '').trim(); if (!q) return;
  const ql = q.toLowerCase();
  const out = [];
  Object.entries(FB.data.collections).forEach(([c, col]) => {
    if (c.toLowerCase().includes(ql)) out.push({ sec: 'database', label: 'Collection: ' + c, go: () => { FB._ui.col = c; FB.go('database'); } });
    Object.values(col.docs).slice(0, 400).forEach((d) => { if ((d.id + JSON.stringify(d.data)).toLowerCase().includes(ql)) out.push({ sec: 'database', label: c + '/' + d.id, go: ((cc, id) => () => { FB._ui.col = cc; FB.go('database'); setTimeout(() => FB.v.docEdit(id), 120); })(c, d.id) }); });
  });
  FB.data.files.forEach((f) => { if (f.path.toLowerCase().includes(ql)) out.push({ sec: 'storage', label: 'File: ' + f.path, go: () => FB.go('storage') }); });
  FB.data.users.forEach((u) => { if ((u.email + u.displayName).toLowerCase().includes(ql)) out.push({ sec: 'users', label: 'User: ' + u.email, go: () => FB.go('users') }); });
  FB.data.functions.forEach((f) => { if (f.name.toLowerCase().includes(ql)) out.push({ sec: 'functions', label: 'Function: ' + f.name, go: () => { FB._ui.fnId = f.id; FB.go('functions'); } }); });
  ['overview', 'auth', 'database', 'storage', 'hosting', 'functions', 'api', 'rules', 'agents', 'providers', 'editor', 'analytics', 'logs', 'docs'].forEach((s) => { if (s.includes(ql)) out.push({ sec: 'nav', label: 'Section: ' + s, go: () => FB.go(s) }); });
  const list = out.slice(0, 12);
  FB.openModal('<div class="modal-title">Search: "' + FB.esc(q) + '" <span class="muted">' + out.length + ' hits</span></div>' +
    (list.map((r, i) => '<div class="sr" data-i="' + i + '"><span class="chip">' + r.sec + '</span> ' + FB.esc(r.label) + '</div>').join('') || '<p class="muted">No results.</p>') +
    '<div class="modal-actions"><button class="btn ghost" onclick="FB.closeModal()">Close</button></div>');
  $$('#modalBox .sr').forEach((el) => { el.onclick = () => { FB.closeModal(); list[+el.dataset.i].go(); }; });
  if (live) { /* modal shows live results; typing again re-renders */ }
}

/* ── assistant drawer ─────────────────────────────────── */
const SUGGEST = ['Create a users collection', 'Auth with admin roles', 'E-commerce schema', 'Generate security rules', 'Scaffold a React app', 'Analyze errors', 'Prepare deploy'];
function renderAsstSuggest() { $('#asstSuggest').innerHTML = SUGGEST.map((s) => '<button onclick="FB._asstAsk(this.textContent)"> ' + FB.esc(s) + '</button>').join(''); }
FB._asstAsk = (t) => { $('#asstIn').value = t; asstSend(); };
function md(text) {
  let h = FB.esc(text);
  h = h.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\n/g, '<br>');
  return h;
}
function asstMsg(role, html) {
  const box = $('#asstMsgs');
  const d = document.createElement('div');
  d.className = 'msg ' + role;
  d.innerHTML = html;
  box.appendChild(d); box.scrollTop = box.scrollHeight;
  return d;
}
async function asstSend() {
  const inp = $('#asstIn');
  const text = inp.value.trim(); if (!text) return;
  inp.value = '';
  asstMsg('user', FB.esc(text));
  const typing = asstMsg('ai', '<span class="muted">thinking…</span>');
  try {
    const r = await FB.ai.chat(text);
    typing.innerHTML = md(r.reply) + (r.via === 'provider' ? '<br><span class="chip ok">via ' + FB.esc(FB.data.providerCfg.provider) + '</span>' : '<br><span class="chip">local engine</span>');
    (r.actions || []).forEach((a) => {
      const b = document.createElement('button');
      b.className = 'btn small primary act';
      b.textContent = '▶ ' + a.label;
      b.onclick = async () => {
        if (FB.ai.isDangerous(a.kind)) { const ok = await FB.ai.requireApproval('AI Assistant', a.label, a.kind); if (!ok) { asstMsg('ai', '✕ Denied — action cancelled.'); return; } }
        try { await a.run(); asstMsg('ai', '✓ Done: ' + FB.esc(a.label)); FB.rerender(); }
        catch (e) { asstMsg('ai', '✕ ' + FB.esc(e.message)); }
      };
      typing.appendChild(b);
    });
    if (r.plan) typing.innerHTML += '<br><span class="muted">Plan: ' + FB.esc(r.plan.join(' → ')) + '</span>';
  } catch (e) { typing.innerHTML = '✕ ' + FB.esc(e.message); }
  $('#asstMsgs').scrollTop = 1e6;
}

/* ── notifications ────────────────────────────────────── */
function renderNotifs() {
  const ul = $('#notifList');
  ul.innerHTML = FB.notifications.map((n) => '<li class="notif ' + n.kind + '"><b>' + FB.esc(n.title) + '</b><p>' + FB.esc(n.body) + '</p><time>' + FB.fmtTime(n.ts) + '</time></li>').join('') || '<li class="muted pad">No notifications.</li>';
  if (!FB.notifications.some((n) => !n.read)) $('#notifDot').classList.add('hidden');
}
FB._renderNotifs = renderNotifs;

/* ── boot ─────────────────────────────────────────────── */
async function boot() {
  FB.applyI18n();
  document.documentElement.setAttribute('data-theme', FB.prefs.theme);
  wireChrome();
  try { await FB.loadAll(); }
  catch (e) { console.error(e); $('#view').innerHTML = '<div class="empty"><h2>Storage unavailable</h2><p>' + FB.esc(String(e.message || e)) + '</p></div>'; return; }
  if (!location.hash) location.hash = '#/overview';
  FB.renderNav(); FB.renderProjectSelector(); FB.updateQuota(); renderNotifs();
  if (FB.cloud) { FB.cloud.setBadge(); await FB.cloud.tryResume().catch(() => false); }
  FB.rerender();
  termPrint('ForgeBase local emulator ready. Type "help".', 'ok');
  termPrint('project: ' + (FB.currentId || 'none'));
  if (!FB._ui.asstBooted && FB.current()) {
    FB._ui.asstBooted = true;
    asstMsg('ai', '👋 I\'m wired into <b>' + FB.esc(FB.current().name) + '</b> — collections, auth, functions, logs, rules. Try a suggestion below.');
  }
  // visit counter (realtime demo)
  try { const v = +((FB.data.rtDoc.app || {}).counters || {}).visits || 0; FB.setPath(FB.data.rtDoc, 'app.counters.visits', v + 1); FB.markDirty(); } catch { /* ignore */ }
}
document.addEventListener('DOMContentLoaded', boot);
})();
