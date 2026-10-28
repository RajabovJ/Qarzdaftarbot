// Qarz daftari — Telegram Mini App (framework'siz, xavfsiz DOM yasash: matn textContent orqali qo'yiladi)

const tg = window.Telegram?.WebApp ?? null;
const devId = new URLSearchParams(location.search).get('dev');

// ---------- Yordamchilar ----------
const NB = ' ';
const MONTHS = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'];
const fmt = (n) => String(Math.abs(Math.round(n))).replace(/\B(?=(\d{3})+(?!\d))/g, NB);
const money = (n) => `${n < 0 ? '−' : ''}${fmt(n)}${NB}so'm`;
const short = (n) => (n >= 1e6 ? `${+(n / 1e6).toFixed(2)} mln` : n >= 1e3 ? `${Math.round(n / 1e3)} ming` : String(n));

function dateParts(s) {
  const [y, m, d] = s.split('-').map(Number);
  return { y, m, d };
}
function addDays(s, n) {
  const d = new Date(`${s}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function fmtDate(s, today = S.today) {
  if (!s) return '';
  if (s === today) return 'Bugun';
  if (s === addDays(today, -1)) return 'Kecha';
  if (s === addDays(today, 1)) return 'Ertaga';
  const { y, m, d } = dateParts(s);
  return `${d}${NB}${MONTHS[m - 1]}${y !== dateParts(today).y ? `${NB}${y}` : ''}`;
}
const dayMonth = (s) => {
  const { d, m } = dateParts(s);
  return `${d}${NB}${MONTHS[m - 1]}`;
};
const hashIdx = (str) => [...str].reduce((a, c) => (a * 31 + c.codePointAt(0)) >>> 0, 7) % 6;
const initial = (name) => ([...name.trim()][0] ?? '?').toUpperCase();

function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid === undefined || kid === null || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

const ICONS = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z"/>',
  book: '<path d="M6 3h11a2 2 0 012 2v14a2 2 0 01-2 2H6zM6 3v18M10 8h5M10 12h5"/>',
  chart: '<path d="M5 20V11M12 20V4M19 20v-6"/>',
  sliders: '<path d="M4 7h8M16 7h4M4 17h4M12 17h8"/><circle cx="14" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  bell: '<path d="M6 16v-5a6 6 0 1112 0v5l2 2H4zM10 20a2 2 0 004 0"/>',
  send: '<path d="M12 4v12M7 11l5 5 5-5M5 20h14"/>',
  chat: '<path d="M4 5h16v11H9l-5 4z"/>',
  copy: '<path d="M9 9h11v11H9zM5 15V4h11"/>',
  down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
};
const icon = (name, size) => {
  const s = h('span', { class: 'ico', 'aria-hidden': 'true' });
  s.innerHTML = `<svg viewBox="0 0 24 24">${ICONS[name] ?? ''}</svg>`; // statik, ishonchli SVG
  if (size) s.style.width = s.style.height = `${size}px`;
  return s;
};

function haptic(kind = 'light') {
  try {
    if (kind === 'success' || kind === 'error' || kind === 'warning') tg?.HapticFeedback?.notificationOccurred(kind);
    else tg?.HapticFeedback?.impactOccurred(kind);
  } catch { /* e'tiborsiz */ }
}

let toastTimer;
function toast(msg, kind = 'ok') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast show${kind === 'error' ? ' error' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = 'toast'), 2600);
  haptic(kind === 'error' ? 'error' : 'success');
}

// ---------- API ----------
class ApiError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function api(method, path, body) {
  const headers = {};
  if (tg?.initData) headers.authorization = `tma ${tg.initData}`;
  else if (devId) headers['x-dev-user'] = devId;
  if (body) headers['content-type'] = 'application/json';
  let res;
  try {
    res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw new ApiError(0, "Internet aloqasi yo'q. Ulanishni tekshirib, qayta urinib ko'ring.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error || 'Xatolik yuz berdi', data.code);
  return data;
}

// ---------- Holat ----------
const S = { me: null, today: new Date().toISOString().slice(0, 10), filter: 'all', q: '', customers: [], customer: null };
const app = document.getElementById('app');
/** Asosiy konteynerga elementlarni qo'yadi; false/null qiymatlar e'tiborsiz qoldiriladi. */
const mount = (...nodes) => app.replaceChildren(...nodes.flat(Infinity).filter((n) => n !== false && n !== null && n !== undefined));
const nav = document.getElementById('nav');
let renderToken = 0;

// ---------- Telegram integratsiyasi ----------
function applyTheme() {
  const scheme = tg?.colorScheme ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.dataset.theme = scheme;
  const bg = scheme === 'dark' ? '#0d1124' : '#eef1f7';
  try {
    tg?.setHeaderColor?.(bg);
    tg?.setBackgroundColor?.(bg);
    tg?.setBottomBarColor?.(scheme === 'dark' ? '#161b35' : '#ffffff');
  } catch { /* eski versiyalar */ }
}
if (tg) {
  tg.ready();
  tg.expand();
  tg.disableVerticalSwipes?.();
  tg.onEvent('themeChanged', applyTheme);
  tg.BackButton.onClick(() => closeTopSheet() || history.back());
}
applyTheme();
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => !tg && applyTheme());

// ---------- Pastki oyna (sheet) ----------
const sheets = [];
function openSheet(title, build, { onClose } = {}) {
  const content = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title });
  const backdrop = h('div', { class: 'backdrop' }, content);
  const sheet = {
    close() {
      const i = sheets.indexOf(sheet);
      if (i < 0) return;
      sheets.splice(i, 1);
      backdrop.remove();
      document.removeEventListener('keydown', onKey);
      if (!sheets.length) updateBackButton();
      onClose?.();
    },
  };
  const onKey = (e) => e.key === 'Escape' && sheets.at(-1) === sheet && sheet.close();
  backdrop.addEventListener('click', (e) => e.target === backdrop && sheet.close());
  document.addEventListener('keydown', onKey);
  content.append(h('div', { class: 'grab' }), h('h2', null, title), build(sheet));
  document.getElementById('sheet-root').append(backdrop);
  sheets.push(sheet);
  tg?.BackButton.show();
  const first = content.querySelector('input:not([type=date]), textarea');
  if (first) setTimeout(() => first.focus({ preventScroll: true }), 120);
  return sheet;
}
function closeTopSheet() {
  const s = sheets.at(-1);
  if (!s) return false;
  s.close();
  return true;
}

function confirmSheet(title, text, okLabel) {
  return new Promise((resolve) => {
    let answered = false;
    const done = (v) => {
      answered = true;
      resolve(v);
    };
    openSheet(
      title,
      (sheet) =>
        h('div', null,
          h('p', { class: 'text' }, text),
          h('div', { class: 'stack' },
            h('button', { class: 'btn primary block', onClick: () => { done(true); sheet.close(); } }, okLabel),
            h('button', { class: 'btn soft block', onClick: () => { done(false); sheet.close(); } }, 'Bekor qilish'),
          ),
        ),
      { onClose: () => !answered && resolve(false) },
    );
  });
}

// ---------- Marshrutlash ----------
function route() {
  const hash = location.hash.replace(/^#/, '') || '/';
  const m = /^\/c\/(\d+)$/.exec(hash);
  if (m) return { name: 'customer', id: Number(m[1]) };
  if (hash === '/report') return { name: 'report' };
  if (hash === '/settings') return { name: 'settings' };
  return { name: 'home' };
}
const go = (hash) => {
  if (location.hash === hash) render();
  else location.hash = hash;
};

function updateBackButton() {
  if (!tg) return;
  if (route().name === 'customer' || sheets.length) tg.BackButton.show();
  else tg.BackButton.hide();
}

function renderNav(active) {
  const tabs = [
    ['home', '#/', 'book', 'Daftar'],
    ['report', '#/report', 'chart', 'Hisobot'],
    ['settings', '#/settings', 'sliders', 'Sozlamalar'],
  ];
  nav.replaceChildren(
    ...tabs.map(([name, hash, ic, label]) =>
      h('button', { 'aria-current': name === active ? 'page' : null, onClick: () => { haptic('light'); if (name === 'home') { S.q = ''; S.filter = 'all'; } go(hash); } }, icon(ic), label),
    ),
  );
  nav.hidden = false;
  app.classList.remove('no-nav');
}

async function render() {
  const token = ++renderToken;
  const r = route();
  updateBackButton();
  window.scrollTo(0, 0);
  try {
    if (!S.me) {
      mount(skeleton(3));
      S.me = (await api('GET', '/api/me')).user;
      S.today = S.me.today;
      if (token !== renderToken) return;
    }
    if (r.name === 'customer') {
      nav.hidden = true;
      app.classList.add('no-nav');
      await customerView(r.id, token);
    } else if (r.name === 'report') {
      renderNav('report');
      await reportView(token);
    } else if (r.name === 'settings') {
      renderNav('settings');
      settingsView();
    } else {
      renderNav('home');
      await homeView(token);
    }
  } catch (err) {
    if (token === renderToken) errorView(err);
  }
}

function errorView(err) {
  nav.hidden = true;
  let title = 'Xatolik yuz berdi';
  let text = err.message;
  let retry = true;
  if (err.code === 'blocked') {
    title = 'Akkaunt bloklangan';
    retry = false;
  } else if (err.code === 'auth' || err.status === 401) {
    title = 'Telegram orqali oching';
    text = "Bu ilova faqat Telegram botidagi “Daftar” tugmasi orqali ishlaydi.";
    retry = false;
  }
  mount(
    h('div', { class: 'screen-msg' },
      h('h2', null, title),
      h('p', null, text),
      retry && h('button', { class: 'btn primary', onClick: () => render() }, 'Qayta urinish'),
    ),
  );
}

function skeleton(n) {
  return h('div', { class: 'list' }, ...Array.from({ length: n }, (_, i) => h('div', { class: 'skeleton', style: `height:${i === 0 ? 130 : 64}px` })));
}

// ---------- Bosh sahifa ----------
async function homeView(token) {
  mount(skeleton(5));
  const [summary, list] = await Promise.all([api('GET', '/api/summary'), fetchCustomers()]);
  if (token !== renderToken) return;
  S.summary = summary;
  S.customers = list;
  S.today = summary.today;

  const listBox = h('div', { class: 'list' });
  const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Filtr' });
  const drawChips = () =>
    chips.replaceChildren(
      ...[['all', 'Hammasi'], ['debtors', 'Qarzdorlar'], ['overdue', `Muddati o'tgan${summary.overdue_count ? ` · ${summary.overdue_count}` : ''}`]].map(
        ([key, label]) =>
          h('button', {
            class: 'chip',
            'aria-pressed': String(S.filter === key),
            onClick: async () => {
              S.filter = key;
              drawChips();
              await refreshList();
            },
          }, label),
      ),
    );
  const refreshList = async () => {
    try {
      S.customers = await fetchCustomers();
      drawList(listBox, summary.customers_count);
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  let timer;
  const search = h('div', { class: 'search' },
    icon('search'),
    h('input', {
      type: 'search', placeholder: 'Ism yoki telefon bo\'yicha qidirish', value: S.q, 'aria-label': 'Qidirish', autocomplete: 'off',
      onInput: (e) => {
        S.q = e.target.value;
        clearTimeout(timer);
        timer = setTimeout(refreshList, 220);
      },
    }),
  );

  drawChips();
  drawList(listBox, summary.customers_count);

  mount(
    h('div', { class: 'topbar' },
      h('div', null, h('h1', null, S.me.shop_name || "Mening do'konim"), h('div', { class: 'date' }, `Bugun, ${dayMonth(summary.today)}`)),
    ),
    heroCard(summary),
    h('div', { class: 'tiles' },
      tile('given', 'down', 'Bugun berildi', summary.today_totals.given),
      tile('received', 'up', 'Bugun olindi', summary.today_totals.received),
    ),
    summary.customers_count > 0 && search,
    summary.customers_count > 0 && chips,
    listBox,
    summary.customers_count > 0 && h('button', { class: 'fab', onClick: () => customerForm() }, icon('plus'), 'Mijoz'),
  );
}

const fetchCustomers = async () => {
  const qs = new URLSearchParams({ filter: S.filter });
  if (S.q.trim()) qs.set('q', S.q.trim());
  return (await api('GET', `/api/customers?${qs}`)).customers;
};

function heroCard(s) {
  return h('section', { class: 'ledger-card', 'aria-label': 'Jami qarzdorlik' },
    h('div', { class: 'label' }, 'Sizga qaytarilishi kerak'),
    h('div', { class: 'amount' }, fmt(s.total_debt), h('small', null, "so'm")),
    h('div', { class: 'meta' }, s.customers_count === 0 ? 'Hali mijoz qo\'shilmagan' : `${s.debtors_count} ta qarzdor · jami ${s.customers_count} ta mijoz`),
    s.overdue_count > 0 &&
      h('div', { class: 'overdue' }, icon('clock', 16), `Muddati o'tgan: ${money(s.overdue_amount)}`),
  );
}

function tile(kind, ic, label, value) {
  return h('div', { class: `tile ${kind}` },
    h('div', { class: 't-label' }, icon(ic, 16), label),
    h('div', { class: 't-value' }, money(value)),
  );
}

function drawList(box, totalCustomers) {
  if (!S.customers.length) {
    if (totalCustomers === 0) {
      box.replaceChildren(emptyState({
        title: "Daftaringiz hali bo'sh",
        text: "Birinchi mijozni qo'shing, so'ng unga qarz yoki to'lovni yozib boring.",
        action: ['Birinchi mijozni qo\'shish', () => customerForm()],
      }));
    } else {
      box.replaceChildren(emptyState({
        title: 'Hech narsa topilmadi',
        text: S.q ? "Boshqa ism yoki raqam bilan qidirib ko'ring." : "Bu filtr bo'yicha mijoz yo'q.",
      }));
    }
    return;
  }
  box.replaceChildren(...S.customers.map(customerRow));
}

function customerRow(c) {
  let balance;
  if (c.balance > 0) balance = h('div', { class: 'v debt' }, money(c.balance));
  else if (c.balance < 0) balance = h('div', { class: 'v advance' }, `Avans ${money(-c.balance)}`);
  else balance = h('div', { class: 'v clear' }, c.tx_count ? "Qarzi yo'q" : 'Yozuv yo\'q');

  const sub = c.balance > 0 && c.next_due && !c.overdue_amount
    ? `Muddat: ${fmtDate(c.next_due)}`
    : c.phone || (c.last_date ? `Oxirgi yozuv: ${fmtDate(c.last_date)}` : 'Yozuv yo\'q');

  return h('button', { class: 'row', onClick: () => go(`#/c/${c.id}`), 'aria-label': `${c.name}, ${money(c.balance)}` },
    h('div', { class: `avatar av-${hashIdx(c.name)}` }, initial(c.name)),
    h('div', { class: 'info' }, h('div', { class: 'name' }, c.name), h('div', { class: 'sub' }, sub)),
    h('div', { class: 'bal' }, balance, c.overdue_amount > 0 && h('span', { class: 'pill' }, "Muddati o'tgan")),
  );
}

function emptyState({ title, text, action }) {
  const svg = h('span');
  svg.innerHTML =
    '<svg viewBox="0 0 120 96" aria-hidden="true"><rect x="22" y="8" width="76" height="80" rx="10" fill="var(--surface)" stroke="var(--line)" stroke-width="2"/>' +
    '<path d="M42 8v80" stroke="var(--anor)" stroke-width="2" opacity=".5"/><path d="M52 30h34M52 44h34M52 58h22" stroke="var(--line)" stroke-width="3" stroke-linecap="round"/>' +
    '<circle cx="92" cy="74" r="14" fill="var(--primary)"/><path d="M92 67v14M85 74h14" stroke="var(--on-primary)" stroke-width="3" stroke-linecap="round"/></svg>';
  return h('div', { class: 'empty' }, svg, h('h3', null, title), h('p', null, text),
    action && h('button', { class: 'btn primary', onClick: action[1] }, action[0]));
}

// ---------- Mijoz sahifasi ----------
async function customerView(id, token) {
  mount(skeleton(4));
  const data = await api('GET', `/api/customers/${id}`);
  if (token !== renderToken) return;
  drawCustomer(data);
}

function drawCustomer(data) {
  S.customer = data;
  const c = data.customer;
  const txs = data.transactions;

  let amountClass = 'clear';
  let label = 'Hisob-kitob';
  let amountText = "Qarzi yo'q";
  if (c.balance > 0) { amountClass = 'debt'; label = 'Qarz'; amountText = money(c.balance); }
  else if (c.balance < 0) { amountClass = 'advance'; label = 'Avans (oldindan to\'langan)'; amountText = money(-c.balance); }

  const extra = h('div', { class: 'extra' },
    c.overdue_amount > 0 && h('span', { class: 'pill' }, `Muddati o'tgan: ${money(c.overdue_amount)}`),
    c.balance > 0 && c.next_due && h('span', null, `Qaytarish muddati: ${fmtDate(c.next_due)}`),
  );

  const groups = new Map();
  for (const t of txs) {
    if (!groups.has(t.date)) groups.set(t.date, []);
    groups.get(t.date).push(t);
  }

  mount(
    h('button', { class: 'back', onClick: () => go('#/') }, icon('back'), 'Orqaga'),
    h('div', { class: 'cust-head' },
      h('div', { class: `avatar av-${hashIdx(c.name)}` }, initial(c.name)),
      h('div', { class: 'who' },
        h('h1', null, c.name),
        c.phone && h('a', { class: 'phone', href: `tel:${c.phone.replace(/[^\d+]/g, '')}` }, icon('phone', 15), c.phone),
        c.note && h('div', { class: 'note' }, c.note),
      ),
      h('button', { class: 'icon-btn', 'aria-label': 'Tahrirlash', onClick: () => customerForm(c) }, icon('edit')),
    ),
    h('section', { class: 'balance-card' },
      h('div', { class: 'label' }, label),
      h('div', { class: `amount ${amountClass}` }, amountText),
      (c.overdue_amount > 0 || (c.balance > 0 && c.next_due)) && extra,
    ),
    h('div', { class: 'actions' },
      h('button', { class: 'btn debt', onClick: () => txForm(c, 'debt') }, icon('down'), 'Qarz berdim'),
      h('button', { class: 'btn pay', onClick: () => txForm(c, 'payment') }, icon('up'), "To'lov oldim"),
    ),
    c.balance > 0 && h('button', { class: 'btn soft block', onClick: () => reminderSheet(c) }, icon('bell'), 'Eslatma yuborish'),
    h('div', { class: 'section-title' }, `Yozuvlar${txs.length ? ` · ${txs.length}` : ''}`),
    txs.length
      ? h('div', { class: 'pages' }, ...[...groups.entries()].flatMap(([, list]) => list.map(entryRow)))
      : emptyState({ title: "Yozuvlar yo'q", text: "“Qarz berdim” yoki “To'lov oldim” tugmasi orqali birinchi yozuvni qo'shing." }),
  );
}

function entryRow(t) {
  const { d, m } = dateParts(t.date);
  const isDebt = t.type === 'debt';
  return h('button', { class: `entry ${t.type}`, onClick: () => entrySheet(t), 'aria-label': `${fmtDate(t.date)}, ${isDebt ? 'qarz' : "to'lov"} ${money(t.amount)}` },
    h('div', { class: 'd' }, h('b', null, d), h('span', null, MONTHS[m - 1].slice(0, 3))),
    h('div', { class: 'what' },
      isDebt ? 'Qarz berildi' : "To'lov olindi",
      t.note && h('small', null, t.note),
      isDebt && t.due_date && h('small', { class: 'due' }, `Muddat: ${fmtDate(t.due_date)}`),
    ),
    h('div', { class: 'amt' }, `${isDebt ? '' : '+'}${money(t.amount)}`),
  );
}

function entrySheet(t) {
  openSheet(t.type === 'debt' ? 'Qarz yozuvi' : "To'lov yozuvi", (sheet) =>
    h('div', null,
      h('div', { class: 'preview' },
        h('div', null, h('b', null, money(t.amount)), ` · ${fmtDate(t.date)}`),
        t.note && h('div', null, t.note),
        t.due_date && h('div', null, `Qaytarish muddati: ${fmtDate(t.due_date)}`),
      ),
      h('div', { class: 'stack' },
        h('button', {
          class: 'btn danger block',
          onClick: async () => {
            sheet.close();
            if (!(await confirmSheet("Yozuvni o'chirish", "Bu yozuv o'chiriladi va qoldiq qayta hisoblanadi.", "Ha, o'chirish"))) return;
            try {
              drawCustomer(await api('DELETE', `/api/transactions/${t.id}`));
              toast("Yozuv o'chirildi");
            } catch (e) { toast(e.message, 'error'); }
          },
        }, icon('trash'), "Yozuvni o'chirish"),
        h('button', { class: 'btn soft block', onClick: () => sheet.close() }, 'Yopish'),
      ),
    ),
  );
}

// ---------- Formalar ----------
function moneyInput(props = {}) {
  const input = h('input', { type: 'text', inputmode: 'numeric', autocomplete: 'off', placeholder: '0', ...props });
  input.addEventListener('input', () => {
    const digits = input.value.replace(/\D/g, '').slice(0, 13);
    input.value = digits ? digits.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') : '';
  });
  return input;
}
const digitsOf = (s) => Number(String(s).replace(/\D/g, '')) || 0;

function field(label, input, error) {
  return h('label', { class: 'field' }, h('span', null, label), input, error);
}

function customerForm(existing) {
  openSheet(existing ? "Mijozni tahrirlash" : 'Yangi mijoz', (sheet) => {
    const name = h('input', { type: 'text', maxlength: '80', value: existing?.name ?? '', placeholder: 'Masalan: Rustam aka', autocomplete: 'off' });
    const phone = h('input', { type: 'tel', maxlength: '40', value: existing?.phone ?? '', placeholder: '+998 90 123 45 67', autocomplete: 'off' });
    const note = h('textarea', { rows: '2', maxlength: '200', placeholder: 'Masalan: 5-do\'kon, qo\'shni' }, existing?.note ?? '');
    const err = h('div', { class: 'err', hidden: true });
    const save = h('button', { class: 'btn primary block', type: 'submit' }, existing ? "Saqlash" : "Mijozni qo'shish");

    const form = h('form', {
      novalidate: true,
      onSubmit: async (e) => {
        e.preventDefault();
        err.hidden = true;
        if (!name.value.trim()) { err.textContent = 'Mijoz ismini kiriting'; err.hidden = false; name.focus(); return; }
        save.disabled = true;
        try {
          const body = { name: name.value, phone: phone.value, note: note.value };
          const data = existing ? await api('PATCH', `/api/customers/${existing.id}`, body) : await api('POST', '/api/customers', body);
          sheet.close();
          toast(existing ? 'Saqlandi' : "Mijoz qo'shildi");
          if (existing) drawCustomer(data);
          else go(`#/c/${data.customer.id}`);
        } catch (ex) {
          err.textContent = ex.message; err.hidden = false; save.disabled = false;
        }
      },
    },
      field('Ism', name), field('Telefon (ixtiyoriy)', phone), field('Izoh (ixtiyoriy)', note), err,
      h('div', { class: 'stack' }, save,
        existing && h('button', {
          type: 'button', class: 'btn danger block',
          onClick: async () => {
            sheet.close();
            if (!(await confirmSheet("Mijozni o'chirish", `“${existing.name}” va uning barcha yozuvlari butunlay o'chiriladi. Buni qaytarib bo'lmaydi.`, "Ha, o'chirish"))) return;
            try { await api('DELETE', `/api/customers/${existing.id}`); toast("Mijoz o'chirildi"); go('#/'); } catch (ex) { toast(ex.message, 'error'); }
          },
        }, icon('trash'), "Mijozni o'chirish"),
      ),
    );
    return form;
  });
}

function txForm(customer, type) {
  const isDebt = type === 'debt';
  openSheet(isDebt ? 'Qarz berildi' : "To'lov olindi", (sheet) => {
    const amount = moneyInput({ class: 'big', 'aria-label': 'Summa' });
    const quick = h('div', { class: 'quick' });
    if (!isDebt && customer.balance > 0) {
      quick.append(h('button', {
        type: 'button',
        onClick: () => { amount.value = fmt(customer.balance).replace(/ /g, ' '); amount.dispatchEvent(new Event('input')); },
      }, `To'liq: ${money(customer.balance)}`));
    }
    const date = h('input', { type: 'date', value: S.today, max: S.today, min: '2000-01-01' });
    const due = h('input', { type: 'date', min: S.today });
    const dueChips = h('div', { class: 'quick' });
    const setDue = (days) => {
      due.value = days ? addDays(date.value || S.today, days) : '';
      drawDueChips(days);
    };
    const drawDueChips = (active) =>
      dueChips.replaceChildren(...[[7, '7 kun'], [15, '15 kun'], [30, '30 kun'], [0, 'Muddatsiz']].map(([d, l]) =>
        h('button', { type: 'button', 'aria-pressed': String(active === d), onClick: () => setDue(d) }, l)));
    drawDueChips(0);
    due.addEventListener('input', () => drawDueChips(-1));
    const note = h('input', { type: 'text', maxlength: '200', placeholder: isDebt ? 'Masalan: un, yog\', shakar' : 'Masalan: naqd', autocomplete: 'off' });
    const err = h('div', { class: 'err', hidden: true });
    const save = h('button', { class: 'btn primary block', type: 'submit' }, isDebt ? 'Qarzni yozish' : "To'lovni yozish");

    return h('form', {
      novalidate: true,
      onSubmit: async (e) => {
        e.preventDefault();
        err.hidden = true;
        const value = digitsOf(amount.value);
        if (!value) { err.textContent = 'Summani kiriting'; err.hidden = false; amount.focus(); return; }
        save.disabled = true;
        try {
          const body = { type, amount: value, note: note.value, date: date.value || S.today };
          if (isDebt && due.value) body.due_date = due.value;
          const data = await api('POST', `/api/customers/${customer.id}/transactions`, body);
          sheet.close();
          drawCustomer(data);
          toast(isDebt ? 'Qarz yozildi' : "To'lov yozildi");
        } catch (ex) {
          err.textContent = ex.message; err.hidden = false; save.disabled = false;
        }
      },
    },
      h('div', { class: 'text' }, customer.name),
      field('Summa (so\'m)', amount, null), quick,
      h('div', { style: 'height:14px' }),
      field('Sana', date),
      isDebt && h('div', { class: 'field' }, h('span', null, 'Qaytarish muddati'), due, dueChips),
      field('Izoh (ixtiyoriy)', note), err,
      h('div', { class: 'stack' }, save),
    );
  });
}

function reminderSheet(c) {
  const shop = S.me.shop_name ? `${S.me.shop_name} do'konidan` : "do'kon tomonidan";
  const overdue = c.overdue_amount > 0 ? ' Qaytarish muddati o\'tib ketgan.' : '';
  const text = `Assalomu alaykum, ${c.name}! ${shop[0].toUpperCase()}${shop.slice(1)} sizda ${money(c.balance)} qarz qolgan.${overdue} Iltimos, imkon qadar tezroq to'lab qo'ying. Rahmat!`;
  openSheet('Eslatma matni', (sheet) => {
    const phoneDigits = (c.phone ?? '').replace(/[^\d+]/g, '');
    const copy = async () => {
      try { await navigator.clipboard.writeText(text); }
      catch {
        const ta = h('textarea', { style: 'position:fixed;opacity:0' }, text);
        document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove();
      }
      toast('Matn nusxalandi');
    };
    return h('div', null,
      h('div', { class: 'preview' }, text),
      h('div', { class: 'stack' },
        phoneDigits && h('a', { class: 'btn primary block', href: `sms:${phoneDigits}?&body=${encodeURIComponent(text)}` }, icon('chat'), 'SMS yuborish'),
        navigator.share && h('button', { class: 'btn soft block', onClick: () => navigator.share({ text }).catch(() => {}) }, icon('send'), 'Ulashish'),
        h('button', { class: 'btn soft block', onClick: copy }, icon('copy'), 'Matnni nusxalash'),
        !phoneDigits && h('p', { class: 'text', style: 'margin:0;text-align:center' }, "SMS yuborish uchun mijozga telefon raqami qo'shing."),
      ),
    );
  });
}

// ---------- Hisobot ----------
async function reportView(token) {
  mount(skeleton(4));
  const s = await api('GET', '/api/summary');
  if (token !== renderToken) return;
  S.today = s.today;

  const read = h('div', { class: 'chart-read' }, 'Kunni bosib, summalarni ko\'ring');
  const rawMax = Math.max(1, ...s.series.flatMap((d) => [d.given, d.received]));
  const niceCeil = (v) => {
    const p = 10 ** Math.floor(Math.log10(v));
    return ([1, 2, 2.5, 5, 10].find((k) => k * p >= v) ?? 10) * p;
  };
  const max = niceCeil(rawMax);
  const W = 340, H = 170, padL = 50, padB = 22, padT = 8;
  const plotW = W - padL - 6, plotH = H - padB - padT;
  const step = plotW / s.series.length;
  const bw = Math.min(9, step / 2 - 1.5);
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', "Oxirgi 14 kundagi berilgan qarz va olingan to'lovlar");
  const mk = (tag, attrs, text) => {
    const e = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    if (text !== undefined) e.textContent = text;
    svg.append(e);
    return e;
  };
  for (const f of [0, 0.5, 1]) {
    const y = padT + plotH * (1 - f);
    mk('line', { x1: padL, x2: W - 6, y1: y, y2: y, class: 'grid' });
    mk('text', { x: padL - 5, y: y + 3, class: 'gv', 'text-anchor': 'end' }, f ? short(Math.round(max * f)) : '0');
  }
  s.series.forEach((d, i) => {
    const cx = padL + step * i + step / 2;
    const bar = (v, x, color, label) => {
      const hgt = (v / max) * plotH;
      mk('rect', { x, y: padT + plotH - Math.max(hgt, v ? 2 : 0), width: bw, height: Math.max(hgt, v ? 2 : 0), rx: 2.5, fill: color, class: 'bar', 'data-l': label });
    };
    bar(d.given, cx - bw - 0.5, 'var(--anor)', 'berildi');
    bar(d.received, cx + 0.5, 'var(--firuza)', 'olindi');
    const hit = mk('rect', { x: cx - step / 2, y: 0, width: step, height: H - padB, fill: 'transparent', class: 'bar' });
    hit.addEventListener('click', () => {
      read.textContent = `${fmtDate(d.date, s.today)}: berildi ${money(d.given)}, olindi ${money(d.received)}`;
      haptic('light');
    });
    if (i % 2 === 1 || s.series.length < 8) mk('text', { x: cx, y: H - 7, class: 'tick' }, String(dateParts(d.date).d));
  });

  const monthName = MONTHS[dateParts(s.today).m - 1];
  mount(
    h('div', { class: 'topbar' }, h('div', null, h('h1', null, 'Hisobot'), h('div', { class: 'date' }, `${monthName[0].toUpperCase()}${monthName.slice(1)} oyi`))),
    h('div', { class: 'tiles', style: 'margin-top:0' },
      tile('given', 'down', 'Oy davomida berildi', s.month_totals.given),
      tile('received', 'up', 'Oy davomida olindi', s.month_totals.received),
    ),
    h('div', { class: 'section-title' }, 'Oxirgi 14 kun'),
    h('div', { class: 'chart-card' }, svg,
      h('div', { class: 'legend' }, h('span', null, h('i', { style: 'background:var(--anor)' }), 'Qarz berildi'), h('span', null, h('i', { style: 'background:var(--firuza)' }), "To'lov olindi")),
      read),
    h('div', { class: 'section-title' }, 'Eng katta qarzdorlar'),
    s.top_debtors.length
      ? h('div', { class: 'list' }, ...s.top_debtors.map((d) =>
          h('button', { class: 'row', onClick: () => go(`#/c/${d.id}`) },
            h('div', { class: `avatar av-${hashIdx(d.name)}` }, initial(d.name)),
            h('div', { class: 'info' }, h('div', { class: 'name' }, d.name)),
            h('div', { class: 'bal' }, h('div', { class: 'v debt' }, money(d.balance)), d.overdue_amount > 0 && h('span', { class: 'pill' }, "Muddati o'tgan")))))
      : h('div', { class: 'card' }, h('div', { class: 'setting' }, h('div', { class: 's-hint' }, "Hozircha qarzdor yo'q. Ajoyib!"))),
  );
}

// ---------- Sozlamalar ----------
function settingsView() {
  const me = S.me;
  const shop = h('input', { type: 'text', maxlength: '60', value: me.shop_name ?? '', placeholder: "Masalan: Baraka market", autocomplete: 'off' });
  const saveShop = h('button', { class: 'btn primary block', type: 'submit' }, 'Saqlash');

  const sw = h('button', {
    class: 'switch', role: 'switch', 'aria-checked': String(me.reminders_enabled), 'aria-label': 'Kundalik eslatmalar',
    onClick: async () => {
      const next = sw.getAttribute('aria-checked') !== 'true';
      sw.setAttribute('aria-checked', String(next));
      try {
        S.me = (await api('PATCH', '/api/me', { reminders_enabled: next })).user;
        toast(next ? 'Eslatmalar yoqildi' : "Eslatmalar o'chirildi");
      } catch (e) {
        sw.setAttribute('aria-checked', String(!next));
        toast(e.message, 'error');
      }
    },
  });

  const exportBtn = h('button', {
    class: 'btn soft block',
    onClick: async () => {
      exportBtn.disabled = true;
      try {
        const r = await api('POST', '/api/export');
        toast(`${r.rows} ta yozuv botga yuborildi`);
      } catch (e) { toast(e.message, 'error'); }
      exportBtn.disabled = false;
    },
  }, icon('send'), 'CSV faylni botga yuborish');

  mount(
    h('div', { class: 'topbar' }, h('h1', null, 'Sozlamalar')),
    h('form', {
      class: 'card', style: 'padding:16px',
      onSubmit: async (e) => {
        e.preventDefault();
        saveShop.disabled = true;
        try { S.me = (await api('PATCH', '/api/me', { shop_name: shop.value })).user; toast('Saqlandi'); }
        catch (ex) { toast(ex.message, 'error'); }
        saveShop.disabled = false;
      },
    }, field("Do'kon nomi", shop), saveShop),
    h('div', { class: 'section-title' }, 'Eslatmalar'),
    h('div', { class: 'card' },
      h('div', { class: 'setting' },
        h('div', null, h('div', { class: 's-title' }, "Muddati o'tgan qarzlar"), h('div', { class: 's-hint' }, 'Har kuni ertalab botdan xabar keladi')),
        sw),
    ),
    h('div', { class: 'section-title' }, "Ma'lumotlar"),
    h('div', { class: 'card', style: 'padding:14px 16px' }, exportBtn,
      h('div', { class: 's-hint', style: 'margin-top:8px;font-size:13px;color:var(--muted)' }, 'Barcha qarz va to\'lov yozuvlari CSV fayl bo\'lib shu chatga keladi.')),
    h('p', { class: 'footnote' }, `Qarz daftari · Telegram ID: ${me.telegram_id}`),
  );
}

// ---------- Ishga tushirish ----------
window.addEventListener('hashchange', () => {
  sheets.slice().forEach((s) => s.close());
  render();
});
render();
