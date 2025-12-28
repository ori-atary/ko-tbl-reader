AI Knowledge Layer
==================

This folder stores an additive, AI-facing knowledge layer that sits on top of
the frozen Knight Online TBL parser. Nothing inside the original parsing,
encryption, or schema generation flow has been changed—this directory is the
only new surface area.

What gets generated
-------------------

* `tables/*.schema.json` – one semantic JSON file per client `.tbl`. These
  files wrap the existing structural schema (column types/counts) with
  AI-friendly metadata such as inferred roles, domain tags, deductions,
  examples, and guidance.
* `index.json` – a lightweight discovery index with per-table summaries so an
  AI assistant can quickly route to the right table knowledge file.
* `README.md` – this document.

Generation workflow
-------------------

Run the generator with:

```
npm run gen:ai-knowledge
```

Key behaviors:

* The script defaults to `./testdata` but automatically falls back to `./test`
  (read-only) if the expected directory is missing. Override the source path
  with `npm run gen:ai-knowledge -- --source ./your/path`.
* Output lands in `./ai_knowledge`. The `tables/` directory is rebuilt on each
  run so re-generation is idempotent.
* Parsing uses the existing `decryption`, `parser`, and schema detector
  modules. If a table cannot be decoded the generator still emits a placeholder
  file with very low confidence so downstream tools never crash.
* Optional flags:
  * `--korean` decodes EUC-KR strings when needed.
  * `--limit <n>` processes only the first `n` tables (handy for debugging).
  * `--dry-run` prints progress without writing files.

Safety guarantees
-----------------

* No legacy scripts, binaries, or schema outputs are modified.
* Knowledge files are purely additive and live under `./ai_knowledge`.
* Existing CSV/TBL conversion flows, binary parsing, and docs remain untouched.

Usage notes
-----------

1. Regenerate after dropping new client `.tbl` files to keep the AI layer in
   sync.
2. Check `index.json` for a high-level overview or jump directly to a specific
   `tables/<Name>.schema.json`.
3. Confidence scores reflect how certain the heuristics were (name/domain
   matches yield higher numbers; placeholder files stay near 0.1).
4. Sample rows and guidance are intentionally concise so large models can use
   them as semantic memory without re-reading the raw `.tbl` content.
