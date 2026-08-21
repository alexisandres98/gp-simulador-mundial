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

// ── TRES PROVEEDORES, UNA PUERTA (21-ago) ────────────────────────────────────────────────────────
// Hasta hoy el LLM era Anthropic y punto: cuando se acababa el presupuesto del día, TODO degradaba a
// plantillas. Con dos claves gratuitas encima (Groq y Gemini) la pregunta deja de ser cuánto gastar y
// pasa a ser dónde mandar cada cosa.
//
// EL REPARTO, Y POR QUÉ ES ASÍ:
//   · CHAT → Anthropic. Es lo único que ve texto escrito por usuarios reales, y es lo único que usa
//     herramientas (el formato de tools de Anthropic no es el de nadie más). Además ahora le sobra
//     presupuesto, porque los redactores han dejado de comérselo.
//   · REDACTORES → Gemini, con Groq detrás. Solo ven factores YA traducidos (etiquetas de producto),
//     jamás pesos ni fórmulas: la doctrina de caja negra se cumple igual con proveedor gratis. Gemini
//     escribe mejor español y respeta esquema JSON nativo; Groq responde en menos de un segundo.
//   · EXTRACTOR → Groq. Extracción estructurada, sin prosa y sin datos de usuario: velocidad pura.
//
// Y LO QUE DE VERDAD CAMBIA: una cadena. Si el primero falla —límite de tasa, 503, timeout— se prueba
// el siguiente. Un redactor solo cae a plantilla cuando fallan LOS TRES. Antes bastaba con que se
// acabara el día.
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GEMINI_URL = (m) => `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`;
const PROV = {
  anthropic: {
    key: () => process.env.ANTHROPIC_API_KEY || '',
    free: false,
    model: (kind) => (MODELS[kind] ? MODELS[kind]() : MODELS.chat()),
    tools: true,
  },
  groq: {
    key: () => process.env.GROQ_API_KEY || '',
    free: true,
    // gpt-oss-120b es el único del catálogo gratuito que sostiene JSON en español sin romperse
    model: (kind) => (kind === 'extract'
      ? (process.env.GP_LLM_GROQ_EXTRACT || 'openai/gpt-oss-120b')
      : (process.env.GP_LLM_GROQ_MODEL || 'openai/gpt-oss-120b')),
    tools: false,
  },
  gemini: {
    key: () => process.env.GEMINI_API_KEY || '',
    free: true,
    // flash-lite NO gasta tokens de pensamiento: los modelos con razonamiento se comen el techo de
    // salida antes de cerrar el JSON (medido: 1.917 tokens de pensamiento y el JSON truncado)
    model: () => process.env.GP_LLM_GEMINI_MODEL || 'gemini-3.1-flash-lite',
    tools: false,
  },
};
// cadena por uso, configurable sin desplegar
const CHAIN = (kind) => {
  const env = process.env['GP_LLM_CHAIN_' + String(kind).toUpperCase()];
  const def = kind === 'chat' ? 'anthropic,gemini,groq'
    : kind === 'extract' ? 'groq,gemini,anthropic'
      : 'gemini,groq,anthropic';
  return String(env || def).split(',').map((x) => x.trim()).filter((x) => PROV[x] && PROV[x].key());
};

let _db = null, _save = null;
function init(db, save) { _db = db; _save = save; }
// ENCENDIDO = HAY ALGÚN PROVEEDOR. Antes esto exigía la clave de Anthropic, así que quitarla apagaba
// el LLM entero aunque hubiera dos claves gratis puestas.
function enabled() {
  if (String(process.env.GP_LLM_ENABLED || 'true') === 'false') return false;
  return Object.values(PROV).some((p) => !!p.key());
}
// ¿Hay algún proveedor GRATIS disponible para este uso? Si lo hay, el presupuesto deja de ser un
// portón: no hay nada que racionar.
function hayGratis(kind) { return CHAIN(kind).some((n) => PROV[n].free); }

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
// Con un proveedor gratis en la cadena, SIEMPRE hay presupuesto: lo que se raciona es el saldo de
// Anthropic, y lo gratis no lo toca. Sin esto, los jobs seguirían parándose al llegar al tope diario
// aunque tuvieran a Gemini y a Groq esperando.
function budgetOk(tier) {
  const kind = tier === 'chat' ? 'chat' : 'writer';
  if (hayGratis(kind)) return true;
  return usage().usd < tierCap(tier === 'chat' ? 'chat' : 'bg');
}
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
    // el reparto real: qué cadena sirve cada uso y cuánto ha movido hoy cada proveedor
    cadenas: { chat: CHAIN('chat'), writer: CHAIN('writer'), extract: CHAIN('extract') },
    proveedores: Object.fromEntries(Object.entries(PROV).map(([k, v]) => [k, { hay_clave: !!v.key(), gratis: v.free }])),
    hoy_por_proveedor: u.by_prov || {},
  };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── LAS TRES LLAMADAS, CADA UNA EN SU DIALECTO ───────────────────────────────────────────────────
