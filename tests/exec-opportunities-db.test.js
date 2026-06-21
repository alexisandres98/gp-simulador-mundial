// tests/exec-opportunities-db.test.js — Sprint 4. Ciclo de vida de publicación contra PostgreSQL real.
// Arranca embedded-postgres (o usa DATABASE_URL externo). Verifica: draft→approve→publish→revalidate→
// pause→withdraw, auditoría completa, snapshot congelado, NO auto-publicación, NO revivir terminales.

'use strict';
// IMPORTANTE: env ANTES de requerir cualquier módulo que lea config en carga.
process.env.DB_SSL = process.env.DB_SSL || 'false';
process.env.ARB_ENGINE_ENABLED = 'true';
process.env.ARB_ENGINE_WRITE_ENABLED = 'true';
process.env.EXEC_OPPORTUNITIES_UI_ENABLED = 'true';
process.env.EXEC_OPPORTUNITIES_ADMIN_PREVIEW_ENABLED = 'true';
process.env.EXEC_OPPORTUNITIES_MANUAL_PUBLICATION_ENABLED = 'true';
process.env.EXEC_OPPORTUNITIES_PUBLIC_ENABLED = 'true';
process.env.EXEC_OPPORTUNITIES_CALCULATOR_ENABLED = 'true';
process.env.EXEC_OPPORTUNITIES_DEEP_LINKS_ENABLED = 'true';
process.env.EXEC_OPPORTUNITIES_GEO_FILTER_ENABLED = 'true';

const path = require('path');
const R = path.join(__dirname, '..');
const { boot } = require('./_pg-harness');

