# Preregistro — descanso diferencial → TOTAL WNBA (regla fija)

**Fecha de registro:** 2 de septiembre de 2026. **Empieza a contar:** el 17 de septiembre de 2026, cuando la WNBA
vuelve a jugar (comprobado en ESPN el 2-sep). Todo partido completado con `date ≥ 2026-09-17` entra en la
muestra; nada anterior cuenta, porque lo anterior es la ventana en la que se ENCONTRÓ la regla.

## De dónde sale (y por qué hay que dudar)

Backtest H4 (`docs/BACKTESTS_FAMILIAS_2026-09-02.md` §5.4): la correlación entre el descanso diferencial y el
residuo del total contra el cierre fue −0,24 en desarrollo y −0,16 en evaluación. La regla "over si el
visitante llega más descansado que el local" dio 13/18 en test (+37,9 % ± 20,7), **pero** el over ciego de esa
misma ventana acertó 56,2 %, y la permutación da p = 0,11 para un rasgo (0,3-0,5 con los ocho rasgos que se
probaron). En NBA no existe (corr −0,007, n = 879). Con esa evidencia la regla no se publica ni se cree: se
**registra** para ver si sobrevive fuera de la muestra donde nació.

## La regla, congelada

- **Descanso de un equipo** = días desde su partido anterior en el calendario ESPN, saturado a 7. Sin partido
  anterior en la ventana de datos → 3 (el valor por defecto que usó el backtest). Misma definición que H4.
- **`rest_diff = away_rest − home_rest`** (visitante menos local).
- **Dispara** cuando `rest_diff > 0,9` días. Dirección: **over** del total principal del partido.
- **Línea de referencia:** la de cierre de la pick de TOTAL del monitor para ese partido si existe
  (`close_line`); si no, la cuota guardada con el partido en el dataset ESPN (`odds[0].ou`, cierre o casi).
  Sin línea el partido cuenta como disparo pero no como resultado.
- **Dónde se ve:** cada pick de TOTAL del monitor lleva `home_rest_days`, `away_rest_days`, `rest_diff` y la
  etiqueta `prereg_rest_over`. El bloque `preregistro_descanso` de `GET /api/hoops/perf?league=wnba` devuelve
  `muestra` (desde el corte) e `historico` (ventana de desarrollo, solo para referencia).
- **Es una ETIQUETA, no una capa del modelo.** Ninguna probabilidad cambia por ella y el monitor no emite
  picks por ella. Si la regla sobrevive, la discusión de meterla al modelo empieza entonces, no antes.

## Muestra y vara

- **Tamaño:** los primeros **60 partidos completados** donde la regla habría disparado (WNBA solamente; en NBA
  no hay señal que registrar).
- **Vara principal:** porcentaje de overs contra la línea de referencia, con su error estándar binomial
  (≈ 6,5 pp con n = 60). **Éxito:** ≥ 56 % de overs (el over ciego de la ventana de desarrollo dio 56,2 %:
  hay que batir eso, no el 50 %) con el intervalo de un error estándar por encima de 52,4 % (break-even a
  −110). **Fracaso:** ≤ 52,4 % o un intervalo que cruce el 50 %.
- **Vara secundaria:** residuo medio `total real − línea` en los disparos (positivo = la regla ve algo que el
  cierre no).
- **Qué NO se hace:** ni mover el umbral 0,9, ni cambiar la definición de descanso, ni añadir rasgos, ni
  mirar la muestra a mitad para decidir nada. Si aparece un error de medición, se documenta y se reinicia.

## Resultado

_(pendiente: se rellena al llegar a 60 disparos)_
