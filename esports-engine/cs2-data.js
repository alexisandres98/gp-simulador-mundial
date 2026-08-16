// esports-engine/cs2-data.js — LA BASE PROPIA DE CS2, SERVIDA AL MOTOR (16-ago).
//
// Lee los agregados que produce `scripts/cs2-harvest.js` y los deja listos para que el motor razone con
// MEDICIONES en vez de con supuestos. Es la diferencia entre el CS2 de esta mañana y el de ahora:
//
//   ANTES (supuesto de circuito)        AHORA (medido sobre el histórico propio)
//   ─────────────────────────────       ────────────────────────────────────────────────────
//   fuerza por mapa: null               tasa de victoria por mapa, encogida y con decaimiento
//   árbol de veto: imposible            se dibuja con la fuerza real de cada equipo en cada mapa
//   prórroga: 12,8 % asumido            11,4 % medido, y POR MAPA (Overpass 8,2 % · Cache 13,9 %)
//   rondas: 22,06 asumido               21,49 medido, y por mapa y por orden dentro de la serie
//   arrastre económico: calibrado a ojo  ajustado por mapa para reproducir su prórroga real
//
// CACHE EN MEMORIA porque los tres archivos suman pocos MB y se leen en cada petición: se cargan una vez y
// se refrescan cuando cambia el mtime, que es como ya funciona el resto de la casa.
'use strict';

const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'data', 'esports', 'cs2');
const FILES = ['maps.json', 'teams.json', 'team-maps.json', 'team-global.json', 'meta.json'];

const G = global._cs2data = global._cs2data || { at: 0, stamp: '', data: null };

