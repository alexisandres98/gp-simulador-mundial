// lib/retiradas.js — LAS FAMILIAS RETIRADAS Y POR QUÉ (15-sep-2026, T1.9 de la auditoría externa).
//
// QUÉ ES RETIRAR. No es apagar. Una familia retirada deja de salir como PICK —deja de ser una afirmación
// de que ahí hay dinero— y sigue registrándose en sombra con su `rule_version` y la etiqueta `control`.
// La diferencia importa por dos motivos y los dos son de método:
//
//   1. Apagarla destruiría la única forma de saber si la decisión de retirarla fue correcta. Una puerta
//      cerrada no produce el dato que la justificaría; solo lo hace imposible. Es el mismo argumento por
//      el que el ganador de serie en esports se abrió en sombra en vez de quedarse cerrado por doctrina.
//   2. Las familias de control son las que fijan el SUELO DE RUIDO del método. Sin ellas no se sabe si un
//      error de calibración de 3 pp en una familia nueva es malo o es lo normal en esta casa.
//
// LA REGLA PARA ENTRAR AQUÍ es el veredicto de `lib/vara.js`: `cerrar` significa que el precio le gana al
// modelo con significancia estadística sobre racimos de evento, no que haya tenido una mala racha. Las diez
// que entran el 15-sep salen de `docs/METRICAS_RECALCULADAS_2026-09.md`, que es el recálculo del histórico
// completo con la vara nueva.
//
// LO QUE NO ENTRA AQUÍ. `no_invertible` no basta: significa que la ventaja no cubre lo que cobra la casa,
// que es una razón para no meter dinero pero no para dejar de publicar la lectura. Solo `cerrar`.
'use strict';

// Clave: deporte|familia|casa. La casa forma parte de la clave a propósito — CS2 hándicap de rondas pierde
// en Bovada y en Pinnacle pero no está cerrada en Cloudbet, y meterlas en el mismo saco fue exactamente el
// error que escondió la diferencia durante semanas.
const POR_VEREDICTO = [
  { deporte: 'cs2', familia: 'RONDAS', casa: 'bovada', ev: -5.52, t: -23.34, n: 190 },
  { deporte: 'cs2', familia: 'RONDAS_HANDICAP', casa: 'bovada', ev: -5.21, t: -14.56, n: 311 },
  { deporte: 'valorant', familia: 'RONDAS_HANDICAP', casa: 'pinnacle', ev: -5.07, t: -13.87, n: 150 },
  { deporte: 'cs2', familia: 'RONDAS', casa: 'pinnacle', ev: -4.43, t: -27.41, n: 309 },
  { deporte: 'dota2', familia: 'KILLS', casa: 'bovada', ev: -3.37, t: -20.71, n: 123 },
  { deporte: 'cs2', familia: 'RONDAS_HANDICAP', casa: 'pinnacle', ev: -3.28, t: -9.55, n: 412 },
  { deporte: 'lol', familia: 'KILLS', casa: 'bovada', ev: -2.84, t: -4.02, n: 147 },
  { deporte: 'lol', familia: 'KILLS_HANDICAP', casa: 'bovada', ev: -2.26, t: -10.35, n: 228 },
  { deporte: 'lol', familia: 'KILLS_HANDICAP', casa: 'cloudbet', ev: -1.37, t: -2.18, n: 153 },
];

// Y LAS VERSIONES DE REGLA RETIRADAS POR OTRO MOTIVO, cada una con el suyo escrito. Aquí no manda un t:
// manda que la regla está mal construida, que es una razón distinta y más fuerte.
const POR_CONSTRUCCION = {
  derivadas_v1: 'la versión 1 de las derivadas de fútbol valoraba la línea del consenso con el precio de otra casa (A01). Ese error infla la ventaja SIEMPRE en la misma dirección, así que su histórico no mide el modelo, mide el error. Se conserva como control y la lectura buena es `derivadas_v2`.',
  lol_kills_hcp_v1: 'veredicto `cerrar` con la vara nueva (EV −0,98 %, t −7,04). El hándicap de kills de LoL pierde contra el precio de forma medible en las dos casas donde se cotiza.',
  ufc_ganador_bruto: 'el ganador de combate se publicaba con la probabilidad bruta del modelo, sin descontar lo que cobra la casa ni medir el EV contra el cierre. Es el mercado donde GP midió −8,34 % de CLV. Sin EV contra cierre no hay veredicto posible, así que no puede salir como pick.',
  boleto_gp_ev_agregado: 'el Boleto GP combinaba las piernas multiplicando cuotas y probabilidades como si fueran independientes. No lo son —dos piernas del mismo partido se liquidan con el mismo resultado— así que el EV y el ¼ Kelly combinados están mal calculados por construcción. Las piernas se siguen enseñando; el EV y el Kelly combinados, no, hasta que haya probabilidad conjunta y precio real del producto (§6.5).',
};

const norm = (s) => String(s || '').toLowerCase().trim();

// ¿Está retirada esta familia en esta casa? Devuelve el motivo o null. Sin casa, retira solo si TODAS las
// casas registradas de esa familia lo están — una familia que pierde en una casa y no en otra no es una
// familia retirada, es una casa mala, y confundirlas tira picks buenas.
function retirada(deporte, familia, casa = null) {
  const dd = norm(deporte), ff = String(familia || '').toUpperCase();
  const dela = POR_VEREDICTO.filter((x) => norm(x.deporte) === dd && x.familia === ff);
  if (!dela.length) return null;
  if (casa == null) return null;
  const hit = dela.find((x) => norm(x.casa) === norm(casa));
  if (!hit) return null;
  return { motivo: 'veredicto_cerrar', etiqueta: 'control',
    lectura: `retirada el 15-sep-2026: EV ${hit.ev} % contra el cierre con t ${hit.t} sobre ${hit.n} tickets en ${hit.casa}. El precio le gana al modelo y no es mala racha. Se sigue registrando en sombra como control.`,
    ev: hit.ev, t: hit.t, n: hit.n };
}

function versionRetirada(version) {
  const v = String(version || '');
  return POR_CONSTRUCCION[v] ? { motivo: 'construccion', etiqueta: 'control', lectura: POR_CONSTRUCCION[v] } : null;
}

// El Boleto GP: las piernas se enseñan, el EV y el Kelly combinados no. Un interruptor para poder
// devolverlos el día que haya probabilidad conjunta.
const boletoMuestraEv = () => /^(1|true|on|yes)$/i.test(String(process.env.GP_BOLETO_EV || ''));

module.exports = { retirada, versionRetirada, boletoMuestraEv, POR_VEREDICTO, POR_CONSTRUCCION };
