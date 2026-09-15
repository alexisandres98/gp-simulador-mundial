# GP Simulador — Auditoría independiente de modelos, precios y evidencia

> Documento externo, recibido el 15 de septiembre de 2026 y transcrito íntegro. No es del equipo. Sirve de base al
> `PLAN_TRABAJO_AUDITORIA_2026-09-15.md`. Los identificadores A01–A36 y E1–E9 de este documento son los que usa el plan.

Para el equipo de GP · 15 de septiembre de 2026
Objeto: decidir qué corregir, qué investigar y qué debe demostrar cada estrategia antes de comprometer capital.
Base documental: AUDITORIA_MODELOS_2026-09-14.md, fecha de corte 14-09-2026, código descrito en el commit 056e37e.

## 1. Dictamen y alcance

No aprobaría actualmente ninguna familia para escalar capital basándome en este dossier. Sí aprobaría un programa concentrado de reparación e investigación. No significa que todas las familias tengan esperanza negativa: significa que la evidencia presentada no permite identificar de forma fiable cuáles tienen esperanza positiva a precios ejecutables.

GP dispone de activos útiles: históricos importantes, algunos modelos evaluados temporalmente, compiladores deportivos, captura de cuotas y experiencia real de ejecución. Pero su cadena de certificación no es suficientemente fiable. Puede seleccionar una apuesta con una probabilidad de una línea y el precio de otra, evaluar con liquidaciones incorrectas, cambiar la población evaluada retrospectivamente y declarar ventaja con un estadístico calculado sobre una magnitud equivocada. Añadir features antes de arreglar eso puede producir mejores gráficos y peores decisiones.

Esta es una auditoría documental, matemática y de diseño, contrastada con investigación primaria y documentación técnica. No he tenido acceso al repositorio privado, a los históricos fila a fila, a las respuestas originales de proveedores ni al extracto completo de las casas. Las referencias archivo:línea incluidas aquí son las transcritas en el dossier, no inspecciones independientes de esos archivos. No he modificado producción ni ejecutado backtests reales de GP.

Distingo tres clases de evidencia:

| Marca | Significado | Ejemplo |
|---|---|---|
| **D** | Comportamiento descrito explícitamente en el dossier; requiere reproducción contra código y datos | Doble compresión en CS2 |
| **M** | Conclusión matemática o aritmética comprobable con las fórmulas/cifras entregadas | Restar medio overround al CLV porcentual no calcula el EV neto |
| **H** | Hipótesis nueva que merece experimento; no un defecto demostrado | Censura de la media de dardos por derrota del leg |

Las afirmaciones de rentabilidad y los resultados históricos conservan la condición de reportados. Mis intervalos calculados a partir de agregados son aproximaciones expresamente identificadas, no sustitutos de un análisis por eventos.

La pregunta correcta no es cómo hacer que once deportes ganen dinero. Es dónde información propia, error de precio y capacidad ejecutable se intersectan, después de descontar costes y error de estimación. Un sindicato puede tener muchos modelos descriptivos y muy pocas estrategias financiables.

**Decisiones que recomiendo**

1. Pausar nuevas apuestas reales de tarjetas y TT hasta corregir contrato, liquidación, EV a precio aceptado y bloqueos operativos. Conservar posiciones existentes y reconciliarlas; esta recomendación no implica liquidarlas anticipadamente.
2. Retirar las etiquetas de ventaja confirmada del tablero actual. Conservar los resultados históricos con advertencias y versiones, no borrarlos.
3. Mantener CS2 real pausado. No transferir el resultado de Pinnacle a Cloudbet.
4. Conservar los modelos antiguos como controles en sombra; ninguna regla congelada justifica conservar un error de identidad, pago o ejecución.
5. Priorizar cuatro investigaciones: tarjetas total, CS2 rondas/props, TT total y tenis ATP BO3 total. Son prioridades de investigación, no recomendaciones actuales de apuestas.
6. Posponer expansión de familias, live y complejidad adicional hasta disponer de una cadena común de validación.

## 2. Los errores de razonamiento que también hay que corregir en la auditoría interna

### 2.1 Se confunden probabilidad de mercado, umbral de rentabilidad y EV [M]

Para una apuesta binaria sin devolución, cuota decimal aceptada o y probabilidad estimada p: `p_BE = 1/o`, `EV = p·o − 1`.

1/o es exactamente el umbral de acierto necesario para no perder. Comparar p contra 1/o es correcto para decidir rentabilidad. No es una probabilidad justa del mercado para comparar calidad predictiva.

Con dos lados exhaustivos y excluyentes del mismo contrato, casa y momento: `Q = 1/o_A + 1/o_B`, `q_A = (1/o_A)/Q`.

q_A es una estimación proporcional de la probabilidad justa. No es la verdad y puede requerir calibración. Ejemplo: mercado 1,90/1,90, q=0,50; GP estima 0,55. La discrepancia con el mercado es 5 pp, el exceso sobre breakeven es 2,37 pp y el EV es 4,5 %. Son tres magnitudes diferentes.

El dossier dice que no retirar margen en tenis infla p_modelo−p_mercado; con cuotas y contrato iguales, el signo es al revés: 1/o excede la probabilidad desvigada y reduce esa diferencia. Puede haber otros sesgos, pero ese argumento algebraico es incorrecto. Lo mismo aplica a las críticas a evaluateEdge de esports.

Tampoco un ROI observado positivo de props se vuelve ficticio porque el cálculo de señal use 1/o. Si el pago era realmente ejecutable y las liquidaciones son correctas, su ROI ya incluye el margen. En Underdog la duda importante es si ese precio por pierna representa un contrato que realmente puede comprarse, no si se desvigó para calcular P&L.

Cambio: almacenar por separado p_model_raw, p_calibrated, q_reference, p_break_even, edge_information_pp y ev_net. Las puertas de dinero consumen EV neto; las de investigación comparan pronósticos contra una referencia justa.

