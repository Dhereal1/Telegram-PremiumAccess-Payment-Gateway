require('dotenv').config();
const { Telegraf } = require('telegraf');

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

function assertHttpsUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`WEB_APP_URL must be a valid URL. Received: ${url}`);
  }
  if (parsed.protocol !== 'https:') {
    throw new Error(`WEB_APP_URL must be HTTPS. Received: ${url}`);
  }
}

const BOT_TOKEN = requireEnv('BOT_TOKEN');
const WEB_APP_URL = requireEnv('WEB_APP_URL');
assertHttpsUrl(WEB_APP_URL);

const bot = new Telegraf(BOT_TOKEN);

bot.start(async (ctx) => {
  await ctx.reply('Welcome! Launch the app below:', {
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: '🚀 Open App',
            web_app: {
              url: WEB_APP_URL,
            },
          },
        ],
      ],
    },
  });
});

bot.catch((err, ctx) => {
  const updateId = ctx?.update?.update_id;
  console.error('Bot error', { updateId, err });
});

bot
  .launch()
  .then(() => console.log('Bot is running...'))
  .catch((err) => {
    console.error('Failed to launch bot:', err);
    process.exitCode = 1;
  });

function shutdown(signal) {
  console.log(`Received ${signal}. Shutting down...`);
  bot.stop(signal);
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));

