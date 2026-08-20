// scripts/tennis-espn-tail.js — LA COLA VIVA DE LA BASE DE TENIS (20-ago)
//
// POR QUÉ EXISTE, y no es un cron que se cayó. La base de tenis salía entera de los repos de Jeff Sackmann
// (tennis_atp / tennis_wta). Esos repos FUERON RETIRADOS de GitHub —comprobado: `raw.githubusercontent.com/
// JeffSackmann/tennis_atp/master/atp_matches_2026.csv` devuelve 404— y lo que quedó es un espejo
// archivístico congelado en los commits de junio. Medido hoy: el último partido del espejo es el
// 25-may-2026. Por eso la base lleva casi tres meses parada, y por eso volver a correr la cosecha mil
// veces no la habría movido un día.
//
// La fuente no vuelve. Lo que se hace es cambiar la forma del problema: Sackmann sigue siendo la ESPINA
// histórica (2015→may-2026, con saque, resto, break points y minutos), y a partir de ahí se le pega una
// COLA derivada del marcador público de ESPN, que es la misma fuente que la casa ya usa para liquidar.
//
// LO QUE LA COLA TRAE Y LO QUE NO, dicho por delante porque cambia lo que se puede afirmar con ella:
//   ✔ ganador, perdedor, sets, juegos, marcador, formato (al mejor de 3 o 5), ronda, torneo y fecha.
//     Con eso el Elo —general y por superficie— se actualiza entero, que es lo que mueve la probabilidad.
//   ✘ NO trae saque ni resto: ni aces, ni dobles faltas, ni puntos al saque, ni break points. Los índices
//     de saque y resto se quedan congelados a mayo y hay que decirlo, no disimularlo.
//   ✘ NO trae minutos ni ranking oficial en el momento del partido.
//
// LA SUPERFICIE NO SE INVENTA NI SE ESCRIBE A MANO: se hereda del propio histórico. Roland Garros ya
// está en la base como tierra y Wimbledon como hierba, así que el torneo se casa por nombre contra los
// 1.816 torneos que ya conocemos y se le copia la superficie. Un torneo nuevo de verdad entra con
// superficie desconocida (−1), que es un valor que el compilador ya maneja desde siempre.
//
// LA IDENTIDAD DEL JUGADOR ES EL RIESGO REAL. Un id equivocado no falla ruidosamente: funde dos carreras
// en un rating y no deja rastro. Así que se exige coincidencia EXACTA del nombre normalizado, o apellido
// + inicial cuando esa pareja es ÚNICA en el catálogo. Lo que no resuelve NO se fuerza: estrena id propio.
// Cuesta que un jugador conocido pueda arrancar de cero si ESPN lo escribe raro —y eso se ve en el
// informe—, pero es infinitamente mejor que mezclarlo con otro.
//
// USO
//   node scripts/tennis-espn-tail.js                 # informa, no escribe
//   node scripts/tennis-espn-tail.js --apply         # escribe matches/players/meta
//   node scripts/tennis-espn-tail.js --desde=20260526 --hasta=20260819 --paso=2
'use strict';

const fs = require('fs');
const path = require('path');

