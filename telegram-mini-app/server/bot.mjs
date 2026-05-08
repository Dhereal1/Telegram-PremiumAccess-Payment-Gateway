import crypto from 'node:crypto'
import fetch from 'node-fetch'
import { Telegraf } from 'telegraf'
import { getLogger } from './lib/log.js'
import { getPool } from './lib/db.js'
import { getAdminByTelegramId, createGroupIfNotExists, upsertAdminWallet } from './lib/groups.js'
import { deleteOnboardingSession, getOnboardingSession, upsertOnboardingSession } from './lib/onboarding-sessions.js'
import { normalizeTonAddress } from './lib/toncenter.js'

const log = getLogger()

function normalizeWebAppUrl(webAppUrl) {
  const u = String(webAppUrl || '').trim()
  if (!/^https:\/\//i.test(u)) throw new Error('Missing WEB_APP_URL (must be https://...)')
  return u.replace(/\/+$/, '')
}

function makeMiniAppGroupUrl(webAppUrl, groupId) {
  return `${normalizeWebAppUrl(webAppUrl)}/?g=${encodeURIComponent(String(groupId))}`
}

function makeBotDeepLink({ botUsername, groupId }) {
  return `https://t.me/${botUsername}?start=${encodeURIComponent(`g_${String(groupId)}`)}`
}

function parsePositiveNumber(text) {
  const n = Number(String(text || '').trim())
  if (!Number.isFinite(n) || n <= 0) return null
  return n
}

function parsePositiveInt(text) {
  const n = Number(String(text || '').trim())
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.floor(n)
}

async function isUserChatAdmin({ botToken, chatId, userId }) {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/getChatMember`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, user_id: Number(userId) }),
  })
  const data = await res.json().catch(() => null)
  if (!data?.ok) return { ok: false, reason: data?.description || 'Telegram API error' }
  const status = data?.result?.status
  const isAdmin = status === 'administrator' || status === 'creator'
  return isAdmin ? { ok: true } : { ok: false, reason: `Not admin (status=${status})` }
}

function setupCallbackData(chatId) {
  return `onboard_setup:${String(chatId)}`
}

function parseSetupCallbackData(data) {
  const s = String(data || '')
  if (!s.startsWith('onboard_setup:')) return null
  return s.slice('onboard_setup:'.length)
}

function startPayloadForChat(chatId) {
  return `onboard_${String(chatId)}`
}

function parseStartPayload(payload) {
  const p = String(payload || '')
  if (!p.startsWith('onboard_')) return null
  return p.slice('onboard_'.length)
}

function parseGroupPayload(payload) {
  const p = String(payload || '')
  const m = p.match(/^g_([0-9a-fA-F-]{36})$/)
  return m ? m[1] : null
}

async function safeDmOrGroupNotice({ ctx, botUsername, adminId, chatId }) {
  try {
    await ctx.telegram.sendMessage(adminId, '👋 You added me to a group.\n\nLet’s set up your premium subscription.\n\nClick below to begin.', {
      reply_markup: {
        inline_keyboard: [[{ text: '⚙️ Setup Group', callback_data: setupCallbackData(chatId) }]],
      },
    })
    return { ok: true }
  } catch (e) {
    log.warn({ adminId, chatId, err: String(e?.message || e) }, 'onboarding_dm_failed')
    const url = `https://t.me/${botUsername}?start=${encodeURIComponent(startPayloadForChat(chatId))}`
    try {
      await ctx.telegram.sendMessage(chatId, `👋 Admin setup required.\n\nPlease DM me first, then tap:\n${url}`)
    } catch (e2) {
      log.warn({ adminId, chatId, err: String(e2?.message || e2) }, 'onboarding_group_notice_failed')
    }
    return { ok: false }
  }
}