let pass = 0, fail = 0;
const ok = (n, c, e = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n} ${e}`); } };

(async () => {
  const h = await boot();
  const client = require(R + '/database/client');
  const migrate = require(R + '/database/migrate');
  const dbRepos = require(R + '/database/repositories');
  const engine = require(R + '/arb-engine');
  const { build } = require(R + '/exec-opportunities/fixtures/golden-ui');
  const svc = require(R + '/exec-opportunities/publicationService');
  const idx = require(R + '/exec-opportunities');
  const cfg = require(R + '/exec-opportunities/config');

  try {
    await migrate.up();
    ok('migración 012 aplicada (arb_publications existe)', (await client.query("SELECT to_regclass('public.arb_publications') t")).rows[0].t != null);
    ok('tabla de auditoría existe', (await client.query("SELECT to_regclass('public.arb_publication_history') t")).rows[0].t != null);
    ok('tabla jurisdicción existe', (await client.query("SELECT to_regclass('public.provider_jurisdiction_rules') t")).rows[0].t != null);

    await dbRepos.providers.upsertByCode({ code: 'polymarket', name: 'Polymarket' });
    await dbRepos.providers.upsertByCode({ code: 'kalshi', name: 'Kalshi' });

    // 1) Persistir una oportunidad+evaluación REAL con el motor (para referencias FK).
    const cases = build();
    const pure = cases.find(c => c.id === 'UI_pure_deep');
    const run = await engine.runShadow({ candidates: [pure.candidate], now: pure.context.now });
    ok('motor persistió pure_arb', run.counts.pure_arb === 1 && run.persisted && run.persisted.written === 1, JSON.stringify(run.counts));
    const oppRow = (await client.query('SELECT * FROM arb_opportunities ORDER BY created_at DESC LIMIT 1')).rows[0];
    const evalRow = (await client.query('SELECT * FROM arb_evaluations ORDER BY created_at DESC LIMIT 1')).rows[0];
    ok('opportunity + evaluation en DB', !!oppRow && !!evalRow);

    const evView = pure.ev;
    const context = { ...pure.context, evaluationId: evalRow.id };

    console.log('\nCiclo de vida');
    // INVARIANTE: la capa bloquea siempre la auto-publicación.
    ok('INVARIANTE auto-publicación bloqueada', cfg.flags.autoPublicationBlocked === true);

    // createDraft
    const draft = await svc.createDraft({ opportunityId: oppRow.id, opportunityKey: oppRow.opportunity_key, evaluationId: evalRow.id, evaluationView: evView, context, actorId: 'admin@gp', visibility: 'public' });
    ok('createDraft → status draft', draft.publication_status === 'draft' && !!draft.public_id);
    ok('draft NO está publicado (no auto-publish)', draft.published_at == null);
    ok('public_payload congelado sin snapshot ids', !/snapshotId|input_hash/.test(JSON.stringify(draft.public_payload)));

    // listPublic no debe mostrar un draft
    const pub0 = await idx.listPublicOpportunities({});
    ok('listado público NO incluye draft', pub0.items.every(x => x.public_id !== draft.public_id));

    // approve
    const appr = await svc.approve(draft.id, { actorId: 'admin@gp', evaluationView: evView, context });
    ok('approve → status approved', appr.publication_status === 'approved' && appr.reviewed_by === 'admin@gp');

    // publish
    const published = await svc.publish(draft.id, { actorId: 'admin@gp', evaluationView: evView, context, visibility: 'public', ttlMs: 60000 });
    ok('publish → status published + expires_at', published.publication_status === 'published' && published.published_at && published.expires_at);

    // listado público ahora SÍ lo muestra
    const pub1 = await idx.listPublicOpportunities({ country: 'MX' });
    ok('listado público incluye la publicada', pub1.items.some(x => x.public_id === draft.public_id));
    const detail = await idx.getPublicOpportunity(draft.public_id, { country: 'US' });
    ok('detalle público redacta + overlay jurisdicción (US restringido)', detail.payload && detail.payload.jurisdiction_status === 'restricted');

    // auditoría
    const hist = await svc.history.listForPublication(draft.id);
    ok('historial auditado (create+approve+publish ≥3)', hist.length >= 3 && hist.some(h => h.action === 'publish'));

    console.log('\nRevalidación / expiración');
    // revalidación con drift de reglas → expira (auto, auditado)
    const rev = await svc.revalidatePublication(draft.id, { evaluationView: evView, context: { ...context, currentRulesFingerprint: 'fp2', opportunityStatus: 'active', lastValidatedAt: new Date(context.now).toISOString() } });
    ok('revalidación con drift → expired', rev.publication.publication_status === 'expired');
    ok('expiración auditada', (await svc.history.listForPublication(draft.id)).some(h => h.action === 'expire'));
    const pub2 = await idx.listPublicOpportunities({});
    ok('listado público ya NO la incluye (expirada)', pub2.items.every(x => x.public_id !== draft.public_id));

    console.log('\nEstados terminales no reviven');
    // segunda publicación para probar pause/withdraw
    const d2 = await svc.createDraft({ opportunityKey: 'opp-key-2', evaluationView: evView, context, actorId: 'admin@gp', visibility: 'public' });
    await svc.approve(d2.id, { actorId: 'admin@gp', evaluationView: evView, context });
    await svc.publish(d2.id, { actorId: 'admin@gp', evaluationView: evView, context, ttlMs: 60000 });
    const paused = await svc.pause(d2.id, { actorId: 'admin@gp', reason: 'manual' });
    ok('pause → paused', paused.publication_status === 'paused');
    const wd = await svc.withdraw(d2.id, { actorId: 'admin@gp', reason: 'cleanup' });
    ok('withdraw → withdrawn (terminal)', wd.publication_status === 'withdrawn');
    // revalidar una retirada NO la revive
    const revWd = await svc.revalidatePublication(d2.id, { evaluationView: evView, context });
    ok('revalidar withdrawn NO revive', revWd.publication.publication_status === 'withdrawn' && revWd.decision.visible === false);
    // publish sobre withdrawn debe fallar (transición inválida)
    let threw = false; try { await svc.publish(d2.id, { actorId: 'x', evaluationView: evView, context }); } catch (e) { threw = /invalid_transition/.test(e.code || e.message); }
    ok('no se puede publicar una retirada (transición inválida)', threw);

    console.log('\nGuards de flag');
    const counts = await svc.repo.counts();
    ok('counts refleja estados', counts.total >= 2 && counts.expired >= 1 && counts.withdrawn >= 1);

    await client.close();
    console.log(`\n${fail === 0 ? '✅' : '❌'} Exec-Opportunities DB: ${pass} pasaron, ${fail} fallaron`);
    await h.stop();
    process.exit(fail === 0 ? 0 : 1);
  } catch (e) {
    console.error('\n❌ ERROR:', e.message); console.error(e.stack);
    try { await client.close(); } catch {}
    try { await h.stop(); } catch {}
    process.exit(1);
  }
})();
