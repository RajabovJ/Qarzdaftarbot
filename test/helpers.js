import crypto from 'node:crypto';
import { loadConfig } from '../src/config.js';
import { createApp } from '../src/server.js';
import { TelegramError } from '../src/telegram.js';

export const BOT_TOKEN = '123456:TEST-TOKEN';

/** Telegram'ning haqiqiy algoritmi bo'yicha imzolangan initData yasaydi. */
export function signInitData(user, { token = BOT_TOKEN, authDate = Math.floor(Date.now() / 1000), extra = {} } = {}) {
  const params = { auth_date: String(authDate), query_id: 'AAH-test', user: JSON.stringify(user), ...extra };
  const dcs = Object.entries(params)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
  const hash = crypto.createHmac('sha256', secret).update(dcs).digest('hex');
  return new URLSearchParams({ ...params, hash }).toString();
}

export function fakeTelegram() {
  const calls = [];
  const fail = new Set(); // chat_id lar: 403 qaytaradi
  const tg = {
    enabled: true,
    calls,
    fail,
    async call(method, payload) {
      calls.push({ method, payload });
      return true;
    },
    async sendMessage(chatId, text, extra = {}) {
      if (fail.has(chatId)) throw new TelegramError('sendMessage', 403, 'Forbidden: bot was blocked by the user');
      calls.push({ method: 'sendMessage', chatId, text, extra });
      return { message_id: calls.length };
    },
    async sendDocument(chatId, filename, content, caption) {
      if (fail.has(chatId)) throw new TelegramError('sendDocument', 403, 'Forbidden: bot was blocked by the user');
      calls.push({ method: 'sendDocument', chatId, filename, content, caption });
      return { message_id: calls.length };
    },
    setWebhook: async (url, secret) => calls.push({ method: 'setWebhook', url, secret }),
    deleteWebhook: async () => calls.push({ method: 'deleteWebhook' }),
    getUpdates: async () => [],
  };
  return tg;
}

export async function startTestApp(overrides = {}) {
  const config = loadConfig({
    NODE_ENV: 'test',
    PORT: '0',
    HOST: '127.0.0.1',
    BOT_TOKEN,
    WEBAPP_URL: 'https://example.test',
    ADMIN_USERNAME: 'boss',
    ADMIN_PASSWORD: 'correct horse battery',
    SESSION_SECRET: 'test-secret-test-secret',
    DB_PATH: ':memory:',
    ...overrides,
  });
  const tg = fakeTelegram();
  const app = createApp(config, { tg });
  const port = await app.start();
  const base = `http://127.0.0.1:${port}`;

  /** Mini-ilova foydalanuvchisi sifatida so'rov yuboruvchi funksiya */
  function client(user) {
    const initData = signInitData(user);
    return async (method, path, body) => {
      const res = await fetch(base + path, {
        method,
        headers: { authorization: `tma ${initData}`, ...(body ? { 'content-type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json().catch(() => null);
      return { status: res.status, data, res };
    };
  }

  /** Admin sifatida kirgan so'rov yuboruvchi funksiya */
  async function adminClient(username = 'boss', password = 'correct horse battery') {
    const login = await fetch(`${base}/admin/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-requested-with': 'qarzdaftar' },
      body: JSON.stringify({ username, password }),
    });
    const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];
    const call = async (method, path, body) => {
      const res = await fetch(base + path, {
        method,
        headers: { cookie, 'x-requested-with': 'qarzdaftar', ...(body ? { 'content-type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      return { status: res.status, data: await res.json().catch(() => null) };
    };
    call.loginStatus = login.status;
    call.cookie = cookie;
    return call;
  }

  return { app, tg, base, config, client, adminClient, close: () => app.close() };
}

export const USER_A = { id: 1001, first_name: 'Anvar', last_name: 'Karimov', username: 'anvar_shop' };
export const USER_B = { id: 1002, first_name: 'Dilnoza' };
