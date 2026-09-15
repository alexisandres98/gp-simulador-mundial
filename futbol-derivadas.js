// futbol-derivadas.js — LAS FAMILIAS QUE LA CASA YA COTIZABA Y NO LEÍAMOS (20-ago)
//
// POR QUÉ EXISTE Y POR QUÉ VIVE APARTE. Midiendo Cloudbet salió que en los partidos que el colector
// descartaba la casa cotizaba entre 14 y 25 mercados. Cuatro de ellos —doble oportunidad, empate no válido,
// hándicap asiático de goles y totales de equipo— los sabe valorar el motor de goles SIN medir nada nuevo,
// porque salen de la misma matriz de marcador que ya calcula. Es inventario ejecutable que estábamos tirando.
//
// Pero una familia nueva no entra al feed público por el hecho de ser calculable. Entra a la SOMBRA, acumula
// muestra y la juzga el tablero de familias con la misma vara que a todas: el CLV y su estadístico. Por eso
// esto vive en su propio archivo y su propio almacén, y no toca `db.clubDailyPicks` ni `curate`: si algo aquí
// se rompe, el feed que ven los usuarios no se entera.
//
// LO QUE NO ENTRABA, Y POR QUÉ YA ENTRA (13-sep-2026). Hasta hoy este archivo decía: «los mercados por
// MITADES quedan fuera; repartir el gol entre los dos tiempos es una suposición que GP no ha medido, y una
// familia sin estructura medida no se apuesta». La regla era buena y sigue siéndolo: lo que ha cambiado es
// que la estructura YA ESTÁ MEDIDA. 33.364 partidos, 18 divisiones, cinco temporadas, con la validación
// contra el resultado real — todo en `goal-engine/mitades.js`, con su muestra y su fecha. Se abre porque se
// midió, no porque hiciera falta inventario.
//
// EL CENSO QUE LO DISPARÓ. Se enumeró lo que Cloudbet publica de verdad en un partido de fútbol: 43
// mercados distintos, y nosotros leíamos 9. De los 34 que faltaban, 15 los sabe valorar el motor hoy (las
// mitades más tres del partido completo que la matriz ya calculaba y nadie leía). El resto sigue fuera con
// su motivo escrito en la tabla de abajo.
'use strict';

const fs = require('fs');
const path = require('path');
const dist = require('./goal-engine/distribution');
const mk = require('./goal-engine/markets');
const mitades = require('./goal-engine/mitades');
const noVig = require('./goal-engine/noVig');
const settlement = require('./goal-engine/settlement');

// ── LA REGLA, CONGELADA ─────────────────────────────────────────────────────────────────────────────────
// Mismo criterio que `cards_under_v1` y `props_cs2_v2`: se escribe, se fecha y no se toca mientras se
// acumula muestra. Cambiarla a mitad de la ventana destruye lo único que la ventana produce.
//
// POR ESO HAY DOS REGLAS Y NO UNA. La v1 lleva desde el 20-ago acumulando muestra con un listón de 3 pp
// para sus cinco familias. Aplicarles ahora el listón por familia sería cambiar la regla a mitad de la
// ventana y tirar veinticuatro días de muestra. Así que la v1 se queda EXACTAMENTE como está —congelada,
// intacta, con su 3 pp— y las familias nuevas nacen bajo la v2 con su propio listón. Cada pick guarda la
// versión con la que nació, así que las dos muestras se pueden leer por separado para siempre.
const RULE = {
  version: 'derivadas_v1',
  frozen_at: '2026-08-20',
  edge_min: 0.03,        // 3 pp sobre el precio sin vig
  edge_cap: 0.15,        // por encima, la ventaja es NUESTRO error, no del mercado
  books_min: 1,          // estas líneas cotizan en 1-2 casas hoy; el conteo viaja en la tesis
  familias: ['double_chance', 'draw_no_bet', 'asian_handicap', 'team_total', 'btts'],
  note: 'sombra desde 3 pp contra el precio sin vig; veto por encima de 15 pp. Las probabilidades de empate-no-válido y de hándicap entero son CONDICIONALES (descuentan la devolución), que es la única forma de compararlas con un precio que devuelve.',
};

// ── LA REGLA NUEVA (v2): EL LISTÓN LO PONE LA PROPIA FAMILIA ────────────────────────────────────────────
// La v1 pedía 3 pp a todo el mundo por igual. Eso solo vale si todas las familias están igual de bien
// calibradas, y ahora sabemos que no lo están: el primer tiempo se desvía hasta 5,8 pp y el "ambos marcan"
// del primer tiempo 0,8 pp. Pedirle 3 pp a la primera es pedirle una ventaja que cabe entera dentro de su
// propio error — o sea, no es una ventaja, es ruido con nombre. Así que cada familia pide 3 pp MÁS SU ERROR
// MEDIDO. La de 0,8 pp entra casi a 3,8; la de 5,8 pp tiene que traer 8,8 antes de que la creamos.
const RULE2 = {
  version: 'derivadas_v2',
  frozen_at: '2026-09-13',
  edge_base: 0.03,
  edge_cap: 0.15,
  books_min: 1,
  familias: ['h1_total', 'h1_1x2', 'h1_btts', 'h1_team_total', 'h1_double_chance', 'h1_draw_no_bet', 'h1_ah',
    'h2_total', 'h2_1x2', 'h2_team_total', 'h2_ah', 'htft', 'exact_score', 'clean_sheet', 'win_to_nil'],
  liston_por_familia: Object.fromEntries(['h1_total', 'h1_1x2', 'h1_btts', 'h1_team_total', 'h1_double_chance',
    'h1_draw_no_bet', 'h1_ah', 'h2_total', 'h2_1x2', 'h2_team_total', 'h2_ah', 'htft', 'exact_score',
    'clean_sheet', 'win_to_nil'].map((f) => [f, mitades.listonDe(f, 0.03)])),
  note: 'el listón de cada familia es 3 pp más su error de calibración MEDIDO. Las mitades se derivan de la cuota del primer tiempo (0,446) sin corrección Dixon-Coles, las dos decisiones medidas sobre 33.364 partidos.',
};

