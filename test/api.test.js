import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { USER_A, USER_B, signInitData, startTestApp } from './helpers.js';
import { verifyInitData } from '../src/telegram.js';
import { addDays, todayStr } from '../src/util.js';
import { buildCsv } from '../src/api.js';

let t;
before(async () => {
  t = await startTestApp();
});
after(() => t.close());

describe('initData tekshiruvi', () => {
  test("to'g'ri imzo qabul qilinadi", () => {
    const v = verifyInitData(signInitData(USER_A), 'BOT', 100);
    assert.equal(v, null, "boshqa token bilan rad etilishi kerak");
    const ok = verifyInitData(signInitData(USER_A, { token: 'BOT' }), 'BOT', 100);
    assert.equal(ok.user.id, USER_A.id);
  });

  test('o\'zgartirilgan ma\'lumot rad etiladi', () => {
    const data = signInitData(USER_A, { token: 'BOT' }).replace('Anvar', 'Hacker');
    assert.equal(verifyInitData(data, 'BOT', 100), null);
  });

  test('eskirgan auth_date rad etiladi', () => {
    const old = Math.floor(Date.now() / 1000) - 3 * 86400;
    assert.equal(verifyInitData(signInitData(USER_A, { token: 'BOT', authDate: old }), 'BOT', 86400), null);
  });

  test('hash yo\'q yoki noto\'g\'ri', () => {
    assert.equal(verifyInitData('user=%7B%7D&auth_date=1', 'BOT'), null);
    assert.equal(verifyInitData('', 'BOT'), null);
    assert.equal(verifyInitData('hash=zzz', 'BOT'), null);
  });
});

describe('autentifikatsiya', () => {
  test('imzosiz so\'rov 401', async () => {
    const res = await fetch(`${t.base}/api/me`);
    assert.equal(res.status, 401);
  });

  test("soxta imzo 401", async () => {
    const bad = signInitData(USER_A, { token: 'boshqa:token' });
    const res = await fetch(`${t.base}/api/me`, { headers: { authorization: `tma ${bad}` } });
    assert.equal(res.status, 401);
  });

  test('x-dev-user DEV_MODE o\'chiq bo\'lganda ishlamaydi', async () => {
    const res = await fetch(`${t.base}/api/me`, { headers: { 'x-dev-user': '5' } });
    assert.equal(res.status, 401);
  });

  test("birinchi so'rovda foydalanuvchi yaratiladi", async () => {
    const api = t.client(USER_A);
    const { status, data } = await api('GET', '/api/me');
    assert.equal(status, 200);
    assert.equal(data.user.telegram_id, USER_A.id);
    assert.equal(data.user.today, todayStr(t.config.tz));
  });
});

