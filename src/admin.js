import { parseCookies, rateLimiter, safeEqual, signToken, verifyToken } from './http.js';
import { HttpError, addDays, cleanText, log, parseId, sleep, todayStr } from './util.js';

const COOKIE = 'qd_admin';

const SORTS = {
  created: 'u.created_at',
  last_seen: 'u.last_seen_at',
  customers: 'customers',
  transactions: 'transactions',
  outstanding: 'outstanding',
};

/** Hamma foydalanuvchilar bo'yicha hisob-kitob uchun qayta ishlatiladigan SQL. */
const OUTSTANDING_SQL = `
  (SELECT COALESCE(SUM(b), 0) FROM (
     SELECT SUM(CASE t.type WHEN 'debt' THEN t.amount ELSE -t.amount END) AS b
     FROM transactions t WHERE t.user_id = u.id GROUP BY t.customer_id
   ) WHERE b > 0)`;

export function registerAdmin(router, { db, tg, config }) {
  const loginLimit = rateLimiter({ windowMs: 15 * 60_000, max: 10, key: (ctx) => `login:${ctx.ip}` });
  const apiLimit = rateLimiter({ windowMs: 60_000, max: 120, key: (ctx) => `admin:${ctx.ip}` });
  const adminEnabled = Boolean(config.adminPassword);

  function cookieHeader(value, maxAgeSec) {
    const parts = [`${COOKIE}=${value}`, 'Path=/admin', 'HttpOnly', 'SameSite=Strict', `Max-Age=${maxAgeSec}`];
    if (config.production) parts.push('Secure');
    return parts.join('; ');
  }

  function auth(ctx) {
    apiLimit(ctx);
    // CSRF qo'shimcha himoyasi: faqat o'z fetch'imiz yuboradigan sarlavha
    if (ctx.req.method !== 'GET' && ctx.req.headers['x-requested-with'] !== 'qarzdaftar') {
      throw new HttpError(403, "So'rov manbai noto'g'ri");
    }
    const token = parseCookies(ctx.req.headers.cookie)[COOKIE];
    const payload = verifyToken(token, config.sessionSecret);
    if (!payload || payload.u !== config.adminUsername) throw new HttpError(401, 'Kirish talab qilinadi', 'auth');
    ctx.state.admin = payload.u;
  }

  router.post('/admin/api/login', (ctx) => {
    loginLimit(ctx);
    if (ctx.req.headers['x-requested-with'] !== 'qarzdaftar') throw new HttpError(403, "So'rov manbai noto'g'ri");
    if (!adminEnabled) throw new HttpError(503, "Admin paroli sozlanmagan (ADMIN_PASSWORD).");
    const { username = '', password = '' } = ctx.body;
    // Ikkala tekshiruv ham bajariladi (vaqt farqi sezilmasligi uchun)
    const okUser = safeEqual(String(username), config.adminUsername);
    const okPass = safeEqual(String(password), config.adminPassword);
    if (!okUser || !okPass) {
      log('info', `Admin kirishi rad etildi (${ctx.ip})`);
      throw new HttpError(401, "Login yoki parol noto'g'ri");
    }
    const maxAge = config.sessionHours * 3600;
    const token = signToken({ u: config.adminUsername, exp: Date.now() + maxAge * 1000 }, config.sessionSecret);
    ctx.res.setHeader('set-cookie', cookieHeader(token, maxAge));
    return { ok: true };
  });

  router.post('/admin/api/logout', (ctx) => {
    ctx.res.setHeader('set-cookie', cookieHeader('', 0));
    return { ok: true };
  });

  router.get('/admin/api/me', auth, (ctx) => ({ username: ctx.state.admin, tz: config.tz }));

  router.get('/admin/api/stats', auth, () => {
    const today = todayStr(config.tz);
    const d7 = addDays(today, -6);
    const d30 = addDays(today, -29);
    const one = (sql, ...args) => db.prepare(sql).get(...args);

    const totals = one(`SELECT
        COUNT(*) AS users,
        COALESCE(SUM(is_blocked), 0) AS blocked,
        COALESCE(SUM(bot_stopped), 0) AS bot_stopped,
        COALESCE(SUM(created_day = ?), 0) AS new_today,
        COALESCE(SUM(created_day >= ?), 0) AS new_7d,
        COALESCE(SUM(created_day >= ?), 0) AS new_30d
      FROM users`, today, d7, d30);

    const active = (from) => one('SELECT COUNT(DISTINCT user_id) AS n FROM activity WHERE day >= ?', from).n;

    const tx = one(`SELECT COUNT(*) AS n,
        COALESCE(SUM(CASE type WHEN 'debt' THEN amount END), 0) AS given,
        COALESCE(SUM(CASE type WHEN 'payment' THEN amount END), 0) AS received
      FROM transactions`);
    const outstanding = one(`SELECT COALESCE(SUM(b), 0) AS n FROM (
        SELECT SUM(CASE type WHEN 'debt' THEN amount ELSE -amount END) AS b FROM transactions GROUP BY customer_id
      ) WHERE b > 0`).n;
    const withData = one('SELECT COUNT(DISTINCT user_id) AS n FROM customers').n;

    const signups = new Map(
      db.prepare('SELECT created_day AS day, COUNT(*) AS n FROM users WHERE created_day >= ? GROUP BY created_day').all(d30).map((r) => [r.day, r.n]),
    );
    const dau = new Map(
      db.prepare('SELECT day, COUNT(*) AS n FROM activity WHERE day >= ? GROUP BY day').all(d30).map((r) => [r.day, r.n]),
    );
    const series = [];
    for (let i = 29; i >= 0; i--) {
      const day = addDays(today, -i);
      series.push({ date: day, signups: signups.get(day) ?? 0, active: dau.get(day) ?? 0 });
    }

    return {
      today,
      users: {
        total: totals.users,
        blocked: totals.blocked,
        bot_stopped: totals.bot_stopped,
        new_today: totals.new_today,
        new_7d: totals.new_7d,
        new_30d: totals.new_30d,
        active_today: active(today),
        active_7d: active(d7),
        active_30d: active(d30),
        with_customers: withData,
      },
      ledger: {
        customers: one('SELECT COUNT(*) AS n FROM customers').n,
        transactions: tx.n,
        given: tx.given,
        received: tx.received,
        outstanding,
      },
      series,
    };
  });

  router.get('/admin/api/users', auth, (ctx) => {
    const page = Math.max(1, Number.parseInt(ctx.query.page, 10) || 1);
    const size = 20;
    const sortKey = SORTS[ctx.query.sort] ? ctx.query.sort : 'created';
    const dir = ctx.query.dir === 'asc' ? 'ASC' : 'DESC';
    const q = String(ctx.query.q ?? '').trim().slice(0, 60);

    const where = [];
    const args = [];
    if (q) {
      const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
      where.push(`(u.first_name LIKE ? ESCAPE '\\' OR u.last_name LIKE ? ESCAPE '\\' OR u.username LIKE ? ESCAPE '\\'
                   OR u.shop_name LIKE ? ESCAPE '\\' OR CAST(u.telegram_id AS TEXT) LIKE ? ESCAPE '\\')`);
      args.push(like, like, like, like, like);
    }
    if (ctx.query.status === 'blocked') where.push('u.is_blocked = 1');
    else if (ctx.query.status === 'active') where.push('u.is_blocked = 0');
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const total = db.prepare(`SELECT COUNT(*) AS n FROM users u ${whereSql}`).get(...args).n;
    const rows = db
      .prepare(
        `SELECT u.id, u.telegram_id, u.first_name, u.last_name, u.username, u.shop_name,
                u.is_blocked, u.bot_stopped, u.created_at, u.last_seen_at,
                (SELECT COUNT(*) FROM customers c WHERE c.user_id = u.id) AS customers,
                (SELECT COUNT(*) FROM transactions t WHERE t.user_id = u.id) AS transactions,
                ${OUTSTANDING_SQL} AS outstanding
         FROM users u ${whereSql}
         ORDER BY ${SORTS[sortKey]} ${dir} NULLS LAST, u.id DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...args, size, (page - 1) * size);

    return {
      page,
      pages: Math.max(1, Math.ceil(total / size)),
      total,
      users: rows.map((r) => ({
        ...r,
        created_at: `${r.created_at.replace(' ', 'T')}Z`,
        last_seen_at: r.last_seen_at ? `${r.last_seen_at.replace(' ', 'T')}Z` : null,
        is_blocked: !!r.is_blocked,
        bot_stopped: !!r.bot_stopped,
      })),
    };
  });

  router.post('/admin/api/users/:id/block', auth, (ctx) => {
    const id = parseId(ctx.params.id);
    if (typeof ctx.body.blocked !== 'boolean') throw new HttpError(400, 'blocked true/false bo\'lishi kerak');
    const res = db.prepare('UPDATE users SET is_blocked = ? WHERE id = ?').run(ctx.body.blocked ? 1 : 0, id);
    if (!res.changes) throw new HttpError(404, 'Foydalanuvchi topilmadi');
    log('info', `Admin: foydalanuvchi ${id} ${ctx.body.blocked ? 'bloklandi' : 'blokdan chiqarildi'}`);
    return { ok: true };
  });

  // ---------- Ommaviy xabar ----------
  const broadcast = { running: false, total: 0, sent: 0, failed: 0, startedAt: null, finishedAt: null };

  router.get('/admin/api/broadcast', auth, () => ({ ...broadcast }));

  router.post('/admin/api/broadcast', auth, (ctx) => {
    if (!tg.enabled) throw new HttpError(503, 'Bot sozlanmagan (BOT_TOKEN)');
    if (broadcast.running) throw new HttpError(409, 'Oldingi xabar hali yuborilmoqda');
    const text = cleanText(ctx.body.text, { max: 3500, required: true, field: 'Xabar matni' });
    const recipients = db.prepare('SELECT id, telegram_id FROM users WHERE is_blocked = 0 AND bot_stopped = 0').all();
    if (!recipients.length) throw new HttpError(400, "Yuboriladigan foydalanuvchi yo'q");

    Object.assign(broadcast, {
      running: true,
      total: recipients.length,
      sent: 0,
      failed: 0,
      startedAt: new Date().toISOString(),
      finishedAt: null,
    });
    log('info', `Admin: ommaviy xabar boshlandi (${recipients.length} ta)`);

    (async () => {
      for (const r of recipients) {
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            await tg.sendMessage(r.telegram_id, text);
            broadcast.sent += 1;
            break;
          } catch (err) {
            if (err.retryAfter && attempt === 0) {
              await sleep(Math.min(err.retryAfter, 30) * 1000);
              continue;
            }
            if (err.userGone) db.prepare('UPDATE users SET bot_stopped = 1 WHERE id = ?').run(r.id);
            broadcast.failed += 1;
            break;
          }
        }
        await sleep(40); // ~25 xabar/soniya, Telegram chegarasidan past
      }
    })()
      .catch((e) => log('error', `Broadcast xatosi: ${e.message}`))
      .finally(() => {
        broadcast.running = false;
        broadcast.finishedAt = new Date().toISOString();
      });

    return { ok: true, total: recipients.length };
  });
}
