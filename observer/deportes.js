// observer/deportes.js — LA CAPA DE OBSERVACIÓN, PARA LOS OCHO DEPORTES (21-ago)
//
// QUÉ ES. Fútbol y combate llevaban desde julio leyendo la prensa: un barrido de Google News por sujeto,
// un prefiltro de código y un extractor LLM que convierte titulares en señales tipadas. Funcionaba y nadie
// lo extendió, porque cada deporte nuevo eran ~40 titulares más por barrido contra un proveedor de pago.
// Con dos proveedores gratuitos el coste marginal es cero, así que lo que quedaba era el trabajo.
//
// POR QUÉ IMPORTA MÁS DE LO QUE PARECE. Nuestros modelos son ciegos a la plantilla POR CONSTRUCCIÓN: miden
// equipos y jugadores por lo que hicieron, no por quién va a estar. Eso está bien para el número —es lo que
// hace que el modelo sea auditable— pero deja un hueco que el mercado sí ve: un stand-in en CS2, un
// quarterback lesionado, una retirada de cuadro. Ninguna de esas tres cosas la publica una API; las publica
// la prensa horas antes de que el precio las digiera. Esta capa las mira.
//
// DISPLAY, NUNCA MODELO. Se guarda versionado y se pinta con la cita textual que la sustenta. Ninguna señal
// toca una probabilidad: para eso tendría que pasar el peaje completo de validación walk-forward, y una
// señal sin histórico no tiene derecho a mover un número.
//
// EDUCADOS CON LA FUENTE. Es un RSS público y gratis: un barrido por sujeto cada 3 h como mínimo, pausa
// entre peticiones, tope de sujetos por pasada y poda de lo viejo. Lo mismo que ya hacen fútbol y combate.
'use strict';

const { googleNewsRss } = require('./sources');

// TÉRMINOS DE BÚSQUEDA POR DEPORTE. Van en la QUERY (lo que Google News tiene que encontrar), no en la
// extracción — el vocabulario de tipos vive en llm.js. Aquí solo se trata de que el feed traiga las
// noticias correctas y no la crónica del partido de ayer.
const TERMINOS = {
  esports: {
    en: '(roster OR "stand-in" OR standin OR benched OR "steps down" OR replacement OR visa OR sick OR "will not play" OR transfer)',
    es: '(roster OR suplente OR banquillo OR reemplazo OR visado OR baja OR fichaje OR "no jugara")',
  },
  tennis: {
    en: '(injury OR withdraws OR withdrawal OR retires OR "pulls out" OR illness OR doubt OR walkover)',
    es: '(lesion OR se retira OR retirada OR abandona OR baja OR enfermedad OR duda OR walkover)',
  },
  amfoot: {
    en: '(quarterback OR injury OR injured OR questionable OR "ruled out" OR doubtful OR suspended OR starter)',
    es: '(lesion OR lesionado OR baja OR duda OR sancionado OR titular OR quarterback)',
  },
};

// PREFILTRO DE CÓDIGO. No es un extractor: es un ordenador de cola. El LLM tiene un tope de items por
// barrido, así que decide QUIÉN entra primero — el titular que ya huele a señal antes que la nota de color.
// Deliberadamente generoso: el trabajo de decidir si hay señal es del modelo, no de esta expresión.
// LO YA JUGADO VA AL FINAL DE LA COLA. Media portada de esports es la crónica del partido de ayer, y esos
// items compiten por las mismas plazas del lote que la noticia de un stand-in. No se descartan —"abandona
// el torneo por un visado denegado" también suena a crónica— pero pierden la prioridad frente a lo demás.
const YA_PASO = /\beliminat|knocked out|\bexits?\b|falls? to|loses? to|beat(s|en)?\b|defeat|advance|qualif(y|ies|ied)|wins?\b|victory|champion|derrot|elimina|clasific|gana\b|vence/i;
const OLOR = {
  esports: /roster|stand[- ]?in|standin|bench|step(s|ped)? down|replac|visa|sick|ill|injur|leave|joins|sign|transfer|out of|suplente|banquill|reemplaz|visad|baja|fichaj/i,
  tennis: /withdraw|pull(s|ed)? out|retire|injur|ill|doubt|walkover|w\/o|medical|abdomin|wrist|shoulder|knee|back|retir|lesion|baja|abandon|molest/i,
  amfoot: /quarterback|\bqb\b|injur|questionable|doubtful|ruled out|\bout\b|suspend|starter|concussion|acl|hamstring|coordinator|fired|lesion|baja|duda|sancion|titular/i,
};

