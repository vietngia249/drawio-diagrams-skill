---
name: drawio-diagrams
description: Generate editable draw.io diagrams from source code or an assignment brief, with sequence, ERD, DFD, use-case, activity, and generic cell inputs.
---

# drawio-diagrams

Read the relevant source code and project requirements. Record actors, entities, flows, evidence, assumptions, and unresolved questions using `templates/diagram-context.md`. Keep project context in the target project, outside this skill.

Obtain approval for uncertain domain details before generating the affected diagrams. Existing user approval remains valid; do not request it again for the same scope. Never invent missing source evidence.

Read `rules/diagrams.md` and `NOTATION.md` for notation choices and renderer limits. Create semantic JSON from the examples in `examples/`; generic `elements[]` JSON is available when callers provide their own layout.

1. Render with `node scripts/render_drawio.mjs input.json -o output.drawio`.
2. Validate with `node scripts/validate_drawio.mjs output.drawio`. For a multipage file, select one page with `--page index|name|id`.
3. If a reference is supplied, compare selected pages with `node scripts/compare_drawio.mjs generated.drawio reference.drawio --generated-page selector --reference-page selector`.
4. Open the output in diagrams.net to inspect label placement, arrows, and readability. Structural checks do not establish visual or domain correctness.
5. When requested, export using `powershell -File scripts/export.ps1 -InputFile output.drawio -OutputDir export -Format png`. Export requires diagrams.net Desktop; the script searches PATH and common Windows install locations, enforces a timeout, and checks the resulting file.

Use UTF-8 JSON. The renderer accepts an optional byte-order mark, normalizes compatibility aliases, warns when canonical and legacy fields conflict, checks generic IDs, parents, endpoints and geometry, and rejects output paths that overwrite input or enter `work/drawio-references`. Style precedence is renderer fallback, `scripts/style.json`, input `style`, then `--style overrides.json`.

Treat user-provided reference diagrams as read-only. Import one page at a time with `node scripts/import_sample.mjs input.drawio output.json generic --page selector`; imported data may retain private labels and metadata. The `_import.losses` field records known losses. Review it and the imported content before sharing.

`--blind` comparison omits label text from its report but reads both source files locally. It is not anonymization or a privacy guarantee.

Do not distribute project source, private context, or reference samples with the skill. Structural diagnostics are not a substitute for visual QA, business validation, or review of notation choices.
