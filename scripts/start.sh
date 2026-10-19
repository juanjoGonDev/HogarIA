#!/bin/bash
# HogarIA Start Script for Raspberry Pi (without Docker)
# This script runs the app directly to save memory

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")"

echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║                        HogarIA Starter                        ║"
echo "╚═══════════════════════════════════════════════════════════════╝"

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 18+ first."
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "❌ Node.js version 18+ required. Current: $(node -v)"
    exit 1
fi

echo "✓ Node.js $(node -v) detected"

# Set environment variables for low memory usage
export NODE_ENV=production
export NODE_OPTIONS="--max-old-space-size=256 --gc-interval=100"
export UV_THREADPOOL_SIZE=2
export DATABASE_PATH="$APP_DIR/data/hogaria.sqlite"
export PORT=${PORT:-3000}
export JWT_SECRET=${JWT_SECRET:-$(openssl rand -hex 32)}

# Create data directory
mkdir -p "$APP_DIR/data"

# Check if build exists
if [ ! -d "$APP_DIR/server/dist" ]; then
    echo "📦 Building server..."
    cd "$APP_DIR/server"
    npm run build
fi

if [ ! -d "$APP_DIR/public" ]; then
    echo "📦 Building frontend..."
    cd "$APP_DIR/frontend"
    npm run build:prod
    cp -r "$APP_DIR/frontend/dist" "$APP_DIR/public"
fi

# Run database migrations if needed
echo "🗄️  Checking database..."
cd "$APP_DIR/server"
node dist/migrate.js 2>/dev/null || true

# Start server with nice priority
echo ""
echo "🚀 Starting HogarIA..."
echo "   Port: $PORT"
echo "   Database: $DATABASE_PATH"
echo "   Memory limit: 256MB heap"
echo ""

cd "$APP_DIR"
nice -n 10 node server/dist/index.js &
SERVER_PID=$!

echo "✓ Server started (PID: $SERVER_PID)"
echo ""
echo "Access the app at: http://localhost:$PORT"
echo "Health check: http://localhost:$PORT/health"
echo ""
echo "Press Ctrl+C to stop..."

# Trap for clean shutdown
cleanup() {
    echo ""
    echo "🛑 Shutting down..."
    kill $SERVER_PID 2>/dev/null || true
    wait $SERVER_PID 2>/dev/null || true
    echo "✓ Server stopped"
    exit 0
}

trap cleanup SIGTERM SIGINT

# Wait for server
wait $SERVER_PID
