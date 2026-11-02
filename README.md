# drawio-diagrams

An agent skill that turns source code or an assignment brief into editable `.drawio` diagrams using local JSON renderers for sequence, ERD, and DFD diagrams. It includes synthetic examples, structural validation, and best-effort import and comparison helpers.

This is an unofficial project that only generates draw.io (diagrams.net) format files. It is not affiliated with or endorsed by draw.io or diagrams.net; optional exports use a separately installed desktop CLI.

## Support

| Diagram | Status | Current scope and limits |
| --- | --- | --- |
| Sequence | Supported | Participants, sync/return messages, and nested `alt`/`opt`/`loop`/`par` fragments. Async uses sync arrow styling; `par` is visual grouping, not a concurrency simulation. |
| ERD | Experimental | Entities, attribute labels, and named relationships. Relationship markers are fixed to zero-to-many at the source and one at the target; custom cardinality metadata is ignored. |
| DFD | Experimental | Processes, data stores, external entities, and labeled flows. Basic grid layout; no automatic level balancing. |
| Use case | Not implemented | No semantic renderer; any generic cell layout must be supplied manually. |
| Activity | Not implemented | No semantic renderer; any generic cell layout must be supplied manually. |

## Requirements

- The API-derived minimum is **Node.js 16.6.0**: `Array.prototype.at` is used in the sequence renderer and comparison helper and was introduced in [Node.js 16.6.0](https://nodejs.org/en/blog/release/v16.6.0). The scripts also use ESM `node:` imports, `String.prototype.replaceAll`, optional chaining, and built-in filesystem/path/zlib modules. No later API was found in the current scripts. This is a source-based compatibility floor, not a tested runtime guarantee.
- Use a maintained Node.js LTS release in practice. The commands below were verified on Node.js **24.13.0**; Node.js 16.6.0 was not tested.
- No `npm install` is needed; there are no third-party JavaScript dependencies.
- Open `.drawio` files in diagrams.net for visual review.
- Optional PNG/SVG export requires PowerShell and the draw.io desktop CLI available as `drawio` on PATH. Export is separate from JSON rendering.

## Install for Codex

The [Codex local skill documentation](https://learn.chatgpt.com/docs/build-skills) lists the user skill directory as `$HOME/.agents/skills`. Clone into a folder named `drawio-diagrams`, matching `name` in `SKILL.md`.

Windows PowerShell:

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE/.agents/skills" | Out-Null
git clone https://github.com/vietngia249/drawio-diagrams-skill.git "$env:USERPROFILE/.agents/skills/drawio-diagrams"
```

macOS/Linux:

```sh
mkdir -p "$HOME/.agents/skills"
git clone https://github.com/vietngia249/drawio-diagrams-skill.git "$HOME/.agents/skills/drawio-diagrams"
```

Codex detects skill changes automatically; restart it if the skill does not appear. These instructions cover Codex only; other agents have not been verified. Installation commands are documented here, not executed as part of repository validation.

Example prompt:

> Use $drawio-diagrams to inspect this project's source and create a sequence diagram for submitting an order. Record uncertain domain details before rendering.

## Quick start

Run from this repository's root, or change to the installed skill directory first:

```sh
node scripts/render_drawio.mjs examples/sequence.json -o out/sequence.drawio
node scripts/validate_drawio.mjs out/sequence.drawio
node scripts/render_drawio.mjs examples/erd.json -o out/erd.drawio
node scripts/validate_drawio.mjs out/erd.drawio
node scripts/render_drawio.mjs examples/dfd.json -o out/dfd.drawio
node scripts/validate_drawio.mjs out/dfd.drawio
```

All three examples were rendered and structurally validated on Node.js 24.13.0. The sequence example emits 19 cells (15 vertices and 4 edges, including a branch separator); ERD emits 3 cells (2 vertices and 1 edge); DFD emits 7 cells (3 vertices and 4 edges). Each validator reports balanced tags and empty duplicate-ID, missing-endpoint, and overlap arrays. These counts exclude the two root cells.

`out/` is ignored by Git. The fixtures are synthetic and in English. Passing these checks does not establish visual or domain correctness.

## Workflow and JSON input

1. Copy the structure of `templates/diagram-context.md` into the target project and record source evidence, requirements, and assumptions.
2. Obtain approval for uncertain domain details. Approval already given for the same scope remains valid.
3. Create UTF-8 JSON using the examples below and the conventions in `rules/diagrams.md`.
4. Render the JSON to a separate `.drawio` output path.
5. Validate the output, then open it in diagrams.net to inspect layout and meaning.
6. Export PNG/SVG only when requested and when the optional CLI is installed.

Keep project context and source material outside the installed skill. Reference diagrams remain read-only.

Every semantic input has a `type` (`sequence`, `erd`, or `dfd`) and optional `title`. The complete runnable inputs are in `examples/`; the following excerpts show their field shapes.

Sequence, from `examples/sequence.json`:

```json
{
  "participants": [{"id": "customer", "label": "Customer"}, {"id": "service", "label": "Order service"}],
  "messages": [{"order": 1, "from": "customer", "to": "service", "label": "Submit order", "kind": "sync"}]
}
```

Message endpoints reference participant IDs. Messages and fragments are merged by numeric `order` within each owner. Fragments have `kind`, `order`, and `branches`; each branch has a `guard` and may contain messages and nested fragments. The complete example contains an `alt` fragment with accepted/rejected branches. `return` messages use dashed open arrows.

ERD, from `examples/erd.json`:

```json
{"name": "OrderItem", "attributes": [{"name": "id", "type": "integer", "key": "PK"}, {"name": "product_id", "type": "integer", "key": "FK"}]}
```

Put entity objects in `entities`. Relations use `from` and `to` entity names and an optional `name`, for example `{"from":"OrderItem","to":"Product","name":"references"}`. Key markers are display strings in `key`; boolean PK/FK metadata is not interpreted.

DFD, from `examples/dfd.json`:

```json
{"id": "search", "kind": "process", "label": "1. Search catalog"}
```

Put nodes in `nodes`, with `kind` set to `process`, `dataStore`, or `externalEntity`. Put links in `flows`, for example `{"from":"reader","to":"search","label":"Search terms"}`. Use declared node IDs as endpoints. Level balancing and process numbering require manual review.

## Script reference

Paths are relative to the skill directory. `.mjs` files marked as modules are imported by the CLI and have no standalone command interface.

| Script | Purpose | Main arguments or exports |
| --- | --- | --- |
| `scripts/render_drawio.mjs` | Render semantic or imported generic JSON to `.drawio`. | `input.json [-o output.drawio]`; defaults to replacing a `.json` suffix with `.drawio`. Always use distinct input/output paths. |
| `scripts/validate_drawio.mjs` | Print structural checks as JSON; exit nonzero on detected violations. | `file.drawio`; also exports `inspect(file)`. |
| `scripts/import_sample.mjs` | Extract generic cells and best-effort fragment metadata from a reference. | `input.drawio output.json type`; use `sequence`, `erd`, or `dfd` for the type metadata. |
| `scripts/compare_drawio.mjs` | Print count, label, and style similarity; optional sequence structure comparison. | `generated.drawio reference.drawio [--blind]`; scores are advisory, not pass/fail thresholds. |
| `scripts/export.ps1` | Invoke the optional draw.io desktop CLI. | `-InputFile file.drawio -OutputDir directory [-Format png\|svg]`; default format is `png`. |
| `scripts/common.mjs` | XML helpers, output writing, style loading, generic rendering, and grid layout. | Module: `docXml`, `vertex`, `edge`, `loadStyle`, `writeOut`, `renderGeneric`, `layoutGrid`, `esc`. |
| `scripts/sequence.mjs` | Sequence layout and fragment rendering. | Module: `renderSequence(data, style)`. |
| `scripts/erd.mjs` | Entity tables and fixed-marker relationship rendering. | Module: `renderErd(data, style)`. |
| `scripts/dfd.mjs` | DFD node and flow rendering. | Module: `renderDfd(data, style)`. |

Import and comparison examples:

```sh
node scripts/compare_drawio.mjs out/sequence.drawio out/sequence.drawio --blind
node scripts/import_sample.mjs out/sequence.drawio out/imported.json sequence
node scripts/render_drawio.mjs out/imported.json -o out/imported.drawio
```

Imported JSON can retain private labels and metadata. Review it before sharing. A self-comparison only demonstrates the command; it is not evidence of fidelity against an independent reference.

Optional export on Windows:

```powershell
powershell -File scripts/export.ps1 -InputFile out/sequence.drawio -OutputDir out/export -Format png
```

Use `-Format svg` for SVG. If `drawio` is missing, the helper prints an installation hint and exits with code zero without creating an export; check that an output file exists. Optional exports have not been verified for this documentation update.

## Customization

Edit `scripts/style.json` to adjust the fields actually read by the renderers, and consult `rules/diagrams.md` for notation conventions. Not every style field is consumed: for example, ERD relationship markers and some arrow styles are hard-coded in the renderer modules.

Labels are user-provided UTF-8 strings in JSON (`label`, `name`, message labels, and guards). Change those strings to change label language; there is no translation or language-selection option. Font availability and text placement still require visual review. Public fixtures and documentation must remain in English.

## Known limitations

- Layout is basic. Visually inspect long labels, self-messages, crossings, and fragments in diagrams.net. Fixed page dimensions may need adjustment for larger diagrams.
- The validator checks tag balance, duplicate IDs, endpoints, and selected overlaps. It is not a full XML/UML validator, skips overlap checking for sequence diagrams, and does not verify domain semantics.
- Import and comparison are best-effort, not lossless round-trip guarantees. Geometry and fragment message membership may be incomplete; compressed/multipage input handling is limited.
- Async messages use the same arrow styling as sync messages. `par` fragments do not simulate concurrency or add separate parallel scheduling.
- ERD uses fixed relationship markers; custom cardinalities and boolean PK/FK metadata are ignored. DFD level balancing is manual.
- Use case and activity semantic rendering are not implemented. Generic-cell rendering requires an explicit manual layout.

## Contributing

Use synthetic fixtures only. Keep public content in English and exclude private data, context, credentials, machine-specific paths, and original reference samples. Preserve reference files as read-only.

Run `node --check` after each `.mjs` edit and on all scripts before submitting. Render and validate all three examples with the quick-start commands. Visually review layout changes. Use Conventional Commits, for example `docs: rewrite README` or `fix: preserve sequence message order`.

## License

MIT. See [LICENSE](LICENSE).
