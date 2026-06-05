#!/usr/bin/env bash
set -e

# One-click launcher for React + TypeScript + Vite on Linux/macOS.
# It installs dependencies when needed, builds the project, finds a free port,
# opens the browser, and starts the Vite dev server.

cd "$(dirname "$0")"

PORT=5173
MAX_PORT=5199
PKG_MANAGER=""

# Check package manager: prefer pnpm, fallback to npm.
if command -v pnpm >/dev/null 2>&1; then
  PKG_MANAGER="pnpm"
elif command -v npm >/dev/null 2>&1; then
  PKG_MANAGER="npm"
else
  echo "[ERROR] npm or pnpm was not found. Please install Node.js first."
  exit 1
fi

# Install dependencies only when node_modules does not exist.
if [ ! -d "node_modules" ]; then
  echo "[INFO] Installing dependencies with $PKG_MANAGER..."
  "$PKG_MANAGER" install
else
  echo "[INFO] node_modules exists, skipping dependency installation."
fi

# Build once before starting the dev server.
echo "[INFO] Building project..."
"$PKG_MANAGER" run build

# Check whether a port is in use. Prefer lsof/nc, then fallback to bash /dev/tcp.
port_busy() {
  if command -v lsof >/dev/null 2>&1; then
    lsof -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
  elif command -v nc >/dev/null 2>&1; then
    nc -z localhost "$1" >/dev/null 2>&1
  else
    (echo >/dev/tcp/127.0.0.1/"$1") >/dev/null 2>&1
  fi
}

# Find the next available port from 5173 to 5199.
while port_busy "$PORT"; do
  echo "[INFO] Port $PORT is busy, trying next port..."
  PORT=$((PORT + 1))
  if [ "$PORT" -gt "$MAX_PORT" ]; then
    echo "[ERROR] No available port found between 5173 and $MAX_PORT."
    exit 1
  fi
done

URL="http://localhost:$PORT/"
echo "[INFO] Project is starting at $URL"
echo "[INFO] Browser will open automatically."

# Open the default browser. Vite usually becomes ready a moment later.
if command -v open >/dev/null 2>&1; then
  open "$URL" >/dev/null 2>&1 &
elif command -v xdg-open >/dev/null 2>&1; then
  xdg-open "$URL" >/dev/null 2>&1 &
else
  echo "[INFO] Please open $URL in your browser."
fi

# Start Vite dev server on the selected port.
"$PKG_MANAGER" run dev -- --host 0.0.0.0 --port "$PORT"
