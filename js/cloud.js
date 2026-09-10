/* ══════════════════════════════════════════════════════════════
   ForgeBase · cloud.js — Cloud Mode adapter.
   LOCAL (default): IndexedDB emulator. CLOUD: real REST + WebSocket
   backend (server/). Overrides FB.svc transparently so ALL views
   work unchanged. Token in sessionStorage (never localStorage).
   ══════════════════════════════════════════════════════════════ */
'use strict';
window.FB = window.FB || {};
(function () {
const FB = window.FB;
const C = FB.cloud = { on: false, base: '', token: '', ws: null, email: '' };

try { C.base = localStorage.getItem('fb_cloud_base') || ''; } catch { /* ignore */ }
try { C.token = sessionStorage.getItem('fb_token') || ''; } catch { /* ignore */ }

/* ── transport ───────────────────────────────────────── */
C.api = async (path, opts) => {
  opts = opts || {};
  const headers = Object.assign({}, opts.headers || {});
  if (C.token) headers.Authorization = 'Bearer ' + C.token;
  const isForm = typeof FormData !== 'undefined' && opts.body instanceof FormData;
  if (!isForm && opts.body && typeof opts.body !== 'string') { headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(opts.body); }
  let r;
  try { r = await fetch(C.base.replace(/\/$/, '') + path, { ...opts, headers }); }
  catch { throw new Error('Server unreachable at ' + C.base); }
  let j = null;
  try { j = await r.json(); } catch { /* non-JSON */ }
  if (!r.ok) throw new Error((j && j.error) || ('HTTP ' + r.status));
  return j;
};
C.dl = (path) => C.base.replace(/\/$/, '') + path + (C.token ? (path.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(C.token) : '');
const P = (pid, rest) => '/api/projects/' + encodeURIComponent(pid) + rest;

/* ── connect / disconnect ────────────────────────────── */
C.connect = async (base, email, password) => {
  base = String(base || '').trim().replace(/\/$/, '');
  if (!/^https?:\/\//.test(base)) throw new Error('Server URL must start with http(s)://');
  C.base = base;
  const h = await (await fetch(base + '/api/health')).json().catch(() => null);
  if (!h || !h.ok) throw new Error('Not a ForgeBase server: ' + base);
  const r = await C.api('/api/auth/login', { method: 'POST', body: { email, password } });
  C.token = r.token; C.email = r.user.email;
  try { localStorage.setItem('fb_cloud_base', base); sessionStorage.setItem('fb_token', C.token); } catch { /* ignore */ }
  await C.enter();
  FB.notify('Connected to cloud', base + ' · ' + C.email, 'ok');
};
C.register = async (base, email, password, name) => {
  base = String(base || '').trim().replace(/\/$/, '');
  C.base = base;
  const r = await C.api('/api/auth/register', { method: 'POST', body: { email, password, displayName: name } });
  C.token = r.token; C.email = r.user.email;
  try { localStorage.setItem('fb_cloud_base', base); sessionStorage.setItem('fb_token', C.token); } catch { /* ignore */ }
  await C.enter();
  FB.notify('Account created' + (r.user.role === 'admin' ? ' (server admin)' : ''), C.email, 'ok');
};
C.disconnect = async () => {
  try { if (C.ws) C.ws.close(); } catch { /* ignore */ }
  C.ws = null; C.on = false; C.token = '';
  try { sessionStorage.removeItem('fb_token'); } catch { /* ignore */ }
  restoreLocal();
  await FB.loadAll();
  FB.renderProjectSelector(); setBadge(); FB.rerender();
  FB.notify('Disconnected', 'Back to LOCAL emulator', 'warn');
};

/* snapshot → local view-model shapes */
C.snapshot = async (pid) => {
  const s = await C.api(P(pid, '/snapshot'));
  s.users = s.users || [];
  return s;
};
C.enter = async () => {
  const list = await C.api('/api/projects');
  if (!list.projects.length) {
    const p = await C.api('/api/projects', { method: 'POST', body: { name: 'My App' } });
    list.projects.push({ ...p.project, createdAt: p.project.createdAt, activity: p.project.activity });
  }
  FB.projects = list.projects.map((p) => ({ ...p, env: 'cloud', region: p.region || 'auto' }));
  FB.currentId = FB.projects[0].id;
  FB.data = await C.snapshot(FB.currentId);
  C.on = true;
  patchSvc();
  setBadge();
  FB.renderProjectSelector(); FB.updateQuota(); FB.rerender();
  C.wsConnect();
  FB.logLocal && FB.logLocal('system', 'info', 'Cloud mode: ' + C.base);
};
C.switch = async (id) => {
  if (!FB.projects.find((p) => p.id === id)) return;
  FB.currentId = id;
  FB.data = await C.snapshot(id);
  FB.renderProjectSelector(); FB.updateQuota(); C.wsConnect(); FB.rerender();
};
C.wsConnect = () => {
  try { if (C.ws) C.ws.close(); } catch { /* ignore */ }
  if (!C.on || !C.token || !FB.currentId) return;
  try {
    const ws = new WebSocket(C.base.replace(/^http/, 'ws') + '/ws?token=' + encodeURIComponent(C.token) + '&project=' + encodeURIComponent(FB.currentId));
    C.ws = ws;
    ws.onmessage = () => C.debRefresh();
    ws.onclose = () => { if (C.on) setTimeout(() => C.wsConnect(), 4000); };
  } catch { /* offline */ }
};
C.debRefresh = FB.debounce(async () => {
  if (!C.on || !FB.currentId) return;
  try { FB.data = await C.snapshot(FB.currentId); FB.updateQuota(); FB.rerender({ keepScroll: true }); } catch { /* ignore */ }
}, 700);

function setBadge() {
  const b = document.getElementById('envBadge');
  if (!b) return;
  if (C.on) { b.textContent = 'CLOUD'; b.style.cssText = 'background:#0c2e1a;color:#4ade80;border-color:#16a34a'; b.title = C.base; }
  else { b.textContent = 'LOCAL'; b.style.cssText = ''; b.title = 'Local emulator mode'; }
}
C.setBadge = setBadge;

/* ── service overrides ───────────────────────────────── */
let orig = null;
window.addEventListener('unhandledrejection', (e) => {
  if (C.on && e && e.reason) FB.toast('Cloud: ' + String(e.reason.message || e.reason).slice(0, 160), 'err');
});
function patchSvc() {
  if (orig) return;
  orig = {
    svc: { ...FB.svc }, switchProject: FB.switchProject,
    projectConfig: FB.svc.projectConfig, sdkSnippet: FB.svc.sdkSnippet,
    fileObjectURL: FB.svc.fileObjectURL, log: FB.log, markDirty: FB.markDirty,
  };
  FB.markDirty = () => {}; // cloud persists server-side; don't overwrite local emulator cache
  FB.logLocal = FB.log;
  const S = FB.svc, pid = () => FB.currentId;

  // client logs also forwarded to server (fire-and-forget)
  FB.log = (service, level, msg, extra) => {
    orig.log(service, level, msg, extra);
    if (C.on && pid()) C.api(P(pid(), '/logs'), { method: 'POST', body: { service, level, msg } }).catch(() => {});
  };
  FB.switchProject = (id) => C.switch(id);

  S.projectConfig = (p) => ({ projectId: p.id, projectName: p.name, environment: 'cloud', region: p.region || 'auto', apiEndpoint: C.base + '/api/projects/' + p.id, wsEndpoint: C.base.replace(/^http/, 'ws') + '/ws?project=' + p.id, authDomain: p.id + '.forgebase.cloud', storageBucket: p.id, emulator: false, env: { FORGEBASE_PROJECT_ID: p.id, FORGEBASE_API_ENDPOINT: C.base + '/api/projects/' + p.id, FORGEBASE_EMULATOR: 'false' } });
  S.sdkSnippet = (lang) => {
    const key = 'YOUR_API_KEY';
    const ep = C.base + '/api/projects/' + pid();
    if (lang === 'python') return `import requests\nBASE = "${ep}"\nH = {"Authorization": "Bearer ${key}"}  # JWT or fb_live_* key\nprint(requests.get(BASE + "/collections/users/docs", headers=H).json())\n`;
    if (lang === 'typescript') return `const BASE = "${ep}";\nconst H = { Authorization: \`Bearer \${process.env.FORGEBASE_KEY}\` };\nconst docs = await (await fetch(BASE + "/collections/users/docs", { headers: H })).json();\n`;
    if (lang === 'react') return `const BASE = "${ep}";\n// REST fetch + WS live: new WebSocket(BASE.replace(/^http/,"ws") + "/ws?token=…&project=${pid()}")\n// onmessage(type=invalidate) → refetch. See docs.`;
    return `const BASE = "${ep}";\nconst docs = await (await fetch(BASE + "/collections/users/docs",\n  { headers: { Authorization: "Bearer ${key}" } })).json();\nconsole.log(docs);`;
  };

  /* projects */
  S.createProject = async (name, opts) => {
    const r = await C.api('/api/projects', { method: 'POST', body: { name: name || 'Untitled', description: (opts && opts.description) || '' } });
    const list = await C.api('/api/projects');
    FB.projects = list.projects.map((p) => ({ ...p, env: 'cloud' }));
    await C.switch(r.project.id);
    FB.renderProjectSelector(); FB.notify('Project created', r.project.id, 'ok');
    return FB.current();
  };
  S.duplicateProject = async (id) => { await C.api(P(id, '/duplicate'), { method: 'POST' }); const l = await C.api('/api/projects'); FB.projects = l.projects.map((p) => ({ ...p, env: 'cloud' })); FB.renderProjectSelector(); FB.rerender(); };
  S.renameProject = async (id, name) => { await C.api(P(id, ''), { method: 'PATCH', body: { name } }); FB.projects.find((x) => x.id === id).name = name; FB.renderProjectSelector(); FB.rerender(); };
  S.archiveProject = async (id, arch) => { await C.api(P(id, ''), { method: 'PATCH', body: { status: arch ? 'archived' : 'active' } }); FB.projects.find((x) => x.id === id).status = arch ? 'archived' : 'active'; FB.renderProjectSelector(); FB.rerender(); };
  S.deleteProject = async (id) => {
    const p = FB.projects.find((x) => x.id === id);
    if (!await FB.confirm('Delete project?', p.name + ' and ALL server data will be removed.', { requireText: p.id })) return false;
    await C.api(P(id, ''), { method: 'DELETE' });
    const l = await C.api('/api/projects');
    FB.projects = l.projects.map((x) => ({ ...x, env: 'cloud' }));
    if (FB.projects.length) await C.switch(FB.projects[0].id); else { C.disconnect(); return true; }
    FB.renderProjectSelector(); FB.rerender(); return true;
  };

  /* auth */
  S.registerUser = async (email, pass, dn, role, provs) => {
    // server registers (password-hashed); role applied by admin after
    const tmp = await fetch(C.base + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: pass, displayName: dn }) });
    if (!tmp.ok) throw new Error((await tmp.json().catch(() => ({}))).error || 'Register failed');
    if (role === 'admin' || (provs && provs.length > 1)) { /* admin adjusts below */ }
    await C.debRefreshNow();
    const u = FB.data.users.find((x) => x.email === String(email).toLowerCase());
    if (u && role === 'admin') await S.setUserRole(u.id, 'admin');
    return u;
  };
  S.loginUser = async (email, pass) => {
    const r = await C.api('/api/auth/login', { method: 'POST', body: { email, password: pass } });
    await C.debRefreshNow();
    return FB.data.users.find((x) => x.email === String(email).toLowerCase());
  };
  S.deleteUser = async (id) => {
    const u = FB.data.users.find((x) => x.id === id);
    if (!await FB.confirm('Delete user?', (u && u.email) + ' will lose access.')) return;
    await C.api('/api/users/' + id, { method: 'DELETE' });
    await C.debRefreshNow(); FB.rerender();
  };
  S.setUserRole = async (id, role) => { await C.api('/api/users/' + id, { method: 'PUT', body: { role } }); await C.debRefreshNow(); FB.rerender(); };

  /* database */
  S.listCollections = () => Object.keys(FB.data.collections || {});
  S.createCollection = async (name) => { await C.api(P(pid(), '/collections'), { method: 'POST', body: { name } }); await C.debRefreshNow(); };
  S.deleteCollection = async (name) => {
    if (!await FB.confirm('Delete collection?', name + ' and all documents (server-side).')) return;
    await C.api(P(pid(), '/collections/' + encodeURIComponent(name)), { method: 'DELETE' });
    await C.debRefreshNow(); FB.rerender();
  };
  S.listDocs = (col, o) => {
    // paginated server-side in views? keep client-shape: fetch sync impossible → use cache + background refresh
    const c = FB.data.collections[col];
    if (!c) return { docs: [], total: 0, pages: 1 };
    let docs = Object.values(c.docs);
    o = o || {};
    if (o.search) { const q = o.search.toLowerCase(); docs = docs.filter((d) => (d.id + ' ' + JSON.stringify(d.data)).toLowerCase().includes(q)); }
    const key = o.sortKey || 'updatedAt', dir = o.sortDir === 'asc' ? 1 : -1;
    docs.sort((a, b) => { const av = key === 'id' ? a.id : (a.data[key] !== undefined ? a.data[key] : a[key]); const bv = key === 'id' ? b.id : (b.data[key] !== undefined ? b.data[key] : b[key]); if (av === bv) return 0; if (av == null) return 1; if (bv == null) return -1; return (av > bv ? 1 : -1) * dir; });
    const per = o.per || 10, pages = Math.max(1, Math.ceil(docs.length / per)), page = Math.max(1, Math.min(pages, o.page || 1));
    return { docs: docs.slice((page - 1) * per, page * per), total: docs.length, pages, page, per };
  };
  S.setDoc = async (col, id, data) => { await C.api(P(pid(), '/collections/' + encodeURIComponent(col) + '/docs/' + encodeURIComponent(id)), { method: 'PUT', body: { data } }); await C.debRefreshNow(); return { id, data }; };
  S.addDoc = async (col, data) => { const r = await C.api(P(pid(), '/collections/' + encodeURIComponent(col) + '/docs'), { method: 'POST', body: { data } }); await C.debRefreshNow(); return { id: r.id, data }; };
  S.deleteDoc = async (col, id) => { await C.api(P(pid(), '/collections/' + encodeURIComponent(col) + '/docs/' + encodeURIComponent(id)), { method: 'DELETE' }); await C.debRefreshNow(); };
  S.exportJSON = () => JSON.stringify({ projectId: pid(), exportedAt: new Date().toISOString(), collections: FB.data.collections, realtime: FB.data.rtDoc }, null, 2);
  S.importJSON = async (text) => {
    const r = FB.parseJSONSafe(text);
    if (!r.ok) throw new Error('Invalid JSON: ' + r.error);
    if (r.value.collections) { await C.api(P(pid(), '/restore'), { method: 'POST', body: r.value }); }
    else if (Array.isArray(r.value)) { for (const doc of r.value) await C.api(P(pid(), '/collections/imported/docs'), { method: 'POST', body: { data: doc } }); }
    else throw new Error('Need "collections" or doc array');
    await C.debRefreshNow();
  };
  S.backup = async () => { const b = await C.api(P(pid(), '/backup')); FB.download(pid() + '-backup.json', JSON.stringify(b, null, 2), 'application/json'); };
  S.restore = async (text) => { const r = FB.parseJSONSafe(text); if (!r.ok || !r.value.collections) throw new Error('Not a backup'); await C.api(P(pid(), '/restore'), { method: 'POST', body: r.value }); await C.debRefreshNow(); };
  S.rtGet = (path) => (path ? FB.getPath(FB.data.rtDoc, path, undefined) : FB.data.rtDoc);
  S.rtSet = async (path, val) => { await C.api(P(pid(), '/realtime') + (path ? '?path=' + encodeURIComponent(path) : ''), { method: 'PUT', body: { value: val } }); };
  S.rtDel = async (path) => { await C.api(P(pid(), '/realtime') + (path ? '?path=' + encodeURIComponent(path) : ''), { method: 'DELETE' }); };

  /* storage */
  S.uploadFiles = async (list, folder) => {
    const fd = new FormData();
    for (const f of Array.from(list || [])) fd.append('files', f, f.name);
    if (folder) fd.append('folder', folder);
    await C.api(P(pid(), '/files'), { method: 'POST', body: fd });
    await C.debRefreshNow();
  };
  S.mkdir = async (name) => { await C.api(P(pid(), '/files/mkdir'), { method: 'POST', body: { name } }); await C.debRefreshNow(); };
  S.renameFile = async (id, name) => { await C.api(P(pid(), '/files/' + id), { method: 'PATCH', body: { name } }); await C.debRefreshNow(); };
  S.deleteFile = async (id) => { await C.api(P(pid(), '/files/' + id), { method: 'DELETE' }); await C.debRefreshNow(); };
  S.fileObjectURL = async (meta) => {
    if (meta.type === 'folder') return null;
    return C.base + P(pid(), '/files/' + meta.id + '/download') + '?token=' + encodeURIComponent(C.token);
  };

  /* hosting */
  S.hostingURL = (p) => C.base + '/pub/' + p.id;
  S.createSite = async (name, env) => {
    const sites = (await C.api(P(pid(), '/kv/sites')).catch(() => ({ value: null }))).value || [];
    const s = { id: FB.uid('site'), name: name || 'main', env: env || 'preview', url: C.base + '/pub/' + pid(), createdAt: Date.now() };
    sites.unshift(s);
    await C.api(P(pid(), '/kv/sites'), { method: 'PUT', body: { value: sites } });
    await C.debRefreshNow(); return s;
  };
  S.deployFiles = async (list, env) => {
    const fd = new FormData();
    for (const f of Array.from(list || [])) fd.append('files', f, f.webkitRelativePath || f.name);
    fd.append('env', env || 'preview');
    const r = await C.api(P(pid(), '/deploy'), { method: 'POST', body: fd });
    r.deployment.url = C.base + r.deployment.url;
    await C.debRefreshNow(); FB.rerender(); return r.deployment;
  };
  S.previewDeployment = async (dep) => {
    FB.openModal('<div class="modal-title">Preview — ' + FB.esc(dep.id) + '</div><iframe src="' + C.base + dep.url + '" sandbox="allow-scripts" style="width:100%;height:60vh;border:1px solid var(--border);border-radius:10px;background:#fff"></iframe><div class="modal-actions"><button class="btn ghost" onclick="FB.closeModal()">Close</button></div>');
  };

  /* functions */
  S.createFn = async (name) => { const r = await C.api(P(pid(), '/functions'), { method: 'POST', body: { name } }); await C.debRefreshNow(); return r.fn; };
  S.deleteFn = async (id) => {
    if (!await FB.confirm('Delete function?', 'Removed server-side.')) return;
    await C.api(P(pid(), '/functions/' + id), { method: 'DELETE' });
    await C.debRefreshNow(); FB.rerender();
  };
  S.runFn = async (fn, payload) => {
    await C.api(P(pid(), '/functions/' + fn.id), { method: 'PUT', body: { code: fn.code, env: fn.env || {}, status: fn.status } }).catch(() => {});
    return C.api(P(pid(), '/functions/' + fn.id + '/run'), { method: 'POST', body: payload || {} });
  };
  S.deployFn = async (fn) => {
    await C.api(P(pid(), '/functions/' + fn.id), { method: 'PUT', body: { code: fn.code, env: fn.env || {}, status: 'deployed' } });
    await C.debRefreshNow(); FB.rerender();
  };

  /* api keys */
  S.createKey = async (name) => {
    const r = await C.api(P(pid(), '/keys'), { method: 'POST', body: { name: name || 'Client key' } });
    FB.copy(r.key.secret);
    FB.notify('API key created — secret copied (shown once)', r.key.name, 'ok');
    await C.debRefreshNow(); return { ...r.key, secret: '(copied)' };
  };
  S.revokeKey = async (id) => {
    if (!await FB.confirm('Revoke API key?', 'It stops working immediately.')) return;
    await C.api(P(pid(), '/keys/' + id), { method: 'DELETE' });
    await C.debRefreshNow(); FB.rerender();
  };

  /* rules */
  S.validateRules = orig.svc.validateRules;
  S.simulateRules = orig.svc.simulateRules;
}
C.debRefreshNow = async () => { if (C.on && FB.currentId) { try { FB.data = await C.snapshot(FB.currentId); FB.updateQuota(); } catch (e) { FB.toast(e.message, 'err'); } } };

function restoreLocal() {
  if (!orig) return;
  Object.assign(FB.svc, orig.svc);
  FB.switchProject = orig.switchProject;
  FB.log = orig.log;
  FB.markDirty = orig.markDirty;
  delete FB.logLocal;
  orig = null;
}

/* kv helpers for agents/code/providers (views call these in cloud mode) */
C.kvGet = (key) => C.api(P(FB.currentId, '/kv/' + key)).then((r) => r.value);
C.kvPut = (key, value) => C.api(P(FB.currentId, '/kv/' + key), { method: 'PUT', body: { value } }).then(() => C.debRefreshNow());

/* ── connection card (Settings) ──────────────────────── */
C.connHTML = () => {
  if (C.on) {
    const ws = C.ws && C.ws.readyState === 1;
    return `<div class="card" style="border-color:var(--ok)"><div class="card-h"><b>☁ Cloud connection</b><span class="chip ok">CONNECTED${ws ? ' · live' : ''}</span></div>
    <p class="mono">${FB.esc(C.base)} · ${FB.esc(C.email)}</p>
    <p class="muted">Real backend: Postgres/SQLite · JWT auth · WebSocket realtime · disk/S3 storage · sandboxed functions · server-side AI proxy. All edits hit the server; other clients update live.</p>
    <div class="row"><button class="btn small danger ghost" onclick="FB.v.connOff()">Disconnect (back to local)</button>
    <button class="btn small ghost" onclick="FB.cloud.debRefreshNow().then(()=>FB.rerender())">↻ Sync now</button></div></div>`;
  }
  return `<div class="card"><div class="card-h"><b>☁ Cloud connection</b><span class="chip warn">LOCAL EMULATOR</span></div>
    <p class="muted">Run the real backend (<span class="mono">node server/server.js</span>) then connect. First registered account becomes server admin.</p>
    <label class="fld"><span>Server URL</span><input id="cxBase" value="${FB.esc(C.base || 'http://localhost:8080')}" placeholder="http://localhost:8080"></label>
    <div class="grid two"><label class="fld"><span>Email</span><input id="cxEmail" placeholder="admin@example.com"></label>
    <label class="fld"><span>Password</span><input id="cxPass" type="password" placeholder="••••••"></label></div>
    <div class="row"><button class="btn primary" onclick="FB.v.connGo()">Connect</button>
    <button class="btn ghost" onclick="FB.v.connReg()">Register new account</button></div></div>`;
};
FB.v = FB.v || {};
FB.v.connGo = async () => {
  try { await C.connect(document.getElementById('cxBase').value, document.getElementById('cxEmail').value, document.getElementById('cxPass').value); }
  catch (e) { FB.toast(e.message, 'err'); }
};
FB.v.connReg = async () => {
  try { await C.register(document.getElementById('cxBase').value, document.getElementById('cxEmail').value, document.getElementById('cxPass').value); }
  catch (e) { FB.toast(e.message, 'err'); }
};
FB.v.connOff = () => C.disconnect();

/* auto-resume session (same tab) */
C.tryResume = async () => {
  if (!C.base || !C.token) return false;
  try {
    await C.api('/api/me');
    await C.enter();
    return true;
  } catch { C.token = ''; try { sessionStorage.removeItem('fb_token'); } catch { /* ignore */ } return false; }
};

})();
