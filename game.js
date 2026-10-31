'use strict';
// Motorul unei mese de Texas Hold'em. Toată logica stă pe server;
// fiecare client primește doar ce are voie să vadă.

const crypto = require('crypto');
const { bestScore, bestFive, handName } = require('./eval');

const AVATARS = ['🦊', '🐼', '🐯', '🦁', '🐸', '🐵', '🦄', '🐙', '🦉', '🐺', '🐻', '🐷', '🐲', '🦈', '🐧', '🦖'];

const MAX_SEATS = 9;
const RANKS = '23456789TJQKA';
const SUITS = 'shdc';
const cardStr = (c) => RANKS[c % 13] + SUITS[(c / 13) | 0];

function newDeck() {
  const d = Array.from({ length: 52 }, (_, i) => i);
  for (let i = 51; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

function cleanName(s) {
  return String(s || '').replace(/[\u0000-\u001f<>&"]/g, '').trim().slice(0, 14);
}

const DEFAULT_TIMING = {
  turn: 30000,        // timp pe tură
  turnAway: 6000,     // timp pe tură pentru un jucător deconectat
  turnSitOut: 1500,   // pentru cineva marcat absent
  nextHand: 6000,     // pauza dintre mâini
  firstHand: 2000,    // după „Începe”
  street: 1100,       // pauza între cărțile deschise la all-in
};

class Table {
  constructor(id, opts = {}) {
    this.id = id;
    this.startStack = opts.stack || 1000;
    this.sb = opts.sb || 10;
    this.bb = this.sb * 2;
    this.t = { ...DEFAULT_TIMING, ...(opts.timing || {}) };

    this.seats = Array(MAX_SEATS).fill(null);
    this.started = false;
    this.handActive = false;
    this.phase = 'lobby'; // lobby | idle | preflop | flop | turn | river | ended
    this.handNo = 0;
    this.dealer = -1;
    this.board = [];
    this.deck = [];
    this.currentBet = 0;
    this.lastRaise = this.bb;
    this.turn = -1;
    this.turnDeadline = 0;
    this.turnTotal = this.t.turn;
    this.nextHandAt = 0;
    this.result = null;

    this.turnTimer = null;
    this.nextTimer = null;
    this.streetTimer = null;
    this.lastActivity = Date.now();

    this.adminKey = opts.adminKey || null;
    this.banned = new Set();
    this.chat = [];
    this.paused = false;
    this.allowRebuy = true;
    this.pendingSb = null;
    this.over = false;
    this.endAfter = false;
    this.handsPlayed = 0;
  }

  checkAdmin(key) {
    if (!this.adminKey || typeof key !== 'string' || !key) return false;
    const a = Buffer.from(key);
    const b = Buffer.from(this.adminKey);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  /* ---------- utilitare ---------- */

  touch() { this.lastActivity = Date.now(); }
  players() { return this.seats.filter(Boolean); }
  activePlayers() { return this.seats.filter((p) => p && p.inHand && !p.folded); }
  eligible(p) { return p.stack > 0 && p.connected && !p.sitOut && !p.leaving; }
  eligibleCount() { return this.players().filter((p) => this.eligible(p)).length; }
  connectedCount() { return this.players().filter((p) => p.connected).length; }
  totalPot() { return this.players().reduce((s, p) => s + p.totalBet, 0); }
  findByToken(token) { return this.seats.find((p) => p && p.token === token) || null; }

  nextSeat(from, pred) {
    for (let i = 1; i <= MAX_SEATS; i++) {
      const s = (((from + i) % MAX_SEATS) + MAX_SEATS) % MAX_SEATS;
      const p = this.seats[s];
      if (p && pred(p)) return s;
    }
    return -1;
  }

  destroy() {
    clearTimeout(this.turnTimer);
    clearTimeout(this.nextTimer);
    clearTimeout(this.streetTimer);
    this.turnTimer = this.nextTimer = this.streetTimer = null;
  }

  /* ---------- intrare / ieșire ---------- */

  join(token, name, ws, adminKey, avatar) {
    if (this.banned.has(token)) return { error: 'Ai fost scos de la această masă.' };
    let isNew = false;
    let p = this.findByToken(token);
    if (p) {
      const old = p.ws;
      p.ws = ws;
      p.connected = true;
      p.disconnectedAt = 0;
      p.sitOut = false;
      p.timeouts = 0;
      p.leaving = false;
      if (old && old !== ws) { try { old.close(); } catch (e) { /* ignorat */ } }
    } else {
      const seat = this.seats.findIndex((s) => !s);
      if (seat < 0) return { error: 'Masa este plină (9 locuri).' };
      let nm = cleanName(name) || 'Jucător';
      const taken = new Set(this.players().map((x) => x.name));
      if (taken.has(nm)) {
        let n = 2;
        while (taken.has(`${nm.slice(0, 11)} ${n}`)) n++;
        nm = `${nm.slice(0, 11)} ${n}`;
      }
      p = {
        token, name: nm, seat, ws, stack: this.startStack, rebuys: 0,
        connected: true, disconnectedAt: 0, sitOut: false, leaving: false, timeouts: 0,
        inHand: false, folded: false, allIn: false, bet: 0, totalBet: 0,
        acted: false, raiseLocked: false, cards: [], last: '', revealed: false,
        winner: false, score: 0, handName: '',
        isAdmin: false, lastChatAt: 0, lastEmoteAt: 0, best: null,
        bustHand: 0, bustStart: 0, handStart: 0,
        avatar: AVATARS[seat % AVATARS.length],
      };
      this.seats[seat] = p;
      isNew = true;
    }
    if (AVATARS.includes(avatar)) p.avatar = avatar;
    if (this.checkAdmin(adminKey)) p.isAdmin = true;
    this.touch();
    this.maybeSchedule(this.t.firstHand);
    this.broadcast();
    this.send(p, { type: 'chatlog', msgs: this.chat });
    if (isNew) this.sys(`${p.name} s-a așezat la masă`);
    return { p };
  }

  disconnect(ws) {
    const p = this.players().find((x) => x.ws === ws);
    if (!p) return;
    p.ws = null;
    p.connected = false;
    p.disconnectedAt = Date.now();
    this.touch();
    // dacă e rândul lui, scurtăm timpul de așteptare
    if (this.turn === p.seat) this.setTurn(p);
    else this.broadcast();
  }

  leave(p, silent) {
    if (!silent) this.sys(`${p.name} a ieșit de la masă`);
    p.connected = false;
    p.ws = null;
    p.leaving = true;
    if (this.handActive && p.inHand) {
      if (this.turn === p.seat) this.act(p, { action: 'fold' }, true);
      // altfel: cade automat când îi vine rândul / se șterge la finalul mâinii
    } else {
      this.seats[p.seat] = null;
    }
    this.broadcast();
  }

  // Curățenie periodică: scoate jucătorii deconectați de mult timp.
  sweep() {
    if (this.handActive) return;
    for (const p of this.players()) {
      if (!p.connected && p.disconnectedAt && Date.now() - p.disconnectedAt > 10 * 60 * 1000) {
        this.seats[p.seat] = null;
      }
    }
  }

  /* ---------- mesaje de la clienți ---------- */

  onMessage(p, msg) {
    this.touch();
    switch (msg.type) {
      case 'action':
        this.act(p, msg);
        return;
      case 'start':
        if (!p.isAdmin) return this.err(p, 'Doar adminul poate porni jocul.');
        if (!this.started) {
          if (this.eligibleCount() < 2) return this.err(p, 'Sunt necesari minim 2 jucători.');
          this.started = true;
          this.phase = 'idle';
          this.maybeSchedule(this.t.firstHand);
          this.sys('Jocul a început. Spor la cărți!');
        }
        break;
      case 'pause':
        if (!p.isAdmin) return this.err(p, 'Doar adminul poate pune pauză.');
        this.paused = !!msg.on;
        if (this.paused) {
          clearTimeout(this.nextTimer);
          this.nextTimer = null;
          this.nextHandAt = 0;
          this.sys('Jocul se oprește după mâna curentă (pauză)');
        } else {
          this.sys('Jocul continuă');
          this.maybeSchedule(2000);
        }
        break;
      case 'settings': {
        if (!p.isAdmin) return this.err(p, 'Doar adminul poate schimba setările.');
        if (msg.sb !== undefined) {
          const sb = Math.floor(Number(msg.sb));
          const max = Math.floor(this.startStack / 4);
          if (!Number.isFinite(sb) || sb < 1 || sb > max) return this.err(p, `Small blind invalid (1–${max}).`);
          if (this.handActive) this.pendingSb = sb;
          else { this.sb = sb; this.bb = sb * 2; this.pendingSb = null; }
        }
        const tm = Math.floor(Number(msg.timer));
        if ([15, 20, 30, 45, 60, 90].includes(tm)) this.t.turn = tm * 1000;
        if (typeof msg.allowRebuy === 'boolean') this.allowRebuy = msg.allowRebuy;
        this.sys('Adminul a actualizat setările mesei');
        break;
      }
      case 'kick': {
        if (!p.isAdmin) return this.err(p, 'Doar adminul poate scoate jucători.');
        const t = this.seats[Math.floor(Number(msg.seat))];
        if (!t || t === p) return;
        this.banned.add(t.token);
        this.send(t, { type: 'error', fatal: true, msg: 'Ai fost scos de la masă de admin.' });
        const w = t.ws;
        this.sys(`${t.name} a fost scos de la masă`);
        this.leave(t, true);
        if (w) { try { w.close(); } catch (e) { /* ignorat */ } }
        break;
      }
      case 'chat':
        this.chatMsg(p, msg.text);
        return;
      case 'emote':
        this.emote(p, msg.e);
        return;
      case 'avatar':
        if (AVATARS.includes(msg.av)) p.avatar = msg.av;
        break;
      case 'end':
        if (!p.isAdmin) return this.err(p, 'Doar adminul poate termina jocul.');
        if (!this.started || this.over) return;
        if (this.handActive) {
          this.endAfter = true;
          this.sys('Jocul se termină după mâna curentă');
        } else {
          this.gameOver();
        }
        break;
      case 'restart':
        if (!p.isAdmin) return this.err(p, 'Doar adminul poate porni un joc nou.');
        if (!this.over) return;
        this.restartGame();
        break;
      case 'rebuy':
        if (this.over) return this.err(p, 'Jocul s-a terminat.');
        if (!this.allowRebuy) return this.err(p, 'Adminul a dezactivat rebuy.');
        if (p.stack === 0 && !(this.handActive && p.inHand)) {
          p.stack = this.startStack;
          p.bustHand = 0;
          p.bustStart = 0;
          p.rebuys++;
          p.sitOut = false;
          p.timeouts = 0;
          this.maybeSchedule(3000);
        }
        break;
      case 'sitin':
        p.sitOut = false;
        p.timeouts = 0;
        this.maybeSchedule(3000);
        break;
      case 'leave':
        this.leave(p);
        return;
      default:
        return;
    }
    this.broadcast();
  }

  err(p, msg) {
    if (p.ws && p.ws.readyState === 1) p.ws.send(JSON.stringify({ type: 'error', msg }));
  }

  /* ---------- pornirea unei mâini ---------- */

  maybeSchedule(delay) {
    if (!this.started || this.handActive || this.nextTimer || this.paused || this.over) return;
    if (this.eligibleCount() < 2) { this.nextHandAt = 0; return; }
    this.nextHandAt = Date.now() + delay;
    this.nextTimer = setTimeout(() => { this.nextTimer = null; this.startHand(); }, delay);
  }

  startHand() {
    clearTimeout(this.nextTimer);
    this.nextTimer = null;
    this.nextHandAt = 0;
    if (this.handActive || this.paused || this.over) return;
    if (this.pendingSb) { this.sb = this.pendingSb; this.bb = this.sb * 2; this.pendingSb = null; }

    // elimină jucătorii care au ieșit
    for (const p of this.players()) if (p.leaving) this.seats[p.seat] = null;

    if (this.eligibleCount() < 2) {
      this.phase = 'idle';
      this.broadcast();
      return;
    }

    this.handNo++;
    this.handActive = true;
    this.result = null;
    this.board = [];
    this.deck = newDeck();
    for (const p of this.players()) {
      Object.assign(p, {
        cards: [], bet: 0, totalBet: 0, folded: false, allIn: false, acted: false,
        raiseLocked: false, last: '', revealed: false, winner: false, score: 0, handName: '',
        inHand: this.eligible(p), handStart: p.stack,
      });
    }

    const inHand = (p) => p.inHand;
    this.dealer = this.nextSeat(this.dealer, inHand);
    const count = this.players().filter(inHand).length;
    let sbSeat;
    let bbSeat;
    if (count === 2) {
      sbSeat = this.dealer;
      bbSeat = this.nextSeat(this.dealer, inHand);
    } else {
      sbSeat = this.nextSeat(this.dealer, inHand);
      bbSeat = this.nextSeat(sbSeat, inHand);
    }
    this.putIn(this.seats[sbSeat], Math.min(this.sb, this.seats[sbSeat].stack));
    this.putIn(this.seats[bbSeat], Math.min(this.bb, this.seats[bbSeat].stack));
    this.currentBet = Math.max(this.seats[sbSeat].bet, this.seats[bbSeat].bet);
    this.lastRaise = this.bb;

    for (let round = 0; round < 2; round++) {
      for (const p of this.players()) if (p.inHand) p.cards.push(this.deck.pop());
    }

    this.phase = 'preflop';
    this.nextAction(bbSeat);
  }

  putIn(p, amount) {
    p.stack -= amount;
    p.bet += amount;
    p.totalBet += amount;
    if (p.stack === 0) p.allIn = true;
  }

  /* ---------- fluxul de pariuri ---------- */

  nextAction(from) {
    const active = this.activePlayers();
    if (active.length === 1) return this.endUncontested(active[0]);

    const actors = active.filter((p) => !p.allIn);
    const needs = (p) => p.bet < this.currentBet || (!p.acted && actors.length >= 2);
    for (let i = 1; i <= MAX_SEATS; i++) {
      const s = (((from + i) % MAX_SEATS) + MAX_SEATS) % MAX_SEATS;
      const p = this.seats[s];
      if (p && p.inHand && !p.folded && !p.allIn && needs(p)) return this.setTurn(p);
    }
    return this.endStreet();
  }

  setTurn(p) {
    clearTimeout(this.turnTimer);
    this.turn = p.seat;
    let dur = this.t.turn;
    if (p.sitOut) dur = this.t.turnSitOut;
    else if (p.leaving) dur = 300;
    else if (!p.connected) dur = this.t.turnAway;
    this.turnTotal = dur;
    this.turnDeadline = Date.now() + dur;
    const handNo = this.handNo;
    const seat = p.seat;
    this.turnTimer = setTimeout(() => this.onTimeout(seat, handNo), dur);
    this.broadcast();
  }

  onTimeout(seat, handNo) {
    if (this.turn !== seat || this.handNo !== handNo || !this.handActive) return;
    const p = this.seats[seat];
    if (!p) return;
    if (p.connected && !p.sitOut) {
      p.timeouts++;
      if (p.timeouts >= 2) p.sitOut = true;
    }
    const toCall = this.currentBet - p.bet;
    this.act(p, { action: toCall > 0 ? 'fold' : 'check' }, true);
  }

  act(p, msg, auto = false) {
    if (!this.handActive || this.turn !== p.seat) return this.err(p, 'Nu este rândul tău.');
    const toCall = this.currentBet - p.bet;
    const others = this.activePlayers().filter((x) => x !== p);

    switch (msg.action) {
      case 'fold':
        p.folded = true;
        p.last = 'Fold';
        break;

      case 'check':
        if (toCall > 0) return this.err(p, 'Nu poți da check, trebuie să plătești.');
        p.acted = true;
        p.last = 'Check';
        break;

      case 'call':
        if (toCall <= 0) { p.acted = true; p.last = 'Check'; break; }
        this.doCall(p, toCall);
        break;

      case 'raise': {
        let to = Math.floor(Number(msg.amount));
        if (!Number.isFinite(to)) return this.err(p, 'Sumă invalidă.');
        const maxTo = p.bet + p.stack;
        if (to > maxTo) to = maxTo;
        if (to <= this.currentBet) { this.doCall(p, toCall); break; } // practic call
        if (p.raiseLocked) return this.err(p, 'Nu poți face raise acum, doar call sau fold.');
        const allIn = to === maxTo;
        const minTo = this.currentBet + this.lastRaise;
        if (to < minTo && !allIn) return this.err(p, `Raise minim: ${minTo}.`);

        const wasBet = this.currentBet === 0;
        const size = to - this.currentBet;
        this.putIn(p, to - p.bet);
        if (size >= this.lastRaise) {
          this.lastRaise = size;
          for (const o of others) { o.acted = false; o.raiseLocked = false; }
        } else {
          // all-in scurt: nu redeschide acțiunea pentru cei care au vorbit deja
          for (const o of others) if (o.acted) o.raiseLocked = true;
        }
        this.currentBet = to;
        p.acted = true;
        p.last = p.allIn ? `All-in ${to}` : `${wasBet ? 'Bet' : 'Raise'} ${to}`;
        break;
      }

      default:
        return this.err(p, 'Acțiune necunoscută.');
    }

    if (!auto) p.timeouts = 0;
    clearTimeout(this.turnTimer);
    this.turn = -1;
    this.nextAction(p.seat);
  }

  doCall(p, toCall) {
    const amt = Math.min(toCall, p.stack);
    this.putIn(p, amt);
    p.acted = true;
    p.last = p.allIn ? `All-in ${p.bet}` : `Call ${amt}`;
  }

  endStreet() {
    this.turn = -1;
    clearTimeout(this.turnTimer);
    for (const p of this.players()) { p.bet = 0; p.acted = false; p.raiseLocked = false; p.last = p.folded ? 'Fold' : p.last; }
    this.currentBet = 0;
    this.lastRaise = this.bb;

    if (this.phase === 'river') return this.showdown();

    const next = { preflop: 'flop', flop: 'turn', turn: 'river' }[this.phase];
    this.deck.pop(); // burn
    const n = next === 'flop' ? 3 : 1;
    for (let i = 0; i < n; i++) this.board.push(this.deck.pop());
    this.phase = next;
    for (const p of this.players()) if (!p.folded) p.last = '';

    const active = this.activePlayers();
    const actors = active.filter((p) => !p.allIn);
    if (actors.length <= 1) {
      // nimeni nu mai poate paria: arătăm cărțile și deschidem restul mesei
      for (const p of active) p.revealed = true;
      this.broadcast();
      this.streetTimer = setTimeout(() => { this.streetTimer = null; this.endStreet(); }, this.t.street);
      return;
    }
    this.nextAction(this.dealer);
  }

  /* ---------- finalul mâinii ---------- */

  buildPots() {
    const ps = this.players().filter((p) => p.totalBet > 0);
    const levels = [...new Set(ps.filter((p) => !p.folded).map((p) => p.totalBet))].sort((a, b) => a - b);
    const maxAll = Math.max(0, ...ps.map((p) => p.totalBet));
    if (!levels.length || levels[levels.length - 1] < maxAll) levels.push(maxAll);

    const pots = [];
    let prev = 0;
    for (const lv of levels) {
      let amount = 0;
      for (const p of ps) amount += Math.max(0, Math.min(p.totalBet, lv) - prev);
      const eligible = ps.filter((p) => !p.folded && p.totalBet >= lv);
      if (amount > 0) {
        if (eligible.length) pots.push({ amount, eligible });
        else if (pots.length) pots[pots.length - 1].amount += amount;
      }
      prev = lv;
    }
    return pots;
  }

  showdown() {
    const active = this.activePlayers();
    for (const p of active) {
      p.revealed = true;
      const b = bestFive([...p.cards, ...this.board]);
      p.score = b.score;
      p.handName = handName(p.score);
      p.best = b.five.map(cardStr);
    }
    const pots = this.buildPots();
    const won = new Map();
    for (const pot of pots) {
      let winners = pot.eligible;
      if (winners.length > 1) {
        const best = Math.max(...winners.map((p) => p.score));
        winners = winners.filter((p) => p.score === best);
      }
      // ordine de la stânga dealerului, pentru fișele rămase
      winners.sort((a, b) => ((a.seat - this.dealer - 1 + 18) % 9) - ((b.seat - this.dealer - 1 + 18) % 9));
      const share = Math.floor(pot.amount / winners.length);
      let rem = pot.amount - share * winners.length;
      for (const w of winners) {
        const amt = share + (rem > 0 ? 1 : 0);
        if (rem > 0) rem--;
        won.set(w, (won.get(w) || 0) + amt);
      }
    }
    const list = [];
    for (const [p, amount] of won) {
      p.stack += amount;
      p.winner = true;
      list.push({ seat: p.seat, name: p.name, amount, hand: p.handName, best: p.best });
    }
    list.sort((a, b) => b.amount - a.amount);
    const text = list.map((w) => `${w.name} câștigă ${w.amount}`).join(' · ') + (list[0] ? ` — ${list[0].hand}` : '');
    this.finishHand({ text, winners: list, showdown: true });
  }

  endUncontested(w) {
    const pot = this.totalPot();
    w.stack += pot;
    w.winner = true;
    this.finishHand({
      text: `${w.name} câștigă ${pot}`,
      winners: [{ seat: w.seat, name: w.name, amount: pot, hand: null }],
      showdown: false,
    });
  }

  finishHand(result) {
    clearTimeout(this.turnTimer);
    clearTimeout(this.streetTimer);
    this.streetTimer = null;
    this.turn = -1;
    this.result = result;
    this.handActive = false;
    this.phase = 'ended';
    for (const p of this.players()) p.bet = 0;
    for (const p of this.players()) if (p.leaving) this.seats[p.seat] = null;
    this.handsPlayed++;
    for (const p of this.players()) {
      if (p.inHand && p.stack === 0 && !p.bustHand) { p.bustHand = this.handNo; p.bustStart = p.handStart; }
    }
    const holders = this.players().filter((p) => p.stack > 0).length;
    if (this.endAfter || (this.started && holders <= 1)) this.gameOver();
    else this.maybeSchedule(this.t.nextHand);
    this.broadcast();
  }

  /* ---------- sfârșit de joc ---------- */

  standings() {
    const ps = this.players().slice().sort((a, b) =>
      (b.stack - a.stack) || ((b.bustHand || 0) - (a.bustHand || 0)) ||
      ((b.bustStart || 0) - (a.bustStart || 0)) || a.name.localeCompare(b.name));
    return ps.map((p, i) => ({
      rank: i + 1, seat: p.seat, name: p.name, av: p.avatar, stack: p.stack,
      net: p.stack - this.startStack * (1 + p.rebuys), rebuys: p.rebuys,
    }));
  }

  gameOver() {
    clearTimeout(this.turnTimer);
    clearTimeout(this.nextTimer);
    clearTimeout(this.streetTimer);
    this.turnTimer = this.nextTimer = this.streetTimer = null;
    this.over = true;
    this.endAfter = false;
    this.phase = 'over';
    this.turn = -1;
    this.nextHandAt = 0;
    const top = this.standings()[0];
    this.sys(top ? `Joc terminat — ${top.name} câștigă!` : 'Joc terminat');
    this.broadcast();
  }

  restartGame() {
    for (const p of this.players()) if (!p.connected) this.seats[p.seat] = null;
    for (const p of this.players()) {
      Object.assign(p, {
        stack: this.startStack, rebuys: 0, bustHand: 0, bustStart: 0, sitOut: false, timeouts: 0,
        leaving: false, cards: [], bet: 0, totalBet: 0, inHand: false, folded: false, allIn: false,
        acted: false, raiseLocked: false, last: '', revealed: false, winner: false, handName: '',
      });
    }
    this.over = false;
    this.endAfter = false;
    this.paused = false;
    this.handsPlayed = 0;
    this.result = null;
    this.board = [];
    this.currentBet = 0;
    this.phase = 'idle';
    this.sys(`Joc nou! Toată lumea pornește cu ${this.startStack} fise`);
    this.maybeSchedule(this.t.firstHand);
  }

  /* ---------- chat ---------- */

  send(p, obj) {
    if (p.ws && p.ws.readyState === 1) {
      try { p.ws.send(JSON.stringify(obj)); } catch (e) { /* ignorat */ }
    }
  }

  broadcastRaw(obj) {
    for (const p of this.players()) this.send(p, obj);
  }

  pushChat(m) {
    this.chat.push(m);
    if (this.chat.length > 50) this.chat.shift();
    this.broadcastRaw({ type: 'chat', msg: m });
  }

  sys(text) { this.pushChat({ sys: true, text, ts: Date.now() }); }

  chatMsg(p, text) {
    const now = Date.now();
    if (now - p.lastChatAt < 600) return;
    text = String(text || '').replace(/[\u0000-\u001f\u007f<>]/g, ' ').trim().slice(0, 200);
    if (!text) return;
    p.lastChatAt = now;
    this.pushChat({ seat: p.seat, name: p.name, text, ts: now });
  }

  emote(p, e) {
    const ok = ['👍', '😂', '😎', '😭', '🔥', '😡', '🤝', '🍀', '👏', '🤔'];
    const now = Date.now();
    if (!ok.includes(e) || now - p.lastEmoteAt < 400) return;
    p.lastEmoteAt = now;
    this.broadcastRaw({ type: 'emote', seat: p.seat, e });
  }

  /* ---------- trimiterea stării ---------- */

  view(me) {
    const isTurn = this.turn === me.seat;
    const toCallFull = Math.max(0, this.currentBet - me.bet);
    const toCall = Math.min(toCallFull, me.stack);
    const others = this.activePlayers().filter((p) => p !== me && !p.allIn);
    const canRaise = isTurn && !me.raiseLocked && me.stack > toCallFull && others.length > 0;
    const maxTo = me.bet + me.stack;
    const minRaiseTo = Math.min(this.currentBet + this.lastRaise, maxTo);

    let myHand = null;
    if (me.inHand && !me.folded && me.cards.length === 2 && this.board.length >= 3) {
      myHand = handName(bestScore([...me.cards, ...this.board]));
    }

    const pub = (p) => {
      let cards = [];
      if (p === me) cards = p.cards.map(cardStr);
      else if (p.revealed) cards = p.cards.map(cardStr);
      else if (this.handActive && p.inHand && !p.folded) cards = ['??', '??'];
      return {
        seat: p.seat, name: p.name, stack: p.stack, bet: p.bet, folded: p.folded,
        allIn: p.allIn, connected: p.connected, sitOut: p.sitOut, inHand: p.inHand,
        last: p.last, winner: p.winner, admin: p.isAdmin, av: p.avatar, cards,
        handName: p.revealed && this.phase === 'ended' ? p.handName : '',
      };
    };

    return {
      type: 'state',
      now: Date.now(),
      room: this.id,
      started: this.started,
      paused: this.paused,
      over: this.over,
      endAfter: this.endAfter,
      handsPlayed: this.handsPlayed,
      standings: this.over ? this.standings() : null,
      phase: this.phase,
      handActive: this.handActive,
      handNo: this.handNo,
      dealer: this.dealer,
      turn: this.turn,
      turnDeadline: this.turnDeadline,
      turnTotal: this.turnTotal,
      nextHandAt: this.nextHandAt,
      board: this.board.map(cardStr),
      pot: this.totalPot(),
      currentBet: this.currentBet,
      sb: this.sb, bb: this.bb, startStack: this.startStack,
      result: this.result,
      me: me.seat,
      seats: this.seats.map((p) => (p ? pub(p) : null)),
      you: {
        isTurn, toCall, minRaiseTo, maxTo, canRaise, hand: myHand,
        canRebuy: me.stack === 0 && this.allowRebuy && !this.over && !(this.handActive && me.inHand),
        isAdmin: me.isAdmin,
        canRestart: me.isAdmin && this.over,
        canStart: me.isAdmin && !this.started && this.eligibleCount() >= 2,
        settings: me.isAdmin
          ? { sb: this.pendingSb || this.sb, timer: this.t.turn / 1000, allowRebuy: this.allowRebuy }
          : null,
      },
    };
  }

  broadcast() {
    for (const p of this.players()) {
      if (p.ws && p.ws.readyState === 1) {
        try { p.ws.send(JSON.stringify(this.view(p))); } catch (e) { /* ignorat */ }
      }
    }
  }
}

module.exports = { Table, cardStr };
