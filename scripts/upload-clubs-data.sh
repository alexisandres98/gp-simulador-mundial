#!/bin/bash
# upload-clubs-data.sh — sube los datos GRANDES de clubes (player-history/results/fotos/af-map) al disco
# persistente de Render (/data/clubs/) vía /api/internal/clubs-data. Correr DESPUÉS de cualquier backfill
# (los JSONs están gitignored → no llegan por deploy; este script los publica a prod).
# Uso: GP_EXPORT_KEY=... ./scripts/upload-clubs-data.sh   (o pasar la key como $1)
set -e
KEY="${GP_EXPORT_KEY:-$1}"
BASE="${GP_BASE:-https://gpsimulador.com}"
DIR="$(cd "$(dirname "$0")/.." && pwd)/data/clubs"
if [ -z "$KEY" ]; then echo "falta GP_EXPORT_KEY"; exit 1; fi
n=0
for f in "$DIR"/player-history-*.json "$DIR"/results-*.json "$DIR"/fotmob-*.json "$DIR"/props-history-*.json "$DIR"/player-photos.json "$DIR"/af-team-map.json; do
  [ -f "$f" ] || continue
  name=$(basename "$f")
  code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/internal/clubs-data?key=$KEY&name=$name" --data-binary "@$f" -H "Content-Type: application/json")
  echo "  $name → $code"
  [ "$code" = "200" ] && n=$((n+1))
done
echo "subidos: $n"
