# Claude Scheduler — Design Spec
_2026-04-27_

## Overview

A Windows desktop configurator that lets the user visually set up and update a Claude Code automation pipeline. The user opens a shortcut, fills in three fields, clicks **Deploy**, and the tool creates all required files and registers a Windows Task Scheduler task. No manual file editing required.

---

## Architecture

**Stack:** Node.js (v24 confirmed available) + plain HTML/CSS/JS.

```
C:\dev\automation\
├── app.js            ← Express server (localhost:3000)
├── index.html        ← UI (dark terminal aesthetic)
├── launcher.bat      ← Starts app.js + opens browser
├── prompt.txt        ← Written on Deploy
├── run-claude.bat    ← Written on Deploy
├── config.json       ← Written on Deploy; read by UI on load
└── logs\             ← Created by run-claude.bat at runtime
```

Desktop shortcut `Claude Scheduler.lnk` → `launcher.bat`

---

## Components

### `app.js` — Node.js server

- Serves `index.html` at `GET /`
- `POST /api/deploy` — receives `{ projectDir, triggerTime, prompt }`, performs all Deploy actions, streams log lines back as newline-delimited JSON
- `POST /api/test-run` — spawns `run-claude.bat` in a visible terminal window (`start cmd /k`)
- `GET /api/config` — reads and returns `config.json` (or `null` if not found)
- Uses only Node built-ins + `express` (one npm dependency)

### `index.html` — UI

Single-page app with no external dependencies (vanilla JS, CSS inline or in a `<style>` block).

**Layout** (two-column):
- Left: form fields + action bar at bottom
- Right: Current Config panel (top) + scrollable console output (bottom)

**Fields:**
| Field | Type | Default |
|---|---|---|
| PROJECT PATH | `<input type="text">` + Browse button | _(empty)_ |
| TRIGGER TIME | `<input type="time">` | `05:00` |
| TASK PROMPT | `<textarea rows="10">` + Load Default button | _(empty)_ |

**Action buttons:**
- `DEPLOY` (primary, green) — calls `POST /api/deploy`
- `TEST RUN` — calls `POST /api/test-run`
- `VIEW LOGS` — calls `GET /api/open-logs` (opens Explorer)
- `OPEN TASK SCHEDULER` — calls `GET /api/open-taskschd`

**Console:** appends timestamped lines from SSE (`text/event-stream`) response; auto-scrolls.

**On load:** calls `GET /api/config` and populates "Current Config" panel; pre-fills form fields if config exists.

**Browse button:** calls `POST /api/browse` which runs a PowerShell `FolderBrowserDialog` and returns the chosen path.

### `launcher.bat`

```bat
@echo off
start "" /min node "C:\dev\automation\app.js"
timeout /t 2 /nobreak >nul
start "" "http://localhost:3000"
```

### `run-claude.bat` (generated on Deploy)

- Sets `PROJECT_DIR`, `AUTO_DIR`, `LOG_DIR`, `PROMPT_FILE`
- Stamps log filename with date/time
- `cd` into project dir
- Pipes `prompt.txt` into `claude -p` with `--allowedTools`, `--permission-mode acceptEdits`, `--output-format text`, `--max-turns 40`
- Logs stdout+stderr to timestamped log file
- Exits with Claude's exit code

### `config.json` (generated on Deploy)

```json
{
  "projectDir": "C:\\dev\\my-project",
  "triggerTime": "05:00",
  "lastDeployed": "2026-04-27T10:23:01"
}
```

---

## Deploy Logic (server-side, `POST /api/deploy`)

1. Validate: `projectDir` exists, `triggerTime` matches `HH:MM`, `prompt` non-empty
2. `mkdir -p C:\dev\automation\`
3. Write `config.json`
4. Write `prompt.txt`
5. Write `run-claude.bat`
6. Run PowerShell inline to register/replace Task Scheduler task `"Claude Auto Plan Execute"`:
   - Action: execute `run-claude.bat` from `C:\dev\automation\`
   - Trigger: daily at chosen time
   - Settings: 1h execution limit, IgnoreNew on overlap
   - `Unregister-ScheduledTask` first (silently), then `Register-ScheduledTask`
7. Stream log lines back to client as each step completes
8. Return next-run timestamp in final message

---

## Default Prompt (Load Default button)

Full 5-step headless pipeline:
- STEP 1 ANALYSE → STEP 2 PLAN (.automation/PLAN.md) → STEP 3 EXECUTE → STEP 4 VALIDATE → STEP 5 REPORT (.automation/LAST_RUN.md)
- Includes safety rules (no git push, no rm -rf outside project dir)

---

## Visual Design

- Background: `#0a0a0a` / `#0f0f0f`
- Accent: `#00ff88` (green) for labels, primary button, success log lines
- Text: `#c8c8c8` (default), `#e0e0e0` (inputs)
- Borders: `#1a1a1a` to `#2a2a2a`
- Font: `'Cascadia Code', 'Fira Code', 'Consolas', monospace`
- Error log lines: `#ff4444`
- No external CSS frameworks

---

## Desktop Shortcut

Created by PowerShell `WScript.Shell.CreateShortcut` at:
`$env:USERPROFILE\Desktop\Claude Scheduler.lnk`
- Target: `C:\dev\automation\launcher.bat`
- Working dir: `C:\dev\automation\`
- Description: `Configure and schedule Claude Code automation`

---

## Error Handling

- Deploy validates fields before any file writes; returns error JSON on failure
- PowerShell task registration errors are caught and streamed as error log lines
- `launcher.bat` waits 2 s for server to start before opening browser (no polling)
- Browse folder picker cancellation returns empty string (UI ignores it)

---

## Out of Scope

- Multi-project support (single config only)
- Authentication / multi-user
- Remote scheduling
- Log viewer in the UI (opens Explorer instead)
