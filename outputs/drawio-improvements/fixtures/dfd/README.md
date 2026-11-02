# DFD regression fixture

`reverse-parallel-long-labels.json` is synthetic rendering test data. It has
parallel and opposite-direction flows between an external entity and a
process, plus opposite-direction process/store flows. Labels include Vietnamese
text, multiple lines, quotes, and XML-sensitive characters.

## Notation and checks

The renderer selects Yourdon/DeMarco semantics: process circles, external
entity rectangles, directed named flows, and data stores drawn with two
parallel horizontal strokes and a label. The store symbol is composed from
independent editable thin-rectangle strokes and a text cell, with a transparent
endpoint anchor for connected flows; it is not a single grouped stencil. Every flow must
touch a process; direct external-entity/data-store flows are rejected. This
connection restriction is convention-specific, not a universal DFD rule.

The notation distinction and connection rule follow IBM's DFD overview:
[IBM, What Is a Data Flow Diagram?](https://www.ibm.com/think/topics/data-flow-diagram).
No source code was copied from that page or any external repository.

Level balancing is **unchecked**: this fixture contains no parent/child DFD
hierarchy evidence to compare.
