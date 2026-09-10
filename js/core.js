/* ══════════════════════════════════════════════════════════════
   ForgeBase · core.js — i18n, theme, utils, IndexedDB store,
   state, logging, notifications, modal/confirm, hash router.
   Exposes: window.FB
   ══════════════════════════════════════════════════════════════ */
'use strict';
window.FB = window.FB || {};
(function () {
const FB = window.FB;

/* ── utils ─────────────────────────────────────────────── */
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
FB.$ = $; FB.$$ = $$;
FB.uid = (p) => (p || 'id') + '_' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
FB.now = () => Date.now();
FB.esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
FB.fmtBytes = (n) => { n = +n || 0; if (n < 1024) return n + ' B'; const u = ['KB', 'MB', 'GB', 'TB']; let i = -1; do { n /= 1024; i++; } while (n >= 1024 && i < 3); return n.toFixed(n < 10 ? 1 : 0) + ' ' + u[i]; };
FB.fmtNum = (n) => (+n || 0).toLocaleString(FB.prefs.lang === 'ar' ? 'ar-EG' : 'en-US');
FB.fmtTime = (t) => new Date(t).toLocaleString(FB.prefs.lang === 'ar' ? 'ar' : 'en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
FB.fmtTimeFull = (t) => new Date(t).toLocaleString(FB.prefs.lang === 'ar' ? 'ar' : 'en', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
FB.debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
FB.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
FB.clone = (o) => JSON.parse(JSON.stringify(o == null ? null : o));
FB.getPath = (obj, path, fb) => { try { const v = String(path).split('.').reduce((o, k) => (o == null ? o : o[k]), obj); return v === undefined ? fb : v; } catch { return fb; } };
FB.setPath = (obj, path, val) => { const ks = String(path).split('.'); let o = obj; ks.slice(0, -1).forEach((k) => { if (typeof o[k] !== 'object' || o[k] === null) o[k] = {}; o = o[k]; }); o[ks[ks.length - 1]] = val; };
FB.download = (name, content, mime) => { const b = new Blob([content], { type: mime || 'application/octet-stream' }); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800); };
FB.copy = async (text) => { try { await navigator.clipboard.writeText(text); FB.toast(FB.t('copied'), 'ok'); return true; } catch { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); FB.toast(FB.t('copied'), 'ok'); } catch { FB.toast(FB.t('copyFail'), 'err'); } ta.remove(); return false; } };
FB.parseJSONSafe = (s) => { try { return { ok: true, value: JSON.parse(s) }; } catch (e) { return { ok: false, error: String(e.message || e) }; } };

/* CSV helpers */
FB.toCSV = (rows) => { if (!rows.length) return ''; const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))]; const q = (v) => { v = v == null ? '' : (typeof v === 'object' ? JSON.stringify(v) : String(v)); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }; return keys.join(',') + '\n' + rows.map((r) => keys.map((k) => q(r[k])).join(',')).join('\n'); };
FB.fromCSV = (text) => {
  const rows = []; let cur = [''], q = false;
  for (let i = 0; i < text.length; i++) { const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur[cur.length - 1] += '"'; i++; } else q = false; } else cur[cur.length - 1] += c; }
    else if (c === '"') q = true;
    else if (c === ',') cur.push('');
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; rows.push(cur); cur = ['']; }
    else cur[cur.length - 1] += c;
  }
  if (cur.length > 1 || cur[0] !== '') rows.push(cur);
  if (!rows.length) return [];
  const head = rows[0].map((h) => h.trim()); return rows.slice(1).filter((r) => r.some((c) => c !== '')).map((r) => { const o = {}; head.forEach((h, i) => { let v = (r[i] || '').trim(); if (/^-?\d+(\.\d+)?$/.test(v)) v = +v; else if (v === 'true') v = true; else if (v === 'false') v = false; o[h || ('col' + i)] = v; }); return o; });
};

