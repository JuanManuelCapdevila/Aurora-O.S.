'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { listGames, getGame } = require('./library');

const WEB_DIR = path.join(__dirname, '..', 'web');
const SYSTEM_ACTIONS = new Set(['poweroff', 'reboot']);

// El launcher no lanza juegos directamente: deja la acción pedida en
// $runtimeDir/next.json y termina. aurora-session la lee, cierra el launcher
// y abre el juego en su propio gamescope (así no ocupa RAM ni CPU mientras se juega).
function writeNextAction(system, action) {
  fs.mkdirSync(system.runtimeDir, { recursive: true });
  const file = path.join(system.runtimeDir, 'next.json');
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(action));
  fs.renameSync(`${file}.tmp`, file);
}

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
}

function serve(system, { port = 7777, once = false } = {}) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (req.method === 'GET' && url.pathname === '/') {
        return send(res, 200, fs.readFileSync(path.join(WEB_DIR, 'index.html')), 'text/html; charset=utf-8');
      }
      if (req.method === 'GET' && url.pathname === '/api/games') {
        const games = listGames(system.gamesDir).map((g) => ({
          id: g.id,
          name: g.name,
          genre: g.genre,
          api: g.detected?.api,
        }));
        return send(res, 200, games);
      }

      let action = null;
      const launch = url.pathname.match(/^\/api\/launch\/([a-z0-9-]+)$/);
      const sys = url.pathname.match(/^\/api\/system\/([a-z]+)$/);
      if (req.method === 'POST' && launch) {
        getGame(system.gamesDir, launch[1]);
        action = { action: 'launch', id: launch[1] };
      } else if (req.method === 'POST' && sys && SYSTEM_ACTIONS.has(sys[1])) {
        action = { action: sys[1] };
      }
      if (!action) return send(res, 404, { error: 'not found' });

      writeNextAction(system, action);
      send(res, 200, { ok: true });
      if (once) setImmediate(() => server.close(() => process.exit(0)));
    } catch (err) {
      send(res, 400, { error: err.message });
    }
  });
  server.listen(port, '127.0.0.1');
  return server;
}

module.exports = { serve, writeNextAction };
