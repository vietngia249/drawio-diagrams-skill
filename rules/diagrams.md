# Diagram conventions

Notation choices and source references are recorded in [NOTATION.md](../NOTATION.md). Presentation defaults are controlled by `scripts/style.json`; those defaults express renderer appearance, not evidence about a user's domain.

## Sequence

Set `type` to `sequence`. Declare participants as objects with unique `id` and a display `label`; legacy participant strings remain accepted. Messages use participant IDs as `from` and `to`, plus a label, optional numeric `order`, and `kind` (`sync`, `async`, or `return`). A missing kind keeps the legacy sync-like behavior. Return messages use dashed open arrows; async and sync messages use distinct arrowheads. Self-messages are routed as loops.

Fragments use `kind` (`alt`, `opt`, `loop`, or `par`), `order`, and `branches`. Each branch may have a `guard` and nested messages/fragments. Guards are display labels. `par` is visual operand grouping, not a concurrency simulation. Explicit order controls placement; without order, input order is retained.

## ERD

Set `type` to `erd`. Each entity has a unique `name` and `attributes`; each attribute has a `name`, optional `type`, and optional display `key` (`PK`/`FK` are recognized). Legacy `attrs`, strings, and `n`/`t`/`k` keys remain supported.

Relations use `from` and `to` entity names and optional `name`. Optional `fromAttribute` and `toAttribute` connect to a uniquely named attribute of the corresponding endpoint; qualify as `Entity.attribute` when needed. Optional end cardinalities accept `1`, `0..1`, `0..*`, or `1..*`. Omitted cardinality is not inferred and is rendered without a marker. Legacy `a`/`b` relation endpoints remain supported.

## DFD

Set `type` to `dfd`. Declare unique node IDs, labels, and kinds (`process`, `dataStore`, `externalEntity`). Flows use `from` and `to` references and may use `label`. Legacy `processes`, `edges`, node name/label endpoint aliases, and flow `text` remain accepted.

This renderer selects a Yourdon/DeMarco-style process-mediated flow convention: each flow must touch a process, so direct entity-to-store and entity-to-entity flows are rejected. This is a notation convention, not a universal DFD law. The configured data-store symbol is a visual approximation; level balancing, process numbering, and business meaning require manual review.

## Use case

Set `type` to `usecase`. Declare `actors[]` and `useCases[]` with unique `id` and nonempty `label`. Relationships use `from`, `to`, and `type` (or legacy `kind`) with `association`, `include`, `extend`, or `generalization`. Associations connect an actor and a use case; other types connect use cases. Direction is taken from the supplied endpoints and is not inferred. The renderer adds a system boundary and uses static layout; verify relationship direction and boundary membership against the source requirements.

## Activity

Set `type` to `activity`. Declare `nodes[]` with unique `id` and a `kind`: `initial`, `action`, `decision`, `merge`, `final`, `activityFinal`, or `flowFinal`. Action nodes need a nonempty label. Optional numeric `x` and `y` set positions; otherwise the renderer uses a simple fallback grid. `transitions[]` use `from` and `to` IDs plus optional `id`, `guard`, or `label`. Guards are display labels, not evaluated conditions. The renderer checks endpoint references and uses the shared planned router for orthogonal transitions; this does not prove a complete or behaviorally correct activity model.

## Class

The class component renderer accepts `type: "class"` with a nonempty `classes[]` array (or `elements[]` alias). Each class has a unique `id` or `name`, optional display `name`, `kind` (`class`, `interface`, `external`, `datatype`), optional `stereotype`, `attributes[]`, and `operations[]`. Members require a name; visibility accepts `public`, `private`, `protected`, or `package` and defaults to package visibility. Attributes may include `type`. Operations may include `parameters[]` (or `params[]`) and `returnType`; each parameter needs a name and may have a type or `optional` marker. Relationships (or alias `relations`) use `from`, `to`, and a type: `association`, `dependency`, `generalization`, `aggregation`, `composition`, or `realization`. Relationship labels are optional. Associations may also provide source/target role and multiplicity labels. The renderer checks IDs/endpoints and planned geometry; it does not infer source-model facts. Invoke through the ordinary CLI once the class component branch is integrated: `node scripts/render_drawio.mjs input.json -o out/class.drawio`.

## Generic cells

Set `elements` to an array. Each element declares exactly one of `vertex` or `edge`. `attrs.id` is canonical; top-level aliases remain accepted. IDs are nonempty, unique, and may not be reserved root IDs `0` or `1`. Parents and edge endpoints must resolve. Vertex geometry uses finite `x`, `y`, `width`, and `height`; sizes cannot be negative. Edge geometry may include finite route points.

## Review

Use the validator's errors to fix malformed XML structure, duplicate IDs, missing parents/endpoints, or invalid geometry. Treat overlap and page-bound messages as warnings. Explicit serialized route points can be checked for bounds, orthogonality, and measurable node/shared-segment conflicts; automatic editor routes are unchecked. Lifeline/frame intersections are expected. Inspect rendered diagrams in diagrams.net; automated checks do not establish correct business logic, readable labels, clean edge crossings, or domain-appropriate notation.