describe('mijozlar va yozuvlar', () => {
  test('qarz va to\'lov hisobi', async () => {
    const api = t.client(USER_A);
    const c = await api('POST', '/api/customers', { name: 'Rustam aka', phone: '+998 90 123 45 67' });
    assert.equal(c.status, 200);
    const id = c.data.customer.id;
    assert.equal(c.data.customer.balance, 0);

    let r = await api('POST', `/api/customers/${id}/transactions`, { type: 'debt', amount: '1 500 000', note: 'Un, yog\'' });
    assert.equal(r.data.customer.balance, 1500000);
    r = await api('POST', `/api/customers/${id}/transactions`, { type: 'payment', amount: 500000 });
    assert.equal(r.data.customer.balance, 1000000);
    assert.equal(r.data.transactions.length, 2);

    const s = await api('GET', '/api/summary');
    assert.equal(s.data.total_debt, 1000000);
    assert.equal(s.data.debtors_count, 1);
    assert.equal(s.data.today_totals.given, 1500000);
    assert.equal(s.data.today_totals.received, 500000);
  });

  test("muddati o'tgan qarz FIFO bo'yicha hisoblanadi", async () => {
    const api = t.client(USER_A);
    const today = todayStr(t.config.tz);
    const c = await api('POST', '/api/customers', { name: 'Nodira' });
    const id = c.data.customer.id;

    // 1-qarz: 100 000, muddati o'tgan; 2-qarz: 200 000, muddati kelajakda
    await api('POST', `/api/customers/${id}/transactions`, {
      type: 'debt', amount: 100000, date: addDays(today, -20), due_date: addDays(today, -5),
    });
    await api('POST', `/api/customers/${id}/transactions`, {
      type: 'debt', amount: 200000, date: addDays(today, -10), due_date: addDays(today, 10),
    });
    let r = await api('GET', `/api/customers/${id}`);
    assert.equal(r.data.customer.balance, 300000);
    assert.equal(r.data.customer.overdue_amount, 100000);

    // 60 000 to'lov eng eski qarzdan ayriladi
    r = await api('POST', `/api/customers/${id}/transactions`, { type: 'payment', amount: 60000 });
    assert.equal(r.data.customer.overdue_amount, 40000);

    // 40 000 to'lasa, muddati o'tgan qarz qolmaydi
    r = await api('POST', `/api/customers/${id}/transactions`, { type: 'payment', amount: 40000 });
    assert.equal(r.data.customer.overdue_amount, 0);
    assert.equal(r.data.customer.balance, 200000);
    assert.equal(r.data.customer.next_due, addDays(today, 10));
  });

  test("ortiqcha to'lov manfiy qoldiq (avans) beradi, jami qarzga kirmaydi", async () => {
    const api = t.client(USER_B);
    const c = await api('POST', '/api/customers', { name: 'Avansli mijoz' });
    const id = c.data.customer.id;
    const r = await api('POST', `/api/customers/${id}/transactions`, { type: 'payment', amount: 70000 });
    assert.equal(r.data.customer.balance, -70000);
    const s = await api('GET', '/api/summary');
    assert.equal(s.data.total_debt, 0);
  });

  test('qidiruv va filtrlar', async () => {
    const api = t.client(USER_A);
    let r = await api('GET', '/api/customers?q=rust');
    assert.deepEqual(r.data.customers.map((c) => c.name), ['Rustam aka']);
    r = await api('GET', '/api/customers?q=12');
    assert.equal(r.data.customers.length, 0, "telefon bo'yicha qidiruv kamida 3 raqam talab qiladi");
    r = await api('GET', '/api/customers?q=123 45');
    assert.equal(r.data.customers.length, 1, "bo'shliqli raqamlar ham topiladi");
    r = await api('GET', '/api/customers?q=90123');
    assert.equal(r.data.customers.length, 1);
    r = await api('GET', '/api/customers?filter=overdue');
    assert.ok(r.data.customers.every((c) => c.overdue_amount > 0));
    r = await api('GET', '/api/customers?filter=debtors');
    assert.ok(r.data.customers.every((c) => c.balance > 0));
  });

  test('tekshiruvlar', async () => {
    const api = t.client(USER_A);
    const c = await api('POST', '/api/customers', { name: 'Tekshiruv' });
    const id = c.data.customer.id;
    const today = todayStr(t.config.tz);

    assert.equal((await api('POST', '/api/customers', { name: '   ' })).status, 400);
    assert.equal((await api('POST', '/api/customers', { name: 'x'.repeat(81) })).status, 400);
    assert.equal((await api('POST', '/api/customers', { name: 'A', phone: 'abc' })).status, 400);
    for (const amount of [0, -5, 1.5, 'abc', null, 2e12]) {
      const r = await api('POST', `/api/customers/${id}/transactions`, { type: 'debt', amount });
      assert.equal(r.status, 400, `amount=${amount}`);
    }
    assert.equal((await api('POST', `/api/customers/${id}/transactions`, { type: 'x', amount: 5 })).status, 400);
    assert.equal((await api('POST', `/api/customers/${id}/transactions`, { type: 'debt', amount: 5, date: addDays(today, 1) })).status, 400);
    assert.equal((await api('POST', `/api/customers/${id}/transactions`, { type: 'debt', amount: 5, date: '2026-13-40' })).status, 400);
    assert.equal((await api('POST', `/api/customers/${id}/transactions`, { type: 'debt', amount: 5, due_date: addDays(today, -3) })).status, 400);
  });

  test('yozuv va mijozni o\'chirish', async () => {
    const api = t.client(USER_A);
    const c = await api('POST', '/api/customers', { name: "O'chiriladigan" });
    const id = c.data.customer.id;
    const r = await api('POST', `/api/customers/${id}/transactions`, { type: 'debt', amount: 1000 });
    const txId = r.data.transactions[0].id;
    const after = await api('DELETE', `/api/transactions/${txId}`);
    assert.equal(after.data.customer.balance, 0);
    assert.equal((await api('DELETE', `/api/customers/${id}`)).status, 200);
    assert.equal((await api('GET', `/api/customers/${id}`)).status, 404);
  });

  test("foydalanuvchilar ma'lumotlari bir-biridan ajratilgan", async () => {
    const a = t.client(USER_A);
    const b = t.client(USER_B);
    const c = await a('POST', '/api/customers', { name: 'Faqat A uchun' });
    const id = c.data.customer.id;
    const tx = await a('POST', `/api/customers/${id}/transactions`, { type: 'debt', amount: 777 });
    const txId = tx.data.transactions[0].id;

    assert.equal((await b('GET', `/api/customers/${id}`)).status, 404);
    assert.equal((await b('PATCH', `/api/customers/${id}`, { name: 'Hack' })).status, 404);
    assert.equal((await b('DELETE', `/api/customers/${id}`)).status, 404);
    assert.equal((await b('POST', `/api/customers/${id}/transactions`, { type: 'debt', amount: 1 })).status, 404);
    assert.equal((await b('DELETE', `/api/transactions/${txId}`)).status, 404);
    const list = await b('GET', '/api/customers');
    assert.ok(!list.data.customers.some((x) => x.id === id));
  });

  test('XSS matni oddiy matn sifatida saqlanadi', async () => {
    const api = t.client(USER_A);
    const r = await api('POST', '/api/customers', { name: '<img src=x onerror=alert(1)>' });
    assert.equal(r.data.customer.name, '<img src=x onerror=alert(1)>');
  });

  test('sozlamalarni yangilash', async () => {
    const api = t.client(USER_A);
    const r = await api('PATCH', '/api/me', { shop_name: 'Baraka market', reminders_enabled: false });
    assert.equal(r.data.user.shop_name, 'Baraka market');
    assert.equal(r.data.user.reminders_enabled, false);
    assert.equal((await api('PATCH', '/api/me', { reminders_enabled: 'ha' })).status, 400);
  });
});

