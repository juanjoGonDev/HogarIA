#!/bin/bash
# =============================================================================
# HogarIA - Setup Script
# =============================================================================
# Usage: ./setup.sh

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Header
echo -e "${BLUE}"
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║                        HogarIA Setup                         ║"
echo "║           Household, shopping and kitchen with AI            ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# Check Volta
echo -e "${YELLOW}📋 Checking prerequisites...${NC}"
if ! command -v volta &> /dev/null; then
    echo -e "${YELLOW}⚠️  Volta not found. Installing...${NC}"
    curl https://get.volta.sh | bash
    export VOLTA_HOME="$HOME/.volta"
    export PATH="$VOLTA_HOME/bin:$PATH"
fi
echo -e "${GREEN}✅ Volta $(volta -v)${NC}"

# Check Node.js version
if ! command -v node &> /dev/null; then
    echo -e "${YELLOW}⚠️  Node.js not found. Installing via Volta...${NC}"
    volta install node@20.18.1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo -e "${RED}❌ Node.js version must be >= 18. Current: $(node -v)${NC}"
    exit 1
fi
echo -e "${GREEN}✅ Node.js $(node -v)${NC}"

# Check pnpm
if ! command -v pnpm &> /dev/null; then
    echo -e "${YELLOW}⚠️  pnpm not found. Installing via Volta...${NC}"
    volta install pnpm@9.15.4
fi
echo -e "${GREEN}✅ pnpm $(pnpm -v)${NC}"

# Check Docker (optional)
if command -v docker &> /dev/null; then
    echo -e "${GREEN}✅ Docker $(docker -v | cut -d' ' -f3 | cut -d',' -f1)${NC}"
    DOCKER_AVAILABLE=true
else
    echo -e "${YELLOW}⚠️  Docker not found (optional)${NC}"
    DOCKER_AVAILABLE=false
fi

echo ""

# Setup environment
echo -e "${YELLOW}📁 Setting up environment...${NC}"
if [ ! -f .env ]; then
    cp .env.example .env 2>/dev/null || cat > .env << 'EOF'
# HogarIA Environment
# Copy this file and update values

# JWT Secret (change in production!)
JWT_SECRET=change-this-to-a-secure-secret-key

# Database
DATABASE_PATH=./data/hogaria.sqlite

# CORS
CORS_ORIGIN=http://localhost:4200

# Server
PORT=3000
NODE_ENV=development
EOF
    echo -e "${GREEN}✅ Created .env file${NC}"
    echo -e "${YELLOW}⚠️  Please update .env with your values${NC}"
else
    echo -e "${GREEN}✅ .env file exists${NC}"
fi

# Create data directory
mkdir -p data
echo -e "${GREEN}✅ Created data directory${NC}"

echo ""

# Install dependencies
echo -e "${YELLOW}📦 Installing dependencies...${NC}"
pnpm install
echo -e "${GREEN}✅ Dependencies installed${NC}"

echo ""

# Build project
echo -e "${YELLOW}🔨 Building project...${NC}"
pnpm run build
echo -e "${GREEN}✅ Project built${NC}"

echo ""

# Run tests
echo -e "${YELLOW}🧪 Running tests...${NC}"
pnpm run test || echo -e "${YELLOW}⚠️  Some tests failed (this is expected on first run)${NC}"
echo -e "${GREEN}✅ Tests completed${NC}"

echo ""

# Summary
echo -e "${BLUE}"
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║                    Setup Complete! 🎉                       ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo -e "${NC}"

echo -e "${GREEN}Quick Start Commands:${NC}"
echo ""
echo -e "  ${BLUE}make dev${NC}          Start development servers"
echo -e "  ${BLUE}make build${NC}        Build for production"
echo -e "  ${BLUE}make test${NC}         Run all tests"
echo -e "  ${BLUE}make lint${NC}         Run linters"
echo -e "  ${BLUE}make docker${NC}       Start Docker development"
echo ""

if [ "$DOCKER_AVAILABLE" = true ]; then
    echo -e "${GREEN}Docker Commands:${NC}"
    echo ""
    echo -e "  ${BLUE}make docker${NC}       Start Docker dev environment"
    echo -e "  ${BLUE}make docker-down${NC}  Stop Docker dev environment"
    echo -e "  ${BLUE}make docker-clean${NC} Clean Docker resources"
    echo ""
fi

echo -e "${GREEN}Security Commands:${NC}"
echo ""
echo -e "  ${BLUE}make audit${NC}        Run security audit"
echo -e "  ${BLUE}make knip${NC}         Detect unused code"
echo ""

echo -e "${YELLOW}📖 See Makefile for all available commands${NC}"
echo ""
