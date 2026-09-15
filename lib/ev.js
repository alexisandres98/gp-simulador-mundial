// lib/ev.js — EL VALOR ESPERADO AL CIERRE, TICKET A TICKET (15-sep-2026)
//
// ── POR QUÉ EXISTE ──────────────────────────────────────────────────────────────────────────────────────
// La vara del 11-sep medía si una familia era invertible restando el margen por lado a la media del CLV:
//
//     CLV_bruto = cuota_entrada / cuota_cierre − 1        margen_lado = (Q_cierre − 1) / 2
//     "neto"    = CLV_bruto − margen_lado                 ← ESTO NO ES EL RETORNO ESPERADO DE NADA
//
// Son dos magnitudes distintas y restarlas no da una tercera con sentido. La auditoría externa del 15-sep
// lo demostró con un contraejemplo que se reproduce en `tests/ev.test.js`:
//
//     cierre 1,904762 / 1,904762 (Q = 1,05, margen 2,5 % por lado), entrada aceptada a 1,97
//     CLV bruto          = 1,97 / 1,904762 − 1 = +3,425 %
//     regla vieja        = 3,425 − 2,5         = +0,925 %   → "invertible"
//     probabilidad justa del cierre            =  0,50
//     EV real            = 1,97 × 0,50 − 1     = −1,50 %    → se pierde dinero
//
// Una familia con esperanza negativa podía salir aprobada. Lo correcto es calcular, POR TICKET, el retorno
// esperado a la cuota que de verdad se aceptó, usando la probabilidad SIN MARGEN del cierre:
//
//     q_cierre = (1/cuota_cierre) / Q_cierre              Q_cierre = 1/cuota_A + 1/cuota_B
//     EV_cierre = cuota_entrada × q_cierre − 1 = (cuota_entrada / cuota_cierre) / Q_cierre − 1
//
// Y solo después se agrega. Nunca al revés: restar una mediana global de margen a una media de CLV mezcla
// tickets de mercados con márgenes distintos y no corresponde a ningún dinero.
//
// ── LAS DOS CARAS TIENEN QUE SER DE LA MISMA CASA Y DEL MISMO MOMENTO ───────────────────────────────────
// `Q` solo significa algo si las dos cuotas son del MISMO contrato, la MISMA casa y la MISMA foto. Con una
// cara de Pinnacle y otra de Bovada se fabrica un mercado que no existe, y con caras de momentos distintos
// se fabrica un arbitraje que nadie pudo tomar. Cuando falta una cara, este módulo devuelve `null` y el
// ticket queda fuera de la vara, contado aparte. Un margen supuesto haría pasar por invertible algo que no
// lo es: es exactamente el error que `lib/margen.js` ya se negaba a cometer.
//
// ── PAGOS FRACCIONARIOS: CUARTOS Y LÍNEAS ENTERAS ───────────────────────────────────────────────────────
// Media apuesta que devuelve y media que juega no es "una apuesta con otra probabilidad". El valor esperado
// se calcula con las masas de pago, no promediando probabilidades:
//
//     A = E[fracción del stake que gana]    B = E[fracción del stake que pierde]
//     EV(cuota) = A × (cuota − 1) − B       cuota_justa = 1 + B/A       p_equivalente = A / (A + B)
//
// Promediar las probabilidades condicionales de las dos medias líneas da otro número y con él se aceptan
// apuestas perdedoras: el ejemplo del over 2,25 del test da cuota justa 1,9444 frente a 1,9048 promediando.
'use strict';

const r2 = (x) => (Number.isFinite(x) ? +x.toFixed(2) : null);
const r4 = (x) => (Number.isFinite(x) ? +x.toFixed(4) : null);
const esCuota = (x) => Number.isFinite(x) && x > 1;