### 2.2 La fórmula central de «la vara» mezcla unidades [M]

El dossier define: `CLV_raw = o_entrada/o_cierre − 1`, `margen_lado = (Q_c − 1)/2`.

Restar estas dos cifras no da el retorno esperado al precio de entrada según el cierre justo. Bajo desvigado proporcional: `EV_cierre = o_entrada · q_c − 1 = (o_entrada/o_cierre)/Q_c − 1`.

Contraejemplo reproducido: cierre 1,904762/1,904762, Q=1,05; entrada a 1,97. CLV crudo +3,425 %. La regla actual resta 2,5 % y declara +0,925 %. El cierre justo estima p=0,50; el EV correcto es −1,50 %. La familia puede ser aprobada con EV negativo.

Además, el código exige neto>0 pero usa el t de CLV bruto. Un CLV de 3,01 % con coste equivalente de 3 % y gran significancia frente a cero no demuestra significancia del excedente 0,01 %. La incertidumbre debe corresponder a la magnitud que se está aprobando.

Cambio: calcular por ticket el payoff esperado con la distribución de cierre y el precio aceptado. Agregar después. No restar una mediana global de margen a una media de CLV. No desvigarlo todo con un margen idéntico para entrada y cierre. Para cuartos/enteros, usar las probabilidades de cada fracción de pago.

### 2.3 «El cierre no mejora significativamente» no significa «el CLV no sirve» [M]

|t|<2 es ausencia de evidencia suficiente de diferencia; no prueba equivalencia. Un mercado puede tener probabilidades buenas desde la apertura y apenas moverse. Un cierre sin movimiento no informa de velocidad, pero todavía puede servir de referencia de precio. Y un book lento puede no servir de referencia aun cuando sí se mueva.

Separar:

| Pregunta | Medición |
|---|---|
| ¿La captura de cierre es correcta? | Mismo evento/contrato, antes del inicio real, fuente fresca |
| ¿El cierre está calibrado? | Pronóstico justo frente al resultado, con intervalos |
| ¿Mejora la apertura? | Diferencia pareada y potencia/equivalencia si se pretende afirmar equivalencia |
| ¿El ticket compró valor según una referencia? | Payoff esperado a la cuota aceptada |
| ¿La estrategia gana? | P&L neto, incertidumbre por bloques, capacidad |

El CLV contra la casa propia y contra una referencia externa responden preguntas distintas. La misma casa no es un requisito universal: comprar una cuota real en una casa lenta y compararla con el cierre justo de otra puede medir una ventaja de ejecución legítima. El defecto del tablero es mezclar referencias y, sobre todo, líneas/contratos no equivalentes; seleccionar el mejor precio auténticamente ejecutable no es por sí solo un sesgo que deba eliminarse.

### 2.4 Las bandas de «eficiencia» no identifican eficiencia económica [M]

El Brier depende de la dificultad y de las probabilidades base. Dos mercados perfectamente calibrados: uno con eventos al 90 % tiene Brier esperado 0,09; otro al 50 %, 0,25. El segundo no es menos eficiente por ser menos predecible.

GP añade dos problemas: calcula bandas sobre las selecciones de su modelo y extiende esa clasificación a otras familias. La eficiencia de 1X2 de una liga no prueba la de tarjetas. Un margen bajo tampoco demuestra eficiencia por sí solo.

Cambio: retirar el Brier absoluto como interruptor económico de liga. Usar diferencias pareadas de pronóstico, calibración condicionada por precio, frescura, disponibilidad, dispersión entre fuentes y EV realizado por estrategia. Modelar heterogeneidad liga×familia con contracción, no cortar en 0,230/0,260.

### 2.5 La autopsia de tarjetas no demuestra las causas que atribuye [M]

Los cuatro grupos de las 139 apuestas suman un P&L de −307,60 USDT. «Apiladas» y «ligas eficientes» se solapan; sus pérdidas no se suman como causas independientes. Las cuatro ligas con −453,43 no son el mismo corte que toda la banda eficiente con −272,64.

El dossier ya calcula el contrafactual de una posición: mejora 95,66 USDT, de −307,60 a −211,94. Ese es el ahorro retrospectivo reportado, no 413,72. Incluso ese ahorro depende de cuál apuesta se conservaría y de que la regla fuera aplicable con información disponible entonces.

La correlación aumenta el riesgo, pero no vuelve negativo el EV de dos apuestas positivas. La regla de una posición es un buen freno inicial. A nivel de sindicato se sustituye por un límite de exposición al payoff conjunto; dos contratos del mismo partido pueden servir para cobertura o un middle.

Los 43 tickets «sueltos + liga no eficiente» son un subconjunto seleccionado después de observar resultados. No certifican +23,79 % o +25,26 % futuro. El dossier usa ambas cifras para ese núcleo: hace falta reconciliar numerador, stake, corte y selección.

### 2.6 La media de una liga puede contener alpha; un modelo más complejo puede empeorarla [M]

TOTALS_DAMP=0 demuestra que el modelo no utiliza fuerza de equipos en el total. No demuestra que la ganancia venga necesariamente de una ventana agotada. Una base simple puede superar un book sesgado, o solo parecerlo por selección, mala liquidación o varianza. La hipótesis de ventana debe competir con esas alternativas.

Tampoco el compilador TT queda descartado por ser inferior a Elo individualmente: el ensamble mejora el log-loss de 0,5372 a 0,5273. Eso es compatible con información complementaria del compilador. Hay que evaluar su contribución marginal pareada, no decir que «la mezcla gana solo por Elo».

### 2.7 Otras conclusiones internas que no adoptaría

