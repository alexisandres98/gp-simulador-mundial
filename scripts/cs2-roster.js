// scripts/cs2-roster.js — ORG ≠ ROSTER (P0.5 del blueprint 2.0).
//
// POR QUÉ ESTO ES EL PUNTO MÁS BAJO DEL SISTEMA. El blueprint 2.0 puntúa "Roster / player intelligence" con
// un 2,0 sobre 10 y da en el clavo: hasta ahora el modelo trataba a un equipo como si fuera el mismo desde
// 2024. No lo es. "Vitality" es una MARCA; los cinco que juegan hoy son un ROSTER, y cuando cambia uno, la
// mitad del historial de esa marca deja de describir al equipo que va a jugar mañana.
//
// El efecto es directo sobre el modelo: la fuerza global de un equipo se calcula sobre 447 mapas que pueden
// pertenecer a tres alineaciones distintas. Sin separar org de roster, el modelo está seguro de algo que ya
// no existe.
//
// ── LO QUE SE PUEDE HACER HOY Y LO QUE NO, SIN ADORNOS ───────────────────────────────────────────────────
// El proveedor da la PLANTILLA ACTUAL de cada equipo (jugador → equipo, rol, si es coach, cuándo se unió),
// pero NO da el histórico de alineaciones. O sea: sé quién juega hoy, no quién jugaba en marzo.
//
// Eso deja dos caminos, y este archivo toma los dos:
//   1. AHORA — construir el grafo canónico org / roster / jugador / pertenencia con las fechas que el
//      proveedor sí da (`joined_team_at`), que basta para calcular continuidad y antigüedad del núcleo.
//   2. DESDE HOY — tomar una FOTO diaria de cada plantilla. Un cambio de roster se detecta comparando la
//      foto de hoy con la de ayer, y a partir de ese momento GP tiene lineage propio con fechas efectivas
//      reales. No recupera el pasado, pero deja de perder el futuro, que es lo único que estaba en nuestra
//      mano. Cuanto antes empiece, antes vale.
//
// Nada de esto se inventa: los equipos sin fecha de incorporación se marcan como desconocidos en vez de
// asumirles una antigüedad.
//
// Uso:
//   node scripts/cs2-roster.js             # cosecha plantillas + foto del día + deriva continuidad
//   node scripts/cs2-roster.js --derive    # solo re-deriva desde las fotos guardadas (sin red)
'use strict';

const fs = require('fs');
const path = require('path');
const B3 = require('../data-providers/esports/bo3');

const ROOT = path.join(__dirname, '..');
const AGG_DIR = path.join(ROOT, 'data', 'esports', 'cs2');
const RAW_DIR = (() => {
  const d = path.join(path.dirname(process.env.DB_FILE || path.join(ROOT, 'db.json')), 'esports', 'cs2-raw');
  try { fs.mkdirSync(d, { recursive: true }); return d; } catch { }
  const f = path.join(ROOT, 'data', 'esports', 'cs2-raw');
  try { fs.mkdirSync(f, { recursive: true }); } catch { }
  return f;
})();
const SNAP_DIR = path.join(RAW_DIR, 'roster-snapshots');
try { fs.mkdirSync(SNAP_DIR, { recursive: true }); } catch { }

const rdRaw = (f) => { try { return JSON.parse(fs.readFileSync(path.join(RAW_DIR, f), 'utf8')); } catch { return null; } };
const wrRaw = (f, o) => fs.writeFileSync(path.join(RAW_DIR, f), JSON.stringify(o));
const wrAgg = (f, o) => fs.writeFileSync(path.join(AGG_DIR, f), JSON.stringify(o));
const log = (...a) => console.log(...a);
const ARG = Object.fromEntries(process.argv.slice(2).map((s) => {
  const m = s.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] === undefined ? true : m[2]] : [s, true];
}));
const r3 = (x) => (Number.isFinite(x) ? +x.toFixed(3) : null);
const today = () => new Date().toISOString().slice(0, 10);

