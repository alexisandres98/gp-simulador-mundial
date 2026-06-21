// repositories/index.js — punto único de acceso a los repositorios server-side.
// Centraliza el SQL (parametrizado) y evita queries dispersas por server.js. En Sprint 0 estos
// repositorios existen y están testeables, pero la app actual NO los usa todavía (no se migra nada).
'use strict';

module.exports = {
  providers: require('./providerRepository'),
  ingestionRuns: require('./ingestionRunRepository'),
  rawSnapshots: require('./rawSnapshotRepository'),
  normalizedSnapshots: require('./normalizedSnapshotRepository'),
  canonicalEvents: require('./canonicalEventRepository'),
  canonicalMarkets: require('./canonicalMarketRepository'),
  canonicalOutcomes: require('./canonicalOutcomeRepository'),
  eventParticipants: require('./eventParticipantRepository'),
  mappings: require('./mappingRepository'),
  signals: require('./signalRepository'),
  modelAnalysisRuns: require('./modelAnalysisRunRepository'),
};
