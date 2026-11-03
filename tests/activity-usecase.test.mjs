import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cellsFromModel, parseDrawioText } from '../scripts/drawio_xml.mjs';

// Baseline on da52fb0: 6 tests, 3 pass, 3 fail. Captured failures include
// "activity_start must declare exitX and exitY", "relationship_athlete-plans
// needs an explicit route", and "loop-back must leave and return on a visible
// orthogonal path". Actor sizing/labels, no-invented-relations, and distinct
// final-node checks match source evidence and pass before renderer work.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtures = path.join(root, 'tests/fixtures/activity-usecase');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'drawio-activity-usecase-'));
test.after(() => fs.rmSync(temp, { recursive: true, force: true }));

function render(inputName) {
  const input = path.join(fixtures, inputName), output = path.join(temp, `${path.basename(inputName, '.json')}.drawio`);
  const run = spawnSync(process.execPath, ['scripts/render_drawio.mjs', input, '-o', output], { cwd: root, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const cells = cellsFromModel(parseDrawioText(fs.readFileSync(output, 'utf8')).graph);
  return { cells, byId: new Map(cells.map(cell => [cell.attrs.id, cell])), output };
}

function renderWithStyle(inputName, style, fromExamples = false) {
  const input = path.join(fromExamples ? path.join(root, 'examples') : fixtures, inputName);
  const output = path.join(temp, `${path.basename(inputName, '.json')}-styled.drawio`);
  const stylePath = path.join(temp, `${path.basename(inputName, '.json')}-style.json`);
  fs.writeFileSync(stylePath, JSON.stringify(style));
  const run = spawnSync(process.execPath, ['scripts/render_drawio.mjs', input, '-o', output, '--style', stylePath], { cwd: root, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const cells = cellsFromModel(parseDrawioText(fs.readFileSync(output, 'utf8')).graph);
  return { cells, byId: new Map(cells.map(cell => [cell.attrs.id, cell])), output };
}

function renderExample(inputName) {
  const input = path.join(root, 'examples', inputName), output = path.join(temp, `example-${inputName}`);
  const run = spawnSync(process.execPath, ['scripts/render_drawio.mjs', input, '-o', output], { cwd: root, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const cells = cellsFromModel(parseDrawioText(fs.readFileSync(output, 'utf8')).graph);
  return { cells, byId: new Map(cells.map(cell => [cell.attrs.id, cell])), output };
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}

function points(edge) {
  return (edge.geometry.points || []).filter(point => point.as === 'points' || !point.as)
    .map(point => ({ x: Number(point.x), y: Number(point.y) }));
}

function pageBounds(cell, byId) {
  let x = Number(cell.geometry.x), y = Number(cell.geometry.y);
  const width = Number(cell.geometry.width), height = Number(cell.geometry.height);
  let parentId = cell.attrs.parent;
  while (parentId && parentId !== '1') {
    const parent = byId.get(parentId);
    assert.ok(parent, `${cell.attrs.id} has unresolved geometry parent ${parentId}`);
    x += Number(parent.geometry.x);
    y += Number(parent.geometry.y);
    parentId = parent.attrs.parent;
  }
  return { x, y, width, height };
}

function declaredPort(edge, end, byId) {
  const endpointId = edge.attrs[end === 'source' ? 'source' : 'target'];
  const cell = byId.get(endpointId), { x, y, width, height } = pageBounds(cell, byId);
  const prefix = end === 'source' ? 'exit' : 'entry';
  const matchX = edge.attrs.style.match(new RegExp(`(?:^|;)${prefix}X=([-\\d.]+)`));
  const matchY = edge.attrs.style.match(new RegExp(`(?:^|;)${prefix}Y=([-\\d.]+)`));
  assert.ok(matchX && matchY, `${edge.attrs.id} must declare ${prefix}X and ${prefix}Y`);
  return { x: x + width * Number(matchX[1]), y: y + height * Number(matchY[1]) };
}

function fullRoute(edge, byId) {
  return [declaredPort(edge, 'source', byId), ...points(edge), declaredPort(edge, 'target', byId)];
}

function routeSegments(route) {
  return route.slice(1).map((point, index) => [route[index], point]);
}

function overlapsPositiveLength([a, b], [c, d]) {
  if (a.x === b.x && c.x === d.x && a.x === c.x)
    return Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)) < Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y));
  if (a.y === b.y && c.y === d.y && a.y === c.y)
    return Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)) < Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x));
  return false;
}

function overlapsBox(box, vertex, byId) {
  const bounds = pageBounds(vertex, byId);
  return box.x < bounds.x + bounds.width && box.x + box.width > bounds.x &&
    box.y < bounds.y + bounds.height && box.y + box.height > bounds.y;
}

