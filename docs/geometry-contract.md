# Shared diagram geometry contract

This document describes the shared router and serializer contract, plus the current limits of renderer and XML diagnostics. Planned layout and geometry measured from serialized draw.io XML are separate phases; neither claims to measure the final diagrams.net Desktop rendering.

## Geometry and route constraints

- Planned geometry uses finite page-space coordinates. Typed vertex geometry is local to its parent; convert it to page space for obstacle checks. IDs `0` and `1` are reserved for the draw.io root and default layer.
- Visible nodes, containers, and independently rendered labels can be represented as obstacles with measured `{ x, y, width, height }` bounds. Labels use estimated wrapped-text dimensions, not actual Desktop font metrics. Parent containment and documented composite glyph parts are intentional.
- **Every route is orthogonal:** each segment is horizontal or vertical and each bend is 90 degrees. A route must clear unrelated node and label obstacles. Edge contact with its declared endpoints is allowed. **Distinct routes may not share any positive-length segment or trunk.** Parallel and reverse edges receive distinct ports and route tracks. Crossings are separate from shared trunks and are allowed only where a diagram-specific rule permits them.
- Route allocation is global across an input set and deterministic by semantic edge ID. Endpoint ports are explicit `{ nodeId, side, offset, point }`; `side` is `north`, `east`, `south`, or `west`, and `offset` is normalized to `[0,1]`. The router spaces colliding preferences and reserves distinct route tracks. Routes and labels must fit the page; impossible placement returns a planned error instead of silently sharing a trunk.
- Allocate edge labels with bounds and a link to their edge. The router places supported edge labels beside a route segment, avoiding supplied obstacles, page bounds, and other allocated route segments/labels. Renderer-specific labels not passed to the router need their own collision checks.

## Shared APIs

`scripts/geometry.mjs` exports:

```js
routeOrthogonalEdges({ obstacles, edges, page, clearance, minimumRouteGap })
```

An obstacle is `{ id, kind: 'node'|'label'|'container'|'helper', bounds, ownerId?, blocksRoute? }` in page coordinates. `blocksRoute` defaults to `true`; when false, the obstacle remains available for endpoint/port lookup but its bounds are omitted from route expansion, endpoint-stub collision checks, and edge-label obstacle checks. This is intended for zero-size helper endpoint markers whose containing semantic nodes are modeled separately. Each edge request has a unique `id`, `source` and `target` endpoint objects `{ nodeId, port?: { side, preferredOffset? } }`, and optionally a `label: { id, width, height }`. `preferredOffset` is normalized to `[0,1]`; the default preference is the side midpoint. Optional `minimumRouteGap` is a nonnegative page-unit **centerline separation** between overlapping positive-length parallel segments of distinct routes, including endpoint approach segments. It defaults to `0` for compatibility; zero-length, point-only contact does not require a gap. For a desired visible whitespace of 4 units and a 1-unit stroke, callers should request a centerline gap of 5 units (or, generally, stroke width plus desired visible whitespace). Ports on a shared node side are allocated at the same minimum separation where the side dimensions permit; otherwise routing returns a planned `ROUTE_GAP_UNAVAILABLE` error and omits affected routes. The same planned error is returned when no obstacle-free route can preserve the requested gap. The result is `{ routes, diagnostics, page }`. Each returned route is `{ edgeId, sourcePort, targetPort, points, bounds, label? }`; `points` are page-space bends between port points, `bounds` includes endpoints and bends, and an allocated label contains `{ id, bounds, segmentIndex, position }`.

The typed cell model accepted by `serializeCells(cells)` in `scripts/common.mjs` is:

```js
{ kind: 'vertex', id, value, style, parent, geometry: { x, y, width, height } }
{ kind: 'edge', id, value, style, parent, source, target,
  ports: { source: { side, offset }, target: { side, offset } },
  geometry: { relative: 1, sourcePoint?, targetPoint?, points: [{ x, y }] } }
```

Vertex geometry is parent-local. Route bends are supplied in page coordinates and converted to the edge parent's coordinates by the serializer. It emits standard editable `mxCell`/`mxGeometry` cells, explicit port constraints, and a waypoint `<Array as="points">`. Legacy `vertex()` and `edge()` helpers remain available; `serializeCells` passes through legacy XML cell strings. Existing renderer and CLI entry points remain supported.

`render_drawio.mjs` exposes `renderInput(input, { style, renderers })` and `registerRenderer(type, renderer)`. Renderer branches return cells and may include diagnostics/page. The integrated dispatcher registers `renderClass` as the built-in `type: "class"`; class JSON uses the ordinary render CLI path.

