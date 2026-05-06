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
    paymentVerificationQueue: new Queue('payment_verification_queue', { connection }),
    accessGrantQueue: new Queue('access_grant_queue', { connection }),
    notificationQueue: new Queue('notification_queue', { connection }),
  };
}
