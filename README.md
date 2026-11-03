# drawio-diagrams

Generate editable diagrams.net (`.drawio`) files from JSON using local Node.js scripts. The project is independent of diagrams.net and is not endorsed by it. See [NOTATION.md](NOTATION.md) for notation choices and their sources.

## Requirements

- Node.js with ES modules and built-in test support. The implementation was exercised on Node.js 24.13.0; a formal minimum version has not been verified. There is no package manifest or dependency installation step.
- Optional PNG/SVG export uses the diagrams.net Desktop executable. The helper searches `PATH` and common Windows installation locations.
- Use diagrams.net Desktop or the web editor to inspect layout and meaning. Structural checks do not establish visual readability or domain correctness.

## Quick start

```sh
node scripts/render_drawio.mjs examples/sequence.json -o out/sequence.drawio
node scripts/validate_drawio.mjs out/sequence.drawio
node scripts/render_drawio.mjs examples/erd.json -o out/erd.drawio
node scripts/render_drawio.mjs examples/dfd.json -o out/dfd.drawio
node scripts/render_drawio.mjs examples/usecase.json -o out/usecase.drawio
node scripts/render_drawio.mjs examples/activity.json -o out/activity.drawio
```

Render accepts UTF-8 JSON, including an optional BOM. The output path must differ from the input and must be outside `work/drawio-references`. Semantic inputs (`sequence`, `erd`, `dfd`, `usecase`, `activity`) and generic `{ "elements": [...] }` inputs are supported. Conflicting canonical and legacy aliases produce warnings. `--help` prints command usage.

```sh
node scripts/render_drawio.mjs input.json -o out/diagram.drawio --style overrides.json
node scripts/validate_drawio.mjs out/diagram.drawio --page 0
node scripts/import_sample.mjs source.drawio out/import.json generic --page "Page 2"
node scripts/compare_drawio.mjs generated.drawio reference.drawio --generated-page 0 --reference-page 1
node scripts/compare_drawio.mjs generated.drawio reference.drawio --blind
```

Style precedence is renderer fallback, then `scripts/style.json`, then the input's `style` object, then `--style overrides.json`. The override must contain known style keys and correctly typed values. A generic cell's inline `attrs.style` (or legacy top-level `style`) is used as supplied.

The `--blind` compare mode omits label text from its report. It still reads both input files locally; it is not anonymization, a privacy guarantee, or a guarantee that the source labels are not exposed elsewhere.

## Input shapes

See `examples/` for runnable examples and [rules/diagrams.md](rules/diagrams.md) for the fields and limits. The renderer component branches also include a `class` diagram input; when that renderer is present, it uses the same CLI form, `node scripts/render_drawio.mjs input.json -o out/class.drawio`.

- **Sequence:** participants and ordered messages/fragments. Participant strings remain accepted for compatibility. Message kinds are `sync`, `async`, and `return`; omitted kind retains the legacy sync-like behavior.
- **Class:** classes/interfaces/external classifiers/data types, attributes, operations, and relationships (`association`, `dependency`, `generalization`, `aggregation`, `composition`, `realization`). The class renderer is implemented in its component branch; this checkout's shared dispatcher exposes a registration slot until that renderer is integrated.
- **ERD:** entities with attributes and relations. `attrs`/`n`/`t`/`k` and `a`/`b` aliases remain supported. Cardinalities (`1`, `0..1`, `0..*`, `1..*`) and attribute endpoints are optional; no business cardinality is inferred.
- **DFD:** nodes and directed flows. Legacy `processes`, `edges`, endpoint names/labels, and flow `text` remain supported. The selected Yourdon/DeMarco convention requires every flow to touch a process; this is a convention choice.
- **Generic:** each `elements[]` entry is exactly one vertex or edge. `attrs` is canonical; top-level aliases remain accepted. IDs must be unique and cannot be `0` or `1`; parent and edge endpoints must resolve. Vertex geometry requires finite x/y/width/height and nonnegative size.
- **Use case:** `actors[]`, `useCases[]`, and optional `relationships[]`. Relationship types are `association`, `include`, `extend`, or `generalization`; the renderer checks declared endpoint IDs.
- **Activity:** `nodes[]` with unique IDs and kinds `initial`, `action`, `decision`, `merge`, `final`, `activityFinal`, or `flowFinal`, plus `transitions[]` with valid `from` and `to`. Transition labels/guards are display text; the renderer does not execute them.

## Utilities

| Command | Behavior |
| --- | --- |
| `node scripts/render_drawio.mjs input.json [-o output.drawio] [--style overrides.json]` | Render sequence, ERD, DFD, use case, activity, or generic cell JSON to editable XML; `type: "class"` is available when the class component renderer is integrated. |
| `node scripts/validate_drawio.mjs file.drawio [--page index\|name\|id]` | Parse plain or compressed draw.io XML and report structural errors separately from geometry warnings. Multi-page input requires explicit selection. |
| `node scripts/import_sample.mjs input.drawio output.json [type] [--page selector]` | Import one selected page to generic cells and record known import losses in `_import.losses`. |
| `node scripts/compare_drawio.mjs generated.drawio reference.drawio [page options] [--blind]` | Compare selected pages. Similarity scores are descriptive, not pass/fail thresholds. |
| `powershell -File scripts/export.ps1 -InputFile file.drawio -OutputDir out/export -Format png` | Export with a timeout and verify fresh, nonempty, readable output. `-Format svg` is also supported. |

Import does not promise lossless round trips. It omits workbook metadata, unsupported XML children, and geometry fields it does not model. Multi-page imports require `--page` by index, name, or ID. Compare page selectors are `--generated-page` and `--reference-page`.

## Tests

Run the shared and geometry regression suites without installing dependencies:

```sh
node --test tests/shared.test.mjs tests/geometry.test.mjs
```

The suite covers generic input normalization, style overrides, XML entity/newline handling, compressed multipage selection, import loss metadata, output safety, and geometry diagnostics. It does not prove domain semantics or visual quality.

See [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md) for the focused five-renderer audit, including dynamic ERD page sizing, mixed-sharing use-case layout, multilingual fixtures, fresh Desktop exports, and verification limits.

## Export

```powershell
powershell -File scripts/export.ps1 -InputFile out/sequence.drawio -OutputDir out/export -Format png
```

The exporter discovers `drawio` on `PATH` and standard Windows Desktop locations, waits at most 60 seconds by default (`-TimeoutSeconds` adjusts this), and returns a structured error if export fails or no fresh readable output appears.

## Limits

- Structural validation checks XML syntax, IDs, parents, endpoints, geometry validity, page overflow, and likely sibling overlap. Lifeline and frame intersections are treated as intentional. Warnings do not fail validation.
- Planned geometry is produced by the semantic renderer and shared orthogonal router; XML validation measures serialized explicit geometry independently. Edges that rely on diagrams.net automatic routing are reported as unchecked for route quality. Neither phase can certify final rendered text metrics, notation truth, or business semantics; inspect Desktop exports.
- The shared router is used by the activity, use-case, sequence, ERD, class, and DFD component renderer branches. Generic `elements[]` input does not receive automatic layout or routing: callers provide the cells' geometry and waypoints.
- Import and comparison support plain XML and draw.io compressed page payloads. A multipage file requires an explicit page selector; comparisons score one selected page at a time.
- Layout is renderer-specific and may need page-size adjustment or manual editing.

## License

MIT. See [LICENSE](LICENSE).
