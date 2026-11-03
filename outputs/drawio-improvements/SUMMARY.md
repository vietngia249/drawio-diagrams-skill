# Draw.io integration verification summary

## Current integrated snapshot

The local integration branch includes shared geometry/docs, sequence, activity/use-case, DFD, and ERD/Class. At integration merge `5e35471b06891786cb82f98977d37cb743811643`, the full test suite passed **92/92**. Syntax checks passed for all 19 script and test `.mjs` files, and `git diff --check e8130af..HEAD` passed.

The six built-in semantic examples (sequence, activity, use case, ERD, class, DFD) were rendered and validated. Each had zero errors and zero warnings. The validator marked some automatic routes unchecked: counts were 0, 0, 9, 9, 5, and 6 respectively. The integrated verification did not export or visually inspect fresh Desktop PNGs; unchecked routes and older preview images are not visual verification of this integrated snapshot.

## Earlier focused acceptance audit (historical)

Before integration, the five-renderer acceptance audit passed 32 shared tests and rendered, validated, exported, and visually reviewed its sequence, ERD, DFD, use-case, and activity examples. Its preview files in `C:/Users/Ngia/.ao/data/artifacts/drawio-diagrams-skill-15/acceptance-preview/` document that earlier run only. Those PNGs predate the six-renderer integration and do not include the class renderer or the current integrated output.

See [VERIFICATION.md](VERIFICATION.md) for the separate commands and evidence for each run.