// Las tres devuelven la MISMA forma que devolvía Anthropic —`{content:[{type:'text',text}], usage}`—
// para que ni un solo llamador de arriba se entere de quién contestó. Ese es todo el truco: el
// dialecto se traduce aquí abajo y `textOf`/`jsonOf` siguen funcionando sin tocarse.
async function callAnthropic({ model, system, messages, tools, max_tokens, cacheSystem }) {
  const body = { model, max_tokens, messages };
  if (tools) body.tools = tools;
  if (system) body.system = cacheSystem ? [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }] : system;
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': PROV.anthropic.key(), 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(50000),
  });
  if (r.status === 429 || r.status >= 500) throw new Error('llm_http_' + r.status);
  const j = await r.json().catch(() => null);
  if (!j) throw new Error('llm_badjson');
  if (j.error) throw new Error('llm_api: ' + (j.error.message || j.error.type));
  return j;
}
// Groq habla OpenAI: el system es un mensaje más y el contenido es texto plano.
async function callGroq({ model, system, messages, max_tokens, json }) {
  const ms = [];
  if (system) ms.push({ role: 'system', content: system });
  for (const m of messages || []) {
    ms.push({ role: m.role, content: typeof m.content === 'string' ? m.content
      : (m.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n') });
  }
  const body = { model, messages: ms, max_tokens, temperature: 0.4 };
  // El modo JSON de Groq exige un OBJETO en la raíz. El extractor devuelve un ARRAY, así que activarlo
  // ahí hace fallar la validación y tira la llamada al siguiente de la cadena sin motivo. Se activa solo
  // donde el contrato es un objeto ({es,en}); para el resto manda el prompt y el parser tolerante.
  if (json === 'esen') body.response_format = { type: 'json_object' };
  const r = await fetch(GROQ_URL, {
    method: 'POST',
    headers: { authorization: 'Bearer ' + PROV.groq.key(), 'content-type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(50000),
  });
  if (r.status === 429 || r.status >= 500) throw new Error('llm_http_' + r.status);
  const j = await r.json().catch(() => null);
  if (!j) throw new Error('llm_badjson');
  if (j.error) throw new Error('llm_api: ' + (j.error.message || j.error.code));
  const txt = ((j.choices || [])[0] || {}).message || {};
  const us = j.usage || {};
  return { content: [{ type: 'text', text: txt.content || '' }],
    usage: { input_tokens: us.prompt_tokens || 0, output_tokens: us.completion_tokens || 0 }, _prov: 'groq' };
}
// Gemini tiene su propia forma: systemInstruction aparte, `contents` con role user/model, y un techo de
// salida que INCLUYE el pensamiento — por eso el modelo elegido es uno que no piensa.
async function callGemini({ model, system, messages, max_tokens, json }) {
  const contents = [];
  for (const m of messages || []) {
    const txt = typeof m.content === 'string' ? m.content
      : (m.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    if (!txt) continue;
    contents.push({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: txt }] });
  }
  if (!contents.length) throw new Error('llm_sin_contenido');
  const body = { contents, generationConfig: { maxOutputTokens: max_tokens, temperature: 0.4 } };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  // esquema nativo: pedir {es,en} por contrato es más fiable que pedirlo por prosa
  if (json) {
    body.generationConfig.responseMimeType = 'application/json';
    if (json === 'esen') {
      body.generationConfig.responseSchema = { type: 'OBJECT',
        properties: { es: { type: 'STRING' }, en: { type: 'STRING' } }, required: ['es', 'en'] };
    }
  }
  const r = await fetch(GEMINI_URL(model) + '?key=' + encodeURIComponent(PROV.gemini.key()), {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(50000),
  });
  if (r.status === 429 || r.status >= 500) throw new Error('llm_http_' + r.status);
  const j = await r.json().catch(() => null);
  if (!j) throw new Error('llm_badjson');
  if (j.error) throw new Error('llm_api: ' + (j.error.message || j.error.status));
  const c = (j.candidates || [])[0] || {};
  const text = ((c.content || {}).parts || []).map((p) => p.text || '').join('');
  // MAX_TOKENS con texto a medias devuelve JSON roto: mejor fallar y que la cadena pruebe al siguiente
  if (!text || (c.finishReason && c.finishReason !== 'STOP' && !text.trim().endsWith('}'))) {
    throw new Error('llm_corte_' + (c.finishReason || 'vacio'));
  }
  const us = j.usageMetadata || {};
  return { content: [{ type: 'text', text }],
    usage: { input_tokens: us.promptTokenCount || 0, output_tokens: us.candidatesTokenCount || 0 }, _prov: 'gemini' };
}

// Llamada base. `kind` decide la CADENA de proveedores; el medidor carga el costo al uso que la originó
// y solo los proveedores de pago tocan el saldo.
async function call({ kind = 'chat', system, messages, tools, max_tokens = 512, cacheSystem = false, json = false, _cadena = null }) {
  if (!enabled()) throw new Error('llm_disabled');
  const u = usage();
  // `_cadena` permite forzar proveedores concretos. Lo usa el verificador para no juzgarse a sí mismo.
  const cadena = (_cadena && _cadena.length ? _cadena.filter((n) => PROV[n] && PROV[n].key()) : CHAIN(kind));
  if (!cadena.length) throw new Error('llm_sin_proveedor');
  const errores = [];
  for (const nombre of cadena) {
    const P = PROV[nombre];
    // el presupuesto SOLO frena a los de pago: un proveedor gratis no tiene por qué respetar una
    // reserva que existe para no vaciar una cuenta con saldo
    if (!P.free) {
      if (u.usd >= tierCap(kind === 'chat' ? 'chat' : 'bg')) { errores.push(nombre + ':presupuesto'); continue; }
      if (remainingUsd() <= 0) { errores.push(nombre + ':saldo'); continue; }
    }
    // las herramientas solo las entiende Anthropic: con un llamador que pide tools, el resto de la
    // cadena responde igual pero SIN ellas (degradado y vivo, en vez de muerto)
    const model = P.model(kind);
    for (let att = 0; att < (P.free ? 2 : 3); att++) {
      try {
        let j;
        if (nombre === 'anthropic') j = await callAnthropic({ model, system, messages, tools, max_tokens, cacheSystem });
        else if (nombre === 'groq') j = await callGroq({ model, system, messages, max_tokens, json });
        else j = await callGemini({ model, system, messages, max_tokens, json });
        contabilizar(kind, nombre, model, j);
        j._prov = nombre; j._model = model;
        return j;
      } catch (e) {
        errores.push(nombre + ':' + e.message);
        if (/llm_api|llm_sin_contenido/.test(e.message)) break;      // error de forma: no insistir
        await sleep((P.free ? 700 : 1500) * (att + 1));
      }
    }
  }
  u.errors++;
  const err = new Error('llm_failed: ' + errores.slice(0, 6).join(' | '));
  err.cadena = errores;
  throw err;
}
// El medidor, con el proveedor dentro. Lo gratis suma llamadas y tokens pero cero dólares — y eso hay
// que poder verlo, porque es justo la prueba de que el reparto está funcionando.
function contabilizar(kind, prov, model, j) {
  const u = usage();
  const us = j.usage || {};
  let cost = 0;
  if (prov === 'anthropic') {
    const [pi, po] = PRICES[model] || PRICES['claude-sonnet-5'];
    cost = ((us.input_tokens || 0) + (us.cache_creation_input_tokens || 0) * 1.25) * pi / 1e6
      + (us.cache_read_input_tokens || 0) * pi * 0.1 / 1e6
      + (us.output_tokens || 0) * po / 1e6;
  }
  u.calls++;
  u.in_tokens += (us.input_tokens || 0) + (us.cache_creation_input_tokens || 0) + (us.cache_read_input_tokens || 0);
  u.out_tokens += us.output_tokens || 0;
  u.by_prov = u.by_prov || {};
  const bp = u.by_prov[prov] = u.by_prov[prov] || { calls: 0, in: 0, out: 0, usd: 0 };
  bp.calls++; bp.in += us.input_tokens || 0; bp.out += us.output_tokens || 0;
  if (cost) {
    bp.usd = +(bp.usd + cost).toFixed(5);
    u.usd = +(u.usd + cost).toFixed(5);
    u.total_usd = +((u.total_usd || 0) + cost).toFixed(5);
    u.by[kind] = +((u.by[kind] || 0) + cost).toFixed(5);
    const b = balance(); b.spent_usd = +((b.spent_usd || 0) + cost).toFixed(5);
  }
  if (_save) { try { _save(); } catch { /* el flush normal lo recoge */ } }
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
async function writePickWhy(payload, aviso) {
  const resp = await call({
    kind: 'writer', json: 'esen',
    max_tokens: 420,
    system: 'Eres el redactor de GP Simulador. Reescribes la justificación de una pick deportiva como lo haría un analista profesional: natural, concreta, sin hype. PROHIBIDO: inventar números o datos que no estén en el JSON de entrada; mencionar cómo funciona el modelo por dentro; prometer resultados. Obligatorio: 2-3 frases por idioma, terminando con la idea de valor vs mercado cuando el edge esté en la entrada. Responde SOLO un JSON {"es":"...","en":"..."}.',
    messages: [{ role: 'user', content: JSON.stringify(payload) + (aviso ? '\n\n' + aviso : '') }],
  });
  const j = jsonOf(resp);
  return j && j.es && j.en ? { es: String(j.es).slice(0, 600), en: String(j.en).slice(0, 600), _prov: resp._prov } : null;
}

// ── Redactor PROFUNDO de combate (12-ago, orden de Alexis: análisis "de pronosticador de élite") ──
// La PROBABILIDAD la pone el modelo estadístico (calibrado, backtesteado); la PROFUNDIDAD la pone este
// redactor, anclado SOLO al dossier (breakdown + film + estilos + intel + método + historial + mercado).
// Doctrina de caja negra intacta: narra la pelea y sus números, jamás el mecanismo del sistema.
async function writeFightRead(payload, aviso) {
  const resp = await call({
    kind: 'writer', json: 'esen',
    max_tokens: 3000, // 12-ago: dossiers ricos (estelares) truncaban a 900 y a 1800 → JSON inválido; 3000 + límite de palabras en el prompt
    system: 'Eres el analista de combate de GP Simulador, al nivel de un pronosticador de élite. Con el dossier JSON escribe la lectura de la pelea para la pick indicada, en DOS párrafos por idioma (máximo 110 palabras por párrafo — la brevedad es parte del oficio): (1) LA TESIS — qué inclina la pelea a favor de la pick y su CAMINO de victoria concreto (dónde y cómo gana: distancia, presión, derribos, control, desgaste tardío), citando los números del dossier que lo sustentan; (2) EL RIESGO — el mejor argumento del rival y la señal concreta que invalidaría la tesis (qué habría que ver en la jaula para saber que salió mal). Si el dossier trae edge vs mercado, cierra con UNA frase sobre el valor del precio. PROHIBIDO: inventar datos que no estén en el JSON; describir el funcionamiento interno del sistema; prometer resultados; hype. Tono: analista profesional, concreto, sin relleno. Responde SOLO un JSON {"es":"...","en":"..."} en UNA línea — separa los dos párrafos con \\n\\n dentro del string, jamás con saltos de línea literales.',
    messages: [{ role: 'user', content: JSON.stringify(payload) + (aviso ? '\n\n' + aviso : '') }],
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
async function writeFightPreview(payload, aviso) {
  const resp = await call({
    kind: 'writer', json: 'esen',
    max_tokens: 3000,
    system: 'Eres el analista de combate de GP Simulador, al nivel de un pronosticador de élite. Con el dossier JSON escribe la lectura profunda de la PELEA, en DOS párrafos por idioma (máximo 110 palabras por párrafo — la brevedad es parte del oficio). REGLA MAESTRA: el favorito del pronóstico es EXACTAMENTE "favorito_gp.nombre" con su probabilidad — esa es la lectura del sistema y tu tesis la defiende SIEMPRE, aunque tu conocimiento previo o el campo "mercado" digan lo contrario; si "mercado" discrepa de favorito_gp, esa discrepancia ES parte del análisis (qué está viendo el sistema que el consenso no pondera), jamás una razón para cambiar de bando. (1) LA FORMA DE LA PELEA — cómo se pelea este cruce y el camino concreto de favorito_gp (distancia, presión, derribos, control, desgaste tardío), citando los números del dossier que lo sustentan; (2) EL CAMINO DEL OTRO — el mejor argumento del rival, la señal temprana de que la pelea se torció y qué factor la haría cerrada. Si "lectura_de_la_casa" viene en el dossier, tu tesis debe ser coherente con ese lado SIN nombrarla. PROHIBIDO: mencionar picks, apuestas, cuotas, edge o valor; contradecir a favorito_gp; inventar datos que no estén en el JSON; describir el funcionamiento interno del sistema; prometer resultados; hype. Tono: analista profesional, concreto, sin relleno. Responde SOLO un JSON {"es":"...","en":"..."} en UNA línea — separa los dos párrafos con \\n\\n dentro del string, jamás con saltos de línea literales.',
    messages: [{ role: 'user', content: JSON.stringify(payload) + (aviso ? '\n\n' + aviso : '') }],
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
async function writeGameRead(payload, aviso) {
  const resp = await call({
    kind: 'writer', json: 'esen',
    max_tokens: 3000,
    system: 'Eres el analista de baloncesto de GP Simulador, al nivel de un scout profesional. Con el dossier JSON escribe la lectura del PARTIDO en DOS párrafos por idioma (máximo 110 palabras por párrafo). REGLA MAESTRA: el favorito es EXACTAMENTE "favorito_gp.nombre" con su probabilidad — tu tesis lo defiende SIEMPRE, aunque el campo "mercado" diga otra cosa; si el mercado discrepa, esa discrepancia ES parte del análisis, nunca una razón para cambiar de bando. (1) LA FORMA DEL PARTIDO — a qué ritmo se juega, quién impone su tempo, dónde se gana en la cancha (aro, triple, línea de tiros libres, rebote ofensivo, pérdidas) y qué jugadores lo deciden, citando los números del dossier. (2) EL CAMINO DEL OTRO — el mejor argumento del rival, qué señal temprana diría que el partido se torció y qué factor lo volvería cerrado. PROHIBIDO: mencionar picks, apuestas, cuotas, edge o valor; contradecir a favorito_gp; inventar datos que no estén en el JSON; describir el funcionamiento interno del sistema; hype. NOMBRÁ CADA MÉTRICA COMO VIENE EN EL JSON: si el campo dice tiro_efectivo_pct escribí \"tiro efectivo\", jamás \"TS%\" ni ningún otro acrónimo — son métricas distintas y renombrarlas es inventar un dato. Tono: analista concreto, sin relleno. Responde SOLO un JSON {"es":"...","en":"..."} en UNA línea — separa los dos párrafos con \\n\\n dentro del string, jamás con saltos de línea literales.',
    messages: [{ role: 'user', content: JSON.stringify(payload) + (aviso ? '\n\n' + aviso : '') }],
  });
  const j = jsonOf(resp);
  if (!j || !j.es || !j.en) {
    console.error('[llm] writeGameRead sin JSON usable · stop:', (resp && resp.stop_reason) || '?', '· texto:', textOf(resp).slice(0, 220).replace(/\n/g, ' '));
    return null;
  }
  return { es: String(j.es).slice(0, 1400), en: String(j.en).slice(0, 1400) };
}

const BRIEF_SPORT = { combat: 'combate (UFC/MMA)', hoops: 'baloncesto (NBA/WNBA/NCAA)', futbol: 'fútbol',
  esports: 'esports (CS2, LoL, Valorant y Dota 2)', nfl: 'fútbol americano (NFL, College y CFL)', tennis: 'tenis (ATP y WTA)', f1: 'Fórmula 1' };
// EL `aviso` ES EL TERCER ARGUMENTO DE TODO ESCRITOR (21-ago). Cuando entró el verificador, los nueve
// escritores pasaron a aceptar un aviso final —la lista de números señalados en el intento anterior— y a
// éste se le añadió al prompt pero NO a la firma. Resultado: `aviso` era un identificador libre y la
// función lanzaba ReferenceError en la PRIMERA línea de la llamada, siempre y en todos los deportes. La
// apertura del brief llevaba desde entonces sin escribirse en ningún sitio, y el mensaje que veía el
// usuario —"la apertura narrada no se pudo escribir"— es el mismo que sale cuando el proveedor está
// caído: un fallo de programación disfrazado de fallo de red. Lo caza scripts/llm-smoke.js.
async function writeBrief(payload, sport, aviso = null) {
  const resp = await call({
    kind: 'writer', json: true,
    // 15-ago: 700 se quedaba corto con jornadas de 10 partidos → el JSON salía truncado y jsonOf devolvía
    // null, o sea brief sin apertura y en silencio. Mismo patrón que ya había pasado con las lecturas de
    // combate. Se sube el techo Y se acota el largo en el prompt, que es lo que de verdad controla el costo.
    max_tokens: 1400,
    system: `Eres el analista jefe de GP Simulador escribiendo la apertura del brief diario de ${BRIEF_SPORT[sport] || BRIEF_SPORT.futbol}. Con los datos del JSON, escribe UN párrafo de apertura (4-6 frases, máximo 130 palabras por idioma) que le diga al usuario qué mirar hoy: los cruces más interesantes, dónde el modelo y el mercado se separan, y qué señales hay. Solo números presentes en el JSON. Sin listas, sin encabezados, tono de newsletter premium. Cierra sin despedida. Responde SOLO un JSON {"es":"...","en":"..."} en UNA línea, sin saltos de línea literales dentro de los strings.`,
    messages: [{ role: 'user', content: JSON.stringify(payload) + (aviso ? '\n\n' + aviso : '') }],
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
// LOS OCHO DEPORTES, NO DOS (21-ago). El extractor existía desde julio pero solo corría en fútbol y
// combate — no por diseño sino por factura: cada barrido son ~40 titulares por deporte y con un único
// proveedor de pago extenderlo a ocho multiplicaba por cuatro la parte más cara del sistema. Con dos
// proveedores gratuitos el coste marginal es cero y lo único que queda es el trabajo de hacerlo bien.
//
// CADA DEPORTE TIENE SUS PROPIAS SEÑALES. Un vocabulario común ("lesión, duda, baja") desperdicia lo que
// de verdad mueve el precio en cada disciplina: en esports es el ROSTER —un stand-in cambia el equipo que
// juega, no el que está en el rating— y en fútbol americano es QUIÉN ES EL QUARTERBACK, que vale más que
// el resto de la plantilla junta. Un tipo genérico "cambio en la plantilla" los mete a los dos en el mismo
// saco y pierde exactamente la información por la que se hace esto.
//
// DISPLAY, NUNCA MODELO. Igual que en fútbol y combate: se guarda versionado, se pinta con la cita textual
// que lo sustenta, y si algún día una señal quiere entrar a una probabilidad paga el peaje completo de
// backtest walk-forward. Una señal sin histórico no tiene derecho a mover un número.
const DOMINIOS = {
  futbol: {
    que: 'fútbol',
    sujeto: 'el equipo indicado',
    tipos: {
      OUT: 'baja confirmada para el partido', INJURY: 'lesión sin baja confirmada',
      SUSPENDED: 'sanción o expulsión que le hace perderse el partido', DOUBT: 'en duda',
      RETURN: 'vuelve de lesión o sanción', CAMP: 'cambio de entrenador o cuerpo técnico',
    },
    ruido: 'Ignora clickbait, rumores de fichajes y noticias de otro partido.',
  },
  combat: {
    que: 'MMA/boxeo',
    sujeto: 'el peleador indicado (no su rival ni terceros)',
    tipos: {
      OUT: 'baja confirmada de la pelea', INJURY: 'lesión sin baja confirmada',
      WEIGHT: 'falló o luchará por dar el peso, hospitalizado en el corte',
      REPLACEMENT: 'entra como reemplazo / short notice', CAMP: 'cambio de campamento o equipo técnico',
      SUSPENDED: 'suspensión', DOUBT: 'en duda',
    },
    ruido: 'Ignora clickbait, trash talk, rumores de terceros y noticias de otra pelea.',
  },
  // ESPORTS — la razón principal de extender esto. El rating mide a un EQUIPO, pero quien juega es un
  // quinteto concreto: un stand-in de la academia o un titular con problemas de visado rompen la
  // correspondencia entre el rating y lo que va a estar en el servidor, y eso no lo publica ninguna API.
  esports: {
    que: 'esports (CS2, League of Legends, Valorant, Dota 2)',
    sujeto: 'el equipo indicado (no su rival ni terceros)',
    tipos: {
      ROSTER: 'cambio ANUNCIADO de la plantilla titular: fichaje, salida, traspaso o jugador apartado',
      STANDIN: 'jugará con suplente, stand-in, prestado o jugador de la academia',
      BENCH: 'un titular queda en el banquillo o es apartado del equipo',
      VISA: 'problema de visado, viaje o logística que impide jugar a alguien',
      ILLNESS: 'enfermedad o lesión física de un jugador',
      ORG: 'cambio de entrenador, analista o dirección deportiva',
      FORFEIT: 'el equipo RENUNCIA a jugar: no se presenta, abandona el torneo sin jugar o concede un walkover',
    },
    // EL ERROR QUE HAY QUE MATAR AQUÍ. Probando esto el 21-ago, "FaZe exits Esports World Cup" salió
    // clasificado como FORFEIT: el equipo no renunció a nada, PERDIÓ. Y un equipo eliminado no es una señal
    // —es un resultado— así que la etiqueta habría dicho al usuario que un equipo se retiró cuando lo que
    // pasó fue que cayó en cuartos. Vale más no dar señal que dar una falsa: la falsa se lee como un hecho.
    ruido: 'CRÍTICO: una eliminación NO es una señal, y una RENOVACIÓN de contrato tampoco ("extends", "re-signs", "renews", "amplía contrato"): el equipo sigue siendo el mismo, no ha cambiado nada de cara al próximo partido. "eliminated", "exits", "knocked out", "falls to", "loses to", "advances", "beats" describen un partido YA JUGADO, no algo que vaya a pasar — para esos items devuelve nada. Solo son señales los hechos que afectan a un partido AÚN NO JUGADO. Ignora también rumores sin fuente identificada, contenido de creadores y noticias de otro juego.',
  },
  // TENIS — deporte individual: la baja ES el evento. Una retirada de cuadro previa al partido no es
  // contexto, es que el partido no existe; y una retirada en pista el día anterior dice más de la carga
  // física del jugador que cualquier estadística de saque.
  tennis: {
    que: 'tenis',
    sujeto: 'el jugador o jugadora indicado (no su rival)',
    tipos: {
      OUT: 'se retira del torneo o del cuadro antes de jugar',
      RETIRED: 'abandonó un partido en pista o lo dio por perdido a mitad',
      INJURY: 'lesión física reportada sin retirada confirmada',
      ILLNESS: 'enfermedad, virus o problema físico no traumático',
      DOUBT: 'duda para jugar, tratamiento médico o molestias',
      RETURN: 'vuelve a competir tras lesión o parón',
      WALKOVER: 'pasa de ronda sin jugar porque su rival se retiró',
    },
    ruido: 'Ignora clickbait, declaraciones sin contenido físico y noticias de otro torneo o de años anteriores.',
  },
  // FÚTBOL AMERICANO — la NFL sí publica parte de lesionados estructurado, pero College y CFL no publican
  // NADA que se pueda consumir: ahí la prensa local es la única fuente. Y el QB va como tipo propio porque
  // en este deporte un cambio de titular en esa posición mueve la línea más que cualquier otra noticia.
  amfoot: {
    que: 'fútbol americano (NFL, College football, CFL)',
    sujeto: 'el equipo indicado (no su rival)',
    tipos: {
      QB: 'cambia el quarterback titular, se lesiona o su disponibilidad está en duda',
      OUT: 'un titular importante confirmado fuera del partido',
      INJURY: 'lesión de un titular sin baja confirmada',
      DOUBT: 'titular en duda, questionable o limitado en los entrenamientos',
      SUSPENDED: 'sanción disciplinaria, de la liga o problema de elegibilidad',
      COACH: 'cambio de entrenador jefe o de coordinador ofensivo/defensivo',
    },
    ruido: 'Ignora clickbait, mercado de fichajes fuera de temporada, recruiting y noticias de otra semana.',
  },
};
async function extractSignals(items, domain) {
  if (!items.length) return [];
  const D = DOMINIOS[domain] || DOMINIOS.futbol;
  const tipos = Object.entries(D.tipos).map(([k, v]) => `${k} (${v})`).join(', ');
  const resp = await call({
    kind: 'extract', json: true,
    // EL TOPE VA CON EL TAMAÑO DEL LOTE, Y CON MUCHO AIRE. Estaba fijo en 900 desde que el extractor era
    // solo para fútbol; un lote de doce titulares lo desbordaba, la respuesta salía cortada a mitad de un
    // JSON y el barrido reportaba cero señales sobre noticias que sí las tenían.
    //
    // Y el desborde no era por el JSON: midiéndolo, de 1.056 tokens de salida el JSON eran ~200 y el resto
    // RAZONAMIENTO del modelo, que cuenta contra el mismo tope. Es la segunda vez que este mismo mecanismo
    // nos muerde —antes con los thinking tokens de Gemini— así que aquí queda escrito: en los modelos que
    // razonan, el tope de salida NO es el tamaño de la respuesta, es respuesta + razonamiento. De ahí el
    // suelo de 2.500: no sobra, es lo que cuesta pensar antes de escribir la primera llave.
    max_tokens: Math.min(8000, 2500 + items.length * 200),
    system: `Extraes señales estructuradas de titulares deportivos de ${D.que}. Para cada item devuelve una señal SOLO si el texto la afirma sobre ${D.sujeto}. Tipos: ${tipos}. Severidad: 1 leve, 2 media, 3 grave. ${D.ruido} Responde SOLO un JSON COMPACTO, sin saltos de línea ni sangría: [{"i":<índice del item>,"type":"...","severity":1|2|3,"quote":"<fragmento textual, máximo 12 palabras>"}] — array vacío si no hay señales.`,
    messages: [{ role: 'user', content: JSON.stringify(items.map((x, i) => ({ i, subject: x.subject, title: x.title, snippet: (x.snippet || '').slice(0, 300) }))) }],
  });
  const j = jsonOf(resp);
  // FALLAR EN VOZ ALTA. Devolver [] cuando la respuesta no es usable hacía indistinguible "no hay señales"
  // de "el proveedor se cayó": el barrido reportaba cero y nadie se enteraba. Nos pasó hoy mismo probando
  // tenis, con seis titulares que sí tenían señal. Ahora el barrido lo recoge como llm_error y se ve.
  if (!Array.isArray(j)) throw new Error(`extractSignals sin JSON usable (stop: ${(resp && resp.stop_reason) || '?'})`);
  const TYPES = new Set(Object.keys(D.tipos));
  return j.filter((s) => s && TYPES.has(s.type) && items[s.i])
    .map((s) => ({ i: s.i, type: s.type, severity: Math.max(1, Math.min(3, +s.severity || 1)), quote: String(s.quote || '').slice(0, 200) }));
}

// ── EL VERIFICADOR DE ALUCINACIONES (21-ago) ─────────────────────────────────────────────────────
// EL AGUJERO QUE TAPA. Cada lectura la escribe un modelo a partir de un dossier, y hasta hoy NADIE
// comprobaba que la prosa no se inventara números. La instrucción "prohibido inventar datos" iba en
// todos los prompts y era lo único que había: una petición, no un control. Publicábamos a ciegas.
//
// POR QUÉ SE PUEDE AHORA Y NO ANTES. Verificar cuesta una llamada más por lectura. Con un solo proveedor
// de pago eso duplicaba la factura de la parte más cara del sistema. Con dos proveedores gratuitos cuesta
// cero — y además permite lo que de verdad importa: que verifique OTRO modelo distinto del que escribió.
// Un modelo revisando su propio texto tiende a ratificarse.
//
// CÓDIGO PRIMERO, MODELO DESPUÉS. Preguntarle a un LLM "¿este número está en el JSON?" es pedirle
// exactamente lo que peor hace. Así que el trabajo se reparte: el CÓDIGO extrae los números del texto y
// los del dossier y encuentra los que no casan —eso es aritmética, no criterio— y el MODELO solo juzga
// los sospechosos, que es donde sí hace falta criterio ("31-21" no está en el dossier pero se deduce de
// dos campos que sí están). Sin sospechosos no hay llamada: la mayoría de lecturas se verifican gratis
// y en un milisegundo.
//
// QUÉ SE MIRA Y QUÉ NO. Solo números, porque son lo único falsable: "Stanford es favorito" es un juicio,
// "9,8 puntos" es un hecho. Y no todos los números: se ignoran los enteros pequeños sueltos (un "dos
// párrafos" o un "3 downs" no es una estadística inventada) y se aceptan las formas derivadas obvias
// —×100 para porcentajes, redondeos— porque el dossier trae 0,684 y la prosa escribe 68,4 %.
const VERIF_ON = () => String(process.env.GP_LLM_VERIFY || 'true') !== 'false';

// todos los números del dossier, con sus formas derivadas legítimas
function numerosDossier(obj, acc = new Set(), prof = 0) {
  if (prof > 6 || obj == null) return acc;
  if (typeof obj === 'number' && Number.isFinite(obj)) {
    for (const v of [obj, obj * 100, Math.round(obj), Math.round(obj * 10) / 10, Math.round(obj * 100) / 100,
      Math.round(obj * 100), Math.round(obj * 1000) / 10, Math.abs(obj), Math.abs(obj * 100)]) {
      if (Number.isFinite(v)) acc.add(+v.toFixed(3));
    }
    return acc;
  }
  if (typeof obj === 'string') {                       // números embebidos en texto del dossier
    for (const m of obj.matchAll(/-?\d+(?:[.,]\d+)?/g)) {
      const v = parseFloat(String(m[0]).replace(',', '.'));
      if (Number.isFinite(v)) { acc.add(+v.toFixed(3)); acc.add(+(v * 100).toFixed(3)); acc.add(+Math.round(v).toFixed(3)); }
    }
    return acc;
  }
  if (Array.isArray(obj)) { for (const x of obj) numerosDossier(x, acc, prof + 1); return acc; }
  if (typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) { numerosDossier(k, acc, prof + 1); numerosDossier(v, acc, prof + 1); }
  }
  return acc;
}
// números de la prosa que MERECEN comprobación
function numerosTexto(txt) {
  const out = [];
  for (const m of String(txt || '').matchAll(/(-?\d+(?:[.,]\d+)?)\s*(%)?/g)) {
    const raw = m[0].trim();
    const v = parseFloat(m[1].replace(',', '.'));
    if (!Number.isFinite(v)) continue;
    const decimal = /[.,]/.test(m[1]);
    const pct = !!m[2];
    // UN ENTERO PEQUEÑO SUELTO NO ES UNA ESTADÍSTICA. "3 downs", "12 jugadores", "5 asaltos", "2 sets":
    // son reglas del deporte, y en un dossier lleno de decimales una cifra inventada de verdad casi
    // siempre lleva coma o porcentaje. El corte se pone en 25 a propósito: prefiero dejar pasar un entero
    // bajo dudoso a bloquear una lectura buena, porque la alternativa a publicar no es publicar mejor, es
    // no publicar nada. Los decimales y los porcentajes se comprueban SIEMPRE, sin importar su tamaño.
    if (!decimal && !pct && Math.abs(v) < 25) continue;
    // los años no son datos del dossier y aparecen legítimamente
    if (!decimal && !pct && v >= 1900 && v <= 2100) continue;
    out.push({ raw, val: v, pct });
  }
  return out;
}
const casa = (v, set) => {
  for (const c of [v, Math.round(v * 10) / 10, Math.round(v), Math.round(v * 100) / 100]) {
    if (set.has(+c.toFixed(3))) return true;
    // tolerancia de redondeo: el dossier trae 9,83 y la prosa escribe 9,8
    for (const d of set) if (Math.abs(d - c) <= Math.max(0.051, Math.abs(c) * 0.005)) return true;
  }
  return false;
};

// Devuelve { ok, sospechosos[], inventados[], como } — `ok:false` = NO publicar.
async function verificarLectura({ texto, dossier, escritor = null }) {
  if (!VERIF_ON()) return { ok: true, como: 'apagado' };
  const set = numerosDossier(dossier);
  const nums = numerosTexto(texto);
  const sosp = nums.filter((n) => !casa(n.val, set));
  if (!sosp.length) return { ok: true, sospechosos: [], como: 'sin sospechosos (solo código)' };
  // hay candidatos: que los juzgue OTRO modelo, no el que escribió
  const cadena = CHAIN('extract').filter((n) => n !== escritor);
  if (!cadena.length) return { ok: true, sospechosos: sosp.map((x) => x.raw), como: 'sin verificador independiente' };
  try {
    const resp = await call({
      kind: 'extract', json: true, max_tokens: 500,
      _cadena: cadena,
      system: 'Verificas datos. Recibes un DOSSIER (JSON con los únicos datos válidos) y una lista de NÚMEROS que aparecen en un texto. Para cada número di si está SOPORTADO por el dossier — cuenta como soportado si aparece tal cual, si es el mismo valor en otra unidad (0,62 y 62 %), si es un redondeo, o si se deduce de forma directa de campos del dossier (una suma, una resta, un marcador formado por dos campos). También cuenta como soportado un número que sea una REGLA CONOCIDA del deporte y no una estadística (asaltos de una pelea, jugadores en el campo, downs, sets de un partido, vueltas de un circuito). Marca como NO soportado solo lo que pretende ser un DATO del enfrentamiento y no se puede obtener del dossier de ninguna de esas formas. Responde SOLO un JSON: [{"n":"<el número tal cual>","soportado":true|false}]',
      messages: [{ role: 'user', content: JSON.stringify({ dossier, numeros: sosp.map((x) => x.raw) }) }],
    });
    const j = jsonOf(resp);
    if (!Array.isArray(j)) return { ok: true, sospechosos: sosp.map((x) => x.raw), como: 'el verificador no devolvió lista' };
    const malos = j.filter((x) => x && x.soportado === false).map((x) => String(x.n));
    return { ok: !malos.length, sospechosos: sosp.map((x) => x.raw), inventados: malos,
      como: 'juzgado por ' + (resp._prov || '?') };
  } catch (e) {
    // el verificador caído no puede bloquear la publicación: se avisa y se deja pasar
    return { ok: true, sospechosos: sosp.map((x) => x.raw), como: 'verificador caído: ' + e.message };
  }
}
// Envoltura: escribe, verifica y —si el verificador encuentra números inventados— reescribe UNA vez
// avisando de cuáles. Si la segunda también falla, no se publica: la plantilla de siempre es mejor que
// una lectura con un dato falso.
async function escribirVerificado(fn, payload, { etiqueta = 'lectura' } = {}) {
  const stats = _db && (_db.llmVerify = _db.llmVerify || { ok: 0, reescritas: 0, descartadas: 0, sin_sospechosos: 0, ultimos: [] });
  let out = await fn(payload, null);
  if (!out || !out.es) return null;
  let v = await verificarLectura({ texto: out.es, dossier: payload, escritor: out._prov || null });
  if (v.ok) {
    if (stats) { stats.ok++; if (!(v.sospechosos || []).length) stats.sin_sospechosos++; }
    return out;
  }
  const aviso = `AVISO DEL VERIFICADOR: en tu texto anterior estos números NO están soportados por el dossier y no se pueden deducir de él: ${(v.inventados || []).join(', ')}. Reescribe usando SOLO cifras que estén en el dossier; si un dato no está, no lo menciones.`;
  const out2 = await fn(payload, aviso);
  if (out2 && out2.es) {
    const v2 = await verificarLectura({ texto: out2.es, dossier: payload, escritor: out2._prov || null });
    if (v2.ok) {
      if (stats) { stats.reescritas++; stats.ultimos = [{ etiqueta, inventados: v.inventados, at: new Date().toISOString(), resuelto: true }].concat(stats.ultimos || []).slice(0, 20); }
      return out2;
    }
    v = v2;
  }
  if (stats) {
    stats.descartadas++;
    stats.ultimos = [{ etiqueta, inventados: v.inventados || [], at: new Date().toISOString(), resuelto: false }].concat(stats.ultimos || []).slice(0, 20);
  }
  console.error('[verificador] descartada', etiqueta, '— inventados:', (v.inventados || []).join(', '));
  return null;
}

// ── LOS TRES DEPORTES QUE NO TENÍAN VOZ (21-ago) ─────────────────────────────────────────────────
// Tenis, F1 y fútbol americano universitario/CFL llevaban meses con motor, pantallas y picks, y sin una
// sola línea escrita: sus fichas enseñaban números y ni una lectura. No se habían hecho por una razón
// muy concreta —cada redactor costaba dinero del saldo de Anthropic y el presupuesto ya iba justo— y esa
// razón acaba de desaparecer. Mismas reglas maestras que los demás: el dossier manda, el LLM narra, y
// jamás sale de aquí una probabilidad, un mecanismo interno ni una promesa.
async function writeTennisRead(payload, aviso) {
  const resp = await call({
    kind: 'writer', json: 'esen',
    max_tokens: 2000,
    system: 'Eres el analista de tenis de GP Simulador. Con el dossier JSON escribe la lectura del partido en DOS párrafos por idioma (máximo 100 palabras cada uno): (1) EL PARTIDO — qué decide el duelo en ESTA superficie, citando los números del dossier (saque, resto, Elo por superficie, historial directo, forma); (2) EL GUION Y EL RIESGO — cómo se rompe el patrón y qué habría que ver en pista para saber que la lectura falló. Si el dossier trae línea de juegos o de sets, cierra con UNA frase sobre por dónde va la duración. PROHIBIDO: inventar datos que no estén en el JSON; describir el funcionamiento interno del sistema; prometer resultados; hype. Responde SOLO un JSON {"es":"...","en":"..."} en UNA línea — separa los párrafos con \\n\\n dentro del string.',
    messages: [{ role: 'user', content: JSON.stringify(payload) + (aviso ? '\n\n' + aviso : '') }],
  });
  const j = jsonOf(resp);
  return j && j.es && j.en ? { es: String(j.es).slice(0, 2200), en: String(j.en).slice(0, 2200), _prov: resp._prov } : null;
}
async function writeF1Read(payload, aviso) {
  const resp = await call({
    kind: 'writer', json: 'esen',
    max_tokens: 2000,
    system: 'Eres el analista de Fórmula 1 de GP Simulador. Con el dossier JSON escribe la lectura del gran premio en DOS párrafos por idioma (máximo 100 palabras cada uno): (1) EL CIRCUITO Y LA PARRILLA — qué pide este trazado y a quién favorece según los números del dossier (ritmo, clasificación frente a carrera, historial en la pista, fiabilidad); (2) DÓNDE SE DECIDE — el momento concreto de la carrera que ordena el resultado (salida, ventana de paradas, degradación, tráfico) y qué lo invalidaría. PROHIBIDO: inventar datos que no estén en el JSON; describir el funcionamiento interno del sistema; prometer resultados; hype. Responde SOLO un JSON {"es":"...","en":"..."} en UNA línea — separa los párrafos con \\n\\n dentro del string.',
    messages: [{ role: 'user', content: JSON.stringify(payload) + (aviso ? '\n\n' + aviso : '') }],
  });
  const j = jsonOf(resp);
  return j && j.es && j.en ? { es: String(j.es).slice(0, 2200), en: String(j.en).slice(0, 2200), _prov: resp._prov } : null;
}
async function writeAmfootRead(payload, liga, aviso) {
  const nombre = liga === 'cfl' ? 'la CFL (fútbol americano canadiense: 12 jugadores, 3 downs, campo más ancho y largo)' : 'el fútbol americano universitario (FBS)';
  const resp = await call({
    kind: 'writer', json: 'esen',
    max_tokens: 2000,
    system: `Eres el analista de ${nombre} de GP Simulador. Con el dossier JSON escribe la lectura del partido en DOS párrafos por idioma (máximo 100 palabras cada uno): (1) EL PARTIDO — qué inclina el choque según los números del dossier (fuerza de los dos ataques y defensas, ritmo, margen esperado, total esperado, localía); (2) EL RIESGO — el mejor argumento del otro lado y la señal concreta que invalidaría la lectura. Si el dossier trae mercado, cierra con UNA frase comparando el margen o el total propio con el del consenso, SIN recomendar nada. PROHIBIDO: inventar datos que no estén en el JSON; describir el funcionamiento interno del sistema; prometer resultados; hype. Responde SOLO un JSON {"es":"...","en":"..."} en UNA línea — separa los párrafos con \\n\\n dentro del string.`,
    messages: [{ role: 'user', content: JSON.stringify(payload) + (aviso ? '\n\n' + aviso : '') }],
  });
  const j = jsonOf(resp);
  return j && j.es && j.en ? { es: String(j.es).slice(0, 2200), en: String(j.en).slice(0, 2200), _prov: resp._prov } : null;
}

// ── Redactores de NFL y CS2 (17-ago, v2) ──────────────────────────────────────────────────────────
// Mismas reglas maestras que la lectura de baloncesto: el favorito del dossier se defiende SIEMPRE, cero
// picks/cuotas/edge, cero datos inventados, y cada métrica se nombra como viene en el JSON.
async function writeNflRead(payload, aviso) {
  const resp = await call({
    kind: 'writer', json: 'esen',
    max_tokens: 3000,
    system: 'Eres el analista de NFL de GP Simulador, al nivel de un scout profesional. Con el dossier JSON escribe la lectura del PARTIDO en DOS párrafos por idioma (máximo 110 palabras por párrafo). REGLA MAESTRA: el favorito es EXACTAMENTE "favorito_gp.nombre" con su probabilidad — tu tesis lo defiende SIEMPRE; si el "mercado" del dossier discrepa, esa discrepancia ES parte del análisis, jamás una razón para cambiar de bando. (1) LA FORMA DEL PARTIDO — de dónde sale la ventaja (pase o carrera, ofensa o defensa, citando los EPA del dossier), qué dice la diferencia de rating, cómo pesan el descanso, la sede o el clima si vienen en el JSON, y qué QB/entrenador conduce cada lado. (2) EL CAMINO DEL OTRO — el mejor argumento del rival con sus números, qué señal temprana diría que el partido se torció y qué lo volvería cerrado; si la incertidumbre del dossier es alta (inicio de temporada), DILO con su número. PROHIBIDO: mencionar picks, apuestas, cuotas, spread como recomendación, edge o valor; contradecir a favorito_gp; inventar datos; hype. Nombra cada métrica como viene en el JSON. Tono: analista concreto. Responde SOLO un JSON {"es":"...","en":"..."} en UNA línea — separa párrafos con \\n\\n dentro del string.',
    messages: [{ role: 'user', content: JSON.stringify(payload) + (aviso ? '\n\n' + aviso : '') }],
  });
  const j = jsonOf(resp);
  if (!j || !j.es || !j.en) { console.error('[llm] writeNflRead sin JSON usable · stop:', (resp && resp.stop_reason) || '?'); return null; }
  return { es: String(j.es).slice(0, 1400), en: String(j.en).slice(0, 1400) };
}
async function writeCs2Read(payload, game, aviso) {
  // 19-ago: el mismo redactor sirve a los cuatro juegos. Lo que cambia es DÓNDE se decide la serie, y eso
  // se le dice explícitamente para que narre el objeto real de cada juego y no el veto de CS2 en todos.
  const LENTE = {
    cs2: 'el VETO DE MAPAS (qué mapas favorecen a cada lado según los efectos por mapa del dossier)',
    valorant: 'el TABLERO DE MAPAS y el reparto ataque/defensa (usa `rondas` y los mapas del dossier)',
    lol: 'el DRAFT y el RITMO DE LA LIGA (usa `draft`, `ritmo` y `duracion` del dossier)',
    dota2: 'el DRAFT, el LADO del mapa y la DURACIÓN (usa `draft`, `lado`, `ritmo` y `duracion` del dossier)',
  }[game || 'cs2'];
  const JUEGO = { cs2: 'Counter-Strike 2', valorant: 'Valorant', lol: 'League of Legends', dota2: 'Dota 2' }[game || 'cs2'];
  const resp = await call({
    kind: 'writer', json: 'esen',
    max_tokens: 3000,
    system: 'Eres el analista de ' + JUEGO + ' de GP Simulador, al nivel de un coach profesional. Con el dossier JSON escribe la lectura de la SERIE en DOS párrafos por idioma (máximo 110 palabras por párrafo). REGLA MAESTRA: el favorito es EXACTAMENTE "favorito_gp.nombre" con su probabilidad — tu tesis lo defiende SIEMPRE; si el mercado del dossier discrepa, esa discrepancia ES parte del análisis. (1) LA FORMA DE LA SERIE — dónde se decide: ' + LENTE + ', la diferencia de Elo, la forma reciente y el historial directo si vienen, y qué jugadores cargan el equipo si el dossier trae ratings. (2) EL CAMINO DEL OTRO — por dónde gana el rival y qué tendría que pasar para que la serie se torciera, y el aviso de plantilla movida si el dossier lo marca. PROHIBIDO: picks, apuestas, cuotas, edge o valor; contradecir a favorito_gp; inventar mapas, héroes, campeones o datos que no estén en el dossier; hype. Nombra cada métrica como viene en el JSON. Tono: analista concreto. Responde SOLO un JSON {"es":"...","en":"..."} en UNA línea — separa párrafos con \\n\\n dentro del string.',
    messages: [{ role: 'user', content: JSON.stringify(payload) + (aviso ? '\n\n' + aviso : '') }],
  });
  const j = jsonOf(resp);
  if (!j || !j.es || !j.en) { console.error('[llm] writeCs2Read sin JSON usable · stop:', (resp && resp.stop_reason) || '?'); return null; }
  return { es: String(j.es).slice(0, 1400), en: String(j.en).slice(0, 1400) };
}

module.exports = { init, enabled, budgetOk, hayGratis, CHAIN, PROV, budgetState, dailyBudget, remainingUsd, balance, usage, call, textOf, jsonOf, askWrite, askAgent, writePickWhy, writeFightRead, writeFightPreview, writeGameRead, writeBrief, extractSignals, DOMINIOS, writeNflRead, writeCs2Read, writeTennisRead, writeF1Read, writeAmfootRead,
  verificarLectura, escribirVerificado, numerosTexto, numerosDossier };
