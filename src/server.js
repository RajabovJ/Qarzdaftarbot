import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerAdmin } from './admin.js';
import { registerApi } from './api.js';
import { createBot } from './bot.js';
import { openDb } from './db.js';
import { Router, createRequestHandler, createStaticHandler, safeEqual } from './http.js';
import { startReminderScheduler } from './reminders.js';
import { createTelegram } from './telegram.js';
import { HttpError, log } from './util.js';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

/**
 * Butun ilovani yig'adi. Testlarda `deps` orqali baza va Telegram mijozini almashtirish mumkin.
 */
export function createApp(config, deps = {}) {
  const db = deps.db ?? openDb(config.dbPath);
  const tg =
    deps.tg ??
    createTelegram({ token: config.botToken, apiBase: config.telegramApiBase });
  const bot = createBot({ tg, db, config });
  const router = new Router();

  router.get('/healthz', () => {
    db.prepare('SELECT 1').get();
    return { ok: true };
  });

  router.post('/telegram/webhook', async (ctx) => {
    const given = ctx.req.headers['x-telegram-bot-api-secret-token'] ?? '';
    if (!config.webhookSecret || !safeEqual(given, config.webhookSecret)) {
      throw new HttpError(403, 'Ruxsat yo\'q');
    }
    // Telegramga tez javob beramiz, ishlov fon rejimida
    bot.handleUpdate(ctx.body).catch((e) => log('error', `Webhook update xatosi: ${e.message}`));
    return { ok: true };
  });

  registerApi(router, { db, tg, config });
  registerAdmin(router, { db, tg, config });

  const securityHeaders = (req) => {
    const isAdmin = req.url?.startsWith('/admin');
    const common = {
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'permissions-policy': 'camera=(), microphone=(), geolocation=()',
    };
    if (isAdmin) {
      return {
        ...common,
        'x-frame-options': 'DENY',
        'content-security-policy':
          "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      };
    }
    // Mini-ilova Telegram ichida iframe/webview sifatida ochiladi, shuning uchun frame-ancestors cheklanmaydi
    return {
      ...common,
      'content-security-policy':
        "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' https://telegram.org; connect-src 'self'; base-uri 'none'",
    };
  };

  const server = http.createServer(
    createRequestHandler({
      router,
      serveStatic: createStaticHandler(PUBLIC_DIR),
      trustProxy: config.trustProxy,
      securityHeaders,
    }),
  );
  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;

  let stopScheduler = () => {};

  return {
    server,
    db,
    tg,
    bot,
    config,
    async start() {
      await new Promise((resolve) => server.listen(config.port, config.host, resolve));
      stopScheduler = startReminderScheduler({ db, tg, config });
      return server.address().port;
    },
    async close() {
      stopScheduler();
      bot.stop();
      await new Promise((resolve) => server.close(resolve));
      server.closeAllConnections?.();
      db.close();
    },
  };
}
