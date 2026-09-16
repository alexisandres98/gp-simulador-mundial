// tests/ausencia.test.js — LA PRUEBA DE QUE LA AUSENCIA DE DATO SE VE (16-sep-2026)
//
// Lo que se fija aquí no son umbrales: es que el módulo sepa distinguir los tres casos que importan y que
// NO se tranquilice solo. Un módulo que existe para detectar muestras seleccionadas es inútil si la suya
// puede estar seleccionada en silencio — que es exactamente lo que pasó la primera vez que se corrió, con
// cuatro motores devolviendo "0 sin resultado de 0" porque el accesor leía `result_code` y ellos escriben
// `result`.
'use strict';
const AU = require('../lib/ausencia');

let fallos = 0;
const t = (nombre, ok, extra = '') => { if (!ok) fallos++; console.log(`${ok ? 'ok  ' : 'FALLA'}  ${nombre}${extra ? ' — ' + extra : ''}`); };

// Un libro de n eventos con dos tickets cada uno. `sesga` decide si las que desaparecen son especiales.
function libro({ nEventos = 200, ausentes = 40, sesga = false, campo = 'result_code' } = {}) {
  const out = [];
  for (let i = 0; i < nEventos; i++) {
    const falta = i < ausentes;
    // jitter determinista, sin Math.random: la misma semilla en cualquier máquina
    const j = ((i * 7919) % 101) / 500;                       // 0 .. 0,2
    // con `sesga`, las ausentes llevan cuota sistemáticamente más corta y p_gp más alta
    const odds = +(1.90 + j + (sesga && falta ? -0.35 : 0)).toFixed(3);
    const pgp = +(0.52 + j / 4 + (sesga && falta ? 0.09 : 0)).toFixed(4);
    for (let k = 0; k < 2; k++) {
      const p = { event_id: 'ev' + i, odds, p_gp: pgp, family: 'F', book: 'casa', competition: 'liga',
        start_at: new Date(Date.UTC(2026, 7, 1 + (i % 28), 12)).toISOString() };
      if (falta) { p.status = 'RESULT_PENDING'; p[campo] = 'DATA_UNRESOLVED'; }
      else { p.status = 'SETTLED'; p[campo] = (i + k) % 2 ? 'WIN' : 'LOSS'; }
      out.push(p);
    }
  }
  return out;
}

// ── 1. UNA AUSENCIA INOCENTE NO SE DECLARA CULPABLE ─────────────────────────────────────────────────────
const plana = AU.examinaLibro(libro({ sesga: false }));
t('con ausencia no relacionada, el veredicto es ignorable', plana.veredicto === 'ignorable_en_lo_observable',
  plana.veredicto + ' · ' + String(plana.razon).slice(0, 120));
t('y el placebo no pasa BH', !(plana.contrastes.find((x) => x.placebo) || {}).significativa_bh);
t('y la razón deja claro que NO es prueba de inocencia', /no es prueba de que la ausencia sea inocente/i.test(plana.razon));

// ── 2. UNA AUSENCIA ALINEADA CON EL RESULTADO SÍ ────────────────────────────────────────────────────────
const sesgada = AU.examinaLibro(libro({ sesga: true }));
t('con ausencia sesgada, el veredicto es seleccionada', sesgada.veredicto === 'seleccionada', sesgada.veredicto);
t('y el placebo es lo que lo delata', /probabilidad del propio modelo/i.test(sesgada.razon), String(sesgada.razon).slice(0, 140));
const pl = sesgada.contrastes.find((x) => x.placebo);
t('y el placebo pasa BH con su t y su p', !!(pl && pl.significativa_bh && Number.isFinite(pl.t) && Number.isFinite(pl.p)),
  pl ? `t ${pl.t} p ${pl.p}` : 'sin placebo');

