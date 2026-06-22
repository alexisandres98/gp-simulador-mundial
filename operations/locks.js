// operations/locks.js — re-exporta los advisory locks de Sprint 1 (fuente única). El orquestador usa un
// namespace de lock propio por job para no colisionar con el lock interno de cada runOnce legacy.
'use strict';
module.exports = require('../market-data/locks');
