export class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const dateFmtCache = new Map();
function dateFmt(tz) {
  if (!dateFmtCache.has(tz)) {
    dateFmtCache.set(
      tz,
      new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }),
    );
  }
  return dateFmtCache.get(tz);
}

/** Berilgan vaqt zonasidagi bugungi sana: YYYY-MM-DD */
export function todayStr(tz, date = new Date()) {
  return dateFmt(tz).format(date);
}

/** Berilgan vaqt zonasidagi soat (0-23) */
export function localHour(tz, date = new Date()) {
  const h = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }).format(date);
  return Number(h);
}

export function isValidDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(fromStr, toStr) {
  return Math.round((new Date(`${toStr}T00:00:00Z`) - new Date(`${fromStr}T00:00:00Z`)) / 86400000);
}

export function formatMoney(n) {
  const sign = n < 0 ? '-' : '';
  return `${sign}${String(Math.abs(Math.round(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} so'm`;
}

/** SQLite UTC vaqtini ('YYYY-MM-DD HH:MM:SS') ISO ko'rinishga aylantiradi. */
export function sqlToIso(s) {
  return s ? `${s.replace(' ', 'T')}Z` : null;
}

// ---------- Kiruvchi ma'lumotlarni tekshirish ----------

export function cleanText(value, { max, required = false, field = 'Maydon' } = {}) {
  if (value === undefined || value === null) value = '';
  if (typeof value !== 'string') throw new HttpError(400, `${field} matn bo'lishi kerak`);
  // boshqaruv belgilarini olib tashlaymiz, bo'shliqlarni tartibga solamiz
  const s = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
  if (required && !s) throw new HttpError(400, `${field} kiritilishi shart`);
  if (s.length > max) throw new HttpError(400, `${field} ${max} belgidan oshmasligi kerak`);
  return s;
}

export function cleanPhone(value) {
  const s = cleanText(value, { max: 40, field: 'Telefon' });
  if (!s) return '';
  const cleaned = s.replace(/[^\d+\-()\s]/g, '').replace(/\s+/g, ' ').trim();
  const digits = cleaned.replace(/\D/g, '');
  if (digits.length < 5 || digits.length > 15) throw new HttpError(400, "Telefon raqami noto'g'ri");
  return cleaned;
}

export function parseAmount(value) {
  let n;
  if (typeof value === 'number') n = value;
  else if (typeof value === 'string') n = Number(value.replace(/[\s ,]/g, ''));
  else n = NaN;
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, "Summa musbat butun son bo'lishi kerak");
  if (n > 1e12) throw new HttpError(400, 'Summa juda katta');
  return n;
}

export function parseDateField(value, field = 'Sana') {
  if (value === undefined || value === null || value === '') return null;
  if (!isValidDate(value)) throw new HttpError(400, `${field} noto'g'ri (YYYY-MM-DD)`);
  return value;
}

export function parseId(value) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) throw new HttpError(404, 'Topilmadi');
  return n;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function log(level, msg, extra) {
  const line = `[${new Date().toISOString()}] ${level.toUpperCase()} ${msg}`;
  if (extra !== undefined) console[level === 'error' ? 'error' : 'log'](line, extra);
  else console[level === 'error' ? 'error' : 'log'](line);
}
