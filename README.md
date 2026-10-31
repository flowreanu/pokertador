# Poker cu prietenii

Texas Hold'em minimalist, în browser, pe bază de link de invitație. Fără conturi, fără bani reali (doar fise virtuale).

## Cum se joacă

1. Deschizi site-ul, alegi fisele de start și small blind-ul, apeși **Creează masa**.
2. Apeși **Copiază linkul** și îl trimiți prietenilor (2–9 jucători).
3. Fiecare își alege un nume și se așază. Când sunteți toți, apeși **Începe jocul**.
4. Mâinile se dau automat una după alta. Cine rămâne fără fise poate apăsa **Rebuy**.

Reguli implementate: blinds, Fold / Check / Call / Raise, All-in, side pots, showdown, timer de 30 s pe tură (fold/check automat), heads-up corect. Cine ratează 2 ture la rând e marcat absent până apasă „Reintră în joc". Dacă îți cade netul, refaci linkul și intri înapoi pe același loc, cu aceleași fise.

Cărțile se amestecă pe server (`crypto.randomInt`), iar fiecare jucător primește doar cărțile lui, deci nu se poate trișa din browser.

## Aspect și animații

- Avatare (16 animale la alegere, la intrare), cu un ring care se golește cât îți mai rămâne din timpul pe tură.
- Fiecare jucător are fisele pariate în față, ca stive colorate pe valori (1, 5, 25, 100, 500, 1000…), iar potul stă în centru.
- Cărțile zboară de la dealer, cele de pe masă se întorc una câte una, iar la showdown cărțile adversarilor se întorc. Fisele se adună în pot, apoi zboară la câștigător, cu confetti și cu evidențierea celor 5 cărți câștigătoare.
- Butonul 🎨 schimbă culoarea mesei (verde, albastru, roșu, mov).

## Admin, chat și sunete

- **Admin:** cine creează masa e adminul (♛ lângă nume). Doar el vede butonul „Începe jocul" și butonul ⚙ Admin: pauză după mâna curentă, small blind, timp pe tură, rebuy on/off, scoate jucător (cel scos nu mai poate reintra pe același link).
- **Linkul de admin:** în ⚙ Admin → „Copiază linkul de admin". E singura cale de a redeveni admin dacă schimbi telefonul sau ștergi datele browserului. Nu-l da nimănui. Linkul normal de invitație (butonul „Copiază linkul") nu dă drepturi de admin.
- **Chat:** butonul 💬, cu selector de emoji și reacții rapide (👍😂😎🔥…) care plutesc deasupra jucătorului. Ultimele 50 de mesaje se păstrează pentru cei care intră mai târziu.
- **Sunete:** cărți, fise, check, fold, all-in, „e rândul tău", tic-tac în ultimele 5 secunde și melodie la câștig. Sunt generate în browser (fără fișiere audio). Butonul 🔊 le oprește, iar alegerea se ține minte.

## Final de joc și clasament

- Jocul se termină singur când un singur jucător mai are fise, sau când adminul apasă ⚙ Admin → „Termină jocul" (se oprește după mâna curentă).
- Toți văd clasamentul final (locul, avatarul, fisele și câștigul/pierderea față de start). Doar adminul vede **▶ Joacă din nou**, care resetează fisele și începe o partidă nouă.
- Îți schimbi avatarul oricând dând click pe propriul avatar de la masă.

## Pornire locală

```bash
npm install
npm start          # http://localhost:3000
npm test           # evaluator + simulare de mii de mâini
```

Ca să testezi singur, deschide linkul mesei și într-o fereastră Incognito (altfel cele două tab-uri sunt același jucător).

## Deploy gratuit pe Render

1. Pune folderul pe GitHub (repo nou, privat sau public).
2. Pe https://render.com: **New → Web Service** → alegi repo-ul.
3. Setări: Runtime **Node**, Build Command `npm install`, Start Command `npm start`, Instance type **Free**.
   (Sau **New → Blueprint** și Render citește singur fișierul `render.yaml`.)
4. După 1–2 minute primești adresa `https://poker-prieteni.onrender.com`. Intri acolo, creezi masa și trimiți linkul.

### De știut despre planul gratuit

- După ~15 minute fără trafic, serviciul adoarme. Prima deschidere după asta durează 30–60 s. Deschide linkul cu un minut înainte să începeți.
- Mesele stau în memorie: la un redeploy sau restart al serverului, mesele active dispar (se creează una nouă în 2 secunde).
- Un server free e mai mult decât suficient pentru câteva mese cu prieteni.

## Structura

```
server.js        server HTTP + WebSocket, camere
game.js          logica mesei (pariuri, pot-uri, showdown)
eval.js          evaluator de mâini
public/index.html  interfața (HTML + CSS + JS, un singur fișier)
test/sim.js      teste automate
```
