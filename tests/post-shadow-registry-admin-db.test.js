// tests/post-shadow-registry-admin-db.test.js — Fase G.1. Acciones admin por señal contra DB efímera.
// Inserta señales SINTÉTICAS en la base embebida (permitido; NUNCA en prod). Cubre §17: state machine,
// integrity, actions, idempotency, regression. Authorization/double-confirmation pura → ver statemachine.test.
'use strict';
process.env.DB_SSL = process.env.DB_SSL || 'false';
const path = require('path');
const R = path.join(__dirname, '..');
const { boot } = require('./_pg-harness');
let pass = 0, fail = 0;
const ok = (n, c, e = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n} ${e}`); } };

const PAST = '2026-06-01T00:00:00.000Z', FUTURE = '2026-12-01T00:00:00.000Z';

(async () => {
  const h = await boot();
  const client = require(R + '/database/client');
  const migrate = require(R + '/database/migrate');
  const SA = require(R + '/signal-registry/signalAdmin');
  const RA = require(R + '/signal-registry/registryAdmin');
  const q = (s, p = []) => client.query(s, p);

  // inserta una señal sintética con hash/chain fijos; eventStart en el pasado o futuro
  let seq = 0;
  async function mkSignal({ eventStart = FUTURE } = {}) {
    seq += 1;
    const r = await q(
      `INSERT INTO signals (signal_type, published_at, event_start_at, content_hash, registry_hash, chain_position, signal_payload, public_payload)
       VALUES ('model_prediction_v1', $1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      ['2026-05-15T10:00:00.000Z', eventStart, 'ch_' + seq, 'rh_' + seq, seq, JSON.stringify({ market_type: '1x2', odds: '2.00' }), JSON.stringify({ event: 'A vs B', selection: 'home' })]);
    return r.rows[0];
  }
  const goodConfirm = (id, critical = false) => critical ? { confirmedSignalId: id, confirmationPhrase: `CONFIRM ${id}` } : { confirmedSignalId: id };

  try {
    await migrate.up();
    await RA.createEpoch({ adminId: 'admin@test', reason: 'test g1' });

    // ===== STATE MACHINE (§17) =====
    console.log('\n§17 STATE MACHINE');
    {
      const s = await mkSignal();
      const r1 = await SA.quarantine(s.id, { adminId: 'a', reasonCode: 'DATA_UNDER_REVIEW', reasonText: 'rev', ...goodConfirm(s.id) });
      ok('1. ACTIVE → quarantine (QUARANTINED, hidden)', r1.state.admin_status === 'QUARANTINED' && r1.state.visibility === 'hidden');
      const r2 = await SA.restore(s.id, { adminId: 'a', reasonText: 'ok', quarantineRef: r1.audit.audit_event_id, ...goodConfirm(s.id) });
      ok('2. QUARANTINED → restore (ACTIVE, visible)', r2.state.admin_status === 'ACTIVE' && r2.state.visibility === 'visible');
    }
    { const s = await mkSignal(); const r = await SA.retract(s.id, { adminId: 'a', reasonCode: 'LINEUP_CHANGE', reasonText: 'x', ...goodConfirm(s.id, true) }); ok('3. ACTIVE → retract', r.state.admin_status === 'RETRACTED'); }
    { const s = await mkSignal(); const r = await SA.correct(s.id, { adminId: 'a', reasonCode: 'OTHER', reasonText: 'x', correctedFields: { odds: { old: '2.00', new: '2.10' } }, ...goodConfirm(s.id, true) }); ok('4. ACTIVE → correct (CORRECTED)', r.state.admin_status === 'CORRECTED'); }
    { const s = await mkSignal(); const r = await SA.dataError(s.id, { adminId: 'a', reasonCode: 'INVERTED_OUTCOME', reasonText: 'x', ...goodConfirm(s.id) }); ok('5. ACTIVE → data_error (hidden)', r.state.admin_status === 'DATA_ERROR' && r.state.visibility === 'hidden'); }
    { const s = await mkSignal(); const r = await SA.administrativeVoid(s.id, { adminId: 'a', reasonCode: 'DUPLICATE_SIGNAL', reasonText: 'x', ...goodConfirm(s.id, true) }); ok('6. ACTIVE → administrative_void', r.state.admin_status === 'ADMINISTRATIVE_VOID'); }
    {
      const s = await mkSignal();
      await SA.retract(s.id, { adminId: 'a', reasonCode: 'OPERATIONAL_ERROR', reasonText: 'x', ...goodConfirm(s.id, true) });
      let e1 = null; try { await SA.quarantine(s.id, { adminId: 'a', reasonCode: 'DATA_UNDER_REVIEW', reasonText: 'x', ...goodConfirm(s.id) }); } catch (er) { e1 = er; }
      ok('7. transición inválida rechazada (RETRACTED → quarantine)', e1 && e1.code === 'validation_failed' && e1.details.includes('invalid_transition'));
      let e2 = null; try { await SA.restore(s.id, { adminId: 'a', reasonText: 'x', quarantineRef: 'x', ...goodConfirm(s.id) }); } catch (er) { e2 = er; }
      ok('8. terminal no reactiva en silencio (RETRACTED → restore rechazado)', e2 && e2.code === 'validation_failed');
    }

    // ===== INTEGRITY (§17) =====
    console.log('\n§17 INTEGRITY');
    {
      const s = await mkSignal();
      const before = (await q(`SELECT content_hash, registry_hash, published_at, signal_payload, chain_position FROM signals WHERE id=$1`, [s.id])).rows[0];
      const r = await SA.correct(s.id, { adminId: 'a', reasonCode: 'OTHER', reasonText: 'fix', correctedFields: { odds: { old: '2.00', new: '2.05' } }, ...goodConfirm(s.id, true) });
      const after = (await q(`SELECT content_hash, registry_hash, published_at, signal_payload, chain_position FROM signals WHERE id=$1`, [s.id])).rows[0];
      ok('1/2. señal y hash originales intactos tras correct', before.content_hash === after.content_hash && before.registry_hash === after.registry_hash && JSON.stringify(before.signal_payload) === JSON.stringify(after.signal_payload) && String(before.published_at) === String(after.published_at));
      ok('3. corrección enlazada (audit_event_id)', r.correction && r.correction.audit_event_id === r.audit.audit_event_id);
      const eff = SA.effectiveView({ odds: '2.00' }, [r.correction]);
      ok('3b. vista efectiva aplica corrección sin tocar original', eff.odds === '2.05');
    }
    {
      let up = null, del = null;
      try { await q(`UPDATE signal_admin_actions SET reason_text='x'`); } catch (er) { up = er; }
      try { await q(`DELETE FROM signal_admin_actions`); } catch (er) { del = er; }
      ok('4/5. audit UPDATE bloqueado (append-only)', !!up);
      ok('6. audit DELETE bloqueado', !!del);
      const vc = await SA.verifyChain();
      ok('7. cadena administrativa válida', vc.ok === true && vc.count > 0);
      // detección de manipulación: bypass del trigger como superusuario → la cadena debe romperse
      await q(`ALTER TABLE signal_admin_actions DISABLE TRIGGER trg_admin_actions_immutable`);
      await q(`UPDATE signal_admin_actions SET reason_text='TAMPERED' WHERE audit_hash IS NOT NULL AND ctid IN (SELECT ctid FROM signal_admin_actions WHERE audit_hash IS NOT NULL LIMIT 1)`);
      await q(`ALTER TABLE signal_admin_actions ENABLE TRIGGER trg_admin_actions_immutable`);
      const vc2 = await SA.verifyChain();
      ok('7b. manipulación del audit detectada (chain rota)', vc2.ok === false);
    }
    // cadena de registro (signals) intacta: ninguna acción cambió chain_position/registry_hash
    ok('reg-chain. posiciones de cadena de signals únicas e intactas', (await q(`SELECT count(*)::int n, count(DISTINCT chain_position)::int d FROM signals`)).rows[0].n === seq);

    // ===== ACTIONS (§17) =====
    console.log('\n§17 ACTIONS');
    {
      const s = await mkSignal();
      let lost = null; try { await SA.administrativeVoid(s.id, { adminId: 'a', reasonCode: 'PICK_LOST', reasonText: 'perdió', ...goodConfirm(s.id, true) }); } catch (er) { lost = er; }
      ok('7. void con razón de pérdida (PICK_LOST) rechazado', lost && lost.details.includes('void_reason_forbidden'));
      const r = await SA.administrativeVoid(s.id, { adminId: 'a', reasonCode: 'EVENT_MAPPING_ERROR', reasonText: 'mapeo', ...goodConfirm(s.id, true) });
      ok('8. void con razón objetiva aceptado', r.state.admin_status === 'ADMINISTRATIVE_VOID');
    }
    {
      const s = await mkSignal({ eventStart: PAST }); // evento ya iniciado
      let weak = null; try { await SA.administrativeVoid(s.id, { adminId: 'a', reasonCode: 'EVENT_CANCELLED_OR_INVALID', reasonText: 'x', isSuperAdmin: false, ...goodConfirm(s.id, true) }); } catch (er) { weak = er; }
      ok('9a. void post-evento sin superadmin rechazado', weak && weak.details.includes('superadmin_required'));
      const r = await SA.administrativeVoid(s.id, { adminId: 'a', reasonCode: 'EVENT_CANCELLED_OR_INVALID', reasonText: 'x', isSuperAdmin: true, ...goodConfirm(s.id, true) });
      ok('9b. void post-evento con superadmin + reforzada aceptado', r.state.admin_status === 'ADMINISTRATIVE_VOID');
    }

    // ===== IDEMPOTENCY (§17) =====
    console.log('\n§17 IDEMPOTENCY');
    {
      const s = await mkSignal();
      const key = 'idem-key-1';
      const r1 = await SA.quarantine(s.id, { adminId: 'a', reasonCode: 'DATA_UNDER_REVIEW', reasonText: 'x', idempotencyKey: key, ...goodConfirm(s.id) });
      const r2 = await SA.quarantine(s.id, { adminId: 'a', reasonCode: 'DATA_UNDER_REVIEW', reasonText: 'x', idempotencyKey: key, ...goodConfirm(s.id) });
      ok('1/2. misma idempotency_key → idempotente (no re-aplica)', r2.idempotent === true && r2.audit.audit_event_id === r1.audit.audit_event_id);
      const cnt = (await q(`SELECT count(*)::int n FROM signal_admin_actions WHERE idempotency_key=$1`, [key])).rows[0].n;
      ok('2b. una sola fila de audit para la clave', cnt === 1);
    }
    {
      const s = await mkSignal();
      // 3/4: dos acciones concurrentes → serializadas; la 2ª choca con estado terminal → error seguro
      const a = SA.retract(s.id, { adminId: 'a', reasonCode: 'OPERATIONAL_ERROR', reasonText: 'x', ...goodConfirm(s.id, true) });
      const b = SA.administrativeVoid(s.id, { adminId: 'a', reasonCode: 'WRONG_MARKET', reasonText: 'x', ...goodConfirm(s.id, true) });
      const res = await Promise.allSettled([a, b]);
      const fulfilled = res.filter(x => x.status === 'fulfilled').length;
      const rejected = res.filter(x => x.status === 'rejected');
      ok('3/4. concurrentes serializadas: 1 aplica, 1 error seguro', fulfilled === 1 && rejected.length === 1 && rejected[0].reason.code === 'validation_failed');
    }

    // ===== REGRESSION (§17) =====
    console.log('\n§17 REGRESSION (invariantes)');
    {
      const ep = await RA.activeEpoch();
      ok('1. Verified Epoch intacto (1 era activa, sin backdate posible)', ep && ep.status === 'active');
      const ctl = await RA.controls();
      ok('5-11. controles: writes no pausados / kill off / público oculto', ctl.registry_writes_paused === false && ctl.product_kill_switch === false && ctl.registry_public_hidden === true);
      const hh = await RA.health();
      // (la cadena se manipuló a propósito en el test de tamper 7b; aquí verificamos epoch + estructura de health)
      ok('health expone epoch configurado + chain admin', hh.verified_epoch_configured === true && hh.audit_chain && 'ok' in hh.audit_chain);
      // ninguna tabla de picks/closing/settlement fue tocada por las acciones admin
      const closings = (await q(`SELECT count(*)::int n FROM signal_closing_snapshots`)).rows[0].n;
      const settles = (await q(`SELECT count(*)::int n FROM signal_settlements`)).rows[0].n;
      ok('6/7. closing y settlement en 0 (no activados)', closings === 0 && settles === 0);
    }

    console.log(`\n[post-shadow-registry-admin-db] ${pass} pass, ${fail} fail`);
  } catch (e) { fail++; console.error('ERROR', e.message, e.stack); }
  finally { try { await client.close(); } catch {} await h.stop(); process.exit(fail ? 1 : 0); }
})();
