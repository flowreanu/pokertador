'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const { Table } = require('./game');

const PORT = process.env.PORT || 3000;
const INDEX = path.join(__dirname, 'public', 'index.html');
const ID_CHARS = 'abcdefghjkmnpqrstuvwxyz23456789';
const MAX_ROOMS = 300;

const rooms = new Map();

function newRoomId() {
  for (;;) {
    let id = '';
    for (let i = 0; i < 5; i++) id += ID_CHARS[crypto.randomInt(ID_CHARS.length)];
    if (!rooms.has(id)) return id;
  }
}

function clamp(n, lo, hi, def) {
  n = Math.floor(Number(n));
  if (!Number.isFinite(n)) return def;
  return Math.min(hi, Math.max(lo, n));
}

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];

  if (req.method === 'POST' && url === '/api/create') {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 2000) req.destroy(); });
    req.on('end', () => {
      if (rooms.size >= MAX_ROOMS) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Prea multe mese active, încearcă mai târziu.' }));
      }
      let o = {};
      try { o = JSON.parse(body || '{}'); } catch (e) { /* implicit */ }
      const stack = clamp(o.stack, 100, 1000000, 1000);
      const sb = clamp(o.sb, 1, Math.floor(stack / 4), 10);
      const id = newRoomId();
      const admin = crypto.randomBytes(16).toString('hex');
      rooms.set(id, new Table(id, { stack, sb, adminKey: admin }));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id, admin }));
    });
    return;
  }

  if (url === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('ok');
  }

  if (req.method === 'GET' && (url === '/' || /^\/t\/[a-z0-9]+\/?$/i.test(url))) {
    fs.readFile(INDEX, (err, data) => {
      if (err) { res.writeHead(500); return res.end('Eroare server'); }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.end(data);
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Nu am găsit pagina.');
});

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 2048 });

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.ctx = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch (e) { return; }
    if (!msg || typeof msg.type !== 'string') return;

    if (msg.type === 'join') {
      const table = rooms.get(String(msg.room || '').toLowerCase());
      if (!table) {
        ws.send(JSON.stringify({ type: 'error', fatal: true, msg: 'Masa nu există sau a expirat.' }));
        return;
      }
      const token = String(msg.token || '').slice(0, 64);
      if (token.length < 8) return;
      const r = table.join(token, msg.name, ws, String(msg.admin || '').slice(0, 64));
      if (r.error) {
        ws.send(JSON.stringify({ type: 'error', fatal: true, msg: r.error }));
        return;
      }
      ws.ctx = { table, token };
      return;
    }

    if (!ws.ctx) return;
    const p = ws.ctx.table.findByToken(ws.ctx.token);
    if (!p || p.ws !== ws) return;
    ws.ctx.table.onMessage(p, msg);
  });

  ws.on('close', () => {
    if (ws.ctx) ws.ctx.table.disconnect(ws);
  });
  ws.on('error', () => {});
});

// ping la 25s: ține conexiunea trează prin proxy și elimină conexiunile moarte
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch (e) { /* ignorat */ }
  }
}, 25000);

// curățenie: mese goale de peste 2 ore, jucători dispăruți
setInterval(() => {
  const now = Date.now();
  for (const [id, t] of rooms) {
    t.sweep();
    if (t.connectedCount() === 0 && now - t.lastActivity > 2 * 60 * 60 * 1000) {
      t.destroy();
      rooms.delete(id);
    }
  }
}, 60000);

server.listen(PORT, () => console.log(`Poker pornit pe portul ${PORT}`));