const nrm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

// ¿HABLA DE ÉL? Los nombres de esports son cortísimos y ambiguos ("Liquid", "G2", "Heroic"), y los de tenis
// se escriben de diez maneras. Un token distintivo del nombre tiene que aparecer en el titular: es un filtro
// tosco, pero el error que evita —atribuirle a un equipo la lesión de otro— es el peor que puede cometer
// esta capa, porque se publica como si fuera un hecho sobre él.
const GENERICOS = new Set(['team', 'esports', 'gaming', 'club', 'fc', 'cf', 'sc', 'united', 'city', 'state', 'university', 'the', 'de', 'del', 'los', 'las', 'el', 'la']);
function nombraA(texto, nombre) {
  const t = nrm(texto);
  const toks = nrm(nombre).split(' ').filter((x) => x.length >= 3 && !GENERICOS.has(x));
  if (!toks.length) return t.includes(nrm(nombre));           // nombre todo genérico: exige el nombre entero
  if (toks.some((x) => new RegExp('(^| )' + x + '($| |s )').test(t))) return true;
  // segunda pasada sin separadores: la prensa escribe "Hawai'i" y nosotros "Hawaii", "St. John's" y
  // "St Johns". Solo para nombres largos — comprimir "G2" contra un texto comprimido caza cualquier cosa.
  const comp = nrm(nombre).replace(/ /g, '');
  return comp.length >= 6 && t.replace(/ /g, '').includes(comp);
}

