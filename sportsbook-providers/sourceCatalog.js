// sportsbook-providers/sourceCatalog.js — Post-shadow Bloque F. Catálogo versionado de fuentes con estado
// de verificación. Provee el conteo de GRUPOS INDEPENDIENTES VERIFICADOS que el consenso/STRONG deben usar:
//   · 'verified'       → cuenta como grupo independiente.
//   · 'duplicate_skin' → se pliega en su grupo de operador (no añade independencia).
//   · 'unverified'/sin catálogo → NO cuenta para el mínimo de STRONG (no se asume independiente).
//   · 'excluded'       → se descarta por completo.
// internal_notes NUNCA sale en el DTO público (solo el número de grupos válidos).
'use strict';
const db = require('../database/client');
const seed = require('./source-catalog-seed');

async function load(provider = 'the_odds_api') {
  if (!db.isConfigured()) return {};
  const r = await db.query(`SELECT * FROM sportsbook_source_metadata WHERE data_provider=$1 AND is_active=true`, [provider]);
  return r.rows.reduce((a, x) => (a[x.sportsbook_code] = x, a), {});
}

// upsert versionado: si cambian operator/independence/verification, sube version y escribe history (append-only).
async function upsertSource(s, { by = 'seed', reason = 'seed/update' } = {}) {
  return db.withTransaction(async (c) => {
    const cur = (await c.query(`SELECT * FROM sportsbook_source_metadata WHERE data_provider=$1 AND sportsbook_code=$2`, [s.data_provider, s.sportsbook_code])).rows[0];
    const changed = !cur || cur.operator_group !== (s.operator_group || null) || cur.independence_group !== (s.independence_group || null)
      || cur.verification_status !== (s.verification_status || 'unverified');
    const r = await c.query(
      `INSERT INTO sportsbook_source_metadata
         (data_provider, sportsbook_code, sportsbook_name, operator_group, independence_group, source_role, jurisdiction,
          verification_status, region, brand_skin, valid_from, internal_notes, evidence, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now(),$11,$12,$13)
       ON CONFLICT (data_provider, sportsbook_code) DO UPDATE SET
         sportsbook_name=COALESCE(EXCLUDED.sportsbook_name, sportsbook_source_metadata.sportsbook_name),
         operator_group=EXCLUDED.operator_group, independence_group=EXCLUDED.independence_group,
         source_role=EXCLUDED.source_role, jurisdiction=EXCLUDED.jurisdiction,
         verification_status=EXCLUDED.verification_status, region=EXCLUDED.region,
         evidence=EXCLUDED.evidence, internal_notes=COALESCE(EXCLUDED.internal_notes, sportsbook_source_metadata.internal_notes),
         version = CASE WHEN $14 THEN sportsbook_source_metadata.version + 1 ELSE sportsbook_source_metadata.version END,
         updated_by=EXCLUDED.updated_by
       RETURNING *`,
      [s.data_provider, s.sportsbook_code, s.sportsbook_name || null, s.operator_group || null, s.independence_group || null,
       s.source_role || 'market_consensus', s.jurisdiction || null, s.verification_status || 'unverified', s.region || null,
       s.brand_skin || null, s.internal_notes || null, JSON.stringify(s.evidence || {}), by, changed]);
    const row = r.rows[0];
    if (changed) {
      await c.query(
        `INSERT INTO sportsbook_source_metadata_history
           (data_provider, sportsbook_code, version, operator_group, independence_group, source_role, verification_status, region, jurisdiction, change_reason, changed_by, snapshot)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [row.data_provider, row.sportsbook_code, row.version, row.operator_group, row.independence_group, row.source_role,
         row.verification_status, row.region, row.jurisdiction, reason, by, JSON.stringify(row)]);
    }
    return row;
  });
}

// seedAll(provider) — siembra las marcas documentadas (verified/duplicate_skin). Idempotente.
async function seedAll(provider = 'the_odds_api', { by = 'seed' } = {}) {
  const rows = seed.seedRows(provider);
  let n = 0;
  for (const s of rows) { await upsertSource(s, { by, reason: 'seed marcas documentadas' }); n++; }
  return { seeded: n };
}

// classify(bookCodes, catalog) — conteo de grupos independientes VERIFICADOS entre las casas presentes.
function classify(bookCodes, catalog = {}) {
  const verifiedGroups = new Set(), unverifiedGroups = new Set(), excluded = [];
  const by = { verified: 0, duplicate_skin: 0, unverified: 0, excluded: 0 };
  for (const code of bookCodes) {
    const m = catalog[code];
    const status = (m && m.verification_status) || 'unverified';   // sin catálogo → unverified (conservador)
    const group = (m && m.independence_group) || code;
    if (status === 'excluded') { excluded.push(code); by.excluded++; continue; }
    if (status === 'verified') { verifiedGroups.add(group); by.verified++; }
    else if (status === 'duplicate_skin') { verifiedGroups.add(group); by.duplicate_skin++; }  // se pliega, no añade grupo nuevo
    else { unverifiedGroups.add(group); by.unverified++; }
  }
  return {
    verified_independence_groups: verifiedGroups.size,
    unverified_groups: unverifiedGroups.size,
    excluded: excluded.length,
    usable_sources: bookCodes.length - excluded.length,
    by_status: by,
  };
}

// DTO público: SOLO el número de grupos independientes válidos (nunca nombres/notas/relaciones).
function publicDTO(classification) {
  return { independent_groups: classification.verified_independence_groups };
}

module.exports = { load, upsertSource, seedAll, classify, publicDTO };
