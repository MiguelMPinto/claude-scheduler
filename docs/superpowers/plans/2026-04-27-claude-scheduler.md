# Claude Scheduler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Node.js+Express local web app that lets users configure and deploy a Claude Code automation pipeline via a dark terminal-inspired UI, creating files and a Windows Task Scheduler entry on demand.

**Architecture:** Express server at localhost:3000 serves a single-page HTML UI; all Windows operations (file writes, PowerShell Task Scheduler registration, folder picker) are handled via server-side API routes. Pure functions for validation and template generation are extracted to `lib.js` for testability.

**Tech Stack:** Node.js v24, Express 4, vanilla HTML/CSS/JS, node:test (built-in), PowerShell (system), Windows Task Scheduler

---

## File Map

| File | Responsibility |
|------|----------------|
| `C:\dev\automation\package.json` | npm manifest + express dependency |
| `C:\dev\automation\lib.js` | Pure functions: validateInput, renderRunClaudeBat, renderPowerShellTaskScript, DEFAULT_PROMPT |
| `C:\dev\automation\app.js` | Express server, all API routes |
| `C:\dev\automation\index.html` | Single-page UI (dark terminal aesthetic) |
| `C:\dev\automation\launcher.bat` | Start server + open browser |
| `C:\dev\automation\setup.ps1` | Create desktop shortcut |
| `C:\dev\automation\test\lib.test.js` | Unit tests for lib.js functions |

---

### Task 1: Scaffold

**Files:**
- Create: `C:\dev\automation\` (directory)
- Create: `C:\dev\automation\package.json`
- Create: `C:\dev\automation\test\` (directory)

- [ ] **Step 1: Create the automation directory**

```powershell
New-Item -ItemType Directory -Force -Path "C:\dev\automation"
New-Item -ItemType Directory -Force -Path "C:\dev\automation\test"
```

- [ ] **Step 2: Write package.json**

Write `C:\dev\automation\package.json`:
```json
{
  "name": "claude-scheduler",
  "version": "1.0.0",
  "description": "Visual configurator for Claude Code + Task Scheduler automation",
  "main": "app.js",
  "scripts": {
    "start": "node app.js",
    "test": "node --test test/lib.test.js"
  },
  "dependencies": {
    "express": "^4.21.2"
  }
}
```

- [ ] **Step 3: Install express**

```bash
cd "C:\dev\automation" && npm install
```

Expected: `added N packages` with no errors. `node_modules/express` exists.

- [ ] **Step 4: Verify express loads**

```bash
node -e "require('express'); console.log('ok')"
```

Expected: `ok`

- [ ] **Step 5: Commit**

```bash
cd "C:\dev\automation" && git init && git add package.json package-lock.json && git commit -m "chore: scaffold claude-scheduler"
```

---

### Task 2: Write failing tests for lib.js

**Files:**
- Create: `C:\dev\automation\test\lib.test.js`

- [ ] **Step 1: Write the test file**

Write `C:\dev\automation\test\lib.test.js`:
```javascript
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const { validateInput, renderRunClaudeBat, renderPowerShellTaskScript, DEFAULT_PROMPT } = require('../lib');

test('validateInput: rejects missing projectDir', () => {
  const err = validateInput({ projectDir: '', triggerTime: '05:00', prompt: 'hello' });
  assert.equal(err, 'PROJECT PATH is required');
});

test('validateInput: rejects non-existent dir', () => {
  const err = validateInput({ projectDir: 'C:\\nonexistent\\xyz\\abc', triggerTime: '05:00', prompt: 'hello' });
  assert.match(err, /not found/);
});

test('validateInput: rejects bad triggerTime (no leading zero)', () => {
  const err = validateInput({ projectDir: os.tmpdir(), triggerTime: '5:00', prompt: 'hello' });
  assert.equal(err, 'TRIGGER TIME must be HH:MM');
});

test('validateInput: rejects empty prompt', () => {
  const err = validateInput({ projectDir: os.tmpdir(), triggerTime: '05:00', prompt: '   ' });
  assert.equal(err, 'TASK PROMPT is required');
});

test('validateInput: returns null for valid input', () => {
  const err = validateInput({ projectDir: os.tmpdir(), triggerTime: '05:00', prompt: 'do something' });
  assert.equal(err, null);
});

test('renderRunClaudeBat: contains projectDir', () => {
  const bat = renderRunClaudeBat('C:\\test\\myproject');
  assert.ok(bat.includes('C:\\test\\myproject'), 'bat must contain projectDir');
});

test('renderRunClaudeBat: contains claude invocation flags', () => {
  const bat = renderRunClaudeBat('C:\\test\\myproject');
  assert.ok(bat.includes('claude -p'), 'bat must invoke claude -p');
  assert.ok(bat.includes('--max-turns 40'), 'bat must set --max-turns 40');
  assert.ok(bat.includes('--permission-mode acceptEdits'), 'bat must set permission mode');
});

