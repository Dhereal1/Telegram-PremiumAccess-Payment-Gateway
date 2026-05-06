import pino from 'pino';

export function getWorkerLogger() {
  return pino({
    level: process.env.LOG_LEVEL || 'info',
    base: undefined,
    redact: {
      paths: ['*.BOT_TOKEN', '*.DATABASE_URL', 'DATABASE_URL', 'BOT_TOKEN', 'REDIS_URL'],
      remove: true,
    },
  });
}

