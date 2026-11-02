import fs from 'node:fs';
import path from 'node:path';
import { assertOutsideReferenceTree, assertSafeOutput, docXml, ensureOptions, loadStyle, mergeStyle, normalizeInput, parseCli, parseJsonText, renderGeneric, reportError, validateGeneric, writeOut } from './common.mjs';
import { renderSequence } from './sequence.mjs';
import { renderErd } from './erd.mjs';
import { renderDfd } from './dfd.mjs';
import { renderUsecase } from './usecase.mjs';
import { renderActivity } from './activity.mjs';
import { cellsFromModel, parseDrawioText } from './drawio_xml.mjs';

const usage = 'Usage: node scripts/render_drawio.mjs input.json [-o output.drawio] [--style overrides.json]';
try {
  const { positional, options, help } = parseCli(process.argv.slice(2), usage);
  if (help) { console.log(usage); process.exit(0); }
  ensureOptions(options, ['style', 'output']);
  const input = positional[0]; if (!input || positional.length !== 1) throw new Error(usage);
  const output = options.output ?? input.replace(/\.json$/i, '.drawio'); assertSafeOutput(input, output); assertOutsideReferenceTree(output);
  const raw = parseJsonText(fs.readFileSync(input, 'utf8'), input), data = normalizeInput(raw);
  const cliStyle = options.style ? parseJsonText(fs.readFileSync(options.style, 'utf8'), options.style) : {};
  const style = mergeStyle(loadStyle(raw.style ?? {}), cliStyle); let cells, genericDiagnostics = [];
  if (data.type === 'generic') { genericDiagnostics = validateGeneric(data); cells = renderGeneric(data); }
  else if (data.type === 'sequence') cells = renderSequence(data, style);
  else if (data.type === 'erd') cells = renderErd(data, style);
  else if (data.type === 'dfd') cells = renderDfd(data, style);
  else if (data.type === 'usecase') cells = renderUsecase(data, style);
  else cells = renderActivity(data, style);
  const xml = docXml(data.title ?? path.basename(input), cells, data.page ?? cells.page);
  const parsed = parseDrawioText(xml), modelCells = cellsFromModel(parsed.graph);
  const ids = modelCells.map(c => c.attrs.id), idSet = new Set(ids), errors = [];
  if (new Set(ids).size !== ids.length) errors.push({ severity: 'error', code: 'ID_DUPLICATE', path: '$output.cells', message: 'Rendered output contains duplicate IDs' });
  if (!idSet.has('0') || !idSet.has('1')) errors.push({ severity: 'error', code: 'ROOT_CELLS', path: '$output.cells', message: 'Rendered output must include root and layer cells 0 and 1' });
  const pageWidth = Number(parsed.graph.attrs.pageWidth), pageHeight = Number(parsed.graph.attrs.pageHeight), outputWarnings = [];
  for (const cell of modelCells) {
    const id = cell.attrs.id ?? '', g = cell.geometry;
    if (!['0', '1'].includes(id) && cell.vertex === cell.edge) errors.push({ severity: 'error', code: 'CELL_KIND', path: `$output.cells.${id}`, message: 'Rendered cell must be exactly one of vertex or edge' });
    if ((cell.vertex || cell.edge) && !cell.hasGeometry) errors.push({ severity: 'error', code: 'GEOMETRY_REQUIRED', path: `$output.cells.${id}.geometry`, message: 'Rendered vertex or edge requires mxGeometry' });
    if (cell.vertex) {
      const dimensions = ['x', 'y', 'width', 'height'].map(k => Number(g[k]));
      if (dimensions.some(n => !Number.isFinite(n))) errors.push({ severity: 'error', code: 'GEOMETRY_FINITE', path: `$output.cells.${id}.geometry`, message: 'Rendered vertex geometry must be finite' });
      if (Number(g.width) < 0 || Number(g.height) < 0) errors.push({ severity: 'error', code: 'GEOMETRY_SIZE', path: `$output.cells.${id}.geometry`, message: 'Rendered vertex size cannot be negative' });
      if (cell.attrs.parent === '1' && Number.isFinite(pageWidth) && Number.isFinite(pageHeight) && (Number(g.x) < 0 || Number(g.y) < 0 || Number(g.x) + Number(g.width) > pageWidth || Number(g.y) + Number(g.height) > pageHeight)) outputWarnings.push({ severity: 'warning', code: 'PAGE_OVERFLOW', path: `$output.cells.${id}.geometry`, message: 'Rendered vertex extends beyond page bounds' });
    }
    if (cell.edge) for (const [index, point] of g.points.entries()) if ((!point.as || ['points', 'sourcePoint', 'targetPoint'].includes(point.as)) && (!Number.isFinite(Number(point.x)) || !Number.isFinite(Number(point.y)))) errors.push({ severity: 'error', code: 'POINT_GEOMETRY', path: `$output.cells.${id}.geometry.points[${index}]`, message: 'Rendered route point must have finite x and y' });
    if (cell.attrs.id && cell.attrs.id !== '0' && cell.attrs.id !== '1' && cell.attrs.parent && !idSet.has(cell.attrs.parent)) errors.push({ severity: 'error', code: 'PARENT_UNRESOLVED', path: `$output.cells.${cell.attrs.id}.parent`, message: `Unresolved parent ${cell.attrs.parent}` });
    for (const key of ['source', 'target']) if (cell.edge && !idSet.has(cell.attrs[key])) errors.push({ severity: 'error', code: 'ENDPOINT_UNRESOLVED', path: `$output.cells.${cell.attrs.id}.${key}`, message: `Unresolved ${key} ${cell.attrs[key] ?? ''}` });
  }
  if (errors.length) { const e = new Error('Rendered XML failed structural checks'); e.diagnostics = errors; throw e; }
  writeOut(output, xml);
  const diagnostics = [...(data.diagnostics ?? []), ...genericDiagnostics, ...outputWarnings];
  console.log(JSON.stringify({ ok: true, output, type: data.type, cells: cells.length, diagnostics }, null, 2));
} catch (error) { reportError(error); process.exitCode = 2; }
