/**
 * Public Launch Gateway for WatchParty "The Private Cinema"
 * Unifies Next.js (port 3000) and WebSocket / REST API server (port 3001)
 * into a single unified public endpoint (port 4000).
 */
const http = require('http');
const net = require('net');

const PORT = parseInt(process.env.GATEWAY_PORT || '4000', 10);
const NEXT_PORT = parseInt(process.env.NEXT_PORT || '3000', 10);
const API_PORT = parseInt(process.env.API_PORT || '3001', 10);

const server = http.createServer((req, res) => {
  const isApi = req.url && req.url.startsWith('/api');
  const targetPort = isApi ? API_PORT : NEXT_PORT;

  const clientIp = req.socket.remoteAddress || '127.0.0.1';
  const headers = { ...req.headers };
  headers['host'] = `127.0.0.1:${targetPort}`;
  headers['x-forwarded-for'] = req.headers['x-forwarded-for']
    ? `${req.headers['x-forwarded-for']}, ${clientIp}`
    : clientIp;
  if (!headers['x-forwarded-proto']) {
    headers['x-forwarded-proto'] = 'https';
  }

  const proxyReq = http.request(
    {
      hostname: '127.0.0.1',
      port: targetPort,
      path: req.url,
      method: req.method,
      headers,
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    }
  );

  proxyReq.on('error', (err) => {
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Gateway Proxy Error', details: err.message }));
    }
  });

  req.pipe(proxyReq);
});

// Proxy WebSocket connections directly to server (port 3001)
server.on('upgrade', (req, socket, head) => {
  const proxySocket = net.connect(API_PORT, '127.0.0.1', () => {
    let raw = `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`;
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      raw += `${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}\r\n`;
    }
    raw += '\r\n';

    proxySocket.write(raw);
    if (head && head.length > 0) {
      proxySocket.write(head);
    }

    socket.pipe(proxySocket);
    proxySocket.pipe(socket);
  });

  proxySocket.on('error', () => {
    socket.destroy();
  });

  socket.on('error', () => {
    proxySocket.destroy();
  });
});

server.listen(PORT, () => {
  console.log(`[WatchParty Gateway] Unified gateway listening on port ${PORT} (dual-stack IPv4/IPv6)`);
  console.log(`  -> Web UI / Next.js: http://127.0.0.1:${NEXT_PORT}`);
  console.log(`  -> API & WebSockets: http://127.0.0.1:${API_PORT}`);
});
