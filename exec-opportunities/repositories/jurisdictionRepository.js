// exec-opportunities/repositories/jurisdictionRepository.js — Sprint 4. provider_jurisdiction_rules.
'use strict';
const db = require('../../database/client');

module.exports = {
  async upsert(rule) {
    const r = await db.query(
      `INSERT INTO provider_jurisdiction_rules
         (provider_code, country_code, status, source_url, source_checked_at, notes, version, metadata)
       VALUES ($1,$2,COALESCE($3,'requires_provider_verification'),$4,$5,$6,COALESCE($7,'jurisdiction-seed-1'),COALESCE($8,'{}'::jsonb))
       ON CONFLICT (provider_code, country_code, version) DO UPDATE SET
         status = EXCLUDED.status, source_url = EXCLUDED.source_url, source_checked_at = EXCLUDED.source_checked_at,
         notes = EXCLUDED.notes, metadata = EXCLUDED.metadata
       RETURNING *`,
      [String(rule.provider).toLowerCase(), String(rule.country_code || rule.countryCode).toUpperCase(), rule.status || null,
       rule.source_url || rule.sourceUrl || null, rule.source_checked_at || rule.sourceCheckedAt || null,
       rule.notes || null, rule.version || null, rule.metadata ? JSON.stringify(rule.metadata) : null]
    );
    return r.rows[0];
  },

  // all() → reglas activas (última versión por par provider/country)
  async all() {
    const r = await db.query('SELECT * FROM provider_jurisdiction_rules ORDER BY provider_code, country_code, version DESC');
    // mapeo al shape que consume jurisdiction.js (snake_case ya coincide)
    return r.rows.map(x => ({
      provider: x.provider_code, country_code: x.country_code, status: x.status,
      source_url: x.source_url, source_checked_at: x.source_checked_at, notes: x.notes, version: x.version,
    }));
  },
};
