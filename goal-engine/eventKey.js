// goal-engine/eventKey.js — Goles. ID ESTABLE de evento para el pipeline de goles, DESACOPLADO del grafo canónico.
// Las tablas de goles (goal_model_snapshots / sportsbook_goal_quote_current / goal_value_shadow) tienen
// canonical_event_id UUID SIN foreign key → podemos usar un id determinístico por PAR DE EQUIPOS sin crear filas en
// canonical_events (que es el backbone del arbitraje y NO debemos tocar). Un cruce de eliminatoria se juega una sola
// vez → el id sale del par (home,away) y es estable entre la ingesta de cuotas y la creación del snapshot.
// PURO. Cuando el partido SÍ es canónico, el caller prefiere el id canónico real (este es solo el fallback).
'use strict';
const crypto = require('crypto');

// UUID determinístico (formato 8-4-4-4-12) a partir de un string. No es un UUID v5 estándar pero es válido como
// UUID textual para columnas UUID de Postgres y 100% reproducible.
function uuidFrom(str) {
  const h = crypto.createHash('sha256').update(String(str)).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

// ID de evento de goles a partir del par de equipos (orden home|away). 'gp-goal:' como namespace para no colisionar.
function stableGoalEventId(homeId, awayId) {
  return uuidFrom('gp-goal:' + String(homeId).toUpperCase() + '|' + String(awayId).toUpperCase());
}

module.exports = { uuidFrom, stableGoalEventId };
