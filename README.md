# Qarz daftari — Telegram Mini App

Do'kon egalari uchun qarz daftari: mijozlar, berilgan qarzlar, olingan to'lovlar, muddati o'tgan qarzlar haqida eslatma va hisobotlar. Telegram ichida (Mini App) ishlaydi. Bot egasi uchun admin panel bor: foydalanuvchilar statistikasi, bloklash va ommaviy xabar yuborish.

**Texnologiyalar:** Node.js 22+ (tashqi paketlarsiz: `node:http`, `node:sqlite`, `fetch`), SQLite, oddiy HTML/CSS/JS.
`npm install` **kerak emas**.

## Imkoniyatlar

**Do'kon egasi (Mini App)**
- Mijozlar ro'yxati, qidiruv (ism yoki telefon), filtrlar: Hammasi / Qarzdorlar / Muddati o'tgan
- «Qarz berdim» va «To'lov oldim»: summa, sana, izoh, qaytarish muddati (7/15/30 kun yoki sana)
- To'lovlar eng eski qarzdan boshlab yopiladi (FIFO), muddati o'tgan summa aniq hisoblanadi
- «Hammasi to'landi» uchun «To'liq» tugmasi, ortiqcha to'lov «Avans» sifatida ko'rinadi
- Mijozga SMS eslatma matni (tayyor matn, nusxalash yoki ulashish)
- Hisobot: oy bo'yicha jami, oxirgi 14 kun grafigi, eng katta qarzdorlar
- Har kuni ertalab botdan muddati o'tgan qarzlar haqida xabar (sozlamalarda o'chirish mumkin)
- Barcha yozuvlarni CSV (Excel) fayl qilib botga yuborish
- Telegram mavzusi (yorug'/qorong'i) va telefon uchun mo'ljallangan dizayn

**Admin panel (`/admin/`)**
- Jami / yangi / faol (kunlik, 7 va 30 kunlik) foydalanuvchilar, 30 kunlik grafiklar
- Daftarlardagi umumiy ko'rsatkichlar: mijozlar, yozuvlar, berilgan qarz, olingan to'lov, hozirgi qarz
- Foydalanuvchilar jadvali: qidiruv, saralash, har birining mijozlari/yozuvlari/qarzi, oxirgi faolligi
- Foydalanuvchini bloklash / blokdan chiqarish
- Barcha faol foydalanuvchilarga ommaviy xabar

## Tezkor ishga tushirish (kompyuteringizda)

Kerak: **Node.js 22.13 yoki yangiroq** (`node -v` bilan tekshiring).

```bash
git clone https://github.com/RajabovJ/Qarzdaftarbot.git
cd Qarzdaftarbot
cp .env.example .env        # so'ng .env ni to'ldiring
npm start
```

Telegramsiz ko'rib chiqish uchun `.env` da `NODE_ENV=development`, `DEV_MODE=true`, `BOT_MODE=off` qo'ying, so'ng:

```bash
npm run seed                # demo ma'lumotlar (ixtiyoriy)
npm start
# http://localhost:3000/?dev=1      — mini-ilova
# http://localhost:3000/admin/      — admin panel
```

## Botni sozlash (bir marta)

