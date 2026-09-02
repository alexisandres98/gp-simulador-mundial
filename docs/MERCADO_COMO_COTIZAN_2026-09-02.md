# Qué sabe el mercado que un modelo de resultados no sabe — evidencia por mercado (2-sep-2026)

> Investigación con fuentes para acompañar `AUTOPSIA_MODELOS_2026-09-02.md`. Leyenda: **[A]** evidencia académica
> revisada · **[I]** práctica de la industria / datos publicados por operadores o analistas · **[Inf]** inferencia
> propia a partir de lo anterior. Las fuentes están al final.

## 1. Fútbol 1X2 en ligas medias y bajas

**Eficiencia del cierre.** El cierre de Pinnacle, con margen retirado, está calibrado casi 1:1: sobre 173.958
cuotas de 57.986 partidos, apostar a todos los resultados devolvió 99,73 % (σ = 0,40 %), y el ratio
pre-cierre/cierre predice el retorno real **[I]**. La eficiencia depende del *mercado*: Hegarty & Whelan (IJF
2025, 150.000 partidos) encuentran un fuerte sesgo favorito-longshot en 1X2 pero **ninguno en el hándicap
asiático**, cuyas cuotas son mejor estimador de la probabilidad **[A]**. Angelini & De Angelis (IJF 2019; 41
casas, 11 ligas, 11 años) hallan 7 mercados eficientes y 4 con ineficiencias explotables tomando la mejor
cuota **[A]**. Direr (2013) obtiene +4,45 % apostando a favoritos con probabilidad > 90 % con la mejor cuota
**[A]**; Deschamps & Gergaud documentan un longshot bias *negativo* en el empate **[A]**.

**Modelos que han igualado o batido el cierre.** Ratings dinámicos con margen de goles (pi-ratings) **[A]**;
Poisson bivariado dinámico (Koopman & Lit, JRSS-A 2015) **[A]**; Weibull bivariado con cópula (Boshnakov et
al., IJF 2017) **[A]**; ratings de *estadísticas* (tiros a puerta, córners) en lugar de goles (Wheatcroft 2021)
**[A]**. Dos hallazgos estructurales: Wunderlich & Memmert (PLoS ONE 2018, ~15.000 partidos): un Elo
alimentado con **cuotas** supera a un Elo alimentado con resultados o goles **[A]**; Peeters (IJF 2018): el
**valor de plantilla de Transfermarkt** predice mejor que FIFA/Elo y genera ganancias **[A]**. Sin modelo
propio: Kaunitz et al. (2017) toman la media de cuotas como probabilidad justa y apuestan cuando una casa se
desvía ≥ 5 %: +3,5 % en 56.435 apuestas (2005-15), +8,5 % en 265 apuestas reales, hasta que las casas
limitaron las cuentas **[A]**.

**Información de plantilla.** Ante la ausencia anunciada de un jugador élite el mercado reacciona con inercia
inicial y ajuste rezagado (Economic Inquiry 2025; 117.174 cuotas) **[A]**. En ligas menores la alineación
oficial (≈1 h antes) es el último gran shock informativo **[Inf]**.

**Cómo abren las casas.** Levitt (EJ 2004): no equilibran el libro, toman posición y explotan sesgos **[A]**.
Franck et al. (Economica 2013): arbitraje casa-exchange en el 19,2 % de partidos **[A]**. En un consenso, el
95-100 % del peso óptimo recae en Pinnacle **[I]**.

**Ascendidos / nueva temporada.** Deutscher, Frick & Ötting (2018): apostar a victorias de recién ascendidos
fue rentable al inicio de temporada y la ineficiencia desapareció en pocas jornadas **[A]**. El mercado usa
priors de plantilla/traspasos que un modelo de resultados no tiene hasta 8-10 jornadas después **[Inf]**.

**Implicación para el modelo**
- Anclar a la probabilidad implícita del **hándicap asiático** o a Pinnacle sin margen (Shin), no al 1X2 de
  casas blandas; el modelo aporta solo desviación sobre ese prior (Benter, §7).
- Sustituir Elo-resultado por Elo-cuotas + ratings de tiros/xG; valor de plantilla como prior de pretemporada.
- El edge accionable: (i) desviaciones de una casa frente al consenso (≥ 5 %), (ii) empates y favoritos
  extremos, (iii) primeras jornadas y la hora post-alineación. No la señal 1X2 pura al cierre.