function crossesVertex([a, b], vertex, byId) {
  const { x, y, width: w, height: h } = pageBounds(vertex, byId);
  return a.x === b.x
    ? a.x > x && a.x < x + w && Math.max(a.y, b.y) > y && Math.min(a.y, b.y) < y + h
    : a.y > y && a.y < y + h && Math.max(a.x, b.x) > x && Math.min(a.x, b.x) < x + w;
}

test('activity edges have explicit orthogonal, obstacle-clear routes on distinct tracks', () => {
  const { cells, byId } = render('activity-routing.json');
  const vertices = cells.filter(cell => cell.vertex && cell.attrs.parent === '1');
  const edges = cells.filter(cell => cell.edge && cell.attrs.id.startsWith('transition_'));
  const ownedSegments = [];
  for (const edge of edges) {
    const route = fullRoute(edge, byId);
    assert.match(edge.attrs.style, /edgeStyle=none;/, `${edge.attrs.id} must use its serialized path without automatic rerouting`);
    for (let i = 1; i < route.length; i++) {
      assert.ok(route[i - 1].x === route[i].x || route[i - 1].y === route[i].y,
        `${edge.attrs.id} has a diagonal segment`);
    }
    const styles = edge.attrs.style;
    for (const port of ['exitX', 'exitY', 'entryX', 'entryY']) {
      assert.match(styles, new RegExp(`(?:^|;)${port}=[-\\d.]+(?:;|$)`), `${edge.attrs.id} must declare ${port}`);
    }
    for (const segment of routeSegments(route)) {
      for (const previous of ownedSegments) assert.equal(overlapsPositiveLength(segment, previous.segment), false,
        `${edge.attrs.id} shares a route segment with ${previous.edgeId}`);
      ownedSegments.push({ segment, edgeId: edge.attrs.id });
      for (const vertex of vertices) {
        if (vertex.attrs.id === edge.attrs.source || vertex.attrs.id === edge.attrs.target) continue;
        assert.ok(!crossesVertex(segment, vertex, byId), `${edge.attrs.id} route crosses unrelated obstacle ${vertex.attrs.id}`);
      }
    }
  }
  const loopLabel = byId.get('transition_label_track-local');
  assert.ok(loopLabel, 'guard must have its own measured text cell');
  assert.match(loopLabel.attrs.style, /^text;/);
  assert.match(loopLabel.attrs.value, /another set or exercise remains/);
  assert.ok(Number(loopLabel.geometry.width) > 0 && Number(loopLabel.geometry.height) > 0);
  for (const vertex of vertices) if (vertex.attrs.id !== loopLabel.attrs.id)
    assert.equal(overlapsBox(pageBounds(loopLabel, byId), vertex, byId), false, `loop label overlaps activity node ${vertex.attrs.id}`);
});

test('use-case actors keep native symbol proportions and separate label sizing', () => {
  const { cells, byId } = render('usecase-routing.json');
  const actor = byId.get('actor_athlete'), label = byId.get('actor_label_athlete');
  assert.match(actor.attrs.style, /shape=umlActor;/);
  assert.equal(actor.attrs.parent, '1');
  assert.equal(label.attrs.parent, '1');
  assert.match(label.attrs.style, /^text;/);
  assert.equal(Number(actor.geometry.width), 64, 'FitTrackAI native umlActor width');
  assert.equal(Number(actor.geometry.height), 72, 'FitTrackAI native umlActor height');
  assert.ok(Number(label.geometry.width) > Number(actor.geometry.width), 'long actor label must size its own text cell');
});

test('use-case associations are undirected and use distinct explicit ports and routes', () => {
  const { cells, byId } = render('usecase-routing.json');
  const associations = cells.filter(cell => cell.edge && cell.attrs.id.startsWith('relationship_athlete-'));
  assert.equal(associations.length, 5);
  const exitPorts = new Set(), ownedSegments = [];
  const obstacles = cells.filter(cell => cell.vertex && cell.attrs.id !== 'system_boundary');
  for (const edge of associations) {
    assert.match(edge.attrs.style, /exitX=[-\d.]+/);
    assert.match(edge.attrs.style, /entryX=[-\d.]+/);
    assert.match(edge.attrs.style, /startArrow=none;/);
    assert.match(edge.attrs.style, /endArrow=none;/);
    exitPorts.add(edge.attrs.style.match(/exitY=([^;]+)/)?.[1]);
    const route = fullRoute(edge, byId);
    for (let i = 1; i < route.length; i++) {
      assert.ok(route[i - 1].x === route[i].x || route[i - 1].y === route[i].y,
        `${edge.attrs.id} has a diagonal segment`);
      const segment = [route[i - 1], route[i]];
      for (const previous of ownedSegments) assert.equal(overlapsPositiveLength(segment, previous.segment), false,
        `${edge.attrs.id} shares a route segment with ${previous.edgeId}`);
      ownedSegments.push({ segment, edgeId: edge.attrs.id });
      for (const vertex of obstacles) {
        if (vertex.attrs.id === edge.attrs.source || vertex.attrs.id === edge.attrs.target) continue;
        assert.ok(!crossesVertex(segment, vertex, byId), `${edge.attrs.id} crosses unrelated obstacle/label ${vertex.attrs.id}`);
      }
    }
  }
  assert.equal(exitPorts.size, associations.length, 'one actor needs a distinct port for every association');
});

