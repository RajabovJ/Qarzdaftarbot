import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { loadConfig } from '../src/config.js';
import { startTestApp } from './helpers.js';

let t;
before(async () => {
  t = await startTestApp();
});
after(() => t.close());

describe('statik sahifalar', () => {
  test('mini-ilova va admin sahifasi beriladi', async () => {
    const app = await fetch(`${t.base}/`);
    assert.equal(app.status, 200);
    assert.match(app.headers.get('content-type'), /text\/html/);
    assert.match(await app.text(), /Qarz daftari/);

    const admin = await fetch(`${t.base}/admin/`);
    assert.equal(admin.status, 200);
    assert.match(await admin.text(), /admin\.js/);

    for (const f of ['/app.js', '/app.css', '/admin/admin.js', '/admin/admin.css']) {
      assert.equal((await fetch(t.base + f)).status, 200, f);
    }
  });

  test('/admin manzili /admin/ ga yo\'naltiriladi', async () => {
    const res = await fetch(`${t.base}/admin`, { redirect: 'manual' });
    assert.equal(res.status, 301);
    assert.equal(res.headers.get('location'), '/admin/');
  });

  test('ETag bilan 304 qaytadi', async () => {
    const first = await fetch(`${t.base}/app.css`);
    const etag = first.headers.get('etag');
    assert.ok(etag);
    const second = await fetch(`${t.base}/app.css`, { headers: { 'if-none-match': etag } });
    assert.equal(second.status, 304);
  });

  test('xavfsizlik sarlavhalari', async () => {
    const admin = await fetch(`${t.base}/admin/`);
    assert.equal(admin.headers.get('x-frame-options'), 'DENY');
    assert.match(admin.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    assert.equal(admin.headers.get('x-content-type-options'), 'nosniff');

    const app = await fetch(`${t.base}/`);
    const csp = app.headers.get('content-security-policy');
    assert.match(csp, /script-src 'self' https:\/\/telegram\.org/);
    assert.ok(!app.headers.get('x-frame-options'), 'Mini-ilova Telegram ichida ochilishi kerak');
  });

  test("noma'lum sahifa HTML brauzerga 404 sahifa beradi", async () => {
    const res = await fetch(`${t.base}/yoq-sahifa`, { headers: { accept: 'text/html' } });
    assert.equal(res.status, 404);
    assert.match(await res.text(), /Sahifa topilmadi/);
  });
});

describe('sozlamalarni tekshirish', () => {
  test('production rejimida xavfsiz bo\'lmagan sozlamalar rad etiladi', () => {
    assert.throws(() => loadConfig({ NODE_ENV: 'production' }), /SESSION_SECRET/);
    assert.throws(
      () => loadConfig({ NODE_ENV: 'production', BOT_TOKEN: 'x', WEBAPP_URL: 'http://insecure', ADMIN_PASSWORD: 'longenough', SESSION_SECRET: 'a'.repeat(20) }),
      /WEBAPP_URL/,
    );
    assert.throws(
      () => loadConfig({ NODE_ENV: 'production', BOT_TOKEN: 'x', WEBAPP_URL: 'https://a.uz', ADMIN_PASSWORD: 'short', SESSION_SECRET: 'a'.repeat(20) }),
      /ADMIN_PASSWORD/,
    );
    assert.throws(
      () => loadConfig({ NODE_ENV: 'production', BOT_TOKEN: 'x', WEBAPP_URL: 'https://a.uz', ADMIN_PASSWORD: 'longenough', SESSION_SECRET: 'a'.repeat(20), DEV_MODE: '1' }),
      /DEV_MODE/,
    );
    const ok = loadConfig({ NODE_ENV: 'production', BOT_TOKEN: 'x', WEBAPP_URL: 'https://a.uz/', ADMIN_PASSWORD: 'longenough', SESSION_SECRET: 'a'.repeat(20) });
    assert.equal(ok.webappUrl, 'https://a.uz');
  });

  test('DEV_MODE: x-dev-user faqat yoqilganda ishlaydi', async () => {
    const dev = await startTestApp({ DEV_MODE: '1' });
    const res = await fetch(`${dev.base}/api/me`, { headers: { 'x-dev-user': '42' } });
    assert.equal(res.status, 200);
    await dev.close();
  });
});
