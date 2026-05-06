import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { requireRedisUrl } from './env.js';

let connection;

function getConnection() {
  if (connection) return connection;
  const redisUrl = requireRedisUrl();
  connection = new IORedis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
  return connection;
}

export function getQueues() {
  const connection = getConnection();
  return {
    paymentVerificationQueue: new Queue('payment-verification', { connection }),
    accessGrantQueue: new Queue('access-grant', { connection }),
    notificationQueue: new Queue('notification', { connection }),
  };
}
