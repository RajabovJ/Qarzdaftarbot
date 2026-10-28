import crypto from 'node:crypto';

/**
 * Telegram WebApp initData imzosini tekshiradi.
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 * Muvaffaqiyatli bo'lsa { user, authDate } qaytaradi, aks holda null.
 */
export function verifyInitData(initData, botToken, maxAgeSec = 86400, nowMs = Date.now()) {
  if (typeof initData !== 'string' || !initData || initData.length > 4096 || !botToken) return null;

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash || !/^[0-9a-f]{64}$/i.test(hash)) return null;
  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expected = crypto.createHmac('sha256', secret).update(dataCheckString).digest();
  const given = Buffer.from(hash, 'hex');
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;

  const authDate = Number(params.get('auth_date'));
  if (!Number.isFinite(authDate) || authDate <= 0) return null;
  const age = nowMs / 1000 - authDate;
  if (age > maxAgeSec || age < -300) return null;

  let user;
  try {
    user = JSON.parse(params.get('user') ?? '');
  } catch {
    return null;
  }
  if (!user || !Number.isSafeInteger(user.id) || user.id <= 0 || user.is_bot) return null;
  return { user, authDate };
}

export class TelegramError extends Error {
  constructor(method, code, description, retryAfter) {
    super(`Telegram ${method}: ${code} ${description}`);
    this.method = method;
    this.code = code;
    this.description = description;
    this.retryAfter = retryAfter;
  }
  /** Foydalanuvchi botni bloklagan yoki chat yo'q */
  get userGone() {
    return this.code === 403 || (this.code === 400 && /chat not found/i.test(this.description));
  }
}

export function createTelegram({ token, apiBase = 'https://api.telegram.org', fetchImpl = fetch }) {
  const url = (method) => `${apiBase}/bot${token}/${method}`;

  async function parse(method, res) {
    let data;
    try {
      data = await res.json();
    } catch {
      throw new TelegramError(method, res.status, 'Javob JSON emas');
    }
    if (!data.ok) {
      throw new TelegramError(method, data.error_code ?? res.status, data.description ?? 'Noma\'lum xato', data.parameters?.retry_after);
    }
    return data.result;
  }

  async function call(method, payload = {}, signal) {
    const res = await fetchImpl(url(method), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
    });
    return parse(method, res);
  }

  return {
    enabled: Boolean(token),
    call,
    sendMessage: (chatId, text, extra = {}) =>
      call('sendMessage', { chat_id: chatId, text, link_preview_options: { is_disabled: true }, ...extra }),
    async sendDocument(chatId, filename, content, caption) {
      const form = new FormData();
      form.append('chat_id', String(chatId));
      if (caption) form.append('caption', caption);
      form.append('document', new Blob([content], { type: 'text/csv' }), filename);
      const res = await fetchImpl(url('sendDocument'), { method: 'POST', body: form });
      return parse('sendDocument', res);
    },
    setWebhook: (webhookUrl, secretToken) =>
      call('setWebhook', {
        url: webhookUrl,
        secret_token: secretToken,
        allowed_updates: ['message', 'my_chat_member'],
        drop_pending_updates: false,
      }),
    deleteWebhook: () => call('deleteWebhook', { drop_pending_updates: false }),
    getUpdates: (offset, timeout, signal) =>
      call('getUpdates', { offset, timeout, allowed_updates: ['message', 'my_chat_member'] }, signal),
  };
}