| Afirmación del dossier | Corrección |
|---|---|
| Semilla fija como debilidad | Favorece reproducibilidad y comparación con números aleatorios comunes; el fallo sería llamar incertidumbre del modelo al error Monte Carlo |
| 100 apuestas certifican una familia; 200 dan certeza razonable | Depende de tamaño del edge, varianza, dependencia y selección; ver sección 5 |
| Sumar el peor error de calibración al umbral arregla el modelo | Es una heurística; el peor bin también tiene ruido y puede no corresponder al contrato seleccionado |
| Un ROI positivo con CLV negativo es necesariamente una racha/prima de riesgo | Puede ser racha, referencia mala o alpha no reflejada en ese cierre; los datos disponibles no eligen entre ellas |
| Más varianza siempre es conservador | Puede acercar un favorito a 50 %, aumentar colas y **crear** señales en derivados |
| Correlación global pequeña demuestra independencia | No descarta dependencia condicional, asimetría ni dependencia de colas |
| El stop de −231 se vuelve más laxo al pasar de stake 30 a 40 | Para un suelo negativo fijo se vuelve **más estricto** en unidades de stake: −7,70u frente a −5,775u. El equivalente a stake 40 es −308 aproximadamente |
| Una pendiente de recalibración 1,1119 con t=28,7 prueba desviación de 1 | Hay que saber si el t contrasta cero o uno. El contraste pertinente es `(b−1)/SE(b)` |
| CC BY-SA implica no comercial | Esa licencia permite uso comercial sujeto a condiciones. Los términos del sitio/API y otros derechos requieren una evaluación aparte |

## 3. Contratos y liquidación: la primera reconstrucción obligatoria

### 3.1 Un precio es una tupla, nunca un número aislado

La clave mínima es: evento canónico | participantes orientados | deporte | competición | fase | periodo/mapa/game | familia | selección | línea con signo | reglas | casa | fuente | timestamp.

La selección, su línea y su cuota deben viajar juntas desde la captura hasta la liquidación. best() debe retornar un contrato cotizado, y el modelo debe valorar esa línea exacta. No devolver solo la cuota y reutilizar la mediana del tablero.

Dos handicaps no se emparejan por abs(line) a secas: A−2,5/B+2,5 es un mercado; A+2,5/B−2,5 es otro. La clave canónica puede normalizar todo a la línea de A, conservando periodo y reglas. Las caras deben ser contemporáneas: elegir la mejor cara de momentos distintos fabrica un mercado inexistente.

TT: clasificar puntos/games por si el total es ≥15 o el handicap ≥4 es una heurística peligrosa; un handicap de puntos pequeño se confunde con games. Debe mandar el identificador y parámetros del proveedor, con reglas explícitas.

### 3.2 Cuartos asiáticos: el promedio de probabilidades condicionales no es exacto [M]

El dossier describe promediar las probabilidades justas de las dos medias apuestas. No es correcto si tienen distinta masa de devolución.

Para cada resultado y, sean w(y) la fracción ganadora del stake y l(y) la fracción perdedora: `A = E[w(Y)]`, `B = E[l(Y)]`, `EV(o) = A(o−1) − B`, `o_fair = 1 + B/A`.

La probabilidad equivalente es A/(A+B) cuando se necesita representar la cuota justa. Deben promediarse payoffs, no probabilidades previamente normalizadas.

Ejemplo over 2,25: P(T<2)=0,30, P(T=2)=0,25, P(T>2)=0,45. A=0,45, B=0,425; cuota justa 1,944444. Promediar P(over2|no push)=0,60 y P(over2,5)=0,45 da 0,525 y cuota 1,904762: apostar a esa falsa cuota justa tiene EV −1,786 %. Revisar goal-engine/markets.js:46-67 y todas sus réplicas.

### 3.3 Resultado desconocido no es VOID económico

En varios motores, no encontrar resultado a 72 horas/7/10/12 días se transforma en VOID. Si la casa no anuló la apuesta, eso no es devolución: es resultado no reconciliado. Darle cero puede seleccionar la muestra y ocultar pérdidas.

Separar estados: OPEN → ACCEPTED → RESULT_PENDING → SETTLED, con ramas REJECTED, BOOK_VOID, DATA_UNRESOLVED, DISPUTED y correcciones versionadas. El resultado deportivo y el pago del book son campos distintos. Si difieren, abrir una incidencia; no forzar uno sobre otro.

Para estudiar sensibilidad a datos faltantes, publicar rangos extremos de P&L asignando a los no resueltos sus payoffs máximo/mínimo posibles y un desglose de por qué faltan. No aprobar sobre el subconjunto liquidable sin conocer ese mecanismo.

### 3.4 Tarjetas necesita un contrato específico por casa

La suma «amarillas + rojas» no puede asumirse equivalente a todas las familias denominadas cards/bookings. Verificar segunda amarilla, roja directa, jugadores sustituidos, banquillo, cuerpo técnico, postpartido, prórroga y puntos disciplinarios. El modelo y la fuente pueden contar perfectamente una variable que no paga como el contrato comprado.

Construir un conjunto de partidos reales con incidencias y contrastar marcador disciplinario original, regla vigente y payout de Cloudbet.

### 3.5 Pruebas de aceptación que sí son imprescindibles

| Prueba | Resultado exigido |
|---|---|
| Invertir A/B y el signo del handicap | Mismo pago económico |
| Línea entera y cuartos en la frontera | WIN/LOSS/PUSH/half-win/half-loss exactos |
| Precio de otra línea | Rechazo antes de valorar |
| ML NFL ganador/derrota/empate según contrato | Nunca PUSH por rama ausente |
| Serie Dota 1–0 en BO3 | No finalizar serie |
| TT 11–10, 12–10 y deuce | Legalidad y soporte exactos |
| Dardos bust tras dos lanzamientos | Vuelta al score inicial de la visita |
| Timeout tras enviar apuesta | Consultar referencia; no reenviar con id nuevo |
| Reinicio durante aceptación | Sin duplicación y exposición reservada persistente |
| Falta de resultado deportivo | DATA_UNRESOLVED, no devolución automática |
| Cuota caducada/mercado suspendido | Cero órdenes nuevas |
| Kelly cero/EV negativo/precio peor | Stake cero, sin mínimo que lo reactive |