// ── 1. LA PROBABILIDAD JUSTA DE UN CIERRE DE DOS CARAS ──────────────────────────────────────────────────
// `cara` es la cuota del lado que se apostó; `contraria`, la del otro lado, de la MISMA casa y la MISMA
// captura. Devuelve null en cuanto falte una de las dos: sin las dos caras no hay margen medible.
function justaDeDosCaras(cara, contraria) {
  if (!esCuota(cara) || !esCuota(contraria)) return null;
  const ia = 1 / cara, ib = 1 / contraria;
  const Q = ia + ib;
  if (!(Q > 0)) return null;
  return { q: r4(ia / Q), Q: r4(Q), margen_total_pct: r2(100 * (Q - 1)), margen_lado_pct: r2(100 * (Q - 1) / 2) };
}

// ── 2. EL EV DE UN TICKET CONTRA SU CIERRE ──────────────────────────────────────────────────────────────
// Caso binario sin devolución. `entrada` es la cuota REALMENTE ACEPTADA (no la mejor del mercado, no la de
// la señal): el dinero se ganó o se perdió a esa. `costes` son comisiones expresadas como fracción del
// stake (Polymarket cobra, las casas de cuota fija no).
function evDeTicket({ entrada, cierre, cierreContraria, costes = 0 }) {
  if (!esCuota(entrada)) return { ok: false, motivo: 'sin cuota de entrada' };
  const justa = justaDeDosCaras(cierre, cierreContraria);
  if (!justa) return { ok: false, motivo: !esCuota(cierre) ? 'sin cierre' : 'sin la cara contraria del cierre' };
  const ev = entrada * justa.q - 1 - costes;
  return { ok: true, ev_pct: r2(100 * ev), q_cierre: justa.q, Q: justa.Q,
    margen_lado_pct: justa.margen_lado_pct, clv_bruto_pct: r2(100 * (entrada / cierre - 1)) };
}

// ── 3. EL EV CON PAGOS FRACCIONARIOS ────────────────────────────────────────────────────────────────────
// `pagos` es la lista de resultados posibles con su probabilidad y su reparto del stake:
//   { p, gana: 1, pierde: 0 }     gana entera        { p, gana: 0.5, pierde: 0 }   media gana, media devuelve
//   { p, gana: 0, pierde: 1 }     pierde entera      { p, gana: 0, pierde: 0.5 }   media pierde, media devuelve
// Las probabilidades deben sumar 1; lo que no es `gana` ni `pierde` se devuelve y no entra al cálculo.
function evFraccionario(pagos, cuota, { costes = 0 } = {}) {
  if (!Array.isArray(pagos) || !pagos.length) return null;
  let A = 0, B = 0, masa = 0;
  for (const x of pagos) {
    const p = Number(x && x.p);
    if (!Number.isFinite(p) || p < 0) return null;
    masa += p;
    A += p * (Number(x.gana) || 0);
    B += p * (Number(x.pierde) || 0);
  }
  if (Math.abs(masa - 1) > 1e-6) return null;                 // una distribución que no suma 1 no se valora
  const salida = { A: r4(A), B: r4(B), masa_devuelta: r4(Math.max(0, 1 - A - B)),
    cuota_justa: A > 0 ? r4(1 + B / A) : null, p_equivalente: A + B > 0 ? r4(A / (A + B)) : null };
  if (esCuota(cuota)) salida.ev_pct = r2(100 * (A * (cuota - 1) - B - costes));
  return salida;
}

