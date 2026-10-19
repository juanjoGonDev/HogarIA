# =============================================================================
# Makefile - HogarIA Development Commands
# =============================================================================
# Usage: make <command>

.PHONY: help install dev build test lint clean docker docker-down docker-clean ci-yaml ci-ui ci-e2e-types

# Default target
help: ## Show this help message
	@echo "HogarIA - Development Commands"
	@echo "================================"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

# =============================================================================
# Setup & Installation
# =============================================================================

install: ## Install all dependencies
	pnpm install

install-fresh: ## Clean install (delete node_modules first)
	rm -rf node_modules frontend/node_modules server/node_modules
	pnpm install

# =============================================================================
# Development
# =============================================================================

dev: ## Start development servers (frontend + backend)
	pnpm run dev

dev-frontend: ## Start frontend dev server only
	pnpm run dev:client

dev-server: ## Start backend dev server only
	pnpm run dev:server

# =============================================================================
# Build
# =============================================================================

build: ## Build for production
	pnpm run build

build-frontend: ## Build frontend only
	pnpm run build:client

build-server: ## Build backend only
	pnpm run build:server

# =============================================================================
# Testing
# =============================================================================

test: ## Run all tests
	pnpm run test

test-frontend: ## Run frontend tests
	pnpm run test:client

test-e2e-full-stack: ## E2E contra el proyecto entero (build + node sirviendo API y web, con limites)
	pnpm run test:e2e-full-stack

test-server: ## Run backend tests
	pnpm run test:server

test-e2e: ## Run E2E tests
	pnpm run test:e2e

test-coverage: ## Run tests with coverage
	pnpm run test:coverage

# =============================================================================
# Linting & Formatting
# =============================================================================

ci-yaml: ## Revisa los YAML de Actions: comillas, tabs y contextos que GitHub no tiene
	@node scripts/check-workflows.mjs

ci-ui: ## Guarda de UI: sin emoji, sin select nativo, sin data-test inventados
	@node scripts/check-ui.mjs

ci-e2e-types: ## Type-check de la suite e2e (Playwright no lo hace por su cuenta)
	pnpm run typecheck:e2e

lint: ## Run all linters
	pnpm run lint

lint-fix: ## Fix all lint issues
	pnpm run lint:fix

format: ## Format code with Prettier
	pnpm run format

# =============================================================================
# Code Quality
# =============================================================================

knip: ## Run Knip (unused code detection)
	pnpm run knip

knip-fix: ## Fix unused code issues
	pnpm run knip:fix

audit: ## Run security audit
	pnpm run audit

audit-fix: ## Fix security vulnerabilities
	pnpm run audit:fix

# =============================================================================
# Docker Development
# =============================================================================

docker: ## Start Docker development environment
	docker compose -f docker-compose.dev.yml up --build

docker-down: ## Stop Docker development environment
	docker compose -f docker-compose.dev.yml down

docker-clean: ## Stop and remove all Docker resources
	docker compose -f docker-compose.dev.yml down -v --rmi local

docker-logs: ## View Docker logs
	docker compose -f docker-compose.dev.yml logs -f

docker-frontend: ## View frontend logs
	docker compose -f docker-compose.dev.yml logs -f frontend

docker-server: ## View server logs
	docker compose -f docker-compose.dev.yml logs -f server

# =============================================================================
# Docker Production
# =============================================================================

docker-prod: ## Build and run production Docker
	docker compose up --build -d

docker-prod-down: ## Stop production Docker
	docker compose down

docker-prod-logs: ## View production logs
	docker compose logs -f

# =============================================================================
# Database
# =============================================================================

db-migrate: ## Run database migrations
	pnpm --filter @hogaria/server run migrate

db-studio: ## Open Drizzle Studio
	pnpm --filter @hogaria/server exec drizzle-kit studio

# =============================================================================
# Cleanup
# =============================================================================

clean: ## Clean all build artifacts and dependencies
	pnpm run clean

clean-docker: ## Clean Docker resources
	docker system prune -f
	docker volume prune -f

# =============================================================================
# CI/CD Simulation
# =============================================================================

ci: ## Simulate CI pipeline locally
	@echo "🔍 Running lint..."
	pnpm run lint
	@echo "🧪 Running tests..."
	pnpm run test
	@echo "📦 Building..."
	pnpm run build
	@echo "🔎 Running Knip..."
	pnpm run knip
	@echo "🔒 Running audit..."
	pnpm run audit
	@echo "✅ All checks passed!"

# =============================================================================
# Quick Commands
# =============================================================================

start: build ## Build and start production server
	pnpm run start

restart: clean install build ## Full restart (clean, install, build)
	pnpm run start

# =============================================================================
# Environment Setup
# =============================================================================

env-setup: ## Setup environment files
	@if [ ! -f .env ]; then \
		echo "Creating .env file..."; \
		echo "# HogarIA Environment" > .env; \
		echo "# Copy this file and update values" >> .env; \
		echo "" >> .env; \
		echo "# JWT Secret (change in production!)" >> .env; \
		echo "JWT_SECRET=change-this-to-a-secure-secret-key" >> .env; \
		echo "" >> .env; \
		echo "# Database" >> .env; \
		echo "DATABASE_PATH=./data/hogaria.sqlite" >> .env; \
		echo "" >> .env; \
		echo "# CORS" >> .env; \
		echo "CORS_ORIGIN=http://localhost:4200" >> .env; \
		echo "" >> .env; \
		echo "✅ .env file created. Please update the values."; \
	else \
		echo "⚠️  .env file already exists."; \
	fi

# =============================================================================
# Version Management
# =============================================================================

version: ## Show current version
	@echo "HogarIA v$(shell node -p "require('./package.json').version")"

version-patch: ## Bump patch version
	npm version patch --no-git-tag-version
	@echo "Version bumped to $(shell node -p "require('./package.json').version")"

version-minor: ## Bump minor version
	npm version minor --no-git-tag-version
	@echo "Version bumped to $(shell node -p "require('./package.json').version")"

version-major: ## Bump major version
	npm version major --no-git-tag-version
	@echo "Version bumped to $(shell node -p "require('./package.json').version")"
