'use strict';
// Evaluator de mâini. Carte = întreg 0..51: rank = (c % 13) + 2 (2..14), suit = floor(c / 13).

const CATS = [
  'Carte mare', 'Pereche', 'Două perechi', 'Trei de un fel', 'Chintă',
  'Culoare', 'Full House', 'Careu', 'Chintă de culoare',
];
const BASE5 = 15 ** 5;

function rank5(cs) {
  const r = cs.map((c) => (c % 13) + 2).sort((a, b) => b - a);
  const suit0 = (cs[0] / 13) | 0;
  const flush = cs.every((c) => ((c / 13) | 0) === suit0);

  let straightHigh = 0;
  if (new Set(r).size === 5) {
    if (r[0] - r[4] === 4) straightHigh = r[0];
    else if (r[0] === 14 && r[1] === 5 && r[2] === 4 && r[3] === 3 && r[4] === 2) straightHigh = 5;
  }

  const counts = {};
  for (const x of r) counts[x] = (counts[x] || 0) + 1;
  const groups = Object.entries(counts)
    .map(([k, v]) => [+k, v])
    .sort((a, b) => b[1] - a[1] || b[0] - a[0]);

  let cat;
  let tb;
  if (straightHigh && flush) { cat = 8; tb = [straightHigh]; }
  else if (groups[0][1] === 4) { cat = 7; tb = [groups[0][0], groups[1][0]]; }
  else if (groups[0][1] === 3 && groups[1][1] === 2) { cat = 6; tb = [groups[0][0], groups[1][0]]; }
  else if (flush) { cat = 5; tb = r; }
  else if (straightHigh) { cat = 4; tb = [straightHigh]; }
  else if (groups[0][1] === 3) { cat = 3; tb = groups.map((g) => g[0]); }
  else if (groups[0][1] === 2 && groups[1][1] === 2) { cat = 2; tb = groups.map((g) => g[0]); }
  else if (groups[0][1] === 2) { cat = 1; tb = groups.map((g) => g[0]); }
  else { cat = 0; tb = r; }

  let score = cat;
  for (let i = 0; i < 5; i++) score = score * 15 + (tb[i] || 0);
  return score;
}

// Cea mai bună mână de 5 cărți din 5..7 cărți: { score, five }.
function bestFive(cards) {
  const n = cards.length;
  let best = -1;
  let combo = null;
  const pick = [];
  (function rec(start) {
    if (pick.length === 5) {
      const s = rank5(pick);
      if (s > best) { best = s; combo = pick.slice(); }
      return;
    }
    for (let i = start; i < n; i++) {
      pick.push(cards[i]);
      rec(i + 1);
      pick.pop();
    }
  })(0);
  return { score: best, five: combo };
}

function bestScore(cards) {
  return bestFive(cards).score;
}

function handName(score) {
  const cat = Math.floor(score / BASE5);
  if (cat === 8) {
    const high = Math.floor(score / 15 ** 4) % 15;
    if (high === 14) return 'Chintă regală';
  }
  return CATS[cat];
}

module.exports = { bestScore, bestFive, handName, rank5 };