test('renderPowerShellTaskScript: contains trigger time', () => {
  const ps = renderPowerShellTaskScript('05:30');
  assert.ok(ps.includes('05:30'), 'ps must include trigger time');
});

test('renderPowerShellTaskScript: contains task name', () => {
  const ps = renderPowerShellTaskScript('05:00');
  assert.ok(ps.includes('Claude Auto Plan Execute'), 'ps must include task name');
});

test('DEFAULT_PROMPT: contains all 5 steps and required paths', () => {
  assert.ok(DEFAULT_PROMPT.includes('STEP 1'), 'missing STEP 1');
  assert.ok(DEFAULT_PROMPT.includes('STEP 2'), 'missing STEP 2');
  assert.ok(DEFAULT_PROMPT.includes('STEP 3'), 'missing STEP 3');
  assert.ok(DEFAULT_PROMPT.includes('STEP 4'), 'missing STEP 4');
  assert.ok(DEFAULT_PROMPT.includes('STEP 5'), 'missing STEP 5');
  assert.ok(DEFAULT_PROMPT.includes('PLAN.md'), 'missing PLAN.md reference');
  assert.ok(DEFAULT_PROMPT.includes('LAST_RUN.md'), 'missing LAST_RUN.md reference');
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd "C:\dev\automation" && npm test
```

Expected: `Error: Cannot find module '../lib'` — confirms tests are wired and currently failing.

---

### Task 3: Implement lib.js

**Files:**
- Create: `C:\dev\automation\lib.js`

- [ ] **Step 1: Write lib.js**

Write `C:\dev\automation\lib.js`:
```javascript
'use strict';
const fs = require('fs');

const DEFAULT_PROMPT = `You are operating in headless, non-interactive mode. There is no human to ask
clarifying questions. You MUST complete the full pipeline below before stopping.
Do not ask questions. Do not stop after planning. If a step is ambiguous, make
a reasonable choice, document it, and continue.

STEP 1 — ANALYSE
Read the repository structure. Identify language, framework, build/test/lint
commands. Pick ONE concrete scoped task: failing tests, TODOs marked URGENT,
or if nothing obvious: "clean up dead code in the most recently modified file".

STEP 2 — PLAN
Write a numbered plan to .automation/PLAN.md with: chosen task, files to touch,
concrete steps, validation command. Then print the plan to stdout.

STEP 3 — EXECUTE
Implement the changes with Edit/Write tools. If \`codex --version\` succeeds,
delegate via: codex exec --skip-git-repo-check "<task from plan>"
Otherwise implement directly. Retry once on non-zero exit with clearer description.

STEP 4 — VALIDATE
Run the validation command from STEP 1 (npm test / pytest / cargo test / etc).
If it fails: make ONE targeted fix, re-run. If still failing: document and stop cleanly.

STEP 5 — REPORT
Write .automation/LAST_RUN.md with: timestamp, task chosen, files changed
(git diff --stat), validation result (PASS/FAIL). Print 5-line summary to stdout.

RULES:
- Never run git push, git reset --hard, or rm -rf outside the project directory.
- All work stays inside the current working directory.
- If project type unclear after reading 10 files, document and stop cleanly.`;

function validateInput({ projectDir, triggerTime, prompt }) {
  if (!projectDir) return 'PROJECT PATH is required';
  if (!fs.existsSync(projectDir)) return `Project dir not found: ${projectDir}`;
  if (!/^\d{2}:\d{2}$/.test(triggerTime)) return 'TRIGGER TIME must be HH:MM';
  if (!prompt || !prompt.trim()) return 'TASK PROMPT is required';
  return null;
}

function renderRunClaudeBat(projectDir) {
  return [
    '@echo off',
    `set "PROJECT_DIR=${projectDir}"`,
    'set "AUTO_DIR=C:\\dev\\automation"',
    'set "LOG_DIR=%AUTO_DIR%\\logs"',
    'set "PROMPT_FILE=%AUTO_DIR%\\prompt.txt"',
    'for /f "tokens=2 delims==" %%I in (\'wmic os get localdatetime /value\') do set DT=%%I',
    'set "STAMP=%DT:~0,4%-%DT:~4,2%-%DT:~6,2%_%DT:~8,2%-%DT:~10,2%"',
    'set "LOG_FILE=%LOG_DIR%\\run_%STAMP%.log"',
    'if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"',
    'cd /d "%PROJECT_DIR%" || (echo ERRO: project dir nao encontrado >> "%LOG_FILE%" & exit /b 1)',
    'echo ============================================== >> "%LOG_FILE%"',
    'echo Run started: %DATE% %TIME% >> "%LOG_FILE%"',
    'echo ============================================== >> "%LOG_FILE%"',
    'type "%PROMPT_FILE%" | claude -p --allowedTools "Read,Edit,Write,Bash" --permission-mode acceptEdits --output-format text --max-turns 40 >> "%LOG_FILE%" 2>&1',
    'set "RC=%ERRORLEVEL%"',
    'echo ============================================== >> "%LOG_FILE%"',
    'echo Run finished: %DATE% %TIME% (exit code %RC%) >> "%LOG_FILE%"',
    'echo ============================================== >> "%LOG_FILE%"',
    'exit /b %RC%'
  ].join('\r\n');
}

function renderPowerShellTaskScript(triggerTime) {
  return [
    '$action = New-ScheduledTaskAction -Execute "C:\\dev\\automation\\run-claude.bat" -WorkingDirectory "C:\\dev\\automation"',
    `$trigger = New-ScheduledTaskTrigger -Daily -At "${triggerTime}"`,
    '$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Hours 1) -MultipleInstances IgnoreNew',
    'Unregister-ScheduledTask -TaskName "Claude Auto Plan Execute" -Confirm:$false -ErrorAction SilentlyContinue',
    'Register-ScheduledTask -TaskName "Claude Auto Plan Execute" -Action $action -Trigger $trigger -Settings $settings -RunLevel Limited'
  ].join('\n');
}

module.exports = { validateInput, renderRunClaudeBat, renderPowerShellTaskScript, DEFAULT_PROMPT };
```

- [ ] **Step 2: Run tests to confirm they pass**

```bash
cd "C:\dev\automation" && npm test
```

Expected:
```
✔ validateInput: rejects missing projectDir
✔ validateInput: rejects non-existent dir
✔ validateInput: rejects bad triggerTime (no leading zero)
✔ validateInput: rejects empty prompt
✔ validateInput: returns null for valid input
✔ renderRunClaudeBat: contains projectDir
✔ renderRunClaudeBat: contains claude invocation flags
✔ renderPowerShellTaskScript: contains trigger time
✔ renderPowerShellTaskScript: contains task name
✔ DEFAULT_PROMPT: contains all 5 steps and required paths
pass 10
fail 0
```

- [ ] **Step 3: Commit**

```bash
cd "C:\dev\automation" && git add lib.js test/lib.test.js && git commit -m "feat: add lib.js with validation and template functions (TDD)"
```

---

### Task 4: app.js skeleton — GET / and GET /api/config

**Files:**
- Create: `C:\dev\automation\app.js`
- Create: `C:\dev\automation\index.html` (placeholder, replaced in Task 7)

- [ ] **Step 1: Write app.js**

Write `C:\dev\automation\app.js`:
```javascript
'use strict';
const express = require('express');
const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');
const { validateInput, renderRunClaudeBat, renderPowerShellTaskScript } = require('./lib');

const AUTO_DIR = 'C:\\dev\\automation';
const CONFIG_PATH = path.join(AUTO_DIR, 'config.json');
const PORT = 3000;

const app = express();
app.use(express.json());

app.get('/', (req, res) => {
  res.sendFile(path.join(AUTO_DIR, 'index.html'));
});

app.get('/api/config', (req, res) => {
  if (!fs.existsSync(CONFIG_PATH)) return res.json(null);
  try {
    res.json(JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')));
  } catch {
    res.json(null);
  }
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`Claude Scheduler → http://localhost:${PORT}`);
});
```

- [ ] **Step 2: Write a placeholder index.html**

Write `C:\dev\automation\index.html`:
```html
<!DOCTYPE html><html><body style="background:#0a0a0a;color:#00ff88;font-family:monospace;padding:20px"><h1>Claude Scheduler</h1><p>UI coming soon.</p></body></html>
```

- [ ] **Step 3: Start server and test GET /**

```bash
cd "C:\dev\automation" && node app.js
```

In a new terminal:
```bash
curl http://localhost:3000/
```

Expected: HTML response containing `Claude Scheduler`.

- [ ] **Step 4: Test GET /api/config with no config file**

```bash
curl http://localhost:3000/api/config
```

Expected: `null`

- [ ] **Step 5: Kill server and commit**

```bash
cd "C:\dev\automation" && git add app.js index.html && git commit -m "feat: Express skeleton — GET / and GET /api/config"
```

---

### Task 5: app.js — POST /api/deploy (SSE streaming)

**Files:**
- Modify: `C:\dev\automation\app.js` (add before `app.listen`)

- [ ] **Step 1: Add runPowerShell helper**

Add after the `app.get('/api/config', ...)` block:
```javascript
function runPowerShell(script) {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return execSync(
    `powershell -NoProfile -ExecutionPolicy Bypass -NonInteractive -EncodedCommand ${encoded}`,
    { encoding: 'utf8', windowsHide: true }
  );
}
```

- [ ] **Step 2: Add the deploy endpoint**

Add after `runPowerShell`:
```javascript
app.post('/api/deploy', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const send = (msg, type = 'info') => {
    const time = new Date().toTimeString().slice(0, 8);
    res.write(`data: ${JSON.stringify({ time, msg, type })}\n\n`);
  };

  const { projectDir, triggerTime, prompt } = req.body;

  const validationError = validateInput({ projectDir, triggerTime, prompt });
  if (validationError) {
    send(validationError, 'error');
    res.write('data: [DONE]\n\n');
    res.end();
    return;
  }

  try {
    send(`Creating ${AUTO_DIR}\\...`);
    fs.mkdirSync(AUTO_DIR, { recursive: true });

    send('Writing config.json...');
    const config = { projectDir, triggerTime, lastDeployed: new Date().toISOString().slice(0, 19) };
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');

    send('Writing prompt.txt...');
    fs.writeFileSync(path.join(AUTO_DIR, 'prompt.txt'), prompt, 'utf8');

    send('Writing run-claude.bat...');
    fs.writeFileSync(path.join(AUTO_DIR, 'run-claude.bat'), renderRunClaudeBat(projectDir), 'utf8');

    send('Registering Task Scheduler task...');
    runPowerShell(renderPowerShellTaskScript(triggerTime));

    send('Task "Claude Auto Plan Execute" created successfully.', 'success');

    const [h, m] = triggerTime.split(':').map(Number);
    const next = new Date();
    next.setHours(h, m, 0, 0);
    if (next <= new Date()) next.setDate(next.getDate() + 1);
    send(`DONE. Next run: ${next.toLocaleDateString('en-GB')} at ${triggerTime}`, 'success');
  } catch (e) {
    send(`Error: ${e.message}`, 'error');
  }

  res.write('data: [DONE]\n\n');
  res.end();
});
```

- [ ] **Step 3: Test deploy endpoint with curl**

Start server: `cd "C:\dev\automation" && node app.js`

```bash
curl -N -X POST http://localhost:3000/api/deploy \
  -H "Content-Type: application/json" \
  -d "{\"projectDir\":\"C:\\\\dev\\\\automation\",\"triggerTime\":\"05:00\",\"prompt\":\"test prompt\"}"
```

Expected: SSE stream of `data: {...}` lines, ending with `data: [DONE]`.

- [ ] **Step 4: Verify files were written**

```powershell
Get-Content "C:\dev\automation\config.json"
Test-Path "C:\dev\automation\prompt.txt"
Test-Path "C:\dev\automation\run-claude.bat"
```

- [ ] **Step 5: Test validation rejection**

```bash
curl -N -X POST http://localhost:3000/api/deploy \
  -H "Content-Type: application/json" \
  -d "{\"projectDir\":\"\",\"triggerTime\":\"05:00\",\"prompt\":\"x\"}"
```

Expected: `data: {"time":"...","msg":"PROJECT PATH is required","type":"error"}` then `data: [DONE]`.

- [ ] **Step 6: Kill server and commit**

```bash
cd "C:\dev\automation" && git add app.js && git commit -m "feat: POST /api/deploy with SSE streaming and Task Scheduler registration"
```

---

### Task 6: app.js — remaining endpoints

**Files:**
- Modify: `C:\dev\automation\app.js` (add after deploy endpoint, before `app.listen`)

- [ ] **Step 1: Add all utility endpoints**

```javascript
app.post('/api/browse', (req, res) => {
  const script = [
    'Add-Type -AssemblyName System.Windows.Forms',
    '$d = New-Object System.Windows.Forms.FolderBrowserDialog',
    "$d.Description = 'Select project folder'",
    "$d.RootFolder = 'MyComputer'",
    "if ($d.ShowDialog() -eq 'OK') { Write-Output $d.SelectedPath }"
  ].join('; ');
  try {
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    const result = execSync(
      `powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encoded}`,
      { encoding: 'utf8' }
    );
    res.json({ path: result.trim() });
  } catch {
    res.json({ path: '' });
  }
});

app.post('/api/test-run', (req, res) => {
  const batPath = path.join(AUTO_DIR, 'run-claude.bat');
  if (!fs.existsSync(batPath)) {
    return res.json({ ok: false, error: 'run-claude.bat not found. Deploy first.' });
  }
  spawn('cmd', ['/c', 'start', 'cmd', '/k', batPath], { detached: true, shell: true });
  res.json({ ok: true });
});

app.get('/api/open-logs', (req, res) => {
  const logsDir = path.join(AUTO_DIR, 'logs');
  fs.mkdirSync(logsDir, { recursive: true });
  spawn('explorer', [logsDir], { detached: true, shell: true });
  res.json({ ok: true });
});

app.get('/api/open-taskschd', (req, res) => {
  spawn('mmc', ['taskschd.msc'], { detached: true, shell: true });
  res.json({ ok: true });
});
```

- [ ] **Step 2: Test open-logs**

Start server, then:
```bash
curl http://localhost:3000/api/open-logs
```

Expected: `{"ok":true}` and Explorer opens to `C:\dev\automation\logs\`.

- [ ] **Step 3: Test open-taskschd**

```bash
curl http://localhost:3000/api/open-taskschd
```

Expected: `{"ok":true}` and Task Scheduler MMC opens.

- [ ] **Step 4: Test browse**

```bash
curl -X POST http://localhost:3000/api/browse
```

Expected: folder picker dialog appears. Selecting a folder returns `{"path":"C:\\chosen\\path"}`. Cancelling returns `{"path":""}`.

- [ ] **Step 5: Kill server and commit**

```bash
cd "C:\dev\automation" && git add app.js && git commit -m "feat: add browse, test-run, open-logs, open-taskschd endpoints"
```

---

### Task 7: index.html — full structure and CSS

**Files:**
- Replace: `C:\dev\automation\index.html`

- [ ] **Step 1: Write index.html with layout and CSS (no JS yet)**

Write `C:\dev\automation\index.html`:
```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Claude Scheduler</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { height: 100%; }
body {
  background: #0a0a0a;
  color: #c8c8c8;
  font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace;
  font-size: 13px;
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
}
.titlebar {
  background: #111;
  border-bottom: 1px solid #1e1e1e;
  padding: 10px 20px;
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
  user-select: none;
}
.dot { width: 12px; height: 12px; border-radius: 50%; }
.dot-r { background: #ff5f57; }
.dot-y { background: #febc2e; }
.dot-g { background: #28c840; }
.title-text { color: #444; font-size: 12px; margin-left: 6px; letter-spacing: .06em; }
.title-ver { margin-left: auto; color: #2a2a2a; font-size: 11px; }
.app {
  flex: 1;
  display: grid;
  grid-template-columns: 1fr 300px;
  grid-template-rows: 1fr auto;
  min-height: 0;
}
.main {
  grid-column: 1; grid-row: 1;
  padding: 22px 26px;
  overflow-y: auto;
  border-right: 1px solid #181818;
}
.section-hd {
  color: #2e2e2e;
  font-size: 10px;
  letter-spacing: .15em;
  text-transform: uppercase;
  padding-bottom: 8px;
  border-bottom: 1px solid #181818;
  margin-bottom: 20px;
}
.field { margin-bottom: 18px; }
.lbl {
  display: block;
  color: #00ff88;
  font-size: 10px;
  letter-spacing: .12em;
  text-transform: uppercase;
  margin-bottom: 6px;
}
.row { display: flex; gap: 8px; }
.inp {
  flex: 1;
  background: #0d0d0d;
  border: 1px solid #1e1e1e;
  color: #e0e0e0;
  font-family: inherit;
  font-size: 13px;
  padding: 8px 11px;
  outline: none;
  transition: border-color .12s;
}
.inp:focus { border-color: #00ff88; }
.inp::placeholder { color: #282828; }
.inp-time { width: 110px; flex: none; }
.ta {
  width: 100%;
  background: #0d0d0d;
  border: 1px solid #1e1e1e;
  color: #ddd;
  font-family: inherit;
  font-size: 12px;
  line-height: 1.65;
  padding: 9px 11px;
  resize: vertical;
  outline: none;
  min-height: 160px;
  transition: border-color .12s;
}
.ta:focus { border-color: #00ff88; }
.ta::placeholder { color: #1e1e1e; }
.hint { color: #2a2a2a; font-size: 10px; margin-top: 4px; }
.ta-row { display: flex; justify-content: flex-end; margin-top: 5px; }
.btn {
  background: #0d0d0d;
  border: 1px solid #242424;
  color: #555;
  font-family: inherit;
  font-size: 10px;
  letter-spacing: .1em;
  text-transform: uppercase;
  padding: 7px 13px;
  cursor: pointer;
  transition: all .12s;
  white-space: nowrap;
}
.btn:hover { border-color: #3a3a3a; color: #888; }
.btn:disabled { opacity: .35; cursor: default; }
.btn-p {
  background: #00ff88;
  border-color: #00ff88;
  color: #000;
  font-weight: 700;
  font-size: 11px;
  letter-spacing: .14em;
  padding: 9px 26px;
}
.btn-p:hover:not(:disabled) { background: #00dd77; border-color: #00dd77; }
.btn-p:disabled { background: #003322; border-color: #003322; color: #006633; }
.actionbar {
  grid-column: 1; grid-row: 2;
  background: #0c0c0c;
  border-top: 1px solid #181818;
  border-right: 1px solid #181818;
  padding: 12px 26px;
  display: flex;
  gap: 9px;
  align-items: center;
}
.right {
  grid-column: 2; grid-row: 1 / 3;
  background: #080808;
  display: flex;
  flex-direction: column;
}
.cfg {
  padding: 18px 16px;
  border-bottom: 1px solid #121212;
  flex-shrink: 0;
}
.cfg-k { color: #252525; font-size: 10px; letter-spacing: .1em; margin-bottom: 2px; }
.cfg-v { color: #444; font-size: 11px; margin-bottom: 10px; word-break: break-all; }
.cfg-v.ok { color: #00885a; }
.cfg-empty { color: #1e1e1e; font-size: 11px; font-style: italic; }
.console { flex: 1; display: flex; flex-direction: column; min-height: 0; }
.con-hd {
  padding: 9px 16px 6px;
  color: #252525;
  font-size: 10px;
  letter-spacing: .12em;
  text-transform: uppercase;
  border-bottom: 1px solid #0f0f0f;
  flex-shrink: 0;
}
.con-body {
  flex: 1;
  overflow-y: auto;
  padding: 10px 12px;
  font-size: 11px;
  line-height: 1.75;
}
.log { display: flex; gap: 8px; }
.log-t { color: #202020; white-space: nowrap; }
.log-m { color: #2e7a50; }
.log-m.ok  { color: #00ff88; }
.log-m.err { color: #ff4444; }
.log-m.dim { color: #1a1a1a; }
::-webkit-scrollbar { width: 3px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: #1a1a1a; }
</style>
</head>
<body>

<div class="titlebar">
  <div class="dot dot-r"></div>
  <div class="dot dot-y"></div>
  <div class="dot dot-g"></div>
  <span class="title-text">CLAUDE SCHEDULER</span>
  <span class="title-ver">localhost:3000</span>
</div>

<div class="app">

  <div class="main">
    <div class="section-hd">Configuration</div>

    <div class="field">
      <label class="lbl" for="projectDir">Project Path</label>
      <div class="row">
        <input id="projectDir" class="inp" type="text"
          placeholder="C:\dev\my-project" autocomplete="off" spellcheck="false">
        <button class="btn" id="browseBtn">Browse</button>
      </div>
    </div>

    <div class="field">
      <label class="lbl" for="triggerTime">Trigger Time (daily)</label>
      <div class="row">
        <input id="triggerTime" class="inp inp-time" type="time" value="05:00">
      </div>
      <div class="hint">Rate limit resets at this time</div>
    </div>

    <div class="field">
      <label class="lbl" for="prompt">Task Prompt</label>
      <textarea id="prompt" class="ta" rows="10"
        placeholder="Analyse the project, create a plan in .automation/PLAN.md,&#10;execute the changes, validate with tests, report to&#10;.automation/LAST_RUN.md. Do not stop after planning.&#10;Do not ask questions."></textarea>
      <div class="ta-row">
        <button class="btn" id="loadDefaultBtn">Load Default</button>
      </div>
    </div>
  </div>

  <div class="actionbar">
    <button class="btn btn-p" id="deployBtn">&#9654; Deploy</button>
    <button class="btn" id="testRunBtn">Test Run</button>
    <button class="btn" id="viewLogsBtn">View Logs</button>
    <button class="btn" id="taskSchdBtn">Task Scheduler</button>
  </div>

  <div class="right">
    <div class="cfg">
      <div class="section-hd" style="margin-bottom:14px">Current Config</div>
      <div id="cfgContent">
        <div class="cfg-empty">No configuration found. First run.</div>
      </div>
    </div>
    <div class="console">
      <div class="con-hd">Output</div>
      <div class="con-body" id="console">
        <div class="log">
          <span class="log-t">[--:--:--]</span>
          <span class="log-m dim">Ready.</span>
        </div>
      </div>
    </div>
  </div>

</div>

</body>
</html>
```

- [ ] **Step 2: Open browser and verify layout**

Start server: `cd "C:\dev\automation" && node app.js`, open `http://localhost:3000`.

Verify:
- Dark background (#0a0a0a), green labels (#00ff88)
- Two-column layout: form left, config+console right
- Action bar at bottom left with Deploy (green), Test Run, View Logs, Task Scheduler
- Console panel with "Ready." placeholder

- [ ] **Step 3: Commit**

```bash
cd "C:\dev\automation" && git add index.html && git commit -m "feat: index.html layout and dark terminal CSS"
```

---

### Task 8: index.html — JavaScript

**Files:**
- Modify: `C:\dev\automation\index.html` (add `<script>` block before `</body>`)

- [ ] **Step 1: Add JavaScript before `</body>`**

```html
<script>
const DEFAULT_PROMPT = `You are operating in headless, non-interactive mode. There is no human to ask
clarifying questions. You MUST complete the full pipeline below before stopping.
Do not ask questions. Do not stop after planning. If a step is ambiguous, make
a reasonable choice, document it, and continue.

STEP 1 — ANALYSE
Read the repository structure. Identify language, framework, build/test/lint
commands. Pick ONE concrete scoped task: failing tests, TODOs marked URGENT,
or if nothing obvious: "clean up dead code in the most recently modified file".

STEP 2 — PLAN
Write a numbered plan to .automation/PLAN.md with: chosen task, files to touch,
concrete steps, validation command. Then print the plan to stdout.

STEP 3 — EXECUTE
Implement the changes with Edit/Write tools. If \`codex --version\` succeeds,
delegate via: codex exec --skip-git-repo-check "<task from plan>"
Otherwise implement directly. Retry once on non-zero exit with clearer description.

STEP 4 — VALIDATE
Run the validation command from STEP 1 (npm test / pytest / cargo test / etc).
If it fails: make ONE targeted fix, re-run. If still failing: document and stop cleanly.

STEP 5 — REPORT
Write .automation/LAST_RUN.md with: timestamp, task chosen, files changed
(git diff --stat), validation result (PASS/FAIL). Print 5-line summary to stdout.

RULES:
- Never run git push, git reset --hard, or rm -rf outside the project directory.
- All work stays inside the current working directory.
- If project type unclear after reading 10 files, document and stop cleanly.`;

function now() { return new Date().toTimeString().slice(0, 8); }

function appendLog(time, msg, type = 'info') {
  const el = document.getElementById('console');
  const line = document.createElement('div');
  line.className = 'log';
  const t = document.createElement('span');
  t.className = 'log-t';
  t.textContent = `[${time}]`;
  const m = document.createElement('span');
  m.className = `log-m${type === 'success' ? ' ok' : type === 'error' ? ' err' : ''}`;
  m.textContent = msg;
  line.appendChild(t);
  line.appendChild(m);
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;
}

function clearConsole() {
  document.getElementById('console').innerHTML = '';
}

function setDeployBusy(busy) {
  const btn = document.getElementById('deployBtn');
  btn.disabled = busy;
  btn.textContent = busy ? '⏳ Deploying...' : '▶ Deploy';
}

function renderConfig(cfg) {
  const el = document.getElementById('cfgContent');
  if (!cfg) {
    el.innerHTML = '<div class="cfg-empty">No configuration found. First run.</div>';
    return;
  }
  el.innerHTML =
    '<div class="cfg-k">PROJECT</div>' +
    '<div class="cfg-v ok">' + cfg.projectDir + '</div>' +
    '<div class="cfg-k">TRIGGER</div>' +
    '<div class="cfg-v ok">' + cfg.triggerTime + ' daily</div>' +
    '<div class="cfg-k">LAST DEPLOYED</div>' +
    '<div class="cfg-v">' + (cfg.lastDeployed || '—') + '</div>';
}

async function loadConfig() {
  try {
    const cfg = await fetch('/api/config').then(r => r.json());
    renderConfig(cfg);
    if (cfg) {
      document.getElementById('projectDir').value = cfg.projectDir || '';
      document.getElementById('triggerTime').value = cfg.triggerTime || '05:00';
    }
  } catch (_) {
    renderConfig(null);
  }
}

async function runDeploy() {
  const projectDir = document.getElementById('projectDir').value.trim();
  const triggerTime = document.getElementById('triggerTime').value;
  const prompt = document.getElementById('prompt').value.trim();

  clearConsole();
  setDeployBusy(true);

  try {
    const response = await fetch('/api/deploy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectDir, triggerTime, prompt })
    });

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6);
        if (data === '[DONE]') continue;
        try {
          const { time, msg, type } = JSON.parse(data);
          appendLog(time, msg, type);
        } catch (_) {}
      }
    }

    await loadConfig();
  } catch (e) {
    appendLog(now(), 'Fetch error: ' + e.message, 'error');
  } finally {
    setDeployBusy(false);
  }
}

async function runTestRun() {
  appendLog(now(), 'Launching test run in new terminal...');
  try {
    const { ok, error } = await fetch('/api/test-run', { method: 'POST' }).then(r => r.json());
    if (!ok) appendLog(now(), error || 'Failed to start test run', 'error');
    else appendLog(now(), 'Terminal opened.', 'success');
  } catch (e) {
    appendLog(now(), 'Error: ' + e.message, 'error');
  }
}

async function openLogs() {
  await fetch('/api/open-logs');
  appendLog(now(), 'Opened logs folder in Explorer.', 'success');
}

async function openTaskSchd() {
  await fetch('/api/open-taskschd');
  appendLog(now(), 'Opened Task Scheduler.', 'success');
}

async function browse() {
  try {
    const { path } = await fetch('/api/browse', { method: 'POST' }).then(r => r.json());
    if (path) document.getElementById('projectDir').value = path;
  } catch (_) {}
}

document.getElementById('deployBtn').addEventListener('click', runDeploy);
document.getElementById('testRunBtn').addEventListener('click', runTestRun);
document.getElementById('viewLogsBtn').addEventListener('click', openLogs);
document.getElementById('taskSchdBtn').addEventListener('click', openTaskSchd);
document.getElementById('browseBtn').addEventListener('click', browse);
document.getElementById('loadDefaultBtn').addEventListener('click', () => {
  document.getElementById('prompt').value = DEFAULT_PROMPT;
});

loadConfig();
</script>
```

- [ ] **Step 2: Reload browser and test interactions**

Open `http://localhost:3000` and verify each feature:
- Page shows "No configuration found. First run." in config panel
- "Load Default" fills the textarea with the 5-step prompt
- "Browse" opens folder picker; selected path populates the PROJECT PATH field
- "View Logs" — Explorer opens to `C:\dev\automation\logs\`
- "Open Task Scheduler" — taskschd.msc opens

- [ ] **Step 3: Full Deploy flow test**

1. Enter `C:\dev\automation` as project path (it exists)
2. Keep trigger time at `05:00`
3. Click "Load Default"
4. Click "Deploy"
5. Verify log lines appear one by one in the console panel
6. Verify Current Config updates to show project and trigger time after deploy

- [ ] **Step 4: Commit**

```bash
cd "C:\dev\automation" && git add index.html && git commit -m "feat: index.html JS — deploy streaming, browse, config load"
```

---

### Task 9: launcher.bat + setup.ps1 + desktop shortcut

**Files:**
- Create: `C:\dev\automation\launcher.bat`
- Create: `C:\dev\automation\setup.ps1`

- [ ] **Step 1: Write launcher.bat**

Write `C:\dev\automation\launcher.bat`:
```bat
@echo off
tasklist /fi "imagename eq node.exe" /fo csv 2>nul | find /i "node.exe" >nul
if not errorlevel 1 goto :open_browser
start "" /min node "C:\dev\automation\app.js"
timeout /t 2 /nobreak >nul
:open_browser
start "" "http://localhost:3000"
```

- [ ] **Step 2: Write setup.ps1**

Write `C:\dev\automation\setup.ps1`:
```powershell
$ws = New-Object -ComObject WScript.Shell
$shortcut = $ws.CreateShortcut("$env:USERPROFILE\Desktop\Claude Scheduler.lnk")
$shortcut.TargetPath = "C:\dev\automation\launcher.bat"
$shortcut.WorkingDirectory = "C:\dev\automation"
$shortcut.Description = "Configure and schedule Claude Code automation"
$shortcut.WindowStyle = 7
$shortcut.Save()
Write-Host "Shortcut created: $env:USERPROFILE\Desktop\Claude Scheduler.lnk"
```

- [ ] **Step 3: Run setup.ps1**

```powershell
powershell -ExecutionPolicy Bypass -File "C:\dev\automation\setup.ps1"
```

Expected: `Shortcut created: C:\Users\pinto\Desktop\Claude Scheduler.lnk`

- [ ] **Step 4: Verify shortcut**

```powershell
Test-Path "$env:USERPROFILE\Desktop\Claude Scheduler.lnk"
```

Expected: `True`

- [ ] **Step 5: Test launcher.bat**

Kill any running node first:
```powershell
Stop-Process -Name node -ErrorAction SilentlyContinue
```

Run:
```bash
"C:\dev\automation\launcher.bat"
```

Expected: browser opens to `http://localhost:3000`.

- [ ] **Step 6: Commit**

```bash
cd "C:\dev\automation" && git add launcher.bat setup.ps1 && git commit -m "feat: launcher.bat and setup.ps1 with desktop shortcut"
```

---

### Task 10: End-to-end smoke test

- [ ] **Step 1: Full cold start from desktop shortcut**

Kill any running node:
```powershell
Stop-Process -Name node -ErrorAction SilentlyContinue
```

Double-click `Claude Scheduler` on Desktop. Browser opens to `http://localhost:3000`.

- [ ] **Step 2: Deploy with real project folder**

1. Click Browse → select any folder that exists (e.g., `C:\dev\automation`)
2. Set trigger time to `06:00`
3. Click Load Default
4. Click Deploy
5. Verify: all 7 log lines stream in, ending with `DONE. Next run: ...`
6. Verify: Current Config shows project + `06:00 daily` + lastDeployed timestamp

- [ ] **Step 3: Verify files on disk**

```powershell
Get-Content "C:\dev\automation\config.json"
Get-Content "C:\dev\automation\prompt.txt" | Select-Object -First 2
Test-Path "C:\dev\automation\run-claude.bat"
```

- [ ] **Step 4: Verify Task Scheduler entry**

```powershell
Get-ScheduledTask -TaskName "Claude Auto Plan Execute" | Format-List TaskName, State, Actions
```

Expected: `State: Ready`, Actions shows path to `run-claude.bat`.

- [ ] **Step 5: Verify Test Run button**

Click "Test Run". A new `cmd` window opens running `run-claude.bat`. Verify the window appears (Claude CLI will run if installed and API key is set).

- [ ] **Step 6: Verify View Logs button**

Click "View Logs". Explorer opens to `C:\dev\automation\logs\`.

- [ ] **Step 7: Final commit**

```bash
cd "C:\dev\automation" && git add . && git commit -m "chore: verified end-to-end — claude-scheduler complete"
```
