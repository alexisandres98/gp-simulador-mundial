// exec-opportunities/repositories/deepLinkTemplateRepository.js — Sprint 4. provider_deep_link_templates.
'use strict';
const db = require('../../database/client');

module.exports = {
  async upsert(t) {
    const r = await db.query(
      `INSERT INTO provider_deep_link_templates (provider_code, template_type, url_template, version, verified, metadata)
       VALUES ($1,$2,$3,COALESCE($4,'deeplink-1'),COALESCE($5,false),COALESCE($6,'{}'::jsonb))
       ON CONFLICT (provider_code, template_type, version) DO UPDATE SET
         url_template = EXCLUDED.url_template, verified = EXCLUDED.verified, metadata = EXCLUDED.metadata
       RETURNING *`,
      [String(t.provider).toLowerCase(), t.templateType || t.template_type, t.urlTemplate || t.url_template,
       t.version || null, t.verified != null ? !!t.verified : null, t.metadata ? JSON.stringify(t.metadata) : null]
    );
    return r.rows[0];
  },

  // byProvider() → { polymarket: { market:'...', event:'...' }, kalshi:{...} } para override del código
  async overrides() {
    const r = await db.query('SELECT * FROM provider_deep_link_templates');
    const out = {};
    for (const row of r.rows) {
      const p = row.provider_code;
      out[p] = out[p] || {};
      out[p][row.template_type] = row.url_template;
    }
    return out;
  },
};
