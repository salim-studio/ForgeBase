/* ══════════════════════════════════════════════════════════════
   ForgeBase server — real backend.
   REST + WebSocket realtime + JWT/API-key auth + SQLite/Postgres +
   disk (or S3-compatible) storage + sandboxed function runner +
   server-side AI proxy. Serves the frontend statically too.
   ══════════════════════════════════════════════════════════════ */
'use strict';
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const vm = require('vm');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { WebSocketServer } = require('ws');
const db = require('./db');

const PORT = +process.env.PORT || 8080;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-secret-change-me';
const JWT_EXPIRES = process.env.JWT_EXPIRES || '7d';
const UPLOAD_DIR = process.env.UPLOAD_DIR || './data/uploads';
const MAX_MB = +process.env.MAX_UPLOAD_MB || 50;
if (JWT_SECRET === 'dev-only-secret-change-me') console.warn('[warn] JWT_SECRET is default — set a real one in production!');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const uid = (p) => (p || 'id') + '_' + crypto.randomBytes(6).toString('hex') + Date.now().toString(36).slice(-4);
const now = () => Date.now();
const emailOk = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || ''));
const J = (v, fb) => { try { return v == null ? fb : JSON.parse(v); } catch { return fb; } };
const S = (v) => JSON.stringify(v == null ? null : v);

/* ── app ─────────────────────────────────────────────── */
const app = express();
app.use(cors({ origin: process.env.CORS_ORIGIN || true }));
app.use(express.json({ limit: '5mb' }));
app.use((req, res, next) => {
  const day = new Date().toISOString().slice(0, 10);
  db.q('INSERT INTO hits(day,count) VALUES(?,1) ON CONFLICT(day) DO UPDATE SET count=count+1', [day]).catch(() => {});
  next();
});

/* rate limiter (auth + ai endpoints) */
const buckets = new Map();
function limit(n, perMs) {
  return (req, res, next) => {
    const k = req.ip + req.path;
    const t = Date.now();
    let b = buckets.get(k);
    if (!b || t > b.reset) b = { n: 0, reset: t + perMs };
    b.n++;
    buckets.set(k, b);
    if (b.n > n) return res.status(429).json({ error: 'Too many requests, slow down' });
    next();
  };
}

/* ── WS hub ──────────────────────────────────────────── */
const rooms = new Map(); // projectId -> Set<ws>
function broadcast(projectId, msg) {
  const set = rooms.get(projectId);
  if (!set) return;
  const s = JSON.stringify(Object.assign({ t: now() }, msg));
  for (const ws of set) { try { if (ws.readyState === 1) ws.send(s); } catch { /* ignore */ } }
}
const invalidate = (pid, scope) => broadcast(pid, { type: 'invalidate', scope });

async function logEvent(projectId, service, level, msg, userId) {
  try {
    await db.q('INSERT INTO logs(project_id,ts,service,level,msg,user_id) VALUES(?,?,?,?,?,?)',
      [projectId, now(), service, level, String(msg).slice(0, 2000), userId || null]);
    const r = await db.q('SELECT COUNT(*) c FROM logs WHERE project_id=?', [projectId]);
    if (+(r.rows[0] || {}).c > 2000) await db.q('DELETE FROM logs WHERE project_id=? AND id NOT IN (SELECT id FROM logs WHERE project_id=? ORDER BY id DESC LIMIT 1500)', [projectId, projectId]);
  } catch { /* ignore */ }
  invalidate(projectId, 'logs');
}

/* ── auth ────────────────────────────────────────────── */
function signToken(u) { return jwt.sign({ sub: u.id, email: u.email, role: u.role }, JWT_SECRET, { expiresIn: JWT_EXPIRES }); }
async function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  const key = req.headers['x-api-key'] || (token && token.startsWith('fb_live_') ? token : null);
  try {
    if (key) {
      const hash = crypto.createHash('sha256').update(key).digest('hex');
      const row = (await db.q('SELECT * FROM api_keys WHERE key_hash=?', [hash])).rows[0];
      if (!row) return res.status(401).json({ error: 'Invalid API key' });
      await db.q('UPDATE api_keys SET last_used=?, requests=requests+1 WHERE id=?', [now(), row.id]);
      req.apiKey = row;
      const m = (await db.q('SELECT u.* FROM users u JOIN access a ON a.user_id=u.id WHERE a.project_id=? LIMIT 1', [row.project_id])).rows[0]
        || (await db.q('SELECT * FROM users WHERE role=? LIMIT 1', ['admin'])).rows[0];
      req.user = m ? { id: m.id, email: m.email, role: m.role } : { id: 'apikey', email: 'api-key', role: 'user' };
      req.authKind = 'key';
      return next();
    }
    if (!token) return res.status(401).json({ error: 'Missing token' });
    const p = jwt.verify(token, JWT_SECRET);
    const r = await db.q('SELECT * FROM users WHERE id=?', [p.sub]);
    if (!r.rows[0] || r.rows[0].status !== 'active') return res.status(401).json({ error: 'Account unavailable' });
    req.user = { id: r.rows[0].id, email: r.rows[0].email, role: r.rows[0].role };
    req.authKind = 'jwt';
    next();
  } catch { return res.status(401).json({ error: 'Invalid/expired token' }); }
}
async function needProject(req, res, next) {
  const pid = req.params.pid || req.query.project;
  if (!pid) return res.status(400).json({ error: 'Missing project' });
  const pr = (await db.q('SELECT * FROM projects WHERE id=?', [pid])).rows[0];
  if (!pr) return res.status(404).json({ error: 'No such project' });
  if (req.user.role !== 'admin') {
    const a = (await db.q('SELECT * FROM access WHERE project_id=? AND user_id=?', [pid, req.user.id])).rows[0];
    if (!a && pr.owner_id !== req.user.id) return res.status(403).json({ error: 'No access to this project' });
    req.prole = a ? a.role : 'owner';
  } else req.prole = 'admin';
  req.project = pr;
  next();
}
const needAdmin = (req, res, next) => (req.user.role === 'admin' ? next() : res.status(403).json({ error: 'Admin only' }));

/* default seeds */
const DEFAULT_RULES = (pid) => `rules_version = '2';
service cloud.firestore {
  match /databases/{db}/documents {
    match /users/{userId} {
      allow read: if true;
      allow write: if request.auth != null && request.auth.uid == userId;
    }
    match /{document=**} {
      allow read, write: if request.auth != null;
    }
  }
}
// Storage
service firebase.storage {
  match /b/${pid}.appspot.com/o {
    match /public/{allPaths=**} { allow read: if true; allow write: if request.auth != null; }
    match /private/{userId}/{allPaths=**} { allow read, write: if request.auth != null && request.auth.uid == userId; }
  }
}`;
const HELLO_FN = (name) => `export const ${name} = async (req, res) => {\n  const n = (req.query && req.query.name) || 'world';\n  res.json({ hello: n, at: new Date().toISOString() });\n};`;

/* ═══ routes ═══════════════════════════════════════════ */
app.get('/api/health', (req, res) => res.json({ ok: true, mode: 'cloud', db: db.isPg ? 'postgres' : 'sqlite', time: now() }));

