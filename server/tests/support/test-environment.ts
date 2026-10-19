// Set this before test modules load: static imports may load app.config/database
// before a spec's top-level `process.env` assignment is evaluated.
process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = ':memory:';

const { config } = await import('../../src/config/app.config.js');
if (config.database.path !== ':memory:') {
  throw new Error('Vitest must never initialize the application database.');
}
