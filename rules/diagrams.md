# Diagram conventions

## Sequence

Set `type` to `sequence`. Declare `participants` as objects with unique `id` and `label`. Messages use `from` and `to` participant IDs, `label`, numeric `order`, and `kind` (`sync`, `async`, or `return`). `return` uses a dashed arrow. Messages and fragments are merged by `order` within their owner.

Fragments use `kind` (`alt`, `opt`, `loop`, or `par`), `order`, and `branches`. Each branch has a `guard` and may contain `messages` and nested `fragments`. Guards are labels, not executable conditions. Parallel branches are drawn as operands; the renderer does not simulate concurrency.

## ERD

Set `type` to `erd`. Each entity has `name` and `attributes`, whose items use `name`, `type`, and optional `key` such as `PK` or `FK`. Relations use `from` and `to` entity names and an optional `name`. Endpoints must match declared entity names. Relationship arrows currently use fixed zero-to-many and one markers. Check the actual domain cardinality manually before sharing.

## DFD

Set `type` to `dfd`. Declare `nodes` with unique `id`, `label`, and `kind` (`process`, `dataStore`, or `externalEntity`). Flows have `from`, `to`, and `label`. Endpoints must match declared IDs. Keep process identifiers and flow labels consistent with the requested level; level balancing is a manual domain check.

## Review

Keep labels readable, make evidence and assumptions explicit, and inspect the generated file in diagrams.net. Do not equate passing structural checks with correct business logic or polished layout. Use case and activity diagrams require manual cell layout rather than these semantic renderers.