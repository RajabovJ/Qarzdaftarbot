import { addDays, HttpError, todayStr } from './util.js';

// ---------- Foydalanuvchilar ----------

export function upsertUser(db, tgUser, tz) {
  const today = todayStr(tz);
  let user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(tgUser.id);
  if (!user) {
    const res = db
      .prepare(
        `INSERT INTO users (telegram_id, first_name, last_name, username, language_code, created_day, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
      )
      .run(
        tgUser.id,
        tgUser.first_name ?? null,
        tgUser.last_name ?? null,
        tgUser.username ?? null,
        tgUser.language_code ?? null,
        today,
      );
    user = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(res.lastInsertRowid));
  } else {
    const changed =
      user.first_name !== (tgUser.first_name ?? null) ||
      user.last_name !== (tgUser.last_name ?? null) ||
      user.username !== (tgUser.username ?? null);
    const stale = !user.last_seen_at || Date.now() - Date.parse(`${user.last_seen_at.replace(' ', 'T')}Z`) > 5 * 60 * 1000;
    if (changed || stale) {
      db.prepare(
        `UPDATE users SET first_name = ?, last_name = ?, username = ?, language_code = COALESCE(?, language_code),
         last_seen_at = datetime('now') WHERE id = ?`,
      ).run(tgUser.first_name ?? null, tgUser.last_name ?? null, tgUser.username ?? null, tgUser.language_code ?? null, user.id);
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
    }
  }
  db.prepare('INSERT OR IGNORE INTO activity (user_id, day) VALUES (?, ?)').run(user.id, today);
  return user;
}

export function publicUser(user, tz) {
  return {
    id: user.id,
    telegram_id: user.telegram_id,
    first_name: user.first_name,
    last_name: user.last_name,
    username: user.username,
    shop_name: user.shop_name,
    reminders_enabled: !!user.reminders_enabled,
    today: todayStr(tz),
  };
}

// ---------- Hisob-kitob ----------

/**
 * Har bir mijoz uchun qoldiq (balans) va muddati o'tgan qarzni hisoblaydi.
 * To'lovlar eng eski qarzdan boshlab yopiladi (FIFO).
 */
export function computeStates(db, userId, today) {
  const customers = db
    .prepare('SELECT id, name, phone, note, created_at FROM customers WHERE user_id = ? ORDER BY name COLLATE NOCASE')
    .all(userId);
  const txs = db
    .prepare('SELECT customer_id, type, amount, date, due_date FROM transactions WHERE user_id = ? ORDER BY customer_id, date, id')
    .all(userId);

  const byCustomer = new Map();
  for (const t of txs) {
    if (!byCustomer.has(t.customer_id)) byCustomer.set(t.customer_id, []);
    byCustomer.get(t.customer_id).push(t);
  }

  return customers.map((c) => {
    const list = byCustomer.get(c.id) ?? [];
    let paid = 0;
    let debtTotal = 0;
    let lastDate = null;
    for (const t of list) {
      if (t.type === 'payment') paid += t.amount;
      else debtTotal += t.amount;
      if (!lastDate || t.date > lastDate) lastDate = t.date;
    }
    let remainingPaid = paid;
    let overdue = 0;
    let nextDue = null;
    for (const t of list) {
      if (t.type !== 'debt') continue;
      const applied = Math.min(remainingPaid, t.amount);
      remainingPaid -= applied;
      const unpaid = t.amount - applied;
      if (unpaid > 0 && t.due_date) {
        if (t.due_date < today) overdue += unpaid;
        if (!nextDue || t.due_date < nextDue) nextDue = t.due_date;
      }
    }
    return {
      id: c.id,
      name: c.name,
      phone: c.phone,
      note: c.note,
      created_at: c.created_at,
      balance: debtTotal - paid,
      overdue_amount: overdue,
      next_due: nextDue,
      last_date: lastDate,
      tx_count: list.length,
    };
  });
}

export function getSummary(db, userId, tz) {
  const today = todayStr(tz);
  const states = computeStates(db, userId, today);

  let totalDebt = 0;
  let debtors = 0;
  let overdueAmount = 0;
  let overdueCount = 0;
  for (const s of states) {
    if (s.balance > 0) {
      totalDebt += s.balance;
      debtors += 1;
    }
    if (s.overdue_amount > 0) {
      overdueAmount += s.overdue_amount;
      overdueCount += 1;
    }
  }

  const monthStart = `${today.slice(0, 8)}01`;
  const from = addDays(today, -13);
  const rows = db
    .prepare(
      `SELECT date, type, SUM(amount) AS total FROM transactions
       WHERE user_id = ? AND date >= ? AND date <= ? GROUP BY date, type`,
    )
    .all(userId, from < monthStart ? from : monthStart, today);

  const sums = (pred) => {
    const r = { given: 0, received: 0 };
    for (const row of rows) {
      if (!pred(row.date)) continue;
      if (row.type === 'debt') r.given += row.total;
      else r.received += row.total;
    }
    return r;
  };

  const series = [];
  for (let i = 13; i >= 0; i--) {
    const day = addDays(today, -i);
    const r = sums((d) => d === day);
    series.push({ date: day, given: r.given, received: r.received });
  }

  const topDebtors = states
    .filter((s) => s.balance > 0)
    .sort((a, b) => b.balance - a.balance)
    .slice(0, 5)
    .map((s) => ({ id: s.id, name: s.name, balance: s.balance, overdue_amount: s.overdue_amount }));

  return {
    today,
    total_debt: totalDebt,
    customers_count: states.length,
    debtors_count: debtors,
    overdue_amount: overdueAmount,
    overdue_count: overdueCount,
    today_totals: sums((d) => d === today),
    month_totals: sums((d) => d >= monthStart),
    series,
    top_debtors: topDebtors,
  };
}

export function listCustomers(db, userId, tz, { q = '', filter = 'all' } = {}) {
  const today = todayStr(tz);
  let list = computeStates(db, userId, today);
  const needle = q.trim().toLowerCase();
  if (needle) {
    const digits = needle.replace(/\D/g, '');
    list = list.filter(
      (c) =>
        c.name.toLowerCase().includes(needle) ||
        (digits.length >= 3 && (c.phone ?? '').replace(/\D/g, '').includes(digits)),
    );
  }
  if (filter === 'debtors') list = list.filter((c) => c.balance > 0);
  else if (filter === 'overdue') list = list.filter((c) => c.overdue_amount > 0);

  // Avval muddati o'tganlar, keyin qarzi katta, keyin ism bo'yicha
  list.sort((a, b) => {
    if ((b.overdue_amount > 0) !== (a.overdue_amount > 0)) return b.overdue_amount > 0 ? 1 : -1;
    if (b.balance !== a.balance) return b.balance - a.balance;
    return a.name.localeCompare(b.name, 'uz');
  });
  return list;
}

export function getCustomerOrThrow(db, userId, customerId) {
  const c = db.prepare('SELECT * FROM customers WHERE id = ? AND user_id = ?').get(customerId, userId);
  if (!c) throw new HttpError(404, 'Mijoz topilmadi');
  return c;
}

export function getCustomerDetail(db, userId, customerId, tz) {
  getCustomerOrThrow(db, userId, customerId);
  const today = todayStr(tz);
  const state = computeStates(db, userId, today).find((s) => s.id === customerId);
  const transactions = db
    .prepare(
      `SELECT id, type, amount, note, date, due_date, created_at FROM transactions
       WHERE customer_id = ? AND user_id = ? ORDER BY date DESC, id DESC`,
    )
    .all(customerId, userId);
  return { customer: state, transactions };
}