function stamp() {
  try { return FILES.map((f) => fs.statSync(path.join(DIR, f)).mtimeMs).join('|'); } catch { return ''; }
}
const rd = (f) => { try { return JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')); } catch { return null; } };

function load() {
  const s = stamp();
  if (G.data && G.stamp === s && Date.now() - G.at < 10 * 60e3) return G.data;
  const maps = rd('maps.json'), teams = rd('teams.json'), tm = rd('team-maps.json'), meta = rd('meta.json');
  const tg = rd('team-global.json');
  const data = {
    available: !!(maps && maps.maps && tm && tm.teams),
    maps: (maps && maps.maps) || {},
    teams: (teams && teams.teams) || {},
    teamMaps: (tm && tm.teams) || {},
    teamGlobal: (tg && tg.teams) || {},
    meta: meta || null,
    at: (meta && meta.at) || null,
  };
  // Índice de búsqueda por nombre normalizado. Cuando dos equipos comparten forma normalizada gana el que
  // más historial tiene: entre el primer equipo y su filial, el mercado casi siempre habla del primero.
  data.byName = {};
  // el mínimo es DOS caracteres, no tres: "G2", "C9" y "NIP" son nombres reales de equipos de élite, y con
  // el guardia en tres se quedaban fuera del índice exacto — con lo que "G2" acababa resolviendo por
  // contención a "G2 Ares", que es su filial.
  const put = (k, t) => {
    if (!k || k.length < 2) return;
    const cur = data.byName[k];
    if (!cur || (data.teams[cur] && (t.n || 0) > (data.teams[cur].n || 0))) data.byName[k] = t.id;
  };
  for (const t of Object.values(data.teams)) {
    put(norm(t.name), t);
    // alias corto por la primera palabra: "FaZe Clan" → "faze". No se aplica a filiales, que es justo
    // donde el alias corto haría el daño ("Spirit Academy" → "spirit").
    if (!/\b(academy|junior|youth|jr)\b/i.test(t.name || '')) put(norm(String(t.name).split(/\s+/)[0]), t);
  }
  data.pool = poolOf(data.maps);
  G.data = data; G.stamp = s; G.at = Date.now();
  return data;
}

// "academy" y "junior" NO se limpian, y esto no es un detalle: al limpiarlos, "Spirit Academy" y "Spirit"
// colapsaban al mismo nombre y el resolutor le entregaba a Team Spirit —número 1 del mundo— el historial de
// su filial. Un equipo con el historial de otro es peor que un equipo sin historial: el modelo se pone
// seguro sobre una mentira. Solo se quitan los sufijos que de verdad son ruido de marca.
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/\b(esports?|gaming|team|club|cs2?)\b/g, '').replace(/[^a-z0-9]/g, '');

// EL POOL ACTIVO NO SE HARDCODEA: se deduce de lo que se está jugando de verdad en los últimos meses. Valve
// lo cambia y una lista escrita a mano queda vieja sin que nadie se entere; los datos no.
function poolOf(maps) {
  // se mira lo RECIENTE, no el total histórico: el pool es lo que se está jugando ahora, y un mapa retirado
  // acumula miles de partidas viejas que lo mantendrían en cabeza para siempre.
  // EL DESEMPATE MIRA LA TENDENCIA, no solo el volumen. Medido el 16-ago, Cache y Overpass estaban a la par
  // en juego reciente (259 contra 284), pero cuentan cosas distintas: los 259 mapas de Cache son TODOS de los
  // últimos 100 días —acaba de entrar al pool— mientras que los de Overpass son el rescoldo de 2.617
  // históricos, o sea un mapa saliendo. Ordenar solo por volumen habría dejado fuera al que se va a jugar y
  // dentro al que se está yendo. La cuota de recencia lo separa sin que nadie tenga que mantener una lista.
  const score = (m) => (m.recent_n || 0) * (0.7 + 0.3 * ((m.recent_n || 0) / Math.max(1, m.n)));
  const rows = Object.values(maps).filter((m) => m.in_pool || (m.recent_n || 0) >= 60)
    .sort((a, b) => score(b) - score(a)).slice(0, 7);
  if (rows.length >= 5) return rows.map((m) => m.map);
  return Object.values(maps).filter((m) => m.n >= 40).sort((a, b) => b.n - a.n).slice(0, 7).map((m) => m.map);
}

// ---- resolución de equipo: del nombre que da el mercado al id propio -------------------------------------
// Devuelve null antes que un equipo equivocado. Asignarle a un equipo el histórico de otro es peor que no
// tener histórico: el modelo se vuelve confiado sobre una mentira.
function resolveTeam(name, { data = load() } = {}) {
  const n = norm(name);
  if (!n) return null;
  if (data.byName[n]) return data.byName[n];
  // Contención como último recurso. Si casan varios, se queda el de más historial SOLO si le saca una
  // distancia clara al segundo; si están parejos es que son equipos distintos con nombres parecidos y se
  // devuelve null, que es la respuesta honesta.
  // La contención solo se permite con consultas de 4+ caracteres y **por prefijo**: "faze" → "fazeclan" sí,
  // pero "g2" → "g2ares" no. Aceptar contención en cualquier posición es lo que metía a las filiales.
  if (n.length < 4) return null;
  const hits = [];
  for (const [k, id] of Object.entries(data.byName)) {
    if (k.startsWith(n) || n.startsWith(k)) hits.push(id);
  }
  if (!hits.length) return null;
  if (hits.length === 1) return hits[0];
  const ranked = hits.map((id) => ({ id, n: (data.teams[id] && data.teams[id].n) || 0 })).sort((a, b) => b.n - a.n);
  return ranked[0].n >= 2 * Math.max(1, ranked[1].n) ? ranked[0].id : null;
}

// ---- fuerza por mapa de un enfrentamiento ---------------------------------------------------------------
// Devuelve, para cada mapa del pool, la probabilidad de que A gane ESE mapa. Se combina de dos señales que
// dicen cosas distintas y se estropean por motivos distintos:
//   · Elo por mapa: comparativo y transitivo, pero lento en reaccionar a un cambio de roster.
//   · Tasa de victoria encogida: directa, pero no sabe contra quién se ganó.
// Cuando una de las dos falta, manda la otra; cuando faltan las dos, el mapa se declara SIN DATOS en vez de
// devolver 0,5 disfrazado de estimación.
// ═══ EL MODELO JERÁRQUICO CALIBRADO ═══════════════════════════════════════════════════════════════════
// ESTE BLOQUE SE REESCRIBIÓ ENTERO PORQUE LA VALIDACIÓN DIJO QUE LA VERSIÓN ANTERIOR ESTABA MAL.
//
// La versión anterior mezclaba un Elo POR MAPA con una tasa de victoria por mapa. Sonaba razonable —"en CS2
// un equipo puede ser top en Mirage y flojo en Nuke"— y era lo que este archivo argumentaba con toda
// confianza. La validación walk-forward sobre 40.432 mapas, con punto en el tiempo estricto, la desmontó:
//
//     predictor            skill de Brier      AUC
//     elo_global                  6,88 %      0,649     ← un solo Elo por equipo, ignorando el mapa
//     elo_mapa                    3,04 %      0,600     ← el Elo por mapa
//     wr_mapa                     1,00 %      0,577
//     modelo anterior (gp)        2,12 %      0,589     ← lo que servía producción
//     jerárquico calibrado        7,28 %      0,652     ← este
//
// La lectura: el efecto de mapa EXISTE pero es pequeño, y tratarlo como un rating independiente parte el
// historial del equipo en siete trozos. El ruido que añade esa partición se come la señal y deja el modelo
// por debajo de ignorar el mapa por completo. La respuesta correcta no es tirar el mapa: es dejar de
// tratarlo como rating y usarlo como CORRECCIÓN sobre la fuerza global.
//
//     logit(p) = CAL_SLOPE × [ logit(p_elo_global) + LAMBDA × (efecto_A − efecto_B) ]
//
// LAMBDA y el encogimiento del efecto se ajustaron en la ventana interna (2024-2025) y se confirmaron en
// 2026 sin volver a tocarlos. CAL_SLOPE corrige la sobreconfianza: sin él la pendiente de calibración era
// 0,88 (cuando decía 70 % la realidad era 67 %); con él es 0,999 y el ECE baja de 0,0165 a 0,0081.
const ELO_SCALE = 400;
const LAMBDA = 1.6;          // peso del efecto de mapa sobre el logit  (ajustado, meseta 1,2-2,6)
const CAL_SLOPE = 0.873;     // corrección de sobreconfianza            (ajustado)
const MODEL_VERSION = 'cs2-hier-cal-1';

function matchupMaps(idA, idB, { data = load(), pool = null } = {}) {
  const A = data.teamMaps[idA], B = data.teamMaps[idB];
  const GA = data.teamGlobal[idA], GB = data.teamGlobal[idB];
  const list = pool || data.pool;

  // BASE: la fuerza global del par. Es lo que de verdad predice.
  let pBase = null;
  if (GA && GB && GA.elo != null && GB.elo != null) pBase = 1 / (1 + Math.pow(10, (GB.elo - GA.elo) / ELO_SCALE));
  else if (GA && GB) pBase = clamp01(0.5 + (GA.wr - GB.wr));

  const out = [];
  for (const m of list) {
    const a = A && A.maps[m], b = B && B.maps[m];
    const info = data.maps[m] || null;
    if (pBase == null) {
      out.push({ map: m, p_a: null, why: 'sin fuerza global de alguno de los dos equipos', n_a: (a && a.n) || 0, n_b: (b && b.n) || 0, info });
      continue;
    }
    const ea = a && a.effect != null ? a.effect : 0;
    const eb = b && b.effect != null ? b.effect : 0;
    const lg = Math.log(pBase / (1 - pBase)) + LAMBDA * (ea - eb);
    const p = 1 / (1 + Math.exp(-lg * CAL_SLOPE));
    out.push({
      map: m, p_a: r3(clamp(p, 0.10, 0.90)),
      p_base: r3(pBase),                                   // qué diría el modelo si ignorara el mapa
      shift_pp: r3(100 * (p - pBase)),                      // cuánto aporta ESTE mapa, en puntos
      n_a: (a && a.n) || 0, n_b: (b && b.n) || 0,
      wr_a: a ? a.wr : null, wr_b: b ? b.wr : null,
      effect_a: a ? a.effect : null, effect_b: b ? b.effect : null,
      rd_a: a ? a.rd : null, rd_b: b ? b.rd : null,
      elo_a: a ? a.elo : null, elo_b: b ? b.elo : null,
      info,
    });
  }
  return out;
}

// La fuerza global del par, que ahora es la cifra principal del modelo y merece salir sola.
function globalStrength(idA, idB, { data = load() } = {}) {
  const GA = data.teamGlobal[idA], GB = data.teamGlobal[idB];
  if (!GA || !GB) return null;
  const p = GA.elo != null && GB.elo != null
    ? 1 / (1 + Math.pow(10, (GB.elo - GA.elo) / ELO_SCALE))
    : clamp01(0.5 + (GA.wr - GB.wr));
  return {
    p_map_base: r3(p), elo_a: GA.elo, elo_b: GB.elo, wr_a: GA.wr, wr_b: GB.wr,
    n_a: GA.n, n_b: GB.n, model_version: MODEL_VERSION,
  };
}

// ---- perfil de ronda de un mapa (lo que sustituye a las constantes inventadas) ---------------------------
// Devuelve la distribución REAL de rondas del perdedor y del total, más la tasa de prórroga observada. El
// motor de simulación se calibra contra esto en vez de contra una intuición.
function mapProfile(mapKey, { data = load() } = {}) {
  const m = data.maps[mapKey];
  if (!m || m.n < 40) return null;
  return {
    map: mapKey, n: m.n,
    // si hay muestra reciente suficiente manda ella: un parche cambia el ritmo de un mapa y la media de dos
    // años lo esconde. Se guarda también la de todo el histórico para poder comparar.
    mean_rounds: m.recent_mean_rounds != null ? m.recent_mean_rounds : m.mean_rounds,
    overtime_p: m.recent_overtime_p != null ? m.recent_overtime_p : m.overtime_p,
    window: m.recent_mean_rounds != null ? 'últimos 100 días' : 'histórico completo',
    recent_n: m.recent_n || 0,
    all_mean_rounds: m.mean_rounds, all_overtime_p: m.overtime_p,
    blowout_p: m.blowout_p,
    loser_distribution: m.loser_distribution, total_distribution: m.total_distribution,
    decider_mean_rounds: m.decider_mean_rounds, by_order: m.by_order,
    measured: true,
  };
}

function teamCard(id, { data = load() } = {}) {
  const t = data.teams[id]; if (!t) return null;
  const tm = data.teamMaps[id], g = data.teamGlobal[id];
  // se ordena por EFECTO, no por tasa bruta: lo interesante de un equipo no es dónde gana más —eso lo
  // arrastra su nivel general— sino dónde gana más DE LO QUE LE TOCARÍA por su nivel.
  const maps = tm ? Object.entries(tm.maps).map(([k, v]) => ({ map: k, ...v }))
    .sort((a, b) => (b.effect ?? 0) - (a.effect ?? 0)) : [];
  return { ...t, maps, n: tm ? tm.n : 0, elo: g ? g.elo : null, wr: g ? g.wr : null };
}

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const clamp01 = (x) => clamp(x, 0, 1);
const r3 = (x) => (Number.isFinite(x) ? +x.toFixed(3) : null);

module.exports = { load, resolveTeam, matchupMaps, globalStrength, mapProfile, teamCard, poolOf, norm, DIR,
  LAMBDA, CAL_SLOPE, ELO_SCALE, MODEL_VERSION };
