// exec-opportunities/deepLinks.js — Sprint 4 §19. Generador VERSIONADO de deep links. Puro, sin DB.
// Reglas: apuntar al mercado exacto (no homepage), allowlist de dominios, solo HTTPS, sin tokens,
// sin tracking no autorizado, encode correcto, marcado verificado/no-verificado.
'use strict';

const DEEPLINK_VERSION = 'deeplink-1';

// Plantillas versionadas por proveedor. Pueden sobreescribirse desde provider_deep_link_templates (DB).
const TEMPLATES = {
  polymarket: {
    domain: 'polymarket.com',
    market: 'https://polymarket.com/event/{eventSlug}/{marketSlug}',
    event: 'https://polymarket.com/event/{eventSlug}',
    label: 'Abrir Polymarket',
  },
  kalshi: {
    domain: 'kalshi.com',
    market: 'https://kalshi.com/markets/{seriesLower}/{ticker}',
    series: 'https://kalshi.com/markets/{seriesLower}',
    label: 'Abrir Kalshi',
  },
};

const ALLOWED_DOMAINS = new Set(['polymarket.com', 'kalshi.com']);

const enc = s => encodeURIComponent(String(s == null ? '' : s)).replace(/%2F/gi, '/'); // permitir paths slug, no inyección

function fill(tpl, vars) {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? enc(vars[k]) : ''));
}

// validateUrl(url) → { ok, reason }. Allowlist de dominio + HTTPS + sin credenciales embebidas.
function validateUrl(url) {
  let u;
  try { u = new URL(url); } catch { return { ok: false, reason: 'invalid_url' }; }
  if (u.protocol !== 'https:') return { ok: false, reason: 'not_https' };
  if (u.username || u.password) return { ok: false, reason: 'embedded_credentials' };
  const host = u.hostname.toLowerCase();
  const allowed = [...ALLOWED_DOMAINS].some(d => host === d || host.endsWith('.' + d));
  if (!allowed) return { ok: false, reason: 'domain_not_allowlisted' };
  // anti open-redirect: no permitir que el destino real vaya en query (?url=, ?redirect=, ?next=)
  for (const [k] of u.searchParams) {
    if (/^(url|redirect|next|to|dest|destination|return|returnto|continue)$/i.test(k)) return { ok: false, reason: 'open_redirect_param' };
  }
  return { ok: true };
}

// buildDeepLink({ provider, eventSlug, marketSlug, ticker, series }, templates?) → link
// verified=true SOLO si hay identificador exacto del mercado (marketSlug en PM, ticker en Kalshi).
function buildDeepLink(args = {}, templates = TEMPLATES) {
  const provider = String(args.provider || '').toLowerCase();
  const t = templates[provider];
  if (!t) return { provider, url: null, verified: false, version: DEEPLINK_VERSION, reason: 'unknown_provider' };

  let url = null, verified = false;
  if (provider === 'polymarket') {
    if (args.eventSlug && args.marketSlug) { url = fill(t.market, args); verified = true; }
    else if (args.eventSlug) { url = fill(t.event, args); verified = false; } // solo evento → no verificado
  } else if (provider === 'kalshi') {
    const series = args.series || 'KXMENWORLDCUP-26';
    const seriesLower = String(series).toLowerCase();
    if (args.ticker) { url = fill(t.market, { ...args, series, seriesLower }); verified = true; }
    else { url = fill(t.series, { ...args, series, seriesLower }); verified = false; }
  }

  if (!url) return { provider, url: null, verified: false, version: DEEPLINK_VERSION, reason: 'insufficient_identifiers' };
  const v = validateUrl(url);
  if (!v.ok) return { provider, url: null, verified: false, version: DEEPLINK_VERSION, reason: v.reason };
  return { provider, url, verified, version: DEEPLINK_VERSION, label: t.label, reason: verified ? null : 'points_to_event_not_market' };
}

// buildLinksForLegs(legs) → un deep link por pata (botones separados, nunca uno ambiguo).
//   legs: [{ provider, deepLinkArgs:{...} }]
function buildLinksForLegs(legs, templates = TEMPLATES) {
  return (legs || []).map(l => buildDeepLink({ provider: l.provider, ...(l.deepLinkArgs || {}) }, templates));
}

module.exports = { buildDeepLink, buildLinksForLegs, validateUrl, ALLOWED_DOMAINS, DEEPLINK_VERSION, TEMPLATES };
