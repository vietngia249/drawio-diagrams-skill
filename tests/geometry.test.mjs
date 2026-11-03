import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { routeOrthogonalEdges } from '../scripts/geometry.mjs';
import { serializeCells } from '../scripts/common.mjs';
import { inspect } from '../scripts/validate_drawio.mjs';
import { registerRenderer, renderInput } from '../scripts/render_drawio.mjs';

const page = { width: 420, height: 300 };
const nodes = [
  { id: 'A', kind: 'node', bounds: { x: 20, y: 120, width: 60, height: 50 } },
  { id: 'B', kind: 'node', bounds: { x: 340, y: 120, width: 60, height: 50 } }
];
const edge = (id, source, target, label) => ({ id, source: { nodeId: source }, target: { nodeId: target }, ...(label ? { label } : {}) });
const overlapsPositiveLength = (a, b, c, d) => a.x === b.x && c.x === d.x && a.x === c.x
  ? Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)) < Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y))
  : a.y === b.y && c.y === d.y && a.y === c.y && Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)) < Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x));
function segments(route) {
  const points = [route.sourcePort.point, ...route.points, route.targetPort.point];
  return points.slice(1).map((point, i) => [points[i], point]);
}
function xmlDocument(extra = '') {
  return `<?xml version="1.0"?><mxfile><diagram id="p" name="P"><mxGraphModel page="1" pageWidth="420" pageHeight="300"><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="A" value="A" vertex="1" parent="1"><mxGeometry x="20" y="120" width="60" height="50" as="geometry"/></mxCell><mxCell id="B" value="B" vertex="1" parent="1"><mxGeometry x="340" y="120" width="60" height="50" as="geometry"/></mxCell>${extra}</root></mxGraphModel></diagram></mxfile>`;
}
function withXml(xml, fn) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'drawio-geometry-'));
  const file = path.join(directory, 'diagram.drawio');
  fs.writeFileSync(file, xml, 'utf8');
  try { return fn(file); } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

test('routes are deterministic, orthogonal, and resolve unique explicit ports', () => {
  const input = { obstacles: nodes, edges: [edge('ab', 'A', 'B'), edge('ba', 'B', 'A')], page };
  const first = routeOrthogonalEdges(input), second = routeOrthogonalEdges(input);
  assert.deepEqual(first, second);
  assert.equal(first.diagnostics.filter(d => d.severity === 'error').length, 0);
  const ports = first.routes.flatMap(route => [route.sourcePort, route.targetPort]);
  assert.equal(new Set(ports.map(port => `${port.nodeId}:${port.side}:${port.offset}`)).size, ports.length);
  for (const route of first.routes) {
    const points = [route.sourcePort.point, ...route.points, route.targetPort.point];
    for (let i = 1; i < points.length; i++) assert.ok(points[i].x === points[i - 1].x || points[i].y === points[i - 1].y, `non-orthogonal segment on ${route.edgeId}`);
    for (const point of points) assert.ok(point.x >= 0 && point.x <= page.width && point.y >= 0 && point.y <= page.height);
  }
});

test('routes go around node and edge-label obstacles', () => {
  const obstacles = [...nodes,
    { id: 'blocker', kind: 'node', bounds: { x: 170, y: 85, width: 80, height: 100 } },
    { id: 'label-obstacle', kind: 'label', ownerId: 'existing', bounds: { x: 140, y: 258, width: 130, height: 24 } }
  ];
  const result = routeOrthogonalEdges({ obstacles, edges: [edge('ab', 'A', 'B', { id: 'new-label', width: 74, height: 24 })], page, clearance: 8 });
  assert.equal(result.diagnostics.filter(d => d.severity === 'error').length, 0);
  const route = result.routes[0];
  for (const [a, b] of segments(route)) {
    for (const obstacle of obstacles) {
      if (obstacle.id === 'A' || obstacle.id === 'B') continue;
      const r = obstacle.bounds;
      const crosses = a.x === b.x ? a.x > r.x - 8 && a.x < r.x + r.width + 8 && Math.max(a.y, b.y) > r.y - 8 && Math.min(a.y, b.y) < r.y + r.height + 8
        : a.y > r.y - 8 && a.y < r.y + r.height + 8 && Math.max(a.x, b.x) > r.x - 8 && Math.min(a.x, b.x) < r.x + r.width + 8;
      assert.equal(crosses, false, `route crosses ${obstacle.id}`);
    }
  }
  assert.ok(route.label);
});

test('parallel and reverse edges have no shared positive-length route segments', () => {
  const result = routeOrthogonalEdges({ obstacles: nodes, edges: [edge('ab1', 'A', 'B'), edge('ab2', 'A', 'B'), edge('ba', 'B', 'A')], page });
  const seen = [];
  for (const route of result.routes) for (const [a, b] of segments(route)) {
    assert.ok(Math.abs(a.x - b.x) + Math.abs(a.y - b.y) > 0, 'zero-length segments are not route tracks');
    for (const previous of seen) assert.equal(overlapsPositiveLength(a, b, previous.a, previous.b), false, `route segment shared by ${previous.edgeId} and ${route.edgeId}`);
    seen.push({ a, b, edgeId: route.edgeId });
  }
});

