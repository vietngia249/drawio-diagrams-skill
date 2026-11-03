import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cellsFromModel, parseDrawioText } from '../scripts/drawio_xml.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtureRoot = path.join(root, 'tests/fixtures/erd-class');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'drawio-erd-class-'));
test.after(() => fs.rmSync(temp, { recursive: true, force: true }));

function render(inputName, outputName = `${path.basename(inputName, '.json')}.drawio`) {
  const input = path.join(fixtureRoot, inputName), output = path.join(temp, outputName);
  const result = spawnSync(process.execPath, ['scripts/render_drawio.mjs', input, '-o', output], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return { cells: cellsFromModel(parseDrawioText(fs.readFileSync(output, 'utf8')).graph), output, stdout: result.stdout };
}

const byId = cells => new Map(cells.map(cell => [cell.attrs.id, cell]));
const text = value => String(value ?? '').replace(/<br\s*\/?\s*>/gi, '\n').replace(/<[^>]*>/g, '').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');
const styleNumber = (style, key) => Number(style.match(new RegExp(`(?:^|;)${key}=([^;]+)`))?.[1]);
function portPoint(edge, cell, end) {
  const geometry = cell.geometry, x = styleNumber(edge.attrs.style, `${end === 'source' ? 'exit' : 'entry'}X`), y = styleNumber(edge.attrs.style, `${end === 'source' ? 'exit' : 'entry'}Y`);
  return { x: Number(geometry.x) + Number(geometry.width) * x, y: Number(geometry.y) + Number(geometry.height) * y };
}
function segmentHitsRect(a, b, box) {
  box = Object.fromEntries(['x', 'y', 'width', 'height'].map(key => [key, Number(box[key])]));
  if (a.x === b.x) return a.x > box.x && a.x < box.x + box.width && Math.max(Math.min(a.y, b.y), box.y) < Math.min(Math.max(a.y, b.y), box.y + box.height);
  return a.y === b.y && a.y > box.y && a.y < box.y + box.height && Math.max(Math.min(a.x, b.x), box.x) < Math.min(Math.max(a.x, b.x), box.x + box.width);
}

test('ERD keeps PK/FK type and nullable notation in physical attribute rows with row endpoints', () => {
  const { cells } = render('erd-routing-stress.json');
  const memberId = cells.find(cell => cell.vertex && cell.attrs.id.startsWith('ent_Member_') && text(cell.attrs.value) === '[PK] id : UUID');
  const accountOwner = cells.find(cell => cell.vertex && cell.attrs.id.startsWith('ent_Account_') && text(cell.attrs.value) === '[FK] secondaryOwnerId : UUID?');
  assert.ok(memberId, 'primary-key attribute keeps its type in its own row');
  assert.ok(accountOwner, 'nullable foreign-key type remains visible');
  const owner = cells.find(cell => cell.edge && cell.attrs.id === 'rel_2');
  assert.equal(owner.attrs.source, memberId.attrs.id);
  assert.equal(owner.attrs.target, accountOwner.attrs.id);
  const ownerStyle = owner.attrs.style;
  assert.match(ownerStyle, /startArrow=ERzeroToMany/);
  assert.match(ownerStyle, /endArrow=ERzeroToOne/);
  assert.match(ownerStyle, /exitX=\d+(?:\.\d+)?/);
  assert.match(ownerStyle, /entryX=\d+(?:\.\d+)?/);
});

test('ERD rejects invalid optional cardinality and unresolved endpoint attributes without output', () => {
  const input = JSON.parse(fs.readFileSync(path.join(fixtureRoot, 'erd-routing-stress.json'), 'utf8'));
  input.relations[0].toCardinality = '0..2';
  const invalid = path.join(temp, 'invalid-cardinality.json'), invalidOut = path.join(temp, 'invalid-cardinality.drawio');
  fs.writeFileSync(invalid, JSON.stringify(input));
  let result = spawnSync(process.execPath, ['scripts/render_drawio.mjs', invalid, '-o', invalidOut], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 2, 'unsupported cardinality must fail rendering');
  assert.equal(fs.existsSync(invalidOut), false, 'invalid cardinality must not leave a partial diagram');

  input.relations[0].toCardinality = '0..*';
  input.relations[0].toAttribute = 'missing';
  const badEndpoint = path.join(temp, 'invalid-endpoint.json'), endpointOut = path.join(temp, 'invalid-endpoint.drawio');
  fs.writeFileSync(badEndpoint, JSON.stringify(input));
  result = spawnSync(process.execPath, ['scripts/render_drawio.mjs', badEndpoint, '-o', endpointOut], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 2, 'unknown endpoint attribute must fail rendering');
  assert.equal(fs.existsSync(endpointOut), false);
});

test('dense ERD routes keep distinct explicit tracks and clear entity rows and relation labels', () => {
  const { cells } = render('erd-routing-stress.json');
  const vertices = cells.filter(cell => cell.vertex), edges = cells.filter(cell => cell.edge), vertexById = byId(cells);
  assert.equal(edges.length, 8);
  const tracks = [], endpointPorts = new Map();
  for (const edge of edges) {
    const points = edge.geometry.points.filter(point => !point.as || point.as === 'points').map(point => ({ x: Number(point.x), y: Number(point.y) }));
    assert.ok(points.length >= 2, `${edge.attrs.id} must serialize its explicit route instead of relying on automatic routing`);
    const source = vertexById.get(edge.attrs.source), target = vertexById.get(edge.attrs.target);
    const route = [portPoint(edge, source, 'source'), ...points, portPoint(edge, target, 'target')];
    for (const [end, cell] of [['source', source], ['target', target]]) {
      const x = styleNumber(edge.attrs.style, `${end === 'source' ? 'exit' : 'entry'}X`), y = styleNumber(edge.attrs.style, `${end === 'source' ? 'exit' : 'entry'}Y`);
      const side = x === 0 ? 'west' : x === 1 ? 'east' : y === 0 ? 'north' : 'south', key = `${cell.attrs.id}:${side}`;
      if (!endpointPorts.has(key)) endpointPorts.set(key, []);
      endpointPorts.get(key).push({ edge: edge.attrs.id, point: portPoint(edge, cell, end) });
    }
    assert.ok(route.every((point, index) => index === 0 || point.x === route[index - 1].x || point.y === route[index - 1].y), `${edge.attrs.id} is orthogonal`);
    for (let i = 1; i < route.length; i++) {
      const a = route[i - 1], b = route[i];
      for (const obstacle of vertices) {
        const box = Object.fromEntries(['x', 'y', 'width', 'height'].map(key => [key, Number(obstacle.geometry[key])]));
        assert.equal(segmentHitsRect(a, b, box), false, `${edge.attrs.id} crosses row or label ${obstacle.attrs.id}`);
      }
      if (a.x === b.x && a.y !== b.y || a.y === b.y && a.x !== b.x) tracks.push({ edge: edge.attrs.id, a, b });
    }
    assert.ok(vertexById.has(edge.attrs.source) && vertexById.has(edge.attrs.target));
  }
  for (const [key, ports] of endpointPorts) for (let i = 0; i < ports.length; i++) for (let j = i + 1; j < ports.length; j++) {
    const verticalSide = key.endsWith(':west') || key.endsWith(':east'), separation = Math.abs(verticalSide ? ports[i].point.y - ports[j].point.y : ports[i].point.x - ports[j].point.x);
    assert.ok(separation >= 5, `${key} endpoints ${ports[i].edge}/${ports[j].edge} are only ${separation}px apart`);
  }
  for (let i = 0; i < tracks.length; i++) for (let j = i + 1; j < tracks.length; j++) {
    if (tracks[i].edge === tracks[j].edge) continue;
    const a = tracks[i], b = tracks[j];
    const horizontal = a.a.y === a.b.y && b.a.y === b.b.y, vertical = a.a.x === a.b.x && b.a.x === b.b.x;
    if (horizontal || vertical) {
      const aMin = horizontal ? Math.min(a.a.x, a.b.x) : Math.min(a.a.y, a.b.y), aMax = horizontal ? Math.max(a.a.x, a.b.x) : Math.max(a.a.y, a.b.y);
      const bMin = horizontal ? Math.min(b.a.x, b.b.x) : Math.min(b.a.y, b.b.y), bMax = horizontal ? Math.max(b.a.x, b.b.x) : Math.max(b.a.y, b.b.y);
      const overlap = Math.min(aMax, bMax) - Math.max(aMin, bMin);
      if (overlap > 0) assert.ok(Math.abs(horizontal ? a.a.y - b.a.y : a.a.x - b.a.x) >= 5, `${a.edge} and ${b.edge} have less than 4px visible gap over ${overlap}px of parallel routing: ${JSON.stringify({a,b})}`);
    }
  }
  const entities = vertices.filter(cell => /^ent_/.test(cell.attrs.id) && !/_attr_\d+$/.test(cell.attrs.id));
  for (const label of vertices.filter(cell => /^rel_label_/.test(cell.attrs.id))) {
    for (const segment of tracks) assert.equal(segmentHitsRect(segment.a, segment.b, label.geometry), false, `${label.attrs.id} must not collide with ${segment.edge} ${JSON.stringify(segment)} / ${JSON.stringify(label.geometry)}`);
    for (const entity of entities) {
      const a = label.geometry, b = entity.geometry;
      const overlaps = Number(a.x) < Number(b.x) + Number(b.width) && Number(a.x) + Number(a.width) > Number(b.x) && Number(a.y) < Number(b.y) + Number(b.height) && Number(a.y) + Number(a.height) > Number(b.y);
      assert.equal(overlaps, false, `${label.attrs.id} must not collide with ${entity.attrs.id}`);
    }
  }
});

test('class rendering preserves typed UML compartments, visibility, parameters, return types, and relation meanings', () => {
  const { cells } = render('class-notation.json');
  const labels = cells.filter(cell => cell.vertex).map(cell => text(cell.attrs.value));
  assert.ok(labels.some(value => value.includes('<<interface>>') && value.includes('IRepository')));
  assert.ok(labels.some(value => value.includes('- repository : IRepository')));
  assert.ok(labels.some(value => value.includes('+ create(input : CreateWorkoutInput, ownerId : string) : Promise<Workout>')));
  const styles = cells.filter(cell => cell.edge).map(cell => cell.attrs.style);
  assert.equal(styles.length, 6);
  assert.ok(styles.some(style => /dashed=1/.test(style) && /endArrow=block/.test(style) && /endFill=0/.test(style)), 'realization has a dashed hollow generalization arrow');
  assert.ok(styles.some(style => /dashed=1/.test(style) && /endArrow=open/.test(style)), 'dependency has a dashed open arrow');
  assert.ok(styles.some(style => /startArrow=diamondThin/.test(style) && /startFill=0/.test(style)), 'aggregation marks its source whole with a hollow diamond');
  assert.ok(styles.some(style => /startArrow=diamondThin/.test(style) && /startFill=1/.test(style)), 'composition marks its source whole with a filled diamond');
  assert.ok(styles.some(style => /endArrow=block/.test(style) && /endFill=0/.test(style)), 'generalization has a hollow triangle');
  const associationLabels = cells.filter(cell => cell.vertex && /association_(?:source|target)_role/.test(cell.attrs.id)).map(cell => text(cell.attrs.value));
  assert.ok(associationLabels.some(value => value.includes('creator') && value.includes('1')));
  assert.ok(associationLabels.some(value => value.includes('workouts') && value.includes('0..*')));
});

test('WorkoutsService example remains a class diagram with source-grounded methods and no invented inheritance', () => {
  const input = JSON.parse(fs.readFileSync(path.join(root, 'examples/class.json'), 'utf8'));
  assert.equal(input.type, 'class');
  const service = input.classes.find(item => item.id === 'WorkoutsService');
  assert.deepEqual(service.attributes.map(attribute => [attribute.name, attribute.type, attribute.visibility]), [['db', 'PrismaClient', 'private']]);
  assert.deepEqual(service.operations.map(operation => operation.name), ['constructor', 'createPlan', 'listPlans', 'getPlanById', 'deletePlan', 'startSession', 'getSessionById', 'logSet', 'completeSession', 'listSessions']);
  assert.deepEqual(service.operations.find(operation => operation.name === 'startSession').parameters.map(parameter => [parameter.name, parameter.type]), [['userId', 'string'], ['input', 'StartWorkoutSessionInput']]);
  assert.ok(service.operations.every(operation => operation.returnType == null), 'methods with inferred TypeScript return types should omit unsupported return signatures');
  assert.equal(input.relationships.some(relation => relation.type === 'generalization' || relation.type === 'realization'), false);
  const { cells } = render(path.relative(fixtureRoot, path.join(root, 'examples/class.json')));
  assert.ok(cells.some(cell => cell.vertex && text(cell.attrs.value).includes('WorkoutsService')));
  assert.ok(cells.some(cell => cell.vertex && text(cell.attrs.value).includes('createPlan')));
});

test('FitTrackAI ERD example matches Prisma PostgreSQL physical types, nullable plan FK, and cardinality', () => {
  const input = JSON.parse(fs.readFileSync(path.join(root, 'examples/erd.json'), 'utf8'));
  const entities = Object.fromEntries(input.entities.map(entity => [entity.name, entity]));
  const session = input.entities.find(entity => entity.name === 'WorkoutSession');
  const fields = Object.fromEntries(session.attributes.map(attribute => [attribute.name, attribute]));
  assert.deepEqual([fields.id.type, fields.planId.type, fields.startedAt.type, fields.totalVolumeKg.type, fields.durationSeconds.type], ['TEXT', 'TEXT NULL', 'TIMESTAMP(3)', 'DOUBLE PRECISION', 'INTEGER']);
  assert.equal(fields.planId.key, 'FK');
  const plan = input.relations.find(relation => relation.from === 'WorkoutPlan' && relation.to === 'WorkoutSession');
  assert.equal(plan.fromCardinality, '0..1');
  assert.equal(plan.toCardinality, '0..*');
  assert.equal(plan.toAttribute, 'planId');
  assert.ok(entities.WorkoutPlan.attributes.some(attribute => attribute.name === 'createdAt' && attribute.type === 'TIMESTAMP(3)'));
  assert.ok(entities.Exercise.attributes.some(attribute => attribute.name === 'primaryMuscles' && attribute.type === 'TEXT[]'));
  assert.ok(entities.WorkoutPlanExercise.attributes.some(attribute => attribute.name === 'restSeconds' && attribute.type === 'INTEGER'));
  const owner = input.relations.find(relation => relation.from === 'User' && relation.to === 'Exercise');
  assert.equal(owner.fromCardinality, '0..1');
  assert.equal(owner.toCardinality, '0..*');
  assert.equal(owner.toAttribute, 'userId');
});

test('ERD and UML class diagrams serialize different semantic node and relationship models', () => {
  const erd = render('../acceptance/erd.json', 'semantic-erd.drawio').cells;
  const uml = render(path.relative(fixtureRoot, path.join(root, 'examples/class.json')), 'semantic-class.drawio').cells;
  assert.ok(erd.some(cell => cell.vertex && /\[PK\]/.test(cell.attrs.value)));
  assert.ok(erd.some(cell => cell.edge && /ERone|ERzeroTo/.test(cell.attrs.style)));
  assert.ok(uml.some(cell => cell.vertex && /<<class>>|WorkoutsService/.test(cell.attrs.value)));
  assert.ok(uml.some(cell => cell.edge && /dashed=1/.test(cell.attrs.style)));
  assert.equal(uml.some(cell => cell.vertex && /\[PK\]|\[FK\]/.test(cell.attrs.value)), false);
});
