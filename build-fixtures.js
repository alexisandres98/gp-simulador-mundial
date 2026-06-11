// Genera data/fixtures-real.json desde el calendario ESPN + auditoría completa de datos
const fs = require('fs');
const { TEAMS } = require('./data/tournament');

const espn = JSON.parse(fs.readFileSync('./espn-schedule.json', 'utf8'));
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
const aliasToId = {};
TEAMS.forEach(t => [t.en, t.name, ...t.aliases].forEach(a => aliasToId[norm(a)] = t.id));
const teamById = Object.fromEntries(TEAMS.map(t => [t.id, t]));

const errors = [];
const groupMatches = [];
const koEvents = [];

for (const e of espn.sort((a, b) => a.date.localeCompare(b.date))) {
  const h = aliasToId[norm(e.home)], a = aliasToId[norm(e.away)];
  // Partido de grupos = ambos equipos mapeados y del mismo grupo.
  // Las eliminatorias en ESPN aún son "TBD vs TBD" (los cruces no existen hasta que cierren los grupos).
  if (h && a && teamById[h].group === teamById[a].group) {
    groupMatches.push({ espnId: e.id, home: h, away: a, group: teamById[h].group, datetime: e.date });
  } else if (h && a) {
    errors.push(`Cruce entre grupos distintos: ${e.home}(${teamById[h].group}) vs ${e.away}(${teamById[a].group})`);
  } else if ((h || a) || !/tbd|to be determined|winner|runner/i.test(e.home + e.away)) {
    if (new Date(e.date) < new Date('2026-06-29T00:00Z') && !(h || a)) errors.push(`No mapeado: ${e.home} vs ${e.away}`);
    else koEvents.push(e);
  } else {
    koEvents.push(e);
  }
}

// auditoría: 72 partidos, 6 por grupo, 3 por equipo
if (groupMatches.length !== 72) errors.push(`Partidos de grupos: ${groupMatches.length} (esperados 72)`);
const perGroup = {}, perTeam = {};
groupMatches.forEach(m => {
  perGroup[m.group] = (perGroup[m.group] || 0) + 1;
  perTeam[m.home] = (perTeam[m.home] || 0) + 1;
  perTeam[m.away] = (perTeam[m.away] || 0) + 1;
});
Object.entries(perGroup).forEach(([g, n]) => { if (n !== 6) errors.push(`Grupo ${g}: ${n} partidos (esperados 6)`); });
TEAMS.forEach(t => { if (perTeam[t.id] !== 3) errors.push(`${t.id}: ${perTeam[t.id] || 0} partidos (esperados 3)`); });

// IDs estables GA1..GL6 por orden cronológico dentro de cada grupo + jornada
const counters = {}, played = {};
const fixtures = groupMatches.map(m => {
  counters[m.group] = (counters[m.group] || 0) + 1;
  played[m.home] = (played[m.home] || 0) + 1;
  played[m.away] = (played[m.away] || 0) + 1;
  return {
    id: `G${m.group}${counters[m.group]}`,
    stage: 'group', group: m.group,
    matchday: Math.max(played[m.home], played[m.away]),
    home: m.home, away: m.away,
    datetime: m.datetime, espnId: m.espnId,
  };
});

console.log(errors.length ? '❌ ERRORES:\n' + errors.join('\n') : '✓ Auditoría OK: 72 partidos, 6 por grupo, 3 por equipo, todos intra-grupo');
console.log('✓ Eliminatorias ESPN (TBD por ahora):', koEvents.length);
fs.writeFileSync('./data/fixtures-real.json', JSON.stringify(fixtures, null, 1));
console.log('✓ data/fixtures-real.json generado');
console.log('\nPrimeros 5:');
fixtures.slice(0, 5).forEach(f => console.log(` ${f.id} ${f.datetime} ${teamById[f.home].name} vs ${teamById[f.away].name} (J${f.matchday})`));