/* ── i18n ──────────────────────────────────────────────── */
const I18N = {
  en: {
    skip: 'Skip to content', aiBuildLabel: 'Describe what you want to build…', aiBuildPh: 'e.g. e-commerce store with auth & orders',
    build: 'Build', newProject: '+ New', searchPh: 'Search docs, collections, files, users…  ( / )', aiAssistant: 'AI Assistant',
    send: 'Send', notifs: 'Notifications', clearAll: 'Clear all', cancel: 'Cancel', confirm: 'Confirm',
    typeToConfirm: 'Type the project ID to confirm:', palettePh: 'Type a command or search… (create collection users, deploy, show logs)',
    paletteHint: 'Natural language works too — e.g. “build auth with admin roles”', cmdCenter: 'Command Center',
    termPh: 'create collection users · deploy · show logs · "build auth with admin roles"',
    asstPh: 'Try: "Create a users collection" · "Generate security rules"', docs: 'Documentation', dbSize: 'Database', storage: 'Storage',
    copied: 'Copied to clipboard', copyFail: 'Copy failed — select manually', saveStateSaved: 'All changes saved locally',
    overview: 'Overview', settings: 'Project Settings', auth: 'Authentication', database: 'Database', storageNav: 'Storage',
    hosting: 'Hosting', functions: 'Functions', analytics: 'Analytics', logs: 'Logs', api: 'API & SDK', rules: 'Security Rules',
    users: 'Users', aiAgents: 'AI Agents', extensions: 'Extensions', providers: 'AI Providers', editor: 'Code Editor', builder: 'App Builder',
    danger: 'Danger zone', save: 'Save', delete: 'Delete', close: 'Close', edit: 'Edit', add: 'Add', create: 'Create', update: 'Update',
    search: 'Search', export: 'Export', import: 'Import', download: 'Download', upload: 'Upload', run: 'Run', test: 'Test', deploy: 'Deploy',
    noProjects: 'No projects yet', createFirst: 'Create your first project to get started.',
    active: 'active', archived: 'archived', local: 'LOCAL', cloud: 'CLOUD',
  },
  ar: {
    skip: 'تخطَّ إلى المحتوى', aiBuildLabel: 'صِف ما تريد بناءه…', aiBuildPh: 'مثال: متجر إلكتروني مع مصادقة وطلبات',
    build: 'ابنِ', newProject: '+ جديد', searchPh: 'ابحث في المستندات والمجموعات والملفات والمستخدمين…  ( / )', aiAssistant: 'المساعد الذكي',
    send: 'إرسال', notifs: 'الإشعارات', clearAll: 'مسح الكل', cancel: 'إلغاء', confirm: 'تأكيد',
    typeToConfirm: 'اكتب معرّف المشروع للتأكيد:', palettePh: 'اكتب أمرًا أو ابحث… (create collection users, deploy, show logs)',
    paletteHint: 'اللغة الطبيعية مدعومة أيضًا — مثال: "ابنِ نظام مصادقة مع أدوار المشرف"',
    cmdCenter: 'مركز الأوامر', termPh: 'create collection users · deploy · show logs · "ابنِ مصادقة مع أدوار المشرف"',
    asstPh: 'جرّب: "أنشئ مجموعة users" · "ولّد قواعد الأمان"', docs: 'التوثيق', dbSize: 'قاعدة البيانات', storage: 'التخزين',
    copied: 'تم النسخ', copyFail: 'فشل النسخ — حدّد يدويًا', saveStateSaved: 'تم حفظ كل التغييرات محليًا',
    overview: 'نظرة عامة', settings: 'إعدادات المشروع', auth: 'المصادقة', database: 'قاعدة البيانات', storageNav: 'التخزين',
    hosting: 'الاستضافة', functions: 'الدوال', analytics: 'التحليلات', logs: 'السجلات', api: 'API و SDK', rules: 'قواعد الأمان',
    users: 'المستخدمون', aiAgents: 'الوكلاء الأذكياء', extensions: 'الإضافات', providers: 'مزودو الذكاء', editor: 'محرر الأكواد', builder: 'منشئ التطبيقات',
    danger: 'منطقة الخطر', save: 'حفظ', delete: 'حذف', close: 'إغلاق', edit: 'تعديل', add: 'إضافة', create: 'إنشاء', update: 'تحديث',
    search: 'بحث', export: 'تصدير', import: 'استيراد', download: 'تنزيل', upload: 'رفع', run: 'تشغيل', test: 'اختبار', deploy: 'نشر',
    noProjects: 'لا توجد مشاريع بعد', createFirst: 'أنشئ مشروعك الأول للبدء.',
    active: 'نشط', archived: 'مؤرشف', local: 'محلي', cloud: 'سحابي',
  }
};
FB.prefs = { theme: 'dark', lang: 'en' };
try { Object.assign(FB.prefs, JSON.parse(localStorage.getItem('fb_prefs') || '{}')); } catch { /* ignore */ }
FB.t = (k) => (I18N[FB.prefs.lang] && I18N[FB.prefs.lang][k]) || I18N.en[k] || k;
FB.setLang = (l) => { FB.prefs.lang = l === 'ar' ? 'ar' : 'en'; localStorage.setItem('fb_prefs', JSON.stringify(FB.prefs)); FB.applyI18n(); };
FB.applyI18n = () => {
  const ar = FB.prefs.lang === 'ar';
  document.documentElement.lang = ar ? 'ar' : 'en';
  document.documentElement.dir = ar ? 'rtl' : 'ltr';
  $$('[data-i18n]').forEach((el) => { el.textContent = FB.t(el.getAttribute('data-i18n')); });
  $$('[data-i18n-ph]').forEach((el) => { el.placeholder = FB.t(el.getAttribute('data-i18n-ph')); });
  $('#langBtn').textContent = ar ? 'EN' : 'ع';
  if (FB.renderNav) FB.renderNav();
  const r = FB.route && FB.route();
  if (r && FB.views && FB.views[r]) { /* re-render handled by caller via hashchange if needed */ }
};
FB.setTheme = (th) => { FB.prefs.theme = th === 'light' ? 'light' : 'dark'; localStorage.setItem('fb_prefs', JSON.stringify(FB.prefs)); document.documentElement.setAttribute('data-theme', FB.prefs.theme); };