// UN BARRIDO. `sujetos` = [{ id, name, q?, langs?, meta? }]. `store` es el slot de db donde vive el dominio.
// Devuelve el parte del barrido para que la ruta interna lo pueda enseñar sin adivinar nada.
async function barrer({ dominio, sujetos, store, llm, refrescoH = 3, capLlm = 40, porSujeto = 10,
  pausaMs = 400, maxSujetos = 40, edadDias = 10, podaDias = 20 }) {
  const out = { dominio, sujetos: 0, requests: 0, items: 0, llm_items: 0, llm_signals: 0 };
  const term = TERMINOS[dominio] || TERMINOS.amfoot;
  const olor = OLOR[dominio] || OLOR.amfoot;
  const lote = [];
  const ahora = Date.now();

  for (const s of (sujetos || []).slice(0, maxSujetos)) {
    if (!s || !s.id || !s.name) continue;
    const prev = store[s.id];
    if (prev && ahora - Date.parse(prev.at || 0) < refrescoH * 3600e3) continue;   // educado
    out.sujetos++;
    const langs = s.langs && s.langs.length ? s.langs : ['en'];
    const crudos = [];
    for (const lang of langs) {
      const q = s.q ? `${s.q} ${term[lang] || term.en}` : `"${s.name}" ${term[lang] || term.en}`;
      try { crudos.push(...(await googleNewsRss(q, lang) || [])); out.requests++; } catch { /* fuente caída: se sigue */ }
      await new Promise((r) => setTimeout(r, pausaMs));
    }
    // dedup por titular + anti-clickbait + ventana del ciclo
    const vistos = new Set();
    const buenos = [];
    for (const it of crudos) {
      const k = nrm(it.title).slice(0, 90);
      if (!k || vistos.has(k)) continue;
      vistos.add(k);
      if (!nombraA(it.title + ' ' + (it.description || ''), s.name)) continue;
      const edad = it.published_at ? ahora - Date.parse(it.published_at) : null;
      if (edad != null && edad > edadDias * 864e5) continue;
      buenos.push(it);
    }
    // los que huelen a señal primero; el resto rellena hasta el tope por sujeto
    const puntua = (x) => { const t = x.title + ' ' + (x.description || ''); return (olor.test(t) ? 2 : 0) - (YA_PASO.test(x.title) ? 1 : 0); };
    buenos.sort((a, b) => puntua(b) - puntua(a));
    const cola = buenos.slice(0, porSujeto);
    out.items += cola.length;
    for (const it of cola) {
      // SIN TOPES MUDOS: si el lote se llena, el parte del barrido dice cuántos titulares se quedaron
      // fuera. Un cero de señales con 84 items descartados en silencio se lee como "no había nada".
      if (lote.length >= capLlm) { out.omitidos = (out.omitidos || 0) + 1; continue; }
      lote.push({ sid: s.id, subject: s.name, meta: s.meta || null, title: it.title,
        snippet: it.description || '', source: it.source || null, published_at: it.published_at || null });
    }
    // marca el barrido aunque no haya salido nada: así no se repite dentro de la ventana
    store[s.id] = { name: s.name, meta: s.meta || null, at: new Date(ahora).toISOString(), signals: (prev && prev.signals) || [] };
  }

  // EXTRACCIÓN. Silenciosa por diseño: sin LLM, sin presupuesto o con la llamada caída no pasa nada más que
  // no haber señales este barrido. Esta capa jamás puede tumbar un deporte.
  if (lote.length && llm && llm.enabled() && llm.budgetOk()) {
    out.llm_items = lote.length;
    try {
      // LOTES CORTOS, MÁS LLAMADAS. Medido el 21-ago: con 24 titulares de golpe el extractor devolvía las
      // señales de un jugador y se dejaba las de los otros dos; con los mismos titulares en lotes de diez
      // los encontraba todos. No es un fallo de formato —la respuesta era JSON válido— es que la atención
      // se reparte peor cuanto más largo es el lote. Antes esto se resolvía con lotes grandes porque cada
      // llamada costaba dinero; con proveedores gratuitos el argumento desapareció y lo que queda es que
      // partir en trozos encuentra más. Los trozos van EN SERIE: no hay prisa y hay límites de ritmo.
      const TROZO = 10;
      const sigs = [];
      // UN TROZO CAÍDO NO SE LLEVA EL BARRIDO. Con el error subiendo desde el bucle, un fallo en el tercer
      // trozo tiraba también las señales buenas de los dos primeros — y en el parte quedaba un cero que
      // parecía "no había nada". Ahora cada trozo falla solo y el parte dice cuántos fallaron.
      for (let i = 0; i < lote.length; i += TROZO) {
        const parte = lote.slice(i, i + TROZO);
        out.llm_calls = (out.llm_calls || 0) + 1;
        try {
          const r = await llm.extractSignals(parte, dominio);
          for (const g of r) sigs.push({ ...g, i: g.i + i });
        } catch (e) { out.llm_fallos = (out.llm_fallos || 0) + 1; out.llm_error = e.message; }
      }
      out.llm_signals = sigs.length;
      // UNA SEÑAL POR TIPO, CON SU RECUENTO DE FUENTES. Seis medios contando la misma vuelta de Alcaraz son
      // SEIS ITEMS y UNA noticia: pintarlos los seis llena el panel de ruido y hace parecer que pasaron seis
      // cosas. Se queda la primera —que es la que el prefiltro puso arriba— y se guarda cuántos medios la
      // publicaron, que además es información útil: una señal en un solo blog no vale lo que una en seis.
      const porSuj = {};
      for (const g of sigs) {
        const it = lote[g.i];
        const lista = porSuj[it.sid] = porSuj[it.sid] || [];
        const ya = lista.find((x) => x.type === g.type);
        if (ya) { ya.fuentes++; if (g.severity > ya.severity) ya.severity = g.severity; continue; }
        lista.push({ type: g.type, severity: g.severity, quote: g.quote, fuentes: 1,
          title: it.title, source: it.source, published_at: it.published_at });
      }
      for (const [sid, signals] of Object.entries(porSuj)) {
        if (store[sid]) store[sid].signals = signals.sort((a, b) => b.severity - a.severity || b.fuentes - a.fuentes).slice(0, 6);
      }
    } catch (e) { out.llm_error = e.message; }
  }

  // poda: sujetos que llevan semanas sin partido
  for (const [k, v] of Object.entries(store)) {
    if (ahora - Date.parse((v && v.at) || 0) > podaDias * 864e5) delete store[k];
  }
  return out;
}

