#!/usr/bin/env node
/**
 * BACKTEST INTEGRAL DE COMBATE (R5, 29-jul) — el peaje completo, sobre TODO el histórico.
 *
 * Orden de Alexis: "a diferencia de fútbol tenemos data suficiente para cualquier backtesting".
 * Aquí se mide, walk-forward y sin leakage, TODO lo que el producto publica:
 *   1. GANADOR: Elo puro vs Elo+features — accuracy, Brier skill, calibración por deciles y por segmentos
 *      (era, rounds pactados, banda de favoritismo, división).
 *   2. MÉTODO (KO/SUB/DEC) y ROUNDS: skill multiclase vs la base de división + calibración.
 *   3. EN VIVO (nuevo): la probabilidad condicionada al reloj, ¿le gana a la prob pre-pelea una vez que
 *      la pelea avanza? Se evalúa en CADA round que la pelea alcanzó.
 *   4. ESTRATEGIA DE PICKS (FIGHT / METHOD / ROUNDS) con las MISMAS reglas del monitor (blend 0.5,
 *      umbral de edge, 1 por familia por pelea) contra un MERCADO PROXY, porque no existe histórico de
 *      cuotas de MMA que podamos comprar:
 *        · FIGHT  → proxy = modelo Elo-puro (lo que sabe cualquiera con ratings) con vig del 5%.
 *        · METHOD → proxy = base de la división (lo que cotiza un libro perezoso) con vig del 5%.
 *        · ROUNDS → proxy = base de la división por rounds pactados, mismo vig.
 *      Se reporta hit rate, ROI y CLV-equivalente. NO es ROI real de casa: es "¿le ganamos a un mercado
 *      que solo sabe lo básico?". Los libros de verdad son más afilados que el proxy — leerlo así.
 *
 * Uso:  node scripts/combat-backtest.js [--org=ufc|mma|both] [--json=out.json]
 */
const fs = require('fs');
const path = require('path');
const CE = require('../combat-engine/ratings');

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true];
}));
const ORGS = args.org === 'both' || !args.org ? ['ufc', 'mma'] : [args.org];
const VIG = 0.05;            // margen del libro proxy
const BLEND = 0.5;           // λ del blend modelo/mercado (mismo del monitor)
const EDGE_FIGHT = 0.02;     // 2pp post-blend (mismo del monitor)
const EDGE_PROP = 0.025;     // 2.5pp para METHOD/ROUNDS (mismo del monitor)
const WARM = 0.35;

const load = (org) => {
  const p = (n) => path.join(__dirname, '..', 'data', 'combat', n);
  const F = JSON.parse(fs.readFileSync(p(`fights-${org}.json`), 'utf8'));
  let fighters = {}; try { fighters = JSON.parse(fs.readFileSync(p(`fighters-${org}.json`), 'utf8')); } catch { }
  const fights = (F.fights || []).filter(f => f.completed && f.f1.id && f.f2.id && (f.f1.winner || f.f2.winner))
    .sort((a, b) => new Date(a.date) - new Date(b.date));
  return { fights, fighters };
};

const clockMin = (c) => { const m = String(c || '').match(/(\d+):(\d+)/); return m ? (+m[1] + +m[2] / 60) : 0; };
const era = (d) => (d < '2013' ? '≤2012' : d < '2020' ? '2013-19' : '2020-26');
const band = (p) => { const q = Math.max(p, 1 - p); return q < 0.6 ? '50-60' : q < 0.7 ? '60-70' : q < 0.85 ? '70-85' : '85+'; };
const fmtPct = (x, d = 1) => (x * 100).toFixed(d) + '%';
const mean = (a) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;

