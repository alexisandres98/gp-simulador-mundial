// providerRepository.js — acceso a la tabla providers. SQL parametrizado y centralizado.
// NO guarda secretos (las API keys viven solo en variables de entorno).
'use strict';
const db = require('../client');

module.exports = {
  // upsert por code. input: { code, name, providerType?, baseUrl?, supports*?, metadata? } → row
  async upsertByCode(p) {
    const r = await db.query(
      `INSERT INTO providers (code, name, provider_type, base_url, supports_rest, supports_websocket, supports_orderbook, supports_historical, metadata)
       VALUES ($1,$2,COALESCE($3,'prediction_market'),$4,COALESCE($5,true),COALESCE($6,false),COALESCE($7,false),COALESCE($8,false),COALESCE($9,'{}'::jsonb))
       ON CONFLICT (code) DO UPDATE SET
         name = EXCLUDED.name, provider_type = EXCLUDED.provider_type, base_url = EXCLUDED.base_url,
         supports_rest = EXCLUDED.supports_rest, supports_websocket = EXCLUDED.supports_websocket,
         supports_orderbook = EXCLUDED.supports_orderbook, supports_historical = EXCLUDED.supports_historical,
         metadata = EXCLUDED.metadata
       RETURNING *`,
      [p.code, p.name, p.providerType || null, p.baseUrl || null, p.supportsRest, p.supportsWebsocket, p.supportsOrderbook, p.supportsHistorical, p.metadata ? JSON.stringify(p.metadata) : null]
    );
    return r.rows[0];
  },
  // findByCode(code) → row | null
  async findByCode(code) {
    const r = await db.query('SELECT * FROM providers WHERE code = $1', [code]);
    return r.rows[0] || null;
  },
  // findById(id) → row | null
  async findById(id) {
    const r = await db.query('SELECT * FROM providers WHERE id = $1', [id]);
    return r.rows[0] || null;
  },
  // listActive() → row[]
  async listActive() {
    const r = await db.query('SELECT * FROM providers WHERE is_active = true ORDER BY code');
    return r.rows;
  },
};