Además, escoger una muestra estratificada de tickets de todos los motores, revisar manualmente la evidencia original y reconciliar el 100 % de tickets reales contra la casa.

## 4. La arquitectura de investigación que falta

### 4.1 Tres motores separados y un selector común

Motor fundamental: pronostica resultados sin cuotas contemporáneas. Motor condicionado al mercado: parte de un consenso disponible en ese momento y aprende correcciones. Motor de ejecución: detecta dónde se compra el mismo payoff a mejor precio, con tamaño aceptable y costes conocidos.

Los tres alimentan un único selector que calcula el payoff neto a la cuota ejecutable. «Ganamos por precio» no invalida una estrategia; atribuirlo a un modelo deportivo sí falsea el diagnóstico.

### 4.2 Modelo residual propuesto

Para mercados binarios sin push: `logit(p*_i) = a_f + b_f·logit(q_i) + c_f·[logit(p_fund_i) − logit(q_i)] + β_f'·x_i`.

q_i debe estar disponible a la hora de decisión, con referencia de casa/familia explícita. x_i contiene pocas variables con hipótesis previa. Los coeficientes se contraen entre familias relacionadas y hacia (a,b,c,β)=(0,1,0,0).

No transferir el c ajustado en un modelo que también estimó a y b a una fórmula que fija a=0,b=1. Tampoco imponer c=0 porque t<1, ni desplegar c<0 como estrategia contraria sin validarla.

Para 1X2, usar una distribución multiclase normalizada; para totales/handicaps, recalibrar una PMF/CDF monotónica o los parámetros del generador. Ajustar cada línea de forma independiente puede producir P(over 5,5)>P(over 4,5).

### 4.3 Competidores obligatorios

Toda mejora debe competir, en las mismas filas, con: (1) base deportiva simple disponible entonces; (2) mejor modelo fundamental anterior; (3) consenso justo a la hora de entrada; (4) consenso recalibrado sin features GP; (5) modelo residual con features GP; (6) selector de precio sin modelo propio.

Un ensamble que gana a GP viejo pero pierde contra consenso recalibrado no ha demostrado valor incremental deportivo.

### 4.4 Protocolo temporal completo

Cada fold tiene cuatro periodos ordenados: entrenamiento → calibración/selección interna → embargo operativo → evaluación externa. Los hiperparámetros, filtros, ventanas y umbrales se escogen solo dentro de entrenamiento/calibración.

GP presenta al menos dos fallos descritos de esta clase: selección de halflife×carry de amfoot sobre la evaluación y bajas de baloncesto reconstruidas con minutos reales.

Agrupación: todas las líneas de un partido y todos los mapas de una serie permanecen juntas en el test. Auditar timestamps múltiples: event_at, source_published_at, first_seen_at, ingested_at, effective_at, corrected_at.

### 4.5 Calibración y selección sin autoengaño

Medir calibración en el universo completo y en los candidatos que la política selecciona. Guardar también candidatos rechazados, con motivo, score y snapshot. El peor bin de calibración es un estimador ruidoso. Separar error estructural, incertidumbre de parámetros y error Monte Carlo.

### 4.6 Dependencia, múltiples pruebas y vigilancia

Un ticket no equivale a una observación independiente. Publicar n_tickets, n_eventos, n_sesiones, concentración y número de bloques. Recalcular incertidumbre con bootstrap por bloques temporales/evento. Con 30 contrastes independientes al 5 %, la probabilidad de al menos un falso positivo es 78,5 %; con 96, 99,27 %.

Registrar todo experimento intentado, aplicar control de descubrimientos falsos para explorar y exigir confirmación prospectiva para promover. Revisar un t cada hora y parar cuando convenga no conserva su nivel nominal. Recortar automáticamente el 10 % de cada cola cambia el estimando; excluir datos inválidos por reglas de calidad independientes del P&L.

## 5. Qué puede demostrar la muestra disponible

### 5.1 Resultados económicos que realmente hay

| Libro/corte reportado | Resultado | Lectura independiente |
|---|---|---|
| Cloudbet total desde 25-ago, corte 14-sep | 278 liquidadas; −266,53 sobre 5.948,04; −4,48 % | Pérdida real reportada; mezcla deportes, versiones y estados |
| CS2 Cloudbet hasta 7-sep | −66,9 sobre 600; 68 tickets, 14 anulados | No trasladar beneficios de Pinnacle |
| Tarjetas núcleo retrospectivo | 43 tickets; +326,44 | Exploratorio y postseleccionado |
| CS2 props v2 | 330; +2,2 % teórico por pierna | Sin prueba de retorno ejecutable del producto completo |
| NFL spread umbral 4 | 575; +1,55 % a −110 | Compatible con cero; umbral seleccionado |
| NCAAF total umbral 6 | 2.199; +1,04 % a −110 | Compatible con cero; tuning no separado |
| Tenis ATP total | 168 tickets; preregistro incompleto | Prioridad razonable, muestra insuficiente |
| TT total | Dinero iniciado con 19 liquidadas en sombra | Falta el dato fundamental |
| Dardos | Sin muestra operativa suficiente | Habilidad predictiva, no evidencia económica |
| F1 | 35 carreras de validación | No son cientos de apuestas independientes |

El P&L diario por fecha de liquidación dividido por stakes colocados ese día no es ROI de cohorte.

### 5.2 Intervalos aproximados recalculados

| Caso | ROI reportado | IC 95 % aproximado | t aproximado del ROI |
|---|---:|---:|---:|
| NFL spread, 575 a −110 | +1,55 % | −6,24 % a +9,34 % | 0,39 |
| NCAAF total, 2.199 a −110 | +1,04 % | −2,94 % a +5,02 % | 0,51 |
| Props CS2, 330 a −112 | +2,20 % | −7,98 % a +12,38 % | 0,42 |

