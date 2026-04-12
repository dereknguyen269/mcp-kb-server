# Changelog

## [1.2.0] - 2026-04-12

### Added

- `wiki.lint` — new `lint_mode: "semantic"` that gathers KB entries, memory entries, existing links, and sources into an LLM-ready payload for deeper analysis: contradictions, stale claims, missing entity pages, and missing cross-references. Tunable via `max_kb_entries`, `max_memory_entries`, `content_preview_length`.
- `memory.get` — fetch a single memory entry by ID; useful after `memory.search` with `max_content_length` to retrieve full content.
- `memory.search` / `memory.list` — new `max_content_length` param to truncate content in results (truncated entries include `truncated: true`).
- `kb.get` — fetch a single KB document by ID.
- `kb.index` — read or atomically replace the wiki index page (`source='_index'`); the LLM's navigation entry point.
- `kb.update` — update title, content, and/or source of an existing KB document.
- `kb.delete` — delete a KB document by ID.
- `kb.search` — new `max_content_length` param for truncated results.
- `kb.init` — description updated to reference the ingest workflow in `.kiro/steering/kb-ingest.md`.
- `source.get` — fetch full content of a single ingested source by ID.
- `wiki.export` — KB index page (`source='_index'`) is now exported as `kb-index.md` and listed in the export index.
- Dashboard — KB counts and search results now exclude the `_index` entry.
- Validation — Joi schemas added for all previously unvalidated tools (`memory.get`, `kb.get`, `kb.index`, `kb.update`, `kb.delete`, `kb.init`, `source.get`); existing schemas updated to pass through new params.

### Fixed

- `wiki.lint` semantic params (`lint_mode`, `max_kb_entries`, `max_memory_entries`, `content_preview_length`) were silently stripped by Joi validation before reaching the handler — now correctly passed through.
- `memory.search`, `memory.list`, `kb.search` `max_content_length` param was silently stripped by Joi validation — now correctly passed through.
- `kb.search` and all KB listing queries now exclude `source='_index'` entries from results.

## [1.1.2] - 2025-xx-xx

Previous release.
