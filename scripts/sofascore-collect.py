#!/usr/bin/env python3
# scripts/sofascore-collect.py — Collector LOCAL de Sofascore (plan B de event data, validado 10-jul-2026).
# Trae lo que FotMob no expone: POSICIONES MEDIAS por jugador, shotmap propio, graph de momentum y lineups
# con ratings. Requiere curl_cffi (impersonación TLS: el API devuelve 403 a curl plano, 200 impersonando
# Chrome). HERRAMIENTA LOCAL para análisis/contenido — el server de producción usa FotMob (node); esto no
# se cablea a Render. Ritmo educado (5s entre requests; para barridos grandes subir a 25-30s).
#
# Uso:
#   python3 scripts/sofascore-collect.py --search "france morocco"      # buscar event ids del Mundial
#   python3 scripts/sofascore-collect.py --event 12813016                # capturar un partido -> data/sofascore/
import argparse, json, os, sys, time

try:
    from curl_cffi import requests
except ImportError:
    sys.exit("falta curl_cffi: pip3 install --user curl_cffi")

BASE = "https://api.sofascore.com/api/v1"
OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "data", "sofascore")
PAUSE = 5

def get(path):
    time.sleep(PAUSE)
    r = requests.get(f"{BASE}/{path}", impersonate="chrome", timeout=15)
    if r.status_code != 200:
        print(f"  ✗ {path}: HTTP {r.status_code}")
        return None
    return r.json()

def search(q):
    d = get(f"search/all?q={q.replace(' ', '%20')}")
    if not d:
        return
    for x in d.get("results", []):
        if x.get("type") != "event":
            continue
        e = x["entity"]
        tour = e.get("tournament", {}).get("name", "")
        print(f"{e['id']}  {e['homeTeam']['name']} vs {e['awayTeam']['name']}  [{tour}]  ts={e.get('startTimestamp')}")

def collect(event_id):
    os.makedirs(OUT_DIR, exist_ok=True)
    out = {"event_id": event_id, "collected_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    meta = get(f"event/{event_id}")
    if meta and meta.get("event"):
        e = meta["event"]
        out["home"] = e["homeTeam"]["name"]; out["away"] = e["awayTeam"]["name"]
        out["tournament"] = e.get("tournament", {}).get("name")
        out["status"] = e.get("status", {}).get("type")
    for path, key in [("average-positions", "average_positions"), ("shotmap", "shotmap"),
                      ("graph", "momentum"), ("lineups", "lineups")]:
        d = get(f"event/{event_id}/{path}")
        if d:
            out[key] = d
            print(f"  ✓ {path}")
    fn = os.path.join(OUT_DIR, f"{event_id}.json")
    with open(fn, "w") as f:
        json.dump(out, f)
    print(f"guardado → {fn} ({os.path.getsize(fn)//1024}KB)")

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--search")
    ap.add_argument("--event", type=int)
    a = ap.parse_args()
    if a.search:
        search(a.search)
    elif a.event:
        collect(a.event)
    else:
        ap.print_help()