## 2. Córners y tarjetas

**Derivación.** Yip (JORS 2024; HKJC 2016-21) modela córners como compuesto Poisson con clustering y usa como
covariables la supremacía y el total **implícitos en las cuotas 1X2 y O/U**: la casa deriva córners del
mercado principal **[A]**. Medias por liga 9,4-11,0 y ratio varianza/media 1,10-1,30: sobredispersión que un
Poisson simple subestima **[A]**.

**Ineficiencia (sesgo público al over).** En 2.057 partidos HKJC 2021 el payout fue **85,7 % en el over y
98,2 % en el under** **[A]**. Un NB con dispersión variable ganó +5,8 % en 1.137 apuestas; apostar ciego al
under perdió −1,7 % **[A]**. Lund (2023) replica en EPL (under infravalorado, p = 0,001) pero los modelos **no
transfieren a la Bundesliga** sin reentrenar **[A]**. Márgenes mayores y límites bajos **[I]**.

**Tarjetas.** Dawson et al. (JRSS-A 2007) y Boyko (2007): variación robusta entre árbitros **[A]**. Buraimo et
al. (JRSS-A 2010): el **estado del partido** (marcador, tarjetas recientes) es el principal generador de
tarjetas y absorbe parte del sesgo aparente **[A]**.

**Implicación para el modelo**
- NB/geométrico-Poisson, no Poisson; supremacía y total del mercado como covariables.
- La ventaja histórica está en el **under** de partidos populares; publicar overs exige superar un payout
  de ~86 %.
- Árbitro como efecto aleatorio con encogimiento, condicionado a la cercanía esperada; reentrenar por liga.

## 3. Esports: rondas (CS2/Valorant) y kills (LoL)

Pinnacle ofrece hándicap de rondas por mapa ±7,5, kills ±5,5, mapas ±1,5 en Bo3; "cada emparejamiento se
precia individualmente" **[I]**. El derivado es una transformación de la probabilidad del mapa a una
distribución de margen; la línea se mueve cuando se mueve el mapa **[Inf]**. Con MR12 un binomial iid con
p = 0,5 daría 16 % de 12-12, pero la economía induce **dependencia serial** (73,3 % de rondas no-pistola son
full buys; Xenopoulos et al. modelan la ronda con equipo y dinero) **[A/I]**; las cuotas de OT (6,5-9,5)
implican ≈10-15 % con margen **[I/Inf]**. En Valorant la defensa gana 50-55 % salvo Lotus (ataque 52,6 %;
Ascent defensa 54,7 %): el lado de inicio y el mapa sesgan el margen **[I]**. Pinnacle recomienda apostar
mapas en vivo, cuando ya se conoce el mapa **[I]**. Li et al. (JIFS 2024): coexisten FLB y FLB inverso según
título y torneo **[A]**. No hay investigación pública sobre la distribución del margen MR12 **[Inf]**.

**Implicación para el modelo**
- Simular rondas con estado económico (Markov), no binomial; calibrar la cola de OT por mapa y lado.
- El hándicap de rondas hereda el error del mapa: si el modelo no bate el moneyline del mapa, el derivado
  tampoco. Modelar *después* del veto.
- Kills LoL: ajustar por parche, región y duración media; la señal es de estilo, no de fuerza.

## 4. MMA/UFC moneyline

Miller & Nichols (J. Econ. Finance 2026): **no** hay FLB en MMA; las casas subvaloran juventud, ventaja de
viaje y favoritas femeninas, pero fuera de muestra "pocos retornos significativos" **[A]**. En 2.229 combates
UFC los ganadores son 0,2-1,5 años más jóvenes según división **[I]**. La recuperación de peso post-pesaje no
predice el resultado en Bellator; en mujeres, +1 % de pérdida rápida se asocia a OR 1,6 de ganar **[A]**. Un
favorito que falla el peso ve su cuota alargarse 20-40 % **[I]**. Los modelos públicos (Elo, edad, alcance,
inactividad) no se comparan contra el cierre **[I]**.

**Implicación para el modelo**
- La única anomalía documentada es edad/juventud y viaje; alcance e inactividad no muestran edge sobre el
  mercado.
- El mercado sabe sustituciones y pesajes; sin cerrar la posición tras el pesaje el modelo compite con
  información vieja **[Inf]**.

## 5. Tenis: total y hándicap de juegos

