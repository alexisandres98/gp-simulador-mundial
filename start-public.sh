#!/bin/bash
# Relanza el simulador + túnel público y muestra la URL para compartir.
cd "$(dirname "$0")"
pkill -f "node server.js" 2>/dev/null
pkill -f "cloudflared tunnel" 2>/dev/null
sleep 1
nohup node server.js > server.log 2>&1 &
sleep 3
nohup cloudflared tunnel --protocol http2 --url http://localhost:3000 > tunnel.log 2>&1 &
echo "Esperando URL pública de Cloudflare..."
for i in $(seq 1 20); do
  URL=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' tunnel.log | head -1)
  [ -n "$URL" ] && break
  sleep 1
done
if [ -n "$URL" ]; then
  echo ""
  echo "✅ Simulador publicado en: $URL"
  echo "   (la URL cambia en cada relanzamiento; la Mac debe quedarse encendida)"
  echo "   Para que no se duerma mientras compartes: caffeinate -s"
else
  echo "❌ No se obtuvo URL; revisa tunnel.log"
fi
