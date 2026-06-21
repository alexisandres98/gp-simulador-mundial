// canonicalEventRepository.js — canonical_events (Sprint 2). SQL parametrizado.
'use strict';
const db = require('../client');

module.exports = {
  // insert({ eventType?, sport?, competition?, season?, homeParticipant?, awayParticipant?, scheduledStart?, venue?, status?, metadata? }) → row
  async insert(e) {
    const r = await db.query(
      `INSERT INTO canonical_events
         (event_type, sport, competition, season, home_participant, away_participant, scheduled_start, venue, status, metadata)
       VALUES (COALESCE($1,'match'),$2,$3,$4,$5,$6,$7,$8,COALESCE($9,'scheduled'),COALESCE($10,'{}'::jsonb)) RETURNING *`,
      [e.eventType || null, e.sport || null, e.competition || null, e.season || null, e.homeParticipant || null,
       e.awayParticipant || null, e.scheduledStart || null, e.venue || null, e.status || null, e.metadata ? JSON.stringify(e.metadata) : null]
    );
    return r.rows[0];
  },
  async findById(id) {
    const r = await db.query('SELECT * FROM canonical_events WHERE id = $1', [id]);
    return r.rows[0] || null;
  },
  // upcoming(limit) → row[]
  async upcoming(limit = 50) {
    const r = await db.query("SELECT * FROM canonical_events WHERE scheduled_start >= now() ORDER BY scheduled_start ASC LIMIT $1", [limit]);
    return r.rows;
  },
};
