import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { HttpError, log } from './util.js';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
};

// ---------- Router ----------

function compile(pattern) {
  const keys = [];
  const re = pattern.replace(/\/:(\w+)/g, (_, k) => {
    keys.push(k);
    return '/([^/]+)';
  });
  return { regex: new RegExp(`^${re}/?$`), keys };
}

export class Router {
  routes = [];

  add(method, pattern, ...handlers) {
    this.routes.push({ method, ...compile(pattern), handlers });
    return this;
  }
  get(p, ...h) { return this.add('GET', p, ...h); }
  post(p, ...h) { return this.add('POST', p, ...h); }
  patch(p, ...h) { return this.add('PATCH', p, ...h); }
  delete(p, ...h) { return this.add('DELETE', p, ...h); }

  match(method, pathname) {
    let pathMatched = false;
    for (const r of this.routes) {
      const m = r.regex.exec(pathname);
      if (!m) continue;
      pathMatched = true;
      if (r.method !== method) continue;
      const params = {};
      r.keys.forEach((k, i) => {
        try {
          params[k] = decodeURIComponent(m[i + 1]);
        } catch {
          params[k] = m[i + 1];
        }
      });
      return { route: r, params };
    }
    return { route: null, pathMatched };
  }
}

// ---------- Javob yordamchilari ----------

export function sendJson(res, status, data, headers = {}) {
  if (res.headersSent) return;
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    ...headers,
  });
  res.end(body);
}

export function readJson(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    const type = req.headers['content-type'] ?? '';
    if (!/^application\/json/i.test(type)) {
      // Bo'sh tanali so'rovlarga ruxsat beramiz
      if (req.headers['content-length'] === '0' || req.headers['content-length'] === undefined) {
        req.resume();
        return resolve({});
      }
      req.resume();
      return reject(new HttpError(415, "Content-Type application/json bo'lishi kerak"));
    }
    const chunks = [];
    let size = 0;
    let tooBig = false;
    req.on('data', (c) => {
      if (tooBig) return;
      size += c.length;
      if (size > limit) {
        tooBig = true;
        chunks.length = 0;
        reject(new HttpError(413, "So'rov juda katta"));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (tooBig) return;
      if (!size) return resolve({});
      try {
        const v = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (v === null || typeof v !== 'object' || Array.isArray(v)) throw new Error('not object');
        resolve(v);
      } catch {
        reject(new HttpError(400, "JSON noto'g'ri"));
      }
    });
    req.on('error', reject);
  });
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

// ---------- Sekinlashtirish (rate limit) ----------

export function rateLimiter({ windowMs, max, key = (ctx) => ctx.ip }) {
  const hits = new Map();
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
  }, windowMs);
  timer.unref();

  return (ctx) => {
    const k = key(ctx);
    const now = Date.now();
    let h = hits.get(k);
    if (!h || h.reset <= now) {
      h = { count: 0, reset: now + windowMs };
      hits.set(k, h);
    }
    h.count += 1;
    if (h.count > max) {
      ctx.res.setHeader('retry-after', Math.ceil((h.reset - now) / 1000));
      throw new HttpError(429, "Juda ko'p urinish. Birozdan so'ng qayta urinib ko'ring.");
    }
  };
}

// ---------- Statik fayllar ----------

export function createStaticHandler(root) {
  const base = path.resolve(root);

  return async function serveStatic(req, res, pathname) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return false;

    let rel;
    try {
      rel = decodeURIComponent(pathname);
    } catch {
      return false;
    }
    if (rel.includes('\0')) return false;
    if (rel === '/admin') {
      res.writeHead(301, { location: '/admin/' });
      res.end();
      return true;
    }
    if (rel.endsWith('/')) rel += 'index.html';

    const file = path.resolve(base, `.${rel}`);
    if (file !== base && !file.startsWith(base + path.sep)) return false;
    if (path.basename(file).startsWith('.')) return false;

    let stat;
    try {
      stat = await fs.promises.stat(file);
    } catch {
      return false;
    }
    if (!stat.isFile()) return false;

    const ext = path.extname(file).toLowerCase();
    const etag = `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
    const headers = {
      'content-type': MIME[ext] ?? 'application/octet-stream',
      'cache-control': 'no-cache',
      etag,
    };
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, headers);
      res.end();
      return true;
    }
    headers['content-length'] = stat.size;
    res.writeHead(200, headers);
    if (req.method === 'HEAD') {
      res.end();
      return true;
    }
    fs.createReadStream(file).pipe(res);
    return true;
  };
}

// ---------- Imzolangan token (admin sessiyasi) ----------

export function signToken(payload, secret) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyToken(token, secret) {
  if (typeof token !== 'string') return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (typeof payload.exp !== 'number' || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// ---------- Asosiy so'rov ishlovchisi ----------

export function clientIp(req, trustProxy) {
  if (trustProxy) {
    const xff = req.headers['x-forwarded-for'];
    if (typeof xff === 'string' && xff) return xff.split(',').pop().trim();
  }
  return req.socket.remoteAddress ?? 'unknown';
}

/**
 * Router + statik fayllarni bitta http handlerga birlashtiradi.
 */
export function createRequestHandler({ router, serveStatic, trustProxy, securityHeaders }) {
  return async function handler(req, res) {
    const started = Date.now();
    try {
      for (const [k, v] of Object.entries(securityHeaders(req))) res.setHeader(k, v);

      const url = new URL(req.url, 'http://localhost');
      const pathname = url.pathname;
      const apiLike = /^\/(api|admin\/api|telegram|healthz)(\/|$)/.test(pathname);

      if (apiLike) {
        const { route, params, pathMatched } = router.match(req.method, pathname);
        if (!route) {
          throw new HttpError(pathMatched ? 405 : 404, pathMatched ? 'Usul ruxsat etilmagan' : 'Topilmadi');
        }
        const ctx = {
          req,
          res,
          url,
          pathname,
          params,
          query: Object.fromEntries(url.searchParams),
          ip: clientIp(req, trustProxy),
          body: {},
          state: {},
        };
        if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method)) ctx.body = await readJson(req);

        const handlers = route.handlers;
        for (let i = 0; i < handlers.length - 1; i++) await handlers[i](ctx);
        const result = await handlers[handlers.length - 1](ctx);
        if (result !== undefined && !res.writableEnded) sendJson(res, 200, result);
        else if (result === undefined && !res.writableEnded) sendJson(res, 200, { ok: true });
        return;
      }

      if (await serveStatic(req, res, pathname)) return;
      throw new HttpError(404, 'Topilmadi');
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status >= 500) log('error', `${req.method} ${req.url} -> ${err.stack ?? err}`);
      const acceptsHtml = (req.headers.accept ?? '').includes('text/html') && !/^\/(api|admin\/api)\//.test(req.url);
      if (acceptsHtml && !res.headersSent) {
        const msg = status === 404 ? 'Sahifa topilmadi' : 'Xatolik yuz berdi';
        res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' });
        res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${msg}</title><body style="font-family:system-ui;padding:3rem;text-align:center"><h1>${status}</h1><p>${msg}</p>`);
      } else {
        sendJson(res, status, {
          error: status >= 500 ? "Serverda xatolik yuz berdi. Keyinroq qayta urinib ko'ring." : err.message,
          ...(err.code ? { code: err.code } : {}),
        });
      }
    } finally {
      if (process.env.LOG_REQUESTS === '1') log('info', `${req.method} ${req.url} ${res.statusCode} ${Date.now() - started}ms`);
    }
  };
}