/* ── IndexedDB store ───────────────────────────────────── */
const DB_NAME = 'forgebase_v1';
let _db = null;
function idb() {
  return new Promise((resolve, reject) => {
    if (_db) return resolve(_db);
    const req = indexedDB.open(DB_NAME, 3);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv', { keyPath: 'k' });
      if (!db.objectStoreNames.contains('files')) db.createObjectStore('files', { keyPath: 'id' });
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
}
async function kvGet(k, fb) { try { const db = await idb(); return await new Promise((res) => { const tx = db.transaction('kv', 'readonly'); const q = tx.objectStore('kv').get(k); q.onsuccess = () => res(q.result ? q.result.v : fb); q.onerror = () => res(fb); }); } catch { return fb; } }
async function kvSet(k, v) { try { const db = await idb(); return await new Promise((res, rej) => { const tx = db.transaction('kv', 'readwrite'); const q = tx.objectStore('kv').put({ k, v }); q.onsuccess = () => res(true); q.onerror = () => rej(q.error); }); } catch (e) { try { localStorage.setItem('fb_' + k, JSON.stringify(v)); return true; } catch { return false; } } }
FB.store = {
  get: async (k, fb) => { const v = await kvGet(k, undefined); if (v !== undefined) return v; try { const l = localStorage.getItem('fb_' + k); return l != null ? JSON.parse(l) : fb; } catch { return fb; } },
  set: kvSet,
  filePut: async (rec) => { const db = await idb(); return new Promise((res, rej) => { const tx = db.transaction('files', 'readwrite'); const q = tx.objectStore('files').put(rec); q.onsuccess = () => res(true); q.onerror = () => rej(q.error); }); },
  fileGet: async (id) => { const db = await idb(); return new Promise((res) => { const tx = db.transaction('files', 'readonly'); const q = tx.objectStore('files').get(id); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); }); },
  fileDel: async (id) => { const db = await idb(); return new Promise((res) => { const tx = db.transaction('files', 'readwrite'); const q = tx.objectStore('files').delete(id); q.onsuccess = () => res(true); q.onerror = () => res(false); }); },
};
FB.pkey = (projId, part) => 'proj:' + projId + ':' + part;

/* ── state ─────────────────────────────────────────────── */
FB.projects = [];
FB.currentId = null;
FB.current = () => FB.projects.find((p) => p.id === FB.currentId) || null;
FB.data = null; // per-project data cache {auth,db,storage,hosting,functions,logs,api,rules,agents,filesMeta,...}
FB.markDirty = FB.debounce(async () => {
  if (!FB.currentId || !FB.data) return;
  await FB.store.set(FB.pkey(FB.currentId, 'data'), FB.data);
  const el = $('#saveState'); if (el) { el.textContent = '● ' + FB.t('saveStateSaved'); el.classList.add('show'); }
  FB.updateQuota();
}, 600);

const DEFAULT_RULES = (pid) => `rules_version = '2';
service cloud.firestore {
  match /databases/{db}/documents {
    // Public read, owner-only write pattern
    match /users/{userId} {
      allow read: if true;
      allow write: if request.auth != null && request.auth.uid == userId;
    }
    // Authenticated users can read/write their own data
    match /{document=**} {
      allow read, write: if request.auth != null;
    }
  }
}
// Storage rules
service firebase.storage {
  match /b/${pid}.appspot.com/o {
    match /public/{allPaths=**} { allow read: if true; allow write: if request.auth != null; }
    match /private/{userId}/{allPaths=**} { allow read, write: if request.auth != null && request.auth.uid == userId; }
  }
}`;

FB.defaultData = (p) => ({
  users: [], sessions: [],
  dbMode: 'firestore',
  collections: { users: { docs: {}, createdAt: Date.now() } },
  rtDoc: { app: { name: p.name, version: '1.0.0', flags: { darkMode: true }, counters: { visits: 0 } } },
  files: [], // meta; blobs in files store
  sites: [], deployments: [],
  functions: [{
    id: 'fn_hello', name: 'helloWorld', runtime: 'nodejs20', trigger: 'https', region: 'auto',
    code: "export const helloWorld = async (req, res) => {\n  const name = (req.query && req.query.name) || 'world';\n  res.json({ hello: name, at: new Date().toISOString() });\n};",
    env: { LOG_LEVEL: 'info' }, status: 'deployed', updatedAt: Date.now(),
  }],
  logs: [], metrics: { req: [], err: [], dau: [], dbops: [], fn: [] },
  apiKeys: [], endpoints: [
    { method: 'GET', path: '/v1/users', desc: 'List users', auth: true },
    { method: 'POST', path: '/v1/users', desc: 'Create user', auth: true },
    { method: 'GET', path: '/v1/collections/:id/docs', desc: 'List documents', auth: true },
  ],
  rules: { text: DEFAULT_RULES(p.id), updatedAt: Date.now(), deployed: true },
  storageRules: 'allow read: if true;\nallow write: if request.auth != null;',
  agents: [], workflows: [], providerCfg: { provider: 'openai-compatible', model: 'gpt-4o-mini', endpoint: 'https://api.openai.com/v1', key: '', temperature: 0.7, maxTokens: 2048, system: 'You are a helpful coding assistant.' },
  codeFiles: {
    'app.js': { lang: 'javascript', content: "// Welcome to " + p.name + "\n// ForgeBase SDK example — see API & SDK section for your config.\n\nimport { ForgeBase } from './forgebase-sdk.js';\n\nconst app = ForgeBase.initializeApp({\n  projectId: '" + p.id + "',\n  apiKey: 'YOUR_API_KEY',\n});\n\nconst users = await app.db.collection('users').list();\nconsole.log('users:', users.length);\n" },
    'schema.sql': { lang: 'sql', content: "-- Postgres-compatible schema (generated)\ncreate table users (\n  id text primary key,\n  email text unique not null,\n  display_name text,\n  role text default 'user',\n  created_at timestamptz default now()\n);\n" },
    'styles.css': { lang: 'css', content: ":root { color-scheme: light dark; }\nbody { font-family: system-ui, sans-serif; margin: 0; }\n.card { border: 1px solid #ccc; border-radius: 12px; padding: 1rem; }\n" },
  },
  extensions: [{ id: 'ext_bigquery', name: 'Export to BigQuery', on: false }, { id: 'ext_mail', name: 'Transactional Email', on: false }, { id: 'ext_search', name: 'Full-text Search', on: false }],
});

async function seedDemo() {
  const now = Date.now();
  const demo = { id: 'demo-starter', name: 'Demo Starter', status: 'active', createdAt: now - 86400000 * 6, activity: now - 3600000, env: 'local', region: 'local', description: 'Sample project with seed data' };
  FB.projects = [demo]; FB.currentId = demo.id;
  const d = FB.defaultData(demo);
  d.users = [
    { id: 'u_admin', email: 'admin@example.com', pass: 'admin123', displayName: 'Admin', role: 'admin', status: 'active', providers: ['password', 'google'], createdAt: now - 86400000 * 6, lastLogin: now - 3600000 },
    { id: 'u_sara', email: 'sara@example.com', pass: 'sara1234', displayName: 'Sara', role: 'user', status: 'active', providers: ['password', 'github'], createdAt: now - 86400000 * 3, lastLogin: now - 7200000 },
  ];
  d.collections.products = { docs: {}, createdAt: now - 86400000 * 2 };
  const mk = (c, id, doc) => { d.collections[c].docs[id] = { id, data: doc, createdAt: now - 86400000, updatedAt: now - 3600000 }; };
  mk('users', 'u_admin', { email: 'admin@example.com', displayName: 'Admin', role: 'admin' });
  mk('users', 'u_sara', { email: 'sara@example.com', displayName: 'Sara', role: 'user' });
  mk('products', 'p1', { name: 'Keyboard', price: 49.99, stock: 120, tags: ['peripherals', 'sale'] });
  mk('products', 'p2', { name: 'Mouse', price: 25.5, stock: 300, tags: ['peripherals'] });
  d.apiKeys = [{ id: 'key_demo', name: 'Web client', prefix: 'fb_live', createdAt: now - 86400000 * 5, lastUsed: now - 60000, requests: 1284 }];
  d.logs = [
    { id: FB.uid('log'), ts: now - 5000, service: 'auth', level: 'info', msg: 'Login success admin@example.com', user: 'u_admin' },
    { id: FB.uid('log'), ts: now - 60000, service: 'database', level: 'info', msg: 'READ products (2 docs, 41ms)', user: 'u_sara' },
    { id: FB.uid('log'), ts: now - 120000, service: 'functions', level: 'warn', msg: 'helloWorld cold start 812ms', user: '-' },
  ];
  d.deployments = [{ id: 'dep_1', env: 'production', status: 'live', url: 'https://demo-starter.forgebase.local', createdAt: now - 86400000, files: 14 }];
  d.sites = [{ id: 'site_main', name: 'main', env: 'production', url: 'https://demo-starter.forgebase.local' }];
  for (let i = 29; i >= 0; i--) { const t = now - i * 86400000; d.metrics.req.push({ t, v: 800 + Math.round(Math.random() * 900) }); d.metrics.err.push({ t, v: Math.round(Math.random() * 22) }); d.metrics.dau.push({ t, v: 40 + Math.round(Math.random() * 120) }); d.metrics.dbops.push({ t, v: 300 + Math.round(Math.random() * 500) }); d.metrics.fn.push({ t, v: 50 + Math.round(Math.random() * 200) }); }
  FB.data = d;
  await FB.store.set('projects', FB.projects);
  await FB.store.set('currentId', FB.currentId);
  await FB.store.set(FB.pkey(demo.id, 'data'), d);
}

FB.loadAll = async () => {
  FB.projects = (await FB.store.get('projects', null)) || [];
  FB.currentId = await FB.store.get('currentId', null);
  const prefs = await FB.store.get('prefs', null); if (prefs && prefs.agents) FB._agentLib = prefs.agents;
  if (!FB.projects.length) { await seedDemo(); return; }
  if (!FB.projects.find((p) => p.id === FB.currentId)) FB.currentId = FB.projects[0].id;
  FB.data = (await FB.store.get(FB.pkey(FB.currentId, 'data'), null)) || FB.defaultData(FB.current());
  // backfill keys for older saves
  const fresh = FB.defaultData(FB.current());
  for (const k of Object.keys(fresh)) if (FB.data[k] === undefined) FB.data[k] = fresh[k];
};

FB.switchProject = async (id) => {
  if (!FB.projects.find((p) => p.id === id)) return;
  FB.currentId = id;
  await FB.store.set('currentId', id);
  FB.data = (await FB.store.get(FB.pkey(id, 'data'), null)) || FB.defaultData(FB.current());
  const fresh = FB.defaultData(FB.current());
  for (const k of Object.keys(fresh)) if (FB.data[k] === undefined) FB.data[k] = fresh[k];
  const p = FB.current(); p.activity = Date.now();
  await FB.store.set('projects', FB.projects);
  FB.renderProjectSelector(); FB.updateQuota();
  FB.log('system', 'info', 'Switched to project ' + p.name);
  FB.rerender();
};

/* ── logs / metrics / notifications / toasts ───────────── */
FB.log = (service, level, msg, extra) => {
  try {
    const e = Object.assign({ id: FB.uid('log'), ts: Date.now(), service, level, msg }, extra || {});
    if (FB.data) { FB.data.logs.unshift(e); if (FB.data.logs.length > 1000) FB.data.logs.length = 1000; FB.markDirty(); }
    if (FB.route && FB.route() === 'logs' && FB.views && FB.views.logs) FB.rerender({ keepScroll: true });
  } catch { /* ignore */ }
};
FB.bumpMetric = (k, v) => { try { const m = FB.data.metrics[k]; const day = new Date().setHours(0, 0, 0, 0); const last = m[m.length - 1]; if (last && new Date(last.t).setHours(0, 0, 0, 0) === day) last.v += (v || 1); else m.push({ t: Date.now(), v: v || 1 }); FB.markDirty(); } catch { /* ignore */ } };

FB.notifications = [];
FB.notify = (title, body, kind) => {
  FB.notifications.unshift({ id: FB.uid('n'), title, body: body || '', kind: kind || 'info', ts: Date.now(), read: false });
  if (FB.notifications.length > 50) FB.notifications.length = 50;
  FB.toast(title, kind);
  const d = $('#notifDot'); if (d) d.classList.remove('hidden');
  if (FB._renderNotifs) FB._renderNotifs();
};
FB.toast = (msg, kind) => {
  const box = $('#toasts'); if (!box) return;
  const el = document.createElement('div');
  el.className = 'toast ' + (kind || 'info');
  el.innerHTML = '<span>' + FB.esc(msg) + '</span><button aria-label="Dismiss">✕</button>';
  el.querySelector('button').onclick = () => el.remove();
  box.appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, 3400);
};

