#!/bin/bash
# HogarIA Setup Script

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")"

echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║                         HogarIA Setup                         ║"
echo "╚═══════════════════════════════════════════════════════════════╝"

cd "$APP_DIR"

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed."
    echo "   Please install Node.js 18+ from https://nodejs.org/"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "❌ Node.js version 18+ required. Current: $(node -v)"
    exit 1
fi

echo "✓ Node.js $(node -v)"

# Create necessary directories
echo ""
echo "📁 Creating directories..."
mkdir -p data
mkdir -p logs

# Install dependencies
echo ""
echo "📦 Installing dependencies (this may take a few minutes)..."
npm install

# Generate JWT secret if not exists
if [ ! -f .env ]; then
    echo ""
    echo "🔐 Generating .env file..."
    JWT_SECRET=$(openssl rand -hex 32 2>/dev/null || cat /dev/urandom | tr -dc 'a-zA-Z0-9' | fold -w 64 | head -n 1)
    
    cat > .env << EOF
# HogarIA Configuration
# Generated on $(date)

# Server
NODE_ENV=development
PORT=3000

# Database
DATABASE_PATH=./data/hogaria.sqlite

# Authentication
JWT_SECRET=${JWT_SECRET}

# CORS (for development)
CORS_ORIGIN=http://localhost:4200

# AI Configuration (configure in the app UI)
# AI_DEFAULT_PROVIDER=custom
# AI_TIMEOUT=30000
EOF
    
    echo "✓ .env file created"
fi

echo ""
echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║                    Setup Complete! ✓                          ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""
echo "Next steps:"
echo ""
echo "1. Start development server:"
echo "   npm run dev"
echo ""
echo "2. Open in browser:"
echo "   http://localhost:4200"
echo ""
echo "3. For production (Raspberry Pi):"
echo "   ./scripts/build.sh"
echo "   ./scripts/start.sh"
echo ""
echo "4. For Docker:"
echo "   docker-compose up -d"
echo ""
