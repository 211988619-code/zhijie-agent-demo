@echo off
setlocal EnableExtensions EnableDelayedExpansion

rem One-click launcher for React + TypeScript + Vite on Windows.
rem It installs dependencies when needed, builds the project, finds a free port,
rem opens the browser, and starts the Vite dev server.

cd /d "%~dp0"

set "PORT=5173"
set "MAX_PORT=5199"
set "PKG_MANAGER="

rem Check package manager: prefer pnpm, fallback to npm.
where pnpm >nul 2>nul
if not errorlevel 1 (
  set "PKG_MANAGER=pnpm"
) else (
  where npm >nul 2>nul
  if not errorlevel 1 (
    set "PKG_MANAGER=npm"
  )
)

if "%PKG_MANAGER%"=="" (
  echo [ERROR] npm or pnpm was not found. Please install Node.js first.
  pause
  exit /b 1
)

rem Install dependencies only when node_modules does not exist.
if not exist "node_modules" (
  echo [INFO] Installing dependencies with %PKG_MANAGER%...
  if "%PKG_MANAGER%"=="pnpm" (
    call pnpm install
  ) else (
    call npm install
  )
  if errorlevel 1 (
    echo [ERROR] Dependency installation failed.
    pause
    exit /b 1
  )
) else (
  echo [INFO] node_modules exists, skipping dependency installation.
)

rem Build once before starting the dev server.
echo [INFO] Building project...
if "%PKG_MANAGER%"=="pnpm" (
  call pnpm run build
) else (
  call npm run build
)
if errorlevel 1 (
  echo [ERROR] Build failed.
  pause
  exit /b 1
)

rem Find the next available port from 5173 to 5199.
:find_port
netstat -ano | findstr /R /C:":%PORT% .*LISTENING" >nul 2>nul
if errorlevel 1 (
  goto port_found
)

echo [INFO] Port %PORT% is busy, trying next port...
set /a PORT+=1
if %PORT% GTR %MAX_PORT% (
  echo [ERROR] No available port found between 5173 and %MAX_PORT%.
  pause
  exit /b 1
)
goto find_port

:port_found
set "URL=http://localhost:%PORT%/"
echo [INFO] Project is starting at %URL%
echo [INFO] Browser will open automatically.

rem Open browser first; Vite usually becomes ready a moment later.
start "" "%URL%"

rem Start Vite dev server on the selected port.
if "%PKG_MANAGER%"=="pnpm" (
  call pnpm run dev -- --host 0.0.0.0 --port %PORT%
) else (
  call npm run dev -- --host 0.0.0.0 --port %PORT%
)

pause
