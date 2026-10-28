import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { USER_A, USER_B, startTestApp } from './helpers.js';
import { runReminders } from '../src/reminders.js';
import { addDays, todayStr } from '../src/util.js';

let t;
before(async () => {
  t = await startTestApp();
  // Ikki foydalanuvchi va ma'lumotlar
  const a = t.client(USER_A);
  const b = t.client(USER_B);
  const today = todayStr(t.config.tz);
  const c1 = await a('POST', '/api/customers', { name: 'Muddati o\'tgan mijoz' });
  await a('POST', `/api/customers/${c1.data.customer.id}/transactions`, {
    type: 'debt', amount: 250000, date: addDays(today, -30), due_date: addDays(today, -2),
  });
  const c2 = await b('POST', '/api/customers', { name: 'Boshqa' });
  await b('POST', `/api/customers/${c2.data.customer.id}/transactions`, { type: 'debt', amount: 90000 });
  await b('POST', `/api/customers/${c2.data.customer.id}/transactions`, { type: 'payment', amount: 30000 });
});
after(() => t.close());

describe('admin kirishi', () => {
  test('sessiyasiz admin API 401', async () => {
    const res = await fetch(`${t.base}/admin/api/stats`, { headers: { 'x-requested-with': 'qarzdaftar' } });
    assert.equal(res.status, 401);
  });

  test("noto'g'ri parol 401, cookie yo'q", async () => {
    const adm = await t.adminClient('boss', 'xato');
    assert.equal(adm.loginStatus, 401);
    assert.equal(adm.cookie, '');
  });

  test("to'g'ri parol bilan kirish; cookie HttpOnly va SameSite=Strict", async () => {
    const res = await fetch(`${t.base}/admin/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-requested-with': 'qarzdaftar' },
      body: JSON.stringify({ username: 'boss', password: 'correct horse battery' }),
    });
    assert.equal(res.status, 200);
    const cookie = res.headers.get('set-cookie');
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
    assert.match(cookie, /Path=\/admin/);
  });

  test("CSRF sarlavhasisiz POST rad etiladi", async () => {
    const adm = await t.adminClient();
    const res = await fetch(`${t.base}/admin/api/users/1/block`, {
      method: 'POST',
      headers: { cookie: adm.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ blocked: true }),
    });
    assert.equal(res.status, 403);
  });

  test("soxta cookie rad etiladi", async () => {
    const res = await fetch(`${t.base}/admin/api/stats`, {
      headers: { cookie: 'qd_admin=abc.def', 'x-requested-with': 'qarzdaftar' },
    });
    assert.equal(res.status, 401);
  });

  test('login urinishlari cheklanadi', async () => {
    const t2 = await startTestApp();
    const statuses = [];
    for (let i = 0; i < 12; i++) statuses.push((await t2.adminClient('boss', `x${i}`)).loginStatus);
    assert.equal(statuses[9], 401);
    assert.equal(statuses[10], 429);
    await t2.close();
  });

  test("ADMIN_PASSWORD berilmasa kirib bo'lmaydi", async () => {
    const t2 = await startTestApp({ ADMIN_PASSWORD: '' });
    assert.equal((await t2.adminClient('boss', '')).loginStatus, 503);
    await t2.close();
  });
});

describe('admin statistikasi', () => {
  test('umumiy ko\'rsatkichlar', async () => {
    const adm = await t.adminClient();
    const { status, data } = await adm('GET', '/admin/api/stats');
    assert.equal(status, 200);
    assert.ok(data.users.total >= 2);
    assert.equal(data.users.new_today, data.users.total);
    assert.equal(data.users.active_today, data.users.total);
    assert.equal(data.users.with_customers, 2);
    assert.equal(data.ledger.customers, 2);
    assert.equal(data.ledger.transactions, 3);
    assert.equal(data.ledger.given, 340000);
    assert.equal(data.ledger.received, 30000);
    assert.equal(data.ledger.outstanding, 310000);
    assert.equal(data.series.length, 30);
    assert.equal(data.series.at(-1).signups, data.users.new_today);
  });

  test("foydalanuvchilar ro'yxati, qidiruv va saralash", async () => {
    const adm = await t.adminClient();
    let r = await adm('GET', '/admin/api/users?sort=outstanding');
    assert.equal(r.data.users[0].telegram_id, USER_A.id);
    assert.equal(r.data.users[0].outstanding, 250000);
    assert.equal(r.data.users[0].customers, 1);

    r = await adm('GET', '/admin/api/users?q=dilnoza');
    assert.equal(r.data.total, 1);
    assert.equal(r.data.users[0].telegram_id, USER_B.id);

    r = await adm('GET', `/admin/api/users?q=${USER_A.id}`);
    assert.equal(r.data.total, 1);

    // maxsus belgilar SQL'ni buzmaydi
    r = await adm('GET', `/admin/api/users?q=${encodeURIComponent("%' OR 1=1 --")}`);
    assert.equal(r.status, 200);
    assert.equal(r.data.total, 0);

    // ruxsat etilmagan saralash maydoni e'tiborsiz qoldiriladi
    r = await adm('GET', `/admin/api/users?sort=${encodeURIComponent('id; DROP TABLE users')}`);
    assert.equal(r.status, 200);
  });

  test('bloklash foydalanuvchini API dan chiqaradi', async () => {
    const adm = await t.adminClient();
    const list = await adm('GET', `/admin/api/users?q=${USER_B.id}`);
    const id = list.data.users[0].id;
    assert.equal((await adm('POST', `/admin/api/users/${id}/block`, { blocked: true })).status, 200);

    const b = t.client(USER_B);
    const r = await b('GET', '/api/me');
    assert.equal(r.status, 403);
    assert.equal(r.data.code, 'blocked');

    const blocked = await adm('GET', '/admin/api/users?status=blocked');
    assert.equal(blocked.data.total, 1);

    await adm('POST', `/admin/api/users/${id}/block`, { blocked: false });
    assert.equal((await b('GET', '/api/me')).status, 200);
    assert.equal((await adm('POST', '/admin/api/users/99999/block', { blocked: true })).status, 404);
  });

  test('ommaviy xabar faqat faol foydalanuvchilarga boradi', async () => {
    const adm = await t.adminClient();
    t.tg.fail.add(USER_B.id); // B botni bloklagan
    const before = t.tg.calls.length;
    const r = await adm('POST', '/admin/api/broadcast', { text: 'Yangilik: yangi funksiya!' });
    assert.equal(r.status, 200);
    assert.equal(r.data.total, 2);
    assert.equal((await adm('POST', '/admin/api/broadcast', { text: 'ikkinchi' })).status, 409);

    for (let i = 0; i < 50; i++) {
      const s = await adm('GET', '/admin/api/broadcast');
      if (!s.data.running) {
        assert.equal(s.data.sent, 1);
        assert.equal(s.data.failed, 1);
        break;
      }
      await new Promise((res) => setTimeout(res, 40));
    }
    const sent = t.tg.calls.slice(before).filter((c) => c.method === 'sendMessage');
    assert.equal(sent.length, 1);
    assert.equal(sent[0].chatId, USER_A.id);

    // B endi "bot_stopped" deb belgilangan: keyingi safar yuborilmaydi
    const stats = await adm('GET', '/admin/api/stats');
    assert.equal(stats.data.users.bot_stopped, 1);
    t.tg.fail.delete(USER_B.id);
  });

  test("bo'sh xabar rad etiladi", async () => {
    const adm = await t.adminClient();
    assert.equal((await adm('POST', '/admin/api/broadcast', { text: '   ' })).status, 400);
  });
});

describe('bot', () => {
  const post = (secret, body) =>
    fetch(`${t.base}/telegram/webhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(secret ? { 'x-telegram-bot-api-secret-token': secret } : {}) },
      body: JSON.stringify(body),
    });
  const wait = () => new Promise((r) => setTimeout(r, 50));

  test('webhook maxfiy kalitsiz rad etiladi', async () => {
    assert.equal((await post(null, { update_id: 1 })).status, 403);
    assert.equal((await post('xato', { update_id: 1 })).status, 403);
  });

  test("/start Mini App tugmasi bilan javob beradi va foydalanuvchini yaratadi", async () => {
    const before = t.tg.calls.length;
    const res = await post(t.config.webhookSecret, {
      update_id: 2,
      message: { chat: { id: 555, type: 'private' }, from: { id: 555, first_name: 'Sardor_*' }, text: '/start' },
    });
    assert.equal(res.status, 200);
    await wait();
    const msg = t.tg.calls.slice(before).find((c) => c.method === 'sendMessage');
    assert.equal(msg.chatId, 555);
    assert.equal(msg.extra.reply_markup.inline_keyboard[0][0].web_app.url, 'https://example.test');
    assert.ok(msg.text.includes('Sardor\\_\\*'), 'Markdown belgilari ekranlangan bo\'lishi kerak');
    assert.equal(t.app.db.prepare('SELECT COUNT(*) AS n FROM users WHERE telegram_id = 555').get().n, 1);
  });

  test('/stat qisqa hisobot beradi', async () => {
    const before = t.tg.calls.length;
    await post(t.config.webhookSecret, {
      update_id: 3,
      message: { chat: { id: USER_A.id, type: 'private' }, from: { id: USER_A.id, first_name: 'A' }, text: '/stat' },
    });
    await wait();
    const msg = t.tg.calls.slice(before).find((c) => c.method === 'sendMessage');
    assert.match(msg.text, /Jami qarzdorlik/);
    assert.match(msg.text, /Muddati o'tgan: 1 ta/);
  });

  test('guruh xabarlari e\'tiborsiz qoldiriladi', async () => {
    const before = t.tg.calls.length;
    await post(t.config.webhookSecret, {
      update_id: 4,
      message: { chat: { id: -100, type: 'group' }, from: { id: 9, first_name: 'G' }, text: '/start' },
    });
    await wait();
    assert.equal(t.tg.calls.length, before);
  });

  test('bot bloklanganda my_chat_member belgilaydi', async () => {
    await post(t.config.webhookSecret, {
      update_id: 5,
      my_chat_member: { chat: { id: 555, type: 'private' }, from: { id: 555 }, new_chat_member: { status: 'kicked' } },
    });
    await wait();
    assert.equal(t.app.db.prepare('SELECT bot_stopped FROM users WHERE telegram_id = 555').get().bot_stopped, 1);
    await post(t.config.webhookSecret, {
      update_id: 6,
      my_chat_member: { chat: { id: 555, type: 'private' }, from: { id: 555 }, new_chat_member: { status: 'member' } },
    });
    await wait();
    assert.equal(t.app.db.prepare('SELECT bot_stopped FROM users WHERE telegram_id = 555').get().bot_stopped, 0);
  });

  test('setup webhook va menyu tugmasini o\'rnatadi', async () => {
    const before = t.tg.calls.length;
    const r = await t.app.bot.setup();
    assert.equal(r.mode, 'webhook');
    const calls = t.tg.calls.slice(before);
    assert.ok(calls.some((c) => c.method === 'setMyCommands'));
    assert.ok(calls.some((c) => c.method === 'setChatMenuButton'));
    const hook = calls.find((c) => c.method === 'setWebhook');
    assert.equal(hook.url, 'https://example.test/telegram/webhook');
    assert.equal(hook.secret, t.config.webhookSecret);
  });
});

describe('eslatmalar', () => {
  const at = (hour) => new Date(`${todayStr(t.config.tz)}T${String(hour - 5).padStart(2, '0')}:30:00Z`); // Toshkent = UTC+5

  test('ertalabki soatgacha yuborilmaydi', async () => {
    const r = await runReminders({ db: t.app.db, tg: t.tg, config: t.config, now: at(8), delayMs: 0 });
    assert.equal(r.skipped, 'too-early');
  });

  test("muddati o'tgan qarzi borga kuniga bir marta yuboriladi", async () => {
    const before = t.tg.calls.length;
    const r = await runReminders({ db: t.app.db, tg: t.tg, config: t.config, now: at(10), delayMs: 0 });
    assert.equal(r.sent, 1);
    const msg = t.tg.calls.slice(before).find((c) => c.method === 'sendMessage');
    assert.equal(msg.chatId, USER_A.id);
    assert.match(msg.text, /Muddati o'tgan mijoz/);

    const again = await runReminders({ db: t.app.db, tg: t.tg, config: t.config, now: at(11), delayMs: 0 });
    assert.equal(again.skipped, 'already-done');
  });

  test("o'chirib qo'yilgan eslatma yuborilmaydi", async () => {
    t.app.db.prepare("DELETE FROM kv WHERE key = 'last_reminder_day'").run();
    await t.client(USER_A)('PATCH', '/api/me', { reminders_enabled: false });
    const r = await runReminders({ db: t.app.db, tg: t.tg, config: t.config, now: at(12), delayMs: 0 });
    assert.equal(r.sent, 0);
  });
});
