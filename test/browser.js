'use strict';
// Test în browser: 6 jucători reali în Chromium, capturi de ecran în momente-cheie.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');

const PORT = 3111;
const OUT = process.argv[2] || '/tmp/shots';
const N = 6;
require('fs').mkdirSync(OUT, { recursive: true });

(async () => {
  const srv = spawn('node', ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT } });
  srv.stderr.on('data', (d) => process.stderr.write('[srv-err] ' + d));
  await new Promise((r) => setTimeout(r, 800));

  const browser = await chromium.launch();
  const errors = [];
  const names = ['Andrei', 'Maria', 'Dan', 'Ioana', 'Radu', 'Elena'];
  const pages = [];

  const c0 = await browser.newContext({ viewport: { width: 1280, height: 780 } });
  const home = await c0.newPage();
  await home.goto(`http://localhost:${PORT}/`);
  await home.click('#h-create');
  await home.waitForURL(/\/t\//);
  const url = home.url();
  await home.close();

  for (let i = 0; i < N; i++) {
    const ctx = i === 0 ? c0 : await browser.newContext({ viewport: i === N - 1 ? { width: 390, height: 780 } : { width: 1280, height: 780 } });
    const pg = await ctx.newPage();
    pg.on('pageerror', (e) => errors.push(`${names[i]}: ${e.message}`));
    pg.on('console', (m) => { if (m.type() === 'error') errors.push(`${names[i]} console: ${m.text()}`); });
    await pg.goto(url);
    await pg.fill('#j-name', names[i]);
    await pg.click(`#avgrid button:nth-child(${i * 2 + 1})`);
    await pg.click('#join-form button[type=submit]');
    await pg.waitForSelector('.seat.me');
    pages.push(pg);
  }
  await pages[0].waitForTimeout(600);
  await pages[0].screenshot({ path: `${OUT}/01-lobby.png` });
  console.log('Doar adminul vede Start:', !!(await pages[0].$('#start')), !!(await pages[1].$('#start')));

  await pages[0].click('#start');
  await pages[0].waitForSelector('.seat .cards .pc', { timeout: 8000 });
  await pages[0].waitForTimeout(500);
  await pages[0].screenshot({ path: `${OUT}/02-dealing.png` });
  await pages[N - 1].screenshot({ path: `${OUT}/02m-dealing-mobile.png` });

  const shot = {};
  const once = async (key, fn) => { if (!shot[key]) { shot[key] = true; await fn(); } };
  const deadline = Date.now() + 120000;
  let hands = 0, wasRes = false, showdowns = 0;
  while (Date.now() < deadline && hands < 5) {
    for (let i = 0; i < N; i++) {
      const pg = pages[i];
      const myTurn = await pg.evaluate(() => document.title.startsWith('▶'));
      if (!myTurn) continue;
      if (i === 0) await once('turn', async () => { await pg.waitForTimeout(500); await pg.screenshot({ path: `${OUT}/03-my-turn-bets.png` }); });
      if (i === N - 1) await once('turnm', async () => { await pg.waitForTimeout(500); await pg.screenshot({ path: `${OUT}/03m-my-turn-mobile.png` }); });
      const r = Math.random();
      const hasRaise = await pg.$('#rbtn');
      if (r < 0.12 && hasRaise) await pg.click('#rbtn');
      else if (r < 0.2) await pg.click('[data-a=fold]');
      else await pg.click('[data-a=call]');
      await pg.waitForTimeout(80);
    }
    const board = await pages[0].evaluate(() => document.querySelectorAll('#board .slot .pc').length);
    if (board >= 3) await once('flop', async () => { await pages[0].waitForTimeout(900); await pages[0].screenshot({ path: `${OUT}/04-flop.png` }); });
    const res = await pages[0].evaluate(() => !!document.querySelector('#cmsg .res'));
    if (res && !wasRes) {
      wasRes = true; hands++;
      const sd = await pages[0].evaluate(() => !!document.querySelector('#cmsg .res .hn'));
      if (sd) showdowns++;
      const n = hands;
      if (n <= 2) {
        await pages[0].screenshot({ path: `${OUT}/05-result-${n}a.png` });
        await pages[0].waitForTimeout(1000);
        await pages[0].screenshot({ path: `${OUT}/05-result-${n}b.png` });
        await pages[0].waitForTimeout(1500);
        await pages[0].screenshot({ path: `${OUT}/05-result-${n}c.png` });
        await pages[N - 1].screenshot({ path: `${OUT}/05m-result-${n}-mobile.png` });
      }
    }
    if (!res) wasRes = false;
    await pages[0].waitForTimeout(150);
  }
  console.log('Mâini terminate:', hands, '| cu showdown:', showdowns);

  await pages[2].reload();
  await pages[2].waitForSelector('.seat.me', { timeout: 8000 });
  console.log('Reconectare după reload: OK');
  console.log('Erori JS:', errors.length ? errors.slice(0, 5) : 'niciuna');
  await browser.close();
  srv.kill();
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