Puntos ≈ iid (Klaassen & Magnus, JASA 2001) **[A]**; Barnett & Clarke (2005): % saque/devolución → p(punto) →
Markov → distribución de juegos **[A]**. El primer servidor cambia el total esperado ≤ 0,4 juegos; 10 pp de
diferencia en p(saque) mueven ~9 % la probabilidad de superar 19,5 juegos **[A]**. Kovalchik (JQAS 2016):
consenso de casas 72 % de acierto vs Elo 70 %; top-30 75-76 % vs rankings bajos 56-67 % **[A]**. FLB positivo
en ATP, más fuerte en rankings bajos y torneos grandes **[A]**. Fatiga: en Grand Slam un set extra en la ronda
previa resta 4,5 pp a las mujeres; los hombres pierden 4,9 pp solo con dos sets extra **[A]**. Retiradas:
Pinnacle, Betfair y Unibet liquidan moneyline con un set completado; bet365 exige partido completo;
hándicaps y totales se anulan si no se completa **[I]**.

**Implicación para el modelo**
- Totales desde p(hold) por superficie con prior de Elo específico; el edge, si existe, está en rankings
  bajos/Challengers, donde hay más FLB y límites menores.
- Incluir carga del partido anterior (sets/duración), sobre todo en WTA.
- El riesgo de retirada casi no afecta a totales/hándicap (void) pero sí al moneyline según la casa.

## 6. Baloncesto (NBA/WNBA)

Gandar et al. (J. Finance 1998): los movimientos apertura→cierre mejoran la precisión **[A]**. Totales: Paul,
Weinbach & Wilson (2004): en los totales más altos el over está sobreapostado **[A]**; grandes favoritos
sobreapostados **[A]**. Modelos: el Markov de posesiones de Štrumbelj & Vračar (IJF 2012) pierde ante las
cuotas **[A]**; Manner (2016): solo modelo + cuotas mejora levemente **[A]**; Hubáček et al. (IJF 2019; 9.093
partidos, cierre Pinnacle 69 % de acierto): un modelo **decorrelacionado** de la casa gana +1,0 a +1,4 %; la
precisión sola no genera beneficio **[A]**. Árbitros: favorecen al local y al que va perdiendo **[A]**; el
efecto de la terna sobre el total (3-5 pts) es práctica de la industria **[I]**. Key numbers: el 7 es el
margen más frecuente (~10 %) pero la distribución es plana; σ(margen vs spread) ≈ 12; la varianza del total
crece ~1 pt por encima de 200 **[I]**. Timing: reporte de lesiones a las 17:00 del día previo y actualización
15-30 min antes; una estrella fuera mueve ~3 pts de spread y 2-4 de total **[I]**. WNBA: límites $500-1.000,
diferencias de 2 pts entre casas, noticias de beat writers antes que las casas **[I]**.

**Implicación para el modelo**
- Cerrar con la información de lesiones final; el skill −0,0079 fuera de muestra es coherente con la
  literatura **[Inf]**.
- Edge estructural: unders en totales altos, decorrelación explícita frente al mercado, y WNBA/props donde
  los límites bajos señalan mercados menos eficientes.

## 7. Cómo operan los sharps

Originadores (modelo propio, apuestan en apertura) vs tomadores de precio ("steam chasers"): seguir el steam
de Pinnacle en MLB dio 52,1 % en 8.636 apuestas **[I]**. Métrica: **CLV** — Buchdahl: si bates el cierre justo
un 5 %, tu EV es ≈5 %; con 22.281 apuestas en casas blandas obtuvo yield 3,4 % con ventaja media 2,2 %;
filtrando ≥ 5 % de ventaja, 13,2 % en 1.927 apuestas **[I]**. Pinnacle acepta ganadores y usa sus apuestas para
afinar la línea; las blandas limitan **[A/I]**. Los derivados con márgenes anchos y límites bajos son donde
las casas *saben* que están expuestas **[Inf]**. Staking: Kelly fraccional (1/4-1/8) **[I]**. Combinación:
Benter (1994) integra la probabilidad del público con el modelo en un logit; Hubáček/Manner confirman que la
ganancia viene de la **desviación ortogonal** al mercado **[A]**. Tamaño del edge documentado al cierre:
**1-4 %**.