const arg = (k, d) => { const h = process.argv.find((a) => a.startsWith(`--${k}=`)); return h ? h.split('=')[1] : d; };
const APPLY = process.argv.includes('--apply');
// SE LEE DE DONDE ESTÉ LO MÁS NUEVO Y SE ESCRIBE DONDE SOBREVIVA. En Render la base refrescada vive en el
// disco persistente: escribirla en el repo la perdería en el siguiente despliegue, y leerla solo del repo
// haría que cada pasada recosechara desde mayo. En local, sin disco, las dos rutas son la misma carpeta.
const REPO = path.join(__dirname, '..', 'data', 'tennis');
const DISCO = path.join(path.dirname(process.env.DB_FILE || path.join(__dirname, '..', 'db.json')), 'tennis');
const OUT = arg('out', null) || (fs.existsSync(DISCO) || process.env.DB_FILE ? DISCO : REPO);
const lee = (n) => { const d = path.join(OUT, n); return fs.existsSync(d) ? d : path.join(REPO, n); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ESPN RECHAZA A QUIEN NO SE PRESENTA, y esto costó media hora de 403 con cuerpo HTML. Sin `user-agent`
// devuelve "Access Denied"; con uno de navegador, también (bloquea agentes de navegador desde IPs de
// datacentro). Con uno de herramienta, pasa. No es un capricho: es la diferencia entre que este script
// funcione y que falle en silencio.
const UA = 'curl/8.5.0';

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const normT = (s) => norm(s).replace(/\b(open|championships|championship|international|masters|cup|classic|tournament|presented by .*|atp|wta|the)\b/g, ' ').replace(/\s+/g, ' ').trim();

const ROUND = { Q1: 0, Q2: 1, Q3: 2, Q4: 3, R128: 4, R64: 5, R32: 6, R16: 7, QF: 8, SF: 9, F: 10, RR: 5, BR: 9, ER: 4 };
function roundOf(nombre) {
  const n = norm(nombre);
  if (/final/.test(n) && !/semi|quarter/.test(n)) return ROUND.F;
  if (/semi/.test(n)) return ROUND.SF;
  if (/quarter/.test(n)) return ROUND.QF;
  if (/round of 16|4th round|fourth round/.test(n)) return ROUND.R16;
  if (/round of 32|3rd round|third round/.test(n)) return ROUND.R32;
  if (/round of 64|2nd round|second round/.test(n)) return ROUND.R64;
  if (/round of 128|1st round|first round/.test(n)) return ROUND.R128;
  if (/round robin/.test(n)) return ROUND.RR;
  return 6;
}
const esClasificacion = (nombre) => /qualif/i.test(String(nombre || ''));

async function get(url, { tries = 4 } = {}) {
  let last = null;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': UA, accept: '*/*' }, signal: AbortSignal.timeout(40000) });
      if (r.status === 404) return null;
      if (!r.ok) { last = new Error('HTTP ' + r.status); await sleep(4000 * (i + 1)); continue; }
      return await r.json();
    } catch (e) { last = e; await sleep(3000 * (i + 1)); }
  }
  throw last || new Error('agotado');
}

const aNum = (iso) => +String(iso).slice(0, 10).replace(/-/g, '');
const aISO = (n) => { const s = String(n); return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`; };
const masDias = (n, d) => { const t = Date.parse(aISO(n) + 'T00:00:00Z') + d * 864e5; return aNum(new Date(t).toISOString()); };

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const M = JSON.parse(fs.readFileSync(lee('matches.json'), 'utf8'));
  const P = JSON.parse(fs.readFileSync(lee('players.json'), 'utf8'));
  const meta = JSON.parse(fs.readFileSync(lee('meta.json'), 'utf8'));
  const F = {}; M.schema.forEach((k, i) => { F[k] = i; });

  const lm = meta.last_match_date || {};
  const desdeBase = Math.max(+lm.atp || 0, +lm.wta || 0);
  // SE VUELVE DOS DÍAS ATRÁS, NO AL DÍA SIGUIENTE. Dos motivos y ninguno es prudencia: los partidos del
  // último día pueden estar A MEDIAS cuando corre el trabajo —un partido en curso no entra, y sin volver
  // sobre él no entraría nunca—, y el cuadro de un torneo se completa hacia atrás según se juegan las
  // rondas. Repetir días no duplica nada: cada partido se dedupe por tour, fecha, jugadores y ronda.
  const desde = +arg('desde', masDias(desdeBase, -2));
  const hasta = +arg('hasta', aNum(new Date().toISOString()));
  const paso = Math.max(1, +arg('paso', 2));
  if (!(desde > 20000000)) { console.error('[cola] ventana inválida', desde, hasta); process.exit(1); }
  // ESTAR AL DÍA NO ES UN FALLO. La primera versión salía con código 1 cuando la base ya llegaba a hoy
  // —que es el estado NORMAL una vez la cola funciona— y el trabajo diario registraba un error todos los
  // días. Un error que sale siempre deja de leerse, y el día que sea de verdad tampoco se va a leer.
  if (hasta < desde) { console.log(`[cola] la base ya llega a ${desdeBase}: nada que traer`); return { rows: 0, last: lm, out: OUT }; }

  // ── índices para resolver identidad ───────────────────────────────────────────────────────────────────
  // ── IDENTIDAD DEL JUGADOR ─────────────────────────────────────────────────────────────────────────────
  // La primera versión solo miraba el nombre exacto y el apellido+inicial, y con eso 113 jugadores
  // estrenaban id. Leyendo la lista se veía que la mayoría NO eran debuts, y que fallaban por dos motivos
  // muy concretos que no tienen nada que ver entre sí:
  //
  //   · ORDEN INVERTIDO en los nombres chinos. ESPN escribe "Zheng Qinwen" (apellido delante) y la espina
  //     "Qinwen Zheng". Comprobado también en Wang Xinyu, Zhang Shuai, Wu Yibing, Shang Juncheng y Yuan Yue.
  //     Peor todavía: la espina a veces parte el nombre de pila —"Xin Yu Wang"—, así que ni siquiera
  //     coinciden los trozos. Lo que sí coincide es la CADENA DE LETRAS al pegar los trozos y darles la
  //     vuelta: "xinyuwang". Comparar cadenas pegadas es estricto (tiene que coincidir letra a letra), así
  //     que no abre la puerta a confusiones.
  //   · APELLIDOS COMPUESTOS RECORTADOS. ESPN pone "Daniel Merida" donde la espina tiene "Daniel Merida
  //     Aguilar" (igual con Irene Burillo Escorihuela y Diego Dedura Palomero). Se acepta que el nombre de
  //     ESPN sea PREFIJO de uno solo de la base — si encaja con dos, no se toca.
  //   · Y el apóstrofo: "Christopher O'Connell" contra "Christopher Oconnell". Se indexa también la versión
  //     sin puntuación pegada, que las hace iguales.
  //
  // Todo lo que no resuelve por una de esas vías estrena id. Un id nuevo de más solo cuesta que ese
  // jugador arranque sin historial; un id equivocado funde dos carreras en un rating y no deja rastro.
  const idx = [new Map(), new Map()], pegado = [new Map(), new Map()], porApellido = [new Map(), new Map()];
  const porTokens = [[], []];   // para el prefijo: [tokens, id] de cada jugador
  const pega = (n) => n.replace(/ /g, '');
  const alReves = (n) => n.split(' ').reverse().join('');
  const unico = (m, k, id) => { if (!k) return; if (m.has(k)) { if (m.get(k) !== id) m.set(k, null); } else m.set(k, id); };
  let maxId = 0;
  for (const [k, v] of Object.entries(P)) {
    const tn = +k.split(':')[0], id = +k.split(':')[1];
    if (id > maxId) maxId = id;
    const n = norm(v.name); if (!n) continue;
    if (!idx[tn].has(n)) idx[tn].set(n, id);
    unico(pegado[tn], pega(n), id);
    unico(pegado[tn], alReves(n), id);
    // la versión sin puntuación PEGADA (O'Connell → oconnell), que la normalización de arriba separa
    unico(pegado[tn], String(v.name).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, ''), id);
    porTokens[tn].push([n.split(' '), id]);
    const p = n.split(' ');
    const ap = p[p.length - 1] + '|' + (p[0] || ' ')[0];
    if (!porApellido[tn].has(ap)) porApellido[tn].set(ap, []);
    porApellido[tn].get(ap).push(id);
  }
  let siguienteId = Math.max(900000, maxId + 1);
  const nuevos = new Map();
  function resolver(tn, nombre, pais) {
    const n = norm(nombre);
    if (!n) return null;
    if (idx[tn].has(n)) return { id: idx[tn].get(n), como: 'exacto' };
    for (const k of [pega(n), alReves(n)]) {
      const hit = pegado[tn].get(k);
      if (hit) return { id: hit, como: 'pegado' };
    }
    const toks = n.split(' ');
    if (toks.length >= 2) {
      const cand = porTokens[tn].filter(([t]) => t.length > toks.length && toks.every((x, i) => t[i] === x));
      if (cand.length === 1) return { id: cand[0][1], como: 'prefijo' };
    }
    const c = porApellido[tn].get(toks[toks.length - 1] + '|' + (toks[0] || ' ')[0]);
    if (c && c.length === 1) return { id: c[0], como: 'apellido+inicial' };
    const k = tn + '|' + n;
    if (nuevos.has(k)) return { id: nuevos.get(k), como: 'nuevo' };
    const id = siguienteId++;
    nuevos.set(k, id);
    P[tn + ':' + id] = { name: String(nombre).trim(), hand: 'U', dob: null, country: pais || null, ht: null };
    idx[tn].set(n, id);
    return { id, como: 'nuevo' };
  }

  // ── SUPERFICIE HEREDADA DEL HISTÓRICO, POR NOMBRE Y POR CIUDAD ────────────────────────────────────────
  // Por nombre casi no funciona, y el motivo es que las dos fuentes nombran distinto: la espina usa la
  // CIUDAD ("Halle", "Queen's Club", "s Hertogenbosch") y ESPN usa el PATROCINADOR ("Terra Wortmann Open",
  // "HSBC Championships", "Libéma Open"). Medido en la primera pasada: 12 de 13 torneos sin superficie.
  //
  // Lo que sí cierra el puente es que ESPN publica la SEDE —"Halle, Germany"— y la sede es justamente el
  // nombre que usa la espina. Con una guardia que no es opcional: el MES tiene que coincidir. Stuttgart es
  // el ejemplo exacto de por qué: la sede masculina de junio es HIERBA y la femenina de abril es TIERRA.
  // Sin el mes, la mitad de los partidos de hierba entrarían al Elo de tierra.
  //
  // Y si ni el nombre ni la sede resuelven, la superficie queda DESCONOCIDA (−1). No se infiere por
  // calendario ni por lo que juegue el resto esa semana: eso sería adivinar, y una superficie adivinada
  // pesa un 30 % en la probabilidad del cruce. El compilador lleva manejando el −1 desde siempre.
  const supPorNombre = [new Map(), new Map()];
  for (const r of M.rows) {
    const t = M.tourneys[r[F.tid]]; if (!t) continue;
    const s = r[F.surface]; if (!(s >= 0)) continue;
    const mes = +String(r[F.date]).slice(4, 6);
    for (const [k, m] of [[normT(t.name), supPorNombre[r[F.tour]]], [norm(t.name), supPorNombre[r[F.tour]]]]) {
      if (!k) continue;
      if (!m.has(k)) m.set(k, { s: new Map(), meses: new Set() });
      const e = m.get(k); e.s.set(s, (e.s.get(s) || 0) + 1); e.meses.add(mes);
    }
  }
  const mejorSup = (e) => [...e.s.entries()].sort((a, b) => b[1] - a[1])[0][0];

  // PUENTES DE NOMBRE DECLARADOS, y son pocos a propósito. Hay torneos del circuito principal cuyo nombre
  // comercial no se parece al de la espina y cuya sede es ambigua: "HSBC Championships" se juega en Londres
  // y la espina lo llama "Queen's Club", pero "London" también fue sede de las Finales ATP en pista dura.
  // Sin puente, ese torneo se cae; con la sede a secas, entraría con la superficie equivocada. Así que se
  // declaran uno a uno, verificables contra la propia base, en vez de inferir.
  // Van POR TOUR porque el mismo nombre comercial cae en sitios distintos de la base: el Masters de Canadá
  // es "Canada Masters" en el circuito masculino y "Toronto"/"Montreal" en el femenino, así que el puente
  // hace falta solo en uno de los dos y la sede resuelve el otro sola.
  const PUENTES = {
    '0|national bank open presented by rogers': 'Canada Masters',
    '0|hsbc championships': "Queen's Club",
    '0|the hsbc championships': "Queen's Club",
    '1|hsbc championships': "Queen's Club",
    '1|the hsbc championships': "Queen's Club",
  };

  const resolverTorneo = (tn, nombre, sede, fecha) => {
    const mes = +String(fecha).slice(4, 6);
    const puente = PUENTES[tn + '|' + norm(nombre)];
    if (puente) { const e = supPorNombre[tn].get(norm(puente)); if (e) return { s: mejorSup(e), como: 'puente' }; }
    const porNombre = supPorNombre[tn].get(normT(nombre));
    if (porNombre) return { s: mejorSup(porNombre), como: 'nombre' };
    const ciudad = norm(String(sede || '').split(',')[0]);
    const porSede = ciudad ? supPorNombre[tn].get(ciudad) : null;
    if (porSede && porSede.meses.has(mes)) return { s: mejorSup(porSede), como: 'sede' };
    return { s: -1, como: null };
  };

  // índice de torneos existente, para no duplicar entradas
  // el índice de torneos va por nombre NORMALIZADO: ESPN escribe "The HSBC Championships" un día y
  // "HSBC Championships" otro, y con la clave cruda eso son dos torneos distintos en la base.
  const tIdx = new Map();
  M.tourneys.forEach((t, i) => { const k = t.tour + '|' + norm(t.name); if (!tIdx.has(k)) tIdx.set(k, i); });
  const tidDe = (tn, nombre) => {
    const k = tn + '|' + norm(nombre);
    if (tIdx.has(k)) return tIdx.get(k);
    const i = M.tourneys.length;
    M.tourneys.push({ name: nombre, tour: tn });
    tIdx.set(k, i);
    return i;
  };

  // lo que ya está, para no meterlo dos veces
  const yaEsta = new Set();
  for (const r of M.rows) yaEsta.add([r[F.tour], r[F.date], r[F.wid], r[F.lid], r[F.round]].join('|'));

  // ── barrido ───────────────────────────────────────────────────────────────────────────────────────────
  const vistos = new Set();          // por id de competición de ESPN: el mismo torneo sale en varios días
  const filas = [];
  const inf = { dias: 0, peticiones: 0, torneos: new Set(), fuera: new Map(), errores: [] };
  for (let d = desde; d <= hasta; d = masDias(d, paso)) {
    inf.dias++;
    for (const lg of ['atp', 'wta']) {
      let j = null;
      try { j = await get(`https://site.api.espn.com/apis/site/v2/sports/tennis/${lg}/scoreboard?dates=${d}`); inf.peticiones++; }
      catch (e) { if (inf.errores.length < 8) inf.errores.push(`${lg} ${d}: ${e.message}`); continue; }
      for (const ev of (j && j.events) || []) {
        const nombreT = String(ev.name || ev.shortName || '').trim();
        for (const g of ev.groupings || []) {
          const slug = String((g.grouping || {}).slug || '');
          if (!/singles$/.test(slug)) continue;                 // dobles fuera: la base es de individuales
          const tn = /^womens/.test(slug) ? 1 : 0;
          for (const c of g.competitions || []) {
            if (!(((c.status || {}).type || {}).completed)) continue;
            if (vistos.has(c.id)) continue;
            vistos.add(c.id);
            if (esClasificacion((c.round || {}).displayName)) continue;   // previa fuera, como en la espina
            const cs = c.competitors || [];
            if (cs.length !== 2) continue;
            const gan = cs.find((x) => x.winner), per = cs.find((x) => !x.winner);
            if (!gan || !per || !gan.athlete || !per.athlete) continue;
            const ls = (x) => (x.linescores || []).map((l) => +l.value).filter((v) => Number.isFinite(v));
            const sg = ls(gan), sp = ls(per);
            if (!sg.length || sg.length !== sp.length) continue;  // sin marcador utilizable no entra
            let sw = 0, sl = 0, gw = 0, gl = 0;
            const sets = [];
            for (let i = 0; i < sg.length; i++) {
              gw += sg[i]; gl += sp[i];
              if (sg[i] > sp[i]) sw++; else if (sp[i] > sg[i]) sl++;
              sets.push(`${sg[i]}-${sp[i]}`);
            }
            if (!sw) continue;                                   // el "ganador" no ganó ningún set: dato roto
            const paisDe = (x) => { const a = ((x.athlete || {}).flag || {}).alt; return a || null; };
            const rw = resolver(tn, gan.athlete.displayName || gan.athlete.fullName, paisDe(gan));
            const rl = resolver(tn, per.athlete.displayName || per.athlete.fullName, paisDe(per));
            if (!rw || !rl || rw.id === rl.id) continue;
            for (const r of [rw, rl]) inf[r.como] = (inf[r.como] || 0) + 1;
            const fecha = aNum(c.date || ev.date || aISO(d));
            const ronda = roundOf((c.round || {}).displayName);
            const clave = [tn, fecha, rw.id, rl.id, ronda].join('|');
            if (yaEsta.has(clave)) continue;
            yaEsta.add(clave);
            // EL TORNEO TIENE QUE EXISTIR EN LA ESPINA, y esto no es un filtro de calidad: es de POBLACIÓN.
            // La espina es circuito principal (la agregación filtra por nivel de torneo), pero el marcador
            // de ESPN cuela Challengers —Foggia, Makarska, Módena, Ilkley— en el mismo listado. Meterlos
            // metería a los jugadores un escalón entero que el modelo histórico nunca vio, y su Elo se
            // movería con partidos de otra población. Un torneo del circuito principal lleva once años
            // repitiéndose en la misma ciudad, así que si no resuelve ni por nombre, ni por sede, ni por
            // puente declarado, no es de esta base. Se descarta y se DICE cuál, con su cuenta, para que
            // añadir un puente sea una decisión informada y no un descubrimiento dentro de un año.
            const t0 = resolverTorneo(tn, nombreT, (ev.venue || {}).displayName, fecha);
            if (!t0.como) {
              const etiqueta = (tn === 0 ? 'ATP ' : 'WTA ') + nombreT + (ev.venue && ev.venue.displayName ? ` (${ev.venue.displayName})` : '');
              inf.fuera.set(etiqueta, (inf.fuera.get(etiqueta) || 0) + 1);
              continue;
            }
            const sup = t0.s;
            inf['sup_' + t0.como] = (inf['sup_' + t0.como] || 0) + 1;
            inf.torneos.add(nombreT);
            const bo = ((c.format || {}).regulation || {}).periods === 5 ? 5 : 3;
            const fila = new Array(M.schema.length).fill(-1);
            fila[F.tour] = tn; fila[F.date] = fecha; fila[F.tid] = tidDe(tn, nombreT);
            fila[F.surface] = sup; fila[F.level] = ev.major ? 'G' : (tn === 0 ? 'A' : 'I');
            fila[F.best_of] = bo; fila[F.round] = ronda;
            fila[F.wid] = rw.id; fila[F.lid] = rl.id;
            fila[F.sets_w] = sw; fila[F.sets_l] = sl; fila[F.games_w] = gw; fila[F.games_l] = gl;
            fila[F.ret] = 0; fila[F.minutes] = -1; fila[F.w_rank] = -1; fila[F.l_rank] = -1;
            fila[F.score] = sets.join(' ');
            filas.push(fila);
          }
        }
      }
      await sleep(400);
    }
  }

  // ── informe ───────────────────────────────────────────────────────────────────────────────────────────
  const fechas = filas.map((f) => f[F.date]).sort();
  console.log(`\n[cola] ventana ${desde} → ${hasta} (paso ${paso} días) · ${inf.peticiones} peticiones`);
  console.log(`[cola] ${filas.length} partidos nuevos · ${inf.torneos.size} torneos · ` +
    (fechas.length ? `del ${fechas[0]} al ${fechas[fechas.length - 1]}` : 'sin partidos'));
  const VIAS = ['exacto', 'pegado', 'prefijo', 'apellido+inicial', 'nuevo'];
  const tot = VIAS.reduce((a, k) => a + (inf[k] || 0), 0);
  const pc = (x) => (100 * x / Math.max(1, tot)).toFixed(1) + '%';
  console.log('[cola] identidad: ' + VIAS.map((k) => `${k} ${inf[k] || 0} (${pc(inf[k] || 0)})`).join(' · '));
  console.log(`[cola] superficie: por nombre ${inf.sup_nombre || 0} · por sede ${inf.sup_sede || 0} · por puente ${inf.sup_puente || 0}`);
  if (inf.fuera.size) {
    const f = [...inf.fuera.entries()].sort((a, b) => b[1] - a[1]);
    console.log(`[cola] FUERA por no estar en la espina (${f.length} torneos, ${f.reduce((a, x) => a + x[1], 0)} partidos):`);
    for (const [n, c] of f.slice(0, 12)) console.log(`         ${String(c).padStart(4)}  ${n}`);
  }
  // LOS IDS NUEVOS SE LISTAN, no se cuentan y ya. Un id nuevo puede ser un jugador que debutó de verdad o
  // un nombre que ESPN escribe distinto: lo primero es correcto y lo segundo parte una carrera en dos. La
  // diferencia solo se ve leyendo los nombres, así que se imprimen.
  if (nuevos.size) {
    const lista = [...nuevos.keys()].map((k) => (k.split('|')[0] === '0' ? 'ATP ' : 'WTA ') + k.split('|').slice(1).join('|'));
    console.log(`[cola] ids nuevos (${lista.length}) — revisar que sean debuts y no variantes de escritura:`);
    for (let i = 0; i < lista.length; i += 4) console.log('        ' + lista.slice(i, i + 4).join(' · '));
  }
  if (inf.errores.length) console.log('[cola] errores:', inf.errores.join(' | '));

  if (!APPLY) { console.log('[cola] (simulacro: sin --apply no se escribe nada)'); return; }
  if (!filas.length) { console.log('[cola] nada que escribir'); return; }

  M.rows = M.rows.concat(filas).sort((a, b) => a[F.date] - b[F.date]);
  const ultimo = { atp: +lm.atp || 0, wta: +lm.wta || 0 };
  for (const f of filas) { const t = f[F.tour] === 0 ? 'atp' : 'wta'; if (f[F.date] > ultimo[t]) ultimo[t] = f[F.date]; }
  // ESCRITURA ATÓMICA. matches.json pesa 8 MB y lo lee el motor al arrancar: si un despliegue corta la
  // escritura por la mitad, el tenis entero se cae con un JSON truncado y no hay vuelta atrás.
  const escribe = (n, obj, pretty) => {
    const tmp = path.join(OUT, '.' + n + '.tmp');
    fs.writeFileSync(tmp, JSON.stringify(obj, null, pretty ? 1 : undefined));
    fs.renameSync(tmp, path.join(OUT, n));
  };
  escribe('matches.json', { schema: M.schema, tourneys: M.tourneys, rows: M.rows });
  escribe('players.json', P);
  escribe('meta.json', {
    ...meta, built_at: new Date().toISOString(), rows: M.rows.length, players: Object.keys(P).length,
    tourneys: M.tourneys.length, last_match_date: ultimo,
    // LA COSTURA VA DECLARADA. Quien lea esta base tiene que poder saber dónde se acaba el dato con saque
    // y resto y dónde empieza el que solo tiene marcador.
    tail: { source: 'ESPN scoreboard (público)', from: desde, to: hasta, rows: filas.length,
      spine_until: desdeBase,
      lacks: ['saque/resto (aces, dobles faltas, puntos, break points)', 'minutos', 'ranking del momento'],
      note: 'los repos de Jeff Sackmann fueron retirados de GitHub; la espina histórica llega hasta ' +
        `${desdeBase} y de ahí en adelante el dato viene del marcador público de ESPN.` },
  }, true);
  console.log(`[cola] escrito en ${OUT} · base ahora ${M.rows.length} filas · último ATP ${ultimo.atp} · último WTA ${ultimo.wta}`);
  return { rows: filas.length, last: ultimo, out: OUT };
})().catch((e) => { console.error('[cola] FALLO:', e.message); process.exit(1); });
