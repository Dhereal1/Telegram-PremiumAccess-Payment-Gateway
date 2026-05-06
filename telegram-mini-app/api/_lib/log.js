import pino from 'pino';

export function getLogger() {
  return pino({
    level: process.env.LOG_LEVEL || 'info',
    base: undefined,
    redact: {
      paths: ['req.headers.authorization', 'req.headers.cookie', '*.BOT_TOKEN', '*.DATABASE_URL', 'DATABASE_URL', 'BOT_TOKEN'],
      remove: true,
    },
  });
}

