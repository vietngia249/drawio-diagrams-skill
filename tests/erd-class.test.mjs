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
const text = value => String(value ?? '').replace(/<br\s*\/?\s*>/gi, '\n').replace(/<[^>]*>/g, '');

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
  const tracks = [];
  for (const edge of edges) {
    const points = edge.geometry.points.filter(point => !point.as || point.as === 'points').map(point => ({ x: Number(point.x), y: Number(point.y) }));
    assert.ok(points.length >= 2, `${edge.attrs.id} must serialize its explicit route instead of relying on automatic routing`);
    const route = [edge.geometry.sourcePoint, ...points, edge.geometry.targetPoint].filter(Boolean).map(point => ({ x: Number(point.x), y: Number(point.y) }));
    assert.ok(route.every((point, index) => index === 0 || point.x === route[index - 1].x || point.y === route[index - 1].y), `${edge.attrs.id} is orthogonal`);
    for (let i = 1; i < route.length; i++) {
      const a = route[i - 1], b = route[i];
      if (a.x === b.x && a.y !== b.y || a.y === b.y && a.x !== b.x) tracks.push({ edge: edge.attrs.id, a, b });
    }
    assert.ok(vertexById.has(edge.attrs.source) && vertexById.has(edge.attrs.target));
  }
  for (let i = 0; i < tracks.length; i++) for (let j = i + 1; j < tracks.length; j++) {
    if (tracks[i].edge === tracks[j].edge) continue;
    const a = tracks[i], b = tracks[j];
    const horizontal = a.a.y === a.b.y && b.a.y === b.b.y && a.a.y === b.a.y;
    const vertical = a.a.x === a.b.x && b.a.x === b.b.x && a.a.x === b.a.x;
    if (horizontal || vertical) {
      const aMin = horizontal ? Math.min(a.a.x, a.b.x) : Math.min(a.a.y, a.b.y), aMax = horizontal ? Math.max(a.a.x, a.b.x) : Math.max(a.a.y, a.b.y);
      const bMin = horizontal ? Math.min(b.a.x, b.b.x) : Math.min(b.a.y, b.b.y), bMax = horizontal ? Math.max(b.a.x, b.b.x) : Math.max(b.a.y, b.b.y);
      assert.ok(Math.min(aMax, bMax) <= Math.max(aMin, bMin), `${a.edge} and ${b.edge} share a positive-length route segment`);
    }
  }
  const entities = vertices.filter(cell => /^ent_/.test(cell.attrs.id) && !/_attr_\d+$/.test(cell.attrs.id));
  for (const label of vertices.filter(cell => /^rel_label_/.test(cell.attrs.id))) for (const entity of entities) {
    const a = label.geometry, b = entity.geometry;
    const overlaps = Number(a.x) < Number(b.x) + Number(b.width) && Number(a.x) + Number(a.width) > Number(b.x) && Number(a.y) < Number(b.y) + Number(b.height) && Number(a.y) + Number(a.height) > Number(b.y);
    assert.equal(overlaps, false, `${label.attrs.id} must not collide with ${entity.attrs.id}`);
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
  assert.ok(styles.some(style => /endArrow=diamondThin/.test(style) && /endFill=0/.test(style)), 'aggregation has a hollow diamond');
  assert.ok(styles.some(style => /endArrow=diamondThin/.test(style) && /endFill=1/.test(style)), 'composition has a filled diamond');
  assert.ok(styles.some(style => /endArrow=block/.test(style) && /endFill=0/.test(style)), 'generalization has a hollow triangle');
  const association = cells.find(cell => cell.edge && cell.attrs.id === 'association');
  assert.match(association.attrs.value, /creator/);
  assert.match(association.attrs.value, /workouts/);
  assert.match(association.attrs.value, /1/);
  assert.match(association.attrs.value, /0\.\.\*/);
});

test('WorkoutsService example remains a class diagram with source-grounded methods and no invented inheritance', () => {
  const input = JSON.parse(fs.readFileSync(path.join(root, 'examples/class.json'), 'utf8'));
  assert.equal(input.type, 'class');
  const service = input.classes.find(item => item.id === 'WorkoutsService');
  assert.deepEqual(service.attributes.map(attribute => [attribute.name, attribute.type, attribute.visibility]), [['db', 'PrismaClient', 'private']]);
  assert.deepEqual(service.operations.map(operation => operation.name), ['constructor', 'createPlan', 'listPlans', 'getPlanById', 'deletePlan', 'startSession', 'getSessionById', 'logSet', 'completeSession', 'listSessions']);
  assert.equal(input.relationships.some(relation => relation.type === 'generalization' || relation.type === 'realization'), false);
  const { cells } = render(path.relative(fixtureRoot, path.join(root, 'examples/class.json')));
  assert.ok(cells.some(cell => cell.vertex && text(cell.attrs.value).includes('WorkoutsService')));
  assert.ok(cells.some(cell => cell.vertex && text(cell.attrs.value).includes('createPlan')));
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
