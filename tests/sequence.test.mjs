import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { docXml, htmlText } from '../scripts/common.mjs';
import { cellsFromModel, parseDrawioText } from '../scripts/drawio_xml.mjs';
import { renderSequence } from '../scripts/sequence.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = name => JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/sequence', name), 'utf8'));
const parseCells = xml => cellsFromModel(parseDrawioText(xml).graph);
const renderCells = data => renderSequence(data, {});
const renderModel = data => parseCells(docXml(data.title || 'Sequence regression', renderCells(data), data.page));
const byId = cells => new Map(cells.map(cell => [cell.attrs.id, cell]));
const geom = cell => Object.fromEntries(['x', 'y', 'width', 'height'].map(key => [key, Number(cell.geometry[key] || 0)]));
const points = edge => edge.geometry.points.filter(point => !point.as || point.as === 'points').map(point => ({ x: Number(point.x), y: Number(point.y) }));
const endpoint = (edge, end) => {
  const point = edge.geometry.points.find(candidate => candidate.as === `${end}Point`);
  return point && { x: Number(point.x), y: Number(point.y) };
};
const isOrthogonal = (a, b) => a.x === b.x || a.y === b.y;
const segmentsFor = (edge, cells) => {
  const route = [endpoint(edge, 'source'), ...points(edge), endpoint(edge, 'target')];
  return route.slice(1).map((point, index) => [route[index], point]);
};
const segmentKey = ([a, b]) => `${Math.min(a.x, b.x)},${Math.min(a.y, b.y)}:${Math.max(a.x, b.x)},${Math.max(a.y, b.y)}`;
const fitTrack = () => fixture('fittrackai-utf8.json');

test('sequence round-trips Unicode participant labels and XML-sensitive text through draw.io XML', () => {
  const data = fitTrack();
  data.participants[0].label = 'Giao diện <người tập> & ActiveWorkoutSession';
  const cells = renderModel(data);
  const participant = cells.find(cell => cell.attrs.id === 'participant_header_0');
  assert.ok(participant.attrs.value.includes('diện'));
  assert.ok(participant.attrs.value.includes('&lt;người tập&gt;'));
  assert.ok(participant.attrs.value.includes('&amp;'));
  assert.equal(participant.attrs.value.replaceAll('<br>', ' '), htmlText(data.participants[0].label).replaceAll('<br>', ' '));
});

test('participant header wraps long Unicode titles and grows beyond its minimum height', () => {
  const data = { type: 'sequence', participants: [
    { id: 'ui', label: 'Giao diện người dùng có tên dài vượt quá vùng tiêu đề chuẩn\nActiveWorkoutSession' },
    { id: 'api', label: 'API' }
  ], messages: [] };
  const cells = renderModel(data), participant = cells.find(cell => cell.attrs.id === 'participant_header_0');
  const header = geom(participant);
  assert.ok(header.width >= 180, 'header should expand within its sizing bounds');
  assert.ok(header.height >= 70, 'a capped header width should wrap the title and increase height');
});

test('long sequence message labels have bounds for their wrapped lines', () => {
  const data = fitTrack();
  data.messages = [{ from: 'ui', to: 'api', kind: 'sync', label: 'Gửi yêu cầu hoàn tất buổi tập cùng dữ liệu bài tập, thời lượng và toàn bộ các hiệp đã lưu cho phiên luyện tập hiện tại' }];
  const label = renderModel(data).find(cell => cell.attrs.id === 'message_label_0');
  const labelBounds = geom(label);
  assert.ok(labelBounds.height >= 36, 'wrapped message label needs line-height space');
  assert.ok(labelBounds.width >= 180, 'message label needs its measured minimum width');
});

