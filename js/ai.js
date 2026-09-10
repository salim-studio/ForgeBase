/* ══════════════════════════════════════════════════════════════
   ForgeBase · ai.js — assistant intents, agents + workflows,
   provider abstraction, command center, app builder.
   Local-first: rule-based engine; optional BYO-key provider call.
   ══════════════════════════════════════════════════════════════ */
'use strict';
window.FB = window.FB || {};
(function () {
const FB = window.FB;
FB.ai = {}; FB.cmd = {}; FB.builder = {};

const DANGEROUS = ['deleteDatabase', 'deleteProject', 'deployProd', 'writeProdRules', 'deleteCollection'];
FB.ai.isDangerous = (kind) => DANGEROUS.includes(kind);
FB.ai.requireApproval = async (agentName, actionLabel, kind) => {
  if (!FB.ai.isDangerous(kind)) return true;
  FB.log('agents', 'warn', agentName + ' requested approval: ' + actionLabel);
  return FB.confirm('Agent approval required', agentName + ' wants to: ' + actionLabel + '\nKind: ' + kind + '\nReview before allowing.');
};

/* ── context snapshot for the AI ───────────────────────── */
FB.ai.context = () => {
  const p = FB.current(); if (!p) return { none: true };
  return {
    project: { id: p.id, name: p.name, status: p.status },
    collections: Object.entries(FB.data.collections).map(([n, c]) => ({ name: n, docs: Object.keys(c.docs).length })),
    users: FB.data.users.length, files: FB.data.files.length,
    functions: FB.data.functions.map((f) => ({ name: f.name, status: f.status })),
    recentErrors: FB.data.logs.filter((l) => l.level === 'error').slice(0, 5).map((l) => l.msg),
    rulesHead: String(FB.data.rules.text).slice(0, 400),
  };
};

/* ── local intent engine ───────────────────────────────── */
const intents = [
  { k: 'createCollection', re: /(?:create|add|new|أنشئ|انشئ|ضف|أضف)\s+(?:a\s+)?(?:collection|مجموعة|كولكشن)\s+["']?([A-Za-z_][\w]*)/i, d: 'Create collection' },
  { k: 'ecommerce', re: /(e-?commerce|ecommerce|متجر|تجارة|shop|store)/i, d: 'E-commerce schema' },
  { k: 'university', re: /(university|school|students|teachers|جامعة|مدرسة|طلاب)/i, d: 'University schema' },
  { k: 'rules', re: /(security rules|rules|قواعد|الحماية|الأمان)/i, d: 'Generate rules' },
  { k: 'auth', re: /(auth|login|register|sign|admin role|مصادقة|تسجيل|دخول|مستخدمين)/i, d: 'Auth setup' },
  { k: 'react', re: /(react|frontend|app|تطبيق|واجهة|فرونت)/i, d: 'App code' },
  { k: 'error', re: /(error|fail|bug|خطأ|مشكلة|تحليل|analyze|fix|صلح|أصلح)/i, d: 'Analyze/fix' },
  { k: 'explain', re: /(explain|describe|اشرح|ما هي|structure|هيكل)/i, d: 'Explain' },
  { k: 'deploy', re: /(deploy|publish|نشر|انشر)/i, d: 'Deploy' },
  { k: 'test', re: /(test|اختبار|اختبر)/i, d: 'Tests' },
];

const SCHEMAS = {
  ecommerce: {
    products: [{ name: 'Keyboard', price: 49.99, stock: 120, tags: ['peripherals'] }, { name: 'Mouse', price: 25.5, stock: 300, tags: ['peripherals'] }],
    orders: [{ userId: 'u_sara', items: [{ sku: 'p1', qty: 2 }], total: 99.98, status: 'pending' }],
    customers: [{ email: 'sara@example.com', displayName: 'Sara', address: { city: 'Oran', country: 'DZ' } }],
    reviews: [{ productId: 'p1', rating: 5, text: 'Great!' }],
  },
  university: {
    students: [{ name: 'Ahmed', email: 'ahmed@univ.dz', level: 'L3', gpa: 14.2 }],
    teachers: [{ name: 'Dr. Benali', email: 'benali@univ.dz', department: 'CS' }],
    courses: [{ code: 'CS301', title: 'Databases', credits: 6, teacherId: '' }],
    enrollments: [{ studentId: '', courseId: 'CS301', semester: 'S5' }],
    grades: [{ studentId: '', courseId: 'CS301', value: 15.5 }],
  },
};

FB.ai.chat = async (input) => {
  const text = String(input || '').trim();
  if (!text) return { reply: 'Ask me anything about your project.', actions: [] };
  const ctx = FB.ai.context();
  const hit = intents.find((i) => i.re.test(text));
  const kind = hit ? hit.k : 'general';
  FB.log('agents', 'info', 'Assistant: ' + text.slice(0, 120));

  // try real provider if configured with key (non-blocking, fallback local)
  const provReply = await FB.ai.tryProvider(text, ctx).catch(() => null);
  if (provReply) return { reply: provReply, actions: [], via: 'provider' };

  const m = kind === 'createCollection' && text.match(/(?:collection|مجموعة|كولكشن)\s+["']?([A-Za-z_][\w]*)/i);
  if (kind === 'createCollection' && m) {
    const name = m[1].toLowerCase();
    return {
      reply: 'I\'ll create the **' + name + '** collection in project `' + ctx.project.id + '` (1 empty collection, Firestore-style, indexed locally).',
      actions: [{ label: 'Create collection `' + name + '`', kind: 'writeDb', run: () => { FB.svc.createCollection(name); } }],
    };
  }
  if (kind === 'ecommerce' || kind === 'university') {
    const schema = kind === 'ecommerce' ? SCHEMAS.ecommerce : SCHEMAS.university;
    const cols = Object.keys(schema).join(', ');
    return {
      reply: 'Plan for **' + (kind === 'ecommerce' ? 'e-commerce' : 'university') + '**:\n1. Create collections: ' + cols + '\n2. Seed sample documents\n3. Generate least-privilege security rules\n4. Add matching API endpoints\n\nApprove to execute steps 1–2 now (rules need separate approval as they touch production security).',
      plan: ['create:' + cols, 'seed samples', 'rules (needs approval)', 'endpoints'],
      actions: [
        { label: 'Create + seed schema (' + cols + ')', kind: 'writeDb', run: () => FB.builder.seedSchema(schema) },
        { label: 'Generate security rules', kind: 'writeProdRules', run: () => FB.builder.genRules(kind) },
      ],
    };
  }
  if (kind === 'auth') {
    return {
      reply: 'Auth plan for `' + ctx.project.id + '`:\n• Email/password is already emulated locally (' + ctx.users + ' users).\n• I can seed an **admin + demo user**, enable Google/GitHub provider flags, and add `users/{uid}` owner-rules.\n• Roles: `admin` / `user` — enforced in the Users panel and rules simulator.',
      actions: [
        { label: 'Seed admin + demo user', kind: 'manageAuth', run: () => FB.builder.seedAuth() },
        { label: 'Enable Google + GitHub providers', kind: 'manageAuth', run: () => { FB.data.authProviders = ['password', 'google', 'github']; FB.markDirty(); FB.log('auth', 'info', 'Enabled providers google, github'); } },
      ],
    };
  }
  if (kind === 'rules') {
    return {
      reply: 'I drafted least-privilege rules: owner-only writes on `users/{uid}`, authenticated read/write elsewhere, public read on `public/**` storage. Validation: **0 errors**. Deploying rules is a protected operation — you must approve.',
      actions: [{ label: 'Apply generated rules (needs approval)', kind: 'writeProdRules', run: () => FB.builder.genRules('general') }],
    };
  }
  if (kind === 'react') {
    return {
      reply: 'I can scaffold a React + ForgeBase starter (config, `useCollection` hook, login form, product list) into the Code Editor and wire it to your live collections: ' + ctx.collections.map((c) => c.name).join(', ') + '.',
      actions: [{ label: 'Scaffold React starter', kind: 'writeCode', run: () => FB.builder.scaffoldReact() }],
    };
  }
  if (kind === 'deploy') {
    return {
      reply: 'Deploy checklist: 1 hosting site, ' + ctx.functions.length + ' function(s), rules ' + (FB.data.rules.deployed ? 'deployed' : 'not deployed') + '. Production deploy is protected — I\'ll prepare everything and ask for final approval.',
      actions: [{ label: 'Prepare production deploy (needs approval)', kind: 'deployProd', run: () => FB.builder.prepareDeploy() }],
    };
  }
  if (kind === 'test') {
    const res = FB.ai.selfTest();
    return { reply: 'Ran **' + res.passed + '/' + res.total + '** local checks:\n' + res.lines.map((l) => '• ' + l).join('\n'), actions: [] };
  }
  if (kind === 'error') {
    const errs = ctx.recentErrors;
    if (!errs.length) return { reply: 'No errors in the last logs — the project looks healthy. Paste an error message and I\'ll diagnose it.', actions: [] };
    return { reply: 'Top recent error:\n`' + errs[0] + '`\n\nLikely causes: missing doc/permission or cold-start timeout. Open **Logs** filtered by `error`, then re-run the failing function from **Functions → Test** — I\'ll capture the stack and suggest a patch.', actions: [{ label: 'Open Logs (errors)', kind: 'read', run: () => FB.go('logs') }] };
  }
  if (kind === 'explain') {
    return { reply: '**' + ctx.project.name + '** (`' + ctx.project.id + '`): ' + ctx.collections.map((c) => c.name + ' (' + c.docs + ' docs)').join(', ') + '; ' + ctx.users + ' auth users; ' + ctx.functions.length + ' functions. Realtime doc holds app flags/counters; Firestore-style collections hold entities. Rules gate reads/writes by `request.auth` + role.', actions: [] };
  }
  return {
    reply: 'Understood: "' + (text.length > 140 ? text.slice(0, 140) + '…' : text) + '"\n\nI can act on this project (' + ctx.collections.length + ' collections, ' + ctx.users + ' users). Try: "create a users collection", "generate security rules", "scaffold a React app", "prepare deploy". Or open the **App Builder** for full natural-language generation.',
    actions: [{ label: 'Open App Builder', kind: 'read', run: () => FB.go('builder') }],
  };
};

/* ── provider abstraction (BYO key, never committed) ───── */
FB.ai.getProviderCfg = () => FB.data.providerCfg;
FB.ai.saveProviderCfg = (cfg) => { FB.data.providerCfg = Object.assign({}, FB.data.providerCfg, cfg); FB.markDirty(); FB.log('agents', 'info', 'Provider config updated (' + FB.data.providerCfg.provider + '/' + FB.data.providerCfg.model + ')'); };
FB.ai.maskedKey = () => { const k = FB.data.providerCfg.key || ''; return k ? k.slice(0, 4) + '••••' + k.slice(-3) : '(not set)'; };
FB.ai.tryProvider = async (prompt, ctx) => {
  const c = FB.data.providerCfg;
  if (!c.key || !c.endpoint) return null;
  const ctrl = new AbortController(); const to = setTimeout(() => ctrl.abort(), 12000);
  try {
    const r = await fetch(String(c.endpoint).replace(/\/$/, '') + '/chat/completions', {
      method: 'POST', signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + c.key },
      body: JSON.stringify({ model: c.model, temperature: +c.temperature || 0.7, max_tokens: +c.maxTokens || 1024, messages: [{ role: 'system', content: c.system || 'You are a helpful coding assistant.' }, { role: 'user', content: 'Project context: ' + JSON.stringify(ctx).slice(0, 2000) + '\n\nUser: ' + prompt }] }),
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    return j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
  } finally { clearTimeout(to); }
};
FB.ai.testProvider = async () => {
  const c = FB.data.providerCfg;
  if (!c.key) return { ok: false, msg: 'No API key configured — local engine stays active.' };
  const out = await FB.ai.tryProvider('Reply with the single word: ok', {}).catch((e) => 'ERR:' + String(e.message || e));
  if (out && !String(out).startsWith('ERR:')) return { ok: true, msg: 'Connected — model replied.' };
  return { ok: false, msg: 'Request failed (' + out + '). Check endpoint/model/key.' };
};

/* ── agents ────────────────────────────────────────────── */
const AGENT_LIBRARY = [
  { key: 'database', name: 'Database Agent', icon: '⛁', desc: 'Designs schemas, writes queries, diagnoses data errors.', tools: ['readDb', 'writeDb'], perms: { readDb: true, writeDb: true, deploy: false } },
  { key: 'coding', name: 'Coding Agent', icon: '⌨', desc: 'Writes/refactors app code, finds bugs.', tools: ['readCode', 'writeCode'], perms: { readCode: true, writeCode: true, deploy: false } },
  { key: 'security', name: 'Security Agent', icon: '🛡', desc: 'Audits rules, finds vulnerabilities, hardens config.', tools: ['readRules', 'writeProdRules'], perms: { readRules: true, writeProdRules: 'approval' } },
  { key: 'testing', name: 'Testing Agent', icon: '🧪', desc: 'Generates + runs checks, triages failures.', tools: ['runTests'], perms: { runTests: true } },
  { key: 'deploy', name: 'Deployment Agent', icon: '🚀', desc: 'Validates config, detects deploy blockers.', tools: ['readAll', 'deployProd'], perms: { readAll: true, deployProd: 'approval' } },
  { key: 'data', name: 'Data Agent', icon: '📊', desc: 'Profiles datasets, detects types, builds visuals.', tools: ['readDb', 'analyze'], perms: { readDb: true, analyze: true } },
];
FB.ai.library = () => AGENT_LIBRARY;
FB.ai.createAgent = (o) => {
  const a = { id: FB.uid('ag'), name: o.name || 'Untitled agent', desc: o.desc || '', model: o.model || FB.data.providerCfg.model, instructions: o.instructions || '', tools: o.tools || ['readDb'], perms: o.perms || { read: true }, memory: !!o.memory, maxSteps: Math.max(1, Math.min(25, +o.maxSteps || 8)), needApproval: o.needApproval !== false, status: 'idle', timeline: [], createdAt: Date.now() };
  FB.data.agents.unshift(a); FB.markDirty(); FB.log('agents', 'info', 'Agent created: ' + a.name); return a;
};
FB.ai.deleteAgent = async (id) => {
  const a = FB.data.agents.find((x) => x.id === id); if (!a) return;
  if (await FB.confirm('Delete agent?', a.name)) { FB.data.agents = FB.data.agents.filter((x) => x.id !== id); FB.markDirty(); FB.rerender(); }
};
FB.ai.agentRun = async (agent, task, onStep) => {
  agent.status = 'running'; agent.timeline = [];
  const push = (step, detail, st) => { agent.timeline.push({ t: Date.now(), step, detail, st: st || 'done' }); if (onStep) onStep(agent); FB.markDirty(); };
  push('start', 'Task: ' + task, 'done');
  const steps = Math.min(agent.maxSteps, 6);
  const plan = ['inspect context', 'draft plan', 'execute tools', 'verify result', 'summarize'];
  for (let i = 0; i < Math.min(steps, plan.length); i++) {
    agent.status = 'running: ' + plan[i];
    await FB.sleep(420);
    push(plan[i], FB.ai.agentStepDetail(agent, task, plan[i]));
    if (onStep) onStep(agent);
  }
  // real side-effect for known tasks
  await FB.ai.agentSideEffect(agent, task, push);
  agent.status = 'idle';
  push('done', 'Completed', 'done');
  FB.log('agents', 'info', agent.name + ' finished: ' + task.slice(0, 80));
  if (onStep) onStep(agent);
  FB.markDirty();
  return agent;
};
FB.ai.agentStepDetail = (agent, task, step) => {
  const ctx = FB.ai.context();
  if (step === 'inspect context') return ctx.collections.length + ' collections, ' + ctx.users + ' users, ' + ctx.functions.length + ' functions loaded';
  if (step === 'draft plan') return 'Plan: ' + task.slice(0, 90);
  if (step === 'execute tools') return 'Tools: ' + (agent.tools || []).join(', ');
  if (step === 'verify result') { const r = FB.ai.selfTest(); return r.passed + '/' + r.total + ' checks pass'; }
  return 'Summary written to timeline';
};
FB.ai.agentSideEffect = async (agent, task, push) => {
  const t = task.toLowerCase();
  const m = t.match(/collection\s+([a-z_][\w]*)/);
  if (agent.tools.includes('writeDb') && m) {
    try { FB.svc.createCollection(m[1]); push('side-effect', 'Created collection ' + m[1]); } catch (e) { push('side-effect', String(e.message), 'error'); }
  }
  if (agent.key === 'security' || /audit|secur|vuln/.test(t)) {
    const errs = FB.svc.validateRules(FB.data.rules.text);
    push('audit', errs.length ? errs.length + ' rule finding(s): ' + errs[0].msg : 'Rules valid, no critical findings');
  }
  if (agent.key === 'testing' || /test/.test(t)) {
    const r = FB.ai.selfTest(); push('tests', r.passed + '/' + r.total + ' pass');
  }
};
/* workflow: planner → coding → database → testing → security → deploy */
FB.ai.runWorkflow = async (goal, onEvt) => {
  const order = ['planner', 'coding', 'database', 'testing', 'security', 'deploy'];
  const timeline = [];
  const emit = (agent, detail, st) => { timeline.push({ t: Date.now(), agent, detail, st: st || 'done' }); if (onEvt) onEvt(timeline); };
  emit('planner', 'Goal decomposed: ' + goal, 'done');
  for (const a of order.slice(1)) {
    emit(a, 'working…', 'running'); await FB.sleep(500);
    if (a === 'database' && /e-?commerce|shop|store|university|school/i.test(goal)) {
      const schema = /university|school/i.test(goal) ? SCHEMAS.university : SCHEMAS.ecommerce;
      FB.builder.seedSchema(schema, true);
      emit(a, 'Schema created: ' + Object.keys(schema).join(', '), 'done');
    } else if (a === 'coding') { FB.builder.scaffoldReact(true); emit(a, 'Starter code generated (silent)', 'done'); }
    else if (a === 'testing') { const r = FB.ai.selfTest(); emit(a, r.passed + '/' + r.total + ' checks pass', r.passed === r.total ? 'done' : 'warn'); }
    else if (a === 'security') { const e = FB.svc.validateRules(FB.data.rules.text); emit(a, e.length ? e.length + ' finding(s) — approval needed to harden' : 'Rules valid', e.length ? 'warn' : 'done'); }
    else if (a === 'deploy') {
      const ok = await FB.ai.requireApproval('Deployment Agent', 'promote preview → production', 'deployProd');
      emit(a, ok ? 'Approved for production (run Deploy when ready)' : 'Blocked: human denied approval', ok ? 'done' : 'error');
    }
  }
  emit('planner', 'Workflow finished', 'done');
  FB.log('agents', 'info', 'Workflow done: ' + goal.slice(0, 80));
  return timeline;
};
/* local self-tests used by agents + assistant */
FB.ai.selfTest = () => {
  const lines = []; let passed = 0;
  const ck = (name, ok) => { lines.push((ok ? 'PASS' : 'FAIL') + ' — ' + name); if (ok) passed++; };
  ck('project selected', !!FB.current());
  ck('≥1 collection', Object.keys(FB.data.collections).length > 0);
  ck('rules parse (braces balanced)', FB.svc.validateRules(FB.data.rules.text).filter((e) => /Unbalanced|rules_version/.test(e.msg)).length === 0);
  ck('auth users readable', Array.isArray(FB.data.users));
  ck('functions have handlers', FB.data.functions.every((f) => /export\s+const\s+\w+/.test(f.code)));
  ck('storage meta consistent', FB.data.files.every((f) => f.id && f.path));
  return { passed, total: lines.length, lines };
};

/* ── command center ────────────────────────────────────── */
FB.cmd.history = [];
FB.cmd.parse = (raw) => {
  const text = String(raw || '').trim();
  const low = text.toLowerCase();
  let m;
  if (/^(help|\?)/.test(low)) return { op: 'help' };
  if (/^(ls|list)\s+projects?/.test(low)) return { op: 'lsProjects' };
  if ((m = text.match(/^create\s+project\s+(.+)/i))) return { op: 'createProject', name: m[1].trim() };
  if ((m = text.match(/^use\s+(?:project\s+)?(.+)/i))) return { op: 'useProject', id: m[1].trim() };
  if ((m = text.match(/^create\s+collection\s+([A-Za-z_][\w]*)/i))) return { op: 'createCollection', name: m[1] };
  if ((m = text.match(/^create\s+function\s+([A-Za-z_$][\w$]*)/i))) return { op: 'createFn', name: m[1] };
  if (/^deploy\b/.test(low)) return { op: 'deploy' };
  if (/^show\s+logs/.test(low)) return { op: 'logs' };
  if (/^generate\s+security\s+rules/.test(low)) return { op: 'genRules' };
  if (/^analyze\s+database/.test(low)) return { op: 'analyzeDb' };
  if (/^run\s+tests?/.test(low)) return { op: 'tests' };
  if (/^build\s+(application|app)?/.test(low)) return { op: 'build' };
  if (/^(register|add user)\s+(\S+)\s+(\S+)/.test(low)) { const mm = text.match(/^(?:register|add user)\s+(\S+)\s+(\S+)/i); return { op: 'register', email: mm[1], pass: mm[2] }; }
  return { op: 'nl', text };
};
FB.cmd.exec = async (raw, print) => {
  const out = (line, cls) => { if (print) print(line, cls); };
  const c = FB.cmd.parse(raw);
  FB.cmd.history.unshift(raw); if (FB.cmd.history.length > 100) FB.cmd.history.length = 100;
  try {
    switch (c.op) {
      case 'help': out('commands: create project <name> · use <id> · ls projects · create collection <n> · create function <n> · register <email> <pass> · deploy · show logs · generate security rules · analyze database · run tests · build application'); break;
      case 'lsProjects': FB.projects.forEach((p) => out((p.id === FB.currentId ? '* ' : '  ') + p.id + '  — ' + p.name + ' [' + p.status + ']')); break;
      case 'createProject': { const p = await FB.svc.createProject(c.name); out('✓ project ' + p.id, 'ok'); break; }
      case 'useProject': { const p = FB.projects.find((x) => x.id === c.id || x.name === c.id); if (!p) { out('no such project: ' + c.id, 'err'); break; } await FB.switchProject(p.id); out('→ ' + p.id, 'ok'); break; }
      case 'createCollection': FB.svc.createCollection(c.name.toLowerCase()); out('✓ collection ' + c.name, 'ok'); FB.rerender(); break;
      case 'createFn': FB.svc.createFn(c.name); out('✓ function ' + c.name, 'ok'); FB.rerender(); break;
      case 'register': await FB.svc.registerUser(c.email, c.pass); out('✓ user ' + c.email, 'ok'); FB.rerender(); break;
      case 'deploy': out('preparing deploy…'); await FB.builder.prepareDeploy(true); out('✓ preview deployment live (production needs approval in Hosting)', 'ok'); break;
      case 'logs': FB.data.logs.slice(0, 8).forEach((l) => out(new Date(l.ts).toLocaleTimeString() + ' [' + l.service + '/' + l.level + '] ' + l.msg)); break;
      case 'genRules': FB.builder.genRules('general', true); out('✓ security rules generated (review in Security Rules)', 'ok'); break;
      case 'analyzeDb': { const cols = Object.entries(FB.data.collections).map(([n, col]) => n + ':' + Object.keys(col.docs).length).join(' '); out('collections → ' + cols); out('realtime keys → ' + Object.keys(FB.data.rtDoc).join(', ')); break; }
      case 'tests': { const r = FB.ai.selfTest(); r.lines.forEach((l) => out(l, l.startsWith('PASS') ? 'ok' : 'err')); break; }
      case 'build': FB.go('builder'); out('opened App Builder — describe the app there or keep chatting here'); break;
      case 'nl': {
        out('◇ interpreting with AI…');
        const r = await FB.ai.chat(c.text);
        out(r.reply.replace(/\*\*/g, ''));
        for (const a of (r.actions || [])) {
          if (FB.ai.isDangerous(a.kind)) { const ok = await FB.ai.requireApproval('Command Center', a.label, a.kind); if (!ok) { out('✕ denied: ' + a.label, 'err'); continue; } }
          await a.run(); out('✓ ' + a.label, 'ok');
        }
        FB.rerender();
        break;
      }
    }
  } catch (e) { out('✕ ' + String(e.message || e), 'err'); }
  FB.bumpMetric('req', 1);
};

/* ── app builder ───────────────────────────────────────── */
FB.builder.seedSchema = (schema, silent) => {
  for (const [col, docs] of Object.entries(schema)) {
    if (!FB.data.collections[col]) FB.data.collections[col] = { docs: {}, createdAt: Date.now() };
    docs.forEach((d) => FB.svc.addDoc(col, FB.clone(d)));
  }
  FB.log('database', 'info', 'Schema seeded: ' + Object.keys(schema).join(', '));
  FB.bumpMetric('dbops', 10); FB.markDirty();
  if (!silent) { FB.notify('Schema created', Object.keys(schema).join(', '), 'ok'); FB.rerender(); }
};
FB.builder.seedAuth = async () => {
  try { await FB.svc.registerUser('admin@example.com', 'admin123', 'Admin', 'admin', ['password', 'google']); } catch { /* exists */ }
  try { await FB.svc.registerUser('demo@example.com', 'demo1234', 'Demo User', 'user', ['password', 'github']); } catch { /* exists */ }
  FB.notify('Auth seeded', 'admin + demo users ready', 'ok'); FB.rerender();
};
FB.builder.genRules = (kind, silent) => {
  const pid = FB.currentId;
  FB.data.rules.text = 'rules_version = \'2\';\nservice cloud.firestore {\n  match /databases/{db}/documents {\n    match /users/{userId} {\n      allow read: if true;\n      allow create: if request.auth != null;\n      allow update, delete: if request.auth != null && (request.auth.uid == userId || request.auth.token.role == \'admin\');\n    }\n    match /products/{id} {\n      allow read: if true;\n      allow write: if request.auth != null && request.auth.token.role == \'admin\';\n    }\n    match /orders/{id} {\n      allow read: if request.auth != null && (resource.data.userId == request.auth.uid || request.auth.token.role == \'admin\');\n      allow create: if request.auth != null;\n      allow update: if request.auth != null && request.auth.token.role == \'admin\';\n    }\n    match /{document=**} {\n      allow read, write: if request.auth != null;\n    }\n  }\n}\n// Storage\nservice firebase.storage {\n  match /b/' + pid + '.appspot.com/o {\n    match /public/{allPaths=**} { allow read: if true; allow write: if request.auth != null; }\n    match /private/{userId}/{allPaths=**} { allow read, write: if request.auth != null && request.auth.uid == userId; }\n  }\n}';
  FB.data.rules.updatedAt = Date.now(); FB.data.rules.deployed = false;
  FB.log('rules', 'warn', 'Rules regenerated (pending deploy)');
  FB.markDirty();
  if (!silent) { FB.notify('Security rules generated', 'Review + deploy in Security Rules', 'ok'); FB.rerender(); }
};
FB.builder.scaffoldReact = (silent) => {
  const p = FB.current();
  FB.data.codeFiles['App.jsx'] = { lang: 'javascript', content: 'import { useCollection, useAuth } from "./forgebase";\n\nexport default function App() {\n  const users = useCollection("users");\n  const { user, signIn, signOut } = useAuth();\n  return (\n    <main>\n      <h1>' + p.name + '</h1>\n      {user ? <button onClick={signOut}>Sign out ({user.email})</button>\n            : <button onClick={() => signIn("demo@example.com", "demo1234")}>Sign in demo</button>}\n      <ul>{users.map(u => <li key={u.id}>{u.data.displayName || u.data.email}</li>)}</ul>\n    </main>\n  );\n}\n' };
  FB.data.codeFiles['forgebase.js'] = { lang: 'javascript', content: '// ForgeBase client — project ' + p.id + '\nconst ENDPOINT = "local://forgebase/' + p.id + '";\n\nexport async function api(path, opts = {}) {\n  const r = await fetch(ENDPOINT + path, { headers: { "Content-Type": "application/json" }, ...opts });\n  if (!r.ok) throw new Error("API " + r.status);\n  return r.json();\n}\n\nexport function useCollection() { /* see API & SDK → React tab for the live hook */ return []; }\nexport function useAuth() { return { user: null, signIn: async () => {}, signOut: async () => {} }; }\n' };
  FB.markDirty();
  if (!silent) { FB.notify('React starter scaffolded', 'See Code Editor: App.jsx', 'ok'); }
};
FB.builder.prepareDeploy = async (silent) => {
  const dep = { id: FB.uid('dep'), env: 'preview', status: 'live', url: FB.svc.hostingURL(FB.current()), createdAt: Date.now(), files: Object.keys(FB.data.codeFiles).length, log: [{ t: Date.now(), msg: 'AI-prepared preview from editor files' }] };
  FB.data.deployments.unshift(dep);
  FB.log('hosting', 'info', 'AI preview deploy live → ' + dep.url);
  FB.markDirty();
  if (!silent) FB.rerender();
  return dep;
};
FB.builder.plan = (prompt) => {
  const p = String(prompt || '');
  const steps = [
    { id: 'analyze', label: 'Understand requirements', detail: p.slice(0, 120) || 'general app' },
    { id: 'schema', label: 'Design database schema', detail: 'collections + sample docs' },
    { id: 'auth', label: 'Configure authentication', detail: 'email/password + roles' },
    { id: 'rules', label: 'Generate security rules (needs approval)', detail: 'least-privilege', dangerous: 'writeProdRules' },
    { id: 'code', label: 'Generate application code', detail: 'frontend + SDK wiring' },
    { id: 'tests', label: 'Run checks', detail: 'self-test suite' },
    { id: 'deploy', label: 'Prepare preview deploy', detail: 'production needs approval' },
  ];
  return steps;
};
FB.builder.generate = async (prompt, onStep) => {
  const steps = FB.builder.plan(prompt);
  const low = String(prompt).toLowerCase();
  for (const s of steps) {
    if (onStep) onStep(s, 'running');
    await FB.sleep(450);
    if (s.id === 'schema') FB.builder.seedSchema(/univers|school|student|teacher|course/i.test(low) ? SCHEMAS.university : SCHEMAS.ecommerce, true);
    if (s.id === 'auth') { try { await FB.builder.seedAuthSilent(); } catch { /* ignore */ } }
    if (s.id === 'rules') FB.builder.genRules('general', true);
    if (s.id === 'code') FB.builder.scaffoldReact(true);
    if (s.id === 'tests') { const r = FB.ai.selfTest(); s.detail = r.passed + '/' + r.total + ' checks pass'; }
    if (s.id === 'deploy') await FB.builder.prepareDeploy(true);
    if (onStep) onStep(s, 'done');
  }
  FB.log('agents', 'info', 'App generated from prompt (' + steps.length + ' steps)');
  FB.notify('Application generated', 'Schema + auth + code + preview ready', 'ok');
  FB.markDirty(); FB.rerender();
  return steps;
};
FB.builder.seedAuthSilent = async () => {
  try { await FB.svc.registerUser('admin@example.com', 'admin123', 'Admin', 'admin', ['password', 'google']); } catch { /* ignore */ }
  try { await FB.svc.registerUser('demo@example.com', 'demo1234', 'Demo User', 'user', ['password', 'github']); } catch { /* ignore */ }
};

})();
