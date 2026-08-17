// llm.js — la ÚNICA puerta al LLM (Anthropic Messages API). Node puro, sin dependencias.
//
// DOCTRINA (acordada 2-ago, ver memoria gp-llm-doctrina): el LLM EXTRAE datos y REDACTA prosa
// desde factores YA computados por los engines. JAMÁS produce una probabilidad, un edge ni una
// pick, y jamás toca el λ. La caja negra se protege AQUÍ, en la capa de datos: a las llamadas
// solo entran factores TRADUCIDOS (etiquetas de producto: "ventaja de alcance", "desgaste de
// carrera"), nunca pesos, fórmulas ni nombres de features. El modelo no puede filtrar lo que
// nunca recibe.
//
// CONTROLES DE COSTO — PRESUPUESTO QUE NO SE AGOTA (15-ago, saldo recargado a $20):
//  - El gasto diario NO es una constante: se deriva del SALDO RESTANTE dividido por un horizonte
//    (GP_LLM_HORIZON_DAYS, default 30). Gastar cada día 1/30 de lo que queda es una caída
//    geométrica: el saldo tiende a cero pero nunca lo toca, así que el LLM NUNCA se apaga solo.
//    Con $20 y horizonte 30 arranca en ~$0.67/día y va bajando si no se recarga.
//  - RESERVA PARA EL CHAT: los jobs de fondo (redactor, extractor, brief) cortan antes que el chat.
//    Un usuario preguntándole a GP siempre encuentra presupuesto aunque los jobs se lo hayan comido.
//    GP_LLM_CHAT_RESERVE (default 0.35) = fracción del día intocable para el chat.
//  - Suelo y techo: GP_LLM_DAILY_MIN_USD (0.10) y GP_LLM_DAILY_MAX_USD (3). GP_LLM_DAILY_USD, si
//    está puesta, actúa como TECHO adicional (compatibilidad con la configuración vieja).
//  - Contabilidad del saldo en db.llmBalance (recarga, gastado, restante) — sobrevive reinicios y
//    se reinicia sola cuando cambia GP_LLM_BALANCE_USD/AT (o sea: cuando Alexis recarga).
//  - Medidor diario persistente en db.llmUsage (día, llamadas, tokens, USD, por-uso).
//    Todo visible en /api/internal/llm.
//  - Al agotarse el presupuesto del día, TODAS las rutas LLM degradan en silencio al comportamiento
//    por plantillas de siempre. Nada se rompe.
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

