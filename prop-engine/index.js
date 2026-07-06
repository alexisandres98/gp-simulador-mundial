// prop-engine/index.js — Fachada del motor de PROPS (córners + tarjetas). Fase P1: motor puro + calibración.
// Aún SIN cablear al server (se enchufa cuando fluyan cuotas de córners/tarjetas vía The Odds API 100k:
// markets alternate_totals_corners / alternate_totals_cards → capa Value → capa Picks, patrón goal-engine).
'use strict';
const model = require('./model');
const markets = require('./markets');
const calibrate = require('./calibrate');

module.exports = {
  fit: model.fit,
  project: model.project,
  overProbNB: model.overProbNB,
  buildMarkets: markets.build,
  settleMarket: markets.settle,
  backtest: calibrate.backtest,
};
