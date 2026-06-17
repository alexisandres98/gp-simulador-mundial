// gpTake.js — generación determinística del "GP Take" (sin IA externa).
// Interpreta modelo vs mercado y devuelve la forma NormalizedGPTake.
// Respeta las reglas de producto: no recomendar longshots (<30%) ni apostar
// contra el favorito del modelo. Coherente con buildMatchTake del frontend.
//
// Opción C (jun 2026): las lesiones/bajas confirmadas INFORMAN la lectura
// (drivers + confianza), pero NO cambian las probabilidades del modelo.

const MIN_BACK = 0.30;

function pct(p) { return (p * 100).toFixed(1) + '%'; }
function cents(p) { return (p * 100).toFixed(1) + '¢'; }
function lowerConf(c) { return c === 'Alta' ? 'Media' : 'Media' === c ? 'Baja' : 'Baja'; }

// model: {home,draw,away}; outcomes: {home:{price,bid,ask,volume},draw,away}
// names: {home, draw:'el empate', away}
// opts: { pureArb, liquidityUsd, injuries: { home:{team,players:[]}, away:{team,players:[]} } }
function generateGPTake(model, outcomes, names, opts = {}) {
  const inj = opts.injuries || {};

  // Cierre común: añade bajas como drivers (informativo) y, si respaldamos a un
  // equipo con bajas confirmadas, baja la confianza un escalón. Nunca toca label/edge.
  function finish(out, backedSide) {
    for (const side of ['home', 'away']) {
      const s = inj[side];
      if (s && s.players && s.players.length) {
        out.drivers.push(`Bajas en ${s.team}: ${s.players.slice(0, 3).join(', ')}${s.players.length > 3 ? '…' : ''}`);
      }
    }
    if (backedSide && backedSide !== 'draw' && inj[backedSide] && inj[backedSide].players && inj[backedSide].players.length) {
      out.confidence = lowerConf(out.confidence);
      out.risk = out.risk === 'Bajo' ? 'Medio' : out.risk === 'Medio' ? 'Alto' : 'Alto';
      out.drivers.push(`Confianza ajustada por bajas en ${names[backedSide]}`);
    }
    return out;
  }

  const out = {
    label: 'WATCH', title: '', summary: '', confidence: 'Media', risk: 'Medio', drivers: [],
  };

  if (!model || !outcomes || (!outcomes.home && !outcomes.away)) {
    out.label = 'WATCH';
    out.title = 'Datos de mercado incompletos';
    out.summary = 'Aún no tenemos precio de mercado fiable para este partido. El modelo ya tiene su lectura; falta la contraparte del mercado para medir valor.';
    out.confidence = 'Baja';
    if (model) {
      const top = ['home', 'draw', 'away'].reduce((a, b) => model[a] >= model[b] ? a : b);
      out.drivers.push(`Modelo: ${names[top]} ${pct(model[top])}`);
    }
    out.drivers.push('Sin precio de mercado comparable');
    return finish(out, null);
  }

  // Arbitraje puro tiene prioridad
  if (opts.pureArb && opts.pureArb.edge > 0) {
    return finish({
      label: 'PURE_ARB',
      title: 'Arbitraje puro entre plataformas',
      summary: `Polymarket y Kalshi se contradicen lo suficiente para asegurar ganancia gane quien gane (~${pct(opts.pureArb.edge)} bruto, antes de fees).`,
      confidence: 'Alta',
      risk: 'Bajo',
      drivers: [opts.pureArb.note || 'Diferencia de precio entre plataformas', 'Riesgo de modelo: ninguno', 'Depende de ejecución y fees'],
    }, null);
  }

  const top = ['home', 'draw', 'away'].reduce((a, b) => model[a] >= model[b] ? a : b);
  const cands = [];
  for (const side of ['home', 'draw', 'away']) {
    const o = outcomes[side]; if (!o) continue;
    const p = model[side];
    const ask = o.ask != null ? o.ask : o.price;
    const bid = o.bid != null ? o.bid : o.price;
    if (ask > 0.001 && p - ask > 0 && p >= MIN_BACK) cands.push({ side, dir: 'back', edge: p - ask, price: ask, p });
    if (bid > 0.001 && bid - p > 0 && (1 - p) >= MIN_BACK && side !== top) cands.push({ side, dir: 'fade', edge: bid - p, price: bid, p });
  }
  cands.sort((a, b) => b.edge - a.edge);
  const best = cands[0];

  if (!best || best.edge < 0.02) {
    out.label = 'PASS';
    out.title = 'Modelo y mercado alineados';
    out.summary = 'El precio del mercado ya descuenta lo que ve nuestro modelo. Sin ventaja clara — preferimos no jugar este resultado.';
    out.confidence = 'Media';
    out.risk = 'Bajo';
    out.drivers = [
      `Modelo: ${names[top]} ${pct(model[top])}`,
      outcomes[top] ? `Mercado: ${cents(outcomes[top].price)}` : 'Mercado cercano',
      'Edge por debajo del umbral',
      'Mejor buscar props o entrada en vivo',
    ];
    return finish(out, null);
  }

  // grado por edge
  const e = best.edge;
  if (e >= 0.10) out.label = 'STRONG';
  else if (e >= 0.04) out.label = 'LEAN';
  else if (e >= 0.02) out.label = 'WATCH';

  const lbl = names[best.side];
  if (best.dir === 'back') {
    out.title = `Valor en ${lbl}`;
    out.summary = `El modelo le da ${pct(best.p)} y el mercado lo paga a ${cents(best.price)}: hay valor respaldando ${lbl}.`;
  } else {
    out.title = `El mercado sobrevalora a ${lbl}`;
    out.summary = `El mercado paga ${lbl} a ${cents(best.price)} frente al ${pct(best.p)} del modelo: el valor está en ir en contra.`;
  }

  // confianza por edge + liquidez
  out.confidence = e >= 0.10 ? 'Alta' : e >= 0.05 ? 'Media' : 'Baja';
  const liq = opts.liquidityUsd || 0;
  if (liq && liq < 4e5 && out.confidence === 'Alta') out.confidence = 'Media';
  if (liq && liq < 1e5 && out.confidence !== 'Baja') out.confidence = 'Baja';

  // riesgo de ejecución por probabilidad respaldada
  const backedP = best.dir === 'back' ? best.p : 1 - best.p;
  out.risk = backedP >= 0.55 ? 'Bajo' : backedP >= 0.38 ? 'Medio' : 'Alto';

  out.drivers = [
    `Modelo: ${lbl} ${pct(best.p)}`,
    `Mercado: ${cents(best.price)}`,
    `Edge estimado: +${pct(best.edge)}`,
  ];
  if (liq) out.drivers.push(`Liquidez: ${liq >= 2e6 ? 'alta' : liq >= 4e5 ? 'media' : 'baja'}`);

  // bajas: solo penaliza confianza si respaldamos (back) al equipo con bajas
  return finish(out, best.dir === 'back' ? best.side : null);
}

module.exports = { generateGPTake };