**Implicación para el modelo**
- Medir todo contra el cierre sin margen (CLV); 50-100 apuestas bastan para diagnosticar.
- `logit(p) = α·logit(p_mercado) + β·modelo` y publicar solo cuando la desviación supere margen + umbral.
- Bankroll con ¼ Kelly sobre el edge *neto* del prior del mercado.

## Fuentes

- https://arxiv.org/abs/1710.02824 — Kaunitz, Zhong & Kreiner (2017): consenso de cuotas; +3,5 % en 56.435 apuestas.
- https://ida.felk.cvut.cz/zelezny/pubs/ijf.2019.pdf — Hubáček, Šourek & Železný (IJF 2019): decorrelación frente a la casa; NBA 2006-14.
- https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0198668 — Wunderlich & Memmert (2018): Elo basado en cuotas.
- https://www.degruyterbrill.com/document/doi/10.1515/jqas-2012-0036/html — Constantinou & Fenton (2013): pi-ratings.
- https://rss.onlinelibrary.wiley.com/doi/10.1111/rssa.12042 — Koopman & Lit (JRSS-A 2015).
- https://www.sciencedirect.com/science/article/abs/pii/S0169207017300018 — Boshnakov, Kharrat & McHale (IJF 2017).
- https://journals.sagepub.com/doi/full/10.3233/JSA-200462 — Wheatcroft (2021): ratings de estadísticas.
- https://www.sciencedirect.com/science/article/abs/pii/S0169207017300754 — Peeters (IJF 2018): Transfermarkt.
- https://godsofodds.com/en/previews/how-accurate-are-pinnacle-s-closing-odds — calibración del cierre de Pinnacle.
- https://www.sciencedirect.com/science/article/pii/S0169207024000670 — Hegarty & Whelan (IJF 2025).
- https://www.sciencedirect.com/science/article/abs/pii/S0169207018301134 — Angelini & De Angelis (IJF 2019).
- https://www.sciencedirect.com/science/article/abs/pii/S0169207009001733 — Štrumbelj & Robnik-Šikonja (IJF 2010).
- https://ideas.repec.org/a/taf/applec/v45y2013i3p343-356.html — Direr (2013).
- https://www.researchgate.net/publication/291191792_Efficiency_in_Betting_Markets_Evidence_From_English_Football — Deschamps & Gergaud.
- https://ideas.repec.org/a/bla/ecinqu/v63y2025i1p236-264.html — Economic Inquiry (2025): ausencias de jugadores élite.
- https://doi.org/10.1080/00036846.2017.1418082 — Deutscher, Frick & Ötting (2018): ascendidos.
- https://academic.oup.com/ej/article-abstract/114/495/223/5086012 — Levitt (EJ 2004).
- https://ideas.repec.org/a/taf/eurjfi/v24y2018i18p1799-1816.html — Grant et al. (EJF 2018).
- https://www.wiwi.uni-muenster.de/uf/sites/uf/files/PublikationenNuuesch/2013franck_verbeek_nueesch_2013.pdf — Franck, Verbeek & Nüesch (2013).
- https://arxiv.org/abs/2112.13001 — Yip (JORS 2024): córners.
- https://lup.lub.lu.se/student-papers/record/9127007/file/9127013.pdf — Lund (2023): córners EPL.
- https://academic.oup.com/jrsssa/article-abstract/170/1/231/7085267 — Dawson et al. (2007).
- https://pubmed.ncbi.nlm.nih.gov/17654230/ — Boyko et al. (2007).
- https://academic.oup.com/jrsssa/article-abstract/173/2/431/7077578 — Buraimo, Forrest & Simmons (2010).
- https://www.pinnacle.com/en/esports-hub/betting-articles/educational/handicap-betting-in-esports/l8y29rk76t5udksb — Pinnacle: hándicaps esports.
- https://www.pinnacle.com/en/esports-hub/betting-articles/cs-go/csgo-live-betting-guide/e652el7pvulh62nh — Pinnacle: veto y economía.
- https://www.pinnacle.com/en/esports-hub/betting-articles/league-of-legends/totals-betting-in-league-of-legends/emr2l49dk4cpjld5 — Pinnacle: totales LoL.
- https://arxiv.org/abs/2109.12990 — Xenopoulos et al. (2021): rondas y economía en Counter-Strike.
- https://www.hltv.org/news/36967/the-logic-behind-valves-move-to-mr12 — HLTV: MR12.
- https://www.hltv.org/betting/guides/csgo-overtime-bets — HLTV: cuotas de OT.
- https://esportsrambles.com/blog/valorant-round-win-distribution — Valorant: rondas por lado y mapa.
- https://journals.sagepub.com/doi/10.3233/JIFS-232932 — Li et al. (JIFS 2024): FLB en esports.
- https://www.sciencedirect.com/science/article/abs/pii/S0167487020300660 — Parimutuel CS:GO (2020).
- https://link.springer.com/article/10.1007/s12197-026-09757-x — Miller & Nichols (2026): MMA.
- https://agentmma.com/mma-lab/ufc-fighter-peak-age — edad de ganadores por división.
- https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11511017/ — pérdida rápida de peso y resultado.
- https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11842001/ — Bellator: recuperación de peso.
- https://bettingmmauk.com/articles/ufc-weigh-in-line-movement/ — movimientos tras pesaje.
- https://ideas.repec.org/a/bes/jnlasa/v96y2001mjunep500-509.html — Klaassen & Magnus (2001).
- https://academic.oup.com/imaman/article-abstract/16/2/113/704903 — Barnett & Clarke (2005).
- https://arxiv.org/abs/2605.04867 — primer servidor y total de juegos.
- https://vuir.vu.edu.au/34652/1/jqas-2015-0059.pdf — Kovalchik (JQAS 2016).
- https://www.tandfonline.com/doi/abs/10.1080/13518470701705736 — Forrest & McHale (2007).
- https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2287335 — Lahvička (2014).
- https://www.sciencedirect.com/science/article/pii/S0169207022001091 — Ramirez, Reade & Singleton (IJF 2023).
- https://arxiv.org/abs/2306.01740 — corrección del "buzz".
- https://fspieksma.win.tue.nl/papers/IJPAS2015paper.pdf — Goossens et al. (2015): fatiga en Grand Slam.
- https://tennisedge.io/tennis-betting-rules/ — reglas de retirada por casa.
- https://www.rebelbetting.com/faq/tennis-rules — tabla de reglas de retirada.
- https://onlinelibrary.wiley.com/doi/10.1111/0022-1082.155346 — Gandar, Dare, Brown & Zuber (1998).
- https://ideas.repec.org/a/eee/quaeco/v44y2004i4p624-632.html — Paul, Weinbach & Wilson (2004).
- https://journals.sagepub.com/doi/10.1177/1527002504266861 — Paul & Weinbach (2005).
- https://www.sciencedirect.com/science/article/abs/pii/S0169207011000458 — Štrumbelj & Vračar (IJF 2012).
- https://doi.org/10.1515/jqas-2015-0088 — Manner (JQAS 2016).
- https://onlinelibrary.wiley.com/doi/10.1111/j.1530-9134.2011.00325.x — Price, Remer & Stone (2012).
- https://www.boydsbets.com/standard-deviations-of-overunder-margins-by-total/ — desviación del margen O/U.
- https://www.boydsbets.com/nba-key-numbers/ — key numbers NBA.
- https://official.nba.com/nba-injury-report-2025-26-season/ — reporte de lesiones NBA.
- https://www.betstamp.com/education/wnba-betting-strategy-guide — WNBA: límites y noticias.
- https://www.bleachernation.com/betting/2025/10/17/maximum-bet-size/ — límites en mercados nicho.
- https://datagolf.com/how-sharp-are-bookmakers — márgenes por casa y quién origina.
- https://www.football-data.co.uk/blog/wisdom_of_the_crowd.php — Buchdahl: Wisdom of the Crowd.
- https://www.pinnacle.com/betting-resources/en/educational/a-case-study-why-arent-bettors-allowed-to-win/tx32bq2dnw9vmyr6 — Pinnacle acepta ganadores.
- https://www.sportsinsights.com/blog/why-should-mlb-bettors-follow-the-pinnacle-steam-move/ — steam de Pinnacle.
- https://www.pinnacle.com/betting-resources/en/betting-strategy/revisiting-the-kelly-criterion-part-2-fractional-kelly/gbd27z9nljvgflgg — Kelly fraccional.
- https://gwern.net/doc/statistics/decision/1994-benter.pdf — Benter (1994).

**Limitaciones:** no existe literatura pública sobre la distribución de márgenes de ronda MR12 en Valorant vs CS2
ni sobre tasas de acierto tras pesajes fallidos en UFC; esas afirmaciones se marcan como inferencia o práctica
de industria.