// ── LO QUE SIGUE FUERA Y POR QUÉ ────────────────────────────────────────────────────────────────────────
// Se escribe para que la próxima sesión no tenga que redescubrirlo — y para que quede claro que no están
// fuera por olvido. De los 43 mercados del censo, estos son los 19 que no se abren hoy:
const FUERA = {
  'when_will_goal_be_scored_intervals': 'necesita la tasa de gol DENTRO de la mitad (cambia con el minuto y con el marcador). No medido.',
  'goal_nr / last_goalscorer': 'mercados de ORDEN: quién marca el primero o el último. Necesitan el proceso temporal, no solo el conteo.',
  'anytime_goalscorer': 'nivel jugador: es territorio del prop-engine, no de la matriz de marcador.',
  'corner_handicap / corner_match_odds / last_corner / 1st_half_total_corners': 'los córners entre local y visitante están correlacionados NEGATIVAMENTE (−0,249 medido) y sobredispersos (var/media 1,18): dos Poisson independientes no valen. Hace falta un modelo bivariante propio.',
  'booking_match_odds / 12_booking_handicap / booking_nr / total_booking_points': 'las tarjetas van al revés: correlación POSITIVA (+0,201) y el visitante recibe más (cuota local 0,466). Mismo problema, signo contrario.',
  'exact_total_goals_period_*': 'calculable, pero la casa lo cotiza con márgenes muy anchos; se abrirá si alguna familia de mitad demuestra algo.',
  'halftime_fulltime (otras casas)': 'abierto aquí solo con Cloudbet; con una sola casa no hay precio sin vig cruzado.',
};

const DISK = () => {
  const base = path.dirname(process.env.DB_FILE || path.join(__dirname, 'db.json'));
  const d = path.join(base, 'derivadas');
  try { fs.mkdirSync(d, { recursive: true }); } catch { }
  return d;
};
const FILE = () => path.join(DISK(), 'futbol-derivadas.json');
const rd = () => { try { return JSON.parse(fs.readFileSync(FILE(), 'utf8')); } catch { return { picks: {}, at: null, rule: RULE.version }; } };
const wr = (o) => { try { const f = FILE(); fs.writeFileSync(f + '.tmp', JSON.stringify(o)); fs.renameSync(f + '.tmp', f); } catch { } };

const r4 = (x) => (Number.isFinite(x) ? +x.toFixed(4) : null);
const r2 = (x) => (Number.isFinite(x) ? +x.toFixed(2) : null);

// El par complementario de cada mercado: para el precio sin vig hacen falta los DOS lados.
// Las familias de mitad reutilizan estas mismas reglas pelando el prefijo H1_/H2_ — el complementario de
// `H1_AH_HOME_M0_5` es `H1_AH_AWAY_P0_5` por la misma razón que en el partido completo.
function contrario(id) {
  const pm = id.match(/^(H[12])_(.+)$/);
  if (pm) {
    const x = pm[2].match(/^1X2_(HOME|DRAW|AWAY)$/);
    if (x) return null;                                          // tres vías: no hay complementario de dos
    const c = contrario(pm[2]);
    return c ? `${pm[1]}_${c}` : null;
  }
  let m = id.match(/^DRAW_NO_BET_(HOME|AWAY)$/);
  if (m) return 'DRAW_NO_BET_' + (m[1] === 'HOME' ? 'AWAY' : 'HOME');
  m = id.match(/^AH_(HOME|AWAY)_(M|P)(\d+)(?:_(\d+))?$/);
  if (m) {
    const otro = m[1] === 'HOME' ? 'AWAY' : 'HOME';
    const cero = Number(m[4] != null ? `${m[3]}.${m[4]}` : m[3]) === 0;
    // el espejo de −0,5 es +0,5, PERO el espejo de 0 es 0 y se escribe P0 en los dos lados. Sin esta línea
    // la línea cero —que es de las que más cotiza la casa en las mitades— se quedaba sin par y se medía
    // contra la cuota cruda, con el margen entero dentro.
    const signo = cero ? 'P' : (m[2] === 'M' ? 'P' : 'M');
    return `AH_${otro}_${signo}${m[3]}${m[4] != null ? '_' + m[4] : ''}`;
  }
  m = id.match(/^(HOME|AWAY)_TEAM_TOTAL_(OVER|UNDER)_(.+)$/);
  if (m) return `${m[1]}_TEAM_TOTAL_${m[2] === 'OVER' ? 'UNDER' : 'OVER'}_${m[3]}`;
  m = id.match(/^TOTAL_GOALS_(OVER|UNDER)_(.+)$/);
  if (m) return `TOTAL_GOALS_${m[1] === 'OVER' ? 'UNDER' : 'OVER'}_${m[2]}`;
  if (id === 'BTTS_YES') return 'BTTS_NO';
  if (id === 'BTTS_NO') return 'BTTS_YES';
  // portería a cero y ganar a cero: la casa cotiza los dos lados y desde el 13-sep los guardamos los dos
  m = id.match(/^((?:HOME|AWAY)_(?:CLEAN_SHEET|WIN_TO_NIL))(_NO)?$/);
  if (m) return m[2] ? m[1] : m[1] + '_NO';
  // la doble oportunidad no tiene complementario de dos vías (su contrario es el 1X2 restante): se valora
  // contra el precio de la propia casa con el margen que traiga, y eso se DICE en la tesis. El marcador
  // exacto y el descanso/final son de MUCHAS vías y les pasa lo mismo, con más margen todavía.
  return null;
}

