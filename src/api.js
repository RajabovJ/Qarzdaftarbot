import { rateLimiter } from './http.js';
import {
  getCustomerDetail,
  getCustomerOrThrow,
  getSummary,
  listCustomers,
  publicUser,
  upsertUser,
} from './ledger.js';
import { verifyInitData } from './telegram.js';
import {
  HttpError,
  cleanPhone,
  cleanText,
  parseAmount,
  parseDateField,
  parseId,
  todayStr,
} from './util.js';

const FILTERS = new Set(['all', 'debtors', 'overdue']);

function csvCell(value, { text = true } = {}) {
  let s = value === null || value === undefined ? '' : String(value);
  // CSV injection (formula) himoyasi: faqat matnli maydonlar uchun
  if (text && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function buildCsv(rows) {
  const header = ['Mijoz', 'Telefon', 'Sana', 'Turi', 'Summa (so\'m)', 'Izoh', 'Qaytarish muddati'];
  const lines = [header.map((h) => csvCell(h)).join(',')];
  for (const r of rows) {
    lines.push(
      [
        csvCell(r.name),
        csvCell(r.phone, { text: false }),
        csvCell(r.date, { text: false }),
        csvCell(r.type === 'debt' ? 'Qarz berildi' : "To'lov olindi"),
        csvCell(r.amount, { text: false }),
        csvCell(r.note),
        csvCell(r.due_date, { text: false }),
      ].join(','),
    );
  }
  return `﻿${lines.join('\r\n')}\r\n`;
}

export function registerApi(router, { db, tg, config }) {
  const apiLimit = rateLimiter({ windowMs: 60_000, max: 240, key: (ctx) => `ip:${ctx.ip}` });
  const writeLimit = rateLimiter({ windowMs: 60_000, max: 90, key: (ctx) => `w:${ctx.state.user?.id ?? ctx.ip}` });
  const exportLimit = rateLimiter({ windowMs: 10 * 60_000, max: 3, key: (ctx) => `x:${ctx.state.user.id}` });

  /** Telegram initData orqali foydalanuvchini aniqlaydi. */
  function auth(ctx) {
    apiLimit(ctx);
    const header = ctx.req.headers.authorization ?? '';
    let tgUser = null;

    if (header.startsWith('tma ')) {
      const verified = verifyInitData(header.slice(4), config.botToken, config.initDataMaxAge);
      if (!verified) throw new HttpError(401, 'Sessiya yaroqsiz. Ilovani Telegram orqali qayta oching.', 'auth');
      tgUser = verified.user;
    } else if (config.devMode && ctx.req.headers['x-dev-user']) {
      const id = Number(ctx.req.headers['x-dev-user']);
      if (!Number.isSafeInteger(id) || id <= 0) throw new HttpError(401, 'Dev foydalanuvchi noto\'g\'ri', 'auth');
      tgUser = { id, first_name: 'Dev', last_name: String(id) };
    } else {
      throw new HttpError(401, 'Ilovani Telegram orqali oching.', 'auth');
    }

    const user = upsertUser(db, tgUser, config.tz);
    if (user.is_blocked) throw new HttpError(403, "Akkauntingiz bloklangan. Savollar bo'lsa, administratorga yozing.", 'blocked');
    ctx.state.user = user;
  }

  const user = (ctx) => ctx.state.user;

  router.get('/api/me', auth, (ctx) => ({ user: publicUser(user(ctx), config.tz) }));

  router.patch('/api/me', auth, writeLimit, (ctx) => {
    const u = user(ctx);
    const b = ctx.body;
    const shop = b.shop_name === undefined ? u.shop_name : cleanText(b.shop_name, { max: 60, field: "Do'kon nomi" }) || null;
    let reminders = u.reminders_enabled;
    if (b.reminders_enabled !== undefined) {
      if (typeof b.reminders_enabled !== 'boolean') throw new HttpError(400, 'reminders_enabled true/false bo\'lishi kerak');
      reminders = b.reminders_enabled ? 1 : 0;
    }
    db.prepare('UPDATE users SET shop_name = ?, reminders_enabled = ? WHERE id = ?').run(shop, reminders, u.id);
    return { user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(u.id), config.tz) };
  });

  router.get('/api/summary', auth, (ctx) => getSummary(db, user(ctx).id, config.tz));

  router.get('/api/customers', auth, (ctx) => {
    const filter = FILTERS.has(ctx.query.filter) ? ctx.query.filter : 'all';
    const q = String(ctx.query.q ?? '').slice(0, 60);
    return { customers: listCustomers(db, user(ctx).id, config.tz, { q, filter }) };
  });

  router.post('/api/customers', auth, writeLimit, (ctx) => {
    const u = user(ctx);
    const name = cleanText(ctx.body.name, { max: 80, required: true, field: 'Ism' });
    const phone = cleanPhone(ctx.body.phone);
    const note = cleanText(ctx.body.note, { max: 200, field: 'Izoh' });
    const count = db.prepare('SELECT COUNT(*) AS n FROM customers WHERE user_id = ?').get(u.id).n;
    if (count >= 5000) throw new HttpError(400, 'Mijozlar soni chegarasiga yetdingiz (5000)');
    const res = db
      .prepare('INSERT INTO customers (user_id, name, phone, note) VALUES (?, ?, ?, ?)')
      .run(u.id, name, phone || null, note || null);
    return getCustomerDetail(db, u.id, Number(res.lastInsertRowid), config.tz);
  });

  router.get('/api/customers/:id', auth, (ctx) =>
    getCustomerDetail(db, user(ctx).id, parseId(ctx.params.id), config.tz),
  );

  router.patch('/api/customers/:id', auth, writeLimit, (ctx) => {
    const u = user(ctx);
    const id = parseId(ctx.params.id);
    const c = getCustomerOrThrow(db, u.id, id);
    const b = ctx.body;
    const name = b.name === undefined ? c.name : cleanText(b.name, { max: 80, required: true, field: 'Ism' });
    const phone = b.phone === undefined ? c.phone : cleanPhone(b.phone) || null;
    const note = b.note === undefined ? c.note : cleanText(b.note, { max: 200, field: 'Izoh' }) || null;
    db.prepare('UPDATE customers SET name = ?, phone = ?, note = ? WHERE id = ? AND user_id = ?').run(name, phone, note, id, u.id);
    return getCustomerDetail(db, u.id, id, config.tz);
  });

  router.delete('/api/customers/:id', auth, writeLimit, (ctx) => {
    const u = user(ctx);
    const id = parseId(ctx.params.id);
    getCustomerOrThrow(db, u.id, id);
    db.prepare('DELETE FROM customers WHERE id = ? AND user_id = ?').run(id, u.id);
    return { ok: true };
  });

  router.post('/api/customers/:id/transactions', auth, writeLimit, (ctx) => {
    const u = user(ctx);
    const id = parseId(ctx.params.id);
    getCustomerOrThrow(db, u.id, id);
    const b = ctx.body;

    if (b.type !== 'debt' && b.type !== 'payment') throw new HttpError(400, "Tur 'debt' yoki 'payment' bo'lishi kerak");
    const amount = parseAmount(b.amount);
    const note = cleanText(b.note, { max: 200, field: 'Izoh' });
    const today = todayStr(config.tz);
    const date = parseDateField(b.date, 'Sana') ?? today;
    if (date > today) throw new HttpError(400, "Sana kelajakda bo'lishi mumkin emas");
    const earliest = '2000-01-01';
    if (date < earliest) throw new HttpError(400, 'Sana juda eski');

    let due = null;
    if (b.type === 'debt') {
      due = parseDateField(b.due_date, 'Qaytarish muddati');
      if (due && due < date) throw new HttpError(400, "Qaytarish muddati qarz sanasidan oldin bo'lishi mumkin emas");
      if (due && due > '2100-01-01') throw new HttpError(400, 'Muddat juda uzoq');
    }

    const count = db.prepare('SELECT COUNT(*) AS n FROM transactions WHERE customer_id = ?').get(id).n;
    if (count >= 20000) throw new HttpError(400, 'Bu mijoz uchun yozuvlar chegarasiga yetdingiz');

    db.prepare(
      'INSERT INTO transactions (user_id, customer_id, type, amount, note, date, due_date) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(u.id, id, b.type, amount, note || null, date, due);
    return getCustomerDetail(db, u.id, id, config.tz);
  });

  router.delete('/api/transactions/:id', auth, writeLimit, (ctx) => {
    const u = user(ctx);
    const id = parseId(ctx.params.id);
    const t = db.prepare('SELECT customer_id FROM transactions WHERE id = ? AND user_id = ?').get(id, u.id);
    if (!t) throw new HttpError(404, 'Yozuv topilmadi');
    db.prepare('DELETE FROM transactions WHERE id = ? AND user_id = ?').run(id, u.id);
    return getCustomerDetail(db, u.id, t.customer_id, config.tz);
  });

  /** Barcha yozuvlarni CSV qilib, foydalanuvchining Telegram chatiga yuboradi. */
  router.post('/api/export', auth, exportLimit, async (ctx) => {
    const u = user(ctx);
    if (!tg.enabled) throw new HttpError(503, 'Bot sozlanmagan');
    const rows = db
      .prepare(
        `SELECT c.name, c.phone, t.date, t.type, t.amount, t.note, t.due_date
         FROM transactions t JOIN customers c ON c.id = t.customer_id
         WHERE t.user_id = ? ORDER BY t.date, t.id`,
      )
      .all(u.id);
    if (!rows.length) throw new HttpError(400, "Hali yozuvlar yo'q, eksport qilinadigan narsa yo'q");

    const today = todayStr(config.tz);
    const csv = buildCsv(rows);
    try {
      await tg.sendDocument(
        u.telegram_id,
        `qarz-daftari-${today}.csv`,
        csv,
        `Qarz daftari, ${today}. ${rows.length} ta yozuv.`,
      );
    } catch (err) {
      if (err.userGone) throw new HttpError(409, "Botga yozish uchun avval botda /start bosing, so'ng qayta urinib ko'ring.");
      throw new HttpError(502, "Faylni Telegramga yuborib bo'lmadi. Keyinroq qayta urinib ko'ring.");
    }
    return { ok: true, rows: rows.length };
  });
}
