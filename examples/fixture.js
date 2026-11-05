import { createServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';

const PAGE = `<!doctype html><meta charset="utf-8"><title>Synthetic revocation fixture</title>
<script>
window.syntheticEvents = [];
window.syntheticSocket = new WebSocket('ws://' + location.host + '/events');
window.syntheticReady = new Promise((resolve, reject) => {
  syntheticSocket.addEventListener('open', resolve, {once:true});
  syntheticSocket.addEventListener('error', reject, {once:true});
});
syntheticSocket.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  syntheticEvents.push(message.id);
});
</script>`;

/** Explicitly started, synthetic loopback-only server. It is never an external target adapter. */
export async function startSyntheticFixture(mode = 'fixed') {
  if (!['fixed', 'broken', 'dead-source'].includes(mode)) throw new TypeError('Unsupported synthetic mode');
  let revoked = false;
  let closed = false;
  const clients = new Map();
  const identity = request => /(?:^|;\s*)identity=(subject|control)(?:;|$)/.exec(request.headers.cookie ?? '')?.[1];
  const server = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    const path = new URL(request.url, 'http://fixture.invalid').pathname;
    if (request.method === 'GET' && (path === '/subject' || path === '/control')) {
      response.setHeader('Set-Cookie', `identity=${path.slice(1)}; Path=/; HttpOnly; SameSite=Strict`);
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); response.end(PAGE); return;
    }
    if (request.method === 'GET' && path === '/access') {
      const who = identity(request);
      response.writeHead(!who ? 401 : who === 'subject' && revoked ? 403 : 200); response.end(); return;
    }
    if (request.method !== 'POST' || request.headers['x-synthetic-admin'] !== 'fixture-only') {
      response.writeHead(404); response.end(); return;
    }
    if (path === '/revoke') {
      revoked = true;
      if (mode === 'fixed') {
        for (const [socket, who] of clients) if (who === 'subject') socket.close(1008, 'synthetic access revoked');
      }
      response.writeHead(204); response.end(); return;
    }
    if (path === '/emit') {
      let body = '';
      try {
        for await (const chunk of request) {
          body += chunk;
          if (body.length > 256) throw new Error('Too large');
        }
        const { id } = JSON.parse(body);
        if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid canary');
        if (!(mode === 'dead-source' && revoked)) {
          for (const [socket, who] of clients) {
            if (socket.readyState === WebSocket.OPEN && (who === 'control' || !revoked || mode === 'broken')) socket.send(JSON.stringify({ id }));
          }
        }
        response.writeHead(202); response.end();
      } catch { response.writeHead(400); response.end(); }
      return;
    }
    response.writeHead(404); response.end();
  });
  server.requestTimeout = 2_000;
  server.headersTimeout = 2_000;
  const websocket = new WebSocketServer({ noServer: true });
  server.on('upgrade', (request, socket, head) => {
    const who = identity(request);
    if (request.url !== '/events' || !who) { socket.destroy(); return; }
    websocket.handleUpgrade(request, socket, head, client => {
      clients.set(client, who);
      client.once('close', () => clients.delete(client));
      client.on('error', () => {});
    });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  const url = `http://127.0.0.1:${address.port}`;
  return {
    url,
    async post(path, body) {
      const response = await fetch(new URL(path, url), { method: 'POST', headers: { 'x-synthetic-admin': 'fixture-only', 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(2_000) });
      await response.arrayBuffer();
      return response.status;
    },
    async close() {
      if (closed) return;
      closed = true;
      for (const socket of clients.keys()) socket.terminate();
      await new Promise((resolve, reject) => websocket.close(error => error ? reject(error) : resolve()));
      server.closeAllConnections();
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    },
  };
}
