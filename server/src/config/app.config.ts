import { z } from 'zod';

const configSchema = z.object({
  server: z.object({
    port: z.number().default(3000),
    env: z.enum(['development', 'production', 'test']).default('development'),
    host: z.string().default('0.0.0.0')
  }),
  database: z.object({
    path: z.string().default('./data/hogaria.sqlite'),
    walMode: z.boolean().default(true),
    cacheSize: z.number().default(-2000) // 2MB in KB (negative)
  }),
  auth: z.object({
    jwtSecret: z.string().default('your-secret-key-change-in-production'),
    jwtExpiresIn: z.string().default('24h'),
    refreshTokenExpiresIn: z.string().default('7d'),
    bcryptRounds: z.number().default(10)
  }),
  cors: z.object({
    origin: z.string().default('http://localhost:4200')
  }),
  // 600 por minuto Y por sesion, no 100 globales cada un cuarto de hora: ver
  // `createApp` para el porque del cambio de clave.
  rateLimit: z.object({
    windowMs: z.number().default(60 * 1000), // 1 minute
    max: z.number().default(600)
  }),
  ai: z.object({
    defaultProvider: z.enum(['openai', 'custom']).default('custom'),
    timeout: z.number().default(30000),
    maxRetries: z.number().default(3)
  }),
  memory: z.object({
    maxHeapSize: z.number().default(256), // MB
    warningThreshold: z.number().default(0.85),
    criticalThreshold: z.number().default(0.95),
    checkInterval: z.number().default(30000) // 30 seconds
  })
});

type Config = z.infer<typeof configSchema>;

function loadConfig(): Config {
  const rawConfig = {
    server: {
      port: parseInt(process.env.PORT || '3000', 10),
      env: process.env.NODE_ENV || 'development',
      host: process.env.HOST || '0.0.0.0'
    },
    database: {
      path: process.env.DATABASE_PATH || './data/hogaria.sqlite',
      walMode: process.env.DB_WAL_MODE !== 'false',
      cacheSize: parseInt(process.env.DB_CACHE_SIZE || '-2000', 10)
    },
    auth: {
      jwtSecret: process.env.JWT_SECRET || 'dev-secret-key-change-in-production',
      jwtExpiresIn: process.env.JWT_EXPIRES_IN || '24h',
      refreshTokenExpiresIn: process.env.REFRESH_TOKEN_EXPIRES_IN || '7d',
      bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS || '10', 10)
    },
    cors: {
      origin: process.env.CORS_ORIGIN || 'http://localhost:4200'
    },
    rateLimit: {
      windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || String(60 * 1000), 10),
      max: parseInt(process.env.RATE_LIMIT_MAX || '600', 10)
    },
    ai: {
      defaultProvider: process.env.AI_DEFAULT_PROVIDER || 'custom',
      timeout: parseInt(process.env.AI_TIMEOUT || '30000', 10),
      maxRetries: parseInt(process.env.AI_MAX_RETRIES || '3', 10)
    },
    memory: {
      maxHeapSize: parseInt(process.env.MAX_HEAP_SIZE || '256', 10),
      warningThreshold: parseFloat(process.env.MEMORY_WARNING_THRESHOLD || '0.85'),
      criticalThreshold: parseFloat(process.env.MEMORY_CRITICAL_THRESHOLD || '0.95'),
      checkInterval: parseInt(process.env.MEMORY_CHECK_INTERVAL || '30000', 10)
    }
  };

  return configSchema.parse(rawConfig);
}

export const config = loadConfig();