test('participants use the native UML lifeline shape and have visible lifeline stems', () => {
  const cells = renderModel(fitTrack());
  const participants = cells.filter(cell => /^participant_header_\d+$/.test(cell.attrs.id));
  assert.equal(participants.length, 4);
  for (const participant of participants) assert.match(participant.attrs.style, /(?:^|;)shape=umlLifeline(?:;|$)/);
  for (let index = 0; index < 4; index++) assert.ok(cells.some(cell => cell.attrs.id === `participant_${index}` && /dashed=1/.test(cell.attrs.style)), `participant ${index} should be a semantic lifeline endpoint`);
});

test('FitTrackAI example documents only the source-backed successful completion scenario', () => {
  const example = JSON.parse(fs.readFileSync(path.join(root, 'examples/sequence.json'), 'utf8'));
  assert.deepEqual(example.participants.map(participant => participant.id), ['ui', 'api', 'svc', 'db']);
  assert.equal(example.fragments.length, 0, 'the referenced sequence is a single successful path, not a conditional fragment');
  assert.ok(example.messages.every(message => ['sync', 'return'].includes(message.kind)));
  assert.ok(example.messages.some(message => message.label.startsWith('200 JSON')));
});

test('activation bars are absent unless activation timing is supported by source evidence', () => {
  const cells = renderModel(fitTrack());
  assert.equal(cells.filter(cell => /activation/i.test(`${cell.attrs.id} ${cell.attrs.style}`)).length, 0,
    'the supplied FitTrackAI evidence has no activation timing; renderer should not invent activation bars');
});

test('self-call route has orthogonal clearance and its label is a separately associated cell', () => {
  const data = fitTrack(), cells = renderModel(data), edges = cells.filter(cell => cell.edge && cell.attrs.id.startsWith('message_'));
  const selfIndex = data.messages.findIndex(message => message.from === message.to);
  const edgeCell = edges.find(edge => edge.attrs.id === `message_${selfIndex}`);
  const route = segmentsFor(edgeCell, cells);
  assert.ok(route.length >= 3, 'self-call needs a visible loop extending out and returning to its lifeline');
  for (const segment of route) assert.ok(isOrthogonal(...segment), 'each self-call segment should be horizontal or vertical');
  const label = cells.find(cell => cell.attrs.id === `message_label_${selfIndex}`);
  assert.ok(label?.vertex && label.attrs.value, 'self-call label should be rendered as its own text cell');
  assert.equal(edgeCell.attrs.value, '', 'message text should not be embedded on the route edge');
  const labelBounds = geom(label);
  const trackX = route[0][1].x;
  const labelGap = trackX < labelBounds.x ? labelBounds.x - trackX : trackX - (labelBounds.x + labelBounds.width);
  assert.ok(Number.isFinite(trackX) && labelGap >= 8, 'self-call label should sit beside its outside loop with clearance');
});

test('combined fragment conditions appear only when the input justifies a fragment', () => {
  const data = fitTrack();
  assert.equal(data.fragments.length, 0);
  const cells = renderModel(data);
  assert.equal(cells.filter(cell => /umlFrame/.test(cell.attrs.style)).length, 0);
  assert.equal(cells.filter(cell => /_guard_/.test(cell.attrs.id)).length, 0);

  data.fragments = [{ kind: 'alt', branches: [
    { guard: '[request is valid]', messages: [{ from: 'ui', to: 'api', label: 'Continue' }] },
    { guard: '[request is invalid]', messages: [{ from: 'api', to: 'ui', label: 'Reject', kind: 'return' }] }
  ] }];
  const justified = renderModel(data);
  assert.ok(justified.some(cell => /(?:^|;)shape=umlFrame(?:;|$)/.test(cell.attrs.style)));
  assert.ok(justified.some(cell => /_guard_/.test(cell.attrs.id) && cell.attrs.value.includes('request is valid')));
});

test('every sequence message route uses only orthogonal bends', () => {
  const cells = renderModel(fitTrack()), edges = cells.filter(cell => cell.edge && cell.attrs.id.startsWith('message_'));
  for (const edge of edges) for (const segment of segmentsFor(edge, cells)) {
    assert.ok(isOrthogonal(...segment), `${edge.attrs.id} contains a diagonal segment ${JSON.stringify(segment)}`);
  }
});

