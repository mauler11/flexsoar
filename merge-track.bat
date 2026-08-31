@echo off
setlocal

rem ---------------------------------------------------------------------------
rem merge-track <data|design|admin|market>
rem
rem Shows incoming commits, refuses if there are none, merges, then
rem npm i / npm test / npm run build. Stops at the first failure.
rem
rem TWO BUGS FIXED (2026-08-25). The previous version failed on EVERY
rem invocation, argument or not:
rem
rem   1. `echo Usage: merge-track <data|design|admin|market>` — cmd treats
rem      < | > as redirection and pipe operators and splits the line into a
rem      pipeline at PARSE time, before the `if` is evaluated. So the line
rem      errored even when the branch was skipped. They are escaped as ^< ^| ^>
rem      below.
rem
rem   2. npm is npm.cmd. Invoking one batch file from another WITHOUT `call`
rem      transfers control and never comes back, so the chain would have
rem      stopped after `npm i` even once (1) was fixed.
rem ---------------------------------------------------------------------------

if "%~1"=="" (
  echo Usage: merge-track ^<data^|design^|admin^|market^>
  exit /b 1
)

git rev-parse --verify --quiet "track/%~1" >nul
if errorlevel 1 (
  echo Unknown track: %~1
  echo Expected one of: data, design, admin, market
  exit /b 1
)

rem --- Incoming commits -------------------------------------------------------
rem An agent that finishes WITHOUT committing produces "Already up to date",
rem which looks like success. Refusing on zero incoming commits turns that
rem into a visible failure instead.

set INCOMING=
for /f %%i in ('git rev-list --count "main..track/%~1"') do set INCOMING=%%i

echo.
echo === incoming on track/%~1 (%INCOMING% commit^(s^)) ===
git log "main..track/%~1" --oneline
echo.

if "%INCOMING%"=="0" (
  echo NOTHING TO MERGE. The agent may have finished without committing.
  echo Check the worktree before assuming the task is done.
  exit /b 1
)

rem --- Merge ------------------------------------------------------------------

git merge --no-edit "track/%~1"
if errorlevel 1 (
  echo.
  echo MERGE FAILED. Resolve conflicts, then re-run the checks by hand.
  echo Note: two agents appending describe blocks to tests/invariants.test.ts
  echo conflict every time, and the conflict cuts mid-block — deleting the
  echo marker lines alone leaves unbalanced braces.
  exit /b 1
)

rem --- Checks -----------------------------------------------------------------

call npm i
if errorlevel 1 (
  echo.
  echo npm i FAILED.
  exit /b 1
)

call npm test
if errorlevel 1 (
  echo.
  echo TESTS FAILED after merging track/%~1.
  exit /b 1
)

call npm run build
if errorlevel 1 (
  echo.
  echo BUILD FAILED after merging track/%~1.
  exit /b 1
)

echo.
echo === merge-track %~1 complete ===
echo Confirm the test count went UP, then run reset-worktrees.bat.
exit /b 0
