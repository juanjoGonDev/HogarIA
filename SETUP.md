# 🚀 Quick Setup Guide

## First Time Setup

```bash
# Run the setup script
./scripts/setup.sh
```

This will:

- Check Node.js version
- Install all dependencies
- Create `.env` file with secure JWT secret
- Create necessary directories

`pnpm install` also installs the repository's pinned Lefthook Git hooks. Before commits they format staged source/config/docs and run `pnpm run check:ui`. Before pushes they format-check files in the pending push, run the UI guard, build, E2E typecheck, and full unit suite with `DATABASE_PATH=:memory:`. Existing Angular/server lint and Knip commands currently fail because their configurations are incomplete, so the hooks do not invoke or claim those checks. The real AI smoke remains opt-in and is not run by Git hooks.

## Development

```bash
# Start both frontend and backend
npm run dev

# Or start them separately
npm run dev:client   # Frontend only (port 4200)
npm run dev:server   # Backend only (port 3000)
```

## Production (Raspberry Pi)

### Option A: Direct Execution (Recommended - Less Memory)

```bash
# Build the app
./scripts/build.sh

# Start the app
./scripts/start.sh
```

### Option B: Docker

```bash
# Build and start
docker-compose up -d

# View logs
docker-compose logs -f

# Stop
docker-compose down
```

## Testing

```bash
# Run all tests
npm test

# Frontend tests
npm run test:client

# Backend tests
npm run test:server

# E2E tests
npm run test:e2e

# Check code quality
npm run lint
npm run knip
```

## Database

The SQLite database is created automatically at `./data/hogaria.sqlite`.
Installations that still have `./data/recipeapp.db` (or the older `./data/mi-cocinai.db`) are adopted on
startup: the file — together with its `-wal`/`-shm` siblings — is renamed before it is opened, and an
existing `hogaria.sqlite` is never overwritten.

To reset the database:

```bash
rm -rf data/*.db
npm run dev
```

## Environment Variables

| Variable        | Default               | Description                                             |
| --------------- | --------------------- | ------------------------------------------------------- |
| `NODE_ENV`      | development           | Environment mode                                        |
| `PORT`          | 3000                  | Server port                                             |
| `DATABASE_PATH` | ./data/hogaria.sqlite | SQLite database path (legacy `recipeapp.db` is adopted) |
| `JWT_SECRET`    | (generated)           | Secret for JWT tokens                                   |
| `CORS_ORIGIN`   | http://localhost:4200 | Allowed CORS origin                                     |

## Troubleshooting

### Port already in use

```bash
# Find process using port 3000
lsof -i :3000

# Kill the process
kill -9 <PID>
```

### Database locked

```bash
# Stop all instances and delete WAL files
rm data/*.db-wal data/*.db-shm
```

### Memory issues on RPi

```bash
# Check memory usage
free -h

# Monitor app memory
curl http://localhost:3000/health
```