// ── 1) COSECHA DE JUGADORES ──────────────────────────────────────────────────────────────────────────────
async function harvestPlayers() {
  const players = {};
  let n = 0;
  await B3.paginate('players', {
    sort: '-id',
    onPage: (rows) => {
      for (const p of rows) {
        if (p.discipline_id !== 1) continue;                 // solo CS
        if (p.is_deleted) continue;
        const id = p.slug || String(p.id);
        players[id] = {
          id, provider_id: p.id, nick: p.nickname || null,
          name: [p.first_name, p.last_name].filter(Boolean).join(' ') || null,
          team: p.team_id != null ? p.team_id : null,
          role: p.role || null, coach: !!p.is_coach,
          joined_at: p.joined_team_at || null,
          country_id: p.country_id != null ? p.country_id : null,
          photo: p.image_url || null,
          rating6m: Number.isFinite(p.six_month_avg_rating) ? p.six_month_avg_rating : null,
          status: p.status,
        };
        n++;
      }
      return true;
    },
    log: (m) => log(m),
  });
  log(`  jugadores de CS: ${Object.keys(players).length}`);
  return players;
}

// ── 2) FOTO DEL DÍA ──────────────────────────────────────────────────────────────────────────────────────
// Una foto por día y por equipo. Es lo que convierte "no tengo histórico" en "a partir de hoy sí lo tengo".
function snapshot(players, teams) {
  const byTeam = {};
  for (const p of Object.values(players)) {
    if (p.team == null) continue;
    (byTeam[p.team] = byTeam[p.team] || []).push({ id: p.id, nick: p.nick, role: p.role, coach: p.coach, joined_at: p.joined_at });
  }
  const day = today();
  const snap = { day, at: new Date().toISOString(), teams: {} };
  for (const [provId, list] of Object.entries(byTeam)) {
    const t = teams[provId];
    if (!t) continue;
    snap.teams[t.id] = {
      org: t.id, name: t.name,
      five: list.filter((x) => !x.coach).sort((a, b) => String(a.id).localeCompare(String(b.id))).map((x) => x.id),
      coach: (list.find((x) => x.coach) || {}).id || null,
      detail: list,
    };
  }
  fs.writeFileSync(path.join(SNAP_DIR, `${day}.json`), JSON.stringify(snap));
  return snap;
}

// ── 3) LINEAGE: de las fotos a un histórico de alineaciones con fechas efectivas ──────────────────────────
// Cada vez que el conjunto de cinco cambia, se cierra el roster anterior y se abre uno nuevo. El id del
// roster es una huella de sus cinco jugadores: dos periodos con los mismos cinco son el MISMO roster aunque
// haya habido un paréntesis, que es lo correcto (un equipo que recupera su quinteto vuelve a ser ese equipo).
function lineage() {
  const days = fs.readdirSync(SNAP_DIR).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  const byOrg = {};
  for (const f of days) {
    let snap; try { snap = JSON.parse(fs.readFileSync(path.join(SNAP_DIR, f), 'utf8')); } catch { continue; }
    for (const [org, t] of Object.entries(snap.teams || {})) {
      const fp = t.five.join('|');
      const O = byOrg[org] = byOrg[org] || { org, name: t.name, periods: [] };
      const last = O.periods[O.periods.length - 1];
      if (last && last.fingerprint === fp) { last.to = snap.day; last.days++; }
      else O.periods.push({ fingerprint: fp, five: t.five, coach: t.coach, from: snap.day, to: snap.day, days: 1 });
    }
  }
  return byOrg;
}