/* ── modal + confirm (destructive ops need explicit approval) ── */
let _cfResolve = null;
FB.confirm = (title, msg, opts) => new Promise((resolve) => {
  _cfResolve = resolve;
  $('#cfTitle').textContent = title; $('#cfMsg').textContent = msg;
  const tw = $('#cfTypeWrap'); const inp = $('#cfType');
  const need = opts && opts.requireText;
  tw.classList.toggle('hidden', !need); inp.value = '';
  const ok = $('#cfOk');
  const check = () => { ok.disabled = !!(need && inp.value.trim() !== need); };
  inp.oninput = check; check();
  $('#confirmModal').classList.remove('hidden');
  setTimeout(() => (need ? inp : $('#cfCancel')).focus(), 30);
});
function cfDone(v) { $('#confirmModal').classList.add('hidden'); if (_cfResolve) { _cfResolve(v); _cfResolve = null; } }
FB.openModal = (html) => { $('#modalBox').innerHTML = html; $('#modal').classList.remove('hidden'); };
FB.closeModal = () => $('#modal').classList.add('hidden');

/* ── router ────────────────────────────────────────────── */
FB.NAV = [
  { id: 'overview', icon: '▦' }, { id: 'builder', icon: '✦' }, { id: 'database', icon: '⛁' },
  { id: 'auth', icon: '🔑' }, { id: 'storage', icon: '🗄' }, { id: 'hosting', icon: '🌐' },
  { id: 'functions', icon: 'λ' }, { id: 'api', icon: '🔌' }, { id: 'rules', icon: '🛡' },
  { id: 'users', icon: '👥' }, { id: 'agents', icon: '🤖' }, { id: 'providers', icon: '🧠' },
  { id: 'editor', icon: '⌨' }, { id: 'analytics', icon: '📈' }, { id: 'logs', icon: '🧾' },
  { id: 'extensions', icon: '🧩' }, { id: 'settings', icon: '⚙' }, { id: 'docs', icon: '📚' },
];
FB.NAV_LABEL = () => ({ overview: FB.t('overview'), builder: FB.t('builder'), database: FB.t('database'), auth: FB.t('auth'), storage: FB.t('storageNav'), hosting: FB.t('hosting'), functions: FB.t('functions'), api: FB.t('api'), rules: FB.t('rules'), users: FB.t('users'), agents: FB.t('aiAgents'), providers: FB.t('providers'), editor: FB.t('editor'), analytics: FB.t('analytics'), logs: FB.t('logs'), extensions: FB.t('extensions'), settings: FB.t('settings'), docs: FB.t('docs') });
FB.route = () => (location.hash || '#/overview').replace('#/', '').split('?')[0] || 'overview';
FB.go = (r) => { location.hash = '#/' + r; };
FB._qs = () => { const h = location.hash || ''; const i = h.indexOf('?'); const o = {}; if (i < 0) return o; h.slice(i + 1).split('&').forEach((p) => { const [k, v] = p.split('='); o[decodeURIComponent(k)] = decodeURIComponent(v || ''); }); return o; };
FB.rerender = (opts) => {
  const r = FB.route();
  const view = $('#view'); if (!view) return;
  const sc = (opts && opts.keepScroll) ? view.scrollTop : 0;
  const fn = FB.views && FB.views[r];
  $$('#navList li').forEach((li) => li.classList.toggle('active', li.dataset.route === r));
  const labels = FB.NAV_LABEL();
  $('#crumbs').textContent = (FB.current() ? FB.current().name + '  /  ' : '') + (labels[r] || r);
  if (fn) { try { fn(view, FB._qs()); } catch (e) { console.error(e); view.innerHTML = '<div class="empty"><h2>Render error</h2><pre>' + FB.esc(String(e && e.stack || e)) + '</pre></div>'; } }
  else view.innerHTML = '<div class="empty"><h2>404</h2><p>Unknown section: ' + FB.esc(r) + '</p></div>';
  if (sc) view.scrollTop = sc;
  $('#sidebar').classList.remove('open'); $('#sidebarScrim').classList.remove('show');
};

