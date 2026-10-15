import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE_URL = 'http://localhost:3000';
const OUT_DIR = path.resolve('qa_screenshots');
const ARTIFACT_DIR = 'C:\\Users\\manga\\.gemini\\antigravity-ide\\brain\\16d59a39-555d-40b1-a1d9-0601b04046f9\\screenshots';

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
if (!fs.existsSync(ARTIFACT_DIR)) fs.mkdirSync(ARTIFACT_DIR, { recursive: true });

const TEMP_USER_DATA = path.join(os.tmpdir(), `chrome-cap-${Date.now()}`);

console.log('[Capture] Launching Chrome on port 9444...');
const chromeProcess = spawn(
  CHROME_PATH,
  [
    '--headless=new',
    '--remote-debugging-port=9444',
    `--user-data-dir=${TEMP_USER_DATA}`,
    '--no-first-run',
    '--disable-gpu',
    'about:blank'
  ],
  { stdio: 'ignore' }
);

process.on('exit', () => {
  try { chromeProcess.kill(); } catch (e) {}
});

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function getTab() {
  for (let i = 0; i < 25; i++) {
    try {
      const res = await fetch('http://127.0.0.1:9444/json/list');
      if (res.ok) {
        const tabs = await res.json();
        const t = tabs.find(x => x.type === 'page') || tabs[0];
        if (t && t.webSocketDebuggerUrl) return t;
      }
    } catch (e) {}
    await sleep(300);
  }
  throw new Error('CDP connection failed');
}

async function run() {
  const tab = await getTab();
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));

  let msgId = 1;
  const pending = new Map();
  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.id && pending.has(msg.id)) {
        pending.get(msg.id)(msg.result);
        pending.delete(msg.id);
      }
    } catch (e) {}
  };

  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = msgId++;
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  await send('Page.enable');

  const targets = [
    { name: 'landing', url: `${BASE_URL}/` },
    { name: 'lobby', url: `${BASE_URL}/lobby` },
    { name: 'room', url: `${BASE_URL}/room/RM-4F7K` },
  ];

  for (const target of targets) {
    // 1440px Desktop
    console.log(`[Capture] Navigating to ${target.name} (1440px)...`);
    await send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await send('Page.navigate', { url: target.url });
    await sleep(1500);

    const shot1440 = await send('Page.captureScreenshot', { format: 'png' });
    const buf1440 = Buffer.from(shot1440.data, 'base64');
    fs.writeFileSync(path.join(OUT_DIR, `${target.name}_1440_aligned.png`), buf1440);
    fs.writeFileSync(path.join(ARTIFACT_DIR, `${target.name}_1440_aligned.png`), buf1440);
    console.log(`Saved ${target.name}_1440_aligned.png`);

    // 390px Mobile
    console.log(`[Capture] Navigating to ${target.name} (390px)...`);
    await send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await send('Page.navigate', { url: target.url });
    await sleep(1500);

    const shot390 = await send('Page.captureScreenshot', { format: 'png' });
    const buf390 = Buffer.from(shot390.data, 'base64');
    fs.writeFileSync(path.join(OUT_DIR, `${target.name}_390_aligned.png`), buf390);
    fs.writeFileSync(path.join(ARTIFACT_DIR, `${target.name}_390_aligned.png`), buf390);
    console.log(`Saved ${target.name}_390_aligned.png`);
  }

  ws.close();
  chromeProcess.kill();
  console.log('[Capture] All screenshots captured successfully.');
  process.exit(0);
}

run().catch((err) => {
  console.error('[Capture Error]', err);
  try { chromeProcess.kill(); } catch (e) {}
  process.exit(1);
});
