'use strict';
const express = require('express');
const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');
const { randomUUID } = require('crypto');
const {
  validateTaskInput,
  renderRunClaudeBat,
  renderRunClaudeVbs,
  renderPowerShellTaskScript,
  DEFAULT_PROMPT
} = require('./lib');

const AUTO_DIR = __dirname;
const CONFIG_PATH = path.join(AUTO_DIR, 'config.json');
const TASKS_PATH = path.join(AUTO_DIR, 'tasks.json');
const PORT = 3000;

const app = express();
app.use(express.json());

function runPowerShell(script) {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return execSync(
    `powershell -NoProfile -ExecutionPolicy Bypass -NonInteractive -EncodedCommand ${encoded}`,
    { encoding: 'utf8', windowsHide: true }
  );
}

function unregisterTaskScript(taskSchedulerName) {
  return [
    '$ProgressPreference = \'SilentlyContinue\'',
    `$taskName = '${String(taskSchedulerName).replace(/'/g, "''")}'`,
    'Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue',
    'exit 0'
  ].join('\n');
}

function migrateConfigToTasks() {
  if (!fs.existsSync(CONFIG_PATH) || fs.existsSync(TASKS_PATH)) return;

  const old = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  const id = randomUUID();
  const promptPath = path.join(AUTO_DIR, 'prompt.txt');
  const prompt = fs.existsSync(promptPath)
    ? fs.readFileSync(promptPath, 'utf8')
    : DEFAULT_PROMPT;
  const migrated = [{
    id,
    name: 'Tarefa Principal',
    projectDir: old.projectDir || '',
    triggerTime: old.triggerTime || '05:00',
    days: ['daily'],
    prompt,
    enabled: true,
    lastDeployed: old.lastDeployed || null,
    taskSchedulerName: `Claude-Auto-${id}`
  }];

  fs.writeFileSync(TASKS_PATH, JSON.stringify(migrated, null, 2), 'utf8');
}

function readTasks() {
  if (!fs.existsSync(TASKS_PATH)) return [];
  return JSON.parse(fs.readFileSync(TASKS_PATH, 'utf8'));
}

function writeTasks(tasks) {
  fs.writeFileSync(TASKS_PATH, JSON.stringify(tasks, null, 2), 'utf8');
}

function taskFiles(task) {
  return {
    batPath: path.join(AUTO_DIR, `run-claude-${task.id}.bat`),
    vbsPath: path.join(AUTO_DIR, `run-claude-${task.id}.vbs`),
    promptPath: path.join(AUTO_DIR, `prompt-${task.id}.txt`)
  };
}

function normalizeTaskInput(body, existing) {
  const id = existing?.id || randomUUID();
  return {
    id,
    name: String(body.name ?? existing?.name ?? '').trim(),
    projectDir: String(body.projectDir ?? existing?.projectDir ?? '').trim(),
    triggerTime: String(body.triggerTime ?? existing?.triggerTime ?? '05:00').trim(),
    days: Array.isArray(body.days)
      ? body.days
      : Array.isArray(existing?.days) ? existing.days : ['daily'],
    prompt: String(body.prompt ?? existing?.prompt ?? DEFAULT_PROMPT),
    enabled: typeof body.enabled === 'boolean'
      ? body.enabled
      : typeof existing?.enabled === 'boolean' ? existing.enabled : true,
    lastDeployed: existing?.lastDeployed || null,
    taskSchedulerName: existing?.taskSchedulerName || `Claude-Auto-${id}`
  };
}

function sendSse(res, msg, type = 'info') {
  const time = new Date().toTimeString().slice(0, 8);
  res.write(`data: ${JSON.stringify({ time, msg, type })}\n\n`);
}

function beginSse(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
}

function endSse(res, task) {
  res.write(`data: ${JSON.stringify({ done: true, task })}\n\n`);
  res.write('data: [DONE]\n\n');
  res.end();
}