// ── LAS FAMILIAS DE VARIAS VÍAS Y CUÁNTO SUMAN ──────────────────────────────────────────────────────────
// Cuando un mercado no tiene "lado contrario" pero sí tiene el RESTO de sus salidas cotizadas, el margen se
// quita normalizando sobre todas ellas. Para eso hay que saber cuánto suman en un mundo sin margen, y eso
// NO es siempre 1: las tres dobles oportunidades suman 2 (cada resultado cae en dos de ellas). El marcador
// exacto suma algo MENOS de 1 porque la casa no cotiza la cola de goleadas; normalizar contra 1 sube un
// poco la probabilidad de mercado y por tanto BAJA nuestra ventaja — se prefiere ese error, que nos quita
// picks, al contrario, que nos las regala.
const MASA_MULTIVIA = { h1_1x2: 1, h2_1x2: 1, htft: 1, exact_score: 1, h1_double_chance: 2 };

// ── REGISTRO ────────────────────────────────────────────────────────────────────────────────────────────
// `deps` inyecta lo que solo el servidor sabe: los eventos con cuotas, cómo sacar las lambdas de un cruce y
// cómo resolver un equipo. Así este módulo no depende de `db` y se puede probar suelto.
async function record(deps = {}) {
  const { dbc, qevents = {}, lambdasFor, ahora = Date.now() } = deps;
  const out = { evaluadas: 0, nuevas: 0, sin_lambdas: 0, sin_par: 0, bajo_listón: 0, vetadas: 0, por_familia: {} };
  if (!dbc || typeof lambdasFor !== 'function') return { ...out, why: 'faltan dependencias' };
  const ids = Object.keys(qevents).filter((id) => {
    const k = Date.parse((qevents[id] || {}).kickoff || 0);
    return Number.isFinite(k) && k > ahora;                      // solo prepartido
  });
  if (!ids.length) return { ...out, why: 'sin eventos futuros con cuotas' };
  const TODAS_FAMILIAS = RULE.familias.concat(RULE2.familias);
  const q = await dbc.query(
    `SELECT canonical_event_id, market_family, market_id, line::float, side, sportsbook_code, odds_decimal::float o
       FROM sportsbook_goal_quote_current
      WHERE canonical_event_id = ANY($1) AND market_family = ANY($2)
        AND coalesce(quote_status,'open') = 'open' AND observed_at > now() - interval '6 hours'`,
    [ids, TODAS_FAMILIAS]).catch(() => ({ rows: [] }));
  if (!q.rows.length) return { ...out, why: 'sin cuotas de estas familias' };

  // índice por mercado, y cache de la matriz por evento (calcularla una vez por partido, no por línea)
  const porMercado = new Map();
  for (const r of q.rows) {
    const k = r.canonical_event_id + '|' + r.market_id;
    if (!porMercado.has(k)) porMercado.set(k, []);
    porMercado.get(k).push(r);
  }
  // CACHE POR EVENTO, NO POR LÍNEA. Con las familias nuevas un partido pasa de ~20 mercados a más de 100,
  // y recalcular la matriz en cada uno multiplicaría por cinco el trabajo de cada pasada. Se guarda un
  // índice market_id → probabilidad por evento, construido UNA vez, con las filas del partido completo y
  // las nuevas juntas.
  const indice = new Map();
  // sobre-redondeo por (evento, familia) para las familias de varias vías: una pasada, no una por mercado
  const multivia = new Map();
  {
    const mejor = new Map();                                     // ceid|familia|market_id → mejor cuota
    for (const r of q.rows) {
      const k = r.canonical_event_id + '|' + r.market_family + '|' + r.market_id;
      if (!mejor.has(k) || r.o > mejor.get(k)) mejor.set(k, r.o);
    }
    for (const [k, o] of mejor) {
      const i = k.lastIndexOf('|');
      const g = k.slice(0, i);
      const e = multivia.get(g) || { suma: 0, n: 0 };
      e.suma += 1 / o; e.n++; multivia.set(g, e);
    }
  }
  const st = rd();
  st.picks = st.picks || {};
  // (partido, familia) que YA tienen una posición viva o liquidada de pasadas anteriores, para no añadir una
  // segunda de la misma familia en el mismo partido cuando el precio se mueva un poco
  const yaHay = new Set();
  for (const p of Object.values(st.picks)) if (p && p.ceid && p.family) yaHay.add(p.ceid + '|' + p.family);
  const candidatas = new Map();

  for (const [k, filas] of porMercado) {
    const i0 = k.indexOf('|');
    const ceid = k.slice(0, i0), marketId = k.slice(i0 + 1);
    const meta = qevents[ceid]; if (!meta) continue;
    if (!indice.has(ceid)) {
      let idx = null;
      try {
        const l = lambdasFor(ceid, meta);
        if (l && l[0] > 0 && l[1] > 0) {
          const M = dist.buildMatrix(l[0], l[1]).matrix;
          idx = new Map();
          for (const f of dist.marketProbabilities(M)) idx.set(f.market_id, f);
          for (const f of mk.extendedMarkets(M)) idx.set(f.market_id, f);
          for (const f of mitades.todas(l[0], l[1])) idx.set(f.market_id, f);
        }
      } catch { idx = null; }
      indice.set(ceid, idx);
    }
    const idx = indice.get(ceid);
    if (!idx) { out.sin_lambdas++; continue; }
    const fila = idx.get(marketId);
    if (!fila) { out.sin_probabilidad = (out.sin_probabilidad || 0) + 1; continue; }
    out.evaluadas++;

    const best = filas.slice().sort((a, b) => b.o - a.o)[0];
    const casas = new Set(filas.map((x) => x.sportsbook_code)).size;
    // precio sin vig: con el complementario cuando existe; sin él, el implícito crudo y se declara
    const opId = contrario(marketId);
    // EL SOBRE-REDONDEO DE ESTE MERCADO, GUARDADO COMO NÚMERO. Es lo que cobra la casa por cruzar, y sin él
    // la vara no puede decir si ganarle al cierre es ganar dinero. Se mide aquí, donde las dos caras están
    // delante; reconstruirlo después, con los precios ya movidos, sería medir otra cosa.
    let pMercado = null, overPct = null, comoMercado = 'implícita de la casa (sin complementario cotizado)';
    if (opId) {
      const op = porMercado.get(ceid + '|' + opId);
      if (op && op.length) {
        const bop = op.slice().sort((a, b) => b.o - a.o)[0];
        // BUG DE ORIGEN, ENCONTRADO EL 13-SEP. `twoWayNoVig` espera OBJETOS de cuota con `odds_decimal`, y
        // aquí se le pasaban dos números sueltos. `Number(undefined)` es NaN, el guardia `!(oa > 1)`
        // disparaba, y la función devolvía null SIEMPRE. Resultado: desde el 20-ago ninguna pick de esta
        // sombra se ha valorado contra el precio sin vig — todas se compararon contra la cuota cruda.
        //
        // El error empuja hacia el lado SEGURO, que es la única razón por la que no se notó: la implícita
        // cruda es MAYOR que la justa (lleva el margen dentro), así que la ventaja salía más pequeña de lo
        // que era y el listón efectivo era 3 pp más medio margen. O sea: se hicieron MENOS picks de las
        // debidas, no peores. Aun así la muestra v1 no se generó con la regla que su propia ficha dice.
        //
        // La muestra se puede partir sin ambigüedad porque cada pick ya guarda `market_basis`: las de antes
        // del arreglo dicen "implícita de la casa" y las de después "sin vig contra el lado contrario".
        const nv = noVig.twoWayNoVig({ odds_decimal: best.o }, { odds_decimal: bop.o });
        if (nv && nv.a != null) {
          pMercado = nv.a;
          overPct = r2(100 * nv.overround);
          comoMercado = `sin vig contra el lado contrario (sobre-redondeo ${overPct} %)`;
        }
      }
    }
    // FAMILIAS DE VARIAS VÍAS. El 1X2 de mitad tiene tres salidas, el descanso/final nueve y el marcador
    // exacto casi treinta: ninguna tiene "el lado contrario", pero TODAS tienen el resto de sus salidas
    // cotizadas en el mismo partido. Sumar sus implícitas y normalizar quita el margen igual de bien que un
    // par. Sin esto, estas familias se comparaban contra la cuota cruda —con el margen entero dentro— y su
    // ventaja salía sistemáticamente baja: no habrían generado casi ninguna pick, que en una sombra cuyo
    // único producto es la muestra es tan malo como generarlas de más.
    if (pMercado == null && MASA_MULTIVIA[filas[0].market_family] != null) {
      // La masa NO siempre es 1: las tres dobles oportunidades de un partido suman 2, porque cada resultado
      // aparece en dos de ellas. Normalizar contra 1 partiría su probabilidad por la mitad y convertiría a
      // toda la familia en ventaja falsa. Por eso la masa va declarada por familia y no se supone.
      const masa = MASA_MULTIVIA[filas[0].market_family];
      const grupo = multivia.get(ceid + '|' + filas[0].market_family);
      if (grupo && grupo.n >= 3 && grupo.suma > masa * 1.005) {
        pMercado = (1 / best.o) * (masa / grupo.suma);
        overPct = r2(100 * (grupo.suma / masa - 1));
        comoMercado = `sin vig sobre las ${grupo.n} salidas de la familia (sobre-redondeo ${overPct} %)`;
      }
    }
    // CONTAR POR FAMILIA, no solo en total. Un "sin_par: 1756" no dice si falta el complementario de una
    // familia entera o cuatro líneas sueltas de cada una, y son dos arreglos distintos. Medirlo por familia
    // fue lo que destapó que el espejo de la línea cero estaba mal escrito.
    if (pMercado == null) {
      pMercado = 1 / best.o; out.sin_par++;
      out.sin_par_por_familia = out.sin_par_por_familia || {};
      out.sin_par_por_familia[filas[0].market_family] = (out.sin_par_por_familia[filas[0].market_family] || 0) + 1;
    }

    const edge = fila.probability - pMercado;
    const fam = filas[0].market_family;
    out.por_familia[fam] = out.por_familia[fam] || { evaluadas: 0, nuevas: 0 };
    out.por_familia[fam].evaluadas++;
    // QUÉ REGLA GOBIERNA ESTA FAMILIA. Las cinco de siempre siguen bajo la v1 con su 3 pp congelado; las
    // quince nuevas nacen bajo la v2 con su listón propio. La versión viaja DENTRO de la pick, así que las
    // dos muestras se pueden separar para siempre aunque mañana cambie cualquiera de las dos reglas.
    const esNueva = RULE2.familias.includes(fam);
    const regla = esNueva ? RULE2 : RULE;
    const liston = esNueva ? mitades.listonDe(fam, RULE2.edge_base) : RULE.edge_min;
    if (edge > regla.edge_cap) { out.vetadas++; continue; }
    if (edge < liston || casas < regla.books_min) { out.bajo_listón++; continue; }

    // ── UNA POSICIÓN POR PARTIDO Y FAMILIA ──────────────────────────────────────────────────────────
    // La lección de card under, aplicada antes de que cueste algo. En un mismo partido, "menos de 1,75 en
    // el segundo tiempo" y "menos de 2,0 en el segundo tiempo" no son dos apuestas: son la misma apuesta
    // con dos etiquetas, y se ganan y se pierden juntas. Anotarlas las dos no diversifica nada — lo que
    // hace es meter observaciones correlacionadas en una muestra que luego se juzga como si fueran
    // independientes. Eso infla el estadístico y la vara deja de medir. Aquí no hay dinero en juego, así
    // que el daño no sería la pérdida: sería creerse una ventaja que no existe.
    //
    // Se queda la de MÁS ventaja de cada (partido, familia). Las candidatas se acumulan en esta pasada y se
    // resuelven al final, porque la mejor puede aparecer la última.
    //
    // SOLO PARA LAS FAMILIAS NUEVAS. La v1 lleva 24 días apilando y su muestra está construida así; meterle
    // el tope ahora cambiaría su comportamiento a mitad de ventana, que es justo lo que esta doctrina
    // prohíbe. La v1 se queda apilando y ESO SE DICE (su muestra tiene el mismo problema que destapamos en
    // card under y hay que leerla con esa advertencia); las nuevas nacen ya con el tope puesto.
    const claveFam = ceid + '|' + fam;
    const key = ceid + '|' + marketId;
    if (st.picks[key]) continue;
    if (esNueva) {
      if (yaHay.has(claveFam)) continue;                         // ya hay una de esta familia de otra pasada
      const prev = candidatas.get(claveFam);
      if (prev && prev.edge >= edge) { out.apiladas = (out.apiladas || 0) + 1; continue; }
      if (prev) out.apiladas = (out.apiladas || 0) + 1;
    }
    candidatas.set(esNueva ? claveFam : key, { edge, key, pick: {
      key, ceid, market_id: marketId, family: fam,
      league: meta.league || null, match: `${meta.home} vs ${meta.away}`,
      home: meta.home, away: meta.away, kickoff_at: meta.kickoff || null,
      line: filas[0].line != null ? filas[0].line : null, side: filas[0].side || null,
      odds: best.o, book: best.sportsbook_code, books: casas,
      p_gp: r4(fila.probability), p_market: r4(pMercado), edge_pp: r2(100 * edge),
      market_basis: comoMercado, over_pct: overPct,
      // el error de calibración con el que nació, para poder releer la pick dentro de tres meses y saber
      // cuánta de su "ventaja" era margen de error del propio modelo
      error_cal_pp: esNueva ? r2(100 * (mitades.ERROR_CAL[fam] || 0)) : null,
      rule_version: regla.version, rule_edge_min: liston,
      born_at: new Date().toISOString(), status: 'ACTIVE',
      close_odds: null, close_at: null, clv_pct: null, result: null, settled_at: null,
    } });
  }
  // se anotan al final las ganadoras de cada (partido, familia)
  for (const { key, pick } of candidatas.values()) {
    if (st.picks[key]) continue;
    st.picks[key] = pick;
    out.nuevas++;
    out.por_familia[pick.family] = out.por_familia[pick.family] || { evaluadas: 0, nuevas: 0 };
    out.por_familia[pick.family].nuevas++;
  }
  if (out.nuevas) { st.at = new Date().toISOString(); wr(st); }
  return out;
}