describe('CSV eksport', () => {
  test('formula in\'ektsiyasidan himoya va BOM', () => {
    const csv = buildCsv([
      { name: '=HYPERLINK("x")', phone: '+998901234567', date: '2026-01-01', type: 'debt', amount: 5, note: '@cmd', due_date: null },
    ]);
    assert.ok(csv.startsWith('﻿'));
    assert.ok(csv.includes(`"'=HYPERLINK(""x"")"`));
    assert.ok(csv.includes("'@cmd"));
    assert.ok(csv.includes('+998901234567'));
  });

  test('eksport botga fayl yuboradi', async () => {
    const api = t.client(USER_A);
    const before = t.tg.calls.length;
    const r = await api('POST', '/api/export');
    assert.equal(r.status, 200);
    const doc = t.tg.calls.slice(before).find((c) => c.method === 'sendDocument');
    assert.equal(doc.chatId, USER_A.id);
    assert.match(doc.filename, /^qarz-daftari-\d{4}-\d{2}-\d{2}\.csv$/);
    assert.ok(doc.content.includes('Rustam aka'));
  });

  test('bot bloklangan bo\'lsa tushunarli xato', async () => {
    const api = t.client(USER_B);
    const c = await api('POST', '/api/customers', { name: 'Eksport B' });
    await api('POST', `/api/customers/${c.data.customer.id}/transactions`, { type: 'debt', amount: 10 });
    t.tg.fail.add(USER_B.id);
    const r = await api('POST', '/api/export');
    assert.equal(r.status, 409);
    t.tg.fail.delete(USER_B.id);
  });

  test('eksport tezligi cheklangan', async () => {
    const api = t.client({ id: 7777, first_name: 'Limit' });
    const c = await api('POST', '/api/customers', { name: 'L' });
    await api('POST', `/api/customers/${c.data.customer.id}/transactions`, { type: 'debt', amount: 10 });
    const statuses = [];
    for (let i = 0; i < 5; i++) statuses.push((await api('POST', '/api/export')).status);
    assert.deepEqual(statuses, [200, 200, 200, 429, 429]);
  });
});

describe('HTTP qatlami', () => {
  test('noma\'lum marshrut 404, noto\'g\'ri usul 405', async () => {
    assert.equal((await fetch(`${t.base}/api/yoq`)).status, 404);
    assert.equal((await fetch(`${t.base}/healthz`, { method: 'POST' })).status, 405);
  });

  test('buzuq JSON 400', async () => {
    const api = signInitData(USER_A);
    const res = await fetch(`${t.base}/api/customers`, {
      method: 'POST',
      headers: { authorization: `tma ${api}`, 'content-type': 'application/json' },
      body: '{bad',
    });
    assert.equal(res.status, 400);
  });

  test('juda katta so\'rov 413', async () => {
    const api = signInitData(USER_A);
    const res = await fetch(`${t.base}/api/customers`, {
      method: 'POST',
      headers: { authorization: `tma ${api}`, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'x'.repeat(200_000) }),
    });
    assert.equal(res.status, 413);
  });

  test('statik fayllar va yo\'l o\'tish (path traversal) himoyasi', async () => {
    assert.equal((await fetch(`${t.base}/healthz`)).status, 200);
    const traversal = await fetch(`${t.base}/..%2f..%2fpackage.json`);
    assert.equal(traversal.status, 404);
    const dot = await fetch(`${t.base}/.env`);
    assert.equal(dot.status, 404);
  });
});
