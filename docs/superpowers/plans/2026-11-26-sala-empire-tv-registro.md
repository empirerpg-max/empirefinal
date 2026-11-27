# Sala da Empire TV — registro da execução

Plano: `docs/superpowers/plans/2026-11-26-sala-empire-tv.md`. Execução por subagentes com revisão por tarefa e revisão final (2026-11-26).

## Decisões tomadas durante a execução (com o custo se estiverem erradas)

- Ruling: run in current checkout, no extra worktree — user's designated branch — cost if wrong: none (branch-only commits).
- Ruling: accepted — UI-only in a file with no component tests; reviewers check against spec — cost: UI regressions caught later by final review/device test |
- Ruling: calcularPresenca window in whole minutes (floor inicio; duracaoMin = minutes floor(inicio)..minute of fim-1) instead of brief's ceil((fim-inicio)/60000) — real starts are mid-minute; otherwise full attendance < 100% — cost if wrong: % off by ≤1 minute.
- Ruling: A4 must compute the D1 window with janelaDoGrupo(original group, eventosReais, agora) — single source for GET and crediting — so edge cases cannot diverge — cost if wrong: % shown ≠ % credited in rare edge cases.
- Ruling: re-dispatch on sonnet (opus quota exhausted) with a stricter review — cost if wrong: extra fix rounds.
- Ruling: D1 groups also read Presenca_TV; players absent from D1 credited at time-only planilha % (chat excluded); summary col L marks origin — fairness during client rollout — cost if wrong: one extra sheet read per D1 group (already done today).
- Ruling: processing clamps window end to scheduled endTs when real start exists, real end missing and schedule passed (GET unchanged) — avoids penalizing viewers when transmissao.py misses "fim" — cost if wrong: % computed over schedule instead of real length in rare cases.
- Ruling: add Task B5 (no auto-reload while in the TV room; chat DOM cap ~150 msgs; unload off-screen GIF videos) — user reported periodic reloads; causes found in staleChunk.ts/pwa.ts and memory — cost if wrong: one extra UI task.
- Ruling: admin 'fim' keeps the 5-min buffer (credit by cron within ~15 min) — late client presence batches (every 5 min) must arrive before crediting — cost if wrong: admin waits a few minutes for REGISTRO.
- Ruling: B5 adds room in URL (/tv?sala=) so any reload returns to the same room — user report: gray/black screen then back at TV menu — cost if wrong: small UI change.
- Ruling: C3 changed per user — polls live in the Enquetes tab; chat shows one-line notices; collapsible pinned bar — cost: none.
- Ruling: B4 adds desktop/tablet side chat column (≥760px) — user report — cost: none.
- Ruling: UI tasks B2–B5/C3: Playwright on 'vite dev' is best-effort (needs Supabase/sheets data); required evidence = tsc + vite build + a component-level check where possible — cost if wrong: UI bugs found later in device test.
- Ruling: never prune chat while reader is not at bottom; prune to newest 150 only at bottom — reconciles B2 with B5 memory cap — cost if wrong: more DOM while a reader browses history.
- Ruling: B5 adds a visible '↑ Ver mensagens anteriores' button at top (plus auto-load) — user request; also covers short lists and load failures — cost: none.
- Ruling: B4 phone landscape = chat beside video (62/38), not overlay — overlay would cover Kick controls (user's sound concern) — cost: smaller video in landscape.
- Ruling: B5 defers auto-reload only while the room is open full-screen (not mini player elsewhere) — a broken page is worse than losing the mini player; pending marks persist — cost: mini player may be lost on deploy.
- Ruling: entering a room PUSHES /tv?sala=X so phone back returns to the TV menu (CLAUDE.md back rule); reload auto-open keeps entry — cost: one extra history entry per room entry.
- Ruling: tv_enquete PRIMARY KEY (programa_id, id) WITHOUT ROWID; all queries filter by programa_id; votar/encerrar take programaId — avoids full-table scans on every 15 s poll under the 5M rows/day free limit — cost: signature change vs brief.
- Ruling: C2 must cache the per-programa poll aggregate in isolate memory for 10 s (invalidated on create/vote/close in the same isolate) and fetch meuVoto with PK lookups only — reading all vote rows per 15 s poll × viewers would use ~2M rows/event of the 5M/day free D1 reads — cost: results up to 10 s stale for other viewers.
- Ruling (user-approved): replace 10 s cache with running counters on tv_enquete (contagem JSON + total), atomic json_set update in a batch with the vote upsert; GET reads one row per poll; client may poll every 5 s — cost: schema change + migration guard.
- Ruling: C3 refresh interval 5 s (counters make reads cheap) instead of plan's 15 s.
- Ruling: client sends encerra_em_min ∈ {2,5,10,15}, server computes time. Fix round 1 dispatched.
- Ruling: I1 — people with both D1 minutes and old-client sheet seconds in a D1 group get max(D1 %, time-only sheet %) — honors "broadcasts started before the switch keep the old path" — cost if wrong: none (only raises credit to what the old path would give).
- Ruling: I2 — admin Início after a recorded Término → 409 (and confirm on the button); GET /api/tv/evento-admin returns the group's current inicioTs/fimTs so the admin bar shows state after reload — cost: one small KV read.
- Ruling: I3 — long-press menu opens once (timer and native contextmenu deduplicated) — cost: none.
- Ruling: I4 — publishing a new poll closes any open poll in the same room (spec 6.19.4), posting ENQRES for it — cost: admins can't run two polls at once.
- Ruling: I5 — every poll is already secret (no voter-level data is stored for display or export), so hide the "Voto secreto" toggle and show "Votos sempre secretos" — reversible UI change; flagged to the user — cost if wrong: user wanted named results (would need a new admin export).
- Ruling: M1 — skip the expiry UPDATE on GET unless a fetched open poll is already past encerra_em; M2 — remove ALTER/backfill migration (tables are new in this deploy, CREATE has the columns); small items: exclude user_id "empire-tv" from chat counts, prefer session name and cap nome at 60 chars on presence, render ENQ/ENQRES only when sent by user_id "empire-tv".
- Ruling (user decision, supersedes I5 ruling): creator chooses 'Voto anônimo' (default on) or public; public polls show voter names on demand via GET /api/tv/enquetes/votantes (never in the 5 s refresh, refused for anonymous, hidden while soFim && aberta); CSV gets Votantes column for public polls — cost: extra reads only when someone taps 'Ver quem votou'.

## Pendências menores registradas (não bloqueiam)

- Task A1: minor (deferred): Math.min(100) cap branch unreachable now; NaN inputs (agoraMs/fimMs non-finite) yield NaN — internal callers only.
- Task A2: minor (deferred): merge duplicate early-returns in gravarMinutosPresenca; delete-count test uses >=1; D1 100 bound-param cap on lerPresencaGrupo IN list (segments are few).
- Task A3: minor (deferred): GET does readProgramas+lerEventosReais before checking D1 (Sheets quota; sheet reads cached); nome length unbounded; no test for GET fallback; edge cases (fimTs w/o inicioTs, fimTs<=inicioTs) window vs processing.
- Task A4: minor (deferred): summary rows share Presenca_TV with legacy readers (benign); GET vs processor differ on D1 error (display only); 30-day retention vs long-unprocessed groups.
- Task A5: minor (deferred): fake KV advances clock on put (test sees immediate processing); no test that other KV groups survive / 400 writes nothing; real admin check mocked; non-atomic KV RMW (pre-existing pattern). UI must not read processamento {0,0} as failure (A6).
- Task A6: minor (deferred): admin bar state lost on reload (no GET for event state); sessionStorage per tab (closed offline tab loses marks); carregar() while logged out drops stored entries; 60/30 s polling.
- Task B2: minor (deferred): 80px slack lets small upward scroll be re-pinned by media resize; not browser-tested (needs live data).
- Task B3: minor (deferred): no pointerleave; menu history entry orphaned if ChatPanel unmounts while open; second finger overwrites gesture; <lg mouse users only right-click; not browser-tested.
- Task B4: minor (deferred): rotating back to portrait with chat menu open leaves a dead back entry; landscape history fix untested in browser.
- Task B5: minor (deferred): late popstate after 400 ms fallback could briefly reopen room; pill 15 s timer starts on mount; unloaded GIF placeholder 96 px may shift content when scrolling up; GIF release untested in browser.
- Task C1: minor (deferred): votar vs encerrar check-then-write race (harmless).
- Task C2: minor (deferred): backfill race only during first deploy (tables are new — no existing polls, moot); every GET issues a cheap expiry UPDATE; closing request waits for chat+sheet notices; mis-indent tvController.ts ~1004.
- Task C3: minor (deferred): auto-close retry not gated on ativo (≤1 min); realtime ENQ/ENQRES path and 401 vote path verified by reading only; pinned bar shows newest open poll only.

## Verificado só por leitura do código (testar no aparelho)

- Menu de segurar mensagem abrindo uma vez só no Android (Chrome).
- Avisos ENQ::/ENQRES:: chegando ao vivo pelo Supabase; caminho 401 do voto.
- Liberação de memória dos GIFs em vídeo fora da tela.
- Girar o celular com menus/folhas abertos (histórico).
