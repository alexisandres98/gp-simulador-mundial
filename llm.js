// llm.js — la ÚNICA puerta al LLM (Anthropic Messages API). Node puro, sin dependencias.
//
// DOCTRINA (acordada 2-ago, ver memoria gp-llm-doctrina): el LLM EXTRAE datos y REDACTA prosa
// desde factores YA computados por los engines. JAMÁS produce una probabilidad, un edge ni una
// pick, y jamás toca el λ. La caja negra se protege AQUÍ, en la capa de datos: a las llamadas
// solo entran factores TRADUCIDOS (etiquetas de producto: "ventaja de alcance", "desgaste de
// carrera"), nunca pesos, fórmulas ni nombres de features. El modelo no puede filtrar lo que
// nunca recibe.
//
// CONTROLES DE COSTO (crédito inicial: $10):
//  - Presupuesto DIARIO en USD (GP_LLM_DAILY_USD, default 1.5): al agotarse, TODAS las rutas
//    LLM degradan en silencio al comportamiento por plantillas de siempre. Nada se rompe.
//  - Medidor persistente en db.llmUsage (día, llamadas, tokens, USD, por-uso) — visible en
//    /api/internal/llm.
//  - Modelos por uso (env-overridable): chat=Sonnet 5, redactor=Sonnet 5, extractor=Haiku 4.5.
//  - Prompt caching en el system prompt del chat (lecturas al ~10% del precio).
//  - Kill switch total: GP_LLM_ENABLED=false.
'use strict';

const PRICES = { // USD por 1M de tokens [input, output] — precios de lista (sin descuento intro)
  'claude-opus-5': [5, 25],
  'claude-sonnet-5': [3, 15],
  'claude-haiku-4-5': [1, 5],
};
const MODELS = {
  chat: () => process.env.GP_LLM_CHAT_MODEL || 'claude-sonnet-5',
  writer: () => process.env.GP_LLM_WRITER_MODEL || 'claude-sonnet-5',
  extract: () => process.env.GP_LLM_EXTRACT_MODEL || 'claude-haiku-4-5',
};

