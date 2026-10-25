#!/usr/bin/env node
/**
 * screenshots.mjs — 重新生成 README 截图（使用虚构演示数据，绝不含真实数据）。
 *
 *   npm run screenshots
 *
 * 流程：用 assets/demo/timetable.json 构建到临时目录，再用无头 Edge 截 4 张图：
 *   1. 默认（浅色，周视图）      2. 学期总览（甘特）
 *   3. 暗色模式                  4. 移动端（选择器展开）
 *
 * 依赖：本机安装 Edge / Chrome；无需 npm 依赖。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT_DIR = path.join(ROOT, 'assets', 'screenshots');
const TMP_DIR = path.join(ROOT, '.screenshots-tmp');
const PORT = 9369;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fileUrl = (p) => new URL('file:///' + p.replace(/\\/g, '/')).href;

function findBrowser() {
  const candidates = [
    process.env.EDGE_PATH,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);
  return candidates.find((p) => fs.existsSync(p));
}

class CDP {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.nextId = 1;
    this.pending = new Map();
    this.ready = new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve);
      this.ws.addEventListener('error', () => reject(new Error('CDP websocket error')));
    });
    this.ws.addEventListener('message', (e) => {
      const msg = JSON.parse(e.data);
      const p = msg.id && this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
    });
  }
  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(payload));
    });
  }
}

async function waitForDevtools(url, timeout = 20000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try {
      const res = await fetch(url);
      if (res.ok) return res.json();
    } catch { /* retry */ }
    await sleep(200);
  }
  throw new Error('浏览器调试端口未就绪');
}

async function evaluate(cdp, sessionId, expression) {
  const res = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, userGesture: true }, sessionId);
  if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description || res.exceptionDetails.text);
  return res.result?.value;
}

async function open(cdp, htmlPath, { width, height, dark = false }) {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  await cdp.send('Page.enable', {}, sessionId);
  await cdp.send('Runtime.enable', {}, sessionId);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width <= 733 }, sessionId);
  await cdp.send('Emulation.setEmulatedMedia', {
    media: '',
    features: [
      { name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' },
      { name: 'prefers-reduced-motion', value: 'no-preference' },
    ],
  }, sessionId);
  await cdp.send('Page.navigate', { url: fileUrl(htmlPath) }, sessionId);
  const end = Date.now() + 15000;
  while (Date.now() < end) {
    if (await evaluate(cdp, sessionId, "!!document.querySelector('#ttTable')")) break;
    await sleep(80);
  }
  await sleep(400);
  return { targetId, sessionId };
}

async function shot(cdp, sessionId, name) {
  const res = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true }, sessionId);
  const file = path.join(OUT_DIR, name);
  fs.writeFileSync(file, Buffer.from(res.data, 'base64'));
  console.log(`  ✓ ${path.relative(ROOT, file)}  ${(fs.statSync(file).size / 1024).toFixed(0)} KB`);
}

async function main() {
  const browser = findBrowser();
  if (!browser) {
    console.error('错误：未找到 Edge/Chrome。可设置环境变量 EDGE_PATH 指向浏览器可执行文件。');
    process.exit(2);
  }

  // 1) 用演示数据构建（不污染 dist/）
  const { execFileSync } = await import('node:child_process');
  execFileSync(process.execPath, [
    path.join(ROOT, 'scripts', 'build.mjs'),
    '--data', path.join(ROOT, 'assets', 'demo', 'timetable.json'),
    '--out', TMP_DIR,
  ], { stdio: 'inherit' });

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const htmlPath = path.join(TMP_DIR, 'index.html');
  const profile = path.join(os.tmpdir(), 'tt-shots-' + Date.now());
  const proc = spawn(browser, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio: 'ignore' });

  let cdp = null;
  try {
    const version = await waitForDevtools(`http://127.0.0.1:${PORT}/json/version`);
    cdp = new CDP(version.webSocketDebuggerUrl);
    await cdp.ready;

    // 2) 默认视图（浅色）
    {
      const { targetId, sessionId } = await open(cdp, htmlPath, { width: 1440, height: 900 });
      await shot(cdp, sessionId, 'screenshot-default-light.png');
      await evaluate(cdp, sessionId, "document.getElementById('btnGantt').click()");
      await sleep(450);
      await shot(cdp, sessionId, 'screenshot-gantt.png');
      await cdp.send('Target.closeTarget', { targetId }).catch(() => {});
    }
    // 3) 暗色
    {
      const { targetId, sessionId } = await open(cdp, htmlPath, { width: 1440, height: 900, dark: true });
      await shot(cdp, sessionId, 'screenshot-dark.png');
      await cdp.send('Target.closeTarget', { targetId }).catch(() => {});
    }
    // 4) 移动端（选择器展开）
    {
      const { targetId, sessionId } = await open(cdp, htmlPath, { width: 390, height: 844 });
      await evaluate(cdp, sessionId, "document.getElementById('pickBtn').click()");
      await sleep(450);
      await shot(cdp, sessionId, 'screenshot-mobile.png');
      await cdp.send('Target.closeTarget', { targetId }).catch(() => {});
    }
  } finally {
    try { cdp?.ws.close(); } catch { /* ignore */ }
    try { proc.kill(); } catch { /* ignore */ }
    await sleep(300);
    fs.rmSync(profile, { recursive: true, force: true });
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
  }
  console.log('\n截图完成（数据来源：assets/demo/timetable.json，纯虚构）');
}

main().catch((err) => {
  console.error(err?.stack || err);
  process.exitCode = 1;
});
