# Shared renderer contract

Status labels: **Observed** means present in development source at `a9e689c`; **Contract proposal** means the shared target recommended for implementation. The installed copy has the same commit, so no source/install divergence was observed.

## Document and cell model

- **Observed:** JSON dispatches to generic mode when `elements` is truthy; otherwise `type` selects `sequence`, `erd`, or `dfd`. Unsupported types throw. `title` is optional; `page.width` and `page.height` pass through to the document wrapper, defaulting to 1200×800. Output is an editable draw.io XML document with root cells `0` and `1`.
- **Contract proposal:** Keep semantic IDs stable, unique within a diagram, deterministic from semantic IDs (not array position where possible), and independent of labels. Every edge endpoint must resolve to a declared cell ID. IDs `0` and `1` are reserved for draw.io root/layer cells.
- Generic cells use `elements[]`; each item is a vertex or edge. `attrs.id` (legacy top-level `id`) identifies it; `attrs.value`/`style` (or top-level aliases), `attrs.parent` (default `1`), and `geometry` carry cell data. Edges also need `source` and `target`; vertices carry x/y/width/height. Current generic rendering is permissive and does not validate required data before XML emission.
- **Contract proposal:** Parent IDs must resolve; parent-child containment must be explicit. Geometry is local to its parent, finite, and nonnegative in size. A child vertex must fit inside its parent unless the renderer documents an intentional overflow. Edge geometry is relative and may include source/target points and route points.

## Semantic inputs and required fields

Required fields below are the proposed minimum semantic contract; current renderers often silently default or fail later rather than validating this at the boundary.

| Type | Required | Optional / compatibility |
| --- | --- | --- |
| Sequence | `participants[]` with unique `id`; each message has `from`, `to`, `kind` | Participant shorthand string remains supported. `label`/`text`; `order`; `fragments[]`; fragment `kind`, `order`, nonempty `branches[]`; branch `guard`, nested `messages`/`fragments`. Current code defaults missing `kind` to a solid filled sync-like arrow. |
| ERD | `entities[]` with unique `name`; each attribute has `name` | Legacy `attrs` alongside `attributes`; string attributes and short keys `n/t/k`; attributes may have `type` and display `key`. Relations have `from`/`to` (legacy `a`/`b`), optional `name`. **Contract proposal:** optional `fromAttribute`/`toAttribute`; resolve unqualified names only when unique, otherwise require `Entity.attribute`. |
| DFD | `nodes[]` with unique `id`, `kind`, `label`; each flow has `from`, `to` | Legacy `processes` and `edges`, node name/label endpoint aliases, flow `text` alias. Kinds: `process`, `dataStore`, `externalEntity`. |
| Generic | `elements[]`; each item declares exactly one of `vertex` or `edge` and an ID | Raw cell attributes, style, parent, and geometry; current renderer accepts `attrs` and legacy top-level fields. |
| Use case | `actors[]` and `useCases[]` with unique IDs and labels; `relationships[]` | Relationship forms: actor-to-use-case association or use-case-to-use-case `include`, `extend`, `generalization`. Renderer currently supports these forms. |
| Activity | `nodes[]` with unique IDs/kinds; `transitions[]` with valid `from`/`to` | Current renderer supports `initial`, `action`, `decision`, `merge`, `final`, `activityFinal`, and `flowFinal`; fork/join are not implemented. Transition labels/guards are display text. |

## Cardinalities, message kinds, and endpoint rules

- Sequence kinds: `sync`, `async`, `return`. Target rendering must distinguish sync (solid filled arrow), async (solid open arrow), and return (dashed open arrow). Self-messages require a loop route. Fragment kinds in current source: `alt`, `opt`, `loop`, `par`; `par` is visual grouping, not concurrency execution. Branch guards are display text.
- ERD cardinality is optional and explicit per relation end using `fromCardinality`/`toCardinality`; `fromMultiplicity`/`toMultiplicity` are accepted compatibility aliases. Supported values are `1`, `0..1`, `0..*`, and `1..*`. Missing or empty values render without an endpoint marker. Never infer missing business cardinality. Optional attribute endpoints resolve to attribute cells.
- DFD uses directed flows with a block end arrow. Under the selected Yourdon/DeMarco convention, each flow must touch a process; process-to-store and external-to-store direct links are invalid. This is a convention choice, not a universal DFD law.
- Future use-case association is undirected; include/extend/generalization direction follows the supplied `from`/`to` and must not be guessed. Activity control-flow direction follows `from`/`to`; decision guards are labels, not executable conditions.

## Geometry, parents, and containment

