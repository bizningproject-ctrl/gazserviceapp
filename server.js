/* Gazmetprod Sklad — backend server (Express + SQLite)
   Run:  npm install && npm start
   Open: http://localhost:3000
*/
const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = process.env.DB_FILE || path.join(DATA_DIR, 'warehouse.db');
const PUBLIC_DIR = path.join(__dirname, 'public');

if(!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, {recursive:true});
if(!fs.existsSync(PUBLIC_DIR)) fs.mkdirSync(PUBLIC_DIR, {recursive:true});

// Always sync the latest index.html into public/ on startup
const rootIndex = path.join(__dirname, 'index.html');
const pubIndex = path.join(PUBLIC_DIR, 'index.html');
if(fs.existsSync(rootIndex)){
  const a = fs.statSync(rootIndex).mtimeMs;
  const b = fs.existsSync(pubIndex) ? fs.statSync(pubIndex).mtimeMs : 0;
  if(a > b){ fs.copyFileSync(rootIndex, pubIndex); console.log('Synced index.html → public/index.html'); }
}

/* =================== DATABASE =================== */
const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL CHECK(role IN ('boss','seller','accountant'))
  );
  CREATE TABLE IF NOT EXISTS kv (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Older databases were created with CHECK(role IN ('boss','seller')) — extend to allow 'accountant'.
(function migrateRoleConstraint(){
  try {
    db.prepare("INSERT INTO users (username,password_hash,role) VALUES (?,?,?)")
      .run('__role_check_probe__', 'x', 'accountant');
    db.prepare("DELETE FROM users WHERE username = ?").run('__role_check_probe__');
  } catch(e){
    console.log('Migrating users CHECK to allow accountant…');
    db.exec(`
      CREATE TABLE users_new (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        username      TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role          TEXT NOT NULL CHECK(role IN ('boss','seller','accountant'))
      );
      INSERT INTO users_new (id, username, password_hash, role)
        SELECT id, username, password_hash, role FROM users;
      DROP TABLE users;
      ALTER TABLE users_new RENAME TO users;
    `);
  }
})();

const DEFAULT_STATE = {
  rate: 12900, lang: 'en', theme: 'dark',
  products: [], suppliers: [], sales: [], expenses: [],
  installers: [], installs: [], purchases: [], stockLogs: []
};

const stmt = {
  getKv:    db.prepare('SELECT value, updated_at FROM kv WHERE key = ?'),
  setKv:    db.prepare(`INSERT INTO kv (key,value,updated_at) VALUES (?,?,datetime('now'))
                        ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')`),
  allUsers: db.prepare('SELECT id, username, password_hash, role FROM users ORDER BY id'),
  userByName: db.prepare('SELECT id, username, password_hash, role FROM users WHERE lower(username) = lower(?)'),
  userById: db.prepare('SELECT id, username, password_hash, role FROM users WHERE id = ?'),
  insertUser: db.prepare('INSERT INTO users (username,password_hash,role) VALUES (?,?,?)'),
  updatePass: db.prepare('UPDATE users SET password_hash = ? WHERE id = ?'),
  deleteUser: db.prepare('DELETE FROM users WHERE id = ?'),
  countBoss:  db.prepare(`SELECT COUNT(*) AS n FROM users WHERE role = 'boss'`),
};

function loadState(){
  const row = stmt.getKv.get('state');
  if(!row){ saveState(DEFAULT_STATE); return {...DEFAULT_STATE}; }
  try { return {...DEFAULT_STATE, ...JSON.parse(row.value)}; }
  catch(e){ console.error('state parse error', e); return {...DEFAULT_STATE}; }
}
function saveState(state){ stmt.setKv.run('state', JSON.stringify(state)); }
function stateUpdatedAt(){
  const row = stmt.getKv.get('state');
  return row ? new Date(row.updated_at + 'Z').toISOString() : null;
}

/* One-time migration from legacy JSON files */
function migrateLegacy(){
  const legacyState = path.join(DATA_DIR, 'state.json');
  const legacyUsers = path.join(DATA_DIR, 'users.json');
  if(!stmt.getKv.get('state') && fs.existsSync(legacyState)){
    try {
      const data = JSON.parse(fs.readFileSync(legacyState,'utf8'));
      saveState(data);
      fs.renameSync(legacyState, legacyState + '.imported');
      console.log('Imported legacy state.json → SQLite');
    } catch(e){ console.error('legacy state import failed', e); }
  }
  if(stmt.allUsers.all().length === 0 && fs.existsSync(legacyUsers)){
    try {
      const arr = JSON.parse(fs.readFileSync(legacyUsers,'utf8'));
      const tx = db.transaction(rows => {
        for(const u of rows) stmt.insertUser.run(u.username.toLowerCase(), u.passwordHash, u.role);
      });
      tx(arr);
      fs.renameSync(legacyUsers, legacyUsers + '.imported');
      console.log('Imported legacy users.json → SQLite');
    } catch(e){ console.error('legacy users import failed', e); }
  }
}
migrateLegacy();

function seedUsers(){
  // Seed each default user only if missing — keeps idempotent across restarts.
  const ensure = (uname, pwd, role) => {
    if(!stmt.userByName.get(uname)){
      stmt.insertUser.run(uname, bcrypt.hashSync(pwd, 10), role);
      console.log(`  + seeded ${role}/${uname} with password ${pwd}`);
    }
  };
  ensure('boss',       'million', 'boss');
  ensure('seller',     'work',    'seller');
  ensure('accountant', 'check',   'accountant');
}
seedUsers();

/* =================== AUTH =================== */
const sessions = new Map();
const TOKEN_TTL = 1000*60*60*24*7;
function newToken(){ return crypto.randomBytes(32).toString('hex'); }
setInterval(()=>{
  const now = Date.now();
  for(const [t,s] of sessions) if(now - s.createdAt > TOKEN_TTL) sessions.delete(t);
}, 1000*60*60);

function authMW(req, res, next){
  const token = (req.headers.authorization||'').replace(/^Bearer\s+/i,'');
  const s = sessions.get(token);
  if(!s) return res.status(401).json({error:'unauthorized'});
  if(Date.now() - s.createdAt > TOKEN_TTL){ sessions.delete(token); return res.status(401).json({error:'expired'});}
  req.user = s;
  next();
}
function requireBoss(req, res, next){
  if(req.user.role !== 'boss') return res.status(403).json({error:'forbidden'});
  next();
}

/* =================== APP =================== */
const app = express();
app.use(express.json({limit:'10mb'}));
app.use((req,res,next)=>{ res.setHeader('Cache-Control','no-store'); next(); });

/* =================== LIVE SYNC (SSE) =================== */
const sseClients = new Set();
let lastBroadcastUpdatedAt = stateUpdatedAt() || '';
function broadcastIfChanged(){
  const cur = stateUpdatedAt() || '';
  if(cur && cur !== lastBroadcastUpdatedAt){
    lastBroadcastUpdatedAt = cur;
    const payload = `event: update\ndata: ${JSON.stringify({updatedAt: cur})}\n\n`;
    for(const r of sseClients){ try { r.write(payload); } catch(_){} }
  }
}
// Cross-server detection: pick up writes made by other server instances sharing the DB
setInterval(broadcastIfChanged, 500);
// Heartbeat so idle connections don't get dropped by proxies
setInterval(() => { for(const r of sseClients){ try { r.write(': ping\n\n'); } catch(_){} } }, 25000);

function authQueryOrHeader(req, res, next){
  const token = (req.query && req.query.token) || (req.headers.authorization||'').replace(/^Bearer\s+/i,'');
  const s = sessions.get(token);
  if(!s) return res.status(401).end();
  if(Date.now() - s.createdAt > TOKEN_TTL){ sessions.delete(token); return res.status(401).end();}
  req.user = s; next();
}

app.get('/api/events', authQueryOrHeader, (req, res) => {
  res.setHeader('Content-Type','text/event-stream');
  res.setHeader('Cache-Control','no-cache, no-transform');
  res.setHeader('Connection','keep-alive');
  res.setHeader('X-Accel-Buffering','no');
  if(typeof res.flushHeaders === 'function') res.flushHeaders();
  res.write(`event: hello\ndata: ${JSON.stringify({updatedAt: stateUpdatedAt()})}\n\n`);
  sseClients.add(res);
  req.on('close', () => { sseClients.delete(res); });
});

app.get('/api/health', (req, res) => res.json({ok:true}));

app.post('/api/auth/login', (req, res) => {
  const username = String(req.body?.username||'').trim().toLowerCase();
  const password = String(req.body?.password||'').toLowerCase();
  if(!username || !password) return res.status(400).json({error:'missing fields'});
  const user = stmt.userByName.get(username);
  if(!user) return res.status(401).json({error:'invalid'});
  if(!bcrypt.compareSync(password, user.password_hash)) return res.status(401).json({error:'invalid'});
  const token = newToken();
  sessions.set(token, {username:user.username, role:user.role, createdAt:Date.now()});
  res.json({token, role:user.role, username:user.username});
});

app.post('/api/auth/logout', authMW, (req, res) => {
  const token = (req.headers.authorization||'').replace(/^Bearer\s+/i,'');
  sessions.delete(token);
  res.json({ok:true});
});

app.get('/api/auth/me', authMW, (req, res) => {
  res.json({username:req.user.username, role:req.user.role});
});

app.get('/api/state', authMW, (req, res) => {
  res.json({data: loadState(), updatedAt: stateUpdatedAt()});
});

app.put('/api/state', authMW, (req, res) => {
  const data = req.body?.data;
  if(!data || typeof data !== 'object') return res.status(400).json({error:'bad payload'});
  saveState(data);
  res.json({ok:true, updatedAt: stateUpdatedAt()});
  broadcastIfChanged();
});

/* Backup / Restore (boss) */
app.get('/api/backup', authMW, requireBoss, (req, res) => {
  const data = loadState();
  res.setHeader('Content-Type','application/json');
  res.setHeader('Content-Disposition', `attachment; filename="gazmetprod-backup-${new Date().toISOString().slice(0,10)}.json"`);
  res.send(JSON.stringify(data, null, 2));
});

app.post('/api/restore', authMW, requireBoss, (req, res) => {
  const data = req.body?.data;
  if(!data || typeof data !== 'object') return res.status(400).json({error:'bad payload'});
  saveState(data);
  res.json({ok:true});
});

/* Users (boss) */
app.get('/api/users', authMW, requireBoss, (req, res) => {
  res.json(stmt.allUsers.all().map(u => ({id:u.id, username:u.username, role:u.role})));
});
app.post('/api/users', authMW, requireBoss, (req, res) => {
  const {username, password, role} = req.body || {};
  if(!username || !password || !['boss','seller','accountant'].includes(role))
    return res.status(400).json({error:'bad payload'});
  const uname = String(username).toLowerCase().trim();
  if(stmt.userByName.get(uname)) return res.status(400).json({error:'username exists'});
  const info = stmt.insertUser.run(uname, bcrypt.hashSync(String(password).toLowerCase(),10), role);
  res.json({ok:true, id: info.lastInsertRowid});
});
app.put('/api/users/:id/password', authMW, requireBoss, (req, res) => {
  const id = Number(req.params.id);
  const {password} = req.body || {};
  if(!password) return res.status(400).json({error:'missing password'});
  const u = stmt.userById.get(id); if(!u) return res.status(404).json({error:'not found'});
  stmt.updatePass.run(bcrypt.hashSync(String(password).toLowerCase(),10), id);
  res.json({ok:true});
});
app.delete('/api/users/:id', authMW, requireBoss, (req, res) => {
  const id = Number(req.params.id);
  const u = stmt.userById.get(id); if(!u) return res.status(404).json({error:'not found'});
  if(u.role==='boss' && stmt.countBoss.get().n <= 1)
    return res.status(400).json({error:'cannot delete last boss'});
  stmt.deleteUser.run(id);
  res.json({ok:true});
});

/* Static frontend */
app.use(express.static(PUBLIC_DIR));

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log('\nGazmetprod Sklad backend running');
  console.log(`  DB:       ${DB_FILE}`);
  console.log(`  Local:    http://localhost:${PORT}`);
  const nets = require('os').networkInterfaces();
  for(const name of Object.keys(nets)){
    for(const net of nets[name]){
      if(net.family==='IPv4' && !net.internal) console.log(`  Network:  http://${net.address}:${PORT}`);
    }
  }
  console.log('\nDefault logins:  boss / Million    seller / Work    accountant / Check\n');
});

function shutdown(sig){
  console.log(`\n${sig} received, closing...`);
  server.close(() => { db.close(); process.exit(0); });
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