export function createBot({ botToken, webAppUrl }) {
  const normalizedWebAppUrl = normalizeWebAppUrl(webAppUrl)
  const bot = new Telegraf(botToken)

  // Ensure botInfo is populated even when using webhooks (no .launch()).
  bot.telegram.getMe().then((me) => { bot.botInfo = me }).catch(() => {})

  async function getBotUsername() {
    if (process.env.BOT_USERNAME) return String(process.env.BOT_USERNAME).replace(/^@/, '')
    const fromInfo = bot.botInfo?.username
    if (fromInfo) return String(fromInfo)
    try {
      const me = await bot.telegram.getMe()
      bot.botInfo = me
      return String(me.username)
    } catch {
      return null
    }
  }

  bot.start(async (ctx) => {
    const payload = ctx.startPayload

    // User deep-link flow: start=g_<groupId>
    const groupIdFromPayload = parseGroupPayload(payload)
    if (groupIdFromPayload) {
      const pool = getPool()
      const r = await pool.query(
        `SELECT id, name, price_ton, duration_days
         FROM groups
         WHERE id=$1 AND is_active=TRUE`,
        [String(groupIdFromPayload)],
      )
      const group = r.rows[0] || null
      if (!group) {
        await ctx.reply('This group is no longer available.')
        return
      }

      const miniAppUrl = makeMiniAppGroupUrl(normalizedWebAppUrl, group.id)
      await ctx.reply(
        `Welcome to ${group.name}!\n\nSubscription: ${Number(group.price_ton)} TON / ${Number(group.duration_days)} days\n\nTap the button below to subscribe and get instant access.`,
        {
          reply_markup: {
            inline_keyboard: [[{ text: 'Subscribe Now 🚀', web_app: { url: miniAppUrl } }]],
          },
        },
      )
      return
    }

    const chatIdFromPayload = parseStartPayload(payload)
    if (chatIdFromPayload) {
      const adminId = String(ctx.from?.id || '')
      if (!adminId) return
      const session = await getOnboardingSession({ adminId, telegramChatId: chatIdFromPayload })
      if (session) {
        await ctx.reply('Ready to set up this premium group?', {
          reply_markup: {
            inline_keyboard: [[{ text: '⚙️ Setup Group', callback_data: setupCallbackData(chatIdFromPayload) }]],
          },
        })
        return
      }
    }

    await ctx.reply('Welcome! Launch the app below:', {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: '🚀 Open App',
              web_app: { url: normalizedWebAppUrl },
            },
          ],
        ],
      },
    })
  })

  async function handleBotAdded({ ctx, chatId, adminId }) {
    if (!chatId || !adminId) return
    await upsertOnboardingSession({
      adminId,
      telegramChatId: chatId,
      step: 'awaiting_setup',
      collectedData: {},
    })
    const botUsername = bot.botInfo?.username
    if (botUsername) {
      await safeDmOrGroupNotice({ ctx, botUsername, adminId, chatId })
    } else {
      // If botInfo isn't ready yet, at least try DM without deep link.
      try {
        await ctx.telegram.sendMessage(adminId, '👋 You added me to a group.\n\nLet’s set up your premium subscription.\n\nOpen this chat and press /start to begin.')
      } catch (e) {
        log.warn({ adminId, chatId, err: String(e?.message || e) }, 'onboarding_dm_failed_no_botinfo')
      }
    }
  }

  bot.on('my_chat_member', async (ctx) => {
    const update = ctx.update?.my_chat_member
    const chatId = update?.chat?.id
    const adminId = update?.from?.id
    const botId = update?.new_chat_member?.user?.id
    const isThisBot = botId && bot.botInfo?.id ? Number(botId) === Number(bot.botInfo.id) : false
    if (!isThisBot) return

    const oldStatus = update?.old_chat_member?.status
    const newStatus = update?.new_chat_member?.status
    const added = (oldStatus === 'left' || oldStatus === 'kicked') && (newStatus === 'member' || newStatus === 'administrator')
    if (!added) return

    await handleBotAdded({ ctx, chatId: String(chatId), adminId: String(adminId) })
  })

  bot.on('new_chat_members', async (ctx) => {
    const members = ctx.message?.new_chat_members || []
    const chatId = ctx.chat?.id
    const adminId = ctx.from?.id
    if (!chatId || !adminId) return
    const thisBotId = bot.botInfo?.id
    const wasBotAdded = thisBotId && members.some((m) => Number(m.id) === Number(thisBotId))
    if (!wasBotAdded) return

    await handleBotAdded({ ctx, chatId: String(chatId), adminId: String(adminId) })
  })

  bot.on('callback_query', async (ctx) => {
    const data = ctx.callbackQuery?.data
    const chatId = parseSetupCallbackData(data)
    if (!chatId) return

    const adminId = String(ctx.from?.id || '')
    if (!adminId) return

    const session = await getOnboardingSession({ adminId, telegramChatId: chatId })
    if (!session) {
      await ctx.answerCbQuery('No active setup session found. Add me to your group again.')
      return
    }

    const adminCheck = await isUserChatAdmin({ botToken, chatId, userId: adminId })
    if (!adminCheck.ok) {
      await ctx.answerCbQuery('You must be an admin of that chat to configure it.')
      return
    }

    await upsertOnboardingSession({
      adminId,
      telegramChatId: chatId,
      step: 'awaiting_price',
      collectedData: session.collected_data || {},
    })

    await ctx.answerCbQuery('Setup started')
    await ctx.reply('💰 Enter subscription price in TON (e.g. 0.1):')
  })

  bot.on('text', async (ctx) => {
    const adminId = String(ctx.from?.id || '')
    if (!adminId) return

    const text = String(ctx.message?.text || '').trim()
    if (!text) return

    // Only drive onboarding through private chat messages to avoid leaking config in groups.
    if (ctx.chat?.type !== 'private') return

    // We need the chatId context; use a single active session per admin (latest updated).
    // This keeps the UX simple for now.
    const pool = getPool()
    const r = await pool.query(
      `SELECT * FROM onboarding_sessions WHERE admin_id=$1 ORDER BY updated_at DESC LIMIT 1`,
      [adminId],
    )
    const session = r.rows[0] || null
    if (!session) return

    const telegramChatId = session.telegram_chat_id
    const step = session.step
    const data = session.collected_data || {}

    if (step === 'awaiting_price') {
      const price = parsePositiveNumber(text)
      if (price == null) {
        await ctx.reply('Please enter a valid number (example: 0.1).')
        return
      }
      data.price_ton = price
      await upsertOnboardingSession({ adminId, telegramChatId, step: 'awaiting_duration', collectedData: data })
      await ctx.reply('⏳ Enter duration in days (example: 30):')
      return
    }

    if (step === 'awaiting_duration') {
      const days = parsePositiveInt(text)
      if (days == null) {
        await ctx.reply('Please enter a valid number of days (example: 30).')
        return
      }
      data.duration_days = days
      await upsertOnboardingSession({ adminId, telegramChatId, step: 'awaiting_name', collectedData: data })
      await ctx.reply('📝 Enter a name for this group:')
      return
    }

    if (step === 'awaiting_name') {
      const name = text.slice(0, 120)
      data.name = name

      const admin = await getAdminByTelegramId(adminId)
      if (!admin) {
        await upsertOnboardingSession({ adminId, telegramChatId, step: 'awaiting_wallet', collectedData: data })
        await ctx.reply('💳 Enter your TON payout wallet address (this will be used for all your groups):')
        return
      }

      const groupId = crypto.randomUUID()
      const group = await createGroupIfNotExists({
        id: groupId,
        telegramChatId: telegramChatId,
        adminTelegramId: adminId,
        name,
        priceTon: data.price_ton,
        durationDays: data.duration_days,
      })

      await deleteOnboardingSession({ adminId, telegramChatId })
      const botUsername = await getBotUsername()
      const link = botUsername
        ? makeBotDeepLink({ botUsername, groupId: group.id })
        : makeMiniAppGroupUrl(normalizedWebAppUrl, group.id)
      await ctx.reply(`✅ Your premium group is ready!\n\n🔗 Your subscription link:\n${link}\n\nShare this with your audience to start earning.`)
      return
    }

    if (step === 'awaiting_wallet') {
      const walletRaw = String(text).trim()
      const normalized = normalizeTonAddress(walletRaw)
      if (!normalized) {
        await ctx.reply('That does not look like a valid TON address. Please paste a valid wallet address (starts with EQ…/UQ…).')
        return
      }

      await upsertAdminWallet({ adminTelegramId: adminId, walletAddress: normalized })

      // Create group now that wallet exists
      const groupId = crypto.randomUUID()
      const group = await createGroupIfNotExists({
        id: groupId,
        telegramChatId: telegramChatId,
        adminTelegramId: adminId,
        name: String(data.name || 'Premium Group').slice(0, 120),
        priceTon: Number(data.price_ton || 0.1),
        durationDays: Number(data.duration_days || 30),
      })

      await deleteOnboardingSession({ adminId, telegramChatId })
      const botUsername = await getBotUsername()
      const link = botUsername
        ? makeBotDeepLink({ botUsername, groupId: group.id })
        : makeMiniAppGroupUrl(normalizedWebAppUrl, group.id)
      await ctx.reply(`✅ Your premium group is ready!\n\n🔗 Your subscription link:\n${link}\n\nShare this with your audience to start earning.`)
      return
    }
  })

  bot.catch((err, ctx) => {
    const updateId = ctx?.update?.update_id
    log.error({ updateId, err: String(err?.message || err) }, 'bot_error')
  })

  return bot
}