// ── 4. EL AGREGADO ──────────────────────────────────────────────────────────────────────────────────────
// La media de los EV por ticket, con su incertidumbre por CLUSTERS de evento: dos líneas del mismo partido
// no son dos observaciones. Si `lib/inferencia.js` está disponible se usa su bootstrap; si no, se cae a la
// normal por filas y se dice en `metodo` (nunca en silencio: el número cambia de significado).
function agrega(tickets, { cluster = null, replicas = 2000, semilla = 42 } = {}) {
  const con = [], sin = { sin_cierre: 0, sin_contraria: 0, sin_entrada: 0, otros: 0 };
  for (const t of tickets || []) {
    const e = t && t.ev_pct != null ? { ok: true, ev_pct: t.ev_pct } : evDeTicket(t || {});
    if (e.ok) con.push({ ...t, ev_pct: e.ev_pct });
    else if (/sin cierre/.test(e.motivo)) sin.sin_cierre++;
    else if (/cara contraria/.test(e.motivo)) sin.sin_contraria++;
    else if (/entrada/.test(e.motivo)) sin.sin_entrada++;
    else sin.otros++;
  }
  const base = { n: con.length, descartados: sin, cobertura_pct: (con.length + sin.sin_cierre + sin.sin_contraria + sin.sin_entrada + sin.otros)
    ? r2(100 * con.length / (con.length + sin.sin_cierre + sin.sin_contraria + sin.sin_entrada + sin.otros)) : null };
  if (!con.length) return { ...base, ev_medio_pct: null, t: null, metodo: 'sin tickets con cierre de dos caras' };
  let INF = null; try { INF = require('./inferencia'); } catch { /* todavía no existe */ }
  if (INF && typeof INF.bootstrapClusters === 'function' && cluster) {
    const b = INF.bootstrapClusters(con, { valor: (x) => x.ev_pct, cluster, replicas, semilla });
    return { ...base, ev_medio_pct: r2(b.media), se_pct: r2(b.se), t: r2(b.t), ic_pct: b.ic ? b.ic.map(r2) : null,
      n_clusters: b.n_clusters, metodo: `bootstrap por clusters (${b.replicas} réplicas, semilla ${semilla})` };
  }
  const a = con.map((x) => x.ev_pct);
  const m = a.reduce((s, x) => s + x, 0) / a.length;
  const sd = a.length > 1 ? Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)) : null;
  const se = sd != null ? sd / Math.sqrt(a.length) : null;
  return { ...base, ev_medio_pct: r2(m), se_pct: r2(se), t: se ? r2(m / se) : null,
    ic_pct: se ? [r2(m - 1.96 * se), r2(m + 1.96 * se)] : null, n_clusters: null,
    metodo: cluster ? 'normal por filas (lib/inferencia no disponible): la incertidumbre está SUBESTIMADA'
      : 'normal por filas (sin clave de cluster): dos líneas del mismo partido cuentan como dos observaciones' };
}

// ── 5. EV CUANDO SOLO SE TIENE EL MARGEN DE LA FAMILIA ──────────────────────────────────────────────────
// Lo correcto es la cara contraria de ESE ticket. Cuando el archivo de cierres no la guarda pero sí se ha
// medido el sobre-redondeo Q de esa casa y esa familia (`lib/margen.js` empareja las dos caras cuando
// existen), se puede aplicar la MISMA fórmula con la Q mediana:
//
//     EV = (cuota_entrada / cuota_cierre) / Q − 1
//
// Es una aproximación —usa la Q típica de la familia, no la de ese partido— y se declara como tal. Pero es
// la fórmula correcta: la diferencia con restar el margen al CLV no es de precisión, es de significado.
// Con Q = 1,05, entrada 1,97 y cierre 1,904762, esto da −1,50 % y la resta daba +0,925 %.
function evDesdeMargen({ entrada, cierre, Q }) {
  if (!esCuota(entrada) || !esCuota(cierre) || !(Q > 0)) return { ok: false, motivo: 'faltan entrada, cierre o Q' };
  const ev = (entrada / cierre) / Q - 1;
  return { ok: true, ev_pct: r2(100 * ev), q_cierre: r4((1 / cierre) / Q), Q: r4(Q),
    clv_bruto_pct: r2(100 * (entrada / cierre - 1)),
    aproximado: 'Q mediana de la familia, no la del propio partido' };
}
// de un margen por lado en porcentaje (lo que publica `lib/margen.js`) a la Q que usa la fórmula
const QDeMargenLado = (margenLadoPct) => (Number.isFinite(margenLadoPct) ? 1 + 2 * margenLadoPct / 100 : null);

module.exports = { justaDeDosCaras, evDeTicket, evFraccionario, agrega, evDesdeMargen, QDeMargenLado };