// ── CIERRE ──────────────────────────────────────────────────────────────────────────────────────────────
// El cierre es el precio que la casa tenía al arrancar el partido. Se refresca en cada pasada mientras el
// partido no haya empezado: la última lectura antes del saque ES el cierre. Sin esto no hay CLV, y sin CLV
// esta familia no se puede juzgar — es la vara de la casa.
async function closes(deps = {}) {
  const { dbc, ahora = Date.now() } = deps;
  const st = rd();
  const vivas = Object.values(st.picks || {}).filter((p) => p.status === 'ACTIVE' && Date.parse(p.kickoff_at || 0) > ahora);
  if (!dbc || !vivas.length) return { actualizados: 0 };
  const ids = [...new Set(vivas.map((p) => p.ceid))];
  const q = await dbc.query(
    `SELECT canonical_event_id, market_id, max(odds_decimal::float) o
       FROM sportsbook_goal_quote_current
      WHERE canonical_event_id = ANY($1) AND market_family = ANY($2)
        AND coalesce(quote_status,'open') = 'open' AND observed_at > now() - interval '3 hours'
      GROUP BY 1,2`, [ids, RULE.familias.concat(RULE2.familias)]).catch(() => ({ rows: [] }));
  const idx = new Map(q.rows.map((r) => [r.canonical_event_id + '|' + r.market_id, r.o]));
  let n = 0;
  for (const p of vivas) {
    const o = idx.get(p.ceid + '|' + p.market_id);
    if (!(o > 1)) continue;
    p.close_odds = o; p.close_at = new Date().toISOString();
    p.clv_pct = r2(100 * (p.odds / o - 1));
    n++;
  }
  if (n) { st.at = new Date().toISOString(); wr(st); }
  return { actualizados: n };
}

