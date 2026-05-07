# Implementation Plan — 2026-05-04

## Chosen task
Remove the dead `$task | Set-ScheduledTask | Out-Null` line from `renderPowerShellTaskScript`
in `lib.js`.

## Files to modify
- `C:\Users\pinto\Documents\Cenas\auto\lib.js`

## Steps

1. Read `lib.js` to confirm current state of `renderPowerShellTaskScript`.
2. Remove the last array element `'$task | Set-ScheduledTask | Out-Null'` from the returned
   array in `renderPowerShellTaskScript`. The Register-ScheduledTask call becomes the last line.
3. Save `lib.js`.
4. Run the validation command and confirm all 11 tests pass.

## Validation command
```
node --test test/lib.test.js
```
All 11 tests must pass (PASS) after the change.