1. [@BotFather](https://t.me/BotFather) da `/newbot` bilan bot yarating va tokenni `.env` dagi `BOT_TOKEN` ga yozing.
2. Ilova **HTTPS** manzilda bo'lishi shart (Telegram talabi). Manzilni `WEBAPP_URL` ga yozing, masalan `https://qarz.example.uz`.
3. Serverni ishga tushiring. Server o'zi webhook, `/start` `/stat` `/help` buyruqlari va «Daftar» menyu tugmasini o'rnatadi.
4. (Ixtiyoriy) BotFather → `/mybots` → botingiz → *Bot Settings → Menu Button* da yana bir marta tekshirib chiqing.

HTTPS manzilsiz sinab ko'rmoqchi bo'lsangiz, Cloudflare Tunnel yoki ngrok bilan vaqtinchalik HTTPS manzil oling va `WEBAPP_URL` ga qo'ying.

## Serverga joylash (VPS, Ubuntu)

```bash
# Node.js 22 o'rnating (masalan nvm bilan), so'ng:
git clone https://github.com/RajabovJ/Qarzdaftarbot.git /opt/qarzdaftar
cd /opt/qarzdaftar && cp .env.example .env && nano .env
```

**systemd xizmati** — `/etc/systemd/system/qarzdaftar.service`:

```ini
[Unit]
Description=Qarz daftari
After=network.target

[Service]
WorkingDirectory=/opt/qarzdaftar
ExecStart=/usr/bin/node --disable-warning=ExperimentalWarning src/index.js
Restart=always
User=www-data
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

```bash
sudo chown -R www-data /opt/qarzdaftar
sudo systemctl enable --now qarzdaftar
```

**Nginx + HTTPS** (`TRUST_PROXY=true` bo'lsin):

```nginx
server {
    server_name qarz.example.uz;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
    }
}
```

```bash
sudo certbot --nginx -d qarz.example.uz
```

**Yangilash:** `git pull && sudo systemctl restart qarzdaftar` (baza sxemasi avtomatik yangilanadi).

**Zaxira nusxa:** ma'lumotlar bitta fayl: `data/qarzdaftar.sqlite`. Uni muntazam nusxalab turing (`sqlite3 data/qarzdaftar.sqlite ".backup backup.sqlite"` xavfsiz usul).

## Sozlamalar (`.env`)

| O'zgaruvchi | Izoh |
|---|---|
| `BOT_TOKEN` | BotFather tokeni (majburiy) |
| `WEBAPP_URL` | Ilovaning `https://` manzili (majburiy) |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD` | Admin panelga kirish. Parol kamida 8 belgi |
| `SESSION_SECRET` | Admin sessiyasini imzolash uchun uzun tasodifiy qator |
| `BOT_MODE` | `webhook` (standart), `polling` yoki `off` |
| `TRUST_PROXY` | Nginx/Cloudflare orqasida `true` |
| `TZ_NAME` | Vaqt zonasi, standart `Asia/Tashkent` |
| `REMINDER_HOUR` | Kundalik eslatma soati (standart 9) |
| `DB_PATH` | Baza fayli, standart `data/qarzdaftar.sqlite` |
| `DEV_MODE` | Faqat lokal sinash uchun. Production'da server uni rad etadi |

## Xavfsizlik

- Mini-ilova har bir so'rovda Telegram `initData` imzosini serverda tekshiradi (HMAC-SHA256, 24 soatdan eski bo'lsa rad etiladi). Foydalanuvchi faqat o'z ma'lumotini ko'radi.
- Webhook maxfiy kalit sarlavhasi bilan himoyalangan.
- Admin: imzolangan, `HttpOnly` + `SameSite=Strict` cookie; CSRF sarlavhasi; kirish urinishlari cheklangan (15 daqiqada 10 ta).
- Hamma kiruvchi ma'lumot tekshiriladi, SQL so'rovlar parametrlangan, interfeysda matn faqat `textContent` orqali chiqariladi (XSS yo'q), CSV eksportda formula in'ektsiyasidan himoya bor.
- Production rejimida `BOT_TOKEN`, `https` manzil, kuchli parol va `SESSION_SECRET` bo'lmasa, server ishga tushmaydi.

## Testlar

```bash
npm test      # 53 ta avtomatik test: imzo, hisob-kitob, ajratilgan ma'lumotlar, admin, bot, eslatmalar
```

## Loyiha tuzilmasi

```
src/            server, API, bot, admin, eslatmalar, baza
public/         mini-ilova (index.html, app.js, app.css)
public/admin/   admin panel
scripts/        demo ma'lumotlar (npm run seed)
test/           avtomatik testlar
```
