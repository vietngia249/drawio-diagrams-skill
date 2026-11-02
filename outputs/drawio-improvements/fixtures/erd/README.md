# ERD regression fixture

This fixture uses relational entity boxes with a header and independently editable attribute rows. Relationship ends use diagrams.net's crow's-foot notation: a bar means one, a circle plus bar means zero or one, a circle plus foot means zero or many, and a bar plus foot means one or many. See the [diagrams.net crow's-foot guide](https://www.drawio.com/docs/tutorials/crows-foot-notation/).

Cardinality is shown only when supplied by the input. The unmarked final relationship is intentional. Attribute endpoints connect to the named row; ordinary relationship endpoints connect to the entity header. Named relation labels use separate editable cells in the reserved gap between entities so they stay clear of cardinality marks. Multiline entity and attribute rows size to their content. The fixture covers long labels, many attributes, PK/FK normalization (`primary key`, `foreign key`, and legacy `n`/`t`/`k`), repeated relations, all supported cardinalities, an attribute-linked self-relation, Vietnamese text, XML-sensitive characters, and a multiline label.

The notation source describes crow's-foot symbols; the renderer's editability and exact routing are implementation-specific. This fixture makes no claim of complete conformance to a broader ERD interchange standard.