// ── SALDO ────────────────────────────────────────────────────────────────────────────────────────
// GP_LLM_BALANCE_USD = cuánto se recargó en la consola de Anthropic. GP_LLM_BALANCE_AT = etiqueta de
// esa recarga (una fecha sirve). Cambiar cualquiera de las dos = recarga nueva → el contador de
// gastado vuelve a cero. Sin GP_LLM_BALANCE_USD el saldo es "desconocido" (Infinity) y todo se
// comporta como antes: manda GP_LLM_DAILY_USD.
function balance() {
  const at = String(process.env.GP_LLM_BALANCE_AT || '');
  const loaded = +(process.env.GP_LLM_BALANCE_USD || 0);
  let b = _db.llmBalance;
  if (!b || b.at !== at || b.loaded_usd !== loaded) {
    b = _db.llmBalance = { at, loaded_usd: loaded, spent_usd: 0, since: new Date().toISOString(), alerted: false };
    // Una RECARGA reabre el día: el gasto de hoy se hizo con las reglas viejas y contra el saldo viejo.
    // Sin esto, recargar a media tarde deja el LLM apagado hasta la medianoche — justo lo contrario de lo
    // que significa recargar. El acumulado histórico (total_usd) se conserva.
    if (_db.llmUsage) { _db.llmUsage.usd = 0; _db.llmUsage.calls = 0; _db.llmUsage.by = {}; _db.llmUsage.reopened_at = new Date().toISOString(); }
  }
  return b;
}
function remainingUsd() {
  const b = balance();
  if (!(b.loaded_usd > 0)) return Infinity;                       // saldo no declarado
  return Math.max(0, +(b.loaded_usd - b.spent_usd).toFixed(5));
}
// Presupuesto del día: 1/horizonte de lo que queda, con suelo, techo y el techo heredado de la env.
function dailyBudget() {
  const envCap = process.env.GP_LLM_DAILY_USD ? +process.env.GP_LLM_DAILY_USD : null;
  const rem = remainingUsd();
  if (!isFinite(rem)) return envCap != null ? envCap : 1.5;
  const horizon = Math.max(1, +(process.env.GP_LLM_HORIZON_DAYS || 30));
  const hi = +(process.env.GP_LLM_DAILY_MAX_USD || 3);
  // El SUELO también es relativo: nunca más de 1/5 de lo que queda. Sin esto, un suelo fijo de $0.10
  // vaciaría la cuenta linealmente al final; con esto el gasto sigue siendo una fracción del saldo y
  // la caída es geométrica — el LLM nunca se apaga por saldo, solo pide recarga (flag `low`).
  const lo = Math.min(Math.max(0, +(process.env.GP_LLM_DAILY_MIN_USD || 0.1)), rem / 5);
  let d = Math.max(lo, rem / horizon);
  d = Math.min(hi, d, rem);                                        // jamás por encima de lo que queda
  if (envCap != null) d = Math.min(d, envCap);
  return +d.toFixed(5);
}
// Techo por PRIORIDAD. El chat (usuario esperando una respuesta) llega al presupuesto completo; los
// jobs de fondo se frenan antes, dejando la reserva intacta.
function tierCap(tier) {
  const d = dailyBudget();
  if (tier === 'chat') return d;
  const r = Math.min(0.9, Math.max(0, +(process.env.GP_LLM_CHAT_RESERVE || 0.35)));
  return +(d * (1 - r)).toFixed(5);
}
function usage() {
  const day = new Date().toISOString().slice(0, 10);
  if (!_db.llmUsage || _db.llmUsage.day !== day) {
    const total = (_db.llmUsage && _db.llmUsage.total_usd) || 0;
    _db.llmUsage = { day, calls: 0, in_tokens: 0, out_tokens: 0, usd: 0, by: {}, errors: 0, total_usd: total };
  }
  return _db.llmUsage;
}
// budgetOk() sin argumento = tier de fondo (así lo llaman todos los jobs existentes, y es el
// comportamiento conservador correcto). budgetOk('chat') para lo interactivo.
function budgetOk(tier) { return usage().usd < tierCap(tier === 'chat' ? 'chat' : 'bg'); }
// Foto completa para el panel admin y /api/internal/llm.
function budgetState() {
  const u = usage(), b = balance(), rem = remainingUsd();
  const daily = dailyBudget();
  const days = isFinite(rem) && daily > 0 ? Math.floor(rem / daily) : null;
  return {
    enabled: enabled(),
    loaded_usd: b.loaded_usd || 0, loaded_at: b.at || null, since: b.since || null,
    spent_usd: +(b.spent_usd || 0).toFixed(4),
    remaining_usd: isFinite(rem) ? +rem.toFixed(4) : null,
    pct_left: isFinite(rem) && b.loaded_usd > 0 ? +(100 * rem / b.loaded_usd).toFixed(1) : null,
    horizon_days: Math.max(1, +(process.env.GP_LLM_HORIZON_DAYS || 30)),
    daily_budget_usd: daily,
    bg_cap_usd: tierCap('bg'),
    chat_reserve_pct: +(100 * Math.min(0.9, Math.max(0, +(process.env.GP_LLM_CHAT_RESERVE || 0.35)))).toFixed(0),
    today_usd: +(u.usd || 0).toFixed(4), today_calls: u.calls || 0,
    today_left_usd: +Math.max(0, daily - (u.usd || 0)).toFixed(4),
    bg_open: budgetOk('bg'), chat_open: budgetOk('chat'),
    days_at_this_rate: days,
    low: isFinite(rem) && b.loaded_usd > 0 && rem < b.loaded_usd * 0.15,
  };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Llamada base. kind decide el modelo; el medidor carga el costo al uso que la originó.
async function call({ kind = 'chat', system, messages, tools, max_tokens = 512, cacheSystem = false }) {
  if (!enabled()) throw new Error('llm_disabled');
  const u = usage();
  // El corte depende de QUIÉN llama: el chat puede usar todo el día, los jobs respetan la reserva.
  if (u.usd >= tierCap(kind === 'chat' ? 'chat' : 'bg')) throw new Error('llm_budget');
  if (remainingUsd() <= 0) throw new Error('llm_balance');
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
    const b = balance(); b.spent_usd = +((b.spent_usd || 0) + cost).toFixed(5);   // el saldo se descuenta acá
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
    max_tokens: 3000, // 12-ago: dossiers ricos (estelares) truncaban a 900 y a 1800 → JSON inválido; 3000 + límite de palabras en el prompt
    system: 'Eres el analista de combate de GP Simulador, al nivel de un pronosticador de élite. Con el dossier JSON escribe la lectura de la pelea para la pick indicada, en DOS párrafos por idioma (máximo 110 palabras por párrafo — la brevedad es parte del oficio): (1) LA TESIS — qué inclina la pelea a favor de la pick y su CAMINO de victoria concreto (dónde y cómo gana: distancia, presión, derribos, control, desgaste tardío), citando los números del dossier que lo sustentan; (2) EL RIESGO — el mejor argumento del rival y la señal concreta que invalidaría la tesis (qué habría que ver en la jaula para saber que salió mal). Si el dossier trae edge vs mercado, cierra con UNA frase sobre el valor del precio. PROHIBIDO: inventar datos que no estén en el JSON; describir el funcionamiento interno del sistema; prometer resultados; hype. Tono: analista profesional, concreto, sin relleno. Responde SOLO un JSON {"es":"...","en":"..."} en UNA línea — separa los dos párrafos con \\n\\n dentro del string, jamás con saltos de línea literales.',
    messages: [{ role: 'user', content: JSON.stringify(payload) }],
  });
  const j = jsonOf(resp);
  if (!j || !j.es || !j.en) {
    // diagnóstico visible (12-ago: la lectura de Garry caía en silencio): qué devolvió el modelo
    console.error('[llm] writeFightRead sin JSON usable · stop:', (resp && resp.stop_reason) || '?', '· texto:', textOf(resp).slice(0, 220).replace(/\n/g, ' '));
    return null;
  }
  return { es: String(j.es).slice(0, 1400), en: String(j.en).slice(0, 1400) };
}

