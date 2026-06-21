// exec-opportunities/repositories/publicationRepository.js — Sprint 4. arb_publications. SQL parametrizado.
'use strict';
const db = require('../../database/client');

const jsonOr = v => (v == null ? null : JSON.stringify(v));

module.exports = {
  async create(p) {
    const r = await db.query(
      `INSERT INTO arb_publications
         (opportunity_id, opportunity_key, evaluation_id, publication_status, visibility, public_id,
          reviewed_by, expires_at, publication_reason, public_payload,
          published_mapping_version, published_rules_fingerprint, risk_disclosure_version, metadata)
       VALUES ($1,$2,$3,COALESCE($4,'draft'),COALESCE($5,'internal'),$6,$7,$8,$9,$10,$11,$12,$13,COALESCE($14,'{}'::jsonb))
       RETURNING *`,
      [uuidOrNull(p.opportunityId), p.opportunityKey, uuidOrNull(p.evaluationId), p.status || null, p.visibility || null,
       p.publicId || null, p.reviewedBy || null, p.expiresAt || null, p.publicationReason || null, jsonOr(p.publicPayload),
       p.publishedMappingVersion || null, p.publishedRulesFingerprint || null, p.riskDisclosureVersion || null, jsonOr(p.metadata)]
    );
    return r.rows[0];
  },

  async findById(id) {
    const r = await db.query('SELECT * FROM arb_publications WHERE id = $1', [id]);
    return r.rows[0] || null;
  },

  async findByPublicId(publicId) {
    const r = await db.query('SELECT * FROM arb_publications WHERE public_id = $1', [publicId]);
    return r.rows[0] || null;
  },

  async findByOpportunityKey(key) {
    const r = await db.query('SELECT * FROM arb_publications WHERE opportunity_key = $1 ORDER BY created_at DESC LIMIT 1', [key]);
    return r.rows[0] || null;
  },

  // listado admin: por estado (o todos), paginado
  async list({ status = null, visibility = null, limit = 50, offset = 0 } = {}) {
    const where = [], params = [];
    if (status) { params.push(status); where.push(`publication_status = $${params.length}`); }
    if (visibility) { params.push(visibility); where.push(`visibility = $${params.length}`); }
    const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
    params.push(Math.min(limit, 200)); const lim = `$${params.length}`;
    params.push(Math.max(offset, 0)); const off = `$${params.length}`;
    const r = await db.query(`SELECT * FROM arb_publications ${w} ORDER BY created_at DESC LIMIT ${lim} OFFSET ${off}`, params);
    const c = await db.query(`SELECT count(*)::int n FROM arb_publications ${w}`, params.slice(0, where.length));
    return { items: r.rows, total: c.rows[0].n };
  },

  // listado público: solo publicadas, visibilidad pública/beta, no expiradas por reloj
  async listPublic({ limit = 50, offset = 0, includeBeta = false } = {}) {
    const vis = includeBeta ? `('public','beta')` : `('public')`;
    const r = await db.query(
      `SELECT * FROM arb_publications
       WHERE publication_status = 'published' AND visibility IN ${vis}
         AND (expires_at IS NULL OR expires_at > now())
       ORDER BY published_at DESC NULLS LAST LIMIT $1 OFFSET $2`,
      [Math.min(limit, 200), Math.max(offset, 0)]
    );
    return r.rows;
  },

  // actualización parcial parametrizada (patch de columnas permitidas)
  async update(id, patch = {}, client = db) {
    const cols = {
      publication_status: patch.status, visibility: patch.visibility, evaluation_id: patch.evaluationId,
      reviewed_by: patch.reviewedBy, reviewed_at: patch.reviewedAt, published_at: patch.publishedAt,
      unpublished_at: patch.unpublishedAt, expires_at: patch.expiresAt, publication_reason: patch.publicationReason,
      unpublication_reason: patch.unpublicationReason, public_payload: patch.publicPayload != null ? jsonOr(patch.publicPayload) : undefined,
      published_mapping_version: patch.publishedMappingVersion, published_rules_fingerprint: patch.publishedRulesFingerprint,
      risk_disclosure_version: patch.riskDisclosureVersion,
    };
    const set = [], params = [];
    for (const [k, v] of Object.entries(cols)) { if (v !== undefined) { params.push(v); set.push(`${k} = $${params.length}`); } }
    if (!set.length) return await module.exports.findById(id);
    params.push(id);
    const r = await client.query(`UPDATE arb_publications SET ${set.join(', ')} WHERE id = $${params.length} RETURNING *`, params);
    return r.rows[0] || null;
  },

  async counts() {
    const r = await db.query(`SELECT
      (SELECT count(*)::int FROM arb_publications) AS total,
      (SELECT count(*)::int FROM arb_publications WHERE publication_status='published') AS published,
      (SELECT count(*)::int FROM arb_publications WHERE publication_status='draft') AS draft,
      (SELECT count(*)::int FROM arb_publications WHERE publication_status='approved') AS approved,
      (SELECT count(*)::int FROM arb_publications WHERE publication_status='paused') AS paused,
      (SELECT count(*)::int FROM arb_publications WHERE publication_status='expired') AS expired,
      (SELECT count(*)::int FROM arb_publications WHERE publication_status='withdrawn') AS withdrawn`);
    return r.rows[0];
  },
};

function uuidOrNull(v) { return /^[0-9a-f-]{36}$/i.test(String(v || '')) ? v : null; }