test('source-backed FitTrackAI use case remains top-level and does not invent include or extend', () => {
  const source = readJson(path.join(root, 'examples/usecase.json'));
  assert.deepEqual(source.relationships.map(row => row.type), Array(5).fill('association'));
  assert.equal(source.actors.length, 1);
  assert.equal(source.useCases.length, 5);
  const { cells } = render('fittrack-usecase.json');
  const associations = cells.filter(cell => cell.edge && cell.attrs.id.startsWith('relationship_'));
  assert.equal(associations.length, 5);
  assert.ok(associations.every(edge => /startArrow=none;/.test(edge.attrs.style) && /endArrow=none;/.test(edge.attrs.style)));
});

test('explicit include, extend, and generalization keep their UML labels and connector styles', () => {
  const { cells, byId } = render('usecase-relations.json');
  assert.match(byId.get('relationship_include-start-plan').attrs.style, /dashed=1;.*endArrow=open;endFill=0;/);
  assert.match(byId.get('relationship_extend-track-history').attrs.style, /dashed=1;.*endArrow=open;endFill=0;/);
  assert.match(byId.get('relationship_generalize-history-plans').attrs.style, /endArrow=block;endFill=0;/);
  assert.match(byId.get('relationship_label_include-start-plan').attrs.value, /«include»/);
  assert.match(byId.get('relationship_label_extend-track-history').attrs.value, /«extend»/);
  assert.ok(cells.filter(cell => cell.edge && cell.attrs.id.startsWith('relationship_')).length === 3);
});

test('activity fixture preserves branch merge and a real loop-back transition', () => {
  const source = readJson(path.join(fixtures, 'activity-routing.json'));
  const fitTrackActivity = readJson(path.join(root, 'examples/activity.json'));
  assert.ok(source.transitions.some(edge => edge.from === 'planned' && edge.to === 'merge'));
  assert.ok(source.transitions.some(edge => edge.from === 'quick' && edge.to === 'merge'));
  assert.ok(source.transitions.some(edge => edge.from === 'local' && edge.to === 'track') && source.transitions.some(edge => edge.from === 'track' && edge.to === 'local'),
    'loop must be a directed path through tracking state and back, not just a loop label');
  assert.ok(fitTrackActivity.transitions.some(edge => edge.from === 'sets' && edge.to === 'local'), 'FitTrackAI repeat must return to the tracking step');
  assert.equal(fitTrackActivity.partitions, undefined, 'source evidence contains no activity partitions');
  const { cells } = render('activity-routing.json');
  const edges = cells.filter(cell => cell.edge && cell.attrs.id.startsWith('transition_'));
  assert.ok(edges.some(edge => edge.attrs.source === 'activity_planned' && edge.attrs.target === 'activity_merge'));
  assert.ok(edges.some(edge => edge.attrs.source === 'activity_quick' && edge.attrs.target === 'activity_merge'));
  assert.ok(edges.some(edge => edge.attrs.source === 'activity_local' && edge.attrs.target === 'activity_track'));
  const loopBack = edges.find(edge => edge.attrs.source === 'activity_track' && edge.attrs.target === 'activity_local');
  assert.ok(loopBack);
  assert.ok(points(loopBack).length >= 1,
    'loop-back must leave and return on a visible orthogonal path');
});

test('source-backed quick and plan alternatives merge before session creation', () => {
  const data = readJson(path.join(root, 'examples', 'activity.json'));
  const { cells, byId } = renderExample('activity.json');
  const merge = byId.get('activity_merge');
  assert.ok(merge?.vertex, 'exclusive quick/plan paths require an explicit merge node');
  assert.match(merge.attrs.style, /rhombus;/);
  const transitions = cells.filter(cell => cell.edge && cell.attrs.id.startsWith('transition_'));
  const incoming = transitions.filter(edge => edge.attrs.target === 'activity_merge').map(edge => edge.attrs.source).sort();
  assert.deepEqual(incoming, ['activity_load', 'activity_manual']);
  assert.ok(transitions.some(edge => edge.attrs.source === 'activity_merge' && edge.attrs.target === 'activity_create'),
    'the merged flow continues into session creation');
  assert.equal(transitions.some(edge => ['activity_load', 'activity_manual'].includes(edge.attrs.source) && edge.attrs.target === 'activity_create'), false,
    'alternative branches must not bypass the merge');
  assert.equal(Object.hasOwn(data, 'partitions'), false);
  assert.equal(data.nodes.some(node => node.partition || node.swimlane), false,
    'the source flow does not declare responsibility partitions');
});