// ── LIQUIDACIÓN ─────────────────────────────────────────────────────────────────────────────────────────
// El liquidador del motor de goles ya sabe resolver estas familias, incluidas devoluciones y cuartos de
// línea. Aquí solo hay que traer el marcador y traducir su veredicto a unidades.
const UNIDADES = { won: (o) => o - 1, lost: () => -1, push: () => 0, half_won: (o) => (o - 1) / 2, half_lost: () => -0.5, void: () => 0 };

// Las familias de mitad necesitan ADEMÁS el marcador al descanso, que no está en nuestro archivo de
// resultados y hay que ir a buscar. Como eso es red, `settle` pasó a ser asíncrona y el descanso se busca
// UNA vez por partido (no por pick: un partido puede tener diez picks de mitad) y con tope por pasada, para
// que una tanda grande no convierta el trabajo de fondo en una tormenta de peticiones.
const NECESITA_DESCANSO = (id) => /^H[12]_/.test(id) || /^HTFT_/.test(id);
const TOPE_DESCANSOS = Number(process.env.GP_DERIV_TOPE_DESCANSOS) || 30;

async function settle(deps = {}) {
  const { scoreFor, descansoFor, ahora = Date.now() } = deps;
  const st = rd();
  let liquidadas = 0, anuladas = 0, no_resueltas = 0, esperando_descanso = 0, descansos_buscados = 0;
  // MIGRACIÓN DE UNA VEZ (15-sep, A03 de la auditoría). Los tres VOID que este motor llegó a escribir eran
  // huecos de dato —sin marcador, sin descanso, mercado sin regla—, no devoluciones: aquí no hay casa, las
  // familias nuevas viven en sombra y nadie devolvió un dólar. Se reclasifican una sola vez; al reescribir
  // el estado dejan de cumplir la condición, así que repetir la pasada no vuelve a tocarlas.
  let migradas = 0;
  for (const p of Object.values(st.picks || {})) {
    if (p.status !== 'VOID') continue;
    p.status = 'RESULT_PENDING'; p.result = 'DATA_UNRESOLVED'; p.units = 0;
    p.unresolved_motivo = 'reclasificado el 15-sep: ' + (p.void_why || 'VOID por falta de dato') + ', no hubo devolución';
    p.unresolved_at = new Date().toISOString();
    migradas++;
  }
  const cacheDescanso = new Map();                               // ceid → {h1Home,h1Away} | null
  for (const p of Object.values(st.picks || {})) {
    if (p.status !== 'ACTIVE') continue;
    const ko = Date.parse(p.kickoff_at || 0);
    if (!ko || ahora - ko < 2.5 * 3600e3) continue;              // el partido tiene que haber terminado
    let sc = null;
    try { sc = typeof scoreFor === 'function' ? scoreFor(p) : null; } catch { sc = null; }
    if (!sc || sc.homeGoals == null || sc.awayGoals == null) {
      // NO RESUELTO NO ES ANULADO (15-sep, A03 de la auditoría). Setenta y dos horas sin marcador se
      // cerraban VOID con cero unidades, y VOID quiere decir que la casa devolvió el dinero. Nadie devolvió
      // nada: el partido se jugó y lo que falta es nuestro dato. Ese cero selecciona la muestra y puede
      // esconder pérdidas, así que la pick queda en DATA_UNRESOLVED con su motivo. El corte de 72 h es el
      // mismo de siempre: aquí solo cambia la etiqueta.
      if (ahora - ko > 72 * 3600e3) { p.status = 'RESULT_PENDING'; p.result = 'DATA_UNRESOLVED'; p.units = 0; p.unresolved_motivo = 'sin marcador final 72 h después del saque'; p.unresolved_at = new Date().toISOString(); no_resueltas++; }
      continue;
    }
    const marcador = { homeGoals: sc.homeGoals, awayGoals: sc.awayGoals };
    if (NECESITA_DESCANSO(p.market_id)) {
      if (!cacheDescanso.has(p.ceid)) {
        if (descansos_buscados >= TOPE_DESCANSOS || typeof descansoFor !== 'function') { esperando_descanso++; continue; }
        descansos_buscados++;
        let d = null;
        try { d = await descansoFor(p, marcador); } catch { d = null; }
        cacheDescanso.set(p.ceid, d && d.h1Home != null ? d : null);
      }
      const d = cacheDescanso.get(p.ceid);
      if (!d) {
        // sin descanso NO se liquida con el marcador final: eso sería resolver otro mercado. Se espera, y a
        // las 72 h se cierra — pero como NO RESUELTA (15-sep, A03), no como anulada: que ESPN no publique
        // el marcador al descanso es un hueco nuestro, no una devolución de nadie.
        if (ahora - ko > 72 * 3600e3) { p.status = 'RESULT_PENDING'; p.result = 'DATA_UNRESOLVED'; p.units = 0; p.unresolved_motivo = 'sin marcador al descanso 72 h después del saque'; p.unresolved_at = new Date().toISOString(); no_resueltas++; }
        else esperando_descanso++;
        continue;
      }
      marcador.h1Home = d.h1Home; marcador.h1Away = d.h1Away;
    }
    const res = settlement.settle(p.market_id, marcador);
    // un mercado sin regla de liquidación tampoco es una devolución (15-sep, A03): es una familia que no
    // sabemos resolver, y eso se dice con su nombre en vez de convertirse en un cero cómodo.
    if (!res || res === 'unknown') { p.status = 'RESULT_PENDING'; p.result = 'DATA_UNRESOLVED'; p.units = 0; p.unresolved_motivo = `el liquidador no reconoce el mercado ${p.market_id}`; p.unresolved_at = new Date().toISOString(); no_resueltas++; continue; }
    if (res === 'void') {
      // AQUÍ 'void' SIGNIFICA DATO INCOHERENTE, NO DEVOLUCIÓN (15-sep, A03). Llegados a este punto el
      // marcador final está y, si la familia lo pedía, el del descanso también: lo único que hace que
      // `settlement.settle` devuelva 'void' es que los números no se sostienen entre sí —la primera mitad
      // con más goles que el partido entero—. Eso es dato roto, no dinero devuelto. Se sigue reintentando
      // por si la fuente se corrige, y al mismo corte de 72 h que las demás ramas se cierra como no
      // resuelta. Antes se quedaba ACTIVE para siempre y el hueco no se veía en ningún contador.
      if (ahora - ko > 72 * 3600e3) { p.status = 'RESULT_PENDING'; p.result = 'DATA_UNRESOLVED'; p.units = 0; p.unresolved_motivo = 'marcador incoherente: las dos mitades no cuadran con el resultado final'; p.unresolved_at = new Date().toISOString(); no_resueltas++; }
      else esperando_descanso++;
      continue;
    }
    p.result = res;
    p.units = r2((UNIDADES[res] || (() => 0))(p.odds));
    p.final_score = { home: sc.homeGoals, away: sc.awayGoals };
    if (marcador.h1Home != null) p.ht_score = { home: marcador.h1Home, away: marcador.h1Away };
    p.status = 'SETTLED';
    p.settled_at = new Date().toISOString();
    liquidadas++;
  }
  if (liquidadas || anuladas || no_resueltas || migradas) { st.at = new Date().toISOString(); wr(st); }
  return { liquidadas, anuladas, no_resueltas, migradas, esperando_descanso, descansos_buscados };
}