/* auth */
app.post('/api/auth/register', limit(30, 60000), async (req, res) => {
  const { email, password, displayName } = req.body || {};
  if (!emailOk(email)) return res.status(400).json({ error: 'Invalid email' });
  if (!password || password.length < 6) return res.status(400).json({ error: 'Password ≥ 6 chars' });
  const exists = (await db.q('SELECT id FROM users WHERE email=?', [String(email).toLowerCase()])).rows[0];
  if (exists) return res.status(409).json({ error: 'Email already registered' });
  const count = +( (await db.q('SELECT COUNT(*) c FROM users')).rows[0] || {} ).c || 0;
  const u = { id: uid('u'), email: String(email).toLowerCase(), displayName: displayName || String(email).split('@')[0], role: count === 0 ? 'admin' : 'user' };
  await db.q('INSERT INTO users(id,email,pass_hash,display_name,role,status,providers,created_at,last_login) VALUES(?,?,?,?,?,?,?, ?,?)',
    [u.id, u.email, await bcrypt.hash(password, 10), u.displayName, u.role, 'active', S(['password']), now(), now()]);
  await logEvent(null, 'auth', 'info', 'Registered ' + u.email + (u.role === 'admin' ? ' (first user → admin)' : ''), u.id);
  res.json({ token: signToken(u), user: pub(u) });
});
app.post('/api/auth/login', limit(30, 60000), async (req, res) => {
  const { email, password } = req.body || {};
  const row = (await db.q('SELECT * FROM users WHERE email=?', [String(email || '').toLowerCase()])).rows[0];
  if (!row) return res.status(401).json({ error: 'No account for this email' });
  if (row.status !== 'active') return res.status(403).json({ error: 'Account is ' + row.status });
  if (!(await bcrypt.compare(password || '', row.pass_hash))) { await logEvent(null, 'auth', 'warn', 'Failed login ' + email); return res.status(401).json({ error: 'Wrong password' }); }
  await db.q('UPDATE users SET last_login=? WHERE id=?', [now(), row.id]);
  const u = { id: row.id, email: row.email, role: row.role };
  await logEvent(null, 'auth', 'info', 'Login ' + row.email, row.id);
  res.json({ token: signToken(u), user: pub({ ...u, display_name: row.display_name, status: row.status, providers: J(row.providers, ['password']), created_at: row.created_at, last_login: now() }) });
});
function pub(r) {
  return { id: r.id, email: r.email, displayName: r.display_name || r.displayName, role: r.role, status: r.status || 'active', providers: r.providers && typeof r.providers === 'string' ? J(r.providers, ['password']) : (r.providers || ['password']), createdAt: r.created_at != null ? r.created_at : r.createdAt, lastLogin: r.last_login != null ? r.last_login : (r.lastLogin || null) };
}
app.get('/api/me', auth, async (req, res) => {
  const r = (await db.q('SELECT * FROM users WHERE id=?', [req.user.id])).rows[0];
  res.json({ user: pub(r) });
});

/* users (project members can list; admin manages) */
app.get('/api/projects/:pid/users', auth, needProject, async (req, res) => {
  const r = await db.q('SELECT * FROM users ORDER BY created_at ASC');
  res.json({ users: r.rows.map(pub) });
});
app.put('/api/users/:id', auth, needAdmin, async (req, res) => {
  const { role, status, displayName } = req.body || {};
  const row = (await db.q('SELECT * FROM users WHERE id=?', [req.params.id])).rows[0];
  if (!row) return res.status(404).json({ error: 'No such user' });
  await db.q('UPDATE users SET role=?, status=?, display_name=? WHERE id=?',
    [role === 'admin' ? 'admin' : 'user', ['active', 'disabled'].includes(status) ? status : row.status, displayName || row.display_name, row.id]);
  await logEvent(null, 'auth', 'info', `User ${row.email} → ${role || row.role}/${status || row.status}`, req.user.id);
  res.json({ ok: true });
});
app.delete('/api/users/:id', auth, needAdmin, async (req, res) => {
  if (req.params.id === req.user.id) return res.status(400).json({ error: 'Cannot delete yourself' });
  const row = (await db.q('SELECT * FROM users WHERE id=?', [req.params.id])).rows[0];
  if (!row) return res.status(404).json({ error: 'No such user' });
  await db.q('DELETE FROM users WHERE id=?', [row.id]);
  await db.q('DELETE FROM access WHERE user_id=?', [row.id]);
  await logEvent(null, 'auth', 'warn', 'Deleted user ' + row.email, req.user.id);
  res.json({ ok: true });
});