let _db = null, _save = null;
function init(db, save) { _db = db; _save = save; }
function enabled() { return !!process.env.ANTHROPIC_API_KEY && String(process.env.GP_LLM_ENABLED || 'true') !== 'false'; }
function dailyBudget() { return +(process.env.GP_LLM_DAILY_USD || 1.5); }
function usage() {
  const day = new Date().toISOString().slice(0, 10);
  if (!_db.llmUsage || _db.llmUsage.day !== day) {
    const total = (_db.llmUsage && _db.llmUsage.total_usd) || 0;
    _db.llmUsage = { day, calls: 0, in_tokens: 0, out_tokens: 0, usd: 0, by: {}, errors: 0, total_usd: total };
  }
  return _db.llmUsage;
}
function budgetOk() { return usage().usd < dailyBudget(); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Llamada base. kind decide el modelo; el medidor carga el costo al uso que la originó.
async function call({ kind = 'chat', system, messages, tools, max_tokens = 512, cacheSystem = false }) {
  if (!enabled()) throw new Error('llm_disabled');
  const u = usage();
  if (u.usd >= dailyBudget()) throw new Error('llm_budget');
  const model = MODELS[kind] ? MODELS[kind]() : MODELS.chat();
  const body = { model, max_tokens, messages };
  if (tools) body.tools = tools;
  if (system) body.system = cacheSystem ? [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }] : system;
  let lastErr = null;
  for (let att = 0; att < 3; att++) {
    let r;
    try {
      r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(50000),
      });
    } catch (e) { lastErr = e; await sleep(1200 * (att + 1)); continue; }
    if (r.status === 429 || r.status >= 500) { lastErr = new Error('llm_http_' + r.status); await sleep(1600 * (att + 1)); continue; }
    const j = await r.json().catch(() => null);
    if (!j) { lastErr = new Error('llm_badjson'); continue; }
    if (j.error) { u.errors++; throw new Error('llm_api: ' + (j.error.message || j.error.type)); }
    const us = j.usage || {};
    const [pi, po] = PRICES[model] || PRICES['claude-sonnet-5'];
    const cost = ((us.input_tokens || 0) + (us.cache_creation_input_tokens || 0) * 1.25) * pi / 1e6
      + (us.cache_read_input_tokens || 0) * pi * 0.1 / 1e6
      + (us.output_tokens || 0) * po / 1e6;
    u.calls++;
    u.in_tokens += (us.input_tokens || 0) + (us.cache_creation_input_tokens || 0) + (us.cache_read_input_tokens || 0);
    u.out_tokens += us.output_tokens || 0;
    u.usd = +(u.usd + cost).toFixed(5);
    u.total_usd = +((u.total_usd || 0) + cost).toFixed(5);
    u.by[kind] = +((u.by[kind] || 0) + cost).toFixed(5);
    if (_save) { try { _save(); } catch { /* el flush normal lo recoge */ } }
    return j;
  }
  usage().errors++;
  throw lastErr || new Error('llm_failed');
}
function textOf(resp) { return (resp && resp.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim(); }
// Los modelos a veces envuelven el JSON en fences — parse robusto, null si no hay JSON.
function jsonOf(resp) {
  let t = textOf(resp).replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  const i = t.indexOf('{') >= 0 ? Math.min(...['{', '['].map((c) => (t.indexOf(c) + 1 || 1e9)) ) - 1 : -1;
  if (i > 0) t = t.slice(i);
  try { return JSON.parse(t); } catch { /* segundo intento abajo */ }
  // 12-ago: respuestas largas (redactor profundo, dos párrafos) traen saltos de línea LITERALES dentro de
  // los strings → JSON inválido → null → el caller degradaba en silencio al redactor corto. Se escapan los
  // caracteres de control SOLO dentro de strings (los de fuera son whitespace válido y no se tocan).
  let out = '', ins = false, esc = false;
  for (const ch of t) {
    if (ins) {
      if (esc) { out += ch; esc = false; continue; }
      if (ch === '\\') { out += ch; esc = true; continue; }
      if (ch === '"') { ins = false; out += ch; continue; }
      if (ch === '\n') { out += '\\n'; continue; }
      if (ch === '\r') continue;
      if (ch === '\t') { out += '\\t'; continue; }
      out += ch;
    } else { if (ch === '"') ins = true; out += ch; }
  }
  try { return JSON.parse(out); } catch { return null; }
}

// ══ CHAT — Pregúntale a GP ══════════════════════════════════════════════════════════════════
// El server resuelve la entidad con los resolvers deterministas de siempre y arma un BUNDLE de
// datos de los engines. El LLM SOLO redacta desde ese bundle, en el idioma del usuario. Regla
// dura en el prompt: ningún número que no esté en el bundle; si el dato no está, se dice.
// V2 (3-ago, corrección de Alexis): el chat es un AGENTE con herramientas — el modelo BUSCA en la
// plataforma (agenda, detalle, picks, valor) en vez de recibir un bundle pre-armado. Eso le da: resolver
// "la pelea del sábado" (mira la agenda con la fecha de hoy), hilos multi-turno (la conversación entera
// viaja en messages) y paridad fútbol/combate. La doctrina no cambia: las herramientas devuelven SOLO
// factores traducidos y números de los engines; el modelo redacta, jamás calcula.
const ASK_AGENT_SYSTEM = `Eres GP, el analista asistente de GP Simulador (plataforma de inteligencia deportiva). Respondes preguntas de usuarios sobre la plataforma usando las HERRAMIENTAS disponibles, que consultan los datos reales del modelo.

REGLAS ABSOLUTAS:
1. Cada número que menciones (probabilidades, cuotas, récords, estadísticas, fechas) debe salir de un resultado de herramienta de ESTA conversación. Jamás inventes, estimes ni respondas de memoria — ni siquiera cosas que "sabes" del deporte.
2. Usa las herramientas con iniciativa: si preguntan por "el sábado", "mañana" o "la próxima jornada", consulta la agenda con la FECHA ACTUAL que tienes abajo y deduce el día. Si preguntan por un cruce concreto, pide el detalle. Encadena hasta 3 consultas si hace falta.
3. Si tras consultar no hay dato, dilo con naturalidad ("no tengo ese dato cargado") y ofrece lo que sí encontraste.
4. Nunca expliques la mecánica interna del modelo (features, pesos, fórmulas, calibración). Los factores que las herramientas devuelven ya vienen con nombre de producto — usa esos nombres y nada más.
5. No des consejo financiero. Si hablas de una jugada, cierra recordando que son estimaciones de un modelo estadístico, no consejo financiero.
6. Responde en el idioma indicado en IDIOMA. Tono: analista cercano, directo, 2-5 frases (más si piden un desglose). TEXTO PLANO: nada de markdown, asteriscos, encabezados ni viñetas.
7. Mantén el hilo: si la conversación venía hablando de una pelea o un partido y la nueva pregunta no nombra otro, sigue con ese sujeto.
8. Si asumes el sujeto (p. ej. el estelar de la próxima cartelera), decláralo al empezar.`;

async function askAgent({ q, lang, hist, tools, runTool, sportLabel, extraCtx }) {
  const now = new Date();
  const DOW_ES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const sys = ASK_AGENT_SYSTEM
    + `\n\nFECHA ACTUAL: ${now.toISOString().slice(0, 16)}Z (${DOW_ES[now.getUTCDay()]})`
    + `\nSECCIÓN ACTIVA: ${sportLabel}`
    + (extraCtx ? `\n${extraCtx}` : '');
  const messages = [];
  for (const h of (hist || []).slice(-6)) {
    if (h.q) messages.push({ role: 'user', content: String(h.q).slice(0, 400) });
    if (h.answer) messages.push({ role: 'assistant', content: String(h.answer).slice(0, 900) });
  }
  messages.push({ role: 'user', content: `IDIOMA: ${lang === 'en' ? 'inglés' : 'español'}\n${q}` });
  let toolCalls = 0;
  for (let iter = 0; iter < 5; iter++) {
    const resp = await call({ kind: 'chat', system: sys, cacheSystem: true, tools, max_tokens: 600, messages });
    const tus = (resp.content || []).filter((b) => b.type === 'tool_use');
    if (resp.stop_reason !== 'tool_use' || !tus.length || toolCalls >= 4) {
      return { answer: textOf(resp) || null, tool_calls: toolCalls };
    }
    messages.push({ role: 'assistant', content: resp.content });
    const results = [];
    for (const tu of tus) {
      toolCalls++;
      let out;
      try { out = await runTool(tu.name, tu.input || {}); }
      catch (e) { out = { error: String(e.message || e).slice(0, 120) }; }
      results.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(out).slice(0, 6000) });
    }
    messages.push({ role: 'user', content: results });
  }
  return { answer: null, tool_calls: toolCalls };
}

