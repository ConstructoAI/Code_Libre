#!/usr/bin/env bash
# Build script for ERP React on Render
set -e

echo "=== ERP React Build ==="

# 0. Validate critical environment
if [ -z "$DATABASE_URL" ]; then
    echo "WARNING: DATABASE_URL not set. API will fail to connect to database."
fi

# 1. Install Python dependencies
echo "[1/4] Installing Python dependencies..."
pip install --upgrade pip
pip install -r requirements.txt
# ERP-specific deps (ensure present even if missing from root requirements)
pip install PyJWT bcrypt

# 2. Install Node.js dependencies for frontend
echo "[2/4] Installing Node.js dependencies..."
cd ERP_REACT/frontend
npm ci --production=false

# 3. Build React frontend
echo "[3/4] Building React frontend..."
npm run build

# 4. Verify build
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
echo "=== ERP React Build complete ==="
