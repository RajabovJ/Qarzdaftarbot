import { getSummary, upsertUser } from './ledger.js';
import { formatMoney, log, sleep } from './util.js';

const WELCOME = (name) =>
  `Assalomu alaykum${name ? `, ${name}` : ''}! 👋\n\n` +
  `Bu — do'koningiz uchun *Qarz daftari*.\n\n` +
  `• Mijozlar va ularning qarzlarini yuriting\n` +
  `• Qarz berilgan va to'lov olingan sanani yozib boring\n` +
  `• Muddati o'tgan qarzlar haqida eslatma oling\n\n` +
  `Boshlash uchun pastdagi tugmani bosing.`;

function escapeMd(s) {
  return String(s).replace(/([_*`\[])/g, '\\$1');
}

export function createBot({ tg, db, config }) {
  const openButton = () => ({
    inline_keyboard: [[{ text: '📒 Daftarni ochish', web_app: { url: config.webappUrl } }]],
  });

  const canOpen = () => /^https:\/\//.test(config.webappUrl);

  async function reply(chatId, text, withButton = true) {
    const extra = { parse_mode: 'Markdown' };
    if (withButton && canOpen()) extra.reply_markup = openButton();
    return tg.sendMessage(chatId, text, extra);
  }

  async function handleMessage(msg) {
    if (!msg.from || msg.from.is_bot) return;
    if (msg.chat.type !== 'private') return;

    const user = upsertUser(db, msg.from, config.tz);
    // Foydalanuvchi yozgan ekan, bot bloklanmagan
    if (user.bot_stopped) db.prepare('UPDATE users SET bot_stopped = 0 WHERE id = ?').run(user.id);
    if (user.is_blocked) return;

    const text = (msg.text ?? '').trim();
    const command = text.split(/[\s@]/)[0].toLowerCase();

    if (command === '/start') {
      return reply(msg.chat.id, WELCOME(escapeMd(msg.from.first_name ?? '')));
    }
    if (command === '/help') {
      return reply(
        msg.chat.id,
        `*Buyruqlar*\n/start — daftarni ochish\n/stat — qisqa hisobot\n/help — yordam\n\n` +
          `Mijoz qo'shish, qarz va to'lovlarni yozish uchun daftarni oching.`,
      );
    }
    if (command === '/stat') {
      const s = getSummary(db, user.id, config.tz);
      let t =
        `📊 *Qisqa hisobot*\n\nJami qarzdorlik: *${formatMoney(s.total_debt)}*\n` +
        `Qarzdorlar: ${s.debtors_count} ta (jami mijoz: ${s.customers_count})\n`;
      if (s.overdue_count > 0) t += `⚠️ Muddati o'tgan: ${s.overdue_count} ta, ${formatMoney(s.overdue_amount)}\n`;
      t += `\nBugun berildi: ${formatMoney(s.today_totals.given)}\nBugun olindi: ${formatMoney(s.today_totals.received)}`;
      return reply(msg.chat.id, t);
    }
    return reply(msg.chat.id, `Daftarni ochish uchun pastdagi tugmani bosing 👇`);
  }

  function handleMyChatMember(update) {
    if (update.chat?.type !== 'private') return;
    const status = update.new_chat_member?.status;
    const tgId = update.from?.id;
    if (!tgId) return;
    if (status === 'kicked' || status === 'left') {
      db.prepare('UPDATE users SET bot_stopped = 1 WHERE telegram_id = ?').run(tgId);
    } else if (status === 'member') {
      db.prepare('UPDATE users SET bot_stopped = 0 WHERE telegram_id = ?').run(tgId);
    }
  }

  async function handleUpdate(update) {
    if (update?.message) return handleMessage(update.message);
    if (update?.my_chat_member) return handleMyChatMember(update.my_chat_member);
  }

  /** Bot ishga tushganda: buyruqlar, menyu tugmasi va webhook/polling. */
  async function setup() {
    if (!tg.enabled || config.botMode === 'off') return { mode: 'off' };

    try {
      await tg.call('setMyCommands', {
        commands: [
          { command: 'start', description: 'Daftarni ochish' },
          { command: 'stat', description: 'Qisqa hisobot' },
          { command: 'help', description: 'Yordam' },
        ],
      });
      if (canOpen()) {
        await tg.call('setChatMenuButton', {
          menu_button: { type: 'web_app', text: 'Daftar', web_app: { url: config.webappUrl } },
        });
      }
    } catch (err) {
      log('error', `Bot sozlamalarida xato: ${err.message}`);
    }

    if (config.botMode === 'polling') {
      await tg.deleteWebhook();
      startPolling();
      return { mode: 'polling' };
    }
    if (!canOpen()) {
      log('error', "WEBAPP_URL https:// bilan berilmagan, webhook o'rnatilmadi");
      return { mode: 'none' };
    }
    await tg.setWebhook(`${config.webappUrl}/telegram/webhook`, config.webhookSecret);
    return { mode: 'webhook' };
  }

  let pollAbort = null;
  function startPolling() {
    pollAbort = new AbortController();
    (async () => {
      let offset = 0;
      while (!pollAbort.signal.aborted) {
        try {
          const updates = await tg.getUpdates(offset, 25, pollAbort.signal);
          for (const u of updates) {
            offset = u.update_id + 1;
            await handleUpdate(u).catch((e) => log('error', `Update xatosi: ${e.message}`));
          }
        } catch (err) {
          if (pollAbort.signal.aborted) return;
          log('error', `Polling xatosi: ${err.message}`);
          await sleep(3000);
        }
      }
    })();
  }

  return { handleUpdate, setup, stop: () => pollAbort?.abort() };
}
