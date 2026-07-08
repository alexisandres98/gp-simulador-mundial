// scripts/fetch-book-logos.js — baja el LOGO OFICIAL de cada casa/exchange/prediction market (el app-icon
// real de cada marca, vía el servicio de favicons de Google a 128px) y lo guarda self-hosted en
// public/books/<brand>.png. Si una marca no tiene ícono decente (<48px o genérico), se conserva el tile
// monograma .svg como fallback (bookLogo() encadena png→svg). `node scripts/fetch-book-logos.js`
'use strict';
const fs = require('fs');
const path = require('path');

const DOMAINS = {
  pinnacle: 'pinnacle.com', bet365: 'bet365.com', williamhill: 'williamhill.com', betway: 'betway.com',
  betvictor: 'betvictor.com', betfred: 'betfred.com', boylesports: 'boylesports.com', unibet: 'unibet.com',
  betsson: 'betsson.com', nordicbet: 'nordicbet.com', betclic: 'betclic.fr', betanysports: 'betanysports.eu',
  betonline: 'betonline.ag', draftkings: 'draftkings.com', fanduel: 'fanduel.com', betmgm: 'betmgm.com',
  caesars: 'caesars.com', betrivers: 'betrivers.com', espnbet: 'espnbet.com', fanatics: 'betfanatics.com',
  ladbrokes: 'ladbrokes.com', coral: 'coral.co.uk', paddypower: 'paddypower.com', skybet: 'skybet.com',
  '888sport': '888sport.com', sportsbet: 'sportsbet.com.au', tab: 'tab.com.au', neds: 'neds.com.au',
  pointsbet: 'pointsbet.com.au', betfair: 'betfair.com', smarkets: 'smarkets.com', matchbook: 'matchbook.com',
  winamax: 'winamax.fr', tipico: 'tipico.de', leovegas: 'leovegas.com', casumo: 'casumo.com',
  onexbet: '1xbet.com', coolbet: 'coolbet.com', grosvenor: 'grosvenorcasinos.com', pmu: 'pmu.fr',
  marathonbet: 'marathonbet.com', mybookie: 'mybookie.ag', lowvig: 'lowvig.ag', bovada: 'bovada.lv',
  betus: 'betus.com.pa', gtbets: 'gtbets.eu', everygame: 'everygame.eu', suprabets: 'suprabets.com',
  ballybet: 'ballybet.com', betparx: 'betparx.com', hardrockbet: 'hardrock.bet', playup: 'playup.com',
  tenbet: '10bet.com',
  polymarket: 'polymarket.com', kalshi: 'kalshi.com', myriad: 'myriadprotocol.com', novig: 'novig.com',
  prophetx: 'prophetx.co',
};

const dir = path.join(__dirname, '..', 'public', 'books');
fs.mkdirSync(dir, { recursive: true });

function pngSize(buf) {
  // PNG: ancho/alto en el chunk IHDR (bytes 16-23)
  if (buf.length < 24 || buf[0] !== 0x89 || buf[1] !== 0x50) return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

(async () => {
  let ok = 0, skip = 0;
  for (const brand of Object.keys(DOMAINS)) {
    const url = `https://www.google.com/s2/favicons?domain=${DOMAINS[brand]}&sz=128`;
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const buf = Buffer.from(await r.arrayBuffer());
      const sz = pngSize(buf);
      // calidad mínima: ícono real ≥48px (los 16px pixelados o el globo genérico no sirven de logo)
      if (!sz || sz.w < 48 || buf.length < 600) { console.log('  skip', brand, sz ? sz.w + 'px' : 'no-png', buf.length + 'B → queda el tile'); skip++; continue; }
      fs.writeFileSync(path.join(dir, brand + '.png'), buf);
      console.log('  ok  ', brand, sz.w + 'px', Math.round(buf.length / 1024) + 'KB');
      ok++;
    } catch (e) { console.log('  err ', brand, e.message, '→ queda el tile'); skip++; }
    await new Promise(res => setTimeout(res, 250));
  }
  console.log('\nlogos oficiales:', ok, '| fallback tile:', skip);
})();
