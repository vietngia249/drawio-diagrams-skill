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

function declaredPort(cell, prefix, byId) {
  const { x, y, width, height } = pageBounds(cell, byId);
  const matchX = cell.attrs.style.match(new RegExp(`(?:^|;)${prefix}X=([-\\d.]+)`));
  const matchY = cell.attrs.style.match(new RegExp(`(?:^|;)${prefix}Y=([-\\d.]+)`));
  assert.ok(matchX && matchY, `${cell.attrs.id} must declare ${prefix}X and ${prefix}Y`);
  return { x: x + width * Number(matchX[1]), y: y + height * Number(matchY[1]) };
}

function fullRoute(edge, byId) {
  return [declaredPort(byId.get(edge.attrs.source), 'exit', byId), ...points(edge), declaredPort(byId.get(edge.attrs.target), 'entry', byId)];
}

function routeSegments(route) {
  return route.slice(1).map((point, index) => [route[index], point]);
}

function segmentKey([a, b]) {
  const pair = [`${a.x},${a.y}`, `${b.x},${b.y}`].sort();
  return pair.join('|');
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
  const ownedSegments = new Map();
  for (const edge of edges) {
    const route = fullRoute(edge, byId);
    assert.ok(points(edge).length >= 2, `${edge.attrs.id} must have explicit route bends`);
    for (let i = 1; i < route.length; i++) {
      assert.ok(route[i - 1].x === route[i].x || route[i - 1].y === route[i].y,
        `${edge.attrs.id} has a diagonal segment`);
    }
    const styles = edge.attrs.style;
    for (const port of ['exitX', 'exitY', 'entryX', 'entryY']) {
      assert.match(styles, new RegExp(`(?:^|;)${port}=[-\\d.]+(?:;|$)`), `${edge.attrs.id} must declare ${port}`);
    }
    for (const segment of routeSegments(route)) {
      const key = segmentKey(segment);
      assert.ok(!ownedSegments.has(key), `${edge.attrs.id} shares a route segment with ${ownedSegments.get(key)}`);
      ownedSegments.set(key, edge.attrs.id);
      for (const vertex of vertices) {
        if (vertex.attrs.id === edge.attrs.source || vertex.attrs.id === edge.attrs.target) continue;
        assert.ok(!crossesVertex(segment, vertex, byId), `${edge.attrs.id} route crosses unrelated obstacle ${vertex.attrs.id}`);
      }
    }
  }
  assert.ok(edges.some(edge => /another set or exercise remains/.test(edge.attrs.value)), 'guard labels must remain attached to the loop route');
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
  const exitPorts = new Set(), ownedSegments = new Map();
  const obstacles = cells.filter(cell => cell.vertex && cell.attrs.parent === '1' && cell.attrs.id !== 'system_boundary');
  for (const edge of associations) {
    assert.match(edge.attrs.style, /exitX=[-\d.]+/);
    assert.match(edge.attrs.style, /entryX=[-\d.]+/);
    assert.match(edge.attrs.style, /startArrow=none;/);
    assert.match(edge.attrs.style, /endArrow=none;/);
    exitPorts.add(edge.attrs.style.match(/exitY=([^;]+)/)?.[1]);
    assert.ok(points(edge).length >= 2, `${edge.attrs.id} needs an explicit route around other cases and labels`);
    const route = fullRoute(edge, byId);
    for (let i = 1; i < route.length; i++) {
      assert.ok(route[i - 1].x === route[i].x || route[i - 1].y === route[i].y,
        `${edge.attrs.id} has a diagonal segment`);
      const segment = [route[i - 1], route[i]], key = segmentKey(segment);
      assert.ok(!ownedSegments.has(key), `${edge.attrs.id} shares a route segment with ${ownedSegments.get(key)}`);
      ownedSegments.set(key, edge.attrs.id);
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

test('activity fixture preserves branch merge and a real loop-back transition', () => {
  const source = readJson(path.join(fixtures, 'activity-routing.json'));
  const fitTrackActivity = readJson(path.join(root, 'examples/activity.json'));
  assert.ok(source.transitions.some(edge => edge.from === 'planned' && edge.to === 'merge'));
  assert.ok(source.transitions.some(edge => edge.from === 'quick' && edge.to === 'merge'));
  assert.ok(source.transitions.some(edge => edge.from === 'track' && edge.to === 'track'), 'loop must be a directed return transition, not just a loop label');
  assert.ok(fitTrackActivity.transitions.some(edge => edge.from === 'sets' && edge.to === 'local'), 'FitTrackAI repeat must return to the tracking step');
  assert.equal(fitTrackActivity.partitions, undefined, 'source evidence contains no activity partitions');
  const { cells } = render('activity-routing.json');
  const edges = cells.filter(cell => cell.edge && cell.attrs.id.startsWith('transition_'));
  assert.ok(edges.some(edge => edge.attrs.source === 'activity_planned' && edge.attrs.target === 'activity_merge'));
  assert.ok(edges.some(edge => edge.attrs.source === 'activity_quick' && edge.attrs.target === 'activity_merge'));
  assert.ok(edges.some(edge => edge.attrs.source === 'activity_track' && edge.attrs.target === 'activity_track'));
  assert.ok(points(edges.find(edge => edge.attrs.source === 'activity_track' && edge.attrs.target === 'activity_track')).length >= 2,
    'loop-back must leave and return on a visible orthogonal path');
});

test('activity finals retain separate flow-final and activity-final marks', () => {
  const { byId } = render('activity-routing.json');
  assert.ok(byId.has('activity_completed_inner'), 'activity final has an inner mark');
  assert.ok(!byId.has('activity_cancelled_inner'), 'flow final must not get an activity-final inner mark');
  assert.match(byId.get('activity_cancelled').attrs.style, /strokeWidth=1\.5/);
  assert.match(byId.get('activity_cancelled').attrs.value, /×|&#215;/);
});
