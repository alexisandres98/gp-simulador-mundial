# Dardos — contrato de la API `/api/darts/*` (admin-only; `GP_DARTS_PUBLIC_ENABLED` abre al público)

Todas las rutas devuelven JSON; 404 si el usuario no es admin y el flag no está. Las tesis (`picks`,
`candidates`) viajan dentro de `board` y `match`. Tiers como tenis: `sim`, `read`, `brief`, `track` son Pro.
Estimaciones de un modelo estadístico, no consejo financiero. Fuente: `darts-engine/store.js`.

## GET /api/darts/board
```
{ rows: [Row], tournaments: [TourSummary], refreshed_at, odds_at, books: {pinnacle,bovada,polymarket,cloudbet: bool}, doctrine, attribution, note }
Row = {
  id (fixtureID PDC), tournament, tournament_id, stage ("Last 16"|"Quarter-Final"|…), start_at (ISO), status ("Fixture"|"Result"), board, tv,
  a, b (nombres), a_id, b_id, a_country, b_country ("GB-ENG"…), photo_a, photo_b (URL o null), score_a, score_b, winner_id,
  format: { kind:"legs"|"sets", best_of, first_to, two_clear, max_legs | best_of_sets, first_to_sets, legs_per_set, final_set_two_clear, double_in, certified: bool, source },
  market: { ml_p_a, ml_p_a_pinnacle, books:[…], n_books, has_180s, lines_legs:[9.5,…], polymarket:{p_a, liquidity, url}|null },
  available: bool, why (si no),
  gp: { p_a, p_a_compiled, p_a_elo, exp_legs|exp_sets, exp_180_a, exp_180_b, hold_a, hold_b, unc_pp, avg_a, avg_b },
  candidates: [Candidate], shadow_n, picks: [PickCard],
  live: { state:"live"|"final", legs_a, legs_b, best_of, source:"flashscore" } | ausente
}
Candidate = { family, side, line, participant ('a'|'b'|null), odds, book, p_model, p_implied, edge_pp, unc_pp, gates:[{gate,pass,detail,informativo?}], verdict:"SHADOW_PICK"|"NO_PICK", no_pick_reason, benchmark?, unsettleable? }
family ∈ ML | LEGS_TOTAL | LEGS_HCP | SETS_TOTAL | SETS_HCP | X180_TOTAL | X180_MOST | X180_PLAYER | HIGHEST_CHECKOUT | CORRECT_SCORE
PickCard = la card de la casa (pickCard()): family (SOLID|TOTAL|SPREAD|PLAYER|COMBO), family_raw, fam_label, selection_name, home, away, dt_avas:{h,a}, dt_hash:"dtmatch/<id>", competition_name, kickoff, confidence, model_prob, market_prob, pick_id, why_es, odds, book, stake_pct, stake_raw_pct, stake_capped, shadow:true, signals:{win_prob, edge_pp, data_confidence, pick_quality, regime:"monitor"}
TourSummary = { id, name, venue, city, start, end, tv, ranked, logo, fixtures, results, formats:[{stage,sets,legs,two_clear,n}], double_in, winner_id, certified_format, format_source }
```

## GET /api/darts/match?id=<fixtureID>
```
Row (arriba) + {
  available, a:{id,name,photo,country}, b:{…}, p_a, p_a_compiled, p_a_elo, unc_pp, starter:"a"|"b"|"unknown", scenarios:{a_starts:{p_a}, b_starts:{p_a}}|null, first_leg_p_a,
  leg: { hold_a, hold_b, break_a, break_b, exp_visits },
  legs: { exp_total, total:[[n,p]…], margin:[[m,p]…], score:[["6-3",p]…] } | null,
  sets: { exp_total, total, score } | null,
  x180: { exp_a, exp_b, most_a, most_b, tie, a:[[n,p]], b:[[n,p]], total:[[n,p]] },
  checkout_max: { a:[[100,P(>=100)],[110,…]…170], b, match },
  exp_visits,
  kernels: { a: Kernel, b: Kernel },
  format_prism: [{label:"BO7"|"BO11"|"BO19"|"BO35"|"BO3 sets"…, p_a, exp_units, exp_180_total, current: bool}],
  h2h: { w_a, w_b, rows:[{date(YYYYMMDD), winner, score, tourney, round, avg_w, avg_l}] },
  profiles: { a: Profile, b: Profile },
  market_rows: [{book,family,side,line,odds,participant}], polymarket, candidates, picks, model_version, doctrine, attribution
}
Kernel = { avg, per180_visit, checkout_pct, exposure_darts, source, cold, as_of, elo,
  windows: { avg_365, avg_90, darts_365, darts_90, x180_365, x180_90, co_365:{hit,att,pct}, co_90 } | null,
  identified: "avg+180"|"avg"|…, fitted:{ avg3, x180_leg, darts_leg },
  doubles: [["D20",p],["D16",p]…]  (con qué doble cierra, del kernel),
  checkout_pmf: [[valor,p]…]       (valor del checkout terminal),
  visits_pmf: [[k,p]…]              (visitas que necesita para cerrar 501 jugando solo),
  scoring_visit: [[puntos,p]…]      (distribución de una visita de puntuación pura: 26, 41, 45, 60, 85, 100, 140, 180…) }
```