// ── 4) CONTINUIDAD: lo que el modelo necesita saber ──────────────────────────────────────────────────────
// El blueprint pide roster overlap, roster age, core continuity y ventana de shock. Con una sola foto no hay
// solapamiento histórico todavía, pero sí hay antigüedad y núcleo — y el solapamiento se llena solo con los
// días. Lo que NO se hace es fingir un solapamiento del 100 % cuando lo que hay es una única observación.
const SHOCK_DAYS = 45;                 // ventana tras un cambio en la que el historial pesa menos
function continuity(orgs, players) {
  const out = {};
  const now = Date.now();
  for (const [org, O] of Object.entries(orgs)) {
    const cur = O.periods[O.periods.length - 1];
    if (!cur) continue;
    // antigüedad del quinteto: la mejor de dos señales — nuestras fotos y las fechas del proveedor
    const joins = cur.five.map((id) => (players[id] || {}).joined_at).filter(Boolean).map((d) => Date.parse(d));
    const newestJoin = joins.length === cur.five.length ? Math.max(...joins) : null;
    const daysFromProvider = newestJoin ? Math.floor((now - newestJoin) / 864e5) : null;
    const daysFromSnapshots = cur.days > 1 ? Math.floor((now - Date.parse(cur.from)) / 864e5) : null;
    const stableDays = daysFromProvider != null && daysFromSnapshots != null
      ? Math.min(daysFromProvider, daysFromSnapshots)
      : (daysFromProvider != null ? daysFromProvider : daysFromSnapshots);

    const prev = O.periods.length > 1 ? O.periods[O.periods.length - 2] : null;
    const overlap = prev ? cur.five.filter((x) => prev.five.includes(x)).length : null;

    out[org] = {
      org, name: O.name,
      five: cur.five.map((id) => ({ id, nick: (players[id] || {}).nick || id, role: (players[id] || {}).role || null })),
      coach: cur.coach ? { id: cur.coach, nick: (players[cur.coach] || {}).nick || cur.coach } : null,
      size: cur.five.length,
      stable_days: stableDays,
      stable_since: cur.days > 1 ? cur.from : null,
      // solapamiento con la alineación anterior: null mientras solo tengamos una foto, NO 5/5
      overlap_prev: overlap,
      changed_recently: stableDays != null ? stableDays < SHOCK_DAYS : null,
      // el peso que el modelo debe dar al historial de esta ORG: 1 si el quinteto lleva tiempo junto, y
      // cae hacia 0,55 justo después de un cambio. No es un castigo: es reconocer que el historial
      // describe a otro equipo.
      history_weight: stableDays == null ? null
        : r3(0.55 + 0.45 * Math.min(1, stableDays / SHOCK_DAYS)),
      periods: O.periods.length,
      source: daysFromProvider != null && daysFromSnapshots != null ? 'fotos propias + proveedor'
        : daysFromProvider != null ? 'fechas del proveedor' : daysFromSnapshots != null ? 'fotos propias' : 'desconocido',
    };
  }
  return out;
}

(async () => {
  const t0 = Date.now();
  const teamsRaw = rdRaw('teams.json') || {};
  const teamsByProv = {}; for (const t of Object.values(teamsRaw)) if (t.provider_id != null) teamsByProv[t.provider_id] = t;

  let players = rdRaw('players.json');
  if (!ARG.derive) {
    log('▸ cosechando jugadores…');
    players = await harvestPlayers();
    wrRaw('players.json', players);
    log('▸ tomando la foto del día…');
    const snap = snapshot(players, teamsByProv);
    log(`  ${Object.keys(snap.teams).length} plantillas fotografiadas en ${snap.day}`);
  } else if (!players) { log('no hay jugadores cosechados todavía'); process.exit(1); }

  log('▸ derivando lineage y continuidad…');
  const orgs = lineage();
  const cont = continuity(orgs, players);
  const withFive = Object.values(cont).filter((c) => c.size >= 5).length;
  const changed = Object.values(cont).filter((c) => c.changed_recently).length;
  const days = fs.readdirSync(SNAP_DIR).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).length;

  wrAgg('rosters.json', {
    at: new Date().toISOString(), teams: cont,
    coverage: { orgs: Object.keys(cont).length, with_five: withFive, changed_recently: changed, snapshot_days: days },
    note: 'org ≠ roster. El proveedor da la plantilla ACTUAL, no el histórico; GP toma una foto diaria para construir su propio lineage con fechas efectivas desde hoy. Un solapamiento nulo significa "todavía no hay dos fotos", no "cambió todo".',
    shock_days: SHOCK_DAYS,
  });
  log(`  ${Object.keys(cont).length} organizaciones · ${withFive} con quinteto completo · ${changed} con cambio reciente`);
  log(`  fotos acumuladas: ${days} día(s)`);
  log(`▸ listo en ${((Date.now() - t0) / 1000).toFixed(1)} s`);
})();
