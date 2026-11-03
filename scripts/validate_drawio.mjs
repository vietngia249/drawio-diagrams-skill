import { ensureOptions, parseCli, reportError } from './common.mjs';
import { cellsFromModel, readDrawio } from './drawio_xml.mjs';

const xmlDiagnostic = (severity, code, path, message, value) => ({ phase: 'xml', severity, code, path, message, ...(value === undefined ? {} : { value }) });
const styleValue = (style, key) => style.match(new RegExp(`(?:^|;)${key}=([^;]+)`))?.[1];
const hasExplicitFloatingPoint = (cell, end) => (cell.geometry.points ?? []).some(point => point.as === `${end}Point` && Number.isFinite(Number(point.x)) && Number.isFinite(Number(point.y)));
const intersectsSegmentBox = (a, b, r) => a.x === b.x
  ? a.x > r.x && a.x < r.x + r.width && Math.max(Math.min(a.y, b.y), r.y) < Math.min(Math.max(a.y, b.y), r.y + r.height)
  : a.y === b.y && a.y > r.y && a.y < r.y + r.height && Math.max(Math.min(a.x, b.x), r.x) < Math.min(Math.max(a.x, b.x), r.x + r.width);
const overlapsRouteSegment = (a, b, c, d) => a.x === b.x && c.x === d.x && a.x === c.x
  ? Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)) < Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y))
  : a.y === b.y && c.y === d.y && a.y === c.y && Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)) < Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x));

