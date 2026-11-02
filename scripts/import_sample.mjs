import fs from 'node:fs';
import path from 'node:path';
import { assertOutsideReferenceTree, assertSafeOutput, ensureOptions, parseCli, reportError } from './common.mjs';
import { cellsFromModel, readDrawio } from './drawio_xml.mjs';

const usage = 'Usage: node scripts/import_sample.mjs input.drawio output.json [sequence|erd|dfd|generic] [--page index|name|id]';
try {
  const { positional, options, help } = parseCli(process.argv.slice(2), usage); if (help) { console.log(usage); process.exit(0); }
  ensureOptions(options, ['page', 'type']);
  const [source, output, legacyType] = positional; if (!source || !output || positional.length > 3) throw new Error(usage); assertSafeOutput(source, output); assertOutsideReferenceTree(output);
  const { page, pageCount, graph } = readDrawio(source, options.page), cells = cellsFromModel(graph).filter(c => !['0', '1'].includes(c.attrs.id));
  const type = options.type ?? legacyType ?? 'generic'; if (!['sequence', 'erd', 'dfd', 'generic'].includes(type)) throw new Error(`Unsupported import type ${type}`);
  const elements = cells.map(cell => {
    const attrs = { ...cell.attrs }, geometry = {};
    for (const k of ['x', 'y', 'width', 'height']) if (cell.geometry[k] !== undefined) geometry[k] = Number(cell.geometry[k]);
    if (cell.geometry.relative !== undefined) geometry.relative = Number(cell.geometry.relative);
    if (cell.geometry.points.length) geometry.points = cell.geometry.points.map(p => Object.fromEntries(Object.entries(p).map(([k, v]) => [k, ['x', 'y'].includes(k) ? Number(v) : v])));
    return { attrs, vertex: cell.vertex, edge: cell.edge, geometry };
  });
  const losses = ['Original page order and workbook-level metadata are not exported.', 'Unknown XML elements, cell children, and unsupported mxGeometry fields are omitted.', 'Semantic source fields cannot be reconstructed reliably from generic draw.io cells.'];
  const result = { type, title: path.basename(source), elements, _import: { source: path.basename(source), page: { id: page.id, name: page.name }, pageCount, losses } };
  fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true }); fs.writeFileSync(output, JSON.stringify(result, null, 2), 'utf8');
  console.log(JSON.stringify({ ok: true, output, page: result._import.page, pageCount, importedCells: elements.length, losses }, null, 2));
} catch (error) { reportError(error); process.exitCode = 2; }
