// signal-registry/canonicalize.js — Sprint 5 §13. Serialización DETERMINÍSTICA.
// Mismo contenido lógico → misma cadena, aunque cambie el orden de claves JSON. Sin secretos ni campos mutables.
'use strict';

// canonicalValue(v) → estructura con claves ordenadas recursivamente. Números finitos como tales; el resto string.
function canonical(value) {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value).sort()) {
      if (value[k] === undefined) continue;
      out[k] = canonical(value[k]);
    }
    return out;
  }
  return value;
}

// canonicalString(obj) → JSON estable (claves ordenadas, sin espacios variables).
function canonicalString(obj) {
  return JSON.stringify(canonical(obj));
}

module.exports = { canonical, canonicalString };
