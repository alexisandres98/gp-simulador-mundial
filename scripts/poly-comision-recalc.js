// scripts/poly-comision-recalc.js — LA SOMBRA DE POLYMARKET, RECALCULADA CON LA COMISIÓN (15-sep-2026)
//
// POR QUÉ. Hasta el 15-sep la sombra anotaba `pnl = shares − costo` y no restaba lo que Polymarket cobra
// al taker por cada cruce. Todo lo que se publicó de esa sombra —incluido el +3,86 % que casi enciende el
// ejecutor real sobre `futbol:No`— estaba inflado por esa cantidad. Este script rehace el track con la
// comisión puesta y enseña el antes y el después juntos, que es la única forma de que nadie compare un
// número nuevo con uno viejo sin darse cuenta.
//
// DOS MODOS, Y NO SON INTERCAMBIABLES:
//
//   --ledger [fichero.json]   EXACTO. Recorre posición a posición y aplica `fee = C·tasa·p·(1−p)` con el
//                             precio y las acciones REALES de cada fill. Sin fichero lee el almacén vivo
//                             (`/data/propfirm/poly-sombra.json`); con fichero acepta el volcado de
//                             `/api/internal/picks-export?key=…&poly=1`. Es el que hay que correr en
//                             producción; es donde vive el ledger.
//
//   --agregado                ESTIMACIÓN. Cuando no se alcanza el ledger, reconstruye el precio medio
//                             ponderado por acción a partir de los agregados publicados (n, acierto,
//                             apostado, P&L) y aplica la comisión sobre él. El precio medio sale de una
//                             identidad contable, no de un supuesto: lo que paga la casa es una acción por
//                             cada acción ganadora, así que `payout = apostado + P&L` ES el número de
//                             acciones ganadoras, y dividiendo el coste de las ganadoras entre ellas sale
//                             su precio medio. Lo que sí es supuesto —y por eso el número es una
//                             estimación— es que las perdedoras se compraron al mismo precio medio. No lo
//                             son: las ganadoras tiran hacia el favorito, así que este modo SUBESTIMA la
//                             comisión. Por eso imprime también la banda.
//
// Uso:
//   node scripts/poly-comision-recalc.js --agregado
//   node scripts/poly-comision-recalc.js --ledger
//   node scripts/poly-comision-recalc.js --ledger /tmp/poly-export.json --tasa 0.03
'use strict';

const fs = require('fs');
const COM = require('../lib/comisiones');

const args = process.argv.slice(2);
const tieneFlag = (f) => args.includes(f);
const valorDe = (f, def) => { const i = args.indexOf(f); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : def; };

// Las dos tasas que la casa da hoy para los mismos mercados, y que no coinciden. Ver docs/CONTRATOS_CASA.md:
// 0,03 es lo que devuelve el `feeSchedule` de cada binario de partido; 0,05 es lo que dice la tabla de
// categorías para Sports. Se publican las dos porque elegir una sola sería esconder el desacuerdo.
const TASAS = [0.03, 0.05];
const n2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : '—');
const pct = (x) => (Number.isFinite(x) ? x.toFixed(2) + ' %' : '—');

// ── MODO EXACTO ─────────────────────────────────────────────────────────────────────────────────────────
function ledger(fichero, tasaForzada) {
  let posiciones;
  if (fichero) {
    const j = JSON.parse(fs.readFileSync(fichero, 'utf8'));
    posiciones = j.posiciones || j;
  } else {
    posiciones = require('../propfirm/polyshadow').posiciones().posiciones;
  }
  const cerradas = posiciones.filter((p) => p.estado === 'WIN' || p.estado === 'LOSS');
  if (!cerradas.length) { console.log('el ledger no tiene ni una posición liquidada: nada que recalcular'); return; }

  const grupos = new Map();
  for (const p of cerradas) {
    const dep = p.deporte || (/^Will .+ win on /i.test(String(p.mercado || '')) ? 'futbol' : '?');
    const k = `${dep} · ${p.lado || '?'}`;
    for (const clave of [k, 'TOTAL']) {
      const g = grupos.get(clave) || { n: 0, w: 0, costo: 0, bruto: 0, com: 0 };
      // el bruto se reconstruye siempre del resultado, no del campo guardado: así el script vale igual para
      // posiciones anteriores al cambio (que no tienen `pnl_bruto`) y para las de después
      const bruto = p.estado === 'WIN' ? (p.shares || 0) - (p.costo || 0) : -(p.costo || 0);
      const com = COM.comisionPolymarket({ shares: p.shares, precio: p.precio_fill || p.precio_limite,
        tasa: tasaForzada != null ? tasaForzada : p.tasa_comision, exponente: p.fee_exp });
      g.n++; if (p.estado === 'WIN') g.w++;
      g.costo += p.costo || 0; g.bruto += bruto; g.com += com;
      grupos.set(clave, g);
    }
  }
  console.log(`\nSOMBRA DE POLYMARKET · recálculo EXACTO sobre ${cerradas.length} liquidadas`);
  console.log(`tasa: ${tasaForzada != null ? tasaForzada : 'la guardada en cada posición, o el defecto ' + COM.tasaPorDefecto()}\n`);
  console.log('| corte | n | apostado | P&L bruto | ROI bruto | comisión | P&L neto | ROI neto |');
  console.log('|---|---:|---:|---:|---:|---:|---:|---:|');
  for (const [k, g] of [...grupos].sort((a, b) => (a[0] === 'TOTAL' ? 1 : b[0] === 'TOTAL' ? -1 : b[1].n - a[1].n))) {
    const neto = g.bruto - g.com;
    console.log(`| ${k} | ${g.n} | ${n2(g.costo)} | ${n2(g.bruto)} | ${pct(100 * g.bruto / g.costo)} | ${n2(g.com)} | ${n2(neto)} | ${pct(100 * neto / g.costo)} |`);
  }
}

