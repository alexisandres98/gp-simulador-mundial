-- 044 — PROFUNDIDAD POR COTIZACIÓN (15-ago).
-- Hasta hoy guardábamos el PRECIO de cada casa pero no CUÁNTO entra a ese precio, así que el escáner
-- pasaba max_stake:null y una oportunidad de $50 se veía igual que una de $5.000. Sin esto no se puede
-- dimensionar una apuesta ni repartir capital entre venues: es el dato que convierte una señal en negocio.
--
-- max_stake = DINERO (USD) colocable a un precio no peor que GP_DEPTH_TOL_PCT respecto del mejor precio.
-- depth_src = de dónde salió, porque no todas las fuentes valen lo mismo y hay que poder distinguirlas:
--   cloudbet_max   → tope propio de la casa por selección (exacto)
--   kalshi_book    → tamaño en el mejor ask del libro (exacto, conservador: solo el primer nivel)
--   polymarket_book→ suma del libro CLOB dentro de la tolerancia (exacto)
--   myriad_amm     → APROXIMACIÓN sobre la liquidez del pool (no hay libro; ver comentario en myriadSweep)
ALTER TABLE sportsbook_goal_quote_current ADD COLUMN IF NOT EXISTS max_stake NUMERIC(14,2);
ALTER TABLE sportsbook_goal_quote_current ADD COLUMN IF NOT EXISTS depth_src TEXT;

-- +migrate down
ALTER TABLE sportsbook_goal_quote_current DROP COLUMN IF EXISTS max_stake;
ALTER TABLE sportsbook_goal_quote_current DROP COLUMN IF EXISTS depth_src;
