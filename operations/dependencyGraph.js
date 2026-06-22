// operations/dependencyGraph.js — grafo explícito de dependencias entre jobs (Sprint 8A §18).
// Un job NO debe ejecutarse si falta una dependencia crítica fresca. Reporta 'blocked' en lugar de
// producir un resultado incompleto presentado como válido. Puro: opera sobre el registry + freshness fn.
'use strict';

// Detección de ciclos (defensa: una mala edición del registry no debe colgar el orquestador).
function detectCycle(jobs) {
  const byName = new Map(jobs.map(j => [j.job_name, j]));
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map(jobs.map(j => [j.job_name, WHITE]));
  let cycle = null;
  function visit(name, path) {
    const j = byName.get(name);
    if (!j) return;
    color.set(name, GRAY);
    for (const dep of (j.dependencies || [])) {
      if (!byName.has(dep)) continue;
      if (color.get(dep) === GRAY) { cycle = [...path, name, dep]; return; }
      if (color.get(dep) === WHITE) { visit(dep, [...path, name]); if (cycle) return; }
    }
    color.set(name, BLACK);
  }
  for (const j of jobs) { if (color.get(j.job_name) === WHITE) visit(j.job_name, []); if (cycle) break; }
  return cycle;
}

// ¿Están satisfechas las dependencias del job? isReady(depName) => bool (p.ej. "hay consenso fresco").
// Devuelve { ok, blockedBy: [] }.
function checkDependencies(job, isReady) {
  const deps = job.dependencies || [];
  const blockedBy = deps.filter(d => !isReady(d));
  return { ok: blockedBy.length === 0, blockedBy };
}

// Orden topológico (para boot ordenado / status). Si hay ciclo, devuelve el orden parcial estable.
function topoOrder(jobs) {
  const byName = new Map(jobs.map(j => [j.job_name, j]));
  const visited = new Set(); const out = [];
  function visit(name) {
    if (visited.has(name) || !byName.has(name)) return;
    visited.add(name);
    for (const dep of (byName.get(name).dependencies || [])) visit(dep);
    out.push(name);
  }
  for (const j of jobs) visit(j.job_name);
  return out;
}

module.exports = { detectCycle, checkDependencies, topoOrder };
