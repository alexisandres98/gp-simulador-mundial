// combat-engine/phases.js — GOLPEO Y LUCHA POR FASE, DESDE LA ESTADÍSTICA GRANULAR (16-ago).
// Módulos 57-90 del blueprint de combate.
//
// LO QUE ESTE ARCHIVO APROVECHA Y NADIE MÁS USA. Nuestro dataset de ESPN trae, por pelea y peleador, los
// golpes significativos separados por POSICIÓN (distancia / clinch / suelo) y por OBJETIVO (cabeza / cuerpo
// / pierna) — nueve combinaciones, intentados y conectados — más derribos, avances posicionales concretos
// (a media guardia, a lateral, a montada, a espalda), reversiones, intentos de sumisión y tiempo de control.
// 7.998 peleas con ese detalle. La mayoría de productos se queda en "golpes significativos por minuto".
//
// LAS TRES IDEAS QUE ORDENAN EL ARCHIVO:
//
// 1. UNA TASA NO ES UNA HABILIDAD HASTA QUE SE AJUSTA POR RIVAL. Un peleador con 55% de precisión contra
//    rivales que se dejan pegar no es más preciso que uno con 45% contra defensores. Cada métrica sale en
//    bruto y AJUSTADA: lo observado menos lo que ese rival suele conceder. Es la misma descomposición
//    "ataque menos defensa" que ya validamos en baloncesto, aplicada a nueve celdas de golpeo.
//
// 2. LA FASE ES LA UNIDAD, NO LA PELEA. El blueprint lo dice en su primera línea: "no modelar peleas;
//    modelar estados y transiciones". Un peleador puede ser dominante a distancia y desaparecer en el
//    clinch. Promediar las dos cosas produce un número que no describe a nadie.
//
// 3. LA CADENA IMPORTA MÁS QUE EL TOTAL. Que alguien logre 4 derribos no dice si los convierte en control,
//    si avanza de posición o si el rival se levanta enseguida. Acá se mide la cadena entera:
//    intento → derribo → control → avance → amenaza de sumisión.
//
// PURO: entra el dataset derivado, salen perfiles. Sin red, sin disco, sin db.
'use strict';

const r3 = (x) => (Number.isFinite(x) ? +x.toFixed(3) : null);
const r2 = (x) => (Number.isFinite(x) ? +x.toFixed(2) : null);
const div = (a, b) => (b > 0 ? a / b : null);

// Las nueve celdas de golpeo significativo, tal como las publica la fuente.
const POSITIONS = ['Distance', 'Clinch', 'Ground'];
const TARGETS = ['Head', 'Body', 'Leg'];
const cellKey = (pos, tgt, kind) => `sig${pos}${tgt}Strikes${kind}`;

// Duración de una pelea en minutos, a partir del round y reloj de final.
function fightMinutes(f) {
  const rd = Number(f.end_round) || Number(f.rounds_sched) || 1;
  const cl = String(f.end_clock || '').match(/^(\d+):(\d+)/);
  const roundLen = 5;                                   // MMA: 5 min por asalto en todas las promociones grandes
  // el reloj de ESPN es tiempo TRANSCURRIDO del asalto final
  const last = cl ? (+cl[1] + (+cl[2]) / 60) : roundLen;
  return (rd - 1) * roundLen + Math.min(last, roundLen);
}

