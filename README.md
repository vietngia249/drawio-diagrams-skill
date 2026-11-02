# drawio-diagrams

This is an unofficial project that only generates draw.io (diagrams.net) format files.

A reusable agent skill for turning source code or an assignment brief into editable diagrams. The scripts run locally with Node.js and use only built-in modules. This project is not affiliated with or endorsed by draw.io or diagrams.net.

## Features and limits

- Sequence diagrams with participants, messages, returns, and nested alt/opt/loop/par fragments.
- ERD entities and labeled relationships. The current renderer uses fixed crow's-foot markers; custom cardinalities and boolean PK/FK metadata are not interpreted. Put key markers in the attribute `key` field.
- DFD processes, data stores, external entities, and labeled flows.
- Generic cell import, rendering, structural validation, and diagram comparison.

Use case and activity diagrams do not have semantic renderers. Layout is basic and requires visual review. Validation checks XML tag balance, duplicate IDs, endpoints, and selected overlaps; it is not a full XML or UML validator. Import and comparison are best-effort helpers, not lossless round-trip guarantees. Async messages currently use the same arrow styling as sync messages.

## Requirements

Use a maintained Node.js LTS release (Node.js 22 or newer). No npm installation is needed. Open `.drawio` outputs in diagrams.net for visual review. Optional PNG/SVG export requires PowerShell and the diagrams.net desktop CLI available as `drawio` on PATH.

## Install as an agent skill

Clone this repository into your agent's skill directory using the folder name `drawio-diagrams`:

```sh
git clone https://github.com/vietngia249/drawio-diagrams-skill.git ~/.codex/skills/drawio-diagrams
```

For another agent, place the repository in its supported skills directory. The entry point is `SKILL.md` and its name is `drawio-diagrams`.

Example prompt:

> Use $drawio-diagrams to inspect this project's source and create a sequence diagram for submitting an order. Record uncertain domain details before rendering.

## Quick start

Run these commands from the repository directory:

```sh
node scripts/render_drawio.mjs examples/sequence.json -o out/sequence.drawio
node scripts/validate_drawio.mjs out/sequence.drawio
node scripts/render_drawio.mjs examples/erd.json -o out/erd.drawio
node scripts/validate_drawio.mjs out/erd.drawio
node scripts/render_drawio.mjs examples/dfd.json -o out/dfd.drawio
node scripts/validate_drawio.mjs out/dfd.drawio
```

The examples are synthetic English fixtures created for this repository. No original project samples are included.

## Workflow and input format

Use `templates/diagram-context.md` in your target project to record evidence, assumptions, and approval. See `rules/diagrams.md` and the three example JSON files for the supported input fields. Style defaults are in `scripts/style.json`.

```sh
node scripts/compare_drawio.mjs out/sequence.drawio out/sequence.drawio --blind
node scripts/import_sample.mjs out/sequence.drawio out/imported.json sequence
node scripts/render_drawio.mjs out/imported.json -o out/imported.drawio
```

Imported JSON can retain private labels and metadata. Keep it in your own project and review before sharing. Reference diagrams must remain read-only.

Optional export on Windows:

```powershell
powershell -File scripts/export.ps1 -InputFile out/sequence.drawio -OutputDir out/export -Format png
```

If `drawio` is missing, the export helper prints an installation hint and does not create an export. A successful render does not imply an export exists.

## Contributing

Keep documentation and public examples in English. Use synthetic fixtures and do not commit private context, reference diagrams, credentials, or machine-specific paths. Run `node --check` on changed `.mjs` files and render/validate the examples. Visually inspect changes affecting layout. Use Conventional Commits, for example `fix: preserve sequence message order`.

## License

MIT. See [LICENSE](LICENSE).