// manualProvider.js — capa MANUAL / editorial (último fallback y complemento).
// Lee data/manual/*.json. Permite cargar a mano lo que las APIs no entregan bien:
// jugadores clave, notas tácticas, lesiones confirmadas, alineaciones probables, model read.
// Se relee desde disco con TTL corto para poder editar los JSON sin reiniciar el server.

const fs = require('fs');
const path = require('path');
const cache = require('./cache');

const DIR = path.join(__dirname, '..', 'data', 'manual');

function readJson(file) {
  return cache.wrap(`manual:${file}`, cache.TTL.manual, async () => {
    try { return JSON.parse(fs.readFileSync(path.join(DIR, file), 'utf8')); }
    catch { return {}; }
  });
}

async function getTeamNotes(teamCode) {
  const all = await readJson('team_notes.json');
  return (all && all[teamCode]) || null;
}
async function getKeyPlayers(teamCode) {
  const all = await readJson('key_players.json');
  return (all && all[teamCode]) || [];
}
async function getManualInjuries(teamCode) {
  const all = await readJson('manual_injuries.json');
  return (all && all[teamCode]) || [];
}
async function getProjectedLineup(teamCode) {
  const all = await readJson('projected_lineups.json');
  return (all && all[teamCode]) || null;
}
async function getSquadNotes(teamCode) {
  const all = await readJson('squad_notes.json');
  return (all && all[teamCode]) || [];
}
async function getTacticalNotes(teamCode) {
  const all = await readJson('tactical_notes.json');
  return (all && all[teamCode]) || null;
}
async function getTeamFormFallback(teamCode) {
  const all = await readJson('team_form_cache.json');
  return (all && all[teamCode]) || null;
}

module.exports = {
  getTeamNotes, getKeyPlayers, getManualInjuries, getProjectedLineup,
  getSquadNotes, getTacticalNotes, getTeamFormFallback,
};
