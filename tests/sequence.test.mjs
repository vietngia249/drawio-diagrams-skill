import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { docXml, htmlText, serializeCells } from '../scripts/common.mjs';
import { cellsFromModel, parseDrawioText } from '../scripts/drawio_xml.mjs';
import { renderInput } from '../scripts/render_drawio.mjs';
import { renderSequence } from '../scripts/sequence.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = name => JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/sequence', name), 'utf8'));
const parseCells = xml => cellsFromModel(parseDrawioText(xml).graph);
const renderCells = (data, style = {}) => renderSequence(data, style).cells;
const renderModel = (data, style = {}) => parseCells(docXml(data.title || 'Sequence regression', serializeCells(renderCells(data, style)), data.page));
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

test('sequence renderer returns the shared model contract and applies presentation tokens without changing notation', () => {
  const data = {
    type: 'sequence', participants: [{ id: 'actor', label: 'Actor', shape: 'umlActor' }, 'Service'],
    messages: [
      { kind: 'sync', from: 'actor', to: 'Service', label: 'Call' },
      { kind: 'async', from: 'Service', to: 'actor', label: 'Signal' },
      { kind: 'return', from: 'actor', to: 'Service', label: 'Reply' },
      { kind: 'sync', from: 'Service', to: 'Service', label: 'Self call' }
    ],
    fragments: [{ kind: 'alt', branches: [
      { guard: '[valid]', messages: [{ kind: 'sync', from: 'actor', to: 'Service', label: 'Accept' }] },
      { guard: '[invalid]', messages: [{ kind: 'return', from: 'Service', to: 'actor', label: 'Reject' }] }
    ] }]
  };
  const tokens = {
    fontFamily: 'Georgia', fontSizes: { heading: 20, body: 15, label: 18 },
    colors: { stroke: '#154360', fill: '#f7f9f9', mutedStroke: '#607d8b' }, strokeWidth: 3,
    label: { paddingX: 11, paddingY: 5, background: '#fff8e1' },
    spacing: { nodeGap: 46, containerPadding: 38, routeClearance: 15, laneSpacing: 26 },
    selfMessage: { width: 42, height: 30, offset: 20, trackGap: 14 }
  };
  const standard = renderSequence(data, {}), themed = renderSequence(data, { presentation: tokens });
  assert.ok(Array.isArray(themed.cells), 'renderer should return shared model cells');
  assert.deepEqual(themed.diagnostics, []);
  const cells = themed.cells, byModelId = new Map(cells.map(cell => [cell.id, cell]));
  assert.match(byModelId.get('participant_header_0').style, /shape=umlActor/);
  assert.deepEqual([byModelId.get('participant_header_0').geometry.width, byModelId.get('participant_header_0').geometry.height], [64, 72],
    'the native UML actor retains its 64:72 stencil proportions');
  assert.match(byModelId.get('participant_header_1').style, /shape=umlLifeline/);
  assert.match(byModelId.get('participant_header_1').style, /fontFamily=Georgia/);
  assert.match(byModelId.get('participant_header_1').style, /fontSize=20/);
  assert.match(byModelId.get('participant_header_1').style, /strokeColor=#607d8b/);
  assert.match(byModelId.get('participant_header_1').style, /strokeWidth=3/);
  assert.match(byModelId.get('message_label_0').style, /fillColor=#fff8e1/);
  assert.match(byModelId.get('message_label_0').style, /fontSize=18/);
  assert.ok(byModelId.get('participant_1').geometry.x > standard.cells.find(cell => cell.id === 'participant_1').geometry.x,
    'nodeGap token should move later participants');
  assert.notDeepEqual(byModelId.get('message_3').geometry.points, standard.cells.find(cell => cell.id === 'message_3').geometry.points,
    'selfMessage tokens should alter the self-call track');

  for (const [index, arrow, dashed] of [[0, 'block', '0'], [1, 'open', '0'], [2, 'open', '1']]) {
    const style = byModelId.get(`message_${index}`).style;
    assert.match(style, new RegExp(`(?:^|;)endArrow=${arrow}(?:;|$)`));
    assert.match(style, new RegExp(`(?:^|;)dashed=${dashed}(?:;|$)`));
  }
  const frames = cells.filter(cell => cell.id.startsWith('fragment_') && cell.kind === 'vertex' && /shape=umlFrame/.test(cell.style));
  assert.ok(frames.some(frame => frame.value === 'alt'), 'the fragment operator remains semantic');
  assert.ok(cells.some(cell => cell.id.includes('_guard_') && cell.value.includes('valid')));
  assert.ok(cells.some(cell => cell.id.includes('_sep_') && /dashed=1/.test(cell.style) && /endArrow=none/.test(cell.style)),
    'fragment separators remain dashed and unarrowed');
});

test('sequence stress layout expands its explicit page to contain final cells', () => {
  const input = JSON.parse(fs.readFileSync(path.join(root, 'outputs/drawio-improvements/fixtures/sequence/sequence-stress.json'), 'utf8'));
  const rendered = renderInput(input);
  assert.ok(rendered.page.width > input.page.width, 'page width should grow when participant headers exceed the requested size');
  assert.ok(!rendered.diagnostics.some(item => item.code === 'PAGE_OVERFLOW'), 'expanded sequence page should not report clipped cells');
  for (const cell of rendered.cells) if (cell.kind === 'vertex' && cell.parent === '1') {
    assert.ok(cell.geometry.x + cell.geometry.width <= rendered.page.width, `${cell.id} should fit within expanded page width`);
    assert.ok(cell.geometry.y + cell.geometry.height <= rendered.page.height, `${cell.id} should fit within expanded page height`);
  }
});

test('legacy sequence presentation overrides remain effective beside shared tokens', () => {
  const data = { type: 'sequence', participants: [{ id: 'A', label: 'Actor', shape: 'umlActor' }, 'B'],
    messages: [{ kind: 'sync', from: 'A', to: 'B', label: 'Call' }] };
  const result = renderSequence(data, {
    presentation: { fontFamily: 'Georgia', colors: { stroke: '#222222' } },
    sequence: { fontFamily: 'Courier New', fontSize: 18,
      participant: { strokeColor: '#aabbcc' }, message: { strokeColor: '#ff0000', strokeWidth: 2, fontSize: 17 } }
  });
  const byId = new Map(result.cells.map(cell => [cell.id, cell]));
  assert.match(byId.get('participant_header_1').style, /fontFamily=Courier New/);
  assert.match(byId.get('participant_header_1').style, /strokeColor=#aabbcc/);
  assert.match(byId.get('participant_header_1').style, /fontSize=18/);
  assert.match(byId.get('message_0').style, /strokeColor=#ff0000/);
  assert.match(byId.get('message_0').style, /strokeWidth=2/);
  assert.match(byId.get('message_label_0').style, /fontSize=17/);
});

test('sequence round-trips Unicode participant labels and XML-sensitive text through draw.io XML', () => {
  const data = fitTrack();
  const ui = data.participants.find(participant => participant.id === 'ui');
  ui.label = 'Giao diện <người tập> & ActiveWorkoutSession';
  const cells = renderModel(data);
  const participant = cells.find(cell => cell.attrs.id === 'participant_header_1');
  assert.ok(participant.attrs.value.includes('diện'));
  assert.ok(participant.attrs.value.includes('&lt;người tập&gt;'));
  assert.ok(participant.attrs.value.includes('&amp;'));
  assert.equal(participant.attrs.value.replaceAll('<br>', ' '), htmlText(ui.label).replaceAll('<br>', ' '));
});

test('corrected UTF-8 JSON participant and message text survive XML serialization unchanged', () => {
  const data = fitTrack(), cells = renderModel(data);
  const ui = data.participants.find(participant => participant.id === 'ui');
  const participant = cells.find(cell => cell.attrs.id === 'participant_header_1');
  const message = cells.find(cell => cell.attrs.id === 'message_label_1');
  assert.equal(participant.attrs.value.replaceAll('<br>', ' '), htmlText(ui.label).replaceAll('<br>', ' '));
  assert.equal(message.attrs.value.replaceAll('<br>', ' '), htmlText(data.messages[1].label).replaceAll('<br>', ' '));
  assert.ok(participant.attrs.value.includes('Giao diện'));
  assert.ok(message.attrs.value.includes('thời lượng'));
  assert.doesNotMatch(`${participant.attrs.value} ${message.attrs.value}`, /(?:Ã|á»|Â)/u,
    'valid UTF-8 input must not contain the known mojibake sequences');
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
  data.activations = [];
  data.messages = [{ from: 'ui', to: 'api', kind: 'sync', label: 'Gửi yêu cầu hoàn tất buổi tập cùng dữ liệu bài tập, thời lượng và toàn bộ các hiệp đã lưu cho phiên luyện tập hiện tại' }];
  const label = renderModel(data).find(cell => cell.attrs.id === 'message_label_0');
  const labelBounds = geom(label);
  assert.ok(labelBounds.height >= 36, 'wrapped message label needs line-height space');
  assert.ok(labelBounds.width >= 180, 'message label needs its measured minimum width');
});

test('participants use the native UML lifeline shape and have visible lifeline stems', () => {
  const cells = renderModel(fitTrack());
  const participants = cells.filter(cell => /^participant_header_\d+$/.test(cell.attrs.id));
  assert.equal(participants.length, 5);
  assert.match(participants[0].attrs.style, /(?:^|;)shape=umlActor(?:;|$)/, 'the athlete uses the installed native UML actor stencil');
  assert.ok(cells.find(cell => cell.attrs.id === 'participant_label_0')?.attrs.value.includes('Vận động viên'), 'actor label is a separate text cell');
  for (const participant of participants.slice(1)) assert.match(participant.attrs.style, /(?:^|;)shape=umlLifeline(?:;|$)/);
  for (let index = 0; index < 5; index++) assert.ok(cells.some(cell => cell.attrs.id === `participant_${index}` && /dashed=1/.test(cell.attrs.style)), `participant ${index} should be a semantic lifeline endpoint`);
});

test('FitTrackAI example documents only the source-backed successful completion scenario', () => {
  const example = JSON.parse(fs.readFileSync(path.join(root, 'examples/sequence.json'), 'utf8'));
  assert.deepEqual(example.participants.map(participant => participant.id), ['athlete', 'ui', 'api', 'svc', 'db']);
  assert.equal(example.participants[0].shape, 'umlActor');
  assert.deepEqual(example.messages[0], { kind: 'sync', order: 0, label: 'Nhấn nút “Save & Complete”', from: 'athlete', to: 'ui' });
  assert.equal(example.participants[0].label, 'Vận động viên (đã xác thực)');
  assert.doesNotMatch(example.participants[0].label, /Athlete/u);
  assert.equal(example.fragments.length, 0, 'the referenced sequence is a single successful path, not a conditional fragment');
  assert.ok(example.messages.every(message => ['sync', 'return'].includes(message.kind)));
  assert.ok(example.messages.some(message => message.label.startsWith('200 JSON')));
});

// Source evidence: ActiveWorkoutSession awaits completeSessionApi; the API handler awaits
// WorkoutsService.completeSession; that service awaits its ordered Prisma operations.
test('source-backed synchronous completion spans render as editable activation bars at call boundaries', () => {
  const data = fitTrack(), cells = renderModel(data), byOrder = new Map(data.messages.map((message, index) => [message.order, index]));
  assert.equal(cells.filter(cell => /^activation_/.test(cell.attrs.id)).length, data.activations.length);
  data.activations.forEach((activation, index) => {
    const bar = cells.find(cell => cell.attrs.id === `activation_${index}`);
    assert.ok(bar?.vertex, `activation ${index} should be an editable vertex`);
    assert.match(bar.attrs.style, /(?:^|;)shape=rect(?:;|$)/, 'native activation bars use the evidenced rectangle shape');
    assert.equal(Number(bar.geometry.width), 12);
    const startEdge = cells.find(cell => cell.attrs.id === `message_${byOrder.get(activation.startOrder)}`);
    const endEdge = cells.find(cell => cell.attrs.id === `message_${byOrder.get(activation.endOrder)}`);
    const startY = endpoint(startEdge, activation.startEnd).y, endY = endpoint(endEdge, activation.endEnd).y;
    assert.ok(Math.abs(Number(bar.geometry.y) - startY) < 0.000001, `${activation.participant} bar should begin at its call boundary`);
    assert.ok(Math.abs(Number(bar.geometry.y) + Number(bar.geometry.height) - endY) < 0.000001, `${activation.participant} bar should end at its completion boundary`);
    assert.ok(endY > startY, 'activation duration must be positive');
    const participantIndex = data.participants.findIndex(participant => participant.id === activation.participant);
    const lifeline = cells.find(cell => cell.attrs.id === `participant_${participantIndex}`);
    assert.equal(Number(bar.geometry.x) + Number(bar.geometry.width) / 2, Number(lifeline.geometry.x) + Number(lifeline.geometry.width) / 2,
      'activation should be centered on its declared participant lifeline');
  });
});

test('activation bars are omitted when synchronous lifetime evidence is absent', () => {
  const cells = renderModel({ type: 'sequence', participants: ['A', 'B'], messages: [{ from: 'A', to: 'B', kind: 'sync', label: 'call' }] });
  assert.equal(cells.filter(cell => /^activation_/.test(cell.attrs.id)).length, 0);
});

test('the athlete finish trigger connects the native actor to the active-session lifeline', () => {
  const data = fitTrack(), cells = renderModel(data), trigger = cells.find(cell => cell.attrs.id === 'message_0');
  assert.equal(trigger.attrs.source, 'participant_0');
  assert.equal(trigger.attrs.target, 'participant_1');
  assert.ok(cells.find(cell => cell.attrs.id === 'message_label_0').attrs.value.includes('Nhấn nút “Save &amp; Complete”'));
  const uiActivation = cells.find(cell => cell.attrs.id === 'activation_0');
  assert.ok(uiActivation, 'UI execution begins when it receives the finish-button event');
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
  const data = fitTrack(), planned = renderInput(data), plannedCells = planned.cells, temp = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-geometry-'));
  const input = path.join(temp, 'input.json'), output = path.join(temp, 'output.drawio');
  fs.writeFileSync(input, JSON.stringify(data), 'utf8');
  const run = spawnSync(process.execPath, ['scripts/render_drawio.mjs', input, '-o', output], { cwd: root, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const outputXml = fs.readFileSync(output, 'utf8');
  assert.ok(outputXml.includes('Giao diện'), 'CLI XML must preserve UTF-8 participant text from the JSON input');
  assert.ok(outputXml.includes('thời lượng'), 'CLI XML must preserve UTF-8 message text from the JSON input');
  assert.doesNotMatch(outputXml, /(?:Ã|á»|Â)/u, 'CLI output must not convert correct Unicode into mojibake');
  const plannedById = byId(parseCells(docXml(data.title, serializeCells(plannedCells), planned.page)));
  const exported = byId(parseCells(outputXml));
  assert.deepEqual([...exported.keys()].sort(), [...plannedById.keys()].sort());
  for (const [id, cell] of plannedById) {
    assert.deepEqual(exported.get(id).geometry, cell.geometry, `export changed planned geometry for ${id}`);
  }
  fs.rmSync(temp, { recursive: true, force: true });
});

test('source-input corruption is distinct from renderer Unicode preservation', () => {
  const corrupted = fixture('fittrackai-source-corrupted.json');
  const corrected = fixture('fittrackai-utf8.json');
  assert.equal(corrupted.participants[0].label.split('\n')[0], 'Giao di?n', 'source fixture records the literal question mark already present upstream');
  const ui = corrected.participants.find(participant => participant.id === 'ui');
  assert.equal(ui.label.split('\n')[0], 'Giao diện');
  const participant = renderModel(corrected).find(cell => cell.attrs.id === 'participant_header_1');
  assert.equal(participant.attrs.value, 'Giao diện<br>ActiveWorkoutSession');
});
