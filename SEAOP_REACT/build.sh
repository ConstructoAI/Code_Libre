#!/usr/bin/env bash
# Build script for SEAOP React on Render
# This builds the React frontend and installs Python dependencies.
set -e

echo "=== SEAOP React Build ==="

# 1. Install Python dependencies (from project root requirements.txt)
echo "[1/4] Installing Python dependencies..."
pip install -r requirements.txt
pip install PyJWT

# 2. Install Node.js dependencies for frontend
echo "[2/4] Installing Node.js dependencies..."
cd SEAOP_REACT/frontend
npm install

# 3. Build React frontend
echo "[3/4] Building React frontend..."
npm run build

# 4. Verify build
echo "[4/4] Verifying build..."
if [ -d "dist" ]; then
    echo "Build successful! Files in dist/:"
    ls -la dist/
    echo "Assets:"
    ls -la dist/assets/ 2>/dev/null || echo "(no assets dir)"
else
    echo "ERROR: Build failed - dist/ directory not found"
    exit 1
fi

echo "=== Build complete ==="