Un t=3,21 de movimiento de línea no transforma el t≈0,42 de beneficio por pierna en evidencia económica sólida. Para 32 victorias de 43, el intervalo Wilson de acierto es 59,8–85,1 % antes de corregir selección.

### 5.3 100 apuestas son un control operativo, no una certificación genérica

A cuota 1,91, 100 apuestas independientes dan una semiamplitud del IC 95 % de ROI de 18,7 pp. Tamaño para detectar ROI positivo (bilateral 5 %, potencia 80 %, cuota 1,91, independencia):

| ROI verdadero | n aproximada | Semanas a 18,7 apuestas/semana |
|---|---:|---:|
| 1 % | 71.402 | 3.818 |
| 2 % | 17.844 | 954 |
| 3 % | 7.927 | 424 |
| 5 % | 2.851 | 153 |
| 10 % | 710 | 38 |

El 20 de octubre puede ser una revisión de integridad, calibración y viabilidad, no la fecha en que 100 tickets garantizan una respuesta económica.

### 5.4 Dos umbrales distintos: riesgo y evidencia

El stop monetario protege capital. El test estadístico determina evidencia. Recalculé el ejemplo de 100 apuestas, cuota 1,81 y p=1/1,81+0,07: el percentil 1 de victorias binomiales es 51; el P&L correspondiente es −230,70 a stake 30 y −307,60 a stake 40.

Diseñar los límites con stakes, precios, cartera abierta y correlaciones efectivos. No usar un banco nocional de 2.000 para justificar stake de 40 cuando el capital disponible puede ser mucho menor.

## 6. Fútbol: qué conservar y qué reconstruir

### 6.1 Tarjetas total: primera investigación, sin dar por demostrado el edge

Estado observado [D]: NB, media de liga amortiguada con DAMP 0/0,25/0,5, ajuste de paridad, fuerzas de equipos con prior 4, árbitro no conectado. La validación LOO usa árbitro real, mientras producción no lo pasa. El selector elige la línea de mayor desacuerdo y las bandas abren/cierran publicación y dinero.

Modelo mínimo T1: distribución de total por liga×temporada con nivel dinámico, dispersión estimada y pooling. Competidores: histograma suavizado, Poisson, NB y una alternativa que admita subdispersión (COM-Poisson).

Modelo T2, solo si T1 queda corto: `log μ_H = α_liga,temporada,t + h_liga + u_recibe_H,t + u_provoca_A,t + r_árbitro,t + β'x`. Análogo para visitante.

No encender a la vez árbitro, DAMP y otro listón. Cuatro challengers emparejados: T0 actual; T1 liga dinámica; T2a T1+equipos; T2b T2a+árbitro. El test principal debe puntuar el total y las líneas realmente ofrecidas.

Diagnóstico de la caída del rendimiento:

| Hipótesis | Datos necesarios | Prueba que la distingue |
|---|---|---|
| La ventana aprovechable desapareció | Primera captura real, cambios de precio/línea, hora de señal y aceptación | Mismo universo: valor y resultados por tiempo desde primera cotización |
| Cambió la mezcla de ligas/formatos | Liga, línea, precio, book, hora, stake y versión por ticket | Estandarizar a mezcla fija |
| Deriva del nivel de tarjetas | Todos los partidos, no solo picks | Error de media y colas por liga×semana |
| Regresión tras seleccionar ganadores | Historial de todos los filtros probados | Reaplicar cronológicamente; confirmación en periodo nuevo |
| Divergencia de liquidación | Payload y reglas de book | Incidencias con rojas/segundas amarillas |
| Cambio de exposición/stake | Intentos, fills, saldo | P&L a stake unitario y real |
| Deterioro de datos | Historial de cobertura y fechas de fit | Error por edad del dato, fallback, árbitro ausente |

La hora de creación de una pick no es la apertura del mercado. Registrar eventos de disponibilidad, incluidos mercados sin pick.

Experimento T3 de precio: comparar T1 contra consenso externo justo excluyendo la casa objetivo.

### 6.2 Córners

Backtest reportado: equipos con K_team≈40, DAMP=0,5 mejoran al baseline; añadir árbitro no aporta. C1: total condicionado a fuerza ofensiva/territorial y respuesta defensiva; modelar T y después C_H|T. La correlación −0,249 no debe imponerse globalmente. Experimento: C0 liga; C1 equipos; C2 proceso; C3 residual contra mercado. Primera familia: total de córners.

### 6.3 1X2, goles y Mundial

El transform fijo 2,6·we^0,93, suelo 0,65, ρ=−0,13 y atenuación 0,15 se transportó entre contextos. El gate se valida con K=28 y producción actualiza con K=30×margen. G1: ataque/defensa dinámicos con home advantage por competición. G2: inferir parámetros de la distribución de marcador desde 1X2 y total. No habilitar picks por superar Brier absoluto 0,63.

### 6.4 Mitades y derivadas

Las mediciones con λ inferidas del cierre de Pinnacle evalúan una transformación condicionada al cierre. Aplicar la corrección de payoffs asiáticos. Doble oportunidad debe derivarse de una distribución 1X2 coherente. Orden: total FT → total 1T/2T → total equipo → HT/FT/exact score. Retirar derivadas_v1 como estrategia financiable; conservarlo como control.

### 6.5 Props de fútbol y combinadas

El Boleto GP no puede prometer EV/Kelly por multiplicar probabilidades de partidos con títulos diferentes. Exigir precio real del producto combinado y probabilidad conjunta.

## 7. Esports

### 7.1 CS2 rondas/mapas

Fallos de mecanismo [D]: doble clampRound, probabilidades comprimidas alimentando una simulación de mapas, veto greedy, arrastre económico calibrado solo para prórroga con p=0,5 y momentum +0,06 sin evidencia.

S1, reparación mínima: (1) tipar p_round, p_map, p_series; (2) resolver por bisección p_round para que P(win_map)=p_map objetivo; (3) compilar serie con las probabilidades de cada mapa; (4) momentum apagado por defecto en el challenger; (5) distribución sobre vetos factibles prematch; tras publicarse el veto, condicionar a él.