test('parallel edge labels receive separate obstacle-free bounds', () => {
  const result = routeOrthogonalEdges({ obstacles: nodes, edges: [
    edge('ab-one', 'A', 'B', { id: 'label-one', width: 90, height: 30 }),
    edge('ab-two', 'A', 'B', { id: 'label-two', width: 90, height: 30 })
  ], page });
  const labels = result.routes.map(route => route.label);
  assert.ok(labels.every(Boolean));
  const [a, b] = labels.map(label => label.bounds);
  assert.ok(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y, 'parallel edge labels overlap');
});

test('labels that cannot clear endpoint nodes are diagnosed instead of placed over them', () => {
  const closeNodes = [
    { id: 'left', kind: 'node', bounds: { x: 20, y: 100, width: 70, height: 50 } },
    { id: 'right', kind: 'node', bounds: { x: 115, y: 100, width: 70, height: 50 } }
  ];
  const result = routeOrthogonalEdges({ obstacles: closeNodes, edges: [edge('short', 'left', 'right', { id: 'wide-label', width: 150, height: 32 })], page: { width: 240, height: 240 } });
  assert.ok(result.diagnostics.some(d => d.code === 'LABEL_ROUTE_UNAVAILABLE' && d.severity === 'error'));
});

test('route result bounds include endpoints and all bends', () => {
  const result = routeOrthogonalEdges({ obstacles: nodes, edges: [edge('ab', 'A', 'B')], page });
  const route = result.routes[0], points = [route.sourcePort.point, ...route.points, route.targetPort.point];
  assert.deepEqual(route.bounds, {
    x: Math.min(...points.map(p => p.x)), y: Math.min(...points.map(p => p.y)),
    width: Math.max(...points.map(p => p.x)) - Math.min(...points.map(p => p.x)),
    height: Math.max(...points.map(p => p.y)) - Math.min(...points.map(p => p.y))
  });
  assert.ok(route.bounds.x >= 0 && route.bounds.y >= 0 && route.bounds.x + route.bounds.width <= page.width && route.bounds.y + route.bounds.height <= page.height);
});

test('typed cell serializer preserves semantic endpoints, ports, and bends', () => {
  const xml = serializeCells([
    { kind: 'vertex', id: 'A', value: 'A', style: 'shape=rect;', parent: '1', geometry: { x: 20, y: 120, width: 60, height: 50 } },
    { kind: 'vertex', id: 'B', value: 'B', style: 'shape=ellipse;', parent: '1', geometry: { x: 340, y: 120, width: 60, height: 50 } },
    { kind: 'edge', id: 'ab', value: '', style: 'edgeStyle=orthogonalEdgeStyle', parent: '1', source: 'A', target: 'B', ports: { source: { side: 'east', offset: 0.4 }, target: { side: 'west', offset: 0.6 } }, geometry: { relative: 1, points: [{ x: 200, y: 50 }] } }
  ]).join('');
  assert.match(xml, /source="A" target="B"/);
  assert.match(xml, /exitX=1;exitY=0\.4/);
  assert.match(xml, /entryX=0;entryY=0\.6/);
  assert.match(xml, /edgeStyle=orthogonalEdgeStyle;exitX=1/);
  assert.match(xml, /<Array as="points"><mxPoint x="200" y="50"\/>/);
  assert.doesNotMatch(xml, /<mxPoint x="200" y="50" as="points"/);
});

test('serializer converts page-space route points into edge-parent local coordinates', () => {
  const xml = serializeCells([
    { kind: 'vertex', id: 'frame', value: '', style: 'shape=rect;', parent: '1', geometry: { x: 100, y: 50, width: 220, height: 180 } },
    { kind: 'vertex', id: 'A', value: 'A', style: 'shape=rect;', parent: 'frame', geometry: { x: 0, y: 30, width: 40, height: 40 } },
    { kind: 'vertex', id: 'B', value: 'B', style: 'shape=rect;', parent: 'frame', geometry: { x: 160, y: 30, width: 40, height: 40 } },
    { kind: 'edge', id: 'ab', value: '', style: 'edgeStyle=none;', parent: 'frame', source: 'A', target: 'B', geometry: { relative: 1, points: [{ x: 210, y: 100 }] } }
  ]).join('');
  assert.match(xml, /<Array as="points"><mxPoint x="110" y="50"\/>/);
});

test('shared XML serialization preserves literal UTF-8 code points', () => {
  const label = String.fromCodePoint(0x47, 0x69, 0x61, 0x6f, 0x20, 0x64, 0x69, 0x1ec7, 0x6e);
  assert.equal(label, 'Giao diện'); // U+1EC7 is the precomposed Vietnamese ệ.
  const xml = serializeCells([{ kind: 'vertex', id: 'v', value: label, style: 'shape=rect;', parent: '1', geometry: { x: 0, y: 0, width: 100, height: 40 } }]).join('');
  assert.ok(xml.includes(`value="${label}"`));
  assert.ok([...xml].some(char => char.codePointAt(0) === 0x1ec7));
});

