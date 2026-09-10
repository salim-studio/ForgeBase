/* ══════════════════════════════════════════════════════════════
   ForgeBase · views.js — all section renderers + canvas charts
   + docs content + view handlers (FB.v).
   ══════════════════════════════════════════════════════════════ */
'use strict';
window.FB = window.FB || {};
(function () {
const FB = window.FB;
const $ = FB.$, $$ = FB.$$;
FB.views = {}; FB.v = {};
FB._ui = { col: null, page: 1, per: 10, sortKey: 'updatedAt', sortDir: 'desc', docSearch: '', rtPath: '', logSvc: 'all', logLevel: 'all', logQ: '', userQ: '', fileQ: '', sdkLang: 'javascript', fnId: null, fnResult: null, ruleSim: { authed: true, uid: 'u_sara', role: 'user', path: 'users/u_sara', op: 'read' }, ruleErrs: null, agentId: null, agentTask: '', wfGoal: '', wfTimeline: null, docSec: 'overview', codeFile: 'app.js', codeTab: [], asstSetup: false };

/* ── shared bits ───────────────────────────────────────── */
const badge = (env) => '<span class="chip ' + (env === 'local' ? 'warn' : 'ok') + '">' + (env === 'local' ? 'LOCAL EMULATOR' : 'CLOUD') + '</span>';
const empty = (t, d, btn) => '<div class="empty"><div class="empty-ic">○</div><h3>' + t + '</h3><p>' + (d || '') + '</p>' + (btn || '') + '</div>';
const statCard = (label, val, sub) => '<div class="card stat"><span class="stat-l">' + label + '</span><b class="stat-v">' + val + '</b><span class="stat-s">' + (sub || '') + '</span></div>';
const esc = FB.esc;

FB.chart = (cv, series, opts) => {
  opts = opts || {};
  const dpr = window.devicePixelRatio || 1;
  const W = cv.clientWidth || 600, H = opts.h || 180;
  cv.width = W * dpr; cv.height = H * dpr;
  const g = cv.getContext('2d'); g.scale(dpr, dpr);
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  g.clearRect(0, 0, W, H);
  const all = series.flatMap((s) => s.data.map((p) => p.v));
  const max = Math.max(1, ...all) * 1.15;
  const pad = { l: 44, r: 10, t: 10, b: 22 };
  const X = (i, n) => pad.l + (i / Math.max(1, n - 1)) * (W - pad.l - pad.r);
  const Y = (v) => H - pad.b - (v / max) * (H - pad.t - pad.b);
  g.strokeStyle = css('--border'); g.fillStyle = css('--muted'); g.font = '10px system-ui'; g.lineWidth = 1;
  for (let i = 0; i <= 4; i++) { const v = (max / 1.15 / 4) * i, y = Y(v); g.beginPath(); g.moveTo(pad.l, y); g.lineTo(W - pad.r, y); g.stroke(); g.fillText(v >= 1000 ? (v / 1000).toFixed(1) + 'k' : Math.round(v), 4, y + 3); }
  const colors = ['#f97316', '#ef4444', '#22c55e', '#3b82f6', '#a855f7'];
  series.forEach((s, si) => {
    g.strokeStyle = colors[si % colors.length]; g.lineWidth = 2; g.beginPath();
    s.data.forEach((p, i) => { const x = X(i, s.data.length), y = Y(p.v); i ? g.lineTo(x, y) : g.moveTo(x, y); });
    g.stroke();
    if (opts.fill) { g.lineTo(X(s.data.length - 1, s.data.length), H - pad.b); g.lineTo(X(0, s.data.length), H - pad.b); g.closePath(); g.globalAlpha = 0.12; g.fillStyle = colors[si % colors.length]; g.fill(); g.globalAlpha = 1; }
    s.data.forEach((p, i) => { g.fillStyle = colors[si % colors.length]; g.beginPath(); g.arc(X(i, s.data.length), Y(p.v), 2, 0, 7); g.fill(); });
  });
  if (series[0] && series[0].data.length) {
    const n = series[0].data.length;
    g.fillStyle = css('--muted');
    [0, Math.floor(n / 2), n - 1].forEach((i) => { const d = new Date(series[0].data[i].t); g.fillText((d.getMonth() + 1) + '/' + d.getDate(), X(i, n) - 10, H - 6); });
  }
};
const drawAllCharts = () => $$('canvas[data-chart]').forEach((cv) => {
  const key = cv.getAttribute('data-chart');
  const m = FB.data.metrics[key] || [];
  FB.chart(cv, [{ data: m.slice(-30) }], { fill: true });
});

/* ═══ OVERVIEW ══════════════════════════════════════════ */
FB.views.overview = (view) => {
  const p = FB.current(), d = FB.data;
  if (!p) { view.innerHTML = empty('No projects yet', FB.t('createFirst'), '<button class="btn primary" onclick="FB.v.newProject()">Create project</button>'); return; }
  const docs = Object.values(d.collections).reduce((a, c) => a + Object.keys(c.docs).length, 0);
  const errs = d.logs.filter((l) => l.level === 'error').length;
  const reqs = d.metrics.req.reduce((a, x) => a + x.v, 0);
  view.innerHTML =
    '<div class="page-head"><div><h2>' + esc(p.name) + '</h2><p class="muted">' + esc(p.id) + ' · ' + badge(p.env || 'local') + '</p></div>' +
    '<div class="row"><button class="btn ghost" onclick="FB.v.openBuilder()">✦ Generate with AI</button><button class="btn primary" onclick="FB.go(\'hosting\')">Deploy</button></div></div>' +
    '<div class="grid stats">' +
    statCard('Projects', FB.projects.length, FB.projects.filter((x) => x.status === 'active').length + ' active') +
    statCard('Auth users', d.users.length, d.sessions.length + ' sessions') +
    statCard('Documents', FB.fmtNum(docs), Object.keys(d.collections).length + ' collections') +
    statCard('Files', d.files.filter((f) => f.type !== 'folder').length, FB.fmtBytes(d.files.reduce((a, f) => a + (+f.size || 0), 0))) +
    statCard('API requests (30d)', FB.fmtNum(reqs), d.apiKeys.length + ' keys') +
    statCard('Function runs (30d)', FB.fmtNum(d.metrics.fn.reduce((a, x) => a + x.v, 0)), d.functions.length + ' functions') +
    statCard('Errors', errs, errs ? 'needs attention' : 'all clear') +
    statCard('Deployments', d.deployments.length, d.deployments[0] ? d.deployments[0].status : 'none') +
    '</div>' +
    '<div class="grid two">' +
    '<div class="card"><div class="card-h"><b>Requests</b><span class="muted">30 days</span></div><canvas data-chart="req"></canvas></div>' +
    '<div class="card"><div class="card-h"><b>Active users</b><span class="muted">30 days</span></div><canvas data-chart="dau"></canvas></div>' +
    '<div class="card"><div class="card-h"><b>Database ops</b><span class="muted">30 days</span></div><canvas data-chart="dbops"></canvas></div>' +
    '<div class="card"><div class="card-h"><b>Errors</b><span class="muted">30 days</span></div><canvas data-chart="err"></canvas></div>' +
    '</div>' +
    '<div class="grid two">' +
    '<div class="card"><div class="card-h"><b>Recent activity</b><button class="btn small ghost" onclick="FB.go(\'logs\')">All logs</button></div><ul class="timeline">' +
    (d.logs.slice(0, 7).map((l) => '<li><span class="lvl ' + l.level + '">' + l.level + '</span><span>' + esc(l.msg) + '</span><time>' + FB.fmtTime(l.ts) + '</time></li>').join('') || '<li class="muted">No activity yet</li>') + '</ul></div>' +
    '<div class="card"><div class="card-h"><b>Deployments</b><button class="btn small ghost" onclick="FB.go(\'hosting\')">Hosting</button></div><ul class="timeline">' +
    (d.deployments.slice(0, 5).map((x) => '<li><span class="lvl info">' + x.env + '</span><span>' + esc(x.url) + '</span><time>' + FB.fmtTime(x.createdAt) + '</time></li>').join('') || '<li class="muted">No deployments</li>') + '</ul></div>' +
    '</div>';
  drawAllCharts();
};

/* ═══ APP BUILDER ═══════════════════════════════════════ */
FB.views.builder = (view, qs) => {
  const prompt = qs.prompt ? decodeURIComponent(qs.prompt) : (FB._ui.buildPrompt || '');
  const steps = FB._ui.buildSteps || null;
  view.innerHTML =
    '<div class="page-head"><div><h2>✦ App Builder</h2><p class="muted">Describe the app — AI plans, shows each step, and generates schema + auth + rules + code + preview.</p></div></div>' +
    '<div class="card"><label class="fld"><span>What do you want to build?</span>' +
    '<textarea id="buildPrompt" rows="3" placeholder="Create a university management system with authentication, students, teachers, courses, grades, dashboard…">' + esc(prompt) + '</textarea></label>' +
    '<div class="row"><button class="btn primary" onclick="FB.v.buildPlan()">1 · Make plan</button><button class="btn" id="buildGoBtn" onclick="FB.v.buildGenerate()" ' + (FB._ui.buildPlan ? '' : 'disabled') + '>2 · Approve & generate</button></div></div>' +
    '<div id="buildPlanBox">' + (FB._ui.buildPlan ? '<div class="card"><div class="card-h"><b>Implementation plan</b><span class="chip">awaiting approval</span></div><ol class="plan">' + FB._ui.buildPlan.map((s) => '<li><b>' + esc(s.label) + '</b><span class="muted"> — ' + esc(s.detail) + '</span>' + (s.dangerous ? ' <span class="chip danger">needs approval</span>' : '') + '</li>').join('') + '</ol></div>' : '<p class="muted">Step 1 produces a reviewable plan first — nothing destructive runs without approval.</p>') + '</div>' +
    (steps ? '<div class="card"><div class="card-h"><b>Execution</b></div><ul class="timeline" id="buildExec">' + steps.map((s) => '<li data-step="' + s.id + '"><span class="lvl ' + (s.st === 'done' ? 'info' : 'warn') + '">' + (s.st === 'done' ? '✓' : '…') + '</span><span><b>' + esc(s.label) + '</b> — ' + esc(s.detail) + '</span></li>').join('') + '</ul><div class="row"><button class="btn ghost" onclick="FB.go(\'database\')">Inspect database</button><button class="btn ghost" onclick="FB.go(\'hosting\')">View preview deploy</button><button class="btn ghost" onclick="FB.go(\'editor\')">Open code</button></div></div>' : '');
};
FB.v.openBuilder = () => FB.go('builder');
FB.v.buildPlan = () => { const p = $('#buildPrompt').value; FB._ui.buildPrompt = p; FB._ui.buildPlan = FB.builder.plan(p); FB._ui.buildSteps = null; FB.rerender(); };
FB.v.buildGenerate = async () => {
  const btn = $('#buildGoBtn'); if (btn) { btn.disabled = true; btn.textContent = 'Generating…'; }
  FB._ui.buildSteps = FB._ui.buildPlan.map((s) => Object.assign({}, s, { st: 'wait' }));
  FB.rerender();
  await FB.builder.generate(FB._ui.buildPrompt || '', (s, st) => {
    const li = document.querySelector('#buildExec li[data-step="' + s.id + '"]');
    if (li) li.innerHTML = '<span class="lvl ' + (st === 'done' ? 'info' : 'warn') + '">' + (st === 'done' ? '✓' : '…') + '</span><span><b>' + esc(s.label) + '</b> — ' + esc(s.detail || '') + '</span>';
  });
  FB._ui.buildSteps = FB._ui.buildPlan.map((s) => Object.assign({}, s, { st: 'done' }));
  FB.rerender();
};

/* ═══ DATABASE ══════════════════════════════════════════ */
FB.views.database = (view) => {
  const cols = FB.svc.listCollections();
  if (!FB._ui.col || !FB.data.collections[FB._ui.col]) FB._ui.col = cols[0] || null;
  const col = FB._ui.col;
  const res = col ? FB.svc.listDocs(col, { search: FB._ui.docSearch, sortKey: FB._ui.sortKey, sortDir: FB._ui.sortDir, page: FB._ui.page, per: FB._ui.per }) : { docs: [], total: 0, pages: 1, page: 1 };
  const rtKeys = Object.keys(FB.data.rtDoc || {});
  view.innerHTML =
    '<div class="page-head"><div><h2>Database ' + badge('local') + '</h2><p class="muted">Firestore-style collections + Realtime JSON · IndexedDB emulator</p></div>' +
    '<div class="row"><select id="dbMode" onchange="FB.v.dbMode(this.value)"><option value="firestore">Firestore-style</option><option value="realtime">Realtime JSON</option></select>' +
    '<button class="btn small ghost" onclick="FB.v.dbBackup()">Backup</button><button class="btn small ghost" onclick="FB.v.dbExport()">Export JSON</button><button class="btn small ghost" onclick="document.getElementById(\'dbImport\').click()">Import</button><input type="file" id="dbImport" accept=".json,.csv" class="hidden" onchange="FB.v.dbImport(this)"></div></div>' +
    '<div id="dbMain">' + (FB.data.dbMode === 'realtime' ? rtHTML(rtKeys) : fsHTML(cols, col, res)) + '</div>';

  function fsHTML(cols, col, res) {
    return '<div class="db-layout"><div class="card cols"><div class="card-h"><b>Collections</b><button class="btn small" onclick="FB.v.colCreate()">+ New</button></div><ul class="collist">' +
      cols.map((c) => '<li class="' + (c === col ? 'active' : '') + '" onclick="FB.v.colSelect(\'' + c + '\')">' + esc(c) + '<span class="count">' + Object.keys(FB.data.collections[c].docs).length + '</span>' + (c === col ? ' <button class="icon-btn danger" title="Delete collection" onclick="event.stopPropagation();FB.v.colDelete(\'' + c + '\')">✕</button>' : '') + '</li>').join('') +
      '</ul><div class="pad"><button class="btn small ghost" onclick="FB.go(\'rules\')">Database rules →</button></div></div>' +
      '<div class="card docs"><div class="card-h"><b>' + esc(col || '—') + '</b><span class="muted">' + res.total + ' docs</span></div>' +
      '<div class="toolbar"><input id="docSearch" type="search" placeholder="Search documents…" value="' + esc(FB._ui.docSearch) + '" oninput="FB.v.docSearch(this.value)">' +
      '<select onchange="FB.v.docSort(this.value)"><option value="updatedAt:desc">Newest</option><option value="updatedAt:asc">Oldest</option><option value="id:asc">ID A–Z</option><option value="id:desc">ID Z–A</option></select>' +
      '<select onchange="FB.v.docPer(this.value)"><option>10</option><option>25</option><option>50</option></select>' +
      '<button class="btn small primary" onclick="FB.v.docAdd()">+ Document</button></div>' +
      '<div class="table-wrap"><table class="tbl"><thead><tr><th>ID</th><th>Data (preview)</th><th>Updated</th><th></th></tr></thead><tbody>' +
      (res.docs.map((d) => '<tr><td class="mono">' + esc(d.id) + '</td><td class="mono clamp">' + esc(JSON.stringify(d.data).slice(0, 120)) + '</td><td>' + FB.fmtTime(d.updatedAt || d.createdAt) + '</td><td class="row"><button class="btn small ghost" onclick="FB.v.docEdit(\'' + esc(d.id) + '\')">Edit</button><button class="btn small danger ghost" onclick="FB.v.docDel(\'' + esc(d.id) + '\')">Delete</button></td></tr>').join('') || '<tr><td colspan="4" class="muted">No documents — add one, import JSON/CSV, or ask the AI.</td></tr>') +
      '</tbody></table></div>' +
      '<div class="pager"><button class="btn small ghost" onclick="FB.v.docPage(-1)">‹ Prev</button><span>Page ' + res.page + ' / ' + res.pages + '</span><button class="btn small ghost" onclick="FB.v.docPage(1)">Next ›</button></div>' +
      '</div></div>';
  }
  function rtHTML(keys) {
    const cur = FB.svc.rtGet(FB._ui.rtPath);
    return '<div class="grid two"><div class="card"><div class="card-h"><b>Realtime tree</b><span class="chip ok">live</span></div>' +
      '<pre class="code" id="rtTree">' + esc(JSON.stringify(FB.data.rtDoc, null, 2).slice(0, 4000)) + '</pre></div>' +
      '<div class="card"><div class="card-h"><b>Read / write path</b></div>' +
      '<label class="fld"><span>Path (dot notation, e.g. app.counters.visits)</span><input id="rtPath" value="' + esc(FB._ui.rtPath) + '" oninput="FB.v.rtPath(this.value)"></label>' +
      '<label class="fld"><span>Value (JSON)</span><textarea id="rtVal" rows="5">' + esc(JSON.stringify(cur === undefined ? null : cur, null, 2)) + '</textarea></label>' +
      '<div class="row"><button class="btn primary" onclick="FB.v.rtSet()">Write</button><button class="btn danger ghost" onclick="FB.v.rtDel()">Delete path</button></div>' +
      '<p class="muted">Watch: visits counter increments on each Overview visit simulation.</p><button class="btn small ghost" onclick="FB.v.rtBump()">+1 app.counters.visits</button></div></div>';
  }
};
FB.v.dbMode = (m) => { FB.data.dbMode = m; FB.markDirty(); FB.rerender(); };
FB.v.colSelect = (c) => { FB._ui.col = c; FB._ui.page = 1; FB.rerender(); };
FB.v.colCreate = async () => { const n = prompt('Collection name (letters, digits, _):', 'orders'); if (!n) return; try { FB.svc.createCollection(n.trim().toLowerCase()); FB._ui.col = n.trim().toLowerCase(); FB.rerender(); } catch (e) { FB.toast(e.message, 'err'); } };
FB.v.colDelete = (c) => FB.svc.deleteCollection(c);
FB.v.docSearch = FB.debounce((v) => { FB._ui.docSearch = v; FB._ui.page = 1; FB.rerender({ keepScroll: true }); const el = $('#docSearch'); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }, 350);
FB.v.docSort = (v) => { const [k, d] = v.split(':'); FB._ui.sortKey = k; FB._ui.sortDir = d; FB.rerender(); };
FB.v.docPer = (v) => { FB._ui.per = +v; FB._ui.page = 1; FB.rerender(); };
FB.v.docPage = (d) => { FB._ui.page += d; FB.rerender(); };
FB.v.docAdd = () => {
  FB.openModal('<div class="modal-title">New document in <b>' + esc(FB._ui.col) + '</b></div><label class="fld"><span>Document ID (blank = auto)</span><input id="ndId" placeholder="auto"></label><label class="fld"><span>Data (JSON)</span><textarea id="ndData" rows="8">{\n  "name": "New item",\n  "created": true\n}</textarea></label><div class="modal-actions"><button class="btn ghost" onclick="FB.closeModal()">Cancel</button><button class="btn primary" onclick="FB.v.docAddGo()">Create</button></div>');
};
FB.v.docAddGo = () => {
  const r = FB.parseJSONSafe($('#ndData').value);
  if (!r.ok) { FB.toast('Invalid JSON: ' + r.error, 'err'); return; }
  const id = $('#ndId').value.trim();
  const rec = id ? FB.svc.setDoc(FB._ui.col, id, r.value) : FB.svc.addDoc(FB._ui.col, r.value);
  FB.closeModal(); FB.notify('Document saved', FB._ui.col + '/' + rec.id, 'ok'); FB.rerender();
};
FB.v.docEdit = (id) => {
  const d = FB.data.collections[FB._ui.col].docs[id];
  FB.openModal('<div class="modal-title">Edit <b class="mono">' + esc(id) + '</b></div><label class="fld"><span>Data (JSON) — supports nested objects & arrays</span><textarea id="edData" rows="12">' + esc(JSON.stringify(d.data, null, 2)) + '</textarea></label><div class="modal-actions"><button class="btn ghost" onclick="FB.closeModal()">Cancel</button><button class="btn primary" onclick="FB.v.docEditGo(\'' + esc(id) + '\')">Save</button></div>');
};
FB.v.docEditGo = (id) => {
  const r = FB.parseJSONSafe($('#edData').value);
  if (!r.ok) { FB.toast('Invalid JSON: ' + r.error, 'err'); return; }
  FB.svc.setDoc(FB._ui.col, id, r.value); FB.closeModal(); FB.rerender();
};
FB.v.docDel = (id) => { FB.svc.deleteDoc(FB._ui.col, id); FB.rerender(); };
FB.v.dbExport = () => { FB.download(FB.currentId + '-db.json', FB.svc.exportJSON(), 'application/json'); };
FB.v.dbBackup = () => FB.svc.backup();
FB.v.dbImport = async (input) => {
  const f = input.files[0]; if (!f) return;
  const text = await f.text();
  try {
    if (/\.csv$/i.test(f.name)) {
      const rows = FB.fromCSV(text);
      const col = 'imported_' + new Date().toISOString().slice(0, 10).replace(/-/g, '');
      rows.forEach((r) => FB.svc.addDoc(col, r));
      FB._ui.col = col;
      // ask AI to analyze
      const types = {};
      rows.slice(0, 50).forEach((r) => Object.entries(r).forEach(([k, v]) => { types[k] = types[k] || new Set(); types[k].add(Array.isArray(v) ? 'array' : typeof v); }));
      FB.openModal('<div class="modal-title">Data Agent — import analysis</div><p>Imported <b>' + rows.length + '</b> rows → <b>' + esc(col) + '</b></p><table class="tbl"><thead><tr><th>Field</th><th>Detected types</th></tr></thead><tbody>' + Object.entries(types).map(([k, s]) => '<tr><td class="mono">' + esc(k) + '</td><td>' + esc([...s].join(', ')) + '</td></tr>').join('') + '</tbody></table><div class="modal-actions"><button class="btn primary" onclick="FB.closeModal()">Done</button></div>');
      FB.log('database', 'info', 'CSV imported: ' + rows.length + ' rows → ' + col);
    } else FB.svc.importJSON(text);
    FB.markDirty(); FB.rerender();
  } catch (e) { FB.toast(e.message, 'err'); }
  input.value = '';
};
FB.v.rtPath = (v) => { FB._ui.rtPath = v; };
FB.v.rtSet = () => {
  const r = FB.parseJSONSafe($('#rtVal').value);
  if (!r.ok) { FB.toast('Invalid JSON: ' + r.error, 'err'); return; }
  FB.svc.rtSet(FB._ui.rtPath.trim(), r.value); FB.rerender();
};
FB.v.rtDel = () => { FB.svc.rtDel(FB._ui.rtPath.trim()); FB.rerender(); };
FB.v.rtBump = () => { const v = +FB.svc.rtGet('app.counters.visits') || 0; FB.svc.rtSet('app.counters.visits', v + 1); FB.rerender(); };

/* ═══ AUTH ═══════════════════════════════════════════════ */
FB.views.auth = (view) => {
  const users = FB.data.users;
  const provs = FB.data.authProviders || ['password'];
  view.innerHTML =
    '<div class="page-head"><div><h2>Authentication ' + badge('local') + '</h2><p class="muted">Email/password emulator + OAuth provider flags · ' + users.length + ' users</p></div>' +
    '<div class="row"><button class="btn small ghost" onclick="FB.v.authExport()">Export CSV</button></div></div>' +
    '<div class="grid two"><div class="card"><div class="card-h"><b>Register user</b></div>' +
    '<label class="fld"><span>Email</span><input id="auEmail" type="email" placeholder="user@example.com"></label>' +
    '<div class="grid two"><label class="fld"><span>Password (≥6)</span><input id="auPass" type="password" placeholder="••••••"></label>' +
    '<label class="fld"><span>Role</span><select id="auRole"><option value="user">user</option><option value="admin">admin</option></select></label></div>' +
    '<button class="btn primary" onclick="FB.v.authRegister()">Create user</button></div>' +
    '<div class="card"><div class="card-h"><b>Providers</b></div>' +
    ['password', 'google', 'github'].map((p) => '<label class="check"><input type="checkbox" ' + (provs.includes(p) ? 'checked' : '') + ' onchange="FB.v.authProv(\'' + p + '\',this.checked)"> ' + p + (p !== 'password' ? ' <span class="muted">(OAuth flag — real flow needs cloud backend)</span>' : ' <span class="muted">(emulated)</span>') + '</label>').join('') +
    '<div class="card-h" style="margin-top:1rem"><b>Try login</b></div><label class="fld"><span>Email</span><input id="liEmail" placeholder="admin@example.com"></label><label class="fld"><span>Password</span><input id="liPass" type="password" placeholder="admin123"></label><button class="btn" onclick="FB.v.authLogin()">Login / logout test</button><p class="muted" id="liOut"></p></div></div>' +
    '<div class="card"><div class="card-h"><b>All users</b></div><div class="toolbar"><input type="search" placeholder="Search email / name…" oninput="FB.v.userSearch(this.value)" value="' + esc(FB._ui.userQ) + '"></div><div class="table-wrap"><table class="tbl"><thead><tr><th>User</th><th>UID</th><th>Role</th><th>Status</th><th>Providers</th><th>Created</th><th>Last login</th><th></th></tr></thead><tbody>' +
    users.filter((u) => !FB._ui.userQ || (u.email + u.displayName + u.id).toLowerCase().includes(FB._ui.userQ.toLowerCase())).map((u) =>
      '<tr><td><b>' + esc(u.displayName) + '</b><br><span class="muted">' + esc(u.email) + '</span></td><td class="mono">' + esc(u.id) + '</td>' +
      '<td><select onchange="FB.svc.setUserRole(\'' + u.id + '\',this.value)"><option ' + (u.role === 'user' ? 'selected' : '') + '>user</option><option ' + (u.role === 'admin' ? 'selected' : '') + '>admin</option></select></td>' +
      '<td><span class="chip ' + (u.status === 'active' ? 'ok' : 'danger') + '">' + u.status + '</span></td><td>' + u.providers.join(', ') + '</td><td>' + FB.fmtTime(u.createdAt) + '</td><td>' + (u.lastLogin ? FB.fmtTime(u.lastLogin) : '—') + '</td>' +
      '<td><button class="btn small danger ghost" onclick="FB.svc.deleteUser(\'' + u.id + '\')">Delete</button></td></tr>').join('') +
    '</tbody></table></div></div>';
};
FB.v.authRegister = async () => {
  try { const u = await FB.svc.registerUser($('#auEmail').value, $('#auPass').value, '', $('#auRole').value); FB.notify('User created', u.email, 'ok'); FB.rerender(); }
  catch (e) { FB.toast(e.message, 'err'); }
};
FB.v.authLogin = async () => {
  try { const u = await FB.svc.loginUser($('#liEmail').value, $('#liPass').value); $('#liOut').textContent = '✓ ' + u.email + ' (' + u.role + ') — session created'; FB.rerender(); }
  catch (e) { $('#liOut').textContent = '✕ ' + e.message; }
};
FB.v.authProv = (p, on) => {
  let a = FB.data.authProviders || ['password'];
  a = on ? [...new Set([...a, p])] : a.filter((x) => x !== p);
  if (!a.length) a = ['password'];
  FB.data.authProviders = a; FB.markDirty(); FB.log('auth', 'info', 'Providers: ' + a.join(', '));
};
FB.v.userSearch = FB.debounce((v) => { FB._ui.userQ = v; FB.rerender({ keepScroll: true }); }, 300);
FB.v.authExport = () => FB.download(FB.currentId + '-users.csv', FB.toCSV(FB.data.users.map((u) => ({ id: u.id, email: u.email, displayName: u.displayName, role: u.role, status: u.status, createdAt: new Date(u.createdAt).toISOString() }))), 'text/csv');

/* ═══ USERS (directory view w/ same data, profile focus) ═ */
FB.views.users = (view) => {
  const q = FB._ui.userQ;
  const list = FB.data.users.filter((u) => !q || (u.email + u.displayName + u.id + u.role).toLowerCase().includes(q.toLowerCase()));
  view.innerHTML = '<div class="page-head"><div><h2>Users</h2><p class="muted">Profiles, IDs, roles, status — mirrors Authentication</p></div><div class="row"><input type="search" placeholder="Search users…" value="' + esc(q) + '" oninput="FB.v.userSearch(this.value)"></div></div>' +
    '<div class="grid cards">' + (list.map((u) => '<div class="card user-card"><div class="avatar">' + esc((u.displayName || u.email)[0].toUpperCase()) + '</div><div><b>' + esc(u.displayName) + '</b><div class="muted mono">' + esc(u.id) + '</div><div class="muted">' + esc(u.email) + '</div><div class="row" style="margin-top:.4rem"><span class="chip ' + (u.role === 'admin' ? 'warn' : '') + '">' + u.role + '</span><span class="chip ' + (u.status === 'active' ? 'ok' : 'danger') + '">' + u.status + '</span></div><div class="muted small">Created ' + FB.fmtTime(u.createdAt) + ' · Last login ' + (u.lastLogin ? FB.fmtTime(u.lastLogin) : 'never') + '</div></div><div class="row"><select onchange="FB.svc.setUserRole(\'' + u.id + '\',this.value)"><option ' + (u.role === 'user' ? 'selected' : '') + '>user</option><option ' + (u.role === 'admin' ? 'selected' : '') + '>admin</option></select><button class="btn small danger ghost" onclick="FB.svc.deleteUser(\'' + u.id + '\')">Delete</button></div></div>').join('') || empty('No users match', 'Try a different search.')) + '</div>';
};

/* ═══ STORAGE ════════════════════════════════════════════ */
FB.views.storage = (view) => {
  const q = FB._ui.fileQ.toLowerCase();
  const files = FB.data.files.filter((f) => !q || (f.path + f.type).toLowerCase().includes(q));
  const bytes = FB.data.files.reduce((a, f) => a + (+f.size || 0), 0);
  view.innerHTML =
    '<div class="page-head"><div><h2>Storage ' + badge('local') + '</h2><p class="muted">IndexedDB emulator · ' + FB.fmtBytes(bytes) + ' used · folders, previews, signed-local URLs</p></div>' +
    '<div class="row"><button class="btn small primary" onclick="document.getElementById(\'upFiles\').click()">Upload</button><input type="file" id="upFiles" multiple class="hidden" onchange="FB.v.upGo(this)"><button class="btn small ghost" onclick="FB.v.mkdir()">+ Folder</button><input type="search" placeholder="Search files…" value="' + esc(FB._ui.fileQ) + '" oninput="FB.v.fileSearch(this.value)"></div></div>' +
    '<div class="table-wrap card"><table class="tbl"><thead><tr><th>Name</th><th>Type</th><th>Size</th><th>Access</th><th>URL</th><th>Uploaded</th><th></th></tr></thead><tbody>' +
    (files.map((f) => '<tr><td>' + (f.type === 'folder' ? '📁 ' : '📄 ') + '<b>' + esc(f.path) + '</b></td><td class="mono">' + esc(f.type) + '</td><td>' + (f.type === 'folder' ? '—' : FB.fmtBytes(f.size)) + '</td><td><select onchange="FB.v.fileAccess(\'' + f.id + '\',this.value)"><option ' + (f.access === 'private' ? 'selected' : '') + '>private</option><option ' + (f.access === 'public' ? 'selected' : '') + '>public</option></select></td><td><button class="btn small ghost" onclick="FB.v.fileURL(\'' + f.id + '\')">Copy URL</button></td><td>' + FB.fmtTime(f.createdAt) + '</td><td class="row">' + (f.type !== 'folder' ? '<button class="btn small ghost" onclick="FB.v.filePreview(\'' + f.id + '\')">Preview</button>' : '') + '<button class="btn small ghost" onclick="FB.v.fileRename(\'' + f.id + '\')">Rename</button><button class="btn small danger ghost" onclick="FB.v.fileDel(\'' + f.id + '\')">Delete</button></td></tr>').join('') || '<tr><td colspan="7" class="muted">Empty — upload files or create a folder.</td></tr>') +
    '</tbody></table></div><div class="card"><div class="card-h"><b>Storage rules</b><span class="muted">enforced by simulator</span></div><textarea id="stRules" rows="3" class="mono">' + esc(FB.data.storageRules) + '</textarea><button class="btn small primary" onclick="FB.v.stRulesSave()">Save rules</button></div>';
};
FB.v.upGo = async (input) => { const folder = prompt('Upload into folder (blank = root, "public/…" = public):', ''); await FB.svc.uploadFiles(input.files, folder || ''); input.value = ''; FB.rerender(); };
FB.v.mkdir = async () => { const n = prompt('Folder name:', 'public/assets'); if (n) { try { FB.svc.mkdir(n); FB.rerender(); } catch (e) { FB.toast(e.message, 'err'); } } };
FB.v.fileSearch = FB.debounce((v) => { FB._ui.fileQ = v; FB.rerender({ keepScroll: true }); }, 300);
FB.v.fileAccess = (id, v) => { const f = FB.data.files.find((x) => x.id === id); if (f) { f.access = v; FB.markDirty(); FB.log('storage', 'info', f.path + ' → ' + v); } };
FB.v.fileURL = async (id) => { const f = FB.data.files.find((x) => x.id === id); const url = f.type === 'folder' ? 'local://storage/folder/' + f.path : await FB.svc.fileObjectURL(f); FB.copy(url || f.url); };
FB.v.fileRename = (id) => { const f = FB.data.files.find((x) => x.id === id); const n = prompt('New name:', f.name); if (n) { FB.svc.renameFile(id, n); FB.rerender(); } };
FB.v.fileDel = async (id) => { if (await FB.confirm('Delete file?', 'The stored blob will be removed.')) { await FB.svc.deleteFile(id); FB.rerender(); } };
FB.v.filePreview = async (id) => {
  const f = FB.data.files.find((x) => x.id === id);
  const url = await FB.svc.fileObjectURL(f);
  let body = '';
  if (/^image\//.test(f.type) && url) body = '<img src="' + url + '" style="max-width:100%;border-radius:8px">';
  else if (/text|json|javascript|css|html/.test(f.type) && url) { try { const t = await (await fetch(url)).text(); body = '<pre class="code">' + esc(t.slice(0, 5000)) + '</pre>'; } catch { body = '<p class="muted">Cannot preview.</p>'; } }
  else body = '<p class="muted">No inline preview for ' + esc(f.type) + '. <a href="' + url + '" download="' + esc(f.name) + '">Download</a></p>';
  FB.openModal('<div class="modal-title">' + esc(f.path) + ' <span class="muted">' + FB.fmtBytes(f.size) + '</span></div>' + body + '<div class="modal-actions"><button class="btn ghost" onclick="FB.closeModal()">Close</button></div>');
};
FB.v.stRulesSave = () => { FB.data.storageRules = $('#stRules').value; FB.markDirty(); FB.log('storage', 'info', 'Storage rules updated'); FB.toast('Storage rules saved', 'ok'); };

/* ═══ HOSTING ════════════════════════════════════════════ */
FB.views.hosting = (view) => {
  const d = FB.data;
  view.innerHTML =
    '<div class="page-head"><div><h2>Hosting ' + badge('local') + '</h2><p class="muted">Deploy console · preview + production environments · simulated URLs in local mode</p></div>' +
    '<div class="row"><button class="btn small primary" onclick="document.getElementById(\'depFiles\').click()">Deploy folder…</button><input type="file" id="depFiles" multiple webkitdirectory class="hidden" onchange="FB.v.deployGo(this)"> <button class="btn small ghost" onclick="FB.v.siteAdd()">+ Environment</button></div></div>' +
    '<div class="grid two"><div class="card"><div class="card-h"><b>Environments</b></div><ul class="timeline">' +
    (d.sites.map((s) => '<li><span class="lvl info">' + esc(s.env) + '</span><span><b>' + esc(s.name) + '</b><br><span class="mono muted">' + esc(s.url) + '</span></span><span class="row"><button class="btn small ghost" onclick="FB.copy(\'' + esc(s.url) + '\')">Copy</button></span></li>').join('') || '<li class="muted">No environments — add one.</li>') + '</ul>' +
    '<div class="card-h"><b>forgebase.json</b></div><pre class="code">' + esc(JSON.stringify({ hosting: { site: d.sites[0] ? d.sites[0].name : 'main', public: 'dist', ignore: ['node_modules'], rewrites: [{ source: '/api/**', function: 'api' }] }, projectId: FB.currentId }, null, 2)) + '</pre><button class="btn small ghost" onclick="FB.copy(document.querySelector(\'#view pre.code\').textContent)">Copy config</button></div>' +
    '<div class="card"><div class="card-h"><b>Deployment history</b></div><ul class="timeline">' +
    (d.deployments.map((x) => '<li><span class="lvl ' + (x.status === 'live' ? 'info' : 'warn') + '">' + x.status + '</span><span><b>' + esc(x.id) + '</b> · ' + x.env + ' · ' + x.files + ' files<br><span class="mono muted">' + esc(x.url) + '</span>' + (x.log ? '<details><summary>console</summary><pre class="code">' + esc(x.log.map((l) => l.msg).join('\n')) + '</pre></details>' : '') + '</span><span class="row"><button class="btn small ghost" onclick="FB.v.depPreview(\'' + x.id + '\')">Preview</button></span></li>').join('') || '<li class="muted">No deployments yet.</li>') + '</ul></div></div>';
};
FB.v.deployGo = async (input) => { try { await FB.svc.deployFiles(input.files, 'preview'); } catch (e) { FB.toast(e.message, 'err'); } input.value = ''; };
FB.v.siteAdd = () => { const n = prompt('Environment name:', 'staging'); if (n === null) return; const env = n === 'main' || n === 'production' ? 'production' : 'preview'; const s = FB.svc.createSite(n || 'preview', env); FB.notify('Environment added', s.url, 'ok'); FB.rerender(); };
FB.v.depPreview = (id) => { const dep = FB.data.deployments.find((x) => x.id === id); if (dep) FB.svc.previewDeployment(dep); };

/* ═══ FUNCTIONS ══════════════════════════════════════════ */
FB.views.functions = (view) => {
  const fns = FB.data.functions;
  if (!FB._ui.fnId || !fns.find((f) => f.id === FB._ui.fnId)) FB._ui.fnId = fns[0] && fns[0].id;
  const fn = fns.find((f) => f.id === FB._ui.fnId);
  const r = FB._ui.fnResult;
  view.innerHTML =
    '<div class="page-head"><div><h2>Functions ' + badge('local') + '</h2><p class="muted">Serverless JS/TS emulator — edit, test, env vars, deploy</p></div><div class="row"><button class="btn small primary" onclick="FB.v.fnCreate()">+ Function</button></div></div>' +
    '<div class="fn-layout"><div class="card"><div class="card-h"><b>Functions</b></div><ul class="collist">' +
    fns.map((f) => '<li class="' + (fn && f.id === fn.id ? 'active' : '') + '" onclick="FB.v.fnSelect(\'' + f.id + '\')">' + esc(f.name) + '<span class="chip ' + (f.status === 'deployed' ? 'ok' : 'warn') + '">' + f.status + '</span></li>').join('') + '</ul></div>' +
    (fn ? '<div class="card"><div class="card-h"><b class="mono">' + esc(fn.name) + '</b><span class="muted">' + fn.runtime + ' · ' + fn.trigger + ' · ' + fn.region + '</span><span class="row"><button class="btn small danger ghost" onclick="FB.v.fnDel()">Delete</button><button class="btn small primary" onclick="FB.v.fnDeploy()">Deploy</button></span></div>' +
    '<label class="fld"><span>Code (JavaScript)</span><textarea id="fnCode" class="mono" rows="14" spellcheck="false">' + esc(fn.code) + '</textarea></label>' +
    '<div class="row"><button class="btn small ghost" onclick="FB.v.fnSave()">Save</button><button class="btn small ghost" onclick="FB.v.fnFormat()">Format</button><span class="muted">Env: </span><input id="fnEnvK" placeholder="KEY" style="width:90px"><input id="fnEnvV" placeholder="value" style="width:120px"><button class="btn small ghost" onclick="FB.v.fnEnvAdd()">+ Env</button></div>' +
    '<div class="envlist">' + Object.entries(fn.env || {}).map(([k, v]) => '<span class="chip">' + esc(k) + '=' + esc(v) + ' <a href="#" onclick="FB.v.fnEnvDel(\'' + esc(k) + '\');return false">✕</a></span>').join('') + '</div>' +
    '<div class="card-h" style="margin-top:.6rem"><b>Test</b></div><label class="fld"><span>Payload (JSON: { query, body })</span><textarea id="fnPayload" rows="3" class="mono">{\n  "query": { "name": "Sara" },\n  "body": {}\n}</textarea></label>' +
    '<button class="btn primary" onclick="FB.v.fnRun()">▶ Run test</button>' +
    (r ? '<div class="card-h" style="margin-top:.6rem"><b>Result</b><span class="chip ' + (r.status < 400 ? 'ok' : 'danger') + '">' + r.status + ' · ' + r.ms + 'ms</span></div><pre class="code">' + esc(typeof r.out === 'string' ? r.out : JSON.stringify(r.out, null, 2)) + '</pre>' + (r.logs.length ? '<pre class="code muted">console:\n' + esc(r.logs.join('\n')) + '</pre>' : '') : '') +
    '</div>' : '<div class="card">' + empty('No functions', 'Create one to start.') + '</div>') + '</div>';
};
FB.v.fnSelect = (id) => { FB._ui.fnId = id; FB._ui.fnResult = null; FB.rerender(); };
FB.v.fnCreate = () => { const n = prompt('Function name (JS identifier):', 'helloWorld'); if (!n) return; try { const f = FB.svc.createFn(n.trim()); FB._ui.fnId = f.id; FB.rerender(); } catch (e) { FB.toast(e.message, 'err'); } };
FB.v.fnDel = () => FB.svc.deleteFn(FB._ui.fnId);
FB.v.fnSave = () => { const f = FB.data.functions.find((x) => x.id === FB._ui.fnId); f.code = $('#fnCode').value; f.updatedAt = Date.now(); f.status = 'draft'; FB.markDirty(); FB.log('functions', 'info', 'Saved ' + f.name); FB.toast('Saved', 'ok'); FB.rerender(); };
FB.v.fnFormat = () => { try { $('#fnCode').value = $('#fnCode').value.replace(/\s+$/gm, '').replace(/\n{3,}/g, '\n\n'); FB.toast('Formatted', 'ok'); } catch { /* ignore */ } };
FB.v.fnEnvAdd = () => { const f = FB.data.functions.find((x) => x.id === FB._ui.fnId); const k = $('#fnEnvK').value.trim(); if (!k) return; f.env[k] = $('#fnEnvV').value; FB.markDirty(); FB.rerender(); };
FB.v.fnEnvDel = (k) => { const f = FB.data.functions.find((x) => x.id === FB._ui.fnId); delete f.env[k]; FB.markDirty(); FB.rerender(); };
FB.v.fnRun = async () => {
  const f = FB.data.functions.find((x) => x.id === FB._ui.fnId);
  f.code = $('#fnCode').value;
  let payload = {}; try { payload = JSON.parse($('#fnPayload').value || '{}'); } catch { FB.toast('Bad payload JSON', 'err'); return; }
  FB._ui.fnResult = await FB.svc.runFn(f, payload);
  FB.markDirty(); FB.rerender();
};
FB.v.fnDeploy = () => { const f = FB.data.functions.find((x) => x.id === FB._ui.fnId); f.code = $('#fnCode').value; FB.svc.deployFn(f); };

/* ═══ API & SDK ══════════════════════════════════════════ */
FB.views.api = (view) => {
  const langs = ['javascript', 'typescript', 'python', 'react'];
  const L = FB._ui.sdkLang;
  view.innerHTML =
    '<div class="page-head"><div><h2>API & SDK</h2><p class="muted">Keys, REST endpoints, realtime, usage</p></div><div class="row"><button class="btn small primary" onclick="FB.v.keyCreate()">+ API key</button></div></div>' +
    '<div class="card"><div class="card-h"><b>Project configuration</b><button class="btn small ghost" onclick="FB.copy(JSON.stringify(FB.svc.projectConfig(FB.current()),null,2))">Copy JSON</button></div><pre class="code">' + esc(JSON.stringify(FB.svc.projectConfig(FB.current()), null, 2)) + '</pre></div>' +
    '<div class="grid two"><div class="card"><div class="card-h"><b>API keys</b></div><ul class="timeline">' +
    (FB.data.apiKeys.map((k) => '<li><span class="lvl info">key</span><span><b>' + esc(k.name) + '</b><br><span class="mono muted">' + esc(k.secret.slice(0, 12)) + '•••• · ' + k.requests + ' req</span></span><span class="row"><button class="btn small ghost" onclick="FB.copy(\'' + k.secret + '\')">Copy</button><button class="btn small danger ghost" onclick="FB.svc.revokeKey(\'' + k.id + '\')">Revoke</button></span></li>').join('') || '<li class="muted">No keys — create one.</li>') + '</ul></div>' +
    '<div class="card"><div class="card-h"><b>REST endpoints</b><span class="muted">local emulator paths</span></div><table class="tbl"><thead><tr><th>Method</th><th>Path</th><th>Auth</th></tr></thead><tbody>' +
    FB.data.endpoints.map((e) => '<tr><td><span class="chip">' + e.method + '</span></td><td class="mono">' + esc(e.path) + '<br><span class="muted">' + esc(e.desc) + '</span></td><td>' + (e.auth ? 'Bearer' : 'open') + '</td></tr>').join('') + '</tbody></table><p class="muted">Realtime: WebSocket <span class="mono">local://forgebase/' + FB.currentId + '/realtime</span> (emulated via live re-render; cloud mode uses real WS).</p></div></div>' +
    '<div class="card"><div class="card-h"><b>SDK snippets</b><span class="tabs">' + langs.map((l) => '<button class="tab ' + (l === L ? 'active' : '') + '" onclick="FB.v.sdkLang(\'' + l + '\')">' + l + '</button>').join('') + '</span><button class="btn small ghost" onclick="FB.copy(document.getElementById(\'sdkPre\').textContent)">Copy</button></div><pre class="code" id="sdkPre">' + esc(FB.svc.sdkSnippet(L)) + '</pre></div>';
};
FB.v.keyCreate = () => { const n = prompt('Key name:', 'Web client'); if (n === null) return; FB.svc.createKey(n || 'Client key'); FB.rerender(); };
FB.v.sdkLang = (l) => { FB._ui.sdkLang = l; FB.rerender(); };

/* ═══ SECURITY RULES ═════════════════════════════════════ */
FB.views.rules = (view) => {
  const s = FB._ui.ruleSim, errs = FB._ui.ruleErrs;
  view.innerHTML =
    '<div class="page-head"><div><h2>Security Rules</h2><p class="muted">Validate, simulate, then deploy — production deploy needs explicit approval</p></div><div class="row"><button class="btn small ghost" onclick="FB.v.rulesTemplate()">Templates</button><button class="btn small ghost" onclick="FB.v.rulesValidate()">Validate</button><button class="btn small primary" onclick="FB.v.rulesDeploy()">Deploy rules</button></div></div>' +
    (errs ? '<div class="card ' + (errs.length ? 'err-card' : 'ok-card') + '"><b>' + (errs.length ? errs.length + ' finding(s)' : '✓ No issues found') + '</b>' + (errs.map((e) => '<div class="mono">line ' + e.line + ': ' + esc(e.msg) + '</div>').join('')) + '</div>' : '') +
    '<div class="grid two"><div class="card"><div class="card-h"><b>firestore.rules</b><span class="chip ' + (FB.data.rules.deployed ? 'ok' : 'warn') + '">' + (FB.data.rules.deployed ? 'deployed' : 'unpublished changes') + '</span></div>' +
    '<textarea id="rulesText" class="mono" rows="22" spellcheck="false">' + esc(FB.data.rules.text) + '</textarea><div class="row"><button class="btn small ghost" onclick="FB.v.rulesSave()">Save draft</button><button class="btn small ghost" onclick="FB.v.rulesValidate()">Validate</button></div></div>' +
    '<div class="card"><div class="card-h"><b>Permission simulator</b></div>' +
    '<div class="grid two"><label class="fld"><span>Authed</span><select id="simAuthed"><option value="1"' + (s.authed ? ' selected' : '') + '>yes</option><option value="0"' + (!s.authed ? ' selected' : '') + '>no</option></select></label>' +
    '<label class="fld"><span>Role</span><select id="simRole"><option' + (s.role === 'user' ? ' selected' : '') + '>user</option><option' + (s.role === 'admin' ? ' selected' : '') + '>admin</option></select></label></div>' +
    '<label class="fld"><span>UID</span><input id="simUid" value="' + esc(s.uid) + '"></label>' +
    '<label class="fld"><span>Path</span><input id="simPath" value="' + esc(s.path) + '"></label>' +
    '<label class="fld"><span>Operation</span><select id="simOp"><option>read</option><option>write</option><option>update</option><option>delete</option></select></label>' +
    '<button class="btn primary" onclick="FB.v.rulesSim()">Run simulation</button><div id="simOut">' + (FB._ui.simOut || '<p class="muted">Result appears here.</p>') + '</div></div></div>';
  const op = $('#simOp'); if (op) op.value = s.op;
};
FB.v.rulesSave = () => { FB.data.rules.text = $('#rulesText').value; FB.data.rules.deployed = false; FB.markDirty(); FB.log('rules', 'info', 'Rules draft saved'); FB.toast('Draft saved', 'ok'); FB.rerender(); };
FB.v.rulesValidate = () => { FB.data.rules.text = $('#rulesText').value; FB._ui.ruleErrs = FB.svc.validateRules(FB.data.rules.text); FB.markDirty(); FB.rerender(); };
FB.v.rulesTemplate = () => {
  FB.openModal('<div class="modal-title">Rule templates</div><div class="row"><button class="btn ghost" onclick="FB.v.rulesTplGo(\'owner\')">Owner-only users</button><button class="btn ghost" onclick="FB.v.rulesTplGo(\'admin\')">Admin write / public read</button><button class="btn ghost" onclick="FB.v.rulesTplGo(\'locked\')">Locked down</button></div><div class="modal-actions"><button class="btn ghost" onclick="FB.closeModal()">Close</button></div>');
};
FB.v.rulesTplGo = (k) => {
  const t = {
    owner: 'rules_version = \'2\';\nservice cloud.firestore {\n  match /databases/{db}/documents {\n    match /users/{userId} {\n      allow read: if true;\n      allow write: if request.auth != null && request.auth.uid == userId;\n    }\n  }\n}',
    admin: 'rules_version = \'2\';\nservice cloud.firestore {\n  match /databases/{db}/documents {\n    match /{document=**} {\n      allow read: if true;\n      allow write: if request.auth != null && request.auth.token.role == \'admin\';\n    }\n  }\n}',
    locked: 'rules_version = \'2\';\nservice cloud.firestore {\n  match /databases/{db}/documents {\n    match /{document=**} {\n      allow read, write: if false;\n    }\n  }\n}',
  }[k];
  FB.data.rules.text = t; FB.data.rules.deployed = false; FB.closeModal(); FB.markDirty(); FB.rerender();
};
FB.v.rulesSim = () => {
  const s = { authed: $('#simAuthed').value === '1', role: $('#simRole').value, uid: $('#simUid').value.trim(), path: $('#simPath').value.trim(), op: $('#simOp').value };
  FB._ui.ruleSim = s;
  FB.data.rules.text = $('#rulesText') ? $('#rulesText').value : FB.data.rules.text;
  const r = FB.svc.simulateRules(s);
  FB._ui.simOut = '<div class="sim ' + (r.allow ? 'allow' : 'deny') + '">' + (r.allow ? '✓ ALLOW' : '✕ DENY') + ' <span class="muted">' + esc(s.op) + ' ' + esc(s.path) + '</span><ul>' + r.reasons.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul></div>';
  FB.log('rules', 'info', 'Simulate ' + s.op + ' ' + s.path + ' → ' + (r.allow ? 'ALLOW' : 'DENY'));
  FB.markDirty(); FB.rerender();
};
FB.v.rulesDeploy = async () => {
  if ($('#rulesText')) FB.data.rules.text = $('#rulesText').value;
  const errs = FB.svc.validateRules(FB.data.rules.text);
  FB._ui.ruleErrs = errs;
  if (errs.length) { FB.rerender(); FB.toast('Fix validation findings first', 'err'); return; }
  const ok = await FB.confirm('Deploy security rules to production?', 'This changes who can read/write your data. Review the diff in the editor first.');
  if (!ok) return;
  FB.data.rules.deployed = true; FB.data.rules.updatedAt = Date.now();
  FB.log('rules', 'warn', 'Rules deployed to production'); FB.markDirty(); FB.notify('Rules deployed', 'production', 'ok'); FB.rerender();
};

/* ═══ AI AGENTS ══════════════════════════════════════════ */
FB.views.agents = (view) => {
  const agents = FB.data.agents, lib = FB.ai.library();
  const sel = agents.find((a) => a.id === FB._ui.agentId) || agents[0];
  view.innerHTML =
    '<div class="page-head"><div><h2>AI Agents</h2><p class="muted">Autonomous dev agents with explicit permissions + approval for dangerous ops · execution timeline per run</p></div><div class="row"><button class="btn small primary" onclick="FB.v.agentNew()">+ New agent</button></div></div>' +
    '<div class="card"><div class="card-h"><b>Agent library</b><span class="muted">one-click add</span></div><div class="grid cards">' +
    lib.map((l) => '<div class="lib-card"><b>' + l.icon + ' ' + esc(l.name) + '</b><p class="muted">' + esc(l.desc) + '</p><p class="mono small">tools: ' + l.tools.join(', ') + '</p><button class="btn small ghost" onclick="FB.v.agentFromLib(\'' + l.key + '\')">Add</button></div>').join('') + '</div></div>' +
    '<div class="grid two"><div class="card"><div class="card-h"><b>My agents (' + agents.length + ')</b></div><ul class="collist">' +
    (agents.map((a) => '<li class="' + (sel && a.id === sel.id ? 'active' : '') + '" onclick="FB.v.agentSelect(\'' + a.id + '\')">' + esc(a.name) + '<span class="chip">' + esc(a.status) + '</span></li>').join('') || '<li class="muted">No agents yet — add from the library.</li>') + '</ul>' +
    '<div class="card-h" style="margin-top:1rem"><b>Agent workflow</b></div><label class="fld"><span>Goal (planner → coding → database → testing → security → deploy)</span><input id="wfGoal" value="' + esc(FB._ui.wfGoal) + '" placeholder="Build an e-commerce backend"></label><button class="btn primary" onclick="FB.v.wfRun()">Run workflow</button><div id="wfOut">' + (FB._ui.wfTimeline ? FB._ui.wfTimeline.map(wfLi).join('') : '') + '</div></div>' +
    (sel ? '<div class="card"><div class="card-h"><b>' + esc(sel.name) + '</b><span class="muted">' + esc(sel.model) + ' · max ' + sel.maxSteps + ' steps</span><button class="btn small danger ghost" onclick="FB.v.agentDel(\'' + sel.id + '\')">Delete</button></div>' +
    '<p class="muted">' + esc(sel.desc) + '</p><p><b>Permissions:</b> ' + Object.entries(sel.perms || {}).map(([k, v]) => '<span class="chip ' + (v === 'approval' ? 'warn' : v ? 'ok' : '') + '">' + esc(k) + (v === 'approval' ? ' (approval)' : '') + '</span>').join(' ') + '</p>' +
    '<label class="fld"><span>Task</span><input id="agentTask" value="' + esc(FB._ui.agentTask) + '" placeholder="Create a products collection with sample docs"></label><button class="btn primary" onclick="FB.v.agentRun()">Run agent</button><ul class="timeline" id="agentTl">' +
    sel.timeline.map((t) => '<li><span class="lvl ' + (t.st === 'error' ? 'err' : 'info') + '">' + (t.st === 'error' ? '✕' : '✓') + '</span><span><b>' + esc(t.step) + '</b> — ' + esc(t.detail) + '</span><time>' + FB.fmtTime(t.t) + '</time></li>').join('') + '</ul></div>'
      : '<div class="card">' + empty('No agent selected', '') + '</div>') + '</div>';
  function wfLi(t) { return '<li><span class="lvl ' + (t.st === 'error' ? 'err' : t.st === 'warn' ? 'warn' : t.st === 'running' ? 'warn' : 'info') + '">' + t.agent + '</span><span>' + esc(t.detail) + '</span></li>'; }
};
FB.v.agentFromLib = (key) => { const l = FB.ai.library().find((x) => x.key === key); const a = FB.ai.createAgent({ name: l.name, desc: l.desc, tools: l.tools, perms: l.perms, instructions: l.desc, maxSteps: 8, needApproval: true }); a.key = key; FB._ui.agentId = a.id; FB.markDirty(); FB.rerender(); };
FB.v.agentNew = () => {
  FB.openModal('<div class="modal-title">New agent</div><label class="fld"><span>Name</span><input id="naName" placeholder="QA Agent"></label><label class="fld"><span>Description</span><input id="naDesc" placeholder="What it does"></label><label class="fld"><span>System instructions</span><textarea id="naIns" rows="3" placeholder="You are…"></textarea></label><div class="grid two"><label class="fld"><span>Model</span><select id="naModel"><option>gpt-4o-mini</option><option>gemini-2.0-flash</option><option>claude-3-5-sonnet</option><option>qwen-2.5</option><option>deepseek-chat</option></select></label><label class="fld"><span>Max steps</span><input id="naSteps" type="number" value="8" min="1" max="25"></label></div><label class="check"><input type="checkbox" id="naAppr" checked> Require human approval for dangerous ops</label><div class="modal-actions"><button class="btn ghost" onclick="FB.closeModal()">Cancel</button><button class="btn primary" onclick="FB.v.agentNewGo()">Create</button></div>');
};
FB.v.agentNewGo = () => { const a = FB.ai.createAgent({ name: $('#naName').value || 'Untitled', desc: $('#naDesc').value, instructions: $('#naIns').value, model: $('#naModel').value, maxSteps: +$('#naSteps').value || 8, needApproval: $('#naAppr').checked, tools: ['readDb', 'writeDb'] }); FB._ui.agentId = a.id; FB.closeModal(); FB.rerender(); };
FB.v.agentSelect = (id) => { FB._ui.agentId = id; FB.rerender(); };
FB.v.agentDel = (id) => FB.ai.deleteAgent(id);
FB.v.agentRun = async () => {
  const a = FB.data.agents.find((x) => x.id === (FB._ui.agentId || (FB.data.agents[0] || {}).id));
  if (!a) return;
  const task = ($('#agentTask') || {}).value || FB._ui.agentTask || 'Audit project and report';
  FB._ui.agentTask = task;
  if (a.needApproval && /delet|drop|production|deploy/i.test(task)) { const ok = await FB.confirm('Approve agent task?', a.name + ' will run: ' + task); if (!ok) return; }
  await FB.ai.agentRun(a, task, () => { const tl = $('#agentTl'); if (tl) tl.innerHTML = a.timeline.map((t) => '<li><span class="lvl info">✓</span><span><b>' + esc(t.step) + '</b> — ' + esc(t.detail) + '</span></li>').join(''); });
  FB.rerender();
};
FB.v.wfRun = async () => {
  const goal = ($('#wfGoal') || {}).value || 'Build app';
  FB._ui.wfGoal = goal; FB._ui.wfTimeline = [];
  FB.rerender();
  await FB.ai.runWorkflow(goal, (tl) => { FB._ui.wfTimeline = tl.slice(); const o = $('#wfOut'); if (o) o.innerHTML = tl.map((t) => '<li><span class="lvl info">' + esc(t.agent) + '</span><span>' + esc(t.detail) + '</span></li>').join(''); });
  FB.rerender();
};

/* ═══ AI PROVIDERS ══════════════════════════════════════ */
FB.views.providers = (view) => {
  const c = FB.ai.getProviderCfg();
  const models = { 'openai-compatible': ['gpt-4o-mini', 'gpt-4o', 'o3-mini'], gemini: ['gemini-2.0-flash', 'gemini-1.5-pro'], anthropic: ['claude-3-5-sonnet', 'claude-3-5-haiku'], qwen: ['qwen-2.5-72b', 'qwen-max'], deepseek: ['deepseek-chat', 'deepseek-reasoner'], custom: ['custom-model'] };
  view.innerHTML =
    '<div class="page-head"><div><h2>AI Providers</h2><p class="muted">BYO keys · stored locally, never committed · backend proxy recommended for production</p></div><div class="row"><button class="btn small primary" onclick="FB.v.provTest()">Test connection</button></div></div>' +
    '<div id="provOut"></div><div class="grid two"><div class="card"><div class="card-h"><b>Configuration</b><span class="chip warn">key masked: ' + esc(FB.ai.maskedKey()) + '</span></div>' +
    '<div class="grid two"><label class="fld"><span>Provider</span><select id="pvP" onchange="FB.v.provP(this.value)">' + Object.keys(models).map((p) => '<option' + (c.provider === p ? ' selected' : '') + '>' + p + '</option>').join('') + '</select></label>' +
    '<label class="fld"><span>Model</span><select id="pvM">' + (models[c.provider] || models.custom).map((m) => '<option' + (c.model === m ? ' selected' : '') + '>' + m + '</option>').join('') + '</select></label></div>' +
    '<label class="fld"><span>API endpoint (OpenAI-compatible)</span><input id="pvE" value="' + esc(c.endpoint) + '" placeholder="https://api.openai.com/v1"></label>' +
    '<label class="fld"><span>API key (env var in production — never commit)</span><input id="pvK" type="password" placeholder="' + (c.key ? '•••• set — leave blank to keep' : 'sk-…') + '"></label>' +
    '<div class="grid two"><label class="fld"><span>Temperature</span><input id="pvT" type="number" step="0.1" min="0" max="2" value="' + c.temperature + '"></label><label class="fld"><span>Max tokens</span><input id="pvTok" type="number" value="' + c.maxTokens + '"></label></div>' +
    '<label class="fld"><span>System prompt</span><textarea id="pvS" rows="3">' + esc(c.system) + '</textarea></label>' +
    '<button class="btn primary" onclick="FB.v.provSave()">Save (local only)</button></div>' +
    '<div class="card"><div class="card-h"><b>Supported providers</b></div><table class="tbl"><thead><tr><th>Provider</th><th>Models</th><th>Endpoint</th></tr></thead><tbody>' +
    '<tr><td>OpenAI</td><td class="mono">gpt-4o-mini, gpt-4o</td><td class="mono">https://api.openai.com/v1</td></tr>' +
    '<tr><td>Google Gemini</td><td class="mono">gemini-2.0-flash</td><td class="mono">https://generativelanguage.googleapis.com/v1beta/openai/</td></tr>' +
    '<tr><td>Anthropic Claude</td><td class="mono">claude-3-5-sonnet</td><td class="mono">OpenAI-compat via proxy</td></tr>' +
    '<tr><td>Qwen</td><td class="mono">qwen-2.5-72b</td><td class="mono">https://dashscope-intl.aliyuncs.com/compatible-mode/v1</td></tr>' +
    '<tr><td>DeepSeek</td><td class="mono">deepseek-chat</td><td class="mono">https://api.deepseek.com/v1</td></tr>' +
    '<tr><td>Custom</td><td class="mono">any OpenAI-compatible</td><td class="mono">your proxy URL</td></tr>' +
    '</tbody></table><p class="muted">Without a key, the built-in local engine answers with full project context. Production: keep keys server-side behind <span class="mono">/api/ai/*</span> proxy.</p></div></div>';
};
FB.v.provP = (p) => { FB.ai.saveProviderCfg({ provider: p }); FB.rerender(); };
FB.v.provSave = () => {
  const cfg = { provider: $('#pvP').value, model: $('#pvM').value, endpoint: $('#pvE').value.trim(), temperature: +$('#pvT').value || 0.7, maxTokens: +$('#pvTok').value || 2048, system: $('#pvS').value };
  if ($('#pvK').value) cfg.key = $('#pvK').value.trim();
  FB.ai.saveProviderCfg(cfg); FB.notify('Provider saved', cfg.provider + ' / ' + cfg.model, 'ok'); FB.rerender();
};
FB.v.provTest = async () => {
  const o = $('#provOut'); o.innerHTML = '<div class="card"><p class="muted">Testing…</p></div>';
  const r = await FB.ai.testProvider();
  o.innerHTML = '<div class="card ' + (r.ok ? 'ok-card' : 'err-card') + '">' + esc(r.msg) + '</div>';
};

/* ═══ CODE EDITOR ═══════════════════════════════════════ */
function hl(code, lang) {
  let h = esc(code);
  if (lang === 'sql') h = h.replace(/\b(create|table|text|primary|key|unique|not|null|default|now|select|from|where|insert|into|values)\b/gi, '<span class="tk-k">$1</span>').replace(/(--[^\n]*)/g, '<span class="tk-c">$1</span>');
  else if (lang === 'css') h = h.replace(/([.#:]?[\w-]+)(\s*:)/g, '<span class="tk-k">$1</span>$2').replace(/(\/\*[\s\S]*?\*\/)/g, '<span class="tk-c">$1</span>');
  else h = h.replace(/(&quot;.*?&quot;|&#39;.*?&#39;|`.*?`|\/\/[^\n]*|\/\*[\s\S]*?\*\/)/g, '<span class="tk-s">$1</span>').replace(/\b(const|let|var|function|return|import|export|from|await|async|new|if|else|for|of|in|try|catch|throw|default|interface|type|extends)\b/g, '<span class="tk-k">$1</span>').replace(/\b(true|false|null|undefined|process|console|fetch|document|window)\b/g, '<span class="tk-f">$1</span>');
  return h;
}
FB.views.editor = (view) => {
  const files = FB.data.codeFiles;
  const names = Object.keys(files);
  if (!files[FB._ui.codeFile]) FB._ui.codeFile = names[0];
  const cur = FB._ui.codeFile, f = files[cur];
  view.innerHTML =
    '<div class="page-head"><div><h2>Code Editor</h2><p class="muted">JS · TS · HTML · CSS · JSON · Python · SQL · Rules — project files persist locally</p></div><div class="row"><button class="btn small ghost" onclick="FB.v.codeNew()">+ File</button><button class="btn small ghost" onclick="FB.v.codeAI()">✦ AI assist</button><button class="btn small primary" onclick="FB.v.codeRun()">▶ Run (JS)</button></div></div>' +
    '<div class="ed-layout"><div class="card files"><div class="card-h"><b>Explorer</b></div><ul class="collist">' +
    names.map((n) => '<li class="' + (n === cur ? 'active' : '') + '" onclick="FB.v.codeOpen(\'' + esc(n) + '\')"><span class="mono">' + esc(n) + '</span><span class="muted">' + files[n].lang + '</span></li>').join('') + '</ul></div>' +
    '<div class="card"><div class="card-h"><b class="mono">' + esc(cur) + '</b><span class="row"><button class="btn small ghost" onclick="FB.v.codeSave()">Save</button><button class="btn small ghost" onclick="FB.v.codeFmt()">Format</button><button class="btn small danger ghost" onclick="FB.v.codeDel()">Delete</button></span></div>' +
    '<textarea id="codeTa" class="mono" rows="16" spellcheck="false">' + esc(f.content) + '</textarea>' +
    '<div class="card-h"><b>Preview (highlighted)</b><span class="muted">read-only</span></div><pre class="code" id="codeHl">' + hl(f.content, f.lang) + '</pre><div id="codeOut"></div></div></div>' +
    '<div class="card"><div class="card-h"><b>Integrated terminal</b><span class="muted">same engine as Command Center</span></div><div class="term-out mini" id="edTermOut"></div><div class="term-in-row"><span class="term-ps">›</span><input id="edTermIn" placeholder="create collection users · run tests" onkeydown="if(event.key===\'Enter\'){FB.v.edTerm(this.value);this.value=\'\'}"></div></div>';
  const ta = $('#codeTa');
  ta.addEventListener('input', FB.debounce(() => { $('#codeHl').innerHTML = hl(ta.value, f.lang); }, 400));
};
FB.v.codeOpen = (n) => { const ta = $('#codeTa'); if (ta && FB.data.codeFiles[FB._ui.codeFile]) FB.data.codeFiles[FB._ui.codeFile].content = ta.value; FB._ui.codeFile = n; FB.markDirty(); FB.rerender(); };
FB.v.codeSave = () => { FB.data.codeFiles[FB._ui.codeFile].content = $('#codeTa').value; FB.markDirty(); FB.toast('Saved', 'ok'); FB.rerender(); };
FB.v.codeFmt = () => { const ta = $('#codeTa'); ta.value = ta.value.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n'); $('#codeHl').innerHTML = hl(ta.value, FB.data.codeFiles[FB._ui.codeFile].lang); };
FB.v.codeNew = () => { const n = prompt('File name:', 'utils.js'); if (!n) return; const lang = /\.sql$/.test(n) ? 'sql' : /\.css$/.test(n) ? 'css' : /\.py$/.test(n) ? 'python' : /\.json$/.test(n) ? 'json' : 'javascript'; FB.data.codeFiles[n] = { lang, content: '// ' + n + '\n' }; FB._ui.codeFile = n; FB.markDirty(); FB.rerender(); };
FB.v.codeDel = async () => { if (Object.keys(FB.data.codeFiles).length <= 1) { FB.toast('Keep at least one file', 'warn'); return; } if (await FB.confirm('Delete file?', FB._ui.codeFile)) { delete FB.data.codeFiles[FB._ui.codeFile]; FB._ui.codeFile = Object.keys(FB.data.codeFiles)[0]; FB.markDirty(); FB.rerender(); } };
FB.v.codeRun = async () => {
  const code = $('#codeTa').value, out = $('#codeOut');
  const logs = [];
  try {
    const fn = new Function('console', 'prompt', 'alert', code);
    fn({ log: (...a) => logs.push(a.map(String).join(' ')), warn: (...a) => logs.push('WARN ' + a.join(' ')), error: (...a) => logs.push('ERR ' + a.join(' ')) });
    out.innerHTML = '<pre class="code">▶ ran ok\n' + esc(logs.join('\n') || '(no output)') + '</pre>';
    FB.log('functions', 'info', 'Editor run ' + FB._ui.codeFile);
  } catch (e) { out.innerHTML = '<pre class="code err">' + esc(String(e.stack || e)) + '</pre>'; FB.log('functions', 'error', 'Editor error: ' + e.message); }
};
FB.v.codeAI = async () => {
  const code = $('#codeTa').value;
  const issues = [];
  if (/==[^=]/.test(code) && !/===/.test(code)) issues.push('Consider === instead of ==.');
  if (/var\s+\w/.test(code)) issues.push('Prefer const/let over var.');
  if (/eval\(/.test(code)) issues.push('Avoid eval() — security risk.');
  if (!issues.length) issues.push('No obvious issues. Add error handling around I/O and keep functions small.');
  FB.openModal('<div class="modal-title">✦ AI code review — ' + esc(FB._ui.codeFile) + '</div><ul>' + issues.map((i) => '<li>' + esc(i) + '</li>').join('') + '</ul><div class="modal-actions"><button class="btn primary" onclick="FB.closeModal()">Done</button></div>');
};
FB.v.edTerm = (cmd) => { const o = $('#edTermOut'); FB.cmd.exec(cmd, (l, c) => { o.innerHTML += '<div class="' + (c || '') + '">› ' + esc(cmd) + '<br>' + esc(l) + '</div>'; o.scrollTop = 1e6; }); };

/* ═══ ANALYTICS ═════════════════════════════════════════ */
FB.views.analytics = (view) => {
  const sum = (k) => FB.data.metrics[k].reduce((a, x) => a + x.v, 0);
  view.innerHTML = '<div class="page-head"><div><h2>Analytics</h2><p class="muted">requests · errors · active users · db ops · storage · function runs</p></div><div class="row"><button class="btn small ghost" onclick="FB.v.anExport()">Export CSV</button></div></div>' +
    '<div class="grid stats">' + statCard('Requests', FB.fmtNum(sum('req'))) + statCard('Errors', FB.fmtNum(sum('err'))) + statCard('Active users', FB.fmtNum(sum('dau'))) + statCard('DB ops', FB.fmtNum(sum('dbops'))) + statCard('Function runs', FB.fmtNum(sum('fn'))) + statCard('Storage', FB.fmtBytes(FB.data.files.reduce((a, f) => a + (+f.size || 0), 0))) + '</div>' +
    '<div class="grid two"><div class="card"><div class="card-h"><b>Requests vs errors</b></div><canvas id="chReq"></canvas></div><div class="card"><div class="card-h"><b>Active users</b></div><canvas data-chart="dau"></canvas></div><div class="card"><div class="card-h"><b>Database ops</b></div><canvas data-chart="dbops"></canvas></div><div class="card"><div class="card-h"><b>Function executions</b></div><canvas data-chart="fn"></canvas></div></div>';
  const c = $('#chReq');
  FB.chart(c, [{ data: FB.data.metrics.req.slice(-30) }, { data: FB.data.metrics.err.slice(-30) }], { fill: true });
  drawAllCharts();
};
FB.v.anExport = () => {
  const rows = FB.data.metrics.req.map((p, i) => ({ date: new Date(p.t).toISOString().slice(0, 10), requests: p.v, errors: (FB.data.metrics.err[i] || {}).v || 0, dau: (FB.data.metrics.dau[i] || {}).v || 0, dbops: (FB.data.metrics.dbops[i] || {}).v || 0, fn: (FB.data.metrics.fn[i] || {}).v || 0 }));
  FB.download(FB.currentId + '-analytics.csv', FB.toCSV(rows), 'text/csv');
};

/* ═══ LOGS ══════════════════════════════════════════════ */
FB.views.logs = (view) => {
  const svcs = ['all', 'auth', 'database', 'storage', 'hosting', 'functions', 'api', 'rules', 'agents', 'system'];
  let logs = FB.data.logs;
  if (FB._ui.logSvc !== 'all') logs = logs.filter((l) => l.service === FB._ui.logSvc);
  if (FB._ui.logLevel !== 'all') logs = logs.filter((l) => l.level === FB._ui.logLevel);
  if (FB._ui.logQ) logs = logs.filter((l) => (l.msg + l.service + (l.user || '')).toLowerCase().includes(FB._ui.logQ.toLowerCase()));
  logs = logs.slice(0, 200);
  view.innerHTML =
    '<div class="page-head"><div><h2>Logs & Monitoring</h2><p class="muted">app · auth · database · functions · hosting · api · ' + FB.data.logs.length + ' events</p></div><div class="row"><button class="btn small ghost" onclick="FB.v.logsExport()">Export JSON</button><button class="btn small danger ghost" onclick="FB.v.logsClear()">Clear</button></div></div>' +
    '<div class="card"><div class="toolbar"><select onchange="FB.v.logFilter(\'svc\',this.value)">' + svcs.map((s) => '<option' + (FB._ui.logSvc === s ? ' selected' : '') + '>' + s + '</option>').join('') + '</select>' +
    '<select onchange="FB.v.logFilter(\'level\',this.value)">' + ['all', 'info', 'warn', 'error'].map((s) => '<option' + (FB._ui.logLevel === s ? ' selected' : '') + '>' + s + '</option>').join('') + '</select>' +
    '<input type="search" placeholder="Filter message, user…" value="' + esc(FB._ui.logQ) + '" oninput="FB.v.logQ(this.value)"></div>' +
    '<div class="table-wrap"><table class="tbl"><thead><tr><th>Time</th><th>Service</th><th>Level</th><th>Event</th><th>User</th><th>Status</th></tr></thead><tbody>' +
    (logs.map((l) => '<tr><td class="mono">' + FB.fmtTimeFull(l.ts) + '</td><td>' + esc(l.service) + '</td><td><span class="lvl ' + l.level + '">' + l.level + '</span></td><td>' + esc(l.msg) + '</td><td class="mono">' + esc(l.user || '—') + '</td><td class="mono">' + (l.level === 'error' ? '500' : l.level === 'warn' ? '—' : '200') + '</td></tr>').join('') || '<tr><td colspan="6" class="muted">No events match.</td></tr>') + '</tbody></table></div></div>';
};
FB.v.logFilter = (k, v) => { if (k === 'svc') FB._ui.logSvc = v; else FB._ui.logLevel = v; FB.rerender(); };
FB.v.logQ = FB.debounce((v) => { FB._ui.logQ = v; FB.rerender({ keepScroll: true }); }, 300);
FB.v.logsExport = () => FB.download(FB.currentId + '-logs.json', JSON.stringify(FB.data.logs, null, 2), 'application/json');
FB.v.logsClear = async () => { if (await FB.confirm('Clear logs?', 'All local log events will be removed.')) { FB.data.logs = []; FB.markDirty(); FB.rerender(); } };

/* ═══ EXTENSIONS ════════════════════════════════════════ */
FB.views.extensions = (view) => {
  view.innerHTML = '<div class="page-head"><div><h2>Extensions</h2><p class="muted">One-click integrations (emulated locally)</p></div></div><div class="grid cards">' +
    FB.data.extensions.map((e) => '<div class="card"><div class="card-h"><b>' + esc(e.name) + '</b><label class="switch"><input type="checkbox" ' + (e.on ? 'checked' : '') + ' onchange="FB.v.extToggle(\'' + e.id + '\',this.checked)"><i></i></label></div><p class="muted">' + (e.on ? 'Enabled — events flow to this extension (simulated).' : 'Disabled.') + '</p></div>').join('') + '</div>';
};
FB.v.extToggle = (id, on) => { const e = FB.data.extensions.find((x) => x.id === id); e.on = on; FB.markDirty(); FB.log('system', 'info', 'Extension ' + e.name + ' ' + (on ? 'enabled' : 'disabled')); FB.toast(e.name + (on ? ' enabled' : ' disabled'), 'ok'); };

/* ═══ SETTINGS ══════════════════════════════════════════ */
FB.views.settings = (view) => {
  const p = FB.current(); if (!p) { view.innerHTML = empty('No project', ''); return; }
  view.innerHTML =
    '<div class="page-head"><div><h2>Project Settings</h2><p class="muted">' + esc(p.id) + ' · created ' + FB.fmtTimeFull(p.createdAt) + '</p></div></div>' +
    (FB.cloud ? FB.cloud.connHTML() : '') +
    '<div class="grid two"><div class="card"><div class="card-h"><b>General</b></div>' +
    '<label class="fld"><span>Project name</span><input id="setName" value="' + esc(p.name) + '"></label>' +
    '<label class="fld"><span>Description</span><input id="setDesc" value="' + esc(p.description || '') + '"></label>' +
    '<div class="grid two"><label class="fld"><span>Project ID (immutable)</span><input value="' + esc(p.id) + '" disabled></label><label class="fld"><span>Status</span><select id="setStatus"><option value="active"' + (p.status === 'active' ? ' selected' : '') + '>active</option><option value="archived"' + (p.status === 'archived' ? ' selected' : '') + '>archived</option></select></label></div>' +
    '<button class="btn primary" onclick="FB.v.setSave()">Save</button>' +
    '<div class="row" style="margin-top:.6rem"><button class="btn small ghost" onclick="FB.svc.duplicateProject(\'' + p.id + '\')">Duplicate</button><button class="btn small ghost" onclick="FB.v.setExport()">Export full backup</button></div></div>' +
    '<div class="card"><div class="card-h"><b>Configuration</b><button class="btn small ghost" onclick="FB.copy(JSON.stringify(FB.svc.projectConfig(FB.current()),null,2))">Copy</button></div><pre class="code">' + esc(JSON.stringify(FB.svc.projectConfig(p), null, 2)) + '</pre>' +
    '<div class="card-h"><b>Connection</b></div><p class="mono">endpoint: local://forgebase/' + esc(p.id) + '<br>realtime: local://forgebase/' + esc(p.id) + '/realtime<br>mode: <b>LOCAL EMULATOR</b> (IndexedDB + LocalStorage) — swap the adapter for cloud backends without changing views.</p></div></div>' +
    '<div class="card danger-zone"><div class="card-h"><b>⚠ ' + FB.t('danger') + '</b></div><div class="row"><button class="btn danger ghost" onclick="FB.svc.archiveProject(\'' + p.id + '\',' + (p.status !== 'archived') + ')">' + (p.status === 'archived' ? 'Unarchive' : 'Archive') + '</button><button class="btn danger" onclick="FB.svc.deleteProject(\'' + p.id + '\')">Delete project…</button></div><p class="muted">Delete requires typing the project ID. Destructive agent actions always ask first.</p></div>';
};
FB.v.setSave = async () => {
  const p = FB.current();
  p.name = $('#setName').value.trim() || p.name; p.description = $('#setDesc').value; p.status = $('#setStatus').value; p.activity = Date.now();
  await FB.store.set('projects', FB.projects);
  FB.renderProjectSelector(); FB.notify('Settings saved', p.name, 'ok'); FB.rerender();
};
FB.v.setExport = () => FB.download(FB.current().id + '-full-backup.json', JSON.stringify({ project: FB.current(), data: FB.data }, null, 2), 'application/json');
FB.v.newProject = async () => {
  const n = prompt('Project name:', 'My App');
  if (n) await FB.svc.createProject(n);
};

/* ═══ DOCS ══════════════════════════════════════════════ */
const DOCS = {
  overview: ['Platform overview', 'ForgeBase is a local-first Firebase-like console: projects, auth, database, storage, hosting, functions, rules, agents — all running on IndexedDB emulators until you attach cloud backends.', 'Pick a project → explore sections → ask the AI. Production swap = replace the storage adapter; views stay the same.'],
  auth: ['Authentication', 'Email/password emulator with roles (admin/user), provider flags (Google/GitHub), sessions, CSV export.', 'await FB.svc.registerUser(email, pass, name, role)\nawait FB.svc.loginUser(email, pass)', 'Never store real passwords in LocalStorage in production — use JWT/OAuth + hashed credentials server-side.'],
  database: ['Database', 'Firestore-style collections/documents (CRUD, search, sort, paginate, import/export, backup/restore) + Realtime JSON tree with dot-path reads/writes.', 'FB.svc.setDoc("products","p1",{name:"Keyboard",price:49.99})\nFB.svc.rtSet("app.counters.visits", 42)', 'Gate writes with Security Rules; validate imported JSON before restore.'],
  storage: ['Storage', 'IndexedDB blob store with folders, public/private access flags, previews, local URLs, storage-rules text.', 'await FB.svc.uploadFiles(fileList, "public/assets")', 'Serve via signed URLs in production (S3-compatible); never expose private blobs.'],
  hosting: ['Hosting', 'Deploy console: upload a folder (index.html previewable), preview/production environments, history, forgebase.json config.', 'Deploy folder… → pick folder → Preview → promote', 'Simulated URLs (*.forgebase.local) in local mode; real CDN in cloud mode.'],
  functions: ['Cloud Functions', 'HTTPS-triggered JS functions with editor, env vars, test runner (sandboxed), deploy status, logs.', 'export const helloWorld = async (req,res)=>{res.json({hello:"world"})}', 'Sandbox untrusted code server-side; cap execution time/memory.'],
  api: ['API & SDK', 'Per-project config, API keys (revocable), REST endpoint catalog, SDK snippets (JS/TS/Python/React), WS realtime path.', 'fetch(ENDPOINT+"/v1/collections/users/docs",{headers:{Authorization:"Bearer KEY"}})', 'Keys shown once — store in env vars; use a backend proxy in production.'],
  rules: ['Security Rules', 'Editor + validator + templates + simulator (uid/role/path/op → ALLOW/DENY) + approval-gated deploy.', 'match /users/{userId} {\n  allow read: if true;\n  allow write: if request.auth.uid == userId;\n}', 'Default-deny; least privilege; test every rule in the simulator.'],
  agents: ['AI Agents', 'Library (database/coding/security/testing/deploy/data), custom agents with tools/permissions/max-steps/memory, approval for dangerous ops, 6-stage workflows with timelines.', 'Run workflow: planner → coding → database → testing → security → deploy', 'Humans approve deletes, prod rules, prod deploys — always.'],
  providers: ['AI Providers', 'OpenAI / Gemini / Claude / Qwen / DeepSeek / custom OpenAI-compatible. BYO key + endpoint + temperature + tokens + system prompt.', 'POST {endpoint}/chat/completions {model, messages}', 'Keys stay local; production uses a server-side proxy.'],
};
FB.views.docs = (view, qs) => {
  const sec = qs.sec || FB._ui.docSec || 'overview';
  FB._ui.docSec = sec;
  const keys = Object.keys(DOCS);
  const d = DOCS[sec] || DOCS.overview;
  const COLS = FB.svc.listCollections();
  view.innerHTML =
    '<div class="page-head"><div><h2>Documentation</h2><p class="muted">Quick start · configuration · examples · API · security · AI explanations</p></div><div class="row"><input type="search" id="docSearch" placeholder="Search docs…" oninput="FB.v.docFind(this.value)"></div></div>' +
    '<div class="db-layout"><div class="card cols"><ul class="collist" id="docList">' + keys.map((k) => '<li class="' + (k === sec ? 'active' : '') + '" onclick="FB.go(\'docs?sec=' + k + '\')">' + esc(DOCS[k][0]) + '</li>').join('') + '</ul></div>' +
    '<div class="card"><div class="card-h"><b>' + esc(d[0]) + '</b><button class="btn small ghost" onclick="FB.v.docExplain(\'' + sec + '\')">✦ AI explain</button></div>' +
    '<h4>Description</h4><p>' + esc(d[1]) + '</p><h4>Quick start</h4><p>' + esc(d[1].split('.')[0]) + '. Open the matching sidebar section for this project.</p><h4>Configuration</h4><pre class="code">' + esc(JSON.stringify({ projectId: FB.currentId, collections: COLS, emulator: true }, null, 2)) + '</pre><h4>Example</h4><pre class="code">' + esc(d[2]) + '</pre><h4>Security considerations</h4><p>' + esc(d[3] || 'Follow least-privilege rules and review approvals.') + '</p><div id="docAI"></div></div></div>';
};
FB.v.docFind = (q) => {
  q = q.toLowerCase();
  $$('#docList li').forEach((li) => li.style.display = li.textContent.toLowerCase().includes(q) ? '' : 'none');
  const gs = $('#globalSearch'); if (gs && document.activeElement !== gs) { /* keep */ }
};
FB.v.docExplain = async (sec) => {
  const d = DOCS[sec];
  const r = await FB.ai.chat('Explain ' + d[0] + ' for my project in 3 bullets');
  $('#docAI').innerHTML = '<div class="card ok-card"><b>✦ AI explanation</b><p>' + esc(r.reply).slice(0, 900) + '</p></div>';
};

})();
