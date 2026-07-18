// scripts/gen-book-logos.js — genera los LOGOS de casas/exchanges/prediction markets como tiles SVG
// self-hosted en public/books/ (misma línea visual que las banderas: 4:3, esquinas redondeadas, servidos
// con cache inmutable). Marca = color oficial de la casa + monograma corto; sin bitmaps externos ni
// hotlinking. Idempotente: regenerar pisa los archivos. `node scripts/gen-book-logos.js`
'use strict';
const fs = require('fs');
const path = require('path');

// brand → { bg, fg, mark } (colores de identidad aproximados de cada marca; monograma legible a 1em)
const BRANDS = {
  pinnacle: { bg: '#16181d', fg: '#ff5c00', mark: 'P' },
  bet365: { bg: '#0f5940', fg: '#f9dc1c', mark: '365' },
  williamhill: { bg: '#002d59', fg: '#ffcf01', mark: 'WH' },
  betway: { bg: '#101010', fg: '#00c65a', mark: 'BW' },
  betvictor: { bg: '#14202b', fg: '#f0aa00', mark: 'BV' },
  betfred: { bg: '#003d78', fg: '#ffffff', mark: 'BF' },
  boylesports: { bg: '#007a33', fg: '#ffffff', mark: 'BS' },
  unibet: { bg: '#0e8040', fg: '#ffffff', mark: 'UB' },
  betsson: { bg: '#ff6600', fg: '#ffffff', mark: 'B' },
  nordicbet: { bg: '#002f6c', fg: '#ffd700', mark: 'NB' },
  betclic: { bg: '#e30613', fg: '#ffffff', mark: 'BC' },
  betanysports: { bg: '#333940', fg: '#ffffff', mark: 'BAS' },
  betonline: { bg: '#101820', fg: '#ee3524', mark: 'BOL' },
  draftkings: { bg: '#0d1a12', fg: '#53d337', mark: 'DK' },
  fanduel: { bg: '#1381e0', fg: '#ffffff', mark: 'FD' },
  betmgm: { bg: '#0d0d0d', fg: '#c4a35a', mark: 'MGM' },
  caesars: { bg: '#012a2a', fg: '#d4b46a', mark: 'CZR' },
  betrivers: { bg: '#14284b', fg: '#f5a623', mark: 'BR' },
  espnbet: { bg: '#0a0a0a', fg: '#58e0c0', mark: 'ESPN' },
  fanatics: { bg: '#0c2340', fg: '#ffffff', mark: 'FAN' },
  ladbrokes: { bg: '#d21f26', fg: '#ffffff', mark: 'LAD' },
  coral: { bg: '#0093d0', fg: '#ffffff', mark: 'COR' },
  paddypower: { bg: '#005e33', fg: '#ffffff', mark: 'PP' },
  skybet: { bg: '#002458', fg: '#ffffff', mark: 'SKY' },
  '888sport': { bg: '#ff8d00', fg: '#ffffff', mark: '888' },
  sportsbet: { bg: '#0055ff', fg: '#ffffff', mark: 'SB' },
  tab: { bg: '#0a9642', fg: '#ffffff', mark: 'TAB' },
  neds: { bg: '#ff7800', fg: '#101010', mark: 'NEDS' },
  pointsbet: { bg: '#101010', fg: '#ed1b42', mark: 'PB' },
  betfair: { bg: '#ffb80c', fg: '#1e1e1e', mark: 'BF' },
  smarkets: { bg: '#0f1419', fg: '#00b1ff', mark: 'SM' },
  matchbook: { bg: '#58b947', fg: '#ffffff', mark: 'MB' },
  winamax: { bg: '#e2001a', fg: '#ffffff', mark: 'W' },
  tipico: { bg: '#c8102e', fg: '#ffffff', mark: 'T' },
  leovegas: { bg: '#ff5c00', fg: '#ffffff', mark: 'LEO' },
  casumo: { bg: '#4a2a82', fg: '#ffffff', mark: 'CAS' },
  onexbet: { bg: '#1c5c8f', fg: '#ffffff', mark: '1X' },
  coolbet: { bg: '#002f5f', fg: '#ffffff', mark: 'CB' },
  grosvenor: { bg: '#1a1a1a', fg: '#cba135', mark: 'G' },
  pmu: { bg: '#00553e', fg: '#ffffff', mark: 'PMU' },
  marathonbet: { bg: '#003b79', fg: '#ffffff', mark: 'MAR' },
  mybookie: { bg: '#111318', fg: '#f26522', mark: 'MYB' },
  lowvig: { bg: '#23405f', fg: '#ffffff', mark: 'LV' },
  bovada: { bg: '#cc0000', fg: '#ffffff', mark: 'BOV' },
  betus: { bg: '#0f2b5b', fg: '#ffb612', mark: 'BUS' },
  gtbets: { bg: '#202020', fg: '#f1c40f', mark: 'GT' },
  everygame: { bg: '#b01c2e', fg: '#ffffff', mark: 'EG' },
  suprabets: { bg: '#12241c', fg: '#27c26a', mark: 'SUP' },
  ballybet: { bg: '#b31e30', fg: '#ffffff', mark: 'BLY' },
  betparx: { bg: '#0a5c3c', fg: '#ffffff', mark: 'PX' },
  hardrockbet: { bg: '#2d2926', fg: '#e3a323', mark: 'HR' },
  playup: { bg: '#ff6b00', fg: '#ffffff', mark: 'PU' },
  tenbet: { bg: '#1b3c8c', fg: '#ffffff', mark: '10B' },
  // prediction markets / exchanges
  polymarket: { bg: '#0f1a2b', fg: '#4d7cfe', mark: 'PM' },
  kalshi: { bg: '#0b3b36', fg: '#29d9b9', mark: 'K' },
  myriad: { bg: '#241a3d', fg: '#9a7bff', mark: 'MY' },
  novig: { bg: '#101820', fg: '#7ef0c1', mark: 'NV' },
  prophetx: { bg: '#131313', fg: '#b18cff', mark: 'PX' },
  // casas cripto
  cloudbet: { bg: '#0a1420', fg: '#f7c948', mark: 'CB' },
  stake: { bg: '#1a2c38', fg: '#00e701', mark: 'STK' },
  rollbit: { bg: '#12101c', fg: '#ff5c00', mark: 'RB' },
  bcgame: { bg: '#14161c', fg: '#ffd400', mark: 'BC' },
  sportsbetio: { bg: '#0e1a2b', fg: '#39a1ff', mark: 'SB' },
};

const FS = { 1: 19, 2: 15.5, 3: 12.5, 4: 10.5 };
function svg({ bg, fg, mark }) {
  const fs = FS[Math.min(mark.length, 4)] || 10;
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 36">' +
    `<rect width="48" height="36" rx="5" fill="${bg}"/>` +
    '<rect width="48" height="18" rx="5" fill="#ffffff" opacity="0.045"/>' +
    `<text x="24" y="23.6" font-family="Arial, Helvetica, sans-serif" font-size="${fs}" font-weight="700" fill="${fg}" text-anchor="middle" dominant-baseline="middle" letter-spacing="0.4">${mark}</text>` +
    '</svg>';
}

const dir = path.join(__dirname, '..', 'public', 'books');
fs.mkdirSync(dir, { recursive: true });
let n = 0;
for (const brand in BRANDS) {
  fs.writeFileSync(path.join(dir, brand + '.svg'), svg(BRANDS[brand]));
  n++;
}
console.log('logos generados:', n, '→', dir);
