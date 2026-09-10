/* ══════════════════════════════════════════════════════════════
   ForgeBase · services.js — project/auth/database/storage/
   hosting/functions/API/rules business logic (local emulator).
   ══════════════════════════════════════════════════════════════ */
'use strict';
window.FB = window.FB || {};
(function () {
const FB = window.FB;
FB.svc = {};

/* ── projects ──────────────────────────────────────────── */
FB.svc.slug = (name) => String(name || 'project').toLowerCase().trim().replace(/[^a-z0-9\u0600-\u06FF]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || ('proj-' + Date.now().toString(36));
FB.svc.createProject = async (name, opts) => {
  const id = FB.svc.slug(name) + (FB.projects.some((p) => p.id === FB.svc.slug(name)) ? '-' + Date.now().toString(36).slice(-4) : '');
  const p = { id, name: name || id, status: 'active', env: 'local', region: 'local', description: (opts && opts.description) || '', createdAt: Date.now(), activity: Date.now() };
  FB.projects.unshift(p);
  await FB.store.set(FB.pkey(id, 'data'), FB.defaultData(p));
  await FB.store.set('projects', FB.projects);
  await FB.switchProject(id);
  FB.notify('Project created', p.name + ' · ' + p.id, 'ok');
  return p;
};
FB.svc.duplicateProject = async (id) => {
  const src = FB.projects.find((p) => p.id === id); if (!src) return;
  const data = await FB.store.get(FB.pkey(id, 'data'), FB.defaultData(src));
  const copy = { id: src.id + '-copy-' + Date.now().toString(36).slice(-4), name: src.name + ' (copy)', status: 'active', env: 'local', region: 'local', description: src.description || '', createdAt: Date.now(), activity: Date.now() };
  FB.projects.unshift(copy);
  await FB.store.set(FB.pkey(copy.id, 'data'), FB.clone(data));
  await FB.store.set('projects', FB.projects);
  FB.renderProjectSelector(); FB.notify('Project duplicated', copy.name, 'ok'); FB.rerender();
};
FB.svc.renameProject = async (id, name) => {
  const p = FB.projects.find((x) => x.id === id); if (!p || !name.trim()) return;
  p.name = name.trim(); p.activity = Date.now();
  await FB.store.set('projects', FB.projects); FB.renderProjectSelector(); FB.rerender();
  FB.toast('Project renamed', 'ok');
};
FB.svc.archiveProject = async (id, arch) => {
  const p = FB.projects.find((x) => x.id === id); if (!p) return;
  p.status = arch ? 'archived' : 'active'; p.activity = Date.now();
  await FB.store.set('projects', FB.projects); FB.renderProjectSelector(); FB.rerender();
};
FB.svc.deleteProject = async (id) => {
  const p = FB.projects.find((x) => x.id === id); if (!p) return false;
  const ok = await FB.confirm('Delete project?', p.name + ' (' + p.id + ') and ALL its local data will be permanently removed.', { requireText: p.id });
  if (!ok) return false;
  FB.projects = FB.projects.filter((x) => x.id !== id);
  try { await FB.store.set(FB.pkey(id, 'data'), null); } catch { /* ignore */ }
  await FB.store.set('projects', FB.projects);
  if (FB.currentId === id) { FB.currentId = FB.projects.length ? FB.projects[0].id : null; await FB.store.set('currentId', FB.currentId); if (FB.currentId) FB.data = await FB.store.get(FB.pkey(FB.currentId, 'data'), null); }
  FB.renderProjectSelector(); FB.notify('Project deleted', p.name, 'warn'); FB.rerender();
  return true;
};
FB.svc.projectConfig = (p) => ({
  projectId: p.id, projectName: p.name, environment: p.env || 'local', region: p.region || 'local',
  apiEndpoint: 'local://forgebase/' + p.id, wsEndpoint: 'local://forgebase/' + p.id + '/realtime',
  authDomain: p.id + '.forgebase.local', storageBucket: p.id + '.appspot.local',
  emulator: true,
  env: { FORGEBASE_PROJECT_ID: p.id, FORGEBASE_API_ENDPOINT: 'local://forgebase/' + p.id, FORGEBASE_EMULATOR: 'true' },
});

/* ── auth ──────────────────────────────────────────────── */
const emailOk = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || ''));
FB.svc.registerUser = async (email, pass, displayName, role, providers) => {
  email = String(email || '').trim().toLowerCase();
  if (!emailOk(email)) throw new Error('Invalid email address');
  if (!pass || pass.length < 6) throw new Error('Password must be at least 6 characters');
  if (FB.data.users.some((u) => u.email === email)) throw new Error('Email already registered');
  const u = { id: FB.uid('u'), email, pass, displayName: displayName || email.split('@')[0], role: role === 'admin' ? 'admin' : 'user', status: 'active', providers: providers && providers.length ? providers : ['password'], createdAt: Date.now(), lastLogin: null };
  FB.data.users.unshift(u);
  if (!FB.data.collections.users) FB.data.collections.users = { docs: {}, createdAt: Date.now() };
  FB.data.collections.users.docs[u.id] = { id: u.id, data: { email: u.email, displayName: u.displayName, role: u.role }, createdAt: Date.now(), updatedAt: Date.now() };
  FB.log('auth', 'info', 'Registered ' + email, { user: u.id });
  FB.bumpMetric('dau', 1); FB.markDirty();
  return u;
};
FB.svc.loginUser = async (email, pass) => {
  email = String(email || '').trim().toLowerCase();
  const u = FB.data.users.find((x) => x.email === email);
  if (!u) throw new Error('No account for this email');
  if (u.status !== 'active') throw new Error('Account is ' + u.status);
  if (u.pass !== pass) { FB.log('auth', 'warn', 'Failed login ' + email); throw new Error('Wrong password'); }
  u.lastLogin = Date.now();
  FB.data.sessions.unshift({ id: FB.uid('s'), userId: u.id, createdAt: Date.now() });
  FB.log('auth', 'info', 'Login success ' + email, { user: u.id });
  FB.bumpMetric('dau', 1); FB.markDirty();
  return u;
};
FB.svc.deleteUser = async (id) => {
  const u = FB.data.users.find((x) => x.id === id); if (!u) return;
  const ok = await FB.confirm('Delete user?', u.email + ' will lose access immediately.');
  if (!ok) return;
  FB.data.users = FB.data.users.filter((x) => x.id !== id);
  if (FB.data.collections.users && FB.data.collections.users.docs[id]) delete FB.data.collections.users.docs[id];
  FB.log('auth', 'warn', 'Deleted user ' + u.email); FB.markDirty(); FB.rerender();
};
FB.svc.setUserRole = async (id, role) => {
  const u = FB.data.users.find((x) => x.id === id); if (!u) return;
  u.role = role === 'admin' ? 'admin' : 'user';
  const d = FB.data.collections.users && FB.data.collections.users.docs[id];
  if (d) { d.data.role = u.role; d.updatedAt = Date.now(); }
  FB.log('auth', 'info', 'Role ' + u.email + ' → ' + u.role); FB.markDirty(); FB.rerender();
};

/* ── database (Firestore-style + realtime JSON) ────────── */
FB.svc.listCollections = () => Object.keys(FB.data.collections || {});
FB.svc.createCollection = (name) => {
  name = String(name || '').trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error('Collection name must match [A-Za-z_][A-Za-z0-9_]*');
  if (FB.data.collections[name]) throw new Error('Collection already exists');
  FB.data.collections[name] = { docs: {}, createdAt: Date.now() };
  FB.log('database', 'info', 'CREATE collection ' + name); FB.bumpMetric('dbops', 1); FB.markDirty();
};
FB.svc.deleteCollection = async (name) => {
  const ok = await FB.confirm('Delete collection?', name + ' and all its documents will be removed.');
  if (!ok) return;
  delete FB.data.collections[name];
  FB.log('database', 'warn', 'DELETE collection ' + name); FB.markDirty(); FB.rerender();
};
FB.svc.listDocs = (col, o) => {
  o = o || {};
  const c = FB.data.collections[col]; if (!c) return { docs: [], total: 0, pages: 1 };
  let docs = Object.values(c.docs);
  if (o.search) { const q = o.search.toLowerCase(); docs = docs.filter((d) => (d.id + ' ' + JSON.stringify(d.data)).toLowerCase().includes(q)); }
  const key = o.sortKey || 'updatedAt', dir = o.sortDir === 'asc' ? 1 : -1;
  docs.sort((a, b) => {
    const av = key === 'id' ? a.id : (a.data[key] !== undefined ? a.data[key] : a[key]);
    const bv = key === 'id' ? b.id : (b.data[key] !== undefined ? b.data[key] : b[key]);
    if (av === bv) return 0; if (av == null) return 1; if (bv == null) return -1;
    return (av > bv ? 1 : -1) * dir;
  });
  const total = docs.length, per = Math.max(1, Math.min(100, o.per || 10)), pages = Math.max(1, Math.ceil(total / per));
  const page = Math.max(1, Math.min(pages, o.page || 1));
  return { docs: docs.slice((page - 1) * per, page * per), total, pages, page, per };
};
FB.svc.setDoc = (col, id, data) => {
  if (!FB.data.collections[col]) FB.data.collections[col] = { docs: {}, createdAt: Date.now() };
  const c = FB.data.collections[col];
  const now = Date.now();
  const rec = c.docs[id] || { id, createdAt: now };
  rec.data = data; rec.updatedAt = now; c.docs[id] = rec;
  FB.log('database', 'info', 'WRITE ' + col + '/' + id); FB.bumpMetric('dbops', 1); FB.markDirty();
  return rec;
};
FB.svc.addDoc = (col, data) => FB.svc.setDoc(col, 'doc_' + Math.random().toString(36).slice(2, 9), data);
FB.svc.deleteDoc = (col, id) => {
  const c = FB.data.collections[col]; if (c && c.docs[id]) { delete c.docs[id]; FB.log('database', 'warn', 'DELETE ' + col + '/' + id); FB.bumpMetric('dbops', 1); FB.markDirty(); }
};
FB.svc.exportJSON = () => JSON.stringify({ projectId: FB.currentId, exportedAt: new Date().toISOString(), collections: FB.data.collections, realtime: FB.data.rtDoc }, null, 2);
FB.svc.importJSON = (text) => {
  const r = FB.parseJSONSafe(text);
  if (!r.ok) throw new Error('Invalid JSON: ' + r.error);
  const v = r.value;
  if (v.collections && typeof v.collections === 'object') {
    for (const [name, col] of Object.entries(v.collections)) {
      if (!FB.data.collections[name]) FB.data.collections[name] = { docs: {}, createdAt: Date.now() };
      const docs = col.docs || col;
      for (const [id, d] of Object.entries(docs)) FB.data.collections[name].docs[id] = { id, data: d.data || d, createdAt: d.createdAt || Date.now(), updatedAt: Date.now() };
    }
  } else if (Array.isArray(v)) {
    if (!FB.data.collections.imported) FB.data.collections.imported = { docs: {}, createdAt: Date.now() };
    v.forEach((row, i) => { const id = 'row_' + i + '_' + Math.random().toString(36).slice(2, 6); FB.data.collections.imported.docs[id] = { id, data: row, createdAt: Date.now(), updatedAt: Date.now() }; });
  } else throw new Error('JSON must contain "collections" or be an array of documents');
  FB.log('database', 'info', 'Imported JSON'); FB.bumpMetric('dbops', 5); FB.markDirty();
};
FB.svc.backup = () => { FB.download(FB.currentId + '-backup-' + new Date().toISOString().slice(0, 10) + '.json', FB.svc.exportJSON(), 'application/json'); FB.log('database', 'info', 'Backup downloaded'); };
FB.svc.restore = (text) => {
  const r = FB.parseJSONSafe(text);
  if (!r.ok) throw new Error('Invalid backup: ' + r.error);
  if (!r.value.collections) throw new Error('Not a ForgeBase backup (missing collections)');
  FB.data.collections = r.value.collections;
  if (r.value.realtime) FB.data.rtDoc = r.value.realtime;
  FB.log('database', 'warn', 'Database restored from backup'); FB.markDirty();
};
/* realtime JSON doc */
FB.svc.rtGet = (path) => (path ? FB.getPath(FB.data.rtDoc, path, undefined) : FB.data.rtDoc);
FB.svc.rtSet = (path, val) => { if (!path) { FB.data.rtDoc = val; } else FB.setPath(FB.data.rtDoc, path, val); FB.log('database', 'info', 'RT WRITE ' + (path || '/')); FB.bumpMetric('dbops', 1); FB.markDirty(); };
FB.svc.rtDel = (path) => {
  if (!path) { FB.data.rtDoc = {}; FB.markDirty(); return; }
  const ks = path.split('.'); let o = FB.data.rtDoc;
  for (let i = 0; i < ks.length - 1; i++) { o = o ? o[ks[i]] : null; if (!o) return; }
  delete o[ks[ks.length - 1]]; FB.log('database', 'warn', 'RT DELETE ' + path); FB.markDirty();
};

/* ── storage (IndexedDB blobs + meta) ──────────────────── */
FB.svc.uploadFiles = async (fileList, folder) => {
  folder = (folder || '').replace(/^\/+|\/+$/g, '');
  for (const f of Array.from(fileList || [])) {
    const id = FB.uid('f');
    const buf = await f.arrayBuffer();
    await FB.store.filePut({ id, blob: new Blob([buf], { type: f.type }), type: f.type });
    FB.data.files.unshift({ id, name: f.name, path: (folder ? folder + '/' : '') + f.name, size: f.size, type: f.type || 'application/octet-stream', access: folder.startsWith('public') ? 'public' : 'private', createdAt: Date.now(), url: 'local://storage/' + id });
  }
  FB.log('storage', 'info', 'Uploaded ' + (fileList || []).length + ' file(s)'); FB.markDirty();
};
FB.svc.mkdir = (name) => {
  name = String(name || '').trim().replace(/^\/+|\/+$/g, '');
  if (!name) throw new Error('Folder name required');
  FB.data.files.unshift({ id: FB.uid('d'), name, path: name, size: 0, type: 'folder', access: 'private', createdAt: Date.now(), url: '' });
  FB.log('storage', 'info', 'Created folder ' + name); FB.markDirty();
};
FB.svc.renameFile = (id, name) => {
  const f = FB.data.files.find((x) => x.id === id); if (!f) return;
  const dir = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/') + 1) : '';
  f.name = name; f.path = dir + name; FB.log('storage', 'info', 'Renamed to ' + name); FB.markDirty();
};
FB.svc.deleteFile = async (id) => {
  const f = FB.data.files.find((x) => x.id === id); if (!f) return;
  FB.data.files = FB.data.files.filter((x) => x.id !== id);
  try { await FB.store.fileDel(id); } catch { /* ignore */ }
  FB.log('storage', 'warn', 'Deleted ' + f.path); FB.markDirty();
};
FB.svc.fileObjectURL = async (meta) => {
  if (meta.type === 'folder') return null;
  const rec = await FB.store.fileGet(meta.id);
  if (rec && rec.blob) return URL.createObjectURL(rec.blob);
  return meta.url || null;
};

/* ── hosting ───────────────────────────────────────────── */
FB.svc.hostingURL = (p) => 'https://' + p.id + '.forgebase.local';
FB.svc.createSite = (name, env) => {
  const s = { id: FB.uid('site'), name: name || 'main', env: env || 'preview', url: FB.svc.hostingURL(FB.current()) + (env === 'preview' ? '/preview/' + Date.now().toString(36) : ''), createdAt: Date.now() };
  FB.data.sites.unshift(s); FB.markDirty(); return s;
};
FB.svc.deployFiles = async (fileList, env) => {
  const files = Array.from(fileList || []);
  if (!files.length) throw new Error('No files selected');
  const dep = { id: FB.uid('dep'), env: env || 'preview', status: 'building', url: FB.svc.hostingURL(FB.current()), createdAt: Date.now(), files: files.length, log: [] };
  FB.data.deployments.unshift(dep); FB.log('hosting', 'info', 'Deploy started (' + files.length + ' files → ' + dep.env + ')'); FB.rerender();
  const steps = ['Resolving project ' + FB.currentId + '…', 'Uploading ' + files.length + ' file(s)…', 'Generating forgebase.json…', 'Optimizing assets…', 'Activating deployment…'];
  for (const s of steps) { dep.log.push({ t: Date.now(), msg: s }); FB.rerender({ keepScroll: true }); await FB.sleep(380); }
  // store file blobs for preview
  dep.assets = [];
  for (const f of files) { const buf = await f.arrayBuffer(); const aid = FB.uid('a'); try { await FB.store.filePut({ id: aid, blob: new Blob([buf], { type: f.type }), type: f.type }); } catch { /* ignore */ } dep.assets.push({ id: aid, name: (f.webkitRelativePath || f.name), size: f.size, type: f.type }); }
  const htmlAsset = dep.assets.find((a) => /index\.html?$/.test(a.name)) || dep.assets.find((a) => /\.html?$/.test(a.name));
  dep.entryId = htmlAsset ? htmlAsset.id : (dep.assets[0] && dep.assets[0].id);
  dep.status = 'live';
  dep.log.push({ t: Date.now(), msg: '✓ Live at ' + dep.url });
  FB.log('hosting', 'info', 'Deploy live → ' + dep.url); FB.markDirty(); FB.rerender();
  return dep;
};
FB.svc.previewDeployment = async (dep) => {
  if (!dep.entryId) { FB.toast('No previewable entry (upload an index.html)', 'warn'); return; }
  const rec = await FB.store.fileGet(dep.entryId);
  if (!rec || !rec.blob) { FB.toast('Preview blob missing', 'err'); return; }
  const url = URL.createObjectURL(rec.blob);
  FB.openModal('<div class="modal-title">Preview — ' + FB.esc(dep.id) + ' <span class="chip ok">' + FB.esc(dep.status) + '</span></div>' +
    '<iframe src="' + url + '" sandbox="allow-scripts" style="width:100%;height:60vh;border:1px solid var(--border);border-radius:10px;background:#fff"></iframe>' +
    '<div class="modal-actions"><button class="btn ghost" onclick="FB.closeModal()">Close</button></div>');
};

/* ── functions ─────────────────────────────────────────── */
const FN_TEMPLATE = (name) => "export const " + name + " = async (req, res) => {\n  // req: { query, body, headers } — res: { json(obj), send(text), status(code) }\n  const name = (req.query && req.query.name) || 'world';\n  res.json({ hello: name, fn: '" + name + "', at: new Date().toISOString() });\n};\n";
FB.svc.createFn = (name) => {
  name = String(name || '').trim();
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) throw new Error('Function name must be a valid JS identifier');
  if (FB.data.functions.some((f) => f.name === name)) throw new Error('Function already exists');
  const fn = { id: FB.uid('fn'), name, runtime: 'nodejs20', trigger: 'https', region: 'auto', code: FN_TEMPLATE(name), env: {}, status: 'draft', updatedAt: Date.now() };
  FB.data.functions.unshift(fn); FB.log('functions', 'info', 'Created function ' + name); FB.markDirty(); return fn;
};
FB.svc.deleteFn = async (id) => {
  const f = FB.data.functions.find((x) => x.id === id); if (!f) return;
  const ok = await FB.confirm('Delete function?', f.name + ' will be removed.');
  if (!ok) return;
  FB.data.functions = FB.data.functions.filter((x) => x.id !== id);
  FB.log('functions', 'warn', 'Deleted function ' + f.name); FB.markDirty(); FB.rerender();
};
FB.svc.runFn = async (fn, payload) => {
  const t0 = performance.now();
  const req = { query: (payload && payload.query) || {}, body: (payload && payload.body) || {}, headers: {} };
  let out = null, status = 200;
  const res = { json: (o) => { out = o; }, send: (t) => { out = t; }, status: (c) => { status = c; return res; } };
  const logs = [];
  const sandboxConsole = { log: (...a) => logs.push(a.map(String).join(' ')), warn: (...a) => logs.push('WARN ' + a.map(String).join(' ')), error: (...a) => logs.push('ERROR ' + a.map(String).join(' ')) };
  try {
    const clean = String(fn.code).replace(/export\s+default\s+/g, '').replace(/export\s+(?=const|let|var|function|async\s+function|class)/g, '');
    const factory = new Function('exports', 'console', 'req', 'res', clean + '\n;return exports["' + fn.name + '"] || exports.default || (typeof ' + fn.name + ' !== "undefined" ? ' + fn.name + ' : null);');
    const handler = factory({}, sandboxConsole, req, res);
    if (typeof handler !== 'function') throw new Error('No exported handler named "' + fn.name + '" found');
    await handler(req, res);
    if (out === null) out = '(no response sent)';
  } catch (e) { status = 500; out = { error: String(e.message || e) }; }
  const ms = Math.round(performance.now() + Math.random() * 40 + 8);
  const result = { fn: fn.name, status, ms, out, logs, at: Date.now() };
  FB.log('functions', status === 500 ? 'error' : 'info', fn.name + ' → ' + status + ' in ' + ms + 'ms');
  FB.bumpMetric('fn', 1); FB.bumpMetric('req', 1); if (status === 500) FB.bumpMetric('err', 1);
  return result;
};
FB.svc.deployFn = async (fn) => {
  fn.status = 'deploying'; FB.rerender();
  await FB.sleep(700);
  const r = FB.parseJSONSafe; void r;
  fn.status = 'deployed'; fn.updatedAt = Date.now();
  FB.log('functions', 'info', 'Deployed ' + fn.name); FB.markDirty(); FB.rerender();
};

