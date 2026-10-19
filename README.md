# 🏠 HogarIA

Cocina, compra y hogar en un solo sitio: despensa, planificador semanal con IA, lista de la compra
con precios e histórico, tickets leídos con OCR y (pronto) tareas del hogar, calendario compartido e
integración con Home Assistant. Optimizado para correr en tu propia máquina (Raspberry Pi 5).

> **Nombres anteriores:** el proyecto nació como *RecipeApp* y se llamaba *MiCocinAI*. El código ya no:
> los paquetes son `@hogaria/web` y `@hogaria/server`, el proyecto de Angular es `hogaria`, la base de
> datos es `data/hogaria.sqlite` y la marca visible es HogarIA. Quedan dos huellas deliberadas: el nombre
> del repositorio de GitHub y el prefijo `recipeapp_` de `localStorage`, que es la clave bajo la que las
> instalaciones ya desplegadas guardaron su sesión (se migra en `main.ts`, no se renombra).

## ✨ Features

- **Pantry Management** - Track ingredients, expiration dates, utensils
- **AI Recipe Generation** - Generate recipes from available ingredients
- **Weekly Meal Planning** - Plan your week with nutritional goals
- **Household Sharing** - Multiple users with preferences and allergies
- **Cooking Mode** - Step-by-step instructions with timers
- **PWA Support** - Works offline on mobile devices

## 🛠️ Tech Stack

- **Frontend:** Angular 19+ with standalone components
- **Backend:** Hono (ultra-lightweight)
- **Database:** SQLite with Drizzle ORM
- **AI:** OpenAI-compatible API (custom or OpenAI)
- **Design:** Minimalist UI with warm color palette

## 📋 Prerequisites

- Node.js 18+ 
- npm or yarn

## 🚀 Quick Start

### Option 1: Development Mode

```bash
# Install dependencies
npm install

# Start development servers
npm run dev
```

Frontend: http://localhost:4200  
Backend: http://localhost:3000

### Option 2: Production on Raspberry Pi

```bash
# Build everything
npm run build

# Start with the optimized script
chmod +x scripts/start.sh
./scripts/start.sh
```

### Option 3: Docker (uses more memory)

```bash
# Build and run
docker-compose up -d

# View logs
docker-compose logs -f
```

## 📁 Project Structure

```
hogaria/
├── frontend/          # Angular application
│   ├── src/
│   │   ├── app/
│   │   │   ├── core/          # Services, guards, interceptors
│   │   │   ├── shared/        # Reusable components, models
│   │   │   ├── features/      # Feature modules (lazy-loaded)
│   │   │   └── layouts/       # App layouts
│   │   ├── assets/
│   │   └── environments/
│   └── ...
├── server/            # Hono backend
│   ├── src/
│   │   ├── config/    # App & database config
│   │   ├── middleware/ # Auth, error handling
│   │   ├── routes/    # API routes
│   │   ├── schemas/   # Zod validation schemas
│   │   └── utils/     # Helpers
│   └── ...
├── nginx/             # Nginx config
├── scripts/           # Utility scripts
└── data/              # SQLite database (created at runtime)
```

## 🧪 Testing

```bash
# Run all tests
npm test

# Frontend tests with coverage
npm run test:client:coverage

# Backend tests with coverage
npm run test:server:coverage

# E2E tests
npm run test:e2e

# Lint
npm run lint

# Check for unused code
npm run knip
```

## 🎨 Design System

See [DESIGN-SYSTEM.md](./DESIGN-SYSTEM.md) for the complete design specification.

**Color Palette:**
- Primary: Orange (#F97316)
- Secondary: Green (#22C55E)
- Neutral: Warm Grays

**Typography:**
- Display: Plus Jakarta Sans
- Body: Inter
- Code: JetBrains Mono

## ⚡ Memory Optimization (Raspberry Pi)

The app is optimized for systems with limited RAM:

| Setting | Value |
|---------|-------|
| Node.js heap | 256MB max |
| SQLite mode | WAL |
| Cache | 30 items, 3min TTL |
| Connection pool | 3 max |
| Request body | 512KB max |

**Recommended:** Run directly on RPi without Docker (saves 50-100MB RAM).

## 📚 API Documentation

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login
- `POST /api/auth/refresh` - Refresh token

### Pantry
- `GET /api/pantry/ingredients` - List ingredients
- `POST /api/pantry/ingredients` - Add ingredient
- `PATCH /api/pantry/ingredients/:id` - Update ingredient
- `DELETE /api/pantry/ingredients/:id` - Delete ingredient
- `GET /api/pantry/utensils` - List utensils

### Recipes
- `GET /api/recipes` - List recipes
- `GET /api/recipes/:id` - Get recipe
- `POST /api/recipes` - Create recipe
- `PATCH /api/recipes/:id` - Update recipe
- `POST /api/recipes/:id/favorite` - Toggle favorite
- `POST /api/recipes/:id/cook` - Record cooking

### AI
- `GET /api/ai/configs` - List AI configs
- `POST /api/ai/configs` - Create AI config
- `POST /api/ai/test-connection` - Test AI connection
- `POST /api/ai/generate-recipe` - Generate recipe with AI
- `POST /api/ai/recommendations` - Get recommendations
- `POST /api/ai/plan-week` - Generate weekly plan

### Calendar
- `GET /api/calendar` - Get current week
- `POST /api/calendar` - Create calendar
- `POST /api/calendar/meals` - Add meal
- `PATCH /api/calendar/meals/:id` - Update meal

### Household
- `GET /api/household` - Get household
- `POST /api/household` - Create household
- `POST /api/household/join` - Join household

## 📄 License

MIT

---

Made with ❤️ for home cooking