// ── SEGUIMIENTO ─────────────────────────────────────────────────────────────────────────────────────────
const sd = (a) => { if (a.length < 2) return null; const m = a.reduce((x, y) => x + y, 0) / a.length;
  return +Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1)).toFixed(2); };

function agrega(list) {
  const cerradas = list.filter((p) => p.status === 'SETTLED');
  const u = cerradas.reduce((s, p) => s + (p.units || 0), 0);
  const clv = cerradas.map((p) => p.clv_pct).filter((x) => Number.isFinite(x));
  const g = cerradas.filter((p) => p.result === 'won' || p.result === 'half_won').length;
  return {
    n: cerradas.length, w: g, l: cerradas.filter((p) => p.result === 'lost' || p.result === 'half_lost').length,
    push: cerradas.filter((p) => p.result === 'push').length,
    units: r2(u), roi_pct: cerradas.length ? r2(100 * u / cerradas.length) : null,
    hit_pct: cerradas.length ? r2(100 * g / cerradas.length) : null,
    clv_avg_pct: clv.length ? r2(clv.reduce((a, b) => a + b, 0) / clv.length) : null,
    clv_n: clv.length, clv_sd: sd(clv),
  };
}

// ── LA TABLA DE RENDIMIENTO ─────────────────────────────────────────────────────────────────────────────
// Una fila por familia con TODO lo que hace falta para juzgarla, y nada más. La columna que la mayoría de
// tableros no tiene y esta sí es `error_cal_pp`: cuánto se desvía el modelo de esa familia. Sin ella un ROI
// del +8 % en una familia que se desvía 5,8 pp parece una mina, cuando lo único que dice es que todavía no
// hay con qué distinguirlo de su propio error.
//
// El veredicto lo pone `lib/vara.js`, la misma que juzga a cards under, CS2 y todo lo demás — empezando por
// la pregunta que ordena todas las otras: ¿el cierre de esta familia predice mejor que nuestra entrada? Si
// no, su CLV no es evidencia ni a favor ni en contra, y decirlo es más útil que un número bonito.
function tabla() {
  const st = rd();
  const all = Object.values(st.picks || {});
  const byFam = {};
  for (const p of all) (byFam[p.family] = byFam[p.family] || []).push(p);
  let vara = null;
  try { vara = require('./lib/vara'); } catch { vara = null; }

  const filas = Object.entries(byFam).map(([fam, v]) => {
    const a = agrega(v);
    const cerradas = v.filter((p) => p.status === 'SETTLED');
    // ACERTÓ O NO ACERTÓ: 1, 0 o fuera. Nada de medias tintas, y por una razón concreta: las dos pruebas de
    // la vara hacen `g ? 1 : 0`, y en JavaScript 0,25 es VERDADERO. Devolver 0,25 para un medio-perdida la
    // contaba como acierto, y por eso el test directo del hándicap decía ROI +5,19 % mientras las unidades
    // decían −263. Un medio-ganada acertó (el resultado ocurrió) y una medio-perdida no; las devoluciones se
    // quedan fuera porque no hay acierto que medir. El ROI de verdad es el de `units`, no el de esta prueba,
    // que con líneas de cuarto solo aproxima.
    const gano = (p) => (p.result === 'won' || p.result === 'half_won' ? 1
      : (p.result === 'lost' || p.result === 'half_lost' ? 0 : null));
    // EL MARGEN DE LA CASA, MEDIDO POR LA PROPIA FAMILIA. Cada pick guardó el sobre-redondeo de su par en el
    // momento de nacer (`over_pct`); la mediana de esos —no la media, que se la comen cuatro capturas rotas—
    // partida por dos es lo que paga UNA apuesta. Las picks anteriores al 13-sep no lo llevan, así que estas
    // familias dirán `sin_margen_medido` hasta que acumulen picks nuevas. Es lo honesto: un margen supuesto
    // haría pasar por invertible algo que no lo es.
    const overs = v.map((p) => p.over_pct).filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
    const medOver = overs.length ? (overs.length % 2 ? overs[overs.length >> 1] : (overs[(overs.length >> 1) - 1] + overs[overs.length >> 1]) / 2) : null;
    const margenLadoPct = medOver != null ? r2(medOver / 2) : null;

    let aporta = null, modelo = null, ve = null, clvRec = null, tRec = null;
    if (vara) {
      // `odds`, `cierre` y `pModelo` son FUNCIONES ACCESORAS, no nombres de campo. Pasarle cadenas hacía que
      // `odds(it)` lanzara, el try/catch se lo tragaba y las dos pruebas salían nulas — una tabla con huecos
      // en vez de un error. De ahí la regla: un catch que devuelve null esconde tanto como protege.
      try {
        aporta = vara.cierreAporta(cerradas.filter((p) => Number.isFinite(p.close_odds) && gano(p) != null),
          { odds: (p) => p.odds, cierre: (p) => p.close_odds, gano, overPct: medOver || 0 });
      } catch (e) { aporta = { error: e.message }; }
      try {
        modelo = vara.modeloContraPrecio(cerradas.filter((p) => gano(p) != null),
          { odds: (p) => p.odds, pModelo: (p) => p.p_gp, gano });
      } catch (e) { modelo = { error: e.message }; }
      // CLV RECORTADO AL 10 %, no crudo: la media cruda la destroza un cierre roto, y en este almacén los
      // hay. Es el mismo recorte que se aplica a todas las demás familias del sistema.
      try {
        const clvs = cerradas.map((p) => p.clv_pct).filter((x) => Number.isFinite(x));
        const rec = vara.recorta ? vara.recorta(clvs) : clvs;
        if (rec.length >= 2) { clvRec = r2(vara.media(rec)); tRec = r2(vara.tDe(rec)); }
      } catch { clvRec = null; tRec = null; }
      // los nombres importan: `veredicto` espera exactamente estos, y pasárselos mal es cómo la tabla salía
      // entera en `sin_margen_medido` sin que nada fallara
      try {
        ve = vara.veredicto({ clvRecortadoPct: clvRec, tRecortada: tRec, n: a.clv_n || a.n,
          margenLadoPct, nMargen: overs.length, cierre: aporta, directo: modelo });
      } catch (e) { ve = { veredicto: 'error', razon: e.message }; }
    }
    const esNueva = RULE2.familias.includes(fam);
    return {
      familia: fam,
      regla: esNueva ? RULE2.version : RULE.version,
      liston_pp: r2(100 * (esNueva ? mitades.listonDe(fam, RULE2.edge_base) : RULE.edge_min)),
      error_cal_pp: mitades.ERROR_CAL[fam] != null ? r2(100 * mitades.ERROR_CAL[fam]) : null,
      abiertas: v.filter((p) => p.status === 'ACTIVE').length,
      anuladas: v.filter((p) => p.status === 'VOID').length,
      // no resueltas (15-sep, A03): huecos de dato, ni liquidadas ni anuladas. No entran a `agrega` —que
      // solo mira SETTLED— así que no tocan ni el ROI ni el CLV de la fila; están para que se vean.
      no_resueltas: v.filter((p) => p.result === 'DATA_UNRESOLVED').length,
      ...a,
      clv_recortado_pct: clvRec, clv_t_recortada: tRec,
      margen_lado_pct: margenLadoPct, n_margen: overs.length,
      clv_neto_pct: (clvRec != null && margenLadoPct != null) ? r2(clvRec - margenLadoPct) : null,
      cierre_aporta: aporta, modelo_contra_precio: modelo, veredicto: ve,
    };
  }).sort((x, y) => (y.n - x.n) || String(x.familia).localeCompare(String(y.familia)));

  return {
    filas,
    leyenda: {
      liston_pp: 'ventaja mínima que se le pide a la familia: 3 pp más su error de calibración medido (solo v2; la v1 sigue congelada en 3 pp)',
      error_cal_pp: 'peor desviación de esa familia medida contra 33.335 partidos con λ resuelta del cierre. El suelo de ruido del método son las familias de control que ya publicamos: 3,4 y 2,9 pp',
      cierre_aporta: 'si el cierre de la casa predice mejor que nuestra entrada. Si NO, el CLV de esta familia no es evidencia de nada',
      modelo_contra_precio: 'Brier pareado: ¿acierta más nuestra probabilidad o la del precio? Es el test directo, sin pasar por el cierre. Su `roi_pct` APROXIMA (trata medias líneas como enteras): el ROI bueno es `roi_pct` de la fila, que sale de las unidades reales',
      veredicto: 'el de lib/vara.js, el mismo que juzga a todas las demás familias del sistema',
    },
  };
}

