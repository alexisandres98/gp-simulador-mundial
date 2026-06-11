// Datos del Mundial 2026 — 48 equipos, 12 grupos, Elo al 8-jun-2026 (fuentes: eloratings.net / Wikipedia)
// El Elo se actualiza en vivo conforme se registran resultados (K=60, multiplicador por margen).

const TEAMS = [
  // Grupo A
  { id: 'MEX', name: 'México',          en: 'Mexico',        flag: '🇲🇽', elo: 1868, group: 'A', host: true,  aliases: ['Mexico'] },
  { id: 'KOR', name: 'Corea del Sur',   en: 'South Korea',   flag: '🇰🇷', elo: 1756, group: 'A', host: false, aliases: ['South Korea', 'Korea Republic', 'Korea'] },
  { id: 'CZE', name: 'Chequia',         en: 'Czechia',       flag: '🇨🇿', elo: 1733, group: 'A', host: false, aliases: ['Czechia', 'Czech Republic'] },
  { id: 'RSA', name: 'Sudáfrica',       en: 'South Africa',  flag: '🇿🇦', elo: 1517, group: 'A', host: false, aliases: ['South Africa'] },
  // Grupo B
  { id: 'SUI', name: 'Suiza',           en: 'Switzerland',   flag: '🇨🇭', elo: 1894, group: 'B', host: false, aliases: ['Switzerland'] },
  { id: 'CAN', name: 'Canadá',          en: 'Canada',        flag: '🇨🇦', elo: 1793, group: 'B', host: true,  aliases: ['Canada'] },
  { id: 'BIH', name: 'Bosnia',          en: 'Bosnia',        flag: '🇧🇦', elo: 1591, group: 'B', host: false, aliases: ['Bosnia', 'Bosnia and Herzegovina', 'Bosnia-Herzegovina'] },
  { id: 'QAT', name: 'Catar',           en: 'Qatar',         flag: '🇶🇦', elo: 1423, group: 'B', host: false, aliases: ['Qatar'] },
  // Grupo C
  { id: 'BRA', name: 'Brasil',          en: 'Brazil',        flag: '🇧🇷', elo: 1991, group: 'C', host: false, aliases: ['Brazil'] },
  { id: 'MAR', name: 'Marruecos',       en: 'Morocco',       flag: '🇲🇦', elo: 1822, group: 'C', host: false, aliases: ['Morocco'] },
  { id: 'SCO', name: 'Escocia',         en: 'Scotland',      flag: '🏴󠁧󠁢󠁳󠁣󠁴󠁿', elo: 1770, group: 'C', host: false, aliases: ['Scotland'] },
  { id: 'HAI', name: 'Haití',           en: 'Haiti',         flag: '🇭🇹', elo: 1532, group: 'C', host: false, aliases: ['Haiti'] },
  // Grupo D
  { id: 'TUR', name: 'Turquía',         en: 'Türkiye',       flag: '🇹🇷', elo: 1906, group: 'D', host: false, aliases: ['Turkey', 'Türkiye', 'Turkiye'] },
  { id: 'PAR', name: 'Paraguay',        en: 'Paraguay',      flag: '🇵🇾', elo: 1833, group: 'D', host: false, aliases: ['Paraguay'] },
  { id: 'AUS', name: 'Australia',       en: 'Australia',     flag: '🇦🇺', elo: 1775, group: 'D', host: false, aliases: ['Australia'] },
  { id: 'USA', name: 'Estados Unidos',  en: 'United States', flag: '🇺🇸', elo: 1733, group: 'D', host: true,  aliases: ['United States', 'USA', 'USMNT'] },
  // Grupo E
  { id: 'ECU', name: 'Ecuador',         en: 'Ecuador',       flag: '🇪🇨', elo: 1935, group: 'E', host: false, aliases: ['Ecuador'] },
  { id: 'GER', name: 'Alemania',        en: 'Germany',       flag: '🇩🇪', elo: 1925, group: 'E', host: false, aliases: ['Germany'] },
  { id: 'CIV', name: 'Costa de Marfil', en: 'Ivory Coast',   flag: '🇨🇮', elo: 1676, group: 'E', host: false, aliases: ['Ivory Coast', "Cote d'Ivoire", 'Côte d’Ivoire'] },
  { id: 'CUW', name: 'Curazao',         en: 'Curaçao',       flag: '🇨🇼', elo: 1433, group: 'E', host: false, aliases: ['Curacao', 'Curaçao'] },
  // Grupo F
  { id: 'NED', name: 'Países Bajos',    en: 'Netherlands',   flag: '🇳🇱', elo: 1961, group: 'F', host: false, aliases: ['Netherlands', 'Holland'] },
  { id: 'JPN', name: 'Japón',           en: 'Japan',         flag: '🇯🇵', elo: 1906, group: 'F', host: false, aliases: ['Japan'] },
  { id: 'SWE', name: 'Suecia',          en: 'Sweden',        flag: '🇸🇪', elo: 1714, group: 'F', host: false, aliases: ['Sweden'] },
  { id: 'TUN', name: 'Túnez',           en: 'Tunisia',       flag: '🇹🇳', elo: 1633, group: 'F', host: false, aliases: ['Tunisia'] },
  // Grupo G
  { id: 'BEL', name: 'Bélgica',         en: 'Belgium',       flag: '🇧🇪', elo: 1888, group: 'G', host: false, aliases: ['Belgium'] },
  { id: 'IRN', name: 'Irán',            en: 'Iran',          flag: '🇮🇷', elo: 1764, group: 'G', host: false, aliases: ['Iran'] },
  { id: 'EGY', name: 'Egipto',          en: 'Egypt',         flag: '🇪🇬', elo: 1699, group: 'G', host: false, aliases: ['Egypt'] },
  { id: 'NZL', name: 'Nueva Zelanda',   en: 'New Zealand',   flag: '🇳🇿', elo: 1585, group: 'G', host: false, aliases: ['New Zealand'] },
  // Grupo H
  { id: 'ESP', name: 'España',          en: 'Spain',         flag: '🇪🇸', elo: 2155, group: 'H', host: false, aliases: ['Spain'] },
  { id: 'URU', name: 'Uruguay',         en: 'Uruguay',       flag: '🇺🇾', elo: 1892, group: 'H', host: false, aliases: ['Uruguay'] },
  { id: 'CPV', name: 'Cabo Verde',      en: 'Cape Verde',    flag: '🇨🇻', elo: 1576, group: 'H', host: false, aliases: ['Cape Verde', 'Cabo Verde'] },
  { id: 'KSA', name: 'Arabia Saudita',  en: 'Saudi Arabia',  flag: '🇸🇦', elo: 1566, group: 'H', host: false, aliases: ['Saudi Arabia'] },
  // Grupo I
  { id: 'FRA', name: 'Francia',         en: 'France',        flag: '🇫🇷', elo: 2062, group: 'I', host: false, aliases: ['France'] },
  { id: 'NOR', name: 'Noruega',         en: 'Norway',        flag: '🇳🇴', elo: 1917, group: 'I', host: false, aliases: ['Norway'] },
  { id: 'SEN', name: 'Senegal',         en: 'Senegal',       flag: '🇸🇳', elo: 1866, group: 'I', host: false, aliases: ['Senegal'] },
  { id: 'IRQ', name: 'Irak',            en: 'Iraq',          flag: '🇮🇶', elo: 1608, group: 'I', host: false, aliases: ['Iraq'] },
  // Grupo J
  { id: 'ARG', name: 'Argentina',       en: 'Argentina',     flag: '🇦🇷', elo: 2114, group: 'J', host: false, aliases: ['Argentina'] },
  { id: 'AUT', name: 'Austria',         en: 'Austria',       flag: '🇦🇹', elo: 1830, group: 'J', host: false, aliases: ['Austria'] },
  { id: 'ALG', name: 'Argelia',         en: 'Algeria',       flag: '🇩🇿', elo: 1743, group: 'J', host: false, aliases: ['Algeria'] },
  { id: 'JOR', name: 'Jordania',        en: 'Jordan',        flag: '🇯🇴', elo: 1685, group: 'J', host: false, aliases: ['Jordan'] },
  // Grupo K
  { id: 'POR', name: 'Portugal',        en: 'Portugal',      flag: '🇵🇹', elo: 1986, group: 'K', host: false, aliases: ['Portugal'] },
  { id: 'COL', name: 'Colombia',        en: 'Colombia',      flag: '🇨🇴', elo: 1982, group: 'K', host: false, aliases: ['Colombia'] },
  { id: 'UZB', name: 'Uzbekistán',      en: 'Uzbekistan',    flag: '🇺🇿', elo: 1718, group: 'K', host: false, aliases: ['Uzbekistan'] },
  { id: 'COD', name: 'RD del Congo',    en: 'DR Congo',      flag: '🇨🇩', elo: 1655, group: 'K', host: false, aliases: ['DR Congo', 'Congo DR', 'Democratic Republic of the Congo'] },
  // Grupo L
  { id: 'ENG', name: 'Inglaterra',      en: 'England',       flag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', elo: 2021, group: 'L', host: false, aliases: ['England'] },
  { id: 'CRO', name: 'Croacia',         en: 'Croatia',       flag: '🇭🇷', elo: 1908, group: 'L', host: false, aliases: ['Croatia'] },
  { id: 'PAN', name: 'Panamá',          en: 'Panama',        flag: '🇵🇦', elo: 1733, group: 'L', host: false, aliases: ['Panama'] },
  { id: 'GHA', name: 'Ghana',           en: 'Ghana',         flag: '🇬🇭', elo: 1503, group: 'L', host: false, aliases: ['Ghana'] },
];

const GROUPS = 'ABCDEFGHIJKL'.split('');

// Calendario REAL de la fase de grupos (fuente: API pública de ESPN, fifa.world scoreboard).
// Generado por build-fixtures.js con auditoría: 72 partidos, 6 por grupo, 3 por equipo,
// todos los cruces intra-grupo. Incluye espnId para la sincronización automática de resultados.
const REAL_FIXTURES = require('./fixtures-real.json').map(f => ({
  ...f, date: f.datetime.slice(0, 10),
}));

// Llaves de eliminación (estructura oficial, Wikipedia: 2026 FIFA World Cup knockout stage)
// W=ganador de grupo, R=segundo, T3=mejor tercero (con grupos permitidos por slot)
const KNOCKOUT = [
  { m: 73, stage: 'R32', date: '2026-06-28', datetime: '2026-06-28T19:00Z', home: { t: 'R', g: 'A' }, away: { t: 'R', g: 'B' } },
  { m: 74, stage: 'R32', date: '2026-06-29', datetime: '2026-06-29T20:30Z', home: { t: 'W', g: 'E' }, away: { t: 'T3', allowed: ['A', 'B', 'C', 'D', 'F'] } },
  { m: 75, stage: 'R32', date: '2026-06-30', datetime: '2026-06-30T01:00Z', home: { t: 'W', g: 'F' }, away: { t: 'R', g: 'C' } },
  { m: 76, stage: 'R32', date: '2026-06-29', datetime: '2026-06-29T17:00Z', home: { t: 'W', g: 'C' }, away: { t: 'R', g: 'F' } },
  { m: 77, stage: 'R32', date: '2026-06-30', datetime: '2026-06-30T21:00Z', home: { t: 'W', g: 'I' }, away: { t: 'T3', allowed: ['C', 'D', 'F', 'G', 'H'] } },
  { m: 78, stage: 'R32', date: '2026-06-30', datetime: '2026-06-30T17:00Z', home: { t: 'R', g: 'E' }, away: { t: 'R', g: 'I' } },
  { m: 79, stage: 'R32', date: '2026-07-01', datetime: '2026-07-01T01:00Z', home: { t: 'W', g: 'A' }, away: { t: 'T3', allowed: ['C', 'E', 'F', 'H', 'I'] } },
  { m: 80, stage: 'R32', date: '2026-07-01', datetime: '2026-07-01T16:00Z', home: { t: 'W', g: 'L' }, away: { t: 'T3', allowed: ['E', 'H', 'I', 'J', 'K'] } },
  { m: 81, stage: 'R32', date: '2026-07-02', datetime: '2026-07-02T00:00Z', home: { t: 'W', g: 'D' }, away: { t: 'T3', allowed: ['B', 'E', 'F', 'I', 'J'] } },
  { m: 82, stage: 'R32', date: '2026-07-01', datetime: '2026-07-01T20:00Z', home: { t: 'W', g: 'G' }, away: { t: 'T3', allowed: ['A', 'E', 'H', 'I', 'J'] } },
  { m: 83, stage: 'R32', date: '2026-07-02', datetime: '2026-07-02T23:00Z', home: { t: 'R', g: 'K' }, away: { t: 'R', g: 'L' } },
  { m: 84, stage: 'R32', date: '2026-07-02', datetime: '2026-07-02T19:00Z', home: { t: 'W', g: 'H' }, away: { t: 'R', g: 'J' } },
  { m: 85, stage: 'R32', date: '2026-07-03', datetime: '2026-07-03T03:00Z', home: { t: 'W', g: 'B' }, away: { t: 'T3', allowed: ['E', 'F', 'G', 'I', 'J'] } },
  { m: 86, stage: 'R32', date: '2026-07-03', datetime: '2026-07-03T22:00Z', home: { t: 'W', g: 'J' }, away: { t: 'R', g: 'H' } },
  { m: 87, stage: 'R32', date: '2026-07-04', datetime: '2026-07-04T01:30Z', home: { t: 'W', g: 'K' }, away: { t: 'T3', allowed: ['D', 'E', 'I', 'J', 'L'] } },
  { m: 88, stage: 'R32', date: '2026-07-03', datetime: '2026-07-03T18:00Z', home: { t: 'R', g: 'D' }, away: { t: 'R', g: 'G' } },
  { m: 89, stage: 'R16', date: '2026-07-04', home: { t: 'M', m: 74 }, away: { t: 'M', m: 77 } },
  { m: 90, stage: 'R16', date: '2026-07-04', home: { t: 'M', m: 73 }, away: { t: 'M', m: 75 } },
  { m: 91, stage: 'R16', date: '2026-07-05', home: { t: 'M', m: 76 }, away: { t: 'M', m: 78 } },
  { m: 92, stage: 'R16', date: '2026-07-05', home: { t: 'M', m: 79 }, away: { t: 'M', m: 80 } },
  { m: 93, stage: 'R16', date: '2026-07-06', home: { t: 'M', m: 83 }, away: { t: 'M', m: 84 } },
  { m: 94, stage: 'R16', date: '2026-07-06', home: { t: 'M', m: 81 }, away: { t: 'M', m: 82 } },
  { m: 95, stage: 'R16', date: '2026-07-07', home: { t: 'M', m: 86 }, away: { t: 'M', m: 88 } },
  { m: 96, stage: 'R16', date: '2026-07-07', home: { t: 'M', m: 85 }, away: { t: 'M', m: 87 } },
  { m: 97, stage: 'QF', date: '2026-07-09', home: { t: 'M', m: 89 }, away: { t: 'M', m: 90 } },
  { m: 98, stage: 'QF', date: '2026-07-10', home: { t: 'M', m: 93 }, away: { t: 'M', m: 94 } },
  { m: 99, stage: 'QF', date: '2026-07-11', home: { t: 'M', m: 91 }, away: { t: 'M', m: 92 } },
  { m: 100, stage: 'QF', date: '2026-07-11', home: { t: 'M', m: 95 }, away: { t: 'M', m: 96 } },
  { m: 101, stage: 'SF', date: '2026-07-14', home: { t: 'M', m: 97 }, away: { t: 'M', m: 98 } },
  { m: 102, stage: 'SF', date: '2026-07-15', home: { t: 'M', m: 99 }, away: { t: 'M', m: 100 } },
  { m: 103, stage: '3RD', date: '2026-07-18', home: { t: 'L', m: 101 }, away: { t: 'L', m: 102 } },
  { m: 104, stage: 'FINAL', date: '2026-07-19', home: { t: 'M', m: 101 }, away: { t: 'M', m: 102 } },
];

module.exports = { TEAMS, GROUPS, GROUP_FIXTURES: REAL_FIXTURES, KNOCKOUT };