// ── Redactor PROFUNDO de la PELEA (12-ago, Punto 1 de Alexis: "esa narrativa e inteligencia también
// en la pelea, no solo en el porqué de la pick"). Mismo estándar que writeFightRead pero orientado al
// CRUCE completo: la lectura vive en el cockpit de la pelea y la ve cualquier plan, así que JAMÁS debe
// nombrar la pick ni hablar de apuestas — analiza; si el dossier trae la lectura de la casa, la tesis
// debe ser COHERENTE con ella (jamás contradecirla), pero sin mencionarla.
async function writeFightPreview(payload) {
  const resp = await call({
    kind: 'writer',
    max_tokens: 3000,
    system: 'Eres el analista de combate de GP Simulador, al nivel de un pronosticador de élite. Con el dossier JSON escribe la lectura profunda de la PELEA, en DOS párrafos por idioma (máximo 110 palabras por párrafo — la brevedad es parte del oficio). REGLA MAESTRA: el favorito del pronóstico es EXACTAMENTE "favorito_gp.nombre" con su probabilidad — esa es la lectura del sistema y tu tesis la defiende SIEMPRE, aunque tu conocimiento previo o el campo "mercado" digan lo contrario; si "mercado" discrepa de favorito_gp, esa discrepancia ES parte del análisis (qué está viendo el sistema que el consenso no pondera), jamás una razón para cambiar de bando. (1) LA FORMA DE LA PELEA — cómo se pelea este cruce y el camino concreto de favorito_gp (distancia, presión, derribos, control, desgaste tardío), citando los números del dossier que lo sustentan; (2) EL CAMINO DEL OTRO — el mejor argumento del rival, la señal temprana de que la pelea se torció y qué factor la haría cerrada. Si "lectura_de_la_casa" viene en el dossier, tu tesis debe ser coherente con ese lado SIN nombrarla. PROHIBIDO: mencionar picks, apuestas, cuotas, edge o valor; contradecir a favorito_gp; inventar datos que no estén en el JSON; describir el funcionamiento interno del sistema; prometer resultados; hype. Tono: analista profesional, concreto, sin relleno. Responde SOLO un JSON {"es":"...","en":"..."} en UNA línea — separa los dos párrafos con \\n\\n dentro del string, jamás con saltos de línea literales.',
    messages: [{ role: 'user', content: JSON.stringify(payload) }],
  });
  const j = jsonOf(resp);
  if (!j || !j.es || !j.en) {
    console.error('[llm] writeFightPreview sin JSON usable · stop:', (resp && resp.stop_reason) || '?', '· texto:', textOf(resp).slice(0, 220).replace(/\n/g, ' '));
    return null;
  }
  return { es: String(j.es).slice(0, 1400), en: String(j.en).slice(0, 1400) };
}

