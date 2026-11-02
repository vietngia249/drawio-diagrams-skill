# Source audit

## Confirmed from development source

- Generic input is selected by truthy `elements`; semantic dispatch currently supports sequence, ERD, DFD. Renderers return XML cell strings; common helpers wrap them under root/layer IDs `0`/`1`.
- Sequence uses participant IDs (or shorthand strings), merges messages/fragments by `order`, and supports `alt`, `opt`, `loop`, `par`. Missing message kind renders like sync; only `return` changes to a dashed/open arrow. Undeclared endpoints and unsupported fragment kinds throw.
- ERD supports `entities`, `attributes` or legacy `attrs`, string attrs and `n/t/k`; relations accept `from`/`to` or `a`/`b`. Endpoints must resolve by entity name. Markers are hard-coded zero-to-many -> one. Attribute endpoint/cardinality enhancements in prior AO work are not present in this source.
- DFD supports `nodes`/`flows` and legacy `processes`/`edges`; node kinds select configured style with a process fallback. Missing flow endpoints throw. Direct external-to-store restrictions are not implemented in current source.
- Generic mode supports vertex/edge cell fields, aliases, parent, and basic geometry, but does not validate IDs, required endpoints, geometry, or parents before emitting XML.
- Style comes from `scripts/style.json`; style values are selectively consumed. `docXml` uses default page dimensions 1200×800; input `page` is passed through. Errors are ordinary JS errors; there is no warning/diagnostic model.
- Validator uses regex/tag parsing, does not check parent references or geometry validity, and skips all overlap checks when `umlLifeline` occurs anywhere. Export returns success when the draw.io CLI is absent and does not verify output.

## Reused prior work (not re-verified here)

Prior `outputs/drawio-improvements/SUMMARY.md`, `USAGE.md`, and fixtures describe improvements for ERD rows/cardinality/attribute endpoints; sequence arrow semantics/self-loops/spacing; DFD sizing/routing/flow convention; use-case/activity renderers; and validation/export reliability. The AO worktree has those changes uncommitted, and these facts are evidence about that worktree only, not current source.

## Inference and unchecked

- The five recommended ownership areas in `IMPLEMENTATION_PLAN.md` are a proposed split inferred from the source module boundaries and the existing improvement scope.
- Prior work's visual verification status is inconsistent: `VERIFICATION.md` says stress-fixture PNGs were visually inspected, while `SUMMARY.md` says no images were produced/reviewed. Treat visual claims as **unchecked** until reconciled against a retained record/artifact.
- No renderer behavior, tests, build, or scripts were executed for this task. No business semantics were inferred.