FB.renderNav = () => {
  const labels = FB.NAV_LABEL();
  $('#navList').innerHTML = FB.NAV.map((n) => '<li data-route="' + n.id + '" class="' + (FB.route() === n.id ? 'active' : '') + '" tabindex="0" role="link" aria-label="' + FB.esc(labels[n.id] || n.id) + '"><span class="ni">' + n.icon + '</span><span class="nl">' + FB.esc(labels[n.id] || n.id) + '</span></li>').join('');
  $$('#navList li').forEach((li) => {
    const go = () => FB.go(li.dataset.route);
    li.onclick = go;
    li.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } };
  });
};

FB.renderProjectSelector = () => {
  const sel = $('#projectSelector');
  sel.innerHTML = FB.projects.map((p) => '<option value="' + FB.esc(p.id) + '"' + (p.id === FB.currentId ? ' selected' : '') + '>' + FB.esc(p.name) + (p.status === 'archived' ? ' (' + FB.t('archived') + ')' : '') + '</option>').join('') || '<option value="">—</option>';
  const tp = $('#termProj'); if (tp && FB.current()) tp.textContent = '@' + FB.current().id;
  const cx = $('#asstCtx'); if (cx && FB.current()) cx.textContent = '@' + FB.current().id;
};

FB.updateQuota = () => {
  try {
    const dbBytes = JSON.stringify(FB.data.collections).length + JSON.stringify(FB.data.rtDoc).length;
    const stBytes = (FB.data.files || []).reduce((a, f) => a + (+f.size || 0), 0);
    $('#quotaDb').textContent = FB.fmtBytes(dbBytes);
    $('#quotaSt').textContent = FB.fmtBytes(stBytes);
    const pct = Math.min(100, ((dbBytes + stBytes) / (50 * 1024 * 1024)) * 100);
    $('#quotaBar').style.width = pct.toFixed(1) + '%';
  } catch { /* ignore */ }
};

/* static wiring (confirm modal, esc) */
document.addEventListener('DOMContentLoaded', () => {
  $('#cfCancel').onclick = () => cfDone(false);
  $('#cfOk').onclick = () => cfDone(true);
  $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') FB.closeModal(); });
  $('#confirmModal').addEventListener('click', (e) => { if (e.target.id === 'confirmModal') cfDone(false); });
});

})();