## Planned and XML diagnostics

- **Planned phase:** semantic renderers validate their own IDs, endpoints, dimensions, requested notation fields, and page limits. The shared router detects route failures against the obstacles it receives, including unavailable page-bounded paths and labels. A renderer that does not call the router, or that omits a label/visible helper from its obstacle model, does not receive those checks automatically. Generic cell geometry is caller-provided.
- **XML phase:** `scripts/validate_drawio.mjs` checks XML structure, IDs, parents, endpoints, finite geometry, page/parent-local bounds, explicit route orthogonality, and measurable route-vs-visible-node/shared-segment conditions. It analyzes serialized waypoints, not the router's claimed plan. The corresponding validator findings are reported in `errors`, `warnings`, and `unchecked`; automatic editor-routed edges have no explicit path to measure and are unchecked, not passed. PNG/SVG export analysis does not currently trace actual rendered connector paths.
- Error findings reject structural or planned-route failures when the relevant renderer enforces them. Warnings flag measurable quality limits such as overflow/collisions. Unchecked means the geometry is not observable in the input and is not a successful check. No diagnostic proves business semantics, formal notation conformance, or final text readability.

## Native shape/style evidence

Use only native style keys found in implementation and checked-in exported examples; this list is not an exhaustive diagrams.net catalog. Current renderer/configuration evidence includes `ellipse`, `rect`, `rhombus`, `umlActor`, `umlFrame`, `umlLifeline`, `table`, `tableRow`, `partialRectangle`, and `default` as values used by renderer source or `scripts/style.json`. The UML actor/lifeline/frame and common basic shapes also occur in checked-in `.drawio` examples. The DFD style configuration explicitly supplies `partialRectangle`; ERD configuration uses `table` and `tableRow`. Other style tokens include `text;`, `line`, `swimlane`, `edgeStyle=orthogonalEdgeStyle`, `edgeStyle=none`, and arrow values such as `open`, `block`, and the `ER...` cardinality arrows. `swimlane`, `text;`, and `line` are style forms, not `shape=` values. Do not add guessed names; require a checked-in exported example or exact installed shape definition as evidence.

## Legal diagram-specific intersections

- **Sequence:** lifelines intentionally pass through message bands and fragment frames; messages connect to their own participant lifelines. Fragment frames contain branch content and separators stay inside the frame. Self-messages loop out and back to the same participant on an orthogonal track. Unrelated messages and labels retain the common route constraints.
- **ERD:** a relation may terminate on its declared entity or attribute row; its own cardinality marker occupies the endpoint. Attribute rows belong to their entity. Distinct relations use different ports/tracks and cannot share positive-length segments.
- **DFD:** a flow touches its declared source and target nodes. The data-store body and glyph parts are one documented visual composite. Distinct flows cannot share a positive-length segment or cross an unrelated node/label.
- **Use case:** a system boundary contains use cases and a title; an actor symbol and actor label are separate cells. Relations connect declared endpoints. Crossings are permitted only when the renderer explicitly permits that relationship and the result remains visually unambiguous; no route may share a trunk.
- **Activity:** transitions touch declared endpoints; a final node's inner mark is intentional containment. Guard labels must clear unrelated nodes and routes.
- **Class:** relationship routes touch their declared classifier endpoints. Class compartments and their separator are child cells within the classifier container; they are not unrelated obstacles.
- **Generic cells:** only declared endpoints and explicit parent containment are intentional. The generic renderer does not automatically route edges.

## Implemented renderer coverage and known causes

The component renderer branches for activity, use case, sequence, ERD, class, and DFD call `routeOrthogonalEdges` and serialize typed cells with explicit ports/waypoints. The generic renderer remains caller-laid-out. The semantic branches retain their own placement rules, label measurements, diagram-specific exceptions, and schema checks; shared routing does not make their semantics interchangeable.

The shared waypoint XML defect was that legacy edge serialization put `as="points"` on waypoint `<mxPoint>` elements instead of the enclosing `<Array>`, so Desktop ignored explicit bends and drew straight endpoint routes. The serializer now emits the proper container. Typed bends are planned in page coordinates, while draw.io stores edge geometry relative to the edge parent; failing to convert between those coordinate spaces caused nested-parent route bounds errors. XML auto-routes remain unmeasurable until they are materialized as explicit waypoints. These are serializer/observability causes, not notation or source-data validation.
