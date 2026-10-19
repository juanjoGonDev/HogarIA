# 🚀 Cómo Ejecutar HogarIA

## Instalación Rápida

```bash
# 1. Entrar al directorio
cd MiCocinAI            # el repo; el producto se llama HogarIA

# 2. Ejecutar setup (instala dependencias, configura entorno)
./setup.sh

# 3. Iniciar en modo desarrollo
make dev
```

## Desarrollo

### Opción 1: Desarrollo Local

```bash
# Instalar dependencias
pnpm install

# Iniciar desarrollo (frontend + backend)
make dev

# O por separado:
make dev-frontend   # Solo frontend
make dev-server     # Solo backend
```

**URLs:**
- Frontend: http://localhost:4200
- Backend API: http://localhost:3000
- Health Check: http://localhost:3000/health

### Opción 2: Desarrollo con Docker

```bash
# Iniciar entorno Docker (frontend + backend + drizzle studio)
make docker

# Ver logs
make docker-logs

# Parar entorno
make docker-down

# Limpiar todo (volúmenes incluidos)
make docker-clean
```

**URLs Docker:**
- Frontend: http://localhost:4200
- Backend API: http://localhost:3000
- Drizzle Studio: http://localhost:4983

## Producción

### Docker Compose (Recomendado para Raspberry Pi)

```bash
# Build y ejecutar producción
make docker-prod

# Ver logs
make docker-prod-logs

# Parar
make docker-prod-down
```

### Manual

```bash
# Build optimizado
make build

# Ejecutar
make start
```

### La suite de stack completo (la que pilla lo que las otras no ven)

`npm run dev` levanta dos servidores y **apaga el limitador de peticiones**: es la
configuracion correcta para 381 tests que comparten IP, y tambien la razon por la que el
«Demasiadas solicitudes» que bloqueaba toda la casa —navegacion y visor de logs— nunca se
vio en CI. Hay un segundo trabajo que si lo ejercita: compila el frontend, arranca **un
unico proceso node** (el mismo `CMD` del contenedor, que ahora sirve API *y* web) con el
limitador encendido, y comprueba el presupuesto de peticiones, el SSE del visor de logs y
el contrato del 429.

```bash
pnpm run build                      # server/dist + frontend/dist/browser
npx playwright test -c playwright.full-stack.config.ts
# o, haciendo las dos cosas:
pnpm run test:e2e:full-stack
```

Se puede puntear a mano igual que lo hace el job:

```bash
PORT=3100 NODE_ENV=production node server/dist/index.js
curl -N localhost:3100/api/logs/stream     # ": connected" y lineas en vivo
curl -i localhost:3100/shopping/una-lista  # index.html, no un 404
```

## Testing & Quality

```bash
# Todos los tests
make test

# Tests específicos
make test-frontend    # Tests Angular
make test-server      # Tests Vitest
make test-e2e         # Tests E2E Playwright
make test-coverage    # Con cobertura

# Linting
make lint             # Verificar
make lint-fix         # Auto-arreglar

# Formateo
make format           # Prettier

# Código no usado
make knip             # Detectar
make knip-fix         # Auto-arreglar

# Seguridad
make audit            # Auditoría
make audit-fix        # Auto-arreglar

# Simular CI localmente
make ci
```

## Comandos Disponibles

```bash
make help             # Ver todos los comandos
```

| Comando | Descripción |
|---------|-------------|
| `make install` | Instalar dependencias |
| `make install-fresh` | Instalación limpia |
| `make dev` | Desarrollo local |
| `make docker` | Desarrollo Docker |
| `make build` | Build producción |
| `make test` | Todos los tests |
| `make lint` | Linters |
| `make knip` | Código no usado |
| `make audit` | Auditoría seguridad |
| `make clean` | Limpiar artefactos |
| `make ci` | Simular CI |

## Credenciales de prueba

Para probar el login, primero registra un usuario en:
http://localhost:4200/auth/register

---

**Stack:** Angular 19 + Hono + SQLite + Drizzle ORM
**Package Manager:** pnpm 12.x (con seguridad máxima)
**Container:** Docker + Docker Compose
