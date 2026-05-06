import { Telegraf } from 'telegraf';
import { readJson } from '../_lib/http.js';

const BOT_TOKEN = process.env.BOT_TOKEN;
const WEB_APP_URL = process.env.WEB_APP_URL;

if (!BOT_TOKEN) {
  throw new Error('Missing BOT_TOKEN env var');
}
if (!WEB_APP_URL) {
  throw new Error('Missing WEB_APP_URL env var (must be HTTPS and publicly reachable)');
}

const bot = new Telegraf(BOT_TOKEN);

bot.start(async (ctx) => {
  await ctx.reply('Welcome! Launch the app below:', {
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: '🚀 Open App',
            web_app: { url: WEB_APP_URL },
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

export default async function handler(req, res) {
  if (req.method === 'GET') return res.status(200).send('OK');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const update = req.body && typeof req.body === 'object' ? req.body : await readJson(req);
    await bot.handleUpdate(update);
    return res.status(200).send('OK');
  } catch (e) {
    console.error('Webhook handler failed:', e);
    return res.status(500).json({ error: 'Webhook handler failed' });
  }
}