// ── Redactor PROFUNDO de BALONCESTO (15-ago, B5) ──────────────────────────────────────────────
// Mismo estándar que la lectura de combate, con la gramática del baloncesto: ritmo, eficiencia, dónde
// se gana el partido (zonas de tiro), rebote, pérdidas y el reparto de minutos. La probabilidad la pone
// el simulador; acá se narra POR QUÉ el partido tiene esa forma. Vive en el cockpit del partido y la ve
// cualquier plan → JAMÁS habla de picks ni de apuestas.
async function writeGameRead(payload) {
  const resp = await call({
    kind: 'writer',
    max_tokens: 3000,
    system: 'Eres el analista de baloncesto de GP Simulador, al nivel de un scout profesional. Con el dossier JSON escribe la lectura del PARTIDO en DOS párrafos por idioma (máximo 110 palabras por párrafo). REGLA MAESTRA: el favorito es EXACTAMENTE "favorito_gp.nombre" con su probabilidad — tu tesis lo defiende SIEMPRE, aunque el campo "mercado" diga otra cosa; si el mercado discrepa, esa discrepancia ES parte del análisis, nunca una razón para cambiar de bando. (1) LA FORMA DEL PARTIDO — a qué ritmo se juega, quién impone su tempo, dónde se gana en la cancha (aro, triple, línea de tiros libres, rebote ofensivo, pérdidas) y qué jugadores lo deciden, citando los números del dossier. (2) EL CAMINO DEL OTRO — el mejor argumento del rival, qué señal temprana diría que el partido se torció y qué factor lo volvería cerrado. PROHIBIDO: mencionar picks, apuestas, cuotas, edge o valor; contradecir a favorito_gp; inventar datos que no estén en el JSON; describir el funcionamiento interno del sistema; hype. NOMBRÁ CADA MÉTRICA COMO VIENE EN EL JSON: si el campo dice tiro_efectivo_pct escribí \"tiro efectivo\", jamás \"TS%\" ni ningún otro acrónimo — son métricas distintas y renombrarlas es inventar un dato. Tono: analista concreto, sin relleno. Responde SOLO un JSON {"es":"...","en":"..."} en UNA línea — separa los dos párrafos con \\n\\n dentro del string, jamás con saltos de línea literales.',
    messages: [{ role: 'user', content: JSON.stringify(payload) }],
  });
  const j = jsonOf(resp);
  if (!j || !j.es || !j.en) {
    console.error('[llm] writeGameRead sin JSON usable · stop:', (resp && resp.stop_reason) || '?', '· texto:', textOf(resp).slice(0, 220).replace(/\n/g, ' '));
    return null;
  }
  return { es: String(j.es).slice(0, 1400), en: String(j.en).slice(0, 1400) };
}

