// modelAnalysisRunRepository.js — model_analysis_runs (Sprint 0.1). SQL parametrizado.
'use strict';
const db = require('../client');

module.exports = {
  // insert(run) → row. Campos JSONB se serializan; random_seed es numérico.
  async insert(r) {
    const res = await db.query(
      `INSERT INTO model_analysis_runs
         (analysis_type, status, completed_at, control_model_version, challenger_model_version, factor_policy_version,
          input_hash, random_seed, simulation_count, team_a_reference, team_b_reference, event_reference,
          input_payload, context_payload, control_output, challenger_output, data_quality_payload, metadata)
       VALUES (COALESCE($1,'h2h_sandbox'),COALESCE($2,'completed'),$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,COALESCE($18,'{}'::jsonb))
       RETURNING id`,
      [r.analysisType || null, r.status || null, r.completedAt || null, r.controlModelVersion || null, r.challengerModelVersion || null,
       r.factorPolicyVersion || null, r.inputHash || null, r.randomSeed ?? null, r.simulationCount ?? null,
       r.teamAReference || null, r.teamBReference || null, r.eventReference || null,
       j(r.inputPayload), j(r.contextPayload), j(r.controlOutput), j(r.challengerOutput), j(r.dataQualityPayload), j(r.metadata)]
    );
    return res.rows[0];
  },
  async findById(id) {
    const r = await db.query('SELECT * FROM model_analysis_runs WHERE id = $1', [id]);
    return r.rows[0] || null;
  },
};
function j(v) { return v == null ? null : JSON.stringify(v); }