// LAS ETIQUETAS. Se pintan en español e inglés con la CITA TEXTUAL que las sustenta, no con el titular:
// la frase concreta es lo que deja al lector juzgar por sí mismo si la señal dice lo que decimos.
const ETIQUETAS = {
  esports: { ROSTER: ['cambio de plantilla', 'roster change'], STANDIN: ['juega con suplente', 'playing with a stand-in'],
    BENCH: ['titular apartado', 'starter benched'], VISA: ['problema de viaje o visado', 'visa or travel issue'],
    ILLNESS: ['jugador enfermo o lesionado', 'player ill or injured'], ORG: ['cambio en el cuerpo técnico', 'coaching change'],
    FORFEIT: ['se retira del torneo', 'withdrawn from the event'] },
  tennis: { OUT: ['se retira del torneo', 'withdrawn from the tournament'], RETIRED: ['abandonó en pista', 'retired mid-match'],
    INJURY: ['lesión reportada', 'reported injury'], ILLNESS: ['enfermedad', 'illness'], DOUBT: ['en duda', 'in doubt'],
    RETURN: ['vuelve de lesión', 'returning from injury'], WALKOVER: ['pasa sin jugar', 'through on a walkover'] },
  amfoot: { QB: ['quarterback titular en el aire', 'starting quarterback in question'], OUT: ['titular fuera', 'starter ruled out'],
    INJURY: ['lesión reportada', 'reported injury'], DOUBT: ['titular en duda', 'starter questionable'],
    SUSPENDED: ['sancionado', 'suspended'], COACH: ['cambio de entrenador', 'coaching change'] },
};
// LA GRAVEDAD LA DICEN LOS DOS, NO UNO SOLO. El tipo lleva un peso —una baja de quarterback importa más
// que un cambio de analista, diga lo que diga el titular— pero dejar que el tipo mande solo pinta en rojo
// una mención de pasada: probándolo salió un "matchup against Nathan Rourke" etiquetado QB y por tanto
// grave, cuando el modelo que lo leyó le había puesto un 1. Se promedian: el peso del tipo pone el suelo
// de importancia y la lectura del texto lo corrige hacia abajo cuando la noticia es floja.
const PESO = { esports: { STANDIN: 3, ROSTER: 3, FORFEIT: 3, VISA: 3, BENCH: 2, ILLNESS: 2, ORG: 1 },
  tennis: { OUT: 3, RETIRED: 3, WALKOVER: 3, INJURY: 2, ILLNESS: 2, DOUBT: 2, RETURN: 1 },
  amfoot: { QB: 3, OUT: 3, SUSPENDED: 2, INJURY: 2, DOUBT: 1, COACH: 1 } };

// banderas de UN sujeto, en la forma que ya consumen los paneles de inteligencia del resto de deportes
function banderas(dominio, store, sid, { lado = null, etiquetaSujeto = null } = {}) {
  const o = (store || {})[sid];
  if (!o || !o.signals || !o.signals.length) return [];
  const L = ETIQUETAS[dominio] || {};
  const P = PESO[dominio] || {};
  const quien = etiquetaSujeto || (o.name || '');
  return o.signals.map((s) => {
    const lbl = L[s.type] || [s.type, s.type];
    const leida = Math.max(1, Math.min(3, +s.severity || 1));
    const sev = Math.round(((P[s.type] || leida) + leida) / 2);
    return { side: lado, code: 'news_' + s.type, type: s.type, news: true, llm: true,
      severity: sev >= 3 ? 'high' : sev === 2 ? 'warn' : 'info',
      source: s.source || null, published_at: s.published_at || null,
      fuentes: s.fuentes || 1,
      es: `📰 ${quien}: ${lbl[0]} — "${(s.quote || s.title || '').slice(0, 160)}"${s.fuentes > 1 ? ` (${s.fuentes} medios)` : ''}`,
      en: `📰 ${quien}: ${lbl[1]} — "${(s.quote || s.title || '').slice(0, 160)}"${s.fuentes > 1 ? ` (${s.fuentes} outlets)` : ''}` };
  });
}

module.exports = { barrer, banderas, ETIQUETAS, PESO, TERMINOS, nombraA };