// ── MODO ESTIMACIÓN ─────────────────────────────────────────────────────────────────────────────────────
// Los agregados publicados en `docs/reportes/semana-38.html`, leídos de las sondas de producción el
// 14-sep-2026 entre 08:37 y 08:50 UTC. Son los mismos números que este documento tiene que corregir.
const CORTES = [
  { k: 'Sombra completa · desde el inicio (12-ago → 13-sep)', n: 341, acierto: 0.440, apostado: 9304.10, pnl: 358.90 },
  { k: 'Sombra completa · semana 38 (7-13 sep)', n: 190, acierto: 0.463, apostado: 5311.42, pnl: 363.58 },
  { k: '`futbol:No` · desde el inicio', n: 101, acierto: 0.535, apostado: 3029.46, pnl: 262.54 },
  { k: 'CS2 · semana 38', n: 112, acierto: 0.509, apostado: 2837.57, pnl: 653.43 },
  { k: 'Fútbol · semana 38', n: 69, acierto: 0.406, apostado: 2174.47, pnl: -211.47 },
  { k: 'LoL · semana 38', n: 9, acierto: 0.333, apostado: 299.38, pnl: -78.38 },
];

// precio medio ponderado por acción, deducido de la contabilidad: cada acción ganadora paga exactamente 1
function precioMedio(c) {
  const payout = c.apostado + c.pnl;                 // = número de acciones ganadoras
  if (!(payout > 0)) return null;
  const ganadoras = Math.round(c.n * c.acierto);
  if (!(ganadoras > 0)) return null;
  const costeGanadoras = c.apostado * (ganadoras / c.n);
  const p = costeGanadoras / payout;
  return p > 0 && p < 1 ? p : null;
}

function agregado() {
  console.log('\nSOMBRA DE POLYMARKET · ESTIMACIÓN desde los agregados publicados el 14-sep-2026');
  console.log('(el ledger vive en el disco de Render; el modo --ledger da el número exacto allí)\n');
  for (const tasa of TASAS) {
    console.log(`### tasa ${tasa.toFixed(2)}\n`);
    console.log('| corte | n | apostado | P&L antes | ROI antes | precio medio | comisión | P&L después | ROI después |');
    console.log('|---|---:|---:|---:|---:|---:|---:|---:|---:|');
    for (const c of CORTES) {
      const p = precioMedio(c);
      // fee = Σ Cᵢ·tasa·pᵢ(1−pᵢ) y Cᵢ·pᵢ = costeᵢ, así que fee = tasa · Σ costeᵢ(1−pᵢ) = tasa·apostado·(1−p̄)
      const com = p != null ? tasa * c.apostado * (1 - p) : null;
      const neto = com != null ? c.pnl - com : null;
      console.log(`| ${c.k} | ${c.n} | ${n2(c.apostado)} | ${n2(c.pnl)} | ${pct(100 * c.pnl / c.apostado)} | ${p != null ? p.toFixed(3) : '—'} | ${n2(com)} | ${n2(neto)} | ${pct(neto != null ? 100 * neto / c.apostado : NaN)} |`);
    }
    console.log('');
  }
  // La banda: la comisión como fracción del nocional es tasa·(1−p), así que basta con mover p para acotarla
  // sin fingir precisión que no tenemos.
  const c = CORTES[0];
  console.log('Banda del total (precio medio entre 0,35 y 0,50):');
  for (const tasa of TASAS) {
    const alto = tasa * c.apostado * (1 - 0.35), bajo = tasa * c.apostado * (1 - 0.50);
    console.log(`  tasa ${tasa.toFixed(2)} → comisión entre ${n2(bajo)} y ${n2(alto)} → P&L entre ${n2(c.pnl - alto)} y ${n2(c.pnl - bajo)}`);
  }
}

if (tieneFlag('--ledger')) {
  const t = valorDe('--tasa', null);
  ledger(valorDe('--ledger', null), t != null ? Number(t) : null);
} else {
  agregado();
}