// acumulador de métricas binarias
const acc = () => ({ n: 0, hit: 0, brier: 0, base: 0, cal: Array.from({ length: 10 }, () => [0, 0]) });
const push = (A, p, y, pBase) => {
  A.n++; if ((p >= 0.5) === (y === 1)) A.hit++;
  A.brier += (p - y) ** 2; A.base += (pBase - y) ** 2;
  const b = Math.min(9, Math.floor(p * 10)); A.cal[b][0] += p; A.cal[b][1] += y;
};
const rep = (A) => ({
  n: A.n, acc: A.n ? A.hit / A.n : 0, brier: A.n ? A.brier / A.n : 0,
  skill: A.n ? (A.base - A.brier) / A.n : 0,
  cal_err: (() => { let e = 0, w = 0; for (const [sp, sy] of A.cal.map((c, i) => [c[0], c[1]]).map((x, i) => [x[0], x[1]])) { } return e; })(),
});
// calibración: error medio |media(p) − tasa real| ponderado por volumen
const calErr = (A, counts) => {
  let e = 0, w = 0;
  for (let i = 0; i < 10; i++) { const c = counts[i]; if (!c) continue; e += c * Math.abs(A.cal[i][0] / c - A.cal[i][1] / c); w += c; }
  return w ? e / w : 0;
};

