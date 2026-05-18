#!/usr/bin/env bash
set -e

echo "=== Mobile React Build (unified backend + frontend) ==="

# 1. Python dependencies
echo "[1/4] Installing Python dependencies..."
pip install --upgrade pip
if [ -f requirements.txt ]; then
  pip install -r requirements.txt
elif [ -f MOBILE_REACT/backend/requirements.txt ]; then
  pip install -r MOBILE_REACT/backend/requirements.txt
else
  echo "No requirements.txt found — installing core deps..."
  pip install fastapi uvicorn psycopg2-binary python-jose passlib bcrypt python-multipart
fi

# 2. Node.js dependencies
echo "[2/4] Installing Node.js dependencies..."
cd MOBILE_REACT/frontend
npm ci --production=false

# 3. Build React frontend
echo "[3/4] Building React frontend..."
npm run build

# 4. Verify build output
echo "[4/4] Verifying build..."
if [ -d "dist" ] && [ -f "dist/index.html" ]; then
    echo "Build successful! dist/index.html exists."
    ls -la dist/
    echo "Assets:"
    ls -la dist/assets/ 2>/dev/null || echo "(no assets dir)"
else
    echo "ERROR: Build failed - dist/index.html not found"
    exit 1
fi

cd ../..
echo "=== Mobile React Build complete ==="
