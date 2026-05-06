import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { getEnv } from './env.js';

let connection;

function getConnection() {
  if (connection) return connection;
  const env = getEnv();
  connection = new IORedis(env.REDIS_URL, {
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

