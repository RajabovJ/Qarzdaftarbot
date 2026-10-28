import crypto from 'node:crypto';

const bool = (v, def = false) =>
  v === undefined || v === '' ? def : ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());

/**
 * Muhit o'zgaruvchilaridan sozlamalarni yig'adi va tekshiradi.
 * Production rejimida xavfsizlik uchun muhim qiymatlar majburiy.
 */
export function loadConfig(env = process.env) {
  const nodeEnv = env.NODE_ENV || 'development';
  const production = nodeEnv === 'production';

  const config = {
    nodeEnv,
    production,
    port: env.PORT === undefined || env.PORT === '' ? 3000 : Number(env.PORT),
    host: env.HOST || '0.0.0.0',
    trustProxy: bool(env.TRUST_PROXY, false),

    botToken: env.BOT_TOKEN || '',
    webappUrl: (env.WEBAPP_URL || '').replace(/\/+$/, ''),
    webhookSecret: env.WEBHOOK_SECRET || '',
    botMode: env.BOT_MODE || 'webhook', // webhook | polling | off
    telegramApiBase: env.TELEGRAM_API_BASE || 'https://api.telegram.org',
    initDataMaxAge: Number(env.INIT_DATA_MAX_AGE) || 24 * 60 * 60,

    adminUsername: env.ADMIN_USERNAME || 'admin',
    adminPassword: env.ADMIN_PASSWORD || '',
    sessionSecret: env.SESSION_SECRET || '',
    sessionHours: Number(env.SESSION_HOURS) || 12,

    dbPath: env.DB_PATH || 'data/qarzdaftar.sqlite',
    tz: env.TZ_NAME || 'Asia/Tashkent',
    reminderHour: env.REMINDER_HOUR === undefined ? 9 : Number(env.REMINDER_HOUR),

    devMode: bool(env.DEV_MODE, false),
  };

  if (!config.sessionSecret) {
    if (production) throw new Error('SESSION_SECRET majburiy (kamida 16 belgi).');
    config.sessionSecret = crypto.randomBytes(32).toString('hex');
  }

  if (production) {
    const problems = [];
    if (!config.botToken) problems.push('BOT_TOKEN');
    if (!/^https:\/\//.test(config.webappUrl)) problems.push('WEBAPP_URL (https:// bilan)');
    if (config.sessionSecret.length < 16) problems.push('SESSION_SECRET (kamida 16 belgi)');
    if (config.adminPassword.length < 8) problems.push('ADMIN_PASSWORD (kamida 8 belgi)');
    if (config.devMode) problems.push('DEV_MODE production rejimida o\'chiq bo\'lishi kerak');
    if (problems.length) throw new Error(`Production uchun sozlamalar yetarli emas: ${problems.join(', ')}`);
  }

  if (!config.webhookSecret && config.botToken) {
    // Webhook maxfiy kalitini bot tokenidan deterministik tarzda hosil qilamiz.
    config.webhookSecret = crypto
      .createHmac('sha256', 'qarzdaftar-webhook')
      .update(config.botToken)
      .digest('hex')
      .slice(0, 48);
  }

  return config;
}
