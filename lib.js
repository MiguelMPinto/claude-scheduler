'use strict';
const fs = require('fs');
const path = require('path');
const AUTO_DIR = __dirname;

function psSingleQuoted(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

const DEFAULT_PROMPT = `You are running in headless non-interactive mode.
Your ONLY job in this session is to ANALYSE and PLAN. Do NOT execute anything.

STEP 1 - ANALYSE
Read the project structure. Identify language, framework, test command, build command.
Choose ONE concrete task: failing tests, urgent TODOs, or "clean up dead code in most recently modified file".
Write findings to .automation/ANALYSIS.md.

STEP 2 - PLAN
Write a numbered plan to .automation/PLAN.md:
- Chosen task (one sentence)
- Files to modify (list)
- Steps to execute (numbered)
- Validation command

STOP after writing PLAN.md. Do NOT make any code changes.`;

const WEEK_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const POWERSHELL_DAYS = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
  sun: 'Sunday'
};

function validateTaskInput({ name, projectDir, triggerTime, days, prompt }) {
  if (typeof name !== 'string' || !name.trim()) return 'TASK NAME is required';
  if (!projectDir) return 'PROJECT PATH is required';
  if (!fs.existsSync(projectDir)) return `Project dir not found: ${projectDir}`;
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(triggerTime)) return 'TRIGGER TIME must be HH:MM';
  if (!Array.isArray(days) || days.length === 0) return 'DAYS must be a non-empty array';
  if (days.includes('daily')) {
    if (days.length !== 1) return 'DAYS must be either daily or specific weekdays';
  } else {
    const seen = new Set();
    for (const day of days) {
      if (!WEEK_DAYS.includes(day)) return `Invalid day: ${day}`;
      if (seen.has(day)) return `Duplicate day: ${day}`;
      seen.add(day);
    }
  }
  if (typeof prompt !== 'string' || !prompt.trim()) return 'TASK PROMPT is required';
  return null;
}

function renderRunClaudeBat(projectDir, taskId) {
  const safeTaskId = String(taskId);
  return [
    '@echo off',
    'setlocal',
    `set "PROJECT_DIR=${projectDir}"`,
    `set "AUTO_DIR=${AUTO_DIR}"`,
    'set "LOG_DIR=%AUTO_DIR%\\logs"',
    `set "PROMPT_FILE=%AUTO_DIR%\\prompt-${safeTaskId}.txt"`,
    "for /f \"tokens=*\" %%I in ('powershell -NoProfile -Command \"Get-Date -Format 'yyyy-MM-dd_HH-mm'\"') do set STAMP=%%I",
    `set "LOG_FILE=%LOG_DIR%\\claude-auto-${safeTaskId}_%STAMP%.log"`,
    'if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"',
    'cd /d "%PROJECT_DIR%" || (echo ERRO: project dir nao encontrado >> "%LOG_FILE%" & exit /b 1)',
    'set "CLAUDE_EXE="',
    'if exist "%USERPROFILE%\\.local\\bin\\claude.exe" set "CLAUDE_EXE=%USERPROFILE%\\.local\\bin\\claude.exe"',
    'if not defined CLAUDE_EXE for /f "delims=" %%I in (\'where claude 2^>nul\') do if not defined CLAUDE_EXE set "CLAUDE_EXE=%%I"',
    'if not defined CLAUDE_EXE (echo ERRO: claude nao encontrado no PATH nem em %%USERPROFILE%%\\.local\\bin\\claude.exe >> "%LOG_FILE%" & exit /b 1)',
    'if not exist "%PROMPT_FILE%" (echo ERRO: prompt file nao encontrado: %PROMPT_FILE% >> "%LOG_FILE%" & exit /b 1)',
    'echo ============================================== >> "%LOG_FILE%"',
    'echo Run started: %DATE% %TIME% >> "%LOG_FILE%"',
    'echo Project: %PROJECT_DIR% >> "%LOG_FILE%"',
    'echo Claude: %CLAUDE_EXE% >> "%LOG_FILE%"',
    'echo ============================================== >> "%LOG_FILE%"',
    'echo === PHASE 1: PLAN === >> "%LOG_FILE%"',
    'type "%PROMPT_FILE%" | "%CLAUDE_EXE%" -p --allowedTools "Read,Write,Bash" --permission-mode acceptEdits --output-format text --max-turns 20 >> "%LOG_FILE%" 2>&1',
    'set "RC1=%ERRORLEVEL%"',
    'if %RC1% neq 0 (echo ERRO fase 1: exit %RC1% >> "%LOG_FILE%" & exit /b %RC1%)',
    'if not exist "%PROJECT_DIR%\\.automation\\PLAN.md" (echo ERRO: PLAN.md nao criado >> "%LOG_FILE%" & exit /b 1)',
    'echo === PHASE 2: EXECUTE === >> "%LOG_FILE%"',
    'powershell -NoProfile -Command "(Get-Content \'%PROJECT_DIR%\\.automation\\PLAN.md\' -Raw) + \\"nExecute this plan exactly. Use Edit/Write/Bash tools. Run the validation command. Write .automation/LAST_RUN.md with timestamp, files changed, and PASS/FAIL.\\"" | "%CLAUDE_EXE%" -p --allowedTools "Read,Edit,Write,Bash" --permission-mode acceptEdits --output-format text --max-turns 40 >> "%LOG_FILE%" 2>&1',
    'set "RC2=%ERRORLEVEL%"',
    'echo ============================================== >> "%LOG_FILE%"',
    'echo Run finished: %DATE% %TIME% (exit code %RC2%) >> "%LOG_FILE%"',
    'echo ============================================== >> "%LOG_FILE%"',
    'exit /b %RC2%'
  ].join('\r\n');
}

function taskIdFromSchedulerName(taskSchedulerName) {
  const prefix = 'Claude-Auto-';
  const name = String(taskSchedulerName || '');
  return name.startsWith(prefix) ? name.slice(prefix.length) : name;
}

function renderPowerShellTaskScript(triggerTime, days, taskSchedulerName) {
  const taskId = taskIdFromSchedulerName(taskSchedulerName);
  const scriptPath = path.join(AUTO_DIR, `run-claude-${taskId}.bat`);
  const trigger = Array.isArray(days) && days.length === 1 && days[0] === 'daily'
    ? `$trigger = New-ScheduledTaskTrigger -Daily -At "${triggerTime}"`
    : `$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek ${days.map(day => POWERSHELL_DAYS[day]).join(',')} -At "${triggerTime}"`;

  return [
    `$taskName = ${psSingleQuoted(taskSchedulerName)}`,
    `$scriptPath = ${psSingleQuoted(scriptPath)}`,
    `$workDir = ${psSingleQuoted(AUTO_DIR)}`,
    '$action = New-ScheduledTaskAction -Execute $scriptPath -WorkingDirectory $workDir',
    trigger,
    '$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Hours 1) -MultipleInstances IgnoreNew -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries',
    'Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue',
    '$task = Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -RunLevel Limited -Force'
  ].join('\n');
}

module.exports = {
  validateTaskInput,
  renderRunClaudeBat,
  renderPowerShellTaskScript,
  DEFAULT_PROMPT,
  WEEK_DAYS,
  POWERSHELL_DAYS
};