function run(org) {
  const { fights, fighters } = load(org);
  const warm = Math.floor(fights.length * WARM);
  console.log(`\n${'='.repeat(78)}\nORG ${org.toUpperCase()} — ${fights.length} peleas completadas (${fights[0].date.slice(0, 10)} → ${fights[fights.length - 1].date.slice(0, 10)})`);
  console.log(`warm-up ${warm} (${fmtPct(WARM, 0)}) · out-of-sample ${fights.length - warm}`);

  // ---- estado incremental (mismo update que fitElo, evaluando SIEMPRE antes de aprender) ----
  const model = CE.newModel(fighters, {});
  let mm = CE.methodModel([]);
  const seen = [];                       // peleas ya "vistas" (para refit de método)
  const A = { elo: acc(), full: acc() }; // ganador
  const cnt = { elo: Array(10).fill(0), full: Array(10).fill(0) };
  const seg = {};                        // segmentos → acumuladores
  const segCnt = {};
  const addSeg = (k, p, y, pb) => { (seg[k] = seg[k] || acc()); (segCnt[k] = segCnt[k] || Array(10).fill(0)); push(seg[k], p, y, pb); segCnt[k][Math.min(9, Math.floor(p * 10))]++; };

  // método
  const M = { n: 0, ll: 0, llBase: 0, hit: 0, hitBase: 0 };
  const Mcls = { ko: acc(), sub: acc(), dec: acc() };
  const MclsCnt = { ko: Array(10).fill(0), sub: Array(10).fill(0), dec: Array(10).fill(0) };
  // rounds
  const RD = { u25_3: acc(), u25_5: acc(), fin: acc() };
  const RDcnt = { u25_3: Array(10).fill(0), u25_5: Array(10).fill(0), fin: Array(10).fill(0) };
  // EN VIVO
  const LIVE = {};   // por round alcanzado: {live: acc, pre: acc}
  const LIVEcnt = {};
  const LIVEF = {};  // R3+ segmentado por P(finish) pre-pelea: donde condicionar DEBE pesar más
  // control de sesgo de orden: ESPN lista primero al favorito ~57% de las veces; el modelo es antisimétrico
  // sin intercepto (no lo explota a propósito). Si las picks se concentran en f1, el ROI es artefacto.
  const BIAS = { n: 0, sumP: 0, y: 0 };
  // PICKS. FIGHT se evalúa contra DOS mercados proxy:
  //  · proxy crudo  = Elo puro (antisimétrico, igual que el modelo)
  //  · proxy justo  = Elo puro + intercepto calibrado al ritmo real de victorias de f1 hasta esa fecha.
  // El segundo es el honesto: un libro de verdad JAMÁS deja servido un sesgo sistemático de 5pp, y nuestro
  // modelo renuncia a ese intercepto a propósito (explotar "el listado primero" no existe en un mercado).
  const picks = { FIGHT: [], FIGHT_JUSTO: [], METHOD: [], ROUNDS: [] };
  let seenF1 = 0, seenTot = 0;

  let refitAt = 0;
  for (let i = 0; i < fights.length; i++) {
    const f = fights[i];
    const y = f.f1.winner ? 1 : 0;
    const sched = f.rounds_sched >= 3 ? f.rounds_sched : 3;

    if (i >= warm) {
      // ---------- 1. GANADOR ----------
      const pf = CE.fightProb(model, f.f1.id, f.f2.id, f.date);
      const pFull = pf.p1;
      // Elo puro = misma pasada, sin la capa de features (model.w desactivado temporalmente)
      const wSave = model.w; model.w = null;
      const pElo = CE.fightProb(model, f.f1.id, f.f2.id, f.date).p1;
      model.w = wSave;

      BIAS.n++; BIAS.sumP += pFull; BIAS.y += y;
      push(A.elo, pElo, y, 0.5); cnt.elo[Math.min(9, Math.floor(pElo * 10))]++;
      push(A.full, pFull, y, pElo); cnt.full[Math.min(9, Math.floor(pFull * 10))]++;
      addSeg(`era:${era(f.date)}`, pFull, y, pElo);
      addSeg(`sched:${sched}R`, pFull, y, pElo);
      addSeg(`banda:${band(pFull)}`, pFull, y, pElo);
      if (f.weight) addSeg(`div:${f.weight}`, pFull, y, pElo);

      // ---------- 2. MÉTODO + ROUNDS ----------
      const cls = CE.methodClass(f.method);
      const mp = CE.methodProbs(mm, pFull, f.f1.id, f.f2.id, f.weight, sched);
      if (cls) {
        // base de división (lo que sabría un libro perezoso)
        const base = divBase(mm, f.weight);
        const pm = { ko: mp.ko, sub: mp.sub, dec: mp.dec };
        M.n++;
        M.ll += Math.log(Math.max(1e-6, pm[cls]));
        M.llBase += Math.log(Math.max(1e-6, base[cls]));
        const top = (o) => Object.entries(o).sort((a, b) => b[1] - a[1])[0][0];
        if (top(pm) === cls) M.hit++;
        if (top(base) === cls) M.hitBase++;
        for (const c of ['ko', 'sub', 'dec']) {
          push(Mcls[c], pm[c], cls === c ? 1 : 0, base[c]);
          MclsCnt[c][Math.min(9, Math.floor(pm[c] * 10))]++;
        }
        // rounds: ¿terminó en ≤2.5 rounds? (finish en R1/R2) + ¿hubo finish?
        const isFin = cls !== 'dec';
        const endR = f.end_round || sched;
        const under25 = isFin && endR <= 2 ? 1 : 0;
        const key = sched >= 5 ? 'u25_5' : 'u25_3';
        const pU = mp.r_le[2] || 0;
        const bU = baseRound(mm, sched);
        push(RD[key], pU, under25, bU.u25); RDcnt[key][Math.min(9, Math.floor(pU * 10))]++;
        push(RD.fin, mp.finish, isFin ? 1 : 0, bU.fin); RDcnt.fin[Math.min(9, Math.floor(mp.finish * 10))]++;

        // ---------- 3. EN VIVO ----------
        // para cada round que la pelea ALCANZÓ, prob condicionada al arranque de ese round
        const reached = isFin ? endR : sched;
        for (let r = 1; r <= reached; r++) {
          const lv = CE.liveFightProbs(mp, sched, { round: r, elapsed: 0 });
          const kk = `R${r}`;
          LIVE[kk] = LIVE[kk] || { live: acc(), pre: acc() };
          LIVEcnt[kk] = LIVEcnt[kk] || { live: Array(10).fill(0), pre: Array(10).fill(0) };
          push(LIVE[kk].live, lv.p1, y, pFull);
          push(LIVE[kk].pre, pFull, y, 0.5);
          LIVEcnt[kk].live[Math.min(9, Math.floor(lv.p1 * 10))]++;
          LIVEcnt[kk].pre[Math.min(9, Math.floor(pFull * 10))]++;
          if (r >= 3) { // donde el condicionamiento tiene algo que decir: segmentado por P(finish) pre-pelea
            const fb = mp.finish < 0.4 ? 'fin<40%' : mp.finish < 0.6 ? 'fin 40-60%' : 'fin>60%';
            LIVEF[fb] = LIVEF[fb] || { live: acc(), pre: acc() };
            push(LIVEF[fb].live, lv.p1, y, pFull);
            push(LIVEF[fb].pre, pFull, y, 0.5);
          }
        }

        // ---------- 4. PICKS ----------
        // FIGHT: mercado proxy = Elo puro; blend; edge ≥2pp; se apuesta el lado con edge
        const mkt = { f1: pElo, f2: 1 - pElo };
        const mdl = { f1: pFull, f2: 1 - pFull };
        let best = null;
        for (const side of ['f1', 'f2']) {
          const blend = BLEND * mdl[side] + (1 - BLEND) * mkt[side];
          const edge = blend - mkt[side];
          if (edge >= EDGE_FIGHT && (!best || edge > best.edge)) best = { side, edge, price: price(mkt[side]), p: blend };
        }
        if (best) picks.FIGHT.push({ date: f.date, edge: best.edge, price: best.price, p: best.p, side: best.side,
          win: (best.side === 'f1' ? y === 1 : y === 0) ? 1 : 0, band: band(pFull), sched, div: f.weight });

        // mismo rulebook contra el proxy JUSTO (Elo + intercepto del ritmo real de f1 hasta hoy)
        const rate = seenTot >= 200 ? seenF1 / seenTot : 0.5;
        const shift = Math.log(rate / (1 - rate));
        const pEloJ = 1 / (1 + Math.exp(-(Math.log(pElo / (1 - pElo)) + shift)));
        const mktJ = { f1: pEloJ, f2: 1 - pEloJ };
        let bj = null;
        for (const side of ['f1', 'f2']) {
          const blend = BLEND * mdl[side] + (1 - BLEND) * mktJ[side];
          const edge = blend - mktJ[side];
          if (edge >= EDGE_FIGHT && (!bj || edge > bj.edge)) bj = { side, edge, price: price(mktJ[side]), p: blend };
        }
        if (bj) picks.FIGHT_JUSTO.push({ date: f.date, edge: bj.edge, price: bj.price, p: bj.p, side: bj.side,
          win: (bj.side === 'f1' ? y === 1 : y === 0) ? 1 : 0, band: band(pFull), sched, div: f.weight });

        // METHOD: mercado proxy = base de división; una sola pick (mayor edge)
        let bm = null;
        for (const c of ['ko', 'sub', 'dec']) {
          const blend = BLEND * pm[c] + (1 - BLEND) * base[c];
          const edge = blend - base[c];
          if (edge >= EDGE_PROP && (!bm || edge > bm.edge)) bm = { c, edge, price: price(base[c]), p: blend };
        }
        if (bm) picks.METHOD.push({ date: f.date, edge: bm.edge, price: bm.price, p: bm.p,
          win: cls === bm.c ? 1 : 0, band: band(pFull), sched, div: f.weight, pick: bm.c });

        // ROUNDS: under/over 2.5 contra la base de rounds de la división
        {
          const pOver = 1 - pU, bOver = 1 - bU.u25;
          const cands = [
            { s: 'under', p: pU, m: bU.u25, win: under25 },
            { s: 'over', p: pOver, m: bOver, win: 1 - under25 },
          ];
          let br = null;
          for (const c of cands) {
            const blend = BLEND * c.p + (1 - BLEND) * c.m;
            const edge = blend - c.m;
            if (edge >= EDGE_PROP && (!br || edge > br.edge)) br = { ...c, edge, price: price(c.m), pb: blend };
          }
          if (br) picks.ROUNDS.push({ date: f.date, edge: br.edge, price: br.price, p: br.pb,
            win: br.win, band: band(pFull), sched, div: f.weight, pick: br.s });
        }
      }
    }

    // ---- aprender esta pelea (después de evaluar: sin leakage) ----
    seen.push(f);
    seenTot++; if (y === 1) seenF1++;
    CE.eloStep(model, f, null);
    if (seen.length - refitAt >= 25) { mm = CE.methodModel(seen); refitAt = seen.length; }
  }

  // ================= REPORTE =================
  const line = (t) => console.log(t);
  line(`\n── 1. GANADOR ─────────────────────────────────────────────────────────────`);
  const rE = rep(A.elo), rF = rep(A.full);
  line(`Elo puro       n=${rE.n}  acc=${fmtPct(rE.acc)}  brier=${rE.brier.toFixed(4)}  skill(vs 0.5)=${rE.skill.toFixed(4)}  cal_err=${calErr(A.elo, cnt.elo).toFixed(4)}`);
  line(`Elo+features   n=${rF.n}  acc=${fmtPct(rF.acc)}  brier=${rF.brier.toFixed(4)}  skill(vs Elo)=${rF.skill.toFixed(4)}  cal_err=${calErr(A.full, cnt.full).toFixed(4)}`);
  line(`\n  calibración por decil (predicho → real, n):`);
  for (let i = 0; i < 10; i++) { const c = cnt.full[i]; if (!c) continue; line(`   ${(i * 10).toString().padStart(3)}-${i * 10 + 10}%  ${fmtPct(A.full.cal[i][0] / c)} → ${fmtPct(A.full.cal[i][1] / c)}  (n=${c})`); }
  line(`\n  por segmento (skill vs Elo puro):`);
  for (const k of Object.keys(seg).sort()) {
    const r = rep(seg[k]); if (r.n < 60) continue;
    line(`   ${k.padEnd(22)} n=${String(r.n).padStart(5)}  acc=${fmtPct(r.acc)}  skill=${r.skill >= 0 ? '+' : ''}${r.skill.toFixed(4)}  cal_err=${calErr(seg[k], segCnt[k]).toFixed(4)}`);
  }

  line(`\n── 2. MÉTODO Y ROUNDS ─────────────────────────────────────────────────────`);
  line(`Método  n=${M.n}  logloss=${(-M.ll / M.n).toFixed(4)} vs base división ${(-M.llBase / M.n).toFixed(4)}  skill=${((M.llBase - M.ll) / M.n).toFixed(4)}`);
  line(`        acierto de la clase más probable: ${fmtPct(M.hit / M.n)} vs base ${fmtPct(M.hitBase / M.n)}`);
  for (const c of ['ko', 'sub', 'dec']) {
    const r = rep(Mcls[c]);
    line(`        ${c.toUpperCase().padEnd(4)} brier=${r.brier.toFixed(4)}  skill=${r.skill >= 0 ? '+' : ''}${r.skill.toFixed(4)}  cal_err=${calErr(Mcls[c], MclsCnt[c]).toFixed(4)}`);
  }
  for (const [k, lbl] of [['u25_3', 'U2.5 (3R)'], ['u25_5', 'U2.5 (5R)'], ['fin', 'FINISH']]) {
    const r = rep(RD[k]); if (!r.n) continue;
    line(`${lbl.padEnd(12)} n=${r.n}  brier=${r.brier.toFixed(4)}  skill=${r.skill >= 0 ? '+' : ''}${r.skill.toFixed(4)}  cal_err=${calErr(RD[k], RDcnt[k]).toFixed(4)}`);
  }

  line(`\n── 3. PROBABILIDAD EN VIVO ────────────────────────────────────────────────`);
  line(`   (¿condicionar al reloj le gana a la prob pre-pelea, en las peleas que llegaron a ese round?)`);
  for (const k of Object.keys(LIVE).sort()) {
    const L = rep(LIVE[k].live), P = rep(LIVE[k].pre);
    if (L.n < 100) continue;
    line(`   ${k}  n=${String(L.n).padStart(5)}  live brier=${L.brier.toFixed(4)} acc=${fmtPct(L.acc)}  |  pre brier=${P.brier.toFixed(4)} acc=${fmtPct(P.acc)}  |  skill=${L.skill >= 0 ? '+' : ''}${L.skill.toFixed(4)}  cal_err=${calErr(LIVE[k].live, LIVEcnt[k].live).toFixed(4)}`);
  }

  for (const k of Object.keys(LIVEF).sort()) {
    const L = rep(LIVEF[k].live), P = rep(LIVEF[k].pre);
    line(`   R3+ ${k.padEnd(11)} n=${String(L.n).padStart(5)}  live brier=${L.brier.toFixed(4)}  pre brier=${P.brier.toFixed(4)}  skill=${L.skill >= 0 ? '+' : ''}${L.skill.toFixed(4)}`);
  }

  line(`\n── CONTROL DE SESGO DE ORDEN ──────────────────────────────────────────────`);
  line(`   f1 (listado primero por ESPN) gana ${fmtPct(BIAS.y / BIAS.n)} de las peleas; el modelo le asigna ${fmtPct(BIAS.sumP / BIAS.n)} en promedio.`);
  line(`   Diferencia = ${((BIAS.y / BIAS.n - BIAS.sumP / BIAS.n) * 100).toFixed(1)}pp — es el sesgo del ORDEN, que el modelo antisimétrico no explota (correcto: en un mercado real no existe "el listado primero").`);

  line(`\n── 4. ESTRATEGIA DE PICKS (vs mercado proxy, vig ${fmtPct(VIG, 0)}) ────────────────────`);
  const out = { org, winner: { elo: rE, full: rF }, method: M, picks: {} };
  for (const fam of ['FIGHT', 'FIGHT_JUSTO', 'METHOD', 'ROUNDS']) {
    const P = picks[fam];
    if (!P.length) { line(`${fam}: sin picks`); continue; }
    const roi = mean(P.map(x => x.win ? x.price - 1 : -1));
    const hit = mean(P.map(x => x.win));
    const be = mean(P.map(x => 1 / x.price));
    const fair = mean(P.map(x => x.win / x.p - 1));  // ROI a cuota justa del propio modelo = sesgo de calibración
    const z = zTest(P.map(x => x.win), P.map(x => 1 / x.price));
    line(`${fam.padEnd(7)} n=${String(P.length).padStart(5)}  hit=${fmtPct(hit)}  breakeven=${fmtPct(be)}  ROI=${(roi * 100).toFixed(1)}%  z=${z.toFixed(2)}  p=${pval(z).toFixed(4)}  |  ROI a cuota justa=${(fair * 100).toFixed(1)}%`);
    // por mitades temporales (walk-forward interno)
    const mid = Math.floor(P.length / 2);
    for (const [lbl, arr] of [['1ª mitad', P.slice(0, mid)], ['2ª mitad', P.slice(mid)]]) {
      if (!arr.length) continue;
      line(`         ${lbl}: n=${arr.length} hit=${fmtPct(mean(arr.map(x => x.win)))} ROI=${(mean(arr.map(x => x.win ? x.price - 1 : -1)) * 100).toFixed(1)}%`);
    }
    // control de artefacto: si el ROI vive solo en un lado, es el sesgo de orden y no edge
    if (fam.startsWith('FIGHT')) {
      for (const s of ['f1', 'f2']) {
        const a2 = P.filter(x => x.side === s); if (!a2.length) continue;
        line(`         lado ${s}: n=${a2.length} (${fmtPct(a2.length / P.length, 0)}) hit=${fmtPct(mean(a2.map(x => x.win)))} ROI=${(mean(a2.map(x => x.win ? x.price - 1 : -1)) * 100).toFixed(1)}%`);
      }
    }
    // bootstrap del ROI (2000 remuestreos): intervalo y P(ROI>0)
    const bs = bootstrap(P.map(x => x.win ? x.price - 1 : -1), 2000);
    line(`         bootstrap ROI: IC95 [${(bs.lo * 100).toFixed(1)}%, ${(bs.hi * 100).toFixed(1)}%]  P(ROI>0)=${bs.pPos.toFixed(3)}`);
    // por banda de favoritismo
    const byB = {};
    for (const x of P) (byB[x.band] = byB[x.band] || []).push(x);
    for (const b of Object.keys(byB).sort()) {
      const a2 = byB[b]; if (a2.length < 40) continue;
      line(`         banda ${b}: n=${a2.length} hit=${fmtPct(mean(a2.map(x => x.win)))} ROI=${(mean(a2.map(x => x.win ? x.price - 1 : -1)) * 100).toFixed(1)}%`);
    }
    out.picks[fam] = { n: P.length, hit, be, roi, fair, z };
  }
  return out;
}

