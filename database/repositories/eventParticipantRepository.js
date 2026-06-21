// eventParticipantRepository.js — canonical_event_participants (Sprint 0.1). SQL parametrizado.
'use strict';
const db = require('../client');

module.exports = {
  // insert({ canonicalEventId, participantName, role, participantType?, participantCode?, externalReference?, displayOrder?, metadata? }) → row
  async insert(p) {
    const r = await db.query(
      `INSERT INTO canonical_event_participants
         (canonical_event_id, participant_type, participant_name, participant_code, role, external_reference, display_order, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,0),COALESCE($8,'{}'::jsonb)) RETURNING *`,
      [p.canonicalEventId, p.participantType || null, p.participantName, p.participantCode || null, p.role,
       p.externalReference || null, p.displayOrder ?? null, p.metadata ? JSON.stringify(p.metadata) : null]
    );
    return r.rows[0];
  },
  async findById(id) {
    const r = await db.query('SELECT * FROM canonical_event_participants WHERE id = $1', [id]);
    return r.rows[0] || null;
  },
  // byEvent(canonicalEventId) → row[]
  async byEvent(canonicalEventId) {
    const r = await db.query('SELECT * FROM canonical_event_participants WHERE canonical_event_id = $1 ORDER BY display_order, role', [canonicalEventId]);
    return r.rows;
  },
};