S2: modelo de rondas identificable con estados de marcador, lado, mitad, economía y reglas OT.

Rosters: continuidad por jugador/rol con contracción. Experimento S3 de precio: mismos partidos/mapas/líneas, Pinnacle vs Cloudbet.

Puerta: round-trip mapa↔ronda↔serie correcto; cero violaciones de soporte; validación de PMF; incremento residual frente a consenso.

### 7.2 Props CS2

P1: `K_j = Σ_{m=1..2} K_j,m`, `K_j,m | R_m, θ_j, Z ~ conteo condicionado a exposición`. Simular conjuntamente R1,R2, lado/rol/mapa, KPR con incertidumbre y forma latente compartida Z. Dedup serie_canónica|jugador|stat|lado|política. Riesgo decisivo: una API con american_price no prueba que puedan apostarse singles a ese precio. Ejemplo: entrada 2 piernas a 3× con p=0,539 → ROI −12,844 %.

### 7.3 LoL

H-L1: el generador fuerza shareW≥0,5; medir frecuencia de winner_kills<loser_kills. H-L2: con shareW independiente de pMap, el total no cambia con la fuerza prematch. L1: histograma liga×parche/era con tendencia. L2: conjunta de duración, kills, diferencia y ganador. No financiar el handicap viejo.

### 7.4 Valorant

Prueba prioritaria: calibración por rango de favoritismo y lado, especialmente p≥0,70 donde el modelo reportaba 74,5 % y ocurría 42,3 %. Revisar orientación.

### 7.5 Dota 2

Parar liquidación prematura de BO3/BO5; eliminar elección de equipo por mayor historial ante nombres ambiguos. Prioridad menor que CS2.

## 8. Baloncesto

B0: rehacer el holdout de lesiones (ausencias del boxscore usan información posterior). B1: minutos = P(activo) × minutos|activo. H-B1: revisar denominador 240 vs 200 WNBA. B2: separar pretemporada, regular, playoff. B3: RAPM con incertidumbre. B4: pruebas de conservación de masa; margen recortado a ±30. B5: peso de mercado por familia; contra −110 breakeven 0,52381. B6: gates best.at y total/match_total.

## 9. NFL, NCAA y CFL

NFL pierde frente al mercado (MAE 10,31 vs 9,86; Brier 0,224 vs 0,210). Datos críticos: hora local con sufijo Z no es UTC; rosters 2025 no son 2026; moneyline en PUSH invalida P&L. NCAA: carry=0,5 en el borde de la rejilla; ROI +1,04 % IC −2,94/+5,02. CFL: 249 cierres; prioridad baja. Atlas: métrica de vecinos, media no garantizada, incertidumbre artificial, doble ruido, marcador alcanzable (T≥|M|, misma paridad).

## 10. Tenis, tenis de mesa y dardos

### 10.1 Tenis
Núcleo Sackmann congelado el 25-may-2026. Clamps [0,45;0,80] con tasa de activación. Shock por game no equivale a forma persistente. C6 solo respaldado para ATP BO3; modelar primero 2/3 sets y luego games. Ocho casos nuevos de 60 del preregistro; t≈2,99 con dos cierres tiene un grado de libertad (umbral ≈12,71).

### 10.2 Tenis de mesa
Holdout: Elo 0,5372, compilador 0,5789, ensemble 0,5273. Solo 30.644 de 192.460 filas con fecha exacta (15,9 %). ML no identifica el total de puntos: serveDelta=0,03 no puede estimarse invirtiendo una moneyline. Diagnóstico: puntos 71,885 real vs 71,232; sweep 0,4005 vs 0,4117; deuce 0,1578 vs 0,1489. Descomponer E[puntos]=Σ P(n_games=k)·E[puntos|k]. Identidades QA: −1,5 puntos en un game ≡ ganar el game; over 20,5 ≡ over 21,5 ≡ llegar a deuce. Operación: lados opuestos autorizados por magnitud de línea, matching ±36 h y cotizaciones no refrescadas.

### 10.3 Dardos
ML: Elo 0,6174, compiler 0,6071, ensemble 0,6045 en 6.688. Ventanas 365 y 90 días se solapan. D-D1: el DP aproxima bust volviendo al resto actual con penalización, el kernel de visita respeta retorno al inicio de la visita. H-D2: cache pT×10 y pD×20. Calibración a estadísticas observadas debe simular la censura del leg. MODUS excluido del preregistro no computa.

## 11. Combate y Fórmula 1

UFC: mercado Brier 0,2120, modelo 0,2343, blend 0,2180; peso de mercado 1 desde 2018. Cerrar ML UFC bruto como estrategia financiada. Métodos/rondas con riesgos competitivos. Boxeo: prioridad baja. F1: 35 carreras; post-quali no supera parrilla; H-F1: winner≤podio≤puntos.

## 12. Ejecución, contabilidad y datos

### 12.1 Un solo contrato, un registro inmutable

| Objeto | Identidad y datos mínimos | Invariante |
|---|---|---|
| Evento | ID canónico, IDs de proveedores, participantes, etapa/formato, hora prevista y real | Un alias ambiguo no genera una orden |
| Contrato | Evento, periodo, métrica, selección, línea con signo, OT/retirada/empate, versión de reglas | Mismo nombre comercial no implica mismo payoff |
| Cotización | Book, contract_id, precio, profundidad/límite, timestamps | Mejor precio y línea proceden de la misma fila |
| Predicción | Input snapshot, cutoff, modelo/hash/config, distribución | Reconstruible con información anterior a la decisión |
| Decisión | Universo elegible, filtros y motivo, p/EV, incertidumbre, versión | Rechazados se conservan |
| Orden/fill | Referencia idempotente, solicitado/aceptado, cuota, importe, fee, tiempos | Un timeout no permite duplicar |
| Liquidación | Resultado oficial, estado, regla, importe bruto/neto, revisión | Falta de datos no equivale a devolución |
| Cierre | Mismo contrato, fuente, timestamp, quotes de todos los lados | Prepartido según inicio real |

