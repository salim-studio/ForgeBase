/* ForgeBase · db.js — storage adapter: SQLite (node:sqlite, default)
   or Postgres when DATABASE_URL is set. Same interface either way. */
'use strict';

const isPg = !!process.env.DATABASE_URL;
let pgPool = null;
let lite = null;

async function init() {
  if (isPg) {
    const { Pool } = require('pg');
    pgPool = new Pool({ connectionString: process.env.DATABASE_URL });
    await pgPool.query('SELECT 1');
    await migrate(pgQuery, 'pg');
    console.log('[db] postgres connected');
  } else {
    const fs = require('fs');
    const path = require('path');
    const p = process.env.SQLITE_PATH || './data/forgebase.db';
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const { DatabaseSync } = require('node:sqlite');
    lite = new DatabaseSync(p);
    migrate(liteQuery, 'sqlite');
    console.log('[db] sqlite at ' + p);
  }
}

/* low-level: both return { rows } */
function liteQuery(sql, params) {
  const st = lite.prepare(sql);
  if (/^\s*select/i.test(sql)) return { rows: st.all(...(params || [])) };
  const r = st.run(...(params || []));
  return { rows: [], changes: Number(r.changes), lastID: Number(r.lastInsertRowid) };
}
async function pgQuery(sql, params) {
  // translate ? placeholders to $1..$n
  let i = 0;
  const psql = sql.replace(/\?/g, () => '$' + (++i));
  const r = await pgPool.query(psql, params || []);
  return { rows: r.rows, changes: r.rowCount, lastID: r.rows[0] && r.rows[0].id };
}

function q(sql, params) {
  return isPg ? pgQuery(sql, params) : Promise.resolve(liteQuery(sql, params));
}

function migrate(run, flavor) {
  const auto = flavor === 'pg' ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
  const stmts = [
    `CREATE TABLE IF NOT EXISTS users(
      id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, pass_hash TEXT NOT NULL,
      display_name TEXT, role TEXT DEFAULT 'user', status TEXT DEFAULT 'active',
      providers TEXT DEFAULT '["password"]', created_at BIGINT, last_login BIGINT)`,
    `CREATE TABLE IF NOT EXISTS projects(
      id TEXT PRIMARY KEY, name TEXT NOT NULL, status TEXT DEFAULT 'active',
      description TEXT DEFAULT '', env TEXT DEFAULT 'cloud', region TEXT DEFAULT 'auto',
      owner_id TEXT, created_at BIGINT, activity BIGINT)`,
    `CREATE TABLE IF NOT EXISTS access(
      project_id TEXT, user_id TEXT, role TEXT DEFAULT 'member',
      PRIMARY KEY(project_id, user_id))`,
    `CREATE TABLE IF NOT EXISTS docs(
      project_id TEXT, collection TEXT, doc_id TEXT, data TEXT,
      created_at BIGINT, updated_at BIGINT,
      PRIMARY KEY(project_id, collection, doc_id))`,
    `CREATE INDEX IF NOT EXISTS idx_docs_lookup ON docs(project_id, collection, updated_at)`,
    `CREATE TABLE IF NOT EXISTS rt(project_id TEXT PRIMARY KEY, data TEXT)`,
    `CREATE TABLE IF NOT EXISTS files(
      id TEXT PRIMARY KEY, project_id TEXT, name TEXT, path TEXT, size BIGINT,
      mime TEXT, access TEXT DEFAULT 'private', created_at BIGINT)`,
    `CREATE INDEX IF NOT EXISTS idx_files_proj ON files(project_id)`,
    `CREATE TABLE IF NOT EXISTS functions(
      id TEXT PRIMARY KEY, project_id TEXT, name TEXT, runtime TEXT DEFAULT 'nodejs',
      trigger TEXT DEFAULT 'https', region TEXT DEFAULT 'auto', code TEXT,
      env TEXT DEFAULT '{}', status TEXT DEFAULT 'draft', updated_at BIGINT)`,
    `CREATE TABLE IF NOT EXISTS rules(
      project_id TEXT PRIMARY KEY, text TEXT, deployed INTEGER DEFAULT 0, updated_at BIGINT)`,
    `CREATE TABLE IF NOT EXISTS api_keys(
      id TEXT PRIMARY KEY, project_id TEXT, name TEXT, prefix TEXT,
      key_hash TEXT, created_at BIGINT, last_used BIGINT, requests BIGINT DEFAULT 0)`,
    `CREATE TABLE IF NOT EXISTS deployments(
      id TEXT PRIMARY KEY, project_id TEXT, env TEXT, status TEXT, url TEXT,
      files_count INTEGER DEFAULT 0, log TEXT DEFAULT '[]', entry_file_id TEXT,
      created_at BIGINT)`,
    `CREATE TABLE IF NOT EXISTS logs(
      id ${auto}, project_id TEXT, ts BIGINT, service TEXT, level TEXT,
      msg TEXT, user_id TEXT)`,
    `CREATE INDEX IF NOT EXISTS idx_logs_lookup ON logs(project_id, ts)`,
    `CREATE TABLE IF NOT EXISTS hits(day TEXT PRIMARY KEY, count BIGINT DEFAULT 0)`,
    `CREATE TABLE IF NOT EXISTS kv(project_id TEXT, key TEXT, value TEXT,
      PRIMARY KEY(project_id, key))`,
  ];
  if (flavor === 'pg') return (async () => { for (const s of stmts) await run(s); })();
  for (const s of stmts) run(s);
  return Promise.resolve();
}

module.exports = { init, q, isPg };
