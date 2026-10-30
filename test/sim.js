'use strict';
// Teste: evaluator + simulare de mii de mâini cu acțiuni aleatoare.
const assert = require('assert');
const { rank5, bestScore, handName } = require('../eval');
const { Table } = require('../game');

/* ---------- evaluator ---------- */
const C = (s) => {
  const r = '23456789TJQKA'.indexOf(s[0]);
  const su = 'shdc'.indexOf(s[1]);
  return su * 13 + r;
};
const H = (str) => str.split(' ').map(C);
const sc = (str) => bestScore(H(str));

assert.strictEqual(handName(sc('As Ks Qs Js Ts 2d 3c')), 'Chintă regală');
assert.strictEqual(handName(sc('9s 8s 7s 6s 5s Ad Ac')), 'Chintă de culoare');
assert.strictEqual(handName(sc('9s 9h 9d 9c 5s Ad 2c')), 'Careu');
assert.strictEqual(handName(sc('9s 9h 9d 5c 5s Ad 2c')), 'Full House');
assert.strictEqual(handName(sc('As 9s 7s 5s 2s Kd Qc')), 'Culoare');
assert.strictEqual(handName(sc('9s 8h 7d 6c 5s Ad 2c')), 'Chintă');
assert.strictEqual(handName(sc('As 2h 3d 4c 5s Kd 9c')), 'Chintă'); // roata
assert.strictEqual(handName(sc('9s 9h 9d 6c 5s Ad 2c')), 'Trei de un fel');
assert.strictEqual(handName(sc('9s 9h 6d 6c 5s Ad 2c')), 'Două perechi');
assert.strictEqual(handName(sc('9s 9h 7d 6c 5s Ad 2c')), 'Pereche');
assert.strictEqual(handName(sc('9s 8h 7d 4c 2s Ad Jc')), 'Carte mare');
// comparații
assert(sc('As Ah Kd Qc 2s 3d 4c') > sc('Ks Kh Ad Qc 2s 3d 4c'));      // AA > KK
assert(sc('As Ah Kd Qc 2s 3d 5c') > sc('Ad Ac Kh Jc 2d 3h 5d'));      // kicker Q > J
assert(sc('6s 5h 4d 3c 2s Ad Kc') < sc('7s 6h 5d 4c 3s Ad Kc'));       // roata < chintă la 7
assert(sc('9s 9h 9d 5c 5s Ad 2c') < sc('9s 9h 9d 6c 6s Ad 2c'));       // full 9-5 < 9-6
assert.strictEqual(sc('As Kh Qd Jc 9s 4d 2c'), sc('Ad Kc Qh Js 9d 4c 2h')); // egalitate
console.log('Evaluator: OK');

/* ---------- simulare ---------- */
const fakeWs = () => ({ readyState: 1, send() {}, close() {} });

async function simulate(nPlayers, hands, seed) {
  const t = new Table('test', {
    stack: 1000, sb: 10,
    timing: { street: 0, nextHand: 0, firstHand: 0, turn: 600000 },
  });
  const ps = [];
  for (let i = 0; i < nPlayers; i++) {
    const r = t.join(`token-${seed}-${i}-xxxxxxxx`, `P${i}`, fakeWs());
    ps.push(r.p);
  }
  // stack-uri diferite, ca să apară side pot-uri
  const chips = [];
  for (const p of ps) {
    p.stack = 50 + Math.floor(Math.random() * 1500);
    chips.push(p.stack);
  }
  let total = chips.reduce((a, b) => a + b, 0);
  t.started = true;

  let played = 0;
  let showdowns = 0;
  let multiPots = 0;
  while (played < hands) {
    if (!t.handActive) {
      // rebuy pentru cei fără fise
      for (const p of ps) {
        if (p.stack === 0) { p.stack = 1000; total += 1000; }
      }
      t.startHand();
      assert(t.handActive, 'mâna trebuia să pornească');
      played++;
    }
    // joacă până se termină mâna
    let guard = 0;
    while (t.handActive) {
      if (++guard > 500) throw new Error('mână blocată');
      if (t.streetTimer) { await new Promise((r) => setTimeout(r, 2)); continue; }
      const p = t.seats[t.turn];
      assert(p, 'turn fără jucător');
      const toCall = t.currentBet - p.bet;
      const roll = Math.random();
      let msg;
      if (roll < 0.15 && toCall > 0) msg = { action: 'fold' };
      else if (roll < 0.55) msg = { action: toCall > 0 ? 'call' : 'check' };
      else if (roll < 0.62) msg = { action: 'raise', amount: p.bet + p.stack }; // all-in
      else {
        const min = t.currentBet + t.lastRaise;
        msg = { action: 'raise', amount: min + Math.floor(Math.random() * 200) };
      }
      const before = t.turn;
      t.act(p, msg);
      if (t.handActive && t.turn === before && !t.streetTimer) {
        // acțiune respinsă (ex. raise prea mic): cădem pe call/check
        t.act(p, { action: toCall > 0 ? 'call' : 'check' });
      }
    }
    if (t.result && t.result.showdown) showdowns++;
    const sum = ps.reduce((s, p) => s + p.stack, 0);
    assert.strictEqual(sum, total, `fișe pierdute/create în mâna ${played}: ${sum} != ${total}`);
    for (const p of ps) assert(p.stack >= 0, 'stack negativ');
    t.nextHandAt = 0;
  }
  t.destroy();
  return { showdowns, multiPots };
}

(async () => {
  let sd = 0;
  for (const n of [2, 3, 4, 6, 9]) {
    for (let k = 0; k < 6; k++) {
      const r = await simulate(n, 250, `${n}${k}`);
      sd += r.showdowns;
    }
  }
  console.log(`Simulare: OK (showdown-uri: ${sd})`);

  // side pot determinist
  const t = new Table('sp', { stack: 1000, sb: 10, timing: { street: 0 } });
  const mk = (name, stack, totalBet, folded, score) => ({ name, stack, totalBet, folded, score, seat: 0 });
  const A = mk('A', 0, 100, false, 5);
  const B = mk('B', 0, 300, false, 3);
  const Cc = mk('C', 0, 300, false, 1);
  const D = mk('D', 0, 50, true, 9);
  [A, B, Cc, D].forEach((p, i) => { p.seat = i; t.seats[i] = p; });
  const pots = t.buildPots();
  assert.strictEqual(pots.reduce((s, p) => s + p.amount, 0), 750);
  assert.deepStrictEqual(pots.map((p) => p.amount), [350, 400]); // 100*3+50 | 200*2
  assert.deepStrictEqual(pots[0].eligible.map((p) => p.name), ['A', 'B', 'C']);
  assert.deepStrictEqual(pots[1].eligible.map((p) => p.name), ['B', 'C']);
  console.log('Side pots: OK');
})().catch((e) => { console.error(e); process.exit(1); });
