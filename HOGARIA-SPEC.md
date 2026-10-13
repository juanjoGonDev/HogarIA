# HogarIA — Absorption of Basketra into MiCocinAI

Status: **in progress** · Owner: juanjoGonDev · Spec opened: 2026-09-19 · Method: SDD (this file is the contract)

## 1. Why

`MiCocinAI` today plans meals and a pantry. `Basketra` (private, mobile-first, one Node process +
SQLite) turns physical receipts into price observations, keeps shopping lists, and compares
baskets. The user has decided to stop maintaining two apps: **one product at home**, absorbing
Basketra completely and renaming it.

Name: **HogarIA**. Chosen because the roadmap goes beyond food — household tasks, a shared
calendar, external calendars, Home Assistant. `MiCocinAI` becomes the historical name.

The two apps share the interesting surface: a dish knows its ingredients, ingredients cost money at
a store, the pantry knows what is already bought, and the receipt is the evidence. Absorbing gives:

| Joint capability                                           | Feeds from                                      |
| ---------------------------------------------------------- | ----------------------------------------------- |
| Approximate cost of a dish / of a week's plan              | `price_observations` + recipe ingredients       |
| "Add to shopping list" from a recipe, a plan or the pantry | `shopping_list_items`, `canonical_products`     |
| Receipt scan fills the pantry (with expiry dates)          | `receipt_items` → `ingredients`                 |
| Expiry pressure reorders the weekly plan                   | `ingredients.expiration_date` + planner         |
| Pantry stock reduces the estimated basket                  | `ingredients.quantity` vs `shopping_list_items` |

## 2. Product shape

Nine sections, one screen each, tabs inside, never everything at once.

```
HogarIA
├── Today            (dashboard: meals due, expiries, open list, budget of the week)
├── Plan             (calendar day/week/month — already shipped — + AI planner)
├── Recipes          (existing)
├── Pantry           (existing: ingredients, utensils) + expiry column + "add to list"
├── Shopping         (lists · detail with check-off, swipe, cost preview, store selection)
├── Catalog          (products, variants, aliases, categories tree, EAN)
├── Prices           (price history per product/retailer/store, ticket evidence)
├── Receipts         (capture → OCR → AI → editable review rows → confirm → pantry + prices)
├── Household        (members, invites, tasks [coming], presence)
└── Settings         (tabs: App · AI · Sync · Support)   Support: logs viewer + report a bug
```

Mobile-first, installable (PWA), usable offline, one private instance. No public multi-tenant
ambitions, no payments, no marketplace, no scraping services — the same non-goals Basketra states.

## 3. Copy of Basketra's contracts (verbatim behaviour, adapted to this stack)

### 3.1 AI provider request

`src/ai/provider.ts` is the reference. Reproduce:

- Endpoint: `POST {baseUrl}/chat/completions` (trailing slash normalised). Optional capability
  probe: `GET {baseUrl}/capabilities`; `400 | 404 | 405` ⇒ no capabilities, continue.
- Headers: `authorization: Bearer <key>` only when a key exists; `x-client-request-id: <correlationId>`
  only when the id matches the allowed pattern; session affinity trio
  `x-session-affinity`, `x-session-affinity-keep-open: true`, and `x-session-affinity-final: true`
  on the final turn.
- Body: `{ model, messages: [{role:'system',content},{role:'user',content}], response_format:
{ type: 'json_schema', json_schema: { name, strict: true, schema } }, reasoning?: { effort } }`.
- Attachments (images/PDF) ⇒ `multipart/form-data` with `request` = the JSON above and each
  attachment appended as `files`; enforce a JSON-body byte ceiling and fail with
  `AI_ATTACHMENT_TOO_LARGE` (`413`) instead of silently truncating.
- Response: read with a hard byte cap, then `choices[0].message.content` parsed as JSON. Empty body
  ⇒ `AI_EMPTY_RESPONSE (retryable)`; unparsable ⇒ `AI_INVALID_RESPONSE`; transport failure ⇒
  `AI_UNREACHABLE (retryable)`; HTTP status mapped through a stable taxonomy.
- Providers are **ephemeral**: constructed per operation, `dispose()`d after. No resident worker, no
  daemon, no broker.
- Every AI output is a **proposal**: validated locally, shown editable, persisted only on confirm.
  The model never writes to the database.

### 3.2 Money, quantities, matching

- Money is an **integer number of cents**, always. Never float arithmetic on money; the UI accepts
  and displays euros with two decimals (`es-ES`), never cents.
- Normalised quantities are reduced integer fractions (`{numerator, denominator}`).
- A price observation is **immutable**; correcting it creates a new observation. No silent overwrite
  of historical evidence.
- Matching order: EAN/GTIN → SKU → confirmed alias → historic mapping → deterministic attributes →
  lexical similarity → AI rerank → human confirmation. A confirmed exact match and category are
  reused before asking the AI.
- A price enters history only with a **retailer** and real evidence (ticket, photo, explicit manual
  entry). No evidence ⇒ no observation, and the item still saves.

### 3.3 Cost preview and basket optimisation

Reference: `src/infrastructure/shopping-estimate.ts` + offers/optimization.

- Per line: resolve the effective store for the list (explicit selection, else last used, else the
  nearest known store), then the **latest confirmed observation** for that product/variant at that
  retailer ⇒ `estimatedTotalMinor`, or `status: 'unpriced'` with a reason (`price-missing`,
  `no-store`, `ambiguous-product`).
- List total = sum of priced lines only; unpriced lines are listed separately with their reason — a
  quote never pretends to be complete.
- Plans: `single-retailer` (one store, fewest trips), `balanced`, `maximum-saving` (split across
  retailers). Exhaustive over retailer subsets while the set is small; bounded and deterministic
  otherwise. Each run persists `optimization_runs` + `optimization_plans` + items with the inputs it
  used, so a plan is re-derivable and never silently re-priced.
- Prime/free-delivery only zeroes transport with valid evidence or a user-confirmed rule.

### 3.4 Durable AI queue

Reference: `src/receipts/durable-job-store.ts` + `durable-runner.ts`.

- Table `ai_jobs`: `id, kind, payload_json, status(queued|running|completed|failed|cancelled),
attempts, max_attempts, run_after, lease_expires_at, response_id, remote_status, error_code,
error_message, created_at, updated_at, finished_at`.
- Transitions: `queued → running` takes a lease with a deadline; a worker that dies leaves
  `running` rows which are swept at startup to `failed` + `RECEIPT_EXTRACTION_INTERRUPTED` (or
  re-queued when attempts remain) — recovery is automatic, never manual.
- Backoff per kind; `max_attempts` from Settings; single-process cooperative scheduling with one
  queue per saved provider configuration, shared by every AI operation (not only receipt scans).
  `ai_configs.concurrency` is the maximum in-flight work for that provider: integer `1..8`, or
  `0` for unlimited; new configurations default to `0`. Pending jobs keep their provider-config
  identity and can be reordered/cancelled/retried through the AI settings queue manager.
- REST: `POST /api/ai/jobs` (create, returns the id), `GET /api/ai/jobs/:id`,
  `DELETE /api/ai/jobs/:id` (cancel), `POST /api/ai/jobs/recover`. Progress reaches the client via
  SSE invalidations, not polling.
- The queue is the only path to the provider for heavy work (receipt extraction, basket
  optimisation, weekly plan): a request handler never blocks on the model.

### 3.5 Realtime and concurrency

Reference: `src/realtime/` + the CAS rules in `spec.md`.

- REST stays authoritative for reads and writes. SSE (`GET /api/realtime`) carries **invalidations
  only**: `entity`, `mutation`, `id`, `version`, `timestamp` — no product names, prices, receipts,
  coordinates or secrets.
- Client: one stream while the document is visible, closed when hidden, re-sync on `visibilitychange`
  and on reconnect; bursts coalesced; no domain polling.
- `shopping_lists` / `shopping_list_items` (and later pantry rows) carry an integer `version`; writes
  are compare-and-swap inside the same transaction; a stale write gets `409` with a stable code plus
  the current canonical row so the UI can show local vs remote and "Use mine" retries on the new
  version. Reordering requires the list version and is rejected if the order moved underneath.

### 3.6 Receipt pipeline with expiry

`capture(s) → OCR (ephemeral provider) → AI verify → editable rows → confirm`, as Basketra does, plus
the joint behaviour the user asked for:

- JPEG/PNG: local OCR first (Spanish), evidence kept and recoverable; when a provider is configured
  it always continues with AI verification — no toggle exposing a half-baked mode. PDF: provider or
  manual review.
- Review UI: one editable row per line (description, quantity, unit, unit price, total in euros,
  **expiry date** when present). Never a transcription textarea as the primary control.
- On confirm: price observations (immutable, with the ticket's store), catalog projection, and —
  new — `pantry` writes: any line whose product resolves to a pantry ingredient type inserts or
  tops up stock with `expiration_date` from the receipt (`Best before`, `Use by`, `Consumir antes
de`, `CAD`, `FECHA DE CONSUMO PREFERENTE`), and shows what was added.
- Deleting a capture from a draft never deletes stored evidence unless it is unreferenced.

## 4. Everything from the UI, nothing from env

Runtime settings live in SQLite (`runtime_settings`, one row `id='instance'`) and are edited under
**Settings**. Reference: `src/infrastructure/runtime-settings.ts` (typed defaults, validated ranges,
masking of secrets).

Target list for MiCocinAI — every one of these stops being read from `process.env`:

| Key                                                                                     | Default                                     | Bounds                                  |
| --------------------------------------------------------------------------------------- | ------------------------------------------- | --------------------------------------- |
| `listenPort`                                                                            | `3000`                                      | 1–65535, applied on restart             |
| `corsOrigins`                                                                           | same-origin                                 | list, blank disables                    |
| `jwtSecret`                                                                             | generated on first boot, stored             | never returned to the client            |
| `jwtExpiresIn`, `refreshTokenExpiresIn`                                                 | `15m`, `30d`                                | duration strings                        |
| `bcryptRounds`                                                                          | `10`                                        | 8–15                                    |
| `rateLimitEnabled`, `rateLimitWindowMs`, `rateLimitMax`                                 | on, `60000`, `300`                          | used by CI/e2e via API                  |
| `aiBaseUrl`, `aiApiKey`, `aiModel`                                                      | empty                                       | validated URLs, key masked (`••••abcd`) |
| `aiTimeoutMs`, `aiMaxRetries`                                                           | `30000`, `1`                                | 1–10 retries                            |
| `aiQueueConcurrency`, `aiJobMaxAttempts`, `aiJobBackoffMs`                              | `1`, `3`, `5000`                            | bounded                                 |
| `ocrEnabled`, `ocrLanguage`                                                             | on, `spa`                                   |                                         |
| `maxBodyBytes`                                                                          | `32 MiB`                                    | 1 KiB–512 MiB                           |
| `dbWalMode`, `dbCacheSizeKb`, `dbBusyTimeoutMs`                                         | on, `-64000`, `5000`                        |                                         |
| `memoryWarnMb`, `memoryCriticalMb`, `memoryCheckMs`                                     | thresholds                                  |                                         |
| `logMaxLines`, `logMaxBytes`, `logRetentionDays`, `logLevel`                            | `10000`, `40 MiB`, `7`, `info`              |                                         |
| `syncIntervalMs`, `syncRetryBackoffMs`, `outboxMaxItems`                                | `15000`, `2000`, `500`                      |                                         |
| `pwaCacheName`                                                                          | derived from version                        | read-only, shown in UI                  |
| `offlineEnabled`, `featureShopping`, `featureReceipts`, `featurePrices`, `featureTasks` | on                                          | kill-switches                           |
| `supportRepoUrl`                                                                        | `https://github.com/juanjoGonDev/MiCocinAI` | used by report-a-bug                    |
| `currency`, `locale`                                                                    | `EUR`, `es-ES`                              |                                         |

Only **bootstrap** may come from the environment, and only for values needed before the database can
be opened: `DATABASE_PATH` (default `./data/hogaria.sqlite` — the existing file is adopted on first
boot, never renamed under the user's feet). `NODE_ENV` stops being read: `production` is inferred
from the build the client loads plus `settings.env`, and a missing value defaults to development.

Rules: typed defaults + explicit validators per key; a PUT patches only supplied keys; secret keys are
write-only through the API (never echoed, only `configured` + a tail mask); ranges are enforced
server-side with stable error codes; changes that need a restart say so in the UI and expose a
"restart to apply" state. Settings are **per instance**, shared by household members, with a
`updated_at` and a diff view.

## 5. Offline, caching and versioning

The rule: **the device is a first-class store; the server is the arbiter.**

1. Every mutation writes locally first (localStorage) and renders immediately, then flushes to the
   server through an **outbox**. The local copy is kept until a `2xx` ack arrives — never dropped on
   send, only on confirmation.
2. Namespaced keys: `hogar:outbox:v1`, `hogar:cache:v1:<entity>`, `hogar:settings:v1`,
   `hogar:session:v1`. Budgeted: a soft cap (2 MiB) with least-useful-first eviction, and eviction
   never removes an unsent outbox entry (it fails loudly with a visible "storage full" warning
   instead). Every outbox entry carries `clientId` (idempotency key) so a retry cannot double-apply.
3. Reads: cached canonical payloads with `entityVersion`; on open/reconnect, re-fetch canonical
   state and reconcile — local unsent edits win over the cached copy but are marked "pending" and
   can conflict (`409` flow from §3.5).
4. A background hook flushes the outbox on `online`, on `visibilitychange`, and on a timer from
   Settings; overlapping flushes are impossible (single in-flight per entity).
5. Cache API: the Angular service worker (`@angular/service-worker`, a dependency that was never
   wired up) with `ngsw-config.json` — `shell` group prefetches `index.html`/`manifest.json`/all
   `*.js`+`*.css`, `assets` group is lazy-on-install and prefetched on update, and API reads use
   `freshness` (`/api/health`, `/api/preferences`) so a stale response is only a fallback. ngsw
   builds one cache per manifest hash (`cacheName = this.cache.name`, prefix supplied by the worker)
   and, on activation, deletes every other cache (`caches.delete(...)`, verified in the emitted
   `ngsw-worker.js`) — a new build therefore forces a clean cache: Basketra's
   `__BASKETRA_VERSION__` trick without a templating step. `@angular/build` v19
   takes `"serviceWorker": "ngsw-config.json"` (a **path**, not a boolean) and writes
   `ngsw-worker.js`, `safety-worker.js`, `worker-basic.min.js` and `ngsw.json` (v1: `index`,
   `assetGroups`, `dataGroups`, `hashTable`, `navigationUrls`, `navigationRequestStrategy:
performance`) into `dist/browser`. `SwUpdate` surfaces "new version available" with **Activate
   now** (activate + clear + reload); a Settings toggle controls silent auto-activation. Because the
   cache name only changes when an asset changes, releases must bump `version` in
   `frontend/package.json`, mirrored in `environments/environment.ts` until a build-time injection
   lands (P6).
6. `GET /api/meta` (P1) answers `{ version, build, serverTime, ready, cacheName }`; until it exists
   the About card reads `GET /api/health` + `environment.version`. The client derives uptime from one
   `serverTime` and never polls diagnostics per second.

## 6. Logs: one funnel, one viewer, one report

`todas las entradas pasan por el mismo sitio` — `LogService` (`core/services/log.service.ts`, already
the SSE viewer) becomes the **only** logging surface:

- `log(level, event, data?)` with levels `trace|debug|info|success|warn|error`; every call stamps
  `ts`, `level`, `source: 'client'`, `session`, `appVersion`, `route`, `seq`.
- Redaction before anything is stored or sent: bearer/JWT-shaped strings, `api_key`, `password`,
  emails of other users, file paths. Values are truncated; an event is capped (2 KiB encoded, like
  Basketra's `MAX_EVENT_BYTES`).
- `console.*` of app code is replaced by the service; a boot-time bridge keeps third-party noise out
  but routes `window.onerror` and `unhandledrejection` in as `error` events.
- Client events persist to `hogar:logs:v1` (bounded ring, newest first) so an offline crash is still
  reportable; they are POSTed to the server in batches (existing `/api/logs` ingest + `GET /api/logs`
  - SSE) which validates the closed schema and drops anything unknown — server and client events end
    up in one queryable stream with a `source` field, rotation by line/byte ceilings and oldest-archive
    removal.
- The viewer (`/logs`) keeps its filters (level, source, pause, autoscroll) and gains: saved views,
  `only errors`, and a per-line expand for `data`.
- **Report a bug** is its own section (`/report`): it composes the markdown (version, build, UA,
  viewport, online/offline, settings hash, last N log lines, reproduction notes as written by the
  user), then offers _Open issue_ (`{supportRepoUrl}/issues/new?title=…&body=…`, which works for a
  signed-in GitHub user against the public repo) and _Copy to clipboard_ as the always-available
  fallback (`navigator.clipboard` with a `execCommand` fallback and a "copied" confirmation). The
  report never contains the AI key, tokens, or other members' emails (asserted by a test).

## 7. UI rules

- Minimal: one idea per screen; tabs, pagination and filters instead of scrolling walls. Tabs,
  subviews, page, search, filters and sort live in query params (existing `core/utils/tab-url.ts`),
  defaults omitted from generated URLs; transient state (drafts, dialogs, bulk selection) never does.
- Depth-aware surfaces: header compact, primary action single and obvious, secondary actions revealed
  on hover/focus-within (calendar precedent).
- Gestures on mobile, from Basketra's lists: short right swipe toggles checked, short left swipe
  reveals edit/delete, past the red threshold delete on release with **Undo**. Every gesture has an
  equivalent button for pointer, keyboard and assistive tech; button-delete keeps its confirmation.
- Icons: inline SVG in a sprite (`assets/icons.svg`), `currentColor`, no emoji in new surfaces (the
  existing nav emoji migrate in phase P2). Every SVG gets `aria-hidden` unless it is the only label.
- Animations: `@keyframes` with explicit `from`/`to` only (no implicit 50% frames), durations from
  tokens (`--duration-*`), `prefers-reduced-motion` disables transform/opacity loops. Skeletons, the
  thin top progress bar and the spinner introduced in the calendar are the reference style.
- Numbers/currency/dates via `es-ES` helpers in one util (the `Intl` grouping separator is **not**
  guaranteed in every browser build — tests must tolerate `2100` and `2.100`).
- Bilingual: every new string goes into both `es`/`en` dictionaries, and no test asserts a translated
  label (CI resolves `en` sometimes).

## 8. Rename to HogarIA

Done in steps so nothing breaks under review:

- **P0 (this round)**: user-facing only — `environment.appName`, `index.html` title +
  `theme-color` + `apple-mobile-web-app-title`, `manifest.json` `name`/`short_name`, header/footer
  text, README heading with an alias note. Storage keys become `hogar:*` with a one-shot read-migrate
  from `mi-cocinai:*` (tokens included, so nobody logs out).
- **P1**: docs and titles (`SETUP.md`, `RUN.md`, `DESIGN-SYSTEM.md` heading, `CHANGELOG.md` entry),
  `DATABASE_PATH` default `data/hogaria.sqlite` with adoption of the existing file.
- **P2**: npm workspace package names (`@hogaria/web`, `@hogaria/server`) **together with**
  `.github/workflows/ci.yml` (`pnpm --filter …`), `Makefile`, `scripts/*`, `playwright.config.ts`
  and `Dockerfile*` — one atomic commit, because CI filters break silently.
- **P3**: repo rename is the user's click (GitHub settings); the app must not assume its own URL —
  `supportRepoUrl` in Settings covers it, and `gh` in CI is the only thing that needs the new name.

The GitHub repo keeps `MiCocinAI` until P3; nothing in code hardcodes the owner/repo except the
`supportRepoUrl` default.

## 8b. From a cooking level to a household profile

The signup form asked for a **cooking level** (beginner / intermediate / expert) and nothing
consumed it: the AI prompt was driven by a separate `detailLevel`, and the household view only
printed a label. With shopping lists, prices, tickets, the pantry and (soon) household tasks, one
cooking-only question no longer describes the user. The concept moves, it does not disappear.

**Contract**

- `users.cooking_level` gains a fourth value, `none` ("apenas cocino"), as a plain TEXT value with no
  CHECK constraint — so no migration, and old rows keep working. Enums updated in
  `schemas/auth.schema.ts`, `schemas/household.schema.ts` and `utils/taste-profile.ts`, plus the
  `CookingLevel` union and `COOKING_LEVEL_LABELS` on the client.
- `users.preferences` JSON gains `profile.modules: HomeModule[]` with the closed set
  `meals | pantry | shopping | receipts | home`, validated and de-duplicated server-side (unknown
  values dropped, max 8). No new column, same merge rule as `taste`/`onboarding`.
- `GET|PATCH /api/auth/taste` now exchanges `profile: { cookingLevel, modules }` as well: one
  round-trip for the tour and for Preferences, `cooking_level` staying the only source for the level
  (Preferences never replaces the whole preferences blob, so it cannot wipe theme/language).
- **The level has to do something.** `detailLevelForCookingLevel(level)` maps `none|beginner → basic`,
  `intermediate → intermediate`, `expert → expert`. Single and multiple recipe generation always return
  all three instruction variants; this mapping chooses the **initially displayed** variant only when
  the request omits `detailLevel`. An explicit choice from the recipe UI still wins.
- Modules drive what HogarIA highlights (dashboard cards, which sections the tour mentions); the three
  not shipped yet are listed with a _pronto/soon_ mark so the picker is honest about the roadmap.

**Where it lives**

- Signup stops configuring the product: the register form is name, email, password only. It lands in
  the tour, which keeps the level as its **first** step ("Perfil") next to the module picker. The
  original five steps gained the meal-hours step in §12C; the current tour has six steps in total,
  skippable and editable later. Its utensils step links to Pantry rather than mutating inventory in
  the tour, as specified by the parity table in §8c.
- **Preferencias › Perfil** is the section to change it later (first tab, `?tab=profile`), with the
  same controls, the derived AI detail level shown as text, and the standard dirty/discard/save
  behaviour of that page. `detailLevel` itself remains in Settings: the profile only _suggests_ it.

**Acceptance**

- Register → tour step 1 of 6 = Perfil; choosing a level and two modules and finishing persists both
  (`GET /api/auth/taste` returns them) and survives a reload of Preferencias › Perfil.
- `cooking_level = 'none'` is accepted by `/api/auth/profile` and renders as "Apenas cocino" in the
  household member list.
- With `cooking_level = 'beginner'` and no `detailLevel` in the request, the initially selected
  variant is `basic`; with `expert`, it is `expert`; with explicit `detailLevel: 'expert'` and level
  `beginner`, the initial selection is `expert`. Every response still contains all three variants.
- Skipping the tour keeps defaults (`beginner`, no modules) and never blocks the dashboard.

### Checklist for this feature

- [x] Server: `none` in every enum (one definition in `utils/taste-profile`, imported by the auth and
      household schemas), `profile.modules` validated, `profile` in the response,
      `detailLevelForCookingLevel` used by the two AI routes, six unit tests.
- [x] Client: single `home-profile.ts` model (`user.model` and `household.model` re-export the level so
      the three copies cannot drift), shared `app-home-profile-picker`, service patch.
- [x] Signup without the level block (note about what comes next); tour step _Perfil_ first, 5 steps,
      copy and logo about the house, progressive save guarded by the initial load.
- [x] Preferencias › Perfil as the default tab, dirty tracking/save/discard covering the profile.
- [x] e2e re-linked (5 steps, default tab, two tests now explicit about `?tab=allergies`) + the
      profile surviving a reload. Green in CI at `ad0eee4` (Type Check · Server Tests · Build · E2E).

**Contract reconciliation (2026-10-01):** the five-step count above records the original profile
tour before §12C introduced meal hours as a separate step. §12E later fixes the visible counter at
six; current order is `profile, allergies, tastes, goal, meals, kitchen`. §8c remains authoritative
for utensil ownership: the `kitchen` step may link to Pantry › Utensilios, but may not change
`utensils.available` itself.

Note for the icon pass (P0): the new picker uses an inline SVG check and no emoji, while the existing
Preferencias tab strip keeps its emoji labels — they are replaced together with the nav in the sprite
commit, so the tab row stays visually consistent until then. Test hooks are attributes
(`[data-level]`, `label[data-module]`, `input[data-module-input]`), never label copy: hints repeat
words across options and `hasText` already resolved to two elements.

### Recipe generation returns instructions for every detail level

The existing `detailLevel` selection continues to choose the **initially displayed** instructions, not which variant the model generates. The cooking-level mapping in §8b remains the default only when the user has not explicitly chosen a level.

**Contract**

- Single and multiple recipe generation return one complete candidate object per recipe. Shared recipe fields (including ingredients, portions and time) appear once, not once per detail level.
- Every candidate contains `instructionsByLevel` with exactly `basic`, `intermediate` and `expert`. Each value is a complete, ordered, non-empty list of steps appropriate to that level; it is not a partial patch or an abbreviated summary.
- All three variants are produced in the same provider response for each candidate. Changing the level in a generated or saved recipe view changes only which instruction list is rendered: it must not call AI again, alter shared recipe data, create another recipe row, or lose the other variants.
- Saving persists one recipe with its shared fields and all three instruction lists. Loading/reloading preserves them. Older saved recipes with only the legacy `steps` list remain readable; they are not presented as if they had three distinct generated variants.
- The level selector is available in the generated recipe preview and saved recipe view, has an accessible name and keyboard behavior, and uses the existing Spanish/English translations.
- In multiple-generation mode, distinct candidates remain distinct recipes; each candidate independently includes all three instruction lists.

**Acceptance checklist (implemented; synthetic verification complete)**

- [x] Add failing schema/API/frontend model/UI tests for all three complete variants, malformed or missing variants, and one provider call per generated candidate.
- [x] Make single and multiple generation return the shared recipe fields once plus `instructionsByLevel`; keep `detailLevel` only as the initially selected view level, with the §8b cooking-level default when omitted.
- [x] Add the level selector to generated previews and saved recipe views; switching it is local-only, accessible, translated, and does not duplicate a recipe or regenerate.
- [x] Persist and reload all variants in one recipe while preserving existing saved recipes with only `steps`.
- [x] Verify single/multiple success, provider/schema errors, retry, cancellation, save/cancel counts and reload using isolated SQLite plus a loopback synthetic provider; do not use a live provider for repeatable tests.
- [x] Run desktop and mobile Playwright for generated and saved views, keyboard/focus and existing breakpoints; inspect synthetic captures, typecheck/build, focused coverage (≥70% S/B/F/L for instrumentable scope), and diff checks without lowering existing gates.

**Verification evidence (2026-10-04):** focused server tests passed **355/355**; recipe API/schema/form tests passed **327/327**. Focused coverage passed all four metrics: `ai.routes.ts` **84.15/72.89/96.77/83.91%**, generated-recipe schema **100/100/100/100%**, recipe input schema **100/100/100/100%**. The frontend instruction helper passed **3/3** at **100/100/100/100%**. The full recipe-generation Playwright file passed **11/11** on isolated SQLite and a loopback synthetic provider, including desktop, mobile, 320 px and landscape cases, selector keyboard interaction, retry/cancel, save and reload. Synthetic PC/mobile screenshots were inspected. Frontend/server builds, E2E typecheck and `git diff --check` passed. These results do not claim a live-model run; that remains tracked separately in `APP-QA-SPEC.md`.

## 8c. Configuración vs Preferencias: qué se configura donde, y en caliente

Two rules the user set, and they are binding for everything that follows:

1. **Parity**: everything the tour asks must be editable outside the tour. No answer may exist only in
   `/onboarding`.
2. **Modules are an app concern, not a diner concern**: which sections of HogarIA are switched on lives
   in **Configuración** (`/settings`), next to theme and language. Kitchen and body — cooking level,
   allergies, tastes, goal — live in **Preferencias** (`/preferences`).

| Pregunta del tour                      | Dónde se cambia después                                           | Dueño del dato                                                   |
| -------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------- |
| Qué secciones quieres llevar (módulos) | **Configuración › Módulos**                                       | `users.preferences.profile.modules` (flag de la app, por cuenta) |
| Nivel de cocina                        | **Preferencias › Perfil**                                         | `users.cooking_level`                                            |
| Alergias e intolerancias               | Preferencias › Alergias                                           | `preferences.taste.allergies`                                    |
| Gustos y aversiones                    | Preferencias › Gustos                                             | `preferences.taste.likes/dislikes`                               |
| Objetivo                               | Preferencias › Objetivo                                           | `preferences.taste.goal`                                         |
| Con qué utensilios cuentas             | **Despensa › Utensilios** (marcar es editar; el tour solo enlaza) | `utensils.available`                                             |

`app.name` and the header mark are the brand; the preferences section icon stops being a salad bowl
(🥗) because the section is not about food any more: it is the person's profile (👤). Where a section
is a household-wide switch (`theme`, `language`, `modules`) it belongs to Configuración; where it
describes one diner, to Preferencias. If a future question is about the _house_, it gets its own tab
in Configuración, never a new page.

### Activation without reloading

`ModulesService` (`core/services/modules.service.ts`) is the only consumer of `profile.modules`:

- `enabled: computed<HomeModule[]>` — derived from `TasteProfileService`, so a change in Configuración
  re-renders the nav and the section entries immediately. **No reload, no re-navigation, no toast
  required.**
- `available: Record<HomeModule, boolean>` — what this build actually ships. Enabling a module that is
  not available is legal and persisted (that is what _pronto_ means: switch it on today, it appears by
  itself when the build that contains it is activated). Nav shows it only while `!available && enabled`
  as a _pronto_ row, never a 404.
- `visible(path)` — the gate used by the sidebar and the dashboard cards. Rule that keeps the app
  usable: **an empty selection means "everything available"**. Nobody loses `Recetas` or `Despensa`
  because they skipped the tour; a non-empty selection filters.
- Writes go through `TasteProfileService.save` and roll back the optimistic value if the PATCH fails,
  with an error toast; a module can be enabled and disabled repeatedly with no extra request per click
  (the toggle is debounced per module).
- A section that gets switched off while you are inside it stays reachable (the route is not
  unmounted mid-life); the nav entry disappears on the next render. Losing the user's place under
  their feet is worse than a stale entry.

At the time of this original module-picker decision, `shopping`, `receipts` and `home` were deferred.
That availability statement is superseded by the shipped features recorded in later rounds: **the current
build has `meals`, `pantry`, `shopping` and `receipts` available; `home` (housework) remains unavailable**.
The current source of truth is `frontend/src/app/core/modules.registry.ts` (availability and owned routes),
`frontend/src/app/shared/models/home-profile.ts` (picker options) and `frontend/src/app/app.routes.ts`.

## 8d. Rename: the code says HogarIA now

The branding round changed what the user sees; this one changes what the developer sees, in one commit
per surface so a revert is possible:

- npm workspace packages: `frontend` → `@hogaria/web`, `server` → `@hogaria/server`, root
  `recipeapp` → `hogaria`. **Everything that filters by name moves with it**: root `package.json`
  scripts, `.github/workflows/ci.yml` (`pnpm --filter …` × 6), `Makefile`, `Dockerfile`,
  `Dockerfile.dev`, `docker-compose.yml`, `docker-compose.dev.yml`, `playwright.config.ts`,
  `knip` config, `.github/dependabot.yml` directory entries. A `pnpm --filter frontend` that silently
  matches nothing is the failure mode to avoid here.
- Angular workspace: project key `recipeapp` → `hogaria` in `frontend/angular.json` (and `baseHref` /
  output names if present); `ng` invocations do not pass `--project`, so the rename is safe once the
  file is consistent.
- Database: default `DATABASE_PATH` becomes `data/hogaria.sqlite`; on first boot, if the new file is
  absent and a legacy `mi-cocinai.db` / `recipeapp.db` exists, the server **adopts** it (rename, not
  copy) and logs it. Never silently start an empty database under the user's feet. Covered by tests
  (`:memory:`, new file, legacy adoption, missing directory, WAL toggle).
- Strings that still say the old name: `app.name` in both dictionaries, the `logs.component` copy, the
  environment comments, README/SETUP/RUN/SECURITY/PROGRESS/COMPLETED/DESIGN-SYSTEM headings,
  `recipe-app-sdd.md` (kept as history: it gets a banner pointing at `HOGARIA-SPEC.md`, it is not
  rewritten). `storage.service.ts` keeps the literal `recipeapp_` legacy prefix — that is the migration
  path, not the brand.
- Manifest/icon identity: name (done in the branding round), `favicon.ico` **created** (the current
  `<link rel="icon">` points at a file that does not exist in the repo), `apple-touch-icon.png`, and
  the eight PWA sizes regenerated from the new mark.

### Iconography of HogarIA

One mark: **a house with a robot brain inside** — flat, two tones (primary `#F97316`, ink
`#1C1917`), no text, no gradients, readable at 32 px, safe inside a maskable circle (10 % padding on
each side). Deliverables: `icon-512.png` as the source of truth; `convert`-generated 72/96/128/144/
152/192/384; `apple-touch-icon-180.png`; `favicon.ico` (16/32/48); `favicon-32.png`,
`favicon-192.png`; a `maskable` variant with the safe padding; and `icon.svg` for the in-app mark. All
sizes produced in the repo, never at runtime.

## 8e. Shopping list & prices: the mobile interaction contract

The API existed and the module switch did nothing, which is the worst possible state for a feature
flag: it promises a screen that is not there. This section is the contract the UI implements — the
numbers below are not taste, they are the ones the tests assert.

**Routes and shape.** `/shopping` is the tray (create, open, finish, delete; `?tab=hechas` for the
history) and `/shopping/:id` is the list itself. The module registry owns `/shopping`, so switching
the module off removes the link and keeps the route alive (same rule as every other section). Nothing
else lives in the list: no filters stacked on filters, no cards inside a card — the sections of the
supermarket are the only grouping, and `Otros` always lands last.

**Gestures (and their visible twins).**

| Gesture                             | Effect                                      | Twin for anyone who does not swipe |
| ----------------------------------- | ------------------------------------------- | ---------------------------------- |
| swipe left, up to 56 px             | the rail peeks out: `Editar · Quitar`       | the ⋯ button on every row          |
| swipe left past **60 %** of the row | runs `Quitar` on release                    | `Quitar` inside the sheet          |
| swipe right ≥ max(56 px, 35 %)      | `+1` unit                                   | the quantity stepper in the sheet  |
| long press **350 ms**               | multi-select mode with a contextual toolbar | `Seleccionar todo` + tapping rows  |
| tap the row                         | toggles the check                           | the checkbox itself, 30 px         |

Vertical movement wins over horizontal: if the finger goes down the page, that is a scroll and the
row must not move. A tap that followed a long press is swallowed (250 ms window), or every "select"
would also toggle a check.

**Undo.** Anything that removes rows answers with a bottom bar carrying `Deshacer` and a countdown
that drains over exactly `duration` ms (the same number the timer uses, so the bar cannot lie). The
window is **6 s**; the endpoint behind it is `POST …/items/:itemId/restore` — items die with
`deleted_at`, which is why this is cheap. Deleting a _list_ is not undoable (its rows are gone) so it
asks first, through `ConfirmService`, never a native dialog.

**A gesture is not a tap.** Chrome fires a `click` on whatever is under the finger when a drag ends,
so the row that was just swiped would also be toggled, opened or marked. The directive answers with
two mechanisms that are not interchangeable: a `swipeRemove` that _committed_ makes the row deaf to the
pointer for 250 ms (`pointer-events: none`, removed by a timer), and a swipe that only _revealed_ the
rail raises a one-use flag the component's own tap handler consumes. Timers are never the discriminator
— 200 ms and 250 ms windows both lost in CI, because the click can arrive later than the gesture by an
amount that depends on how fast the runner is. A swipe may also start **on** a row button (the far right
is where a thumb grabs): only the checkbox and text inputs carry `data-gesture-stop`, because there the
tap is the whole interaction; a button that opens a sheet keeps its click and gets the guard that the
sheet refuses a row that no longer exists.

**Autosave.** Every field commits **400 ms** after the last keystroke, per row key, and the header
says `Guardando…` / `Guardado`. Writes go through a keyed queue: tapping one checkbox four times is
one intention, not four requests, and `PATCH /lists/:id/items/:id` for the same row replaces the
pending patch instead of stacking. When the network is gone the queue keeps the operation and retries
on `online`; local state stays the visible truth meanwhile. A `409` (`LIST_VERSION_CONFLICT`) never
wins by brute force — the list is re-read and the person is told another device changed it.

**Money.** Cents in the wire, comma-decimal in the keyboard: `1,20` is 1.20 €, `1.290` is 1290 € and
`1.290,50` is 1290.50 €. An empty price is `null` and paints as `—`; `0` is a real, free line. A unit
price above 100 000 € is a slipped finger and gets rejected as invalid input, not stored. A line
stores the price **per unit**, the estimate multiplies by `quantity`, and the footer total is the only
number that ever adds across lines.

### Checklist for this feature

- [x] Tray: create, open, finish (undoable, reopens through the same PATCH), delete (confirmed),
      progress bar and money summary per row, tabs in the URL.
- [x] Detail: add line (`2 Leche`, `1kg Tomates`), paste-a-whole-list sheet (`items/bulk`), pending /
      in-the-cart tabs, category grouping, per-line price chip, estimate with per-line source
      (`manual` / `observed` / `unpriced`) and the count of lines without a price.
- [x] Gestures with the thresholds above, plus multi-select toolbar (marcar, quitar with one undo bar
      that restores every row), `Seleccionar todo`, `Vaciar carro` (undoable).
- [x] Autosave at 400 ms, keyed write queue with retry on `online`, 409 handled by re-reading.
- [x] Toasts gained `action`, `position` and `countdown` (additive; every existing call site untouched).
- [x] `checked` crosses the wire as a boolean and is accepted as `0`/`1` too — the API paints that
      column as an integer, and a client that echoes back what it read must be able to mark a row.
- [x] The undo bar is unconditional on a removal: if the request never made it the bar is still there,
      the restore 404s and the service says so, instead of the person losing a line with no recourse.
- [ ] Drag to reorder (`PUT …/order` exists and is covered by route tests; the UI still orders by
      section + `position`).
- [ ] "What the pantry already covers" reduction and the store switcher inside the cost preview.
- [ ] A price catalogue screen (history per product and store); today prices are read and written only
      through the list and `/complete`.

## 8f. Round 6: the list becomes a tool, and the calendar becomes the house's

Five things asked for, all of them the same complaint seen from different sides: the shopping list
works, but it is not yet _efficient_ on a phone with one hand and it does not exploit the width a
desktop offers. And the calendar is still "the meal plan" when the house has a lot more to put in it.

### Icon button rule (small beats wordy)

`Pendientes (3)` and `Seleccionar todo` as text buttons is what eats a phone: they wrap, they push the
row content, and half the row is left unusable. The rule now:

> **If a control's meaning is a gesture everyone knows, it is an icon, not a word.** 18 px glyph,
> 40 px hit area, `aria-label` + `title` mandatory. If the meaning is _not_ universal (quitar,
> terminar, vaciar carro) the icon travels **with** its word, or the row reveals it in the rail.

Emoji are out for controls: `⋯` and `✎` are typographic, drawn by whatever font the device has, and they
render at three different sizes across Android/iOS/desktop. They are replaced by `app-ui-icon`, a
standalone component with a hand-authored registry of 24×24 `path`s in Material geometry (check,
indeterminate-check, cart, list, pencil, trash, plus, camera, filter, chevron-left/right, close, people,
clock, tag, percent, order). No icon dependency is added — a registry in one file is auditable, offline
and themeable with `currentColor`, and it does not need a network install.

### Renaming a title must not get stuck

The inline rename opened a bare `<input>` with autosave and no way out: Escape did nothing, and a tap
anywhere else left the field on screen mid-row. Inline editing now owns its whole lifecycle:

- ✓ commits, ✕ reverts, `Enter` commits, `Escape` reverts, and blur **commits only if the value is
  dirty** (otherwise it just closes: leaving a field must never invent a write).
- while it is open, the row's gestures are off (`[appSwipeRow]="false"` / the sheet blocks them) — a
  swipe starting inside a text field is selection, not deletion;
- a failed rename rolls the visible name back and says so (the 409 path already re-reads the list).
- the same ✕ is added to the tray's create form, which had "Cancelar" only while the form was open
  by accident after a validation error.

### The tray is a table, with filters and pagination

Desktop `/shopping` shows: name + store, a progress bar with `x/y`, line count, money, last touched,
and who touched it. Sorting is on the header (name / importe / tocada), direction toggles, `?sort=&dir=`.
Filters, all of them **server-side** (`GET /lists?q=&store=&minTotal=&from=&to=&status=&sort=&dir=&limit=&offset=`
answering `{ data, page: { total, limit, offset } }`):

| Filtro                  | Control                                                 | URL            |
| ----------------------- | ------------------------------------------------------- | -------------- |
| Texto en nombre o línea | input con ✕ para limpiar                                | `q`            |
| Supermercado (local)    | `app-ui-dropdown` de los que existen en datos           | `store`        |
| Importe mínimo          | input de €. Mismo parser de dinero que una línea        | `min`          |
| Toca/hasta              | dos `input type=date`                                   | `from`, `to`   |
| Estado                  | tabs Activas / Terminadas (ya existía)                  | `tab`          |
| Página y tamaño         | ‹ › + 10/20/50, el tamaño se recuerda en `localStorage` | `page`, `size` |

On a phone the filter row collapses to one `Filtros` icon button with a count badge, opening a sheet
with the same controls and `Aplicar` / `Borrar todo`. Nothing lives twice: the URL is the state, the
sheet writes to it, the server reads from it. Filtering server-side is not a purity thing — a house with
90 archived lists must not download 90 lists to hide 89.

### Units are picked, not typed

`kg`, `u`, `ud`, `1`, `pac` typed free is how a list ends up grouping the same thing three ways.
`app-unit-picker` is a themed combobox (not a native `select`, which cannot carry the theme): grouped
catalogue (**peso** g/kg, **volumen** ml/l, **unidad** u/paquete/caja/lata/botella/docena/medias…), search
as you type, `↑↓ Enter Esc`, `role="combobox"` + `aria-expanded` + `aria-activedescendant`, an
`Otra…` escape hatch that keeps the free text (the catalogue is a convenience, never a cage) and the 6
last used units pinned on top from `localStorage`. The catalogue lives in one file
(`shared/models/units.ts`) and is used by the add-line parser, the edit sheet, the paste sheet and the
photo review sheet, so a unit is spelled the same place everywhere.

### Discounts and offers, Basketra-style

One `Descuentos` section per list, collapsed by default, with a header chip stating what is applied
(`-5 %` / `-2,00 €` / `3×2 en 2 líneas`). Two kinds, because they are two different real things:

- **Offer on a line** — `buy`/`take` (3×2, 2×1, or custom). Paid units are
  `payable = floor(qty / buy) * take + min(qty % buy, take)`. Five units of a 3×2 pay four: one full
  pack of three costs two, and the two leftovers are still two. The row's chip shows the offer next to the price (`6,50 €/ud · 3×2`).
- **Discount on the list** — `amount` (cents) or `percent` (basis points, so 12,5 % is 1250, never a
  float), and `appliesTo`: `all`, or `upToQuantity` with a unit cap ("2 € de descuento en las primeras
  3 unidades"). The cap consumes paid units in `position` order, which is what a cashier does.

`/estimate` grows a `discount` block: `subtotalMinor` (as today), `offerSavingsMinor`, `discountMinor`,
`totalMinor`. Rounding is half-up on cents at the **total**, never per line (per line it would leak a
cent and make the sum disagree with the visible numbers). A total can never go below 0 and a discount
above the subtotal is clamped and _says so_ in the UI instead of silently eating the difference. Money
rules from §8e hold: cents on the wire, comma decimal on the keyboard.

### Adding by photo, with the AI as the clerk

Two calls, on purpose — a model that misreads must not silently rewrite the list:

1. `POST /lists/:id/photo/analyze` with `{ image: <dataURL>, mode: 'auto'|'ticket'|'shelf', note? }`.
   The server builds the prompt with (a) the **category catalogue as JSON** — `[{ "name", "color" }]`
   from the household's own categories, colours included so the model can echo one it recognised — and
   (b) the **expected response shape**, spelled out literally, plus the money and unit rules. It calls
   the active `ai_configs` row (the same `base_url`/`api_key`/`model`/`timeout` the recipe generator
   uses, now extracted to `utils/ai-client.ts` so there is exactly one place that talks to a provider)
   and **validates the answer with zod** (`photoLinesSchema`). It writes nothing and returns the lines
   with a `confidence` each.
2. `POST /lists/:id/items/apply` — what the person confirmed, line by line (edit, drop, keep),
   `category` included; `createCategory: true` is what adds a category with the colour the model
   proposed. Reuses the merge-by-`product_key` behaviour of `POST /items`, so a photo of a shelf does not
   duplicate the milk that is already pending.

Errors are specific because the user has to act on them: no active AI config → `409` with
`data.redirect = '/ai-config'`; a reply that is not JSON → `422` with the model's first 200 characters
(for the log section, not for the toast); image too big → `413`; a line the model invented a price for
with no digits → it arrives with `priceMinor: null` and lands in "sin precio", which is honest.

### Live for the household, and who touched what

- `shopping_list_items.added_by` / `.updated_by`, `shopping_lists.updated_by`, and
  `shopping_list_events (list_id, user_id, user_name, action, item_name, created_at)` written on every
  mutation — the audit trail is a table, not a log line: "quién ha añadido qué" has to be queryable per
  list and readable a month later.
- `GET /lists/:id/events?limit=` feeds a "Quién ha tocado qué" sheet.
- **SSE** `GET /api/shopping/stream/:listId` broadcasts `{ type: 'items' | 'list', by, at }` to the rest
  of the household; the client **refetches** on a message instead of trusting the payload, so a missed
  event costs a stale row until the next write, never a wrong list. `EventSource` cannot set headers, so
  the stream accepts `?access_token=`, the auth middleware allows it **only** on that GET, and the
  request logger masks it — a token in a URL is a token in a log file otherwise.

### The calendar is the house's

`calendar_events (id, household_id, user_id, title, kind, date, start_time, end_time, all_day, color,
notes, source, source_id, created_at, updated_at)` with `kind ∈ meal | shopping | home | appointment |
personal | other`, CRUD on `/api/calendar/events`, and meals projected as `kind: 'meal'` (source
`meal`, `source_id`) so the plan that already exists shows up without duplicating a row per meal.

The existing month/week/day views keep their structure and gain: a **kind filter row** (chips with the
event colour, `?kinds=meal,home`, empty = everything), a `Hoy` button, `‹ ›` around the range title, and
in month cells the pills overflow into `+2 más` with the hidden ones listed on click. Events are
household-visible by default (that is the point of a house calendar) and per-member ownership is kept on
the row, painted as the author's initial in week/day views.

Recurrence, availability, ICS sync and "who cooks" stay in §13 — this round makes the calendar _general_,
not a scheduler.

## 9. Data model additions

New tables (SQLite, `PRAGMA foreign_keys = ON`, WAL, busy timeout, indexes on every FK and date):

`retailers`, `stores` (with optional lat/lon and `source`), `canonical_products`, `product_variants`,
`product_aliases`, `categories` (self-referencing `parent_id`, `color`, fallback `category_unknown`),
`retailer_listings`, `price_observations`, `external_evidence`, `receipts`, `receipt_captures`,
`receipt_extractions`, `receipt_items`, `receipt_corrections`, `shopping_lists`, `shopping_list_items`,
`optimization_runs`, `optimization_plans`, `optimization_plan_items`, `runtime_settings`, `ai_jobs`,
`sync_conflicts`.

Existing tables are extended, not replaced: `ingredients` gains `expiry_source`, `receipt_item_id`,
`list_item_id` and `store_id`; `recipes` gain `estimated_cost_minor` (derived, cached with the
observation ids used); `meals` may link a `receipt_item_id` for "we ate this, it cost X". Money
columns are `INTEGER` cents, `CHECK (col >= 0)`. Timestamps are ISO-8601 TEXT. Migrations are
numbered, additive, never rewritten, and each ships with a "migrate an old DB, assert data survives"
test — the same discipline used for `weekly_calendars.household_id`.

## 10. Backend/API surface

Hono routers, `authMiddleware` on all of them, `{ success, data }` envelope (existing convention):

```
GET|PUT   /api/settings                      runtime settings (public projection) / patch
GET|POST  /api/ai/jobs · GET|DELETE /api/ai/jobs/:id · POST /api/ai/jobs/recover
POST      /api/ai/test                       provider probe (configured|unreachable|unauthorized|slow|ok)
GET       /api/shopping-lists · POST          create
GET|PATCH|DELETE /api/shopping-lists/:id      version/CAS
POST      /api/shopping-lists/:id/items · PATCH|DELETE /items/:itemId
PUT       /api/shopping-lists/:id/order       full order, guarded by list version
PUT       /api/shopping-lists/:id/store       store selection for the estimate
GET       /api/shopping-lists/:id/estimate    per-line + totals + unpriced reasons
POST      /api/shopping-lists/:id/items/bulk  pantry-aware paste/split
GET|POST  /api/products · /api/products/suggestions · /api/products/photo-proposal
GET|POST  /api/categories · /api/categories/suggest · PATCH /api/categories/:id
GET|POST  /api/stores/suggestions · /api/stores/nearby (Overpass, opt-in, bounded, cancellable)
GET|POST  /api/retailers/suggestions
POST      /api/receipts/extract · /api/receipts/validate · /api/receipts/confirm
POST      /api/files · GET /api/files/:id     evidence store (validated type/size/signature)
POST      /api/optimization-runs
GET       /api/realtime                       SSE invalidations
GET       /api/meta · /health · /readiness
```

Every list endpoint: `limit`/`offset` or cursor `page`, `sort`, `q`, and entity filters; unknown or
out-of-range values are clamped, never forwarded. Writes accept only allowlisted fields (the schema
layer already does this with zod) and every enum is validated before it reaches SQL.

## 11. Tests

- **Unit** (`src/domain` equivalents): money parse/format round-trip incl. `es-ES` separators,
  fraction reduction, matching priority order, estimate (priced/unpriced/no-store), plan selection,
  CAS 409, outbox replay/idempotency, redaction, log event size cap.
- **Server integration** (vitest, `DATABASE_PATH=':memory:'`): migration from the pre-absorption
  schema keeps data; receipt confirm writes observations + pantry stock + expiry; queue sweeps
  interrupted jobs; `PUT /api/settings` masks secrets and enforces ranges.
- **E2E** (Playwright, chromium in CI): list CRUD offline→sync, swipe toggle, cost preview shows a
  partial total with reasons, receipt review rows edit and confirm into the pantry, Settings tabs
  persist and mask, Support section copies a redacted report, PWA shell loads with the network
  offline. Assertions use ids/hrefs, never translated text.
- **CI**: Type Check · Server Tests · Production Build · E2E stay green on every push; a phase is not
  done while the suite is red.

## 11d. CI: a five-minute budget, and no silence

Two rules, and the second one only exists because of how the first was broken once.

**Budget.** No job may run over five minutes, so the work that is not testing happens once:
`install` runs `pnpm install --frozen-lockfile` plus `playwright install --with-deps chromium` and
_publishes_ `node_modules` and `~/.cache/ms-playwright` through `actions/cache/save@v4`. Every other
job restores those keys and only falls back to installing when the restore missed (`if:
steps.nm.outputs.cache-hit != 'true'`). The key carries `hashFiles('pnpm-lock.yaml')`,
`github.run_id` and `github.run_attempt`, so a cache is never reused across commits and a retry never
poisons the next run. The e2e suite runs as four shards (`--shard=i/4`) with two workers each — the
count is hardcoded in the matrix, see below — and the dev-server cold compile is paid once in
`globalSetup`, not per test. Per-test timeout is 90 s in CI: 120 s turned five real failures into
sixty-nine waiting ones.

**No silence.** A workflow file GitHub cannot _validate_ does not fail red: it produces a 0-second run
named after the file path and **no checks on the pull request at all**. That is how a broken CI passed
for several pushes. `make ci:yaml` (`scripts/check-workflows.mjs`, dependency-free) is the guard, and
it checks the three things that actually hurt:

- an unquoted scalar containing `: ` (YAML opens a map there and the whole file dies);
- tabs;
- expressions whose context does not exist where they were written — `runner.*` and `hashFiles()` in
  the workflow-level `env:` (they are only available inside a job, e.g. in a step's `with:`), and
  `strategy.*` in a job `name:` (use `matrix.<key>`; the shard total lives in the matrix, so it is
  written where it is decided).

**A failure has to be readable to count as a failure.** On `failure()` the e2e job uploads
`test-results/` (trace plus `error-context.md`), but the artifact store is not reachable from every
environment — `gh run download` against the blob endpoint dies with an EOF that no retry fixes. The
channel that always arrives is the annotation the reporter publishes, so a gesture test puts its
evidence _inside the assertion message_: the row's text, the visible toasts, the last handful of
`/api/shopping` responses and any `pageerror` Angular threw. That is what turned three
«element(s) not found» into one sentence: a `PATCH` where a `DELETE` belonged.

**Backticks do not belong inside a SQL or `styles:` template literal.** A comment written with
`` `column` `` inside `db.exec(`…`)` (or an Angular `styles: [`…`]`) terminates the string, and what
comes back is either a `TS1005 ',' expected` in a file that looks untouched or
`Failed to resolve styles at position 1` from the Angular compiler. It has bitten three times in this
repo; the rule is to write comments in SQL and in `styles` without a single backtick.

One more inherited trap, same family: with `"packageManager": "pnpm@10.15.0"` in `package.json`,
passing `version:` to `pnpm/action-setup@v4` is an input error — the version is written once, in the
manifest.

## 12. Checklist

Every box is a PR-sized commit. `[x]` only when its tests are green in CI.

### P0 · Groundwork, branding, foundations

- [ ] Spec committed and PR updated (this document).
- [x] Branding rename: `appName`, `index.html` (title, description, apple/application name),
      `manifest.json` (name, id, description, shortcuts), auth layout title, global stylesheet header,
      README heading + alias note, `frontend/package.json` 1.1.0.
- [x] `hogar:v1:*` storage keys with a one-shot read-migrate from the legacy bare keys
      (`auth_token`, `refresh_token`, `current_user`, `theme`, `language`) and from `recipeapp_*`;
      migration keeps the originals for rollback and does not silently log users out. An explicit
      logout deletes both namespaced and legacy auth credentials (including `recipeapp_*` aliases)
      so the next boot cannot restore the session; legacy preferences remain untouched.
- [x] PWA wired: `frontend/ngsw-config.json` (shell prefetch: `index.html`, `manifest.json`,
      `favicon.ico`, `*.css`, `*.js`; assets lazy/prefetch-on-update; `freshness` for
      `/api/health` + `/api/preferences`), `"serviceWorker": "ngsw-config.json"` in the production
      configuration, `index.csr.html` excluded (this build has no SSR). Verified in `dist/browser`:
      `ngsw-worker.js` + `ngsw.json` with 61 hashed entries, and the `provideServiceWorker` call that
      already existed now has a worker to register.
- [ ] `LogService` is the only funnel: levels, stamp, redaction, size cap, localStorage ring,
      `window.onerror`/`unhandledrejection` bridge, batched POST to `/api/logs`.
- [ ] Log viewer: level + source filters, only-errors, pause, expandable payload, saved view.
- [ ] New **Support** section (`/report`): generated markdown report, _Open issue_, _Copy to
      clipboard_ fallback, redaction assertion in tests, nav entry, tabs in URL.
- [ ] `SwUpdate` prompt with _Activate now_ + Settings auto-activate toggle (delivered with the
      Support section, next commit).
- [ ] `GET /api/meta` (version, build, serverTime, ready, cacheName) + About card showing
      version/uptime, no per-second polling.
- [ ] Rename the Angular project key `recipeapp` (and `defaultProject`) together with the workspace
      package names — one commit, because `ng` invocations in CI and the Makefile depend on it.
- [ ] App-wide icon sprite + first pass of SVG icons replacing emoji in the nav.
- [ ] Animation tokens documented and a `from`/`to`-only lint note in DESIGN-SYSTEM.md.

### P1 · Runtime configuration (no env)

- [ ] `runtime_settings` table + typed defaults + validators + `runtime_settings.spec.ts`.
- [ ] `GET|PUT /api/settings` with masked secrets, `configured` flags, `restartRequired` state.
- [ ] Server reads nothing but `DATABASE_PATH`; every other `process.env` reference removed.
- [ ] Rate limiter, CORS, bcrypt rounds, JWT lifetimes, memory monitor, DB pragmas, AI timeout and
      retries driven by the stored row (live where safe, next-boot where not).
- [ ] e2e: `globalSetup` disables the limiter through the API instead of `DISABLE_RATE_LIMIT` env.
- [ ] Settings section, tab **App**: identity, cache/version, feature flags, limits; tab **AI**:
      base URL, key (write-only), model, timeout, retries, queue concurrency; **Test connection**
      with the six states (absent, loopback-in-docker, unreachable, unauthorized, slow, ok).
- [ ] `ai_configs` (existing) folded into the same UI or explicitly retired in favour of
      `runtime_settings` — decision recorded here, then executed.

### P2 · Catalog, prices, stores

- [ ] Migrations for retailers/stores/canonical_products/variants/aliases/categories/
      retailer_listings/price_observations/external_evidence.
- [ ] Repositories + routes; FTS5 search for products, hierarchy-aware category list with the
      `category_unknown` fallback, immutable observation writes.
- [ ] `src/domain/money.ts` (cents + fractions + `es-ES` formatting) shared by client and server.
- [ ] Catalog section: tabs (Products · Categories · Stores), search, filters, pagination, row
      actions; product detail as a bottom sheet with editable metadata (name, brand, EAN, package,
      aliases, category).
- [ ] Prices section: per-product history table, delta vs previous, evidence thumbnail, "correct
      price" = new observation, chart in CSS only (no chart library).
- [ ] Quick capture (photo → proposal → preview → confirm) with no persistence before confirm.
- [ ] Nearby stores via Overpass: opt-in button only, bounded, cancellable, OpenStreetMap
      attribution, nothing persisted until confirmed.

### P3 · Shopping lists

- [x] `shopping_lists` / `shopping_list_items` with `version`, `completed`, `completed_at`,
      `quantity` fraction, `unit` — plus `product_key` for merging lines and a soft `deleted_at` that
      is what makes "Undo" a call and not a resurrection. (`exact|substitutable` and the variant link
      wait for the catalogue in P2.)
- [x] List management view (all lists, create/rename/delete, useful summary) separate from the list
      detail (pending first, completed secondary, grouped by supermarket section) — see §8e.
- [x] Add/edit sheet with progressive disclosure; the sheet saves as you type (400 ms) and the row
      never shows a "Guardar" button. Transactional full-order writes exist on the server
      (`PUT …/order` + `version`); the drag that drives them is still open.
- [x] Swipe gestures + Undo, with button equivalents and confirmation on button-delete (§8e).
- [x] Autosave, keyed write queue with retry on `online`, stale-edit 409 that re-reads instead of
      winning. Realtime invalidation (SSE) is not wired: a second device converges on the next load.
- [ ] Cost preview per list: totals, per-line prices and unpriced reasons are shipped; the store
      switcher and the "what the pantry already covers" reduction are not.

### P4 · Receipts, OCR and the queue

- [ ] `ai_jobs` + durable runner (lease, attempts, startup sweep) + REST + SSE progress.
- [ ] `receipts*` tables and the evidence file store (type/size/signature validation).
- [ ] OCR provider abstraction, ephemeral, Spanish; failure keeps the draft and says so.
- [ ] `POST /api/receipts/extract|validate|confirm` with idempotent confirm and arithmetic re-check.
- [ ] Review UI: editable rows (description, qty, unit, unit price, total in euros, expiry), add and
      remove rows, thumbnails per capture, PDF fallback text, undo-friendly.
- [ ] Ticket header: store, payment status/method, notes, taxes, discount — all optional, validated.
- [ ] Confirm projects lines to catalog + price observations (with the ticket's `store_id`) **and**
      into the pantry with `expiration_date`.
- [ ] History section (`ticket-history`): list of tickets with filters (store, period, amount),
      detail with evidence, "re-open for review" without losing corrections.

### P5 · Joint features (the reason to merge)

- [ ] Dish cost: recipe/plan line shows `≈ 3,40 €` from ingredient prices, with the observation dates
      used on hover; never presented as a quote.
- [ ] "Add missing ingredients to the shopping list" from a recipe, a planned meal, or the whole
      week's plan; pantry covers subtract, prices attach when known.
- [ ] Expiry pressure: planner prefers ingredients expiring sooner; "eat this today" chip in Today.
- [ ] "Bought from receipt" marks planned meals and links the evidence.
- [ ] Today: expiring within N days (N in Settings), open list totals vs weekly budget, next planned
      meal, pending AI jobs with a jump into the queue view.
- [ ] Queue view: running/queued/failed with retry, filters and pagination.

### P6 · Offline, sync, resilience

- [ ] localStorage cache layer with budgets, eviction rules and quota warnings.
- [ ] Outbox: enqueue on mutation, flush on online/visibility/timer, keep-until-acked, idempotency
      keys, no overlapping sends per entity.
- [ ] Conflict surfacing (409) with "mine / theirs" resolution UI.
- [ ] `sync_conflicts` audit rows for post-mortems.
- [ ] Adaptive heartbeat (15 s healthy, 2 s disconnected, 4 s timeout, none while hidden) and a
      visible connection chip that recovers without a reload.
- [ ] Read-only offline modes for every section, with the "pending sync" badge.

### P7 · Hardening and polish

- [ ] Log rotation server-side with the same caps as the client; retention from Settings.
- [ ] Redaction tests for both sides; no secret in any log, URL or error payload.
- [ ] Accessibility pass: focus order in sheets, `aria-current`, gesture equivalents, contrast in the
      dark theme, 44 px targets.
- [ ] i18n completion for every new string (`es` + `en`), no test asserting translated text.
- [ ] Empty/loading/error states per section (calendar pattern), skeletons only on first load.
- [ ] Budgets: per-chunk size limits in `angular.json`, lazy sections, no new runtime dependency
      without a recorded reason.
- [ ] Docs: `SETUP.md` (no env section), `RUN.md`, `SECURITY.md` (secrets, access boundary),
      `CHANGELOG.md`.

### P8 · Rename completion

- [ ] Workspace package names + every `pnpm --filter`, script, Dockerfile, Makefile and workflow
      updated in one commit.
- [ ] `data/hogaria.sqlite` default with adoption of the previous file.
- [ ] Repo renamed by the human; `supportRepoUrl` verified; CI re-verified green.

## 11b. Test reporting: see everything, like vitest

`playwright.config.ts` uses a project reporter, `tools/reporters/hogaria-reporter.mjs`, that prints
what jest/vitest print and what `list` leaves out:

- **Run header**: seed, workers, projects, `--grep`, total tests, and the rerun command for failures.
- **One line per test**, tree-shaped on the `describe` path:
  `✓ Preferencias › el perfil del hogar se cambia aquí (2.4s)` — status glyph, title path, duration,
  `[project]` when several run, `(retried ×1)` when it took a retry, and the test's **data seed**
  (the e2e users are generated: `e2e-<seed>-<slug>@example.com`) so a run can be traced back to its
  rows. The seed is `E2E_SEED` when set (CI pins it per run) and `Date.now().toString(36)` otherwise;
  it is also written to `test-results/hogaria-run.json` with the counts.
- **Failure concentration before the summary** (the part that saves scrolling): for each failed test —
  title path, `file:line`, the assertion that broke with expected vs received, the first frame of the
  stack, the page URL and the actions of the last 5 seconds from the trace/attachment, plus the video
  and screenshot paths. Then the counts.
- **Summary**: passed / failed / flaky / skipped, total wall time, and the five slowest tests, so a
  regression in duration is visible without opening the HTML report.
- Kept: `html` (open: never in CI), `json` for `scripts/ci-e2e-summary.mjs` (annotations), `junit` for
  anyone who wants the XML. `list` is dropped because this reporter supersedes it.
- `globalSetup` writes the seed into `process.env` before the web server starts so backend logs of the
  same run can be grepped by it.

E2E ambition: every user-visible behaviour gets a test in the suite that owns it (the calendar, tab
URL and confirm-dialog specs are the model: flow + persistence + a11y hooks + the empty/loading/error
state). The suite runs on `chromium` in CI for wall-time reasons; all three projects run locally and in
`workflow_dispatch`.

## 11c. Coverage: a floor, not a poster

- Server (vitest + v8): `statements/branches/functions/lines ≥ 70` **per file** and ≥ 80 globally,
  with the `text`, `html`, `lcov` and `json-summary` reporters, so `server/coverage/index.html` is the
  visualization and the CI `Server Tests` job runs `test:coverage` and uploads the report as an
  artifact. The instrumentation ramp is honest: files enter `coverage.include` when they get a spec,
  and thresholds **never go down**; `database.ts`, `memory-monitor.ts` and `seed-data.ts` get the tests
  they need to clear the floor instead of being excluded.
- New pure code (models, mappers, the modules service, the reporter helpers) is expected at **100 %**
  of its statements and branches — including the edges: unknown module ids, malformed persisted JSON,
  PATCH failure rollback, double toggle, `:memory:` vs file, legacy database adoption.
- Frontend unit tests run in a non-blocking CI job (`continue-on-error`) until the suite is trustworthy
  in CI; UI coverage continues to be enforced where it is real: the Playwright suite. Flipping the FE
  job to blocking is a P7 item, with its own coverage thresholds in `karma.conf`.
- `pnpm test:coverage` is the one command for both; `pnpm --filter @hogaria/server run test:coverage`
  prints the table.

## 12b. Checklist for this round

- [x] Spec: this text (parity table, sections, live activation, rename, icons, reporter, coverage).
- [x] `ModulesService` + `home-profile` model at 100 % coverage, unit tests with the edges above
      (16 tests: optimistic toggle, rollback + `MODULE_SAVE_FAILED`, _pronto_ not linked, `canSwitchOff`,
      `resetSelection`, registry consistency).
- [x] Configuración: **Módulos** section (available on/off, _pronto_ ones pre-enableable, live nav);
      Preferencias › Perfil keeps only the cooking level; preferences icon → 👤; `.settings-group`
      count and the section i18n updated (6 keys × 2 languages).
- [x] `tools/reporters/hogaria-e2e-reporter.js` + `E2E_SEED` plumbing + reporter list in the config; run
      header, per-test lines, failure concentration, summary, `test-results/hogaria-run.json`.
      Shipped as **CommonJS**, not `.mjs`: Playwright `require`s reporter files and the repo has no
      `"type": "module"`; an ESM reporter would need a build step for one file.
- [x] Coverage: `perFile: true` at 70 % for the four metrics (a per-file floor _implies_ the global one,
      and it is the one that was hiding `database.ts` at 41 % of branches); reporters text+html+lcov+
      json-summary; CI runs `test:coverage` and uploads `server/coverage/` even when the gate fails; the
      three files under the floor got tests instead of an exclusion (memory-monitor 100 %, seed-data 100/96,
      database 73 with the adoption tests). The include list is a ramp and says who is missing and when.
- [x] Rename: workspace packages (`@hogaria/web`, `@hogaria/server`, root `hogaria`) + every `--filter`
      (root scripts, CI, Makefile), Angular project key `hogaria`, `DATABASE_PATH` default
      `data/hogaria.sqlite` with legacy adoption (7 tests on a tmpdir), i18n brand strings, docs headings,
      container names, Dockerfile/compose/`.npmrc`/dependabot headers, setup and start banners.
      Left on purpose: the GitHub repo name and the `recipeapp_` localStorage key.
- [x] Icons: generated mark (`design/hogaria-icon-source.png` + `design/README.md` with the exact
      derivation), all PWA sizes really at their size, `favicon.ico` (was a declared 404), `apple-touch-icon`,
      maskable variant at 80 %, `purpose: any|maskable` split, `index.html` links, dead `shortcuts`/
      `screenshots` references removed. **`icon.svg` is not wired**: without `potrace`/`inkscape` in the
      project, a hand-made SVG would be a second, almost-but-not-quite logo; that is now a Coming-soon item.
- [x] e2e: modules toggle visible in the nav without reload; pre-enabling a _pronto_ module persists
      and does not create a route; the Configuración tabs travel in the URL; the tour's parity
      assertions (each answer readable in its section). New `tests/e2e/pwa-assets.spec.ts` also asserts that
      every declared manifest icon is served **and** that its PNG measures what `sizes` claims.
- [x] PR body and `PROGRESS.md` updated; nothing merged.

## 12c. Checklist for round 5 — the list, on a phone

- [x] `shopping.model.ts`: the two money conversions as pure functions (`parseMoneyToMinor` handles
      `1,20` / `1.290` / `1.290,50` / `3,999` → 4,00 and returns `null` instead of guessing), category
      grouping with `Otros` last, `formatQuantity` that stays silent on a single unit. Verified with a
      20-case table before anything touched the DOM.
- [x] `ShoppingService`: signals per screen, optimistic toggle/+1/patch, keyed retry queue flushed on
      `online`, 409 → re-read the list and say so, and one endpoint shape copied from the server rather
      than invented (`items/bulk` takes `lines`, `order` takes `itemIds` + `version`, PATCH a list takes
      `version`, `GET /lists/:id` returns the list **with** its items inline).
- [x] `SwipeRowDirective` + `LongPressDirective` with the thresholds exported as constants and the
      geometry as pure functions (`swipeState`, `isQuickPlus`) so the 56 px / 60 % / 350 ms contract is
      testable without a finger.
- [x] Tray and detail screens (§8e checklists), including the paste-a-list sheet and the estimate
      breakdown with the source of every price.
- [x] Toasts grew `action` + `countdown` + `position`; the countdown bar animates over the same
      `duration` the dismissal timer uses, and the bottom stack is where an `Deshacer` lives.
- [x] Module flipped to available with its real path, navigation entry (sidebar and bottom bar), i18n
      keys for both languages, and the e2e that used `shopping` as the _pronto_ example moved to
      `receipts` so the "activating what does not exist" rule keeps being tested.
- [x] `tests/e2e/shopping-lists.spec.ts`: 14 cases × 3 projects driving real pointer drags (reveal,
      commit-at-60 %, +1 to the right, long press into multi-select) and the undo bar.
- [x] Coverage ramp: the three shopping server files moved into `COVERED` (they were already above the
      floor); the frontend got its pure logic under `frontend/src/app/shared/**` specs.
- [ ] Not in this round: SSE invalidation, drag-to-reorder UI, price catalogue, receipts/OCR.
- [x] CI: the workflow file was invalid since the cache/shard round (expressions in the workflow-level
      `env`), which is why no check appeared on the PR. Fixed, and `make ci:yaml` now refuses that class
      of mistake instead of trusting a red job to show up. See §11d.
- [x] Three rounds of CI to make the gestures honest, all of them real bugs the tests found: the residual
      `click` after a swipe (200 ms windows lost to a slow runner → one-use flag + 250 ms deaf row), the
      ⋯ vetoing a swipe that started on it (which is where a thumb starts), and `remove()` deciding
      whether the undo bar appeared from a response that had not arrived yet.
- [x] `booleanish` now accepts the `0`/`1` the API itself prints. Marking a checkbox was silently
      un-persisting itself since the feature was born: `checked: 1` fell outside the union, zod answered
      400, the optimistic tick flipped back on the next read, and `Vaciar carro` found nothing to
      remove. Route test covers both spellings and refuses `2`.
- [x] Budget holds: install 58s · server 14s · typecheck 28s · build 35s · e2e shards 1m29s / 1m44s /
      1m11s / 2m0s — 381 Playwright tests (14 of them shopping) in four parallel jobs, every one under
      five minutes.

## 12d. Round 6 checklist — the list becomes a tool

Same rule as every other box: `[x]` only when its tests are green in CI, and the first commit of the
round is this checklist. What changed while building it is written next to the box, not hidden: the
spec is the record, including of where reality disagreed with it.

- [x] `app-ui-icon` (`ui/icon/icon-paths.ts` + `IconComponent`): 68 Material _baseline_ glyphs as path
      data in TS, `currentColor`, generated by `scripts/icons.mjs` from `@material-icons/svg` and it
      refuses to write an empty file. `name` is a _type_, so a wrong icon name does not compile. No new
      runtime dependency, no font, nothing to fetch — which is what makes it survive offline. Detail
      tabs, `Seleccionar todo`, `⋯`, `✎`, the back arrow, the pending/cart mark and every tray action
      are icons now, inside `app-icon-button` (32/40/48 px hit area, `:active` scale, `aria-label` +
      `<title>` from the same `label`).
- [x] Inline rename owns its lifecycle: ✓ and ✕ buttons, Enter commits, Escape cancels _and undoes the
      auto-saved text_, blur commits only when dirty. Detail header and tray rows. The tray no longer
      has a swipe rail (its two actions are the icons in the row), so there is no gesture to suppress
      there; in the detail, gestures live on the row face and never on the title.
- [x] Custom picker, not a native `select`: `app-picker` — colour per option, type-to-filter above 8
      options, `allowCustom` so a unit that is not in the catalogue is a value and not a lost keystroke,
      listbox/option roles with `aria-selected`, arrows/Enter/Escape/Home/End, click-outside, and the
      trigger always showing what is inside. Used by units (15 formats), sections, photo mode, page size
      and the tray filters. _Not_ `shared/models/units.ts` with recents: the catalogue lives with the
      screen that owns it and recents went to §13 — a `localStorage` list of units is a guess about how
      people shop that we have not earned yet.
- [x] Tray as a table: Lista / Tienda / Progreso / Total / Actualizado / acciones, header sorting with
      `aria-sort`, filters (text across lists _and_ items, store, importe ≥, desde/hasta, estado) and
      10/25/50 pagination **all in the URL**, resolved in SQL with `COUNT(*) OVER ()` for the total; the
      `Filtros` button carries an active-count badge and the whole row reflows into a two-line card below
      720 px with `data-label` as the inline caption.
- [x] Money: `promo_buy`/`promo_take` per line, one list discount per list (`kind: 'amount'|'percent'`,
      `scope: 'all'|'firstUnits'` + `first_units`, `label`), the payable-unit maths in `utils/list-discount.ts`
      as pure functions, `discount` + per-line share in `/estimate`, half-up on the total and largest
      remainder for the split, clamp at 0 with `reason: 'clampedToZero'` said out loud. Naming debt: this
      spec said `appliesTo: 'upToQuantity'`; the code is `scope: 'firstUnits'` because `scope` is what the
      items PATCH already used for "que se aplica a", and `firstUnits` says what the number counts.
- [x] Photo ingestion: `POST /lists/:id/photo/analyze` (prompt carries the household catalogue as JSON —
      name _and_ colour — and the exact reply shape; `photoLinesSchema` validates; cents in `priceMinor`;
      "no inventes precios"; nothing is written) → review sheet (checkbox per line, editable name/qty/price,
      proposed section, `baja confianza`, warnings) → `POST /lists/:id/items/apply` (creates the category
      when the model asks, merges through the same rule as a manual add). Four errors with four answers:
      409 + `data.redirect: /ai-config`, 422 + `sample` (and the sample is forwarded to the log viewer),
      422 + zod issues, 400/413 for the file itself.
- [x] Categories as data: `shopping_categories` (name, `key`, colour, position) seeded from what the UI had
      hard-coded, `GET/POST /categories`, household-wide once it exists, colour painted on the group headers,
      the chips, the picker and the photo review. `utils/photo-prompt.spec.ts` asserts that the example shown
      to the model _parses with the schema that validates the answer_.
- [x] Live + authorship: `added_by`/`updated_by` (a merge paints who merged), `shopping_list_events` +
      `describeEvent` (the sentence is the server's), `GET /lists/:id/events`, SSE `GET /api/shopping/stream/
lists/:id` and `/stream/tray` with `?access_token=` accepted _only_ there and masked in the log, 15 s
      heartbeats, cap of 24 listeners with eviction; the client refetches on invalidation (it never paints
      the payload), the row shows the author's initials with the name in the tooltip, and "Quién ha tocado
      qué" is a sheet with avatars.
- [x] General calendar: `calendar_events` + CRUD, `kind` per suelta, `sharedWithHousehold` (only the author
      edits or deletes, and the read says `editable`), `allDay` clearing the times, meals **projected as a
      layer and not as rows** — `kind: 'meal'` is rejected by the POST with `MEAL_COMES_FROM_THE_PLAN`, so the
      weekly plan stays the only owner of what we eat; layer chips (Comidas + 5 kinds) with the kind colour,
      in the URL as `?layers=`, `Hoy` and ‹ › with the range title, `+n más` overflow in month cells, and an
      agenda strip under the grid for the anchored day.
- [ ] `PUT …/order` still has no drag UI: the endpoint works and the list keeps `position`, but a reorder
      handle that only moves items inside their section is a gesture of its own and it did not fit the round.
- [x] e2e for the new surfaces: `tests/e2e/shopping-round6.spec.ts` covers table headers and sorting through
      the URL, search across items, the filter badge and clearing it, pagination and page size, rename with
      Escape, icon marking, select-all, the 3×2 chip surviving a reload and removing itself, the 10 % discount
      moving the total and being removable, the photo sheet refusing to write without an AI config (and
      pointing at it), the calendar layers with a created event, a discount aimed at one product, and a calendar
      that must not ask for the same window of events twice. Not covered: drag reorder, picker recents
      (neither exists yet) — and note these specs could not be _executed_ in this sandbox (no Chrome binary),
      so CI is the place where they turn green or red. Every `data-test` they use is now _checked_ by
      `scripts/check-ui.mjs` rather than trusted.
- [x] §13 updated: recurrence and availability stay out, plus what this round consciously left behind.

## 12e. Round 7 checklist — the things that were quietly wrong

Round 6 shipped with three bugs that only show up on a phone or on the second click, plus a vocabulary
mismatch. The rule stays: `[x]` when the test is green, and here also _how_ it was verified, because in
this sandbox the frontend runner does not exist and pretending otherwise is how a box lies.

- [x] "Ver todas" in the tray showed nothing. `status=all` is a _filter_ value, not a value of the column,
      and the query was asking for `l.status = 'all'`. The schema now carries `LIST_STATUSES | 'all'` and the
      route has the three branches written out: no status → active+archived, a status → that one, `all` → no
      condition at all. Route test `la pestaña «todas» mezcla activas y terminadas` (server, green).
- [x] The calendar asked for the house events in a loop — dozens of requests, then 429 — because `visibleRange`
      was a `computed` derived from `days()`, `days()` reads the events, and the `effect()` that loads the events
      writes what `days()` reads: a feedback cycle wearing a date picker. Fixed in two places, both of which
      matter: `visibleRange` is computed from `anchor()`/`view()` with `monthGrid`/`weekDays` (the grid no
      longer depends on the data painted inside it), and `loadHouseholdEvents(from, to)` remembers the window
      it already fetched and ignores a repeat. Frontend: type-checked and built, no runner here.
- [x] An editable control always has a way out: `✕` on the inline rename (round 6) is now also a visible close
      on the three bottom sheets of the detail (`discount-close`, `photo-close`, `audit-close`) — the backdrop
      has always closed them, but "swipe away somewhere" is not an affordance you can see.
- [x] `app-checkbox` (`ui/checkbox/`): `button[role=checkbox]` with `aria-checked`, the Material check inside a
      box, `disabled`, and a 40 px hit area. It replaces the two bare `<input type=checkbox>` of the event sheet;
      the bare `<select>` of the event _kind_ became an `app-picker`, so the type of an event carries its colour
      like everything else. Frontend spec written (`checkbox.component.spec.ts`), not executed here.
- [x] `app-picker` opens **upwards** when it does not fit below: inside a sheet with `overflow-y: auto` the panel
      was cut at the bottom edge and the last options of the list were physically unreachable. `flipForRoom()`
      measures on open and again once the search box has focus, because that is when a sheet may have scrolled.
- [x] Discount per product or per section — the shape of the signs in a real aisle («2 € de descuento en jamón»).
      `scope: 'all' | 'firstUnits' | 'product' | 'category'` + `target`; `MoneyLine` gains `productKey` and
      `category`, `isEligibleForDiscount()` compares _normalised_ keys (NFD, no accents, lowercase) so "Jamón"
      and "jamon" are the same product, the base of the maths _and_ the split both shrink to the matching lines,
      and a promised discount with no line that matches says `reason: 'noMatchingLine'` instead of pretending.
      `describeDiscount` writes "… en Jamon Serrano". The schema requires `target` (`DiscountTargetRequired`) the
      moment a scope promises a target, and the sheet refuses to save before asking the server.
- [x] Storage: the `CHECK` of `shopping_list_discounts` only knew two scopes, so the new ones could not be
      written on an existing database. `database.ts` ships the rebuild of that table (copy, drop, rename) when
      the stored SQL does not mention `'product'`, plus `target TEXT`; a fresh install gets the new shape
      directly. Five server route tests cover it (product only, whole aisle, 400 without target, forgetting the
      target when going back to the basket, and the estimate admitting it matched nothing) — green, `189 tests`.
- [x] Vocabulary: the sheet said "suelta". The pills and the sheet title say `Evento`, the type is `Tipo`, and
      the only `suelta` left in the calendar files is the Spanish adjective in "tarjetas sueltas" — which is
      about loose cards, not about the feature.
- [x] `scripts/check-ui.mjs`, wired into CI (Type Check job) and `make ci:ui`: no emoji in `frontend/src`, no
      native `<select>` outside `ui/`, no `ui/` component left unmounted, every `data-test` an e2e spec asks for
      existing in the app (the invented-selector failure mode that bit this project twice), and no direct call
      from the browser to an AI provider. It carries a **debt list** — 22 files with emoji and 5 with a native
      select, all of them pre-existing screens — that may only shrink: when a file stops offending, the guard
      says so in the log and the entry is deleted in the same commit. Verified by breaking things on purpose.
- [ ] `tests/e2e/shopping-round6.spec.ts` still cannot be executed in this sandbox (no Chromium), and the two
      new tests in it (the product discount and the request count) are therefore _read-and-checked_, not run.
      The first CI run is the one that turns them green.

## 12f. Round 8 checklist — why the app locked itself out

The user's report was one sentence with two halves: _still_ too many requests, and _I cannot test
anything or see the logs in the UI_. Both are the same bug with two faces, and neither was in the
calendar: it was the request budget of the whole API, the only layer with no test —the e2e suite runs
with the limiter switched off, and the middleware lived in the same file that opens the port.

- [x] `createApp(options)` in `server/src/app.ts`: the middleware and the routes stopped being
      inseparable from `listen()`. Without this, testing the limiter meant booting a server, which is
      why nobody had ever done it. `index.ts` is now the binary: probe the `dist`, build the app, serve.
- [x] The limit is per **session**, not per `unknown`. `keyGenerator` fell back to a single shared
      bucket whenever the proxy did not set `x-forwarded-for` —which is every preview, and a lot of home
      nginx setups— so one tab in a loop locked out the entire household, including `/api/logs`. Key
      derived from the bearer token (FNV-1a, no material from the token in the key); credentials keep the
      tight IP buckets they had.
- [x] Diagnostics are outside the budget: `/api/logs*`, `/api/health*` and any `/stream` path never
      consume the quota (server test: six hits on `/api/logs` with a bucket of 1 and no 429). Blocking the
      screen you use to understand a lockout is not a defence.
- [x] A 429 now says when to come back (`Retry-After`, read from the draft-6 `RateLimit` header, exposed
      through CORS) and logs **one** line per window into the store, so the viewer shows the throttle
      instead of the user guessing it. `rateLimitFromEnv` refuses `max=0` (returns the default and warns)
      because `0` is how people write "disable" and how an app ends up with no limit at all.
- [x] The node server can serve the built frontend (`resolveStaticAsset` + `resolveStaticDir`): hashed
      chunks cached for a year, `index.html` never cached, SPA deep links to `index.html`, a missing
      `.js` a real JSON 404 (never HTML —that is the «Unexpected token '<'» blank screen), and `..`
      refused. The Dockerfile was already copying `frontend/dist` to `./public` with a `CMD node` that
      could not read it.
- [x] `core/sse.ts`: one resilient client for the two live surfaces (log viewer, shopping stream). The
      browser reconnects a failed `EventSource` once a second forever; this closes it, backs off
      (1 s → 2 → 5 → 10 → 30), gives up after N tries and says so, stops while the tab is hidden and
      makes a single attempt on return. Frontend spec: five cases (Jasmine, fake clock).
- [x] `log-store.onLogEntry()` is the single fan-out, and `addLog` calls it: previously only the browser's
      `POST /api/logs` broadcast, so every server `console.*` line entered the ring buffer and nobody told
      the live tail —the viewer looked dead while the server was talking. Verified against the built binary
      with a live `curl -N` of `/api/logs/stream` (the marker appeared without reloading).
- [x] Error interceptor: one toast per status and window (30 s for a 429, 4 s for the rest), with the wait
      written in the message. A wall of identical toasts is how the screen becomes unusable — «no me deja
      probar nada».
- [x] CI runs the **whole project**: `playwright.full-stack.config.ts` boots `node server/dist/index.js`
      (prod build, limiter ON, SSE intact) and `tests/e2e/full-stack/` covers serving + deep links, the
      request budget of the calendar and the cart, the live log tail, and the limiter contract (429 with
      `Retry-After`, diagnostics unaffected, quota recovers, other sessions untouched). Same command
      locally: `pnpm run test:e2e:full-stack`, or `make test-e2e-full-stack`.
- [x] `tsconfig.e2e.json` + `pnpm run typecheck:e2e` + a CI step: Playwright transpiles without checking
      types, and the first run of this found a `toHaveCount(0, { message })` whose "message" option does
      not exist —the failure the author wanted to label has been unlabeled ever since.
- [x] `server/src/app.spec.ts` (9) and `server/src/utils/log-store.spec.ts` (3) are the first tests of
      those two layers; `pnpm --filter @hogaria/server test` is green at 202.
- [ ] The four full-stack specs could not be _executed_ here (no Chromium in the sandbox); what was
      executed is the same thing by hand with `curl` against the built server: HTML at `/`, 200 for a real
      chunk, JSON 404 for a missing one, `index.html` for `/shopping/una-lista`, SSE with the live marker,
      the 600-per-minute cut with `Retry-After: 47`, and `/api/health` + `/api/logs` answering the whole
      time the probe bucket was blocked. CI is where they run as Playwright.
- [ ] Limits are still configured with env, not from `/settings` —there is no `runtime_settings` table
      yet (§10), and a rate limit is the wrong first consumer of a feature that does not exist.

## 12g. Round 9 checklist — a discount that can name several products, and a purchase that cannot close without prices

Three things from the user, and only one of them was cosmetic: the agenda under the calendar had a second
add button and no styling at all; the discount still could not say "2,50 € on these four products"; and
closing a purchase was free to invent nothing and learn nothing — you could mark a list as paid with lines
that had no price, and the price that _was_ recorded did not know which shop it belonged to, although the
same milk has another name and another price at Mercadona than at Lidl.

- [x] `shopping_list_discounts.targets` (JSON array of product keys or section names) next to the legacy
      `target`. The engine gets a set instead of a string: `isEligibleForDiscount` matches `product_key` or
      the name's key, `basketMoney` builds its base from the matching lines, and `describeDiscount` writes
      «2,50 € en jamón, queso · +2 más» so what the shelf promised and what the basket applied are the same
      sentence. A discount that can only ever hit one product is a discount nobody can type at the till.
- [x] `discountSchema` accepts `targets` and only requires a target of some kind when the scope promises
      one; the `PUT` stores both shapes and the `GET` reads them back, so an old row (single `target`) keeps
      working with no data migration.
- [x] The discount sheet picks products **from the list** (rows with section, quantity and price, checkbox
      multi-select, "toda la sección X") instead of one free-text `app-picker`; the bar's affordance stops
      being a bare percent icon and says «Descuento · no aplicado» / «Descuento · 2,50 € en …»; and the
      multi-selection toolbar offers «Descuento a estas N líneas», which opens the same sheet pre-targeted.
      One editor, three ways in — the sheet is not where the discount is decided, the aisle is.
- [x] `POST /lists/:id/complete` refuses what it cannot learn from: if a bought line has no price, 409
      `PRICES_MISSING` with the offending lines (id, name, quantity, unit) and the count. Not a warning in
      the toast — the app has been asked to _remember prices_ by closing the list, and closing it with holes
      is how the next estimate comes back wrong.
- [x] Prices can arrive _with_ the close: `POST /lists/:id/complete { prices: [{ itemId, priceMinor,
quantity?, store?, productName? }] }` writes each one onto its line and records the observation in the
      same transaction, so "pago y apunto lo que he pagado" is one tap and not a race between two calls.
      `quantity`/`productName` exist because a receipt says what was paid for what was carried, under the
      name the shop printed.
- [x] A price without a shop is not a price: `prices[].store` or the list's `store`, and with neither, 409
      `STORE_REQUIRED` with a hint naming where to set it. This is what "el precio del producto por el
      establecimiento" means as a constraint the server can check.
- [x] `estimate` resolves the observed price **for the list's shop first**, then falls back to the most
      recent one from any shop and marks the line `otherStore` with the shop's name. Two rows in
      `price_observations` for one `product_key` are the point of the table, and reading `ORDER BY
observed_at DESC LIMIT 1` across all of them was silently pricing the house's milk with Lidl money.
- [x] Same product, different name: `PATCH /lists/:id/items/:itemId` accepts `productKey`, so a line can
      declare itself to be the product the house already tracks, whatever the shelf calls it. `GET /prices`
      filters by `store`/`productKey`, and `GET /prices/products?q=` returns the known products with their
      variants (name per shop, price, observations) to feed the picker and the per-shop price chips.
- [x] The agenda is a section: its own card with padding and rhythm, a title that says the day in relative
      words, rows that are not the 11 px variant built for a month cell, and an empty state that offers
      something to do. `[data-test="agenda-add"]` disappears — the header's «+ Evento» is the only add
      button and it opens the modal with the day in view prefilled, so nothing is lost by removing it.
- [x] Tests: `list-discount.spec.ts` for the set semantics and the plural description; `shopping.routes.spec.ts`
      for storing `targets`, the two 409s of `complete`, prices written by the close, per-shop resolution and
      the `productKey` link; `tests/e2e/full-stack/` and the dev suite for the flows that only exist in the
      browser (discount on two products, close blocked until the prices are in).
- [ ] Still env-configured, not `/settings`-configured: the completion rules are code, and the list
      of "shops this house uses" comes from the `shopping_lists.store` column, not from a catalog
      table. A `stores` table with its own name per product (and a barcode) is the next step, and it
      is in §13 rather than here because it needs a UI of its own.
- [ ] The four money flows in `tests/e2e/full-stack/shopping-money.spec.ts` typecheck (`pnpm run
typecheck:e2e`) but were not _executed_ here —no Chromium in the sandbox—, so CI is where they
      turn green. What was executed: the 22 new vitest cases (224 green in total), the prod build,
      `tsc` of app and spec, `check-ui` at 126 files with the removed `discount-row` caught by the
      guard itself, and the discount/multi-target behaviour read back from the API by hand.

## 12h. Round 10 checklist — one control per decision, a discount that belongs to the line, and clocks that mean what they say

Four things from the screenshot of the line sheet, and the fourth was app-wide.

### The line sheet (units) — done

- [x] The unit control is **one** control. The quick chips (`ud kg L pack`) and the picker below
      repeated the same value twice, and a row that offers the same choice twice is a row that
      disagrees with itself the moment one of the two is stale. Both are gone; the sheet has
      `app-unit-picker` and nothing else for that decision.
- [x] Families: the picker groups by what is being measured —peso, volumen, unidades, envase,
      medida de cocina— and choosing the family **selects its default unit** (Peso → kg, Volumen
      → L, Unidades → ud). Refining inside the family is one more tap, not another control, and
      writing «bote de 400 g» by hand keeps working because a unit that is not in the catalog is a
      unit someone actually uses. `unit-families.ts` holds the data and `canonicalUnit`, shared
      with the paste parser so «1kg Tomates» and «1 KG Tomates» are the same row.
- [x] `app-unit-picker` is a component that wraps `app-picker` (the trigger that always says the
      value, the filter, the keyboard, `allowCustom`) instead of a fourth copy of the pattern. It
      also names the family it resolved to under the trigger, because «kg» alone is a number
      without a story. The photo review has no unit control yet —its units come from the model—
      so the picker has one consumer today, which is what the sheet needed.

### The line discount — done

- [x] `shopping_list_items` gained `disc_kind`, `disc_value_minor`, `disc_percent_bps`,
      `disc_units` via `addColumnIfMissing`. Four columns and not one JSON blob: `estimate` sums
      them for the header in one pass, and a blob has to be parsed per row to do arithmetic.
- [x] `applyLineDiscount` in `utils/list-discount.ts`, applied **after** the offer and **before**
      the basket coupon, which is the order a till uses: `3x2 → -10 % sobre 2 unidades → -2,50 €
de la cesta`. Applied in the other order, the same receipt gives a different number, and
      there is no way to argue with it afterwards. The percent is taken on what is _paid_ (with a
      3x2 on six units, 5 % of four units' worth), because that is what the sign at the shelf
      means.
- [x] Percent or amount over the first N units (`disc_units`) exists because that is a real sign
      («50 % en la segunda unidad», «2 € en los dos primeros») and without it the only honest
      option was to lie about the whole line.
- [x] Clamped and said: a 2 € discount on a 0,95 € line lowers it to 0,00 and the row says
      `clamped`; a cap of two units when the basket holds one says `fewerUnits`. It never goes
      negative and never refunds the rest of the basket.
- [x] `createItemSchema`/`updateItemSchema` take `discount` (and `discount: null` removes it,
      which is why it is not a `COALESCE`); `POST` writes the four columns and merging two lines of
      the same product carries the incoming discount over; `PATCH` writes all four at once, because
      half a discount is worse than none; `estimate` returns `lineDiscountMinor` per row,
      `lineDiscountDescription` and `lineDiscountReason`, plus `lineDiscountMinor` at basket level;
      the audit trail logs `item.discount`.
- [x] The sheet got the block («Descuento en esta linea»: ninguna / porcentaje / importe, with
      «sobre cuantas unidades»), a live «de 0,95 € a 0,86 €» line while typing, and autosave like
      every other field in that sheet — one debounced commit for the whole sheet, so tapping a
      discount chip cannot swallow the price being typed. The offer block stayed separate on
      purpose: an offer says how many units you pay for, a discount says how much; they are two
      questions and they stack exactly like at a till. The row shows a chip with the discount so it
      is not only visible while the sheet is open, and the breakdown strikes the old price.
- [x] Closing the purchase separates the two numbers: `paidMinor` subtracts the line discount (that
      is what left the wallet), while the price the household _learns_ is the shelf price —learning
      0,75 today would make next week's estimate lie.

### Clocks — done

- [x] The server stored UTC in a column without saying so: `2026-09-20 09:44:18` has no zone, so
      the browser read it as _local_ and everything moved by the offset —in Madrid, two hours: a
      list saved a second ago said «hace 2 horas» and the log viewer printed tomorrow's
      timestamps. The fix is at the boundary: `timestamp.middleware.ts` rewrites naive
      `YYYY-MM-DD HH:MM:SS` (and `T…` without zone) into ISO with `Z` on the way out, for JSON
      responses only, keyed by the field name so a note that mentions a date is not rewritten.
      Date-only strings are left alone on purpose: `2026-09-20` is a day on a calendar, not an
      instant, and adding a zone to it would move the lunch to the previous day.
- [x] `frontend/src/app/core/time.ts` owns what the client knows: `clientTimeZone()` (Intl,
      detected, not typed), `parseInstant` (Z or naive-UTC), `formatTime`/`formatDateTime`/
      `formatDay`/`formatTimePrecise`, `toDayKey`, `daysUntil` and a `formatRelative` that says
      «hace 3 min» or «16 sept» by distance. Every hand-rolled `new Date(value)` in a component
      goes through it: the tray's «Guardado», the audit trail, the log viewer's clock, the pantry's
      expiration chip. The audit rows carry the absolute time in their `title`, and the log viewer
      says which zone it is showing —the server speaks UTC, so comparing the two used to be
      guesswork.
- [x] Calendar dates keep the local-day rule from `calendar.util.ts` (`toISODate` from local
      parts): that file already stopped the UTC-shift bug for meals, and the same rule now applies
      to expiration and receipt dates —a product does not expire one day earlier because you fly to
      Lisbon. Two places broke it and are fixed: the pantry's edit form pushed the day through an
      instant (`toISOString().split('T')[0]`), and its «Caducado» badge counted milliseconds, so
      at 23:00 on the expiry day the yoghurt was already expired.
- [x] The same day-vs-instant mistake was in the pantry's **SQL**, and it was worse:
      `expiration_date >= datetime('now')` compares `2026-09-20` with `2026-09-20 10:50:08`
      lexicographically, so what expires today counted as _expired_ from the first hour of the
      morning and never showed up in «next 3 days». The filters now compare `date()` to `date()`.
      And the two pantry filter flags were declared `z.boolean()` in a query schema, which never
      parses a URL —every «solo caducados» from the app was a 500 with a ZodError. There is now a
      `queryFlag` that takes `true`/`1`/`false`/`0`, and a route spec that pins both behaviors.
- [x] Tests: the middleware on a Hono app (naive → Z, date-only untouched, JSON of the real API
      checked in the shopping routes suite, non-JSON left alone), the engine table for line
      discounts (order, clamp, per-units slice, merge, removal), `time.spec.ts` for
      parse/format/relative with the zone passed explicitly so it runs in any browser,
      `unit-picker.spec.ts` for the families, and `pantry.routes.spec.ts` for the day math.
- [x] Verified against the built server, not only against the tests: an item with `3x2` plus
      `-10 %` estimated `400 → 360` on six units of 1,00 €; a 2 € discount on a 0,95 € line
      reported `clamped`; `discount: null` cleared the four columns; closing the list reported
      `paidMinor 405` while the remembered price stayed at 1,00 €/ud; every timestamp in the
      responses ended in `Z` while `expiration_date` stayed `2026-09-20`; `?expired=true` returned
      the day-old yoghurt and not today's, and `item.discount` appeared in the audit trail as
      «Sonda B ha cambiado el descuento de «Tortilla»».

## 12i. Round 11 checklist — the picker as a list of things you can choose, and the person visible wherever something happened

Feedback on the screenshots of the line sheet, plus one thing that was visible on screen.

### The unit picker, again (it was half right)

- [x] Families are **not** a choice. A family is a title: what you can tap is a unit. The
      previous round made "Peso" an option that selected `kg`, which read well in the spec and
      badly on the phone —the trigger then said «Volumen» instead of «1,5 L» because the family
      row and the unit row shared the value `L` and the picker matched the first one.
- [x] No per-row descriptions. The hint next to each unit was cut to two letters in a
      320-pixel-wide column; a truncated description is noise with an ellipsis. Title only.
- [x] The trigger says the unit, and the panel is the list of units grouped by title. Typing
      still filters across everything, and writing «bote de 400 g» is still a value.

### The photo sheet was printing its own test attribute

- [x] `data-test="photo-drop">` was visible as text in the drop zone: the tag was closed before
      the attribute, so the attribute became content. Fix the markup, and teach `check-ui` to
      catch the shape —an attribute-looking token sitting between a `>` and a `>` is not
      something a user should ever read.

### Who is using this, in the sidebar

- [x] Bottom-left is the **person**, not a logout row: avatar (their photo if they set one,
      otherwise their initial —like Google's chip), their name, and a separate small logout icon
      button. One tap does not log you out by accident, and you can see who you are logged in as.
- [x] The layout's own icons stop being emoji (`🏠 📦  📅  👨‍👩‍👧‍ 👤 🤖 📋 ⚙️  ☰ ✕`): same
      rule as the rest of the app, and it takes `main-layout` off the guard's debt lists.

### The person, in every history line

- [x] Wherever a line says _who_ did something, it shows the **same icon**: the shopping row
      (it printed bare initials letters), the tray, the audit trail (already an avatar) and the
      household agenda (which computed initials by hand in two places). `app-avatar` is the only
      implementation of "a person as a circle".
- [x] For that to be a picture and not a letter, the reads that already join a name now join the
      avatar too: `added_by_avatar`/`updated_by_avatar` on shopping items, `authorAvatar` on
      calendar events. The client never guesses a color: `app-avatar` hashes the name, so the
      same person is the same circle everywhere.
- [x] Tests: the unit options contain no family values and no duplicated values (that is what
      made the trigger lie), `app-avatar` renders the initial when there is no image, and the two
      API reads return the avatar field they promise.

### How it actually turned out

- The group titles live in `PickerOption.group`, and `rows()` returns a discriminated union
  (`kind: 'header' | 'option'`). Two `@if (row.kind === …)` blocks, not `@if/@else`: the AOT
  compiler does not narrow a union in an `@else` branch and fails the _build_ with NG1
  «Object is possibly 'null'» even though `tsc -p tsconfig.app.json` is happy —`ng build` is
  the gate that catches this class of template bug.
- The unit field's caption under the trigger ("Peso") went with the row descriptions: the icon
  in the trigger already says the family, and two descriptions of the same thing in a 320 px
  column is one too many.
- A comment with markdown backticks inside `styles` broke the _client_ and nothing else: the
  first backtick closes the literal, the CSS after it becomes code, `styles` ends up an
  array of several entries and the AOT reports `Failed to resolve styles at position 1 —
Value could not be determined statically` (NG1010). `tsc` is happy with it, since the
  result is still valid text for the type checker. Rule 7 of `check-ui`
  (`backtick-cierra-el-literal`) is that trap: no backticks inside a comment that lives in
  `template`/`styles` —and no, `ng build` is not optional in a round that touches them.
- `check-ui` grew rule 6 (`atributo-como-texto`) and prints its rule count; it flags the broken
  drop zone, stays quiet on the fixed one and on `a > b ? "x" : "y"`. `main-layout` left the
  emoji debt list (20 files left) and the icon set is 85 names.
- The sizes follow the row: `xs` in list rows, agenda chips and the tray, `sm` in the audit
  sheet. `.detail__who` stopped being a circle —it used to draw one around the letters, which
  would have nested two.
- On the way, the tray rows gained the owner of each list (`ownerName`/`ownerAvatar`), because
  the history tab is exactly where «did I close this?» is asked.
- **What the app still cannot say:** a `meals` row has no author —the table has no user column,
  a meal belongs to the calendar day, not to whoever typed it— so the food part of the agenda
  has no face to show without widening the schema. `calendar_events.user_id` exists, and those
  lines do show one.

## 12j. Round 12 checklist — the agenda belongs to the house, the avatar has to be readable, and the account is editable

Four complaints, one of them about something that was simply invisible.

### The calendar is not the property of the kitchen module

- [x] `?layers=` and the shared agenda (round 9) made `/calendar` a section of the house: shopping
      lists, house tasks, personal sueltas. But the registry still owned the **route** from the
      `meals` module, so switching off «Comidas y recetas» deleted the whole agenda —route and nav
      entry— which is the opposite of what that switch means.
- [x] `MODULE_REGISTRY.meals.paths` is `['/recipes']` now. What the module governs is **what is
      kitchen inside the calendar**, not the calendar: the Comidas layer, the meal affordances in
      the three grids, the goal ring and the calories/plan strip, the `Objetivo` pill and
      `Planificar IA`.
- [x] The grids receive `kitchen=false` and stop offering what the account turned off; the days
      arrive with `meals: []`, so the blocks cannot leak in through the data. A shared
      `?layers=meals` link with the module off is ignored —not an error, and not written back to
      the URL, because that would re-add the thing the person just turned off.

### An avatar you can actually see

- [x] `app-avatar` painted `[style.background-color]` from the **`color` input** and never from
      the hashed colour of the name. Nobody passing only a name —which is every line of the app—
      got no circle: white initials over the page background. And a photo had no edge, so it
      merged into the card behind it.
- [x] Background always resolves (an explicit `color`, otherwise the hash of the name); the
      initials take **white or ink depending on the luminance of that background**, so the pair is
      readable on both themes; a photo gets a 1 px ring in `--border-strong` so the circle is a
      circle on any surface.
- [x] Fixing the component fixes everywhere, which is the point of round 11 having made it the
      only rendering of a person.

### The person's own account, in Preferences

- [x] `/preferences` gains a **Cuenta** tab with the three things the server already accepted and
      the UI never showed: the display name (`PATCH /auth/profile`), the photo, and the password
      (`POST /auth/change-password`, which checks the current one before replacing it).
- [x] The photo is resized **in the browser** to a square JPEG of 128 px before leaving the
      device, and it is stored as a file: `POST /api/auth/avatar` writes it in an `uploads`
      directory next to the database and `users.avatar` keeps a path
      (`/api/uploads/avatars/<userId>.jpg`), not the bytes. It is served under `/api` so the dev
      proxy carries it without touching `proxy.conf.json`.
- [x] Why a path and not a data URL: `users.avatar` is read by the subqueries that decorate every
      shopping row, every audit event and every agenda chip. A 40 KB data URL there is 40 KB per
      row on every list view, and the list view is the hottest screen of the app.
- [x] `updateProfileSchema.avatar` was `z.string().url()`, which rejects the very path the app
      generates for it. It becomes: an `uploads` path, an absolute URL, or `null` to clear.
- [x] Name, photo and password each have a cancel that restores what was there — the standing rule
      for any editable control — and nothing uses `window.prompt` for a new password.

### «Sin oferta» and «Sin descuento» have to look like what they are

- [x] They were muted caption-coloured chips: a removal action that reads as a label is not a
      button, and the person cannot see that it is the way out. The chip gets a `--clear` variant:
      accent ink, the `close` icon, and the same height as its neighbours.
- [x] Tapping the offer preset that is already on **takes it off**, like every other chip in the
      app; tapping the discount kind that is active goes back to `Sin descuento`. The hint line
      keeps saying what will be paid, and that is the feedback — no toast for a toggle.

### Tests

- [x] The registry no longer claims `/calendar`; `isPathVisible('/calendar')` is true with the
      kitchen module off, and `isPathVisible('/recipes')` is false.
- [x] The avatar's colour pair is a pure function (`avatar-palette.ts`) with its own spec: a name
      always resolves to a background with enough contrast for the initials, and the choice is
      stable for the same name.
- [x] `POST /api/auth/avatar` writes, replaces the previous file, and refuses a non-image MIME and
      an oversized body; `PATCH /auth/profile` accepts the app's own path and clears with `null`.
- [x] The line sheet: clicking the active offer preset clears the draft, and clicking the active
      discount kind returns it to `none`.

## 12k. Round 12 — how it actually turned out

The five things asked for, in the order they were done. What is checked below is checked by a test
that runs; what only a pair of eyes can decide says so.

### The agenda stayed, the kitchen went away

- [x] `MODULE_REGISTRY` no longer owns `/calendar` (`meals.paths` is `['/recipes']` alone), so
      `moduleOwningPath('/calendar')` is `undefined` and the route is core: it survives every switch
      in Configuración. `modules.registry.spec.ts` pins that, and the Karma spec of the service
      follows the same rule through `isPathVisible`.
- [x] The view does not disappear; its kitchen content does. `calendar.component.ts` injects
      `ModulesService` and derives `kitchen()`, and `mealsVisible() = kitchen() && showMeals()`.
      With the kitchen off: no Comidas chip, no Objetivo, no Planificar IA, the period strip
      collapses to `cal-strip--bare` (only the error line is left), the month cells lose the `+`,
      the week and day grids show the household agenda instead of meal slots, and `?layers=` neither
      writes nor honours `meals`.
- [x] The three grid children take `[kitchen]` as an input rather than reaching for the service —
      the day component keeps its aside only when there is a kitchen, and the week's `is-empty`
      marker means "no plans" only in the sense the person can still act on.

### An avatar you can actually see, everywhere

- [x] `avatar-palette.ts` is the whole decision, in the open: eight discs, a tint of the hashed
      colour at 84 % over the ink, and the letter in the colour that clears WCAG contrast against
      that specific disc (`contrastRatio ≥ 4.5`, asserted for all eight and for a smiley-name
      surrogate pair). `avatar-palette.spec.ts` runs it in the pure-test bridge — no browser, so the
      numbers are the verification; how it _looks_ is the preview's.
- [x] `app-avatar` is the only place a face is drawn, so fixing it fixes the header, the sidebar
      chip, the household list and the line sheets. `ink` is a getter, not a `computed`: with plain
      `@Input()` fields a `computed` keeps a stale value when a row is reused.
- [x] A photo gets a double ring (inset `--border-default`, outer `--border-strong`) so the circle
      is still a circle on a white card, and a 404 photo falls back to the initials instead of a
      blank disc (`broken` + `.avatar__initials--fallback`).
- [x] The mobile header was the one avatar that ignored the stored photo — it binds `userAvatar()`
      now, so the face you chose is the face you get at 400 px wide too.

### The account, editable from Preferencias

- [x] New `Cuenta` tab, first in the strip: the sidebar opens `/preferences` from the person's own
      avatar, so the account is what should be there when they arrive. The tab strip became a loop
      over a `tabs` list with `app-icon`s — four emojis out, `preferences.component.ts` out of the
      `sin-emoji` debt list in `scripts/check-ui.mjs`, and the footer button that saves the
      _comensal_ profile is hidden on this tab because this tab saves itself.
- [x] `uploads.ts`: files on disk next to the database, `dirname(DATABASE_PATH)/uploads` (and a
      per-process temp dir under `:memory:`, which is what keeps the suite out of the repo). The
      stored value is the _path_ — a base64 avatar in `users.avatar` would be paid per row in the
      shopping and calendar subqueries that decorate every line with its author's face.
- [x] The filename is the server's, never the client's: `storeImage` sanitises the owner id and adds
      a random suffix, and `uploads.spec.ts` proves that a `../../etc/passwd` id comes out as one
      safe component inside `avatars/`. `resolveUploadUrl` refuses anything that escapes the kind
      directory, and `deleteUpload` reports whether there was something to delete (`rmSync` with
      `force` does not throw on absence, so answering `true` there would be a lie).
- [x] `GET /api/uploads/:kind/:file` is mounted next to the API routes and is _not_ behind the
      token — an `<img>` cannot send one — which is why the random suffix is the whole permission.
      `auth.routes.spec.ts` uploads a real PNG, reads it back through the public URL and checks the
      profile carries the path.
- [x] The public route is out of the request budget (`EXEMPT_PATHS`), next to `logs` and the SSE
      streams: a tray with thirty authored rows is thirty `img` GETs that cannot carry a token to
      key on, and round 7 is the precedent for what that does to a household.
- [x] `avatarField` accepts the app's own `/api/uploads/avatars/…` path or an absolute URL:
      `z.string().url()` was rejecting the exact string the server hands out, which is the kind of
      bug only an end-to-end test catches. `null` clears it, `sanitizeUser` omits the key when there
      is no photo (never an empty string), and the service's `avatar: avatar ?? undefined` matches.
- [x] `avatar-image.ts`: the file never leaves the device in a form the server would reject —
      JPEG/PNG/WebP, 4 MB, cropped to a 128 px centre square and re-encoded at 0.72 in a canvas.
      The pure half (`avatarFileError`, `squareCrop`) has a spec; the canvas half is browser-only.
- [x] Name and password need no new endpoints, only a screen: `updateProfile` keeps the cached user
      in sync (so the sidebar renames itself with the same signal), `changePassword` maps the
      server's English `Current password is incorrect` to a Spanish line, and every one of the three
      blocks has its own Cancelar — the password fields are wiped, not left typed on the screen.

### The chips that take things off

- [x] `.detail__chip-btn--clear`: dashed border in `--error`, no `--active` state, and it applies to
      `Sin oferta` (which had a `--muted` class with no rule anywhere — that is why it read as a
      caption) and to `Sin descuento`.
- [x] `pickOfferPreset` / `pickLineKind`: tapping the chip that is already on turns it off, with
      `aria-pressed` carrying the state the colour no longer can. No toast for a toggle: the hint
      line already says what will be paid.

### Verification

- [x] Gates: `tsc -p tsconfig.app.json`, `ng build --configuration production`,
      `node scripts/check-ui.mjs` (137 files), server `tsc --noEmit`, server vitest 271 tests with
      94.86 % statement coverage, `npm run typecheck:e2e`, and the frontend pure bridge at 45 tests.
- [x] New e2e for the round (`tests/e2e/round12.spec.ts`): kitchen off with the agenda alive and
      usable, the avatar disc readable, the photo visible in both menus and served by the public
      route, and the two removal chips. `tests/e2e/preferences.spec.ts` covers renaming, the photo
      and the three password fields against the real API.
- [ ] Not verified here, and it cannot be: whether the tint reads as _nice_ rather than merely legal,
      and how the crop behaves on a face that is not centred. That is the preview's job.

## 12l. Round 13 checklist — the person gets a page, the history says _now_, and the filter keeps its distance

### The layer row was flush against the card

- [x] `.cal-layers` sits inside `.calendar__panel`, which has no padding of its own — every band
      there sets its own 16 px laterally (`.cal-top`, `.cal-strip`). The layer row never did, so the
      filter chips touched the border of the card and read as something outside the screen.

### Who acted is resolved to today's name

- [x] `readEvents` selects `COALESCE(u.name, e.user_name)`: the feed shows the name the person uses
      now, and the row's snapshot stays in the table as the fallback for an account that no longer
      exists. Round 11 froze the name "so a rename cannot rewrite history"; in a household feed a
      stale first name on your own line is not history, it is a bug — the audit trail keeps the
      snapshot, the screen resolves it.
- [x] The client paints its _own_ rows from the live session (`auditFace` in the shopping model, with
      a pure spec): a rename or an uploaded photo must show in the history without a refetch, or the
      success toast lied.
- [x] `ha anadido` / `lineas anadidas` — the ñ and the accents were missing in the two server
      sentences and the two frontend toasts that print them.

### Mi cuenta, outside Preferences

- [x] `/account` is its own page with three sub-sections — **Cuenta** (name, photo), **Seguridad**
      (password, ending this session) and **Información** (what the app keeps in this browser, the
      version, the id, the household link) — reached by tapping the face in the sidebar. Preferences
      goes back to being about the _diner_: perfil, alergias, gustos, objetivo.
- [x] The tab travels in the URL (`?tab=security`) with the default left clean, as everywhere else,
      and `/account` is core: no module switch hides your own account.
- [x] The account state is seeded from the session signal through an `effect`, not once in the
      constructor — the user may still be loading from cache when the page opens.

### The dev database was a test dependency

- [x] `calendar.routes.spec.ts` imported its routes statically, so `app.config.js` was evaluated
      _before_ its own `process.env.DATABASE_PATH = ':memory:'` line: the spec ran on
      `server/data/hogaria.sqlite`. Any local use of the app (a registration seeds
      `shopping_categories`) then broke its `DELETE FROM users` cleanup with an FK error — nine red
      tests whose only cause was that somebody had used the product. Dynamic import, like its
      neighbours.

### Tests

- [x] `tests/e2e/account.spec.ts`: entering through the sidebar face, the three tabs in the URL,
      renaming visible in the menu _and_ in the history line without a reload, uploading a real PNG
      and reading it back through the public route, the ring around the photo, the password rules and
      the Cancelar that wipes the fields, and the storage inventory.
- [x] `preferences.spec.ts` asserts the opposite: the account is not there any more.
- [x] `shopping.routes.spec.ts` proves the rename shows in the feed while the stored snapshot stays.

### How it turned out

- The layer row, the accents and the identity fix are small; the page split was not. Moving the
  account out of Preferences deleted ~460 lines from that component and left it doing one job again —
  and it fixed a bug nobody had reported: `/preferences` was opening on the account tab, which is why
  «Preferencias» felt like it had changed subject between rounds.
- `auditFace` is deliberately narrow: it only touches rows whose `user_id` is yours, and only the
  prefix of the sentence. A helper that rewrote other people's text would be rewriting the audit
  trail, which is the one thing round 11 was right to freeze.
- Not verified by eye, and not run: this sandbox cannot install Chromium, so the four new `e2e`
  cases are written against the contracts (selectors, `data-test`, copy) and have never executed. The
  unit and route suites are green — 272 server tests, the pure frontend models under the vitest
  bridge, `tsc` for app and specs, the production build, `check-ui` on 141 files. Nothing here can be
  called visually confirmed.

## 12m. Round 13b — a photo that reported success and was not on disk

Reported from the preview: uploading the avatar showed a green toast, the face did not change, and the
server log said `GET /api/uploads/avatars/<file> 404` seven milliseconds after the `POST` that had
just answered `200`.

- [x] **A write that did not stick has to fail the request.** `storeImage` now verifies
      (`assertWritten`): the file exists and has the bytes it was given. `mkdirSync` and
      `writeFileSync` can both "succeed" against a directory that is about to disappear —a volume
      remounted, a workspace restored, a deploy that forgets `data/`— and the only honest answer is
      `500 UPLOAD_WRITE_FAILED` with the absolute path in it.
- [x] **A rejected upload leaves no trace in the database.** The `UPDATE` runs after the write is
      confirmed, so the profile keeps the photo it had; a row pointing at nothing is a 404 forever,
      which is precisely the state the user was stuck in.
- [x] **A 404 on an image is not cacheable.** The miss answers `cache-control: no-store`, so the
      next load can recover the file instead of staying blank until a hard reload; the hit keeps
      `immutable` because its name changes with every upload.
- [x] **The server says where it writes, once.** Startup logs `Uploads en <absolute path>` and a
      miss logs the full path it tried (at most once a minute — the route is public). Before this,
      the difference between «wrong directory», «read-only volume» and «bad code» was invisible
      without a shell.
- [x] **Notifications say what happened, not where it propagates.** «Foto actualizada — ya aparece en
      el menú, la compra y la agenda» is a brochure; and it is a lie the moment the write fails. The
      account page now says `Imagen cambiada`, `Imagen quitada` (there was no toast on removal) and
      `Nombre guardado`, and when the server could not write to disk it says exactly that, with the
      place to look.
- [x] Tests: `assertWritten` (missing file, truncated file), a read-only uploads directory making
      `storeImage` throw, and `POST /api/auth/avatar` answering 500 while the profile keeps its old
      photo, with the same read-only directory forced through `DATABASE_PATH`.

### How it turned out

Verified against the real server, both ways: `POST` → `GET` returns 200 with the bytes, and with
`chmod 0500 data/uploads/avatars` the same `POST` returns `500 UPLOAD_WRITE_FAILED` naming the path
and the profile still holds the previous photo. The reproduction of the reported symptom as a _silent_
404 could not be completed here — in this sandbox the flow answers 200 end to end, and the report's
own log shows the process writing to one filesystem while reading another (`server/data/` had been
replaced underneath the running server, which is also why the avatar from the previous session was
already 404 before the new upload). What is fixed is the class, not just the case: an upload that
cannot be read back can no longer be called a success, and the log now names the directory so the
remaining environment question is answerable in one line.

## 12n. Round 13c — the photo is a control, and a dead session says so

### The face in the account page had become a form field

- [x] The avatar is a **button**: hover or focus shows «Cambiar / Poner foto» over the disc, and the
      whole disc is the target. On touch (no hover) the label is there from the start —a hint that
      only appears for a pointer that does not exist is not a hint.
- [x] Tapping it opens a modal with the two decisions that belong together: **sustituir** and
      **quitar** (plus the Cancelar/Escape/backdrop that every editable control in the app has). Two
      stacked modals would have been two escapes to press; it is one modal with two steps.
- [x] Choosing a file no longer uploads it: it opens the **editor** —drag to frame, wheel, slider or
      `+`/`-` to zoom (1x–4x), arrows to nudge, `0` to recenter, and «Usar imagen». Before this the
      crop was always the dead centre of the photo, which is how a face becomes a forehead.
- [x] `avatar-crop.ts` is the single source of that geometry (pure, 7 tests, run in node): the preview
      and the uploaded bytes come from the same `cropRegion`, so what is framed is what is saved. The
      preview is `previewLayout` in px on the same image, not a `transform` with a second formula.
- [x] The editor always hands over a JPEG square of `AVATAR_EDGE` px, whatever came in.
- [x] A second photo cannot inherit the first one's broken state: `app-avatar` used to keep
      `broken = true` when `src` changed, painting the fallback initials over the photo that had just
      loaded —the exact signal that the upload worked.

### The ghost session is the bug the user actually hit

- [x] Evidence: the account in the browser (`IA4IeB_2YdLBjcQSyaHpX`) does not exist in the database
      the API has open, and its avatar file is nowhere on disk; `server/data/` (DB _and_
      `uploads/`) had been replaced under the running process by the sandbox reset. The screen kept
      showing the cached name and the cached photo URL, and every write answered 401.
- [x] That state was **silent**: the error interceptor excluded 401 from its toast, so an app on a
      dead session looks alive. A 401 now says «La sesion que guarda este navegador ya no vale.
      Cierra sesion y vuelve a entrar.», throttled once per 30 s (a screen full of parallel requests
      produces one message), and suppressed when the 401 belongs to the login form itself, which
      already answers next to the field.

### Tests

- [x] `avatar-crop.spec.ts`: centred crop, clamped zoom (including a `NaN` slider), the pan clamped
      to the slack the frame leaves, drag in the direction a finger expects, preview layout matching
      the region, and zoom anchored to the pointer (the assertion that catches «scale the offset»
      instead of «scale the gap»).
- [x] `account.spec.ts`: opacity of the label before/after hover, the modal's two steps, zooming
      changing the preview, Cancelar returning without uploading, the stored file being a
      **128x128 JPEG** served through the public route, the ring, the same face in the sidebar and
      the mobile header, and the removal through the modal.

### Same round, two corrections — one of them mine

- [x] **The 404 was a Windows path, and nothing else.** The server the user is running prints
      `Uploads en D:\projects\MiCocinAI\server\data\uploads`; `resolveUploadUrl` decided containment
      with `full.startsWith(dir + '/')`, and `resolve` on Windows writes backslashes, so the check
      never passed: the photo was written, its URL stored, the `POST` answered `200` —and every read
      404'd. `isInside(dir, candidate, separator = sep)` says what was meant, the separator is a
      parameter so the Windows case is a test (`uploads.spec.ts`) and not a hope, and the files
      already on that disk light up again without re-uploading. The sandbox-reset theory written
      above is wrong: it explained the same log lines but not `D:\`, and it was reached by
      inspecting the wrong filesystem. Left in place, because «el diagnóstico que quedaba bien pero
      era falso» is the lesson worth keeping here.
- [x] **Hover = the edit icon, alone, centred.** No label: over a 64 px disc a word is either
      truncated or a smudge. The icon is `1em` (`size = 0` on `app-icon`) governed by the overlay's
      `font-size`, and the inset is `padding: 18%` of the disc —so if someone changes the size of the
      face elsewhere, the icon cannot end up touching the ring. On touch (no hover) the scrim stays at
      a lighter alpha, because a square with a photo inside does not announce itself as a button.

### How it turned out

- The account chunk went from 22.7 kB to 36.7 kB raw (9.7 kB gzipped) with the editor inside it. It
  is lazy, it only loads on the one screen that needs it, and it replaces a canvas call plus a
  hand-centred crop that was already there —the cost is honest.
- The editor never talks to the network: it emits the finished data URL and the screen owns the
  POST, the toasts and the failure copy. That is what keeps the two cancelable paths (Cancelar in
  the editor, closing the modal) in one place.
- Not verified by eye: no Chromium in this sandbox, so the drag, the wheel and the 128x128 result
  are asserted by unit tests on the geometry and by an `e2e` case that has not been executed. The
  preview is the reviewer.

## 12o. Round 14 checklist — optional means optional, and the day has an hour axis

Reported by the user in one breath, and each part is a separate promise below: the calendar answers
`400` when a form is filled only with what it asks for; the day is not divided into
desayuno/almuerzo/cena/merienda — and that list was in the wrong order anyway, dinner comes after the
snack; the grid should read like Google's hours, showing only the window that has something in it, not
24 rows; and an event can have another member of the house in it.

### A. «Optional» has four shapes, and `.optional()` covers one of them

- [x] A form sends an empty field as absent, as `null`, as `''`, or as `"   "`. `z.string().optional()`
      accepts exactly the first. The calendar's `notes`/`location`/`color` are `.optional()` and the
      form sends `null` on purpose, so every event saved with the notes field empty was a `400`
      reading «Expected string, received null» —an error about the shape of the request, shown to
      someone who had done nothing wrong.
- [x] New `server/src/schemas/form.ts`: `formText(max)`, `formTime()`, `formDate()`, `formColor()`,
      `formNumber(...)` accept all four shapes, and normalise blank to `null`. `null` is _cleared_,
      absence is _untouched_ —that difference is what makes PATCH able to remove a value, and it is
      documented in the helper, because the next person will reach for `.optional()` again.
- [x] Every request schema a route parses is converted to those helpers where the UI can leave the
      field empty. Required stays required: `title` on an event, `date`, `name` on a product.
- [x] `calendar.routes.ts` and friends answer a failed parse with the field and the reason in Spanish
      (`notes: max 500`), not with the first zod sentence in English, and the dialog shows it inline.
- [x] The frontend stops using `undefined` to mean «borrar»: editing a meal and emptying its time now
      sends `null`, so the old hour actually disappears. Before this, the only way to lose a time was
      to delete the meal.

### B. Every form is tested with the optional fields missing — and that stays true

- [x] `server/src/schemas/form-contract.spec.ts` holds a table: one row per request schema, with a full
      sample, the list of required keys and the list of optional ones. For each row it asserts — parses
      with only the required; parses with each optional key absent, `null`, `''`, `"   "`; and still
      rejects a missing required key (otherwise the fix would just be «accept anything»).
- [x] The same file reads `server/src/routes/*.routes.ts` and fails if any `…Schema.parse` /
      `…Schema.safeParse` has no row in the table. That is the part that keeps it true in three months:
      a new form cannot skip the contract, and the failure message says exactly what to add.
- [x] Route level, where a schema can pass and the SQL still break on `undefined`: `POST
/api/calendar/events` with `{title, date}` only → `201` and the optional columns are NULL in the
      row that comes back; the same for `PATCH` clearing `notes` with `null`; plus a minimal-payload
      case in the existing `pantry`, `shopping` and `auth` route specs.
- [x] `tests/e2e/calendar.spec.ts` creates an event typing only the title, and asserts the dialog
      closes and the block appears —the user's exact repro, at the level the user touches.

### C. The order of the day

- [x] `MEAL_ORDER` and both SQL `CASE` blocks: breakfast, lunch, **snack, dinner**. The list was
      breakfast, lunch, dinner, snack since the first version, so the plan read «cena» before
      «merienda» everywhere it was sorted by type (grid, month, AI persist loop, enum).
- [x] `MEAL_TYPES` in `server/src/utils/weekly-plan.ts` follows the same order, so what the model is
      asked for and what gets written back agree with what is displayed.

### D. Hours, not meal slots — and only the hours that have something

- [x] New pure module `frontend/src/app/core/calendar-grid.ts`, tested before the component (TDD within
      the bridge's limits): minute↔hour helpers, the conventional hour of an untimed meal (`desayuno
08:30 · almuerzo 14:00 · merienda 17:30 · cena 21:00` —a position, never a printed claim), the
      visible window from the items of the range with padding, and the overlap layout (side-by-side
      columns, same rule Google uses: groups of items that collide share the width).
- [x] `app-calendar-timeline` renders the day/week grid: hour gutter, a column per day, blocks placed
      by minutes, a band on top for `allDay`, and no 24 empty rows — the top and bottom of the view are
      the first and last thing there is (default 08:00–22:00 when the range is empty).
- [x] The window is scrolled on load to the first thing of the day, or to `now` if today has nothing —
      the behaviour the user named («como las horas de google»).
- [x] Clicking an empty strip creates at that time: a meal takes `time` and the type nearest to that
      hour, an event takes `startTime`. The hour you clicked is not lost, which is the only reason a
      time axis is worth having over a list.
- [x] `calendar-week.component.ts` and `calendar-day.component.ts` go away rather than sit next to the
      grid as a second way to paint the same day; the month view keeps its rows (a month has no hours).
- [x] Meal type stops being a partition of the view and stays what it always was in the data: a label
      and a colour. The `data-meal` accent and the labels survive; the four fixed bands do not.

### E. Another member in the event

- [x] `calendar_event_attendees (event_id, user_id, added_by)`, created by the migration runner, with
      an index on `user_id`. The author is not an attendee of their own event —they are the author, and
      mixing the two would make «leave» able to delete the event.
- [x] `attendeeIds` on `POST`/`PATCH /api/calendar/events`: unknown ids and ids outside the house are
      rejected with the list of who could not be invited, not silently dropped.
- [x] Visibility follows the invitation: `GET /api/calendar/events` returns events where I am in
      `calendar_event_attendees` as well as mine and the house's, with `editable` still only for the
      author. An event you are invited to that you cannot see is an invitation that did not work.
- [x] An attendee can leave (`DELETE /api/calendar/events/:id/attendees/me`) and the author can remove
      anyone; nobody can remove the author, and the event is not deleted by the last person leaving.
- [x] In the dialog: a member picker with faces (`app-avatar`, the same palette rule as everywhere
      else), the author's face on the block, and the invited faces beside it; `title`/tooltip says who.
- [x] The picker has no «save» trap: adding or removing a member there is applied with the event, and
      `Cancelar` never sends anything.

### F. Gates and honesty

- [x] Server vitest green, the frontend-vitest bridge green with `calendar-grid.spec.ts` added to it,
      `tsc` for app and spec, `typecheck:e2e`, `node scripts/check-ui.mjs`, production build.
- [x] No claim about how the grid looks is made from a build: the sandbox has no Chromium. What is
      asserted here is geometry (numbers), placement data, and the dialogs' behaviour.

### What actually landed (measured, not promised)

- **Server**: the vitest run in `server/` → 21 files, **542 tests** green, with `tsc --noEmit` clean.
  The form contract file alone is **254** of them. `calendar.routes.spec.ts` is 18 tests: seven on the
  data the routes read, and the rest the behaviour the user reported —minimal payload accepted, `null`
  versus absent, a legible 400 naming the field in Spanish, clearing a note, changing and clearing a
  meal's hour, the order of the day, invites, outsiders, and leaving.
- **Route-level minimal payloads** now also exist for the pantry (ingredient with only what its screen
  requires, then `expirationDate: null` really clearing it), the shopping list item (only `name`, then
  `note`/`priceMinor` cleared with `null`) and `PATCH /api/auth/taste` with `{}` —which is what
  «saltar por ahora» sends, and was a 500 before this round.
- **Frontend geometry** is a pure module with **79** bridge tests (9 files) covering hour↔minute
  conversion, the trimmed window (hour boundaries, six-hour minimum, full day when the range is empty),
  the minimum block height, the overlap packing, the all-day band, the anchor order in Spanish hours,
  the 30-minute click snap and the auto-scroll. `calendar-week.component.ts` and
  `calendar-day.component.ts` are deleted, not deprecated: day and week are one component now.
- **`scripts/check-ui.mjs` grew a rule and a fix.** Rule 4 (orphan selectors) previously matched
  `data-test` names _by common prefix in either direction_, so when the week grid was deleted its
  `meal-chip` handle still «existed» —and the e2e specs asking for it would have gone quietly vacuous,
  because Playwright does not fail on a locator that matches nothing. It is now exact-match, with the
  only exception being the dynamic attributes the frontend builds by concatenation (`'layer-' + kind`).
  A second half of the rule does the same for the **CSS classes** the specs ask for, and it caught four
  orphan classes in three spec files (`.meal-slot`, `.cal-band`, `.cal-week`, `.cal-day`) on the first
  run; the specs were rewritten against the new handles rather than the old names being faked back into
  existence. The rule count in its own summary line is a constant now, because the printed «7 reglas»
  was lying the day the rule became eight.
- **UI handles of the new grid**, for the specs and for anyone reading the template: `timeline-col` (one
  per visible day), `timeline-band` (the all-day strip, which is also the «no he puesto hora» affordance),
  `timeline-add-meal` (the `+` in each day header), `timeline-block-meal` / `timeline-block-event` (built
  as `'timeline-block-' + kind`, so the prefix rule is what matches them), and `event-attendees` in the
  dialog. The removed handles (`meal-slot`, `meal-chip`, `cal-band`, `day-meal-*`, `week-meal-*`) are
  gone from the specs too —there is no `voluntario` line for a selector nobody uses.
- **A gate that turned out not to exist**: `npm run lint` does not lint anything in this repo, and it
  failed before this round. `frontend` runs `ng lint`, whose builder (`@angular-eslint/builder`) is not a
  dependency of any package or of the lockfile; `server` runs `eslint src --ext .ts`, and the pinned
  eslint 9.17 rejected `--ext` long ago and then found no `eslint.config.js`, because the repo has none.
  This round therefore does not claim a lint pass: what was run is `tsc` (app, spec and the e2e project),
  the two vitest suites, `check-ui` and the production build. Fixing the lint setup is its own round —
  flat config plus a decision about template linting— and pretending to have run it would be worse than
  leaving it broken and said.
- **Not claimed**: the sandbox has no Chromium, so nothing here asserts how the grid _looks_. The window
  trimming, the block placement and the scroll position are asserted as numbers, and the click and dialog
  behaviour as events. `calendar.component.ts` keeps a pre-existing component-CSS budget warning
  (13.32 kB against a 10 kB budget); its own styles are 12.6 kB of agenda and dialog CSS that predates
  this round, and the ~0.7 kB of the member picker did not create the overrun —the same warning already
  covers `shopping-list-detail.component.ts` at 17.86 kB. A check-ui sweep for orphan selectors in that
  style block returned none, so nothing was left behind by the deleted views.

### Coming soon, deliberately not here

- RSVP / «no me va» on an event, and availability (busy hours from another calendar).
- Dragging a block to move or resize it — the grid geometry is written so that the drop target is the
  same pure function that paints it, but the drag is not this round.
- A `time` per generated meal: the model does not return one, so untimed placement stays.
  (Taken in the next section: the house's hour is written on generated meals —the model still does not
  choose it.)

## 12p. Round 15 checklist — everything that deletes asks first, the house says what time it eats

Four things in one breath from the user, and the last one is a correction of what this program said it
had done last round, so it leads.

### A. «Sigo sin poder invitar a otros miembros a un evento, tanto en la creación como en la edición»

The server worked —proven with two accounts against the live API: `PATCH /events/:id {attendeeIds}` →
200 with the face back, `POST /events {attendeeIds}` → 201, and the invited account could see the event.
So the report was about the app, and it turned out to be three separate breaks, each of which on its own
is enough to make the control unusable:

- [x] `GET /api/calendar/events` (the list the calendar actually renders) attached `attendees` but not
      `attendeeIds`. Opening the dialog to edit an event therefore started with **nobody selected**, and
      saving would have written that back. Fix: the list returns the same pair the POST and the PATCH
      return, derived from the same bulk query —no second read per row.
- [x] `/calendar` never loaded the household: `loadHousehold()` was called on login, register, dashboard
      and the household page, so opening the calendar URL directly (or reloading it) left
      `householdService.household()` at `null`, `hasHousehold()` answered false, and the block that
      contains the picker did not render at all. Fix: `HouseholdService.ensureHousehold()` — load once,
      never twice in parallel, keep the failure recoverable — and the calendar calls it on init.
- [x] A control that is hidden because a request is in flight is a bug the user cannot distinguish from
      «this house has one member». When there is nobody else to invite, the dialog says so and offers
      the way to add someone; it does not disappear.
- [x] `saveEvent` sends `attendeeIds` only when the picker was actually shown for that draft. Absent
      means «don't touch» on the server, so the client must not send a list it never rendered —and must
      send the empty one it did.
- [x] The dialog's candidate list is a pure function (`core/event-invitations.ts`): the household minus
      the author, stable order by name, no self-invitation. Tested in the bridge, because it is the only
      part of the invite flow with real logic in the client.
- [x] An e2e case that drives the whole gesture (open dialog → tick a member → save → the face appears
      on the block), written and typechecked; it is not executed here (no Chromium), and the spec says so
      instead of claiming a green.

### B. Deleting anything asks first

Listas, líneas, eventos, utensilios, configs: a delete is the only action whose mistake cannot be undone
by pressing again, so no destructive control may act on the first click. `ConfirmService` is the app's
own dialog (round 12) and every path below goes through it.

- [x] A rule in `scripts/check-ui.mjs` finds the gaps instead of a list of promises: any method in a
      component whose body calls a destructive service method (`delete…`, `remove…`) must call
      `confirmService.confirm(` **inside that method**, or declare why in `DEBT`. The rule reports the
      method name and the line, so the fix is obvious and a new screen cannot forget.
- [x] The gaps it found get fixed in the same commit as the rule: the shopping line (`removeItem`), the
      price/discount removals, the recipe delete, the household member removal and the calendar event
      delete. Each confirmation names the thing being deleted —«¿Borrar «Pan de pueblo» de la lista?»—,
      never «¿Estás seguro?».
- [x] Deliberate exceptions, each with its reason written in the rule file: «quitar la foto» of the
      account (it is a decision inside the avatar modal, already a two-choice step, and re-uploading
      undoes it), the PWA's local-cache discard, and anything the server itself treats as a _setting_
      rather than a deletion (a `null` that clears a field is not a delete of a row).
- [x] Cancelling does nothing at all: no toast, no optimistic removal from a local list, no refetch. And
      the confirm dialog already has its own cancel —the rule «todo control editable necesita forma de
      cancelar» applies double to a destruction.

### C. What time this house eats (preferences → tour → calendar → IA)

- [x] `mealTimes` in the taste profile (`users.preferences`), one key per meal type, each an `HH:MM`
      string through `formTime`: `breakfast 09:00`, `lunch 14:00`, `snack 17:00`, `dinner 20:30` are the
      defaults the app ships with, and `readMealTimes` answers them when nothing was saved —so there is
      no «no configured» state to branch on in the UI.
- [x] A new section in **Preferencias** («Horarios de las comidas»): four time inputs, the unsaved-changes
      state, Guardar and Descartar, no more magic than the rest of the page. The values are editable
      whenever the user wants; nothing locks after the tour.
- [x] The **tour** asks the same question as its own step, prefilled with the defaults, and saving the
      step is the same PATCH the preferences page uses. Skipping the tour must not lose the schedule:
      the defaults stay.
- [x] The hour grid uses them: an untimed meal is _placed_ at the house's hour for its type, and the
      anchors that `core/calendar-grid.ts` tests (08:30/14:00/17:30/21:00) become the shipped defaults
      only as `MEAL_TIME_DEFAULTS`, imported by nothing else. Placement, the click-to-add prefill and
      the `+` in the day header read the configured values.
- [x] The AI gets them: the weekly-plan prompt names the hours, and `persistWeeklyPlan` writes
      `time = mealTimes[type]` for the meals it inserts, because a schedule the user typed is a fact of
      the house, not an invented per-meal claim (that distinction is what round 14's
      «no printed fake hour» was protecting).
- [x] Blank means back to the default: clearing a field and saving does not store `''`, it stores nothing,
      and the next read answers the default. No form here accepts a half-typed hour as a value.

### D. «Pedirle a la IA qué comidas quiero en el calendario»

- [x] The generate dialog has a selector of the four meal types (chips, default: all four), and it is a
      real filter, not decoration: `POST /api/ai/plan-week` accepts `mealTypes`, the prompt's JSON example
      is built from the chosen types in the order of the day, and `persistWeeklyPlan` inserts only those
      keys —so a house that does not eat breakfast stops getting breakfasts it has to delete by hand.
- [x] The response keeps telling how many slots were filled and how many were skipped because the user
      already had something there; the toast counts what actually happened (round 13b's rule).
- [x] A selected set of zero means «dame las cuatro», not «no generes nada» and not a 400: it is the same
      request as the unmodified default, and the dialog shows which is which.

### E. The tour lets you out of any step

- [x] Every step has its own «Saltar este paso» (the global «Saltar por ahora» stays for the whole tour),
      and skipping a step keeps whatever the previous steps saved —skipping «horarios» must not write
      empty hours.
- [x] The tour is a linear array of ids, so «which step is this» and «can I go back» come from the array
      and not from `ngSwitch` branches; the number in the header («Paso 3 de 6») is derived from the same
      array.
- [x] Keyboard: `Escape` skips the current step (never the whole tour), and `Enter` in a text input is the
      «siguiente» action, not a form submit that saves the world.

### Gates

- [x] Server vitest green, contract green with the new `mealTimes`/`mealTypes` keys (the contract file
      tests a new optional key the day it is added, so this box ticks itself), bridge green with the new
      pure modules, `tsc` (server, app, spec), `typecheck:e2e`, `check-ui` with the delete rule and the
      selector rule, production build.
- [x] No claim about pixels or about the tour's look: no Chromium here. What is asserted is the step
      machine, the payload the dialog sends, and the numbers the plan writes.

### What changed while doing it

- **The grid kept an anchor of its own.** The bullet above says the shipped hours become
  `MEAL_TIME_DEFAULTS` «imported by nothing else»; that turned out to be wrong in a useful way.
  `MEAL_ANCHOR_MINUTES` (08:30 / 14:00 / 17:30 / 21:00) stays in `core/calendar-grid.ts` as what the
  grid paints _before_ the profile answers, and `mealAnchors()` falls back to it per key. Without it,
  every untimed meal is placed at midnight for the ~200 ms the taste profile takes, which is a worse
  calendar than a slightly recoloked one. The two sets mean different things and say so in their
  comments: one is «what the app ships as a normal day», the other is «where an untimed block sits».
- **Blank and absent are different inside `mealTimes`.** `mealTimes: { dinner: '' }` deletes the dinner
  key (next read answers the default); `mealTimes: { dinner: '22:00' }` leaves the other three alone;
  no `mealTimes` at all touches nothing. That is the same absent/null contract the rest of the API
  uses, one level deeper, and it is why the Preferences tab and the tour send a patch of _changed_
  keys (`mealTimesPatch`) instead of the four visible ones —otherwise «look at the default» silently
  becomes «have the default saved», and a future change of the shipped hour would stop reaching houses
  that never chose anything.
- **The mirror between the two sides is a text comparison.** `frontend/src/app/core/meal-times.ts`
  cannot import `server/src/utils/taste-profile.ts` (the server file drags better-sqlite3, and
  `rootDir` makes the reverse import break the server build), so `server/src/utils/meal-times-mirror.spec.ts`
  reads both sources and compares the literals —defaults, the order of the day, and the Spanish names.
  It throws if a constant moves instead of passing quietly without comparing anything.
- **A selected set of only-unheard-of names also means «the whole day».** The checklist covers zero
  selected; the first implementation returned zero valid types for `['cena', 'postre']`, which reads as
  «plan nothing and insert nothing» —the quietest possible way to fail. `resolveMealTypes` (server) and
  `selectedMealTypes` (frontend) now fall back to all four when nothing survives, and both are tested.
- **The delete rule is a rule, not a list of screens.** `sin-confirmar-borrado` in `scripts/check-ui.mjs`
  walks every component, follows one level of delegation (a `removeMeal` that calls `removeMealById`,
  which does confirm), and keeps an `EXEMPT`-style `LEGACY` map with a mandatory reason per file. It
  found four real gaps and four false positives (`removeAllRanges`, `classList.remove`,
  `clearGenerated`, `clearTimeout`); the exceptions are in the rule, not in the components.
- **e2e written, not executed.** The tour cases (per-step skip, Esc/Enter, the hours step feeding
  Preferencias) and the invitation cases (one-member house says so; two members, mark, save, reopen with
  the mark still there, and the invited session sees the event) are in `tests/e2e/onboarding.spec.ts` and
  `tests/e2e/calendar.spec.ts`, and `npm run typecheck:e2e` passes. Nothing here ran them: the sandbox
  has no Chromium, and CI does.

### Gates as run

- Server vitest: **22 files, 559 tests** green (the contract file covers `mealTimes` on the PATCH without
  a new row, and `mealTimes` in `updateTasteSchema` inherits the whole «optional means optional» table).
- Bridge (pure frontend specs under the server's vitest): **12 files, 121 tests** green, including the two
  new modules `meal-times` and `onboarding-steps`.
- `tsc` clean for server, `tsconfig.app.json` and `tsconfig.spec.json`; `typecheck:e2e` clean;
  `check-ui`: **151 files, 9 reglas, sin incidencias**; `ng build --configuration production` OK with the
  two pre-existing component-CSS budget warnings and no new one.
- Against the live API (`tsx watch` on the dev database): a fresh account reads the four defaults,
  `PATCH {mealTimes:{dinner:'22:00'}}` merges without touching `taste`, `dinner:''` + `lunch:'13:30'` in
  one call clears one and sets the other, `lunch:'a comer'` is a 400 that names the field
  (`mealTimes.lunch: Almuerzo: usa HH:MM`), `mealTimes:''` is a 200 that changes nothing, and
  `POST /ai/plan-week {mealTypes:[…]}` parses (it fails later on the missing AI key, as expected).
- `npm run lint` is still not a gate, for the reason written in §12o.

### Coming soon, deliberately not here

- Per-house (not per-user) meal times. The schedule of a house is shared in real life; the preferences
  document this round touches is the account's, and making it the household's is a migration with its own
  arguments about who may change it.
- Letting the model return a time per dish («sobremesa a las 16:30») and honouring it —this round writes
  the house's hour, not the model's guess.
- Remembering the AI selector between generations (it resets to the four each time, which is the least
  surprising default while it is not configurable).

## 12q. Round 16 checklist — the copy says «por defecto», and everything you can press looks pressable

**Fuente de verdad actualizada para planificación del hogar:** los requisitos históricos de esta sección
describen `mealTimes` en Preferencias y el tour cuando la planificación aún era por cuenta. La extensión
de planificación del hogar en `HOGARIA-HOUSEHOLD-PLAN-SPEC.md` los supersede como ubicación efectiva:
los valores existentes se conservan como perfil/origen para inicializar el hogar o activar el override
personal, sin borrar ni migrar datos de forma destructiva. Desde ese cambio, la configuración común se
edita en Hogar > Planificación y cada miembro puede activar su propio horario/comidas.

Two sentences of feedback from the user, and they are the same complaint seen from both ends: the app
described a behaviour with the word for an empty canvas («en blanco») instead of the word for what
happens («por defecto»), and controls that do nothing when you hover them do not look like controls. The
first is copy; the second is the reason the copy had to exist at all — a field whose empty state _means_
something needs either a button or a sentence, and here it had a sentence that used the wrong word.

### A. «En blanco» is a pixel, not a meaning

- [x] `En blanco: 09:00` becomes `Por defecto: 09:00` in both places that show it (the tour's hours step
      and the Preferences tab). The sentence under the fields gets rewritten for the same reason: leaving
      a box empty here does not mean «this house has no lunch time», it means «use the one the app
      ships», and the copy has to say the consequence, not the colour of the input.
      Hecho: Sobrecumplido: la frase ya no existe en ninguna de las dos pantallas. El control hace lo que la
      frase explicaba (un boton «Por defecto» por fila tocada), y la cadena que quedaba se la llevo
      `app-meal-hours`.
- [x] Where empty really does mean _nothing_ — the hour of a single meal in the meal dialog, which round
      14 made clearable — the control and its copy say «quitar la hora». «En blanco» is not used for
      either case anywhere in the UI.
      Hecho: El dialog de la comida habla de «sin hora» y esa es la otra acepcion: no hay valor. Cero cadenas
      «en blanco» visibles en `frontend/src` (lo vigila la regla 10).
- [x] `texto-sin-en-blanco`, rule 10 in `scripts/check-ui.mjs`: no user-visible string in the frontend
      says «en blanco». Comments keep the phrase (a developer may talk about the canvas; a user is being
      told about a value), so the rule reads code lines and skips comment lines. It is written before the
      fix, and it fails on exactly the three strings this round is about.
      Hecho: Escrita, con la maquina de estados que se salta comentarios, y con los `.spec.ts` exentos: un
      test puede escribir la palabra para prohibirla.
- [x] `DESIGN-SYSTEM.md` gets the two words and when they are allowed, so the next empty-state copy is
      not a coin flip: _vacío / sin valor_ for «no value», _por defecto_ for «the value the app ships».
      Hecho: Dos subapartados: «Estados de interaccion» (tabla hover/focus/disabled) y «Vaciar un campo no es
      dejarlo en blanco».

### B. Everything you can press looks pressable

- [x] Global baseline in `styles.scss`: `button { border: none; background: none }` is a _reset_, and it
      was also the whole story for any button that did not opt into a component skin — the origin of «esto
      no parece un botón». From now on: a bare `<button>` (no class of its own) gets the design-system
      skin (border, background, padding, radius, hover, focus ring); every `label:has(input)` is
      `cursor: pointer` (the app's checkbox-as-card pattern was a clickable rectangle with an arrow);
      `:disabled` answers `not-allowed`, which explains itself, and every interactive element shares one
      `:focus-visible` ring instead of eight half-remembered ones.
      Hecho: Piel para `button:not([class])`, `label:has(input){cursor:pointer}` y
      `button:disabled{not-allowed}`. La opacidad del deshabilitado sigue siendo de cada componente: dos
      opacidades multiplicadas desaparecen.
- [x] `boton-sin-afecto`, rule 11: any `<button>`/`<a>` in a component template that carries its own class
      must have a hover or focus state in that component's styles — BEM modifiers count through their
      base (`.cal-btn--ghost` is covered by `.cal-btn:hover`), and any element that is clickable without
      being a button or a link (`label`, `div`, `tr`, `td` with `(click)`) must set `cursor: pointer`.
      Exemptions live in `LEGACY['boton-sin-afecto']` with a reason, same as the delete rule, and the
      list can only shrink.
      Hecho: Escrita: solo `<button>` (los `a` heredan del global), familia BEM resuelta por la base, bloques
      de `styles:` contados por llaves, un aviso por fichero+clase, mas el `cursor:pointer` de los
      `label|div|span|li|tr|td` con `(click)`. Y un guard que exige que el baseline global siga ahi: si
      alguien lo borra, la regla no se calla, protesta.
- [x] The 41 classes the rule found on its first run are fixed in this round, not forgiven: 20 in the
      shopping-line sheet, 9 in the shopping lists, and the rest in the calendar grid, the layout
      (sidebar, header), toast, password toggle, invite page, account/preferences inline links, recipe
      favourite, pantry appliance delete, settings reset and the log reconnect. They are grouped by
      screen into shared selector lists (`.detail__ghost:hover, .detail__more:hover { … }`) so the fix
      costs a few hundred bytes per file and not one block per class.
      Hecho: 36 arregladas en esta ronda (las otras 5 eran `<a>` o ya tenian su hover). Sin excepciones en
      `LEGACY`: perdonarlas era volver a tenerlas en seis meses.
- [x] The controls this program actually shipped last round get real treatment, not just a rule: the
      invited faces (`.cal-person`) have a border, a hover background and a pressed state that is not
      only a colour swap; «Saltar este paso» and «Saltar por ahora» in the tour stop being underlined
      text floating next to real buttons; and the links inside dialogs (`cal-link`,
      `preferences__inline-link`, `account__inline-link`, `invite-card__link`) keep looking like links —
      underline plus colour, no fake border — but react when hovered.
      Hecho: El campo de hora tiene la receta de `app-input` (borde, fondo, anillo) y los `onboarding__skip`
      han dejado de ser texto subrayado: pastilla con borde y hover.
- [x] `app-icon-button`/`app-button` are not touched: they already own their hover and focus, which is
      why the rule only inspects raw `class=` on `button`/`a` elements.
      Hecho: Intactos.

### C. The hours row, once, as a component

- [x] `app-meal-hours` (`shared/components/ui/meal-hours/`): the four rows the tour and Preferences were
      about to copy-paste, with `[(times)]`, an `idPrefix` so `#ob-meal-dinner` and `#meal-dinner` stay
      the ids the e2e specs already use, one `Por defecto` button per row, and the hint text next to the
      label instead of under it. Two rows of hand-copied CSS is how one of them ends up without a hover
      state, so there is one.
      Hecho: Creado, con `[(times)]`-es-mutar-en-sitio, `idPrefix` (los `#meal-dinner`/`#ob-meal-dinner` que
      buscan los e2e) y `dataTest`. Ocho tests en el puente; `MEAL_TIME_DEFAULTS` y `MealTimes` se han ido al
      modelo compartido porque un componente del design system no importa de `core/`.
- [x] The reset is an action, not a sentence: «Por defecto» writes the shipped hour into the form (which
      is the same thing as emptying it, but visible and reversible before saving), and it does not mark
      the row as changed when the value already _is_ the default — the dirty state and `mealTimesPatch`
      stay the single source of what gets sent.
      Hecho: El boton existe solo en la fila tocada; en la que vale lo de siempre no hay nada que deshacer.
- [x] The hour input has a minimum width and height of its own. A bare `type="time"` shrinks to the width
      of «20:3» on narrow columns, and its native spinner is 12 px on desktop: it is a field, it gets
      `--control-height`.
      Hecho: `min-width: 8.5rem` y `min-height: 40px` en el input, con su motivo escrito al lado.

### D. The `var(--token)` that does not exist (found while writing rule 11)

The hover audit turned out not to be the whole of «no parece un botón»: the hours inputs added last round
were styled with `var(--surface)`, `var(--border)`, `var(--text)`, and **no such token exists** in
`styles.scss` — it is `--bg-secondary`, `--border-default`, `--text-primary` here. CSS does not error on
an unknown custom property: the declaration is dropped, and the field arrives with no border, no
background and inherited colour. Which is exactly the screen the user is complaining about.

- [x] Rule 12, `token-inexistente`: every `var(--x)` used anywhere in `frontend/src` must be defined in
      some file of the frontend, or be a property that the same code sets at runtime —
      `[style.--hour-px]` counts, because that is how the grid passes geometry down. The three runtime
      ones (`--event-color`, `--hour-px`, `--swipe-x`) are the proof the rule can tell the difference.
      Hecho: Escrita, con exencion para los que se definen en tiempo de ejecucion (`[style.--x]`,
      `style="--x:"`, `setProperty`) y con sugerencia por familia del nombre. Ha pillado cuatro tokens mios y
      cinco que venian de antes.
- [x] The nine that were missing get fixed to their real token: the four of the hours inputs (this
      program's own bug, two files) and five pre-existing (`--color-warning` in the log viewer,
      `--duration-fast` in settings and the home-profile picker, `--primary-alpha` in the same picker,
      `--primary-soft` in `app-picker`, `--color-warning-400` in `app-rating`). Each is a style that was
      silently not being applied, not a cosmetic preference.
      Hecho: Nueve arreglados: cuatro del campo de hora (borrados con el bloque duplicado), `--color-warning`
      en logs (que tenia un fallback tapandolo), dos `--duration-fast`, `--primary-alpha`, `--primary-soft`,
      `--color-warning-400`.
- [x] The tokens the app _should_ have and does not: `--surface` and friends were invented because the
      names in use (`--bg-secondary`, `--text-primary`) do not say which is on top of which. Renaming is
      not this round (160 definitions, every screen); the rule is what stops the pile growing.
      Hecho: Sin renombrar nada, como decia el punto: 160 definiciones y todas las pantallas. La regla 12 es
      lo que evita que la pila crezca.

### E. Lo que la ronda no podia ver: el `*ngFor` sobre un getter congelaba la pantalla

Cerrada la tanda y probada en una maquina de verdad (Windows, el usuario), **la pantalla de Horarios se
colgaba**. Era de la ronda 19 y ningun gate la vio, asi que va aqui con su mecanismo:

- `app-meal-hours` itera `*ngFor="let row of rows"`, y `rows` era un getter que construa la array.
- `*ngFor` compara **identidad**: con una array nueva en cada ciclo, las cuatro filas se destruian y se
  volvian a montar; cada `input` nuevo con su `ngModel` escribia el valor en el modelo, el arbol se
  marcaba de nuevo, y el ciclo volvia. Zona.js no se queda nunca vacia: la pantalla deja de responder.
- Sin Chromium en el sandbox, ni el build, ni `tsc`, ni el puente de vitest, ni los 28 e2e de CI lo decian:
  el sintoma vive en el navegador. La preview de Arena tampoco lo reprodujo porque alli la pantalla se abria
  y se cerraba sin escribir en el campo, que es lo que dispara el bucle largo.

Arreglado con identidad estable (`rows` cacheada por `idPrefix` + `hints`) y `trackBy`, y con un test de
identidad en `meal-hours.component.spec.ts` —`toBe`, no `toEqual`, que es lo que comprueba el bucle. El mismo
hueco estaba en `app-chip-select` (`choices`); ahi no habia `ngModel` dentro del bucle, asi que no congelaba
pero si hacia parpadear chips y perder hover y foco: se memoiza por identidad del catalogo y contenido de la
seleccion, y se anade `trackBy` tambien.

Y la regla que lo impide, **13 en `check-ui`** (`ngfor-getter-sin-trackby`): un `*ngFor` que itera un getter
del propio componente lleva `trackBy`. Es mecanica y comprueba lo que se puede comprobar leyendo el fichero —
la clave de reutilizacion— en lugar de prohibir getters, que es una preferencia.

### Gates

- [x] `check-ui` with 12 rules (13 desde 12q-E) and no findings, `tsc` (server, app, spec), `typecheck:e2e`, server
      vitest, the bridge suite (including any pure module this round extracts), production build with no
      new budget warning beyond the two pre-existing ones.
      Hecho: Medido: «153 ficheros, 12 reglas, sin incidencias». `tsc` de app y spec limpios; 559/559 del
      server y 153/153 del puente (16 ficheros); `typecheck:e2e` limpio; build de produccion OK — las dos
      unicas warnings de budget son las dos de siempre (`shopping-list-detail` 19,52 kB y `calendar` 13,63 kB
      sobre 10), que han subido 1,7 kB con los estados de interaccion. No es una nueva.
- [x] The e2e written last round is re-read against the new ids (nothing renamed), and no claim is made
      about how any of this looks: still no Chromium here. Hover, focus ring and the width of a time
      input are the preview's judgement, and that is said in the PR instead of measured.
      Hecho: Revisado contra los ids y ampliado: el tour y Preferencias ahora comprueban que «Por defecto»
      aparece, actua y desaparece. Nada de esto se ha ejecutado: sigue sin haber Chromium, asi que como se ve
      (el hover, el anillo, el ancho del campo) es cosa de la preview, y se dice en el PR en vez de medirse
      aqui.

### Coming soon, deliberately not here

- `:active` and pressed states as tokens (`--state-*`) and the same treatment for `app-picker`'s options:
  the rule covers `button`/`a`/clickable rows, and a picker list is its own affordance discussion.
- Hover-only affordances need a touch answer: the sidebar and the row actions already show their controls
  on small screens; a systematic `@media (hover: none)` pass across the 47 components is a round of its
  own, and doing it halfway would leave a different app on a phone than on a laptop.
- Making the _global_ skin the only way to paint a button (component CSS keeps 144 hand-written
  variants). The rule now refuses a control with no state; collapsing the skins into tokens is the next
  step and it touches every screen.

## 12r. Round 20 checklist — la suite e2e no habia corrido nunca, y ahora se ve

Esta tanda no la pidio el usuario: la produjo la ronda 19 al arreglar `playwright.config.ts`, que apuntaba
a un reporter inexistente. Con un reporter que no esta, Playwright no llega al test numero 1 —falla el
proceso, no la asercion—, y asi llevaba la suite desde que se escribio. En el primer run real (CI, 4 shards
con Chromium) han salido **28 tests fallidos**: 9 en el shard 1 (`account`, `calendar`), 11 en el 2
(`onboarding`, `full-stack/*`), 8 en el 4 (`shopping-*`); el shard 3 entero en verde. Ninguno es de la ronda
19: los dos asserts nuevos de «Por defecto» (tour y Preferencias) pasaron.

La regla que hay que escribirse: **un test que no se ejecuta no es un test, es un comentario largo**. Los
gates de este proyecto se median «a mano» en un sandbox sin navegador, y eso esta bien para el codigo, pero
dejaba la capa e2e entera sin verificar durante ocho tandas.

### A. Triaje por causa, no por fichero

- [ ] 12 fallos son **selectores que ya no existen** o datos que el seed ya no pone: `[data-test="add-input"]`,
      `[data-test="selection-toolbar"]`, `[data-test="pay-sheet"]`, `[data-test="discount-amount"] input`,
      `.tab` con texto «Información», `[data-test="item-row"]` esperando filas que el seed actual no crea,
      y el email `@hogaria.test` (el helper genera `@example.com`). Se arregla el test, no la app, salvo que
      el selector haya desaparecido por un cambio real —entonces el que estaba mal era el test al revés.
- [ ] 4 son **aserciones sobre texto que cambio el producto**: `offer-chip` dice `3x1` donde el test queria
      `3x2` (el test no miraba el estado que se estaba poniendo), `photo-error` dice «El modelo no esta
      disponible ahora mismo» y el test esperaba «Falta configurar la IA». Decidir cual de los dos textos es
      el correcto para el usuario y alinear el otro; no silenciar el assert.
- [ ] 2 son **estrict mode de Playwright**: `input[name="chip-select-custom"]` resuelve a dos elementos
      porque hay dos `app-chip-select` en el mismo paso. El selector tiene que bajar al contenedor del paso
      (`page.locator('#ob-allergies').locator(...)`) y no al revés.
- [ ] 1 es un **click que no llega**: «Siguiente →» en el paso de gustos —hay que mirar si el boton esta
      deshabilitado por una validacion del propio paso o si hay un overlay; el log dice `waiting for element
to be visible, enabled and stable`, que es lo que separa un test mal escrito de una pantalla que
      bloquea.
- [ ] 6 son del **job full-stack**, y su causa es el entorno: `429` esperado y `404` recibido (los limites
      no se aplican igual cuando el server arranca con otra config), `results.json` que no se escribe, el
      404 de un asset que devuelve `text/html`, y dos cuentas del `request-budget` que cuentan los
      `@vite/client` del dev server en un build que deberia ser de produccion. Hay que separar «el stack
      roto» de «el test que corre contra el stack equivocado» antes de tocar nada.
- [ ] 2 del visor de logs: `logs-status` se queda en «Reintentando en 10 s» —el SSE no casa con el CI. Es
      el unico grupo que podria ser un defecto real de la app, y por eso va el primero en la lista.

### B. Que tiene que existir para que esto no vuelva

- [ ] El job de CI que corre los e2e **falla si `test-results/results.json` no aparece**. Ya lo hace el de
      full-stack (su mensaje existe: «Playwright no llego a escribir resultados»); falta en los shards
      normales, y es exactamente la red que habria convertido ocho tandas de e2e silenciosos en un rojo el
      dia uno. Es una linea en `.github/workflows/ci.yml`, no un proyecto.
- [ ] `tools/reporters/hogaria-e2e-reporter.js` se escribe o se olvida para siempre. Mientras el fichero no
      este, la configuracion apunta a la nada, y esto es la segunda ronda que lo descubre.
- [x] Un gate nuevo en `scripts/check-ui.mjs`: **toda cadena de `data-test` escrita en un spec e2e existe en
      alguna plantilla del frontend**. Es mecanica, es barata, y habria pillado 12 de los 28 antes de que nadie
      abriera el navegador. Los textos, no: esos cambian y el test debe poder discutirlos.
      Hecho en la tanda 20, y es la regla **17** (`data-test-huerfano`), no la 14: en medio se quedaron
      `texto-sin-traducir` (14), `clave-sin-traduccion` (15) y `pipe-sin-importar` (16). Vale tambien un
      literal que acabe en `-` y sea prefijo del nombre, porque `[attr.data-test]="'layer-' + kind"` nunca
      contiene el nombre entero y los e2e si lo conocen. Con la regla escrita: 104 nombres en los specs, 0
      huerfanos.

### Gates

- [ ] Los 28 con nombre y apellidos: cada uno o arreglado o marcado `test.skip` con un motivo de una linea
      (un skip sin motivo es la puerta por la que volvera el silencio).
- [ ] CI verde en el shard 1-4 y en full-stack, medido en el run, no afirmado desde el sandbox.

### Coming soon, deliberadamente fuera de aqui

- [ ] Ejecutar los e2e en local: no hay Chromium en esta maquina y no se va a instalar uno de 300 MB para
      una tanda. El navegador es CI, y eso obliga a que el gate de CI sea el bueno.

## 12s. Tanda 20 — todo texto de la interfaz pasa por el diccionario

Lo que reportó el usuario: al cambiar a inglés **quedan cosas en español**. Medido antes de tocar nada: 502
literales visibles en 29 plantillas y otras tantas cadenas en el código (avisos, confirmaciones, etiquetas de
opcionarios). El diccionario tenía 87 claves y las usaban tres componentes; el resto de la app estaba escrita a
mano en español. Así que esto no es «arreglar dos etiquetas»: es convertir el diccionario en el único sitio de
donde sale texto a la pantalla, y dejar una regla que no permita volver a escribir fuera.

### A. Qué es texto de la interfaz y qué es dato

- [ ] **Traducible**: lo que la app dice —títulos, botones, pistas, placeholders, `aria-label`, `title`,
      estados vacíos, avisos (`toast`), confirmaciones, nombres de comidas y de secciones cuando se _enseñan_.
- [ ] **Dato, no se toca**: lo que el usuario escribe o guarda (nombre de una categoría de la cesta, un
      alimento propio, una receta generada por la IA) y lo que viaja en un contrato: `MEAL_TYPE_LABELS` y
      `MEAL_TIME_META` siguen en español porque el server parsea la respuesta del modelo por esas cadenas
      (`taste-profile.ts` hace `formTime('Desayuno')`). Donde esas constantes se _pintan_, la pantalla usa
      `t('meal.<tipo>')`; donde se _envían_, siguen mandando el literal del contrato. Un refactor que
      tradujera el dato cambiaría el prompt de la IA.
- [ ] **Se queda como está, declarado**: lo que contesta el server (`error.message` del API, que se muestra
      tal cual en el toast) y el contenido generado por la IA. Traducir eso es `Accept-Language` en el
      server y un prompt bilingüe: es otra tanda, y está en Coming soon.

### B. Arquitectura del diccionario (como quedo)

- [ ] `core/i18n/dict/<dominio>.ts`, uno por pantalla (nav, auth, ui, dashboard, recipes, pantry, shopping,
      calendar, account, preferences, onboarding, ai-config, household, logs, settings). Cada fichero exporta
      `Pair = { es, en }`; `core/i18n/index.ts` los mezcla. Motivo: con 600 claves en un solo fichero el
      service sería ilegible y cualquier retoque generaría conflictos en todas las tandas a la vez.
- [ ] `type TranslationKey = keyof typeof DICTS.es`, y `t()`/la pipe la aceptan con ESOS valores. Con
      `strictTemplates` encendido, una clave mal escrita en una plantilla es **error de compilación**, no una
      clave visible en pantalla. Es la garantía real; la regla 15 del check-ui es la que además exige que
      exista en los dos idiomas (el compilador no ve `en`).
- [ ] Interpolación con `{param}` como hasta ahora (`{n} recetas`). Los textos que mezclaban contenido y
      `{{ }}` en la plantilla pasan a ser una clave con parámetro: `shopping.tab.pending = 'Pendientes ({n})'`,
      y no dos cadenas pegadas en la plantilla —juntar palabras en la plantilla es lo que impide traducir.
- [x] La etiqueta se calcula al renderizar (getter o método), nunca en un campo `readonly` de la clase: un
      campo se evalúa una vez al construir y no se entera del cambio de idioma. Donde el getter construye
      arrays para un `*ngFor`, se memoiza (misma lección que 12q-E: identidad estable).
      **Y la memoización no lleva el idioma en su clave**: `app-meal-hours` lo hacía y ya no. Lo que se guarda
      en el array es la `labelKey`, así que el cache vale para los dos idiomas y la pipe impura lo traduce al
      pintar. Efecto secundario deseado: el componente deja de inyectar `I18nService`, y sin `inject()` en el
      constructor sus specs vuelven a poder instanciarlo sin TestBed (el puente de vitest lo agradece).

### C. Reglas de guardia (14, 15 y 16 en `scripts/check-ui.mjs`)

- [ ] `texto-sin-traducir` (14): en `template:` no queda ningún literal con palabras fuera de una pipe `| t`
      —texto entre etiquetas y los atributos `placeholder`, `aria-label`, `title`, `label`, `alt`—. Se saltan
      comentarios, atributos técnicos (`class`, `id`, rutas, nombres de icono) y lo que ya está dentro de una
      expresión. Empieza con la lista de deuda en `LEGACY` por fichero (29) y **la lista solo puede encoger**;
      el objetivo de la tanda es dejarla a cero, así que la regla queda sin excepciones.
      Hecho: la lista de deuda de la 14 está **vacía** (los 111 casos que quedaban se cerraron en esta tanda,
      y `--sin-deuda` deja de tener sentido para esta regla). La cuenta entera: 502 literales al empezar, 0 al
      cerrar, en 177 ficheros.
- [ ] `clave-sin-traduccion` (15): toda clave referenciada (plantilla o `t(`) existe en `es` **y** en `en`, y
      toda clave de los diccionarios se usa en algún sitio. Los dos sentidos: si falta la clave, la pantalla
      sale en el idioma viejo o con la clave en crudo; si sobra, es texto muerto que alguien jurará vivo.
      Hecho: 0 claves sin inglés en los 22 diccionarios y 0 claves muertas (25 que había se borraron, y las
      cuatro de `common.*` que no usaba nadie también).
- [x] `pipe-sin-importar` (16): si la plantilla usa `| t`, el componente importa `TranslatePipe`. Nace
      porque NG8004 solo lo ve `ng build`, que es el único gate que mira plantillas: 40 segundos contra 15
      minutos de compilación. Y la 17 (`data-test-huerfano`) cierra la cuenta que quedó de 12r.

### D. CI con dos idiomas, y el test que faltaba (hecho)

- [x] `playwright.config.ts` fija `locale: 'es-ES'` en `use`. No es un capricho: con `language: 'auto'` y el
      Chromium de CI (`en-US`), el día que los textos pasen por el diccionario **toda la suite e2e escrita en
      español empieza a fallar contra una app que no está rota**. Un test cuyo idioma depende de la máquina
      no es un test; se ancla el locale y se dice. Y se ancla también la preferencia guardada
      (`hogar:v1:language = 'es'`) desde `tests/e2e/fixtures.ts` con un `addInitScript`: el `localStorage`
      sobrevive entre specs dentro del mismo worker, y quien corría después de una prueba de idioma probaba
      otra app.
- [x] e2e nuevo: en cada pantalla principal, cambiar a inglés y exigir que **no quede español** (se comprueba
      el texto visible contra una lista de palabras que solo existen en español: `Guardar`, `Añadir`,
      `Cancelar`, `Despensa`, `recetas`…), y volver a español y exigir lo mismo con las inglesas. Es el test
      que habria evitado esta tanda entera, y es barato porque el diccionario ya da el oráculo.
      Escrito en `tests/e2e/i18n-idioma.spec.ts`: 7 pantallas × 2 direcciones, y el oráculo es una lista de
      frases que solo existen en un idioma. Comprueba además `placeholder`, `title` y `aria-label`, que es
      donde el español se escondía (no salen en `innerText`) y tiene un test extra de la pipe impura: pulsar
      el idioma en Configuracion cambia 'Recipes' a 'Recetas' **sin navegar ni recargar**. Aquí no hay
      Chromium, así que corre en CI y su resultado va en el PR, como en 12r.
- [ ] `tests/e2e/settings-theme-i18n.spec.ts` pasa de «`/Claro|Light/`» a afirmar los dos textos por separado:
      la tolerancia a ambos idiomas era una coartada mientras la mitad de la app no se traducía.

### E. Convención de claves: una frase, una clave

- [x] **Un diccionario por pantalla** (`dict/<dominio>.ts`), y el dominio es el nombre de la carpeta del
      componente: `home-profile-picker` → `home_profile_picker`. No hay un `dict/comun.ts` donde acaban los
      restos: lo que se repite está en `ui.*` y `common.*` **a propósito**, y es lo primero que consulta el
      extractor antes de acuñar una clave nueva.
- [x] **El texto generado se copia, no se inventa**: una frase que sale de un `@Input` o de un placeholder
      larga se convierte en una clave con el propio texto (`account.tu_nombre_tu_foto`), y si lleva un número
      o un nombre dentro, el hueco es `{param}` (`calendar.month_more`, `logs.zona_detectada`). Las ~96 claves
      que ya existían conservan su `camelCase`; las nuevas van en `snake_case` porque es lo que produce el
      extractor y un refactor no se pone a renombrar lo que funciona.
- [x] **Los plurales se resuelven con dos claves**, no con una `s` pegada en la plantilla:
      `invite.miembro_uno` / `invite.miembros`, elegidos en un getter. `{{ n !== 1 ? 's' : '' }}` es
      gramática española escrita en el template, y en inglés no significa nada.
- [x] **Dentro del objeto de parámetros no puede haber una pipe**: `'k' | t:{name: x || ('otro' | t)}` no
      compila (los pipes van en la raíz del binding o en una rama de un ternario, no dentro de un objeto de
      argumentos). Cuando hizo falta un texto dentro de otro texto, salió un getter al `.ts` — `tu cuenta`
      en `account.displayName()`.
- [x] **Un `@Input` no lleva literal de fábrica**: `@Input() label = 'Unidad o formato'` se escribe al
      construir y se queda en español para siempre. Se deja el Input sin valor y el defecto se resuelve en un
      getter con `t()` (`app-unit-picker`, `app-home-profile-picker`). Eso es lo que denuncia la 14 en su
      última variante.
- [x] **Herramientas**: `scripts/i18n-extract.mjs` (repasa plantillas, reutiliza cualquier `texto → clave`
      que ya exista antes de acuñar, decodifica entidades porque un property binding no las decodifica, y
      escapa saltos de línea al escribir el diccionario) y `scripts/i18n-merge-dupes.mjs` (una frase, una
      clave: reescribe las comillas por toda la app y borra la línea duplicada; canónica
      `common.* > ui.* > nav.* > la más corta`). Reescribieron 40 referencias y dejaron 19 frases duplicadas
      en una sola clave.
- [x] **Lo que NO entra en el diccionario**, y no es una excusa sino el criterio: el dato que se guarda
      (`COMMON_ALLERGENS`, `COMMON_LIKES`, las categorías y alimentos que escribe la casa) porque traducirlo
      haría que la pantalla mienta sobre la base de datos; el contrato con la IA (`MEAL_TYPE_LABELS`,
      `MEAL_TIME_META.label`) porque esas cadenas las parsea el server; y las etiquetas de catálogo **sin
      consumidor** (`*_LABELS` de `shared/models/household.model.ts`), que se dejan y se anotan en §13 para
      que no se confundan con deuda de esta tanda.
- [x] **La deuda de emoji viaja con la clave**: `⏱️ {n}min`, `🤖 Configuración IA` o `📦 Despensa` seguían en
      el template cuando `check-ui` los perdonaba por fichero; al migrarlos se fueron dentro del diccionario,
      así que los `dict/*.ts` correspondientes entran en la lista de deuda de `sin-emoji` (cinco, y la lista
      solo puede encoger). Quitar el emoji de la clave es el paso que queda, y es el que ya estaba pedido.

### Gates (medidos al cerrar la tanda)

- [x] `check-ui`: **177 ficheros, 17 reglas, sin incidencias**, con la lista de deuda de la 14 vacía
      (hoy son 18: la regla que faltaba se ve en §12t-R).
- [x] `tsc` de app y de spec limpios; `typecheck:e2e` limpio; vitest del server **22 ficheros / 559 tests**;
      puente del frontend **16 ficheros / 155 tests**; `ng build --configuration production` **0 errores** (es
      el único gate que ve las plantillas: NG8004, NG8113 y NG5 de los que hablan arriba salen todos aquí).
- [ ] Los e2e: en CI, con el locale anclado. Aquí no hay navegador, así que la comprobación del cambio de
      idioma se trae a CI y se reporta el resultado en el PR, como en 12r.

### Coming soon, deliberadamente fuera de aquí

- [ ] `Accept-Language` en el server para los mensajes de error y los nombres que genera la IA.
- [ ] Fechas, números y dinero con el idioma activo (`Intl`): hoy el `DatePipe` de Angular usa la local
      del navegador, que no tiene por qué ser la del `language` de la app.
- [ ] Un tercer idioma: la estructura (`dict/<dominio>.ts` + `Pair`) lo permite sin tocar las pantallas.

## 12t. Tanda 21 — bloquear comidas del planificador, y eventos que se repiten

Pedidos por la persona que usa la app, los dos con su caso detras:

1. «Puedes hacer que la IA no te planifique parte del horario; por ejemplo, si solo quiero que planifique la
   cena, pues bloqueas las demas.» Hoy la eleccion de comidas es **por generacion** (el dialog de «Generar con
   IA» tiene cuatro checkboxes que vuelven a estar marcados la proxima vez). Lo que se pide es una
   preferencia de la casa: la cena se planifica, lo demas no, y asi se queda.
2. «En la creacion de eventos pueda repetirse: semanal, diario.» Un recado recurrente («sacar la basura los
   lunes») hoy se escribe a mano cada semana.

### T. Bloqueo de comidas por cuenta (`mealPlan`) — supersedido como configuración efectiva

La clave histórica `users.preferences.mealPlan` y su PATCH triestado se conservan durante la transición,
pero dejan de ser la fuente efectiva de `plan-week` y no son la ubicación de la configuración común.
Al crear un hogar pueden servir como valor semilla para sus comidas habilitadas; para una persona se usan
como valor personal solo cuando su override de horario está activado. La clave existente no se borra ni se
reescribe automáticamente. La configuración común, los overrides y sus permisos quedan definidos por
`HOGARIA-HOUSEHOLD-PLAN-SPEC.md` (extensión aprobada en PR #47). La sección siguiente sobre recurrencia
de eventos es independiente y sigue vigente.

**Estado del código en PR #47 (13-10-2026):** este párrafo describe el contrato de destino, no una
entrega completa. La API/persistencia/semilla del hogar y el alta con puerta de membresía tienen
implementación parcial y pruebas unitarias. El endpoint nuevo de propuesta semanal ya resuelve ajustes
por miembro y confirma de forma explícita tras revalidar; el `POST /api/ai/plan-week` legado todavía
lee preferencias antiguas y escribe sin esa vista previa. La UI de ajustes y propuesta semanal de
Hogar > Planificación, más el ajuste local de recetas por ración, están integrados. E2E aislada
sintética de ajustes pasa 2/2 (PC/móvil); propuesta pasa 2/2 con dos miembros, revisión/confirmación,
navegación entre subtabs y limpieza de contexto al cambiar de hogar. Faltan combinaciones de
preferencias y casos completos de restricciones. La E2E de onboarding verifica en Chromium y Mobile
Chrome que un HTTP 503 sintético conserva el formulario para reintentar y que el retry crea una sola
membership; el archivo pasa 6/6. Siguen faltando doble envío, alta/invitación real e
interrupción/reanudación, por lo que la casilla global permanece abierta. Una guarda adicional devuelve
`409 MEAL_PLAN_OVERRIDE_INCOMPLETE` antes de IA cuando un override personal activo carece de valor
explícito válido; su cobertura focal y E2E de ajustes pasan, pero no cierra el criterio completo de
configuración. Decisión del 13-10-2026: toda comida confirmada del plan del hogar será visible para
miembros activos con `calendar.view`, aunque esté asignada individualmente; esto no expone calendarios
personales ni metas, alergias, notas o prompts privados. Solo los participantes asignados podrán
registrar/corregir su consumo: la lectura no concede permiso de escritura. `GET /api/calendar` y
`/range` ya aplican esta regla; la regresión primero falló para un lector no asignado y luego pasan
60/60 tests focales (cobertura de ruta/almacén 88,43/79,56/94,52/90,74 % S/B/F/L), `tsc` y hooks.
La UI de calendario abre el registro de consumo solo para participantes explícitos con `calendar.view`;
otros miembros siguen viendo la comida doméstica pero no obtienen control de escritura. El endpoint
GET/PUT persiste realizada/no realizada, raciones reales, versión, idempotencia y ajustes de stock desde
el snapshot por ración. La regresión focal de consumo pasa 30 tests (schema/store/ruta) con cobertura
de ruta 88,67/80/100/91,83 % y store 89,77/80,83/100/92,59 % S/B/F/L; 92 tests de frontend pasan y el
E2E sintético de escritorio/móvil 2/2 verifica propuesta con proveedor local, confirmación, calendario,
teclado, persistencia de consumo y breakpoints estrechos. Capturas y comandos reproducibles están en
`HOGARIA-HOUSEHOLD-PLAN-SPEC.md`. La suite web/cobertura global integrada queda pendiente; por eso no
se marca `QA-HOME-MEALS.CONSUMPTION.1` completo todavía. La compra doméstica tiene preview de solo
lectura, UI de revisión editable y aprobación explícita que reconcilia filas `meal_plan` sin tocar
inventario ni borrar filas compradas/manuales. La ruta de aprobación pasa 14/14 focales; el E2E
sintético de escritorio/móvil pasa 2/2 e incluye cancelar/error sin escritura, aprobación, retry
idempotente y conservación de filas. La spec activa contiene capturas, comandos, cobertura y límites;
`QA-HOME-MEALS.SHOPPING.1` sigue pendiente de los gates integrados.

La proyección de tareas semanales en el calendario actual pasa 62/62 backend (cobertura de alcance
89,14/80,45/95,29/91,23 % S/B/F/L), 94/94 frontend y E2E sintética PC/móvil 2/2. Requiere membresía
activa y `calendar.view`; muestra título, fecha, estado, zona y asignatario activo, sin detalles de tarea
ni una hora inexistente en el modelo. Es de solo lectura y no modifica calendarios o permisos de
escritura. `QA-HOME-TASKS.CALENDAR.1` sigue pendiente de la matriz completa de breakpoints/teclado y
del gate global; sus capturas y comandos están en `HOGARIA-HOUSEHOLD-PLAN-SPEC.md`.

**Decisión de automatización (13-10-2026):** cada hogar debe elegir explícitamente día, hora local y
zona IANA antes de activarla; no se inferirá la zona del servidor o del navegador. Una hora local que
no existe por DST se ejecuta en la primera hora válida posterior; una hora duplicada se ejecuta una vez,
en la primera ocurrencia. Ante una ejecución automática de generación nueva, el usuario autorizó
publicar al calendario solo después de la misma validación del servidor; la propuesta manual mantiene
confirmación explícita y Compra siempre requiere aprobación. El helper puro de siguiente ocurrencia
pasó 16/16 con cobertura 96,1/97,36/100/95,94 % en esa primera etapa, cuando aún no existían
configuración persistente, worker ni ledger de ejecuciones. Contrato, decisiones de seguridad, comandos y pendientes en
`HOGARIA-HOUSEHOLD-PLAN-SPEC.md`.

La proyección de tareas semanales en el calendario existente ya tiene implementación backend/UI y
pruebas focales: **62/62** backend con cobertura de alcance 89,14/80,45/95,29/91,23 % S/B/F/L, **94/94**
frontend, typecheck del servidor y E2E sintética PC/móvil **2/2**. Requiere `calendar.view` y pertenencia
activa al hogar; las tarjetas muestran título, zona, estado y asignatario; el modelo semanal no define
hora y el JSON del calendario no expone detalles de tarea. No crea ni altera tareas, comidas o eventos
personales. El E2E final ya inspeccionó agenda, semana/timeline, mes y año, y las capturas PC/móvil; aún
falta la matriz completa de breakpoints/teclado y el gate global, por lo que
`QA-HOME-TASKS.CALENDAR.1` sigue abierto.
La spec activa contiene comandos, rutas de capturas, límites y rollback/evidencia de esta unidad.

**Trazabilidad de tareas semanales (2026-10-13):** la unidad `QA-HOME-TASKS.WEEKLY.2` de la
extensión de planificación está verificada en desktop y móvil, incluyendo equilibrio, días no
consecutivos, preservación de asignaciones manuales durante propuesta/uso explícito y persistencia tras
Guardar. Comando, capturas sintéticas, límites y resultado reproducible constan en
`HOGARIA-HOUSEHOLD-PLAN-SPEC.md`, «Estado de implementación y evidencia».

**Actualización de automatización (2026-10-13):** ahora hay configuración/ledger SQLite por hogar,
poller único, worker con fence de versión, modos generar/repetir, publicación transaccional, pausa y retry
explícito. Para «Generar» tareas el usuario eligió una propuesta nueva con IA, usando las zonas vigentes y
la última semana confirmada solo como contexto; el servidor asigna localmente y publica únicamente tras
validar ámbitos y comprobar que el destino no contiene cambios/conflictos manuales. «Repetir» copia la
última semana confirmada sin IA. Scheduler **4/4**, worker **14/14**, configuración/rutas **55/55** con
SQLite en memoria; E2E aislada de configuración **2/2 PC/móvil** cubre guardar/reanudar/pausar/cambiar
modo/guardar y la versión vigente tras acciones del aviso. No se envió proveedor real ni se ejecutó una
planificación desde este E2E. La aceptación global sigue abierta hasta cubrir el flujo integrado de
ocurrencia y los gates/matriz restantes; evidencia, comandos y capturas sintéticas en
`HOGARIA-HOUSEHOLD-PLAN-SPEC.md`.

### R. Recurrencia de los eventos de la casa

- [ ] **El dato, dos columnas**: `calendar_events.recurrence` (`'none' | 'daily' | 'weekly'`, `NOT NULL DEFAULT
'none'`) y `calendar_events.exceptions` (JSON de fechas `YYYY-MM-DD`, `DEFAULT '[]'`). Se anaden con el
      helper de `config/database.ts` que ya existe (`addColumnIfMissing`), sin tabla nueva y sin rebuild: una
      fila vieja es `'none'`, que es lo que era.
- [ ] **Una fila, no una fila por dia**. La serie vive en una fila y las ocurrencias se materializan al leer.
      El motivo es el mismo de «las comidas no se copian a `calendar_events`» (8f): dos verdades se
      desincronizan. Y hay un efecto secundario bueno —editar el titulo de la serie cambia los lunes de
      verdad, y borrar la serie no deja 30 filas huerfanas—.
- [ ] **Diario y semanal, y nada mas por ahora**: `daily` = cada dia desde `date`; `weekly` = el mismo dia de
      la semana de `date` (`getUTCDay` de la fecha ISO, nunca `new Date()` local, que en un navegador con otra
      zona corria los lunes). Mensual y «hasta el dia X» se van a §13 con su motivo: sin `until`, una serie es
      para siempre, y eso es honesto para un recado de la casa y mentira para una cita medica.
- [ ] **`exceptions` es el «solo este dia no»**: al borrar una ocurrencia concreta se anade SU fecha a la
      lista, y la serie sigue viva. Borrar la serie entera es lo que hace `DELETE /events/:id`, y el dialog lo
      dice con las letras: «Se quitan todas las repeticiones». Un evento que no se repite no tiene este
      dialogo: borra como sempre.
- [ ] **Se expande en un sitio**: `core/calendar-recurrence.ts` (nuevo, puro, con sus specs) y llamado desde
      el service al leer, de modo que mes, timeline, dia y el contador «+N» ven exactamente la misma lista. Un
      `computed` por vista que expandiera seria cuatro calendarios de la verdad.
- [ ] **El editor**: un `app-picker` «Repetir» con tres opciones. `PATCH` de una serie cambia la serie, no la
      ocurrencia pulsada, y el dialog lo avisa en una linea («Editas todos los lunes»); el «solo este dia»
      existe para quitar, no para renombrar. Renombrar un dia suelto habria exigido un modelo de ocurrencias
      propias, y eso es otra tanda.
- [ ] **La ventana**: se piden `from`/`to` al server y la serie se expande contra esa ventana, asi que el
      `LIMIT` de la consulta no corta ocurrencias (cuenta filas, no dias). Un `limit` de 200 filas con 40
      series diarias sigue siendo 40 filas.
- [ ] **Visibilidad e invitados sin cambios**: una ocurrencia es la fila de su serie, con su `editable` (solo
      el autor), sus `attendees` y su `source`. No se introduce «responder a una invitacion repetida».

### Idioma (12s, aplicado a lo nuevo)

- [ ] Todo texto nuevo sale de `dict/calendar.ts` y `dict/preferences.ts` con sus claves: «Que la IA la
      planifique», «bloqueadas en Preferencias», «Repetir», «No se repite», «Cada dia», «Cada semana»,
      «Editas todos los lunes», «Se quitan todas las repeticiones», «Quitar solo este dia». Nada de
      concatenar en la plantilla: lo que lleva una fecha o un numero dentro, lleva `{param}`.
- [ ] Un `@Input` nuevo, sin literal de fabrica; una lista de opciones, con `labelKey` o resuelta en un getter
      que llame a `t()` (las dos valen, lo que no vale es un `readonly` con el texto ya traducido).

### Gates

- [x] `node scripts/check-ui.mjs` en verde (18 reglas) —incluida la 14 sobre las plantillas nuevas y la 15
      sobre las claves nuevas.
- [ ] `tsc -p tsconfig.app.json` y `-p tsconfig.spec.json`, `npm run typecheck:e2e`.
- [ ] `vitest run` en `server/` (schema, POST/PATCH/DELETE de recurrencia, `mealPlan` en el PATCH de
      preferencias y en `persistWeeklyPlan`) y el puente del frontend (`calendar-recurrence`,
      `app-meal-hours` con el bloqueo).
- [ ] `ng build --configuration production` sin errores: es el unico que ve las plantillas.
- [ ] e2e: crear un evento semanal, ver los cuatro lunes, quitar uno, volver a entrar y que siga sin ese
      lunes; y bloquear la merienda, generar, y que la merienda no aparezca. Corre en CI (aqui no hay
      Chromium) y su resultado va en el PR.

### Fuera de aqui, con su motivo

- [ ] `until`/「cada N semanas»/mensual en la recurrencia: hacen falta, pero piden UI de calendario y una
      decision de que pasa con las ocurrencias pasadas. §13.
- [ ] El bloqueo en el tour de bienvenida (añadiria una pregunta a las seis prometidas) y un «silenciar este
      dia» que no sea borrar la ocurrencia. §13.

## 12t-R. Como ha quedado la tanda (recurrencia) y el cierre de i18n

Entregado sobre lo pedido en §12t. Lo que sigue es lo que esta en el codigo, con las decisiones que no se
ven desde la pantalla.

### Recurrencia de eventos (lo pedido: «que se pueda repetir, semanal, diario»)

- [x] Modelo: `HouseholdEvent.recurrence: 'none' | 'daily' | 'weekly'` y `seriesDate` (la fecha de la que
      arranca la serie). `HOUSEHOLD_RECURRENCES` + `HOUSEHOLD_RECURRENCE_META` (con `labelKey`, regla 15) en
      el modelo compartido, que es de donde salen a la vez las opciones del selector y el glifo de la pastilla.
- [x] BD: `recurrence TEXT NOT NULL DEFAULT 'none' CHECK (recurrence IN (...))` y
      `exceptions TEXT NOT NULL DEFAULT '[]'`, en el `CREATE` y via `addColumnIfMissing` para las bases ya
      creadas. Las excepciones se guardan como ISOs ordenadas, no como indices: un cambio de cadencia no
      descoloca las que ya existen.
- [x] Lectura: el GET pide el rango visible y expande **despues** del `LIMIT` (`expandOccurrences`), con
      `truncated: true` si se ha cortado. La fila de la serie es UNA fila en la BD: siete burbujas en la
      rejilla, no siete eventos.
- [x] Edicion: el modal abierto desde una burbuja muestra la fecha de ESA ocurrencia (`occurrenceDate`) y la
      de la serie (`seriesDate`); «Quitar solo este dia» llama a
      `DELETE /api/calendar/events/:id/occurrences/:date` (400 de formato, 404, 403 si no eres quien lo
      escribio, 400 `EVENTO_SIN_REPETICION`, idempotente). Mover la fecha de una serie quita esa fecha de las
      excepciones; pasar a `none` las borra todas.
- [x] El autor no es invitado, y `editable` sigue siendo solo del autor: una serie la cambia quien la apunto,
      el resto la ve y puede faltar a un dia.
- [x] e2e en `tests/e2e/calendar.spec.ts` (`Calendario — repeticiones`), medidos en la agenda del dia que es
      donde la app pinta las sueltas: la serie semanal aparece hoy y no ayer (habia que cambiar de dia con la
      flecha: contar la semana entera hubiera dependido de que la rejilla pinte cada dia, y eso es otra
      pantalla), la diaria se sostiene tambien el dia anterior, «quitar solo este dia» deja el hueco vacia y
      el dia de al lado en pie, y una suelta normal no repite ni lleva glifo. Playwright no corre aqui (no hay
      Chromium); el job corre en CI.

### Un arreglo que la prueba en vivo se nego a callar

- [x] `PATCH /auth/taste` con `mealPlan: null` (y el mismo caso en `mealTimes`) no borraba nada: la rama era
      `if (patch.mealPlan)` y `null` es falsy, asi que el tri-estado prometido se quedaba en dos estados.
      Verificado contra el servidor en marcha con la BD real, escrito el test primero (rojo: 2 pruebas) y
      arreglado con la rama `=== null` antes del `if` ✓ 592 pruebas en el server. El flujo de la pantalla no
      estaba roto (`mealPlanPatch()` nunca manda un `null` de nivel superior: manda las comidas cambiadas, y
      `null` por clave ya borraba esa clave), pero la garantia escrita en el contrato mentia.

### Cierre del i18n (lo pedido en la ronda 20: «usa siempre el sistema de traducciones»)

- [x] Regla 18 del gate: todo literal con pinta de frase que acabe en un sink (`toast.*`, `*Error.set`,
      `note`, `title`, ...) tiene que salir de `t()`. Ademas de los setters, cubre `return 'prosa'`, el
      `cond ? 'prosa' : 'prosa'` dentro de `t()` y las variables `t(clave)` - no el «solo literales» que
      dejaba fuera los helpers. El receptor puede tener tramos intermedios (`this.formErrors.name.set('...')`
      cuenta igual que `this.photoError.set('...')`), que era el hueco por donde se escurrian los dos errores
      del formulario de despensa.
- [x] Locale de formato en un unico sitio: `core/time.ts` guarda `dateLocale()` y el `I18nService` la fija
      (`en` → `en-GB`, lo demas → `es-ES`) en su `effect` y en `languagechange`. Se acabaron los 15 `'es-ES'`
      repartidos: fechas, dias de la semana, kcal, «X personas», tamaños de almacen y los memoizadores de
      `calendar.util` (la clave de cache lleva el idioma dentro, si no, cambiar de idioma no se notaba).
- [x] Lo que devolvian los helpers puros es clave, no frase: `AvatarIssue {clave, params}` (viaja por los
      `catch` como un `Error` normal), `pendingLabelKey`, `stepLabel()` → descriptor
      `{numero, total, tituloKey, skipped}` que la pantalla arma con `onboarding.paso_de` y
      `onboarding.sin_responder`, `describeLineDiscount(discount, {unidad, unidades})`, `facesOf`/
      `periodShortLabel`/`sourceLabel` por clave. Un modulo sin inyeccion no puede saber de idioma: ahora
      tampoco lo finge.
- [x] Prosa que se quedaba fuera del gate y ya no esta: etiquetas del boton «+ Agregar» de despensa, errores
      de `formErrors.name/quantity`, los dos estados vacios de las listas de la compra, la nota en vivo del
      SSE, `linkVariants` («sin tienda»), el mapa de errores de la foto del ticket y los avisos del tour al
      guardar/saltar. Las claves nuevas mantienen el texto en español identico al anterior: los e2e que
      asertan texto en suelto siguen valiendo.

### Deuda i18n que se queda, escrita para que la proxima tanda no la re-descubra

- [ ] Catalogos de `features/pantry/pantry.component.ts` (`utensilCategoryOptions` y el de electrodomesticos,
      ~20 `label:` en castellano dentro de un campo): se arreglan pasando a `labelKey` + un `computed` que
      mappea con `t()`, igual que `kindOptions` en el calendario. No los ve la regla 18 porque un campo con
      objetos no es un sink.
- [ ] `shopping-list-detail.component.ts`: `discountKinds`/`discountScopes` tienen `label:`/`hint:` en prosa
      y, encima, las etiquetas se guardan como dato en `data.targets`. Cambiar la frase sin migrar los
      objetivos ya guardados rompería los descuentos existentes: hace falta clave + migracion, no un `t()`.
- [ ] Catálogos de `shared/models/taste-profile.ts`: son datos persistidos que viajan al prompt del modelo
      (`preferences.tastes`), no etiquetas de UI. Traducirlos exige migrar el perfil; se deja para su tanda.
- [ ] `shopping.model.ts` (`hint:` de las promos de ejemplo) y `pantry.model.ts:105` («Utensilios de cocina»):
      texto de siembra/dato, no de interfaz.

### Gates (como han salido)

- [x] `node scripts/check-ui.mjs`: 177 ficheros, 18 reglas, sin incidencias. Con `--sin-deuda` (el modo que
      ignora las listas LEGACY para medir lo que queda de una migracion) salen 338 avisos y **ninguno** es de
      las reglas 14-18: 321 son `sin-emoji` dentro de los diccionarios y 11 `sin-select-nativo`, deuda que ya
      esta apuntada en `DESIGN-SYSTEM.md` con su decision pendiente.
- [x] `tsc -p tsconfig.app.json` y `-p tsconfig.spec.json`, `npm run typecheck:e2e`.
- [x] `vitest run` en `server/`: 23 ficheros, 590 pruebas (expansion, excepciones, permisos, `mealPlan`,
      `persistWeeklyPlan`).
- [x] Puente del frontend (`tmp-frontend.vitest.config.ts`): 16 ficheros, 144 pruebas, con las firmas nuevas
      de `stepLabel`, `pendingLabelKey` y `AvatarIssue`.
- [x] `ng build --configuration production` sin errores.

## 12u. Tanda 21 — lo que sigue saliendo en español cuando el idioma es inglés

La tanda 20 cerró los canales por los que yo había mirado: la clave sin traducir, la llamada de servicio, el
`aria-label`, los módulos puros. El parte de esta sigue teniendo el mismo síntoma en **nueve sitios más**, y los
nueve eran texto que ninguna de mis reglas leía. El inventario (151 candidatos en 18 ficheros) está en
`/home/user/scratch-round22/censo.txt`; lo que sigue es la lectura de ese inventario, que es lo que hay que
arreglar, no la lista.

**La causa, en una frase: un catálogo pinta lo que lleva dentro.** `tabs = [{ label: 'Todas' }, …]` y en la
plantilla `{{ tab.label }}`. Como el texto está en el `.ts` y el `{{ }}` no lleva ni clave ni `| t`, las tres
pruebas de la ronda 20 pasan de largo: la 2 mira el argumento del `t()`, la 3 la llamada de servicio, la 14 el
texto _plano_ de la plantilla. Afecta a varias pantallas de golpe porque el catálogo es un `shared/models/*.ts`
(`MEAL_TYPE_META`, `OFFER_PRESETS`, `unit-families`) o una lista de columnas, y eso lo pintan a la vez el
calendario, la lista, el detalle y el modal.

Los casos, con lo que hay que hacer en cada uno:

- **Calendario — la etiqueta de la comida**: `calendar.component.ts:526` pinta
  `{{ MEAL_TYPE_META[draft.mealType].label }}`. `MEAL_TYPE_META.label` y `addAction` son **dato del contrato con
  la IA** (el planificador busca la comida por esas cadenas), así que no se traducen y no se tocan: se renombran
  **`aiLabel`**, que es lo que son. Pintar pasa por `MEAL_LABEL_KEYS` (`core/i18n/labels.ts`) con `| t`, que ya
  existía para eso. Renombrar en vez de «explicarlo con un comentario» obliga a que cada punto que pinta la
  etiqueta salga del diccionario, y el compilador lleva la cuenta.
- **Las pestañas**: `recipes.component.ts` (`Todas`/`Favoritas`/`Rápidas`/`IA`), `logs.component.ts` (fuentes y
  niveles), `account.component.ts` (secciones), `pantry.component.ts` (`+ Agregar`, `Caducado`),
  `shopping-lists.component.ts` (`Activas`/`Todas`/`Archivadas`). `label: 'X'` pasa a `labelKey: 'domain.x'` (un
  `TranslationKey`), y la plantilla pinta `{{ tab.labelKey | t }}`. Donde el catálogo alimenta un `PickerOption[]`
  (`{ value, label }`) la traducción se resuelve en el `computed`, que es lo que ya hacen
  `meal-hours.component.ts` con `row.labelKey` y la ronda 20 con `STEP_TITLE_KEYS`.
- **Catálogos de modelo**: `unit-families.ts` (familias de medida), `OFFER_PRESETS` de `shopping.model.ts` (los
  `hint:` de 3x2/2x1/4x3/5x4), `shopping.model.ts:242/250` (`'Otros'` de secciones y targets). Mismo trato: la
  clave viaja en el dato, la frase está en el diccionario.
- **La tabla de listas**: columnas `{ key: 'lista', name: 'Lista' }` → `nameKey`, `Actualizado` igual. Y el
  tiempo relativo: «hace 1 d» no es texto de plantilla, es una etiqueta compuesta, así que se compone con
  `Intl.RelativeTimeFormat` sobre `dateLocale()` (la regla de la ronda 20: el locale de formato es uno solo) y
  las unidades salen del diccionario, no del `'d'`/`'h'`/`'min'` escrito en el código.
- **El modal de «añadir descuento»**: `discountKinds`/`discountScopes` (`Porcentaje`/`Importe`,
  `Toda la cesta`/`Primeras unidades`/`En productos`/`En secciones`, y sus `hint:`). Aquí hay trampa de datos: el
  valor que se persiste es la **etiqueta**. Se separan las dos cosas: `value` (lo que se guarda, inmutable) y
  `labelKey` (lo que se enseña). Lo guardado con una etiqueta en español no se reescribe: se sigue leyendo tal
  cual y se pinta traducida.
- **La barra de selección**: `<span>{{ selection().length }} seleccionadas</span>` — texto pegado a una
  interpolación. Va al diccionario con parámetro: `| t: { count }`.
- **`logs.component.ts statusLabel()`**: un getter que devuelve `'En vivo'`/`'Sin conexion'`. Devuelve la clave y
  la pantalla traduce; el texto ya está en `dict/logs.ts`.
- **`time-format.pipe.ts`**: `'0 min'`, `'2 h 15 min'`. Un pipe **puede** inyectar `I18nService` (no es un modelo
  puro), así que traduce sus unidades dentro, en vez de exportar claves para que las descifre quien lo usa, que
  era la salida fácil y dejaba el formato repartido en cuatro sitios.
- **Household**: `{ admin: 'Admin', member: 'Miembro', child: 'Niño' }` es un **record**, no un array con `label:`,
  y por eso la regla nueva tampoco lo veía: se detecta por valor con inicial mayúscula.
- **Preferencias**: las pestañas ya iban por `labelKey` ✓, y el diccionario está limpio (auditado: 891 claves, 24
  con `Es == En`, y solo dos de ellas con motivo — `' / {target} kcal'` y `'HogarIA — terminal'`). Lo que quedaba
  eran catálogos de `shared/models/taste-profile.ts`. **Excepción documentada y con motivo de datos**: esos
  catálogos son lo que se **persiste** en `preferences.tastes` y lo que se manda al prompt
  (`likes`/`dislikes`/`allergens`/`restrictions`). Traducir la etiqueta cambiaría lo que se guarda y lo que
  entiende el modelo. Donde el dato es una clave conocida se muestra su traducción; donde es texto libre del
  usuario, se pinta tal cual porque es su texto.

**La regla que lo impide** — `check-ui.mjs`, regla 19 `texto-en-un-catalogo`, sobre todos los `.ts` (excepto
`*.spec.ts` y `core/i18n`):

- **(a)** un campo de presentación (`label`, `labels`, `name`, `title`, `subtitle`, `placeholder`, `hint`, `text`,
  `description`, `emptyTitle`, `emptyText`, `legend`, `actionLabel`, `tooltip`, `caption`) cuyo valor es un
  literal que `isProse` aprueba. El criterio que separa el texto del dato es la **caja**: `danger`, `bottom`,
  `tray__row--head`, `repeat` no se leen; «Todas», «Importe», «Lista» sí. Todo en minúsculas se perdona; en
  cuanto hay inicial mayúscula o tilde, es interfaz. Claves del diccionario (`ui.ok`), unidades y `NOT_TEXT`
  también se perdonan.
- **(b)** un getter o función `*Label`/`*Text`/`*Title`/`*Hint`/`describe*`/`labelFor`/`titleFor` que devuelve un
  literal de prosa.

Y en la plantilla (regla 14 ampliada) los dos huecos que la ronda 20 dejó abiertos:

- **texto pegado a una interpolación**: `{{ a }} seleccionadas {{ b }}`. Al escanear, cada `{{ … }}` se sustituye
  por un centinela del mismo largo (los desplazamientos siguen siendo los del fichero crudo, que es lo que se
  imprime en el aviso) y el ancla del texto pasa a ser `>` **o** centinela.
- **prosa en un atributo**: `aria-label="Añadir por foto"`, `title="Ver detalle"`. Un atributo de accesibilidad o
  de ayuda con más de una palabra y sin punto de clave es texto de interfaz, y corre la misma suerte: `| t`.

Lo que **no** es incidencia y no hay que «arreglar»:

- los `data-test` (contrato del e2e), `theme.service.ts:159` (un `console.log`) y los mensajes internos del
  cliente (`'respuesta vacia'` en `shopping.service.ts:731`): eso es un código que el cliente traduce, y el
  contrato lo decide `## 14`, no esta tanda;
- los nombres de idioma en el selector (`Español` / `English`): se enseñan **en su propio idioma a propósito**,
  que es la única forma de que un hablante los reconozca.

```text
[x] Catálogos con label/name/hint/text en shared/models y unit-families → labelKey, y todos sus puntos de pintura.
[x] MEAL_TYPE_META: fuera `label` y `addAction` (no los leía nadie) y el modal del calendario pinta `mealLabel()`.
[x] Recipes tabs · logs (fuentes, niveles, statusLabel) · account tabs · pantry (categorías, cacharros, filtros).
[x] shopping-lists (tabs, filtros, columnas, tiempo relativo) · shopping-list-detail (línea, descuento, foto,
    historial, barra de selección), separando en discountKinds/Scopes el valor persistido de la etiqueta.
[x] Pipes: `difficulty` traduce por dentro con su lógica pura al lado; `time-format` se borra (no lo usaba nadie).
[x] Regla 19 en check-ui.mjs, con (a) campos, (b) getters y (c) records, y la regla 14 abierta a los nodos de
    texto que empiezan justo detrás de una interpolación.
[x] 59 claves nuevas en los diccionarios de los siete dominios tocados (Es y En a la vez, que es como el tipo
    exige la paridad: falta una y no compila).
[x] Gates: check-ui 175 ficheros · 19 reglas · 0 incidencias · `tsc` de la app y de los specs · `typecheck:e2e` ·
    puente de vitest 12 ficheros / 109 pruebas · server 23 / 592 · `ng build --configuration production`.
[x] El test espejo (`meal-times-mirror`) reescrito para comparar el server con la clave del diccionario: era el
    `MEAL_TYPE_LABELS` que he borrado, y ahora vigila además que lo que se ensena sea lo que se le dice a la IA.
```

**Lo que la regla nueva no veía y la ampliación de la 14 sí.** Al abrir los nodos de texto que pegan a una
interpolación salieron **nueve textos más** en cinco pantallas: `{{ n }} configuraciones`, `{{ n }} miembros`,
`{{ n }} recetas`, dos veces `{{ cantidad }} {{ unidad }} de {{ nombre }}`, `Paso {{ n }}`, `Usar {{ importe }}`,
`{{ rango }} de {{ total }}` en el paginador y `pronto` del selector de secciones. Ninguno es una frase suelta:
todos llevan un número dentro, así que la única salida honesta era la clave con `{parametros}`. Y como cuatro de
los nueve son contadores con sustantivo, `I18nService` gana `plural(cantidad, claveUno, claveVarios, params)` —
en castellano la terminación del sustantivo y en inglés la `s` final son la misma decisión, y ninguna de las dos
cabe en un `{{ n }} + 'recetas'`.

**Dos cosas que se han caído del árbol, y por qué.** `time-format.pipe.ts` (con su spec): no lo consumía nadie y
sus `'2 h 15 min'` eran español escrito dentro del pipe —traducirlo habría sido cuidar un cadáver. Los cinco
`Record<Rol, string>` de `household.model.ts`, los dos de `user.model.ts` y el de `ai-config.model.ts`:
exportados desde el barril y sin un solo lector. Borrajos, no `labelKey`: menos código y el mismo idioma.

**Dónde estoy (2026-09-21, cierre de la tanda).** La lista de trabajo la generó el gate, no el parte: 141
incidencias, 86 de ellas reales tras quitar los comentarios del barrido, 0 al final de la tanda con las 19 reglas
activas. La salida en `es-ES` no cambia: cada clave nueva del diccionario lleva exactamente la cadena que estaba
escrita en el código, así que el `| t` añade una vuelta y no una reescritura, y los e2e que assertan texto en
español siguen assertando lo mismo. Lo que **no** he podido comprobar aquí: el render (no hay navegador en el
sandbox; `ng test` necesita ChromeHeadless y `ng lint` no puede correr porque `frontend/package.json` declara
`ng lint` sin tener `@angular-eslint/builder` entre sus dependencias —deuda apuntada en `## 13`).

**Y despues del 0, nueve mas (ampliar la regla 14).** Con el texto de nodo ya medido, la regla 14 —«toda
cadena en negrita o titulo de bloque va por clave»— tenia un angulo ciego: perdonaba cualquier nodo cuyo
texto empezara con una interpolacion porque `isProse` exigia mayuscula o tilde, y un nodo que empieza con el
numero de una seleccion (`{{ n }} seleccionadas`) empieza en minuscula. Es la cadena que responde al «12
elementos seleccionados» de `list-toolbar`, `batch-assign-category-dialog`, `shopping-list-detail`,
`calendar-batch-*`, `inventory` y `bulk` — seis pantallas que decian una cifra en castellano con el idioma
en ingles. No he metido una exencion: el predicado de nodo (`esProsaDeNodo`) es mas estricto que el de
atributo, porque un nodo de texto no puede contener una clase CSS, una URL ni una ruta, que es exactamente
lo que justifica la laxitud de la otra. El mismo paso se ha llevado por delante `Difficult: fácil` de la
ficha de receta (con el `strong` dentro del `h3`, la regla 14 lo miraba y le pasaba de largo) y el «1
configuraciones / 3 miembros» de Configuracion de IA y Gestion de hogar, que eran texto plano sin etiqueta.

**Un plural no es una cadena: es dos.** «1 configuraciones» estaba mal escrito hasta en castellano, y eso
es lo que hacia visible la traduccion. En el diccionario es `ai_config.n_configuraciones_uno` y `..._varios`
con `{count}`, y el servicio tiene `plural(cantidad, claveUno, claveVarios, params)` que elige; la pantalla
no hace aritmetica de genero ni de numero. La regla vale igual para `household.n_miembros_uno/_varios` y
`recipes.n_recetas_uno/_varios`. Los nombres en plural de los idiomas en el selector (`IDIOMA_LABELS`) son
nombre propio y se quedan, porque el `option` de un `select` nativo no admite nada que no sea texto.

**Un catalogo pintado no es lo mismo que un catalogo guardado.** Los alergenos, los gustos y las aversiones
del onboarding y de Preferencias, y las categorias de las listas de la compra, se guardan y viajan al prompt
en castellano: son el dato, y traducirlos romperia la canonizacion de `core/normalize.ts` y la relectura que
hace la IA. Lo que se ensena pasa por un mapa valor → clave (`TASTE_VALUE_LABEL_KEYS`,
`LIST_CATEGORY_LABEL_KEYS` en `core/i18n/labels.ts`), y lo que la persona escribio a mano se pinta tal cual
porque es su texto. `app-chip-select` resuelve la etiqueta en un unico punto, asi que picker y fichas
guardadas hablan el mismo idioma. Que `preferences.tab_allergies` ya estuviera traducido no significa nada:
lo que se veia debajo no lo estaba, y ese era el parte del usuario.

**Como ha quedado la tanda (2026-09-21, cierre).** Las dos reglas que miden esto son la 14 (ningun texto de
la interfaz se escribe a mano: texto desnudo en plantilla, nodos con interpolacion delante, y atributos
`aria-label`/`placeholder`/`title`/`alt`) y la 19 (la etiqueta de un catalogo no se escribe en el catalogo),
ampliada la 14 con `esProsaDeNodo`. Gate: **0 incidencias en 175 ficheros, 19 reglas**. 141 candidatos → 86 → 59 → 0, mas las 9 de la 14. Once dominios del diccionario han
ganado **198 claves** en los siete commits de la tanda (122 en los cinco primeros y 76 en el ultimo: 65 de
alergenos y gustos del perfil, 10 de categorias de la compra incluido «En el carro», y la del estado «Pendiente»
de la prueba del proveedor de IA); `relativeTimeEscofina` ha muerto (seis llamadas y cero
pruebas) en favor de `relativeTimeParts`, que devuelve piezas y deja la frase al diccionario, y
`time-format.pipe.ts` ha muerto con su spec porque nadie lo importaba. El spec y `DESIGN-SYSTEM.md` dicen lo
mismo, que es la prueba de que la regla esta en el sistema y no en mi memoria. Puente vitest 12 ficheros /
109 pruebas, suite del server 23/592, `tsc` de app y spec limpios, `typecheck:e2e` limpio y build de
produccion sin un error nuevo (siguen los dos avisos de budget de siempre, mas los `NG8107`/`TS-998113`
preexistentes).

**Lo que sigue siendo deuda, y no es de esta tanda.** `ng lint` esta declarado en `frontend/package.json`
pero no se puede ejecutar: faltan los paquetes `@angular-eslint/*`, y no he instalado dependencias nuevas
para arreglarlo (aqui `pnpm install` necesita `--no-frozen-lockfile` y reconstruir nativos). Mientras tanto
el gate propio es el que manda. Y, otra vez, aqui no hay navegador: ni Karma, ni Playwright. El `describe.skip`
del spec de `pantry-section` no se ha quitado porque no hay forma honesta de ejecutarlo; el puente de vitest
que si lo hace esta montado para los modulos puros y sus tests (12 ficheros) y el resto se queda para una
maquina con Chrome.

## 12v. Tanda 23 — la clave que se ve en pantalla, y el sufijo que la regla 14 no leía

> «Hay traducciones rotas y sitios donde aun quedan textos fijos como en setting y placeholders etc, revisa de nuevo» (con captura: la pestana
> «Perfil» de Preferencias pone `profile.cooking.none` debajo del titulo).

**Que significa «traduccion rota» aqui, y que no significa.** La clave existía en los dos idiomas, el diccionario estaba
completo y simétrico (una sonda sobre los 21 pares `Es`/`En` devuelve 0 asimetrías y 0 calcos). Lo roto es lo último que
recorre la app: `profileLabel()` devolvía **la clave** y el hueco de texto la pintaba. Un `{{ }}` de Angular acepta
cualquier `string`, así que ni el compilador, ni la regla 15 (que busca literales dentro de un `t(` o de un `| t`), ni
los 592 tests del server tenían forma de quejarse. De ahí la regla nueva (20, `clave-pintada-desnuda`), que no
persigue el traductor roto sino el **contrato del miembro**: lo que se pinta sale traducido o se llama `*Key`.

**Y «placeholders etc» era un agujero del propio gate, no una lista de sitios.** La regla 14 comparaba el nombre del
atributo contra una lista cerrada (`placeholder`, `label`, `title`, `aria-label`…), y el texto se guardaba en atributos
que la lista no tenía: `customPlaceholder`, `searchPlaceholder`, `emptyText`, `hint`, `levelLabel`, `data-label`. La
lista se ha sustituido por un **sufijo**: si el nombre del atributo, pasado a kebab, acaba en `label|title|heading|
message|hint|placeholder|text|subtitle|description|question|tooltip|alt`, es texto y alguien lo lee. `data-label` se
queda dentro a propósito: en la bandeja de listas lo consume CSS con `content: attr(data-label)` y se ve en la fila
de móvil.

**Censo medido con las dos reglas ya escritas, antes de tocar nada: 25 incidencias** (21 de atributo, 4 de clave
desnuda) en 7 ficheros: `onboarding` (4), `preferences` (6: 5 atributos + `profileLabel`), `shopping-list-detail` (4),
`shopping-lists` (6 `data-label` de la bandeja), `unit-picker` (2), `account` (2: `passwordStrengthLabel` con sus
cinco palabras y `cookingLevel` devolviendo clave + `'Sin marcar'`), `household` (`getLevelLabel`).

### Checklist

- [x] La regla 20 existe y está afinada con un fichero de prueba dentro del árbol (`features/tmp-fixture/`), creado,
      medido y borrado en la misma tanda: las tres formas malas (atributo estático con sufijo de texto, `{{ 'clave' }}`
      sin `| t`, getter `*Label` que devuelve prosa o clave) salen, y las cuatro buenas (`[hint]="'k' | t"`, getter que
      traduce dentro, objeto con `labelKey`, miembro acabado en `Key`) no. Sin esto la regla es un chiste: una regla que
      no sabe callarse se quita, y una que no sabe hablar no guarda nada.
- [x] 20 tiene tres brazos escritos, no uno: **a)** plantilla con clave literal sin traductor; **b)** miembro con nombre
      de texto (`*Label`, `*Title`, `*Message`, `*Hint`, `*Placeholder`, `*Subtitle`, `*Description`, `*Question`) que
      devuelve la clave de un catálogo o la prosa en español; **c)** el mismo defecto en un miembro que no se llama como
      texto, que es como se coló `readonly cookingLevel = computed(...)` en Mi cuenta. El brazo **c)** exonera la
      propiedad `labelKey: MAPA[type]` (construir la clave es el patrón correcto: quien pinta traduce) y exonera al
      miembro acabado en `Key` (es lo que su nombre promete).
- [x] La regla 14 deja de llevar una lista cerrada de atributos, y la lista vieja se queda comentada como documentación
      de los casos que la empujaron, no como filtro.
- [x] Las 25 incidencias traducidas, con la cadena en español **byte a byte** la que estaba escrita (aserciones e2e e
      historia de la app: cambiar el texto no es trabajo de esta tanda), y reutilizando claves que ya existían cuando
      existían: los `data-label` de la bandeja pintan las mismas `shopping_lists.columna_*` que la cabecera de la tabla
      —un dato, una clave—; `levelLabel` en Preferencias se **borra** en vez de traducirse, porque `home-profile-picker`
      ya tiene ese valor por defecto traducido y lo que hacía la pantalla era pisarlo con literal.
- [x] `account` y `household`/`preferences` resueltos por el mismo camino: `cookingLevel` pasa a llamarse a lo que
      devuelve (`cookingLevelLabel`), traduce dentro, y el `'Sin marcar'` se acuña (`account.sin_nivel`);
      `passwordStrengthLabel` deja de ser un array de cinco palabras escritas y pasa a un array de cinco claves.
- [x] Un detalle de ortografía **no** arreglado, y escrito aquí para que no se pierda: los literales que salen de
      `shopping-list-detail` y `unit-picker` están sin tildes en el código desde antes de esta tanda («Buscar
      seccion», «Nada aun: en cuanto anotes un precio aparecera aqui»). Traducir es mover la cadena al diccionario;
      corregirle la ortografía a una frase que la gente ya lee es otra decisión, con su e2e y su captura, y no cabe
      en una tanda de i18n. El diccionario guarda exactamente lo que se pintaba.
- [x] Gates: `check-ui` en 0 con 20 reglas, `tsc` de app y de spec, `typecheck:e2e`, puente vitest, suite del server y
      build de producción sin avisos nuevos. Ninguno de los cinco se declara verde sin haberlo ejecutado en la tanda.
- [x] `DESIGN-SYSTEM.md` (quién lo vigila, y la fila del `{{ }}` que pinta una clave) y el parte del PR dicen lo mismo
      que el spec, con el número medido.

### Como ha quedado la tanda (2026-09-21, cierre)

- [x] Reglas escritas y afinadas con el fichero de prueba dentro del árbol. **Medido: 25 incidencias (21 de
      atributo, 4 de clave desnuda) en 7 ficheros → 0**. `check-ui` cierra con «176 ficheros, 20 reglas, sin
      incidencias», y el contador de reglas es una constante del propio script, no del mensaje: la última vez
      que se añadió una, el parte seguía diciendo siete.
- [x] Los tres brazos de la 20 funcionan, y sobre todo **callan** donde deben: `goodLabel()` que traduce,
      `passwordStrengthLabel()` que busca la clave en una linea y la traduce en la siguiente, y
      `{ labelKey: MEAL_LABEL_KEYS[type] }` no salen en el parte. El segundo caso es el que obligó a cambiar el
      escaneo: la primera versión miraba linea a linea y denunciaba a quien traducía una linea más tarde. Con
      el cuerpo del miembro por delante, lo que se exige es lo que importa —que en ese miembro alguien llama al
      traductor.
- [x] Las 25 traducidas con la cadena en español byte a byte, y reutilizando lo que ya estaba: los seis
      `data-label` de la bandeja pintan las mismas `shopping_lists.columna_*` que la cabecera de la tabla.
      **Dos cosas se han caído del árbol en vez de traducirse**: `levelLabel="¿Cómo andas de cocina?"`
      (Preferencias pisaba con un literal el valor por defecto ya traducido de `app-home-profile-picker`: se
      borra el atributo), y los tres `emptyText="…"` repartidos entre el picker de unidades y la ficha de la
      lista — **`app-picker` no declara ese input**, así que Angular los trataba como atributo de DOM corriente y
      nunca se pintaron. Un literal que no llega a la pantalla no se traduce: se borra, con sus dos claves
      huérfanas fuera del diccionario. Es también la razón por la que la regla 14 no los veía antes: no había
      texto que ver.
- [x] El nivel de cocina tiene una sola función, `cookingLevelWord(level, t, fallback)` en
      `shared/models/home-profile.ts`, y la usan las tres pantallas que lo imprimían (Preferencias, Gestión de
      hogar, Mi cuenta —esta última con su `computed` renombrado a `cookingLevelLabel`, que es lo que
      devuelve). Escrito con las pruebas por delante: dos casos rojos contra el modelo y verdes con él. La
      cuenta de Mi cuenta ya no imprime `'Sin marcar'` escrito a mano (`account.sin_nivel`) y el medidor de
      contrasena son cinco claves (`account.pw_*`), no cinco palabras.
- [x] Dos locks nuevos, además del gate: `core/i18n/dict-simetrico.spec.ts` compara los objetos `es` y `en`
      enteros (mismas claves, ningún valor vacío, ninguna frase larga calcada del castellano) —lo que un escaneo
      estático no ve porque es una propiedad de los dos diccionarios a la vez—, y `I18nService.t()` avisa por
      consola en desarrollo cuando una clave no está: el hueco de texto de Angular acepta cualquier `string`, así
      que una clave rota **no falla, se pinta**, y eso es exactamente lo que muestra la captura del parte.
- [x] Gates, todos ejecutados en la tanda: `check-ui` 176/20/0 · `tsc` de app limpio · `typecheck:e2e` limpio ·
      puente vitest **14 ficheros / 126 pruebas** · suite del server **23 / 592** · `ng build --configuration
production` sin un error nuevo. El puente ha crecido en dos ficheros: `home-profile.spec.ts` estaba excluido
      solo por usar `toBeTrue()`/`toBeFalse()` (matchers de Jasmine que chai no tiene), y cambiarlos por
      `toBe(true)`/`toBe(false)` lo ha devuelto a la ejecución —mismo test, ahora corre también aquí. Y ese mismo puente ha enseñado una regla de escritura: un spec que corre en los dos
      arneses no puede usar `expect(valor, mensaje)` —en Karma ese segundo sitio no existe, alli el contexto se
      pide con `.withContext()`, que vitest no tiene—; el `tsc -p tsconfig.spec.json` lo corto en el momento, y
      es la razon de que los dos specs nuevos ensamblen el mensaje dentro del valor comparado.

**Lo que queda, y no es de esta tanda**: el `## 13` sigue con 21 de los 35 `*.spec.ts` fuera del puente porque
necesitan `TestBed`, y con `ng lint` sin poder ejecutarse. Y el detalle ortográfico anotado arriba: «Buscar
seccion» y compañía siguen sin tildes porque esta tanda mueve cadenas, no las reescribe.

## 12w. Tanda 24 — lo que el servidor escribe en castellano: el historial, la despensa sembrada y los utensilios

> «El historial se sigue viendo en español. El querer generar recetas hay ingredientes en español. Los utensilios
> se ven en español.» (con captura del modal «Generate Recipe with AI» en ingles: `Vino tinto`, `Cerveza`, `Levadura`…
> y un historial que dice `Juanjo ha desmarcado «Leche»`).

Las tres cosas son la misma: **texto escrito por el servidor en castellano y pintado como si fuera interfaz**. No es
que falten claves; es que no habia ninguna clave que poner.

1. **El historial de la lista.** `server/src/utils/shopping-events.ts:describeEvent` compone la frase
   (`${who} ha desmarcado${item}`) y la ruta la manda como `description`; la pantalla la pinta. Y aqui hay un bug que
   ni estaba en el mapa: el tipo del cliente `ListEventAction` declara **otras** acciones (`items.add`,
   `list.rename`, `list.clear_checked`…) que no son las del server (`item.add`, `list.update`, `list.clear-checked`,
   `items.bulk`…). Nueve de los nombres no existen en el server: un tipo inventado, que nadie pudo usar para componer
   la frase en el idioma activo. El payload ya trae `action`, `item_name` y `user_name` —la tabla los tiene—, así que
   la correccion es enteramente del cliente: **componer con `t()` a partir de la accion**, y `description` queda como
   reserva para una accion que el cliente aun no conoce (filas viejas, o un server nuevo con un cliente viejo: los
   dos se leen).
2. **La despensa sembrada.** `server/src/utils/seed-data.ts` crea la casa nueva con **68 alimentos y 54 utensilios con
   nombre en castellano** (122 en total), y el modal de la IA, la despensa y el onboarding pintan `item.name`. Es el
   mismo caso que los alergenos de la ronda 22 —el nombre es el dato—, con un matiz: aqui la persona **no lo escribió**,
   lo escribió la app al sembrar la casa. Dejarlo en español no es respetar su texto, es enseñarle su propio semillero.
   Se traduce **la etiqueta**, igual que con gustos y categorías: mapa valor → clave en el punto de pintura.
3. **Cuando se traduce un nombre y cuando no**, que es la linea que separa esto de un caos:
   - lectura de un nombre del catalogo sembrado (despensa, utensilios, ingrediente, fila de la lista) → **etiqueta
     traducida si la palabra está en el catalogo, crudo si no lo está**;
   - campo **editable** (el input donde se escribe el nombre, el cuadro de renombrar) → **el dato tal cual**: traducir
     lo que se edita es reescribir la base de datos con un golpe de idioma;
   - lo que **una persona o la IA escribieron** (lineas de un ticket fotografiado, nombre de una receta, texto libre)
     → **crudo siempre**: es su texto, y la pantalla no tiene derecho a corregirlo.

### Checklist

- [x] `ListEventAction` pasa a ser **la lista del server**, y un spec espejo en `server/` (el patron de
      `meal-times-mirror.spec.ts`) compara las dos: si alguien anade una accion al server y el cliente no la traduce,
      CI lo para. Sin este paso la traduccion del historial se cae a la primera accion nueva.
- [x] Cada accion tiene clave con sus parametros: `list_event.<slug>` con `{who}` siempre y `{item}` solo donde el
      server manda nombre. El espejo comprueba el detalle que se olvida siempre: **las acciones con `item_name` llevan
      `{item}` en la frase y las que no, no** —si no, «ha vaciado el carro {item}» se queda con la llave pintada.
- [x] `auditFace` deja de reescribir la frase del server con `startsWith`/`slice` (el apaño para cambiar «Juanjo» por
      «Tú» dentro de una cadena ya compuesta): el sujeto pasa a ser un **parametro**, elegido al componer y no a
      posteriori. Y la prueba de que el apaño era frágil: en la captura del parte el historial se leía pegado
      («…comprada1 d agoJuanjo…») porque la fila pinta nombre y frase en dos nodos contiguos.
- [x] Dos mapas de catalogo (`FOOD_LABEL_KEYS`, `UTENSIL_LABEL_KEYS`) **generados desde el propio `seed-data.ts`**, no
      tecleados, con las 122 claves en los dos idiomas, y un espejo que exige que cada nombre sembrado tenga la suya.
      Un mapa escrito a mano se pudre la primera vez que alguien anade un alimento al semillero.
- [x] Un pipe `catalogLabel` (`shared/pipes/catalog-label.pipe.ts`), **impuro a propósito** como `t`: puro no se
      re-evalúa al cambiar de idioma, y ese es el bug congelado de la ronda 20. La logica vive al lado, pura
      (`catalogLabelKey(tipo, valor)`), con su spec en el puente: se prueba sin navegador.
- [x] Puntos de pintura: `pantry` (alimentos, «con esto puedo cocinar», utensilios), `onboarding` (paso de utensilios),
      `shopping-list-detail` (fila de la lista y titulo de su ficha), `recipes` (chips del modal de la IA e
      ingredientes de la receta). Los tickets fotografidos y el nombre de una receta **no** pasan por el pipe, por la
      regla 3 de arriba.
- [x] Censo y cierre: `check-ui` en 0 con las 20 reglas de la tanda 23, `tsc` de app **y de spec** (el de spec es el
      que corto el `expect(valor, mensaje)` de la ronda pasada; sigue siendo gate), `typecheck:e2e`, puente, suite del
      server y build de produccion.
- [x] `DESIGN-SYSTEM.md`: la regla «lectura traducida / edicion en crudo / texto ajeno intacto» y el aviso de que un
      tipo de cliente que no coincide con el contrato del server es un bug silencioso —nadie lo usa mal porque nadie
      lo usa.

### Cierre de la tanda

Medido al cerrar: 20 acciones de auditoria (las del server, por fin, en el tipo del cliente) · 122 nombres del
semillero (68 alimentos + 54 utensilios, ninguno repetido) con sus 244 claves en los dos idiomas · ocho puntos de
pintura traducidos y dos que se dejan crudos a proposito (las lineas del ticket fotografiado) · tres que nunca
fueron catalogo (titulos de receta en `dashboard` y `recipes`) · 3 de las 19 claves de `ListEventAction`
coincidian con el server antes de tocar nada. Gates: `check-ui` 179 ficheros / 20 reglas en 0 · `tsc` de app y de
spec · `typecheck:e2e` · puente de vitest 16 ficheros / 139 pruebas · suite del server 25 ficheros / 611 pruebas
(14 del espejo del catalogo y 5 del del historial) · `ng build --configuration production` sin errores.

## 12x. Tanda 25 — el gestor de categorías del inventario y el gestor de productos principales

> «Ahora tendrás que implementar el gestor de categorías de inventario como está en Basketra y el gestor de
> productos principales.»

### De dónde se parte, medido

Hoy la categoría de un artículo de despensa es un **enum cerrado en el código, en los dos lados del contrato**:
`server/src/schemas/pantry.schema.ts:9` (doce claves) y `frontend/src/app/shared/models/pantry.model.ts:20` (las
mismas doce), y el desplegable del formulario es un `<select>` nativo con las doce escritas a mano
(`pantry.component.ts:382`). No hay catálogo: **no se puede crear la categoría de tu casa, ni renombrar la de
siempre, ni quitar lo que no usas**.

Y el catálogo de productos tampoco existe como dato gestionable: `seed-data.ts` escribe 68 alimentos y 54
utensilios al dar de alta la casa, y la pantalla llama «sugerencias» a las filas con `quantity = 0`
(`pantry.routes.ts:127`). O sea: el catálogo de la casa **son** esas filas, sin nombre propio y sin gestor —lo que
tu casa no compra se queda ahí para siempre, y lo que sí compra y no está sembrado hay que escribirlo entero cada
vez—.

### El modelo que se adopta (Basketra)

`src/domain/categories.ts`, `src/api/catalog-management-core.ts` y
`.agents/specs/2026-09-02-professional-inventory/` (capturas 02 y 04) dicen lo siguiente, y esto es lo que se copia:

- **Categoría** = `name` + `color` (`#RRGGBB`, normalizado a mayúsculas al escribir) + `description` + `parentId`,
  y una **categoría de reserva protegida** (`category_unknown`, «desconocido»). La reserva no se borra, no se
  renombra y no se recoloca: en el editor, nombre y padre están **deshabilitados** y el botón de eliminar está
  deshabilitado con una nota al lado (`#category-protected-note`). No es un aviso: es un dato que la app sabe que
  necesita.
- **Borrar bloqueado mientras quede algo encima.** `canDelete` exige `productCount === 0 && childCount === 0`, y
  el 409 lleva el impacto en el cuerpo para que el diálogo pueda decir _por qué_ no, con números.
- **Lista jerárquica aplanada y paginada**: hijo indentado dentro del padre, `childCount` / `productCount` /
  `descendantProductCount` por fila, «1-2 de 2» y «10 por página», con `total` = **el total filtrado** (un pager
  que dice «10» sobre 3 filtrados miente).
- **Vistas**: todas / activas / sin productos / con subcategorías, y orden por nombre.
- **El producto** lleva `aliases` (cómo lo llama la casa), un índice de búsqueda que se refresca al escribir, y el
  borrado —suelto o en lote, hasta 100— anuncia la evidencia que lo impide (líneas de cesta, tickets,
  observaciones de precio) en lugar de borrar historia.
- **Tres pantallas enrutadas** —lista → detalle → editor—, así que `.../categories/new?parent=category_food` es un
  enlace que se puede pegar en un chat y **sobrevive a un F5**. El estado vive en la URL, no en un signal.

### Checklist

- [x] **Migration `pantry_categories`**: `id, user_id, household_id, key, name, color, description, parent_key,
position, created_at, updated_at`, única por casa y `key`, índice por `position`. `key` es **el dato** que ya
      guardan `ingredients.category` y el prompt de la IA: las doce claves de fábrica se siembran con su `name` en
      castellano y su color, y `other` nace protegida. Se siembra desde `backfillHouseholdSeeds` de forma
      idempotente: las casas ya creadas reciben el catálogo **sin migrar una sola fila de `ingredients`**.
- [x] `ingredients.aliases` (JSON, como `model_params` de `household_ai_config`): lista de cómo llama la casa al
      producto. Se escribe en mayúsculas-normalizada y **solo sirve para buscar**; lo que se guarda y se compara en
      la cesta sigue siendo `productKeyOf(name)` —dos criterios de «esto es un kg» son dos productos distintos—.
- [x] `server/src/utils/pantry-categories.ts`, el módulo del dominio, imitando a `shopping-categories.ts`:
      `normalizeCategoryName` (1..120, espacios colapsados), `normalizeCategoryColor` (`#RRGGBB` a mayúsculas o 400),
      `slug` de la clave, y `assertNoCycle`: el padre no puede ser la propia categoría **ni ninguno de sus
      descendientes**, con profundidad máxima 4. Basketra solo corta el auto-padre; aquí se corta el ciclo porque
      el conteo de descendientes recorre el árbol, y un ciclo haría un `while` eterno en la pantalla.
- [x] Rutas: `GET/POST /api/pantry/categories`, `PATCH/DELETE /api/pantry/categories/:id`,
      `GET /api/pantry/categories/:id/delete-impact`. Sobre `PATCH`: `formPartial`, que es el contrato de
      `form-contract.spec.ts` —quitar el padre o la descripción escribe `null` explícito, no los omite—.
      **La ruta de reordenación manual de Basketra (`PUT .../order`) se cae de la tanda**: `position` se guarda al
      crear y el gestor ordena por nombre; mientras no haya una UI de arrastrar, una ruta de reordenar es un
      contrato sin cliente. El campo queda escrito para que el día que se arrastre no haya migración.
- [x] `category` deja de ser un enum cerrado en `pantry.schema.ts`: pasa a «la clave existe en el catálogo de esta
      casa», con `400 PANTRY_CATEGORY_UNKNOWN` que contesta las claves válidas, y reserva a `other` cuando el
      formulario no manda ninguna. El agrupador de estadísticas (`GROUP BY category`) y el prompt no cambian de
      forma: ya valían con cualquier clave.
- [x] **Gestor de productos principales** sobre lo que ya existe: `staples` = filas con `quantity = 0`. Rutas
      `GET /api/pantry/products` (búsqueda `q` por nombre, alias, `barcode` y `notes`; `filter=all|staples|in-pantry|
expiring` —`staples`, sin stock, es la pestaña con la que abre la pantalla—; `sort=name|recent`; paginado
      `limit`/`offset` con `meta.total` filtrado y `hasMore`), `POST`, `PATCH /:id`,
      `GET /:id/delete-impact`, `DELETE /:id`, y `POST /products/bulk-delete-impact` + `POST /products/bulk-delete`
      (máximo 100, todo-o-nada dentro de una transacción). Borrar un producto principal **borra la sugerencia, no
      la historia**: las líneas de cesta y las observaciones de precio no se tocan, y el impacto se pinta en el
      diálogo para que se sepa lo que se deja.
- [x] Cliente: `PantryCategory` y `PantryProduct` en `shared/models/pantry.model.ts`; `pantry.service` con los
      mismos filtros y el mismo `save-state` que el resto de mutaciones; dos pantallas enrutadas,
      `/pantry/categories` y `/pantry/products`, con lista → detalle → editor. Piezas del sistema: `app-picker`
      (padre y categoría), `app-confirm-dialog` (todo lo que borra), `app-tag` (vistas, filtros y aliases),
      `app-badge` (la reserva) y `app-checkbox` (el lote). Los **dos** `<select>` nativos del formulario se van
      al picker —el de categoría y, aprovechando el mismo array, el de ubicación—: se cierra la deuda que
      `## 13` apuntaba para esta pantalla, y el catálogo de la casa pasa a ser lo que pintan los chips del
      filtro, con su etiqueta traducida y su punto de color.
- [x] **La regla de traducción de `## 12w`, sin excepción**: la etiqueta de una categoría de fábrica se pinta con su
      clave `pantry.categoria_*` (doce claves que ya existen en los dos idiomas); la de una categoría que creó la
      casa se pinta con su `name` crudo, porque ese texto lo escribió una persona. El `name` es dato y nunca clave;
      el campo editable del formulario pinta el dato tal cual. Y todo el chrome del gestor sale del diccionario
      (reglas 14, 15, 18, 19 y 20, con `check-ui` en 0).
- [x] El color manda en la fila (punto de color, como Basketra) y **no se añade ningún emoji**: `getCategoryIcon`
      se queda donde decora el artículo, no donde se nombra la categoría (regla 1).
- [x] `data-test` nuevos con sus casos e2e (`tests/e2e/pantry-managers.spec.ts`): crear una categoría con padre y
      color; la reserva con «Eliminar» deshabilitado y con nombre/padre deshabilitados en el editor; borrado
      bloqueado enseñando el impacto; un alias que encuentra el producto en la búsqueda; F5 que conserva lista,
      detalle y filtro; borrado en lote con impacto.
- [x] Gates: `node scripts/check-ui.mjs` en 0 · `tsc -p tsconfig.app.json` **y** `-p tsconfig.spec.json` ·
      `pnpm run typecheck:e2e` · puente de vitest (los specs puros de las dos pantallas corren ahí) · suite del
      server con las rutas · `ng build --configuration production`.
- [ ] **No se hace a propósito**: exportar el catálogo (Basketra tiene «Exportar» y HogarIA no tiene ninguna ruta de
      exportación: nace con su propio contrato y su propio CSV que nadie ha pedido), precios por comercio en la
      ficha del producto (HogarIA guarda `price_observations` por línea de cesta, no por producto: enlazarlos es
      otra tanda con su migración), las variantes/«importados» de Basketra (aquí un producto es una fila, no un
      `canonical_product` con `product_variants`; importar la mitad del modelo para no usarlo sería pior), y la
      **reordenación a mano** por el mismo motivo de arriba: sin UI que la exercise no se acuña un contrato.

### Lo que midió el servidor (fin de la primera mitad)

`server/src/utils/pantry-categories.spec.ts` (11) y `server/src/routes/pantry-categories.routes.spec.ts` (15) +
`server/src/routes/pantry-products.routes.spec.ts` (13) escribieron **antes** que la implementación y el rojo fue
el previsto: «no puede resolver ./pantry-categories.js». Cerrado el lote del servidor con la suite entera en
**28 ficheros / 685 pruebas** (antes: 25 / 609). Tres cosas que el plan no sabía:

- `formPartial` afloja el tipado inferido de los PATCH (`Record<string, ZodTypeAny>`), así que en
  `PATCH /categories/:id` los `String(...)` no son ceremonia: sin ellos `tsc` no deja pasar el objeto `patch`
  del módulo.
- El candado de `form-contract.spec.ts` exige fila por cada schema exportado, incluido
  `bulkProductIdsSchema` —un `z.object` con un solo campo y sin opcionales también entra en el registro, y está
  bien que sea así: es como se entera uno de que un lote de 101 ids debe dar 400 y no 500.
- `assertPlacement` comprueba ciclo y profundidad sobre el árbol **que resultaría** del cambio (alta incluida),
  no sobre el guardado; es la única forma de no escribir un ciclo y descubrirlo al recorrerlo.

### Cierre de la tanda

Medido al cerrar (ronda 25, tanda `## 12x`):

- `node scripts/check-ui.mjs` → **184 ficheros, 20 reglas, sin incidencias**. La regla
  `backtick-cierra-el-literal` se re-ensayó a propósito antes de dar el gate por bueno: con un comentario HTML
  con backticks dentro del template del gestor salta, y sin ellos no. Es el error que esta sesión ha cometido
  cuatro veces, y lo volverá a cometer quien confíe en `tsc`: el AOT lo ve, el tipador no.
- `tsc -p tsconfig.app.json` y `-p tsconfig.spec.json` → 0 errores. `corepack pnpm run typecheck:e2e` → 0.
- `corepack pnpm --filter @hogaria/web build:prod` → bundle completo. Quedan los dos avisos de `?.`/`??`
  redundantes y los `NG8113` de importaciones sin usar, todos en ficheros ajenos a la tanda.
- Suite del server → **28 ficheros / 690 pruebas** (antes de la tanda: 25 / 609). Los tres ficheros nuevos son
  `pantry-categories.spec.ts` (11), `pantry-categories.routes.spec.ts` (15) y `pantry-products.routes.spec.ts`
  (13), y `pantry-catalog-i18n.spec.ts` pasó de 14 a 19 con el espejo de las doce categorías de fábrica.
- La lógica del frente (`pantry-gestor.util.spec.ts`, 13 pruebas) se ejecuta en verde con el vitest del server
  (`--globals`, `--root ..`): Karma pide un navegador que el contenedor no tiene, así que el resto de specs del
  frente se validan por `tsconfig.spec.json` y por el build, como en las tandas anteriores.
- `tests/e2e/pantry-managers.spec.ts` (7 casos) deja escrito lo que solo se ve con navegador: las dos rutas de
  entrada, el alta con color y padre, la reserva cerrada por los dos sitios, el borrado bloqueado enseñando los
  números, el alias que encuentra el producto y el F5 que conserva filtro, búsqueda y ficha.

Lo que la tanda deja dicho para quien siga:

- **El patrón de gestor de catálogo ya existe.** `shopping_categories` sigue sin pantalla propia (solo tiene
  `GET`/`POST` en `shopping.service.ts`); ahora hay a donde migrar: en el server, `utils/*-categories.ts` con
  `meta.total` filtrado, 409 con el impacto en el cuerpo y reserva protegida; en el frente, dos rutas, picker
  del catálogo, confirmación con impacto y el estado en la query.
- **La reserva protegida no es un adorno.** Que `other` no se pueda renombrar ni borrar es lo que permite que
  una fila de `ingredients` con una clave que ya no existe se pinte sin romper la pantalla; la próxima tanda que
  toque el catálogo no debería poder quitárselo de encima.
- La **reordenación a mano** no se hizo, y `position` ya se guarda: el día que se arrastre la lista no habrá
  migración, solo una ruta.

## 12y. Tanda 26 — la suite e2e del branch estaba roja, y no la rompió la tanda 25

Medido en GitHub, no supuesto: los tres runs de CI de esta rama (`7d7da09` —un commit que solo tocaba este
fichero—, `cf2e92b` y `4029d06`) fallan **igual** en `Full-stack E2E` y en los shards 1, 3 y 4 (el 2 pasa).
Un commit de documentación ya estaba rojo: **la tanda 25 no introdujo nada de esto**. Y aquí no se puede
reproducir con navegador —`corepack pnpm exec playwright install chromium` falla descargando: el CDN de
Playwright no es alcanzable desde el sandbox—, así que cada caso se ha juzgado **contra el fuente de la app**,
y solo se arregla lo que el fuente prueba. Lo que necesita un navegador para saber de qué lado está el error
se queda escrito, no se toca a ciegas.

### Lo que dice la anotación de CI, y con qué se casa

| prueba                                                                                        | qué esperaba                                          | qué salió                                                                            | veredicto                                                                                                                                                                                                                                                                        |
| --------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth.spec.ts` — «should show login form»                                                     | `h2` con `Iniciar Sesión`                             | `Iniciar sesión`                                                                     | prueba vieja: la ronda de i18n pasó los títulos a minúscula de frase; `household.spec.ts` ya busca `/Iniciar sesión/`                                                                                                                                                            |
| `account.spec.ts` — «informacion dice lo que la app guarda»                                   | `account-email` con `@hogaria.test`                   | `e2e-r…a1s1-1-…@example.com`                                                         | prueba vieja: `registerAndGoto` **devuelve el email que crea** y el dominio del arnés es `@example.com`                                                                                                                                                                          |
| `onboarding.spec.ts` — desmarcar la merienda y la cena                                        | `[data-test="gen-meal-snack"] input[type="checkbox"]` | 45 s esperando el localizador                                                        | prueba vieja: `app-checkbox` es un `button[role="checkbox"]` —**no hay input dentro que marcar**— y el `data-test` está en el propio `<app-checkbox>`                                                                                                                            |
| los textos en español que salieron en inglés (`10 % en 2 units`)                              | chip en castellano                                    | chip en inglés                                                                       | **el arnés estaba roto**: `fixtures.ts` anclaba el idioma escribiendo `hogaria.language`, y la app lee `STORAGE_KEYS.language` = `hogar:v1:language`. La clave no existía para nadie: quien cambiaba de idioma en otro sitio se llevaba el `auto` del navegador (en CI, `en-US`) |
| `calendar.spec.ts` (`.cal-event` a 0, hover esperando)                                        | eventos en la rejilla                                 | ninguno                                                                              | **no se toca**: la clase existe (`calendar-event.component.ts`, `class: 'cal-event'`), así que es dato/tiempo, y sin navegador no se decide si es del test o del planificador                                                                                                    |
| `recipes.spec.ts` y `ai-goal.spec.ts` (`.modal__title` vacío)                                 | título del modal                                      | cadena vacía                                                                         | **no se toca**: `.modal__title` sigue en el sistema (2 ficheros); o el modal no estaba abierto en el assert o el `[title]` no llega —hay que verlo—                                                                                                                              |
| `shopping-round6.spec.ts` — oferta `3x2`, `selection-toolbar`, `add-input`, `discount-amount` | 3x2 / toolbar visible                                 | `3x1` / no aparece                                                                   | **no se toca**: todos los `data-test` existen en la app; la pinta de cascada (un paso anterior no hizo lo que el test creía)                                                                                                                                                     |
| `shopping-round10.spec.ts` — «bote de 400 g» en el picker                                     | la medida escrita a mano                              | `Sin unidad`                                                                         | **no se toca** por el mismo motivo, y puede que lo arregle el anclaje del idioma                                                                                                                                                                                                 |
| `shopping-round6.spec.ts` — hoja de foto sin IA                                               | `/Falta configurar la IA/i`                           | `El modelo no esta disponible ahora mismo.`                                          | **no se toca**: las dos frases están en el diccionario (`ui.falta_configurar_la_ia`, `ui.el_modelo_no_esta`) y son condiciones distintas —cuál toca depende del estado del arnés                                                                                                 |
| `Full-stack E2E`                                                                              | `test-results/results.json`                           | «Playwright no llegó a escribir resultados (posible fallo al arrancar el webServer)» | **no se toca**: es el job de proceso único (build de producción + servidor), y su fallo es de arranque, no de ningún assert                                                                                                                                                      |

### Checklist

- [x] `tests/e2e/fixtures.ts`: el anclaje de idioma tiene que escribir **la clave que lee la app**
      (`STORAGE_KEYS.language` → `hogar:v1:language`). Se pone la constante al lado del literal y un comentario
      que diga que si `STORAGE_PREFIX` cambia, esto cambia; un fixture que escribe una clave muerta no es un
      fixture, es decoración.
- [x] `auth.spec.ts`: el título se busca como lo pinta la app (`Iniciar sesión`).
- [x] `account.spec.ts`: se afirma contra el email que el propio helper registró (`const email = await
registerAndGoto(...)`), no contra un dominio que el arnés ya no usa.
- [x] `onboarding.spec.ts`: las casillas se pulsan por su rol (`[role="checkbox"]`) y se comprueban por
      `aria-checked`, como hace `pantry-managers.spec.ts` desde la tanda 25. Nadie marca un input que no existe.
- [x] `corepack pnpm run typecheck:e2e` en 0 tras los cuatro cambios (es la única puerta que el sandbox puede
      cerrar de esto: el `check-ui` no mira `tests/`, y Playwright no arranca aquí).
- [x] **Regla que sale**: un e2e se escribe contra **lo que la app pinta**, no contra el nombre que el equipo se
      puso a sí mismo. `input[type="checkbox"]` era el componente de antes; `app-checkbox` es lo que hay; y
      `hogaria.language` era la clave de antes. Ninguna de las dos cosas se ve con `tsc` —el selector es una
      cadena—, así que el guardián es el CI: si un test lleva meses fallando «por datos», la sospecha es el
      arnés.
- [ ] **Lo que no se hace**: no se reescriben los tests que necesitan navegador para ser juzgados (tabla de
      arriba, seis filas). Cambiarles el assert hasta que pasen sin haber visto la pantalla es exactamente lo que
      este proyecto llama «tests que mienten» (`108cb55`). Quedan escritos con su anotación de CI para quien
      corra la suite con navegador: si al arreglar el anclaje del idioma se alinean solos, se cierra aquí; si no,
      cada uno merece su mirada.

### Lo que midió el CI (aquí el CI es el navegador)

Run `35723671031`, el primero con el arnés del idioma arreglado: `Install`, `Server Tests`, `Type Check` y
`Production Build` en verde; siguen rojos `Full-stack E2E` (no llega a escribir `test-results/results.json`: es
arranque del proceso único, no un assert) y los shards. Las anotaciones dan para clasificar sin adivinar, y lo que
clasifican incluye **lo mío**:

- **La tanda 25 tenía un bug, y lo encontró un e2e que nadie había ejecutado.** `un producto principal se
registra sin meter nada en la despensa` esperaba el campo del nombre y no aparecía: `abrirFicha('new')` ponía
  `ficha = null`, y la plantilla decide «lista o ficha» con `@if (!ficha)` —el botón de crear, por tanto, volvía a
  pintar la lista; el formulario del alta no existía—. Las categorías lo hacían bien (ficha en blanco) y productos
  no; se repara con la misma forma (ficha en blanco con `impact` a ceros), y lo que de una fila inexistente no se
  puede decir ya estaba detrás de un `@if (!esNueva)`.
- **`app-input` pone el `id` en el `<input>` nativo y el del host a `null`** (`host: { '[attr.id]': 'null' }`, lo
  dice el componente): en un e2e se localiza `#gestor-productos-q`, **no** `#gestor-productos-q input`. Cuatro
  sitios de mi spec lo hacían al revés y la anotación de CI los nombraba uno por uno.
- **`app-picker` no hace teleport**: sus `.picker__option` viven dentro del host, así que «abrir el picker y
  pulsar la opción por su texto» es un patrón legítimo, y es el que sustituye a los cuatro
  `page.selectOption('select[name="category"]')` de `pantry.spec.ts` —que llevaban meses verdes mientras el
  `<select>` existió—.
- **Cambiar una pieza de la UI es cambiar la suite e2e en la misma tanda.** Es la regla que sale de la tabla de
  arriba: `check-ui` no mira `tests/`, pero los selectores de `tests/` son contrato con la pantalla igual que los
  `data-test`. Si la próxima tanda sustituye otra pieza, los casos que la tocan se actualizan ahí, no «cuando
  alguien pase lista».
- **Un assert sobre un dato que la pantalla pide aparte lleva plazo.** En el gestor, `canDelete` de una fila lo
  decide el `delete-impact` que se pide por fila y llega después de pintar: sin `timeout` propio, el assert
  perdía por red lo que ganaba por milisegundos.
- **El anclaje del idioma del arnés se tuvo que corregir dos veces.** Primero porque escribía una clave que nadie
  leía (`hogaria.language` frente a `STORAGE_KEYS.language` = `hogar:v1:language`); después porque, ya leída,
  `addInitScript` la sembraba en **cada** navegación y le ganaba a un test que consistía en que la preferencia
  sobrevive a un reload (`settings-theme-i18n`). Semilla, no imposición: `if (!getItem(key))`.

Checklist de esta segunda mitad, medida contra las anotaciones:

- [x] Ficha en blanco en el alta de productos (el bug de arriba), con `build:prod` y `tsc -p
tsconfig.app.json` volviendo a decir 0.
- [x] Los cinco localizadores míos corregidos (`#id`, sin ` input`), el `gestor-productos-ficha` visible antes de
      rellenar la ficha —si alguien vuelve a romper el alta, el fallo dice eso, no «timeout»—, y el plazo en el
      assert del borrado.
- [x] `pantry.spec.ts`: los cuatro `selectOption` convertidos al picker, con el texto de la opción del
      diccionario (`Verduras`, `Lácteos`, `Nevera`) y un comentario que diga por qué se filtra por substring (el
      pictograma de ubicación va delante).
- [x] `fixtures.ts`: el anclaje solo cuando no hay preferencia.
- [x] Puertas: `check-ui` en 0 · `tsc` app **y** `-p tsconfig.spec.json` en 0 · `corepack pnpm run
typecheck:e2e` en 0 · `--filter @hogaria/web build:prod` completo. La suite del server no se vuelve a correr:
      ningún fichero de `server/` cambia en este tramo.
      Y **se sigue sin tocar** lo que necesita navegador para juzgarse (`.cal-event` a 0, `.modal__title` vacio,
      `offer-chip` 3x2/3x1, `unit-picker` «Sin unidad», los timeouts en cascada de `shopping-round6`, el
      `photo-error` con las dos frases del diccionario, y el arranque del `Full-stack E2E`): seis filas, cada una
      con su anotación, esperando alguien con Playwright delante. Lo que sí se espera es que al anclar el idioma
      varias se alineen solas; si lo hacen, se borran de esta lista con la medición, no a ojo.

### La segunda tanda del CI (mismo método: las anotaciones mandan)

Segundo bucle sobre las anotaciones (run `35724969328`, con los localizadores de `pantry-managers` ya
corregidos): `settings-theme-i18n` pasa ✓, los dos casos de `pantry.spec.ts` que dependían del `<select>` pasan ✓,
y quedan tres de los míos. Leyéndolos contra el fuente sale **otro bug real de la tanda 25**, y del mismo sitio en
las dos pantallas: `ngOnInit` leía el `paramMap` pero **nunca leía la `queryParamMap`** —el gestor escribía
`?filter=&q=&offset=` con `replaceUrl` y al montar los ignoraba—, así que «F5 conserva el filtro, la búsqueda y la
página» era una promesa del `## 12x` que no se cumplía: entrar por `?filter=in-pantry` pintaba `staples` con la
caja vacía (y de ahí, también, el botón de borrar «enabled» que mi caso esperaba deshabilitado: la fila que se
estaba mirando no era del filtro pedido).

- El arreglo vive en el util (`valorDeQuery`, `offsetDeQuery`) y no en cada componente, porque **las dos pantallas
  tienen que leer el estado exactamente igual**; el valor que la app no conoce cae al de fábrica (la URL es texto
  libre del navegador, no una entrada de formulario), y el `offset` negativo o no numérico se queda en la
  primera página. Escrito con TDD en el puente: `pantry-gestor.util.spec.ts` pasa de 13 a **17** y las cuatro
  nuevas estuvieron en rojo antes de existir las funciones.
- `pantry-managers` afila dos casos: el del alias entra por URL (`?filter=all&q=levadura%20fresca`) en lugar de
  teclear en la caja —lo que se prueba es que el alias encuentra el producto, no el `debounce` de un input— y el
  del F5 comprueba además que **la caja recupera el texto** y que el `view` sigue en la URL.
- Puertas tras el cambio: `check-ui` 184/20 en 0 · `tsc` app y spec en 0 · `build:prod` completo ·
  `typecheck:e2e` en 0 · `pantry-gestor.util.spec.ts` 17/17. La suite del server no se vuelve a correr: ningún
  fichero de `server/` cambia en este tramo.
- **La regla, esta vez en condiciones**: escribir el estado en la URL y no leerlo al montar es lo mismo que no
  escribirlo. Cualquier pantalla que prometa «el F5 conserva» tiene que tener su lectura en el `ngOnInit`, y eso
  se prueba en el util —sin navegador— con un valor desconocido, una ausencia y un número sucio.

### Tercer bucle: lo que queda abierto, dicho como esta

Tras arreglar la query, `pantry-managers` pasa de cinco casos fallando a **dos**, y el CI sigue siendo la unica
ventanilla que tengo (el sandbox no puede descargar un navegador: `playwright install chromium` falla en la
descarga). Lo que miden las anotaciones del run `35726780626`:

- `el F5 conserva el filtro, la busqueda y la ficha abierta` — `locator.click` agotando 45 s esperando
  `[data-test="gestor-categorias-vista-without-products"]`: el host del tag existe (en el run anterior la
  anotacion lo nombraba: `<app-tag ng-reflect-selected="false" ...>`), y con el intento de pulsar por `.tag`
  tampoco. Es decir: **no es un selector inventado, es una cuestion de accionabilidad o de cuando se pinta**,
  y eso necesita Playwright delante para saber de que lado esta el error —del test o de un `app-tag` que no
  deberia estar deshabilitado—. Se queda abierto, con la anotacion copiada, no se maquilla.
- `una casa sin stock no ofrece borrados falsos, y el lote cuenta lo que se marca` — la primera mitad (la vista
  `in-pantry` anuncia que esta vacia) pasa; la segunda espera `.fila__marca [role="checkbox"]` y no lo
  encuentra, lo que apunta a que en `all` la lista no pinto filas: habria que ver si `refrescar()` se queda en
  `cargando` con un `null` del servicio (un 5xx del `?filter=all` en el entorno del arnes). Abierto igual que el
  anterior, y con la sospecha escrita.

Lo que si se decidio con el fuente delante: el caso que **asumia una fila en `in-pantry`** estaba fingiendo
datos —el semillero de la casa crea productos principales, que son filas con `quantity = 0`, y por contrato ahi
no hay nada en despensa—; se reescribio contra la regla, y la parte de «con algo dentro de la despensa no se
borra, ni en lote» se queda donde esta probada con datos reales, en `pantry-products.routes.spec.ts` (409
`PANTRY_PRODUCT_BULK_DELETE_BLOCKED`, sin borrar ninguno).

- **Regla**: un e2e no puede sembrar a mano lo que el arnes no siembra; si la regla necesita datos, o el arnes
  los pone (otro dia, con su helper y su contrato) o la regla se prueba en el server. Fingir una fila para que el
  assert pase es el tipo de test que este repo ya borro una vez (`108cb55`).
- **Y la contrapartida, que es lo que esta tanda deja medido**: cinco de mis siete casos valen (entrada, alta de
  categoria con color y padre, reserva cerrada por los dos sitios, impacto del borrado, alta de producto con su
  alias encontrado por busqueda) y dos siguen abiertos con la anotacion al lado. Un test que nunca se ejecuto es
  eso: una hipotesis tipada.

## 12z. Tanda 27 — las dos pantallas del catálogo, maquetadas con el sistema

Lo que se dijo: «las vistas no son buenas, el diseño a penas tiene márgenes, padding, alineaciones etc». Medido
contra `DESIGN-SYSTEM.md`, era cierto y tenía nombre propio: las dos pantallas salieron **maquetadas con
píxeles sueltos** (`gap: 2px`, `padding: 6px 12px`, `padding: 10px 4px 10px 10px`), sin contenedor de página, sin
superficie para la barra de trabajo y sin columnas —los colores y las piezas eran del sistema, la caja no—.

### Las reglas que se aplicaron (las dos pantallas, iguales donde son la misma pantalla)

- **Contenedor**: `max-width: 1000px` + `margin: 0 auto` + `--space-4` en móvil y `--space-6` desde 768px, con
  `--space-16`/`--space-20` de aire al pie. Son los números de la pantalla de la despensa, la vecina por la que se
  entra: al saltar de una a otra nada cambia de ancho. Sin esto, en un monitor ancho la lista se estiraba y
  ninguna columna cuadraba con la de arriba.
- **Espaciado solo del tipo de espaciado** (`--space-*`): donde hace falta un 2px se pone `--space-1` y se
  reordena la tipografía, no se escribe `2px`. Lo que queda de `padding: 0` son ceros de reset, que no cuentan.
- **La barra de trabajo es una superficie** (`--bg-secondary`, borde de 1px, `--radius-xl`, `padding: --space-3
--space-4`) y `align-items: end`, para que buscador, filtros, orden y botón compartan línea de base. El grupo
  de vistas vive dentro de una píldora `--bg-tertiary`: tres filtros dentro de un fondo común se leen como
  _elegir vista_, tres sueltos se leen como tres botones.
- **La lista es una tarjeta con filas**, no fichitas separadas 2px: `--radius-xl` + `overflow: hidden`,
  `border-bottom` de 1px entre filas, `padding: --space-4` en cada una y `gap: --space-2 --space-4` entre piezas.
- **Alineación con `grid`, declarada por pantalla**: desde 860px `.fila__cuerpo` es grid con las pistas de cada
  una —categorías `auto minmax(0,1fr) auto auto`, productos `minmax(0,0.9fr) minmax(0,1.6fr) auto`—. En la hoja
  común no va: los hijos de cada fila son distintos y en número variable, y poner `1fr auto` a secas mandaba el
  último a una segunda línea. Un número alineado porque existe su columna; suelto, alineado por casualidad.
- **La jerarquía se ve**: las filas hijas llevan `.fila--anidada` (sangrado a `--space-8` con un hilo de 1px).
  El server ya devolvía el árbol aplanado; pintarlo plano sin decir nada era medio contrato roto.
- **Los datos de la fila son etiquetas**: `--radius-full`, `--space-1 --space-2`, `font-variant-numeric:
tabular-nums`; `--success-subtle` cuando hay existencias y `--warning-subtle` cuando caduca en días, y los
  alias con borde discontinuo para que se distingan de los datos duros sin añadir un icono.
- **La ficha es un formulario**: `--radius-2xl`, `padding: --space-4`/`--space-6`, microetiqueta en `--text-xs` +
  `uppercase` + `--tracking-wide` (el patrón de etiquetas de la app), `.form-row` en dos columnas desde 720px,
  avisos con 3px de acento a la izquierda, y las acciones separadas del cuerpo por una línea con Guardar a la
  derecha del todo (`margin-inline-start: auto`).
- **La barra de lote es flotante y pegada abajo** (`position: sticky; bottom: --space-3`, `--shadow-lg`,
  `--radius-full`): una acción destructiva aparece donde se está marcando, no arriba, y no tapa la fila que se
  está mirando.
- **La franja de entrada al catálogo** (en la despensa) dejó de ser una fila de botones sueltos: superficie con
  `--space-4`, título a la izquierda y las dos acciones agrupadas a la derecha. Y sus botones tienen
  `:focus-visible`, que antes no tenía ninguno.

### Checklist

- [x] Las dos hojas de estilo reescritas con el mismo vocabulario (contenedor, superficie, grid, píldoras,
      tarjetas) y las clases del template intactas: ningún `data-test` ni gancho de e2e cambia de nombre, así que
      `pantry-managers.spec.ts` sigue hablando con las mismas piezas.
- [x] Cobertura comprobada con un barrido: cada `class` que aparece en las plantillas tiene su regla en la hoja
      correspondiente (cero elementos huérfanos, que es como se ven los «sin padding»).
- [x] Hover y foco visible en todo lo clicable de las dos pantallas, incluido el botón primario (sin hover
      propio parecía deshabilitado al lado del secundario).
- [x] Puertas: `node scripts/check-ui.mjs` 184 ficheros / 20 reglas en 0 · `tsc -p tsconfig.app.json` en 0 ·
      `corepack pnpm --filter @hogaria/web build:prod` completo. La suite del server y los e2e no se tocan: es
      CSS y un gancho de clase en la fila hija.
- [ ] **Queda, y es lo que el sandbox no puede dar**: verlas. Este repo no tiene un gate visual para el catálogo
      (las capturas existen para el onboarding y para el tour, no para estas dos rutas), y el contenedor no tiene
      navegador. Un `pnpm exec playwright test tests/e2e/pantry-managers.spec.ts --project=chromium` con
      `--headed`, o simplemente abrir `/pantry/categories` y `/pantry/products` en el dev, es lo que falta para
      decir que la tanda está cerrada; puede que quede algún `--space-6` de más o de menos, y eso solo se ve
      mirando.

### Y un boton que se pinta en dos pantallas necesita dos destinos

Al ver las dos vistas salio lo que el CSS no podia tapar: «el boton de volver al inventario no funciona». No es
que el router no funcionara —`volver()` estaba guardado por `if (this.ficha)`, y en la **lista** `ficha` es `null`,
asi que el boton de la cabecera no hacia absolutamente nada—. Los dos sitios que comparten cabecera necesitan su
propio destino: de la ficha a la lista (`../`) y de la lista al inventario (`/pantry`).

- Se decide **por la URL** (`paramMap.has('id')`), no por el estado: `ficha` se queda a `null` a mitad del
  guardado y del borrado, y «volver» no puede cambiar de significado a media operacion. Los sitios internos que
  querian «cerrar la ficha» siguen haciendo lo mismo que hacian (estan detras de un `if (this.ficha)`).
- `tests/e2e/pantry-managers.spec.ts` gana un caso con las dos mitades: desde la lista el boton deja en `/pantry`
  (con el titulo de la despensa visible) y desde el alta `/pantry/products/new` deja en `/pantry/products` con su
  lista visible. Un boton que no hace nada es invisible para `tsc`, para `check-ui` y para el build: lo ve quien
  lo pulsa, o quien escribe el caso que lo pulsa.

## 12aa. Tanda 29 — el inventario es de la casa entera, y el catálogo llega pre-registrado

Lo que se dijo: «crea un visor profesional tanto para PC como para mobile, y sería de inventario en general:
ya no es solo una app de cocina, ahora es de la casa, por lo que la despensa será inventario —puedes crear la
categoría padre "Alimentos" donde estén todos estos, o "Despensa", como tú quieras—. Y quiero pre-registro, con
su relación producto-categoría y categoría-categoría-padre, de productos comunes en los supermercados de España
(Mercadona, Lidl, Consum, Carrefour, Alcampo, Coviran, Día…). Pon una inmensa mayoría: así está pre-registrado
y es más fácil añadirlo.»

Tres peticiones, y las tres tienen forma de dato antes que de pantalla:

### A. El nombre: «Inventario»

La pantalla deja de ser la despensa de la cocina y pasa a ser el inventario de la casa. Se cambian **los
valores, no las claves ni las rutas**: `/pantry`, las claves `pantry.*` y las rutas de la API son contratos
(enlaces guardados de gente que ya usa la app, el `data-module-switch="pantry"`, toda la suite e2e). Renombrar
eso a `/inventario` no añade una sola palabra visible y toca dos contratos por fuera. Lo visible es el texto,
y el texto es del diccionario: `nav.pantry` pasa a «Inventario»/«Inventory», `pantry.title` pierde el «Despensa»
y el pictograma de más adelante, `pantry.en_despensa` pasa a «En inventario», y los rótulos del ajuste de casa
(`household.despensa_*`: «Despensa compartida», «Despensa individual») pasan a hablar de inventario compartido.
La clave interna de la preferencia sigue siendo `sharedPantry`, por el mismo motivo que la ruta.

### B. El pre-registro: catálogo de supermercado en el server

`server/src/utils/supermarket-catalog.ts` trae el dato: **seis categorías padre** —`alimentos` (Alimentos),
`limpieza` (Limpieza del hogar), `higiene` (Higiene personal), `hogar` (Hogar y desechables), `mascotas`
(Mascotas) y `bebe` (Bebé)—, **treinta y dos hojas** colgando de ellas (las once hojas de comida de siempre,
con su `key` exacta para caer en las categorias que la casa ya tiene, más `charcuteria`, `panaderia`,
`desayunos`, `snacks`, `dulces`, `colada`, `fregadero`, `superficies`, `bano`, `cabello`, `corporal`, `bucal`,
`botiquin`, `desechables`, `almacenaje`, `mantenimiento`, `perro`, `gato`, `panales`, `alimentacion-bebe`,
`cuidado-bebe`…), y **una inmensa mayoría de productos**: 340 como mínimo, medidos en el propio test de
invariantes, repartidos por los pasillos que se recorren de verdad en un súper español. Cada producto es
`[nombre, unidad]`, con la unidad del vocabulario de siempre (nada de `pack`: `unit` es la caja, la botella,
el pack de seis —que es como la casa cuenta de todas maneras—).

Tres decisiones de modelo, escritas antes de tocar código:

- **No hay tabla nueva.** El catálogo es dato de fábrica, como el de utensilios, no dato de la casa:
  copiarlo a una tabla hace que cada producto nuevo exija una migración para actualizar la copia. Vive en el
  módulo; los endpoints leen de memoria; lo único que se persiste es lo que la persona añade, que es una fila
  de `ingredients` con su categoría. Si mañana el catálogo quisiera ser editable, eso es otra tanda con su
  migración.
- **`id` = `hoja:índice`** (p. ej. `dairy:3`): determinista, legible en el log, y **referencia efímera**: lo
  que guarda la casa es el nombre, no el id. Reordenar el fichero no rompe ninguna casa, a lo sumo cambia el
  id con el que alguien llamó dos minutos antes. El test de invariantes exige claves únicas dentro de la hoja.
- **La relación producto-categoría y categoría-padre se respeta al añadir, no solo al pintar.** `POST
/catalog/add` crea en la casa la hoja que falte con su nombre y su color **y su padre en orden**
  (`alimentos` antes que `charcuteria`), reutilizando `createCategory` —techo de profundidad, clave única
  y reserva de `other` incluidos—. Un catálogo sin padre sería la lista de la compra; con padre es el árbol
  que el gestor de categorías ya sabe pintar.

Y tres endpoints bajo `/api/pantry` (misma auth y mismo ámbito que los dos gestores; en `pantry.schema.ts`
los `zod` correspondientes):

- `GET /catalog/categories` — la lista plana de las 38 con su `productCount`; el cliente se monta el árbol,
  que son treinta y ocho filas.
- `GET /catalog/products?q=&category=&limit=&offset=` — `q` busca sin acentos y sin mayúsculas sobre el
  nombre; `category` vale una hoja o una padre (con padre, se responde el subárbol); el orden es hoja →
  nombre; la paginación y el `meta` son los de siempre. Cada fila trae `inHousehold`: si ese nombre ya es
  un producto de la casa (la misma `productKeyOf` que usa el gestor, no un `LIKE`).
- `POST /catalog/add {ids}` — por cada id: si no existe ficha, se inserta con **`quantity` 1** («añadir al
  inventario» promete inventario, no un registro vacío —eso ya lo hace el gestor—); si existe con stock a 0,
  sube a 1; si existe con stock, se salta y se cuenta en `skipped`. Un `ids` con un id desconocido o vacío es
  400: un lote a medias es la clase de estado que luego nadie sabe arreglar (el mismo criterio del
  `bulk-delete`).

### C. «Alimentos» también en la casa, y el filtro por padre filtra el subárbol

- `DEFAULT_PANTRY_CATEGORIES` gana la padre `alimentos` y las once hojas de comida nacen colgando de ella
  (la reserva `other` se queda arriba, protegida y sin padre —es donde cae lo que no encaja, no una sección de
  comida—). Para las casas que ya existen, `asegurarPadreAlimentos(db, casa)`: idempotente, solo toca a la
  casa que tiene las hojas de fábrica **con su nombre de fábrica y sin mover de sitio**, y no reescribe la
  fila de nadie que ya las reorganizó. Se llama desde el backfill de arranque, que es donde viven las
  migraciones de dato en este repo.
- **Filtrar por categoría incluye el subárbol** en `GET /products` y `GET /ingredients`. Con `category =
'alimentos'`, el `category = ?` exacto devolvía cero filas: un botón pintado que no encuentra nada es el
  botón de la ronda 28 repetido en el sitio del lado equivocado. El conteo del padre en los chips del visor
  pasa a ser `descendantProducts`, que es lo que la fila del padre promete.
- La etiqueta de fábrica `alimentos` entra en los dos mapas de `labels.ts` (`pantry.categoria_alimentos`,
  «Alimentos»/«Food»), y las hojas que crea el catálogo en una casa son categorías **de la casa**: su nombre
  se pinta crudo, que es la regla de la ## 12w al revés de como se mira —se traduce la lectura de lo de
  fábrica; lo que la casa escribió, no—.

### D. La pantalla `/pantry/catalogo`: el visor profesional del catálogo

Un navegador en ruta, no un modal —mismo contrato que los dos gestores: F5 sobrevive, el botón atrás significa
lo que significa, y el estado viaja en la query (`?cat=&q=`), **hidratándola al montar** (la lección del bug
de la ## 12y). La caja es `.gestor` (1000px, `--space-4`/`--space-6`, pie `--space-16`/`--space-20`), con el
mismo vocabulario de superficies que sus dos vecinas:

- **PC (≥ 960px)**: dos columnas `220px minmax(0,1fr)`. A la izquierda, el árbol en riel `position: sticky`:
  las seis padres como microetiquetas y sus hojas debajo con sangrado y contador `tabular-nums`. A la derecha,
  la barra de trabajo (buscador, «Añadir lo visible») y la lista: filas en `.lista` con grid `minmax(0,1fr)
auto auto` —nombre + punto de color, etiqueta de categoría, botón de acción—.
- **Móvil**: las mismas filas del árbol se vuelven un scroller horizontal de píldoras (un único DOM, que el
  CSS es el que cambia el reflujo: dos piezas por medio = dos `data-test` iguales = strict-mode en la primera
  prueba que pase por ahí); las filas, apiladas, con el botón de añadir a 44px de diana.
- Fila ya en casa: el botón se convierte en `check_circle` deshabilitado con su etiqueta «en tu inventario» —
  que el catálogo diga qué es tuyo sin tener que ir comprobándolo es media gracia del pre-registro—.
- «Añadir lo visible (N)» manda los ids de la página actual: el lote es el mismo endpoint con la selección
  que estabas mirando, no un botón mágico por arriba.

### E. El visor del inventario (la pantalla que ya existía) se pone a la altura

Cambios sobre `pantry.component.ts` sin tocar ningún `data-test` ni clase que pisan los e2e existentes:

- Fuera pictogramas de la pestaña de inventario: el punto de color de la categoría en la fila y en las
  sugerencias (el dato de la categoría, ya cargado, en lugar de un emoji por clave), `app-icon` para editar
  y borrar, y los stats como franja profesional (icono del sistema + cifra `tabular-nums`) en vez de las tres
  tarjetas con 📦⚠️❌. La pestaña de utensilios no se toca: su pictografía vive en su propia lista de deuda y
  migrarla es otra tanda —el fichero, por eso, sigue en el LEGACY de `sin-emoji` (lo dice check-ui, no yo).
- **Cantidad con stepper −/+** en la fila con existencias (PATCH a `ingredients`, mínimo 0; bajar a 0 deja la
  ficha en «lo que la casa conoce» sin borrarla, que es exactamente la semántica de `staples` de la ## 12x).
- Filtros en riel a partir de 960px (columna con los `app-tag` de siempre, `overflow: auto`, sticky) y
  scroller horizontal por debajo: el mismo DOM en las dos pantallas.
- Cabecera: botón «Añadir del catálogo» (ruta nueva) junto al de alta manual, y la franja `pantry__gestion`
  gana el tercer enlace `pantry-abrir-catalogo`.

### F. La suite e2e, en la misma tanda (regla de la ## 12y)

- `pantry.spec.ts`: `h1` a «Inventario», la stat a «En inventario», y el orden de los chips cambia porque el
  árbol existe: `nth(1)` pasa a ser «Alimentos» y «Verduras» desciende a `nth(2)` — se ancla aquí para que el
  que lea el diff sepa por qué se movió un índice y no se toque otro índice por gusto.
- `household.spec.ts`: «Inventario compartido».
- `pantry-catalog.spec.ts` (nuevo): entrada desde la franja → buscador «leche» → fila con su botón → añadir →
  la fila pasa a «en tu inventario» → «Añadir lo visible» cuenta y no duplica → volver deja `/pantry` con el
  título de la despensa… perdón, del inventario → y el alta del catálogo aparece en `/pantry/products` con su
  padre `alimentos` visible en el gestor de categorías.
- El caso de «volver» de la ronda 28 no se mueve: el catálogo no comparte cabecera con una ficha, tiene un
  solo destino.

### Checklist de la tanda

- [x] `supermarket-catalog.spec.ts` (TDD, rojo primero): ≥ 340 productos; cada hoja no vacía y con ≥ 8
      productos; toda `category` de producto existe y es hoja (nadie cuelga un producto de un padre); todo
      padre existe; `key` y `id` únicos; unidades dentro del enum; nombres sin espacios dobles y ≤ 100; los
      once `key` de comida coinciden con `DEFAULT_PANTRY_CATEGORIES`; `buscarCatalogo` sin acentos y subárbol;
      paginación (total/offset).
- [x] `pantry-categories`: `ensureDefaultCategories` siembra `alimentos` + once hijas + `other` suelto;
      `asegurarPadreAlimentos` idempotente (casa renombrada/reorganizada no se toca); `clavesDeSubarbol`.
- [x] Rutas: `pantry-catalog.routes.spec.ts` con los tres endpoints (counts, `inHousehold`, subárbol, add con
      creación de categorías con padre en orden, bump 0→1, skip con stock, 400 con id desconocido o lote
      vacío, límite 100).
- [x] Filtro `category` de `GET /products` y `GET /ingredients` por subárbol; chips del visor con
      `descendantProducts`.
- [x] Frontend: tipos y `pantry.service` (listar catálogo, añadir); pantalla `pantry-catalog.component.ts` con
      la query hidratada al montar y escrita al cambiar; visor con stepper, iconos del sistema y riel.
- [x] i18n: claves nuevas del catálogo y del stepper en `dict/pantry.ts` en los dos idiomas (la tipa del
      `en` obliga), `pantry.categoria_alimentos`, y los renombrados de «despensa»→«inventario» en
      nav/dashboard/household/pantry/onboarding donde lean a pantalla.
- [x] Puertas medidas: `check-ui` 0 · `tsc -p tsconfig.app.json` 0 · `build:prod` completo ·
      `typecheck:e2e` 0 · vitest del server completo.
- [x] Run de CI como juez final y sus tres bucles: el primer run enseñó selectores muertos y zonas muertas de
      click (`ea083fd`); el segundo, dos cosas en el gestor de categorías —el picker del padre de la reserva sin
      `disabled` y una lectura de URL competida en el F5 (`6b85737`)— que al arreglarse destaparon que `guardar()`
      reenviaba la forma entera y el server leía ahí un renombre/movimiento (`8250a22`); el tercero, la única de
      verdad: el PATCH `/ingredients/:id` heredaba el `.positive()` del alta y el 0 del stepper moría en un 400
      sin destinatario (`19f5c83`). En `19f5c83`: cero rojos de `pantry-*`; quedan los 20 de deuda preexistente
      de la tabla de la ## 12y, que no se tocan aquí.
- [ ] Mirar las dos pantallas en la preview (`/pantry` y `/pantry/catalogo`, y el gestor de categorías para
      ver el padre) — el punto que quedó abierto en la ## 12z y que el sandbox ahora sí permite.

## 12ab. Tanda 30 — todas las listas de la pantalla de inventario pasan a tabla profesional

El veredicto del usuario sobre el visor tras la ## 12aa: «varias cosas» — el filtro de categorías pintado como
riel con `overflow: auto` no es un filtro, es un div con scroll; las sugerencias, tal cual, ocupan media pantalla
para pulsarlas una vez; y la lista de filas, sin orden ni filtrado por columna, no es el visor «de pc como de
mobile» que se prometía. La respuesta no es retocar tres sitios: es el componente que la casa aún no tiene.

### A. `app-data-table` — el componente (shared/components/ui/data-table/)

Una tabla de datos presentacional, sin fetch dentro: la pantalla le da las filas y ella se ocupa de orden,
filtrado, paginación y selección. Contrato:

- **Columnas** (`DataTableColumn[]`): `key` (campo de la fila o nombre de celda proyectada), `labelKey` (i18n —
  la tabla no escribe texto: reglan 14/15—), `tipo` (`texto | numero | fecha | enum`), `alineacion`,
  `ancho`, `ordenable`, `filtrable`, y `celda` para las celdas proyectadas con la directiva estructural
  `appDataTableCell` (contexto: la fila). El valor pintado de un enum sale de `etiqueta(valor)` que pone la
  pantalla: la tabla no sabe de catálogos (regla 19).
- **Ordenación múltiple**: clic en la etiqueta del encabezado cicla asc → desc → sin orden; `Shift`+clic añade
  la columna al orden activo. El encabezado muestra el sentido (`expand_less`/`expand_more`) y, si hay
  varias claves, el índice del orden. `aria-sort` en el `th`.
- **Filtro por columna, modo Excel**: cada columna filtrable lleva su embudo en el encabezado. Menú:
  - `texto`/`enum`: lista de los valores presentes (con su cuenta de filas), buscador dentro del menú,
    «Seleccionar todo»/«Ninguno», casillas; «Limpiar filtro» en el pie.
  - `numero`: condiciones (`igual a`, `mayor que`, `menor que`, `entre`) con campos `app-input type=number`.
  - `fecha`: `antes de`, `después de`, `entre`, más los atajos `hoy`, `próximos 7 días`, `caducados`.
    El filtro activo se marca en el embudo (punto + `aria-pressed`) y su estado vive en la tabla, no en la URL:
    lo que comparte una pantalla es la búsqueda y la categoría, no cada casilla pulsada.
- **Paginación** del lado cliente: tamaños 10/24/50/100, «desde–hasta de total», anterior/siguiente. La tabla
  itera el dataset completo de la pantalla; por eso el visor carga las filas de una vez (§B).
- **Selección múltiple**: columna de casillas (`app-checkbox`), cabecera con «todas las filas visibles» (y su
  estado indeterminado); la selección se emite (`seleccionChange`) para que la pantalla pinte su barra de lote
  con `ng-content select="[data-tabla-lote]"` dentro de la cabecera de la tabla. Vaciar la selección desde
  fuera: método público `limpiarSeleccion()`.
- **Móvil (<720px)**: las filas se reflujaan a tarjetas (cada celda con su etiqueta `data-label`); el
  encabezado de columnas desaparece y sus controles se recogen en un botón «Ordenar y filtrar» que abre una
  hoja inferior con la lista de columnas: por columna, orden y el mismo menú de filtro. Un solo DOM por menú
  (un panel vivo a la vez, anclado al cabezal en escritorio y a la hoja en móvil), porque dos copias con el
  mismo `data-test` partirían la suite e2e por la mitad.
- **Lógica pura fuera del componente** (`data-table.util.ts`) con spec en la misma carpeta (el patrón de
  `calendar-grid.spec.ts`): enumeración de valores únicos, predicados de filtro por tipo, orden multi-clave
  con comparadores por tipo y recorte de paginación. Así el contrato se prueba sin navegador.

### B. El visor del inventario: carga entera, y a la tabla

- **Carga**: `pantry.service` estrena `cargarInventarioCompleto()` — página de 100 en 100 hasta `total`, tope
  duro de 2.000 filas (una casa no tiene más; si lo tuviera, se avisa y la tabla pagina lo que hay). Con eso
  la búsqueda, el filtro de categoría y los filtros de columna son instantáneos y coherentemente Excel:
  ordenar por caducidad sobre 400 filas sin tener que hojear el servidor es el punto de la ronda.
- **URL**: `?buscar=` y `?category=` se leen y se escriben (`replaceUrl`, como en los gestores); `?tab=` sigue.
  El parámetro `category` es el subárbol (ya lo era server-side; ahora la expansión `clavesSubarbol` se hace en
  cliente sobre el catálogo de categorías cargado, mismo contrato).
- **Filtro de categorías minimizado**: el riel con scroll se va. En su sitio, un `app-picker` (el selector del
  sistema, con buscador propio dentro, color por opción y «Todos» arriba): el disparador dice la categoría
  activa siempre, el menú aparece al pulsar y se cierra al elegir. Las cuentas viajan en la etiqueta («Alimentos ·
  80») porque ya salían en el riel. Grupos: los padres del árbol se agrupan con `group` del picker.
- **Sugerencias en un expand**: el bloque `.suggestions` pasa a un botón-cabecera con `aria-expanded` y la
  cuenta («N sin existencias»), cerrado por defecto; el cuerpo son las mismas píldoras de un clic (añaden a 1).
  Una sección que se usa una vez al mes no puede ocupar media pantalla por defecto.
- **Columnas del inventario**: nombre (punto de color + nombre + badge de estado si caduca/caduca), cantidad
  (stepper de la fila dentro de la celda —mismos `data-test` `pantry-stock-mas-/menos-`—, `numero` filtrable),
  unidad (enum), categoría (enum con etiqueta `pantryCategoryLabel`, punto de color), caducidad (fecha con el
  badge, `fecha` filtrable), ubicación (enum con las etiquetas del modal) y acciones (editar/borrar, como hoy).
  Los pictogramas-emoji de la fila (`getLocationIcon`) salen del DOM: la ubicación se lee en su columna.
- **Lote**: «Vaciar (mueve a sugerencias)» (PATCH `quantity: 0` por fila, en paralelo, un solo toast al final) y
  «Borrar del inventario» (DELETE por fila en paralelo), cada uno con su confirmación propia de la app
  (ConfirmService) nombrando cuántas filas; «Anular selección» limpia sin preguntar. El borrado NO usa
  `bulk-delete` de productos: ese endpoint rechaza por diseño las filas con existencias (todo-o-nada) y en el
  visor todas las filas las tienen —el camino del visor es el DELETE que ya usa la fila suelta—.

### C. Utensilios a la tabla, y los tramos se van

La pestaña de utensilios recorre hoy un catálogo de ~54 filas en secciones de 12 con `?section=`, barra de
progreso y atajos por categoría: una paginación artesanal nacida porque la lista no se podía ordenar ni filtrar.
Con la tabla, eso sobra: columnas nombre, categoría (enum), estado (casilla `app-checkbox` en la celda —el
mismo toque que alternar la tarjeta—) y acciones (borrar, solo en los propios). «Ver todo de golpe», los tramos y
el parámetro `section` desaparecen; la paginación de la tabla (y su selector de tamaño) hacen el trabajo, y el
lote gana «Marcar como disponibles»/«Marcar como no disponibles» con su toast. `?tab=utensils` se escribe y se
lee igual que antes (regla de las pestañas).

### D. Lo que NO entra en la tanda (queda apuntado, no improvisado)

El catálogo y los dos gestores ya tienen paginación propia server-side y su e2e en verde; pasarlos a la tabla es
casi regalar el componente a tres pantallas, pero cada una toca su suite. Se anotan como siguiente tanda con su
propio spec para no mezclar 3 reescrituras e2e más en el lote de CI de esta.

### E. La suite e2e, en la misma tanda (regla de la ## 12y)

- `pantry.spec.ts`: las filas se localizan por `[data-test="pantry-fila-<id>"]` (y se mantiene
  `.ingredient-item` como clase de la fila para no reescribir el mundo); los chips de categoría pasan a prueba
  por el picker (abrir, elegir, verificar etiqueta en el disparador y `?category=` en la URL); el expand de
  sugerencias se abre antes de pulsar la píldora (el test que clickaba la píldora a ciegas aprendió de la tanda
  29: primero la consecuencia observable, luego la acción); orden por columna (clic de cabecera, comprobar el
  orden en la primera fila), filtro de columna con menú (elegir un valor, comprobar filas restantes y el punto
  del embudo), paginación (tamaño 10, avance, «x–y de z»), lote (marcar dos, vaciar con confirmación de la app,
  las filas se van a sugerencias).
- `utensils.spec.ts`: se reescribe contra la tabla (adiós a las pruebas de tramos/`?section=`/progreso; hola a
  paginación, filtro por categoría, toggle en celda y lote de marcado masivo). Un test nuevo de móvil viewport
  (412 px): la hoja «Ordenar y filtrar» abre, filtra por estado y la tarjeta refleja el filtro.

### Checklist de la tanda

- [x] `data-table.util.ts` + spec (TDD: rojo primero): únicos con cuenta y orden estable, predicados por tipo
      (texto/enum casillas, numero condiciones, fecha condiciones con huecos tolerados), orden multi-clave
      (asc/desc/ninguno, mezcla de tipos, `null` al final), paginación (recorte, fuera de rango al filtrar).
- [x] `data-table.component.ts`: cabecera con orden cíclico + Shift, menú de filtro popover (un panel vivo),
      selección con casillas y emisión, lote por proyección, paginación con tamaño, modo tarjetas <720px y hoja
      inferior con los mismos controles, estado vacío con clave i18n.
- [x] Servicio: `cargarInventarioCompleto()` (loop 100, tope 2.000) sin tocar `loadIngredients` (lo usan otras
      pantallas); en el visor, búsqueda y categoría client-side con URL leída y escrita; `clavesSubarbol` en el
      util del gestor (misma semántica que el server).
- [x] Visor: picker de categorías (con cuenta, color, grupo) sustituyendo al riel con scroll; expand de
      sugerencias cerrado por defecto; tabla de inventario con las 7 columnas; lote vaciar/borrar con
      confirmación propia y un toast; stepper y acciones intactos en su celda; fuera los emojis de ubicación.
- [x] Utensilios: tabla (nombre, categoría, estado con casilla, acciones), lote de marcado, fuera tramos y
      `?section=`; modal de alta y texto de intro, como estaban.
- [x] i18n: claves `ui.tabla_*` (orden, filtros, hoja, selección, paginación) y las nuevas de `pantry.*` en los
      dos idiomas; ninguna cadena escrita a mano; ninguna clave huérfana (check-ui 15).
- [x] e2e en la misma tanda: `pantry.spec` y `utensils.spec` reescritos (más el test de móvil de la hoja);
      ningún botón pintado sin destino verificado en la plantilla tocada.
- [x] Puertas: `check-ui` 0 · `tsc -p tsconfig.app.json` 0 · `typecheck:e2e` 0 · `ng build --configuration
production` completo · suite del server (intacta, pero verde por si el picker cambia algo).
- [x] Run de CI como juez de los e2e y su bucle de fixes —tres bucles, y verde. Bucle 1: el velo tapaba el
      popover del cabezal (el th sticky apila aparte), los botones de modo se imprimían la clave cruda y la
      búsqueda no bajaba a minúsculas. Bucle 2: dos promesas del test estaban escritas al revés de lo firmado
      (toasts apilados, insignia con un solo criterio) y el rojo de `caducidad` destapó el dato gordo —el
      `GET /ingredients` responde la fila en `snake_case` y el visor prometía camelCase. Bucle 3, con
      Chromium de npm para reproducir localmente lo que CI solo contaba: el menú del filtro se recortaba
      contra el lienzo con scroll (ahora se ancla a la pantalla y se reencaja al desplazarse), el «tengo» de
      utensilios llegaba en tres formas para decir lo mismo (0/1 del server, `true/false` del optimista, y la
      clave empaquetada como texto en el menú), y el título del modal de alta se pasaba por `[attr.title]`
      a lo que es un `@Input` (diálogo sin etiqueta). Run `ff67e8f`: `pantry.spec`, `utensils.spec` y `tab-urls.spec` verdes íntegros; los rojos que
      quedan en el run son deuda preexistente (account, calendar, ai-goal, shopping, recipes) más el
      conocido cancel de shard 2.
- [ ] Validación manual del usuario en la preview (escritorio y móvil emulado).

## 12ac. Tanda 31 — los tres gestores pasan por la misma tabla: categorías, productos y catálogo

Petición del usuario al cerrar la tanda 30: «Categorías, productos principales y catálogo deberían tener también
esa tabla con todo lo que comenté». La tanda 30 lo dejó anotado (## 12ab §D: «queda apuntado, no improvisado»):
el componente ya está hecho y probado; lo que cuesta es reescribir las tres suites e2e, que entran en esta
misma tanda (regla de la ## 12y). Ninguna de las tres toca el server: los endpoints de hoy dan todo lo que la
tabla necesita.

### A. La carga: el conjunto completo de la consulta, en cliente

La regla que la casa aprendió en la tanda 30: filtrar u ordenar sobre una página es una mentira. Las tres
pantallas cambian de modelo de datos:

- El server deja de paginar la vista. Cada gestor carga **todas las páginas** de su endpoint (limit=100, el tope
  que admite el schema, en bucle hasta `total`, con el mismo tope de 2.000 filas del visor) una vez al montar y
  tras cada mutación. El util puro `cargarTodasLasPaginas(pedirPagina, tope)` nace en `pantry-gestor.util.ts`
  con su spec (TDD): para de leer cuando `offset >= total`, cuando una página llega vacía o al tope, y
  propaga `null` (fallo de red = cero filas con la pantalla avisando, no media lista muda).
- La búsqueda, los chips de vista/filtro y el pasillo se aplican **en memoria** sobre lo cargado, con la
  semántica exacta de lo que hoy hace el server (documentada en cada sitio), salvo un detalle deliberado: la
  búsqueda de estas pantallas pasa a ignorar acentos como la del visor (`quitarAcentos + toLowerCase`), que es
  mejor y es lo que la casa ya promete en `#search`. Los `LIKE` del server no lo hacían; se anota aquí para que
  nadie lo tome por regresión.
  - Categorías: `sin productos` ⇔ `counts.products === 0`; `con subcategorías` ⇔ `counts.children > 0`; la
    búsqueda casa `name` normalizado o `key` (igual que `pantryCategoryKey` del server, aplicada en cliente).
  - Productos: `staples` ⇔ `quantity === 0`; `in-pantry` ⇔ `quantity > 0`; `expiring` ⇔ `hoy <= caducidad <=
hoy+3` **por día** (`claveDeDia` + `sumarDias`, el error del instante ya corregido en el server); `q` casa
    `name` o cualquier alias (el server hacía LIKE sobre name y sobre el JSON de aliases; aquí se comparan las
    cadenas del array, que es el mismo dato sin el JSON).
  - Catálogo: el pasillo filtra por **subárbol de hojas** del árbol del catálogo (38 filas, `listCatalogCategories()`
    ya lo trae plano): nuevo pure `hojasDelSubarbol(categorias, clave)` con su spec —elegir un padre suma las filas
    de todas sus hojas, igual que `hojasDe()` del server, que es lo que fija su e2e («334 productos»). `q` casa solo
    el nombre, normalizado, como `buscarProductos`.
- **URL**: se conservan los enlaces ya firmados —`?q=`, `?view=`, `?filter=`, `?cat=`—, leídos al montar y
  escritos con `replaceUrl` (con el debounce de URL que ya traen, para no reescribir el historial a cada tecla).
  **Quedan jubilados** `?sort=` del gestor de productos (el orden vive en el cabezal de la tabla, como en el
  visor) y `?p=`/`?limit=` de los tres (la paginación es del componente; F5 vuelve a la primera página, igual que
  hoy al no viajar). Los componentes que lean parámetros con `offsetDeQuery` lo dejan de hacer.

### B. Categorías (`/pantry/categories`) — la lista pasa a `app-data-table`

- Columnas: **nombre** (celda proyectada: punto de color + nombre + badge «Reservada» si `protected`;
  `texto`, con `etiquetaValor` por nombre), **padre** (texto; el hueco —las raíces— se pinta vacío y el menú lo
  agrupa como «sin valor», la convención del visor), **productos** (numero ← `counts.products`), **subcategorías**
  (numero ← `counts.children`), **en subárbol** (numero ← `counts.descendantProducts`; es el número que el
  borrado en cascada respeta, pintarlo aparte tiene sentido porque la reserva se decide por él) y **acciones**
  (no ordenable, no filtrable). El «estado reserva/no» no necesita columna: el badge de la fila y el menú de
  «padre» bastan, y una columna booleana con dos valores casi vacíos es ruido.
- Orden múltiple con Shift, menús por columna, paginación y búsqueda global: gratis de la tabla. El buscador de
  la barra (`#gestor-categorias-q`) queda enlazado a lo filtrado en memoria (el `?q=` sigue viajando).
- Chips de vista (`?view=`): se mantienen en la barra, ahora aplicados en cliente.
- **Selección múltiple + lote**: barra en `data-tabla-lote` con dos acciones — «Borrar seleccionadas» (bucle de
  `DELETE /categories/:id` **solo sobre las que admiten borrado** —`canDelete`—; las filas seleccionadas que no
  pueden borrarse se anuncian en el mismo mensaje de confirmación con su cuenta; un solo toast al final con
  borradas/saltadas; recarga de la carga completa tras el lote) y «Anular selección» (sin preguntar). La
  confirmación, `ConfirmService` de la app, nunca `confirm()` del navegador.
- Fila: clic en el cuerpo abre la ficha (ruta `:id`, intacta). El botón de borrar por fila y el aviso «tiene
  artículos» siguen como estaban; `data-test` de fila: `gestor-categorias-fila-<key>` sobre
  `tabla-fila-<id>` (el identificador de fila es la `id`; el `key` se conserva como data-test adicional en la
  celda nombre para no reescribir media suite con mentiras).
- La ficha, los swatches, el picker de padre y el aviso de reserva: sin cambios.

### C. Productos (`/pantry/products`) — misma tabla, mismo lote con impacto

- Columnas: **nombre** (celda proyectada: punto + nombre + chips de alias con el «+n» de los ocultos,
  `texto`), **categoría** (`etiquetaValor` = `pantryCategoryLabel` con su punto de color en la celda, como el
  visor), **unidad** (enum), **en despensa** (booleano ← `inPantry`, etiqueta «Sí/No»; la celda del **stock**
  pinta `quantity + unit` o raya —numero sobre `quantity`, filtrable con los modos del visor—), **caducidad**
  (fecha con el badge `por caducar/caduca` igual que el visor, `claveDeDia` del dato ya camel —`expirationDate`
  del endpoint de productos, no del de ingredientes—), **cesta** (numero ← `impact.listLines`) y **acciones**.
- Orden, menús, paginación: la tabla. El picker `opcionesOrden` (reciente/nombre) **se borra**: su «reciente»
  era `updated_at`, y nadie recuerda ese botón; la columna caducidad y un orden por fila de creación no eran la
  misma promesa. Si algún día hace falta, la columna «actualizado» se añade a la tabla, no un select.
- Chips de filtro (`?filter=`: staples / en despensa / caducan / todo) se mantienen, en cliente (semánticas del
  §A). La barra de lote existente (`gestor-productos-lote`) pasa dentro de la tabla con **la ruta de siempre**:
  `bulkProductImpact` → confirmación de la app nombrando borrables y bloqueados → `bulkDeleteProducts`
  (todo-o-nada, es el contrato del gestor y lo sostiene `pantry-products.routes.spec.ts` con
  `PANTRY_PRODUCT_BULK_DELETE_BLOCKED`; la prohibición de `bulk-delete` de la ## 12ab es del **visor**, cuyas
  filas tienen existencias). «Anular selección» sin preguntar. Tras el lote: recarga de la carga completa.
- Fila: clic en el cuerpo abre la ficha; el botón de borrar por fila sigue deshabilitado con stock dentro. La
  ficha (aliases, impacto, «ver en la despensa») no se toca.

### D. Catálogo (`/pantry/catalogo`) — el riel de pasillos se minimiza, la lista es tabla

- El riel de pasillos (padres con sus hojas, botón a botón) se convierte en el **`app-picker`** del visor: una
  línea «Pasillo: <etiqueta> · <cuenta>» que abre la lista con subárbol (cuenta del padre = suma de hojas, como
  `productCount` del endpoint) y color por categoría. `?cat=` sigue enlazado; «Todos» es el valor limpio. El
  contador `catalogo-resultados` se queda (cuenta lo que la tabla muestra: `filas filtradas`, no la página).
- Columnas: **nombre** (punto + nombre; `texto`), **pasillo** (enum ← `categoryLabel`, etiqueta por el pipe
  `catalog` de siempre… en la tabla el `etiquetaValor` pone la etiqueta ya traducida), **unidad** (enum,
  `unit` crudo es el vocabulario del catálogo y así se pinta hoy —no hay clave que traducir—) y **acciones**.
  El «en casa» NO es columna: es el estado de la fila (check_circle) y sale por el botón, como hoy; añadir una
  columna booleana de solo-lectura que nadie filtra es pintar el DOM del gestor en otro sitio. La carga trae
  TODO el catálogo (~800 filas, bajo el tope) —filtrar 24 filas por página es exactamente la mentira de la
  tanda 30.
- Búsqueda: `#catalogo-q` filtra en memoria (nombre normalizado, como `buscarProductos`), `?q=` enlazado.
- **Selección múltiple + lote**: «Añadir a la despensa» de las filas seleccionadas usa `POST /catalog/add` con
  los ids (es la ruta de la fila suelta, con su validación todo-o-nada y sus contadores `added/skipped`); un
  toast con el recuento y recarga. La fila individual mantiene su botón `+` idéntico (misma `data-test
catalogo-anadir-<id>`). «Añadir lo visible» **cambia de significado con honestidad**: pasa a añadir **lo que
  la tabla muestra tras filtros** (las filas del dataset filtrado, no la página) —el botón se llama como lo que
  hace: «Añadir lo de la pantalla» (`pantry.catalogo_anadir_filtrados`, nueva clave; la vieja se borra con su
  value). Con filtro «solo fuera de casa» activo, el botón hace exactamente lo que el usuario acaba de pedir.
- La fila ya en casa sigue mostrando «En tu inventario» sin botón; el reflujo móvil, igual que el visor.

### E. i18n y acabado

- Claves nuevas es+en donde haga falta (columnas «subcategorías», «en subárbol», «cesta», «pasillo», el botón de
  lote de categorías, el aviso de salteadas, «añadir lo de la pantalla»…) y **bajas**: las claves de los textos
  jubilados (`pantry.catalogo_anadir_visibles`, las de `opcionesOrden` si no las usa nadie más) se borran del
  diccionario con su value (regla: no dejar huérfanas). Los `t:` con `as any` de la primera versión del visor
  no se repiten aquí: las claves nuevas se declaran y se usan con `TranslateKey`.
- Visual: misma cabecera `gestor__header` (volver/título/ayuda) y el `app-page` contenedor; toolbar con
  [chips][buscador][botón nuevo] y la tabla debajo, con su barra de lote pegada a la cabecera de la tabla. En
  móvil (<720) el reflujo a tarjetas y la hoja «Ordenar y filtrar» del visor, sin CSS duplicado: es el mismo
  componente. Márgenes y alineaciones con tokens, como exige la casa.

### F. Suite e2e (misma tanda)

- `pantry-managers.spec.ts` reescrito al molde de la tabla: la categoría nueva con color y padre se busca por la
  caja y por el menú de «padre»; la reserva sigue sin poder romperse (botón deshabilitado en fila y lote que la
  salta); «una categoría con artículos no se borra» usa el menú de la columna productos (filtro `mayor que 0`)
  en vez de contar filas a mano; el lote de categorías borra dos filas con confirmación y un toast; el lote de
  productos mantiene impacto/confirmación; el F5 conserva `?q=`, `?view=`, `?filter=` y la ficha; `?sort=`
  jubilado se comprueba por ausencia (entrar con `?sort=recent` no lo devuelve escrito).
- `pantry-catalog.spec.ts` reescrito: el picker de pasillo pinta subárbol (334 por «alimentos», la cuenta del
  trigger), la fila se añade con un clic y pasa a «en casa», «añadir lo de la pantalla» manda el conjunto
  filtrado y no duplica, el lote de selección usa `tabla-marcar-<id>`, y entrar por URL `?q=&cat=` deja la
  pantalla igual que antes de jubilarse la página server-side.
- El `leedor` del data-table lee `fila[clave]`: para campos calculados (counts, impact) la pantalla proyecta
  las filas con esos campos **en la propia fila** (un `map` al cargar: `productos: c.counts.products`, etc.) en
  lugar de ensuciar el componente con accessors. Es dato de presentación, no modelo: se dice en el componente.

### G. Puertas

- `check-ui` 0 · `tsc -p tsconfig.app.json` 0 · `typecheck:e2e` 0 · `ng build --configuration production` 0 ·
  suite del server intacta y verde (no se toca; si algo del catálogo en cliente revela una semántica mal copiada,
  se corrige en cliente, no en el server) · unitarios de `pantry-gestor.util` y `data-table.util` verdes en el
  navegador local · e2e de las tres pantallas, reproduce y decide el navegador local; CI como juez final.

### H. Fuera de la tanda

- El visor (`/pantry`) no se toca: ya tiene su tabla. Las pantallas `:id` (fichas) no se rediseñan.
- Seguir usando `?q=` compartido con `buscar=` del visor sería coherente, pero rompe contratos de tanda 30 y el
  e2e de tab-urls: se anota, no se hace.

### I. Cierre de la tanda (2026-09-23)

- [x] Utils del gestor por TDD (`pantry-gestor.util.spec.ts`, 24/24): `cargarTodasLasPaginas` (corta por
      `total`/`hasMore`/tope 2.000 y devuelve `null` si una página falla, nunca media lista muda),
      `caducaEnTresDias` (ventana HOY..HOY+3 inclusiva, como `date('now','+3 days')` del server) y
      `coincideGestor` (OR de campos sin acentos, consulta vacía lo deja pasar todo).
- [x] `app-data-table` gana `resultadoChange`: el conjunto filtrado y ordenado ANTES del corte de página,
      emitido por un effect sobre un computed nuevo; es lo que consume el botón «añadir los de la pantalla»
      del catálogo, para que respete también los menús de columna.
- [x] Catálogo reescrito al molde de la tabla: riel de pasillos → `app-picker` (con color, cuenta del
      subárbol y grupos), paginación manual → paginador de la tabla, `?offset=` jubilado, dataset completo
      en memoria con `coincideGestor` + `clavesSubarbolDe`, selección múltiple con lote (POST /catalog/add
      sin confirmación: no es destructivo) y botón por fila conservado.
- [x] Productos: chips `staples/in-pantry/expiring/all` y búsqueda (nombre y alias, sin acentos) en memoria
      con la semántica exacta del server; picker `opcionesOrden` y `?sort=` fuera; su lote con impacto
      (`bulkProductImpact` → ConfirmService → `bulk-delete` todo-o-nada) conservado; ficha y alta intactas.
- [x] Categorías: vista y búsqueda en memoria (recuentos del server, proyectados en la fila para que los menús
      numéricos sean de verdad), columnas nombre/padres/productos/en subárbol/subcategorías/acciones, y lote =
      bucle DELETE solo sobre `canDelete` con las no-borrables anunciadas EN la confirmación; ficha intacta.
- [x] i18n es+en: columnas nuevas (pasillo, cesta, productos, en subárbol, subcategorías), `editar_producto`,
      lote de categorías y «añadir los de la pantalla»; bajas reales: `catalogo_anadir_visibles`,
      `opcionesOrden`-claves (`orden_por_nombre`, `orden_recientes`), `siguiente`, `cuenta_sin_articulos` y
      `cuenta_articulos_descendientes` — cero huérfanas (check-ui).
- [x] e2e en la misma tanda: `pantry-managers.spec.ts` (12 tests: lote de categorías con salto de la reserva,
      lote de productos con impacto, menú de columna estilo Excel, búsqueda sin acentos, F5 sin `?sort=`) y
      `pantry-catalog.spec.ts` (5 tests: carga completa con paginador de tabla, pasillo-picker con URL,
      selección-lote sin confirmación, alta que sale en el gestor). Verdes íntegros en escritorio y en
      mobile-chrome local.
- [x] Puertas: `check-ui` 0 · `tsc -p tsconfig.app.json` 0 · `typecheck:e2e` 0 · `ng build --configuration
production` 0 · karma de lo tocado 49/49 · suite del server intacta (no se tocó).
- [x] Run de CI como juez (`35846007180`): las dos suites reescritas, verdes; el conjunto de rojos finales es
      el mismo que en el run de la tanda anterior (deuda preexistente: account, calendar, ai-goal, shopping ×3
      familias, recipes, y el «sin results.json» del job full-stack, ya rojo igual en `a2a5125`). Un detalle
      que solo enseñó el navegador local: el prefijo `catalogo-anadir-` de las filas choca con el botón de
      pantalla de la barra —los selectors de alta pasan a `.celda__accion` dentro de la fila—.
- [ ] Validación manual del usuario en la preview (escritorio y móvil emulado).

## 12ad. Tanda 32 — la tabla se refina: tramos con Shift, paginador de verdad, lote flotante y buscador pegado

Petición del usuario sobre las tablas heredadas de las tandas 30–31, con una captura del paginador de Windows
como referencia visual. Seis mejoras, todas en el componente compartido (`app-data-table`) salvo donde diga el
contrario, y todas con su regla:

### A. La casilla de «seleccionar la página» deja de estar pegada

El `th` de selección no tiene relleno (los `th` de columna lo heredan de `.th`, la casilla va suelta) y el
cuadrito de 26 px queda a cero del borde. Se centra y se respira: `th--check` y `td--check` a 56 px con
`text-align: center` y el mismo padding vertical que el resto del cabezal. Nada más se mueve: el cuadrito de
fila (`.tabla__td--check`) ya vive en un `td` con `--space-2` — se le añade el centrado, que es lo que falta
para que columna y celda apunten al mismo eje.

### B. Seleccionar tramos con Shift, como en Windows

Mantener Shift y pulsar la casilla de una fila marca el TRAMO desde la última fila pulsada sin Shift hasta la
pulsada ahora (ambos inclusives), en el orden visible de la página actual —igual que el explorador de Windows:
el tramo REEMPLAZA la selección, no se suma—. Sin ancla previa, el Shift+click se comporta como un click
normal. El gesto vive en el `click` (fase burbuja) del propio `td--check`: cuando hay Shift, el toggle que el
`app-checkbox` ya hizo queda absorbido porque el tramo reemplaza la seleccion; sin Shift, el `td` solo mueve el
ancla y deja trabajar al boton. (Angular no admite el modificador `.capture` en la sintaxis de eventos.)
que así no llega al `app-checkbox` y no hay doble toggle); el ancla vive en el componente (guarda el id, no el
índice: el orden cambia al filtrar y el índice envejece mal) y se actualiza en todo click normal y en
`togglePagina` (el ancla pasa a ser la primera fila de la página). Cambiar de página o de filtros no rompe el
ancla mientras la fila siga viva; si desaparece del mapa de la página actual, el tramo se calcula contra la
lista ordenada completa (`resultado()`) y solo se marcan las filas que además están en la página —no hay
tramo silencioso a través de filas invisibles—.

Utilidad pura con test: `tramoDeIndices(a, b): number[]` (inclusive, en cualquier sentido). El componente la
usa; no hay trampa de test pegado a Angular.

### C. «Filas por página» es un desplegable, no cuatro botones

El `pie__tam` de botones sueltos (`tabla-tamano-<n>`) se jubila: pasa a ser un `app-picker` dentro del pie
(`data-test="tabla-tamano"`), con las opciones del input `tamanos()` etiquetadas con la nueva clave
`ui.tabla_filas_pagina` («{n} por página»/«{n} per page») y `title`/`aria-label` con `ui.tabla_por_pagina`.
Cambiar el tamaño mantiene la selección y RE-ANCLA la página para que la fila vista siga a la vista
(`pagina = floor((paginaAnterior-1)*tamanoAnterior / tamanoNuevo) + 1`, con test unitario de la fórmula en
`reanclarPagina(actual, tamanoViejo, tamanoNuevo)`). El tamaño no viaja en la URL: es preferencia de la
visita, como el orden interno de la tabla.

### D. Paginador con selección intermedia de páginas

El «‹ 1/39 ›» se convierte en el paginador de la captura: `‹ Anterior · 1 … 5 6 7 … 39 · Siguiente ›`,
themed con los tokens de la casa (mismo `.pag` actual, la página activa con `--on` y `aria-current="true"`).
Reglas del tramo (`tramoDePaginas(actual, ultima): (number | 'hueco-ini' | 'hueco-fin')[]`, con test):
primera y última siempre; ventana de ±1 alrededor de la actual; un hueco de UN solo número se imprime como
número (nada de «1, …, 2»); dos huecos se fusionan si se solapan. Cada número es botón
(`data-test="tabla-pagina-<n>"`, `title` con `ui.tabla_ir_pagina`); los huecos son texto `…`
`aria-hidden`; `tabla-anterior`/`tabla-siguiente` conservan data-test y comportamiento (desabilitados en los
extremos). El texto «Página x de y» (`tabla-pagina`) sigue existiendo como etiqueta accesible del conjunto:
se pinta aparte en el pie y no compite con los números. En móvil el pie refruye y el paginador se recorta a
`‹ [6] ›` con el rango textual (`vista` de ≤640 px), como el resto de controles que ya ceden espacio.

### E. El buscador vive pegado a la tabla

La tabla acepta un slot nuevo: `div[data-tabla-buscar]`, proyectado dentro de la tarjeta, por encima del
lienzo, con `padding: var(--space-3) var(--space-4) var(--space-2)` y la clase `.tabla__buscar:empty {
display: none }` para que las tablas sin búsqueda no noten nada. Las cuatro pantallas que tienen caja de
búsqueda sobre la tabla (visor: `#search`; productos: `#gestor-productos-q`; categorías:
`#gestor-categorias-q`; catálogo: `#catalogo-q`) MUEVEN el `app-input` a ese slot sin tocar ids, data-tests ni
el debounce propio; la fila de toolbar de cada pantalla conserva lo demás (chips, pickers, botones) y pierde
el `flex: 1 1 280px` del input, que ya no hace falta. «Pegado» es literal: la caja queda dentro del mismo
borde redondeado que la tabla, compartiendo fondo.

### F. El lote es una barra flotante de pie que no tapa nada; «Anular selección» pasa a X

El slot `data-tabla-lote` se proyecta AHORA al pie de la tarjeta (después del paginador), y la barra `.lote`
de las cinco listas (inventarios, utensilios, categorías, productos, catálogo) pasa de «franja en cabecera /
sticky solo en móvil» a `position: fixed` centrada abajo (`bottom: calc(--space-4 + env(safe-area-inset-bottom))`,
ancho `min(100% - 2*--space-4, 1000px)`, `z-index` por debajo del popover de columna (60) y del modal, por
encima del sticky del cabezal), con fondo de tarjeta, borde y `--shadow-lg`. Como flota sobre el contenido,
CADA barra lleva detrás un separador en el flujo (`.lote__empuje`, altura 72 px, `aria-hidden`) proyectado en
el mismo `@if`, para que la última fila jamás quede tapada ni con el scroll al fondo. El botón «Anular
selección» de las cinco listas pasa a botón-icono `close` (16 px) con `aria-label` y `title` =
`pantry.lote_anular`; los data-tests (`pantry-lote-anular`, `utensilios-lote-anular`,
`gestor-categorias-lote-anular`, `gestor-productos-lote-anular`, `catalogo-lote-anular`) no cambian.

### G. El lote del catálogo también quita del inventario (con confirmación)

A «Añadir a la despensa» y la X se les suma «Quitar del inventario» (`data-test="catalogo-lote-quitar"`,
clave nueva `pantry.catalogo_lote_quitar`), activa solo si hay filas seleccionadas con `inHousehold`. El
borrado es el del visor, no el de las fichas: se resuelve el ingrediente de la casa por la MISMA clave con la
que el server pinta el «en casa» (`normalizeProductName` del server portada al cliente como
`claveDeProductoCasa`, con test espejo de sus reglas: acentos, ruido, unidades abreviadas y palabras sueltas),
se confirma por el diálogo propio nombrando cuántos artículos se quitan (clave nueva
`pantry.catalogo_lote_quitar_pregunta`, `{n}`), y se aplican `DELETE /ingredients/:id` en bucle (el mismo
`deleteIngredient` del servicio, que ya poda la cache del visor). Lo no resuelto (fila marcada «en casa» que
ya no tiene ingrediente) se anuncia en el mismo toast, no se calla. Al terminar: recarga del catálogo y
`pantry.lote_borrados` en el toast de éxito. NO es destructivo con las fichas: el catálogo no borra
productos, quita existencias de la casa.

### H. Accesibilidad, i18n y estilo de la tanda

Todo control nuevo lleva `title` (popover nativo) y `aria-label` o etiqueta visible: el picker de tamaño, los
botones de página (aria-current en el activo), la X de anular y el botón de quitar. Iconos decorativos con
`[label]="null"`; el hueco «…» con `aria-hidden`. Todos los textos pasan por el diccionario en es+en —claves
nuevas: `ui.tabla_filas_pagina`, `ui.tabla_ir_pagina`, `pantry.catalogo_lote_quitar`,
`pantry.catalogo_lote_quitar_pregunta`— y lo jubilado (`tabla-tamano-<n>`, los `.tam`) no deja huérfanas
(check-ui 16). Se respeta `prefers-reduced-motion` en la sombra de la barra (no hay transiciones nuevas, la
que hay es la del sistema).

### I. Puertas, e2e y fuera de la tanda

- [ ] TDD de las tres utils (`tramoDeIndices`, `reanclarPagina`, `tramoDePaginas`) y del port `claveDeProductoCasa`, en sus specs actuales.
- [ ] `check:ui` 0 · `tsc -p tsconfig.app.json` 0 · `typecheck:e2e` 0 · `ng build --configuration production` 0 · karma de lo tocado en verde · suite del server intacta.
- [ ] e2e en la misma tanda (## 12y): actualizar `pantry.spec` (tamño por picker, paginador con números, buscador en su slot) y añadir: Shift+tramo (escritorio), salto por número, tamaño 10 → re-ancla, y el flujo completo de «Quitar del inventario» en el catálogo (añadir → en casa → quitar → vuelve a estar añadible, con su confirmación nombrando el cuántos). `pantry-managers`/`pantry-catalog`: nada de esto cambia sus contratos salvo `tabla-tamano-*` si alguien lo usaba.
- [ ] Run de CI como juez, verde de lo reescrito sin aumentar deuda.
- [ ] Validación manual del usuario en la preview (escritorio y móvil emulado).

Fuera de la tanda: el servidor no se toca (la port `claveDeProductoCasa` es lectura del contrato, no cambio);
la persistencia del tamaño en URL/localstorage no se añade «porque sí» —se apunta para una tanda de
preferencias si el usuario la pide—; los `alt` en iconos son `aria-label` de botón, que es como funciona la
casa desde la tanda 8.

## 12ae — Revivir el job full-stack (y el SSE de logs que tapaba)

**A. El config, cargable.** `playwright.full-stack.config.ts` no puede usar `import.meta` (ni `__dirname`):
la raiz no declara `type: module` y Playwright carga el fichero como CJS, con lo que el job moria en un
segundo sin escribir ni `results.json`. Regla: el config solo usa rutas relativas (`testDir`, `globalSetup`,
`webServer.cwd` por defecto = la carpeta del config) y `process.env`. El `DATABASE_PATH` del webServer queda
relativo a la raiz (`server/data/hogaria-e2e-full-stack-<puerto>.sqlite`).

**B. `E2E_CHROME_BIN`.** Opcional y solo local: si existe, los dos proyectos pasan `launchOptions.executablePath`.
En CI no se define y manda el navegador de Playwright. Sirve para entornos sin acceso al CDN de navegadores.

**C. El stream de logs habla SSE de verdad.** `GET /api/logs/stream` debe responder `Content-Type:
text/event-stream` —`EventSource` aborta con cualquier otro MIME—. `stream()` de Hono construye su propia
Response con `text/plain` (y `stream()` devuelve una Promise: retoñar cabeceras «sobre la respuesta» no
hace nada); la ruta pasa a `streamSSE` —lo que ya hacia el stream de las cestas— conservando
`X-Accel-Buffering: no`, el encuadre `: connected` / `data: {"type":"connected",...}` / `: ping` y la
limpieza por abort. Regresion fijada en `src/app.spec.ts`, leyendo el primer frame `connected` del propio
proceso.

**D. Lo que NO toca esta ronda.** Con el job vivo aparecen los rojos que nunca llego a contar: rachas de
`GET /api/shopping/lists/:id` dobles/triples y los selectores de `shopping-money` —la familia de deuda de
shopping (rondas 6/10/listas), declarada intocable—. El job se deja correr y reportar esos rojos con nombre
y apellidos; no se reescriben los umbrales del presupuesto ni se maquillan los specs para que cuadren.

**Checklist.** [x] config sin `import.meta` (verificado con `--list` limpio y el job entero en local) ·
[x] `E2E_CHROME_BIN` opcional · [x] ruta a `streamSSE` + test en `app.spec.ts` · [x] suite del server
731/731 · [x] full-stack local: `served-app` 5/5, `rate-limit` 3/3, `logs-live` 4/4 (movil incluido);
restantes rojos = familia shopping (documentada en D) · [x] `check:ui`, karma y builds intactos (frontend
no cambia).

## 12af — De cocina a casa: copy generico, pistas en popover y buscador que respira

**El parte (2026-09-23, ronda 34).** Tres cosas del usuario, una detras de otra: (1) «Tu asistente de cocina
inteligente» ya no vale —la app es generica—, y lo mismo «¿Que vamos a cocinar hoy?» nada mas entrar; busca las
demas frases asi. (2) «Te dije popover, no alt ni title: eso tarda en salir». (3) El buscador de la tabla «se ve
pegado por abajo», quiere padding continuo.

**A) Las frases de solo-cocina, fuera (diccionario ES e INGLAES, y el `index.html`).** La regla que se extrae:
**el copy que posiciona la app entera no puede ser de cocina**; si la frase vive dentro de un modulo y habla del
modulo (el nivel de cocina del onboarding, los utensilios de la despensa, el filtro de recetas), es literal y se
queda. Los cambios, clave renombrada cuando la clave era la frase vieja:

- `auth.tu_asistente_de_cocina` → `auth.tu_asistente_del_hogar`: «Tu asistente para tener la casa a punto» /
  «Your assistant for keeping the home in order». Era el subtitulo del login y de crear cuenta.
- `dashboard.subtitle`: «¿Que vamos a cocinar hoy?» → «Tu casa, de un vistazo» / «Your home at a glance».
- `onboarding.hogaria_es_cocina_y` → `onboarding.hogaria_es_tu_dia_a_dia`: «HogarIA es el dia a dia de tu
  casa: dinos como andas de cocina...» — la pregunta sigue siendo de cocina, la definicion de la app ya no.
- `ai_config` (dos): el proveedor de IA ya no es «para generar recetas» a secas —«para que el planificador y
  las sugerencias funcionen», y «recetas, menus y cestas a tu medida»—, que la IA de HogarIA es una sola para
  todo.
- `pantry.agrega_ingredientes_para_empezar`: el vacio del inventario no «empieza a generar recetas», empieza
  por «contar que tienes en casa: la IA lo tendra en cuenta».
- `pantry.quitar_del_catalogo`: el catalogo NO es «de tu cocina», es `de tu hogar` (el dialogo lo confirmaba,
  y el EN decia «kitchen catalogue»).
- `index.html <title>`: «Cocina, compra y hogar con IA» → «Tu casa, organizada con IA». La meta description ya
  era generica desde la absorcion de Basketra.

  Y lo que encontro la auditoria de placeholders era mas gordo que un token: trece claves de `onboarding`
  entraron cruzadas de idioma en el diccionario en d9d1dc5 —en el bloque `es`, el ingles entero; en el `en`,
  el espanol—. Nadie lo leyo nunca: el shard 2, el que contiene los specs de `onboarding` e `i18n-idioma`,
  esta cancelado desde que existe el job. El arreglo es el intercambio de las 13 parejas (las claves ya estaban
  en ambos bloques) y, de paso, `{title}`→`{titulo}`, que si era del codigo. Verificado con una sonda de
  playwright-core —4 segundos de navegador— antes y despues del cambio: la cabecera del tour en ingles ya
  no pinta el literal, y el espanol dice «Paso 5 de 6 · Horarios».

**B) Las pistas son popover, no el title nativo (reincidente, y con razon).** El `title` de HTML tarda ~1 s en
aparecer, no se puede estilizar y desaparece al pulsar; el `alt` ni es tooltip. El proyecto YA tenia
`app-tooltip` (shared/ui) y nadie lo usaba: se usaba como pista-hover unica en toda la tanda de tablas:

- Sale AL INSTANTE (`:hover` y `:focus-within` del wrapper, fade de 150 ms), y con el foco por teclado, que el
  `title` no cubria.
- Texto largo (el catalogo detras de un chip de sugerencia) se parte en varias lineas con tope de 280 px en vez
  de desbordar la tarjeta — el `nowrap` del popover viejo estaba pensado para pistas cortas.
- Migran sus `title`/`[attr.title]` al popover: el paginador de la tabla («por pagina» en el picker de tamano e
  «Ir a la pagina N» en cada numero), la X de «Anular seleccion» de las cuatro barras de lote, el boton
  «Quitar N del inventario» del catalogo (pista `..._quitar_info`), los iconos de fila (alta en casa, ±unidad,
  editar, borrar —incluidas las pistas CONDICIONALES «en uso»/«en despensa» de categorias y productos—), el
  borrado de utensilios y los chips de sugerencia del visor. El `aria-label` se queda donde estaba: el popover
  es lo que se VE, el label es lo que se LEE.
- Los `alt=""` de imagenes decorativas no se tocan: eso es accesibilidad, no pista. Y `app-modal` tiene un
  `@Input() title` que no tiene nada que ver con tooltips.

**C) El buscador de la tabla respira.** `.tabla__buscar` llevaba `padding: var(--space-3) var(--space-4) 0` —el
cero de abajo dejaba el campo pegado a la cabecera de la tabla—. pasa a `var(--space-3) var(--space-4)`: padding
continuo, la caja de busqueda es ahora un bloque con la misma holgura arriba y abajo dentro de la tarjeta.

**D) Dos bugs de la app que salieron en el triaje, y que habria sido mentir tapar con los specs.** (1) _Horarios
del tour al reves_: desde 528d2e3 el boton «Por defecto» de cada fila estaba atado a `*ngIf="isDefault(row.type)"`
—aparecia cuando la hora NO estaba tocada y desaparecia al tocarla, o sea justo al reves de su funcion: no habia
forma de deshacer—. Queda `isNotDefault`, el span de «estado por defecto» seguia bien, y el contrato de karma
pide ahora `filter(isNotDefault)` → `['dinner']` con una fila tocada. (2) _El guardado del tour tosteaba la clave_:
`save` del componente de onboarding comenta que traduce titulo y cuerpo al pintarlos, pero llamaba a
`toastService.success(title, body)` en crudo —el toast salia literal «onboarding.listo» en los dos idiomas, y el
`skip` igual con «onboarding.guardado»—. Ahora pasa `i18n.t(...)` y el e2e exige el texto «Listo», no solo
que el toast exista.

**E) El job full-stack corria pero no anotaba resultados.** Tras d787634 el E2E se ejecutaba de verdad (4,5 min
en el run 35920837815) y el resumen seguia diciendo «sin resultados»: `playwright.full-stack.config.ts` no
llevaba el reporter `json`, asi que nunca se escribia el `test-results/results.json` que lee
`scripts/ci-e2e-summary.mjs` (el config de dev si lo lleva; nadie habia cruzado los dos). Anadido; verificado en
local corriendo el pipeline sin flags `--reporter` (mandarlos a pelo en CLI pisa los del config): annotations con
los 8 rojos reales de la tanda, con nombre y apellidos.

**F) Los specs ciegos del shard 2, uno a uno.** Nadie los habia ejecutado nunca y se nota: `i18n-idioma` clicaba
`getByRole('button', {name:'English', exact:true})` sobre botones que desde la migracion de banderas dicen
«🇬🇧 English» —el `exact` jamas casaba; los 15 rojos del spec eran eso—, y para seleccionar idioma por test
se han anadido `data-test="settings-lang-{auto,es,en}"` a los botones de Preferencias. `onboarding` pedia
`toContainText` a un span `.preferences__state` que vive dentro de un `*ngIf` (no existe cuando no hay cambios: se
cuenta con `toHaveCount(0)`, no se le pide texto al fantasma), localizaba el custom de gustos sin `.last()` y
empataba entre dos pasos montados, y su test de «se puede saltar un paso» se habia quedado a mitad de tour —ahora
llega al Paso 6 y pulsa «Guardar y empezar». Y el de `/shopping` esperaba una cabecera «Pendientes» que no
existe: la bandeja vacia titula «Lista de la compra» / «Shopping list», que es el par que comprueba ahora. Regla
que se queda: **correr los shards huerfanos en local con `--workers=1` antes de fiarse de un rojo o un verde de
CI**.

**G) Los rojos de movil no son de esta ronda.** Bajo `mobile-chrome` en esta maquina fallan seis tests (pantry:
hoja de orden/filtro, chip de sugerencia, flechas del paginador; utensilios: el modal de alta) con «pointer
events intercepted» por elementos vecinos. Reproducidos identicos sobre el arbol con `git stash` (sin ningun
cambio de la ronda), es la excentricidad de hit-testing del emulador con overlays fijos ya anotada en la ronda 32;
el CI no los cubria (shard 2 cancelado / specs posteriores al ultimo shard en pie). Quedan como deuda conocida,
sin tocar.

**H) Fuera de alcance, como siempre:** los rojos de deuda conocida (shopping, calendar, ai-goal, account,
recipes, cancel-shard) no se tocan; el copy de los modulos que habla de su modulo sigue en su sitio.

**Checklist.** [x] copies genericos en el diccionario (ES+EN) y en `index.html` · [x] ~19 pistas a `app-tooltip`,
ningun `title`/`alt` de pista sobreviviente; `check:ui` 189 ficheros / 20 reglas / 0 incidencias · [x] padding
continuo en `.tabla__buscar` (medido en e2e: arriba == abajo > 0) · [x] swap de `onboarding.ts` y toast con clave
cruda, verificados con sonda y con e2e exigiendo texto traducido · [x] flip de meal-hours con contrato karma nuevo
(karma dirigido: 186/188, los 2 rojos son checkbox/modal de siempre) · [x] reporter `json` en full-stack y
`ci-e2e-summary` funcionando en local · [x] e2e tocados en verde: `onboarding` 6/6, `i18n-idioma` 16/16,
`settings-theme-i18n` 6/6, `pantry`+familia+`preferences` 47/48 (el rojo, interference cross-spec bajo
workers=2; en solitario verde) · [x] `build` de produccion, `typecheck:e2e` y dist al dia · [ ] los seis moviles
de G, deuda nueva documentada.

**Veredicto del CI (runs 35965898182 → 35968622851).** Con el reporter json vivo, el job full-stack anoto por
fin los suyos y el triaje de CI sumo dos cadaveres mas del propio shard 2: el `selectOption` de `dashboard.spec`
y `confirm-dialog.spec` sobre los selects de alta que enterraron los app-picker en la ## 12x (el titulo «🚪 Salir
del hogar» tampoco casaba con `toHaveText` —el emoji se quita en su tanda—), y cinco rojos estructurales de los
specs de `full-stack/` que el shard de desarrollo se tragaba por ser `tests/e2e` recursivo: `testIgnore` los
devuelve a su job. Despues de `52f800e`: **shard 2 verde por primera vez en la historia del repo** y el conjunto
rojo restante = la deuda documentada al pelo (account×5, calendar×3, ai-goal×1 en el 1; recipes×2 en el 3;
shopping×9 en el 4; shopping-money + request-budget en full-stack), sin un solo rojo nuevo y con las
disminuciones legitimas (i18n, onboarding, meal-hours, pantry paginar y los dos selects ciegos) explicadas en
sus commits.

## 12ag — Paginador con saltos, sugerencias del catalogo, vaciar con vuelta a casa y autoguardado que no pierde el ultimo tecleo

**El parte (2026-09-24, ronda 35).** Cuatro cosas del usuario: (1) el paginador de las tablas solo puede ir de uno
en uno —quiere saltar al principio y al final—; (2) al aadir producto a la compra, que sugiera los del catalogo
antes de escribir; (3) un boton «Vaciar carro» que saque lo comprado de la lista y lo vuelque al inventario, con
deshacer; (4) «si cierro el editor justo cuando guarda, se pierde el ultimo cambio». Y de propina, el CI segua
rojo de `round10` por dos tests que no eran del test: estaban cruzados.

**A) Paginador.** `tramoDePaginas(actual, total)` en `data-table.util.ts` (con spec propio) decide que numeros se
pintan —`[1, '...', 4, 5, 6, '...', 20]` con la ventana de siempre— y a los lados dos botones nuevos:
`first_page`/`last_page` duplicados en SVG (`icon-paths.ts`) con tooltip `ui.tabla_primera_pagina` /
`tabla_ultima_pagina`, ES y EN. Salta a 1 y a `totalPaginas`, no «un paso grande»: llegar a la pagina 20 de 20
en un clic o no ir.

**B) Stepper unificado.** El `+`/`-` de la despensa eran `app-icon-button` con icono de 18 y el de la tabla de
44/20; ahora todo 28 px de boton con icono de 14 —la norma queda escrita en `pantry.component.ts` y replicada en
la fila de la compra.

**C) Sugerencias del catalogo en la hoja de aadir.** Panel `.detail__sug` bajo el input: busca en el catalogo
mientras se teclea (secuencia `sugSeq` para que una respuesta vieja no pinte sobre una nueva), cada sugerencia
trae la ultima compra y si ya esta en casa; aadir desde ahi reutiliza el alta normal. Copy nuevo en
`shopping_list_detail` (`sugerencias_del_catalogo`, `ya_en_casa`...) y la imagen que no carga o el modelo que
tarda tienen frase propia en vez de silencio.

**D) Vaciar carro = vuelco al inventario.** El boton vive en la barra de acciones; en movil es solo icono
(`app-icon-button`), en escritorio solo texto —`detail__bar-actions` decide por `min/max-width` y uno de los dos
se oculta, un solo boton real—. Abre `app-confirm-dialog` («Vaciar lo comprado»), y al confirmar: PATCH de la
lista con `checked: false` para los pendientes (que se quedan) y los comprados se van; el servidor (route
`shopping.routes.ts`, con spec en `shopping.routes.spec.ts`) los sube al inventario haciendo SUMAR si la linea
existe y CREAR si no —`pantryMoved`/`pantryMerged` en `shopping.model.ts` cuentan cada caso— y el toast dice
«1 articulo ha ido al inventario» o «N articulos: X nuevos, Y sumados» con Deshacer que baja otra vez a la lista
de pendientes.

**E) Autoguardado sin perdida.** `closeEdit()` ahora hace `flush('item:'+id)` ANTES de cerrar: el debounce
cancelado se ejecuta en vez de tirarse (los `debouncedRuns` guardan el cierre por clave). El precio en la fila
manda un unico payload `linePatch(priceMinor)` y `commitPrice` solo lanza su PATCH si no habia nada pendiente,
para no doblar la escritura. Quitar item pide confirmacion y el toast con Deshacer sale pase lo que pase con la
red.

**F) El diccionario estaba cruzado y el test lo gritaba.** En `shopping_list_detail.ts` el bloque ES llevaba
`'unidad': 'unit'` y el EN `'unidad': 'unidad'` a la inversa —por eso `round10:80` (chip «en 2 units») era rojo en
CI y verde aqui: el CI corre con el ES del remoto, vicio de la tanda 12af al mover claves. Descruzado y
comprobado clave a clave contra el remoto: cero perdidas, cuatro anadidos (los de sugerencias).

**G) Dos lecciones de obra, cara cada una.** (1) **El presupuesto de CSS por componente no se esquiva sacando el
CSS a `styleUrls`: el `check:ui` esta ciego a esos ficheros y `boton-sin-afecto` salta** —lo que vale es un
array `styles: [principal, panel]` con dos literales en el propio `.component.ts`, cada uno por debajo de 20k;
y jamas backticks dentro, ni en un comentario: rompen el template literal con un errorcito «position 1» que no
seala nada—. (2) **El postinstall del raiz corre `prettier --write .`**: tras un `pnpm install`, un `git add -A`
recoge medio repo en formato y uno cree que su diff es de 13 ficheros cuando son 300. Regla: `prettier --write`
solo a los ficheros del diff, y `git status --porcelain` antes de commitear. Y los `input#search` «rotos» que
aparecian con `git stash` montado eran el arbol viejo del stash, no un fallo: no experimentar con el stash
mientras se mide un rojo.

**El parte de salud.** `shopping-lists` 14/14 (los dos dialogos de confirmacion tienen su clic en el spec, que
sin el el carro se quedaba vaciado a medias), `shopping-sugerencias` 3/3, `round10` 8/8, karma diana 64/64
(modelo, simetria del dict, tramo del paginador, picker), suite e2e completa 176/22/1 —los 22 son los rojos
historicos de account/calendar/recipes y compaia, mi saldo neto contra el run 35969357522 es de cuatro rojos
menos—, `build:prod` verde y `check:ui` sin incidencias en 189 ficheros.

## 12ah — El confirm por encima de la hoja, la sugerencia con su seccion y el paginador que no respira

**El parte (2026-09-24, ronda 36).** Tres partes del usuario con sus fotos: (1) «el modal de quitar si quieres
eliminar sale detras del modal de edicion, eso esta mal»; (2) «al anadir desde sugerencia no te infiere todas sus
caracteristicas: categoria etc., deberia hacerlo»; (3) «la paginacion se sigue viendo mal: desde un inicio deberia
verse 1 2 3 4 o la que sea, y luego lo de los puntos, pero cambia el tamano horizontal y una buena UI evita esto».

**A) La hoja bajo el modal, no encima.** El «modal de edicion» de la linea es la hoja `detail__sheet-backdrop`, que
viv­ia a `z-index: 1200` —por encima del nivel modal de la app (1000)—, asi que el confirm de quitar (un `app-modal`)
se pintaba detras del backdrop oscurecido: invisible e inalcanzable. La escalera queda escrita en el propio CSS:
popovers de pagina (45) < hoja (900) < modal/confirm (1000). El spec lo mide con los dos z-index reales y pulsa el
«Quitar» del dialogo con la hoja abierta —el clic que antes se comia el backdrop y dejaba la linea viva—.

**B) La sugerencia arrastra su pasillo.** `seccion-de-catalogo.ts` (features/shopping, con spec): la tabla se escribe
de seccion del carrito a hojas del catalogo global («en Lacteos cae dairy», como se lee en la tienda), el record
hoja→seccion se deriva de ella con `Object.fromEntries`, y `addItem` manda `category: seccionDeLista(hoja)` cuando la
linea nace de una sugerencia. Las secciones son entradas de `LIST_CATEGORIES` —el vocabulario que siembra el server y
con el que `groupItemsByCategory` agrupa y ordena—, asi que la linea nace ya clasificada y en su sitio del recorrido.
Lo que no tiene pasillo propio (mascotas, bebe) o no se conoce cae en «Otros»: decidir es mejor que inventar.

**C) El paginador deja de respirar.** `tramoDePaginas` ahora devuelve SIEMPRE siete casillas cuando hay mas de siete
paginas: `[1 2 3 4 5 … N]` al principio, `[1 … a-1 a a+1 … N]` en medio, `[1 … N-4 N-3 N-2 N-1 N]` al final. El baile
venia de la ventana «de lo que saliera»: en la pagina 1 pintaba tres casillas y en la 5 siete, y el pie entero cambiaba
de ancho con cada clic. La marca «…» ahora ocupa la casilla de un numero (30 px, `inline-grid`) y los numeros son
casilla fija con `tabular-nums`: siete casillas son siete, digan lo que digan. El spec recorre todas las actuales de
todas las ultimas entre 8 y 41 y exige longitud siete en cada combinacion —el contrato de ancho, no una foto—.

**D) Dos lecciones de obra.** (1) El `check:ui` (regla 19c) caza cualquier record `clave: 'Texto'`, y el primer borrador
del mapeo hoja→seccion era exactamente eso: 26 avisos. La salida no fue exhentar el fichero sino escribir la tabla al
reves (seccion → hojas) y derivar el record: el vocabulario sigue escrito una sola vez y el checker sigue siendo ley.
(2) Jasmine no tiene `toHaveLength` —es de jest—: `.length` con `toBe`, que el lint de karma no perdona.

**El parte de salud.** karma 38/38 (data-table.util y seccion-de-catalogo juntos), `check:ui` sin incidencias en 191
ficheros, `build:prod` verde. e2e local: `shopping-sugerencias` 4/4 (la seccion al nacer y el confirm por encima), y la
barrida pantry + round12 + shopping-lists + round6 + round10 + utensils + dashboard deja 72 verdes con los 5 rojos de
siempre de round6 —la deuda documentada del shard 4, ya roja en CI sobre 56679d0—.

## 12ai — La ficha del articulo: caracteristicas, precios por tienda con grafica y su edicion dedicada

**El parte (2026-09-24, ronda 37).** El usuario pidio «una vista dedicada del item de inventario, donde ver sus
caracteristicas y una tab para ver los precios por store, incluso una grafica donde se vea en el tiempo los
diferentes precios segun la tienda donde se hayan comprado y registrado. Tambien una vista dedicada a su edicion.
Hazlo responsive y profesional, cuida el UI al detalle».

**A) La ficha (`/pantry/inventario/:id`).** El nombre de la fila en la tabla del inventario es un enlace de verdad
(`href` + navegacion propia, el patron de la cesta: boton central y «abrir en pestana nueva» siguen siendo un
enlace). La pantalla: cabecera con categoria (punto de color y etiqueta), stock, ubicacion y semaforo de caducidad;
pestañas Detalles / Precios por tienda, en la query (`?tab=precios`, la convencion de `tab-url.ts`). Detalles pinta
las caracteristicas en tarjetas (categoria, unidad, ubicacion, caducidad, codigo de barras, alias, nota, registrado/
actualizado) y la huella (lineas de cesta y observaciones de precio que cuelgan de la clave). Un basico sin stock
dice que lo es, con su aviso.

**B) Los precios por tienda.** `preciosDeProducto(clave)` en el shopping service bucea `/shopping/prices
?productKey=` hasta agotar paginas. La pestana reparte por tienda (tarjeta: ultimo precio por unidad, media,
observaciones), dibuja la grafica y lista el historial completo con su boton de quitar (confirm + DELETE, como
manda la casa). **La grafica es SVG a mano** (`price-chart.component.ts` + `precio-chart.util.ts` con spec): una
linea por tienda con paleta propia, rejilla con euros, fechas deduplicadas, puntos con `<title>` nativo, y
`viewBox` al 100% —responsive sin medir nada en JS—. Sin libreria de charts: cuatro escalas y un path no son
motivo de dependencia. Tres reglas de escala escritas en el spec: el eje Y respira un 8% y no empieza en cero
cuando vive lejos, un solo precio tiene ±10 centimos de aire, y un solo dia no colapsa el eje X.

**C) La edicion (`/pantry/inventario/:id/editar`).** Pantalla propia con guardar explicito, no un modal. Edita
nombre, categoria (el catalogo de la casa), unidad, ubicacion, caducidad, codigo de barras, nota y alias (con el
choque de alias dicho en cristiano). El stock se VE pero no se toca: la regla de la ## 12x —lo que hay dentro se
mueve desde la despensa, con sus motivos— no se rompe porque haya ficha nueva, y la pantalla lo dice. Salir con
cambios sin guardar pregunta (ConfirmService, como toda la casa).

**D) El server estira un poco el PATCH de productos.** `GET /products/:id` nuevo (la ficha con su huella, alcance
de la casa entera) y `updateProductSchema` gana `location` y `barcode` —la ficha edita todo lo que la fila sabe de
si misma en un solo sitio—. Con spec: la ficha llega entera, el 404 tiene su codigo, y null en la ubicacion vuelve
a la despensa mientras que en el codigo es «quitar».

**E) Dos lecciones de obra.** (1) `syncTabWithUrl` se llama desde el CONSTRUCTOR y no desde ngOnInit: monta un
`effect` y `inject`, y eso solo vive en contexto de inyeccion —en ngOnInit explota en silencio y la pantalla se
queda en «Cargando…» para siempre, que en el e2e fue el primer rojo de la tanda—. (2) El API de precios llega
DESC: dos observaciones del mismo instante necesitan desempate (gana el que el API conto primero) o el «ultimo
precio» sale exactamente al reves —lo destapo el e2e, que siembra tres precios seguidos, y ahora es un caso del
spec de la util.

**El parte de salud.** Server 16/16 (pantry-products). karma 42/42 en las tres specs tocadas (chart util 11,
dict-simetrico, pantry-gestor). `build:prod` verde, `check:ui` sin incidencias en 196 ficheros. e2e: `pantry-item`
3/3 (enlace desde la tabla, URL con pestana, tarjetas por tienda, grafica con series/puntos/linea, quitar
observacion con confirm, edicion que guarda y vuelve) y la barrida pantry + catalog + managers + sugerencias +
utensils + round12 con 48 verdes y cero rojos nuevos (el unico fallo del primer pase era el desempate del punto E,
ya cerrado).

## 12aj — Lectura de tickets por IA: la cola local, la revision linea a linea y el confirm

**El parte (2026-09-25, ronda 38).** El usuario pidio la integracion del modulo de lecturas de tickets: «al contrario
que basketra vamos a omitir la parte de OCR y que sea la IA la que devuelva la estructura JSON directamente, total el
OCR no aporta mucho valor pues lee mal la imagen». Como basketra: cargar ticket en PDF o imagen → cola de consumo de
IA LOCAL (concurrencia default 1, configurable por proveedor desde el apartado de IA), icono animado —circulo de carga
procesando, borde rojo en error— clicable para ver progreso, parar todo o parar/reintentar uno. «Poco a poco vaya
mostrando lo que va analizando los items del ticket, detecte la tienda y la registre si no existe». Cada linea editable
en todas sus propiedades y a meter en el inventario. Novedad: a la IA se le adjunta un JSON «inventario» con tiendas,
categorias y productos por categoria, para que sepa clasificar.

**A) Sin OCR: el modelo devuelve la estructura.** `ticket-prompt.ts` (con spec) construye el prompt con las reglas de
dinero de la casa (centimos enteros; el importe de linea es lo PAGADO por la cantidad; no inventar precios; `store` de
la cabecera; `totalMinor` avisa si no cuadra) y adjunta `inventario.json`: tiendas (`stores` + DISTINCT de listas),
categorias (`pantry_categories` con clave y nombre) y productos (`ingredients` con categoria y unidad). `category` de
cada linea es CLAVE del catalogo de la despensa —no la seccion del carrito—, y `createCategory` avisa de lo nuevo. La
respuesta se valida con `ticketAnswerSchema` (hermana de `photoLinesSchema` con tienda y total).

**B) La cola local (`ticket-queue.ts`).** Trabajos durables en `ai_jobs` (lease 300s, `max_attempts` 3, barrido de
arranque que devuelve a la cola lo que quedo `running`). La cola es por configuración de proveedor y comparte el
dispatcher general de IA: `ai_configs.concurrency` acepta `0..8`, con `0` ilimitado y valor inicial `0`; se limita
cualquier trabajo de IA de esa configuración, no solo los tickets. `callAIStreaming` (nueva en
`ai-client.ts`) consume el SSE y `lineasNuevas` (`ticket-lines-stream.ts`, con spec: cadenas, escapes, llaves dentro de
textos) extrae del JSON parcial cada linea COMPLETA —cada una se inserta en `receipt_items` al momento, que es el
«poco a poco»—. Si el stream muere antes del primer delta, cae a `callAI`; al final revalida el esquema y reescribe
las lineas completas (la version incremental era la intencion, la final es la ley). Parada por `AbortController` por
trabajo → `stopped`; `pararTodo` aborta los corriendo y marca los en cola.

**C) Las rutas (`receipts.routes.ts`, montadas en `/api/receipts`).** Subida multipart que valida la FIRMA de los bytes
(`detectarKindTicket`: PNG/JPEG/WebP/PDF, 10 MB de techo) —el Content-Type es una opinion—. Pipeline
`queued → analyzing → review → confirmed | failed | stopped`. La revision: PATCH de cabecera (tienda, notas), POST/
PATCH/DELETE de cada linea, alta manual incluida (un ticket fallido se rescata a mano, que es la otra mitad del flujo).
`GET /queue` alimenta el icono; `/stop`, `/retry`, `/queue/stop` y el DELETE cierran el ciclo. **El confirm reusa el
patron del `/complete`** (misma ficha con stock SUMA, a cero REPONE, sin ficha CREA) pero con dos diferencias
pedidas: la ficha nueva nace en la categoria DE LA LINEA (no en la reserva `other`), y las observaciones de precio
llevan la tienda del ticket. La tienda detectada se registra en `stores` (tabla nueva), y `/shopping/stores` hace
UNION con ella: las tiendas ya no son solo el DISTINCT de las listas.

**D) El frontend.** Modulo `receipts` ya disponible (`available: true` en el registro y en el picker de perfil: la
pantalla «pronto» de Configuracion pasa a ser la de tareas). Bandeja `/receipts` con arrastrar-y-soltar (imagen o PDF)
que repinta sola cuando la cola se mueve; ficha `/receipts/:id` con la lectura EN DIRECTO (poll de detalle mientras
corre, lineas entrando con su animacion, anillo girando), la revision completa por linea (nombre, cantidad, unidad,
categoria de la despensa con el picker, precio en euros, oferta «3x2», nota) y el confirm con su resumen. En el movil
la tabla se vuelve una tarjeta por linea (grid-areas, siete columnas no caben). **El icono de la cola**
(`receipt-queue.component.ts`) vive en la cabecera movil y en el sidebar: anillo girando mientras lee, borde rojo
quieto si algo fallo, badge con el numero; su panel ensena cada trabajo (lineas leidas, intento n de m) con parar
todo y parar/reintentar individual. El formulario de Ajustes → IA configura la concurrencia máxima general del
proveedor («Concurrencia máxima», `0 = ilimitado`); el gestor detallado de la cola por proveedor vive en esa sección.

**E) El estado del modulo y su UI.** Diccionario propio (`dict/receipts.ts`, ES/EN pareados) con los estados del
pipeline y los errores de IA traducidos (NO_CONFIG → «encaja el proveedor en Ajustes → IA», como la foto de la
cesta). `ReceiptsService` singleton con la cola en senal: el latido (1s) solo corre mientras alguien mira (icono o
ficha), y las escrituras fallan con toast, sin cola offline —un ticket no es una edicion de cesta.

> **Leccion de obra (la del CI, no la de local).** El primer push rompio TODO el CI, y el fallo raiz era uno solo:
> `estado()` devolvia `string` y el pipe `t` exige `TranslationKey` — el build de produccion y el `ng serve` de los
> shards no compilaban, asi que el webServer de Playwright nunca abrio y las shards morian con «0 fallidos / ? tests».
> En local no se vio porque el dev server en modo watch SIRVE EL ULTIMO BUILD BUENO aunque el actual no compile, y los
> e2e corrieron contra ese bundle viejo: un verde contra un watch reciclado no dice nada. La regla que queda: despues
> de tocar plantillas, `ng build --configuration production` ANTES de creerse un e2e. De paso cayeron las otras dos
> puertas: `check:ui` (tokens CSS inexistentes, fechas con espacio en la plantilla, borrados sin ConfirmService,
> claves del diccionario sin invocar — 19 incidencias) y la puerta de cobertura del server (`callAIStreaming` sin
> cubrir dejaba `ai-client.ts` al 53%: seis specs nuevos de stream la suben).

**El parte de salud.** Server: `tsc` limpio y 778/778 en vitest (nuevos: `receipts.routes` 11 — subida por firma,
NO_CONFIG, stop-all, retry, concurrencia por configuracion, edicion de lineas, confirm con tienda/precios/inventario
y categoria de la linea, suma de stock en el segundo ticket, categorias inexistentes a la reserva, borrado en
cascada manual —; `ticket-prompt` 4; `ticket-lines-stream` 7; `ai-client` +6 de stream; y el contrato de formularios estirado con las tres
schemas nuevas). Frontend: `build:prod` verde (el warning de estilos de calendar es deuda previa). e2e `receipts` 5/5
(nav y bandeja, rechazo de fichero raro, PDF en cola, rescate manual + confirm con verificacion de inventario y
tienda por API, parar todo) y `settings-modules` 6/6 retocado a la realidad nueva (cuatro secciones vivas; el «no
crea rutas muertas» pasa a probarlo con el modulo de tareas). Regresion: shopping-lists + round12 20/20.

## 12ak — Caducidades en tiempo real: la despensa ordenada por lo que se tira antes

**El parte (2026-09-29, ronda 39).** El usuario: «calcular en tiempo real cuánto dura cada producto según la frecuencia de
compra», «gráficas y/o listados de productos ordenables por fecha de caducidad — solo de los registrados», «los que no
tengan fecha pero sean calculables por la IA (ej.: PAN de barra) que se calculen automáticamente» y que «al gestionar la
comida semanal o sugerir comidas se tengan en cuenta las caducidades».

**A) Tres fuentes de vida, por precedencia (`server/src/utils/caducidades.ts`).** La fecha registrada
(`expiration_date`) manda; si no hay, la estimacion de la IA (columna nueva `estimated_shelf_days`); si no, el catalogo
de bolsillo —`CATALOGO_DE_VIDA`, ~80 productos basicos indexados por `productKeyOf` (leccion de la ronda: 'Pan de
barra' → 'pan barra', indexar por el nombre normalizado a mano NUNCA matchea)—. El catalogo **no se guarda, se
consulta**: es gratis y no ocupa columna. La fecha estimada nace de la base (la ultima compra en `price_observations`,
si no `created_at`) mas los dias de vida.

**B) El ritmo de compra.** Las compras del MISMO dia se funden (SUM de cantidad); con dos dias distintos o mas,
`cadaDias = tramo/(n-1)`, `diasPorUnidad = cadaDias/unidadesPorCompra` y `duraDias = round(quantity × diasPorUnidad)`:
cuanto dura el stock actual a ese ritmo. Menos de dos dias distintos no es ritmo, es una compra.

**C) Las rutas (`pantry.routes.ts`).** `GET /api/pantry/expiry` devuelve `CaducidadRow[]` —solo stock > 0, ambito casa,
orden por urgencia (`daysLeft` asc, lo sin fecha al final)— con fecha, origen (`fecha|ia|catalogo|null`), dias para
caducar (negativo = caducado), ritmo y duracion. `POST /api/pantry/expiry/estimate`: candidatos = sin fecha Y sin
estimacion (LIMIT 60); el catalogo cubre lo suyo gratis y el resto va a `callAI` con `buildShelfPrompt` +
`shelfAnswerSchema`; se guarda `estimated_shelf_days` matcheando por `productKeyOf`. Errores de IA con su codigo
(NO_CONFIG 409 / BAD_JSON 422 / resto 502). Nada de esto corre en background: se pide al pulsar «Estimar».

**D) El planificador ya mira la nevera.** `bloqueDeCaducidades` coloca en los prompts de `/api/ai/plan-week` y
`/api/ai/recommendations` lo que caduca en 7 dias o menos (formato «Nombre (3 ud (fecha estimada), caduca en 2
dia(s))», con tope de 8 y sufijo «; y N mas»), prefijado con «priorizalos en el plan para no tirar comida». Y el modal
de planificacion del calendario lo ENSENA («La IA priorizará lo que caduca pronto: …») en vez de ser magia: la IA
prioriza, pero quien planifica ve que se esta priorizando.

**E) El frontend (`/pantry/caducidades`, boton en la cabecera de la despensa).** Resumen con chips (caducados, esta
semana, estimadas, sin fecha), grafica de barras —una por producto, anchura proporcional al dias-maximo con suelo del
4%, color del semaforo, `≈` en lo estimado (`barrasDeCaducidad`, con spec)— y tabla ordenable por caduca/nombre/dura
(el server manda por urgencia; reordenar en memoria, una despensa no da para paginar). El origen de cada vida se ve
(badge Fecha/IA/Catálogo/Sin estimar) porque una fecha registrada no promete lo mismo que un «≈4 dias». El boton
«Estimar caducidades» traduce el fallo de IA a su mensaje propio («Falta configurar la IA para estimar lo que no está
en el catálogo»), silenciando el toast del interceptor — dos avisos por un clic es un aviso que se desconfia de si
mismo. Diccionario propio ES/EN (`dict/caducidades.ts`).

**El parte de salud.** Server: `tsc` limpio y 795/795 en vitest (nuevos: `caducidades` 11 — precedencia de fuentes,
fusion de compras del mismo dia, ritmo con 2 dias, funda de clave de catalogo, formato del bloque —; `pantry-expiry`
5 — orden por urgencia, NO_CONFIG con el catalogo consultandose igualmente, estimacion de IA en SU producto,
BAD_JSON, vacio —; el `shelfAnswerSchema` de la respuesta de IA al EXEMPT del contrato de formularios: lo escribe un
modelo, no un formulario). Frontend: `build:prod` verde, `check:ui` sin incidencias, spec del chart 5/5 en karma. e2e
`pantry-caducidades` 1/1 (orden por prisa con cuatro origenes sembrados, chips, grafica, reorden por nombre con
toggle, «Estimar» sin IA → NO_CONFIG traducido, aviso del modal de planificar) y regresion pantry + catalogo + ficha +
calendario + tab-urls 40/40.

## 12al — La lista de la compra que se escribe sola: estadistica de la casa, sin IA

**El parte (2026-09-29, ronda 40).** El usuario: «quiero que esto sea sin IA simplemente por estadistica y teniendo en
cuenta los alimentos faltantes, frecuencia de consumo, cantidades restantes, fecha de caducidad etc. Te sugiera en la
seccion de compras una lista de la compra basada en mi actividad, planificacion semanal para abastecerlo, etc. Además te
indique la mejor tienda donde comprarla, la cantidad etc. Si ya hay una lista pendiente generada por actividad que haya
un botón que te sugiera actualizarla —la puedes crear dias antes de ir a comprar y haya nuevos registros, cambios etc.
Si no hay una creada, la creará.»

**A) El motor (`server/src/utils/lista-sugerida.ts`).** Cuatro reglas legibles, cada una con su motivo en pantalla:
**caduca** (lo que no se consumira a tiempo —caduca en ≤2 dias o ya caduco— se repone: es comida que se tira), **sin
stock** (se acabo y se compraba → lo que cubre la semana al ritmo de la casa, o el tamano de la ultima compra si el
ritmo aun no se conoce), **se acaba** (al ritmo de la casa el stock no llega al horizonte de 7 dias → lo que falta,
redondeado al pack en que se compra: sugerir 5 yogures cuando se venden de 6 es sugerir nada) y **para el plan** (las
recetas de los proximos 7 dias necesitan mas de lo que hay, escalado a las raciones apuntadas; solo se descuenta el
stock de la MISMA unidad — 400 g contra 2 ud no se restan). La cantidad es el MAXIMO de las reglas que aplican (no la
suma: si el plan pide 4 y el ritmo 6, son 6), el motivo es el de la cantidad ganadora, y hay tope de 30 lineas. La
**mejor tienda** es la mas barata de las que la casa conoce por su ULTIMO precio (el precio de enero no decide el de
hoy), con el precio estimado de la linea. Reutiliza de la ## 12ak: `caducidadesDe` (fechas y ritmo) y `comprasDeLaCasa`.

**B) Las rutas (`shopping.routes.ts`).** `GET /api/shopping/suggested` previsualiza sin escribir nada (sugerencias +
lista abierta si la hay). `POST /api/shopping/suggested` crea la lista —o actualiza la que ya este abierta, que se
reconoce por `source='sugerida'`+`status='active'` (migracion: `source` en listas y lineas)—: las lineas sugeridas
PENDIENTES se sustituyen por las de ahora y lo comprado (checked) y lo anadido a mano se queda, que es la promesa del
boton «Actualizar». Sin sugerencias no nace una lista vacia. Las lineas nacen con `price_minor` por unidad y la nota
«Mejor en X». El cuerpo es todo opcional (solo el nombre traducido); un POST vacio es valido: el boton no lleva
formulario.

**C) El frontend (`shopping-suggested.component.ts`).** La entrada es minimalista —lo pidio el usuario al ver la
primera version: «esto es demasiado grande, algo mas minimalista, un boton con algun icono distintivo»—: en la bandeja
de `/shopping` solo vive UN BOTON pequeño (icono de carrito, que nadie mas usa en esa pantalla, + el numero de
sugerencias) alineado con las acciones de la cabecera. El detalle vive en el modal que abre: cada fila con su nombre
×cantidad, badge de motivo con su color, «mejor en X» y ≈precio; total estimado; y el boton «Crear lista de la compra»
que pasa a «Actualizar lista» cuando ya hay una abierta —con texto que explica que actualizar no toca lo comprado ni lo
manual. Sin nada que sugerir y sin lista abierta, el boton no aparece. Diccionario ES/EN propio
(`dict/shopping_suggested.ts`).

**El parte de salud.** Server: `tsc` limpio y 821/821 en vitest (nuevos: `lista-sugerida` 15 — pack-rounding, reposicion
de lo que caduca, plan con unidades incomparables, mejor tienda por ultimo precio, orden y tope —; `shopping-suggested`
6 — previsualizacion sin escritura, POST vacio crea, actualizar no duplica y conserva checked+manual, caduca+plan
entran, sin sugerencias no nace lista —; y la fila del contrato de formularios para `createSuggestedListSchema`).
Frontend: `build:prod` verde, `check:ui` sin incidencias en 210 ficheros. e2e `shopping-suggested` 1/1 (la historia
completa: siembra por API de pan agotado, pescado caducado y receta de manana; motivos y tiendas a la vista; total;
crear; nota «Mejor en Lidl» en la linea; comprar el pan; actualizar; lo comprado sigue y la sugerencia del plan renace)
y regresion shopping-lists + sugerencias + caducidades 19/19.

## 13. Coming soon (deliberately not in this program)

- **Las unidades del carro: el ultimo catalogo sin etiqueta.** `UNIT_FAMILIES`
  (`frontend/src/app/features/shopping/unit-families.ts`) guarda 29 unidades canonicas —`kg`, `ud`, `bote`,
  `lata`, `cucharada`, `manojo`…— y la pantalla las pinta tal cual: la despensa (`{{ ingredient.unit }}`) y el
  pago por linea de la lista. No es un descuido de la tanda 24, es otro catalogo con su propio contrato: la
  etiqueta se traduce en el punto de pintura (`pantry.unidad.*` + la pipe `catalog`), el **picker** tiene que
  seguir ofreciendo el dato crudo (lo que se elige es lo que se guarda, y `canonicalUnit`/el precio por unidad
  comparan esa cadena) y el espejo se escribe contra `UNIT_FAMILIES`, no contra `seed-data.ts`. Dos puntos de
  lectura, un mapa de 29 pares y un spec: la proxima tanda pequena.

- `ng test` (Karma/Chromium) y `playwright test` siguen sin ejecutarse en esta maquina: no hay navegador.
  Los specs que necesitan `TestBed` se validan a traves del puente de vitest (16 ficheros / 139 pruebas),
  que es estrictamente menor que la suite real: 21 de los 37 ficheros `*.spec.ts` del frontend estan excluidos
  del puente por necesidad, y esa lista es la deuda. El config del puente y su generador
  (`server/tmp-frontend*.ts`, `server/tmp-frontend-stubs/`) son rueda de taller y estan en `.gitignore`: el
  generador aplica una heuristica —`TestBed`, DOM, matchers de Jasmine— y no hay que curar la lista a mano al
  anadir un spec, basta con volver a lanzarlo (`node server/tmp-frontend-round24/bridge.mjs`); con
  Chrome encima hay que quitar el `describe.skip` de `pantry-section.spec.ts` y pasar la suite e2e de una
  vez por todas.

- **`npm run lint` no puede correrse.** `frontend/package.json` declara `"lint": "ng lint"` y ni
  `@angular-eslint/builder` ni las reglas están entre sus dependencias: el comando falla al arrancar, asi que
  no hay forma de que nadie lo ponga como gate. O se instala el conjunto (y se arregla lo que salga, que seran
  cientos de avisos la primera vez), o se borra el script y se dice en el README que no hay linter.
  Es el unico checker que no puedo cerrar, y por eso el gate propio (`scripts/check-ui.mjs`) es el que
  manda en el CI.
- **Las etiquetas de catálogo sin uso de `shared/models/household.model.ts`.** `*_LABELS` en español que no
  lee ningún componente: no son texto visible, son un residuo. O se enganchan a una pantalla con su `labelKey`
  o se borran; mientras no cuelguen de la regla 15 (que solo exige que lo que se usa esté en los dos idiomas),
  se quedan ahí declarados para que la próxima tanda los borre con conocimiento.
- **Quitar los emoji de las claves del diccionario.** La regla `sin-emoji` perdona cinco `dict/*.ts` porque
  los pictogramas venían perdonados en sus plantillas. Convertirlo es decidir si el glifo es decoración (se
  quita) o es información (pasa a `app-icon` con su nombre), y toca 5 pantallas con sus capturas.
- **Despensa: los emoji de las doce categorias.** Doce categorias se ensenan con emoji (`🧀 🥩 🐟`), y
  ahora tambien en los chips del filtro y en las filas del gestor, porque el catalogo de la casa pinta
  mas sitios que antes. (La ronda 25 se llevo por delante los dos <select> del formulario —categoria y
  ubicacion—, que eran la otra mitad de esta deuda; el glifo sigue donde estaba.) La regla de «los iconos
  nunca son emojis» solo se cumple en lo que `check-ui` mira, y la despensa esta en su lista de deuda.
  Convertirla es: `getCategoryIcon`/`getLocationIcon` devuelven el NOMBRE del icono, `app-unit-picker`
  (que ya existe) cubre la unidad, y se quitan los dos ficheros de la lista. Se hizo el visor de logs en
  la ronda 10 porque ya estaba en el diff; la despensa entera merece su propia tanda con sus capturas.
- **Fotos de las lineas de la compra, tambien en disco.** `uploads/` existe desde §12j para el
  avatar de la cuenta; la foto que se adjunta a una linea sigue viajando como base64 dentro de la
  propia fila, que es lo que hace pesada la lectura de una lista con diez fotos. Moverla es
  reutilizar el mismo endpoint y cambiar una columna por una ruta.
- **Precio por linea en la foto.** Las lineas que devuelve el modelo traen cantidad y precio, pero
  no unidad: quien revisa la foto no puede corregir «1 L» a «1 botella» y luego en la lista si. El
  control ya existe (`app-unit-picker`); falta el campo en el prompt y en la validacion.

- **Store catalog with aliases and barcodes**: `stores` as a table (not a column of names), one product
  with several shelf names per shop, EAN lookup. Today the link is the product key, chosen by hand in
  the line sheet, and that is enough to remember prices per shop —it is not enough to _suggest_ them.
- **Photo price tags teaching observations**: a photographed shelf price still only sets the line. When
  it also writes `price_observations` (with the store, `source: 'photo'`), the photographed shop starts
  being one of the shops whose prices the app already knows.
- **Drag to reorder inside a section**: the `PUT /lists/:id/order` endpoint and the `position` column are
  ready; what is missing is a handle that cannot be confused with the swipe. Same for **picker recents**
  (`localStorage`), including the unit picker: what the household actually writes («pack de 6», «barra»)
  is already in `shopping_list_items.unit`, and showing it first would remove most typing — but a house
  that changes shop changes format, so the window has to be decided before it becomes a canon.
- **The UI debt the guard counts**: 21 files still paint an emoji where a glyph should be (the log viewer
  stopped in round 10, and its filters still use a native `select`), and five screens
  still open a native `select`. They are named in `scripts/check-ui.mjs`, one PR per screen, and the list can
  only shrink — the guard prints a line when a file stops offending.
- **Photo prices as observations**: a photographed price tag sets the line price today; it should also teach
  `price_observations` (with the store and a `source: 'photo'`), which is the difference between a price you
  typed once and a shop that starts knowing what milk costs.
- **Household tasks**: assignments, rotations, due windows, points for kids, per-member load chart.
- **Shared calendar**, what is left of it: recurrence, availability, "who cooks". General events with
  kind filters and colours (§8f) are in; a recurring event is a different problem and it is not here.
- **External calendars**: subscribe (ICS/webcal) and two-way sync with Google Calendar, plus a
  generic CalDAV adapter; conflict policy per calendar; OAuth from the UI, tokens in the settings
  store.
- **Home Assistant**: REST/WebSocket bridge — publish expiring ingredients and the shopping list as
  entities, receive notifications on fridge-door/stock events, expose "start plan" as a service call.
- **Devices**: smart-fridge and scale imports; barcode scanning via the device camera with the
  EAN lookup done locally.
- **Budgets**: weekly/monthly spend vs income, store-level price trend alerts, "this brand got 18 %
  dearer since June".
- **Multi-household**: one instance serving several homes with per-home scoping and joins.
- **Community prices**: opt-in, aggregated, privacy-reviewed publishing of anonymised observations.
- **Vector logo** (`icon.svg` / `favicon.svg`): traced from `design/hogaria-icon-source.png` once the
  project has a real tracer; until then there is one visual source, not two that disagree.
- **Frontend coverage gate**: same 70 % per file for `frontend/` when the unit suite runs headless in CI
  today the karma job is not in the workflow; the report is already produced by `test:client:coverage`.
- **Install screenshots**: the manifest `screenshots` block returns with real captures under
  `frontend/src/assets/screenshots/` (it pointed at files that never existed).
- **Native shell**: TWA/Capacitor once the PWA is stable.
- Languages beyond `es`/`en`, other currencies, other units (lb/oz), tablet layouts.

## 14. Risks

1. **Package/CI coupling** — renaming workspace packages breaks `pnpm --filter` silently: P2 of the
   rename must land as one commit with the workflow. Kept out of P0 for exactly this reason.
2. **localStorage is not a database** — quota (typically 5 MB) and eviction force the budget rules in
   §5; if the outbox grows past the cap, the UI blocks new offline edits rather than losing them.
3. **OCR/AI cost and latency** — a queue per provider configuration, shared by every AI operation,
   `max_attempts`, cancellation, and provider-scoped concurrency (`0` means no configured cap);
   a missing provider keeps every manual flow available.
4. **Money arithmetic** — float anywhere is a bug; cents only, tested at the boundary.
5. **Two histories of truth** — during the merge, `pantry` and `shopping_list_items` must not both
   invent products; the catalog is the join point, and unconfirmed AI output never persists.
6. **Session/DB rename while live** — the migration adopts the existing SQLite file and the old
   storage keys; nothing deletes, and every migration ships with a keep-data test.
7. **Review size** — the program is one PR by request, so phase boundaries are commit boundaries and
   each phase is revertible alone.

## 15. Definition of done

A phase is done when: types and lint pass, migrations run on an old database without data loss,
server tests are green, the e2e suite is green in CI (chromium), the section works offline as
specified, every string is translated, nothing reads env that §4 says must not, and this file's
checkbox plus the PR body reflect reality. The product is done when P0–P8 are checked, Basketra is
feature-complete inside HogarIA (its docs list the same), and a human has tested it from their own
device — the merge stays theirs.

## 16. Agent constraints

- Atomic commits, English messages, pushed to the PR as they land; the PR body mirrors the checklist.
- Never merge without an explicit human yes in chat — defaults to no, even under "work autonomously".
- Every command runs with an explicit timeout; no unbounded waits.
- No native browser dialogs (`alert`/`confirm`/`prompt`): `ConfirmService` + `app-confirm-dialog`.
- Tabs/filters/pages in the URL through `core/utils/tab-url.ts`, defaults omitted.
- No new runtime dependency without writing down why in this file.
- The sandbox has no browser: visual verification is the human's preview, functional verification is
  CI. Never claim a look-and-feel change as "verified" on a build alone.

## 12am — La IA que «no se activaba»: la prueba de conexión de verdad, y una sola configuración activa

**El parte (2026-09-29, ronda 41).** Tres reclamaciones del usuario: «La IA no se activa se queda inactivada»; «La
prueba de hello es ambigua, deberia devolver un formato JSON dado. Incluso pedir que devuelva un schema» (con su
ejemplo de `POST /v1/chat/completions` con `response_format: {type:'json_schema', json_schema:{name, strict:true,
schema}}`); «cuando se le pulsa testear muestra inmediatamente una notificación de que está bien cuando en realidad
no ha recibido respuesta. Debe bloquear el botón y que ponga "comprobando..." y una vez termine da igual el
resultado se desbloquea. Y debe mostrar luego la notificación del resultado».

**Por qué no se activaba — cuatro causas y ninguna era el modelo.** (1) Un `base_url` sin camino (`http://host:8000`)
pegaba contra `…/chat/completions`, que no existe en el convenio OpenAI-compatible: 404 silencioso para siempre.
(2) `callAI` mandaba `temperature: null` y compañía — los proveedores estrictos lo rechazan con 400. (3) No había
mono-activa: la configuración activa era «la primera por rowid», así que la config VIEJA seguía contestando por
muchas nuevas que se guardaran encima. (4) La más cruel: la config nueva SÍ nacía activa en la base (`is_active
DEFAULT 1`) pero `GET /api/ai/configs` devolvía la fila cruda en snake_case — el badge de la UI lee `isActive`,
veía `undefined`, y la tarjeta decía «Inactivo» aunque la IA estuviera funcionando. La pantalla mentía.

**El arreglo del lado del cliente.** `endpoint()` completa la base: si ya termina en `/chat/completions` se respeta;
si trae su versión (`/v1`) se añade `/chat/completions`; si no trae nada, se añade `/v1/chat/completions`.
`chatBody` solo viaja con lo puesto: `temperature`/`maxTokens`/`topP`/… NULOS no se mandan. Y `toClientConfig`
mapea TODAS las respuestas de configuraciones a camelCase — y nunca devuelve la `api_key` (la fila cruda de
`SELECT *` la llevaba en cada POST y PATCH).

**Mono-activa.** Crear una configuración la convierte en LA activa y apaga las demás (`UPDATE … WHERE user_id = ?
AND id != ?`); activar una por PATCH apaga el resto antes. `activeAiConfig` es `is_active = 1 ORDER BY updated_at
DESC LIMIT 1`. La UI relee la lista tras crear/activar: sin eso, dos tarjetas dicen «Activo» a la vez porque la
lista local conserva el objeto viejo.

**La prueba de conexión pide un JSON DADO.** Nada de «Hello»: `pingDeConexion` hace POST al endpoint con
`response_format: {type:'json_schema', json_schema:{name:'connection_test', strict:true, schema}}`, donde el
schema exige `{status:'ok', message:string}` — el modelo tiene que devolver ESE JSON exacto, sin `max_tokens` ni
`temperature` que le den pie a recortar la contestación. La respuesta se valida (extracción del JSON + zod): el
veredicto es `{ok, latency, message}` o `{ok:false, latency, error}` — nunca lanza. `POST /api/ai/test-connection`
admite dos formas: `{configId}` (config guardada; persiste `test_status`/`test_error`/`last_tested` en la fila) o
`{baseUrl, apiKey, model, timeout?}` (lo escrito en el formulario; NADA se persiste); sin ninguna → 400. HTTP 200
en ambos veredictos — el veredicto va en `data.success`.

**El botón no miente.** El `testFromForm()` de antes era un stub: soltaba un toast de «Configuración válida» sin
haber llamado a nada. Ahora: el botón (tarjeta y formulario) se BLOQUEA con «Comprobando…» (`probandoId`/
`probandoForm`, señales — una prueba a la vez), no hay toast preventivo, y cuando llega la respuesta —sea la que
sea— se abre el modal de resultado existente (`test-result`: éxito/error, modelo, latencia, error) con el veredicto
de verdad. La prueba del formulario valida primero que URL+key+modelo estén escritos (aviso si falta algo) y
después llama con esos datos SIN guardar.

**Pruebas.** `ai-client.spec.ts` (endpoint ×3, chatBody ×2, ping ×4: 26 en total), `ai.routes.spec.ts` nueva (7:
mono-activa al crear y al activar, la respuesta no devuelve la `api_key`, el estado de la prueba queda en la fila,
el modelo que no devuelve el JSON pedido suspende, la vía formulario no toca la fila, sin datos → 400),
`form-contract.spec.ts` con las excepciones del refine escritas, y e2e `ai-config.spec.ts` (9): la del botón
intercepta la ruta con 700 ms de retraso y comprueba que el botón está bloqueado en «Comprobando…» SIN toast de
éxito mientras el proveedor no ha contestado; la mono-activa crea dos configs y verifica que la nueva es la activa
y que activar la vieja apaga la nueva. Server 837/837, e2e IA 16/16, build de producción y `check-ui` verdes.

## 12an — Concurrencia máxima y gestor de cola por proveedor (implementado)

**Contrato del límite.** `ai_configs.concurrency` se presenta como **Concurrencia máxima** /
**Maximum concurrency**. Es un entero de `0..8`; `0` significa **ilimitado** y es el valor inicial
para configuraciones nuevas. Se mantiene el máximo positivo de 8 que ya define la API. El input
explica `0 = ilimitado` / `0 = unlimited`, muestra el rango válido e impide guardar negativos,
fracciones u otros valores inválidos; create y update API aplican el mismo límite. Al editar, `0`
debe sobrevivir sin convertirse a un fallback truthy. No se reescriben en bloque valores guardados
existentes al migrar: se conservan límites configurados previamente.

**Una sola puerta de salida.** Cada llamada al modelo pasa por el dispatcher asociado al ID de
configuración de proveedor que la recibió: recetas (una o varias), recomendaciones, planificación,
análisis de foto de compra, estimación de caducidad, lectura de tickets y prueba de conexión.
Ninguna ruta de producto llama directamente al transporte del proveedor. Una solicitud ya admitida
no cambia de proveedor en silencio si el usuario activa otra configuración. Una prueba del formulario
sin guardar usa el mismo dispatcher con datos efímeros de la petición: no crea una configuración ni
persiste su API key.

Un límite positivo restringe trabajos en curso de ESA configuración; las configuraciones tienen
colas independientes. `0` quita el límite configurado, no desactiva el dispatcher ni bloquea la cola:
se inician todos los trabajos elegibles. Bajar el límite no interrumpe solicitudes que ya están en
curso; evita iniciar más hasta estar por debajo del nuevo límite. Desactivar o eliminar una
configuración cancela los trabajos suyos pendientes y aborta los que estén en curso, sin redirigirlos
a otra configuración. La cola inicial ordena por llegada; el reordenamiento cambia de forma atómica
el orden solo de los trabajos pendientes.

**Gestor en Ajustes → IA.** El listado de proveedores permanece compacto: cada configuración con
`concurrency > 0` muestra una acción para abrir su vista dedicada de cola (`/ai-config/:configId/queue`),
con el nombre/configuración del proveedor y una navegación explícita de vuelta al listado. La vista
solo carga la cola de esa configuración y expone trabajos pendientes, en curso y fallidos terminales
con metadatos seguros (tipo, estado, intentos y error redactado), sin mostrar API keys, prompts,
adjuntos, cuerpos ni resultados. Permite:

- Arrastrar trabajos pendientes para persistir su nueva prioridad; trabajos en curso no se mueven.
  Debe existir alternativa de teclado (subir/bajar) y controles táctiles accesibles.
- Cancelar trabajos pendientes y en curso. La cancelación en curso aborta la petición real al
  proveedor y evita aplicar una respuesta final tardía. El flujo de tickets conserva su contrato
  incremental actual; un retry limpia sus líneas parciales antes de volver a procesar.
- Reintentar un fallo terminal tras agotar los reintentos automáticos. Un retry manual inicia otro
  ciclo con la política configurada, limpia el error visible y conserva el tipo/vínculo del trabajo.

**Ciclo de vida de datos y retry síncrono.** `ai_jobs` persiste solo metadatos de despacho; prompts,
imágenes/adjuntos, respuestas y cierres de ejecución viven solo en RAM. Un fallo genérico con
configuración guardada y concurrencia positiva conserva la operación síncrona original pendiente
durante 5 minutos tras agotar retries automáticos. Un retry manual reejecuta la misma closure; si
termina correctamente, resuelve la petición HTTP original y deja que su caller procese/guarde el
resultado. Cada fallo manual abre otra ventana de 5 minutos. Al vencer la ventana el caller se
rechaza (o devuelve el último veredicto fallido de conexión), el error pasa a `INPUT_EXPIRED` y el
payload se libera. Al cancelar/desactivar/eliminar se aborta y libera la ejecución. Configuración
efímera de prueba y concurrencia 0 no exponen gestor ni ventana manual: la petición termina al
agotar retries. Se limita el payload residente a 100 jobs y 32 MiB por usuario; una solicitud que
exceda cualquiera recibe `QUEUE_CAPACITY`. Tras reinicio, tickets recuperables mantienen su
`receipt_id`/archivo, pero los jobs genéricos sin closure fallan `INPUT_EXPIRED`; no se afirma
persistencia/reintento de payloads genéricos. La cola requiere una sola instancia Node por base
SQLite: las closures genéricas son locales al proceso y no se comparte memoria entre workers. El
worker solo reclama un job genérico si conserva esa closure; no se debe desplegar más de un proceso
servidor contra la misma DB sin reemplazar este contrato por ownership/lease multiproceso. Cada
claim incrementa `claim_generation`; cancelación y reinicio invalidan la generación en curso. Las
escrituras incrementales/finales verifican estado y generación para que una respuesta tardía de un
intento cancelado no modifique un retry posterior del mismo job.

Estado vacío, carga/error/reintento, carreras de cancelación/claim, aislamiento por usuario y
configuración, caída/timeout del proveedor, cambio de límite y eliminación de configuración son
parte del contrato. La cola debe seguir despachando cuando el gestor visual está oculto por límite 0.

### Checklist QA-AI.PROVIDER-QUEUE.1

- [x] Baseline aislada antes de implementar: POST de `-1`, `1.5` y `9`, PATCH de `-1`, y POST de
      `0`; registrar respuesta real sin usar la base normal. (Los límites válidos `1/8` se verifican en
      las pruebas finales; no se afirma haberlos recorrido en el build previo.)
- [x] API y formulario validan el mismo rango entero `0..8`; 0 es el default nuevo, significa
      ilimitado y permanece 0 después de editar/recargar. Valores inválidos no se envían desde UI ni
      persisten por API. No alterar configuraciones existentes por migración masiva.
- [x] Centralizar todo transporte de modelo; cubrir tickets, recetas, recetas múltiples,
      recomendaciones, planificación, compra/foto, caducidad y test de conexión, incluida la prueba
      efímera no guardada. Cada trabajo conserva el config ID y no filtra secretos/payload.
- [x] Tests del dispatcher prueban límite por proveedor, independencia, 0 ilimitado, FIFO inicial,
      orden explícito persistido, cambio de cap, cancelación real y retries automático/manual.
- [x] API del gestor aplica autorización de usuario/config, reordena solo pendientes, cancela
      queued/running, reintenta solo terminales y no devuelve API key, prompt, adjunto ni resultado.
- [x] El listado no monta gestores inline: ofrece acceso a una vista dedicada por proveedor, con
      navegación de vuelta. Vista directa con cap 0, proveedor inexistente o acceso ajeno no expone cola.
- [x] Playwright real valida el gestor en la vista dedicada solo para cap >0, drag/drop + alternativa teclado,
      cancelación pendiente/en curso, retry tras agotar intentos y persistencia de orden, en ES/EN.
- [x] Validar 320×568, 393×851, 568×320 y 1440×900 y los límites de breakpoints actuales; comprobar
      overflow, foco, nombres/labels, errores, anuncios de estado y targets táctiles. Guardar capturas
      sintéticas PC/móvil e inspeccionarlas.
- [x] Cobertura del alcance ≥70 % en statements/branches/functions/lines sin rebajar gates;
      ejecutar typechecks, build, unit/integración y E2E aislado, y registrar resultados/limitaciones.

**Fuente revalidada al crear spec (2026-10-01):** solo `ticket-queue.ts` encolaba trabajo IA.
Recetas, generación múltiple, recomendaciones, plan semanal, foto de compra, estimación de
caducidad y test de conexión llamaban `callAI`/`pingDeConexion` directamente. La validación API
exigía mínimo 1, el input compartido no retransmitía `min/max/step` y `config.concurrency || 1`
reemplazaba un 0 al editar. La cola atendía tickets, sin orden mutable y cargaba la configuración
activa al despachar; el contrato nuevo fija proveedor y concurrencia para todos los usos.

**Evidencia — unidad numérica (2026-10-01):** baseline Playwright aislado confirmó POST de `-1`,
`1.5` y `9` → 400, PATCH `-1` → 400, POST explícito `0` → 400 y el formulario sin límites ni
error inline al enviar `-1`. Tras el cambio, `tests/e2e/ai-provider-concurrency.spec.ts` pasa 3/3 y
verifica POST/PATCH inválidos, límites válidos `0/1/8`, default `0` y bloqueo del formulario.
Karma (AiConfig + Input) pasó 45/45; el test aislado de valores se ejecuta también en el set E2E final.

**Evidencia — cola por proveedor (2026-10-01):** el transporte raw solo se invoca desde el
dispatcher; el `rg` de `callAIWithConfig`, `callAIStreamingWithConfig` y `pingDeConexionTransport`
no encontró llamantes de producto fuera de `ticket-queue.ts`. `server` TypeScript build pasa;
Vitest dirigido a dispatcher, rutas de cola, cliente IA, rutas IA, despensa y compra: 6 archivos,
170/170 pruebas. La cobertura configurada del servidor (41 archivos, excluida únicamente la suite
Windows-específica de `uploads.spec.ts`) quedó en 91.24/81.65/94.08/93.87; los archivos nuevos
`ticket-queue.ts` y `ai-queue.routes.ts` superan 70 % en cada métrica.

El listado no monta los gestores: tres proveedores sintéticos muestran tres enlaces de cola; cada
enlace abre `/ai-config/:configId/queue`. La vista enseña solo el proveedor elegido y ofrece volver;
cap 0 y proveedor no disponible no montan cola. La suite Playwright aislada para concurrencia/cola
pasó 6/6 en inglés y español; cubrió 320×568, 393×851, 568×320 y 1440×900, persistencia de orden,
drag/drop, orden por teclado con foco restaurado, cancelación queued/running con abort del proveedor,
retry manual tras agotar retries y supresión del gestor a cap 0. El proveedor fue loopback sintético;
no se usó el token LAN. Capturas sintéticas inspeccionadas (listado y vista, PC/móvil) en
`test-results/ai-provider-queue-qa-hogaria-e2e-WxUZwa-{providers,manager}-{desktop,mobile}.png`.

Karma de frontend: 643/643 tests; la cobertura agregada de proyecto sigue bajo el umbral global ya
configurado de 80 % (60.41/51.31/50.59/62.17). La cobertura de los cuatro archivos de UI/servicio
de cola sí supera 70 % en statements/branches/functions/lines: 96.24/81.16/97.17/96.24; no se
rebajó ningún gate. `ng build --configuration production` y `check-ui` pasan; el build conserva
warnings existentes de budget del bundle/estilos. `pnpm run typecheck:e2e` está bloqueado por
`EPERM` de Corepack en Windows, pero el mismo `tsc -p tsconfig.e2e.json --noEmit` directo pasa.

## 12ao — Metadatos detectados del ticket, edición permanente e historial

**Decisión actualizada por el usuario (2026-10-03):** se conserva el contrato de §12aj de enviar la
imagen/PDF directamente a la IA, sin una etapa OCR; además, la IA debe detectar la tienda/local y la
fecha impresa de compra. Ambos campos son datos del ticket, no del momento de subida: la fecha de
compra se guarda como fecha civil `YYYY-MM-DD`; si el comprobante no contiene una fecha legible o es
ambigua, se devuelve `null` y nunca se sustituye por `created_at`. La tienda puede quedar vacía si no
se puede identificar. El modelo no debe inventar ninguno de esos valores.

La ficha del ticket permite corregir tienda y fecha desde la UI en los tickets analizados y desde su
historial, también después de confirmar el ticket. Guardar una corrección modifica los metadatos del
recibo, no vuelve a confirmar el inventario ni duplica movimientos. El valor manual guardado prevalece
sobre resultados tardíos de análisis/reintentos. El historial es un apartado identificable de `/receipts`,
persistente al recargar o volver a iniciar sesión; contiene tickets cuyo procesamiento terminó
(`review`, `confirmed`, `failed` o `stopped`), excluye los trabajos aún `queued`/`analyzing`, permite
abrir la ficha y no oculta recibos antiguos por el límite actual de la bandeja. Si la lista necesita
paginación, esta debe permitir recorrer el historial completo. Los límites de usuario/hogar, borrado,
autorización y disponibilidad de adjuntos conservan las reglas existentes.

La fecha desconocida permanece vacía en UI; el campo es accesible y editable con teclado, valida una
fecha civil real y persiste al volver a abrir el ticket. El historial ordena por fecha de compra cuando
existe y usa fecha de subida solo como criterio de desempate/agrupación, mostrándolas con etiquetas
distintas para no confundirlas. Cada cambio de metadatos se guarda explícitamente y su error queda
visible/reintentable; un ticket confirmado no repite el efecto de confirmación al editar.

## 12ap — Hogares múltiples y configuración de IA propia de cada hogar

**Hallazgo inicial (2026-10-04):** household_members permitía varias membresías, pero users.household_id y las rutas/UI trataban una sola casa como contexto; crear/unirse podía sustituir la membresía anterior. ai_configs era personal, no había ACL común para la configuración IA y ai_jobs no guardaba el hogar.

**Revalidación vigente (2026-10-06):** las subunidades de selector, salida, pantry y tickets ya verifican partes del contrato multi-hogar. `ai_configs.household_id` y `ai_jobs.household_id` ya existen; la configuración se resuelve dentro de la casa activa, la pantalla/las rutas de proveedor exigen `settings`, la falta de selección no cae a una configuración personal y el worker conserva el scope del job. Ver `QA-HOUSEHOLD.AI.HOME-CONFIG-AND-PINNED-JOBS.1`. Sigue sin estar certificada la integración de todas las rutas, caches, respuestas tardías, colas offline y servicios en una sola sesión.

**Decisiones confirmadas por el usuario:** un usuario puede pertenecer a varios hogares y este soporte se incluye ahora. La IA queda asociada directamente a cada hogar. Reutilizar el permiso existente settings para ver y administrar su configuración. Para hogares nuevos, inicializar desde la configuración activa del creador; para hogares existentes, usar la configuración activa del admin de mayor antigüedad (joined_at ASC, user_id ASC). Conservar las configuraciones personales originales y las demás configuraciones; ningún hogar ni usuario sirve de fallback silencioso. La app está en desarrollo y se elige una migración idempotente sencilla, sin pedir decisiones adicionales por cada caso de datos.

**Contrato de hogares:**

- household_members es la autoridad de membresía, rol y permisos. users.household_id se conserva como hogar actualmente seleccionado, no como prueba de membresía; toda ruta protegida resuelve hogar activo y verifica (user_id, household_id) contra membresía.
- La UI presenta las casas disponibles y el hogar activo de forma accesible. Crear/unirse añade una membresía sin borrar otras y selecciona la casa nueva. Seleccionar un hogar valida la membresía en servidor; si la selección guardada ya no es válida, no se sirve ningún dato hasta recuperar una casa permitida. Con una sola membresía puede seleccionarse automáticamente; con varias se exige una selección válida. Salir elimina solo la membresía activa y conserva las demás; si quedan casas, el usuario puede seleccionar una de ellas. Ningún endpoint mezcla o adopta datos entre hogares al cambiar de selección.
- Cada lectura/escritura, carga diferida, sondeo, reintento, SSE y operación asíncrona usa el contexto de hogar de la petición. Cachés/respuestas tardías y escrituras offline quedan vinculadas al hogar original: nunca se muestran ni se reenvían en el hogar recién seleccionado. Un hogar ajeno o una selección obsoleta falla cerrado. La lógica de pertenencia del calendario compartido/invitado se mantiene sin abrir acceso cruzado a otros datos.
- Las selecciones y permisos se comprueban en backend; ocultar controles en frontend no es autorización. El DTO de membresías comunica los permisos efectivos de esa casa. La preferencia personal, idioma y módulos que actualmente son de usuario no se transforman accidentalmente en datos de hogar.

**Contrato de IA por hogar:**

- La configuración activa y sus alternativas pertenecen al hogar, no al usuario creador/admin. Crear un hogar la inicializa desde la configuración personal activa del creador; la preparación idempotente de hogares existentes la inicializa desde la del admin más antiguo (joined_at ASC, user_id ASC). Se crea una configuración independiente por hogar cuando una misma configuración origen se usa en más de uno; las filas personales de origen y demás configuraciones se conservan. Si no existe una configuración activa de origen, el hogar queda sin configurar hasta que alguien autorizado lo haga.
- Todos los miembros del hogar pueden usar las funciones de IA disponibles en la aplicación con la configuración activa de ese hogar. Solo miembros cuya membresía tiene settings=true pueden abrir la sección y consultar, probar, crear, activar, editar o eliminar sus configuraciones. Esta ACL se aplica en servidor a todas las rutas, también llamadas directas. El permiso para configurar no se convierte en permiso para leer prompts, adjuntos o trabajos de otros miembros.
- Las configuraciones de hogares distintos son independientes; no se comparte estado por pertenecer la misma persona a ambos. Las configuraciones personales no se usan como fallback en un hogar. Fuera de cualquier hogar se conserva el uso individual existente. La asociación/autorización se basa en el hogar explícito, no en el user_id histórico de la fila; cualquier valor de origen se conserva solo como procedencia. DTO, mensajes, errores, logs y respuestas nunca devuelven api_key; URLs con userinfo se rechazan o redactan.
- Un job registra explícitamente su hogar, solicitante y config_id al admitirse. El worker conserva ese hogar/proveedor aunque el usuario cambie de casa, y no vuelve a escoger proveedor por el hogar actual. Listado, retry, cancelación y orden se autorizan por el actor según el contrato vigente de §12an; otra casa no ve jobs, metadatos privados, prompts ni adjuntos. Los límites de concurrencia y reintentos de §12an siguen aplicando por configuración/proveedor.
- El commit publicado 4e260b3 feat(ai): set household AI owner implementó una dirección anterior, ahora supersedida por configuración directa al hogar. No reescribir historia publicada. En la nueva implementación se ignora ai_owner_user_id; por seguridad de datos no se elimina ni reconstruye esa columna salvo que una migración no destructiva lo requiera.

### Checklist QA-HOUSEHOLD.MULTI-AI.1

**Corte TDD actual — salir del hogar activo sin escoger otro implícitamente (2026-10-05):** el código de `DELETE /api/household/leave` elige hoy la membresía más reciente aunque queden varias. El contrato permite autoselección cuando queda una sola, pero exige una selección válida explícita si quedan varias.

- [x] Al abandonar el hogar activo, se elimina solo esa membresía; si quedan dos o más, `users.household_id` queda `NULL`, ninguna casa aparece activa y `GET /api/household` no entrega datos de otra.
- [x] La lista de membresías restantes sigue disponible con `activeHouseholdId: null`; `POST /api/household/active` solo permite elegir una membresía existente y a partir de entonces el hogar elegido se sirve como activo.
- [x] Si al salir queda exactamente una membresía, la resolución vigente puede autoseleccionarla; no borrar datos ni cambiar los comportamientos de limpieza del último admin.

**Evidencia TDD (2026-10-05):** la prueba de salida con varias casas falló primero al demostrar que `DELETE /leave` activaba implícitamente `target-house`; tras cambiar el puntero a `NULL`, la suite focal `household.routes.spec.ts` pasa **20/20** y su cobertura focal es **98,94 % statements / 88,34 % ramas / 100 % funciones / 100 % líneas**. `DATABASE_PATH=:memory:`; los informes se escribieron a una ruta temporal única, sin tocar artefactos previos. Se conserva la autoselección existente al quedar una sola membresía. Esta subunidad no certifica todavía el resto de multi-hogar (selector UI y aislamiento de todas las rutas siguen pendientes).

- [ ] Pruebas rojas de contexto activo, alta/selección de segunda casa, membresía inválida, login con selección obsoleta y pertenencia cruzada; crear/unirse no elimina membresías o datos anteriores.
- [ ] Cambiar rutas de crear/unirse/salir para membresías múltiples y selección activa; cubrir admin, permisos por hogar, transacciones/rollback y eliminación acotada al hogar correspondiente.
- [ ] Proteger en servidor todas las rutas household-scoped con membresía del hogar activo; cubrir pantry, recetas, calendario, compra, tickets, categorías, caducidades, recomendaciones y SSE. Incluir operaciones personales sin hogar y casos de usuario de otra casa.
- [ ] Selector accesible para escritorio/móvil; selección persiste tras refresh, datos de cada servicio cambian juntos, una respuesta tardía del hogar anterior no pisa el nuevo, y caches/deduplicación incluyen el contexto de hogar.
- [ ] Pruebas para cola offline de compra y colas de recibos/IA: ninguna operación pendiente se redirige a otra casa; todo job lleva hogar, actor y config fijos aunque cambie la selección.
- [ ] Migración aislada/idempotente de ai_configs a scope de hogar: nueva casa usa creador; antigua usa admin más antiguo con empate estable; copia independiente cuando un origen abastece varias casas; conserva originales y demás configuraciones; ausente activo deja hogar sin IA.
- [ ] Resolver proveedor por hogar en cada ruta, prueba, dispatcher y worker; no hay fallback personal ni entre hogares. Probar admin/permisos settings de miembros, denegación API directa, miembro sin settings que usa IA sin ver la sección, keys ausentes y jobs aislados por casa/actor.
- [ ] E2E Playwright aislado con dos hogares y membresías compartidas: selector/refresh, calendario, inventario, compra, recibos, IA/configuración y colas; escritorio y móvil, capturas con datos sintéticos solamente. Verificar teclado, foco, nombre accesible y bordes de breakpoints.
- [ ] Ejecutar migraciones y tests con DB temporal y fixtures sintéticos; proveedores repetibles se simulan, smoke real opt-in solo contra loopback. Registrar comandos/resultados; typecheck, build, check-ui, E2E y coverage por archivo ≥70 % S/B/F/L sin rebajar gates existentes.

### QA-HOUSEHOLD.RECEIPTS.ACTIVE-SCOPE.1 — tickets vinculados al hogar activo

- [x] Lista, historial, ficha y mutaciones autorizan por la membresía/hogar activo validado; ser la persona que subió un ticket de otra casa no conserva acceso. Los tickets personales (`household_id IS NULL`) siguen siendo solo del dueño.
- [x] La subida captura el contexto activo. La confirmación mantiene el hogar fijado en el propio recibo; no adopta categorías, stock ni precios de otra casa. La lectura de contexto de IA del recibo y el registro de tienda quedan fijados al hogar del recibo, aunque el miembro cambie después.
- [x] La cola y “detener cola” solo exponen/alteran trabajos de ticket del actor en su hogar activo o los propios personales; trabajos genéricos y trabajos de otros hogares quedan fuera.
- [x] TDD reproducible con dos hogares demuestra que el ticket del hogar anterior no aparece ni acepta GET/PATCH/confirm/delete, no modifica inventario/precios y vuelve a estar accesible al reactivar su hogar. La suite de categorías también prueba que el catálogo activo/personal excluye categorías del otro hogar.
- [x] E2E Playwright real con SQLite temporal, ticket PNG sintético y dos hogares: subir, verificar en el hogar de origen, cambiar de hogar y obtener lista limpia/404, volver y recuperarlo. Chrome escritorio y móvil, **2/2**; capturas sintéticas comparables revisadas.
- [x] Coverage full-server, sin alterar gate: `receipts.routes.ts` **84,04/73,91/85,18/85,94 %**, `ticket-queue.ts` **86,63/79,48/92,06/91,84 %**, `pantry-categories.ts` **92,22/85,95/95,45/97,88 %** S/B/F/L; total server **90,60/82,24/94,53/93,37 %**. `build` del server, `typecheck:e2e` y suite completa de cobertura pasan.

**Límite de alcance:** esta unidad no añade `household_id` a cada fila `ai_jobs` ni migra la configuración/proveedor de IA al hogar. Los trabajos de ticket se acotan mediante su recibo duradero y conservan actor/config actuales; la propiedad IA por hogar, trabajos genéricos, pantry/calendario/recetas y el E2E conjunto de §12ap siguen pendientes. No se marca terminado el contrato amplio de multi-hogar.

### QA-HOUSEHOLD.PANTRY.ACTIVE-SCOPE.1 — despensa bajo el hogar activo

- [x] Inventario compartido incluye filas del hogar activo y filas personales del usuario; no incluye
      filas del hogar anterior solo porque el usuario las creó. Hogar privado conserva el filtro por
      propietario. Las rutas de ficha, edición y borrado de utensilios también comprueban el scope.
- [x] Caducidades/lista/estadísticas usan la misma casa activa que la lista de inventario. La creación
      de producto y utensilio captura el hogar activo y las rutas cerradas devuelven 404 sin mutar datos.
- [x] Los contadores de impacto de producto solo agregan líneas de listas/observaciones de precio del
      hogar activo y filas personales del usuario; nunca cuentan actividad de otro hogar.
- [x] Con varias membresías y sin hogar activo, rutas privadas de despensa/listas fallan con 409
      `HOUSEHOLD_SELECTION_REQUIRED`; ni leen datos ni crean filas personales por accidente.
- [x] E2E aislado con dos hogares sintéticos comprueba cambiar, refrescar y volver: inventario y tickets
      solo aparecen en la casa de origen. Chrome desktop y móvil, 2/2; capturas sintéticas inspeccionadas.
- [x] Suite servidor completa y build pasan con DB de pruebas; no se usó la DB local habitual ni un
      proveedor externo.
- [x] `caducidades.ts` supera el gate por archivo y se añade al conjunto cubierto del servidor:
      96,70/86,58/100/100 % S/B/F/L con sus pruebas de contrato y el test de aislamiento.
- [x] `pantry.routes.ts` supera ≥70 % por archivo y se añade al conjunto cubierto del servidor;
      la medición focal con `pantry.routes.spec.ts` da 91,20/76,01/95,71/93,41 % S/B/F/L.

**Evidencia TDD (2026-10-06):** se añadió el escenario de dos casas al test de pantry; la primera corrida
falló porque la consulta de ingredientes incluía el producto de la casa anterior. Después de acotar
inventario, fichas, mutations, utensilios y caducidades al hogar activo más datos personales, la suite
focal pasa **7/7**. E2E aislado `multi-household-switcher.spec.ts` pasa **2/2** (Chrome escritorio y
móvil) y verifica también ticket sintético e inventario al cambiar y volver de casa. `pnpm run
typecheck:e2e`, build servidor y `pnpm run check:ui` pasan; `pnpm run test:config` pasó entonces
**8/8**. La suite completa con SQLite `:memory:` pasó entonces **1.132/1.132 + 1 omitida**, cobertura
global del servidor 90,72/82,31/94,69/93,50 %; el reporte se guardó en una ruta temporal.
`caducidades.ts` supera su gate por archivo (96,70/86,58/100/100 % S/B/F/L) y se añadió al coverage
config. Esta subunidad mejora el aislamiento real pero no cierra el requisito de cobertura de
`pantry.routes.ts` ni el contrato mayor §12ap.

**Revalidación aislada (2026-10-06):** una prueba sintética detectó que los contadores de impacto de un
producto agregaban líneas/precios de todas las casas; la primera corrida contó 3 en vez de las 2 filas
del hogar activo + espacio personal. Tras unir las líneas a `shopping_lists` y aplicar el mismo scope a
ambos agregados, `pantry.routes.spec.ts` pasa **7/7**. La prueba de hogar/listas exige ahora `409
HOUSEHOLD_SELECTION_REQUIRED` si hay varias membresías y ninguna selección, en vez de tratarlo como
lista personal vacía. Hogares + pantry pasan **32/32**, build del servidor pasa y la suite completa pasa
**1.132/1.132 + 1 omitida** con cobertura global **90,72/82,34/94,69/93,50 % S/B/F/L**. SQLite fue
memoria/temporal y el informe se escribió en una ruta temporal nueva; no se usó la base local habitual ni
proveedor externo. Se repetirá el E2E aislado de cambio de hogar tras el cambio de middleware, sin
sobrescribir las capturas anteriores. Revalidación posterior: E2E `multi-household-switcher.spec.ts`
**2/2** (Chrome escritorio y móvil), cleanup del runner aislado confirmado; capturas sintéticas nuevas
inspeccionadas en `.e2e-screenshots/2026-10-06-pantry-revalidation/multi-household-switcher/`.

**Suite global revalidada (2026-10-06):** `DATABASE_PATH=:memory: pnpm --filter
@hogaria/server run test:coverage` pasa **1.138/1.138 + 1 omitida**; cobertura agregada del servidor
**90,63/82,25/94,72/93,42 % S/B/F/L**. `pantry.routes.ts` continúa fuera del gate por archivo
porque su cobertura focal medida es **25,33/12,77/20,58/27,27 %**; queda abierto ampliar pruebas de
esa ruta hasta ≥70 % en cada métrica. El cliente pasa **1.039/1.039** pruebas unitarias, pero su gate
global conserva 80 % y sigue rojo en **78,43/66,15/77,37/79,95 %**. No se relajan umbrales. `pnpm run
typecheck:e2e`, `pnpm run check:ui` (205/21), `pnpm run test:config` (9/9) y `git diff --check`
pasan. El build de producción del frontend pasa con warnings de tamaño ya existentes.

**Revalidación frontend (2026-10-06):** tras ampliar la cobertura de compra, la suite completa de Chrome
Headless pasa **1.074/1.074**. Cobertura global: **80,73 % statements / 68,59 % ramas / 79,47 % funciones /
82,16 % líneas**. S/L ya superan el gate existente de 80 %, pero ramas y funciones no; el proceso conserva
código de salida 1 por esos dos umbrales. Informe preservado en
`%TEMP%\hogaria-client-full-coverage-020a3994e50542a7b9bb50e987132e5a`. No se rebajó el gate ni se
declara completa la cobertura global; quedan además las rutas/archivos individuales abiertos.

**Nueva medición de cliente (2026-10-06):** tras añadir la cobertura de calendario, Chrome Headless
pasa **1.086/1.086** pruebas. La cobertura sube a **81,79/69,34/81,61/83,19 % S/B/F/L**; statements,
funciones y líneas pasan 80 %, ramas sigue fallando el gate global 80 %. Informe preservado en
`%TEMP%\hogaria-client-full-coverage-1df834b3cb2e4f348ed2e3074331d95f`; ningún umbral se redujo.

**Router de inventario (2026-10-06):** se añadieron pruebas de contrato para CRUD/filtros de categorías,
productos y utensilios, borrado por lotes, catálogo pre-registrado y caducidades. `pantry.routes.spec.ts`
pasa **18/18** con SQLite en memoria; cobertura focal **91,20/76,01/95,71/93,41 % S/B/F/L**. El router
se añadió a `server/vitest.config.ts`; la suite completa del servidor pasa y reporta global
**91,55/82,80/95,58/94,12 %**, con `pantry.routes.ts` en **93,64/81,93/98,57/95,55 %**. El reporte
se escribió en `%TEMP%\hogaria-server-coverage-037a6c628d7c4ab6a2157b9987073d5b`.

**Validación enfocada del runner de IA (actualizado 2026-10-05):** las suites locales de seguridad,
control del runner, preflight de WebAPI, supervisor aislado y coordinación pasan **45/45** (`node
<archivo>.test.mjs`, sin usar la base normal ni llamar al modelo). El E2E sintético de
`ai-real-smoke.spec.ts` pasa **1/1** en Chrome con SQLite temporal y ejercita ocho tipos de trabajo IA,
incluido un borrador de receta compleja con once ingredientes. El último smoke real anterior contestó
HTTP 200 en las tres primeras llamadas y HTTP 502 en la cuarta, durante la generación múltiple de
recetas; los metadatos de la sesión WebAPI identificaron `HttpConnectionAbortedError` en espera de
respuesta. No se leyó ni guardó contenido del log ni se atribuye el fallo a la app. El usuario reinició
WebAPI; la comprobación de solo lectura volvió a confirmar disponibilidad y captura de cuerpos/sesiones
apagada. Un nuevo smoke con el recibo real no llegó a iniciarse: el control de ejecución lo bloqueó
porque la WebAPI podría transmitir el ticket a un proveedor externo sin que esté confirmado su
tratamiento. No se intentará rodear el bloqueo ni enviar el recibo hasta confirmar ese destino. La
ejecución previa limpió su credencial temporal y DB aislada; el smoke real y el ticket siguen pendientes.

**Nuevos smokes opt-in (2026-10-05):** todas las corridas usaron ingredientes y recibos sintéticos,
credencial/DB temporales y dejaron la captura de cuerpos apagada; no se adjuntó ningún ticket personal.
Con límite de configuración 90 s falló la receta compleja (1/10, HTTP 502); con 120 s falló igual
(1/10). Tras elevarlo a 240 s —por debajo del lease actual de 300 s—, la receta detallada solicitada
con 11 ingredientes de entrada pasó todas las comprobaciones reales, también la conexión y dos recetas alternativas
diversas (3/10 completions HTTP 200); la siguiente llamada, de recomendaciones, devolvió HTTP 502
(4/10), por lo que el smoke total no pasó y el resto de casos IA reales queda pendiente. La WebAPI
local está configurada para reenviar a `chatgpt.com`; por tanto «local» describe solo el gateway, no
el proveedor final. No hubo reintentos automáticos ni se alteró la app normal.

### QA-AI.LIVE-SMOKE-DEADLINES.1

- [x] La receta completa utiliza hasta 4096 tokens y timeout de configuración máximo de `240000` ms,
      menor que el lease vigente de 300 s; no confundir WebAPI local con proveedor local/privado.
- [x] Los límites del proxy, la petición Playwright y el timeout global tienen márgenes crecientes y
      cubren el timeout de la configuración; nunca se reintentan automáticamente llamadas reales ni se
      excede el máximo fijo de diez completions.
- [x] Tests automáticos verifican la relación entre deadlines, el límite de esquema, el presupuesto de
      completions y la limpieza tras timeout; la suite repetible sigue usando proveedor sintético.
- [x] Repetir una vez el smoke real opt-in solo con datos sintéticos, con WebAPI local, captura de
      cuerpos desactivada y credencial/DB temporal propias; documentar el resultado por completion sin
      almacenar prompts, contenido de tickets ni credenciales. No adjuntar tickets personales mientras
      el destino final sea externo sin consentimiento informado explícito.
- [x] Si el proceso E2E aislado no puede arrancar, informar solo un estado seguro y no filtrar el
      error bruto del sistema, el bearer ni los datos de la petición.

**Evidencia (2026-10-05):** suites del runner/preflight/supervisor **51/51**; la nueva prueba Vitest
de schema **2/2** verifica el máximo de 240 s y el default de 4096 tokens; `typecheck:e2e`, build del
servidor/cliente, `check:ui` (196 ficheros, 20 reglas), Playwright sintético de los ocho tipos de job
**1/1** y Prettier pasan. El smoke real no es verde: sus tres primeras respuestas fueron 200 y la
cuarta 502 en recomendaciones; la limpieza temporal concluyó. Los gates documentados cubren el
contrato, no convierten el HTTP 502 en éxito.

**Reintento de verificación (2026-10-05):** el preflight de WebAPI volvió a confirmar el servicio y
los controles de privacidad, pero el runner terminó con código 1 antes de iniciar Chrome; hubo **0/10**
completions y no se envió una petición al proveedor ni ticket alguno. La comprobación posterior ya no
encontró WebAPI disponible en `localhost:3001`; no se atribuye la parada al smoke porque no hay evidencia
causal. Queda pendiente repetirlo cuando el servicio vuelva a estar activo. Se añadió y probó un aviso
sanitizado para futuros errores de arranque del proceso aislado.

**Revalidación de esta continuación (2026-10-05):** aunque el usuario indicó que había levantado de
nuevo la WebAPI, `GET /health/ready` no fue accesible desde este ejecutor ni en `127.0.0.1:3001` ni
en `localhost:3001`. No se consultó ningún endpoint autenticado, no se creó/leyó token y no se hizo
ninguna completion real. Reintentar el preflight cuando el servicio sea alcanzable desde el ejecutor.

**Revalidación (2026-10-06):** preflight de solo lectura a `http://127.0.0.1:3001/health/ready` vuelve
a fallar por conexión no disponible desde este ejecutor; no existen variables `HOGARIA_AI_REAL_SMOKE_*`
en el entorno de esta sesión. No se leyó/creó ningún token ni se envió una petición al proveedor. El
smoke permanece abierto; la disponibilidad del navegador/local de desarrollo del usuario no demuestra
que el gateway sea alcanzable desde este proceso.

### QA-HOUSEHOLD.SHOPPING.OFFLINE-QUEUE-SCOPE.1 — cola ligada a su hogar de origen

- [x] Cada escritura optimista que entra en la cola captura el hogar activo de origen; la clave de deduplicación también incluye ese ámbito.
- [x] Al volver la conexión solo se envían escrituras del hogar actualmente seleccionado. Las de otras casas permanecen pendientes, en orden y sin bloquear la cola de la casa activa; volver al origen las reintenta una sola vez.
- [x] Un cambio A → B nunca reenvía la edición de A bajo B ni aplica una respuesta tardía de A a la vista de B. La invalidación global de lecturas/SSE sigue dentro del contrato mayor §12ap.
- [x] TDD unitario con A fallando por red, online en B sin petición, luego online de vuelta en A y persistencia única; conservar deduplicación, orden por casa, conflictos y reintentos existentes.
- [x] E2E aislado con dos hogares prueba una lista abierta, cambio de contexto montado y retorno a la casa original en escritorio/móvil, sin 404 de reintento, mutación cruzada ni estado obsoleto.
- [x] Alcanzar ≥70 % en statements/branches/functions/lines por cada fichero frontend modificado en esta unidad, sin rebajar el gate global: `shopping.service.ts` **97,23/87,86/100/99,46 %** y `shopping-lists.component.ts` **95,08/86,80/90,16/97,14 %** S/B/F/L (revalidación posterior; para el dato histórico del service, ver la medición anterior).

**Discrepancia revalidada (2026-10-06):** `ShoppingService` guardaba `{key, send}` sin ámbito. `flush()` reintentaba siempre `queue[0]` con el hogar que estuviera seleccionado al reconectar; la cola A podía enviarse bajo B y descartarse como error de negocio. El contrato principal §12ap exige fijar la escritura al hogar que la originó.

**Conducta UI precisada (2026-10-06):** si se cambia el hogar mientras está abierta una lista perteneciente a la casa anterior, la URL de detalle deja de ser válida para el nuevo contexto. Al confirmarse el cambio, el detalle debe cerrarse, limpiar la vista anterior y llevar a `/shopping`; no se vuelve a pedir el ID anterior bajo la nueva casa ni se deja una SSE abierta a esa lista.

**Evidencia focal (2026-10-06):** `ShoppingService` guarda el ID de hogar en cada operación y en su clave de deduplicación; al cambiar contexto vacía estado/cache de Compra, ignora respuestas tardías de detalle/listados y reabre las lecturas/SSE bajo el nuevo hogar. Karma focal pasó **36/36** en Chrome local. Cobertura de `shopping.service.ts` en el informe focal: **97,23 % statements / 87,86 % ramas / 100 % funciones / 99,46 % líneas**; el global del corte focal no es comparable (solo incluye este archivo y dependencias cargadas), no se modificó el gate 80 % existente. Incluye A fallando, intención repetida coalescida, escrituras B sin drenar A, reintento A en orden, caché limpia, dos listados fuera de orden y una respuesta A tardía que no reemplaza el estado de B. El E2E aislado `node scripts/run-isolated-playwright.mjs --project=chromium --project=mobile-chrome tests/e2e/shopping-view-order.spec.ts --grep "switching homes"` pasó **2/2** en escritorio y móvil: con el detalle A montado, el selector cambia a B, cierra el detalle, muestra su lista sin pedir de nuevo el ID A y permite volver a A. Capturas sintéticas: `.e2e-screenshots/shopping-household-context-20261006/{chromium,mobile-chrome}.png`. El resto de servicios/cachés/colas/SSE del contrato global §12ap sigue pendiente; este cierre es específico de Compra.

**Revalidación de bandeja (2026-10-06):** `shopping-lists-stream.spec.ts` pasa **2/2** en Chrome Headless. Se verificó el efecto de contexto en ambas fases reales del cambio: cierra la SSE al comenzar el cambio y vuelve a cargar listas/tiendas y abrir una SSE solo cuando el hogar B queda confirmado; al destruir la vista también cierra el stream vigente. El test inicialmente falló porque el efecto Angular aún no se había procesado; al ejecutar detección de cambios explícita, pasa sin alterar lógica de producción.

**Coverage focal (2026-10-06):** service + bandeja ejecutaron **38/38** tests. El informe temporal mide `shopping.service.ts` **97,23/87,86/100/99,46 %** S/B/F/L; `shopping-lists.component.ts` **38,23/25/15/43,58 %**, por debajo del mínimo de proyecto. El gate global de Karma quedó intacto y el run parcial no alcanza el 80 % global; la cobertura de la bandeja queda pendiente.

**Cierre de cobertura de la bandeja (2026-10-06):** se añadieron pruebas de estado inicial/URL, filtros y
búsqueda retrasada, orden/paginación, estados vacíos, creación, renombrado, archivo/deshacer, borrado con
confirmación, navegación y operaciones de la cola. El nuevo caso de página vacía encontró en rojo un rango
imposible (`26-25`) cuando el contador global seguía teniendo filas; `rangeLabel()` ahora devuelve `0` si la
página actual no tiene resultados y la UI mantiene su estado vacío sin presentar paginación inconsistente.
Karma focal en Chrome Headless ejecutó **12/12** (`shopping-lists.component.spec.ts`
y `shopping-lists-stream.spec.ts`). Cobertura actual de `shopping-lists.component.ts`: **95,22/86,96/90/97,01 %**
S/B/F/L (259/272 statements, 120/138 branches, 54/60 functions, 227/234 lines). El comando filtrado deja rojo
el gate global existente con **18,45/11,39/10,29/18,95 %**; es el denominador parcial, no una regresión del set
completo, y no se cambió ningún umbral. Playwright aislado con respuesta de lista sintética pasa **2/2**
en Chrome escritorio/móvil; al recibir 0 filas con total antiguo, muestra estado vacío y oculta el paginador,
sin rango invertido. Capturas inspeccionadas en `.e2e-screenshots/shopping-empty-page-range/{chromium,mobile-chrome}.png`.
Informe preservado en `%TEMP%\hogaria-shopping-lists-coverage-6352817507dd46b9877829cd895cb92a`.

**Revalidación de paginación tras borrado (2026-10-06):** la revisión de la UI detectó un caso distinto: al
eliminar la única fila de la última página, el servidor puede devolver `total=25` para un offset de 25; dejar
el estado vacío ocultando el paginador obligaba a recargar manualmente. La nueva prueba unitaria y el E2E
fallaron primero en Chrome con el efecto reproducible (`page` seguía en 1 y no se volvía a pedir offset 0).
Ahora la bandeja compara la respuesta terminada con el offset vigente y, si el total ya no contiene esa
página, vuelve a la última página válida, actualiza la URL y recarga. Karma focal de `shopping-lists.component.spec.ts`
pasó **11/11**; el conjunto de bandeja + stream pasó **13/13**. Cobertura del archivo actual medida con
ambos specs: **95,08 % statements / 86,80 % ramas / 90,16 % funciones / 97,14 % líneas**. El comando filtrado
de coverage sale con 1 por el denominador global parcial (18,92/11,79/10,45/19,45 %); no se rebajó ningún gate.
Playwright aislado `--project=chromium --project=mobile-chrome ... --grep "final row"` pasó **2/2**.
Capturas sintéticas PC/móvil, inspeccionadas: `.e2e-screenshots/shopping-empty-page-range/{chromium,mobile-chrome}.png`.
El rango vacío (`0`) sigue siendo defensivo para filtros o respuestas vacías; no sustituye el reanclaje cuando
el total confirma que la página actual quedó fuera de rango.

### QA-SHOPPING.PAGINATION-LAST-PAGE-DELETION.1 — reanclar cuando desaparece la última página

- [x] Si la respuesta confirmada del servidor reduce el total por debajo del offset actual, volver a la última
      página todavía válida, reemplazar el parámetro de página de la URL y recargar sin dejar un estado vacío.
- [x] Mantener el rango `0` y el estado vacío como defensa para resultados realmente vacíos; no reiniciar una
      página mientras su petición sigue cargando ni antes de recibir metadatos de su propio offset.
- [x] TDD unitario primero en rojo y después verde para total reducido; Playwright aislado con lista sintética,
      viewport de escritorio y móvil, confirma la fila/rango recuperado, el fin del paginador y la segunda
      petición al offset 0. Capturas PC/móvil inspeccionadas.
- [x] Archivo frontend sobre 70 % en statements, branches, functions y lines; `typecheck:e2e`, `check:ui`,
      build cliente, formato y `git diff --check` pasan.

**Evidencia (2026-10-06):** el test de componente falló primero porque quedaba en página 1; el mismo caso
E2E falló en Chrome escritorio y móvil porque desaparecía el paginador. Tras reanclar únicamente cuando la
lectura termina y sus metadatos coinciden con el offset visible, pasan Karma **13/13** (componente y stream)
y Playwright **2/2** con DB temporal. El build de producción cliente termina correctamente con advertencias
de presupuestos/imports ya existentes. La corrida completa del cliente ejecutó **1.075/1.075** tests; su
gate global sigue pendiente: **80,74 % statements / 68,61 % ramas / 79,48 % funciones / 82,19 % líneas**,
frente al 80 % configurado. Solo fallan ramas y funciones; se conservaron los umbrales.

### QA-HOUSEHOLD.MULTI-MEMBERSHIP.SELECTOR-API.1 — completada

- [x] Agregar listado seguro de membresías propias y selección persistente del hogar activo; rechazar ID vacío o hogar ajeno sin alterar la selección.
- [x] Crear/unirse a un segundo hogar conserva membresías previas y no traslada filas de otra casa; salir elimina solo la membresía activa y selecciona una restante.
- [x] Una selección guardada inválida se corrige automáticamente solo cuando queda una membresía; con varias, GET del hogar no revela datos ni elige una casa implícitamente.
- [x] Si hay varias membresías activas y el hogar activo es NULL/inválido, las rutas privadas fallan con `409 HOUSEHOLD_SELECTION_REQUIRED`; solo siguen permitidas las rutas explícitas para listar o seleccionar hogar.

**Evidencia TDD (2026-10-04):** antes de la implementación, el nuevo test de membresías falló porque `GET /memberships` devolvía 404; tras añadir la API, ampliar create/join/leave y vincular `users.household_id` a selección validada, `npm test -- --reporter=dot src/routes/household.routes.spec.ts` pasa **19/19** con `DATABASE_PATH=:memory:`. `npm run build` pasa. Coverage focal del archivo `household.routes.ts`: **98.95/88.57/100/100 %** S/B/F/L. La corrida de coverage sin filtro también se intentó; falló únicamente porque no ejecuta las suites de los demás archivos del gate, sin cambiar umbrales. `git diff --check` y Prettier focal pasan. Harness runtime: Hono real de las rutas, SQLite en memoria; no UI, DB persistente ni proveedor externo.

**Rollback:** commit atómico solo de rutas/tests/spec, sin migración de esquema. Revertir antes de usar hogares múltiples fuera de desarrollo; nunca borrar membresías o datos como parte del rollback.

**Rollback:** cada subunidad queda en commit atómico. La selección activa se puede restablecer al hogar válido anterior sin borrar membresías/datos. Desasociar IA revierte solo filas/claves nuevas creadas por la migración; no elimina las configuraciones personales originales, ai_jobs ni datos de otros hogares. No se borra ai_owner_user_id durante este cambio.

### QA-HOUSEHOLD.MULTI-HOME-SWITCHER.UI.1 — subunidad verificada

- [x] Con más de una membresía aparece un selector accesible basado en `app-picker`; con una sola casa no añade controles redundantes. La selección pide validación al servidor y un fallo revierte el valor visual con error accesible.
- [x] Crear/unirse refresca las membresías y deja activa la nueva; el selector espera opciones asíncronas, cambia de casa y conserva la selección después de recargar. La barra lateral móvil deja llegar al selector.
- [ ] No se marca el contrato mayor de §12ap: sigue faltando probar en la misma sesión el refresco
      conjunto/aislamiento de calendario, despensa, compra, tickets y cargas tardías/colas offline.
      La configuración IA por hogar y su job fijado tienen ahora una subunidad verificada aparte;
      esta pantalla no certifica la integración completa.

**Evidencia (2026-10-05):** test focal del selector **3/3**; `pnpm run check:ui` **204 ficheros/21 reglas**; `pnpm run typecheck:e2e` pasa. Playwright aislado con Chrome y SQLite temporal, Chromium desktop + mobile-chrome: **2/2** para crear dos hogares sintéticos, unirse, seleccionar otro, persistir tras refresh y recuperar el selector accesible; capturas inspeccionadas en `.e2e-screenshots/multi-household-switcher/{chromium,mobile-chrome}.png`. No se usaron datos reales ni se considera esto una prueba de aislamiento de todos los servicios.

### QA-HOUSEHOLD.AI.HOME-CONFIG-AND-PINNED-JOBS.1 — configuración y trabajos IA fijados al hogar

- [x] La configuración activa/listada se resuelve por hogar activo; las filas personales siguen disponibles solo fuera de hogares; no hay fallback entre hogar/cuenta ni al perder la selección. API de proveedor deniega contexto sin selección y comprueba `settings` en llamadas directas.
- [x] La ruta y el enlace de configuración IA siguen el permiso `settings`: miembro sin permiso no accede ni por URL directa; si un admin lo concede, puede entrar tras refrescar membresías.
- [x] Cada job genérico y de ticket conserva actor, `household_id` y `config_id`; el worker/claim/retry usa el scope fijado, no el hogar seleccionado después. Un ticket deriva el hogar durable del recibo; la cola de otra casa queda invisible.
- [x] TDD con dos hogares demuestra cambio A→B antes del claim sin cambiar proveedor ni scope, cola de ticket fijada al hogar del recibo, selección faltante sin fallback personal y permiso de configuración. No se invoca proveedor real.
- [x] Playwright aislado prueba bloqueo/concesión de `settings` y visibilidad de navegación en Chrome de escritorio y móvil con cuentas/hogar sintéticos; guardar capturas comparables sin datos personales.

**Evidencia (2026-10-06):** `pnpm --filter @hogaria/server run build` pasa; suites focales `ai-queue.spec.ts`, `ai-queue.routes.spec.ts` y `ai.routes.spec.ts`: **72/72** con DB de test temporal. Karma con Chrome Headless para el guard y el menú: **13/13**. `tests/e2e/ai-household-settings-permission.spec.ts` pasa **2/2** en Chrome escritorio/móvil, incluyendo enlace oculto, redirección directa y entrada después de conceder el permiso; capturas sintéticas en `.e2e-screenshots/ai-household-settings/`. `pnpm run typecheck:e2e`, `pnpm run check:ui` (**205 ficheros/21 reglas**) y `pnpm run test:config` (**9/9**) pasan. Todas las llamadas IA del corte usan fixtures/proveedores sintéticos; no se accede al token ni al servicio WebAPI.

**Límite:** esta subunidad no cierra §12ap: aislamiento de todas las rutas, invalidación conjunta de caches/respuestas tardías, colas offline y E2E multi-servicio siguen abiertos; tampoco sustituye el gate global de coverage ni la cobertura pendiente de `pantry.routes.ts`.

### QA-HOUSEHOLD.CALENDAR.ACTIVE-CONTEXT.1 — invalidación del calendario al cambiar de hogar

- [x] Al cambiar la revisión o selección de hogar, vaciar comidas, objetivos, eventos y errores del
      contexto anterior e invalidar sus lecturas pendientes; conservar el rango visible como estado
      de navegación, no como dato del hogar.
- [x] Cuando termine el cambio, pedir de nuevo comidas/objetivos/eventos para el mismo rango bajo el
      hogar activo. Ninguna respuesta tardía del hogar anterior puede restaurar datos antiguos.
- [x] TDD unitario reproduce respuesta tardía de `/calendar/range` y `/calendar/events`, estado
      limpio durante el cambio y recarga del rango visible.
- [x] E2E con dos hogares y comidas sintéticas cambia de hogar desde el selector del shell sin salir
      de `/calendar`; valida además una respuesta de rango antigua retenida hasta después de mostrar el
      hogar nuevo. Chrome escritorio y móvil; capturas sintéticas inspeccionadas.
- [x] Cobertura ≥70 % statements/branches/functions/lines de los archivos modificados en esta
      subunidad; el gate global de Karma se revalidó sin modificar umbrales.

**Evidencia (2026-10-06):** `calendar.service.spec.ts` reproduce y corrige el caso rojo en el que
persistían los datos y las lecturas en vuelo al cambiar el hogar; la prueba focal pasa **26/26** en
Chrome Headless. También cubre filtros/eventos y fallos de borrar/saltar/abandonar sin falsos éxitos;
`createCalendar` devuelve el objeto del contrato y no el envelope HTTP. `calendar.service.ts` alcanza
**95,96/80,95/92,13/95,96 % S/B/F/L** en reporte focal. `tests/e2e/calendar-household-context.spec.ts`
usa el runner con SQLite temporal y
dos hogares sintéticos, intercepta una respuesta real de A, cambia a B en la misma vista y libera la
respuesta anterior después; pasa **2/2** en Chromium escritorio y Mobile Chrome. Capturas revisadas:
`.e2e-screenshots/calendar-household-context/{chromium,mobile-chrome}.png`. `pnpm run typecheck:e2e`
pasa. El gate global de Karma se revalidó sin alterar sus umbrales. El contrato mayor §12ap permanece
abierto para los demás servicios/rutas y su recorrido integrado.

## 12aq — Mejoras solicitadas: planificación, objetivos y contenido multimedia

Estas mejoras se desarrollan en subunidades separadas después de estabilizar el contexto multi-hogar; los detalles de proveedor se resuelven inspeccionando las integraciones existentes antes de cada subunidad, sin inventar capacidades ni guardar secretos en fixtures.

### QA-PLANNER.GOALS-AND-PARTIAL-REPLAN.1

- [x] Permitir regenerar el día completo, un plato/slot concreto o solo los platos seleccionados; lo no seleccionado mantiene identidad, horario y datos salvo una dependencia explícita aprobada.
- [x] Configuración y planificación aceptan varios objetivos junto a instrucciones libres; enviar, recargar y mostrar los valores plurales/custom sin degradarlos a un solo objetivo.
- [x] Mantener selección y objetivos visibles/editables antes de confirmar; los errores/cancelación no dejan un plan parcialmente sobrescrito. Persistir únicamente los cambios confirmados del hogar activo.
- [x] TDD para validación/round-trip, objetivos vacíos o mezclados, replan parcial, cancelación, repetición/idempotencia, error IA y aislamiento entre dos hogares; validar UI real desktop/móvil.

**Fuente revalidada (2026-10-06):** preferencias, formularios del calendario, esquema, prompt y persistencia semanal admiten objetivos plurales/custom. Se agregó el flujo de replanificación selectiva con vista previa/confirmación. Al reproducir dos hogares con la misma semana, el API devolvía mezcladas las comidas por buscar solo `(user_id, week_start)`; el calendario semanal, objetivos y operaciones de comida ahora se resuelven por `(user_id, hogar activo, semana)`, y `/api/ai/replace-meal` no puede usar el proveedor del hogar activo para leer la comida de otra casa. Esto cierra el aislamiento de esta subunidad, no el contrato multi-hogar de todas las rutas de §12ap.

**Subunidad en curso — objetivos plural/custom:**

- [x] E2E aislado en Chrome escritorio/móvil verifica que Preferencias guarda más de un objetivo y el texto custom, recarga el estado y que Planificar envía todos los valores en `goals.types` y `goals.customInstructions`.
- [x] Al cancelar antes de generar no se envía la petición ni se persisten comidas; el escenario sintético confirma que el flujo plural no necesita proveedor real.
- [x] Tras reproducir y corregir discrepancias visuales, correr las pruebas focales API/UI y capturar estados sintéticos en desktop y móvil.

**Evidencia (2026-10-05):** se reprodujo primero que el E2E antiguo usaba un selector `<select>` singular ya retirado; se sustituyó por cobertura de chips plurales y round-trip real de Preferencias. El E2E focal de Chrome desktop/móvil pasa **10/10**, incluye siete opciones, validación de selección vacía/custom, envío plural, cancelación sin petición, persistencia al recargar y medición sin solapamiento a 320 px. La primera aserción visual falló con **0/7 SVG**: la pantalla imprimía nombres internos de icono y los fieldsets conservaban el borde HTML por defecto. Tras reutilizar `app-icon`, un grid responsive uniforme y resetear el fieldset, pasan las diez pruebas. Las rutas AI/calendario y persistencia semanal pasan **76/76** con DB en memoria; `typecheck:e2e`, `check:ui` (196 ficheros/20 reglas) y `build:client` pasan. Capturas inspeccionadas: `.e2e-screenshots/qa-multi-goals/planner-multiple-goals-{chromium,mobile-chrome}.png`.

**Subunidad pendiente — fallo al guardar objetivos:**

- [x] No mostrar éxito ni cerrar el modal hasta que el PATCH de objetivos confirme el guardado.
- [x] Ante error, conservar borrador/objetivos anteriores, mantener abierta la edición y mostrar un error accesible con opción de reintentar.
- [x] TDD con respuesta pendiente/éxito/error y E2E sintético en escritorio/móvil; el reintento persiste en el hogar activo aislado de la prueba.

Evidencia: la prueba de componente se ejecutó primero en rojo por cierre prematuro del modal; después, las pruebas focalizadas de calendario dieron 20/20. `pnpm run typecheck:e2e` pasó. El E2E real `tests/e2e/calendar-goals-save.spec.ts` pasó en Chromium y Mobile Chrome (2/2): intercepta el primer PATCH para simular un 503, comprueba estado pendiente/error accesible y borrador intacto, deja pasar el reintento al API local aislado y verifica persistencia tras recargar. La infraestructura de esta prueba crea un hogar sintético activo; no alterna entre dos hogares ni pretende certificar ese escenario. Capturas sintéticas: `.e2e-screenshots/qa-planner-goals-save/{chromium,mobile-chrome}-save-{error,confirmed}.png` (y variantes de acciones/detalle móvil).

Limitación del gate global: la suite frontend completa ejecutó 968/968 pruebas, pero salió con código 1 porque la cobertura actual queda en 77.26% statements, 63.84% branches, 75.85% functions y 78.60% lines frente al umbral existente de 80%; no se rebajó el umbral. La cobertura focalizada solo con los dos specs es insuficiente para evaluar esa métrica global.

**Subunidad completada — replanificación parcial, confirmación e aislamiento del hogar activo:**

- [x] Selección por día, por plato y de toda la semana; comidas terminadas quedan bloqueadas. La propuesta es editable y la confirmación hace una sustitución atómica que conserva horarios, raciones y notas; un plato no seleccionado no cambia.
- [x] Objetivos plurales/custom, miembros activos e invitados se envían a cada propuesta; cambiar cualquiera de esos datos invalida la vista previa anterior.
- [x] Cancelar solicitudes en vuelo o fallar cualquier candidato no persiste propuestas parciales; la UI solo escribe después de confirmar el conjunto completo.
- [x] El calendario y los objetivos del mismo usuario quedan separados entre hogares activos; lectura, edición, borrado y sustitución cruzada se deniegan. La ruta de sustitución IA tampoco revela comidas de otro hogar.
- [x] Pruebas repetibles de repetición/idempotencia, error de proveedor, objetivo inválido, hogar sin selección, cambio entre dos hogares, API y UI real en escritorio/móvil.

**Evidencia (2026-10-06):** primero falló la prueba de dos hogares porque la segunda comida caía en el calendario de la primera casa y `/range` devolvía ambas; `ensureWeekCalendar` ahora usa el hogar activo y las consultas/actualizaciones de `/api/calendar`, además del lookup IA, filtran el mismo ámbito. Servidor: `DATABASE_PATH=:memory: pnpm --filter @hogaria/server exec vitest run src/routes/calendar.routes.spec.ts src/routes/ai.routes.spec.ts src/utils/weekly-plan.spec.ts --reporter=dot` **101/101** (y luego prueba focal del test de selección activa **2/2** tras corregir la barra final de la ruta raíz); `tsc --noEmit` servidor pasa. Angular focal de replan/servicios **34/34** y typecheck app pasan. La cobertura del componente `calendar-replan.component.ts`, en directorio temporal fuera del repo, es **80,12/71,18/73,58/81,37 %** (S/B/F/L): cumple el mínimo por archivo de 70 %. El comando focal mantiene intacto y no satisface el umbral global de 80 % al medir solo seis tests; no se rebajó el gate. Playwright aislado contra app/SQLite temporales pasa **6/6** en Chromium de escritorio y Mobile Chrome; cubre selección de día/plato, objetivos plurales/custom, edición antes de guardar, error IA sin escritura parcial, recarga y conservación de platos no seleccionados. Capturas sintéticas comparables revisadas: `.e2e-screenshots/calendar-replan-57676/chromium-preview.png` y `.e2e-screenshots/calendar-replan-29712/mobile-chrome-preview.png`. `pnpm run check:ui` pasa (206 ficheros/21 reglas), `typecheck:e2e`, `git diff --check` y ambos typechecks pasan.

**Revalidación TDD de contexto abierto (2026-10-06):** un cambio de hogar mientras el diálogo de replanificación permanece montado dejaba visibles platos, miembros, invitados y propuestas del hogar anterior. La prueba de componente reprodujo ese estado en rojo antes del fix. Ahora el cambio de ID o revisión invalida y limpia el borrador, cancela lectura/generación/aplicación en curso e ignora sus respuestas tardías; tampoco permite enviar ni aplicar propuestas con el contexto obsoleto. La suite focal `calendar-replan.component.spec.ts` pasa **8/8** en Chrome Headless; coverage de `calendar-replan.component.ts`: **81,15 % statements / 71,21 % ramas / 76,36 % funciones / 83,33 % líneas**. El E2E aislado `node scripts/run-isolated-playwright.mjs --project=chromium --project=mobile-chrome tests/e2e/calendar-replan.spec.ts`, con `E2E_CHROME_BIN` apuntando al Chrome instalado, pasa **6/6** usando SQLite temporal; una ejecución inicial sin esa variable falló porque Playwright no tiene su Chromium descargado. Capturas sintéticas desktop/móvil inspeccionadas: `.e2e-screenshots/calendar-replan-42876/chromium-preview.png` y `.e2e-screenshots/calendar-replan-39508/mobile-chrome-preview.png`; cubren el flujo de replanificación, no una selección de hogar desde el diálogo abierto, que no es alcanzable con interacción normal mientras el modal bloquea el fondo. `typecheck:e2e`, `check:ui` (207 ficheros/21 reglas), `build:server` y `build:client` pasan. El build cliente conserva advertencias de presupuesto de bundle/estilos y de imports/optional chaining; no se modificó ningún umbral.

### QA-RECIPE.DETAIL-LEVELS-AND-MEDIA.1

- [x] Una generación devuelve en un JSON toda la receta: metadatos e ingredientes una sola vez, con instrucciones completas para nivel básico, intermedio y experto. Cambiar nivel solo cambia la presentación; no hace otra llamada ni guarda otra receta/ingredientes duplicados.
- [x] La ficha permite cambiar el nivel de detalle después de generar y conserva la selección por receta al cerrar y reabrir su ficha durante la misma visita; es una preferencia de presentación y no duplica ni reescribe instrucciones.
- [x] Al crear/ver receta, intentar buscar imagen y/o vídeo relacionado en Internet si la integración disponible lo permite. Resultados opcionales muestran fuente; ausencia/fallo de búsqueda no bloquea la receta ni produce una imagen/video inventados como resultado de búsqueda.
- [x] TDD de schema/parser para los tres niveles, persistencia, alternancia sin duplicados y acceso seguro a URL; E2E de ficha en escritorio/móvil con atribución accesible.
- [x] Pruebas de búsqueda de fotos con resultados/vacío/error/timeout y visualización accesible de la fuente, incluida búsqueda real opt-in en Commons; la ausencia de búsqueda de vídeo no bloquea la receta.

**Evidencia (2026-10-06):** además de la búsqueda explícita de portada/pasos en el editor, al abrir una receta se intenta una foto real según la escena del paso y se muestra atribución, licencia y fuente mediante proxy del mismo origen. El smoke opt-in `tests/e2e/recipe-step-photos-real.spec.ts`, con receta y consulta sintéticas, pasa **2/2** en Chromium y Mobile Chrome; valida imagen real (>200 px), enlaces de crédito, búsqueda portada en vivo (hasta 10 resultados), y que solo salen del navegador los endpoints propios y la consulta explícita `tortilla`. Las pruebas repetibles servidor/Angular cubren licencia/autoria, host y MIME permitidos, límite de resultados, vacío, error/timeout, autorización, retry y rechazo de URL/bytes inseguros. No se encontró capacidad de vídeo en las integraciones activas; no se inventan resultados.

**Evidencia (2026-10-05):** `generated-recipe.schema.spec.ts` comprueba los tres niveles obligatorios, el orden, listas vacías y URLs HTTPS/alt text; `ai.routes.spec.ts` comprueba que una generación retorna los tres niveles completos en una llamada, sin persistir un borrador; `recipes.routes.spec.ts` comprueba guardar/recargar instrucciones sin duplicar ingredientes. E2E aislado de ficha **2/2** (Chrome escritorio/móvil) verifica alternar niveles sin llamadas IA ni cambios a datos base y que el nivel elegido se conserva al cerrar/reabrir. Regresión aislada de libro/enlaces/acciones **16/16** en escritorio/móvil; incluye selección de estado vacío sintético porque el catálogo sembrado garantiza recetas en la base E2E. `recipe-detail.util.spec.ts` **5/5** cubre preferencia de nivel independiente por receta e inmutabilidad. `typecheck:e2e` y `build:client` pasan; el build conserva avisos de tamaño existentes, incluido `recipes.component.ts` (13,04 kB frente a 10 kB).

**Pendiente explícito:** la integración actual es un endpoint de chat de texto, no genera imágenes ni busca vídeos. El prompt no inventa enlaces y deja las ilustraciones a `null`; las fotos reales se obtienen desde Commons, con atribución/licencia. Una futura capacidad de generación de imagen/vídeo requiere proveedor compatible y revisión de su contrato.

### QA-RECIPE.FULL-DETAIL.OUTPUT-BUDGET.1 — completada

- [x] Las configuraciones IA nuevas parten de un presupuesto de 4096 tokens para no truncar los datos
      comunes y los tres niveles de una receta detallada; formulario y valor por defecto de API coinciden.
- [x] Se respeta el valor explícito de configuraciones existentes; no se reescriben credenciales ni
      preferencias guardadas al cambiar el valor por defecto para altas nuevas.
- [x] Tests de schema y formulario comprueban el valor inicial, el límite válido y el guardado; la
      generación completa sintética mantiene metadatos/ingredientes únicos y tres niveles.

**Evidencia (2026-10-05):** las configuraciones nuevas parten de 4096 tokens en formulario/API;
los valores explícitos de configs existentes siguen intactos. Vitest schema **2/2**, Chrome/Karma
`ai-config.component.spec.ts` **15/15**, Playwright sintético real Chrome `ai-real-smoke.spec.ts`
**1/1** y smoke IA real confirmó una receta solicitada con 11 ingredientes de entrada y tres niveles, ingredientes sin
duplicar, utensilios, electrodomésticos, tareas paralelas, consejos, nutrición y conservación antes
de fallar más adelante en la solicitud independiente de recomendaciones. No se elevó la cota de
tokens superior a la soportada por el contrato.

### QA-RECIPE.FULL-DETAIL-VIEW.1

- [x] Abrir una receta muestra una vista completa y adaptable (sin limitarse a la tarjeta o a un diálogo estrecho), conservando deep link, cierre/retorno, teclado y foco.
- [x] Antes de generar se muestran las raciones —2 por defecto— y el usuario puede confirmarlas o cambiarlas; en el detalle puede ajustar las raciones y escalar solo las cantidades visibles, sin alterar la receta guardada.
- [x] La generación única devuelve y persiste los datos comunes una sola vez: preparación/cocción/reposo y tiempo total, kcal aproximadas por ración, ingredientes con preparación/opcionalidad/alternativas/notas, electrodomésticos disponibles y utensilios.
- [x] La vista presenta pasos cronológicos para cada nivel acordado; el primero indica qué debe lavarse cuando aplique, e incluye temporizadores, tareas paralelas, consejos/variaciones de sabor-textura-presentación y conservación con frigorífico/congelador, duración, recipiente y recalentado cuando proceda.
- [x] Ilustraciones de paso son opcionales: solo mostrar medios reales/generados que tengan URL HTTPS segura y texto alternativo; no inventar enlaces ni dejar que la falta de imágenes bloquee receta o pasos. Mantener búsqueda/generación de medios como integración separada si no está disponible en el proveedor actual.
- [x] TDD de prompt/schema, persistencia compatible con recetas antiguas, raciones/escalado, selector sin llamada adicional ni duplicados, y E2E aislado con datos sintéticos en PC/móvil, teclado/foco y capturas comparables.

**Evidencia (2026-10-05):** la suite completa del servidor con cobertura pasa **1.054/1.054** pruebas; scope cubierto **92,40 % statements / 83,96 % ramas / 95,38 % funciones / 94,49 % líneas**. Los esquemas `generated-recipe`, `ai` y `recipe` quedan por encima de 70 % en las cuatro métricas. La prueba Angular focal de escalado pasa **3/3**. E2E real de navegador con Chrome, API y SQLite temporales, datos sintéticos e ilustración interceptada, pasa **2/2** (Chrome escritorio + móvil); verifica 320 px sin overflow, URL/cierre, valores por ración, niveles, imagen/atribución, raciones escaladas solo en pantalla y cero llamadas a `/api/ai`. Capturas comparables e inspeccionadas: `.e2e-screenshots/recipe-full-detail/{chromium,mobile-chrome}-full-detail.png`. `pnpm run build:server`, `pnpm run build:client`, `pnpm run typecheck:e2e`, `pnpm run check:ui` (194 ficheros, 20 reglas), `git diff --check` y Prettier focal pasan. Angular mantiene avisos existentes de bundles/imports sin uso y aviso presupuestario de tamaño de estilos de `recipes.component.ts` (13,04 kB frente a 10 kB); el build no falla.

**Límite explícito:** el proveedor configurado aquí solo genera texto y la respuesta de receta fija `illustration: null`; por tanto no se inventan fotos ni se afirma que haya búsqueda/generación de imágenes operativa. La vista y el contrato ya aceptan ilustraciones con HTTPS, texto alternativo y atribución cuando una integración real las aporte. La prueba IA E2E es sintética; no llama al proveedor.

### QA-RECIPE.FULL-PAGE.VIEW.1

**Decisión de producto (2026-10-05):** «vista entera» significa una página propia de detalle para la receta guardada, no una tarjeta ni un modal superpuesto. Se conserva el contrato culinario de `QA-RECIPE.FULL-DETAIL-VIEW.1` y el prompt facilitado por el usuario: instrucciones en español de España, para principiantes, con cantidades escalables en pantalla, alternativas, aparatos disponibles, pasos visuales, tareas paralelas, consejos y conservación. Los SVG locales esquemáticos siguen siendo el respaldo honesto hasta disponer de imágenes/vídeos reales con fuente.

- [x] Abrir desde una tarjeta o URL directa muestra una página de detalle a ancho completo del contenido principal, sin diálogo/modal y sin dejar la lista visible debajo; el enlace de la receta sigue siendo compartible.
- [x] Volver y la navegación del navegador restauran el listado, sus filtros/paginación y el foco; la página de detalle ofrece una acción accesible para volver y sus controles son utilizables por teclado.
- [x] La vista conserva todos los apartados y el orden acordados en el prompt, permite cambiar nivel y raciones sin llamar a IA ni reescribir/duplicar datos, y presenta ilustraciones paso a paso locales o medios seguros con atribución.
- [x] TDD primero: E2E aislado que falla si el detalle es un diálogo, confirma URL/deep link, retorno/teclado/foco, orden completo y ausencia de overflow en Chrome desktop/móvil (incluido 320 px); guardar e inspeccionar capturas sintéticas comparables.

**Evidencia (2026-10-05):** TDD primero confirmó que la URL con `recipe=id` aún no mostraba página propia; el E2E pasó tras eliminar el modal y conservar el detalle como ruta consultable. Chrome escritorio y móvil, con seis specs de receta/enlaces y proveedor de IA sintético, pasan **44/44** pruebas. Cubren tarjeta y deep link, ausencia de diálogo/lista debajo, URL compartible, retorno por botón y navegador con filtros/página/foco, teclado, apartados en orden, nivel/raciones sin llamadas IA ni cambios persistidos, atribución y overflow en 320 px. `pnpm run typecheck:e2e`, `pnpm run check:ui` (196 ficheros/20 reglas), `pnpm run build:client` y `git diff --check` pasan. Capturas PC y móvil revisadas: `.e2e-screenshots/recipe-full-detail/chromium-full-detail.png` y `.e2e-screenshots/recipe-full-detail/mobile-chrome-full-detail.png`; los SVG por paso se identifican como «Ilustración esquemática» (no son fotos ni generación fotográfica). El build mantiene avisos de presupuesto global (758,31 kB frente a 500 kB) y estilos de recetas (13,73 kB frente a 10 kB), además de avisos Angular existentes.

### QA-RECIPE.DETAIL-ORDER.1

**Decisión revalidada (2026-10-05):** tanto el borrador generado como la receta guardada deben presentar la explicación completa en el orden del prompt del usuario: tiempo total (con preparación/cocción/reposo), kcal estimadas por ración, ingredientes, electrodomésticos/utensilios, pasos, tareas paralelas, consejos/variaciones y conservación. El selector de nivel no debe esconder los datos comunes ni cambiar ese orden. La ficha guardada conserva el diseño adaptable de detalle amplio y el borrador permite revisar la misma información antes de guardar.

- [x] En las dos vistas, las secciones se leen y se muestran en el orden acordado; la información ampliada de macros queda junto a las kcal estimadas, conservación aparece después de instrucciones/tareas/consejos y el tiempo total no se duplica entre resumen y desglose.
- [x] La portada y el resumen no se solapan: en escritorio sus cajas quedan separadas y en móvil se apilan en orden, con geometría medida en navegador y tolerancia máxima de 1 CSS px.
- [x] TDD/E2E con fixture completo verifica el orden de pantalla, sección ausente opcional, selector de nivel y raciones; repetir en Chrome escritorio y móvil estrecho, revisar capturas sintéticas comparables y no persistir ni invocar IA al alternar.
- [x] El prompt de receta mantiene español de España, texto claro para principiantes, lista cerrada de electrodomésticos, primera indicación de lavado (o que no hace falta), tareas paralelas seguras, variaciones y conservación prudente; validar el contrato con una prueba de prompt.

**Evidencia (2026-10-05):** TDD reprodujo primero tanto el orden incorrecto como el solapamiento portada/resumen. Tras corregir las dos vistas, E2E aislado con datos sintéticos pasa **6/6** pruebas para ficha completa y **8/8** para las tres candidatas múltiples, en Chrome desktop/móvil (incluidos 1440×900, 393×851, 320×568 y 568×320); mide orden y geometría, niveles/raciones y ausencia de nuevas llamadas al alternar. Los tests unitarios enfocados de detalle/ilustraciones pasan **23/23**. La prueba del contrato del prompt del servidor pasa **25/25**. El `lcov` de `recipe-detail.util.ts`, `recipe-step-illustration.util.ts` y `recipe-step-illustration.component.ts` informa cobertura completa de líneas, funciones y ramas de esos módulos. `pnpm run check:ui` pasa (196 ficheros, 20 reglas), `pnpm run typecheck:e2e`, `pnpm run build:client` y `git diff --check` también pasan. Capturas sintéticas inspeccionadas: `.e2e-screenshots/recipe-full-detail/{chromium-full-detail,mobile-chrome-full-detail}.png` y `.e2e-screenshots/recipe-generated-preview/{chromium,mobile-chrome}-generated-recipe-detail-level-*`.

**Gate global pendiente ajeno a esta unidad:** `pnpm run test:client` completa **963/964** pruebas, pero falla `CalendarComponent meal deletion feedback keeps plural goal edits open and makes no success claim when saving fails`; además la cobertura global queda por debajo del umbral local existente del 80% (77,19% statements, 63,76% branches, 75,73% functions y 78,55% lines). No se modificó el calendario en esta unidad. El build de producción compila, con advertencias Angular/tamaño ya visibles en el proyecto.

### QA-RECIPE.GENERATED-DRAFT.FULL-PREVIEW.1

**Fuente revalidada (2026-10-05):** la ficha guardada ya presenta el detalle completo, pero el borrador que aparece tras generar una receta omite tiempos desglosados, macronutrientes, conservación y avisos de pasos. Una persona debe poder revisar la misma información útil antes de guardar; no se debe persistir una receta para poder leerla ni duplicar ingredientes por nivel.

- [x] El formulario conserva un diálogo compacto antes de generar; al recibir un borrador completo oculta el formulario y lo presenta en una vista amplia adaptable, con el detalle inmediatamente visible al inicio. El usuario puede volver a editar ingredientes/opciones sin perder el borrador; al descartarlo o cerrar/reabrir el diálogo vuelve al formulario compacto. La ficha guardada continúa usando la vista completa.
- [x] Cada una de las tres opciones múltiples ofrece una vista completa propia antes de guardarla y retorno a la lista, conservando su nivel de detalle; abrirla no genera otra llamada ni la persiste.
- [x] El borrador muestra preparación, cocción, reposo y total; porciones con su número; kcal/macros estimados por ración; ingredientes con cantidades, unidades y separación legible de preparación/notas/opcionalidad/alternativas; electrodomésticos/utensilios; pasos con tiempos, consejos y advertencias; tareas paralelas, variaciones y conservación (frigorífico, recipiente, congelación y recalentado cuando proceda). Los tres borradores múltiples muestran también el número de porciones.
- [x] Los niveles básico/intermedio/experto conservan los mismos datos comunes y la selección solo cambia los pasos visibles. Cambiar nivel/raciones no provoca llamada IA ni modifica el borrador o receta guardada.
- [x] Ilustraciones y atribuciones opcionales solo se muestran si URL/alt-text pasan la validación segura existente; vacío o proveedor de texto no bloquean ni inventan contenido.
- [x] TDD con un borrador sintético completo, confirmación de secciones antes de guardar y regresión E2E Chrome desktop/móvil, teclado/foco y sin desbordamiento.

**Evidencia (2026-10-05):** TDD reprodujo primero que las candidatas múltiples no ofrecían ficha completa; tras implementar el selector a ficha compartida, la suite E2E aislada con proveedor sintético y SQLite temporal pasa **12/12** en Chrome desktop y emulación móvil, incluidas 1440×900, 393×851, 320×568 y 568×320. Verifica diálogo compacto→completo, edición sin perder el borrador, ficha completa de las tres candidatas, retorno a lista, raciones, ingredientes, macros, tiempos, electrodomésticos, tareas paralelas, avisos, conservación, selector local sin nueva llamada, guardado explícito de una opción, persistencia de niveles y reapertura compacta. Capturas comparables generadas e inspeccionadas: `.e2e-screenshots/recipe-generated-preview/{chromium,mobile-chrome}-generated-recipe-detail-level-*` y `*-generated-option-full-detail-*`. También pasan `pnpm run typecheck:e2e`, `pnpm run check:ui` (194 ficheros, 20 reglas) y `pnpm run build:client`. El build conserva avisos de tamaño inicial (757,52 kB frente a 500 kB), estilos de `recipes.component.ts` (13,14 kB frente a 10 kB) y avisos Angular de imports/nullability sin uso; compila correctamente.

**Limitación multimedia:** el proveedor actual es de texto; las recetas no inventan ilustraciones. El control de URL HTTPS/alt-text queda cubierto por la ficha guardada previa, y los borradores sin imagen siguen completos. La búsqueda/generación de ilustraciones continúa pendiente de una integración real de medios.

### QA-RECIPE.STEP-ILLUSTRATIONS.LOCAL.1

El usuario aporta como guía que cada receta sea una explicación completa para cocinar desde cero: tiempos, kcal por ración, ingredientes y alternativas, electrodomésticos disponibles, pasos cronológicos (incluido lavado al principio cuando corresponda), tareas paralelas, consejos de sabor/textura/presentación y conservación. Ese contrato ya está cubierto por `QA-RECIPE.FULL-DETAIL-VIEW.1`; esta unidad añade una ayuda visual inmediata sin fingir que el proveedor de texto puede generar o buscar imágenes.

**Revisión de producto (2026-10-05):** aunque la solución esquemática se implementó y probó, el usuario la considera poco elaborada y prefiere fotos reales. Esta unidad queda como evidencia histórica, no como criterio visual vigente; `QA-RECIPE.STEP-PHOTO-SEARCH.1` la reemplaza en la interfaz.

- [x] En borradores y recetas guardadas, cada paso tiene una ilustración esquemática local según la acción (lavar, cortar, mezclar, cocinar, hornear, reposar, servir o preparación general) cuando no hay una imagen remota validada.
- [x] Una ilustración externa con URL HTTPS y texto alternativo válidos tiene prioridad; la ilustración local no incluye URL/fuente inventada y se identifica como esquemática, no como foto o resultado de búsqueda.
- [x] Las ilustraciones son descriptivas y accesibles, no sustituyen el texto ni los avisos; se renderizan sin servicio externo, mantienen texto alternativo semántico y funcionan con los tres niveles y en móvil estrecho.
- [x] Cambiar nivel/raciones no genera llamadas IA ni modifica receta/ingredientes persistidos o duplica datos. Fallos o ausencia de ilustraciones nunca bloquean la lectura.
- [x] TDD del clasificador y E2E real aislado en Chrome de vista guardada y borrador en PC/móvil, incluido 320 px; capturas sintéticas comparables revisadas y verificación de build, cobertura y accesibilidad.

**Evidencia (2026-10-05):** `CHROME_BIN=... ng test --no-watch --code-coverage --include=src/app/features/recipes/recipe-step-illustration.*.spec.ts` ejecuta 18/18; ambos archivos nuevos muestran 100 % de statements/branches/functions/lines en sus reportes individuales. El comando filtrado termina con el gate global 80 % en rojo (31,14/4,69/13,46/32,95 %), porque esa selección no corre el resto de pruebas; no se rebajó ningún gate. `pnpm run typecheck:e2e`, `pnpm run check:ui` (196 ficheros/20 reglas), `ngc -p tsconfig.app.json --noEmit`, `pnpm run build:client` y `git diff --check` pasan. `E2E_CHROME_BIN=... pnpm run test:e2e -- --grep 'la ficha completa presenta detalle|cambia el nivel solo en pantalla y conserva|la generación individual informa error y permite reintentar' --project=chromium --project=mobile-chrome`: 14/14, con SQLite y app temporales aislados; cubre borrador/guardada, selector de tres niveles, imágenes válidas/rotas/ausentes, fallback accesible, cambio de raciones/nivel y ancho de 320 px. Capturas revisadas en `.e2e-screenshots/recipe-step-illustrations/` (escritorio y móvil).

**Límite:** estas ilustraciones son vectores esquemáticos propios de la aplicación. La búsqueda web de fotos/vídeos o generación fotográfica por IA sigue siendo la integración separada pendiente de `QA-RECIPE.DETAIL-LEVELS-AND-MEDIA.1`.

### QA-RECIPE.STEP-PHOTO-SEARCH.1 — fotografía real con autoría y licencia

**Decisión de producto (2026-10-05):** no volver a mostrar los diagramas SVG genéricos como ilustración principal de los pasos. Buscar fotografías reales en Wikimedia Commons, que ofrece metadatos de autoría y licencia; enseñar la foto solo si la respuesta contiene URL HTTPS de `thumb.wikimedia.org` o `upload.wikimedia.org`, un autor identificable y licencia explícita. La tarjeta enlaza a la página original y a la licencia. La falta de resultados, mala conexión, timeout o imagen rota nunca oculta instrucciones ni impide guardar/leer la receta; en esos casos no se sustituye por otro dibujo esquemático.

**Privacidad y carga:** las consultas se forman exclusivamente con una lista cerrada de escenas de cocina (lavar, cortar, mezclar, cocinar, hornear, reposar, servir/preparar). No enviar a Wikimedia nombres de recetas, ingredientes, pasos literales, hogar ni datos del usuario. Buscar al entrar en una ficha/borrador, de forma asíncrona y bajo demanda/lazy, limitar y cachear por escena; no persistir imágenes ni resultados en DB. El servidor solo admite escenas enumeradas, valida URL de miniatura en `thumb.wikimedia.org` o `upload.wikimedia.org` y sirve sus bytes mediante un proxy autenticado de mismo origen para que el navegador no contacte Wikimedia ni comparta allí su IP. El proxy nunca acepta URLs del cliente y mantiene el User-Agent identificable exigido por Wikimedia.

- [x] TDD del catálogo de escenas, parser de `imageinfo/extmetadata`, crédito seguro, licencia/source links y filtro de HTTPS/host/MIME; rechazar resultados sin autor/licencia, URL insegura, SVG/dibujo y metadata malformada sin filtrar HTML.
- [x] Endpoints autenticados restringen escenas/identificadores, consultan Commons con límite de resultados, timeout, caché y respuestas de error normalizadas, y transmiten imágenes raster de tamaño acotado desde el proxy de mismo origen; comprobar resultado, vacío, error HTTP/429, timeout, respuesta malformada, identificador inexistente y repetición sin enviar texto del usuario ni guardar nada.
- [x] Borrador y ficha guardada muestran fotos reales disponibles con `alt`, autoría/licencia legibles y enlaces accesibles; eliminan SVG esquemáticos como fallback; cargando/sin resultado/error/reintento permanecen utilizables por teclado, no bloquean el texto y no desbordan.
- [x] E2E aislado simula Commons en PC/móvil (incluido 320 px y horizontal), verifica metadatos/atribución, cambio de nivel, carga diferida, fallo/recuperación y que el request solo contiene la escena permitida. Prueba de integración real opt-in hace consultas genéricas, no sube recetas/tickets y nunca captura cuerpos; guardar e inspeccionar capturas sintéticas.
- [x] Medir cobertura focal de statements, ramas, funciones y líneas (≥70 %, sin bajar gates existentes), typechecks, build, accesibilidad, i18n y check de UI; revalidar que los SVG ya no aparecen como solución por defecto.

**Evidencia de verificación (2026-10-05):** `pnpm --filter @hogaria/server exec vitest run src/utils/recipe-step-photos.spec.ts src/routes/recipe-step-photos.routes.spec.ts src/utils/recipe-step-photos.integration.spec.ts` ejecutó 19 pruebas (1 opt-in omitida); `DATABASE_PATH=:memory: pnpm run test:server:coverage` ejecutó 1.078 pruebas/1 omitida con 91,84/83,33/95,4/94,17 % globales. Cobertura focal servidor: router 91,66/90,9/100/91,3 % y proveedor 82,41/70,86/95,23/88,82 % (statements/branches/functions/lines). Suite cliente: 965/965 pruebas correctas; la cobertura global existente permanece en rojo en 77,30/63,87/75,89/78,67 % frente al gate 80 %; no se bajó. `recipe-step-photo.component.ts`, el clasificador y modelo: 100 % en las cuatro métricas; el servicio de recetas: 90,91/81,58/91,11/90,91 %.

`pnpm run typecheck:e2e`, `pnpm run check:ui` (197 ficheros/20 reglas), `pnpm run build:server`, `pnpm run build:client` y `git diff --check` pasan; el build cliente mantiene advertencias de presupuesto global/componente que ya deben tratarse aparte. E2E aislado con Chrome: ficha completa 2/2 (PC/móvil, 320 px y horizontal), borrador generado→guardar→reabrir 4/4, error/reintento 2/2; humo real opt-in 2/2 contra Commons, usando receta sintética y solo `scene=cut`, verificando que el navegador no contacta Wikimedia. Base SQLite temporal y artefactos del runner aislado se limpiaron. Capturas reales inspeccionadas: `.e2e-screenshots/recipe-step-photos-real/chromium-real-commons-photo.png` y `.e2e-screenshots/recipe-step-photos-real/mobile-chrome-real-commons-photo.png`; capturas mock PC/móvil: `.e2e-screenshots/recipe-full-detail/`.

**Revalidación de redirecciones (2026-10-06):** la validación inicial de host no bastaba si `fetch` seguía una redirección emitida por el upstream. El proxy ahora solicita `redirect: 'error'` tanto para la API de Commons como para la miniatura; la prueba de regresión primero falló con la opción ausente y pasa tras el arreglo. `pnpm --filter @hogaria/server exec vitest run src/utils/recipe-step-photos.spec.ts`: **18/18**. No se accedió a la red externa durante este test.

**Fuente técnica vigente (2026-10-05):** la documentación de MediaWiki permite buscar archivos mediante `generator=search` y obtener URL/MIME y `extmetadata` (autor/licencia) con `prop=imageinfo`; recomienda pedir pocos metadatos porque el campo es costoso. La API exige un User-Agent identificable y atribuir el contenido conforme a su licencia. La imagen se sirve por proxy de mismo origen; el enlace de atribución sí lleva a Wikimedia Commons. El API no forma parte de la configuración/token de IA de HogarIA.

### QA-RECIPE.EDIT-DEDICATED-VIEW.1 — edición integral en vista propia

**Decisión de producto (2026-10-05):** editar una receta guardada abre una ruta/página dedicada, no un modal. El formulario mantiene el diseño y el ancho de contenido común de HogarIA, con secciones claras, acciones persistentes accesibles y adaptación real a móvil. Solo quien sea dueño editable de la receta puede guardar cambios; se reutiliza la regla del API (`author !== 'catalog' && author_id === userId`), no se confía en ocultar el botón del cliente. Las recetas de catálogo, ajenas o de solo lectura conservan su ficha normal, sin acción de edición.

La edición permite corregir los datos existentes completos sin regenerar ni duplicar la receta: datos generales (nombre, descripción, dificultad, país/cocina, comidas, etiquetas, imagen de portada segura, duración y raciones), ingredientes con cantidad/unidad/preparación/opcional/sustituciones/notas, utensilios, guía (electrodomésticos, tareas paralelas, consejos), nutrición, conservación y pasos. Para recetas nuevas conserva por separado las instrucciones `basic`, `intermediate` y `expert`; no convierte una variante en todas ni las aplana a `steps`. Recetas históricas de nivel único permanecen editables sin inventar variantes. Editar, cambiar nivel o raciones no invoca IA; las fotos de pasos siguen derivándose de la acción y su carga no persiste datos de usuario.

- [x] Desde la ficha propia se puede entrar en `/recipes/:id/edit`, editar y volver a la ficha/listado; la ruta funciona tras recargar/abrirse directamente, y recetas ajenas/de catálogo no exponen acción ni aceptan guardado en el servidor.
- [x] Vista de edición precarga toda la receta sin pérdida y ofrece formularios accesibles para metadatos, ingredientes, utensilios, los tres niveles de pasos cuando existan, nutrición, conservación y guía; añadir/quitar/reordenar ingredientes y pasos conserva las relaciones y la secuencia, y recetas heredadas con pasos planos siguen funcionando.
- [x] Guardar persiste el conjunto completo de campos editables en una operación consistente, mantiene autoría/propietario, favoritos/uso y campos no enviados, vuelve a la ficha con datos actualizados y no crea una receta duplicada; cancelación conserva lo guardado y descartar cambios sin guardar requiere confirmación explícita. Sin conexión/validación/403/404, mantiene el borrador visible, explica el error y permite reintentar.
- [x] Pruebas primero: esquema/UI para límites de campos, datos vacíos y nested arrays; integración PATCH para round-trip de todos los niveles y metadatos, autorización propia/ajena/catálogo, payload inválido y fallo de persistencia sin cambios parciales; E2E aislado cubre ruta directa, validación, guardado, reabrir, cancelar/descartar, error recuperable, teclado/foco y ausencia de llamadas IA.
- [x] Playwright real en escritorio y móvil: anchos 320, 393 y escritorio, horizontal, scroll/teclado y modales de confirmación; capturas sintéticas revisadas. Cobertura focal frontend ≥70 % en statements/branches/functions/lines sin rebajar el gate global, check UI, i18n, accesibilidad, typechecks y builds; fixtures/BD temporales aisladas.

**Evidencia verificada (2026-10-05):** tests Angular focales **23/23**, E2E aislado Chrome escritorio/móvil **8/8**, suite servidor con coverage **1.118 passed / 1 skipped** y builds/typecheck/UI checks verdes. Detalle de comandos, porcentajes por fichero y capturas en [HOGARIA-MEMBERS-RECIPE-IMPROVEMENTS-SPEC.md](HOGARIA-MEMBERS-RECIPE-IMPROVEMENTS-SPEC.md#evidencia-de-avance--editor-dedicado-y-gestor-de-imágenes-2026-10-05).

**Cierre focal (2026-10-06):** cobertura `recipe-edit.component.ts` **93,99/85,71/91,67/100 %** y `recipe-edit.util.ts` **88,52/82,67/100/100 %** S/B/F/L, con sus **21/21** pruebas Angular; Playwright aislado `recipe-edit.spec.ts` pasa **10/10** (Chromium escritorio y Mobile Chrome). La matriz comprueba 320, 393 px y horizontal, navegación directa, edición round-trip, guardado/reapertura, validación, cancelación, teclado/foco y que editar no llama a IA; los datos son sintéticos y la base es temporal. Capturas comparables revisadas: `.e2e-screenshots/recipe-editor/desktop.png` y `.e2e-screenshots/recipe-editor/mobile.png`. Los builds, `typecheck:e2e`, `check:ui` y `git diff --check` pasan. El comando de cobertura focal conserva el gate global del 80 % intacto y por ello sale con código 1 al medir el subconjunto; ambas unidades cubiertas exceden el mínimo focal del 70 % en las cuatro métricas. No afirma que el gate global frontend esté completo.

### QA-PRODUCT.IMAGES.1

- [x] Al agregar un producto al inventario (alta directa, catálogo, confirmación de ticket y completar compra), iniciar búsqueda de imagen en segundo plano sin bloquear la operación y respetando la cola/concurrencia del proveedor compartido.
- [x] Usuario con permiso existente de edición del inventario puede reintentar una búsqueda fallida, revisar hasta diez imágenes con atribución/licencia y elegir una; puede subir una imagen propia validada. **Candidatos generados por IA (3–4)** requieren una capacidad de generación de imágenes realmente soportada/configurada; no simular generación mediante búsqueda ni mandar prompts a un endpoint de chat.
- [x] Estado queued/running/complete/failed/cancelled, retry idempotente, cancelación/repetición y límites de tamaño/tipo se modelan explícitamente. El hogar activo y los permisos de despensa protegen producto y medios; fallos externos nunca revierten el alta ni escriben en otro hogar.
- [x] Los resultados/miniaturas no quedan rotos tras recarga o reinicio del servidor: selección licenciada se conserva localmente; resultados de búsqueda caducados se identifican y permiten nueva búsqueda sin exponer el producto de otra casa.
- [x] TDD con proveedor sintético que verifica concurrencia, cancelación, fallo, tipo/tamaño, atribución, permisos y scopes. Playwright aislado contra app+API+SQLite temporal valida cola UI en escritorio/móvil; capturas sintéticas inspeccionadas, sin fotos personales ni secretos.
- [x] Cobertura de cada archivo nuevo/modificado del flujo ≥70 % en statements/branches/functions/lines, sin rebajar gates; check-ui, typechecks y builds requeridos pasan.

**Revalidación y pruebas TDD (2026-10-06):** se corrigieron dos hallazgos. El E2E ahora usa una imagen de tomate de fixture sintético visible (80 × 60), no píxeles blancos; el recorte de móvil muestra dos tarjetas completas por fila antes del menú fijo y la prueba recorre 320 × 568, 393 × 851, 568 × 320 y 1440 × 900 sin overflow, mide 12 acciones de 44 px con geometría uniforme y verifica foco/Enter. Las capturas revisadas son `.e2e-screenshots/2026-10-06-pantry-image-editor-refactor/{chromium,mobile-chrome}.png`. La segunda regresión fue roja antes del arreglo: tras simular reinicio (sin `getPhoto` en RAM) el proxy de miniatura daba 404 aunque SQLite retenía candidatos. Ahora resuelve solo IDs persistidos como candidatos Commons públicos, recupera los bytes desde el `thumbnailUrl` validado si expiró la caché, mantiene MIME/tamaño limitado y no devuelve nombre/producto/hogar; volver a seleccionar una imagen también tolera esa expiración. API: `pantry-product-images.routes.spec.ts` **11/11**; suite completa de servidor en base en memoria **1.178 aprobadas / 1 omitida**. E2E real aislado, SQLite temporal y proveedor sintético: **2/2** (Chrome escritorio/móvil), persiste selección al recargar y sube foto validada. `check:ui` (207 archivos/21 reglas), `typecheck:e2e` y build de producción pasan; build conserva avisos Angular/presupuesto existentes. No se contactó Wikimedia ni se fingió generación de imagen por IA: la integración presente no soporta raster. El primer E2E sin `E2E_CHROME_BIN` no encontró el Chromium descargado; la pasada verde usó Chrome instalado. No se cambió ningún umbral.

**Cierre del gate por archivo (2026-10-06):** reejecutada la suite completa de servidor con `DATABASE_PATH=:memory:` y coverage en directorio temporal: **1.188 pasaron / 1 omitida**, **91,56/82,83/95,59/94,13 % S/B/F/L** agregado; `pantry.routes.ts` mide **93,64/81,93/98,57/95,55 %**, `pantry-product-images.routes.ts` **88,74/79,81/88,88/93,84 %**, `product-image-search.ts` **96/90,32/100/97,33 %** y `recipe-images.routes.ts` **100 %** en las cuatro métricas. Las pruebas focales posteriores al tipado del helper `pantry.routes.spec.ts` + `recipe-images.routes.spec.ts` pasan **20/20**. En el informe completo del cliente, `PantryService` **100/84,82/100/100 %**, `PantryItemComponent` **98,59/92,85/95,65/100 %**, y `pantry-product-image-editor.component.ts` **88,33/87,50/84,61/90,38 %**; la suite frontend pasa **1.144/1.144** y su gate global intacto supera 80 % en las cuatro métricas. El cierre por archivo es ahora verificable; la cobertura y pruebas aquí usan fixtures/datos temporales, no el inventario normal.

### QA-SHOPPING.GROUP-AND-WEIGHT-ORDER.1

- [x] La lista puede agruparse por categoría y/o ordenarse por peso; las opciones se pueden combinar o desactivar sin cambiar cantidades, checks, productos ni orden persistido original.
- [x] Incluir orden pesado-primero y una opción para dejar congelados al final. Peso desconocido o unidades incompatibles se mantienen en una zona estable, sin conversiones inventadas.
- [x] TDD para mezcla de categorías, unidades comparables/no comparables, peso ausente, productos congelados, empate, checks/manual order y cambio de hogar; UI responsive y accesible.

**Evidencia base (2026-10-06):** `orderShoppingItems` trabaja sobre una copia de presentación: convierte explícitamente mg/g/kg y alias de masa; unidades de volumen/desconocidas quedan en una zona estable. Congelados al final funciona agrupado y sin agrupar, sin modificar `position` ni persistir preferencias. La primera iteración de pruebas cubría la interacción con ratón; el cierre amplía cobertura a teclado, cambio de hogar y métricas por archivo (ver evidencia siguiente).

**Cierre QA (2026-10-06):** cobertura real de `shopping.model.ts`, ejecutando sus 27 tests con Chrome Headless y `QA_COVERAGE_DIR` temporal (sin modificar `frontend/coverage`): statements **94,21 %**, branches **87,16 %**, functions **100 %**, lines **100 %**. El comando filtrado termina en código 1 porque el gate global intacto exige 80 % sobre la selección parcial (48,86/49,61/48,93/52,27); no se rebajó el gate. E2E aislado de Playwright, SQLite temporal, Chrome escritorio y móvil: **4/4**; cubre selector/checkbox con teclado y cambio real entre dos casas, comprueba 404 para la lista doméstica ajena y su restauración al reactivar la casa original. API en memoria `shopping.routes.spec.ts`: **95/95**. La prueba nueva fue roja antes del fix. Capturas sintéticas desktop/móvil inspeccionadas.

El fix descubierto cierra también la exposición concreta de esta subunidad: `getScope` solo incluye las listas del hogar activo y datos personales sin `household_id`; ser el autor de una lista asociada a otra casa ya no permite verla al cambiar de hogar o quedar sin selección. Esto no prueba el aislamiento de las demás rutas; el contrato general de §12ap sigue pendiente.

## 12ar — Error de login por proxy local

**Fuente revalidada (2026-10-04):** el navegador usa `frontend/proxy.conf.json` para enviar `/api` a `localhost:3000`. En el entorno actual `localhost` resuelve al listener IPv6 que sirve otro dashboard; el backend HogarIA responde correctamente por `127.0.0.1:3000`. El error visible como “Recurso no encontrado” es por tanto un destino de proxy equivocado, no una contraseña.

### QA-LOCAL-DEV.PROXY-IPV4.1

- [x] Fijar el proxy de desarrollo a `127.0.0.1` y añadir una prueba que impida volver a `localhost` ambiguo.
- [x] Verificar el endpoint de salud del backend por el destino nuevo y describir el reinicio necesario del cliente si ya estaba iniciado.

**Evidencia (2026-10-04):** `node --test scripts/karma-coverage-gate.test.mjs` pasa 3/3. `127.0.0.1:3000/api/health` devuelve HTTP 200 de HogarIA; `localhost:4200/api/health` en el proceso cliente ya iniciado seguía llegando al dashboard ajeno y devolvía HTTP 500. Una instancia temporal de Angular cargada con el proxy corregido respondió HTTP 200 a `/api/health` y a la ruta UI `/auth/login`. No se envió ninguna credencial real. El proxy de `ng serve` se lee al arrancar: para que el cliente existente en `localhost:4200` aplique el arreglo hay que reiniciar solo el servidor frontend; no hace falta tocar ni detener el API.

## 12as — Rejilla del calendario de 24 horas y scroll contextual

**Fuente revalidada (2026-10-04):** `CalendarTimelineComponent` usa `windowFor()` para recortar las horas a los eventos/anclas y desplaza el inicio hacia el primer evento cuando la fecha visible no es hoy. La captura del 5–11 de octubre muestra la rejilla comenzando sobre las 05:00 y terminando en las horas del mediodía, aunque al crear un evento se necesita poder acceder al resto del día. La rejilla ya tiene scroll interno y el marcador/scroll de hora actual condicionado a que hoy esté entre los días mostrados.

**Decisión del usuario:** la rejilla de Día/Semana siempre abarca el día civil completo, de 00:00 a 24:00. Si la fecha actual está visible, la posición inicial muestra la hora actual; para cualquier otro día/semana comienza arriba a las 00:00, no saltando al primer evento. La persona puede recorrer las 24 horas con el scroll interno; no se comprime todo el día en una pantalla.

### QA-CALENDAR.FULL-DAY-TIMELINE.1

- [x] Día y Semana mantienen la escala 00:00–24:00 aunque no haya eventos o estén agrupados. Las etiquetas cubren 00:00–23:00 y los eventos 00:00/23:30 quedan dentro de la escala.
- [x] La rejilla conserva scroll vertical interno. Si hoy aparece, enfoca la hora actual; para otro periodo comienza a medianoche aunque haya eventos.
- [x] Cambiar de rango montado recalcula el inicio; actualizar datos del mismo rango y otros cambios de cocina no pisan el scroll manual.
- [x] TDD: pruebas unitarias y Playwright real con datos sintéticos validan Día/Semana, creación de evento para la semana siguiente y scroll en escritorio/móvil. Se guardaron e inspeccionaron capturas sin datos personales.
- [x] El código de geometría afectado supera 70 % en todas las métricas del scope; build, typecheck, `check-ui`, E2E aislado y límites responsive validados sin bajar gates.
- [x] Gate global de cobertura del frontend (80 % existente): revalidado en 2026-10-06 con 1.127/1.127 pruebas; statements 88,83 %, branches 80,04 %, functions 88,34 % y lines 90,20 %. Los cuatro valores superan el 80 % sin cambiar ningún umbral. La ejecución anterior por debajo del gate queda como evidencia histórica.

**Evidencia (2026-10-04):** `pnpm --filter @hogaria/web exec ng test --no-watch --include=src/app/core/calendar-grid.spec.ts --include=src/app/features/calendar/calendar-timeline.component.spec.ts --browsers=ChromeHeadless` pasa 20/20. `pnpm test:e2e --project=chromium --project=mobile-chrome --grep "arranca en la vista de semana|la semana siguiente empieza"` pasa 4/4 con servidor y SQLite temporales; `pnpm test:e2e --project=chromium --project=mobile-chrome --grep "muestra y enfoca las horas de madrugada"` pasa 2/2 a las 02:08 en Europe/Madrid. Capturas inspeccionadas: `.e2e-screenshots/qa-calendar-full-day-1/{chromium,mobile-chrome}-next-week-{midnight,last-hours}.png`.

`pnpm run build:client`, `pnpm run typecheck:e2e` y `pnpm run check:ui` pasan (189 archivos, 20 reglas). El lint del cliente no pudo iniciarse porque falta el paquete `@angular-eslint/builder`; no se instaló ni cambió ninguna dependencia. La suite completa ejecuta 929/929 pruebas, pero el gate de coverage 80 % de Karma queda rojo con los valores arriba; no se rebajó.

**Enlace con el contrato anterior:** esta unidad supersede solo el recorte de ventana y el salto al primer evento de §12h.D. Se conservan colocación, clics y duración de bloques, orden, invitados y representación del marcador de ahora.

## 12at — Calendario con vistas y editor de eventos al estilo Google Calendar

**Fuente revalidada (2026-10-04):** las capturas adjuntas son de Google Calendar. La app actual tiene rejilla de día/semana/mes, un modal centrado genérico para eventos y repetición limitada a `ninguna/diaria/semanal`. No tiene vistas Año, Agenda ni 4 días; tampoco guarda intervalos, días de semana seleccionados o fin de serie. La recurrencia del servidor expande ocurrencias desde una fila y usa fechas excluidas, que se conservan. La sección §12t-R dejó explícitamente mensual, intervalos y `until` para más adelante; esta unidad supersede esa exclusión para eventos del calendario.

**Decisión de alcance:** tomar las capturas como referencia visual y funcional para el calendario de HogarIA, no como petición de modificar el navegador Chrome. Replicar la estructura principal de la agenda de Google —barra de navegación, selector de vista, mini-calendario lateral, popover de alta/edición y diálogo de periodicidad personalizada— conservando el modelo y las acciones propias de HogarIA (categoría, color, compartir, invitados, ubicación y notas). Las seis vistas del selector de referencia quedan dentro del alcance: Día, 4 días, Semana, Mes, Año y Agenda. Las vistas/rango y fecha deben ser enlazables en URL. En móvil, la mini-navegación puede colapsarse en un panel accesible, sin perder controles ni crear scroll horizontal.

La repetición ofrecerá: no repetir, diaria, días laborables, semanal en el día inicial, mensual en el día del mes inicial, anual en la fecha inicial y «Personalizar». Personalizar permite repetir cada 1–99 días/semanas/meses/años; para frecuencia semanal permite seleccionar días; y termina nunca, en fecha inclusiva o después de 1–999 ocurrencias. Las ocurrencias siguen proyectándose al leer (no se duplican filas) y las excepciones por fecha permanecen. Eventos heredados `none/daily/weekly` siguen leyéndose sin conversión destructiva. El proveedor Google, sincronización externa, Meet, Drive, citas externas y Tareas de Google no tienen respaldo actual y no se simulan ni se guardan como si funcionaran; sus controles no se mostrarán.

### QA-CALENDAR.GOOGLE-LIKE.1

- [x] El selector accesible contiene Día, 4 días, Semana, Mes, Año y Agenda. La vista elegida y la fecha/rango se enlazan en URL y sobreviven a recarga; elegir un número en la vista Mes abre esa fecha en Día. Evidencia: `tests/e2e/calendar.spec.ts`, `tests/e2e/calendar-google-like-ui.spec.ts`.
- [x] Las utilidades calculan rangos y navegación natural para las seis vistas, incluyendo día bisiesto. Evidencia: `frontend/src/app/features/calendar/calendar-view.util.spec.ts`.
- [x] Atrás/adelante del navegador restaura vista y fecha/rango juntos. Evidencia: prueba `atrás y adelante del navegador restauran la vista y el periodo del calendario` en `calendar-google-like-ui.spec.ts`; E2E Chrome escritorio/móvil, 2/2.
- [x] El selector de fecha superior salta en Día, 4 días, Semana, Mes, Año y Agenda; URL, vista y mes de la mini agenda siguen sincronizados. Evidencia: E2E «el salto de fecha sincroniza el encabezado…», 2/2 proyectos.
- [x] El E2E del mini-calendario verifica cambio de mes, selección de día, botón Hoy y conservación de selección/URL tras recarga, en Chrome escritorio y móvil. Evidencia: `calendar-google-like-ui.spec.ts`, prueba «la mini agenda cambia de mes y fecha…» (1/1 en cada proyecto).
- [x] Día, 4 días y Semana conservan las 24 horas y desplazamiento; Mes presenta rejilla semanal y Año 12 rejillas mensuales. Agenda cubre 12 meses desde la fecha ancla. Evidencia: E2E de calendario y pruebas unitarias de rangos.
- [x] Las capas/filtros sobreviven el cambio entre las seis vistas y la recarga; sus botones exponen el estado accesible correcto. Evidencia: E2E «las capas seleccionadas se conservan…», 2/2 proyectos.
- [x] Seleccionar un día en la rejilla Mes abre ese día; el título de un mes en Año abre Mes; seleccionar un día desde Año abre ese día. En todos los casos vista, fecha del selector superior, URL y mini agenda quedan sincronizados y sobreviven a recarga. E2E `calendar-google-like-ui.spec.ts`, Chromium + Chrome móvil, 2/2.
- [x] El editor compacto de evento incluye título, fecha/hora, todo el día y repetición de un paso; «Más opciones» expande datos propios de HogarIA. Escape/cierre y persistencia básica se ejercitan, con capturas sintéticas inspeccionadas en escritorio y móvil.
- [x] Matriz del editor: foco/teclado, validación, re-edición de todos los campos, cancelación sin cambios e invitados/borrado.
- [x] El selector presenta las cadencias acordadas y «Personalizar» permite intervalo, unidad y fin; se probó persistencia de un intervalo con fin por número. La expansión conserva una fila por serie y las excepciones. Evidencia: `tests/e2e/calendar.spec.ts`, `server/src/utils/calendar-recurrence.spec.ts`, `server/src/routes/calendar.routes.spec.ts`.
- [x] Repetición semanal personalizada con varios días y fin por fecha persiste y proyecta las ocurrencias correctas sin duplicar la fila; reabrir restaura días/fecha, cancelar descarta el borrador y editar el título mantiene la regla. Playwright real en Chrome escritorio/móvil, 2/2.
- [x] API/base de datos validan y persisten la regla estructurada sin convertir destructivamente reglas antiguas; el set enfocado cubre límites, exclusiones, fechas inválidas, años bisiestos, fin de mes, intervalos y conteo inclusivo.
- [x] Los días seleccionables anuncian el nombre completo del día y se pueden alternar con teclado (Space), manteniendo `aria-pressed`; se valida en Playwright desktop/móvil.
- [x] Playwright real con Chrome y servicios/SQLite aislados ejecutó 46 escenarios de calendario en escritorio y móvil; otra ejecución añadió anchos de 320 px y horizontal (812×375), 2/2 pasaron. No se usan datos personales.
- [ ] Falta auditar contraste, foco, objetivos táctiles y todos los breakpoints/orientaciones no incluidos en las capturas.
- [x] Cada archivo de lógica/componente de calendario afectado alcanza ≥70 % de statements, branches, functions y lines en la medición completa: `calendar.component.ts` **87,35/80,26/80,22/89,67**; `calendar-timeline.component.ts` **97,81/84,21/97,05/98,27**; `calendar-replan.component.ts` **81,15/71,21/76,36/83,33**; las vistas de agenda, evento, eventos del hogar, mini-mes, mes y año, además de `calendar-view.util.ts` y `calendar.util.ts`, **100 %** en las cuatro métricas. Valores del informe de la suite frontend completa del 2026-10-06; el corte filtrado no se considera gate global ni se cambió ningún umbral.

### Evidencia ejecutada y límites (2026-10-04)

- `pnpm run typecheck:e2e`: PASS.
- `pnpm run check:ui`: PASS, 193 ficheros / 20 reglas.
- `pnpm --filter @hogaria/web exec ng test --no-watch --include=src/app/core/calendar-grid.spec.ts --include=src/app/features/calendar/calendar-timeline.component.spec.ts --include=src/app/features/calendar/calendar-view.util.spec.ts --include=src/app/features/calendar/calendar.util.spec.ts --include=src/app/features/calendar/calendar.component.spec.ts --browsers=ChromeHeadless`: 35/35 PASS.
- `pnpm --filter @hogaria/web exec ng test --no-watch --include=src/app/features/calendar/calendar.component.spec.ts --browsers=ChromeHeadless`: 4/4 PASS; incluye prueba de restauración reactiva de vista/ancla desde los query params.
- `pnpm run typecheck:e2e`: PASS. Se corrigieron dos callbacks de `requestAnimationFrame` incompatibles con TS y la llamada a `Document.getAnimations()` en la prueba del libro.
- `node scripts/run-isolated-playwright.mjs tests/e2e/calendar-google-like-ui.spec.ts --project=chromium --project=mobile-chrome`: 12/12 PASS con Chrome real, SQLite temporal; incluye saltos de fecha en las seis vistas, capas con reload, mini-agenda y Atrás/Adelante.
- `node scripts/run-isolated-playwright.mjs tests/e2e/calendar-google-like-ui.spec.ts --project=chromium --project=mobile-chrome --grep "los días y meses de las rejillas"`: 2/2 PASS con Chrome instalado y SQLite temporal. Verifica día desde Mes, mes y día desde Año, sincronización URL/selector/mini-calendario y persistencia tras recarga; datos sintéticos.
- `pnpm test:e2e -- tests/e2e/calendar.spec.ts tests/e2e/calendar-google-like-ui.spec.ts --project=chromium --project=mobile-chrome`: 46/46 PASS con Chrome real, DB aislada y fixtures sintéticas.
- `pnpm test:e2e -- tests/e2e/calendar-google-like-ui.spec.ts --project=chromium --project=mobile-chrome --grep 'ancho mínimo ni en horizontal'`: 2/2 PASS (320 px y 812×375); mismo estado de la página sin overflow horizontal.
- `pnpm --filter @hogaria/server exec vitest run src/routes/calendar.routes.spec.ts src/config/database.spec.ts src/utils/calendar-recurrence.spec.ts`: 66 tests PASS (validación previa a esta actualización de la evidencia).
- Una primera ejecución de E2E falló en el caso «No se repite» porque el menú abierto interceptaba el botón Guardar. Se ajustó el propio test para elegir/cerrar la opción predeterminada antes de guardar; el caso pasó en escritorio y móvil y la ejecución completa siguiente pasó 46/46.
- El filtro de cobertura Angular se ejecutó pero el gate global existente (80 %) falló por el conjunto intencionalmente filtrado; no representa una ejecución completa de cobertura ni satisface el 70 % exigido por archivo.

**Estado:** implementación funcional parcial, con vistas, modal, selector, recurrencia y validación Chrome desktop/móvil entregados. La unidad sigue abierta por los checks `[ ]` de cobertura por archivo, auditoría global de accesibilidad/contraste/breakpoints, re-edición completa y cancelación/invitados/borrado. La sincronización al escoger días/meses en las rejillas de Mes/Año queda validada por el E2E añadido. Las capturas inspiran la UI de HogarIA; no se afirma paridad píxel a píxel ni se simulan funciones externas de Google.

**Revalidación incremental (2026-10-06):** E2E aislado `calendar.spec.ts` «la serie semanal personalizada conserva varios días y fin al editar/cancelar» pasa **2/2** (desktop/móvil), verificando ocurrencias y una sola identidad, reapertura, cancelación del borrador y guardado de un cambio ordinario. `calendar-google-like-ui.spec.ts` «las vistas, el selector de repetición y los editores…» pasa **2/2** tras comprobar los siete nombres accesibles. Capturas comparables e inspeccionadas: `.e2e-screenshots/2026-10-06-calendar-aria/calendar-google-like/{chromium,mobile-chrome}-custom-repeat.png`. `pnpm run typecheck:e2e` pasa. Se corrigió que los botones solo anunciaran abreviaturas (`MAR/JUE`): la vista visual sigue usando letras estrechas, el nombre accesible ahora es completo; el test rojo mostró la diferencia antes del cambio. En ese punto, además del resto de accesibilidad, seguían pendientes las pruebas de edición integral, invitados y borrado; la evidencia siguiente las cierra.

**Cierre de la matriz del editor (2026-10-06):** el E2E nuevo `calendar.spec.ts` «el editor valida, conserva todos los campos, descarta cancelaciones y pide confirmar el borrado» pasa **2/2** en Chrome de escritorio/móvil con app y SQLite aislados: botón deshabilitado sin título, foco dentro/restaurado y Escape, fecha/horas/tipo/color/sitio/notas round-trip tras guardar y recargar, cancelar sin emitir PATCH, y borrado solo tras confirmación explícita (cancelar la confirmación conserva el evento). El E2E de invitaciones `calendar.spec.ts` «se marca a otra persona…» pasa también **2/2**, y `calendar-checkbox.spec.ts` pasa **3/3** en los proyectos/anchos aplicables (desktop 1440, móvil 393 y 320): nombre accesible, teclado Space/Enter y objetivo ≥44×44. `calendar.component.spec.ts` verifica adicionalmente ausencia de escritura con título o fecha inválidos. Esto cierra únicamente la matriz funcional del editor; la auditoría global de contraste, foco, dimensiones y breakpoints sigue abierta.

**Plan TDD:** primero reglas puras de recurrencia y sus pruebas; luego persistencia/expansión API; después las reglas puras de rangos/URL de las seis vistas; finalmente el editor, el contenedor visual y Playwright. Antes de cada unidad, revalidar el contrato y los cambios sin commit existentes en los archivos de calendario. Los artefactos de prueba usarán servidor y SQLite temporales, seed sintética y cleanup propio; nunca la base de uso normal.

**Estado:** implementación funcional parcial con pruebas focales en desktop/móvil; quedan abiertos los
checks de navegación del mini-calendario, accesibilidad/teclado, cobertura por archivo y revalidación
completa del alcance. La nueva unidad del libro se especifica antes de su implementación.

### QA-UI.ACTION-GEOMETRY.1 — botones equivalentes, mismo tamaño

- [x] Las variantes de `app-button` comparten la altura estándar **44 px**, padding y tipografía; el
      énfasis se expresa con color/estado, no con `sm/md/lg` de distintas dimensiones. El calendario usa
      los mismos tokens y sus acciones de evento ocupan tracks iguales acotados a 96 px.
- [x] Una guarda automatizada detecta cambios al token de alto, dimensiones en variantes, desaparición
      de familias base o tracks desiguales; forma parte de `test:config` y `check:ui`.
- [x] Playwright mide las cuatro acciones del modal (ancho igual, alto 44 px, texto íntegro, ancho ≤112
      px) a 1440 px y 320 px. Ejecución Chrome instalada, DB aislada y datos sintéticos: 2/2; capturas
      desktop/móvil inspeccionadas en `.e2e-screenshots/qa-button-geometry/`.
- [ ] Esto no sustituye la matriz geométrica de todas las familias/rutas/breakpoints que exige
      `AGENTS.md`; la auditoría visual global sigue abierta.

**Evidencia (2026-10-06):** `pnpm run test:config` pasa **8/8**; `pnpm run check:ui` pasa (**204
ficheros, 21 reglas**). `pnpm run test:e2e -- tests/e2e/calendar.spec.ts --grep="geometría uniforme"
--project=chromium --project=mobile-chrome` pasa **2/2** usando `E2E_CHROME_BIN` apuntando al Brave ya
instalado y runner/SQLite temporales. No se descargó navegador ni se accedió a datos normales.

### QA-CALENDAR.USER-REPORTED-FIXES.1 · medianoche, repetición y tema HogarIA

**Hallazgo revalidado (2026-10-04):** el ajuste vertical común de etiquetas (`translateY(-5px)`) también
movía fuera del borde superior a `00:00` cuando un rango futuro comienza en medianoche; la primera
etiqueta queda sin ese desplazamiento. El auto-scroll a las 02:08 de hoy es deliberado (muestra el entorno
de la hora actual), por lo que `00:00` no debe exigirse simultáneamente visible en esa condición: se
verifica completo al abrir un día/semana que no contiene hoy. La serie semanal se verifica en API y UI en
su siguiente semana, sin crear filas duplicadas. El editor de eventos usa superficies y CTA del tema
HogarIA, no las superficies azules de la referencia; la prueba captura el estado activo tras esperar las
animaciones.

- [x] Etiqueta `00:00` completa en el inicio de Día/Semana futura y visible bajo la cabecera fija, en
      escritorio y móvil. Mantener la prueba separada de la hora actual a las 02:08.
- [x] Crear una serie diaria y comprobar el día siguiente/anterior; crear una semanal con hora y navegar
      a la semana siguiente: API devuelve la ocurrencia en la fecha debida y la UI la renderiza en su
      columna, conservando una sola serie.
- [x] El modal usa el fondo `--bg-secondary` y la acción `--primary` de HogarIA. Validación real de
      estado activo y capturas sintéticas estables en ambas resoluciones.

**Evidencia (2026-10-04):** `node scripts/run-isolated-playwright.mjs tests/e2e/calendar-early-hours.spec.ts
--project=chromium` y `--project=mobile-chrome`: 1/1 cada uno; fija el reloj a 02:08 de Europe/Madrid,
comprueba la línea actual y completa la etiqueta a medianoche en el día siguiente. El E2E de `calendar.spec.ts`
para «una serie diaria se repite también el día siguiente», «una serie semanal también se carga al abrir
la semana siguiente» y «el editor de eventos usa superficies, título y color de HogarIA» pasó en Chrome
escritorio y móvil con DB/servidor aislados (daily: 2/2; semanal + modal: 4/4). Capturas revisadas:
`.e2e-screenshots/calendar-week-midnight/{chromium,mobile-chrome}-recurring-next-week.png`
y `.e2e-screenshots/calendar-app-modal/{chromium,mobile-chrome}-event-modal.png`.

**Límite:** esto cierra solo las tres regresiones reportadas; no completa los checks de accesibilidad,
cobertura por archivo, navegación del mini-calendario ni la matriz global del calendario de §12at.

**Mantenimiento verificado:** los estilos del calendario están ahora en `styles.scss` bajo el scope
`app-calendar`; el foco visible de controles conserva una regla local compartida para cumplir la guarda
de UI. `ng build --output-path <temp>` compila (se elimina el error de presupuesto de 24.09 KB del
componente; quedan advertencias de presupuesto inicial y de otros componentes). `node scripts/check-ui.mjs`
termina sin incidencias. Tras mover estilos, el E2E de repetición semanal/medianoche y tema HogarIA pasó
4/4 en escritorio y móvil.

### QA-CALENDAR.MULTI-GOALS-UNIFORMITY.1 — objetivos múltiples sin agrandar la barra

- [x] La pastilla muestra una cuenta compacta en lugar de concatenar nombres que la ensanchan; todos los
      objetivos completos siguen en `aria-label` y `title`.
- [x] TDD cubre lista guardada plural, objetivo heredado/sin guardar, nombre accesible, número visible y
      geometría uniforme frente a controles hermanos, también en móvil.
- [x] Playwright real con SQLite temporal comprueba objetivos guardados en la semana, cuenta `3`, texto
      accesible completo, alto común de 44 px y ancho acotado; capturas sintéticas de PC/móvil inspeccionadas.

**Evidencia (2026-10-06):** la regresión visual mostraba antes una pastilla con todos los objetivos unidos y
la UI podía ocultar los objetivos guardados al priorizar el primero seleccionado. `calendar.component.spec.ts`
y `calendar-view-components.spec.ts` pasan con el calendario completo. E2E aislado de
`calendar.spec.ts`, prueba «los objetivos se guardan sobre la semana que se está viendo», pasa **2/2**
(Chrome escritorio y móvil). Capturas revisadas: `.e2e-screenshots/2026-10-06-calendar-multiple-goals/{chromium,mobile-chrome}.png`.
`check:ui`, `typecheck:e2e` y build de producción pasan; warnings existentes de presupuesto/imports no se
han ocultado ni cambiado. La matriz visual global de todas las familias/rutas continúa abierta.

## 12au — Libro de recetas y catálogo tradicional por país

**Fuente revalidada (2026-10-04):** la pantalla `/recipes` ya lista recetas y dispone de filtros rápidos,
pero el control «Filtros» aún no tiene flujo funcional; API/modelo admiten `cuisine` y los tipos de
comida existentes (`breakfast`, `brunch`, `lunch`, `snack`, `dinner`, `dessert`), pero no separan el
país de origen. Las tarjetas no muestran de forma consistente una portada/imágen de la receta. La
experiencia pedida se suma al catálogo actual como apartado identificable «Libro de recetas», no como
otra copia de las mismas filas ni una librería desconectada.

**Contrato:**

- Incorporar una vista de libro accesible desde Recetas, con campo de búsqueda y filtros combinables
  por país de origen, tipo de comida y los filtros que ya soporta el catálogo. La búsqueda cubre nombre,
  ingredientes y etiquetas; filtros, resultados vacíos, limpieza de filtros, recarga, URL/paginación y
  permisos mantienen un estado coherente. País (`countryCode`, ISO 3166-1 alpha-2) es un atributo
  independiente de `cuisine`; no inferir país a partir de una cocina ambigua ni del idioma.
- Mostrar recetas en tarjetas editoriales con portada (imagen de la receta, o fallback local accesible),
  título, país, tipo de comida y metadatos útiles; el detalle conserva portada, origen y atribución. No
  presentar imágenes externas como propias: búsqueda de media/atribución/validación de URL se rige por
  §12aq y su proveedor; si no hay una fuente autorizada se muestra un fallback, nunca una URL inventada.
- Sembrar un catálogo inicial pequeño pero útil con al menos seis recetas tradicionales de España y seis
  de El Salvador, cubriendo más de un tipo de comida. Investigar/validar el origen de cada plato con
  fuentes culinarias fiables, redactar ingredientes y pasos propios (no copiar artículos/recetas), y
  guardar fuente/atribución del dato histórico e imagen/licencia cuando corresponda. Cada receta semilla
  cumple el esquema actual, incluyendo instrucciones `basic`, `intermediate` y `expert` en una sola
  receta; ingredientes, cantidades y metadatos se persisten una vez, no se duplican por nivel.
- Seeds idempotentes, con identidad de catálogo estable y reversibles sin sobrescribir recetas de usuario.
  El contenido editorial incorporado es de solo lectura. Favoritos, notas, nivel elegido y recetas
  generadas siguen siendo propios del usuario/hogar activo; no mutar un favorito global ni exponer datos
  de otro hogar al aplicar §12ap. Las recetas semilla se pueden descubrir desde cualquier hogar sin
  compartir accidentalmente listas privadas.
- El país y los filtros tienen etiquetas traducidas, controles accesibles por teclado/lector de pantalla,
  diseño uniforme y probado en desktop/móvil; portadas tienen texto alternativo significativo cuando
  aportan contenido, y alt vacío cuando son decorativas.

### QA-RECIPES.BOOK.CATALOG.1

- [x] Contrato de país separado de cocina, tipos de comida combinables y migración/seed idempotente
      probados con DB temporal y sin reemplazar recetas existentes.
- [x] Búsqueda y filtros combinados (país ES/SV, tipo de comida y cocina), URL/recarga/paginación,
      vacíos, limpieza y resultados cubiertos por API y E2E sintético de escritorio/móvil.
- [x] API cubre catálogo sin recetas privadas, estado de favoritos/notas por usuario y favoritos sin
      mutar la fila global del catálogo.
- [x] Probar que el favorito de una receta semilla pertenece a la cuenta y se mantiene al cambiar
      de hogar activo; las recetas y preferencias privadas del hogar siguen aisladas.
- [x] Libro muestra las semillas españolas y salvadoreñas con portada/atribución o fallback; ninguna
      receta de usuario se pierde ni sus favoritos/notas se escriben en el catálogo global.
- [x] Al menos 6 recetas por país, verificadas con fuentes institucionales, texto propio, país/tipo
      correctos y las tres instrucciones detalladas con ingredientes almacenados una sola vez. Se revisó
      Spain.info para los seis platos españoles, El Salvador Travel para cinco platos salvadoreños y el
      material del Ministerio de Educación para las riguas; se reemplazó el PDF ministerial anterior
      (404) por el enlace oficial vigente.
- [x] Playwright real, aislado y sintético demuestra búsqueda/filtros, paginación, resultados vacíos,
      URL/recarga/limpieza, abrir/cerrar detalle, fallback de portada, atribución, teclado y layout sin
      overflow en desktop, móvil mínimo y móvil horizontal.
- [x] Una portada con imagen servida desde fixture SVG local se carga en tarjeta y detalle; el E2E
      comprueba `naturalWidth`, texto alternativo y atribución, sin llamar a un proveedor de imágenes.
- [x] Favorito de la misma cuenta visible tras alternar dos hogares en E2E real; la API conserva la
      separación usuario/catálogo y el cambio de hogar no afecta el estado personal.
- [x] Ejecutados tests API, UI y E2E reales; typecheck E2E, build del servidor y `check-ui` pasan.
- [x] Alcanzar ≥70 % statement/branch/function/line coverage por archivo y correr build/gates
      completos del cliente; registrar comandos, resultados y límites sin rebajar umbrales.

**Hallazgo revalidado durante la implementación:** cuando el usuario escribía una búsqueda y aplicaba
país/tipo de comida de inmediato, podían terminar llegando primero las respuestas nuevas y después la
respuesta anterior (solo búsqueda), reemplazando las tarjetas filtradas. `RecipeService` ya descarta las
respuestas de lista obsoletas; una prueba unitaria reproduce el orden inverso y comprueba resultados,
total y estado de carga. El E2E espera que la transición visual finalice antes de capturar, para que la
evidencia no muestre simultáneamente el fotograma anterior.

**Cierre de coverage y gates (2026-10-06):** la suite Angular completa pasa **1.144/1.144** y su
coverage global mantiene el gate existente: **88,82/80,40/88,30/90,18 % S/B/F/L**. Los archivos del
flujo quedan sobre 70 % en cada métrica: `RecipesComponent` **94,68/88,99/92,98/95,33 %**,
`recipe.service.ts` **90/78,57/92,30/91,45 %**, `recipes.routes.ts`
**87,69/77,50/93,93/89,07 %**, `recipe-images.routes.ts` **100 %**, y las utilidades de detalle,
edición y wizard con sus componentes superan 70 %; las nuevas suites de `RecipesComponent` y edición
cubren el filtro/URL, favoritos, permisos, niveles, participantes y guardado sin duplicados. La suite
completa del servidor en DB temporal pasa con **91,56/82,83/95,59/94,13 % S/B/F/L** agregado y
`recipe-book-seed.ts`/`recipe-images.routes.ts` con 100 % por archivo. Esta revalidación supersede el
gate de coverage que permanecía abierto en la evidencia histórica; build cliente/servidor,
`typecheck:e2e`, `check:ui` (**207 ficheros/21 reglas**), `test:config` (**9/9**) y `git diff --check`
pasan. No se rebajaron umbrales; artifacts de cobertura y DB temporales.

**Evidencia actualizada (2026-10-05):** `pnpm --filter @hogaria/server exec vitest run
src/routes/recipes.routes.spec.ts src/utils/recipe-book-seed.spec.ts --reporter=dot`: **18/18** con
SQLite `:memory:`. TDD del origen de las riguas: primero falla al detectar el PDF anterior (404); tras
actualizar la atribución al PDF oficial vigente, la suite completa pasa. El E2E de
`recipe-book.spec.ts` tiene cuatro escenarios verificados en Chromium y Chrome móvil: búsqueda/filtros
combinados, URL/recarga/limpieza, paginación/vacío, teclado/foco y anchos 320 px y 812×375; **8/8
ejecuciones de escenario** contando corridas focales aisladas, con servidor/SQLite temporales y datos
sintéticos. Las capturas comparables se guardan e inspeccionaron en
`.e2e-screenshots/recipe-book/{chromium,mobile-chrome}-filtered-book.png`. Además, el servicio Angular
`recipe.service.spec.ts` pasa **14/14**; `pnpm run typecheck:e2e`, `pnpm run check:ui` (193 archivos,
20 reglas), `pnpm --filter @hogaria/server run build` y `git diff --check` pasan. Coverage por archivo
y build completo del cliente siguen abiertos; no se bajó el gate.

**Revisión editorial (2026-10-05):** [Spain.info](https://www.spain.info/es/descubrir-espana/platos-gastronomia-tradicional-espana/)
respalda la tradición de gazpacho, tortilla, cocido, pulpo y tarta de Santiago, y
[la ficha de la paella](https://www.spain.info/es/top/conoce-el-origen-de-algunos-platos-espanoles-tipicos/)
confirma su origen valenciano. [El Salvador Travel](https://elsalvador.travel/preforocimap/gastronomia-salvadorena/)
documenta pupusas, tamales, empanadas, yuca y pastelitos; el
[libro oficial de Estudios Sociales del Ministerio de Educación](https://www.mined.gob.sv/descarga/programas-estudio/libro_4_sociales_0_.pdf)
menciona preparar riguas durante la cosecha del maíz. El buscador institucional confirmó el pasaje;
la descarga del PDF (17 MB) excede el límite de lectura directa del navegador.

**Estado:** catálogo, filtros, fuentes iniciales, fixture local de portada y E2E base —incluido el
favorito personal al cambiar de hogar— completados; la unidad permanece abierta por cobertura por
archivo (≥70 % en las cuatro métricas), gates completos y revalidación de la especificación global.

**Evidencia de portada (2026-10-06):** el escenario `sirve la portada del libro desde un fixture local`
de `recipe-book.spec.ts` verifica en escritorio y móvil la imagen local para tarjeta y ficha completa,
su `alt`, carga real del recurso y atribución conservada. No contacta Internet ni modifica la semilla.

**Evidencia adicional (2026-10-06):** `multi-household-switcher.spec.ts` pasa **2/2** en Chrome
escritorio y móvil con DB aislada y dos hogares sintéticos: marcar favorita la tortilla en el hogar dos,
cambiar al hogar uno y confirmar que el mismo usuario mantiene el favorito. Capturas comparables en
`.e2e-screenshots/recipe-favorites-house-switch/`. La suite completa del servidor ejecutada con
`DATABASE_PATH=:memory:` pasa **1.138 tests y 1 omitido**; cobertura agregada **90,63 % statements /
82,25 % ramas / 94,72 % funciones / 93,42 % líneas**. La cobertura individual de `pantry.routes.ts`
continúa pendiente y no se rebajó ningún umbral. En el cliente, las **1.039/1.039** pruebas pasan,
pero el gate global de coverage aún falla: **78,43 / 66,15 / 77,37 / 79,95 %** respectivamente ante
umbrales existentes de 80 %; no se ha bajado el gate. El build de producción del cliente pasa con
warnings de presupuesto ya existentes. Se mantienen abiertos cobertura focal exigida, gates completos
y auditoría global de la web.

### QA-RECIPE.BOOK.FULL-DETAIL.1

**Motivo:** la receta de IA ya cumple `QA-RECIPE.FULL-DETAIL-VIEW.1`, pero el catálogo semillado solo
guarda uno o dos pasos breves y omite información que el detalle amplio sabe presentar. El libro debe
ofrecer una experiencia de cocina igualmente completa, sin inventar fuentes o prometer precisión
nutricional.

- [x] Cada receta semillada aporta kcal aproximadas por ración y estimaciones de macronutrientes,
      separación/preparación/cocción/reposo, electrodomésticos permitidos y utensilios.
- [x] Los tres niveles contienen al menos cuatro pasos completos, cronológicos y coherentes: básico para
      cocinar con confianza, intermedio con señales de punto y experto con técnica/temperatura cuando sea
      útil. El primer paso indica qué lavar o dice explícitamente que no hace falta lavar nada.
- [x] La vista muestra tareas seguras en paralelo, variaciones concretas de sabor/textura/presentación y
      consejos prudentes de conservación (recipiente, frío, duración, congelación y recalentado cuando
      corresponda). Si no hay una tarea paralela segura, el dato puede ser una lista vacía.
- [x] El detalle adapta raciones en pantalla sin mutar los datos compartidos ni duplicar ingredientes;
      cambiar nivel solo cambia instrucciones. Ilustraciones locales esquemáticas acompañan los pasos
      cuando no hay un medio real validado, sin URLs ni atribuciones ficticias.
- [x] TDD verifica el contrato de las 12 semillas, datos persistidos/servidos y ficha E2E aislada en
      escritorio/móvil con cambio de nivel/raciones, orden de lectura, cero llamadas IA y ningún overflow.
      Se refresca contenido editorial antiguo sin cambiar IDs, portadas existentes ni favoritos/notas
      personales; la siembra continúa siendo idempotente y no sobrescribe filas de usuario.

**Evidencia (2026-10-05):** `recipe-book-seed.spec.ts` comprueba las 12 fichas persistidas (8/8), los tres niveles,
el primer paso de lavado/preparación en cada nivel, tiempos, estimaciones, electrodomésticos permitidos,
tareas paralelas, conservación y semillas idempotentes. Un test TDD reprodujo primero que las filas antiguas
no se actualizaban; ahora el seed refresca solo columnas editoriales de filas `catalog`, mantiene las portadas
existentes y preserva rating, historial, favoritos y notas personales. Suite de servidor aislada con `DATABASE_PATH=:memory:`
y cobertura en un directorio temporal único: **1.058/1.058**; coverage **92,41 % statements / 84,05 % ramas /
95,37 % funciones / 94,49 % líneas** (seed `recipe-book-seed.ts`: 100 % en las cuatro métricas; ningún
directorio previo de coverage fue limpiado). E2E Playwright aislado
con SQLite temporal y proveedor sintético, seleccionando Chrome instalado en escritorio y viewport móvil:
`recipe-book.spec.ts` **10/10**; el detalle confirma instrucciones, escalado solo en pantalla, selector de nivel,
ilustraciones SVG accesibles, cero llamadas IA y ausencia de overflow. Capturas comparables, sintéticas e
inspeccionadas: `.e2e-screenshots/recipe-book-full-detail/{chromium,mobile-chrome}-tortilla-detail-{top,steps}.png`.
La primera invocación sin `E2E_CHROME_BIN` no encontró los navegadores descargados de Playwright; la pasada verde
usó `C:\Program Files\Google\Chrome\Application\chrome.exe` y no ejecutó Mobile Safari. Las ilustraciones
son esquemas SVG locales, no fotos ni imágenes generadas por un proveedor; la búsqueda multimedia continúa
pendiente bajo `QA-RECIPE.DETAIL-LEVELS-AND-MEDIA.1`.

### QA-AI.USER-LOCALE.1 — textos de IA en el idioma activo de la aplicación

**Fuente revalidada (2026-10-06):** la interfaz admite `es`, `en` y `auto`; `auto` resuelve a español o inglés
según el idioma del navegador. La preferencia actual vive en el cliente y los prompts de receta fijan español
de España, mientras que recomendaciones, planificación semanal y sustituciones no fijan de forma uniforme el
idioma de su contenido. La salida estructurada mezcla texto generado con datos que deben preservar su forma.

- [x] Cada petición autenticada comunica el idioma ya resuelto por la aplicación (`es` o `en`) al servidor; no
      inferirlo del hogar, proveedor, servidor ni de la configuración de IA compartida.
- [x] Todo campo natural redactado por IA para mostrar a la persona solicitante se genera en ese idioma: receta
      (incluidas las tres instrucciones), recetas recomendadas, nombres/descripciones de sustitución, plan semanal,
      lista de compra generada y avisos de lectura de tickets/fotos. En `es`, exigir español de España.
- [x] No traducir claves JSON, enums, identificadores, claves/nombres de catálogo ni texto copiado/transcrito de un
      ticket/foto; los avisos sí son prosa generada y se localizan. Las transformaciones que devuelven únicamente
      valores numéricos/copiados no deben añadir prosa localizada innecesaria.
- [x] Los tickets asíncronos conservan el idioma elegido al subirlos también al reintentar y después de reiniciar
      el worker; el idioma queda como metadato no sensible, nunca se almacenan prompts ni contenido de IA.
- [x] TDD cubre español, inglés, `auto` resuelto a ambos idiomas, preferencia ausente/inválida, endpoints síncronos,
      tickets en cola y repetición; una prueba garantiza que los datos fieles y claves de catálogo no se traducen.

**Evidencia (2026-10-06):** prueba TDD inicial roja reprodujo la ausencia del helper y de idioma en los prompts
de receta/ticket/foto; tras el cambio, la suite aislada del servidor pasa **58 archivos, 1.195 tests y 1 omitido**.
Cobertura total: **91,6 % statements / 82,95 % ramas / 95,63 % funciones / 94,15 % líneas**; el helper nuevo
`ai-output-language.ts` supera el umbral por archivo (**100 / 92,3 / 100 / 100 %**). La prueba focal posterior
`ai-queue.spec.ts` pasa **25/25**, incluyendo reintento y reinicio conservando el idioma. El TypeScript del servidor
compila con `tsc --noEmit`; los dos specs del interceptor Angular pasan **12/12** en Chrome Headless y verifican
cabecera persistente en la petición original y en el reintento. Los contratos cubren idioma de receta, sustitución,
recomendación, plan semanal, análisis de compra y avisos de ticket/foto; claves y datos transcritos se preservan.
El idioma de UI es resuelto antes de enviarse (`es`/`en`); para clientes antiguos `auto` usa `Accept-Language` y
preferencia guardada, con español como fallback. Tickets guardan solo el locale en metadatos para reintentos.
ESLint no pudo arrancar: el repositorio no proporciona la configuración `eslint.config.js` que exige ESLint 9.
No se hizo una llamada de humo a un proveedor externo en esta unidad; estas pruebas verifican el contrato del
prompt y el transporte, no que un modelo externo obedezca siempre.
