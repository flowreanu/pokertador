'use strict';
// Test în browser: 3 jucători reali în Chromium, capturi de ecran.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');

const PORT = 3111;
const OUT = process.argv[2] || '/tmp/shots';
require('fs').mkdirSync(OUT, { recursive: true });

(async () => {
  const srv = spawn('node', ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT } });
  srv.stdout.on('data', (d) => process.stdout.write('[srv] ' + d));
  srv.stderr.on('data', (d) => process.stderr.write('[srv-err] ' + d));
  await new Promise((r) => setTimeout(r, 800));

  const browser = await chromium.launch();
  const errors = [];
  const names = ['Andrei', 'Maria', 'Dan'];
  const ctxs = [];
  const pages = [];

  // creează masa prin pagina de acasă
  const c0 = await browser.newContext({ viewport: { width: 1280, height: 780 } });
  const home = await c0.newPage();
  await home.goto(`http://localhost:${PORT}/`);
  await home.screenshot({ path: `${OUT}/01-home.png` });
  await home.click('#h-create');
  await home.waitForURL(/\/t\//);
  const url = home.url();
  console.log('Masa:', url);
  await home.close();

  for (let i = 0; i < 3; i++) {
    const ctx = i === 0 ? c0 : await browser.newContext({ viewport: i === 2 ? { width: 390, height: 780 } : { width: 1280, height: 780 } });
    const pg = await ctx.newPage();
    pg.on('pageerror', (e) => errors.push(`${names[i]}: ${e.message}`));
    pg.on('console', (m) => { if (m.type() === 'error') errors.push(`${names[i]} console: ${m.text()}`); });
    await pg.goto(url);
    await pg.fill('#j-name', names[i]);
    await pg.click('#join-form button[type=submit]');
    await pg.waitForSelector('.seat.me');
    ctxs.push(ctx); pages.push(pg);
  }
  await pages[0].waitForTimeout(400);
  await pages[0].screenshot({ path: `${OUT}/02-lobby.png` });

  // doar adminul vede butonul de start și setările
  const has = async (pg, sel) => !!(await pg.$(sel));
  console.log('Admin vede Start:', await has(pages[0], '#start'), '| Maria:', await has(pages[1], '#start'), '| Dan:', await has(pages[2], '#start'));
  console.log('Admin vede ⚙:', await pages[0].isVisible('#b-admin'), '| Maria:', await pages[1].isVisible('#b-admin'));
  await pages[1].screenshot({ path: `${OUT}/02b-lobby-guest.png` });
  await pages[0].click('#b-admin');
  await pages[0].waitForSelector('#admin:not([hidden])');
  await pages[0].screenshot({ path: `${OUT}/02c-admin.png` });
  await pages[0].click('#a-close');

  // chat + emoji
  await pages[1].click('#b-chat');
  await pages[1].fill('#chat-input', 'Salut băieți 😎 pregătiți de pierdut?');
  await pages[1].press('#chat-input', 'Enter');
  await pages[1].click('#reacts button[data-e="🔥"]');
  await pages[0].waitForSelector('.bub');
  await pages[0].click('#b-chat');
  await pages[0].waitForTimeout(300);
  const log = await pages[0].textContent('#chat-log');
  console.log('Chat primit de admin:', /Salut băieți/.test(log) ? 'OK' : 'LIPSEȘTE');
  await pages[0].screenshot({ path: `${OUT}/02d-chat.png` });
  await pages[0].click('#chat-x');

  await pages[0].click('#start');
  await pages[0].waitForSelector('.seat .cards .card', { timeout: 8000 });
  await pages[0].waitForTimeout(600);

  // joacă automat: fiecare, când e rândul lui, dă call/check; uneori raise
  let shot = { flop: false, mobile: false, turnui: false, end: false };
  const deadline = Date.now() + 90000;
  let hands = 0, lastHand = 0;
  while (Date.now() < deadline && hands < 4) {
    for (let i = 0; i < 3; i++) {
      const pg = pages[i];
      const myTurn = await pg.evaluate(() => document.title.startsWith('▶'));
      if (myTurn) {
        if (!shot.turnui && i === 0) {
          await pg.waitForTimeout(200);
          await pg.screenshot({ path: `${OUT}/03-my-turn.png` });
          shot.turnui = true;
        }
        if (!shot.mobile && i === 2) {
          await pg.screenshot({ path: `${OUT}/04-mobile-turn.png` });
          shot.mobile = true;
        }
        const r = Math.random();
        const hasRaise = await pg.$('#rbtn');
        if (r < 0.25 && hasRaise) await pg.click('#rbtn');
        else if (r < 0.35) await pg.click('[data-a=fold]');
        else await pg.click('[data-a=call]');
        await pg.waitForTimeout(150);
      }
    }
    const txt = await pages[0].evaluate(() => document.querySelector('#center .board')?.querySelectorAll('.card:not(.empty)').length);
    if (txt >= 3 && !shot.flop) { await pages[0].screenshot({ path: `${OUT}/05-flop.png` }); shot.flop = true; }
    const ended = await pages[0].evaluate(() => /câștigă/.test(document.querySelector('#center .msg')?.textContent || ''));
    if (ended && !shot.end) {
      await pages[0].waitForTimeout(300);
      await pages[0].screenshot({ path: `${OUT}/06-result.png` });
      await pages[2].screenshot({ path: `${OUT}/07-result-mobile.png` });
      shot.end = true;
    }
    if (ended) {
      const h = await pages[0].evaluate(() => 1);
      hands++;
      await pages[0].waitForSelector('#center .msg:not(.win)', { timeout: 15000 }).catch(() => {});
    }
    await pages[0].waitForTimeout(250);
  }
  console.log('Mâini terminate în browser:', hands);

  // verificare reconectare: reîncarcă pagina lui Dan
  await pages[2].reload();
  await pages[2].waitForSelector('.seat.me', { timeout: 8000 });
  console.log('Reconectare după reload: OK');

  console.log('Erori JS:', errors.length ? errors : 'niciuna');
  await browser.close();
  srv.kill();
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