function track() {
  const st = rd();
  const all = Object.values(st.picks || {});
  const byFam = {};
  for (const p of all) (byFam[p.family] = byFam[p.family] || []).push(p);
  const porRegla = {};
  for (const p of all) (porRegla[p.rule_version || RULE.version] = porRegla[p.rule_version || RULE.version] || []).push(p);
  return {
    rule: RULE, rule2: RULE2,
    medicion_mitades: mitades.MEDICION,
    fuera_a_proposito: FUERA,
    total: all.length,
    active: all.filter((p) => p.status === 'ACTIVE').length,
    voided: all.filter((p) => p.status === 'VOID').length,
    // NO RESUELTAS (15-sep, A03): fuera del ROI y del recuento de liquidadas, contadas con su motivo. Un
    // "no encontré el dato" contado como cero selecciona la muestra y puede esconder pérdidas.
    no_resueltas: all.filter((p) => p.result === 'DATA_UNRESOLVED').length,
    no_resueltas_motivos: all.filter((p) => p.result === 'DATA_UNRESOLVED')
      .reduce((a, p) => { const k = p.unresolved_motivo || 'sin motivo'; a[k] = (a[k] || 0) + 1; return a; }, {}),
    overall: agrega(all),
    // las dos ventanas por separado: mezclarlas sería juzgar la regla nueva con la muestra de la vieja
    por_regla: Object.fromEntries(Object.entries(porRegla).map(([k, v]) => [k, agrega(v)])),
    by_family: Object.fromEntries(Object.entries(byFam).map(([k, v]) => [k, agrega(v)])),
    tabla: tabla().filas,
    recent: all.filter((p) => p.status === 'SETTLED').sort((a, b) => String(b.settled_at).localeCompare(String(a.settled_at))).slice(0, 40),
    open: all.filter((p) => p.status === 'ACTIVE').sort((a, b) => String(a.kickoff_at).localeCompare(String(b.kickoff_at))).slice(0, 40),
    at: st.at || null,
    doctrina: 'Familias nuevas EN SOMBRA: se anotan y se liquidan solas, no publican picks, no tocan el feed y no tocan un dólar. Las mitades salen de una estructura MEDIDA (33.364 partidos) y validada contra el resultado real, y cada familia carga su propio error de calibración en su listón de ventaja. Lo que falta ahora es lo único que no se puede acelerar: muestra.',
  };
}

module.exports = { RULE, RULE2, FUERA, record, closes, settle, track, tabla, contrario, NECESITA_DESCANSO };
