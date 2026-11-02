---
name: drawio-diagrams
description: Generate editable draw.io diagrams from source code or an assignment brief, with sequence, ERD, and DFD JSON rendering and structural validation. Use case and activity diagrams require manual layout.
---

# drawio-diagrams

Read the relevant source code and project requirements. Record actors, entities, flows, evidence, assumptions, and unresolved questions using `templates/diagram-context.md`. Keep project context in the target project, outside this installed skill.

Obtain approval for uncertain domain details before generating the affected diagrams. Existing user approval remains valid; do not request it again for the same scope. Never invent missing source evidence.

Read `rules/diagrams.md` for supported notation and renderer limitations. Create semantic JSON using the examples in `examples/`. All script paths below are relative to the installed `drawio-diagrams` directory.

1. Render: `node scripts/render_drawio.mjs input.json -o output.drawio`.
2. Validate: `node scripts/validate_drawio.mjs output.drawio`.
3. If a reference is supplied, compare: `node scripts/compare_drawio.mjs output.drawio reference.drawio --blind`.
4. Open the output in diagrams.net to inspect label placement, arrows, and readability. Structural validation alone does not establish visual or domain correctness.
5. When requested, export using `powershell -File scripts/export.ps1 -InputFile output.drawio -OutputDir export -Format png`. Export requires a separately installed `drawio` CLI.

Treat user-provided reference diagrams as read-only. Save generated JSON, diagrams, and exports to separate output paths. Do not distribute project source, private context, or reference samples with the skill.

Use UTF-8 without BOM. When writing through PowerShell, use `[IO.File]::WriteAllText(path, text, [Text.UTF8Encoding]::new($false))`. Run `node --check` after editing each `.mjs` file.