/* ── API & SDK ─────────────────────────────────────────── */
FB.svc.createKey = (name) => {
  const k = { id: FB.uid('key'), name: name || 'Client key', prefix: 'fb_live', secret: 'fb_live_' + Math.random().toString(36).slice(2, 18) + Math.random().toString(36).slice(2, 10), createdAt: Date.now(), lastUsed: null, requests: 0 };
  FB.data.apiKeys.unshift(k); FB.log('api', 'info', 'API key created: ' + k.name); FB.markDirty(); return k;
};
FB.svc.revokeKey = async (id) => {
  const k = FB.data.apiKeys.find((x) => x.id === id); if (!k) return;
  const ok = await FB.confirm('Revoke API key?', k.name + ' will stop working immediately.');
  if (!ok) return;
  FB.data.apiKeys = FB.data.apiKeys.filter((x) => x.id !== id);
  FB.log('api', 'warn', 'API key revoked: ' + k.name); FB.markDirty(); FB.rerender();
};
FB.svc.sdkSnippet = (lang) => {
  const p = FB.current(), cfg = FB.svc.projectConfig(p);
  const key = (FB.data.apiKeys[0] && FB.data.apiKeys[0].secret) || 'YOUR_API_KEY';
  if (lang === 'python') return '"""ForgeBase Python SDK — ' + p.name + '"""\nimport requests\n\nPROJECT_ID = "' + p.id + '"\nAPI_KEY = "' + key + '"  # keep in env vars, never commit\nBASE = "' + cfg.apiEndpoint + '"\n\ndef list_docs(collection):\n    r = requests.get(f"{BASE}/v1/collections/{collection}/docs",\n                     headers={"Authorization": f"Bearer {API_KEY}"})\n    r.raise_for_status()\n    return r.json()\n\nprint(list_docs("users"))\n';
  if (lang === 'typescript') return '// ForgeBase TypeScript SDK — ' + p.name + '\nconst config = {\n  projectId: "' + p.id + '",\n  apiKey: process.env.FORGEBASE_API_KEY!, // never hardcode\n  endpoint: "' + cfg.apiEndpoint + '",\n};\n\ninterface Doc<T> { id: string; data: T; updatedAt: number }\n\nasync function listDocs<T>(col: string): Promise<Doc<T>[]> {\n  const r = await fetch(`${config.endpoint}/v1/collections/${col}/docs`, {\n    headers: { Authorization: `Bearer ${config.apiKey}` },\n  });\n  if (!r.ok) throw new Error(`API ${r.status}`);\n  return r.json();\n}\n';
  if (lang === 'react') return '// React hook — ' + p.name + '\nimport { useEffect, useState } from "react";\n\nconst ENDPOINT = "' + cfg.apiEndpoint + '";\nconst API_KEY = import.meta.env.VITE_FORGEBASE_KEY; // env var!\n\nexport function useCollection(col: string) {\n  const [docs, setDocs] = useState([]);\n  useEffect(() => {\n    fetch(`${ENDPOINT}/v1/collections/${col}/docs`, {\n      headers: { Authorization: `Bearer ${API_KEY}` },\n    }).then((r) => r.json()).then(setDocs);\n    const ws = new WebSocket("' + cfg.wsEndpoint + '");\n    ws.onmessage = (e) => {\n      const evt = JSON.parse(e.data);\n      if (evt.collection === col) setDocs(evt.docs);\n    };\n    return () => ws.close();\n  }, [col]);\n  return docs;\n}\n';
  return '// ForgeBase Web SDK — ' + p.name + '\nimport { ForgeBase } from "https://cdn.forgebase.local/sdk.js";\n\nconst app = ForgeBase.initializeApp({\n  projectId: "' + p.id + '",\n  apiKey: "' + key + '", // use env vars in production\n  authDomain: "' + cfg.authDomain + '",\n});\n\nconst users = await app.db.collection("users").list();\nconsole.log(users);\n\napp.db.collection("users").onSnapshot((docs) => {\n  console.log("realtime:", docs.length);\n});\n';
};