export function inspect(file, selection) {
  const { page, pageCount, graph } = readDrawio(file, selection), cells = cellsFromModel(graph);
  const errors = [], warnings = [], ids = new Map(), vertices = [], edges = [];
  for (const cell of cells) {
    const a = cell.attrs, id = a.id ?? '';
    if (!id) errors.push({ severity: 'error', code: 'ID_REQUIRED', path: '$xml.cells', message: 'Every mxCell requires a nonempty id' });
    if (!['0', '1'].includes(id) && cell.vertex === cell.edge) errors.push({ severity: 'error', code: 'CELL_KIND', path: `$xml.cells.${id || '<missing>'}`, message: 'Cell must be exactly one of vertex or edge' });
    if (id) { if (ids.has(id)) errors.push({ severity: 'error', code: 'ID_DUPLICATE', path: `$xml.cells.${id}`, message: 'Duplicate cell ID', value: id }); else ids.set(id, cell); }
    if (cell.vertex) vertices.push(cell);
    if (cell.edge) edges.push(cell);
  }
  if (!ids.has('0') || !ids.has('1')) errors.push({ severity: 'error', code: 'ROOT_CELLS', path: '$xml.root', message: 'Required root and default layer cells 0 and 1 must exist' });
  for (const cell of cells) {
    const a = cell.attrs, id = a.id ?? '', g = cell.geometry, p = `$xml.cells.${id}`;
    if ((cell.vertex || cell.edge) && !cell.hasGeometry) errors.push({ severity: 'error', code: 'GEOMETRY_REQUIRED', path: `${p}.geometry`, message: 'Vertex or edge cell requires mxGeometry' });
    if (id !== '0' && id !== '1' && !a.parent) errors.push({ severity: 'error', code: 'PARENT_REQUIRED', path: `${p}.parent`, message: 'Non-root cell requires a parent' });
    if (a.parent && !ids.has(a.parent)) errors.push({ severity: 'error', code: 'PARENT_UNRESOLVED', path: `${p}.parent`, message: `Parent ${a.parent} does not resolve`, value: a.parent });
    const ancestry = new Set([id]); let parentId = a.parent;
    while (parentId && ids.has(parentId)) { if (ancestry.has(parentId)) { errors.push({ severity: 'error', code: 'PARENT_CYCLE', path: `${p}.parent`, message: 'Parent hierarchy contains a cycle', value: parentId }); break; } ancestry.add(parentId); parentId = ids.get(parentId).attrs.parent; }
    if (cell.vertex) for (const k of ['x', 'y', 'width', 'height']) {
      if (g[k] === undefined || g[k] === '' || !Number.isFinite(Number(g[k]))) errors.push({ severity: 'error', code: 'GEOMETRY_FINITE', path: `${p}.geometry.${k}`, message: 'Vertex geometry requires a finite number', value: g[k] });
    }
    if (cell.vertex) for (const k of ['width', 'height']) if (Number(g[k]) < 0) errors.push({ severity: 'error', code: 'GEOMETRY_SIZE', path: `${p}.geometry.${k}`, message: 'Size must be nonnegative', value: g[k] });
    if (cell.edge) for (const k of ['source', 'target']) if ((!a[k] || !ids.has(a[k])) && !(a[k] === '' && hasExplicitFloatingPoint(cell, k))) errors.push({ severity: 'error', code: 'ENDPOINT_UNRESOLVED', path: `${p}.${k}`, message: `${k} ${a[k] ?? ''} does not resolve`, value: a[k] });
  }
  const model = graph, pageWidth = Number(model.attrs.pageWidth), pageHeight = Number(model.attrs.pageHeight), unchecked = [];
  const worldOrigin = (cell, seen = new Set()) => {
    const id = cell.attrs.id ?? '', g = cell.geometry, origin = { x: Number(g.x ?? 0), y: Number(g.y ?? 0) };
    if (seen.has(id)) return origin; seen.add(id);
    const parent = ids.get(cell.attrs.parent ?? '');
    if (parent?.vertex && parent.attrs.id !== id) { const p = worldOrigin(parent, seen); origin.x += p.x; origin.y += p.y; }
    return origin;
  };
  for (const v of vertices) {
    const g = v.geometry, origin = worldOrigin(v), x = origin.x, y = origin.y, w = Number(g.width ?? 0), h = Number(g.height ?? 0);
    const parent = ids.get(v.attrs.parent ?? '');
    if (parent?.vertex && parent.attrs.id !== v.attrs.id) {
      const px = Number(parent.geometry.x ?? 0), py = Number(parent.geometry.y ?? 0), pw = Number(parent.geometry.width ?? 0), ph = Number(parent.geometry.height ?? 0);
      const localX = Number(g.x ?? 0), localY = Number(g.y ?? 0);
      if (localX < 0 || localY < 0 || localX + w > pw || localY + h > ph) warnings.push({ severity: 'warning', code: 'PARENT_OVERFLOW', path: `$xml.cells.${v.attrs.id}.geometry`, message: `Vertex extends beyond parent ${parent.attrs.id}`, value: { x: localX, y: localY, width: w, height: h } });
    }
    if (Number.isFinite(pageWidth) && Number.isFinite(pageHeight) && (x < 0 || y < 0 || x + w > pageWidth || y + h > pageHeight)) warnings.push({ severity: 'warning', code: 'PAGE_OVERFLOW', path: `$xml.cells.${v.attrs.id}.geometry`, message: 'Vertex extends beyond page bounds', value: { x, y, width: w, height: h, pageWidth, pageHeight } });
  }
  const edgeParentOrigin = edge => {
    const parent = ids.get(edge.attrs.parent ?? '');
    return parent?.vertex ? worldOrigin(parent) : { x: 0, y: 0 };
  };
  for (const edge of edges) for (const [index, point] of edge.geometry.points.entries()) {
    if (point.as && !['points', 'sourcePoint', 'targetPoint'].includes(point.as)) continue;
    const origin = edgeParentOrigin(edge), x = Number(point.x) + origin.x, y = Number(point.y) + origin.y;
    if (!Number.isFinite(x) || !Number.isFinite(y)) errors.push({ severity: 'error', code: 'POINT_GEOMETRY', path: `$xml.cells.${edge.attrs.id}.geometry.points[${index}]`, message: 'Edge route point requires finite x and y', value: point });
    else if (Number.isFinite(pageWidth) && Number.isFinite(pageHeight) && (x < 0 || y < 0 || x > pageWidth || y > pageHeight)) warnings.push({ severity: 'warning', code: 'EDGE_ROUTE_OVERFLOW', path: `$xml.cells.${edge.attrs.id}.geometry.points[${index}]`, message: 'Edge route point is outside page bounds', value: point });
  }
  const geometryById = new Map();
  const vertexBounds = cell => { const origin = worldOrigin(cell), g = cell.geometry; return { x: origin.x, y: origin.y, width: Number(g.width), height: Number(g.height) }; };
  for (const vertex of vertices) geometryById.set(vertex.attrs.id, vertexBounds(vertex));
  const measuredRoutes = [];
  const endpointPoint = (edge, end, id) => {
    const direct = edge.geometry.points.find(point => point.as === `${end}Point`);
    const edgeOrigin = edgeParentOrigin(edge);
    if (direct && Number.isFinite(Number(direct.x)) && Number.isFinite(Number(direct.y))) return { x: Number(direct.x) + edgeOrigin.x, y: Number(direct.y) + edgeOrigin.y };
    const vertex = ids.get(id), box = vertex && geometryById.get(id); if (!box) return undefined;
    const X = styleValue(edge.attrs.style ?? '', `${end === 'source' ? 'exit' : 'entry'}X`), Y = styleValue(edge.attrs.style ?? '', `${end === 'source' ? 'exit' : 'entry'}Y`);
    if (X === undefined || Y === undefined) return undefined;
    const nx = Number(X), ny = Number(Y); if (!Number.isFinite(nx) || !Number.isFinite(ny)) return undefined;
    const value = { x: box.x + box.width * nx, y: box.y + box.height * ny };
    const shape = styleValue(vertex.attrs.style ?? '', 'shape');
    // Rectangular perimeter anchors are directly measurable from the serialized bounds.
    if (styleValue(edge.attrs.style ?? '', `${end === 'source' ? 'exit' : 'entry'}Perimeter`) !== '0' && shape && !['rect', 'rectangle'].includes(shape)) return undefined;
    return value;
  };
  for (const edge of edges) {
    const id = edge.attrs.id, path = `$xml.cells.${id}.geometry`, edgeOrigin = edgeParentOrigin(edge), routePoints = edge.geometry.points.filter(point => !point.as || point.as === 'points')
      .map(point => ({ x: Number(point.x) + edgeOrigin.x, y: Number(point.y) + edgeOrigin.y }));
    const automatic = styleValue(edge.attrs.style ?? '', 'edgeStyle') !== 'none' && styleValue(edge.attrs.style ?? '', 'noEdgeStyle') !== '1';
    if (!routePoints.length || automatic) {
      unchecked.push(xmlDiagnostic('unchecked', 'ROUTE_AUTO_UNCHECKED', path, routePoints.length ? 'Automatic edge routing may add or move segments between stored waypoints' : 'Edge has no explicit route waypoints; diagrams.net determines its rendered path', id));
      continue;
    }
    const source = endpointPoint(edge, 'source', edge.attrs.source), target = endpointPoint(edge, 'target', edge.attrs.target);
    const partial = !source || !target;
    if (partial) unchecked.push(xmlDiagnostic('unchecked', 'ROUTE_ENDPOINTS_UNCHECKED', path, 'Explicit waypoints are measurable, but one or both endpoint positions depend on automatic perimeter routing', id));
    const points = source && target ? [source, ...routePoints, target] : routePoints;
    const segments = [];
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i];
      if (a.x !== b.x && a.y !== b.y) errors.push(xmlDiagnostic('error', 'ROUTE_NON_ORTHOGONAL', `${path}.points[${i - 1}]`, 'Explicit route segment is not horizontal or vertical', { from: a, to: b }));
      else if (a.x !== b.x || a.y !== b.y) segments.push([a, b]);
    }
    for (const [index, point] of points.entries()) if (Number.isFinite(pageWidth) && Number.isFinite(pageHeight) && (point.x < 0 || point.y < 0 || point.x > pageWidth || point.y > pageHeight)) warnings.push(xmlDiagnostic('warning', 'EDGE_ROUTE_OVERFLOW', `${path}.points[${index}]`, 'Explicit route point is outside page bounds', point));
    if (!partial && segments.length) measuredRoutes.push({ edge, points, segments });
  }
  const visibleObstacles = vertices.filter(vertex => !/opacity=0/.test(vertex.attrs.style ?? '') && !/umlLifeline|umlFrame/.test(vertex.attrs.style ?? ''));
  for (const route of measuredRoutes) {
    const terminals = new Set([route.edge.attrs.source, route.edge.attrs.target]);
    for (const [a, b] of route.segments) for (const obstacle of visibleObstacles) {
      if (terminals.has(obstacle.attrs.id)) continue;
      const box = geometryById.get(obstacle.attrs.id);
      if (box && intersectsSegmentBox(a, b, box)) warnings.push(xmlDiagnostic('warning', 'ROUTE_OBSTACLE', `$xml.cells.${route.edge.attrs.id}`, `Explicit route crosses visible cell ${obstacle.attrs.id}`, { obstacle: obstacle.attrs.id, from: a, to: b }));
    }
  }
  for (let i = 0; i < measuredRoutes.length; i++) for (let j = i + 1; j < measuredRoutes.length; j++) {
    const a = measuredRoutes[i], b = measuredRoutes[j];
    if ((a.edge.attrs.parent ?? '') !== (b.edge.attrs.parent ?? '')) continue;
    if (a.segments.some(([p, q]) => b.segments.some(([r, s]) => overlapsRouteSegment(p, q, r, s)))) warnings.push(xmlDiagnostic('warning', 'ROUTE_SHARED_SEGMENT', `$xml.cells.${a.edge.attrs.id}`, `Explicit route shares a positive-length segment with ${b.edge.attrs.id}`, b.edge.attrs.id));
  }
  const overlapPairs = [];
  const endpointCells = new Set(edges.flatMap(edge => [edge.attrs.source, edge.attrs.target]).filter(Boolean));
  for (let i = 0; i < vertices.length; i++) for (let j = i + 1; j < vertices.length; j++) {
    const a = vertices[i], b = vertices[j]; if ((a.attrs.parent ?? '') !== (b.attrs.parent ?? '')) continue;
    if (endpointCells.has(a.attrs.id) || endpointCells.has(b.attrs.id) || /opacity=0/.test(a.attrs.style ?? '') || /opacity=0/.test(b.attrs.style ?? '')) continue;
    if (/umlLifeline|umlFrame/.test(a.attrs.style ?? '') || /umlLifeline|umlFrame/.test(b.attrs.style ?? '')) continue;
    const ga = a.geometry, gb = b.geometry, ax = Number(ga.x ?? 0), ay = Number(ga.y ?? 0), aw = Number(ga.width ?? 0), ah = Number(ga.height ?? 0), bx = Number(gb.x ?? 0), by = Number(gb.y ?? 0), bw = Number(gb.width ?? 0), bh = Number(gb.height ?? 0);
    const inside = (x, y, w, h, X, Y, W, H) => x >= X && y >= Y && x + w <= X + W && y + h <= Y + H;
    if (inside(ax, ay, aw, ah, bx, by, bw, bh) || inside(bx, by, bw, bh, ax, ay, aw, ah)) continue;
    const iw = Math.max(0, Math.min(ax + aw, bx + bw) - Math.max(ax, bx)), ih = Math.max(0, Math.min(ay + ah, by + bh) - Math.max(ay, by));
    const ratio = iw * ih / Math.max(1, Math.min(aw * ah, bw * bh));
    if (ratio > 0.2) { overlapPairs.push([a.attrs.id, b.attrs.id, ratio]); warnings.push({ severity: 'warning', code: 'SIBLING_OVERLAP', path: `$xml.cells.${a.attrs.id}`, message: `Possible overlap with ${b.attrs.id}`, value: ratio }); }
  }
  return { file, page: { id: page.id, name: page.name, index: pageCount === 1 ? 0 : undefined }, pageCount, ok: errors.length === 0, errors: errors.map(d => ({ phase: 'xml', ...d })), warnings: warnings.map(d => ({ phase: 'xml', ...d })), unchecked, balanced: true, duplicateIds: [...errors.filter(d => d.code === 'ID_DUPLICATE').map(d => d.value)], missingSource: [...errors.filter(d => d.code === 'ENDPOINT_UNRESOLVED' && d.path.endsWith('.source')).map(d => d.path)], missingTarget: [...errors.filter(d => d.code === 'ENDPOINT_UNRESOLVED' && d.path.endsWith('.target')).map(d => d.path)], overlapPairs, shapeCount: vertices.length, edgeCount: edges.length, ids: ids.size };
}

const usage = 'Usage: node scripts/validate_drawio.mjs file.drawio [--page index|name|id]';
if (process.argv[1]?.endsWith('validate_drawio.mjs')) {
  try {
    const { positional, options, help } = parseCli(process.argv.slice(2), usage); if (help) { console.log(usage); process.exit(0); }
    ensureOptions(options, ['page']);
    if (positional.length !== 1) throw new Error(usage);
    const result = inspect(positional[0], options.page); console.log(JSON.stringify(result, null, 2)); if (!result.ok) process.exitCode = 1;
  } catch (error) { reportError(error); process.exitCode = 2; }
}
