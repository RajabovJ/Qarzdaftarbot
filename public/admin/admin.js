// Admin panel (framework'siz). CSP sababli inline style ishlatilmaydi.

const root = document.getElementById('root');
const NB = ' ';
const fmt = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, NB);
const MONTHS = ['yan', 'fev', 'mar', 'apr', 'may', 'iyn', 'iyl', 'avg', 'sen', 'okt', 'noy', 'dek'];

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
  home: '<path d="M4 11l8-7 8 7v9H4z"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0113 0M16 4.5a3.5 3.5 0 010 7M18 14a6.5 6.5 0 013.5 6"/>',
  send: '<path d="M21 3L10 14M21 3l-7 18-4-7-7-4z"/>',
  out: '<path d="M14 4h5a1 1 0 011 1v14a1 1 0 01-1 1h-5M10 8l-4 4 4 4M6 12h10"/>',
};
function icon(name) {
  const s = h('span', { class: 'ico', 'aria-hidden': 'true' });
  s.innerHTML = `<svg viewBox="0 0 24 24">${ICONS[name] ?? ''}</svg>`;
  return s;
}

let toastTimer;
function toast(msg, kind = 'ok') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast show${kind === 'error' ? ' error' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = 'toast'), 3000);
}

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
async function api(method, path, body) {
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: { 'x-requested-with': 'qarzdaftar', ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'Server bilan aloqa yo\'q');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && path !== '/admin/api/login') showLogin();
    throw new ApiError(res.status, data.error || 'Xatolik');
  }
  return data;
}

function ago(iso) {
  if (!iso) return '—';
  const sec = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (sec < 60) return 'hozir';
  if (sec < 3600) return `${Math.floor(sec / 60)} daqiqa oldin`;
  if (sec < 86400) return `${Math.floor(sec / 3600)} soat oldin`;
  if (sec < 86400 * 30) return `${Math.floor(sec / 86400)} kun oldin`;
  return new Date(iso).toLocaleDateString('uz-UZ', { year: 'numeric', month: 'short', day: 'numeric' });
}
const dayLabel = (s) => {
  const [, m, d] = s.split('-').map(Number);
  return `${d}${NB}${MONTHS[m - 1]}`;
};

function confirmDialog(title, text, okLabel, danger = false) {
  return new Promise((resolve) => {
    const close = (v) => {
      backdrop.remove();
      resolve(v);
    };
    const backdrop = h('div', { class: 'dialog-backdrop', onClick: (e) => e.target === backdrop && close(false) },
      h('div', { class: 'dialog', role: 'alertdialog', 'aria-modal': 'true', 'aria-label': title },
        h('h2', null, title), h('p', null, text),
        h('div', { class: 'row' },
          h('button', { class: 'btn soft', onClick: () => close(false) }, 'Bekor qilish'),
          h('button', { class: `btn ${danger ? 'danger' : 'primary'}`, onClick: () => close(true) }, okLabel))));
    document.body.append(backdrop);
    backdrop.querySelector('.btn.soft').focus();
  });
}

// ---------- Kirish ----------
function showLogin(message) {
  stopPolling();
  const user = h('input', { type: 'text', name: 'username', autocomplete: 'username', value: 'admin', required: true });
  const pass = h('input', { type: 'password', name: 'password', autocomplete: 'current-password', required: true });
  const err = h('p', { class: 'err', hidden: !message }, message ?? '');
  const btn = h('button', { class: 'btn primary block', type: 'submit' }, 'Kirish');
  root.replaceChildren(
    h('div', { class: 'login-wrap' },
      h('form', {
        class: 'login',
        onSubmit: async (e) => {
          e.preventDefault();
          btn.disabled = true;
          err.hidden = true;
          try {
            await api('POST', '/admin/api/login', { username: user.value, password: pass.value });
            boot();
          } catch (ex) {
            err.textContent = ex.message;
            err.hidden = false;
            btn.disabled = false;
            pass.select();
          }
        },
      },
        h('h1', null, 'Qarz daftari'),
        h('p', null, 'Administrator paneliga kirish'),
        h('label', { class: 'field' }, h('span', null, 'Login'), user),
        h('label', { class: 'field' }, h('span', null, 'Parol'), pass),
        err, btn)),
  );
  pass.focus();
}

