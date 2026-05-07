import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const WORKDIR = 'C:\\Users\\pinto\\Documents\\Cenas\\auto';
const APP_PATH = path.join(WORKDIR, 'app.js');
const APP_URL = 'http://localhost:3000';
const LOG_DIR = path.join(WORKDIR, 'logs');
const SCRIPT_NAME = 'playwright-deploy-test.mjs';
const CHROME_EXE = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const EDGE_EXE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

const TASK_PROMPT = `You are running in headless non-interactive mode. Complete ALL steps below without stopping.
Do NOT ask questions. Make decisions and document them.

STEP 1 — ANALYSE
Read the project structure (top-level files, package.json / pyproject.toml / Cargo.toml).
Identify: language, framework, test command, build command.
Choose ONE concrete task: failing tests, urgent TODOs, or "clean up dead code in most recently modified file".
Write findings to .automation/ANALYSIS.md.

STEP 2 — PLAN
Write a numbered implementation plan to .automation/PLAN.md:
- Chosen task (one sentence)
- Files to modify (list)
- Steps to execute (numbered)
- Validation command

STEP 3 — EXECUTE WITH CODEX
Read .automation/PLAN.md.
Use the Agent tool with subagent_type="codex:codex-rescue" and pass this prompt:
"Execute the plan in .automation/PLAN.md exactly. Use Edit/Write/Bash tools.
Do not stop until all steps are complete. Run the validation command at the end."

STEP 4 — VALIDATE
Run the validation command identified in STEP 1.
If it fails: make ONE targeted fix, re-run. If still failing: document why.

STEP 5 — REPORT
Write .automation/LAST_RUN.md with:
- Timestamp
- Task chosen
- Files changed
- Validation result (PASS/FAIL)
- Exit reason if stopped early
Print a 5-line summary to stdout.

RULES:
- Never run: git push, git reset --hard, rm -rf outside project dir
- All work stays inside PROJECT_DIR
- If unsure after reading 10 files: document and stop cleanly`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let failures = 0;
let serverProc = null;
let browserProc = null;

function log(message) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

function recordFailure(message, error) {
  failures += 1;
  console.error(`FAIL: ${message}`);
  if (error) console.error(error.stack || error.message || String(error));
}

async function retryStep(name, fn) {
  log(`STEP: ${name}`);
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const result = await fn();
      log(`OK: ${name}`);
      return result;
    } catch (error) {
      console.error(`Attempt ${attempt} failed for ${name}: ${error.message}`);
      if (attempt === 2) {
        recordFailure(name, error);
        return null;
      }
      await sleep(1000);
    }
  }
  return null;
}

async function waitForReachable(url, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return true;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(500);
  }
  throw lastError || new Error(`${url} was not reachable within ${timeoutMs}ms`);
}

async function startServer() {
  try {
    serverProc = spawn(process.execPath, [APP_PATH], {
      cwd: WORKDIR,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });
    serverProc.stdout.on('data', (data) => process.stdout.write(`[server] ${data}`));
    serverProc.stderr.on('data', (data) => process.stderr.write(`[server] ${data}`));
    serverProc.on('exit', (code) => log(`Server process exited with code ${code}`));
  } catch (error) {
    log(`Node spawn denied while starting server (${error.code}); checking for an already-running server.`);
  }
  await waitForReachable(APP_URL, 15000);
}

async function tryPlaywright() {
  try {
    return await import('playwright');
  } catch {
    return null;
  }
}

async function withPlaywright(playwright) {
  const browser = await playwright.chromium.launch({
    headless: true,
    executablePath: fs.existsSync(CHROME_EXE) ? CHROME_EXE : undefined
  });
  const page = await browser.newPage();
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  return {
    mode: 'playwright',
    page,
    close: () => browser.close(),
    fillPrompt: async () => {
      await page.locator('#prompt').fill(TASK_PROMPT);
    },
    clickDeploy: async () => {
      await page.locator('#deployBtn').click();
      await page.waitForFunction(() => document.body.innerText.includes('DONE.'), null, { timeout: 30000 });
      return await page.locator('body').innerText();
    },
    clickTestRun: async () => {
      await page.locator('#testRunBtn').click();
      await page.waitForFunction(() => document.body.innerText.includes('Terminal opened.') || document.body.innerText.includes('Failed to start test run'), null, { timeout: 10000 });
      return await page.locator('body').innerText();
    }
  };
}

class CdpClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.nextId = 1;
    this.pending = new Map();
    this.events = new Map();
  }

  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true });
      this.ws.addEventListener('error', reject, { once: true });
    });
    this.ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      } else if (msg.method && this.events.has(msg.method)) {
        for (const listener of this.events.get(msg.method)) listener(msg.params);
      }
    });
  }

  send(method, params = {}) {
    const id = this.nextId;
    this.nextId += 1;
    const promise = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
    this.ws.send(JSON.stringify({ id, method, params }));
    return promise;
  }

  once(method) {
    return new Promise((resolve) => {
      const listener = (params) => {
        const listeners = this.events.get(method) || [];
        this.events.set(method, listeners.filter((item) => item !== listener));
        resolve(params);
      };
      const listeners = this.events.get(method) || [];
      listeners.push(listener);
      this.events.set(method, listeners);
    });
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text || 'Runtime.evaluate failed');
    }
    return result.result?.value;
  }

  close() {
    if (this.ws) this.ws.close();
  }
}

async function withChromeCdp() {
  const exe = fs.existsSync(CHROME_EXE) ? CHROME_EXE : EDGE_EXE;
  if (!fs.existsSync(exe)) throw new Error('No Chrome or Edge executable found');
  if (typeof WebSocket === 'undefined') throw new Error('Node.js global WebSocket is unavailable');

  const profileDir = path.join(WORKDIR, '.playwright-cdp-profile');
  fs.mkdirSync(profileDir, { recursive: true });
  try {
    browserProc = spawn(exe, [
      '--remote-debugging-port=9222',
      `--user-data-dir=${profileDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--headless=new',
      'about:blank'
    ], {
      cwd: WORKDIR,
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true
    });
    browserProc.stderr.on('data', (data) => process.stderr.write(`[browser] ${data}`));
  } catch (error) {
    log(`Browser spawn denied (${error.code}); checking for an existing Chrome DevTools endpoint.`);
  }

  let version = null;
  for (let i = 0; i < 50; i += 1) {
    try {
      version = await fetch('http://127.0.0.1:9222/json/version').then((r) => r.json());
      break;
    } catch {
      await sleep(200);
    }
  }
  if (!version?.webSocketDebuggerUrl) throw new Error('Chrome DevTools endpoint did not start');

  const client = new CdpClient(version.webSocketDebuggerUrl);
  await client.connect();
  await client.send('Page.enable');
  await client.send('Runtime.enable');
  const loaded = client.once('Page.loadEventFired');
  await client.send('Page.navigate', { url: APP_URL });
  await loaded;

  const js = (source) => `(async () => { ${source} })()`;

  return {
    mode: 'chrome-cdp',
    page: client,
    close: async () => {
      client.close();
      if (browserProc) browserProc.kill();
    },
    fillPrompt: async () => client.evaluate(js(`
      const el = document.querySelector('#prompt');
      if (!el) throw new Error('Missing #prompt');
      el.value = ${JSON.stringify(TASK_PROMPT)};
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    `)),
    clickDeploy: async () => {
      await client.evaluate(js(`
        const btn = document.querySelector('#deployBtn');
        if (!btn) throw new Error('Missing #deployBtn');
        btn.click();
        return true;
      `));
      const deadline = Date.now() + 30000;
      while (Date.now() < deadline) {
        const text = await client.evaluate('document.body.innerText');
        if (text.includes('DONE.')) return text;
        await sleep(500);
      }
      throw new Error('Timed out waiting for DONE. in UI console');
    },
    clickTestRun: async () => {
      await client.evaluate(js(`
        const btn = document.querySelector('#testRunBtn');
        if (!btn) throw new Error('Missing #testRunBtn');
        btn.click();
        return true;
      `));
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        const text = await client.evaluate('document.body.innerText');
        if (text.includes('Terminal opened.') || text.includes('Failed to start test run')) return text;
        await sleep(500);
      }
      throw new Error('Timed out waiting for Test Run confirmation');
    }
  };
}

function withHttpFallback() {
  let prompt = TASK_PROMPT;
  return {
    mode: 'http-fallback',
    close: async () => {},
    fillPrompt: async () => {
      prompt = TASK_PROMPT;
    },
    clickDeploy: async () => {
      const cfg = await fetch(`${APP_URL}/api/config`).then((r) => r.json());
      if (!cfg?.projectDir) throw new Error('Cannot preserve Project Path because /api/config has no projectDir');
      const body = JSON.stringify({
        projectDir: cfg.projectDir,
        triggerTime: cfg.triggerTime || '05:00',
        prompt
      });
      const response = await fetch(`${APP_URL}/api/deploy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body
      });
      const text = await response.text();
      const messages = [];
      for (const line of text.split(/\r?\n/)) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6);
        if (payload === '[DONE]') continue;
        try {
          messages.push(JSON.parse(payload).msg);
        } catch {}
      }
      return messages.join('\n');
    },
    clickTestRun: async () => {
      const result = await fetch(`${APP_URL}/api/test-run`, { method: 'POST' }).then((r) => r.json());
      return result.ok ? 'Terminal opened.' : `Failed to start test run: ${result.error || 'unknown error'}`;
    }
  };
}

