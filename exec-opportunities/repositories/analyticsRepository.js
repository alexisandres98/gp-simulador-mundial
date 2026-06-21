// exec-opportunities/repositories/analyticsRepository.js — Sprint 4. executable_opportunity_events.
// NUNCA persiste capital/bankroll. Solo evento + props ya saneadas por analytics.js.
'use strict';
const db = require('../../database/client');

module.exports = {
  async insert({ event, props = {}, sessionRef = null }) {
    const r = await db.query(
      `INSERT INTO executable_opportunity_events
         (event_type, public_id, provider_code, jurisdiction_status, classification, calculator_range, session_ref, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'{}'::jsonb) RETURNING id`,
      [event, props.public_id || null, props.provider || null, props.jurisdiction_status || null,
       props.classification || null, props.calculator_range || null, sessionRef]
    );
    return r.rows[0];
  },

  async summary({ sinceHours = 24 } = {}) {
    const r = await db.query(
      `SELECT event_type, count(*)::int n FROM executable_opportunity_events
       WHERE created_at > now() - ($1 || ' hours')::interval GROUP BY event_type ORDER BY n DESC`,
      [String(sinceHours)]
    );
    return r.rows;
  },
};
