import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assertOutsideReferenceTree, assertSafeOutput, edge, loadStyle, normalizeInput, parseJsonText, renderGeneric, textWidth, validateGeneric } from '../scripts/common.mjs';
import { parseDrawioText, cellsFromModel } from '../scripts/drawio_xml.mjs';
import { inspect } from '../scripts/validate_drawio.mjs';
import { renderSequence } from '../scripts/sequence.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtureRoot = path.join(root, 'tests/fixtures/shared');
const validFixture = path.join(fixtureRoot, 'generic-valid.json');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'drawio-shared-'));
test.after(() => fs.rmSync(temp, { recursive: true, force: true }));

test('UTF-8 BOM JSON input is normalized', () => assert.equal(parseJsonText('\uFEFF{"ok":true}').ok, true));
test('generic aliases normalize and forward endpoints resolve', () => {
  const data = normalizeInput(JSON.parse(fs.readFileSync(validFixture, 'utf8')));
  const cells = renderGeneric(data);
  assert.equal(cells.length, 3);
  assert.match(cells.join(''), /target="target"/);
});
test('conflicting semantic aliases are surfaced as warnings', () => {
  const result = normalizeInput({ type: 'erd', entities: [{ name: 'A', attributes: [], attrs: [{ name: 'legacy' }] }], relations: [{ from: 'A', a: 'Other' }] });
  assert.equal(result.diagnostics.length, 2); assert.ok(result.diagnostics.every(d => d.code === 'ALIAS_CONFLICT' && d.severity === 'warning'));
});
test('generic validation rejects reserved and duplicate IDs', () => {
  const data = normalizeInput({ elements: [{ vertex: true, id: '0', geometry: {} }, { vertex: true, id: '0', geometry: {} }] });
  assert.throws(() => renderGeneric(data), e => e.diagnostics.some(d => d.code === 'ID_RESERVED') && e.diagnostics.some(d => d.code === 'ID_DUPLICATE'));
});
test('shared invalid fixture captures duplicate IDs and negative geometry', () => {
  const invalid = normalizeInput(parseJsonText(fs.readFileSync(path.join(fixtureRoot, 'generic-invalid.json'), 'utf8')));
  assert.throws(() => renderGeneric(invalid), e => e.diagnostics.some(d => d.code === 'ID_DUPLICATE') && e.diagnostics.some(d => d.code === 'GEOMETRY_SIZE'));
});
test('generic validation rejects unresolved parent/endpoints and invalid geometry', () => {
  const data = normalizeInput({ elements: [{ vertex: true, id: 'v', parent: 'missing', geometry: { x: 0, y: 0, width: -1, height: 1 } }, { edge: true, id: 'e', source: 'absent', target: 'v', geometry: {} }] });
  assert.throws(() => renderGeneric(data), e => ['PARENT_UNRESOLVED', 'GEOMETRY_SIZE', 'ENDPOINT_UNRESOLVED'].every(code => e.diagnostics.some(d => d.code === code)));
});
test('generic validation rejects cyclic parent relationships', () => {
  const data = normalizeInput({ elements: [
    { vertex: true, id: 'a', parent: 'b', geometry: { x: 0, y: 0, width: 10, height: 10 } },
    { vertex: true, id: 'b', parent: 'a', geometry: { x: 0, y: 0, width: 10, height: 10 } }
  ] });
  assert.throws(() => renderGeneric(data), e => e.diagnostics.some(d => d.code === 'PARENT_CYCLE'));
});
test('generic containment and page overflow are warnings', () => {
  const data = normalizeInput({ page: { width: 20, height: 20 }, elements: [
    { vertex: true, id: 'frame', geometry: { x: 0, y: 0, width: 10, height: 10 } },
    { vertex: true, id: 'child', parent: 'frame', geometry: { x: 8, y: 8, width: 5, height: 5 } },
    { vertex: true, id: 'outside', geometry: { x: 18, y: 18, width: 5, height: 5 } }
  ] });
  assert.deepEqual(validateGeneric(data).map(d => d.code).sort(), ['PAGE_OVERFLOW', 'PARENT_OVERFLOW']);
});
test('style overrides preserve defaults and reject unknown keys', () => {
  const style = loadStyle({ sequence: { message: { strokeColor: '#123456' } } });
  assert.equal(style.sequence.message.strokeColor, '#123456');
  assert.equal(style.sequence.message.syncArrow, 'block');
  assert.equal(style.erd.relation.fontSize, 14);
  assert.equal(style.activity.action.strokeWidth, 1);
  assert.throws(() => loadStyle({ sequence: { madeUp: {} } }), e => e.diagnostics[0].code === 'STYLE_UNKNOWN');
});
test('sequence synchronous messages retain UML block arrow under style override', () => {
  const cells = renderSequence({ participants: ['Client', 'Service'], messages: [{ from: 'Client', to: 'Service', kind: 'sync', label: 'call' }] }, {
    sequence: { message: { syncArrow: 'open' } }
  });
  const message = cells.find(cell => /id="message_0"/.test(cell));
  assert.ok(message, 'synchronous message edge should be rendered');
  assert.match(message, /endArrow=block/);
  assert.doesNotMatch(message, /endArrow=open/);
});
test('sequence participant IDs reject duplicates after string normalization', () => {
  for (const participants of [
    [{ id: 1 }, { id: '1' }],
    ['actor', { id: 'actor', label: 'Actor object' }]
  ]) {
    assert.throws(() => renderSequence({ participants }, {}), /Duplicate sequence participant id .*participants\[1\]/);
  }
});
test('XML parser preserves encoded multiline text and rejects malformed XML', () => {
  const xml = `<mxfile><diagram name="p"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${edge('e', 'a', 'b', 'row 1\nrow 2', 'edge') }<mxCell id="a" vertex="1" parent="1"><mxGeometry x="0" y="0" width="10" height="10" as="geometry"/></mxCell><mxCell id="b" vertex="1" parent="1"><mxGeometry x="20" y="0" width="10" height="10" as="geometry"/></mxCell></root></mxGraphModel></diagram></mxfile>`;
  const parsed = parseDrawioText(xml), cells = cellsFromModel(parsed.graph);
  assert.equal(cells.find(c => c.attrs.id === 'e').attrs.value, 'row 1\nrow 2');
  assert.throws(() => parseDrawioText('<mxfile><diagram></mxfile>'));
});
test('draw.io parser accepts an uncompressed embedded XML page', () => {
  const model = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel>';
  const parsed = parseDrawioText(`<mxfile><diagram id="plain" name="Plain"><![CDATA[${model}]]></diagram></mxfile>`);
  assert.equal(parsed.page.id, 'plain'); assert.equal(cellsFromModel(parsed.graph).length, 2);
});
test('compressed multipage files require and honor explicit page selection', () => {
  const file = path.join(fixtureRoot, 'compressed-multipage.drawio');
  assert.throws(() => inspect(file), e => e.diagnostics[0].code === 'PAGE_SELECTION_REQUIRED');
  assert.equal(inspect(file, 'Details').page.id, 'second');
  assert.equal(inspect(file, '1').page.name, 'Details');
  const output = path.join(temp, 'multipage-import.json');
  const run = spawnSync(process.execPath, ['scripts/import_sample.mjs', file, output, 'generic', '--page', '1'], { cwd: root, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr); const imported = JSON.parse(fs.readFileSync(output, 'utf8'));
  assert.equal(imported._import.page.name, 'Details'); assert.equal(imported._import.pageCount, 2);
});
test('output path protection resolves identical paths', () => assert.throws(() => assertSafeOutput(validFixture, path.join(fixtureRoot, '.', 'generic-valid.json')), e => e.diagnostics[0].code === 'OUTPUT_OVERWRITE'));
test('outputs are refused inside the reference checkout', () => assert.throws(() => assertOutsideReferenceTree(path.join(root, 'work/drawio-references/untrusted/output.drawio'), root), e => e.diagnostics[0].code === 'REFERENCE_TREE_WRITE'));
test('edge waypoint API remains additive and text width is deterministic', () => {
  assert.match(edge('e', 'a', 'b', '', 'edge', '1', { points: [{ x: 8, y: 12 }] }), /<Array as="points"><mxPoint x="8" y="12" as="points"\/><\/Array>/);
  assert.equal(textWidth('abc', 10), 18);
});
test('render CLI produces structurally valid generic output', () => {
  const out = path.join(temp, 'generic.drawio');
  const run = spawnSync(process.execPath, ['scripts/render_drawio.mjs', validFixture, '-o', out], { cwd: root, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr); assert.equal(inspect(out).ok, true);
});
test('render CLI writes no partial diagram after validation failure', () => {
  const out = path.join(temp, 'invalid.drawio'), input = path.join(fixtureRoot, 'generic-invalid.json');
  const run = spawnSync(process.execPath, ['scripts/render_drawio.mjs', input, '-o', out], { cwd: root, encoding: 'utf8' });
  assert.equal(run.status, 2); assert.equal(fs.existsSync(out), false); assert.match(run.stderr, /ID_DUPLICATE/);
});
test('shared dispatch renders use-case and activity semantic examples', () => {
  for (const type of ['usecase', 'activity']) {
    const output = path.join(temp, `${type}.drawio`);
    const input = path.join(fixtureRoot, `${type}-valid.json`);
    const run = spawnSync(process.execPath, ['scripts/render_drawio.mjs', input, '-o', output], { cwd: root, encoding: 'utf8' });
    assert.equal(run.status, 0, `${type}: ${run.stderr}`); assert.equal(inspect(output).ok, true, type);
  }
});
test('shared dispatch renders all five repository semantic examples', () => {
  for (const type of ['sequence', 'erd', 'dfd', 'usecase', 'activity']) {
    const output = path.join(temp, `repository-${type}.drawio`);
    const run = spawnSync(process.execPath, ['scripts/render_drawio.mjs', `examples/${type}.json`, '-o', output], { cwd: root, encoding: 'utf8' });
    assert.equal(run.status, 0, `${type}: ${run.stderr}`); assert.equal(inspect(output).ok, true, type);
  }
});
test('mixed-sharing use-case actors render on opposite sides of the boundary', () => {
  const input = path.join(root, 'tests/fixtures/acceptance/usecase.json'), output = path.join(temp, 'usecase-mixed.drawio');
  const run = spawnSync(process.execPath, ['scripts/render_drawio.mjs', input, '-o', output], { cwd: root, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const cells = cellsFromModel(parseDrawioText(fs.readFileSync(output, 'utf8')).graph), byId = new Map(cells.map(cell => [cell.attrs.id, cell]));
  const first = Number(byId.get('actor_cong_dan').geometry.x), second = Number(byId.get('actor_can_bo').geometry.x);
  assert.notEqual(first, second);
  assert.ok(cells.some(cell => cell.attrs.source === 'actor_cong_dan' && cell.attrs.target === 'usecase_theo_doi'));
  assert.ok(cells.some(cell => cell.attrs.source === 'actor_can_bo' && cell.attrs.target === 'usecase_theo_doi'));
  for (const actorId of ['actor_cong_dan', 'actor_can_bo']) {
    const exits = cells.filter(cell => cell.edge && cell.attrs.source === actorId).map(cell => cell.attrs.style.match(/(?:^|;)exitY=([^;]+)/)?.[1]);
    assert.equal(new Set(exits).size, exits.length, `${actorId} associations should leave at distinct ports`);
  }
  assert.equal(inspect(output).warnings.length, 0);
});
test('semantic renderer labels preserve XML-sensitive text through the HTML layer', () => {
  for (const type of ['sequence', 'erd', 'dfd', 'usecase', 'activity']) {
    const input = path.join(root, `tests/fixtures/acceptance/${type}.json`), output = path.join(temp, `acceptance-${type}.drawio`);
    const run = spawnSync(process.execPath, ['scripts/render_drawio.mjs', input, '-o', output], { cwd: root, encoding: 'utf8' });
    assert.equal(run.status, 0, `${type}: ${run.stderr}`);
    const xml = fs.readFileSync(output, 'utf8');
    assert.match(xml, /&amp;lt;/, `${type} angle brackets must remain literal HTML text`);
    assert.match(xml, /&amp;amp;/, `${type} ampersands must remain literal HTML text`);
  }
});
test('sequence acceptance fixture covers nested fragments, a long guard, and a self-message', () => {
  const input = path.join(root, 'tests/fixtures/acceptance/sequence.json'), output = path.join(temp, 'sequence-acceptance.drawio');
  const data = JSON.parse(fs.readFileSync(input, 'utf8'));
  assert.equal(data.participants.length, 3, 'fixture should cover three participants');
  const outer = data.fragments?.find(fragment => fragment.kind === 'alt');
  assert.ok(outer, 'fixture should contain an outer alt fragment');
  const nested = outer.branches.flatMap(branch => branch.fragments || []).find(fragment => fragment.kind === 'opt');
  assert.ok(nested, 'fixture should contain a nested opt fragment');
  const nestedBranch = nested.branches.find(branch => branch.guard.length >= 72);
  assert.ok(nestedBranch, 'nested guard should be long enough to exercise wrapping');
  const selfCall = nestedBranch.messages.find(message => message.from === message.to);
  assert.ok(selfCall, 'nested branch should contain a self-message');

  const run = spawnSync(process.execPath, ['scripts/render_drawio.mjs', input, '-o', output], { cwd: root, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const cells = cellsFromModel(parseDrawioText(fs.readFileSync(output, 'utf8')).graph);
  assert.ok(cells.some(cell => cell.vertex && cell.attrs.value === 'alt'));
  assert.ok(cells.some(cell => cell.vertex && cell.attrs.value === 'opt'));
  assert.ok(cells.some(cell => cell.attrs.id.includes('_guard_') && cell.attrs.value.includes('mã đơn')));
  assert.ok(cells.some(cell => cell.edge && cell.attrs.id.startsWith('message_') && cell.geometry.points.length >= 3));
  assert.equal(inspect(output).warnings.length, 0);
});
test('ERD long relation labels wrap above their connector with clearance', () => {
  const input = path.join(root, 'tests/fixtures/acceptance/erd.json'), output = path.join(temp, 'erd-label-clearance.drawio');
  const run = spawnSync(process.execPath, ['scripts/render_drawio.mjs', input, '-o', output], { cwd: root, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const cells = cellsFromModel(parseDrawioText(fs.readFileSync(output, 'utf8')).graph), byId = new Map(cells.map(cell => [cell.attrs.id, cell]));
  const relation = cells.find(cell => cell.edge && cell.attrs.id === 'rel_0');
  const label = byId.get('rel_label_0');
  const source = byId.get(relation.attrs.source), target = byId.get(relation.attrs.target);
  const routeY = (Number(source.geometry.y) + Number(source.geometry.height) / 2 + Number(target.geometry.y) + Number(target.geometry.height) / 2) / 2;
  assert.ok(Number(label.geometry.height) >= 36, 'long relation label should have room for wrapped lines');
  assert.ok(Number(label.geometry.y) + Number(label.geometry.height) <= routeY - 8, 'label should sit above the connector');
  assert.equal(inspect(output).warnings.length, 0);
});
test('ERD infers a page for tall multiline tables and preserves explicit undersized pages', () => {
  const input = path.join(temp, 'erd-dynamic.json'), output = path.join(temp, 'erd-dynamic.drawio');
  const data = { type: 'erd', title: 'ERD dynamic page', entities: [{ name: 'Customer Registry', attributes: Array.from({ length: 18 }, (_, i) => ({
    name: i === 17 ? 'ghi chú dài\n(dòng thứ hai & <xml>)' : `attribute_${i}_with_a_long_name`,
    type: i === 17 ? 'NVARCHAR(500)\ncomment: khách hàng' : 'VARCHAR(240)', key: i === 0 ? 'PK' : ''
  })) }] };
  fs.writeFileSync(input, JSON.stringify(data));
  let run = spawnSync(process.execPath, ['scripts/render_drawio.mjs', input, '-o', output], { cwd: root, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const result = JSON.parse(run.stdout), parsed = parseDrawioText(fs.readFileSync(output, 'utf8'));
  assert.ok(Number(parsed.graph.attrs.pageHeight) > 800);
  assert.deepEqual(result.diagnostics, []);
  assert.equal(inspect(output).warnings.length, 0);

  data.page = { width: 320, height: 240 }; fs.writeFileSync(input, JSON.stringify(data));
  run = spawnSync(process.execPath, ['scripts/render_drawio.mjs', input, '-o', output], { cwd: root, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.ok(JSON.parse(run.stdout).diagnostics.some(d => d.code === 'PAGE_OVERFLOW'));
  const explicit = parseDrawioText(fs.readFileSync(output, 'utf8'));
  assert.equal(Number(explicit.graph.attrs.pageWidth), 320); assert.equal(Number(explicit.graph.attrs.pageHeight), 240);
  assert.ok(inspect(output).warnings.some(d => d.code === 'PAGE_OVERFLOW'));
});
test('CLI style file overrides input style while preserving renderer semantics', () => {
  const input = path.join(temp, 'styled.json'), override = path.join(temp, 'style.json'), output = path.join(temp, 'styled.drawio');
  const data = JSON.parse(fs.readFileSync(path.join(root, 'examples/dfd.json'), 'utf8')); data.style = { dfd: { fontSize: 11 } };
  fs.writeFileSync(input, JSON.stringify(data)); fs.writeFileSync(override, JSON.stringify({ dfd: { fontSize: 12 } }));
  const run = spawnSync(process.execPath, ['scripts/render_drawio.mjs', input, '-o', output, '--style', override], { cwd: root, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr); const result = inspect(output); assert.equal(result.ok, true);
  const xml = fs.readFileSync(output, 'utf8'); assert.match(xml, /fontSize=12/);
});
test('import records page selection and known losses', () => {
  const input = path.join(temp, 'simple.drawio'), output = path.join(temp, 'import.json');
  fs.writeFileSync(input, '<mxfile><diagram id="d" name="One"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="x" value="X" vertex="1" parent="1"><mxGeometry x="1" y="2" width="3" height="4" as="geometry"/></mxCell></root></mxGraphModel></diagram></mxfile>');
  const run = spawnSync(process.execPath, ['scripts/import_sample.mjs', input, output], { cwd: root, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr); const imported = JSON.parse(fs.readFileSync(output, 'utf8'));
  assert.equal(imported.elements[0].attrs.id, 'x'); assert.ok(imported._import.losses.length >= 2);
});
test('compare selects pages and blind mode includes its privacy caveat', () => {
  const file = path.join(fixtureRoot, 'compressed-multipage.drawio');
  const run = spawnSync(process.execPath, ['scripts/compare_drawio.mjs', file, file, '--generated-page', '0', '--reference-page', 'Details', '--blind'], { cwd: root, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr); const result = JSON.parse(run.stdout);
  assert.equal(result.generatedPage.name, 'Overview'); assert.equal(result.referencePage.name, 'Details'); assert.match(result.caveat, /privacy.*guarantee/i);
});
test('validator reports possible overlap and page overflow as warnings', () => {
  const file = path.join(temp, 'overlap.drawio');
  fs.writeFileSync(file, '<mxfile><diagram><mxGraphModel pageWidth="19" pageHeight="20"><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="a" vertex="1" parent="1"><mxGeometry x="0" y="0" width="15" height="15" as="geometry"/></mxCell><mxCell id="b" vertex="1" parent="1"><mxGeometry x="5" y="5" width="15" height="15" as="geometry"/></mxCell></root></mxGraphModel></diagram></mxfile>');
  const result = inspect(file); assert.equal(result.ok, true); assert.ok(result.warnings.some(d => d.code === 'SIBLING_OVERLAP')); assert.ok(result.warnings.some(d => d.code === 'PAGE_OVERFLOW'));
});
test('validator requires the draw.io root/layer and vertex geometry model', () => {
  const file = path.join(temp, 'missing-geometry.drawio');
  fs.writeFileSync(file, '<mxfile><diagram><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="v" vertex="1" parent="1"/></root></mxGraphModel></diagram></mxfile>');
  const result = inspect(file); assert.equal(result.ok, false); assert.ok(result.errors.some(d => d.code === 'GEOMETRY_REQUIRED'));
});
test('validator warns when child geometry exceeds its parent frame', () => {
  const file = path.join(temp, 'parent-overflow.drawio');
  fs.writeFileSync(file, '<mxfile><diagram><mxGraphModel pageWidth="32" pageHeight="32"><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="frame" vertex="1" parent="1"><mxGeometry x="10" y="10" width="20" height="20" as="geometry"/></mxCell><mxCell id="child" vertex="1" parent="frame"><mxGeometry x="18" y="18" width="5" height="5" as="geometry"/></mxCell></root></mxGraphModel></diagram></mxfile>');
  const result = inspect(file); assert.equal(result.ok, true); assert.ok(result.warnings.some(d => d.code === 'PARENT_OVERFLOW')); assert.ok(result.warnings.some(d => d.code === 'PAGE_OVERFLOW'));
});
