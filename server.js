/* ════════════════════════════════════════════════════════════
   PINIT SERVER — pokretanje:  node server.js
   Bez ikakvih instalacija (nula zavisnosti, samo Node.js).

   Servira:
     http://ADRESA:3000/           → mobilna aplikacija (app.html)
     http://ADRESA:3000/komandni   → komandni centar (komandni.html)
   API:
     POST  /api/register            {name, city}        → {userId, token}
     GET   /api/reports?city=X      → lista prijava
     POST  /api/reports             {token, cat, note, photo, lat, lng, ts, city, name}
     POST  /api/reports/:id/vote    {delta}
     PATCH /api/reports/:id         {status 0-3}        ← komandni centar mijenja status
     GET   /api/drives?city=X       → lista vožnji
     POST  /api/drives              (šalje aplikacija sama)
     GET   /api/stats?city=X
   Podaci se čuvaju u data.json pored servera.
   ════════════════════════════════════════════════════════════ */
'use strict';
const http = require('http'), fs = require('fs'), path = require('path'),
      crypto = require('crypto'), os = require('os');

const PORT = process.env.PORT || 3000;
const DATA = path.join(__dirname, 'data.json');
const PUB  = path.join(__dirname, 'public');

let DB = { users: [], reports: [], drives: [], workers: [] };
try { DB = Object.assign(DB, JSON.parse(fs.readFileSync(DATA, 'utf8'))); } catch (e) {}
let saveT = null;
function save() { clearTimeout(saveT); saveT = setTimeout(() =>
  fs.writeFile(DATA, JSON.stringify(DB), () => {}), 300); }