const ASK_SYSTEM = `Eres GP, el asistente de GP Simulador (plataforma de inteligencia deportiva). Respondes preguntas de usuarios sobre partidos, equipos, peleas y peleadores usando EXCLUSIVAMENTE los datos del bloque DATOS que acompaña cada pregunta.

REGLAS ABSOLUTAS:
1. Cada número que menciones (probabilidades, cuotas, récords, estadísticas) debe salir literalmente del bloque DATOS. Jamás inventes, estimes ni redondees de memoria.
2. Si el dato que piden no está en DATOS, dilo con naturalidad ("no tengo ese dato cargado") y ofrece lo que sí tienes.
3. Nunca expliques cómo funciona el modelo por dentro (features, pesos, fórmulas, calibración). Si preguntan, di que el modelo pondera factores del enfrentamiento y menciona solo los factores que ya vienen nombrados en DATOS.
4. No des consejo financiero. Si hablas de una jugada, cierra con la idea de que son estimaciones de un modelo estadístico, no consejo financiero.
5. Responde en el idioma indicado en IDIOMA. Tono: analista cercano, directo, 2-4 frases, sin listas salvo que pidan varios datos. Usa los apellidos de jugadores/peleadores como haría un comentarista. TEXTO PLANO: nada de markdown (ni asteriscos, ni encabezados, ni viñetas) — la interfaz no lo renderiza.
6. Si DATOS trae "assumed": aclara primero de qué partido/pelea estás hablando.`;

async function askWrite({ q, lang, bundle }) {
  const resp = await call({
    kind: 'chat',
    system: ASK_SYSTEM,
    cacheSystem: true,
    max_tokens: 350,
    messages: [{ role: 'user', content: `IDIOMA: ${lang === 'en' ? 'inglés' : 'español'}\nPREGUNTA: ${q}\nDATOS: ${JSON.stringify(bundle)}` }],
  });
  return textOf(resp) || null;
}

// ══ REDACTOR — why de picks y brief narrado ═════════════════════════════════════════════════
// Entra: factores ya templados (la narrativa de plantilla actual + campos legibles de la pick).
// Sale: {es, en}. El prompt prohíbe números nuevos; la plantilla vieja queda de respaldo.
async function writePickWhy(payload) {
  const resp = await call({
    kind: 'writer',
    max_tokens: 420,
    system: 'Eres el redactor de GP Simulador. Reescribes la justificación de una pick deportiva como lo haría un analista profesional: natural, concreta, sin hype. PROHIBIDO: inventar números o datos que no estén en el JSON de entrada; mencionar cómo funciona el modelo por dentro; prometer resultados. Obligatorio: 2-3 frases por idioma, terminando con la idea de valor vs mercado cuando el edge esté en la entrada. Responde SOLO un JSON {"es":"...","en":"..."}.',
    messages: [{ role: 'user', content: JSON.stringify(payload) }],
  });
  const j = jsonOf(resp);
  return j && j.es && j.en ? { es: String(j.es).slice(0, 600), en: String(j.en).slice(0, 600) } : null;
}

