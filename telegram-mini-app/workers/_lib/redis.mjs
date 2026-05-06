import IORedis from 'ioredis';
import { getWorkerEnv } from './worker-env.mjs';

let connection;

export function getRedis() {
  if (connection) return connection;
  const env = getWorkerEnv();
  connection = new IORedis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
  return connection;
}

