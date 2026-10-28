import { getSummary, listCustomers } from './ledger.js';
import { formatMoney, localHour, log, sleep, todayStr } from './util.js';

/**
 * Muddati o'tgan qarzi bor foydalanuvchilarga kuniga bir marta eslatma yuboradi.
 * `now` testlar uchun parametr sifatida beriladi.
 */
export async function runReminders({ db, tg, config, now = new Date(), delayMs = 40 }) {
  if (!tg.enabled) return { sent: 0, skipped: 'bot-off' };

  const today = todayStr(config.tz, now);
  if (localHour(config.tz, now) < config.reminderHour) return { sent: 0, skipped: 'too-early' };

  const last = db.prepare("SELECT value FROM kv WHERE key = 'last_reminder_day'").get();
  if (last?.value === today) return { sent: 0, skipped: 'already-done' };
  db.prepare("INSERT INTO kv (key, value) VALUES ('last_reminder_day', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(today);

  const users = db
    .prepare('SELECT id, telegram_id FROM users WHERE reminders_enabled = 1 AND is_blocked = 0 AND bot_stopped = 0')
    .all();

  let sent = 0;
  for (const u of users) {
    const s = getSummary(db, u.id, config.tz);
    if (s.overdue_count === 0) continue;

    const names = listCustomers(db, u.id, config.tz, { filter: 'overdue' })
      .slice(0, 5)
      .map((c) => `• ${c.name} — ${formatMoney(c.overdue_amount)}`);

    let text = `⏰ Muddati o'tgan qarzlar: ${s.overdue_count} ta mijoz, jami ${formatMoney(s.overdue_amount)}.`;
    if (names.length) text += `\n\n${names.join('\n')}`;
    text += `\n\nDaftarni ochib, qaysi mijozga eslatma yuborishni tanlang.`;

    const extra = {};
    if (/^https:\/\//.test(config.webappUrl)) {
      extra.reply_markup = { inline_keyboard: [[{ text: '📒 Daftarni ochish', web_app: { url: config.webappUrl } }]] };
    }
    try {
      await tg.sendMessage(u.telegram_id, text, extra);
      sent += 1;
    } catch (err) {
      if (err.userGone) db.prepare('UPDATE users SET bot_stopped = 1 WHERE id = ?').run(u.id);
      else log('error', `Eslatma yuborilmadi (${u.id}): ${err.message}`);
    }
    await sleep(delayMs);
  }
  log('info', `Eslatmalar yuborildi: ${sent}`);
  return { sent };
}

export function startReminderScheduler(deps) {
  const tick = () => runReminders(deps).catch((e) => log('error', `Eslatma xatosi: ${e.message}`));
  const timer = setInterval(tick, 10 * 60 * 1000);
  timer.unref();
  setTimeout(tick, 30_000).unref();
  return () => clearInterval(timer);
}