## GET /api/darts/agenda → { rows:[Row básica + live], at, attribution }  (±30 h)
## GET /api/darts/live?id=&legs_a=&legs_b=[&starter=a|b] → { p_a, from:{legs_a,legs_b}, p_a_prematch } | null
## GET /api/darts/players?q=&limit= → { rows:[{id,name,country,photo,nickname,tour_card,oom_rank,elo,wl,avg,per180_visit,checkout_pct,cold,last,inactive}], total, attribution, freshness }
## GET /api/darts/player?id= → Profile
```
Profile = { available, id, name, country, photo, nickname, dob, age, hometown, darts (marca), dart_weight, started, tour_card, oom_rank, prize, nine_darters,
  elo, wl:{w,l}, legs:{won,lost}, titles, best_avg, x180_total,
  skill: { avg, per180_visit, checkout_pct, exposure_darts, source, cold, as_of, windows },
  kernel: { fitted:{avg3,x180_leg,darts_leg}, identified, doubles, checkout_pmf, visits_pmf, nine_dart_pct },
  form: [{to (YYYY-MM-DD), avg, darts, x180}]   (ventanas de 90 d, una por mes),
  recent: [{date, opp, opp_id, won, score, avg, x180, co, hc, tourney, round}],
  last_date, inactive_note, attribution, freshness, index_note }
```
## GET /api/darts/ranking → { rows:[{pos, move, …fila de players}], snapshot_at, note, attribution }
## GET /api/darts/tournaments → { rows:[{id,name,venue,city,start,end,tv,ranked,logo,fixtures,double_in,state:"upcoming"|"live"|"done"}] }
## GET /api/darts/tournament?id= → TourSummary + { available, stages:[{stage,sets,legs,two_clear,fixtures:[Row + gp?{p_a,exp_legs} + market?{ml_p_a,n_books}]}], title:[{id,name,photo,p}], outrights:[{book,participant,odds}]|null }
## GET /api/darts/sim?a=&b=&format=bo11|bo19|matchplay19|sets7|wgp5[&starter=a|b] (Pro)
```
{ available, format, starter, a:{id,name,country,photo}, b, p_a, p_a_compiled, p_a_elo, unc_pp, scenarios, leg:{hold_a,hold_b,break_a,break_b}, legs|sets, x180:{exp_a,exp_b,most_a,most_b,tie,total}, checkout_max:{match}, skills:{a:{avg,per180_visit,checkout_pct,elo},b}, format_prism, h2h,
  sample_leg: { winner, visits:[{who:'a'|'b', from, to, darts, scored, fin, dbl, is180, bust}] }, note, attribution }
```
## GET /api/darts/track (Pro) → { regime, doctrine, open, open_list, settled, w, l, push, voided, units, roi_pct, clv_avg_pct, clv_n, by_family:{FAM:{n,hit_pct,units,clv_avg_pct,clv_n,clv_sd,note}}, by_family_book, recent, reading, settle_diag }
## GET /api/darts/model → { name, version, family, doctrine, base:{matches,players,tourneys,window,freshness,orakel_as_of,sources,level}, mechanism:{atom,leg,match,markets}, validation, families:{FAM:"sombra"|…}, known_gaps:[…], disclaimer }
## GET /api/darts/brief (Pro) → { day, games:[Row…], intro:{es,en,at}|null, intro_error, note }
## GET /api/darts/read?id= (Pro) → { es, en, at, match_id } | { pending:true, why }
## GET /api/darts/search?q= → { hit:{id,name}|null }
## POST /api/ask  body { q, sport:'darts', lang, hist } → { a }

## Convenciones de UI
- Hash del partido: `dtmatch/<fixtureID>`; del jugador: `dtplayer/<id>`; del torneo: `dttour/<id>`.
- `dt_hash`/`dt_avas` en la pick card (añadir a `pickCard()` junto a `ten_hash`/`ten_avas`).
- Deporte `darts` con vistas `DT_VIEWS = ['dtopps','dtgames','dtmatch','dtplayers','dtplayer','dtrank','dttours','dttour','dtsim','dtperf','dtbrief','dtask','dtmodel']`.
- Bandera `S.me.dartsPublic`; `dtAllowed()` como `tenAllowed()`. Barra de deportes: botón oculto si no está permitido (idioma tenis/F1). Emoji 🎯.
