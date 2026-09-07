# Preregistro — sombra de dardos (congelado el 6-sep-2026, antes de la primera tesis)

Blueprint 8.0 §24: una familia es mecanismo × mercado × universo × timing × política de ejecución, y su
evaluación se fija ANTES de acumular muestra. Esto es lo que queda congelado; cambiarlo a mitad destruye la muestra.

## Universo
- Partidos de la agenda oficial de la PDC (API pública) en torneos no secundarios (fuera Q-School, Challenge,
  Development, Women's Series, juveniles, MODUS). Formato certificado por el stage oficial de la ronda; los
  formatos de plantilla NO producen tesis (puerta `format`).
- Prematch únicamente: la tesis nace con el partido en estado `Fixture`, ≥ 0 h y ≤ 6 días antes del inicio.

## Modelo (market-blind por construcción)
- Habilidad por jugador: media de tres dardos, 180s por visita y % de dobles de Darts Orakel (365 d arrastrado
  hacia 90 d por exposición); kernel de visita calibrado a esos tres; carrera del leg exacta; compilador de
  legs/sets con saque alterno. Ganador = mezcla en logit de Elo cronológico (resultados PDC 2023→) y compilador,
  con `ensembleU` de `data/darts/model-priors.json` (fijado en desarrollo, holdout 2026 leído una vez).
- Ninguna cuota entra a ninguna probabilidad.

## Familias y puertas (idénticas para todas)
`edge ≥ 3 pp` · `edge > incertidumbre` (exposición de los dos + desacuerdo Elo/compilador, tope 12 pp) ·
`push < 8 %` · formato certificado · ninguno de los dos "frío" (exposición < 1.500 dardos en 365 d).
- **ML** — referencia (benchmark), jamás pick.
- **LEGS_TOTAL / LEGS_HCP** (y SETS_* en formatos de sets) — sombra; liquidan con el resultado oficial.
- **X180_TOTAL / X180_MOST / X180_PLAYER** — sombra; liquidan con la estadística de partido (hoy solo Players
  Championship); fuera de ahí quedan `unsettleable` y VOID a los 12 días con motivo. No cuentan en la muestra.
- **HIGHEST_CHECKOUT / CORRECT_SCORE** — solo display.
- Mejor cuota entre Pinnacle, Bovada y Cloudbet (Polymarket excluido: intervalo, no precio). Stake ¼ Kelly, tope 2 %.

## Vara y muestra
- Endpoint primario: **CLV medio contra el cierre de la misma línea** (mejor cuota al cierre; y contra Pinnacle
  cuando la cotizó), por EVENTO (varias tesis del mismo partido pesan una unidad). ROI se anota, no decide.
- Mínimo para leer: 60 eventos liquidados por familia y dos ediciones/torneos distintos. Una lectura por versión.
- Kill inmediato (no estadístico): formato mal certificado, identidad ambigua, transición imposible, liquidación
  discrepante con el resultado oficial.

## Lo que NO se hace hasta medir
- Abrir `first leg`/hándicap corto donde el bull-off es información que el mercado puede tener y el modelo no.
- Meter prensa, carga o "presión" en la probabilidad: display, nunca modelo.
- Abrir el deporte al público o cobrar por él (derechos: `data/darts/RIGHTS.md`).
