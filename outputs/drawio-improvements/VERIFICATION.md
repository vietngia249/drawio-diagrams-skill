# Verification record

## Current integrated run

This verification covers the local six-renderer integration at merge commit `5e35471b06891786cb82f98977d37cb743811643`, based on `e8130af860f8c7933a498aa8811ca96998eecdf5`. It includes activity, use-case, sequence, ERD, class, DFD, shared serialization, and shared geometry tests.

- `node --test`: **92 passed, 0 failed**.
- `node --check` over all `.mjs` files under `scripts/` and `tests/`: all 19 files passed.
- `git diff --check e8130af..HEAD`: passed.
- Rendered each of `examples/{sequence,activity,usecase,erd,class,dfd}.json` with `scripts/render_drawio.mjs`, then checked the resulting `.drawio` with `scripts/validate_drawio.mjs`: all six returned zero errors and zero warnings.
- The validator reported unchecked automatic-route counts of 0 for sequence, 0 for activity, 9 for use case, 9 for ERD, 5 for class, and 6 for DFD. An unchecked route has no explicit path available to measure; it is not a passing route-quality check.

These six integrated examples were validated as XML. No fresh Desktop PNG export or visual inspection was performed for this integrated run. The older acceptance PNGs below predate integration and are not evidence of the current integrated rendering.

## Earlier focused acceptance audit (historical)

The earlier audit covered only sequence, ERD, DFD, use-case, and activity. In its worker checkout, `node --test tests/shared.test.mjs` passed 32 tests. The five acceptance fixtures were rendered and structurally validated without errors or warnings, exported with diagrams.net Desktop, and visually reviewed. The audit also checked JavaScript syntax and `git diff --check` for its then-current files.

Its preview artifacts are in `C:/Users/Ngia/.ao/data/artifacts/drawio-diagrams-skill-15/acceptance-preview/`. They document the earlier five-renderer audit only; they predate the current integration and do not include class-diagram output.
