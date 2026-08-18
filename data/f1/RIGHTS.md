# Derechos de datos — Fórmula 1 (Fase 0 del blueprint 7.0)

> Los derechos son una feature del modelo (F-0056). Este archivo gobierna qué fuente alimenta qué capa.

## Registro de fuentes

### 1. Jolpica-F1 (api.jolpi.ca — sucesor comunitario de Ergast)
- **Qué da:** resultados de carrera y clasificación por temporada (parrilla, posición final, estado
  DNF/DSQ con motivo, puntos, vueltas), calendario, circuitos, pilotos y constructores, 1950→hoy,
  con la temporada 2026 al día (11 rondas cargadas al 18-ago).
- **Licencia:** datos bajo **CC BY 4.0** (atribución; uso comercial permitido con crédito).
- **Clase GP:** `attribution_ok` — la mejor clase de derechos de todos los deportes de la casa.
- **Regla:** atribución "Datos de Jolpica-F1 (CC BY 4.0)" donde se enseñe la base. Cosecha educada
  (paginación limit=100, pausas; su tasa pública es ~500 req/h).

### 2. The Odds API (`SPORTSBOOK_PROVIDER_API_KEY`)
- **Estado comprobado 18-ago-2026:** el plan de la casa NO expone claves de F1/motorsport.
- **Diseño:** el job de mercado consulta el descubrimiento de claves igualmente; si algún día el plan
  abre motorsport, la sombra se enciende sola. Hasta entonces el producto es un TERMINAL DE
  INTELIGENCIA sin lado mercado, y lo dice (F-0001: útil aunque no exista ninguna pick).

### 3. OpenF1 / FastF1 (telemetría y sesiones)
- **Clase:** `research_only` por doctrina del blueprint (F-0066/F-0067): OpenF1 es explícitamente
  personal/no comercial y el estatus open-source de FastF1 no otorga derechos comerciales del dato.
  NO entran a la v1. Si algún día entran, será en namespace de investigación separado (F-0059).

### 4. ESPN racing (agenda en vivo)
- **Clase:** `informal_public_endpoint`, solo agenda/estado del fin de semana, como en otros deportes.

## Reglas duras
1. Modelo market-blind por construcción: ninguna cuota entra a la probabilidad (F-0013).
2. F1 es **admin-only** (`GP_F1_PUBLIC_ENABLED` sin poner) hasta decisión de producto.
3. Sin fotos de pilotos, logos de equipos ni livery art: texto-first + identidad de COLOR de
   constructor (el color es un hecho, no un asset — F-0073).
4. Los crudos no se versionan; al repo entra la base compacta derivada + priors con lineage.