Reserva atómica de exposición antes de enviar. Saldo desconocido bloquea. Las alertas de parada deben ejercer la acción prevista sobre nuevas órdenes.

### 12.2 EV después de costes
`EV_monetario = s·(p·o−1) − f`; `o_min = (1+r+f/s)/p`. Tolerancia de deslizamiento 3 % puede consumir un edge de 2 %. Polymarket: fee = C·feeRate·p·(1−p), tasa Sports 0,05 para takers (consulta 15-09-2026); a precio 0,50, 100 shares → 1,25 de comisión.

### 12.3 Qué medir cada día
Por familia×book×versión×horizonte: universo, contratos válidos, quotes frescas, señales, órdenes, aceptadas/rechazadas, stake, fee, slippage, CLV justo, P&L neto, exposición, unresolved. Dos cohortes: por fecha de decisión y por fecha de liquidación. Conciliación: Δsaldo = depósitos − retiros − stakes + payouts − comisiones.

## 13. Programa de inversión

### 13.1 Decisiones propuestas hoy

| Familia | Decisión actual | Condición para avanzar |
|---|---|---|
| Cards under, núcleo | Pausar nuevas órdenes hasta reparar controles; máxima prioridad de revalidación | Cohorte limpia, modelo realmente servido, feed/settlement correctos, preregistro nuevo |
| CS2 rounds handicap | Prioridad alta, shadow por venue | Inversión p correcta; CLV justo y rentabilidad ejecutable |
| CS2 props | Prioridad alta condicionada al producto | Payout real, joint rounds/KPR, reglas DFS |
| TT totals | Prioridad alta; reparar antes de dinero | Contratos inequívocos, ajuste de duración, registro prospectivo |
| Tenis ATP BO3 totals | Shadow prioritario, regla fija | Datos actualizados, C6 legal, muestra nueva |
| LoL total kills | Shadow con generador nuevo separado | Versión auditada, dependencia correcta |
| Dardos ML/180s | Prioridad intermedia | ML contra precio; 180s con exposición y resultados |
| NBA/WNBA | Prioridad intermedia | Ausencias PIT, minutos, benchmark |
| Goles/córners de clubes | Retirar etiqueta de edge; challenger simple | Valor incremental por liga/familia |
| NCAA/CFL totals | Shadow diagnóstico | Mismo contrato, cierre justo, atlas |
| NFL bruto | No financiar | Reparar ML y tiempos |
| UFC ML bruto | Cerrar estrategia de dinero | Señal PIT supera mercado recalibrado |
| Boxeo, Dota, Valorant, F1 | Menor prioridad | Fallas específicas |
| LoL handicap viejo, combos | Retirar versión | Reemplazo revalidado |
| Polymarket fútbol No | Shadow neto de costes | Fees/fills/contratos |

Asignación orientativa: 40 % medición/ejecución común, 20 % tarjetas, 20 % CS2, 10 % TT, 10 % tenis.

### 13.3 Experimentos

| ID | Hipótesis y comparación | Resultado que la rechaza |
|---|---|---|
| E1 | Cards: composición vs cambio de precio; mix fijo | Desaparición del efecto al fijar mix |
| E2 | Cards: liga/paridad vs +equipos vs +árbitro | Ninguna mejora de score/calibración o EV neto |
| E3 | CS2: corrección de inversión y economía vs p=0,5, mismas series | Mejora solo teórica |
| E4 | CS2 props: exposición conjunta vs KPR simple | Ticket pierde por payout/correlación/costes |
| E5 | TT: corregir distribución por n_games vs spread latente | Sesgo de duración persiste |
| E6 | ATP BO3: C6 vs compilador y empírico | Solo gana en tramo retrospectivo |
| E7 | Edge invertido: curva de retorno vs residual calibrado | Techo no mejora muestra nueva |
| E8 | NCAA/CFL: CLV justo y atlas vs mercado contemporáneo | Liderazgo se explica por línea distinta, vig o in-play |
| E9 | Ejecución: shadow vs fills reales a tamaño controlado | Slippage, no-fill, fee eliminan margen |

### 13.4 Puertas de promoción

G0 integridad · G1 señal histórica · G2 shadow prospectivo · G3 piloto real · G4 escalar. Kelly/4 sobre una probabilidad errónea sigue siendo una apuesta errónea.

### 13.5 Secuencia

| Ventana | Trabajo | Entregable |
|---|---|---|
| Días 1–3 | Congelar estado, reconciliar dinero y contratos, corregir críticos | Ledger reproducible y lista de discrepancias |
| Días 4–10 | Unificar CLV/EV, snapshots PIT, replay del histórico, controles de duplicación | Métricas recalculadas sobre una cohorte por versión |
| Semanas 2–3 | Challengers de tarjetas/CS2; preparar TT/ATP | Comparaciones pareadas y registro de intentos |
| Semana 4+ | Shadow preregistrado | Evidencia nueva acumulada |
| Tras G2/G3 | Pilotos y escalado | Curva beneficio neto vs turnover |

## 14. Economía
A 18,7 tickets/semana, stake 30 y ROI 10 %: 56,10/semana, ≈243,75/mes. Para 100.000/mes: 5 M de turnover mensual al 2 % o 2 M al 5 %. La base de 980 registros demuestra interés, no clientes.

## 15. Respuestas a las diez preguntas
1. No hay "mete dinero ahí" con esta evidencia. 2. La caída de tarjetas no está identificada; E1/E2. 3. "CLV no aplica" no está demostrado. 4. Edge invertido: alerta, no umbral. 5. Cerrar versiones inválidas, LoL hcp viejo, UFC ML bruto, combos. 6. CS2, props, TT, ATP BO3 son hipótesis razonables; NCAA/CFL no. 7. Anclarse al mercado como baseline y residual, c fuera de muestra. 8. Sí hay fugas descritas. 9. Medición insuficiente. 10. Trading no soporta la estructura; producto aparte.