function json(res, code, obj) {
  const b = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(b);
}
function readBody(req, cb) {
  let d = '';
  req.on('data', c => { d += c; if (d.length > 25e6) { req.destroy(); } });
  req.on('end', () => { try { cb(JSON.parse(d || '{}')); } catch (e) { cb(null); } });
}
function log(msg) { console.log(new Date().toLocaleTimeString('bs'), '·', msg); }

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript',
  '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const p = u.pathname;

  /* CORS preflight */
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PATCH,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    return res.end();
  }

  /* ── API ── */
  if (p === '/api/register' && req.method === 'POST') {
    return readBody(req, b => {
      if (!b || !b.name || !b.city) return json(res, 400, { error: 'name i city su obavezni' });
      const user = {
        id: 'u_' + crypto.randomBytes(5).toString('hex'),
        token: crypto.randomBytes(16).toString('hex'),
        name: String(b.name).slice(0, 60),
        city: String(b.city).slice(0, 60),
        created: Date.now()
      };
      DB.users.push(user); save();
      log('👤 Novi nalog: ' + user.name + ' (' + user.city + ')');
      json(res, 200, { userId: user.id, token: user.token });
    });
  }

  if (p === '/api/reports' && req.method === 'GET') {
    const city = u.searchParams.get('city');
    let list = DB.reports;
    if (city) list = list.filter(r => r.city === city);
    return json(res, 200, list.slice(-300));
  }

  if (p === '/api/reports' && req.method === 'POST') {
    return readBody(req, b => {
      if (!b || !b.cat) return json(res, 400, { error: 'cat je obavezan' });
      const user = DB.users.find(x => x.token === b.token) || null;
      const r = {
        id: Date.now() * 1000 + Math.floor(Math.random() * 999),
        userId: user ? user.id : null,
        name: user ? user.name : (b.name || 'anonimno'),
        city: b.city || (user && user.city) || '',
        cat: String(b.cat).slice(0, 30),
        note: String(b.note || '').slice(0, 1000),
        photo: (typeof b.photo === 'string' && b.photo.length < 8e6) ? b.photo : null,
        lat: (typeof b.lat === 'number') ? b.lat : null,
        lng: (typeof b.lng === 'number') ? b.lng : null,
        acc: (typeof b.acc === 'number') ? Math.round(b.acc) : null,
        ts: b.ts || Date.now(),
        status: 0, votes: 0, confirms: 0, resolvedAt: null,
        worker: null, cost: null, pri: null,
        history: [{ status: 0, t: Date.now() }]
      };
      DB.reports.push(r); save();
      log('📨 Nova prijava: ' + r.cat + ' · ' + r.city + ' · ' + r.name +
          (r.lat ? ' @ ' + r.lat.toFixed(5) + ',' + r.lng.toFixed(5) : ' (bez GPS-a)'));
      json(res, 200, { ok: true, id: r.id });
    });
  }

  let m = p.match(/^\/api\/reports\/(\d+)\/vote$/);
  if (m && req.method === 'POST') {
    return readBody(req, b => {
      const r = DB.reports.find(x => String(x.id) === m[1]);
      if (!r) return json(res, 404, { error: 'nema prijave' });
      const d = (b && b.delta === -1) ? -1 : 1;
      r.votes = Math.max(0, (r.votes || 0) + d);
      r.confirms = Math.max(0, (r.confirms || 0) + d);
      save(); json(res, 200, { ok: true, votes: r.votes });
    });
  }

  m = p.match(/^\/api\/reports\/(\d+)$/);
  if (m && req.method === 'PATCH') {
    return readBody(req, b => {
      const r = DB.reports.find(x => String(x.id) === m[1]);
      if (!r) return json(res, 404, { error: 'nema prijave' });
      if (b && typeof b.status === 'number' && b.status >= 0 && b.status <= 3) {
        r.status = b.status;
        r.history.push({ status: b.status, t: Date.now() });
        if (b.status === 3) r.resolvedAt = Date.now();
        log('🔧 Status prijave ' + r.cat + ' → ' + ['čeka', 'obaviještena služba', 'u toku', 'riješeno'][b.status]);
      }
      if (b && 'worker' in b) {
        r.worker = b.worker;
        const w = DB.workers.find(x => x.id === b.worker);
        log('👷 Dodijeljeno: ' + r.cat + ' → ' + (w ? w.name : 'nitko'));
      }
      if (b && typeof b.cost === 'number') r.cost = b.cost;
      if (b && typeof b.pri === 'string') r.pri = b.pri;
      if (b && typeof b.photoBefore === 'string' && b.photoBefore.length < 8e6) r.photoBefore = b.photoBefore;
      if (b && typeof b.photoAfter === 'string' && b.photoAfter.length < 8e6) r.photoAfter = b.photoAfter;
      save();
      json(res, 200, { ok: true, status: r.status, worker: r.worker });
    });
  }

  /* ── RADNICI ── */
  if (p === '/api/workers' && req.method === 'GET') {
    const city = u.searchParams.get('city');
    let list = DB.workers;
    if (city) list = list.filter(w => w.city === city);
    return json(res, 200, list);
  }
  if (p === '/api/workers' && req.method === 'POST') {
    return readBody(req, b => {
      if (!b || !b.name) return json(res, 400, { error: 'name je obavezan' });
      const initials = String(b.name).trim().split(/\s+/).map(s => s[0] || '').join('').slice(0, 2).toUpperCase();
      const w = {
        id: 'w_' + crypto.randomBytes(4).toString('hex'),
        name: String(b.name).slice(0, 60),
        role: String(b.role || 'Terenac').slice(0, 40),
        dept: String(b.dept || 'putevi').slice(0, 20),
        city: String(b.city || '').slice(0, 60),
        av: initials || '?',
        created: Date.now()
      };
      DB.workers.push(w); save();
      log('➕ Novi radnik: ' + w.name + ' (' + w.role + ', ' + w.dept + ')');
      json(res, 200, { ok: true, worker: w });
    });
  }
  m = p.match(/^\/api\/workers\/(w_[a-f0-9]+)\/loc$/);
  if (m && req.method === 'POST') {
    return readBody(req, b => {
      const w = DB.workers.find(x => x.id === m[1]);
      if (!w) return json(res, 404, { error: 'nema radnika' });
      if (b && typeof b.lat === 'number' && typeof b.lng === 'number') {
        w.lat = b.lat; w.lng = b.lng; w.locTs = Date.now(); save();
      }
      json(res, 200, { ok: true });
    });
  }
  m = p.match(/^\/api\/workers\/(w_[a-f0-9]+)$/);
  if (m && req.method === 'DELETE') {
    const i = DB.workers.findIndex(w => w.id === m[1]);
    if (i < 0) return json(res, 404, { error: 'nema radnika' });
    const w = DB.workers.splice(i, 1)[0];
    DB.reports.forEach(r => { if (r.worker === w.id) r.worker = null; });
    save();
    return json(res, 200, { ok: true });
  }

  if (p === '/api/drives' && req.method === 'GET') {
    const city = u.searchParams.get('city');
    let list = DB.drives;
    if (city) list = list.filter(d => d.city === city);
    return json(res, 200, list.slice(-100));
  }

  if (p === '/api/drives' && req.method === 'POST') {
    return readBody(req, b => {
      if (!b || !b.drive) return json(res, 400, { error: 'drive je obavezan' });
      const rec = {
        id: 'd_' + Date.now() + '_' + Math.floor(Math.random() * 999),
        ts: Date.now(),
        deviceId: b.deviceId || null,
        city: b.city || '',
        name: b.name || '',
        drive: b.drive
      };
      DB.drives.push(rec); save();
      const d = b.drive;
      log('🚗 Nova vožnja: ' + (d.km || 0) + ' km · ' +
          ((d.segments || []).length) + ' segmenata · ' + ((d.bumps || []).length) + ' udara · ' + rec.city);
      json(res, 200, { ok: true, id: rec.id });
    });
  }

  if (p === '/api/stats' && req.method === 'GET') {
    const city = u.searchParams.get('city');
    const R = city ? DB.reports.filter(r => r.city === city) : DB.reports;
    const D = city ? DB.drives.filter(d => d.city === city) : DB.drives;
    return json(res, 200, {
      users: DB.users.length, reports: R.length,
      resolved: R.filter(r => r.status === 3).length,
      inProgress: R.filter(r => r.status === 1 || r.status === 2).length,
      drives: D.length,
      km: +D.reduce((s, d) => s + (d.drive.km || 0), 0).toFixed(1),
      bumps: D.reduce((s, d) => s + (d.drive.bumps || []).length, 0)
    });
  }

  /* ── statika ── */
  let file = null;
  if (p === '/' || p === '/app') file = 'app.html';
  else if (p === '/komandni') file = 'komandni.html';
  else if (p === '/platforma' || p === '/platform') file = 'platforma.html';
  else if (p === '/radnik') file = 'radnik.html';
  else file = p.replace(/^\/+/, '').replace(/\.\./g, '');
  const fp = path.join(PUB, file);
  fs.readFile(fp, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('404'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
    res.end(buf);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  const nets = os.networkInterfaces(); let lan = null;
  for (const k of Object.keys(nets)) for (const n of nets[k])
    if (n.family === 'IPv4' && !n.internal) { lan = n.address; break; }
  console.log('════════════════════════════════════════════════');
  console.log(' PINIT server radi.');
  console.log('   Na ovom računaru:  http://localhost:' + PORT);
  if (lan) {
    console.log('   Sa telefona (ista Wi-Fi mreža):');
    console.log('       aplikacija:      http://' + lan + ':' + PORT);
    console.log('       komandni (Drive): http://' + lan + ':' + PORT + '/komandni');
    console.log('       platforma (prijave): http://' + lan + ':' + PORT + '/platforma');
  }
  console.log('   Podaci: ' + DATA);
  console.log('════════════════════════════════════════════════');
});