/* ── security rules: validator + simulator ─────────────── */
FB.svc.validateRules = (text) => {
  const errs = [];
  if (!/rules_version\s*=\s*['"]2['"]/.test(text)) errs.push({ line: 1, msg: 'Missing rules_version = \'2\';' });
  const opens = (text.match(/{/g) || []).length, closes = (text.match(/}/g) || []).length;
  if (opens !== closes) errs.push({ line: text.split('\n').length, msg: 'Unbalanced braces: ' + opens + ' { vs ' + closes + ' }' });
  const bad = ['eval(', 'Function(', 'while(true)', 'allow read, write: if true; // open'];
  bad.forEach((b) => { const i = text.indexOf(b); if (i >= 0) errs.push({ line: text.slice(0, i).split('\n').length, msg: 'Suspicious pattern: ' + b }); });
  if (/allow\s+(read|write):\s*if\s+true\s*;/.test(text)) errs.push({ line: text.split('\n').findIndex((l) => /allow\s+(read|write):\s*if\s+true/.test(l)) + 1, msg: 'Overly permissive rule: allow … if true (public access)' });
  return errs;
};
FB.svc.simulateRules = (sim) => {
  // sim: {authed, uid, role, path, op}
  const text = FB.data.rules.text;
  const reasons = [];
  const isOwnerDoc = /users\/\{userId\}/.test(text) && sim.path.startsWith('users/') && sim.uid && sim.path === 'users/' + sim.uid;
  const hasAuthGate = /request\.auth\s*!=\s*null/.test(text);
  const publicRead = /match\s+\/users\/\{userId\}[\s\S]{0,300}?allow\s+read:\s*if\s+true/.test(text);
  let allow = false;
  if (sim.op === 'read' && publicRead && sim.path.startsWith('users/')) { allow = true; reasons.push('Public read rule on /users/{userId}'); }
  else if (!sim.authed && hasAuthGate) { allow = false; reasons.push('Denied: request.auth == null but rules require authentication'); }
  else if (isOwnerDoc && sim.authed) { allow = subOpAllowed(sim.op, true); reasons.push('Owner rule: uid matches document'); }
  else if (sim.authed) { allow = ['read', 'write', 'update'].includes(sim.op) || (sim.role === 'admin'); reasons.push(sim.role === 'admin' && sim.op === 'delete' ? 'Admin role permitted' : 'Authenticated fallback rule'); }
  else { allow = false; reasons.push('Denied: no matching public rule'); }
  function subOpAllowed(op, owner) { if (op === 'read') return true; return !!owner; }
  return { allow, reasons };
};

})();