// base de método de una división (el "mercado perezoso")
function divBase(mm, weight) {
  let w = mm.W[weight || '?'];
  if (!w) { w = { ko: 1, sub: 1, dec: 1 }; for (const v of Object.values(mm.W)) for (const c of ['ko', 'sub', 'dec']) w[c] += v[c]; }
  const t = w.ko + w.sub + w.dec;
  return { ko: w.ko / t, sub: w.sub / t, dec: w.dec / t };
}
// base de rounds: P(finish) y P(termina en ≤2 rounds) de la distribución global de la división/sched
function baseRound(mm, sched) {
  const sc = sched >= 3 ? sched : 3;
  const fin = mm.FIN[sc];
  let tot = 0, all = 0;
  for (const v of Object.values(mm.W)) { tot += v.ko + v.sub; all += v.ko + v.sub + v.dec; }
  const pFin = all ? tot / all : 0.5;
  if (!fin) return { fin: pFin, u25: pFin * 0.6 };
  const t = fin.slice(1).reduce((a, x) => a + x, 0);
  const le2 = (fin[1] + (fin[2] || 0)) / t;
  return { fin: pFin, u25: pFin * le2 };
}
const price = (p) => 1 / Math.min(0.98, Math.max(0.02, p * (1 + VIG)));
function bootstrap(rets, B) {
  const n = rets.length; const out = [];
  for (let b = 0; b < B; b++) { let s = 0; for (let i = 0; i < n; i++) s += rets[(Math.random() * n) | 0]; out.push(s / n); }
  out.sort((a, b) => a - b);
  return { lo: out[Math.floor(B * 0.025)], hi: out[Math.floor(B * 0.975)], pPos: out.filter(x => x > 0).length / B };
}
// z de la tasa observada vs la implícita del precio (¿le ganamos al mercado proxy?)
function zTest(wins, probs) {
  const n = wins.length; const exp = probs.reduce((a, b) => a + b, 0);
  const obs = wins.reduce((a, b) => a + b, 0);
  const varr = probs.reduce((a, p) => a + p * (1 - p), 0);
  return varr > 0 ? (obs - exp) / Math.sqrt(varr) : 0;
}
const pval = (z) => { // dos colas, aproximación de Abramowitz-Stegun
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return Math.max(0, Math.min(1, 1 - y));
};

const results = [];
for (const org of ORGS) results.push(run(org));
if (args.json) fs.writeFileSync(args.json, JSON.stringify(results, null, 2));
console.log('\n' + '='.repeat(78) + '\nlisto.');
