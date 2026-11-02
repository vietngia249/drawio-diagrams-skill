# Notation and presentation choices

## Standards and conventions

Sequence diagrams use UML interaction concepts such as participants, messages, combined fragments, and operands. The project cites the OMG [UML 2.5.1 specification](https://www.omg.org/spec/UML/2.5.1/PDF) as its normative UML source. Renderer support is a subset: sync, async, and return messages; `alt`, `opt`, `loop`, and `par` fragments. A `par` frame is a static drawing and does not model runtime scheduling.

Use-case and activity diagrams use a renderer subset of UML concepts from the same OMG specification. The use-case renderer supports actors, use cases, associations, include, extend, and generalization relationships. The activity renderer supports initial/final nodes, actions, decisions, merges, and directed transitions. It checks declared IDs and endpoints, but it does not enforce every UML well-formedness rule or model execution.

The DFD renderer selects a process-mediated convention associated with Yourdon/DeMarco. IBM's [DFD overview](https://www.ibm.com/think/topics/data-flow-diagram) describes the four DFD concepts and notes that its common notation families vary in symbol appearance; it also describes external entities as exchanging data through processes rather than directly with stores. The project enforces that process-mediated connection rule as a chosen convention, not as a universal law for every DFD dialect. The current store shape is a diagrams.net partial-rectangle approximation, not a claim of exact symbol conformance.

ERD crow's-foot endpoint markers are presentation symbols. The renderer accepts explicit end cardinalities `1`, `0..1`, `0..*`, and `1..*`, but it does not infer them from entity or attribute names. No single ERD convention is claimed as authoritative here; confirm the intended notation with the project owner when the notation matters.

## Presentation templates

The sequence defaults use lifeline headers and dashed lifelines, labeled messages, and framed combined fragments. The ERD defaults use entity/table shapes, attribute rows, key markers, and routed relationship edges. The DFD defaults use differentiated process, external-entity, and data-store shapes with labeled directed flows. These are renderer templates in `scripts/style.json`, not domain facts or user preferences.

## Explicit overrides and inferred preferences

An explicit per-call style override (`--style file.json`), input `style` object, or per-cell generic inline style expresses a caller choice and takes precedence in that order after repository defaults. Where no explicit choice exists, appearance comes from `scripts/style.json` and is only a renderer default. A layout or color inferred from an example/reference should be recorded as an inference and checked with the user when it affects meaning. Do not infer cardinality, flow semantics, or business rules from visual style.

## Evidence limits

The sources above support notation concepts and the specific convention decisions stated here. They do not validate a generated diagram's domain meaning or every visual detail. Structural validation and image review are separate checks. The validator skips likely overlap warnings for lifeline/frame intersections, but other collisions, routing quality, and text clipping still require visual inspection.
