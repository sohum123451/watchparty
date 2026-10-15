import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT_DIR = path.resolve('qa_screenshots');

// Spin up a simple static file server to serve the reference htmls
const server = http.createServer((req, res) => {
  const filePath = path.join(OUT_DIR, req.url.slice(1));
  if (fs.existsSync(filePath)) {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(fs.readFileSync(filePath));
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(4111, async () => {
  console.log('[Ref Server] Serving on http://127.0.0.1:4111');

  const TEMP_USER_DATA = path.join(os.tmpdir(), `chrome-ref-${Date.now()}`);
  const chromeProcess = spawn(
    CHROME_PATH,
    [
      '--headless=new',
      '--remote-debugging-port=9333',
      `--user-data-dir=${TEMP_USER_DATA}`,
      '--no-first-run',
      '--disable-gpu',
      'about:blank'
    ],
    { stdio: 'ignore' }
  );

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  async function getTab() {
    for (let i = 0; i < 20; i++) {
      try {
        const res = await fetch('http://127.0.0.1:9333/json/list');
        if (res.ok) {
          const tabs = await res.json();
          if (tabs.length > 0) return tabs[0];
        }
      } catch (e) {}
      await sleep(300);
    }
    throw new Error('CDP failed');
  }

  const tab = await getTab();
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);

  let msgId = 1;
  const pending = new Map();
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg.result);
      pending.delete(msg.id);
    }
  };

  function send(method, params = {}) {
    return new Promise(resolve => {
      const id = msgId++;
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  await send('Page.enable');

  const refs = ['landing', 'lobby', 'room'];
  for (const ref of refs) {
    // 1440px
    await send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false
    });
    await send('Page.navigate', { url: `http://127.0.0.1:4111/reference_${ref}.html` });
    await sleep(800);
    const shot1440 = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT_DIR, `reference_${ref}_1440.png`), Buffer.from(shot1440.data, 'base64'));
    console.log(`Saved reference_${ref}_1440.png`);
  }

  ws.close();
  chromeProcess.kill();
  server.close();
  process.exit(0);
});
