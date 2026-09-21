// lib/feed.js — EL FEED PUBLICA PICKS EN TODOS LOS DEPORTES (21-sep-2026, orden de Alexis).
//
// LA ORDEN, LITERAL: "quiero que todas esas familias publiquen picks; al final los clientes pagan por ver
// picks, entonces quiero que cuando entren a un deporte se les generen picks, independientemente de si son
// rentables o no. A nivel de feed quiero que sigan publicando tanto dardos como cualquier otro que esté
// similar."
//
// QUÉ CAMBIA Y QUÉ NO. Este interruptor toca SOLO lo que se enseña. Hasta hoy había tres capas que dejaban
// un deporte sin picks aunque el motor las generara:
//   1. las familias RETIRADAS por veredicto (`lib/retiradas.js`): el precio le gana al modelo con
//      significancia, así que dejaban de salir como pick y quedaban en sombra como control;
//   2. el GANADOR como familia de referencia (dardos y tenis de mesa): se registraba para medir el modelo
//      pero "jamás pick";
//   3. los monitores privados: las picks de baloncesto eran solo-admin por ruta, y el ganador de combate se
//      escondía al público (`GP_COMBAT_FIGHT_MONITOR`).
// Con el interruptor puesto, las tres capas publican. Lo que NO cambia: la sombra sigue midiendo cada
// familia con su etiqueta (`control`, `benchmark`) intacta, la vara (`lib/vara.js`) sigue dando su
// veredicto, el ejecutor real no toma ni una apuesta distinta —su perímetro es cards_under_v1 en Cloudbet y
// no lee este módulo—, y las puertas de CALIDAD (ventaja mínima, ruido, ortogonalidad, precio rancio,
// calibración) siguen cerrando lo que no es una tesis. Publicar sin veredicto no es publicar sin criterio.
//
// LA ETIQUETA VIAJA CON LA PICK. Una pick que sale por este interruptor lleva `sin_veredicto: true` y, si
// es de familia retirada, su `retirada` con la lectura medida. Que el cliente vea la pick no obliga a
// esconderle que la casa no la respalda con evidencia. Y la regla del dinero del 13-sep no se mueve un
// milímetro: esto es el feed, no la caja.
//
// Por defecto ENCENDIDO (así lo ordenó Alexis y así queda aunque un deploy no lleve la env);
// `GP_FEED_SIN_VEREDICTO=0` lo apaga y todo vuelve a la doctrina del 15-sep.
'use strict';

const sinVeredicto = () => !/^(0|false|off|no)$/i.test(String(process.env.GP_FEED_SIN_VEREDICTO || '1').trim());

// Los textos que acompañan a lo que se publica por este interruptor: una sola fuente, para que la
// interfaz y los tableros digan lo mismo.
const NOTA = {
  es: 'Pick publicada sin veredicto de rentabilidad: la casa la enseña porque el motor la generó, no porque tenga evidencia medida de que gana. Estimación de un modelo estadístico, no consejo financiero.',
  en: 'Pick published without a profitability verdict: shown because the engine produced it, not because there is measured evidence that it wins. A statistical model estimate, not financial advice.',
};

module.exports = { sinVeredicto, NOTA };