// ---- 1) ACUMULADOR POR PELEADOR --------------------------------------------------------------------------
// Recorre las peleas una vez y acumula, por peleador: lo que HIZO y lo que le HICIERON. Las dos mitades son
// imprescindibles — sin la segunda no se puede ajustar por rival ni medir defensa.
function accumulate(fights, statsById, { since = null, halfLifeDays = 900, now = null } = {}) {
  const t0 = now || Date.now();
  const A = new Map();
  const blank = () => ({
    n: 0, w: 0, min: 0, wsum: 0,
    kd: 0, kd_abs: 0,
    sig_l: 0, sig_a: 0, sig_l_abs: 0, sig_a_abs: 0,
    tot_l: 0, tot_a: 0,
    cells: {}, cells_abs: {},
    td_l: 0, td_a: 0, td_l_abs: 0, td_a_abs: 0,
    adv: 0, adv_half: 0, adv_side: 0, adv_mount: 0, adv_back: 0,
    rev: 0, rev_abs: 0, sub: 0, sub_abs: 0, ctrl: 0, ctrl_abs: 0,
    fin_for: 0, fin_ag: 0, ko_for: 0, ko_ag: 0, sub_for: 0, sub_ag: 0, dec: 0,
    opps: [],
  });
  const get = (id) => { if (!A.has(id)) A.set(id, blank()); return A.get(id); };

  for (const f of fights) {
    if (!f || !f.completed || !f.f1 || !f.f2) continue;
    const when = Date.parse(f.date || 0);
    if (since && when < since) continue;
    const st = statsById[String(f.comp_id)];
    if (!st) continue;
    const s1 = st[String(f.f1.id)], s2 = st[String(f.f2.id)];
    if (!s1 || !s2) continue;
    const mins = fightMinutes(f);
    if (!(mins > 0.5)) continue;
    // DECAIMIENTO TEMPORAL: una pelea de 2016 no describe al peleador de hoy. Vida media de ~2,5 años.
    const w = Math.pow(0.5, Math.max(0, (t0 - when) / 864e5) / halfLifeDays);
    const meth = String((f.method || {}).name || '').toLowerCase();
    const isKo = /ko|tko/.test(meth), isSub = /sub/.test(meth), isDec = /dec/.test(meth);

    for (const [me, foe, myS, foeS] of [[f.f1, f.f2, s1, s2], [f.f2, f.f1, s2, s1]]) {
      const c = get(String(me.id));
      c.n++; c.wsum += w; c.min += w * mins;
      if (me.winner) c.w++;
      c.kd += w * (myS.knockDowns || 0); c.kd_abs += w * (foeS.knockDowns || 0);
      c.sig_l += w * (myS.sigStrikesLanded || 0); c.sig_a += w * (myS.sigStrikesAttempted || 0);
      c.sig_l_abs += w * (foeS.sigStrikesLanded || 0); c.sig_a_abs += w * (foeS.sigStrikesAttempted || 0);
      c.tot_l += w * (myS.totalStrikesLanded || 0); c.tot_a += w * (myS.totalStrikesAttempted || 0);
      for (const pos of POSITIONS) for (const tgt of TARGETS) {
        const k = pos + tgt;
        c.cells[k] = c.cells[k] || { l: 0, a: 0 };
        c.cells_abs[k] = c.cells_abs[k] || { l: 0, a: 0 };
        c.cells[k].l += w * (myS[cellKey(pos, tgt, 'Landed')] || 0);
        c.cells[k].a += w * (myS[cellKey(pos, tgt, 'Attempted')] || 0);
        c.cells_abs[k].l += w * (foeS[cellKey(pos, tgt, 'Landed')] || 0);
        c.cells_abs[k].a += w * (foeS[cellKey(pos, tgt, 'Attempted')] || 0);
      }
      c.td_l += w * (myS.takedownsLanded || 0); c.td_a += w * (myS.takedownsAttempted || 0);
      c.td_l_abs += w * (foeS.takedownsLanded || 0); c.td_a_abs += w * (foeS.takedownsAttempted || 0);
      c.adv += w * (myS.advances || 0);
      c.adv_half += w * (myS.advanceToHalfGuard || 0); c.adv_side += w * (myS.advanceToSide || 0);
      c.adv_mount += w * (myS.advanceToMount || 0); c.adv_back += w * (myS.advanceToBack || 0);
      c.rev += w * (myS.reversals || 0); c.rev_abs += w * (foeS.reversals || 0);
      c.sub += w * (myS.submissions || 0); c.sub_abs += w * (foeS.submissions || 0);
      c.ctrl += w * (myS.timeInControl || 0); c.ctrl_abs += w * (foeS.timeInControl || 0);
      if (me.winner) { c.fin_for += (isKo || isSub) ? w : 0; c.ko_for += isKo ? w : 0; c.sub_for += isSub ? w : 0; }
      else { c.fin_ag += (isKo || isSub) ? w : 0; c.ko_ag += isKo ? w : 0; c.sub_ag += isSub ? w : 0; }
      if (isDec) c.dec += w;
      c.opps.push({ id: String(foe.id), w, mins, date: f.date });
    }
  }
  return A;
}

