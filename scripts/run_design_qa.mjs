import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE_URL = 'http://localhost:3000';
const OUT_DIR = path.resolve('qa_screenshots');

if (!fs.existsSync(OUT_DIR)) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

const TEMP_USER_DATA = path.join(os.tmpdir(), `chrome-qa-${Date.now()}`);

console.log('[QA] Starting Chrome on port 9222...');
const chromeProcess = spawn(
  CHROME_PATH,
  [
    '--headless=new',
    '--remote-debugging-port=9222',
    `--user-data-dir=${TEMP_USER_DATA}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--window-size=1440,900',
    'about:blank'
  ],
  { stdio: 'ignore' }
);

process.on('exit', () => {
  try { chromeProcess.kill(); } catch (e) {}
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForCdp(maxRetries = 30) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch('http://127.0.0.1:9222/json/list');
      if (res.ok) {
        const tabs = await res.json();
        const pageTab = tabs.find(t => t.type === 'page') || tabs[0];
        if (pageTab && pageTab.webSocketDebuggerUrl) return pageTab;
      }
    } catch (e) {}
    await sleep(300);
  }
  throw new Error('Failed to connect to Chrome CDP on port 9222');
}

class CDPClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.msgId = 1;
    this.pending = new Map();
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.onopen = () => {
        console.log('[CDP] WebSocket connected');
        resolve();
      };
      this.ws.onerror = (err) => reject(err);
      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.id && this.pending.has(msg.id)) {
            const { resolve, reject, timer, method } = this.pending.get(msg.id);
            clearTimeout(timer);
            this.pending.delete(msg.id);
            if (msg.error) {
              console.warn(`[CDP] ${method} returned error:`, msg.error.message);
              reject(new Error(msg.error.message));
            } else {
              resolve(msg.result);
            }
          }
        } catch (e) {
          console.error('[CDP] JSON parse error:', e);
        }
      };
    });
  }

  send(method, params = {}, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      const id = this.msgId++;
      const timer = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`[CDP] Timeout calling ${method}`));
        }
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, method });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    if (this.ws) {
      try { this.ws.close(); } catch (e) {}
    }
  }
}

async function runAudit() {
  const tab = await waitForCdp();
  console.log('[QA] Connected to CDP:', tab.webSocketDebuggerUrl);

  const cdp = new CDPClient(tab.webSocketDebuggerUrl);
  await cdp.connect();

  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  const screens = [
    { name: 'landing', path: '/' },
    { name: 'lobby', path: '/lobby' },
    { name: 'room', path: '/room/CRITERION-70MM' },
    { name: 'login', path: '/login' },
    { name: 'signup', path: '/signup' },
    { name: 'join', path: '/join/CRITERION-70MM' },
    { name: 'motion-demo', path: '/motion-demo' }
  ];

  const report = {
    timestamp: new Date().toISOString(),
    screens: {},
    reducedMotionAudit: {},
    performanceAudit: {},
    syncDriftCheck: {}
  };

  for (const screen of screens) {
    console.log(`\n========================================`);
    console.log(`[QA] Auditing: ${screen.name} (${screen.path})`);
    const screenData = {
      name: screen.name,
      path: screen.path,
      desktop: {},
      mobile: {}
    };

    // 1. Desktop 1440x900
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false
    });

    console.log(`[QA] Navigating to ${BASE_URL}${screen.path}...`);
    await cdp.send('Page.navigate', { url: `${BASE_URL}${screen.path}` });
    await sleep(2000);

    // Desktop screenshot
    const desktopFile = path.join(OUT_DIR, `${screen.name}_1440.png`);
    try {
      const desktopShot = await cdp.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(desktopFile, Buffer.from(desktopShot.data, 'base64'));
      console.log(`[QA] Saved desktop screenshot: ${desktopFile}`);
      screenData.desktop.screenshot = desktopFile;
    } catch (e) {
      console.error('[QA] Desktop screenshot error:', e.message);
    }

    // Run DOM Audits on Desktop
    try {
      const evalAudit = await cdp.send('Runtime.evaluate', {
        expression: `(() => {
          function parseRgb(colorStr) {
            if (!colorStr || colorStr === 'transparent') return null;
            const match = colorStr.match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)(?:,\\s*([\\d.]+))?\\)/);
            if (!match) return null;
            const a = match[4] !== undefined ? parseFloat(match[4]) : 1;
            if (a === 0) return null;
            return { r: parseInt(match[1]), g: parseInt(match[2]), b: parseInt(match[3]), a };
          }

          function getEffectiveBg(elem) {
            let curr = elem;
            while (curr && curr !== document.body) {
              const bg = window.getComputedStyle(curr).backgroundColor;
              const parsed = parseRgb(bg);
              if (parsed && parsed.a > 0.5) return parsed;
              curr = curr.parentElement;
            }
            return { r: 14, g: 11, b: 9, a: 1 }; // default --bg: #0E0B09
          }

          function getLuminance({ r, g, b }) {
            const a = [r, g, b].map(v => {
              v /= 255;
              return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
            });
            return a[0] * 0.2126 + a[1] * 0.7152 + a[2] * 0.0722;
          }

          function getContrast(rgb1, rgb2) {
            const l1 = getLuminance(rgb1);
            const l2 = getLuminance(rgb2);
            const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
            return Math.round(ratio * 100) / 100;
          }

          const contrastViolations = [];
          const textElements = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6, p, span, button, a, label, input, li'));
          for (const el of textElements) {
            const text = el.innerText ? el.innerText.trim() : '';
            if (!text || text.length === 0 || text.length > 80) continue;
            const style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) < 0.2) continue;

            const fg = parseRgb(style.color);
            if (!fg) continue;
            const bg = getEffectiveBg(el);
            const contrast = getContrast(fg, bg);

            const fontSize = parseFloat(style.fontSize);
            const isBold = parseInt(style.fontWeight) >= 700;
            const isLarge = fontSize >= 24 || (fontSize >= 18.66 && isBold);
            const minRatio = isLarge ? 3.0 : 4.5;

            if (contrast < minRatio) {
              contrastViolations.push({
                tag: el.tagName.toLowerCase(),
                text: text.slice(0, 40),
                contrast,
                required: minRatio,
                fg: style.color,
                bg: 'rgb(' + bg.r + ',' + bg.g + ',' + bg.b + ')',
                selector: el.className ? '.' + el.className.split(' ').slice(0, 2).join('.') : el.tagName
              });
            }
          }

          const interactive = Array.from(document.querySelectorAll('button, a, input, select, textarea, [tabindex]'));
          const focusMissing = [];
          for (const el of interactive) {
            if (el.getAttribute('tabindex') === '-1' || el.disabled) continue;
            const cls = el.className || '';
            const hasFocusRing = cls.includes('focus-visible') || cls.includes('focus:');
            const style = window.getComputedStyle(el);
            if (!hasFocusRing && style.outlineStyle === 'none' && !style.boxShadow.includes('rgb')) {
              focusMissing.push({
                tag: el.tagName.toLowerCase(),
                text: (el.innerText || el.getAttribute('placeholder') || el.getAttribute('aria-label') || '').trim().slice(0, 30),
                class: cls.slice(0, 60)
              });
            }
          }

          const positiveTabIndices = Array.from(document.querySelectorAll('[tabindex]'))
            .filter(el => parseInt(el.getAttribute('tabindex') || '0', 10) > 0)
            .map(el => ({ tag: el.tagName.toLowerCase(), tabIndex: el.getAttribute('tabindex') }));

          const headings = Array.from(document.querySelectorAll('h1, h2, h3')).map(h => {
            const style = window.getComputedStyle(h);
            return {
              tag: h.tagName.toLowerCase(),
              text: (h.innerText || '').slice(0, 30),
              fontFamily: style.fontFamily,
              letterSpacing: style.letterSpacing
            };
          });

          return {
            contrastViolations: contrastViolations.slice(0, 10),
            focusMissing: focusMissing.slice(0, 10),
            positiveTabIndices,
            headings,
            totalInteractive: interactive.length
          };
        })()`,
        returnByValue: true
      });
      screenData.desktop.audit = evalAudit.result.value;
      console.log(`[QA] Desktop Audit: ${evalAudit.result.value.contrastViolations.length} contrast issues, ${evalAudit.result.value.focusMissing.length} focus issues.`);
    } catch (e) {
      console.error('[QA] Desktop eval error:', e.message);
    }

    // 2. Mobile 390x844
    console.log(`[QA] Switching to Mobile 390x844...`);
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      mobile: true
    });
    await sleep(1000);

    const mobileFile = path.join(OUT_DIR, `${screen.name}_390.png`);
    try {
      const mobileShot = await cdp.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(mobileFile, Buffer.from(mobileShot.data, 'base64'));
      console.log(`[QA] Saved mobile screenshot: ${mobileFile}`);
      screenData.mobile.screenshot = mobileFile;
    } catch (e) {
      console.error('[QA] Mobile screenshot error:', e.message);
    }

    try {
      const mobileEval = await cdp.send('Runtime.evaluate', {
        expression: `(() => {
          const scrollWidth = document.documentElement.scrollWidth;
          const innerWidth = window.innerWidth;
          const hasHorizontalOverflow = scrollWidth > innerWidth + 2;

          const smallTargets = Array.from(document.querySelectorAll('button, a, input'))
            .filter(el => {
              const rect = el.getBoundingClientRect();
              return rect.width > 0 && rect.height > 0 && (rect.width < 32 || rect.height < 32);
            })
            .map(el => ({
              tag: el.tagName.toLowerCase(),
              text: (el.innerText || el.getAttribute('aria-label') || '').slice(0, 25),
              width: Math.round(el.getBoundingClientRect().width),
              height: Math.round(el.getBoundingClientRect().height)
            }));

          return {
            scrollWidth,
            innerWidth,
            hasHorizontalOverflow,
            smallTargets: smallTargets.slice(0, 5)
          };
        })()`,
        returnByValue: true
      });
      screenData.mobile.audit = mobileEval.result.value;
      console.log(`[QA] Mobile Audit: overflow=${mobileEval.result.value.hasHorizontalOverflow}, small targets=${mobileEval.result.value.smallTargets.length}`);
    } catch (e) {
      console.error('[QA] Mobile eval error:', e.message);
    }

    report.screens[screen.name] = screenData;
  }

  // 3. Performance & 3D Scene FPS measurement
  console.log(`\n========================================`);
  console.log(`[QA] Measuring 3D Scene & Animation FPS on /room/CRITERION-70MM...`);
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false
  });
  await cdp.send('Page.navigate', { url: `${BASE_URL}/room/CRITERION-70MM` });
  await sleep(3000);

  try {
    const fpsMeasurement = await cdp.send('Runtime.evaluate', {
      expression: `new Promise((resolve) => {
        const frameTimes = [];
        let lastTime = performance.now();
        let frames = 0;
        const targetFrames = 120;

        function onFrame(now) {
          const delta = now - lastTime;
          lastTime = now;
          frameTimes.push(delta);
          frames++;
          if (frames < targetFrames) {
            requestAnimationFrame(onFrame);
          } else {
            const avgDelta = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length;
            const avgFps = Math.round(1000 / avgDelta);
            const maxDelta = Math.max(...frameTimes);
            const minFps = Math.round(1000 / maxDelta);
            resolve({ avgFps, minFps, frameCount: frames, avgDelta: Math.round(avgDelta * 10) / 10 });
          }
        }
        requestAnimationFrame(onFrame);
      })`,
      awaitPromise: true,
      returnByValue: true
    });
    console.log(`[QA] Room 3D FPS on desktop:`, fpsMeasurement.result.value);
    report.performanceAudit.roomDesktopFps = fpsMeasurement.result.value;
  } catch (e) {
    console.error('[QA] FPS evaluation error:', e.message);
  }

  // Video Isolation Check
  try {
    const videoIsolationCheck = await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        const video = document.querySelector('video');
        if (!video) return { found: false };
        const style = window.getComputedStyle(video);
        return {
          found: true,
          animationName: style.animationName,
          transition: style.transition,
          isolated: style.animationName === 'none'
        };
      })()`,
      returnByValue: true
    });
    console.log(`[QA] Video Sync Isolation Check:`, videoIsolationCheck.result.value);
    report.syncDriftCheck = videoIsolationCheck.result.value;
  } catch (e) {
    console.error('[QA] Video check error:', e.message);
  }

  // 4. Reduced Motion Test
  console.log(`\n========================================`);
  console.log(`[QA] Testing Reduced-Motion Emulation...`);
  try {
    await cdp.send('Emulation.setEmulatedMedia', {
      media: 'screen',
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }]
    });
    await cdp.send('Page.navigate', { url: `${BASE_URL}/motion-demo` });
    await sleep(1500);

    const reducedMotionEval = await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        const isReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        return {
          mediaQueryMatched: isReduced
        };
      })()`,
      returnByValue: true
    });
    console.log(`[QA] Reduced Motion Evaluation:`, reducedMotionEval.result.value);
    report.reducedMotionAudit = reducedMotionEval.result.value;
  } catch (e) {
    console.error('[QA] Reduced motion eval error:', e.message);
  }

  // Write full audit report
  fs.writeFileSync(path.resolve('qa_report.json'), JSON.stringify(report, null, 2));
  console.log(`\n[QA] Full audit report saved to qa_report.json!`);

  cdp.close();
  try { chromeProcess.kill(); } catch (e) {}
}

runAudit().catch(err => {
  console.error('[QA] Fatal audit error:', err);
  try { chromeProcess.kill(); } catch (e) {}
  process.exit(1);
});