test('activity finals retain separate flow-final and activity-final marks', () => {
  const { byId } = render('activity-routing.json');
  assert.ok(byId.has('activity_completed_inner'), 'activity final has an inner mark');
  assert.ok(!byId.has('activity_cancelled_inner'), 'flow final must not get an activity-final inner mark');
  assert.match(byId.get('activity_cancelled').attrs.style, /strokeWidth=1\.5/);
  assert.match(byId.get('activity_cancelled').attrs.value, /×|&#215;/);
});

test('shared presentation tokens change activity and use-case typography/layout without changing semantics', () => {
  const style = {
    presentation: {
      fontFamily: 'Verdana',
      fontSizes: { body: 20, heading: 22, label: 18, small: 16 },
      spacing: { nodeGap: 40, containerPadding: 30 }
    },
    activity: { action: { fillColor: '#ffeecc', strokeColor: '#123456', strokeWidth: 2 }, edge: { strokeColor: '#345678', strokeWidth: 3 } },
    usecase: { actor: { fillColor: '#ddffdd', strokeColor: '#234567', strokeWidth: 2 }, relationship: { strokeColor: '#456789', strokeWidth: 4 } }
  };

  const activityBefore = render('activity-routing.json'), activityAfter = renderWithStyle('activity-routing.json', style);
  const activitySemantics = cells => cells.filter(cell => cell.edge && cell.attrs.id.startsWith('transition_'))
    .map(cell => [cell.attrs.id, cell.attrs.source, cell.attrs.target, cell.attrs.value]);
  assert.deepEqual(activitySemantics(activityAfter.cells), activitySemantics(activityBefore.cells));
  const actionBefore = activityBefore.cells.find(cell => cell.attrs.id === 'activity_track');
  const actionAfter = activityAfter.byId.get('activity_track');
  assert.match(actionAfter.attrs.style, /fontSize=20;/);
  assert.match(actionAfter.attrs.style, /fontFamily=Verdana;/);
  assert.match(actionAfter.attrs.style, /fillColor=#ffeecc;/);
  assert.match(actionAfter.attrs.style, /strokeColor=#123456;/);
  assert.ok(Number(actionAfter.geometry.width) > Number(actionBefore.geometry.width) || Number(actionAfter.geometry.height) > Number(actionBefore.geometry.height),
    'activity action geometry responds to body typography');
  assert.ok(activityAfter.cells.some(cell => cell.vertex && cell.attrs.id.startsWith('transition_label_') && /fontSize=16;/.test(cell.attrs.style)));
  assert.ok(activityAfter.cells.some(cell => cell.edge && cell.attrs.id.startsWith('transition_') && /strokeColor=#345678;strokeWidth=3;/.test(cell.attrs.style)));

  const usecaseBefore = render('usecase-routing.json'), usecaseAfter = renderWithStyle('usecase-routing.json', style);
  const usecaseSemantics = cells => cells.filter(cell => cell.edge && cell.attrs.id.startsWith('relationship_'))
    .map(cell => [cell.attrs.id, cell.attrs.source, cell.attrs.target, cell.attrs.value, /startArrow=none;endArrow=none;/.test(cell.attrs.style)]);
  assert.deepEqual(usecaseSemantics(usecaseAfter.cells), usecaseSemantics(usecaseBefore.cells));
  const actor = usecaseAfter.byId.get('actor_athlete'), actorLabel = usecaseAfter.byId.get('actor_label_athlete');
  assert.match(actor.attrs.style, /shape=umlActor;/);
  assert.match(actor.attrs.style, /fillColor=#ddffdd;/);
  assert.match(actor.attrs.style, /strokeColor=#234567;strokeWidth=2;/);
  assert.equal(Number(actor.geometry.width) / Number(actor.geometry.height), 64 / 72);
  assert.match(actorLabel.attrs.style, /fontSize=18;/);
  assert.match(usecaseAfter.byId.get('usecase_plans').attrs.style, /fontSize=20;/);
  assert.ok(Number(usecaseAfter.byId.get('usecase_plans').geometry.height) > Number(usecaseBefore.byId.get('usecase_plans').geometry.height),
    'use-case node height responds to body typography');
  assert.match(usecaseAfter.byId.get('relationship_athlete-plans').attrs.style, /strokeColor=#456789;strokeWidth=4;/);
  assert.notEqual(Number(usecaseAfter.byId.get('usecase_history').geometry.y), Number(usecaseBefore.byId.get('usecase_history').geometry.y),
    'use-case row placement responds to shared node spacing');
});
