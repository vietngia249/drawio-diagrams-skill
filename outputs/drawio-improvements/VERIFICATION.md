# Acceptance verification

## Result

The final acceptance audit covers sequence, ERD, DFD, use-case, and activity renderers. Current result: 32 shared tests passed, and all five acceptance examples were rendered, validated, exported through diagrams.net Desktop, and visually reviewed. This final 32-test result supersedes the earlier 30-test addendum; use this verification record as the current result.

## Commands and evidence

From the worker checkout at `C:/Users/Ngia/.ao/data/worktrees/drawio-diagrams-skill/drawio-diagrams-skill-15`:

- `node --test tests/shared.test.mjs`: 32 passed, 0 failed.
- `node --check` was run for every `scripts/*.mjs` and `tests/*.mjs` file: passed.
- For each `tests/fixtures/acceptance/{sequence,erd,dfd,usecase,activity}.json` input, `scripts/render_drawio.mjs` generated an editable diagram and `scripts/validate_drawio.mjs` reported no errors or warnings.
- Each diagram was passed to `scripts/export.ps1 -Format png` using the installed diagrams.net Desktop executable. The script confirmed fresh, nonempty PNG output with a valid PNG signature.
- `git diff --check` passed.

The preview artifacts are `C:/Users/Ngia/.ao/data/artifacts/drawio-diagrams-skill-15/acceptance-preview`: `sequence.png`, `erd.png`, `dfd.png`, `usecase.png`, and `activity.png`. Editable `.drawio` sources are alongside them. The sequence preview was regenerated directly from the D-source acceptance fixture for this final handoff (38 cells; zero validation errors or warnings), freshly exported, and visually inspected. The ERD preview was regenerated after its final label fix; the other three previews were exported from the final source snapshot and their renderer code did not change afterward.

## Confirmed behaviors

- ERD without a page request infers sufficient bounds for long and multiline entities plus relation labels. Explicit 320 x 240 remains 320 x 240 and reports page overflow.
- The long ERD relation label wraps above its connector with clearance.
- Use-case shared associations from actors on opposite sides have separate actor exits and remain individually readable.
- Sequence output has three participants, synchronous and return messages, nested `alt`/`opt` fragments, a long guard, and a self-message. The self-message appears as a compact loop in the Desktop preview.
- Semantic labels preserve Vietnamese diacritics and literal `&`, `<`, and `>` characters through the HTML layer.

## Review limits

The validator provides structural checks; it cannot prove semantic correctness, full UML or data-flow notation conformance, accessibility, or readability across all fonts and zoom settings. Manual review covers only the five synthetic examples. Desktop export and preview inspection are direct evidence for this environment, not for other platforms.

## Installed path

`C:/Users/Ngia/.codex/skills/drawio-diagrams` was verified as a Windows junction to `D:/MyProject/drawio-diagrams-skill` after source integration. The junction was preserved. No commit or push was made.
