// tests/alerts-db.test.js — Sprint 8A. Alertas + preferencias + onboarding contra PostgreSQL real.
// Generación idempotente (dedup), delivery in-app, read, preferencias get/update + validación, onboarding,
// aislamiento por usuario, LEAN/no-publicada no generan pick.
'use strict';
process.env.DB_SSL = process.env.DB_SSL || 'false';
process.env.USER_ALERTS_ENABLED = 'true';
process.env.USER_ALERTS_GENERATION_ENABLED = 'true';
process.env.USER_ALERTS_DELIVERY_ENABLED = 'true';
process.env.USER_ALERTS_IN_APP_ENABLED = 'true';
process.env.USER_PREFERENCES_ENABLED = 'true';
process.env.ONBOARDING_V2_ENABLED = 'true';

const path = require('path');
const R = path.join(__dirname, '..');
const { boot } = require('./_pg-harness');
let pass = 0, fail = 0;
const ok = (n, c, e = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n} ${e}`); } };

(async () => {
  const h = await boot();
  const db = require(R + '/database/client');
  const migrate = require(R + '/database/migrate');
  const alerts = require(R + '/alerts');
  const prefs = require(R + '/user-preferences');

  try {
    await migrate.up();
    const t = await db.query(`SELECT to_regclass('user_alerts') a, to_regclass('user_preferences') b, to_regclass('user_onboarding_state') c, to_regclass('alert_delivery_attempts') d`);
    ok('migración 018: 4 tablas', t.rows[0].a && t.rows[0].b && t.rows[0].c && t.rows[0].d);

    // ---- preferencias ----
    const u1 = await prefs.update('userA', { timezone: 'Europe/Madrid', preferred_odds_format: 'american', teams: ['ARG', 'BRA'], alert_preferences: { channels: { in_app: true, email: false }, types: ['new_pick_gp'] } });
    ok('prefs: update válido persiste', u1.ok && u1.value.timezone === 'Europe/Madrid' && u1.value.preferred_odds_format === 'american');
    ok('prefs: update inválido rechazado', (await prefs.update('userA', { timezone: 'X/Y' })).ok === false);
    const gotB = await prefs.get('userB');
    ok('prefs: usuario sin prefs → defaults (aislamiento)', gotB.source === 'defaults' && gotB.timezone === 'UTC');

    // ---- onboarding ----
    ok('onboarding: inicial not_started', (await prefs.getOnboarding('userA')).status === 'not_started');
    await prefs.updateOnboarding('userA', { action: 'start' });
    await prefs.updateOnboarding('userA', { action: 'advance', step: 3 });
    const ob = await prefs.getOnboarding('userA');
    ok('onboarding: start+advance', ob.status === 'started' && ob.current_step === 3);
    await prefs.updateOnboarding('userA', { action: 'complete' });
    ok('onboarding: complete', (await prefs.getOnboarding('userA')).status === 'completed');
    ok('onboarding: acción inválida rechazada', (await prefs.updateOnboarding('userA', { action: 'fly' })).ok === false);

    // ---- alertas: generación idempotente ----
    const recipients = [{ userRef: 'userA', prefs: { types: ['new_pick_gp'], alert_preferences: { channels: { in_app: true } } } }];
    const ev = { type: 'new_pick_gp', published: true, classification: 'strong', entityType: 'pick', entityId: 'pk1', materialStateVersion: 'pk1', title: 'PICK GP — STRONG', body: 'Argentina', metadata: {} };
    const g1 = await alerts.generate(ev, recipients);
    const g2 = await alerts.generate(ev, recipients); // misma observación → no duplica
    ok('alertas: primera generación crea 1', g1.created === 1);
    ok('alertas: dedup evita duplicado', g2.created === 0);
    const list = await alerts.repo.listForUser('userA');
    ok('alertas: aparece en el inbox del usuario', list.length === 1 && list[0].alert_type === 'new_pick_gp');
    const da = await db.query(`SELECT channel, status FROM alert_delivery_attempts WHERE alert_id=$1`, [list[0].id]);
    ok('alertas: delivery in-app registrado', da.rows.some(r => r.channel === 'in_app' && r.status === 'delivered'));

    // cambio material (price_moved) → nueva alerta
    const moved = { ...ev, type: 'pick_price_moved', materialStateVersion: 'moved', title: 'Cuota movida' };
    const g3 = await alerts.generate(moved, [{ userRef: 'userA', prefs: { types: ['new_pick_gp', 'pick_price_moved'] } }]);
    ok('alertas: cambio material genera nueva', g3.created === 1);

    // read / unread
    ok('alertas: unread count', await alerts.repo.unreadCount('userA') === 2);
    await alerts.repo.markRead('userA', list[0].id);
    ok('alertas: markRead baja el unread', await alerts.repo.unreadCount('userA') === 1);

    // LEAN / no publicada NO generan pick
    const lean = await alerts.generate({ type: 'new_pick_gp', published: true, classification: 'lean', entityId: 'pk2', materialStateVersion: 'pk2', title: 'x' }, [{ userRef: 'userA', prefs: {} }]);
    ok('alertas: LEAN no genera pick', lean.created === 0);
    const unpub = await alerts.generate({ type: 'new_pick_gp', published: false, classification: 'strong', entityId: 'pk3', materialStateVersion: 'pk3', title: 'x' }, [{ userRef: 'userA', prefs: {} }]);
    ok('alertas: pick no publicada no genera', unpub.created === 0);

    // aislamiento: userB no ve alertas de userA
    ok('alertas: aislamiento por usuario', (await alerts.repo.listForUser('userB')).length === 0);
  } catch (e) { fail++; console.log('  ✗ excepción', e && e.stack || e); }
  finally { try { await db.close(); } catch {} await h.stop(); }
  console.log(`\nalerts-db: ${pass} ✓  ${fail} ✗`);
  process.exit(fail ? 1 : 0);
})();
