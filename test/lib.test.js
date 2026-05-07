'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const { validateTaskInput, renderRunClaudeBat, renderPowerShellTaskScript, DEFAULT_PROMPT } = require('../lib');

function validTask(overrides = {}) {
  return {
    name: 'Daily automation',
    projectDir: os.tmpdir(),
    triggerTime: '05:00',
    days: ['daily'],
    prompt: 'do something',
    ...overrides
  };
}

test('validateTaskInput: rejects missing name', () => {
  const err = validateTaskInput(validTask({ name: '   ' }));
  assert.equal(err, 'TASK NAME is required');
});

test('validateTaskInput: rejects missing projectDir', () => {
  const err = validateTaskInput(validTask({ projectDir: '' }));
  assert.equal(err, 'PROJECT PATH is required');
});

test('validateTaskInput: rejects non-existent dir', () => {
  const err = validateTaskInput(validTask({ projectDir: 'C:\\nonexistent\\xyz\\abc' }));
  assert.match(err, /not found/);
});

test('validateTaskInput: rejects bad triggerTime (no leading zero)', () => {
  const err = validateTaskInput(validTask({ triggerTime: '5:00' }));
  assert.equal(err, 'TRIGGER TIME must be HH:MM');
});

test('validateTaskInput: rejects invalid triggerTime value', () => {
  const err = validateTaskInput(validTask({ triggerTime: '29:99' }));
  assert.equal(err, 'TRIGGER TIME must be HH:MM');
});

test('validateTaskInput: rejects empty days', () => {
  const err = validateTaskInput(validTask({ days: [] }));
  assert.equal(err, 'DAYS must be a non-empty array');
});

test('validateTaskInput: rejects invalid day', () => {
  const err = validateTaskInput(validTask({ days: ['mon', 'noday'] }));
  assert.equal(err, 'Invalid day: noday');
});

test('validateTaskInput: rejects daily mixed with weekdays', () => {
  const err = validateTaskInput(validTask({ days: ['daily', 'mon'] }));
  assert.equal(err, 'DAYS must be either daily or specific weekdays');
});

test('validateTaskInput: rejects empty prompt', () => {
  const err = validateTaskInput(validTask({ prompt: '   ' }));
  assert.equal(err, 'TASK PROMPT is required');
});

test('validateTaskInput: returns null for valid daily input', () => {
  const err = validateTaskInput(validTask());
  assert.equal(err, null);
});

test('validateTaskInput: returns null for valid weekly input', () => {
  const err = validateTaskInput(validTask({ days: ['mon', 'fri'] }));
  assert.equal(err, null);
});

test('renderRunClaudeBat: contains projectDir', () => {
  const bat = renderRunClaudeBat('C:\\test\\myproject', 'abc-123');
  assert.ok(bat.includes('C:\\test\\myproject'), 'bat must contain projectDir');
});

test('renderRunClaudeBat: contains claude invocation flags', () => {
  const bat = renderRunClaudeBat('C:\\test\\myproject', 'abc-123');
  assert.ok(bat.includes('CLAUDE_EXE'), 'bat must resolve claude executable');
  assert.ok(bat.includes('"%CLAUDE_EXE%" -p'), 'bat must invoke claude in print mode');
  assert.ok(bat.includes('=== PHASE 1: PLAN ==='), 'bat must include phase 1 marker');
  assert.ok(bat.includes('=== PHASE 2: EXECUTE ==='), 'bat must include phase 2 marker');
  assert.ok(bat.includes('--max-turns 20'), 'bat must set phase 1 --max-turns 20');
  assert.ok(bat.includes('--max-turns 40'), 'bat must set phase 2 --max-turns 40');
  assert.ok(bat.includes('if not exist "%PROJECT_DIR%\\.automation\\PLAN.md"'), 'bat must check PLAN.md exists between phases');
  assert.ok(bat.includes('--permission-mode acceptEdits'), 'bat must set permission mode');
});

test('renderRunClaudeBat: includes taskId in log file path', () => {
  const bat = renderRunClaudeBat('C:\\test\\myproject', 'task-42');
  assert.ok(bat.includes('claude-auto-task-42_%STAMP%.log'), 'bat must include taskId in log filename');
});

test('renderPowerShellTaskScript: daily trigger contains New-ScheduledTaskTrigger without weekly', () => {
  const ps = renderPowerShellTaskScript('05:30', ['daily'], 'Claude-Auto-abc-123');
  assert.ok(ps.includes('New-ScheduledTaskTrigger -Daily -At "05:30"'), 'ps must include daily trigger');
  assert.ok(!ps.includes('-Weekly'), 'daily trigger must not include weekly flag');
});

test('renderPowerShellTaskScript: weekly trigger maps weekdays', () => {
  const ps = renderPowerShellTaskScript('05:00', ['mon', 'fri'], 'Claude-Auto-abc-123');
  assert.ok(ps.includes('-Weekly -DaysOfWeek Monday,Friday'), 'ps must include mapped weekly days');
});

test('renderPowerShellTaskScript: contains task name', () => {
  const ps = renderPowerShellTaskScript('05:00', ['daily'], 'Claude-Auto-abc-123');
  assert.ok(ps.includes('Claude-Auto-abc-123'), 'ps must include task name');
});

test('DEFAULT_PROMPT: contains plan-only steps and required paths', () => {
  assert.ok(DEFAULT_PROMPT.includes('STEP 1'), 'missing STEP 1');
  assert.ok(DEFAULT_PROMPT.includes('STEP 2'), 'missing STEP 2');
  assert.ok(!DEFAULT_PROMPT.includes('STEP 3'), 'prompt must stop before execution');
  assert.ok(DEFAULT_PROMPT.includes('ANALYSE and PLAN'), 'missing plan-only instruction');
  assert.ok(DEFAULT_PROMPT.includes('ANALYSIS.md'), 'missing ANALYSIS.md reference');
  assert.ok(DEFAULT_PROMPT.includes('PLAN.md'), 'missing PLAN.md reference');
  assert.ok(!DEFAULT_PROMPT.includes('LAST_RUN.md'), 'prompt must not include execution report');
  assert.ok(DEFAULT_PROMPT.includes('Do NOT make any code changes'), 'missing no-code-changes instruction');
});