// ── 3. EL CERO QUE EN REALIDAD ERA «NO MIRÉ» ────────────────────────────────────────────────────────────
// Éste es el test que existe por un fallo real: cuatro motores informaron de un libro vacío porque escriben
// el veredicto en `result` y el accesor solo leía `result_code`.
const conResult = AU.examinaLibro(libro({ campo: 'result', ausentes: 0 }));
t('un libro que escribe el veredicto en `result` también se lee', conResult.n_total === 400,
  `n_total ${conResult.n_total}`);
t('y se declara sin ausencias, no vacío', conResult.veredicto === 'sin_ausencias', conResult.veredicto);

const ilegible = AU.examinaLibro([{ foo: 1 }, { foo: 2 }, { foo: 3 }]);
t('un libro con filas pero ninguna vencida NO se declara sin ausencias', ilegible.veredicto === 'libro_no_legible',
  ilegible.veredicto);
t('y lo dice con esas palabras', /ninguna se reconoce como vencida/i.test(ilegible.razon));
t('un libro de verdad vacío se distingue del ilegible', AU.examinaLibro([]).veredicto === 'libro_vacio');

// ── 4. MUESTRA CORTA: NO SE INVENTA UN VEREDICTO ────────────────────────────────────────────────────────
const corta = AU.examinaLibro(libro({ nEventos: 200, ausentes: 5 }));
t('con 10 ausentes no se contrasta nada', corta.veredicto === 'insuficiente', corta.veredicto);
t('y dice cuántas harían falta', /hacen falta \d+/.test(corta.razon), corta.razon);

// ── 5. LA COMPOSICIÓN TAMBIÉN CUENTA, AUNQUE NADA SE MUEVA ──────────────────────────────────────────────
// Mismas covariables en las dos mitades, pero TODAS las ausencias salen de un torneo que no aparece entre
// las observadas. Ninguna media difiere y aun así el libro visible es otro producto.
const porComposicion = libro({ sesga: false }).map((p, i) => ({ ...p,
  competition: p.status === 'SETTLED' ? 'liga-a' : 'torneo-fantasma' }));
const comp = AU.examinaLibro(porComposicion);
t('si toda la ausencia sale de un torneo ausente del resto, se marca por composición',
  comp.veredicto === 'seleccionada_por_composicion', comp.veredicto + ' · ' + String(comp.razon).slice(0, 110));

// ── 6. EL MÓDULO NO ABRE NINGUNA PUERTA, Y LO DICE ──────────────────────────────────────────────────────
t('el veredicto lleva escrito que es evidencia y no permiso',
  /evidencia, no permiso/i.test(String(plana.no_abre_puerta || '')) && /G0 sigue mandando/i.test(String(plana.no_abre_puerta || '')),
  String(plana.no_abre_puerta || '').slice(0, 90));

// ── 8. LA CONCENTRACIÓN NO SE DECLARA EN UN LIBRO DE UNA SOLA CATEGORÍA ─────────────────────────────────
// Salió de un falso positivo de este mismo test: con una sola familia en el libro, el 100 % de las
// ausencias sale de ella por definición y eso no es concentración, es aritmética.
const unaSola = AU.examinaLibro(libro({ sesga: false }));
const fam = unaSola.composicion.find((x) => x.clave === 'family');
t('con una sola familia, la cuota dominante es 1 pero el exceso es 0',
  fam && fam.dominante_cuota === 1 && Math.abs(fam.dominante_exceso) < 1e-9,
  fam ? `cuota ${fam.dominante_cuota} exceso ${fam.dominante_exceso}` : 'sin composición de familia');

// ── 7. REPRODUCIBLE ─────────────────────────────────────────────────────────────────────────────────────
const a = AU.examinaLibro(libro({ sesga: true })), b = AU.examinaLibro(libro({ sesga: true }));
t('dos corridas del mismo libro dan el mismo t', JSON.stringify(a.contrastes.map((x) => x.t)) === JSON.stringify(b.contrastes.map((x) => x.t)));

console.log(fallos ? `\n${fallos} FALLOS` : '\nTodo correcto');
process.exit(fallos ? 1 : 0);