function deployTask(task, send) {
  const validationError = validateTaskInput(task);
  if (validationError) throw new Error(validationError);

  const { batPath, vbsPath, promptPath } = taskFiles(task);
  send('Writing prompt file...');
  fs.writeFileSync(promptPath, task.prompt, 'utf8');

  send('Writing task runner...');
  fs.writeFileSync(batPath, renderRunClaudeBat(task.projectDir, task.id), 'utf8');
  fs.writeFileSync(vbsPath, renderRunClaudeVbs(batPath), 'utf8');

  send('Removing previous Task Scheduler registration...');
  runPowerShell(unregisterTaskScript(task.taskSchedulerName));

  if (task.enabled) {
    send('Registering Task Scheduler task...');
    runPowerShell(renderPowerShellTaskScript(task.triggerTime, task.days, task.taskSchedulerName));
  } else {
    send('Task is disabled; scheduler registration skipped.');
  }

  return { ...task, lastDeployed: new Date().toISOString() };
}

migrateConfigToTasks();

app.get('/', (req, res) => {
  res.sendFile(path.join(AUTO_DIR, 'index.html'));
});

app.get('/api/tasks', (req, res) => {
  try {
    res.json(readTasks());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/tasks', (req, res) => {
  beginSse(res);
  const send = (msg, type) => sendSse(res, msg, type);

  try {
    const tasks = readTasks();
    let task = normalizeTaskInput(req.body);
    task = deployTask(task, send);
    tasks.push(task);
    writeTasks(tasks);
    send(`Task "${task.name}" saved.`, 'success');
    endSse(res, task);
  } catch (e) {
    send(`Error: ${e.message}`, 'error');
    endSse(res, null);
  }
});

app.put('/api/tasks/:id', (req, res) => {
  beginSse(res);
  const send = (msg, type) => sendSse(res, msg, type);

  try {
    const tasks = readTasks();
    const index = tasks.findIndex(task => task.id === req.params.id);
    if (index === -1) throw new Error('Task not found');

    let task = normalizeTaskInput(req.body, tasks[index]);
    task = deployTask(task, send);
    tasks[index] = task;
    writeTasks(tasks);
    send(`Task "${task.name}" updated.`, 'success');
    endSse(res, task);
  } catch (e) {
    send(`Error: ${e.message}`, 'error');
    endSse(res, null);
  }
});

app.delete('/api/tasks/:id', (req, res) => {
  try {
    const tasks = readTasks();
    const task = tasks.find(item => item.id === req.params.id);
    if (!task) return res.status(404).json({ ok: false, error: 'Task not found' });

    runPowerShell(unregisterTaskScript(task.taskSchedulerName));
    const { batPath, vbsPath, promptPath } = taskFiles(task);
    for (const f of [batPath, vbsPath, promptPath]) {
      try { fs.unlinkSync(f); } catch {}
    }
    writeTasks(tasks.filter(item => item.id !== req.params.id));
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/tasks/:id/run', (req, res) => {
  try {
    const task = readTasks().find(item => item.id === req.params.id);
    if (!task) return res.status(404).json({ ok: false, error: 'Task not found' });

    const { batPath, promptPath } = taskFiles(task);
    fs.writeFileSync(promptPath, task.prompt, 'utf8');
    fs.writeFileSync(batPath, renderRunClaudeBat(task.projectDir, task.id), 'utf8');

    spawn('cmd.exe', ['/c', 'start', `"Claude ${task.name}"`, 'cmd.exe', '/k', `"${batPath}"`], {
      detached: true,
      windowsHide: false
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/browse', (req, res) => {
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

app.post('/api/open-logs', (req, res) => {
  const logsDir = path.join(AUTO_DIR, 'logs');
  fs.mkdirSync(logsDir, { recursive: true });
  spawn('explorer', [logsDir], { detached: true, shell: true });
  res.json({ ok: true });
});

app.post('/api/open-taskschd', (req, res) => {
  spawn('mmc', ['taskschd.msc'], { detached: true, shell: true });
  res.json({ ok: true });
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`Claude Scheduler -> http://localhost:${PORT}`);
});
