# LoL Intelligence OS — Master Blueprint 3.0 (texto plano extraído del .docx de Alexis, 1-sep-2026)

> Fuente: GPsimulador_LoL_Intelligence_OS_Master_Blueprint.docx. Guardado aquí para que las sesiones siguientes lo tengan sin volver a subirlo.

GP SIMULADOR  /  ESPORT INTELLIGENCE
League of LegendsIntelligence OS
Master Blueprint 3.0 — the data, quant, market, picks and product system for a category-defining LoL intelligence terminal
THE OBJECTIVEBuild the product a professional LoL analyst opens for game intelligence, a bettor opens for executable prices, a sharp opens for model evidence, and a fan opens because no other public product explains a draft, a game or a market with the same depth. The target is not “more dashboards.” The target is an operating system for understanding and pricing professional League of Legends.
Version: August 2026  |  Scope: professional League of Legends  |  Modes: pre-match, draft-conditioned, post-match; live only when lawful low-latency data is available
00 / PRODUCT MANDATE
What “number one” means
GP does not earn the right to call itself the best because it has the most numbers. It earns it when the data chain is auditable, the forecast is calibrated, the market comparison is orthogonal, the pick is executable, and the interface compresses complexity into understanding faster than any alternative.
ACCEPTANCE SENTENCEThe desired external review is: “Structurally they are operating like an elite esports quant/syndicate. What they still need is more live sample, not missing methodology.”
Non-negotiable outcomes
ID
Requirement / capability
LOL-0001
Every published probability is reproducible from an immutable point-in-time snapshot.
LOL-0002
Every output states whether it is measured, derived, inferred, market-informed, or unavailable.
LOL-0003
Every betting family is validated independently; no blanket claim that “GP has edge in LoL.”
LOL-0004
Every pick has a fair price, maximum playable price, edge posterior, uncertainty, timestamp and market source.
LOL-0005
Every draft-conditioned probability is computed only from information known at that draft step.
LOL-0006
Every model is patch-aware and roster-aware; old data is never treated as stationary by default.
LOL-0007
Every player is evaluated within role, champion context, team resource allocation and opponent quality.
LOL-0008
Every series model handles side selection, adaptation and non-independence between games.
LOL-0009
Every screen has one dominant domain story; tables are secondary evidence, not the page architecture.
LOL-0010
Every visual element has semantic meaning. Decorative glow, generic gradients and card repetition are prohibited.
LOL-0011
Every edge family can be degraded, paused or killed automatically when CLV/calibration deteriorates.
LOL-0012
Every data source has an explicit commercial-rights record before it can feed a public betting output.
LOL-0013
Every market that informed a model is excluded or orthogonalized when evaluating value against that same market.
LOL-0014
Every user mode — Fan, Bettor, Analyst — sees the same truth at a different depth, never different numbers.
LOL-0015
Every model change is champion/challenger tested before replacing production.
North-star KPI stack
Layer
Primary KPI
Why it matters
Data
point-in-time completeness + source-rights coverage
A perfect model on illegal, stale or future data is worthless.
Forecast
log loss / Brier / calibration by regime
Measures probabilistic quality, not just winners.
Market
CLV by family and timing
Best early evidence that prices are systematically better than market.
Execution
realized price vs signaled price
Separates model edge from fantasy execution.
Portfolio
risk-adjusted return + drawdown
A syndicate manages correlated exposure, not isolated picks.
Product
time-to-insight + return usage
The terminal must make intelligence faster to consume.
Trust
prediction reproducibility rate
Every public claim must be replayable.
01 / DESIGN DIVERGENCE
What we keep from CS2 — and what LoL must break
The current CS2 product proves that GP can turn model logic into a coherent branded terminal. LoL should preserve its rigor and transparency but must deliberately escape its vertically stacked dashboard grammar.
Preserve from CS2
ID
Requirement / capability
LOL-0016
The separation between market probability, GP probability, disagreement and model weight.
LOL-0017
The explicit “what GP does not know” treatment of uncertainty.
LOL-0018
The NO PICK doctrine and visible reasons for rejection.
LOL-0019
The model-validation panel with out-of-sample metrics and transparent constants.
LOL-0020
The ability to move from slate → match → team → player → ecosystem without changing product language.
LOL-0021
The use of game-specific visual objects rather than generic sports charts.
LOL-0022
The clear labeling of measured versus assumed inputs.
LOL-0023
The idea that a sport has a signature object: veto board in CS2; draft + Rift state in LoL.
LOL-0024
The compact dark GP shell, left navigation and cross-sport navigation continuity.
LOL-0025
The willingness to show model shortcomings instead of hiding residuals.
Break deliberately for LoL
ID
Requirement / capability
LOL-0026
No long page where every module is a rounded rectangle stacked below the previous module.
LOL-0027
No repeated “metric cards” as the primary information architecture.
LOL-0028
No single accent color carrying data, action, edge, confidence and decoration simultaneously.
LOL-0029
No generic horizontal bar chart when a lane, draft, timing or objective-native visual can explain the same fact.
LOL-0030
No 100-row market table as the first representation of opportunity; market surfaces must group by thesis and family.
LOL-0031
No player page that is mainly a stat header plus a conventional table; it must explain role, champion pool, resource share and impact.
LOL-0032
No rankings page that is simply a leaderboard; ranking must expose uncertainty, roster state, region strength and matchup context.
LOL-0033
No model section buried below the fold; model trust must be available as a persistent provenance lens.
LOL-0034
No “AI written analysis” block with generic prose. GP Analyst must cite structured variables and show the changed state behind each sentence.
LOL-0035
No mimicry of Riot’s in-game HUD or LoL Esports broadcast graphics; GP needs its own institutional design language.
Visual direction: GP-native, domain-specific and editorial — not a clone of the game client or a generic AI dashboard.
02 / LEGAL-DATA ARCHITECTURE
Data rights are a model feature
For LoL, the data architecture cannot be designed after the product. Riot’s current Developer Portal policy states that products using Riot Developer Tools cannot feature betting or gambling functionality. Official real-time LoL esports data is distributed through Riot’s official data ecosystem with GRID. Therefore GP must maintain a hard rights firewall: no source enters public betting/pick calculations until its commercial betting rights are documented.
CRITICAL ARCHITECTURE RULEDo not build GP LoL picks on Riot Developer API / Developer Tools data and hope to solve policy later. Build adapters and research layers so the modelling IP survives regardless of data supplier. For official sanctioned betting data, treat GRID or another explicitly authorized commercial arrangement as an upgrade path, not something the core intellectual property depends on.
Source-rights firewall
ID
Requirement / capability
LOL-0036
Create a source_registry table with owner, endpoint/feed, fields, license, commercial permission, betting permission, attribution, retention and termination conditions.
LOL-0037
Each ingested row carries source_id and rights_class; Gold features inherit the strictest rights class among their inputs.
LOL-0038
Public picks may only use features whose lineage is marked betting_commercial_ok.
LOL-0039
Research-only community datasets live in a separate warehouse schema and cannot be promoted accidentally.
LOL-0040
Create CI tests that fail deployment if a restricted source is referenced by a betting model feature set.
LOL-0041
Use vendor-neutral canonical entities so replacing a feed requires an adapter, not rebuilding models or UI.
LOL-0042
Do not scrape Riot, Leaguepedia, Oracle’s Elixir or third-party sites for production unless explicit terms permit GP’s commercial use.
LOL-0043
Treat logos, champion art and Riot assets as independent rights objects; data permission does not imply image permission.
LOL-0044
Allow text-first/abstract champion representations if art rights are not cleared.
LOL-0045
Keep a human approval field for each new source and store the approval document/reference.
LOL-0046
Create an emergency source kill switch that invalidates downstream picks when a feed is revoked.
LOL-0047
Keep research reproducible after a provider swap by retaining GP-owned normalized feature definitions and model artifacts.
LOL-0048
Build optional official-feed adapters so future GRID access adds latency/granularity without changing model contracts.
LOL-0049
Have legal counsel review the final commercial data path before public betting launch.
Current source reality to design around
Source / channel
Useful for
Production betting stance
Riot Developer Tools / Data Dragon
static game data, assets, ordinary player ecosystem
Do not feed betting functionality without explicit Riot approval; current general policy prohibits betting/gambling functionality.
Riot / GRID official esports data
official scores, real-time competition data
Clean official path; commercial terms required.
LoL Esports Data Portal ecosystem
professional competition data distributed to partners/community
Access/rights depend on program and downstream source; verify commercial betting permission.
Oracle’s Elixir-type datasets
historical pro-match R&D, feature prototyping
Excellent research bootstrap; do not assume commercial betting rights.
Commercial odds feeds
price history, markets, settlement
Required; contract must permit storage, analytics and display.
Licensed news/roster provider
roster, substitutions, announcements
Required for point-in-time roster and availability state.
Research references are listed in the source appendix. This blueprint is product/technical guidance, not legal advice.
03 / DATA FABRIC
Build memory before intelligence
LoL changes by patch, roster, side, champion and tournament context. A flat “matches.csv” is not a system. GP needs event-sourced temporal truth that can answer exactly what was known at any pre-match, draft-step or market timestamp.
Bronze — immutable source events
ID
Requirement / capability
LOL-0050
Raw match/event payloads stored exactly as received with ingestion timestamp and checksum.
LOL-0051
Raw schedules and event lifecycle changes retained rather than overwritten.
LOL-0052
Raw roster announcements, substitutions and role swaps stored as events.
LOL-0053
Raw market snapshots stored append-only at book × market × selection × line × timestamp resolution.
LOL-0054
Raw draft sequence stored pick-by-pick and ban-by-ban with exact ordering and timestamps when available.
LOL-0055
Raw game outcomes and granular statistics retained independently from derived features.
LOL-0056
Raw patch metadata and competitive rules retained by effective date.
LOL-0057
Raw tournament format/side-selection rules versioned.
LOL-0058
Raw source errors and missing-data events retained for later quality analysis.
LOL-0059
Every event has source, observed_at, effective_at and ingested_at timestamps.
Silver — canonical LoL entities
ID
Requirement / capability
LOL-0060
Canonical team identity with historical aliases, organization ownership and region spells.
LOL-0061
Canonical player identity with aliases, legal name, nationality if licensed, DOB if licensed, and career spells.
LOL-0062
RosterSpell: team, player, role, start/end, active/substitute status and evidence.
LOL-0063
CoachSpell and staff continuity for draft/adaptation analysis.
LOL-0064
League, tournament, stage, group, series and game entities separated explicitly.
LOL-0065
Patch and ruleset entity attached to every game.
LOL-0066
Side assignment per game and side-choice context when available.
LOL-0067
Champion entity with stable GP ID independent of external provider identifiers.
LOL-0068
ChampionRoleSpell because viable roles change across patches.
LOL-0069
Item, rune, summoner spell and objective entities only from rights-safe sources.
LOL-0070
DraftEvent with action type, champion, team, slot, role uncertainty and timestamp.
LOL-0071
PlayerGame and TeamGame rows with normalized statistics and data completeness flags.
LOL-0072
MarketEvent canonicalization across books and naming conventions.
LOL-0073
Settlement entity independent from market snapshot history.
LOL-0074
NewsEvent / roster status entity for lineup and role uncertainty.
LOL-0075
DataQualityEvent for conflicts, stale state, impossible values and late corrections.
Gold — predictive feature stores
ID
Requirement / capability
LOL-0076
Team strength snapshots by timestamp, region, patch and side.
LOL-0077
Player-role strength snapshots with uncertainty.
LOL-0078
Region meta-strength and cross-region bridge ratings.
LOL-0079
Champion global strength by patch/role plus posterior uncertainty.
LOL-0080
Player × champion mastery and recency features.
LOL-0081
Team × champion comfort, priority and flex features.
LOL-0082
Pairwise and higher-order champion synergy features.
LOL-0083
Champion counter and lane matchup features conditioned on role/patch.
LOL-0084
Team draft-style vectors and coach draft-style vectors.
LOL-0085
Lane pressure, jungle pressure and early-game expected differential features.
LOL-0086
Objective control and conversion features.
LOL-0087
Gold-lead conversion / comeback features.
LOL-0088
Series adaptation and between-game adjustment features.
LOL-0089
Game duration hazard features.
LOL-0090
Kill intensity and player opportunity features.
LOL-0091
Market consensus, sharp-weighted consensus and market disagreement features.
LOL-0092
Point-in-time model-ready matrices with explicit availability timestamps.
04 / TEMPORAL IDENTITY
Roster state is not metadata — it is the team
Team names are insufficient. In LoL, the object being rated is the current competitive unit: organization + five players + roles + coach + patch + region context. Every model must know which version of a team it is looking at.
Identity and roster engine
ID
Requirement / capability
LOL-0093
Never collapse academy, challenger, sister or rebranded teams solely by name similarity.
LOL-0094
Build alias resolution with candidate scoring and human review for ambiguous cases.
LOL-0095
Attach each historical game to the roster spell active at game start.
LOL-0096
Maintain player role probabilities rather than forcing a fixed role when swaps/flexes are uncertain.
LOL-0097
Compute roster continuity at 5-man, 4-man, 3-man and coaching-core levels.
LOL-0098
Compute games together, days together and patch exposure together.
LOL-0099
Create replacement-impact priors by role and outgoing/incoming player strength.
LOL-0100
Create role-swap penalties with uncertainty rather than deterministic downgrades.
LOL-0101
Build roster cold-start priors using player histories and region-adjusted skill.
LOL-0102
Create substitute uncertainty states until official lineup confirmation.
LOL-0103
Expose roster freshness and evidence source in UI.
LOL-0104
Create a roster graph where nodes are players and edges are shared games/time.
LOL-0105
Use roster graph features for synergy, not just team name history.
LOL-0106
Allow coach changes to reset/decay draft-style priors faster than mechanical team skill.
LOL-0107
Create manual override workflow with audit trail for emergency roster news.
05 / PATCH & META ENGINE
Patch is a regime, not a column
The model must treat professional League as non-stationary. Champion power, item systems, objective rewards, lane dynamics and draft priority change. GP needs to identify when old evidence remains useful and when it becomes misleading.
Patch regime detection
ID
Requirement / capability
LOL-0108
Attach every game to exact competitive patch, not current client patch.
LOL-0109
Maintain patch-family embeddings for changes that are mechanically similar.
LOL-0110
Compute meta distance between patches using champion pick/ban, role, item and objective distributions.
LOL-0111
Use meta distance to determine historical sample weights rather than a single fixed half-life.
LOL-0112
Create emergency reset rules for major system changes, reworks and map/objective changes.
LOL-0113
Build champion cold-start priors after major buffs/nerfs/reworks.
LOL-0114
Separate patch adaptation speed from underlying team quality.
LOL-0115
Estimate team Meta Adaptation Rating from early-patch performance relative to expectation.
LOL-0116
Model coach/team champion experimentation rate and draft entropy.
LOL-0117
Flag teams whose historical strength relies heavily on champions no longer meta.
LOL-0118
Create “meta debt” metric: share of prior value tied to de-prioritized champion archetypes.
LOL-0119
Create “meta optionality” metric: depth of viable champion/role combinations under current patch.
LOL-0120
Backtests must split by chronological patch boundaries; random split is prohibited.
LOL-0121
Calibration is monitored separately for first week, established patch and international patch convergence.
LOL-0122
UI must show which portion of a forecast comes from same-patch evidence versus transferred priors.
06 / TEAM & REGION SKILL
A 10–2 record means nothing without the pool it came from
GP should produce a global, role-aware, roster-aware rating system that bridges isolated regional pools and expresses uncertainty rather than forcing false precision.
Region strength engine
ID
Requirement / capability
LOL-0123
Hierarchical region ratings learned from cross-region events and partial pooling.
LOL-0124
Region ratings have uncertainty that expands when international bridge data is old.
LOL-0125
Domestic team ratings borrow from region prior but update from opponent-adjusted results.
LOL-0126
International matches update both team and region layers without double counting.
LOL-0127
Competition tier affects information weight, not simply result value.
LOL-0128
Cross-region transfer priors for players moving regions.
LOL-0129
League schedule strength and opponent quality tracked point-in-time.
LOL-0130
Region meta-style vectors: pace, kill intensity, objective timing, draft diversity and game length.
LOL-0131
Prevent overreaction to small international samples with Bayesian shrinkage.
LOL-0132
Publish GP Global Rating and regional percentile separately.
Team power decomposition
ID
Requirement / capability
LOL-0133
Overall pre-draft game strength posterior.
LOL-0134
Blue-side and red-side strength separately.
LOL-0135
Early-game strength and variance.
LOL-0136
Mid-game conversion strength.
LOL-0137
Late-game / scaling execution strength.
LOL-0138
Draft value generated relative to neutral expectation.
LOL-0139
Objective setup/control strength.
LOL-0140
Baron conversion and anti-Baron defense.
LOL-0141
Dragon stacking and soul conversion.
LOL-0142
Gold lead conversion by lead magnitude/time.
LOL-0143
Comeback probability by deficit magnitude/time.
LOL-0144
Kill dependency: how much win probability relies on skirmish outcomes versus macro.
LOL-0145
Resource concentration by role/player.
LOL-0146
Execution volatility / upset susceptibility.
LOL-0147
Roster stability and coach stability modifiers.
LOL-0148
Series adaptation rating.
LOL-0149
Opponent-style interaction terms rather than additive power only.
LOL-0150
Current-form signal separated from sustainable latent strength.
LOL-0151
Posterior interval published with every rating.
LOL-0152
Rating snapshots stored daily so historical rankings are reproducible.
07 / PLAYER INTELLIGENCE
Players are conditional systems, not box-score rows
A top public LoL product should explain what a player does, what resources they receive, how efficiently they convert those resources, which champions unlock their value and how their impact changes against this opponent.
Role-adjusted player rating
ID
Requirement / capability
LOL-0153
Independent latent performance models for Top, Jungle, Mid, Bot and Support.
LOL-0154
Opponent-adjusted laning performance by role.
LOL-0155
Resource share normalized within team and patch.
LOL-0156
Damage efficiency per gold rather than raw damage only.
LOL-0157
Kill participation contextualized by team kill environment.
LOL-0158
Vision impact contextualized by role and game state where data permits.
LOL-0159
Objective participation and smite/contest context for junglers where available.
LOL-0160
Roam timing and lane departure impact where granular data permits.
LOL-0161
Death quality classification: isolated, traded, objective setup, sacrifice, late cleanup — only when source supports it.
LOL-0162
Clutch / high-leverage contribution using win-probability-added when granular state data exists.
LOL-0163
Consistency posterior: floor, median, ceiling and variance.
LOL-0164
Role-swap capability and multi-role uncertainty.
LOL-0165
Player form with Bayesian regression toward role baseline.
LOL-0166
International adjustment for player samples from isolated regions.
LOL-0167
Age/experience only when licensed and validated as useful; never decorative causal storytelling.
LOL-0168
Player impact split into laning, economy, combat, macro proxy and champion flexibility components.
LOL-0169
Estimate replacement value for roster changes.
LOL-0170
Pair synergy features for jungle-mid, jungle-support, bot-support and top-jungle.
LOL-0171
Player rating history with structural breaks after roster/role changes.
LOL-0172
Uncertainty rises explicitly for small champion samples and new rosters.
Player page must answer
ID
Requirement / capability
LOL-0173
What is this player’s current sustainable level?
LOL-0174
What does the team ask this player to do?
LOL-0175
How much gold/XP/draft capital do they receive?
LOL-0176
How efficiently do they convert those resources?
LOL-0177
Which champions are genuine mastery picks versus inflated small samples?
LOL-0178
Which matchup archetypes improve or reduce their expected impact?
LOL-0179
How does performance change on blue/red side?
LOL-0180
How does performance change in wins versus losses without confusing cause and effect?
LOL-0181
What changed after roster/coach/patch transitions?
LOL-0182
Which current market props are most sensitive to this player’s projected role/opportunity?
08 / CHAMPION INTELLIGENCE GRAPH
The champion pool is a graph of power, mastery, role, synergy and counterfactuals
Global win rate is too crude. GP needs patch-specific champion posteriors, role-specific strength, player mastery and team-level draft fit, with uncertainty and selection-bias controls.
Champion strength
ID
Requirement / capability
LOL-0183
Patch × role champion strength posterior with shrinkage.
LOL-0184
Region-specific deviations with hierarchical pooling.
LOL-0185
Blue/red side conditional champion strength where sample supports it.
LOL-0186
Pick-order selection bias considered; late counterpicks are not comparable to blind first picks.
LOL-0187
Ban rate and pick priority modeled as information, not proof of strength.
LOL-0188
Champion strength separated from player/team selection quality.
LOL-0189
Performance normalized for opponent strength.
LOL-0190
Cold-start priors for new/reworked champions from archetype similarity and early evidence.
LOL-0191
Patch change shock prior that expands uncertainty after meaningful balance changes.
LOL-0192
Role-flex probability per patch.
LOL-0193
Champion scaling curve by game time using historical state outcomes.
LOL-0194
Champion execution-complexity proxy and team proficiency interaction.
LOL-0195
Champion objective profile: early dragon, herald, baron, siege, side-lane contribution where inferable.
LOL-0196
Champion damage profile and frontline/engage attributes stored as versioned taxonomy.
LOL-0197
Every handcrafted taxonomy field separated from measured performance features.
Mastery and champion pool
ID
Requirement / capability
LOL-0198
Player × champion games weighted by recency, patch similarity and opponent strength.
LOL-0199
Mastery prior combines volume, sustainable performance and role familiarity.
LOL-0200
Team champion comfort aggregates player-specific assignments, not team pick count alone.
LOL-0201
Champion pool depth score by role with effective sample size.
LOL-0202
Blind-pick comfort separate from counterpick comfort.
LOL-0203
Flex value quantifies how long a pick can hide role assignment.
LOL-0204
Flex entropy represents opponent uncertainty after each pick.
LOL-0205
Pocket-pick detector identifies low-frequency, high-proficiency picks without overrating tiny samples.
LOL-0206
Champion substitution graph finds nearest archetype alternatives when a comfort pick is banned.
LOL-0207
Draft fragility measures how much team value collapses after removing top comfort options.
09 / DRAFT ENGINE
Draft is the signature object of GP LoL
This is where LoL must visually and analytically surpass CS2’s veto board. The Draft Room should be a model, an explainer and an interactive counterfactual laboratory — not a row of champion icons.
Sequential draft probability model
ID
Requirement / capability
LOL-0208
Learn P(ban/pick | patch, side, team, opponent, prior actions, role needs, champion availability).
LOL-0209
Model first-phase and second-phase draft separately.
LOL-0210
Coach/team historical tendencies enter as priors, not deterministic scripts.
LOL-0211
Champion priority conditioned on role-flex uncertainty.
LOL-0212
Predict role assignment distribution after each draft action.
LOL-0213
Update game win probability after every pick/ban.
LOL-0214
Calculate Draft WPA: probability swing attributable to each action relative to available alternatives.
LOL-0215
Compute veto/pick surprise versus GP draft model.
LOL-0216
Flag draft actions that sacrifice expected game win probability for comfort/strategy — descriptive, not normative unless validated.
LOL-0217
Compute counterfactual best-response sets under realistic team champion pools.
LOL-0218
Estimate draft leverage: how much value is still available to the next picker.
LOL-0219
Estimate draft entropy: uncertainty over final composition.
LOL-0220
Estimate trap risk: apparent counterpick that historically underperforms for this player/team.
LOL-0221
Estimate flex leverage: value of delaying role revelation.
LOL-0222
Produce final draft-conditioned win probability with interval.
LOL-0223
Produce pre-draft → post-draft probability bridge so user sees what changed.
LOL-0224
Build draft model separately for BO1 and series contexts where adaptation differs.
LOL-0225
Include side-choice and pick-order rules by competition.
LOL-0226
Never train on end-game stats for pre-game or draft-time predictions.
LOL-0227
Draft timestamps saved for historical market-reaction research.
Composition geometry
ID
Requirement / capability
LOL-0228
Engage availability and initiation reliability.
LOL-0229
Disengage / peel capacity.
LOL-0230
Frontline durability.
LOL-0231
Backline access.
LOL-0232
Range / poke pressure.
LOL-0233
Waveclear and stall capacity.
LOL-0234
Side-lane / split-push pressure.
LOL-0235
Pick potential and fog-of-war threat.
LOL-0236
Objective DPS and secure profile.
LOL-0237
Teamfight front-to-back suitability.
LOL-0238
Damage mix and resistance pressure.
LOL-0239
Crowd-control chain density.
LOL-0240
Mobility and chase profile.
LOL-0241
Early skirmish power.
LOL-0242
One-item, two-item and three-item power windows.
LOL-0243
Late-game scaling and execution burden.
LOL-0244
Resource competition between carries.
LOL-0245
Lane priority expectations.
LOL-0246
Jungle setup compatibility.
LOL-0247
Composition volatility: how punishing a small early deficit becomes.
10 / LANE & JUNGLE ENGINES
Predict the mechanism that creates the scoreboard
The strongest forecasting architecture should not jump directly from team rating to match winner. It should model how draft and player strength translate into lane pressure, jungle access, objectives, gold and eventually win probability.
Lane matchup engine
ID
Requirement / capability
LOL-0248
Top, Mid and Bot lane modeled separately; support influence is explicit in bot lane.
LOL-0249
Expected CS differential at 10/15 conditional on champion matchup and player skill.
LOL-0250
Expected XP differential at 10/15.
LOL-0251
Expected gold differential at 10/15.
LOL-0252
Probability of lane priority by time window.
LOL-0253
Probability of solo kill / lane death where data supports reliable estimation.
LOL-0254
Turret plate / first tower pressure where current rules and data support it.
LOL-0255
Waveclear and roam windows modeled as composition context.
LOL-0256
Blind-pick penalty and counterpick value estimated from matched historical contexts.
LOL-0257
Lane outcome posterior shrinks heavily for sparse champion matchups.
LOL-0258
Role/player mastery and champion base strength separated.
LOL-0259
Jungle intervention risk conditions lane projections.
LOL-0260
Lane swap / unusual assignment detection prevents invalid standard-lane assumptions.
LOL-0261
Output is a distribution, not “Team A wins lane.”
Jungle / map pressure engine
ID
Requirement / capability
LOL-0262
Jungle player latent skill and champion mastery.
LOL-0263
Expected early path archetype when data supports it.
LOL-0264
Farm versus gank tendency by patch/team.
LOL-0265
Lane priority inputs determine invade/objective feasibility.
LOL-0266
First objective influence derived from lane/jungle state, not isolated historical percentage.
LOL-0267
Jungle-mid synergy and jungle-support synergy.
LOL-0268
Early river control proxy where granular data allows.
LOL-0269
Expected first recall / item timing classes when data allows.
LOL-0270
Counter-jungle pressure and resource denial where data allows.
LOL-0271
Smite/objective secure is modeled only with reliable event data and adequate sample.
LOL-0272
Path uncertainty remains explicit; the model should not fabricate exact pathing without telemetry.
11 / OBJECTIVE, TEMPO & MACRO
LoL is a race through state transitions
Dragon, towers, Baron and gold are not independent props. They are connected state variables. GP should model their joint distribution and the pathways through which a composition wins.
Objective hazard models
ID
Requirement / capability
LOL-0273
First Blood hazard by team and game time.
LOL-0274
First Dragon hazard conditional on draft, lane priority and team tendencies.
LOL-0275
First Herald / current equivalent objective hazard conditional on patch rules.
LOL-0276
First Tower hazard.
LOL-0277
Dragon count distribution by team.
LOL-0278
Soul probability and soul timing distribution.
LOL-0279
Baron first-take hazard and total Baron count.
LOL-0280
Elder occurrence probability.
LOL-0281
Tower count distribution.
LOL-0282
Objective trades modeled jointly; securing one objective changes probability of another.
LOL-0283
Objective timing distributions update game-duration and kill expectations.
LOL-0284
No objective market is priced independently in simulation.
Tempo and conversion
ID
Requirement / capability
LOL-0285
Gold lead at 10/15/20 distributions.
LOL-0286
XP lead distributions.
LOL-0287
Expected game time conditional on current/pre-game state.
LOL-0288
Lead conversion P(win | gold lead, time, comp, team).
LOL-0289
Comeback P(win | deficit, time, comp, team).
LOL-0290
Scaling crossover time where Team B’s composition overtakes Team A under neutral state.
LOL-0291
Tempo advantage state as a latent variable connecting objectives and map pressure.
LOL-0292
Snowball elasticity: how much a 1k early lead changes expected final margin/kill environment.
LOL-0293
Stall capacity: probability game survives beyond key scaling thresholds.
LOL-0294
Baron conversion into towers/inhibitors/win where data supports it.
LOL-0295
Game closure efficiency separated from ability to gain a lead.
LOL-0296
Macro volatility: distribution width of outcome conditional on similar early states.
12 / WIN-PROBABILITY STATE MODEL
Build a state model useful for research now and live later
Riot has publicly described a professional LoL win-probability model using game time, gold share, XP, players alive, towers, dragons, buffs and inhibitor timers. GP should build its own independently validated state model when lawful granular data is available, then use it for player/action impact, game-state research and eventually live intelligence.
State variables
ID
Requirement / capability
LOL-0297
Game time.
LOL-0298
Team/player gold distribution, not only gold difference.
LOL-0299
Team XP and level distribution.
LOL-0300
Players alive and death timers.
LOL-0301
Towers and inhibitor state.
LOL-0302
Dragon stack, soul state and dragon types when available.
LOL-0303
Baron/Elder possession and remaining buff duration.
LOL-0304
Objective spawn timers.
LOL-0305
Composition scaling state and item completion state where lawful data exists.
LOL-0306
Current side-lane / map-control features where telemetry permits.
LOL-0307
Model state uncertainty when data feed is incomplete or delayed.
State model outputs
ID
Requirement / capability
LOL-0308
Win probability.
LOL-0309
Win-probability added by event.
LOL-0310
Expected remaining game duration.
LOL-0311
Expected remaining kills.
LOL-0312
Expected next objective probabilities.
LOL-0313
Comeback probability.
LOL-0314
Game closure probability within N minutes.
LOL-0315
Player impact attribution with causal humility — WPA is contextual contribution, not pure skill.
LOL-0316
Counterfactual state comparisons for analysis.
LOL-0317
Post-game “turning point” sequence generated from largest validated WPA swings.
13 / SERIES ENGINE
BO3 and BO5 are adaptive systems
Games in a series are not IID coin flips. Side choices change, drafts reveal information, coaches adapt, champion priorities shift and mental/strategic state can alter subsequent games. GP must model the series as a sequence of conditional games.
Series dependency
ID
Requirement / capability
LOL-0318
Game-level win probabilities conditioned on expected side and draft state.
LOL-0319
Side-selection rules by competition and game number.
LOL-0320
Champion reveal information from prior games.
LOL-0321
Pick/ban adaptation probability after losses/wins.
LOL-0322
Team-specific adaptation rating from historical series.
LOL-0323
Rematch champion priors after successful/failed picks.
LOL-0324
Between-game roster/substitution possibility where rules permit.
LOL-0325
Game duration/fatigue effects researched, not assumed.
LOL-0326
Latent same-day performance state creates correlation across games.
LOL-0327
Series score distribution derived from conditional game simulation.
LOL-0328
Total maps and handicap markets derived from same joint simulator.
LOL-0329
Correct-score probabilities maintain coherence with ML and total maps.
LOL-0330
Pre-series and post-Game-1 reforecast contracts are separate products.
LOL-0331
No arbitrary “momentum +X%” constant unless learned and validated.
14 / PLAYER OPPORTUNITY & PROP ENGINE
Player props require opportunity first, performance second
The model must determine how many kills/assists/CS opportunities a player is likely to receive under a given draft and game script before forecasting the stat itself.
Opportunity model
ID
Requirement / capability
LOL-0332
Expected team kill environment distribution.
LOL-0333
Expected player kill participation by champion/role/team.
LOL-0334
Expected kill share conditional on champion role and team resource allocation.
LOL-0335
Expected assist share.
LOL-0336
Expected death exposure conditional on role/champion and game script.
LOL-0337
Expected CS/min and game-duration distribution.
LOL-0338
Expected gold share / resource share.
LOL-0339
Expected game count in series for series-total props.
LOL-0340
Expected player participation probability including substitution risk.
LOL-0341
Post-draft opportunity update when champion assignment is known.
LOL-0342
Correlation between teammates’ opportunities modeled explicitly.
Prop distributions
ID
Requirement / capability
LOL-0343
Player kills per game and series.
LOL-0344
Player assists per game and series.
LOL-0345
Player deaths where offered.
LOL-0346
Kill participation markets where offered.
LOL-0347
CS / creep score where offered.
LOL-0348
Combined K+A / KDA-style markets only when settlement definitions are normalized.
LOL-0349
First blood participation where offered and data is reliable.
LOL-0350
Role-specific event props only after sufficient market/sample validation.
LOL-0351
Every prop distribution is jointly simulated with team kills and duration.
LOL-0352
No Poisson assumption accepted without dispersion diagnostics; use negative-binomial/mixture/hierarchical alternatives as needed.
LOL-0353
Player lines are conditioned on confirmed draft when market timing allows.
LOL-0354
Output full CDF so any book line can be priced without refitting.
15 / GAME & SERIES MARKET SURFACE
Price the entire board coherently
GP should produce one joint latent game distribution and derive dozens of markets from it. Independent models that disagree with each other create fake edges and impossible combinations.
Primary market families to model
ID
Requirement / capability
LOL-0355
Match / series winner for intelligence and benchmark, even if not initially pick-eligible.
LOL-0356
Game 1 / Game N winner.
LOL-0357
Map/game handicap and series handicap.
LOL-0358
Total maps / total games in series.
LOL-0359
Correct series score.
LOL-0360
Total kills per game.
LOL-0361
Team kills per game.
LOL-0362
Kill handicap.
LOL-0363
Game duration totals.
LOL-0364
First blood.
LOL-0365
First tower.
LOL-0366
First dragon.
LOL-0367
First Baron.
LOL-0368
Total dragons.
LOL-0369
Total towers.
LOL-0370
Total Barons.
LOL-0371
Race-to-kills markets where available.
LOL-0372
Player kills / assists / CS markets.
LOL-0373
Other niche families enter research registry before public eligibility.
Cross-market coherence
ID
Requirement / capability
LOL-0374
Correct score sums must reconcile to series winner.
LOL-0375
Total maps distribution must reconcile to correct score.
LOL-0376
Game winner probabilities aggregate consistently to series distribution.
LOL-0377
Team kill distributions sum coherently to total kills distribution.
LOL-0378
Player kill expectations reconcile to team kill environment after accounting for shared kills/assists appropriately.
LOL-0379
Duration and kill intensity share latent pace/game-script variables.
LOL-0380
First-objective probabilities share lane/jungle early-state variables.
LOL-0381
Objective counts and duration share game-state simulation.
LOL-0382
Cross-market arbitrage diagnostics identify internal model inconsistency before external edge is considered.
LOL-0383
If a market is used as an anchor/input, its family is tagged non-independent for value evaluation.
16 / MARKET INTELLIGENCE
The market is both benchmark and sensor — never an oracle and never an opponent to ignore
A professional operation needs multiple books, timestamps, no-vig methods, stale-price detection, closing capture and execution realism. One displayed price is not market intelligence.
Multi-book market tape
ID
Requirement / capability
LOL-0384
Canonical mapping for book, event, market, side, line and settlement rules.
LOL-0385
Snapshot every price change or poll at sufficiently high cadence pre-match/draft.
LOL-0386
Capture opening, first liquid, current, pre-draft, post-draft and closing states where possible.
LOL-0387
Store suspended/reopened states around draft/news.
LOL-0388
Sharp/recreational book classification maintained as a versioned research label, not hardcoded truth.
LOL-0389
Consensus no-vig probability using multiple methods and robustness checks.
LOL-0390
Bookmaker-specific margin tracking.
LOL-0391
Best price and median price displayed separately.
LOL-0392
Price freshness in seconds/minutes; stale prices cannot generate public picks.
LOL-0393
Market depth proxy from number of books and line agreement.
LOL-0394
Cross-book dispersion as uncertainty/liquidity signal.
LOL-0395
Line-move attribution to known events when timestamp evidence exists.
LOL-0396
Closing line captured independently of result settlement.
LOL-0397
Execution log stores actual price user/GP could have taken, not hindsight best price.
LOL-0398
Max playable price computed for every pick.
LOL-0399
Price alerts trigger when market crosses entry or invalidation threshold.
No-vig and consensus research
ID
Requirement / capability
LOL-0400
Compare proportional normalization, additive normalization, power method and Shin-style adjustments where appropriate.
LOL-0401
Choose no-vig method per market structure via backtest/calibration, not aesthetics.
LOL-0402
Correct-score multiway markets remove vig over all outcomes jointly.
LOL-0403
Line markets with different thresholds are converted to a monotonic probability curve.
LOL-0404
Fit market-implied distributions from multiple lines where available.
LOL-0405
Estimate synthetic fair mean/variance from book ladder as a benchmark.
LOL-0406
Use robust consensus to reduce influence of obviously stale books.
LOL-0407
Never compare GP to raw 1/odds and call the difference edge when vig is material.
17 / MARKET ORTHOGONALITY
Never beat a price with information copied from the same price
The most dangerous false edge in a market-aware model is circularity. GP must maintain separate fundamental and market-informed forecasts and know exactly which market families were allowed to influence each one.
Orthogonality controls
ID
Requirement / capability
LOL-0408
Maintain Fundamental GP forecast with zero betting-market inputs.
LOL-0409
Maintain Market-Informed GP forecast as a separate output when blending improves calibration.
LOL-0410
Every model artifact stores allowed market feature families.
LOL-0411
Leave-one-family-out forecasts generated when evaluating that family for edge.
LOL-0412
If Series ML anchors the forecast, Series ML cannot be evaluated as independent value.
LOL-0413
If Game 1 ML informs a series latent strength estimate, Game 1 ML is marked contaminated for that timestamp.
LOL-0414
Derived market inputs are traced through feature lineage, not just model configuration.
LOL-0415
UI labels “fundamental,” “market-informed,” and “benchmark market” explicitly.
LOL-0416
Edge engine uses the orthogonal forecast by default.
LOL-0417
Research compares whether market blending improves calibration without destroying discoverable independent edge.
18 / PICK ENGINE
A candidate is not a pick
GP’s picks should look like investment decisions with rejection gates. The system must be proud to publish nothing when evidence, price or data quality does not justify a position.
Pick gates
ID
Requirement / capability
LOL-0418
Rights Gate: all feature lineage betting-commercial-ok.
LOL-0419
Data Gate: required fields complete and within freshness SLA.
LOL-0420
Roster Gate: active lineup/role state confirmed or uncertainty within family tolerance.
LOL-0421
Draft Gate: pre-draft/post-draft state matches model used.
LOL-0422
Market Gate: executable price exists and market mapping is verified.
LOL-0423
Orthogonality Gate: evaluated market did not contaminate forecast.
LOL-0424
Calibration Gate: model/family/regime currently within calibration tolerance.
LOL-0425
Edge Gate: expected edge exceeds family-specific threshold.
LOL-0426
Posterior Gate: P(edge > 0) exceeds family-specific threshold.
LOL-0427
Noise Gate: edge is large relative to epistemic/model uncertainty.
LOL-0428
Robustness Gate: reasonable model perturbations do not erase value.
LOL-0429
Price Gate: current price is at or better than max playable price.
LOL-0430
Liquidity/Depth Gate: minimum book depth / confidence requirement.
LOL-0431
Integrity Gate: event/data anomaly risk below threshold.
LOL-0432
Correlation Gate: incremental exposure fits portfolio limits.
LOL-0433
Timing Gate: opportunity has enough time for user execution and is not stale.
LOL-0434
Execution Gate: settlement definition/book market is understood.
LOL-0435
Governance Gate: family status is Active, not Research/Probation/Degraded/Killed.
Pick card 3.0 fields
ID
Requirement / capability
LOL-0436
Market and exact settlement definition.
LOL-0437
Best current price + book + timestamp.
LOL-0438
GP fair price and fair probability.
LOL-0439
Max playable price.
LOL-0440
Market no-vig consensus.
LOL-0441
Edge in probability points and expected value.
LOL-0442
Edge posterior with P(edge > 0).
LOL-0443
Confidence decomposed into data, model, market and regime components.
LOL-0444
Primary thesis: 1–3 mechanisms, not generic prose.
LOL-0445
Counter-thesis: what must happen for GP to be wrong.
LOL-0446
Draft/roster dependence badge.
LOL-0447
Price sensitivity strip.
LOL-0448
Correlation/exposure note.
LOL-0449
Suggested fractional-Kelly stake with cap.
LOL-0450
Family historical CLV and sample shown contextually, not as marketing headline.
LOL-0451
Prediction/model version and audit link.
19 / EDGE DISCOVERY RESEARCH LAB
Make the system discover its own strongest families
The right question is not “does GP beat LoL?” It is “under which market family × tier × patch maturity × timing × price range × draft state × book class × data quality does GP consistently beat close?”
Edge family dimensions
ID
Requirement / capability
LOL-0452
Market family.
LOL-0453
League / competition tier.
LOL-0454
Region.
LOL-0455
Patch age / maturity.
LOL-0456
Pre-draft versus post-draft.
LOL-0457
Time-to-start bucket.
LOL-0458
Book class.
LOL-0459
Price range.
LOL-0460
Favorite/underdog state.
LOL-0461
Series format.
LOL-0462
Roster continuity bucket.
LOL-0463
Data-completeness tier.
LOL-0464
Model confidence bucket.
LOL-0465
Draft leverage bucket.
LOL-0466
Composition scaling/volatility archetype.
LOL-0467
Game pace archetype.
LOL-0468
Line movement regime.
LOL-0469
Market depth/dispersion bucket.
Research governance
ID
Requirement / capability
LOL-0470
Every hypothesis registered before evaluation with rationale and target metric.
LOL-0471
Exploratory segments cannot be promoted directly to Active.
LOL-0472
Multiple-testing correction / false-discovery-rate control across family mining.
LOL-0473
Partial pooling prevents tiny segments from looking artificially elite.
LOL-0474
Untouched forward confirmation required after discovery.
LOL-0475
Primary discovery signal is CLV, then calibration/scoring, then realized ROI.
LOL-0476
ROI without CLV is treated as weak evidence unless mechanism strongly justifies it.
LOL-0477
Positive CLV with negative short-run ROI remains under review rather than killed automatically.
LOL-0478
Family state machine: Hypothesis → Research → Shadow → Probation → Active → Degraded → Killed.
LOL-0479
Promotion thresholds versioned and public internally.
LOL-0480
Kill criteria include negative CLV, drift, broken data rights, price unavailability and execution decay.
LOL-0481
Research notebook links directly to production family ID.
LOL-0482
Every family has a “why it should exist” mechanism, not only a backtest curve.
LOL-0483
Every family has a capacity/execution note.
20 / VALIDATION & MLOPS
The backtest must be harder to beat than the market
LoL’s non-stationarity creates a high risk of leakage and regime overfitting. Validation must reproduce the information set, patch state, roster state, draft state and market state available at prediction time.
Point-in-time validation
ID
Requirement / capability
LOL-0484
Event time and knowledge time stored separately.
LOL-0485
Feature store rejects values whose available_at exceeds prediction timestamp.
LOL-0486
Roster/news corrections cannot leak backwards into historical snapshots.
LOL-0487
Draft features become available only after corresponding pick/ban timestamp.
LOL-0488
Closing prices never enter model features for earlier prediction timestamps.
LOL-0489
Patch metadata uses effective competitive date, not publication hindsight.
LOL-0490
Walk-forward splits advance chronologically through patches/seasons.
LOL-0491
Nested tuning occurs only inside training history.
LOL-0492
Untouched confirmation period is locked before model selection.
LOL-0493
Random train/test split is diagnostic only, never final evidence.
LOL-0494
Backtest includes source outages/missingness patterns where feasible.
LOL-0495
All production predictions written immutably before result.
Metrics by output type
ID
Requirement / capability
LOL-0496
Binary outcomes: log loss, Brier score, calibration slope/intercept, ECE and reliability curves.
LOL-0497
Continuous/count distributions: CRPS, pinball loss, likelihood/deviance and coverage intervals.
LOL-0498
Market comparison: closing-line log loss/Brier where directly comparable.
LOL-0499
Betting: CLV, expected value at signal, realized price, ROI, yield and drawdown.
LOL-0500
Calibration segmented by patch age, region, side, favorite range and confidence.
LOL-0501
Prediction intervals assessed for empirical coverage.
LOL-0502
Model sharpness measured only alongside calibration.
LOL-0503
Bootstrap/block-bootstrap confidence intervals respect temporal/series clustering.
LOL-0504
Family metrics require effective sample size, not raw row count only.
LOL-0505
Performance dashboards show both current and trailing regimes.
Champion / challenger MLOps
ID
Requirement / capability
LOL-0506
Every production model has versioned training data hash and feature schema.
LOL-0507
Champion model cannot be silently modified.
LOL-0508
Challenger runs in shadow on identical point-in-time inputs.
LOL-0509
Promotion requires predefined scoring improvement and no material calibration regression.
LOL-0510
Ablation tests quantify value of draft, player, region, patch and market components.
LOL-0511
Drift monitors input distributions and residuals.
LOL-0512
Automatic kill switch if model outputs become degenerate or source quality collapses.
LOL-0513
Reproducibility test reruns random historical predictions and compares exact output tolerance.
LOL-0514
Inference latency monitored for pre-draft and draft-time update SLAs.
LOL-0515
Research artifacts remain queryable after retirement.
21 / PORTFOLIO & EXECUTION
A sharp operation manages a book of correlated theses
LoL picks share game script, team, player and series risk. GP should never recommend stakes as if every positive-EV line were independent.
Portfolio engine
ID
Requirement / capability
LOL-0516
Fractional Kelly based on posterior edge rather than point estimate.
LOL-0517
Family-specific Kelly caps based on validation maturity.
LOL-0518
Per-match exposure cap.
LOL-0519
Per-series exposure cap.
LOL-0520
Per-team/day exposure cap.
LOL-0521
Per-player exposure cap for correlated props.
LOL-0522
Per-game-script exposure attribution: fast game, stomp, Team A lead, Team B scaling, etc.
LOL-0523
Correlation matrix estimated from joint simulations for markets in same event.
LOL-0524
Cross-event correlation monitored for same team/roster/patch thesis.
LOL-0525
Drawdown throttle reduces stake after evidence, not emotion.
LOL-0526
Liquidity/capacity model limits recommended stake when obtainable price is thin.
LOL-0527
Price slippage converts theoretical EV to executable EV.
LOL-0528
Portfolio optimizer can prefer one cleaner market over three redundant correlated markets.
LOL-0529
User bankroll mode and GP model performance kept conceptually separate.
LOL-0530
No martingale, loss chasing or stake escalation from recent outcomes.
22 / VISUAL INTELLIGENCE SYSTEM
Make LoL feel designed, not assembled
The product should look as if a world-class strategy/product studio and an esports quant team spent six months together. The key is not decorative complexity. It is a clear spatial metaphor for every kind of LoL intelligence and a disciplined system of information depth.
Visual laws
ID
Requirement / capability
LOL-0531
One dominant canvas per screen; supporting evidence docks around it.
LOL-0532
Use asymmetric editorial layouts instead of symmetric grids of equal cards.
LOL-0533
Create three surface types only: Canvas, Dock and Lens/Drawer; avoid endless nested cards.
LOL-0534
GP green means proprietary intelligence or actionable state — never generic decoration.
LOL-0535
Gold means resource/objective/value; red means risk/opponent pressure; blue/teal distinguish sides/spatial control.
LOL-0536
Neutral observed data uses low-saturation grayscale so GP inference stands out.
LOL-0537
No glassmorphism, neon cyberpunk, glowing borders everywhere or random gradients.
LOL-0538
No icon soup; each icon is a stable domain symbol.
LOL-0539
No decorative champion art unless rights cleared; silhouette/initial/token system must look intentional.
LOL-0540
No radar chart as default “DNA” visualization; use aligned bands/trajectories that can be compared precisely.
LOL-0541
No table as hero. Tables live in analyst lenses or detail modes.
LOL-0542
Numbers use tabular figures; probabilities and prices align visually.
LOL-0543
Whitespace is active structure even in a dense terminal.
LOL-0544
Animation only explains state transitions: draft pick, price move, probability swing, objective timing.
LOL-0545
Data provenance can open from any number without leaving page.
LOL-0546
Color never carries meaning alone; labels/patterns handle accessibility.
LOL-0547
UI must feel native to GP and not imitate Riot’s client/broadcast styling.
LOL-0548
Every screen has a “30-second answer” and a “30-minute investigation” path.
Information depth modes
ID
Requirement / capability
LOL-0549
Fan Mode: outcome, draft story, five things that matter, player stars, simple simulation.
LOL-0550
Bettor Mode: fair prices, market tape, edge posterior, max playable price, picks and invalidation rules.
LOL-0551
Analyst Mode: full distributions, feature attribution, data quality, counterfactuals, model/version provenance.
LOL-0552
Modes change density and controls, not underlying truth.
LOL-0553
Persistent global search handles team, player, champion, series, tournament and market queries.
LOL-0554
Keyboard command palette for power users.
LOL-0555
Desktop designed as terminal; mobile designed as concise intelligence briefing, not scaled-down desktop.
23 / SCREEN SYSTEM
Every screen has a signature composition
Below is the screen-by-screen product specification. Each page is built around a single visual question rather than a generic sequence of modules.
A. Sunday-style LoL Command Center / Opportunities
ID
Requirement / capability
LOL-0556
Time axis is the primary organizing spine: live, imminent, later today and tomorrow.
LOL-0557
Matches appear as compact thesis rows, not tall pick cards by default.
LOL-0558
Each row shows GP probability, market consensus, data state, draft state and number of validated opportunities.
LOL-0559
Opportunity families expand horizontally from the match rather than repeating separate cards.
LOL-0560
“Why now?” indicator shows whether opportunity came from price move, roster confirmation, draft or model refresh.
LOL-0561
One “Focus Match” expands into a large editorial panel with the strongest intelligence story of the slate.
LOL-0562
Opportunity filter supports Active picks, Watch price, Post-draft only, High data quality and Research-only.
LOL-0563
Book/price freshness visible without opening match.
LOL-0564
Edge is encoded by posterior confidence and price gap, not green border thickness alone.
LOL-0565
No pick matches remain useful via analysis; opportunity page does not become empty when no bets qualify.
LOL-0566
Quick-action: open Pick Memo, monitor price, add to portfolio, open Draft Room.
LOL-0567
Global slate summary shows market breadth, active families and model health, not vanity win rate.
LOL-0568
Alerts dock shows roster, draft, price and patch changes relevant to currently watched matches.
B. Match Intelligence Terminal
ID
Requirement / capability
LOL-0569
Hero is a three-zone thesis: Team A state, central Rift Thesis, Team B state.
LOL-0570
Central Rift Thesis displays lane/jungle/objective advantages spatially on an abstract GP map.
LOL-0571
Probability rail across top shows Fundamental GP, Market-Informed GP and Market consensus without conflating them.
LOL-0572
Uncertainty band wraps the probability rail rather than appearing as a separate card.
LOL-0573
“What changed?” ribbon lists the latest causal inputs: roster, draft, price, side, patch signal.
LOL-0574
Five Things That Matter sits inside the canvas as numbered annotations attached to relevant spatial regions.
LOL-0575
Draft status is persistent: pre-draft, in-draft step N, confirmed.
LOL-0576
Tempo River spans viewport width: predicted power/lead windows across game time.
LOL-0577
Objective timing markers sit on Tempo River, not in a separate generic chart.
LOL-0578
Game Script Selector toggles neutral, Team A early lead, Team B early lead and high-kill states and reflows distributions.
LOL-0579
Market Tape docks to lower edge and can be expanded without scrolling away from thesis.
LOL-0580
Pick Memo opens as side lens rather than navigating away.
LOL-0581
Analyst lens reveals feature attribution, source freshness and model versions.
LOL-0582
After match, same page transforms into Prediction Replay showing where forecast moved and why.
C. Draft Room
ID
Requirement / capability
LOL-0583
Entire pick/ban sequence is visible on one horizontal decision rail.
LOL-0584
Current action is visually dominant; past actions compress; future slots remain quiet.
LOL-0585
Central Composition Geometry compares teams along domain capabilities, not a radar chart.
LOL-0586
Role-assignment uncertainty shown as branching connectors from flex picks.
LOL-0587
Each pick/ban displays GP action probability and Draft WPA on hover/click.
LOL-0588
Counterfactual lens shows top realistic alternatives from that team’s actual champion pool.
LOL-0589
Flex entropy meter shows how much information a pick reveals.
LOL-0590
Draft leverage meter shows remaining expected value for next action.
LOL-0591
Power Window strip estimates composition strength by game-time bands.
LOL-0592
Lane Theater updates immediately when roles resolve.
LOL-0593
Market tape overlays draft timestamps so user sees whether books repriced efficiently.
LOL-0594
Post-draft Pick Gate runs automatically once composition/roles reach sufficient certainty.
LOL-0595
“Draft Thesis” is a concise human-readable model explanation tied to numeric drivers.
LOL-0596
Replay mode lets users scrub historical drafts and hide future actions for training/research.
D. Lane Theater
ID
Requirement / capability
LOL-0597
Three lane bands plus jungle corridors share one spatial canvas.
LOL-0598
Each lane shows pressure distribution, expected gold/CS/XP differential and volatility.
LOL-0599
Player/champion tokens sit on lanes with mastery and matchup state integrated.
LOL-0600
Jungle intervention arcs show probability bands, not fake exact path predictions.
LOL-0601
Objective windows appear where lane priority creates river access.
LOL-0602
Counterfactual: swap champion assignment or side and recalculate lane state.
LOL-0603
Analyst lens exposes historical comparable matchups and effective sample size.
LOL-0604
Bettor lens connects lane state to first tower/dragon and early kill markets.
LOL-0605
No standalone “lane stats table” in default view.
E. Tempo River
ID
Requirement / capability
LOL-0606
Horizontal 0–45+ minute flow is the signature macro visualization.
LOL-0607
Team strength shown as two bands whose relative width changes through time.
LOL-0608
Item/power spikes appear as discrete semantic markers when lawful data supports them.
LOL-0609
Dragon/Herald/Baron windows appear on same time axis.
LOL-0610
Expected gold lead distribution shown as a subtle ribbon, not separate line chart.
LOL-0611
Scaling crossover highlighted when composition advantage changes sign.
LOL-0612
Game duration distribution is encoded at river tail.
LOL-0613
Clicking a time point opens expected game-state lens.
LOL-0614
User can compare neutral and alternate game-script rivers.
F. Objective Observatory
ID
Requirement / capability
LOL-0615
Objective sequence represented as a connected strategic path, not isolated percentage cards.
LOL-0616
First dragon, stack progression, soul, Baron and Elder are modeled as dependent events.
LOL-0617
Each objective node shows probability, expected timing and leverage on game win probability.
LOL-0618
Objective trade branches show most likely alternatives.
LOL-0619
Historical team objective tendencies are shown as faint reference, not mixed with GP forecast.
LOL-0620
Market lines for first/total objectives dock directly to relevant nodes.
LOL-0621
Click node opens model drivers and data sample.
G. Scaling Bridge
ID
Requirement / capability
LOL-0622
Composition and team execution strength displayed through time on one bridge-like trajectory.
LOL-0623
Distinguish champion theoretical scaling from team historical ability to reach/use that state.
LOL-0624
Show power-window uncertainty, not exact minute claims.
LOL-0625
Identify win conditions: accelerate before crossover, stall through crossover, objective force timing.
LOL-0626
Connect directly to duration and comeback markets.
LOL-0627
Allow counterfactual removal/change of a key champion.
H. Market Terminal
ID
Requirement / capability
LOL-0628
Financial-style tape with books as rows and time horizontal; price is the primary object.
LOL-0629
Events (roster, draft pick, side confirmation) are annotated on price timeline.
LOL-0630
GP fair price appears as a stable reference band with its own uncertainty.
LOL-0631
Max playable price visually distinct from fair price.
LOL-0632
Consensus and dispersion update in real time/poll cadence.
LOL-0633
Family tabs reorganize the same tape rather than load unrelated tables.
LOL-0634
Cross-market consistency alerts identify suspicious book lines or model inconsistency.
LOL-0635
Closing-price marker locks after market close for CLV audit.
LOL-0636
Analyst can replay tape at historical timestamp with only then-known data.
LOL-0637
Price-monitor action is one click and survives navigation.
I. Pick Memo
ID
Requirement / capability
LOL-0638
Looks like a one-page investment memo, not a sportsbook bet slip.
LOL-0639
Top line: exact position, current price, max price, fair price, time and book.
LOL-0640
Investment thesis limited to three quantified mechanisms.
LOL-0641
Counter-thesis lists the two strongest failure pathways.
LOL-0642
Edge posterior shown as probability mass around zero, not a single giant edge number.
LOL-0643
Price sensitivity shows EV at several reachable odds.
LOL-0644
Correlation panel states what other GP positions duplicate this thesis.
LOL-0645
Data confidence and model confidence shown separately.
LOL-0646
Historical family evidence shows CLV/sample/calibration, not cherry-picked ROI.
LOL-0647
Invalidation conditions: roster/draft/price/time thresholds.
LOL-0648
Stake calculator uses posterior fractional Kelly and portfolio caps.
LOL-0649
Audit link opens immutable prediction snapshot.
J. Team War Room
ID
Requirement / capability
LOL-0650
Hero is Team Identity Strip: global rating, region rating, roster continuity, meta adaptation and uncertainty.
LOL-0651
Roster graph replaces plain player chips; edge thickness represents shared games/time.
LOL-0652
Champion Pool Map shows role flexibility and priority network.
LOL-0653
Draft fingerprint shows first-pick, ban, flex and adaptation tendencies as sequences.
LOL-0654
Phase ribbon shows early / mid / late / closure performance.
LOL-0655
Objective signature integrates dragon/Baron/tower patterns.
LOL-0656
Opposition-adjusted results shown as expectation residuals, not W-L only.
LOL-0657
Patch transition timeline shows where rating/state changed structurally.
LOL-0658
Series adaptation section compares game-to-game adjustments.
LOL-0659
Current market perception vs GP rating tracked historically.
LOL-0660
Compare button launches War Room split view against any team.
K. Player Atlas
ID
Requirement / capability
LOL-0661
Portrait/token hero plus Role State, GP Impact posterior and resource role.
LOL-0662
Champion Constellation maps mastery, recency, role flexibility and current-patch strength.
LOL-0663
Resource Flow shows share of team gold/CS/XP across phases.
LOL-0664
Impact Strip separates lane, economy, combat and macro proxies.
LOL-0665
Matchup Lens compares opponent archetypes rather than raw head-to-head.
LOL-0666
Form trajectory distinguishes observed recent result from sustainable posterior.
LOL-0667
Pair Synergy shows relevant teammate relationships.
LOL-0668
Props lens converts role/opportunity forecast into current market prices.
LOL-0669
Historical game list is a supporting drawer, not the page hero.
L. Champion Observatory
ID
Requirement / capability
LOL-0670
Patch-specific champion state is the hero: role probability, priority, strength and uncertainty.
LOL-0671
Role map shows where champion is actually viable in current competitive patch.
LOL-0672
Pick-order effect distinguishes blind versus counterpick outcomes.
LOL-0673
Synergy/counter network visualizes strongest validated interactions.
LOL-0674
Player mastery leaderboard adjusts for player/team strength and sample.
LOL-0675
Patch shock timeline shows buffs/nerfs/rework state and uncertainty expansion.
LOL-0676
Draft impact shows expected value by realistic team/player context.
LOL-0677
No public global win-rate worship; every number is conditional and shrunk.
M. Patch Observatory
ID
Requirement / capability
LOL-0678
Meta landscape compares previous/current patch using champion priority shifts.
LOL-0679
Meta distance score quantifies how much old data should be trusted.
LOL-0680
Role-level changes displayed as migration flows, not tables of deltas.
LOL-0681
Team adaptation leaderboard includes uncertainty and early-patch sample warnings.
LOL-0682
Market research layer tracks whether books systematically lag specific patch shifts.
LOL-0683
Historical “patch shock” archive supports research hypotheses.
LOL-0684
Patch page links directly to affected teams, players, champions and edge families.
N. Circuit / Ecosystem
ID
Requirement / capability
LOL-0685
World map/network view of regions and leagues with current strength posterior.
LOL-0686
Cross-region bridge edges thicken with recent international evidence.
LOL-0687
League cards are secondary; map is the narrative object.
LOL-0688
Competition schedule and format overlays available by time.
LOL-0689
Region style fingerprints compare pace, kill environment, draft diversity and objective timing.
LOL-0690
Click region enters league/team hierarchy without losing global context.
LOL-0691
Public SEO pages can expose rankings/schedules while terminal retains advanced lenses.
O. Model & Research Lab
ID
Requirement / capability
LOL-0692
Champion/challenger status board.
LOL-0693
Model scorecards by market family and regime.
LOL-0694
Calibration reliability plots only where they answer a question; otherwise numeric summary plus exceptions.
LOL-0695
Feature ablation matrix.
LOL-0696
Drift alerts and data-source health.
LOL-0697
Edge Family Registry with state, sample, CLV, calibration and last review.
LOL-0698
Untouched test results locked and immutable.
LOL-0699
Prediction replay tool selects any historical timestamp.
LOL-0700
Parameter registry distinguishes learned, calibrated, convention, heuristic and temporary fallback.
LOL-0701
Research notebook links to production model/family artifacts.
24 / INTERACTION & MOTION
Motion should explain causality
A premium terminal feels expensive because interactions are coherent, responsive and purposeful — not because everything animates.
Motion grammar
ID
Requirement / capability
LOL-0702
Draft pick: selected token locks, role branches recompute, Composition Geometry morphs and probability rail moves in one coordinated transition.
LOL-0703
Price change: old price ghosts briefly, new price snaps, GP fair band remains stable so movement is perceptible.
LOL-0704
Probability change: animate delta from prior state and annotate cause; never count-up from zero.
LOL-0705
Hover on lane/objective highlights linked variables across Rift Thesis and Market Tape.
LOL-0706
Opening a Lens preserves spatial origin so user understands where detail came from.
LOL-0707
No perpetual glow, pulsing cards or looping background motion.
LOL-0708
Animation duration generally 120–240ms; analytical state changes may use 300–450ms when tracing causal flow.
LOL-0709
Reduced-motion accessibility mode removes non-essential transitions.
LOL-0710
Loading uses structural skeleton of actual screen, not shimmering generic rectangles.
LOL-0711
Error states preserve last known good data and visibly mark staleness.
25 / GP ANALYST
AI is the interface to structured truth, not the source of truth
The assistant layer should never invent a LoL take and then search for numbers to support it. It must query GP’s structured store, return evidence and distinguish model inference from observed data.
Analyst architecture
ID
Requirement / capability
LOL-0712
Natural-language question → intent/schema plan → deterministic data query → evidence bundle → language rendering.
LOL-0713
Every answer carries clickable source/provenance references to GP entities and snapshots.
LOL-0714
Numbers are never generated by the language model.
LOL-0715
If the requested statistic is unavailable, answer “not available” and explain which data would unlock it.
LOL-0716
Allow questions like “What changed after draft pick 7?” with timestamped model deltas.
LOL-0717
Allow cross-team/player/champion comparisons with consistent definitions.
LOL-0718
Allow market questions: “Which active picks survive if price moves 5 cents?”
LOL-0719
Allow research questions in Analyst Mode but label exploratory outputs as non-production.
LOL-0720
Generated narrative is concise and mechanism-first: state → driver → consequence → uncertainty.
LOL-0721
No faux certainty adjectives like “lock,” “guaranteed,” or “free money.”
26 / PICK RESEARCH PRIORITIES
Where to search first — without assuming the answer
LoL’s structure suggests several market families may contain more modelable conditional information than top-tier match winner. These are research priorities, not claims of existing edge. Promotion depends on point-in-time CLV and forward confirmation.
Priority
Family
Why investigate
Key risk
A
Post-draft game winner / handicap
Draft creates observable information with team-specific mastery and composition interactions.
Books may reprice extremely fast; rights/latency matter.
A
Game total kills / team kills
Jointly tied to pace, matchup, draft, duration and snowball state.
Overdispersion and strong book correlations.
A
Game duration
Composition scaling, closure efficiency and objective state create mechanism.
Settlement and overtime-like edge cases; line availability.
A
Player kills / assists
Opportunity can be modeled from draft, team kill environment, role and resource share.
Limits, lineup/draft timing, correlated teammates.
B
First dragon / first tower
Lane/jungle priority creates clear pre-game mechanism.
High variance and bookmaker vig.
B
Total dragons / towers
Joint objective/duration model may add structure.
Market availability and settlement definitions.
B
Series total maps / handicap
Team strengths + side + draft adaptation produce coherent series distribution.
Top-level markets can be efficient.
C
Correct score
Useful coherence output and occasional price anomaly detector.
Large vig and sparse prices.
Benchmark
Match winner
Critical calibration benchmark and product intelligence.
Likely one of the hardest markets to beat consistently at top tier.
27 / DATA CONTRACTS
Specify what the models need before choosing vendors
The team should evaluate providers against canonical field contracts. The data product must not contort itself around whichever API happens to be easiest this week.
Minimum pre-match contract
ID
Requirement / capability
LOL-0722
Series/game schedule, competition, format, stage and timestamp.
LOL-0723
Team canonical IDs and active rosters.
LOL-0724
Player canonical IDs and roles.
LOL-0725
Side selection or side state when known.
LOL-0726
Patch/ruleset.
LOL-0727
Historical game results and game duration.
LOL-0728
Team/player game statistics adequate for team/player/role ratings.
LOL-0729
Draft pick/ban sequence for historical games.
LOL-0730
Champion assignment by player/role.
LOL-0731
Objective and early-game statistics sufficient for targeted market models.
LOL-0732
Data completeness flags per game/field.
LOL-0733
Correction/version mechanism.
Minimum market contract
ID
Requirement / capability
LOL-0734
Book identifier.
LOL-0735
Event identifier mapped to GP game/series.
LOL-0736
Market family and exact settlement rule.
LOL-0737
Selection and side.
LOL-0738
Line/threshold.
LOL-0739
Decimal odds.
LOL-0740
Timestamp and market status.
LOL-0741
Opening/current/closing history or enough polling to reconstruct it.
LOL-0742
Settlement result.
LOL-0743
Commercial storage/display/analytics rights.
LOL-0744
Prefer multiple books; single-book operation remains Research/Probation for most families.
28 / DATA QUALITY, INTEGRITY & SAFETY
The terminal must degrade gracefully
A professional system does not silently convert missing data into 50%, a stale roster into confidence, or a malformed price into a 20% edge.
Quality gates
ID
Requirement / capability
LOL-0745
Impossible-value checks for game duration, kills, objective counts and role assignments.
LOL-0746
Duplicate game detection across providers.
LOL-0747
Source conflict resolution with precedence + manual review queue.
LOL-0748
Roster mismatch detection between schedule and historical provider.
LOL-0749
Patch mismatch detection.
LOL-0750
Draft completeness verification.
LOL-0751
Market sign/side/line convention tests with cross-market coherence checks.
LOL-0752
Outlier edge detector: very large apparent edge triggers mapping audit before publication.
LOL-0753
Model input missingness converted to uncertainty/degradation, never silent imputation without flag.
LOL-0754
Provider staleness dashboard and SLA.
LOL-0755
Prediction blocked when required source is beyond freshness threshold.
LOL-0756
Post-result corrections do not rewrite original prediction snapshot.
LOL-0757
Integrity/anomaly flag for lower-tier competitions when data/market behavior is suspicious; avoid ungrounded accusations.
LOL-0758
Automated incident report stores which picks/models were affected by a data fault.
29 / ENGINEERING ARCHITECTURE
Separate data, models, market and experience so each can evolve independently
LoL will be the most stateful esport module in GP. Keep canonical contracts stable and allow providers/models to be replaced behind them.
Service boundaries
ID
Requirement / capability
LOL-0759
lol-source-adapters: one adapter per licensed source.
LOL-0760
lol-identity: teams, players, rosters, aliases, roles.
LOL-0761
lol-patch-meta: patch regimes, champion taxonomy and meta features.
LOL-0762
lol-draft: sequential draft model and composition feature service.
LOL-0763
lol-ratings: region/team/player/champion latent ratings.
LOL-0764
lol-game-model: lane, objective, duration, kills and game outcome distributions.
LOL-0765
lol-series-model: BO1/3/5 joint simulation and adaptation.
LOL-0766
lol-props: player opportunity and prop distributions.
LOL-0767
market-core: canonical odds, no-vig, consensus, closing and execution.
LOL-0768
edge-core: orthogonal value evaluation and family governance.
LOL-0769
portfolio-core: stake/correlation/exposure.
LOL-0770
prediction-ledger: immutable prediction artifacts and audit replay.
LOL-0771
lol-query: structured API used by UI and GP Analyst.
LOL-0772
lol-experience: visual composition/state orchestration; no modelling logic in front end.
LOL-0773
model-registry: artifacts, metrics, champion/challenger status and rollbacks.
Performance / reliability
ID
Requirement / capability
LOL-0774
Pre-match full match analysis target < 800ms from warm cache.
LOL-0775
Draft-step probability refresh target < 500ms once action is ingested, excluding provider latency.
LOL-0776
Market tape updates independently from expensive model recomputation where possible.
LOL-0777
Cache keys include patch, roster, draft state, model version and knowledge timestamp.
LOL-0778
All writes idempotent; repeated provider payload does not duplicate events.
LOL-0779
Dead-letter queues for malformed provider events.
LOL-0780
Feature generation is deterministic for same snapshot/model version.
LOL-0781
Background recalculation after new patch/roster data does not overwrite historic snapshots.
LOL-0782
Observability includes source latency, feature latency, model latency, UI query latency and pick publication latency.
LOL-0783
Runbooks exist for provider outage, market outage, roster conflict and model kill switch.
30 / CATEGORY OWNERSHIP
Be useful even when the user is not betting
To become the place people think of for LoL intelligence, GP needs free/public surfaces that solve search and fandom questions while premium layers monetize simulation, market intelligence and edge.
Public intelligence surfaces
ID
Requirement / capability
LOL-0784
LoL matches today with GP preview and data state.
LOL-0785
Global/team rankings with uncertainty and roster state.
LOL-0786
Player rankings by role with opponent adjustment.
LOL-0787
Champion Observatory by patch/role.
LOL-0788
Team pages with roster, form, draft fingerprint and match history.
LOL-0789
Player pages with champion pool and role-adjusted impact.
LOL-0790
Patch Observatory summaries.
LOL-0791
Tournament/circuit pages and brackets/schedules when licensed.
LOL-0792
Historical match Prediction Replay after settlement.
LOL-0793
Public model methodology page explaining what GP measures and does not know.
LOL-0794
Indexable comparison pages only where content is substantive, not SEO spam.
Premium intelligence
ID
Requirement / capability
LOL-0795
Full Draft Room and counterfactuals.
LOL-0796
Complete game/series distributions.
LOL-0797
Market Tape and multi-book fair-price comparison.
LOL-0798
Active Pick Memos and max playable prices.
LOL-0799
Portfolio/exposure tools.
LOL-0800
Deep Analyst Mode and feature provenance.
LOL-0801
Advanced GP Analyst queries.
LOL-0802
Edge Family performance and research transparency at appropriate granularity.
LOL-0803
Price alerts / post-draft alerts.
LOL-0804
Historical research explorer.
31 / BUILD ROADMAP
Build the research machine before the showroom
The order below deliberately puts rights, temporal truth and market history ahead of elaborate UI. The visual system can be prototyped in parallel, but public picks wait for validation.
#
Phase
Task
1
Phase 0 — rights & contracts
Write LoL data-rights matrix and get counsel review.
2
Phase 0 — rights & contracts
Define betting-commercial-ok lineage flag.
3
Phase 0 — rights & contracts
List candidate match/roster/draft providers and obtain written terms.
4
Phase 0 — rights & contracts
List candidate multi-book odds providers and verify LoL market coverage.
5
Phase 0 — rights & contracts
Define canonical source adapter contract.
6
Phase 0 — rights & contracts
Build source registry schema.
7
Phase 0 — rights & contracts
Create restricted-source CI test.
8
Phase 0 — rights & contracts
Decide champion/team/player asset strategy independent of restricted Riot assets.
9
Phase 0 — rights & contracts
Create emergency provider kill switch.
10
Phase 0 — rights & contracts
Document Riot Developer Tool betting restriction in engineering handbook.
11
Phase 1 — canonical data
Create team/player/league/tournament/game IDs.
12
Phase 1 — canonical data
Create alias resolver and review queue.
13
Phase 1 — canonical data
Create roster spell model.
14
Phase 1 — canonical data
Create patch/ruleset model.
15
Phase 1 — canonical data
Create draft event model.
16
Phase 1 — canonical data
Create market event/settlement model.
17
Phase 1 — canonical data
Create event-time vs knowledge-time fields.
18
Phase 1 — canonical data
Build Bronze/Silver warehouse schemas.
19
Phase 1 — canonical data
Implement first licensed historical adapter.
20
Phase 1 — canonical data
Implement incremental ingestion.
21
Phase 1 — canonical data
Implement data completeness metrics.
22
Phase 1 — canonical data
Backfill at least 3–5 years of usable pro data if rights/source permit.
23
Phase 1 — canonical data
Create cross-source game deduplication.
24
Phase 1 — canonical data
Create daily temporal snapshots.
25
Phase 1 — canonical data
Build raw → normalized reproducibility tests.
26
Phase 2 — market tape
Integrate at least two books/feeds if commercially feasible.
27
Phase 2 — market tape
Normalize LoL market naming and settlement rules.
28
Phase 2 — market tape
Build continuous odds snapshotter.
29
Phase 2 — market tape
Build no-vig library.
30
Phase 2 — market tape
Capture opening/current/closing.
31
Phase 2 — market tape
Build market dispersion and stale-price detector.
32
Phase 2 — market tape
Build best-price/max-price primitives.
33
Phase 2 — market tape
Create market replay API.
34
Phase 2 — market tape
Create line mapping unit tests.
35
Phase 2 — market tape
Start accumulating live close history immediately.
36
Phase 3 — baseline ratings
Build region hierarchical rating.
37
Phase 3 — baseline ratings
Build team roster-aware rating.
38
Phase 3 — baseline ratings
Build blue/red side effects.
39
Phase 3 — baseline ratings
Build player role ratings.
40
Phase 3 — baseline ratings
Build roster-change priors.
41
Phase 3 — baseline ratings
Build same-patch recency weighting.
42
Phase 3 — baseline ratings
Build calibration baseline versus market.
43
Phase 3 — baseline ratings
Create daily global rankings.
44
Phase 3 — baseline ratings
Create uncertainty intervals.
45
Phase 3 — baseline ratings
Lock first untouched validation window.
46
Phase 4 — champion & draft
Build champion patch/role posterior.
47
Phase 4 — champion & draft
Build player-champion mastery.
48
Phase 4 — champion & draft
Build team champion comfort.
49
Phase 4 — champion & draft
Build synergy/counter graph.
50
Phase 4 — champion & draft
Build flex-role probabilities.
51
Phase 4 — champion & draft
Build sequential ban/pick model.
52
Phase 4 — champion & draft
Build final draft win-probability model.
53
Phase 4 — champion & draft
Build Draft WPA.
54
Phase 4 — champion & draft
Build composition taxonomy with measured/inferred flags.
55
Phase 4 — champion & draft
Build composition power-window model.
56
Phase 4 — champion & draft
Validate post-draft improvement over pre-draft baseline.
57
Phase 4 — champion & draft
Create draft replay dataset.
58
Phase 5 — mechanism models
Build lane expected differential models.
59
Phase 5 — mechanism models
Build first blood model.
60
Phase 5 — mechanism models
Build first dragon model.
61
Phase 5 — mechanism models
Build first tower model.
62
Phase 5 — mechanism models
Build game duration distribution.
63
Phase 5 — mechanism models
Build team kills/total kills joint model.
64
Phase 5 — mechanism models
Build objective count distributions.
65
Phase 5 — mechanism models
Build lead conversion/comeback model.
66
Phase 5 — mechanism models
Build game-state simulation scaffold.
67
Phase 5 — mechanism models
Build series adaptation model.
68
Phase 5 — mechanism models
Build BO3/BO5 simulator.
69
Phase 5 — mechanism models
Run cross-market coherence tests.
70
Phase 6 — player props
Build team kill environment.
71
Phase 6 — player props
Build player kill share.
72
Phase 6 — player props
Build player assist share.
73
Phase 6 — player props
Build death exposure.
74
Phase 6 — player props
Build CS/min + duration joint model.
75
Phase 6 — player props
Build draft-conditioned opportunity refresh.
76
Phase 6 — player props
Build series-total player prop simulator.
77
Phase 6 — player props
Validate distribution calibration by role.
78
Phase 6 — player props
Add line ladder pricing.
79
Phase 6 — player props
Keep props Shadow until live CLV evidence exists.
80
Phase 7 — edge engine
Implement Fundamental GP and Market-Informed GP separation.
81
Phase 7 — edge engine
Implement feature lineage and contamination tags.
82
Phase 7 — edge engine
Implement leave-one-market-family-out forecasts.
83
Phase 7 — edge engine
Build edge posterior.
84
Phase 7 — edge engine
Build family-specific gates.
85
Phase 7 — edge engine
Build Family Registry state machine.
86
Phase 7 — edge engine
Build FDR/multiple-testing workflow.
87
Phase 7 — edge engine
Build untouched forward confirmation workflow.
88
Phase 7 — edge engine
Build CLV analytics by family/timing/book.
89
Phase 7 — edge engine
Build automatic degradation/kill logic.
90
Phase 8 — portfolio
Build joint simulation correlation matrix.
91
Phase 8 — portfolio
Build posterior fractional Kelly.
92
Phase 8 — portfolio
Build exposure taxonomy.
93
Phase 8 — portfolio
Build max per match/team/player/family limits.
94
Phase 8 — portfolio
Build executable EV after slippage.
95
Phase 8 — portfolio
Build price invalidation alerts.
96
Phase 8 — portfolio
Build portfolio audit ledger.
97
Phase 9 — experience foundation
Build GP LoL design tokens and semantic color map.
98
Phase 9 — experience foundation
Build Canvas/Dock/Lens primitives.
99
Phase 9 — experience foundation
Prototype Command Center.
100
Phase 9 — experience foundation
Prototype Match Terminal.
101
Phase 9 — experience foundation
Prototype Draft Room.
102
Phase 9 — experience foundation
Prototype Lane Theater.
103
Phase 9 — experience foundation
Prototype Tempo River.
104
Phase 9 — experience foundation
Prototype Market Tape.
105
Phase 9 — experience foundation
Prototype Pick Memo.
106
Phase 9 — experience foundation
Run design review specifically for card-soup regression.
107
Phase 10 — entity experiences
Build Team War Room.
108
Phase 10 — entity experiences
Build Player Atlas.
109
Phase 10 — entity experiences
Build Champion Observatory.
110
Phase 10 — entity experiences
Build Patch Observatory.
111
Phase 10 — entity experiences
Build Circuit/Ecosystem map.
112
Phase 10 — entity experiences
Build Model & Research Lab.
113
Phase 10 — entity experiences
Build historical Prediction Replay.
114
Phase 10 — entity experiences
Build compare mode.
115
Phase 11 — GP Analyst
Define query schema.
116
Phase 11 — GP Analyst
Build deterministic stats query layer.
117
Phase 11 — GP Analyst
Build evidence bundle.
118
Phase 11 — GP Analyst
Add provenance links.
119
Phase 11 — GP Analyst
Add unavailable-data refusal behavior.
120
Phase 11 — GP Analyst
Add match/draft/market question templates.
121
Phase 11 — GP Analyst
Evaluate numerical fidelity and hallucination rate.
122
Phase 12 — production validation
Run nested walk-forward.
123
Phase 12 — production validation
Run untouched season/period confirmation.
124
Phase 12 — production validation
Shadow-publish all candidate families.
125
Phase 12 — production validation
Accumulate 500+ opportunities per promising family where feasible.
126
Phase 12 — production validation
Review CLV before ROI claims.
127
Phase 12 — production validation
Perform mapping/data incident audit.
128
Phase 12 — production validation
Run champion/challenger comparisons.
129
Phase 12 — production validation
Stress test patch transition.
130
Phase 12 — production validation
Stress test roster shock.
131
Phase 12 — production validation
Stress test single-book outage.
132
Phase 12 — production validation
Open public intelligence surfaces only after rights review.
133
Phase 12 — production validation
Open public picks only for Active families.
Total roadmap tasks in this build sequence: 133.
32 / QUANT RESEARCH AGENDA
Questions that can become moat
The strongest edges are usually found through repeated, pre-registered questions about mechanism and market response. This agenda is deliberately larger than the first production model.
RQ
Research question
RQ-001
How much predictive value does draft add over a roster/side/team pre-draft baseline by region and patch age?
RQ-002
How quickly does market price incorporate each draft action?
RQ-003
Does Draft WPA predict post-draft closing movement?
RQ-004
Which teams consistently draft above/below their pre-draft expected strength?
RQ-005
Is draft skill stable across patches or coach dependent?
RQ-006
Does flex entropy create measurable market mispricing?
RQ-007
Are blind-pick comfort champions under/overvalued by markets?
RQ-008
How much of champion counter data survives opponent/player adjustment?
RQ-009
Which champion synergies remain predictive after selection-bias correction?
RQ-010
Can team composition scaling curves predict game-duration residuals?
RQ-011
Which teams systematically close games faster/slower than composition state predicts?
RQ-012
Does gold-lead conversion skill persist year to year?
RQ-013
Which teams have stable comeback skill after controlling for composition?
RQ-014
How much player-role rating improves game prediction beyond team rating?
RQ-015
Does player-champion mastery improve post-draft prediction out of sample?
RQ-016
How much roster continuity is needed before team-level historical data becomes reliable?
RQ-017
How fast should ratings reset after one-player vs two-player changes?
RQ-018
Does a coach change primarily affect draft or also game execution immediately?
RQ-019
How should region strength uncertainty expand between international events?
RQ-020
Which domestic regions are most mispriced immediately before international events?
RQ-021
Do region meta-style differences create totals edges internationally?
RQ-022
Are blue/red side effects stable by patch/league?
RQ-023
Does side selection itself reveal private team draft preference information?
RQ-024
Can lane expected gold differential predict first tower better than historical first-tower rate?
RQ-025
Can combined lane priority predict first dragon better than team objective rate?
RQ-026
Does jungle-mid synergy improve first objective models?
RQ-027
Are first blood markets structurally too vig-heavy to overcome despite model signal?
RQ-028
What distribution best models total kills under different pace archetypes?
RQ-029
How much game duration explains player kill/assist prop variance?
RQ-030
Are player kill lines more mispriced post-draft than pre-draft?
RQ-031
Do books adjust player props slower than game totals after draft?
RQ-032
Which roles produce the most stable prop calibration?
RQ-033
Does resource share predict player kills better than recent kill average?
RQ-034
Can team kill environment + kill share fully explain player kill props?
RQ-035
When are player props too correlated to justify multiple positions?
RQ-036
Do alternate kill lines reveal book-implied distribution tails that differ from GP?
RQ-037
Which books lead price discovery in LoL by market family?
RQ-038
How should book weights change by family and region?
RQ-039
Does cross-book dispersion predict future line movement?
RQ-040
Does a stale-price detector generate positive CLV without any fundamental model edge?
RQ-041
How much closing line quality differs pre-draft versus post-draft?
RQ-042
What is the optimal prediction timestamp for each family?
RQ-043
Does post-draft edge decay in seconds, minutes or tens of minutes?
RQ-044
Can price movement around draft be attributed to specific champion actions?
RQ-045
Does market overreact to famous comfort picks?
RQ-046
Does market underreact to role-flex resolution?
RQ-047
Are top-tier match winners measurably harder to beat than derived props?
RQ-048
Which tier-2 leagues offer larger edge but worse data/integrity/liquidity tradeoffs?
RQ-049
Can integrity/data-quality filters improve CLV by excluding suspicious/low-information events?
RQ-050
Does patch week 1 create larger model-market disagreement and is it real?
RQ-051
Does edge disappear as patch matures?
RQ-052
Which teams adapt fastest to large patches and is that persistent?
RQ-053
Can meta distance replace fixed recency decay?
RQ-054
How much prior data should survive a major item/objective system change?
RQ-055
Does champion pool depth create stronger BO5 value than BO1 value?
RQ-056
Which teams improve most from Game 1 to Game 2 after a loss?
RQ-057
Is series “momentum” real after controlling for latent team/day state and draft adaptation?
RQ-058
Does successful Game 1 champion information change Game 2 market efficiently?
RQ-059
Can side-choice decisions reveal expected matchup advantage?
RQ-060
How much non-independence is needed to calibrate 2-0 / 3-0 series tails?
RQ-061
Can correct-score markets be used to detect incoherent series pricing?
RQ-062
Which no-vig method best predicts close/outcomes for multiway correct score?
RQ-063
Does sharp-consensus blending improve fundamental calibration without eliminating derived edge?
RQ-064
What market inputs can be used safely without circularity for each family?
RQ-065
Can a fundamental model beat market calibration in any region/market at close?
RQ-066
What is the relationship between model disagreement magnitude and future CLV?
RQ-067
How should edge posterior thresholds vary with data maturity?
RQ-068
What P(edge>0) threshold maximizes risk-adjusted return?
RQ-069
How much theoretical EV is lost to price slippage between signal and execution?
RQ-070
Does max playable price improve user realized CLV versus static picks?
RQ-071
How does recommended stake change when correlation is estimated from joint simulations?
RQ-072
Which market families create hidden duplicate exposure to the same “fast game” thesis?
RQ-073
Does portfolio optimization improve drawdown without sacrificing much expected growth?
RQ-074
What sample is required to activate each family given observed variance?
RQ-075
How often do discovered segments fail untouched confirmation?
RQ-076
What false-discovery-rate control best balances research velocity and overfitting?
RQ-077
How stable are calibration curves across patches?
RQ-078
Can conformal or distribution-free intervals improve uncertainty coverage under patch shift?
RQ-079
Does ensemble diversity improve tails more than average loss?
RQ-080
Which feature groups actually add incremental out-of-sample value in ablations?
RQ-081
Does model complexity improve CLV or only predictive scoring?
RQ-082
Can simpler hierarchical models outperform boosted models under patch drift?
RQ-083
Which model families are easiest to audit and maintain without sacrificing edge?
RQ-084
How should uncertainty expand when roster roles are ambiguous?
RQ-085
How should uncertainty expand when draft role assignment is unresolved?
RQ-086
Does public player popularity bias props?
RQ-087
Do star-player props carry systematically higher vig?
RQ-088
Are underdog team kill overs more mispriced in scaling compositions?
RQ-089
Does objective-focused style produce under/over kill environments versus market?
RQ-090
Can lane pressure and comp volatility predict stomp probability?
RQ-091
Can stomp probability improve kill handicap and duration tails?
RQ-092
Does expected scaling crossover help price live/post-draft comeback scenarios?
RQ-093
Which publicly understandable GP metric has the strongest correlation with true predictive improvement?
RQ-094
Does showing uncertainty improve user decision quality and retention?
RQ-095
Can the Pick Memo reduce users taking stale prices?
RQ-096
Which screen gets users to insight fastest: Draft Room, Rift Thesis or Market Tape?
RQ-097
Do power users use Fan/Bettor/Analyst modes as intended?
RQ-098
Can the terminal expose deep data without increasing time-to-decision?
RQ-099
Which visual explanation best communicates draft impact without oversimplifying?
RQ-100
How should GP Analyst phrase counter-thesis to reduce false certainty?
RQ-101
Can Prediction Replay increase trust after losing picks by showing that the process was still correct?
RQ-102
Which public free surfaces most effectively build “look it up on GP” behavior?
RQ-103
What is the minimum licensed data stack that sustains the best pre-match models without official low-latency feed?
RQ-104
At what revenue/user level does official GRID data create enough incremental value to justify cost?
RQ-105
Which model components would actually improve with official real-time data versus already being solved pre-match?
Research questions specified: 105.
33 / RELEASE GATES
When we are allowed to say “top of the top”
Marketing language must follow evidence. These are the minimum technical/product standards before GP should position LoL as an elite quant-grade intelligence product.
Data acceptance
ID
Requirement / capability
LOL-0805
Canonical entity/roster resolution >99% on audited major-league sample.
LOL-0806
Every production feature has source lineage and availability timestamp.
LOL-0807
No restricted/unapproved source reaches betting outputs.
LOL-0808
Historical draft coverage sufficient for target leagues and transparently measured.
LOL-0809
Multi-book price/close capture working for target market families.
LOL-0810
Data quality incidents are observable and replayable.
Model acceptance
ID
Requirement / capability
LOL-0811
Pre-draft model validated walk-forward and calibrated by major regime.
LOL-0812
Post-draft model demonstrates incremental out-of-sample value over pre-draft baseline.
LOL-0813
Series simulator calibrated on score/totals tails.
LOL-0814
Player prop distributions pass coverage/calibration tests before eligibility.
LOL-0815
Patch-transition drift is detected and uncertainty expands appropriately.
LOL-0816
Fundamental versus market-informed outputs are independently reproducible.
Edge acceptance
ID
Requirement / capability
LOL-0817
At least one market family completes Shadow → Probation → Active with untouched forward evidence.
LOL-0818
Active family shows positive CLV with confidence interval/supporting evidence appropriate to sample.
LOL-0819
No family is activated based only on ROI.
LOL-0820
Execution prices are captured and materially achievable.
LOL-0821
Multiple-testing protection is in place before segment mining.
LOL-0822
Portfolio correlation and stake caps are operational.
LOL-0823
Kill/degrade rules have been tested in simulation/shadow.
Product acceptance
ID
Requirement / capability
LOL-0824
Match page default viewport communicates forecast, draft/roster state, primary mechanisms and market status without scrolling.
LOL-0825
Draft Room can replay and counterfactually evaluate historical drafts.
LOL-0826
No core screen degenerates into a vertical pile of equal cards.
LOL-0827
Fan/Bettor/Analyst modes are consistent and user-tested.
LOL-0828
Every probability/edge can open provenance without navigation loss.
LOL-0829
Mobile delivers a curated thesis and executable pick state, not desktop compression.
LOL-0830
GP Analyst numeric fidelity passes automated tests.
LOL-0831
Visual QA demonstrates a coherent GP-specific system across all LoL pages.
FINAL AUDIT QUESTIONIf a professional esports bettor, sportsbook trader, data scientist and product designer review GP independently, none should be able to identify a missing foundational layer. Their remaining criticism should be about sample size, proprietary data depth, or model performance — not missing process.
34 / SOURCE & POLICY APPENDIX
Current external constraints used in this blueprint
These sources were checked while drafting the architecture because LoL data access and betting-policy rules can change. Re-verify before implementation and whenever Riot/provider terms change.
Source
Why it matters
URL
Riot Developer Portal — General Policies
Last updated Mar. 11, 2025. States all products must be registered/audited and, under Monetization, “Your product cannot feature betting or gambling functionality.”
https://developer.riotgames.com/policies/general
Riot Developer Portal — League of Legends
Documents Data Dragon, LoL API routing, Tournament API, League Client API and Live Client Data API.
https://developer.riotgames.com/docs/lol
Official Esports Data powered by Riot Games
States Riot partners with GRID to distribute real-time League of Legends esports data and positions the feed as official/certified source.
https://riotesportsdata.com/
Riot Games — Betting sponsorships in esports
June 26, 2025. Says Riot’s betting-partner program builds on its official GRID relationship and approved betting partners must use GRID to power offerings.
https://www.riotgames.com/en/news/esports-betting-sponsorships
LoL Esports — LoL Esports Data Portal Dev Diary
Describes LDP competition data, API/replays/telemetry and community use cases such as Leaguepedia and Oracle’s Elixir.
https://lolesports.com/news/dev-diary-introducing-the-new-lol-esports-data-portal
LoL Esports — Win Probability Dev Diary
Describes Riot/AWS professional WP variables including time, gold share, XP, alive players, towers, dragons, buffs and inhibitor timers; useful benchmark for state-model design.
https://lolesports.com/en-GB/news/dev-diary-win-probability-powered-by-aws-at-worlds
Oracle’s Elixir
Community professional LoL statistics/datasets useful for research bootstrap. Commercial/betting rights must be verified independently before production use.
https://oracleselixir.com/
35 / THE PRODUCT IN ONE SENTENCE
The moat
GP LoL Intelligence OS is not a picks page with stats around it. It is a rights-safe temporal data platform that models the roster, patch, draft, lanes, objectives, players, series and market as one probabilistic system — and then renders that system as a spatial strategy terminal where every actionable price is auditable.
THE BARWhen users think “What will happen in this LoL series, why, what did the draft change, what does the market think, and is there a price worth taking?” there should be one place that answers all five questions in one coherent object: GP.
Traceable LoL capability requirements in this document: 831.
Build-roadmap tasks: 133. Research questions: 105.
End of Master Blueprint 3.0.