const BRIEF_SPORT = { combat: 'combate (UFC/MMA)', hoops: 'baloncesto (NBA/WNBA/NCAA)', futbol: 'fútbol' };
async function writeBrief(payload, sport) {
  const resp = await call({
    kind: 'writer',
    // 15-ago: 700 se quedaba corto con jornadas de 10 partidos → el JSON salía truncado y jsonOf devolvía
    // null, o sea brief sin apertura y en silencio. Mismo patrón que ya había pasado con las lecturas de
    // combate. Se sube el techo Y se acota el largo en el prompt, que es lo que de verdad controla el costo.
    max_tokens: 1400,
    system: `Eres el analista jefe de GP Simulador escribiendo la apertura del brief diario de ${BRIEF_SPORT[sport] || BRIEF_SPORT.futbol}. Con los datos del JSON, escribe UN párrafo de apertura (4-6 frases, máximo 130 palabras por idioma) que le diga al usuario qué mirar hoy: los cruces más interesantes, dónde el modelo y el mercado se separan, y qué señales hay. Solo números presentes en el JSON. Sin listas, sin encabezados, tono de newsletter premium. Cierra sin despedida. Responde SOLO un JSON {"es":"...","en":"..."} en UNA línea, sin saltos de línea literales dentro de los strings.`,
    messages: [{ role: 'user', content: JSON.stringify(payload) }],
  });
  const j = jsonOf(resp);
  if (!j || !j.es || !j.en) {
    console.error('[llm] writeBrief sin JSON usable · deporte:', sport, '· stop:', (resp && resp.stop_reason) || '?', '· texto:', textOf(resp).slice(0, 200).replace(/\n/g, ' '));
    return null;
  }
  return { es: String(j.es).slice(0, 1200), en: String(j.en).slice(0, 1200) };
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

// ── Redactores de NFL y CS2 (17-ago, v2) ──────────────────────────────────────────────────────────
// Mismas reglas maestras que la lectura de baloncesto: el favorito del dossier se defiende SIEMPRE, cero
// picks/cuotas/edge, cero datos inventados, y cada métrica se nombra como viene en el JSON.
async function writeNflRead(payload) {
  const resp = await call({
    kind: 'writer',
    max_tokens: 3000,
    system: 'Eres el analista de NFL de GP Simulador, al nivel de un scout profesional. Con el dossier JSON escribe la lectura del PARTIDO en DOS párrafos por idioma (máximo 110 palabras por párrafo). REGLA MAESTRA: el favorito es EXACTAMENTE "favorito_gp.nombre" con su probabilidad — tu tesis lo defiende SIEMPRE; si el "mercado" del dossier discrepa, esa discrepancia ES parte del análisis, jamás una razón para cambiar de bando. (1) LA FORMA DEL PARTIDO — de dónde sale la ventaja (pase o carrera, ofensa o defensa, citando los EPA del dossier), qué dice la diferencia de rating, cómo pesan el descanso, la sede o el clima si vienen en el JSON, y qué QB/entrenador conduce cada lado. (2) EL CAMINO DEL OTRO — el mejor argumento del rival con sus números, qué señal temprana diría que el partido se torció y qué lo volvería cerrado; si la incertidumbre del dossier es alta (inicio de temporada), DILO con su número. PROHIBIDO: mencionar picks, apuestas, cuotas, spread como recomendación, edge o valor; contradecir a favorito_gp; inventar datos; hype. Nombra cada métrica como viene en el JSON. Tono: analista concreto. Responde SOLO un JSON {"es":"...","en":"..."} en UNA línea — separa párrafos con \\n\\n dentro del string.',
    messages: [{ role: 'user', content: JSON.stringify(payload) }],
  });
  const j = jsonOf(resp);
  if (!j || !j.es || !j.en) { console.error('[llm] writeNflRead sin JSON usable · stop:', (resp && resp.stop_reason) || '?'); return null; }
  return { es: String(j.es).slice(0, 1400), en: String(j.en).slice(0, 1400) };
}
async function writeCs2Read(payload) {
  const resp = await call({
    kind: 'writer',
    max_tokens: 3000,
    system: 'Eres el analista de Counter-Strike 2 de GP Simulador, al nivel de un coach profesional. Con el dossier JSON escribe la lectura de la SERIE en DOS párrafos por idioma (máximo 110 palabras por párrafo). REGLA MAESTRA: el favorito es EXACTAMENTE "favorito_gp.nombre" con su probabilidad — tu tesis lo defiende SIEMPRE; si el mercado del dossier discrepa, esa discrepancia ES parte del análisis. (1) LA FORMA DE LA SERIE — dónde se decide el veto (qué mapas favorecen a cada lado según los efectos por mapa del dossier), la diferencia de Elo, la forma reciente y el historial directo si vienen, y qué jugadores cargan el equipo si el dossier trae ratings. (2) EL CAMINO DEL OTRO — el mejor mapa del rival, qué pasaría en el veto para que la serie se torciera, y el aviso de plantilla movida si el dossier lo marca. PROHIBIDO: picks, apuestas, cuotas, edge o valor; contradecir a favorito_gp; inventar mapas o datos; hype. Nombra cada métrica como viene en el JSON. Tono: analista concreto. Responde SOLO un JSON {"es":"...","en":"..."} en UNA línea — separa párrafos con \\n\\n dentro del string.',
    messages: [{ role: 'user', content: JSON.stringify(payload) }],
  });
  const j = jsonOf(resp);
  if (!j || !j.es || !j.en) { console.error('[llm] writeCs2Read sin JSON usable · stop:', (resp && resp.stop_reason) || '?'); return null; }
  return { es: String(j.es).slice(0, 1400), en: String(j.en).slice(0, 1400) };
}

module.exports = { init, enabled, budgetOk, budgetState, dailyBudget, remainingUsd, balance, usage, call, textOf, jsonOf, askWrite, askAgent, writePickWhy, writeFightRead, writeFightPreview, writeGameRead, writeBrief, extractSignals, writeNflRead, writeCs2Read };