/* projects */
const slug = (n) => String(n || 'project').toLowerCase().trim().replace(/[^a-z0-9\u0600-\u06FF]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || ('proj-' + Date.now().toString(36));
app.get('/api/projects', auth, async (req, res) => {
  let rows;
  if (req.user.role === 'admin') rows = (await db.q('SELECT * FROM projects ORDER BY activity DESC')).rows;
  else rows = (await db.q(`SELECT p.* FROM projects p LEFT JOIN access a ON a.project_id=p.id AND a.user_id=? WHERE p.owner_id=? OR a.user_id IS NOT NULL ORDER BY p.activity DESC`, [req.user.id, req.user.id])).rows;
  res.json({ projects: rows.map((p) => ({ id: p.id, name: p.name, status: p.status, description: p.description, env: 'cloud', region: p.region, createdAt: p.created_at, activity: p.activity })) });
});
async function seedProject(pid) {
  const hasRules = (await db.q('SELECT project_id FROM rules WHERE project_id=?', [pid])).rows[0];
  if (!hasRules) await db.q('INSERT INTO rules(project_id,text,deployed,updated_at) VALUES(?,?,1,?)', [pid, DEFAULT_RULES(pid), now()]);
  const fns = (await db.q('SELECT id FROM functions WHERE project_id=?', [pid])).rows;
  if (!fns.length) await db.q('INSERT INTO functions(id,project_id,name,runtime,trigger,region,code,env,status,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
    [uid('fn'), pid, 'helloWorld', 'nodejs', 'https', 'auto', HELLO_FN('helloWorld'), S({}), 'deployed', now()]);
  if (!(await db.q('SELECT project_id FROM rt WHERE project_id=?', [pid])).rows[0])
    await db.q('INSERT INTO rt(project_id,data) VALUES(?,?)', [pid, S({ app: { counters: { visits: 0 } } })]);
}
app.post('/api/projects', auth, async (req, res) => {
  const name = String(req.body.name || 'Untitled').slice(0, 80);
  let id = slug(name);
  if ((await db.q('SELECT id FROM projects WHERE id=?', [id])).rows[0]) id += '-' + Date.now().toString(36).slice(-4);
  const t = now();
  await db.q('INSERT INTO projects(id,name,status,description,env,region,owner_id,created_at,activity) VALUES(?,?,?,?,?,?,?, ?,?)',
    [id, name, 'active', req.body.description || '', 'cloud', 'auto', req.user.id, t, t]);
  await db.q('INSERT INTO access(project_id,user_id,role) VALUES(?,?,?)', [id, req.user.id, 'owner']);
  await seedProject(id);
  await logEvent(id, 'system', 'info', 'Project created', req.user.id);
  res.json({ project: { id, name, status: 'active', description: '', env: 'cloud', region: 'auto', createdAt: t, activity: t } });
});
app.patch('/api/projects/:pid', auth, needProject, async (req, res) => {
  const { name, description, status } = req.body || {};
  await db.q('UPDATE projects SET name=?, description=?, status=?, activity=? WHERE id=?',
    [String(name || req.project.name).slice(0, 80), description != null ? String(description).slice(0, 500) : req.project.description, status === 'archived' ? 'archived' : 'active', now(), req.project.id]);
  invalidate(req.project.id, 'projects');
  res.json({ ok: true });
});
app.delete('/api/projects/:pid', auth, needProject, async (req, res) => {
  if (req.prole !== 'owner' && req.user.role !== 'admin') return res.status(403).json({ error: 'Owner only' });
  const pid = req.project.id;
  for (const t of ['docs', 'rt', 'files', 'functions', 'rules', 'api_keys', 'deployments', 'logs', 'kv', 'access']) {
    const col = t === 'rt' || t === 'rules' ? 'project_id' : 'project_id';
    await db.q(`DELETE FROM ${t} WHERE ${col}=?`, [pid]);
  }
  // delete uploaded blobs
  try { fs.rmSync(path.join(UPLOAD_DIR, pid), { recursive: true, force: true }); } catch { /* ignore */ }
  await db.q('DELETE FROM projects WHERE id=?', [pid]);
  broadcast(pid, { type: 'project-deleted' });
  res.json({ ok: true });
});
app.post('/api/projects/:pid/duplicate', auth, needProject, async (req, res) => {
  const src = req.project.id;
  const id = src + '-copy-' + Date.now().toString(36).slice(-4);
  const t = now();
  await db.q('INSERT INTO projects(id,name,status,description,env,region,owner_id,created_at,activity) VALUES(?,?,?,?,?,?,?, ?,?)',
    [id, req.project.name + ' (copy)', 'active', req.project.description, 'cloud', req.project.region, req.user.id, t, t]);
  await db.q('INSERT INTO access(project_id,user_id,role) VALUES(?,?,?)', [id, req.user.id, 'owner']);
  for (const tbl of ['docs', 'functions']) {
    const rows = (await db.q(`SELECT * FROM ${tbl} WHERE project_id=?`, [src])).rows;
    for (const r of rows) {
      const cols = Object.keys(r).filter((k) => k !== 'project_id');
      await db.q(`INSERT INTO ${tbl}(project_id,${cols.join(',')}) VALUES(${['?'].concat(cols.map(() => '?')).join(',')})`, [id, ...cols.map((k) => r[k])]);
    }
  }
  for (const tbl of ['rt', 'rules']) {
    const r = (await db.q(`SELECT * FROM ${tbl} WHERE project_id=?`, [src])).rows[0];
    if (r) { const cols = Object.keys(r).filter((k) => k !== 'project_id'); await db.q(`INSERT INTO ${tbl}(project_id,${cols.join(',')}) VALUES(${['?'].concat(cols.map(() => '?')).join(',')})`, [id, ...cols.map((k) => r[k])]); }
  }
  const kvs = (await db.q('SELECT * FROM kv WHERE project_id=?', [src])).rows;
  for (const k of kvs) await db.q('INSERT INTO kv(project_id,key,value) VALUES(?,?,?)', [id, k.key, k.value]);
  await logEvent(id, 'system', 'info', 'Duplicated from ' + src, req.user.id);
  res.json({ project: { id, name: req.project.name + ' (copy)', status: 'active', env: 'cloud', region: 'auto', createdAt: t, activity: t } });
});

/* snapshot — everything the dashboard needs in one call */
app.get('/api/projects/:pid/snapshot', auth, needProject, async (req, res) => {
  const pid = req.project.id;
  const docs = (await db.q('SELECT collection,doc_id,data,created_at,updated_at FROM docs WHERE project_id=? ORDER BY updated_at DESC LIMIT 3000', [pid])).rows;
  const collections = {};
  for (const d of docs) {
    collections[d.collection] = collections[d.collection] || { docs: {}, createdAt: d.created_at };
    collections[d.collection].docs[d.doc_id] = { id: d.doc_id, data: J(d.data, {}), createdAt: d.created_at, updatedAt: d.updated_at };
  }
  const rt = J(((await db.q('SELECT data FROM rt WHERE project_id=?', [pid])).rows[0] || {}).data, {});
  const files = (await db.q('SELECT id,name,path,size,mime AS type,access,created_at AS createdAt FROM files WHERE project_id=? ORDER BY created_at DESC LIMIT 500', [pid])).rows
    .map((f) => ({ ...f, url: '' }));
  const fns = (await db.q('SELECT * FROM functions WHERE project_id=? ORDER BY updated_at DESC', [pid])).rows
    .map((f) => ({ id: f.id, name: f.name, runtime: f.runtime, trigger: f.trigger, region: f.region, code: f.code, env: J(f.env, {}), status: f.status, updatedAt: f.updated_at }));
  const logs = (await db.q('SELECT id,ts,service,level,msg,user_id AS "user" FROM logs WHERE project_id=? ORDER BY id DESC LIMIT 200', [pid])).rows;
  const rules = (await db.q('SELECT * FROM rules WHERE project_id=?', [pid])).rows[0] || { text: DEFAULT_RULES(pid), deployed: 0, updated_at: now() };
  const keys = (await db.q('SELECT id,name,prefix,created_at,last_used,requests FROM api_keys WHERE project_id=?', [pid])).rows
    .map((k) => ({ id: k.id, name: k.name, prefix: k.prefix, createdAt: k.created_at, lastUsed: k.last_used, requests: k.requests }));
  const deps = (await db.q('SELECT * FROM deployments WHERE project_id=? ORDER BY created_at DESC LIMIT 20', [pid])).rows
    .map((d) => ({ id: d.id, env: d.env, status: d.status, url: d.url, files: d.files_count, log: J(d.log, []), entryId: d.entry_file_id, createdAt: d.created_at }));
  const kvRows = (await db.q('SELECT key,value FROM kv WHERE project_id=?', [pid])).rows;
  const kv = {}; kvRows.forEach((r) => { kv[r.key] = J(r.value, null); });
  res.json({
    dbMode: kv.dbMode || 'firestore', collections, rtDoc: rt, files,
    functions: fns, logs, metrics: await buildMetrics(pid),
    rules: { text: rules.text, deployed: !!rules.deployed, updatedAt: rules.updated_at },
    apiKeys: keys, deployments: deps, sites: kv.sites || [], agents: kv.agents || [],
    providerCfg: sanitizeProv(kv.providerCfg), codeFiles: kv.codeFiles || defaultCode(pid),
    endpoints: kv.endpoints || defaultEndpoints(), storageRules: kv.storageRules || 'allow read: if true;\nallow write: if request.auth != null;',
    extensions: kv.extensions || [{ id: 'ext_bigquery', name: 'Export to BigQuery', on: false }, { id: 'ext_mail', name: 'Transactional Email', on: false }, { id: 'ext_search', name: 'Full-text Search', on: false }],
    users: (await db.q('SELECT * FROM users ORDER BY created_at ASC')).rows.map(pub),
    sessions: [],
  });
});
function sanitizeProv(c) {
  const d = c || {};
  return { provider: d.provider || process.env.AI_PROVIDER || 'openai-compatible', model: d.model || process.env.AI_MODEL || 'gpt-4o-mini', endpoint: d.endpoint || process.env.AI_ENDPOINT || 'https://api.openai.com/v1', key: '', temperature: d.temperature != null ? d.temperature : +(process.env.AI_TEMPERATURE || 0.7), maxTokens: d.maxTokens || +(process.env.AI_MAX_TOKENS || 2048), system: d.system || 'You are a helpful coding assistant.', serverManaged: !!process.env.AI_API_KEY };
}
function defaultCode(pid) {
  return { 'app.js': { lang: 'javascript', content: `// ForgeBase cloud project ${pid}\nconst BASE = location.origin + '/api/projects/${pid}';\nconst TOKEN = sessionStorage.getItem('fb_token');\nconst h = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN };\nconst docs = await (await fetch(BASE + '/collections/users/docs', { headers: h })).json();\nconsole.log('users:', docs.total);\n` } };
}
function defaultEndpoints() {
  return [
    { method: 'GET', path: '/api/projects/:id/collections/:name/docs', desc: 'List documents', auth: true },
    { method: 'PUT', path: '/api/projects/:id/collections/:name/docs/:doc', desc: 'Write document', auth: true },
    { method: 'POST', path: '/api/projects/:id/files', desc: 'Upload file', auth: true },
    { method: 'POST', path: '/api/projects/:id/functions/:fid/run', desc: 'Run function', auth: true },
    { method: 'POST', path: '/api/ai/chat', desc: 'AI proxy (server key)', auth: true },
  ];
}
async function buildMetrics(pid) {
  const days = [], m = { req: [], err: [], dau: [], dbops: [], fn: [] };
  for (let i = 29; i >= 0; i--) { const d = new Date(Date.now() - i * 86400000); days.push(d.toISOString().slice(0, 10)); }
  const start = new Date(days[0]).getTime();
  const hits = (await db.q('SELECT day,count FROM hits WHERE day>=?', [days[0]])).rows;
  const hm = {}; hits.forEach((h) => { hm[h.day] = +h.count; });
  const logs = (await db.q('SELECT ts,service,level,user_id FROM logs WHERE project_id=? AND ts>=?', [pid, start])).rows;
  const by = {}; logs.forEach((l) => { const d = new Date(l.ts).toISOString().slice(0, 10); (by[d] = by[d] || []).push(l); });
  for (const d of days) {
    const t = new Date(d).getTime();
    const L = by[d] || [];
    m.req.push({ t, v: hm[d] || 0 });
    m.err.push({ t, v: L.filter((x) => x.level === 'error').length });
    m.dau.push({ t, v: new Set(L.filter((x) => x.service === 'auth' && x.user_id).map((x) => x.user_id)).size });
    m.dbops.push({ t, v: L.filter((x) => x.service === 'database').length });
    m.fn.push({ t, v: L.filter((x) => x.service === 'functions').length });
  }
  return m;
}

/* kv (agents, code files, sites, prefs…) */
app.get('/api/projects/:pid/kv/:key', auth, needProject, async (req, res) => {
  const r = (await db.q('SELECT value FROM kv WHERE project_id=? AND key=?', [req.project.id, req.params.key])).rows[0];
  res.json({ value: r ? J(r.value, null) : null });
});
app.put('/api/projects/:pid/kv/:key', auth, needProject, async (req, res) => {
  if (req.params.key === 'providerCfg' && req.body.value && req.body.value.key) delete req.body.value.key; // keys never stored from browser
  await db.q(db.isPg
    ? 'INSERT INTO kv(project_id,key,value) VALUES(?,?,?) ON CONFLICT(project_id,key) DO UPDATE SET value=EXCLUDED.value'
    : 'INSERT INTO kv(project_id,key,value) VALUES(?,?,?) ON CONFLICT(project_id,key) DO UPDATE SET value=excluded.value',
    [req.project.id, req.params.key, S(req.body.value)]);
  res.json({ ok: true });
});

/* database */
app.get('/api/projects/:pid/collections', auth, needProject, async (req, res) => {
  const r = await db.q('SELECT collection, COUNT(*) c FROM docs WHERE project_id=? GROUP BY collection', [req.project.id]);
  res.json({ collections: r.rows.map((x) => ({ name: x.collection, docs: +x.c })) });
});
app.post('/api/projects/:pid/collections', auth, needProject, async (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return res.status(400).json({ error: 'Bad collection name' });
  const ex = (await db.q('SELECT doc_id FROM docs WHERE project_id=? AND collection=? LIMIT 1', [req.project.id, name])).rows[0];
  if (ex) return res.status(409).json({ error: 'Exists' });
  await logEvent(req.project.id, 'database', 'info', 'CREATE collection ' + name, req.user.id);
  invalidate(req.project.id, 'db');
  res.json({ ok: true });
});
app.delete('/api/projects/:pid/collections/:name', auth, needProject, async (req, res) => {
  await db.q('DELETE FROM docs WHERE project_id=? AND collection=?', [req.project.id, req.params.name]);
  await logEvent(req.project.id, 'database', 'warn', 'DELETE collection ' + req.params.name, req.user.id);
  invalidate(req.project.id, 'db');
  res.json({ ok: true });
});
app.get('/api/projects/:pid/collections/:name/docs', auth, needProject, async (req, res) => {
  const col = req.params.name;
  const search = (req.query.search || '').toLowerCase();
  const sortKey = req.query.sortKey || 'updatedAt', dir = req.query.sortDir === 'asc' ? 1 : -1;
  const per = Math.max(1, Math.min(100, +req.query.per || 10));
  const page = Math.max(1, +req.query.page || 1);
  let rows = (await db.q('SELECT doc_id,data,created_at,updated_at FROM docs WHERE project_id=? AND collection=?', [req.project.id, col])).rows;
  let docs = rows.map((r) => ({ id: r.doc_id, data: J(r.data, {}), createdAt: r.created_at, updatedAt: r.updated_at }));
  if (search) docs = docs.filter((d) => (d.id + S(d.data)).toLowerCase().includes(search));
  docs.sort((a, b) => {
    const av = sortKey === 'id' ? a.id : (a.data[sortKey] !== undefined ? a.data[sortKey] : a[sortKey]);
    const bv = sortKey === 'id' ? b.id : (b.data[sortKey] !== undefined ? b.data[sortKey] : b[sortKey]);
    if (av === bv) return 0; if (av == null) return 1; if (bv == null) return -1;
    return (av > bv ? 1 : -1) * dir;
  });
  const total = docs.length, pages = Math.max(1, Math.ceil(total / per));
  const p = Math.max(1, Math.min(pages, page));
  res.json({ docs: docs.slice((p - 1) * per, p * per), total, pages, page: p, per });
});
app.put('/api/projects/:pid/collections/:name/docs/:doc', auth, needProject, async (req, res) => {
  const t = now();
  const has = (await db.q('SELECT doc_id FROM docs WHERE project_id=? AND collection=? AND doc_id=?', [req.project.id, req.params.name, req.params.doc])).rows[0];
  if (has) await db.q('UPDATE docs SET data=?, updated_at=? WHERE project_id=? AND collection=? AND doc_id=?', [S(req.body.data || {}), t, req.project.id, req.params.name, req.params.doc]);
  else await db.q('INSERT INTO docs(project_id,collection,doc_id,data,created_at,updated_at) VALUES(?,?,?,?,?,?)', [req.project.id, req.params.name, req.params.doc, S(req.body.data || {}), t, t]);
  await logEvent(req.project.id, 'database', 'info', `WRITE ${req.params.name}/${req.params.doc}`, req.user.id);
  invalidate(req.project.id, 'db');
  res.json({ ok: true });
});
app.post('/api/projects/:pid/collections/:name/docs', auth, needProject, async (req, res) => {
  const id = 'doc_' + crypto.randomBytes(4).toString('hex');
  const t = now();
  await db.q('INSERT INTO docs(project_id,collection,doc_id,data,created_at,updated_at) VALUES(?,?,?,?,?,?)', [req.project.id, req.params.name, id, S(req.body.data || {}), t, t]);
  await logEvent(req.project.id, 'database', 'info', `WRITE ${req.params.name}/${id}`, req.user.id);
  invalidate(req.project.id, 'db');
  res.json({ id });
});
app.delete('/api/projects/:pid/collections/:name/docs/:doc', auth, needProject, async (req, res) => {
  await db.q('DELETE FROM docs WHERE project_id=? AND collection=? AND doc_id=?', [req.project.id, req.params.name, req.params.doc]);
  await logEvent(req.project.id, 'database', 'warn', `DELETE ${req.params.name}/${req.params.doc}`, req.user.id);
  invalidate(req.project.id, 'db');
  res.json({ ok: true });
});
app.get('/api/projects/:pid/backup', auth, needProject, async (req, res) => {
  const docs = (await db.q('SELECT collection,doc_id,data,created_at FROM docs WHERE project_id=?', [req.project.id])).rows;
  const collections = {};
  docs.forEach((d) => { (collections[d.collection] = collections[d.collection] || { docs: {}, createdAt: d.created_at }).docs[d.doc_id] = { id: d.doc_id, data: J(d.data, {}), createdAt: d.created_at, updatedAt: d.created_at }; });
  const rt = J(((await db.q('SELECT data FROM rt WHERE project_id=?', [req.project.id])).rows[0] || {}).data, {});
  res.json({ projectId: req.project.id, exportedAt: new Date().toISOString(), collections, realtime: rt });
});
app.post('/api/projects/:pid/restore', auth, needProject, async (req, res) => {
  const cols = (req.body || {}).collections;
  if (!cols || typeof cols !== 'object') return res.status(400).json({ error: 'Missing collections' });
  const t = now();
  for (const [name, col] of Object.entries(cols)) {
    const docs = col.docs || col;
    for (const [id, d] of Object.entries(docs)) {
      const data = d.data || d;
      const has = (await db.q('SELECT doc_id FROM docs WHERE project_id=? AND collection=? AND doc_id=?', [req.project.id, name, id])).rows[0];
      if (has) await db.q('UPDATE docs SET data=?, updated_at=? WHERE project_id=? AND collection=? AND doc_id=?', [S(data), t, req.project.id, name, id]);
      else await db.q('INSERT INTO docs(project_id,collection,doc_id,data,created_at,updated_at) VALUES(?,?,?,?,?,?)', [req.project.id, name, id, S(data), d.createdAt || t, t]);
    }
  }
  if (req.body.realtime) await db.q('INSERT INTO rt(project_id,data) VALUES(?,?) ON CONFLICT(project_id) DO UPDATE SET data=excluded.data', [req.project.id, S(req.body.realtime)]);
  await logEvent(req.project.id, 'database', 'warn', 'Restored from backup', req.user.id);
  invalidate(req.project.id, 'db');
  res.json({ ok: true });
});

/* realtime doc */
const getPath = (o, p) => String(p).split('.').reduce((a, k) => (a == null ? a : a[k]), o);
app.get('/api/projects/:pid/realtime', auth, needProject, async (req, res) => {
  const data = J(((await db.q('SELECT data FROM rt WHERE project_id=?', [req.project.id])).rows[0] || {}).data, {});
  res.json({ value: req.query.path ? getPath(data, req.query.path) ?? null : data });
});
app.put('/api/projects/:pid/realtime', auth, needProject, async (req, res) => {
  const p = req.query.path;
  let data = J(((await db.q('SELECT data FROM rt WHERE project_id=?', [req.project.id])).rows[0] || {}).data, {});
  if (!p) data = req.body.value;
  else { const ks = String(p).split('.'); let o = data; ks.slice(0, -1).forEach((k) => { if (typeof o[k] !== 'object' || !o[k]) o[k] = {}; o = o[k]; }); o[ks[ks.length - 1]] = req.body.value; }
  await db.q('INSERT INTO rt(project_id,data) VALUES(?,?) ON CONFLICT(project_id) DO UPDATE SET data=excluded.data', [req.project.id, S(data)]);
  await logEvent(req.project.id, 'database', 'info', 'RT WRITE ' + (p || '/'), req.user.id);
  broadcast(req.project.id, { type: 'rt', path: p || '/', value: req.body.value });
  invalidate(req.project.id, 'db');
  res.json({ ok: true });
});
app.delete('/api/projects/:pid/realtime', auth, needProject, async (req, res) => {
  const p = req.query.path;
  if (!p) await db.q('UPDATE rt SET data=? WHERE project_id=?', [S({}), req.project.id]);
  else {
    const data = J(((await db.q('SELECT data FROM rt WHERE project_id=?', [req.project.id])).rows[0] || {}).data, {});
    const ks = String(p).split('.'); let o = data;
    for (let i = 0; i < ks.length - 1; i++) { o = o ? o[ks[i]] : null; if (!o) break; }
    if (o) delete o[ks[ks.length - 1]];
    await db.q('UPDATE rt SET data=? WHERE project_id=?', [S(data), req.project.id]);
  }
  invalidate(req.project.id, 'db');
  res.json({ ok: true });
});

/* storage */
const storage = multer.diskStorage({
  destination: (req, file, cb) => { const d = path.join(UPLOAD_DIR, req.project.id); fs.mkdirSync(d, { recursive: true }); cb(null, d); },
  filename: (req, file, cb) => cb(null, uid('f') + '-' + path.basename(file.originalname).replace(/[^\w.\-]+/g, '_')),
});
const upload = multer({ storage, limits: { fileSize: MAX_MB * 1024 * 1024 } });
app.post('/api/projects/:pid/files', auth, needProject, upload.array('files', 50), async (req, res) => {
  const folder = String(req.body.folder || req.query.folder || '').replace(/^\/+|\/+$/g, '');
  const out = [];
  for (const f of req.files || []) {
    const id = uid('f');
    const dest = path.join(UPLOAD_DIR, req.project.id, id + '-' + path.basename(f.filename).slice(13));
    try { fs.renameSync(f.path, dest); } catch { /* keep */ }
    const meta = { id, name: f.originalname, path: (folder ? folder + '/' : '') + f.originalname, size: f.size, mime: f.mimetype, access: folder.startsWith('public') ? 'public' : 'private' };
    await db.q("INSERT INTO files(id,project_id,name,path,size,mime,access,created_at) VALUES(?,?,?,?,?,?,?,?)",
      [id, req.project.id, meta.name, meta.path, meta.size, meta.mime, meta.access, now()]);
    fs.writeFileSync(path.join(UPLOAD_DIR, req.project.id, id + '.json'), S({ storedAs: path.basename(dest) }));
    out.push(meta);
  }
  await logEvent(req.project.id, 'storage', 'info', `Uploaded ${out.length} file(s)`, req.user.id);
  invalidate(req.project.id, 'files');
  res.json({ files: out });
});
app.get('/api/projects/:pid/files', auth, needProject, async (req, res) => {
  const rows = (await db.q('SELECT id,name,path,size,mime AS type,access,created_at AS createdAt FROM files WHERE project_id=? ORDER BY created_at DESC LIMIT 500', [req.project.id])).rows;
  res.json({ files: rows });
});
app.post('/api/projects/:pid/files/mkdir', auth, needProject, async (req, res) => {
  const name = String(req.body.name || '').trim().replace(/^\/+|\/+$/g, '').slice(0, 200);
  if (!name) return res.status(400).json({ error: 'Folder name required' });
  const f = { id: uid('d'), name: name.split('/').pop(), path: name };
  await db.q("INSERT INTO files(id,project_id,name,path,size,mime,access,created_at) VALUES(?,?,?,?,?,?,?,?)",
    [f.id, req.project.id, f.name, f.path, 0, 'folder', 'private', now()]);
  await logEvent(req.project.id, 'storage', 'info', 'Created folder ' + name, req.user.id);
  invalidate(req.project.id, 'files');
  res.json({ ok: true });
});
function fileDiskPath(pid, fid) {
  const sidecar = path.join(UPLOAD_DIR, pid, fid + '.json');
  if (!fs.existsSync(sidecar)) return null;
  return path.join(UPLOAD_DIR, pid, J(fs.readFileSync(sidecar, 'utf8'), {}).storedAs);
}
app.get('/api/projects/:pid/files/:fid/download', async (req, res) => {
  const meta = (await db.q('SELECT * FROM files WHERE id=? AND project_id=?', [req.params.fid, req.params.pid])).rows[0];
  if (!meta) return res.status(404).json({ error: 'No such file' });
  if (meta.access !== 'public') {
    // private → require member token (header or ?token= for previews)
    const h = req.headers.authorization || '';
    const qt = req.query.token ? 'Bearer ' + req.query.token : '';
    try { jwt.verify((h || qt).slice(7), JWT_SECRET); } catch { return res.status(401).json({ error: 'Private file' }); }
  }
  const disk = fileDiskPath(req.params.pid, meta.id);
  if (!disk || !fs.existsSync(disk)) return res.status(410).json({ error: 'Blob missing' });
  res.setHeader('Content-Type', meta.mime || 'application/octet-stream');
  res.setHeader('Content-Disposition', `inline; filename="${meta.name.replace(/"/g, '')}"`);
  fs.createReadStream(disk).pipe(res);
});
app.patch('/api/projects/:pid/files/:fid', auth, needProject, async (req, res) => {
  const meta = (await db.q('SELECT * FROM files WHERE id=? AND project_id=?', [req.params.fid, req.project.id])).rows[0];
  if (!meta) return res.status(404).json({ error: 'No such file' });
  let p = meta.path;
  if (req.body.name) { const dir = p.includes('/') ? p.slice(0, p.lastIndexOf('/') + 1) : ''; p = dir + String(req.body.name).slice(0, 120); }
  await db.q('UPDATE files SET name=?, path=?, access=? WHERE id=?',
    [req.body.name || meta.name, p, req.body.access === 'public' ? 'public' : (req.body.access === 'private' ? 'private' : meta.access), meta.id]);
  invalidate(req.project.id, 'files');
  res.json({ ok: true });
});
app.delete('/api/projects/:pid/files/:fid', auth, needProject, async (req, res) => {
  const disk = fileDiskPath(req.project.id, req.params.fid);
  await db.q('DELETE FROM files WHERE id=? AND project_id=?', [req.params.fid, req.project.id]);
  try { if (disk) fs.unlinkSync(disk); fs.unlinkSync(path.join(UPLOAD_DIR, req.project.id, req.params.fid + '.json')); } catch { /* ignore */ }
  await logEvent(req.project.id, 'storage', 'warn', 'Deleted file', req.user.id);
  invalidate(req.project.id, 'files');
  res.json({ ok: true });
});

/* hosting: deploy folder → public preview URLs */
app.post('/api/projects/:pid/deploy', auth, needProject, upload.array('files', 200), async (req, res) => {
  const env = req.body.env === 'production' ? 'production' : 'preview';
  const depId = uid('dep');
  const t = now();
  const names = [];
  for (const f of req.files || []) {
    const rel = String(f.originalname).replace(/\\/g, '/');
    const id = uid('a');
    const dest = path.join(UPLOAD_DIR, req.project.id, 'releases', depId, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.renameSync(f.path, dest);
    await db.q("INSERT INTO files(id,project_id,name,path,size,mime,access,created_at) VALUES(?,?,?,?,?,?,?,?)",
      [id, req.project.id, rel.split('/').pop(), 'releases/' + depId + '/' + rel, f.size, f.mimetype || 'application/octet-stream', 'public', t]);
    names.push({ id, name: rel });
  }
  if (!names.length) return res.status(400).json({ error: 'No files' });
  const entry = names.find((a) => /(^|\/)index\.html?$/.test(a.name)) || names.find((a) => /\.html?$/.test(a.name)) || names[0];
  const url = `/pub/${req.project.id}/${depId}/${entry.name}`;
  const log = ['Resolving project ' + req.project.id + '…', `Uploading ${names.length} file(s)…`, 'Generating config…', 'Activating…', '✓ Live at ' + url].map((msg) => ({ t: now(), msg }));
  await db.q('INSERT INTO deployments(id,project_id,env,status,url,files_count,log,entry_file_id,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
    [depId, req.project.id, env, 'live', url, names.length, S(log), entry.id, t]);
  await logEvent(req.project.id, 'hosting', 'info', `Deploy live → ${url}`, req.user.id);
  invalidate(req.project.id, 'hosting');
  res.json({ deployment: { id: depId, env, status: 'live', url, files: names.length, log, entryId: entry.id, createdAt: t } });
});
app.get('/api/projects/:pid/deployments', auth, needProject, async (req, res) => {
  const rows = (await db.q('SELECT * FROM deployments WHERE project_id=? ORDER BY created_at DESC LIMIT 20', [req.project.id])).rows;
  res.json({ deployments: rows.map((d) => ({ id: d.id, env: d.env, status: d.status, url: d.url, files: d.files_count, log: J(d.log, []), entryId: d.entry_file_id, createdAt: d.created_at })) });
});
app.get('/pub/:pid/:dep/:file(*)', async (req, res) => {
  const disk = path.join(UPLOAD_DIR, req.params.pid, 'releases', req.params.dep, req.params.file || 'index.html');
  const norm = path.normalize(disk);
  if (!norm.startsWith(path.normalize(path.join(UPLOAD_DIR, req.params.pid)))) return res.status(403).send('forbidden');
  if (!fs.existsSync(norm) || !fs.statSync(norm).isFile()) return res.status(404).send('not found');
  res.sendFile(path.resolve(norm));
});

/* functions */
app.get('/api/projects/:pid/functions', auth, needProject, async (req, res) => {
  const rows = (await db.q('SELECT * FROM functions WHERE project_id=? ORDER BY updated_at DESC', [req.project.id])).rows;
  res.json({ functions: rows.map((f) => ({ id: f.id, name: f.name, runtime: f.runtime, trigger: f.trigger, region: f.region, code: f.code, env: J(f.env, {}), status: f.status, updatedAt: f.updated_at })) });
});
app.post('/api/projects/:pid/functions', auth, needProject, async (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) return res.status(400).json({ error: 'Bad function name' });
  const ex = (await db.q('SELECT id FROM functions WHERE project_id=? AND name=?', [req.project.id, name])).rows[0];
  if (ex) return res.status(409).json({ error: 'Exists' });
  const fn = { id: uid('fn'), code: HELLO_FN(name) };
  await db.q('INSERT INTO functions(id,project_id,name,runtime,trigger,region,code,env,status,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
    [fn.id, req.project.id, name, 'nodejs', 'https', 'auto', fn.code, S({}), 'draft', now()]);
  await logEvent(req.project.id, 'functions', 'info', 'Created ' + name, req.user.id);
  invalidate(req.project.id, 'functions');
  res.json({ fn: { ...fn, name, runtime: 'nodejs', trigger: 'https', region: 'auto', env: {}, status: 'draft', updatedAt: now() } });
});
app.put('/api/projects/:pid/functions/:fid', auth, needProject, async (req, res) => {
  const { code, env, status } = req.body || {};
  await db.q('UPDATE functions SET code=?, env=?, status=?, updated_at=? WHERE id=? AND project_id=?',
    [code != null ? String(code).slice(0, 200000) : undefined, S(env || {}), status || 'draft', now(), req.params.fid, req.project.id]);
  invalidate(req.project.id, 'functions');
  res.json({ ok: true });
});
app.delete('/api/projects/:pid/functions/:fid', auth, needProject, async (req, res) => {
  await db.q('DELETE FROM functions WHERE id=? AND project_id=?', [req.params.fid, req.project.id]);
  await logEvent(req.project.id, 'functions', 'warn', 'Deleted function', req.user.id);
  invalidate(req.project.id, 'functions');
  res.json({ ok: true });
});
app.post('/api/projects/:pid/functions/:fid/run', auth, needProject, async (req, res) => {
  const row = (await db.q('SELECT * FROM functions WHERE id=? AND project_id=?', [req.params.fid, req.project.id])).rows[0];
  if (!row) return res.status(404).json({ error: 'No such function' });
  const t0 = Date.now();
  const reqObj = { query: (req.body && req.body.query) || {}, body: (req.body && req.body.body) || {}, headers: {} };
  let out = null, status = 200;
  const resObj = { json: (o) => { out = o; }, send: (t) => { out = t; }, status: (c) => { status = c; return resObj; } };
  const logs = [];
  const sandboxConsole = { log: (...a) => logs.push(a.map(String).join(' ')), warn: (...a) => logs.push('WARN ' + a.join(' ')), error: (...a) => logs.push('ERR ' + a.join(' ')) };
  try {
    // functions are authored as ES modules (`export const name`) — strip to plain script for the sandbox
    const clean = String(row.code).replace(/export\s+default\s+/g, '').replace(/export\s+(?=const|let|var|function|async\s+function|class)/g, '');
    const src = `(function(exports, console, req, res){ ${clean}\n;return (exports[${JSON.stringify(row.name)}] || (typeof ${row.name} !== 'undefined' ? ${row.name} : null)); })`;
    const h = new vm.Script(src).runInNewContext({ console: sandboxConsole }, { timeout: 5000 })({}, sandboxConsole, reqObj, resObj);
    if (typeof h !== 'function') throw new Error(`No exported handler "${row.name}"`);
    await Promise.race([Promise.resolve(h(reqObj, resObj)), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout 10s')), 10000))]);
    if (out === null) out = '(no response sent)';
  } catch (e) { status = 500; out = { error: String((e && e.message) || e) }; }
  const ms = Date.now() - t0;
  await logEvent(req.project.id, 'functions', status === 500 ? 'error' : 'info', `${row.name} → ${status} in ${ms}ms`, req.user.id);
  res.json({ fn: row.name, status, ms, out, logs });
});

/* rules */
function validateRules(text) {
  const errs = [];
  if (!/rules_version\s*=\s*['"]2['"]/.test(text)) errs.push({ line: 1, msg: `Missing rules_version = '2';` });
  const opens = (text.match(/{/g) || []).length, closes = (text.match(/}/g) || []).length;
  if (opens !== closes) errs.push({ line: text.split('\n').length, msg: `Unbalanced braces` });
  if (/allow\s+(read|write):\s*if\s+true\s*;/.test(text)) errs.push({ line: 1, msg: 'Overly permissive: allow … if true' });
  return errs;
}
app.get('/api/projects/:pid/rules', auth, needProject, async (req, res) => {
  const r = (await db.q('SELECT * FROM rules WHERE project_id=?', [req.project.id])).rows[0];
  res.json({ rules: r ? { text: r.text, deployed: !!r.deployed, updatedAt: r.updated_at } : { text: DEFAULT_RULES(req.project.id), deployed: false, updatedAt: now() } });
});
app.put('/api/projects/:pid/rules', auth, needProject, async (req, res) => {
  const text = String(req.body.text || '');
  const errs = validateRules(text);
  if (errs.length && req.body.deploy) return res.status(400).json({ error: 'Validation failed', errs });
  const deployed = req.body.deploy ? 1 : 0;
  await db.q('INSERT INTO rules(project_id,text,deployed,updated_at) VALUES(?,?,?,?) ON CONFLICT(project_id) DO UPDATE SET text=excluded.text, deployed=excluded.deployed, updated_at=excluded.updated_at',
    [req.project.id, text, deployed, now()]);
  await logEvent(req.project.id, 'rules', deployed ? 'warn' : 'info', deployed ? 'Rules deployed to production' : 'Rules draft saved', req.user.id);
  invalidate(req.project.id, 'rules');
  res.json({ ok: true, deployed: !!deployed });
});
app.post('/api/projects/:pid/rules/simulate', auth, needProject, async (req, res) => {
  const s = req.body || {};
  const text = ((await db.q('SELECT text FROM rules WHERE project_id=?', [req.project.id])).rows[0] || {}).text || '';
  const reasons = [];
  const isOwnerDoc = /users\/\{userId\}/.test(text) && String(s.path).startsWith('users/') && s.uid && s.path === 'users/' + s.uid;
  const hasAuthGate = /request\.auth\s*!=\s*null/.test(text);
  const publicRead = /match\s+\/users\/\{userId\}[\s\S]{0,300}?allow\s+read:\s*if\s+true/.test(text);
  let allow = false;
  if (s.op === 'read' && publicRead && String(s.path).startsWith('users/')) { allow = true; reasons.push('Public read on /users/{userId}'); }
  else if (!s.authed && hasAuthGate) { allow = false; reasons.push('Denied: request.auth == null'); }
  else if (isOwnerDoc && s.authed) { allow = true; reasons.push('Owner rule: uid matches'); }
  else if (s.authed) { allow = ['read', 'write', 'update'].includes(s.op) || s.role === 'admin'; reasons.push('Authenticated fallback rule'); }
  else { allow = false; reasons.push('Denied: no public rule'); }
  res.json({ allow, reasons });
});

/* api keys */
app.get('/api/projects/:pid/keys', auth, needProject, async (req, res) => {
  const rows = (await db.q('SELECT id,name,prefix,created_at,last_used,requests FROM api_keys WHERE project_id=?', [req.project.id])).rows;
  res.json({ keys: rows.map((k) => ({ id: k.id, name: k.name, prefix: k.prefix, createdAt: k.created_at, lastUsed: k.last_used, requests: k.requests })) });
});
app.post('/api/projects/:pid/keys', auth, needProject, async (req, res) => {
  const secret = 'fb_live_' + crypto.randomBytes(18).toString('hex');
  const k = { id: uid('key'), name: String(req.body.name || 'Client key').slice(0, 60) };
  await db.q('INSERT INTO api_keys(id,project_id,name,prefix,key_hash,created_at,requests) VALUES(?,?,?,?,?,?,0)',
    [k.id, req.project.id, k.name, 'fb_live', crypto.createHash('sha256').update(secret).digest('hex'), now()]);
  await logEvent(req.project.id, 'api', 'info', 'API key created: ' + k.name, req.user.id);
  res.json({ key: { ...k, secret, createdAt: now(), lastUsed: null, requests: 0 } }); // secret shown ONCE
});
app.delete('/api/projects/:pid/keys/:kid', auth, needProject, async (req, res) => {
  await db.q('DELETE FROM api_keys WHERE id=? AND project_id=?', [req.params.kid, req.project.id]);
  await logEvent(req.project.id, 'api', 'warn', 'API key revoked', req.user.id);
  res.json({ ok: true });
});

/* logs */
app.get('/api/projects/:pid/logs', auth, needProject, async (req, res) => {
  const { service, level, q: qq } = req.query;
  let sql = 'SELECT id,ts,service,level,msg,user_id AS "user" FROM logs WHERE project_id=?';
  const p = [req.project.id];
  if (service && service !== 'all') { sql += ' AND service=?'; p.push(service); }
  if (level && level !== 'all') { sql += ' AND level=?'; p.push(level); }
  if (qq) { sql += ' AND msg LIKE ?'; p.push('%' + qq + '%'); }
  sql += ' ORDER BY id DESC LIMIT 300';
  res.json({ logs: (await db.q(sql, p)).rows });
});
app.post('/api/projects/:pid/logs', auth, needProject, async (req, res) => {
  const { service, level, msg } = req.body || {};
  await logEvent(req.project.id, service || 'app', ['info', 'warn', 'error'].includes(level) ? level : 'info', msg || '', req.user.id);
  res.json({ ok: true });
});
app.delete('/api/projects/:pid/logs', auth, needProject, needAdmin, async (req, res) => {
  await db.q('DELETE FROM logs WHERE project_id=?', [req.project.id]);
  res.json({ ok: true });
});
app.get('/api/projects/:pid/metrics', auth, needProject, async (req, res) => {
  res.json({ metrics: await buildMetrics(req.project.id) });
});

/* AI proxy — keys stay server-side, never reach the browser */
app.post('/api/ai/chat', auth, limit(20, 60000), async (req, res) => {
  const key = process.env.AI_API_KEY;
  if (!key) return res.status(501).json({ error: 'No AI provider configured on server (AI_API_KEY). Client falls back to local engine.' });
  const endpoint = (req.body.endpoint || process.env.AI_ENDPOINT || 'https://api.openai.com/v1').replace(/\/$/, '');
  const model = req.body.model || process.env.AI_MODEL || 'gpt-4o-mini';
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 30000);
  try {
    const r = await fetch(endpoint + '/chat/completions', {
      method: 'POST', signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify({
        model,
        temperature: req.body.temperature != null ? +req.body.temperature : +(process.env.AI_TEMPERATURE || 0.7),
        max_tokens: req.body.maxTokens || +(process.env.AI_MAX_TOKENS || 1024),
        messages: req.body.messages || [],
      }),
    });
    if (!r.ok) return res.status(502).json({ error: 'Provider HTTP ' + r.status });
    const j = await r.json();
    const reply = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
    res.json({ reply, model, usage: j.usage || null });
  } catch (e) { res.status(502).json({ error: 'Provider unreachable: ' + String(e.message || e) }); }
  finally { clearTimeout(to); }
});

/* ── WebSocket realtime ───────────────────────────────── */
const server = require('http').createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', async (ws, req) => {
  try {
    const u = new URL(req.url, 'http://x');
    const token = u.searchParams.get('token');
    const pid = u.searchParams.get('project');
    if (!token || !pid) return ws.close(4401, 'need token+project');
    const p = jwt.verify(token, JWT_SECRET);
    const prow = (await db.q('SELECT * FROM projects WHERE id=?', [pid])).rows[0];
    if (!prow) return ws.close(4404, 'no project');
    const urow = (await db.q('SELECT * FROM users WHERE id=?', [p.sub])).rows[0];
    if (!urow) return ws.close(4401, 'bad user');
    if (urow.role !== 'admin') {
      const a = (await db.q('SELECT * FROM access WHERE project_id=? AND user_id=?', [pid, p.sub])).rows[0];
      if (!a && prow.owner_id !== p.sub) return ws.close(4403, 'forbidden');
    }
    if (!rooms.has(pid)) rooms.set(pid, new Set());
    rooms.get(pid).add(ws);
    ws.send(JSON.stringify({ type: 'hello', project: pid, t: now() }));
    ws.on('close', () => { const s = rooms.get(pid); if (s) s.delete(ws); });
    ws.on('message', () => { /* server-push only; client msgs ignored */ });
  } catch { try { ws.close(4401, 'auth failed'); } catch { /* ignore */ } }
});

/* ── static frontend (same origin) ─────────────────────── */
const WEB = path.join(__dirname, '..');
app.use(express.static(WEB, { extensions: ['html'] }));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/ws') || req.path.startsWith('/pub')) return next();
  res.sendFile(path.join(WEB, 'index.html'));
});

/* ── boot ──────────────────────────────────────────────── */
(async () => {
  await db.init();
  server.listen(PORT, () => console.log(`[forgebase] real backend on http://localhost:${PORT}  (db: ${db.isPg ? 'postgres' : 'sqlite'})`));
})();
