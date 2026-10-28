// Demo ma'lumotlar: `npm run seed -- <telegram_id>`  (ID berilmasa, 1 ishlatiladi)
// Faqat ko'rib chiqish uchun. Bu foydalanuvchining mavjud mijozlari o'chirilib, qayta yoziladi.
import { loadConfig } from '../src/config.js';
import { openDb, transaction } from '../src/db.js';
import { addDays, todayStr } from '../src/util.js';

try { process.loadEnvFile(); } catch { /* .env yo'q */ }
const config = loadConfig();
const db = openDb(config.dbPath);
const tgId = Number(process.argv[2] ?? 1);
const today = todayStr(config.tz);

const customers = [
  ['Rustam aka', '+998 90 123 45 67', "Ko'chat bozori, 12-do'kon", [['debt', 1_200_000, -25, 'Un, yog\', shakar', -4], ['payment', 400_000, -12, 'Naqd'], ['debt', 350_000, -3, 'Choy, makaron', 12]]],
  ['Dilnoza opa', '+998 93 555 11 22', null, [['debt', 780_000, -9, 'Mahsulotlar', 6], ['payment', 300_000, -2, "Click orqali"]]],
  ['Bobur Karimov', '+998 99 700 80 90', 'Qo\'shni', [['debt', 2_450_000, -40, 'Qurilish mollari', -10], ['payment', 1_000_000, -20, '']]],
  ['Nodira', null, null, [['debt', 96_000, 0, 'Sut, non']]],
  ['Sardor', '+998 97 301 22 33', null, [['debt', 150_000, -6, '', 20], ['payment', 150_000, -1, "To'liq yopildi"]]],
  ['Gulnora xola', '+998 91 888 77 66', null, [['debt', 520_000, -14, 'Bayram uchun', 1]]],
  ['Jasur', null, null, []],
];

transaction(db, () => {
  db.prepare("INSERT OR IGNORE INTO users (telegram_id, first_name, shop_name, created_day) VALUES (?, 'Demo', 'Baraka market', ?)").run(tgId, today);
  const user = db.prepare('SELECT id FROM users WHERE telegram_id = ?').get(tgId);
  db.prepare("UPDATE users SET shop_name = COALESCE(shop_name, 'Baraka market') WHERE id = ?").run(user.id);
  db.prepare('DELETE FROM customers WHERE user_id = ?').run(user.id);
  for (const [name, phone, note, txs] of customers) {
    const c = db.prepare('INSERT INTO customers (user_id, name, phone, note) VALUES (?, ?, ?, ?)').run(user.id, name, phone, note);
    for (const [type, amount, dayOffset, txNote, dueOffset] of txs) {
      const date = addDays(today, dayOffset);
      const due = type === 'debt' && dueOffset !== undefined ? addDays(today, dueOffset) : null;
      db.prepare('INSERT INTO transactions (user_id, customer_id, type, amount, note, date, due_date) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(user.id, Number(c.lastInsertRowid), type, amount, txNote || null, date, due);
    }
  }
  db.prepare('INSERT OR IGNORE INTO activity (user_id, day) VALUES (?, ?)').run(user.id, today);
});
console.log(`Demo ma'lumotlar yozildi (telegram_id=${tgId}). Ochish: /?dev=${tgId} (DEV_MODE=1 bilan)`);
db.close();