test('parallel and reverse messages use distinct semantic ports and route lanes', () => {
  const data = {
    type: 'sequence', participants: ['A', 'B'], messages: [
      { from: 'A', to: 'B', label: 'parallel one' },
      { from: 'A', to: 'B', label: 'parallel two' },
      { from: 'B', to: 'A', label: 'reverse one' },
      { from: 'B', to: 'A', label: 'reverse two' }
    ]
  };
  const cells = renderModel(data), edges = cells.filter(cell => cell.edge && cell.attrs.id.startsWith('message_'));
  assert.equal(edges.length, 4);
  for (const edge of edges) {
    assert.ok(/^participant_/.test(edge.attrs.source), 'message source should be its semantic participant');
    assert.ok(/^participant_/.test(edge.attrs.target), 'message target should be its semantic participant');
    assert.ok(endpoint(edge, 'source') && endpoint(edge, 'target'), 'each message end should declare an explicit port point');
  }
  assert.equal(new Set(edges.map(edge => JSON.stringify([endpoint(edge, 'source'), endpoint(edge, 'target')]))).size, 4,
    'parallel and reverse messages should have distinct endpoint ports');
  const tracks = edges.map(edge => JSON.stringify([endpoint(edge, 'source'), points(edge), endpoint(edge, 'target')]));
  assert.equal(new Set(tracks).size, tracks.length, 'parallel and reverse messages need separate tracks');
});

test('unrelated sequence messages do not share route segments', () => {
  const cells = renderModel({ type: 'sequence', participants: ['A', 'B', 'C'], messages: [
    { from: 'A', to: 'C', label: 'wide call' }, { from: 'A', to: 'B', label: 'near call' },
    { from: 'C', to: 'A', label: 'wide return', kind: 'return' }
  ] });
  const edges = cells.filter(cell => cell.edge && cell.attrs.id.startsWith('message_'));
  const segmentSets = edges.map(edge => new Set(segmentsFor(edge, cells).map(segmentKey)));
  for (let left = 0; left < segmentSets.length; left++) for (let right = left + 1; right < segmentSets.length; right++) {
    for (const segment of segmentSets[left]) assert.ok(!segmentSets[right].has(segment), `edges ${left} and ${right} share segment ${segment}`);
  }
});

test('planned sequence geometry is the geometry preserved by draw.io export serialization', () => {
  const data = fitTrack(), plannedCells = renderCells(data), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-geometry-'));
  const input = path.join(temp, 'input.json'), output = path.join(temp, 'output.drawio');
  fs.writeFileSync(input, JSON.stringify(data), 'utf8');
  const run = spawnSync(process.execPath, ['scripts/render_drawio.mjs', input, '-o', output], { cwd: root, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const planned = byId(parseCells(docXml(data.title, plannedCells, data.page)));
  const exported = byId(parseCells(fs.readFileSync(output, 'utf8')));
  assert.deepEqual([...exported.keys()].sort(), [...planned.keys()].sort());
  for (const [id, cell] of planned) {
    assert.deepEqual(exported.get(id).geometry, cell.geometry, `export changed planned geometry for ${id}`);
  }
  fs.rmSync(temp, { recursive: true, force: true });
});

test('source-input corruption is distinct from renderer Unicode preservation', () => {
  const corrupted = fixture('fittrackai-source-corrupted.json');
  const corrected = fixture('fittrackai-utf8.json');
  assert.equal(corrupted.participants[0].label.split('\n')[0], 'Giao di?n', 'source fixture records the literal question mark already present upstream');
  assert.equal(corrected.participants[0].label.split('\n')[0], 'Giao diện');
  const participant = renderModel(corrected).find(cell => cell.attrs.id === 'participant_header_0');
  assert.equal(participant.attrs.value, 'Giao diện<br>ActiveWorkoutSession');
});