// ── Redactor PROFUNDO de combate (12-ago, orden de Alexis: análisis "de pronosticador de élite") ──
// La PROBABILIDAD la pone el modelo estadístico (calibrado, backtesteado); la PROFUNDIDAD la pone este
// redactor, anclado SOLO al dossier (breakdown + film + estilos + intel + método + historial + mercado).
// Doctrina de caja negra intacta: narra la pelea y sus números, jamás el mecanismo del sistema.
async function writeFightRead(payload) {
  const resp = await call({
    kind: 'writer',
    max_tokens: 900,
    system: 'Eres el analista de combate de GP Simulador, al nivel de un pronosticador de élite. Con el dossier JSON escribe la lectura de la pelea para la pick indicada, en DOS párrafos por idioma: (1) LA TESIS — qué inclina la pelea a favor de la pick y su CAMINO de victoria concreto (dónde y cómo gana: distancia, presión, derribos, control, desgaste tardío), citando los números del dossier que lo sustentan; (2) EL RIESGO — el mejor argumento del rival y la señal concreta que invalidaría la tesis (qué habría que ver en la jaula para saber que salió mal). Si el dossier trae edge vs mercado, cierra con UNA frase sobre el valor del precio. PROHIBIDO: inventar datos que no estén en el JSON; describir el funcionamiento interno del sistema; prometer resultados; hype. Tono: analista profesional, concreto, sin relleno. Responde SOLO un JSON {"es":"...","en":"..."} en UNA línea — separa los dos párrafos con \\n\\n dentro del string, jamás con saltos de línea literales.',
    messages: [{ role: 'user', content: JSON.stringify(payload) }],
  });
  const j = jsonOf(resp);
  return j && j.es && j.en ? { es: String(j.es).slice(0, 1400), en: String(j.en).slice(0, 1400) } : null;
}

async function writeBrief(payload, sport) {
  const resp = await call({
    kind: 'writer',
    max_tokens: 700,
    system: `Eres el analista jefe de GP Simulador escribiendo la apertura del brief diario de ${sport === 'combat' ? 'combate (UFC/MMA)' : 'fútbol'}. Con los datos del JSON, escribe UN párrafo de apertura (4-6 frases) que le diga al usuario qué mirar hoy: los cruces más interesantes, dónde el modelo y el mercado se separan, y qué señales hay. Solo números presentes en el JSON. Sin listas, sin encabezados, tono de newsletter premium. Cierra sin despedida. Responde SOLO un JSON {"es":"...","en":"..."}.`,
    messages: [{ role: 'user', content: JSON.stringify(payload) }],
  });
  const j = jsonOf(resp);
  return j && j.es && j.en ? { es: String(j.es).slice(0, 1200), en: String(j.en).slice(0, 1200) } : null;
}

// ══ EXTRACTOR — observer (la pata que puede mejorar el rendimiento) ═════════════════════════
// Entra: lote de titulares/snippets de noticias con el nombre del sujeto. Sale: señales tipadas.
// Es EXTRACCIÓN (doctrina): el resultado se guarda versionado y solo llega a display; si algún
// día una señal quiere entrar al modelo, paga el peaje completo de backtest primero.
async function extractSignals(items, domain) {
  if (!items.length) return [];
  const resp = await call({
    kind: 'extract',
    max_tokens: 900,
    system: `Extraes señales estructuradas de titulares deportivos de ${domain === 'combat' ? 'MMA/boxeo' : 'fútbol'}. Para cada item devuelve una señal SOLO si el texto la afirma sobre EL SUJETO indicado (no sobre su rival ni terceros). Tipos: OUT (baja confirmada de la pelea/partido), INJURY (lesión sin baja confirmada), WEIGHT (falló o luchará por dar el peso, hospitalizado en el corte), REPLACEMENT (entra como reemplazo / short notice), CAMP (cambio de campamento/equipo técnico), SUSPENDED (suspensión), DOUBT (en duda). Severidad: 1 leve, 2 media, 3 grave. Ignora clickbait, rumores de terceros y noticias de otra pelea/partido. Responde SOLO un JSON: [{"i":<índice del item>,"type":"...","severity":1|2|3,"quote":"fragmento textual que lo sustenta"}] — array vacío si no hay señales.`,
    messages: [{ role: 'user', content: JSON.stringify(items.map((x, i) => ({ i, subject: x.subject, title: x.title, snippet: (x.snippet || '').slice(0, 300) }))) }],
  });
  const j = jsonOf(resp);
  if (!Array.isArray(j)) return [];
  const TYPES = new Set(['OUT', 'INJURY', 'WEIGHT', 'REPLACEMENT', 'CAMP', 'SUSPENDED', 'DOUBT']);
  return j.filter((s) => s && TYPES.has(s.type) && items[s.i])
    .map((s) => ({ i: s.i, type: s.type, severity: Math.max(1, Math.min(3, +s.severity || 1)), quote: String(s.quote || '').slice(0, 200) }));
}

module.exports = { init, enabled, budgetOk, usage, call, textOf, jsonOf, askWrite, askAgent, writePickWhy, writeFightRead, writeBrief, extractSignals };
