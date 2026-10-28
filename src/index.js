import { loadConfig } from './config.js';
import { createApp } from './server.js';
import { log } from './util.js';

try {
  process.loadEnvFile(); // .env faylini o'qiydi (bo'lmasa, o'tkazib yuboradi)
} catch {
  /* .env yo'q — muhit o'zgaruvchilari bilan davom etamiz */
}

process.removeAllListeners('warning'); // node:sqlite "experimental" ogohlantirishini yashiradi
process.on('warning', (w) => {
  if (w.name !== 'ExperimentalWarning') console.warn(w);
});

let config;
try {
  config = loadConfig();
} catch (err) {
  log('error', err.message);
  process.exit(1);
}

const app = createApp(config);
const port = await app.start();
log('info', `Server ishga tushdi: http://localhost:${port}  (${config.nodeEnv})`);
if (config.adminPassword) log('info', `Admin panel: http://localhost:${port}/admin/`);
else log('info', "ADMIN_PASSWORD berilmagan — admin panelga kirib bo'lmaydi");
if (config.devMode) log('info', 'DEV_MODE yoqilgan: Telegramsiz sinash mumkin (?dev=123)');

app.bot
  .setup()
  .then((r) => log('info', `Bot rejimi: ${r.mode}`))
  .catch((err) => log('error', `Bot sozlanmadi: ${err.message}`));

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    log('info', `${sig} qabul qilindi, to'xtatilmoqda...`);
    await app.close();
    process.exit(0);
  });
}
