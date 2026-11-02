# Sources consulted

## Local source evidence

| Source | Revision/state | Use |
| --- | --- | --- |
| `D:/MyProject/drawio-diagrams-skill` | `a9e689cd582d321ecee576e2cbf43eeb628757c9`; `main`; untracked `agent.md` | Authoritative development source. Read `agent.md`, `README.md`, `SKILL.md`, `rules/diagrams.md`, examples, `scripts/*.mjs`, `scripts/style.json`, `LICENSE`. |
| `C:/Users/Ngia/.codex/skills/drawio-diagrams` | Same commit `a9e689cd582d321ecee576e2cbf43eeb628757c9`; untracked `agent.md` | Installed-copy state comparison only; not modified. |
| `C:/Users/Ngia/.ao/data/worktrees/drawio-diagrams-skill/drawio-diagrams-skill-2` | Base commit same; branch `ao/drawio-skill/root`; implementation files and outputs uncommitted | Read `outputs/drawio-improvements/{CONTEXT_UPDATE,NOTATION,SUMMARY,USAGE,VERIFICATION}.md`, fixtures, and relevant diffs. Reused prior findings rather than rerunning their fixture work. |

## Reference repositories

All three URLs were supplied in the AO orchestrator session transcript and cloned because their target directories were absent. Only repository documentation, source, style schema, and root LICENSE files listed below were read. No embedded instructions were followed, no programs were executed, and no packages were installed. License entries distinguish the root repository license from nested vendor licenses.

| Repository | Exact URL | Checked-out commit | Root license consulted | Relevant material inspected and patterns noted |
| --- | --- | --- | --- | --- |
| `Agents365-ai/drawio-skill` at `work/drawio-references/drawio-skill` | https://github.com/Agents365-ai/drawio-skill | `1f59eae2ca4740ed72a195279469fb58fa39d9e0` | `LICENSE`: MIT | `skills/drawio-skill/scripts/seqlayout.py`: label-aware participant spacing, distinct sync/async/return styles, self-message routing, endpoint checks. `scripts/sqlerd.py`: PK/FK display and content-derived table dimensions. `scripts/edgeports.py`: distribute multiple edge ports along a shared side in endpoint order; explicitly distinguishes port placement from full obstacle routing. `scripts/validate.py`: stable diagnostic codes, severities, subject/message/fix fields; XML geometry, parent, endpoint, sibling-overlap, and explicit-waypoint routing checks; auto-routed edges are intentionally not geometry-checked. `styles/schema.json` and `references/style-presets.md`: schema/preset separation. |
| `full-stack-skills/drawio-skills` at `work/drawio-references/drawio-skills` | https://github.com/full-stack-skills/drawio-skills | `e57f2ed84dabb05fd93962f5d8fd2a04add2ebed` | `LICENSE`: Apache-2.0 | `README.md`, `skills/drawio-flowchart/SKILL.md`, and `skills/drawio-architecture/SKILL.md`: concise type-specific guidance, consistent flow direction/symbols/style, one-topic diagrams, and labels/legends. This is authoring guidance rather than a semantic renderer or machine-checkable contract. |
| `jgraph/drawio-mcp` at `work/drawio-references/drawio-mcp` | https://github.com/jgraph/drawio-mcp | `30c232a35a924e193cd419013b3deb35536ec79b` | `LICENSE`: Apache-2.0; nested `mcp-app-server/vendor/libavoid/LICENSE` and `mcp-tool-server/vendor/libavoid/LICENSE`: GNU LGPL v2.1 | `shared/mx-model.js`: model subset exposes parent/child, geometry, edge terminals and resolved styles; geometry remains authoritative when no rendered view exists. `shared/mx-xml.js`: builds cell hierarchy and terminal links, preserves geometry points and selectively serializes changed fields. `shared/label-perimeter.js`: conditional label-aware perimeter/edge-label handling. `shared/mermaid-elk.js`: isolates layout selection in source configuration and respects existing explicit layout. |

## External references and limits

- Prior AO `outputs/drawio-improvements/NOTATION.md` cites the OMG UML 2.5.1 specification and IBM's DFD overview. The links were noted there but were not independently browsed or reverified for this read-only task; they are not cloned repositories.
- Project `LICENSE` identifies MIT. No reference code was copied. The patterns above are observations to inform future design, not proof of correctness or a required implementation choice.