// ---- 2) PERFIL DE GOLPEO (módulos 57-68) ----------------------------------------------------------------
function strikingProfile(c) {
  if (!c || !(c.min > 3)) return null;
  const perMin = (x) => div(x, c.min);
  const cellRate = (k) => ({
    landed_pm: r3(div(c.cells[k].l, c.min)), att_pm: r3(div(c.cells[k].a, c.min)),
    acc: r3(div(c.cells[k].l, c.cells[k].a)), share: r3(div(c.cells[k].a, c.sig_a)),
  });
  const cells = {}; for (const k of Object.keys(c.cells)) cells[k] = cellRate(k);
  const sumPos = (pos) => TARGETS.reduce((s, t) => s + c.cells[pos + t].a, 0);
  const sumTgt = (tgt) => POSITIONS.reduce((s, p) => s + c.cells[p + tgt].a, 0);
  const ctrlMin = c.ctrl / 60;
  return {
    // 57 · ritmo
    pace: { sig_landed_pm: r3(perMin(c.sig_l)), sig_att_pm: r3(perMin(c.sig_a)), total_landed_pm: r3(perMin(c.tot_l)) },
    // 58 · precisión propia
    accuracy: { sig: r3(div(c.sig_l, c.sig_a)), total: r3(div(c.tot_l, c.tot_a)) },
    // 59 · absorción y defensa
    defense: { absorbed_pm: r3(perMin(c.sig_l_abs)), opp_accuracy: r3(div(c.sig_l_abs, c.sig_a_abs)),
      // la defensa es 1 − precisión que concede: es LO QUE EL PELEADOR CONTROLA, no cuánto le tiran
      striking_defense: r3(1 - (div(c.sig_l_abs, c.sig_a_abs) || 0)) },
    // 60 · reparto por objetivo
    target: { head: r3(div(sumTgt('Head'), c.sig_a)), body: r3(div(sumTgt('Body'), c.sig_a)), leg: r3(div(sumTgt('Leg'), c.sig_a)) },
    // 61 · reparto por posición
    position: { distance: r3(div(sumPos('Distance'), c.sig_a)), clinch: r3(div(sumPos('Clinch'), c.sig_a)), ground: r3(div(sumPos('Ground'), c.sig_a)) },
    // 62 · proxy de poder: derribos por golpe conectado a la cabeza en pie + conversión a finalización
    power: {
      kd_per15: r3(perMin(c.kd) * 15),
      kd_per_100_head: r3(div(c.kd, (c.cells.DistanceHead.l + c.cells.ClinchHead.l)) * 100),
      ko_rate: r3(div(c.ko_for, c.wsum)),
      finish_rate: r3(div(c.fin_for, c.wsum)),
    },
    // 44 · durabilidad, como tasa y no como etiqueta
    durability: { kd_absorbed_per15: r3(perMin(c.kd_abs) * 15), ko_against_rate: r3(div(c.ko_ag, c.wsum)) },
    // 68 · volatilidad del intercambio: cuánto se juega por golpe
    volatility: r3(div(c.kd + c.kd_abs, c.min) * 15),
    cells,
    control_min_pm: r3(div(ctrlMin, c.min)),
    sample: { fights: c.n, minutes: r2(c.min), weight: r2(c.wsum) },
  };
}

// ---- 3) PERFIL DE LUCHA Y SUELO (módulos 69-90) ---------------------------------------------------------
function grapplingProfile(c) {
  if (!c || !(c.min > 3)) return null;
  const per15 = (x) => div(x, c.min) * 15;
  const ctrlMin = c.ctrl / 60, ctrlAbsMin = c.ctrl_abs / 60;
  return {
    // 69-70 · entrada y conversión
    takedown: {
      att_per15: r3(per15(c.td_a)), landed_per15: r3(per15(c.td_l)),
      accuracy: r3(div(c.td_l, c.td_a)),
      // 71 · defensa: fracción de intentos rivales que NO acaban en derribo
      defense: r3(1 - (div(c.td_l_abs, c.td_a_abs) || 0)),
      conceded_per15: r3(per15(c.td_l_abs)),
    },
    // 77-78 · calidad del control: minutos de control por derribo logrado, y por minuto de pelea
    control: {
      min_per15: r3(per15(ctrlMin)), conceded_min_per15: r3(per15(ctrlAbsMin)),
      per_takedown: r3(div(ctrlMin, c.td_l)),
      net_per15: r3(per15(ctrlMin - ctrlAbsMin)),
    },
    // 87 · avance posicional: lo que de verdad separa a un controlador de un pasador
    advance: {
      per15: r3(per15(c.adv)),
      per_control_min: r3(div(c.adv, ctrlMin)),
      to_half: r3(div(c.adv_half, c.adv)), to_side: r3(div(c.adv_side, c.adv)),
      to_mount: r3(div(c.adv_mount, c.adv)), to_back: r3(div(c.adv_back, c.adv)),
      // 84 · caza de espalda: la ruta que más sumisiones produce
      back_per15: r3(per15(c.adv_back)),
    },
    // 82-83 · amenaza de sumisión, normalizada por oportunidad de suelo
    submission: {
      att_per15: r3(per15(c.sub)), att_per_control_min: r3(div(c.sub, ctrlMin)),
      finish_rate: r3(div(c.sub_for, c.wsum)),
      // 89 · defensa: sumisiones sufridas por minuto que el rival controla
      conceded_per_ctrl_min: r3(div(c.sub_ag, ctrlAbsMin)),
      lost_by_sub_rate: r3(div(c.sub_ag, c.wsum)),
    },
    // 85 · amenaza desde abajo
    bottom: { reversals_per15: r3(per15(c.rev)), reversals_conceded_per15: r3(per15(c.rev_abs)) },
    // 90 · la cadena completa, que es la lectura que importa
    chain: {
      td_to_control: r3(div(ctrlMin, c.td_l)),
      control_to_advance: r3(div(c.adv, ctrlMin)),
      advance_to_sub: r3(div(c.sub, c.adv)),
      note: 'derribo → control → avance → amenaza: cada eslabón por separado, porque un peleador puede ser fuerte en uno y nulo en el siguiente',
    },
    sample: { fights: c.n, minutes: r2(c.min) },
  };
}

