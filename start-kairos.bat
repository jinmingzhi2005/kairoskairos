@echo off
rem Kairos launcher (ASCII-only to avoid codepage issues)
rem   start-kairos.bat             -> build, then start
rem   start-kairos.bat skip-build  -> start only (use when already built)
cd /d "%~dp0"

if not exist "package.json" (
  echo [ERROR] package.json not found. Run this from the Kairos folder.
  pause
  exit /b 1
)

if /i "%~1"=="skip-build" goto run

echo [1/2] Building...
call npm run build
if errorlevel 1 (
  echo.
  echo [ERROR] Build failed. Copy the output above.
  pause
  exit /b 1
)

:run
echo [2/2] Starting Kairos...
echo   Alt+Space   = show the calendar
echo   Ctrl+Alt+C  = toggle the calendar
echo   Tray icon   = show / hide / quit
echo.
call npm start
echo.
echo Kairos exited.
pause