## 16. Registro priorizado

| ID | Prioridad / base | Lugar | Cambio verificable |
|---|---|---|---|
| A01 | P0 D | Selectores multibook | Fila inmutable con cuota, línea, selección, book y hora; replay de mismatches |
| A02 | P0 D/M | TT catálogo/executor | Contrato y periodo exacto; no colisión por magnitud; exposición por match |
| A03 | P0 D | Liquidadores | UNRESOLVED separado de VOID; conciliación de devoluciones |
| A04 | P0 D | Amfoot moneyline | Ganador/push/anulado según regla |
| A05 | P0 D | LoL/Dota resultados | Orientación y serie final; regenerar track por versión |
| A06 | P0 D/M | `lib/vara` | Sustituir CLV−medio margen por EV de cierre; estadístico sobre esa magnitud |
| A07 | P0 D | `real-executor/parada.js` | Condiciones vinculantes y auditables |
| A08 | P0 D/H | Executor/relay | Reserva atómica, saldo unknown bloqueado, idempotencia tras timeout |
| A09 | P0 D | Polymarket/propfirm | Fees por mercado/fill |
| A10 | P0 D/H | Matching proveedores | IDs inequívocos; ambiguos sin orden |
| A11 | P1 D | Captura de cierres | Prepartido real y mismo contrato; excluir in-play |
| A12 | P1 D | Hoops validación | Ausencias PIT o quitar la capa |
| A13 | P1 H | Hoops minutos | Denominador por liga |
| A14 | P1 D/M | Hoops mercado | Pesos por familia |
| A15 | P1 D | Hoops gates | best.at y nombres de familia |
| A16 | P1 D/M | CS2 compiler | P_round/map/series tipadas; bisección |
| A17 | P1 D/H | CS2/Valorant veto | Escenarios prematch o veto conocido |
| A18 | P1 D/M | Props CS2 | Contrato DFS y joint exposure |
| A19 | P1 D/H | Cards árbitro | Entrenado coincide con servido |
| A20 | P1 M/H | Cards pérdidas | Counterfactual sin doble conteo |
| A21 | P1 D/M | Corners | DAMP y prior separados |
| A22 | P1 D/H | Goals/mitades | Calibración propia; payoff cuartos |
| A23 | P1 D | Tenis datos/formato | Frescura, superficie, tiebreak |
| A24 | P1 D/H | Tenis C6 | PMF legal; validación nueva |
| A25 | P1 D/H | TT puntos | Saque/resto; duración por n_games |
| A26 | P1 D/H | Dardos DP/cache | Bust con estado correcto |
| A27 | P1 H | Dardos calibración | Misma censura que el dataset |
| A28 | P1 D/H | Amfoot atlas | Pool temporal, coordenadas, paridad |
| A29 | P1 D | NFL calendario/roster | Zona real→UTC; plantilla actual |
| A30 | P1 M | Inferencia general | Clusters, variantes registradas, test secuencial |
| A31 | P1 D | Track/edge-board | Una cohorte por versión; 96 vs 98 |
| A32 | P1 D | Logs/contabilidad | Sin truncado; cohortes decisión vs caja |
| A33 | P1 D/M | Combate | Mercado recalibrado como control |
| A34 | P1 H | F1 | DNF/H2H; winner≤podio≤puntos |
| A35 | P2 H | Todas | Capacidad, slippage, beneficio neto por tamaño |
| A36 | P2 D/H | Fuentes | Licencias/cobertura/coste |

## Apéndice A. Cálculos reproducibles

```python
from math import sqrt, ceil
from scipy.stats import norm, binom

def roi_ci(n, roi, odds):
    p = (1 + roi) / odds
    se = odds * sqrt(p * (1 - p) / n)
    return roi - norm.ppf(.975)*se, roi + norm.ppf(.975)*se

for name, n, roi, odds in [('NFL', 575, .0155, 1 + 100/110), ('NCAA', 2199, .0104, 1 + 100/110), ('CS2_props', 330, .022, 1 + 100/112)]:
    print(name, 'IC95_ROI_aprox', roi_ci(n, roi, odds))

o = 1.91; p0 = 1/o
for roi in [.01, .02, .03, .05, .10]:
    p1 = (1+roi)/o
    n = ceil(((norm.ppf(.975)*sqrt(p0*(1-p0)) + norm.ppf(.8)*sqrt(p1*(1-p1))) / (p1-p0))**2)
    print('ROI', roi, 'n_total_aprox', n, 'semanas_a_18.7', n/18.7)

entry, close = 1.97, 2/1.05
Q = 2/close
raw = entry/close - 1; old = raw - (Q-1)/2; fair_ev = entry/(close*Q) - 1
print('CLV_raw, regla_antigua, EV_cierre', raw, old, fair_ev)
assert old > 0 and fair_ev < 0

A, B = .45, .30 + .5*.25
fair_odds = 1 + B/A; naive_p = .5*(.45/(1-.25) + .45)
print('cuarto: odds_justa, odds_ingenua, EV_ingenuo', fair_odds, 1/naive_p, A*(1/naive_p-1)-B)

prob_stop = 1/1.81 + .07
wins01 = binom.ppf(.01, 100, prob_stop)
for stake in [30, 40]:
    print('parada', stake, 'wins_percentil1', wins01, 'P&L_percentil1', stake*(1.81*wins01-100))

p = .539
print('ejemplo_2legs_3x', 3*p*p-1, 'breakeven_por_pierna', sqrt(1/3))
print('false_positive_30_96_independientes', 1-.95**30, 1-.95**96)
print('fee_ejemplo_sports_100shares_a_0.5', 100*.05*.5*(1-.5))
print('beneficio_mensual_hipotetico', 18.7*4.345*30*.10)
```
