#!/bin/bash
# HogarIA Build Script

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")"

echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║                        HogarIA Builder                        ║"
echo "╚═══════════════════════════════════════════════════════════════╝"

cd "$APP_DIR"

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Build frontend
echo ""
echo "🔨 Building frontend..."
cd "$APP_DIR/frontend"
npm run build:prod

# Copy frontend build to server/public
echo ""
echo "📋 Copying frontend build..."
rm -rf "$APP_DIR/server/public"
cp -r "$APP_DIR/frontend/dist/browser" "$APP_DIR/server/public"

# Build backend
echo ""
echo "🔨 Building backend..."
cd "$APP_DIR/server"
npm run build

echo ""
echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║                    Build Complete! ✓                          ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""
echo "To start the app:"
echo "  Development: npm run dev"
echo "  Production:  ./scripts/start.sh"
echo "  Docker:      docker-compose up -d"
