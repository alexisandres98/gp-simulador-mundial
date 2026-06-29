// collector/venuesSeed.js — Grupo 2 (jun-29). Catálogo de las 16 sedes del Mundial 2026 con coordenadas
// verificadas (hechos públicos). Permite resolver event_venue_resolution para MÁS partidos y, con ello,
// que el clima exacto (Open-Meteo) se pueble y se fusione como factor. aliases = nombres de estadio que
// reporta ESPN + ciudad (para el matching). NO se infiere nada: si ESPN no trae sede, no se resuelve.
'use strict';

// { name, aliases:[], city, country, lat, lon, tz }
const VENUES = [
  { name: 'MetLife Stadium', aliases: ['metlife', 'east rutherford', 'new york', 'new jersey'], city: 'East Rutherford', country: 'USA', lat: 40.8135, lon: -74.0745, tz: 'America/New_York' },
  { name: 'SoFi Stadium', aliases: ['sofi', 'inglewood', 'los angeles'], city: 'Inglewood', country: 'USA', lat: 33.9535, lon: -118.3392, tz: 'America/Los_Angeles' },
  { name: "Levi's Stadium", aliases: ['levi', 'santa clara', 'san francisco bay'], city: 'Santa Clara', country: 'USA', lat: 37.4030, lon: -121.9698, tz: 'America/Los_Angeles' },
  { name: 'AT&T Stadium', aliases: ['at&t', 'at t stadium', 'arlington', 'dallas'], city: 'Arlington', country: 'USA', lat: 32.7473, lon: -97.0945, tz: 'America/Chicago' },
  { name: 'NRG Stadium', aliases: ['nrg', 'houston'], city: 'Houston', country: 'USA', lat: 29.6847, lon: -95.4107, tz: 'America/Chicago' },
  { name: 'Arrowhead Stadium', aliases: ['arrowhead', 'geha field', 'kansas city'], city: 'Kansas City', country: 'USA', lat: 39.0489, lon: -94.4839, tz: 'America/Chicago' },
  { name: 'Mercedes-Benz Stadium', aliases: ['mercedes-benz', 'mercedes benz', 'atlanta'], city: 'Atlanta', country: 'USA', lat: 33.7553, lon: -84.4006, tz: 'America/New_York' },
  { name: 'Hard Rock Stadium', aliases: ['hard rock', 'miami gardens', 'miami'], city: 'Miami Gardens', country: 'USA', lat: 25.9580, lon: -80.2389, tz: 'America/New_York' },
  { name: 'Lincoln Financial Field', aliases: ['lincoln financial', 'philadelphia'], city: 'Philadelphia', country: 'USA', lat: 39.9008, lon: -75.1675, tz: 'America/New_York' },
  { name: 'Gillette Stadium', aliases: ['gillette', 'foxborough', 'boston'], city: 'Foxborough', country: 'USA', lat: 42.0909, lon: -71.2643, tz: 'America/New_York' },
  { name: 'Lumen Field', aliases: ['lumen', 'seattle'], city: 'Seattle', country: 'USA', lat: 47.5952, lon: -122.3316, tz: 'America/Los_Angeles' },
  { name: 'BMO Field', aliases: ['bmo', 'toronto'], city: 'Toronto', country: 'Canada', lat: 43.6332, lon: -79.4185, tz: 'America/Toronto' },
  { name: 'BC Place', aliases: ['bc place', 'vancouver'], city: 'Vancouver', country: 'Canada', lat: 49.2767, lon: -123.1119, tz: 'America/Vancouver' },
  { name: 'Estadio Azteca', aliases: ['azteca', 'banorte', 'mexico city', 'ciudad de mexico'], city: 'Mexico City', country: 'Mexico', lat: 19.3029, lon: -99.1505, tz: 'America/Mexico_City' },
  { name: 'Estadio Akron', aliases: ['akron', 'guadalajara', 'zapopan'], city: 'Guadalajara', country: 'Mexico', lat: 20.6818, lon: -103.4628, tz: 'America/Mexico_City' },
  { name: 'Estadio BBVA', aliases: ['bbva', 'monterrey', 'guadalupe'], city: 'Guadalupe', country: 'Mexico', lat: 25.6694, lon: -100.2444, tz: 'America/Monterrey' },
];

const norm = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// matchVenue(espnFullName, espnCity) → venue del catálogo, o null. Primero por alias dentro del nombre,
// luego por ciudad. NO adivina (sin coincidencia → null).
function matchVenue(espnFullName, espnCity) {
  const fn = norm(espnFullName), ci = norm(espnCity);
  for (const v of VENUES) {
    if (fn && v.aliases.some((a) => fn.includes(norm(a)))) return v;
  }
  for (const v of VENUES) {
    if (ci && (ci.includes(norm(v.city)) || norm(v.city).includes(ci) || v.aliases.some((a) => ci.includes(norm(a))))) return v;
  }
  return null;
}

module.exports = { VENUES, matchVenue, norm };