async function openUi() {
  const playwright = await tryPlaywright();
  if (playwright) {
    log('Using Playwright Chromium.');
    return await withPlaywright(playwright);
  }
  log('Playwright package unavailable; using Chrome DevTools fallback automation.');
  try {
    return await withChromeCdp();
  } catch (error) {
    log(`Chrome DevTools fallback unavailable (${error.message}); using HTTP route fallback.`);
    return withHttpFallback();
  }
}

function assertConsoleContains(consoleText) {
  const required = [
    'Writing config.json...',
    'Writing prompt.txt...',
    'Writing run-claude.bat...',
    'Task "Claude Auto Plan Execute" created successfully.'
  ];
  const missing = required.filter((item) => !consoleText.includes(item));
  if (missing.length) throw new Error(`Deploy console missing: ${missing.join(', ')}`);
}

function latestLogFile() {
  if (!fs.existsSync(LOG_DIR)) throw new Error(`Logs dir not found: ${LOG_DIR}`);
  const files = fs.readdirSync(LOG_DIR)
    .filter((name) => name.toLowerCase().endsWith('.log'))
    .map((name) => {
      const fullPath = path.join(LOG_DIR, name);
      return { fullPath, mtimeMs: fs.statSync(fullPath).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  if (!files.length) throw new Error('No log files found');
  return files[0].fullPath;
}

function parseLogDurationSeconds(contents) {
  const started = contents.match(/Run started:\s+(\d{2})\/(\d{2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})/i);
  const finished = contents.match(/Run finished:\s+(\d{2})\/(\d{2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})/i);
  if (!started || !finished) return null;
  const toDate = (m) => new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), Number(m[4]), Number(m[5]), Number(m[6]));
  return (toDate(finished).getTime() - toDate(started).getTime()) / 1000;
}

async function verifyLatestLog() {
  await sleep(5000);
  const file = latestLogFile();
  const contents = fs.readFileSync(file, 'utf8');
  console.log(`\n===== MOST RECENT LOG: ${file} =====`);
  console.log(contents);
  console.log('===== END LOG =====\n');

  const duration = parseLogDurationSeconds(contents);
  const hasAutomationRefs = contents.includes('.automation/PLAN.md') || contents.includes('.automation/LAST_RUN.md');
  if (!(duration > 30 || hasAutomationRefs)) {
    throw new Error(`Log assertion failed: duration=${duration ?? 'unavailable'}s, automation refs=${hasAutomationRefs}`);
  }
}

async function main() {
  process.chdir(WORKDIR);
  log(`Running ${SCRIPT_NAME} in ${WORKDIR}`);
  log('Dependency check: attempted npm install externally; script will use Playwright if present.');

  await retryStep('Start server and wait for http://localhost:3000', startServer);

  let ui = null;
  ui = await retryStep('Open UI via browser automation', openUi);
  if (!ui) throw new Error('Cannot continue without browser automation');
  log(`Browser automation mode: ${ui.mode}`);

  await retryStep('Fill Task Prompt field', async () => {
    await ui.fillPrompt();
  });

  const deployText = await retryStep('Click Deploy and wait for DONE.', async () => {
    const text = await ui.clickDeploy();
    assertConsoleContains(text);
    return text;
  });
  if (deployText) log('Deploy console contained all required messages.');

  await retryStep('Click Test Run and wait for terminal confirmation', async () => {
    const text = await ui.clickTestRun();
    if (!text.includes('Terminal opened.')) throw new Error('UI did not confirm terminal opened');
  });

  await retryStep('Read and assert most recent log', verifyLatestLog);

  if (ui) await ui.close();
  if (serverProc) serverProc.kill();

  console.log(`FINAL SUMMARY: ${failures === 0 ? 'PASS' : 'FAIL'} (${failures} failed step${failures === 1 ? '' : 's'})`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (error) => {
  recordFailure('Unhandled fatal error', error);
  if (browserProc) browserProc.kill();
  if (serverProc) serverProc.kill();
  console.log(`FINAL SUMMARY: FAIL (${failures} failed step${failures === 1 ? '' : 's'})`);
  process.exit(1);
});
