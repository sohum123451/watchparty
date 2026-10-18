const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const TARGET_PORT = process.env.TUNNEL_PORT || '3001';
const STATUS_FILE = path.join(__dirname, 'active-tunnel.json');

function startTunnel() {
  console.log(`[Tunnel] Launching Pinggy tunnel for port ${TARGET_PORT}...`);
  const proc = spawn('ssh', [
    '-p', '443',
    `-R0:127.0.0.1:${TARGET_PORT}`,
    '-o', 'StrictHostKeyChecking=no',
    '-o', 'ServerAliveInterval=30',
    'a.pinggy.io'
  ]);

  let activeHttpUrl = null;

  proc.stdout.on('data', (data) => {
    const text = data.toString();
    const lines = text.split('\n');
    for (const line of lines) {
      const match = line.match(/(https:\/\/[a-z0-9\-]+\.(?:run\.pinggy-free\.link|free\.pinggy\.net|a\.free\.pinggy\.link))/i);
      if (match && !activeHttpUrl) {
        activeHttpUrl = match[1];
        const wsUrl = activeHttpUrl.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
        console.log(`\n======================================================`);
        console.log(`  [TUNNEL ONLINE]`);
        console.log(`  HTTP: ${activeHttpUrl}`);
        console.log(`  WS:   ${wsUrl}`);
        console.log(`======================================================\n`);
        fs.writeFileSync(STATUS_FILE, JSON.stringify({ httpUrl: activeHttpUrl, wsUrl, timestamp: new Date().toISOString() }, null, 2));
      }
    }
  });

  proc.stderr.on('data', (data) => {
    const text = data.toString();
    if (text.includes('Allocated') || text.includes('expire')) {
      console.log(`[Tunnel Info] ${text.trim()}`);
    }
  });

  proc.on('close', (code) => {
    console.log(`[Tunnel] Process exited with code ${code}. Reconnecting in 3 seconds...`);
    setTimeout(startTunnel, 3000);
  });

  proc.on('error', (err) => {
    console.error(`[Tunnel Error]`, err);
  });
}

startTunnel();
