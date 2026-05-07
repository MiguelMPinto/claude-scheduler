@echo off
setlocal
set "PROJECT_DIR=C:\Users\pinto\Documents\Cenas\auto"
set "AUTO_DIR=C:\Users\pinto\Documents\Cenas\auto"
set "LOG_DIR=%AUTO_DIR%\logs"
set "PROMPT_FILE=%AUTO_DIR%\prompt.txt"
for /f "tokens=*" %%I in ('powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd_HH-mm'"') do set STAMP=%%I
set "LOG_FILE=%LOG_DIR%\run_%STAMP%.log"
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"
cd /d "%PROJECT_DIR%" || (echo ERRO: project dir nao encontrado >> "%LOG_FILE%" & exit /b 1)
set "CLAUDE_EXE="
if exist "%USERPROFILE%\.local\bin\claude.exe" set "CLAUDE_EXE=%USERPROFILE%\.local\bin\claude.exe"
if not defined CLAUDE_EXE for /f "delims=" %%I in ('where claude 2^>nul') do if not defined CLAUDE_EXE set "CLAUDE_EXE=%%I"
if not defined CLAUDE_EXE (echo ERRO: claude nao encontrado no PATH nem em %%USERPROFILE%%\.local\bin\claude.exe >> "%LOG_FILE%" & exit /b 1)
if not exist "%PROMPT_FILE%" (echo ERRO: prompt.txt nao encontrado: %PROMPT_FILE% >> "%LOG_FILE%" & exit /b 1)
echo ============================================== >> "%LOG_FILE%"
echo Run started: %DATE% %TIME% >> "%LOG_FILE%"
echo Project: %PROJECT_DIR% >> "%LOG_FILE%"
echo Claude: %CLAUDE_EXE% >> "%LOG_FILE%"
echo ============================================== >> "%LOG_FILE%"
echo === PHASE 1: PLAN === >> "%LOG_FILE%"
type "%PROMPT_FILE%" | "%CLAUDE_EXE%" -p --allowedTools "Read,Write,Bash" --permission-mode acceptEdits --output-format text --max-turns 20 >> "%LOG_FILE%" 2>&1
set "RC1=%ERRORLEVEL%"
if %RC1% neq 0 (echo ERRO fase 1: exit %RC1% >> "%LOG_FILE%" & exit /b %RC1%)
if not exist "%PROJECT_DIR%\.automation\PLAN.md" (echo ERRO: PLAN.md nao criado >> "%LOG_FILE%" & exit /b 1)
echo === PHASE 2: EXECUTE === >> "%LOG_FILE%"
powershell -NoProfile -Command "(Get-Content '%PROJECT_DIR%\.automation\PLAN.md' -Raw) + \"nExecute this plan exactly. Use Edit/Write/Bash tools. Run the validation command. Write .automation/LAST_RUN.md with timestamp, files changed, and PASS/FAIL.\"" | "%CLAUDE_EXE%" -p --allowedTools "Read,Edit,Write,Bash" --permission-mode acceptEdits --output-format text --max-turns 40 >> "%LOG_FILE%" 2>&1
set "RC2=%ERRORLEVEL%"
echo ============================================== >> "%LOG_FILE%"
echo Run finished: %DATE% %TIME% (exit code %RC2%) >> "%LOG_FILE%"
echo ============================================== >> "%LOG_FILE%"
exit /b %RC2%