// ---------- Maket ----------
const NAV = [['#/', 'home', "Umumiy ko'rinish"], ['#/users', 'users', 'Foydalanuvchilar'], ['#/broadcast', 'send', 'Xabar yuborish']];
const view = h('div', { class: 'main' });
let currentRoute = '';

function shell() {
  const side = h('aside', { class: 'side' },
    h('div', { class: 'brand' }, brandMark(), 'Qarz daftari'),
    ...NAV.map(([hash, ic, label]) => h('a', { href: hash, 'data-route': hash }, icon(ic), label)),
    h('div', { class: 'spacer' }),
    h('button', {
      class: 'link',
      onClick: async () => {
        await api('POST', '/admin/api/logout').catch(() => {});
        showLogin();
      },
    }, icon('out'), 'Chiqish'),
  );
  root.replaceChildren(h('div', { class: 'shell' }, side, view));
}

function brandMark() {
  const s = h('span', { class: 'mark' });
  s.innerHTML =
    '<svg viewBox="0 0 32 32" width="32" height="32" aria-hidden="true"><rect width="32" height="32" rx="8" fill="#fff" fill-opacity=".12"/><path d="M9 8h13a1 1 0 011 1v15H10a1 1 0 01-1-1z" fill="none" stroke="#fff" stroke-width="2"/><path d="M13 8v16" stroke="#FF6B83" stroke-width="2"/></svg>';
  return s;
}

