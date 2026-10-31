'use strict';
// 2 jucători: schimbare avatar, joc până la final, clasament, "Joacă din nou" doar admin.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const PORT = 3112, OUT = process.argv[2] || '/tmp/shots2';
require('fs').mkdirSync(OUT, { recursive: true });
(async () => {
  const srv = spawn('node', ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT, POKER_FAST: '1' } });
  await new Promise((r) => setTimeout(r, 800));
  const browser = await chromium.launch();
  const errors = [];
  const c0 = await browser.newContext({ viewport: { width: 1100, height: 760 } });
  const c1 = await browser.newContext({ viewport: { width: 1100, height: 760 } });
  const a = await c0.newPage(), b = await c1.newPage();
  for (const [p, n] of [[a, 'Admin'], [b, 'Bob']]) {
    p.on('pageerror', (e) => errors.push(n + ': ' + e.message));
    p.on('console', (m) => { if (m.type() === 'error') errors.push(n + ' console: ' + m.text()); });
  }
  // pre-setăm nume salvat, FĂRĂ avatar: modalul trebuie să apară
  await a.goto(`http://localhost:${PORT}/`);
  await a.evaluate(() => localStorage.setItem('poker_name', 'Admin'));
  await a.click('#h-create'); await a.waitForURL(/\/t\//);
  const url = a.url();
  await a.waitForSelector('#join:not([hidden])');
  console.log('Admin vede alegerea avatarului (nume deja salvat): OK');
  await a.click('#avgrid button:nth-child(3)'); await a.click('#join-form button[type=submit]');
  await a.waitForSelector('.seat.me');
  await b.goto(url); await b.fill('#j-name', 'Bob'); await b.click('#join-form button[type=submit]'); await b.waitForSelector('.seat.me');
  // schimbare avatar din masă
  await a.click('.seat.me .avwrap'); await a.waitForSelector('#avmodal:not([hidden])');
  await a.click('#avgrid2 button:nth-child(5)');
  await a.waitForTimeout(400);
  const av = await a.evaluate(() => document.querySelector('.seat.me .avwrap').textContent);
  console.log('Avatar schimbat la masă:', av.trim());
  await a.click('#start');
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    if (await a.$('#over:not([hidden]) .lbrow')) break;
    for (const p of [a, b]) {
      if (await p.evaluate(() => document.title.startsWith('▶'))) {
        const r = await p.$('#rbtn');
        if (r) { await p.evaluate(() => { const i = document.querySelector('#rslider,#ramt,input[type=range]'); if (i) { i.value = i.max; i.dispatchEvent(new Event('input')); } }); await p.click('#rbtn').catch(() => {}); }
        else await p.click('[data-a=call]').catch(() => {});
      }
    }
    await a.waitForTimeout(120);
  }
  await a.waitForSelector('#over .lbrow', { timeout: 5000 });
  await a.waitForTimeout(1500);
  await a.screenshot({ path: `${OUT}/over-admin.png` });
  await b.screenshot({ path: `${OUT}/over-user.png` });
  console.log('Clasament rânduri:', await a.locator('#over .lbrow').count());
  console.log('Admin are „Joacă din nou":', !!(await a.$('#again')), '| Bob are:', !!(await b.$('#again')));
  await a.click('#again');
  await a.waitForSelector('#over', { state: 'hidden', timeout: 5000 });
  await a.waitForSelector('.seat .cards .pc', { timeout: 8000 });
  console.log('După „Joacă din nou" începe o mână nouă: OK');
  console.log('Erori JS:', errors.length ? errors.slice(0, 5) : 'niciuna');
  await browser.close(); srv.kill();
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