test('XML diagnostics identify non-orthogonal explicit waypoints and mark auto routes unchecked', () => {
  const anchored = 'exitX=1;exitY=0.5;entryX=0;entryY=0.5;exitPerimeter=1;entryPerimeter=1;';
  const bentEdge = `<mxCell id="diagonal" value="" style="edgeStyle=none;${anchored}" edge="1" parent="1" source="A" target="B"><mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="180" y="70"/><mxPoint x="210" y="95"/></Array></mxGeometry></mxCell>`;
  const explicit = withXml(xmlDocument(bentEdge), file => inspect(file));
  assert.ok(explicit.errors.some(d => d.phase === 'xml' && d.code === 'ROUTE_NON_ORTHOGONAL'));
  const autoEdge = '<mxCell id="automatic" value="" style="edgeStyle=orthogonalEdgeStyle;" edge="1" parent="1" source="A" target="B"><mxGeometry relative="1" as="geometry"/></mxCell>';
  const automatic = withXml(xmlDocument(autoEdge), file => inspect(file));
  assert.ok(automatic.unchecked.some(d => d.phase === 'xml' && d.code === 'ROUTE_AUTO_UNCHECKED'));
});

test('XML diagnostics measure route intersections with unrelated visible nodes', () => {
  const blocker = '<mxCell id="blocker" value="B" style="shape=rect;" vertex="1" parent="1"><mxGeometry x="180" y="130" width="40" height="30" as="geometry"/></mxCell>';
  const routedEdge = '<mxCell id="crossing" value="" style="edgeStyle=none;exitX=1;exitY=0.5;entryX=0;entryY=0.5;exitPerimeter=1;entryPerimeter=1;" edge="1" parent="1" source="A" target="B"><mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="200" y="145"/></Array></mxGeometry></mxCell>';
  const result = withXml(xmlDocument(blocker + routedEdge), file => inspect(file));
  assert.ok(result.warnings.some(d => d.phase === 'xml' && d.code === 'ROUTE_OBSTACLE'));
});

test('XML diagnostics identify positive-length shared segments between fixed routes', () => {
  const style = 'edgeStyle=none;exitX=1;exitY=0.5;entryX=0;entryY=0.5;exitPerimeter=1;entryPerimeter=1;';
  const routeA = `<mxCell id="route-a" value="" style="${style}" edge="1" parent="1" source="A" target="B"><mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="200" y="145"/></Array></mxGeometry></mxCell>`;
  const routeB = `<mxCell id="route-b" value="" style="${style}" edge="1" parent="1" source="A" target="B"><mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="250" y="145"/></Array></mxGeometry></mxCell>`;
  const result = withXml(xmlDocument(routeA + routeB), file => inspect(file));
  assert.ok(result.warnings.some(d => d.phase === 'xml' && d.code === 'ROUTE_SHARED_SEGMENT'));
});

test('XML route bounds convert parent-local waypoints back to page coordinates', () => {
  const frame = '<mxCell id="frame" value="" style="shape=rect;" vertex="1" parent="1"><mxGeometry x="100" y="100" width="240" height="180" as="geometry"/></mxCell>';
  const source = '<mxCell id="nested-a" value="A" style="shape=rect;" vertex="1" parent="frame"><mxGeometry x="0" y="20" width="40" height="40" as="geometry"/></mxCell>';
  const target = '<mxCell id="nested-b" value="B" style="shape=rect;" vertex="1" parent="frame"><mxGeometry x="180" y="20" width="40" height="40" as="geometry"/></mxCell>';
  const route = '<mxCell id="nested-route" value="" style="edgeStyle=orthogonalEdgeStyle;" edge="1" parent="frame" source="nested-a" target="nested-b"><mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="100" y="250"/></Array></mxGeometry></mxCell>';
  const result = withXml(xmlDocument(frame + source + target + route), file => inspect(file));
  assert.ok(result.warnings.some(d => d.phase === 'xml' && d.code === 'EDGE_ROUTE_OVERFLOW'));
});

test('class dispatch is a safe registration slot and reports unregistered classes', () => {
  assert.throws(() => renderInput({ type: 'class', classes: [] }), error => error.diagnostics?.some(d => d.code === 'RENDERER_UNREGISTERED'));
  const unregister = registerRenderer('class', data => ({ cells: [{ kind: 'vertex', id: 'class-a', value: data.classes[0].name, style: 'shape=rect;', parent: '1', geometry: { x: 0, y: 0, width: 80, height: 40 } }] }));
  try {
    assert.equal(renderInput({ type: 'class', classes: [{ name: 'Account' }] }).cells[0].id, 'class-a');
  } finally { unregister(); }
  assert.throws(() => renderInput({ type: 'class', classes: [] }), error => error.diagnostics?.some(d => d.code === 'RENDERER_UNREGISTERED'));
});