function markNav() {
  const hash = location.hash || '#/';
  document.querySelectorAll('.side a').forEach((a) => {
    if (a.dataset.route === hash) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
}

async function boot() {
  try {
    await api('GET', '/admin/api/me');
  } catch (e) {
    if (e.status !== 401) showLogin(e.message);
    return;
  }
  shell();
  navigate();
}

function navigate() {
  stopPolling();
  const hash = location.hash || '#/';
  currentRoute = hash;
  markNav();
  view.replaceChildren(h('p', { class: 'sub' }, 'Yuklanmoqda…'));
  const page = hash === '#/users' ? usersPage : hash === '#/broadcast' ? broadcastPage : dashboardPage;
  page().catch((e) => {
    if (e.status !== 401 && currentRoute === hash) view.replaceChildren(h('p', { class: 'err' }, e.message));
  });
}
window.addEventListener('hashchange', () => document.querySelector('.shell') && navigate());

// ---------- Boshqaruv paneli ----------
function statCard(label, value, { delta, unit, cls = '' } = {}) {
  return h('div', { class: `card stat ${cls}` },
    h('div', { class: 'label' }, label),
    h('div', { class: 'value' }, typeof value === 'number' ? fmt(value) : value, unit && h('small', null, ` ${unit}`)),
    delta && h('div', { class: 'delta' }, delta));
}

function barChart(title, series, key, color) {
  const W = 520, H = 190, padL = 34, padB = 22, padT = 8;
  const max = Math.max(1, ...series.map((d) => d[key]));
  const niceMax = (() => {
    const p = 10 ** Math.floor(Math.log10(max));
    return ([1, 2, 2.5, 5, 10].find((k) => k * p >= max) ?? 10) * p;
  })();
  const step = (W - padL - 6) / series.length;
  const bw = Math.max(4, step - 5);
  const plotH = H - padB - padT;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', title);
  const mk = (tag, attrs, text) => {
    const e = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    if (text !== undefined) e.textContent = text;
    svg.append(e);
    return e;
  };
  const hint = h('p', { class: 'hint' }, 'Ustunni bosing yoki ustiga olib boring');
  for (const f of [0, 0.5, 1]) {
    const y = padT + plotH * (1 - f);
    mk('line', { x1: padL, x2: W - 6, y1: y, y2: y, class: 'grid' });
    mk('text', { x: padL - 6, y: y + 3, class: 'gv', 'text-anchor': 'end' }, String(+(niceMax * f).toFixed(1)));
  }
  series.forEach((d, i) => {
    const x = padL + step * i + (step - bw) / 2;
    const hgt = (d[key] / niceMax) * plotH;
    const show = () => (hint.textContent = `${dayLabel(d.date)}: ${fmt(d[key])}`);
    const rect = mk('rect', { x, y: padT + plotH - Math.max(hgt, d[key] ? 2 : 0), width: bw, height: Math.max(hgt, d[key] ? 2 : 0), rx: 3, fill: color, class: 'bar' });
    const hit = mk('rect', { x: padL + step * i, y: 0, width: step, height: H - padB, fill: 'transparent', class: 'bar' });
    for (const el of [rect, hit]) {
      el.addEventListener('mouseenter', show);
      el.addEventListener('click', show);
    }
    if (i % 5 === 0 || i === series.length - 1) {
      const last = i === series.length - 1;
      mk('text', { x: last ? W - 4 : x + bw / 2, y: H - 6, class: last ? 'tick end' : 'tick' }, dayLabel(d.date));
    }
  });
  return h('div', { class: 'card chart' }, h('h3', null, title), hint, svg);
}

async function dashboardPage() {
  const s = await api('GET', '/admin/api/stats');
  if (currentRoute !== '#/' && currentRoute !== '') return;
  const u = s.users;
  const l = s.ledger;
  view.replaceChildren(
    h('h1', null, "Umumiy ko'rinish"),
    h('p', { class: 'sub' }, `Bugun: ${dayLabel(s.today)} · ma'lumotlar real vaqtda`),
    h('div', { class: 'cards' },
      statCard('Jami foydalanuvchilar', u.total, { delta: h('span', null, h('b', null, `+${u.new_today}`), ' bugun') }),
      statCard('Bugun faol', u.active_today, { delta: `${u.total ? Math.round((u.active_today / u.total) * 100) : 0}% foydalanuvchilar` }),
      statCard('7 kunda faol', u.active_7d),
      statCard('30 kunda faol', u.active_30d)),
    h('div', { class: 'cards' },
      statCard('Yangi (7 kun)', u.new_7d),
      statCard('Yangi (30 kun)', u.new_30d),
      statCard('Daftar yuritayotganlar', u.with_customers, { delta: 'kamida 1 mijoz qo\'shgan' }),
      statCard('Bloklanganlar', u.blocked, { delta: `Botni to'xtatganlar: ${fmt(u.bot_stopped)}` })),
    h('div', { class: 'grid2' },
      barChart('Yangi foydalanuvchilar (30 kun)', s.series, 'signups', 'var(--primary)'),
      barChart('Faol foydalanuvchilar (30 kun)', s.series, 'active', 'var(--firuza)')),
    h('div', { class: 'section-title' }, 'Daftarlardagi umumiy ko\'rsatkichlar'),
    h('div', { class: 'cards five' },
      statCard('Mijozlar', l.customers),
      statCard('Yozuvlar', l.transactions),
      statCard('Berilgan qarz', l.given, { unit: "so'm" }),
      statCard("Olingan to'lov", l.received, { unit: "so'm", cls: 'ok' }),
      statCard('Hozirgi qarz', l.outstanding, { unit: "so'm", cls: 'debt', delta: 'barcha do\'konlar bo\'yicha' })),
  );
}

// ---------- Foydalanuvchilar ----------
const U = { q: '', sort: 'created', status: '', page: 1 };

async function usersPage() {
  const body = h('div');
  const pager = h('div', { class: 'pager' });
  let timer;

  const search = h('input', {
    type: 'search', placeholder: 'Ism, @username, do\'kon yoki Telegram ID', value: U.q, 'aria-label': 'Qidirish',
    onInput: (e) => { U.q = e.target.value; U.page = 1; clearTimeout(timer); timer = setTimeout(load, 250); },
  });
  const sort = h('select', { 'aria-label': 'Saralash', onChange: (e) => { U.sort = e.target.value; U.page = 1; load(); } },
    ...[['created', "Ro'yxatdan o'tgan sana"], ['last_seen', 'Oxirgi faollik'], ['customers', 'Mijozlar soni'], ['transactions', 'Yozuvlar soni'], ['outstanding', 'Qarz summasi']]
      .map(([v, l]) => h('option', { value: v, selected: U.sort === v }, l)));
  const status = h('select', { 'aria-label': 'Holat', onChange: (e) => { U.status = e.target.value; U.page = 1; load(); } },
    ...[['', 'Barchasi'], ['active', 'Faollar'], ['blocked', 'Bloklanganlar']].map(([v, l]) => h('option', { value: v, selected: U.status === v }, l)));

  view.replaceChildren(
    h('h1', null, 'Foydalanuvchilar'),
    h('p', { class: 'sub', id: 'users-sub' }, ''),
    h('div', { class: 'toolbar' }, search, sort, status),
    body, pager);

  async function load() {
    const qs = new URLSearchParams({ page: U.page, sort: U.sort });
    if (U.q.trim()) qs.set('q', U.q.trim());
    if (U.status) qs.set('status', U.status);
    const data = await api('GET', `/admin/api/users?${qs}`).catch((e) => { toast(e.message, 'error'); return null; });
    if (!data || currentRoute !== '#/users') return;
    document.getElementById('users-sub').textContent = `Jami: ${fmt(data.total)} ta`;

    if (!data.users.length) {
      body.replaceChildren(h('div', { class: 'table-wrap' }, h('div', { class: 'empty' }, 'Hech narsa topilmadi')));
    } else {
      body.replaceChildren(h('div', { class: 'table-wrap' }, h('table', null,
        h('thead', null, h('tr', null,
          h('th', null, 'Foydalanuvchi'), h('th', null, "Do'kon"), h('th', { class: 'num' }, 'Mijozlar'), h('th', { class: 'num' }, 'Yozuvlar'),
          h('th', { class: 'num' }, "Qarz (so'm)"), h('th', null, "Ro'yxatdan o'tgan"), h('th', null, 'Oxirgi faollik'), h('th', null, 'Holat'), h('th', null, ''))),
        h('tbody', null, ...data.users.map(userRow)))));
    }

    pager.replaceChildren(
      h('span', null, `${data.page} / ${data.pages} sahifa`),
      h('div', { class: 'btns' },
        h('button', { class: 'btn soft small', disabled: data.page <= 1, onClick: () => { U.page -= 1; load(); } }, '‹ Oldingi'),
        h('button', { class: 'btn soft small', disabled: data.page >= data.pages, onClick: () => { U.page += 1; load(); } }, 'Keyingi ›')));
  }

  function userRow(u) {
    const name = [u.first_name, u.last_name].filter(Boolean).join(' ') || `ID ${u.telegram_id}`;
    const badge = u.is_blocked ? h('span', { class: 'badge off' }, 'Bloklangan')
      : u.bot_stopped ? h('span', { class: 'badge warn', title: "Botni to'xtatgan: xabar yuborilmaydi" }, "Bot to'xtagan")
      : h('span', { class: 'badge ok' }, 'Faol');
    return h('tr', null,
      h('td', null, h('div', { class: 'who' }, h('b', null, name), h('span', null, `${u.username ? `@${u.username} · ` : ''}${u.telegram_id}`))),
      h('td', null, u.shop_name || '—'),
      h('td', { class: 'num' }, fmt(u.customers)),
      h('td', { class: 'num' }, fmt(u.transactions)),
      h('td', { class: 'num' }, u.outstanding ? fmt(u.outstanding) : '—'),
      h('td', { title: u.created_at }, ago(u.created_at)),
      h('td', { title: u.last_seen_at ?? '' }, ago(u.last_seen_at)),
      h('td', null, badge),
      h('td', null, h('button', {
        class: `btn small ${u.is_blocked ? 'ok' : 'danger'}`,
        onClick: async () => {
          const block = !u.is_blocked;
          const ok = await confirmDialog(block ? 'Foydalanuvchini bloklash' : 'Blokdan chiqarish',
            block ? `${name} ilovadan foydalana olmaydi. Ma'lumotlari saqlanib qoladi.` : `${name} yana ilovadan foydalana oladi.`,
            block ? 'Bloklash' : 'Blokdan chiqarish', block);
          if (!ok) return;
          try {
            await api('POST', `/admin/api/users/${u.id}/block`, { blocked: block });
            toast(block ? 'Bloklandi' : 'Blokdan chiqarildi');
            load();
          } catch (e) { toast(e.message, 'error'); }
        },
      }, u.is_blocked ? 'Chiqarish' : 'Bloklash')));
  }

  await load();
}

// ---------- Ommaviy xabar ----------
let pollTimer = null;
function stopPolling() {
  clearInterval(pollTimer);
  pollTimer = null;
}

async function broadcastPage() {
  const stats = await api('GET', '/admin/api/stats');
  const recipients = stats.users.total - stats.users.blocked - stats.users.bot_stopped;

  const text = h('textarea', { maxlength: '3500', placeholder: 'Xabar matni. Oddiy matn sifatida yuboriladi.' });
  const counter = h('div', { class: 'counter' }, '0 / 3500');
  text.addEventListener('input', () => (counter.textContent = `${text.value.length} / 3500`));
  const bar = h('i');
  const status = h('p', { class: 'sub' }, '');
  const send = h('button', { class: 'btn primary', type: 'submit' }, icon('send'), 'Yuborish');

  const render = (s) => {
    const done = s.sent + s.failed;
    bar.style.width = s.total ? `${Math.round((done / s.total) * 100)}%` : '0%';
    status.textContent = s.total
      ? `${s.running ? 'Yuborilmoqda' : 'Tugadi'}: ${fmt(done)} / ${fmt(s.total)} · yetkazildi: ${fmt(s.sent)} · xato: ${fmt(s.failed)}`
      : '';
    send.disabled = s.running;
  };
  const poll = () => {
    stopPolling();
    pollTimer = setInterval(async () => {
      try {
        const s = await api('GET', '/admin/api/broadcast');
        render(s);
        if (!s.running) stopPolling();
      } catch { stopPolling(); }
    }, 1000);
  };

  view.replaceChildren(
    h('h1', null, 'Xabar yuborish'),
    h('p', { class: 'sub' }, `Xabar botni bloklamagan ${fmt(recipients)} ta foydalanuvchiga yuboriladi.`),
    h('form', {
      class: 'card compose',
      onSubmit: async (e) => {
        e.preventDefault();
        if (!text.value.trim()) { toast('Xabar matnini kiriting', 'error'); return; }
        const ok = await confirmDialog('Xabarni yuborish', `Xabar ${fmt(recipients)} ta foydalanuvchiga yuboriladi. Buni qaytarib bo'lmaydi.`, 'Yuborish');
        if (!ok) return;
        try {
          await api('POST', '/admin/api/broadcast', { text: text.value });
          toast('Yuborish boshlandi');
          poll();
        } catch (ex) { toast(ex.message, 'error'); }
      },
    },
      h('label', { class: 'field' }, h('span', null, 'Xabar matni'), text), counter,
      send, h('div', { class: 'progress' }, bar), status));

  const s = await api('GET', '/admin/api/broadcast');
  if (s.total) render(s);
  if (s.running) poll();
}

boot();