- **Observed:** Semantic renderers place cells under parent `1`; generic mode can retain a caller parent. Vertices have x/y/width/height geometry; semantic edges use relative geometry. Current layout algorithms are fixed-grid/simple sequence layout and do not guarantee collision-free output.
- **Contract proposal:** Parent frames own contained cells, with stable local coordinates. Renderers may use helper/label cells, but their ownership and semantic edge endpoints must be documented. Root/layer cells are not semantic content. Route and label geometry must remain inside page bounds or trigger a warning; intentional overlap (lifelines, frames, contained children) must not be reported as a sibling collision.

## Styles and configuration precedence

- **Observed:** `scripts/style.json` is loaded once by `common.mjs`. Semantic renderers read selected type-specific values. Generic items can supply inline style. `title` and page dimensions come from input. There is no renderer-wide override/merge API.
- **Contract proposal:** precedence is explicit per-call configuration > repository style defaults > renderer fallback. Generic per-cell inline style is authoritative for that cell. Validate configuration shape and values; avoid silently accepting unused keys. Notation semantics and endpoint/cardinality data must never be overridden by presentation styles.

## Renderer interfaces and diagnostics

- Current module interfaces: `renderSequence(data, style)`, `renderErd(data, style)`, `renderDfd(data, style)` return arrays of `<mxCell>` XML strings; common helpers are `vertex`, `edge`, `docXml`, `loadStyle`, `writeOut`, `layoutGrid`, `renderGeneric`, `esc`. CLI owns parsing, dispatch, output path, and document wrapping.
- **Contract proposal:** Semantic renderers should validate and return cells plus structured diagnostics, or throw a typed input error before writing output. CLI handles JSON/I/O/XML errors; renderer errors identify type, field/path, offending value, and expected form. No partial output on errors.
- Severity: errors for malformed/missing required data, duplicate IDs, unresolved endpoints/parents, invalid cardinality/kind, invalid geometry, and prohibited DFD flows. Warnings for likely overlap, page overflow, unresolved visual layout concerns, or legacy aliases. Warnings must not claim domain correctness. Validator reports structural errors and warnings separately; rendered text collisions, edge crossing quality, notation truth, and visual readability require image/domain review and remain explicit unchecked checks.

## Legacy compatibility

Keep sequence string participants and missing-kind-as-sync behavior during a compatibility period; keep ERD `attrs`, `a`/`b`, and `n/t/k`; keep DFD `processes`, `edges`, name/label endpoint aliases, and flow `text`; keep generic `attrs` plus top-level aliases. New canonical fields are `participants[].id`, `entities[].attributes`, relation `from`/`to`, DFD `nodes`/`flows`, and generic `attrs`. Detect conflicting canonical/legacy values and warn or reject rather than choosing silently. Preserve output semantics for valid existing examples.

## Implementation evidence and contract clarifications (2026-11-02)

- Shared dispatch now registers sequence, ERD, DFD, use-case, activity, and generic-cell inputs. The five repository examples rendered and passed structural validation in the D checkout. Use-case and activity support remains a renderer subset; the activity kinds above replace the earlier future proposal's unsupported fork/join set.
- `scripts/drawio_xml.mjs` parses XML into an element/attribute model and decodes plain, CDATA, and compressed draw.io pages. It rejects malformed XML and declarations rather than relying on regular-expression tag extraction. No XML package was available and no dependency was installed. The parser deliberately rejects DTD/external entity declarations.
- `scripts/common.mjs` validates generic aliases, IDs, parent cycles, endpoints, finite geometry, containment, and page bounds; warnings remain separate from errors. `scripts/validate_drawio.mjs` checks the parsed model, warns about page overflow/likely sibling overlap, and ignores known lifeline/frame intersections and invisible edge endpoint helper cells.
- Style precedence is renderer fallback < `scripts/style.json` < input `style` < `--style` JSON. Unknown keys and incompatible scalar types/ranges are errors. Generic per-cell inline style remains authoritative for that cell.
- Import and comparison select a single page from multi-page files. Import records omitted workbook/XML/geometry semantics in `_import.losses`; comparison scores are descriptive. `--blind` hides cell labels from its report but is explicitly not anonymization or a privacy guarantee.
- Export discovery includes the installed Windows Desktop executable locations, applies a timeout, and verifies a fresh nonempty PNG signature or parseable SVG root. The installed app exported PNG and SVG in the D environment; Chromium cache warnings appeared on stderr despite successful files.
- Visual evidence is retained under `outputs/drawio-improvements/validation/`. The sequence stress diagram's wrapped guards and final return label were visually checked in a fresh Desktop export. Use-case structure passes, while connector convergence/crossings remain a visual limitation; structural checks do not assess those details.
