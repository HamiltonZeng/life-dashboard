#!/usr/bin/env node
/**
 * Host-side REAL-BROWSER smoke test for the unified entry http://localhost:18080.
 *
 * This script is intentionally NOT part of the Docker image / `pnpm verify`:
 * the `tools` container has no browser. Run it on the developer host instead:
 *
 *   node apps/web/scripts/verify-browser.mjs
 *
 * It has zero npm dependencies: it uses Node >= 22 built-ins only
 * (`fetch` + the global `WebSocket` as a minimal Chrome DevTools Protocol client)
 * and drives a locally installed headless Edge/Chrome.
 *
 * Honest scope:
 *   - It does NOT run inside Docker and is not the same thing as the DOM-less
 *     `verify-web.ts` suite; it is the real-browser companion check.
 *   - It never prints, logs or persists LOCAL_LOGIN_SECRET. The secret is read
 *     from the environment or `.secrets/development.env` and used only for the
 *     same-origin POST /api/v1/session call.
 *
 * Checks:
 *   1. unauthenticated login page renders
 *   2. login through POST /api/v1/session sets the session Cookie; `/` is blank
 *   3. /tasks renders
 *   4. settings AI section renders
 *   5. 360px viewport shows the mobile bottom dock (no occlusion)
 *   6. no uncaught page errors / console errors
 *   7. (bonus) the S1 "导出数据" action downloads life-dashboard-YYYY-MM-DD.json
 *
 * If no Chromium-family browser executable is found, prints SKIP and exits 0.
 * If the app server at BASE_URL is unreachable, exits 1 (that is not a SKIP:
 * the smoke cannot claim anything about a server that is down).
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..', '..', '..');
const BASE_URL = (process.env.LD_BASE_URL ?? 'http://localhost:18080').replace(/\/+$/, '');

const BROWSER_CANDIDATES = [
  process.env.LD_BROWSER_PATH,
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  '/usr/bin/microsoft-edge',
  '/usr/bin/microsoft-edge-stable',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser'
].filter(Boolean);

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function findBrowser() {
  for (const candidate of BROWSER_CANDIDATES) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function readLoginSecret() {
  if (process.env.LOCAL_LOGIN_SECRET && process.env.LOCAL_LOGIN_SECRET.trim()) {
    return process.env.LOCAL_LOGIN_SECRET.trim();
  }
  const envPath = path.join(repoRoot, '.secrets', 'development.env');
  if (!existsSync(envPath)) return null;
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = /^\s*LOCAL_LOGIN_SECRET\s*=\s*(.*?)\s*$/.exec(line);
    if (match) return match[1].replace(/^['"]|['"]$/g, '');
  }
  return null;
}

class CdpClient {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    ws.addEventListener('message', event => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      if (typeof message.id === 'number') {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(`CDP ${message.error.message}`));
        else pending.resolve(message.result);
        return;
      }
      for (const listener of this.listeners.get(message.method) ?? []) {
        try {
          listener(message.params ?? {});
        } catch {
          // Listener errors must never break the protocol loop.
        }
      }
    });
  }

  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', () => reject(new Error('CDP WebSocket connection failed')), { once: true });
    });
    return new CdpClient(ws);
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }
      }, 30000);
    });
  }

  on(method, listener) {
    const listeners = this.listeners.get(method) ?? [];
    listeners.push(listener);
    this.listeners.set(method, listeners);
    return () => {
      this.listeners.set(
        method,
        (this.listeners.get(method) ?? []).filter(entry => entry !== listener)
      );
    };
  }

  close() {
    try {
      this.ws.close();
    } catch {
      // already closed
    }
  }
}

class Page {
  constructor(cdp) {
    this.cdp = cdp;
  }

  async evaluate(expression, options = {}) {
    const result = await this.cdp.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: options.awaitPromise !== false,
      userGesture: true
    });
    if (result.exceptionDetails) {
      const description =
        result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? 'page evaluation failed';
      throw new Error(description);
    }
    return result.result?.value;
  }

  async waitUntil(expression, label, timeoutMs = 15000) {
    const startedAt = Date.now();
    let lastError = null;
    while (Date.now() - startedAt < timeoutMs) {
      try {
        const value = await this.evaluate(expression);
        if (value) return value;
      } catch (error) {
        lastError = error;
      }
      await delay(120);
    }
    throw new Error(`timed out waiting for ${label}${lastError ? ` (${lastError.message})` : ''}`);
  }

  async navigate(url) {
    await this.cdp.send('Page.navigate', { url });
    await this.waitUntil(`document.readyState === 'complete'`, `load ${url}`, 20000);
    // The SPA mounts asynchronously after DOMContentLoaded.
    await this.waitUntil(`document.getElementById('app') && document.getElementById('app').childElementCount > 0`, `app mount on ${url}`, 20000);
  }
}

function resultsCollector() {
  const results = [];
  return {
    results,
    check(name, ok, detail) {
      results.push({ name, ok: Boolean(ok), detail });
      console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
    },
    skip(name, detail) {
      results.push({ name, ok: true, skipped: true, detail });
      console.log(`[SKIP] ${name}${detail ? ` — ${detail}` : ''}`);
    },
    fail(name, detail) {
      results.push({ name, ok: false, detail });
      console.log(`[FAIL] ${name}${detail ? ` — ${detail}` : ''}`);
    }
  };
}

async function waitForDebugPort(port, timeoutMs = 20000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return await response.json();
    } catch {
      // browser not listening yet
    }
    await delay(150);
  }
  throw new Error(`headless browser did not expose a DevTools endpoint on port ${port}`);
}

async function findPageTarget(port) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`);
    const targets = await response.json();
    const page = targets.find(target => target.type === 'page' && target.webSocketDebuggerUrl);
    if (page) return page;
    await delay(100);
  }
  throw new Error('no page target was exposed by the headless browser');
}

async function waitForDownloadedJson(downloadDir, timeoutMs = 15000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (existsSync(downloadDir)) {
      const files = readdirSync(downloadDir).filter(name => name.endsWith('.json'));
      if (files.length > 0) {
        const file = path.join(downloadDir, files[0]);
        return { file, fileName: files[0], text: readFileSync(file, 'utf8') };
      }
    }
    await delay(150);
  }
  return null;
}

async function main() {
  const collector = resultsCollector();

  if (typeof WebSocket === 'undefined') {
    console.log('SKIP: Node.js built-in WebSocket (Node >= 22) is not available; real-browser CDP smoke skipped.');
    return 0;
  }

  const browserPath = findBrowser();
  if (!browserPath) {
    console.log('SKIP: no headless Edge/Chrome executable was found on this host; real-browser smoke skipped.');
    console.log('      Set LD_BROWSER_PATH to a Chromium-family executable to enable it.');
    return 0;
  }

  try {
    const ready = await fetch(`${BASE_URL}/health/ready`).catch(() => null);
    if (!ready || !ready.ok) {
      console.error(`FAIL: app server is not ready at ${BASE_URL}/health/ready (start docker compose first).`);
      return 1;
    }
  } catch {
    console.error(`FAIL: app server is not reachable at ${BASE_URL}.`);
    return 1;
  }

  const secret = readLoginSecret();
  if (!secret) {
    console.error('FAIL: LOCAL_LOGIN_SECRET is not available in the environment or .secrets/development.env; cannot verify authenticated flows.');
    return 1;
  }

  const userDataDir = mkdtempSync(path.join(tmpdir(), 'ld-browser-smoke-'));
  const downloadDir = path.join(userDataDir, 'downloads');
  const port = 9300 + Math.floor(Math.random() * 500);
  const browser = spawn(
    browserPath,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-sync',
      '--disable-background-networking',
      '--metrics-recording-only',
      '--mute-audio',
      '--hide-scrollbars',
      '--window-size=1280,900',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userDataDir}`,
      'about:blank'
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] }
  );

  let cdp = null;
  try {
    await waitForDebugPort(port);
    const target = await findPageTarget(port);
    cdp = await CdpClient.connect(target.webSocketDebuggerUrl);
    const page = new Page(cdp);

    const pageErrors = [];
    cdp.on('Runtime.exceptionThrown', params => {
      pageErrors.push(params.exceptionDetails?.exception?.description ?? params.exceptionDetails?.text ?? 'uncaught exception');
    });
    cdp.on('Runtime.consoleAPICalled', params => {
      if (params.type === 'error') {
        pageErrors.push(
          `console.error: ${(params.args ?? []).map(arg => arg.value ?? arg.description ?? '').join(' ')}`
        );
      }
    });

    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Network.enable').catch(() => {});

    // 1. Unauthenticated login page renders (fresh browser profile => no Cookie).
    await page.navigate(`${BASE_URL}/`);
    await page.waitUntil(`document.getElementById('ld-login-secret-input') !== null`, 'login form', 20000);
    const loginPage = await page.evaluate(`({
      hasForm: !!document.getElementById('ld-login-form'),
      text: document.querySelector('.ld-login-card')?.innerText ?? ''
    })`);
    collector.check(
      '登录页渲染',
      loginPage.hasForm && loginPage.text.includes('本地登录口令'),
      '本机口令登录表单可见'
    );

    // 2. Authenticate exactly like the app does: same-origin POST /api/v1/session.
    const loginResult = await page.evaluate(`fetch('/api/v1/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ login_secret: ${JSON.stringify(secret)} })
    }).then(async response => ({ status: response.status, body: await response.text() }))`);
    const meResult = await page.evaluate(`fetch('/api/v1/me', { credentials: 'same-origin' }).then(async response => ({ status: response.status, body: await response.text() }))`);
    collector.check(
      'API 会话 Cookie 登录',
      loginResult.status === 200 && meResult.status === 200,
      loginResult.status === 200 && meResult.status === 200
        ? 'POST /api/v1/session -> 200，随后 GET /api/v1/me -> 200'
        : `unexpected statuses: session=${loginResult.status}, me=${meResult.status}`
    );

    await page.navigate(`${BASE_URL}/`);
    await page.waitUntil(`document.getElementById('ld-home-blank') !== null`, 'blank home', 20000);
    const home = await page.evaluate(`({
      hasShell: !!document.querySelector('.ld-app-shell'),
      blank: (document.getElementById('ld-home-blank')?.textContent ?? '').trim() === '',
      hasLoginForm: !!document.getElementById('ld-login-form')
    })`);
    collector.check(
      '登录后首页保持空白',
      home.hasShell && home.blank && !home.hasLoginForm,
      home.hasShell && home.blank && !home.hasLoginForm
        ? 'shell 已挂载，#ld-home-blank 主内容区为空且未回退到登录页'
        : `shell=${home.hasShell}, blank=${home.blank}, loginForm=${home.hasLoginForm}`
    );

    // 3. /tasks renders.
    await page.navigate(`${BASE_URL}/tasks`);
    await page.waitUntil(
      `document.querySelector('.ld-panel-title')?.textContent?.includes('任务面板')`,
      'tasks panel title',
      20000
    );
    const tasks = await page.evaluate(`({
      title: document.querySelector('.ld-panel-title')?.textContent ?? '',
      cards: document.querySelectorAll('.ld-card').length,
      dockButtons: document.querySelectorAll('.ld-mobile-dock [data-action="nav-route"]').length
    })`);
    collector.check(
      '任务面板渲染',
      tasks.title.includes('任务面板') && tasks.dockButtons === 5,
      `${tasks.title.trim()}，${tasks.cards} 个卡片区域，底部导航 ${tasks.dockButtons} 项`
    );

    // 4. Settings AI section renders (click the "AI 设置与自动填充" sub-tab).
    await page.navigate(`${BASE_URL}/settings`);
    await page.waitUntil(
      `document.querySelector('.ld-panel-title')?.textContent?.includes('设置面板')`,
      'settings panel title',
      20000
    );
    await page.evaluate(`[...document.querySelectorAll('[data-action="panel-subtab"]')].find(button => button.dataset.subtab === 'ai')?.click()`);
    await page.waitUntil(`document.body.innerText.includes('AI 生成与自动填充')`, 'settings AI section', 20000);
    const aiSection = await page.evaluate(`({
      configCard: document.body.innerText.includes('AI 配置'),
      matrix: !!document.querySelector('[data-support-matrix="blueprint-1.0"]'),
      generateButton: !!document.querySelector('[data-action="open-ai-modal"]')
    })`);
    collector.check(
      '设置面板 AI 区',
      aiSection.configCard && aiSection.matrix && aiSection.generateButton,
      aiSection.configCard && aiSection.matrix && aiSection.generateButton
        ? 'AI 配置卡、蓝图 1.0 支持矩阵与「发起 AI 生成」按钮均渲染'
        : `configCard=${aiSection.configCard}, matrix=${aiSection.matrix}, generateButton=${aiSection.generateButton}`
    );

    // 5. Bonus: S1 export button downloads the real JSON export through the gateway.
    await page.evaluate(`[...document.querySelectorAll('[data-action="panel-subtab"]')].find(button => button.dataset.subtab === 'account')?.click()`);
    await page.waitUntil(`document.querySelector('[data-action="export-data"]') !== null`, 'export action', 20000);
    let downloadBehaviorReady = false;
    try {
      await cdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDir });
      downloadBehaviorReady = true;
    } catch {
      try {
        await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDir });
        downloadBehaviorReady = true;
      } catch {
        downloadBehaviorReady = false;
      }
    }
    await page.evaluate(`document.querySelector('[data-action="export-data"]').click()`);
    await page.waitUntil(`document.querySelector('[data-export-status="success"]') !== null`, 'export success feedback', 30000);
    const exportUi = await page.evaluate(`({
      message: document.querySelector('[data-export-status="success"]')?.innerText ?? '',
      fileName: document.querySelector('[data-export-file]')?.getAttribute('data-export-file') ?? ''
    })`);
    collector.check(
      '导出数据按钮（真实下载）',
      /^life-dashboard-\d{4}-\d{2}-\d{2}\.json$/.test(exportUi.fileName) && exportUi.message.includes('导出成功'),
      /^life-dashboard-\d{4}-\d{2}-\d{2}\.json$/.test(exportUi.fileName)
        ? `页面反馈成功，文件名 ${exportUi.fileName}`
        : `unexpected filename: ${exportUi.fileName}`
    );
    if (downloadBehaviorReady) {
      const downloaded = await waitForDownloadedJson(downloadDir);
      if (!downloaded) {
        collector.fail('导出文件写入磁盘', '等待 headless 浏览器下载 JSON 文件超时');
      } else {
        const payload = JSON.parse(downloaded.text);
        const downloadOk =
          payload.format === 'life-dashboard-user-export' &&
          payload.schema_version === 1 &&
          typeof payload.checksum === 'string' &&
          payload.checksum.length === 64 &&
          typeof payload.data === 'object' &&
          downloaded.fileName === exportUi.fileName;
        collector.check(
          '导出文件写入磁盘',
          downloadOk,
          downloadOk
            ? `已下载 ${downloaded.fileName}（format/schema_version/checksum/data 齐全，${downloaded.text.length} 字节）`
            : `下载文件的格式/校验和不符: ${downloaded.fileName}`
        );
      }
    } else {
      collector.skip('导出文件写入磁盘', '当前 Chromium 不支持 CDP 下载目录设置；仅验证了页面成功反馈');
    }

    // 6. 360px viewport: mobile bottom dock must be visible and fixed to the bottom.
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 360,
      height: 800,
      deviceScaleFactor: 2,
      mobile: true
    });
    await page.navigate(`${BASE_URL}/tasks`);
    await page.waitUntil(`document.querySelector('.ld-mobile-dock') !== null`, 'mobile dock', 20000);
    const mobile = await page.evaluate(`(() => {
      const dock = document.querySelector('.ld-mobile-dock');
      const style = getComputedStyle(dock);
      const rect = dock.getBoundingClientRect();
      const sidebar = document.querySelector('.ld-sidebar');
      const sidebarDisplay = sidebar ? getComputedStyle(sidebar).display : 'missing';
      return {
        width: window.innerWidth,
        display: style.display,
        dockWidth: rect.width,
        dockBottom: rect.bottom,
        innerHeight: window.innerHeight,
        buttons: dock.querySelectorAll('[data-action="nav-route"]').length,
        sidebarDisplay
      };
    })()`);
    const mobileOk =
      mobile.width === 360 &&
      mobile.display !== 'none' &&
      mobile.buttons === 5 &&
      Math.abs(mobile.dockBottom - mobile.innerHeight) <= 1 &&
      mobile.sidebarDisplay === 'none';
    collector.check(
      '360px 视口底部导航',
      mobileOk,
      mobileOk
        ? `5 个底部导航按钮可见并固定在视口底部（dockWidth=${mobile.dockWidth}px, sidebar=${mobile.sidebarDisplay}）`
        : `viewport=${mobile.width}, display=${mobile.display}, buttons=${mobile.buttons}, bottom=${mobile.dockBottom}/${mobile.innerHeight}, sidebar=${mobile.sidebarDisplay}`
    );
    await cdp.send('Emulation.clearDeviceMetricsOverride').catch(() => {});

    // 7. No uncaught page errors / console errors during the whole flow.
    collector.check(
      '无未捕获页面错误',
      pageErrors.length === 0,
      pageErrors.length === 0 ? '整个流程未出现 uncaught exception 或 console.error' : pageErrors.join(' | ')
    );

    if (pageErrors.length > 0) {
      // Already surfaced as a failing check; keep totals honest.
    }

    const failed = collector.results.filter(result => !result.ok);
    for (const result of failed) console.error(`[FAIL] ${result.name} — ${result.detail}`);
    const skipped = collector.results.filter(result => result.skipped);
    for (const result of skipped) console.log(`[SKIP] ${result.name} — ${result.detail}`);
    const executed = collector.results.length - skipped.length;
    const passed = collector.results.filter(result => result.ok && !result.skipped).length;
    console.log(`\nTotal: ${passed}/${executed} browser checks passed${skipped.length ? ` (${skipped.length} skipped)` : ''}.`);
    return failed.length === 0 ? 0 : 1;
  } finally {
    if (cdp) cdp.close();
    try {
      browser.kill('SIGKILL');
    } catch {
      // already exited
    }
    await delay(300);
    try {
      rmSync(userDataDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup of a temp profile (never contains secrets)
    }
  }
}

main().then(
  exitCode => process.exit(exitCode),
  error => {
    console.error('FAIL: real-browser smoke crashed.');
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
);
