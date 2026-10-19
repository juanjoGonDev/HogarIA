# 🔒 Security Configuration - HogarIA

This document describes the security measures implemented in HogarIA.

## Table of Contents

- [Supply Chain Security](#supply-chain-security)
- [pnpm Configuration](#pnpm-configuration)
- [Dependabot](#dependabot)
- [CI/CD Security](#cicd-security)
- [Docker Security](#docker-security)
- [Best Practices](#best-practices)

---

## Supply Chain Security

### Version Pinning

All dependencies use **exact versions** (no `^` or `~`):

```json
// ❌ Before (vulnerable to supply chain attacks)
"@angular/core": "^19.0.0"

// ✅ After (exact version)
"@angular/core": "19.2.25"
```

### Why Exact Versions?

1. **Reproducibility**: Same version everywhere (dev, CI, production)
2. **Security**: No automatic updates that could introduce vulnerabilities
3. **Auditability**: Easy to track what's deployed
4. **Stability**: No unexpected breaking changes

### Volta (Node.js Version Manager)

We use [Volta](https://volta.sh/) instead of nvm for cross-platform version management:

```json
// package.json
"volta": {
  "node": "20.18.1",
  "pnpm": "12.4.1"
}
```

**Why Volta?**
- Works on Windows, macOS, and Linux
- No shell configuration needed
- Automatically uses correct versions per project
- Faster than nvm

---

## pnpm Configuration

### `.npmrc` Security Settings

```ini
# Never run install scripts (prevents malicious code execution)
ignore-scripts=true

# Strict peer dependency checking
strict-peer-dependencies=true
auto-install-peers=false

# Strict lockfile (fail if out of sync)
lockfile-strict=true

# Use official registry only
registry=https://registry.npmjs.org/

# Verify package integrity
verify-store-integrity=true

# Audit level
audit-level=moderate
```

### Key Security Features

| Setting | Purpose |
|---------|---------|
| `ignore-scripts=true` | Prevents malicious install scripts from running |
| `strict-peer-dependencies=true` | Catches dependency conflicts early |
| `lockfile-strict=true` | Ensures lockfile is always in sync |
| `verify-store-integrity=true` | Verifies package integrity |
| `audit-level=moderate` | Fails on moderate+ vulnerabilities |

### Running with Scripts (When Needed)

Some packages require install scripts (e.g., `better-sqlite3`). To run them:

```bash
# Option 1: Allow scripts for specific packages
pnpm install --config.ignore-scripts=false

# Option 2: Use .pnpmfile.cjs (recommended)
# Create .pnpmfile.cjs with allowlist
```

---

## Dependabot

### Configuration

Dependabot is configured in `.github/dependabot.yml`:

- **GitHub Actions**: Weekly updates (Monday)
- **Root dependencies**: Weekly updates (Monday)
- **Frontend dependencies**: Weekly updates (Tuesday)
- **Backend dependencies**: Weekly updates (Wednesday)
- **Docker images**: Weekly updates (Thursday)

### Auto-Merge Rules

| Update Type | Action |
|-------------|--------|
| Patch (1.0.x) | Auto-approve + auto-merge |
| Minor (1.x.0) | Auto-approve + auto-merge |
| Major (x.0.0) | Comment + request manual review |

### Grouped Updates

Dependencies are grouped to reduce PR noise:

- **Angular**: All `@angular/*` packages
- **TypeScript ESLint**: All `@typescript-eslint/*` packages
- **Testing**: Karma, Jasmine, Vitest
- **Database**: Drizzle, better-sqlite3
- **Hono**: Hono and `@hono/*` packages

---

## CI/CD Security

### GitHub Actions Workflow

```yaml
# .github/workflows/ci.yml
jobs:
  lint:
    - Run ESLint
    - Run TypeScript type checking

  test-frontend:
    - Run Angular tests

  test-server:
    - Run Vitest tests

  build:
    - Build frontend
    - Build server
    needs: [lint, test-frontend, test-server]

  knip:
    - Detect unused code

  audit:
    - Run security audit
    - Fail on moderate+ vulnerabilities

  docker:
    - Build Docker image
    needs: [build]
```

### Security Checks

1. **Lint**: Catches code quality issues
2. **Tests**: Ensures functionality works
3. **Build**: Verifies compilation
4. **Knip**: Detects unused code (reduces attack surface)
5. **Audit**: Checks for known vulnerabilities
6. **Docker**: Verifies container builds

---

## Docker Security

### Production Dockerfile

```dockerfile
# Use specific Node.js version
FROM node:20.18.1-alpine

# Run as non-root user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nextjs -u 1001
USER nextjs

# Health checks
HEALTHCHECK --interval=15s --timeout=5s \
  CMD curl -f http://localhost:3000/health || exit 1

# Resource limits
ENV NODE_OPTIONS=--max-old-space-size=256
```

### Docker Compose Security

```yaml
deploy:
  resources:
    limits:
      cpus: '1.0'
      memory: 384M
    reservations:
      cpus: '0.25'
      memory: 96M
```

---

## Best Practices

### 1. Regular Audits

```bash
# Run security audit
pnpm audit

# Fix vulnerabilities
pnpm audit fix
```

### 2. Lockfile Management

```bash
# Always commit lockfile
git add pnpm-lock.yaml

# Verify lockfile integrity
pnpm install --frozen-lockfile
```

### 3. Environment Variables

```bash
# Never commit .env files
echo ".env" >> .gitignore

# Use .env.example for documentation
cp .env .env.example
# Remove sensitive values from .env.example
```

### 4. Secrets Management

```bash
# Use GitHub Secrets for CI/CD
# Settings > Secrets and variables > Actions

# Required secrets:
# - PAT_FINE (Personal Access Token for Dependabot auto-merge)
# - NPM_TOKEN (for private packages)
# - DOCKER_HUB_USERNAME
# - DOCKER_HUB_TOKEN
```

> **Note:** The Dependabot auto-merge workflow uses `PAT_FINE` instead of `GITHUB_TOKEN` because Dependabot PRs require elevated permissions that the default token cannot provide.

### 5. Dependency Review

Before merging Dependabot PRs:

1. Check CHANGELOG for breaking changes
2. Review security advisories
3. Run tests locally
4. Verify no suspicious code changes

---

## Security Checklist

- [ ] All dependencies use exact versions
- [ ] `.npmrc` has `ignore-scripts=true`
- [ ] Lockfile is committed and up-to-date
- [ ] Dependabot is configured
- [ ] CI runs security audit
- [ ] Docker uses specific image versions
- [ ] No secrets in code or commits
- [ ] Environment variables documented
- [ ] Health checks configured
- [ ] Resource limits set

---

## Incident Response

If a security vulnerability is discovered:

1. **Assess**: Determine severity and impact
2. **Update**: Update affected dependencies
3. **Test**: Run full test suite
4. **Deploy**: Deploy fix immediately
5. **Document**: Update SECURITY.md

---

## Resources

- [pnpm Security](https://pnpm.io/cli/install#--ignore-scripts)
- [npm Security Best Practices](https://docs.npmjs.com/packages-and-modules/securing-your-code)
- [GitHub Dependabot](https://docs.github.com/en/code-security/dependabot)
- [Docker Security](https://docs.docker.com/develop/security-best-practices/)
