require('dotenv').config({path:'./.env', override:true});
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
pool.query(`
  TRUNCATE TABLE 
    subscription_events,
    memberships,
    payments,
    payment_intents,
    earnings,
    fraud_logs,
    failed_jobs,
    blockchain_cursors,
    onboarding_sessions,
    groups,
    admins,
    users
  RESTART IDENTITY CASCADE
`).then(() => { console.log('All test data cleared'); pool.end(); }).catch(e => { console.error(e.message); pool.end(); });
