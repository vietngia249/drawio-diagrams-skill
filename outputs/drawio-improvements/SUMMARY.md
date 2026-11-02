# Draw.io acceptance audit summary

The focused final acceptance audit is complete for the five semantic renderers. The current automated suite passes 32/32 tests. Acceptance fixtures cover Vietnamese UTF-8, XML-sensitive characters, multiline content, mixed-sharing use cases, inferred and undersized ERD pages, a long ERD relation label, and a sequence with three participants, nested fragments, a long guard, and a self-message.

All five fixtures were rendered and structurally validated without diagnostics, exported to PNGs with diagrams.net Desktop, and visually inspected. For this final handoff, the sequence diagram was regenerated directly from the D-source fixture, validated (38 cells; no errors or warnings), freshly re-exported, and inspected. The sequence self-message is visible as a compact loop; the ERD relation label wraps above its connector with clear space. Preview images and editable diagrams are at `C:/Users/Ngia/.ao/data/artifacts/drawio-diagrams-skill-15/acceptance-preview/`.

The installed junction `C:/Users/Ngia/.codex/skills/drawio-diagrams` still targets `D:/MyProject/drawio-diagrams-skill`. No commit or push was made. See [VERIFICATION.md](VERIFICATION.md) for commands, evidence, and limits.
