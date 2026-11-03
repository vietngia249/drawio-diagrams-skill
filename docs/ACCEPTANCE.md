# Earlier acceptance audit (historical)

This focused audit predates the six-renderer integration and records evidence for the original five renderers only. For current integrated tests and fixture validation, see [outputs/drawio-improvements/VERIFICATION.md](../outputs/drawio-improvements/VERIFICATION.md).

## Scope and fixtures

This audit covers the sequence, ERD, DFD, use-case, and activity renderers. The five synthetic fixtures are in `tests/fixtures/acceptance/`; they exercise Vietnamese text, literal ampersands and angle brackets, and multiline labels. The sequence fixture includes three participants, synchronous and return messages, nested `alt`/`opt` fragments, a long guard, and a self-message. The use-case fixture exercises actors sharing use cases.

ERD page dimensions are inferred from entity geometry, relation labels, and self-relation routes when no page is specified. An explicit page remains authoritative; an undersized page is preserved and produces `PAGE_OVERFLOW` diagnostics. Long relation labels wrap and sit above the connector with clearance. The shared HTML text encoder preserves literal `&`, `<`, and `>` in labels. Mixed-sharing use cases place actors on opposite sides and give each actor independently routed exits.

## Automated checks

Run from the repository root:

- `node --test tests/shared.test.mjs` — 32 passed, 0 failed.
- `node --check` over every `scripts/*.mjs` and `tests/*.mjs` file — passed.
- Each acceptance JSON was rendered with `scripts/render_drawio.mjs` and checked with `scripts/validate_drawio.mjs` — no structural errors or warnings.
- Each generated diagram was exported through `scripts/export.ps1` using the installed diagrams.net Desktop executable. The helper checked fresh output, PNG signature, and nonempty output.
- ERD regressions cover inferred bounds for a tall multiline table and preservation/overflow reporting for an explicit 320 × 240 page.
- Sequence and mixed-sharing use-case regressions inspect emitted diagram structure and routing; the ERD relation-label regression checks label height and connector clearance.

## Visual review

Fresh PNGs and their editable diagrams are stored at `C:/Users/Ngia/.ao/data/artifacts/drawio-diagrams-skill-15/acceptance-preview/`. All five PNGs were opened and reviewed. Text and diacritics are readable in these examples; the ERD long label is above its connector, and the sequence includes the nested `alt`/`opt` and a compact visible self-loop. The use-case associations are individually readable. The review also covered activity branches and DFD flow direction/labels.

## Limits

The structural validator checks XML parsing, page selection, IDs, parents, geometry, endpoints, page bounds, and likely sibling overlap. Those checks do not establish business correctness, full notation conformance, accessibility, or legibility at every zoom level and font environment. Visual review applies only to these synthetic inputs. Explicit undersized pages intentionally render with warnings rather than failing generation.

## Installed path

`C:/Users/Ngia/.codex/skills/drawio-diagrams` is a Windows junction targeting `D:/MyProject/drawio-diagrams-skill`. It was inspected after the audit changes and remains intact.