// ---- 4) AJUSTE POR RIVAL ---------------------------------------------------------------------------------
// Lo observado menos lo que ese rival CONCEDE de media. Es la diferencia entre "conecta mucho" y "conecta
// mucho contra gente que no defiende". Se encoge por muestra: con tres peleas el ajuste no puede mandar.
function opponentAdjust(A, profiles, { prior = 4 } = {}) {
  const lgOf = (fn) => {
    const vals = [...profiles.values()].map(fn).filter(Number.isFinite);
    return vals.length ? vals.reduce((s, x) => s + x, 0) / vals.length : null;
  };
  const lg = {
    sig_pm: lgOf((p) => p.striking && p.striking.pace.sig_landed_pm),
    absorbed_pm: lgOf((p) => p.striking && p.striking.defense.absorbed_pm),
    td_per15: lgOf((p) => p.grappling && p.grappling.takedown.landed_per15),
    td_conc: lgOf((p) => p.grappling && p.grappling.takedown.conceded_per15),
    ctrl: lgOf((p) => p.grappling && p.grappling.control.min_per15),
  };
  const out = new Map();
  for (const [id, prof] of profiles) {
    const c = A.get(id);
    if (!c || !prof.striking) { out.set(id, prof); continue; }
    // "lo que conceden mis rivales" ponderado por el peso con el que los enfrenté
    let ws = 0, oppAbs = 0, oppTdConc = 0, n = 0;
    for (const o of c.opps) {
      const op = profiles.get(o.id); if (!op || !op.striking) continue;
      ws += o.w; n++;
      oppAbs += o.w * (op.striking.defense.absorbed_pm || lg.absorbed_pm || 0);
      oppTdConc += o.w * ((op.grappling && op.grappling.takedown.conceded_per15) || lg.td_conc || 0);
    }
    if (!ws || !n) { out.set(id, prof); continue; }
    const shrink = n / (n + prior);
    const expAbs = oppAbs / ws, expTd = oppTdConc / ws;
    const adj = {
      // conectar 4,5/min contra rivales que conceden 3,0 vale más que contra los que conceden 5,0
      sig_landed_pm_adj: r3((prof.striking.pace.sig_landed_pm || 0) - shrink * ((expAbs || 0) - (lg.absorbed_pm || 0))),
      td_landed_per15_adj: r3((prof.grappling.takedown.landed_per15 || 0) - shrink * ((expTd || 0) - (lg.td_conc || 0))),
      opponents: n, shrink: r3(shrink),
      opp_concedes: { strikes_pm: r3(expAbs), takedowns_per15: r3(expTd) },
    };
    out.set(id, { ...prof, adjusted: adj });
  }
  return { profiles: out, league: lg };
}

// ---- 5) FACHADA ------------------------------------------------------------------------------------------
function buildProfiles(fights, stats, opts = {}) {
  const A = accumulate(fights, stats, opts);
  const raw = new Map();
  for (const [id, c] of A) {
    const s = strikingProfile(c), g = grapplingProfile(c);
    if (s || g) raw.set(id, { id, striking: s, grappling: g });
  }
  const { profiles, league } = opponentAdjust(A, raw, opts);
  return { profiles, league, n: profiles.size, acc: A };
}

module.exports = { POSITIONS, TARGETS, fightMinutes, accumulate, strikingProfile, grapplingProfile, opponentAdjust, buildProfiles };
