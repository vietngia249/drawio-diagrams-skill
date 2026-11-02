# Implementation plan proposal

Preparatory recommendation only; no implementation performed. Agree `CONTRACT.md` before coding. Keep ownership disjoint by file set:

1. **Shared schema, dispatch, and diagnostics:** `scripts/common.mjs`, `scripts/render_drawio.mjs`, `scripts/validate_drawio.mjs`; own ID/parent/geometry contract, typed errors/warnings, compatibility normalization, and style override merge.
2. **Sequence:** `scripts/sequence.mjs`, `examples/sequence.json`; own participant/message/fragment requirements, kinds, endpoint validation, layout and self-route behavior.
3. **ERD:** `scripts/erd.mjs`, `examples/erd.json`; own row model, relation cardinality/endpoints, attribute links and legacy aliases.
4. **DFD:** `scripts/dfd.mjs`, `examples/dfd.json`; own node/flow requirements, process-mediated rule decision, layout and routing.
5. **New semantic renderers:** `scripts/usecase.mjs`, `scripts/activity.mjs`, corresponding examples; own new type schemas, semantics, layout. Coordinate only a single dispatch integration change with stream 1.

Avoid concurrent edits to shared files. Stream 1 integrates registration after each renderer is ready; each other stream owns only its listed renderer/example. Documentation owner (if needed) should be assigned separately after schemas settle; do not include it as a sixth parallel implementation stream. Preserve legacy fields through explicit normalization and test existing examples plus focused regression fixtures.

Suggested order: confirm contract and notation choices; agree style precedence and diagnostic shape; implement schema/core boundary; implement four disjoint renderer streams; integrate dispatch; verify structural XML, legacy examples, diagnostics, and rendered images. Visual inspection and domain correctness are separate from structural validation.