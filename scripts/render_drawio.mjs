import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertOutsideReferenceTree, assertSafeOutput, docXml, ensureOptions, loadStyle, mergeStyle, normalizeInput, parseCli, parseJsonText, renderGeneric, reportError, serializeCells, validateGeneric, writeOut, DiagramInputError } from './common.mjs';
import { renderSequence } from './sequence.mjs';
import { renderErd } from './erd.mjs';
import { renderDfd } from './dfd.mjs';
import { renderUsecase } from './usecase.mjs';
import { renderActivity } from './activity.mjs';
import { cellsFromModel, parseDrawioText } from './drawio_xml.mjs';

const usage = 'Usage: node scripts/render_drawio.mjs input.json [-o output.drawio] [--style overrides.json]';
const builtins = new Map([
  ['sequence', (data, style) => renderSequence(data, style)],
  ['erd', (data, style) => renderErd(data, style)],
  ['dfd', (data, style) => renderDfd(data, style)],
  ['usecase', (data, style) => renderUsecase(data, style)],
  ['activity', (data, style) => renderActivity(data, style)]
]);
const registered = new Map();

export function registerRenderer(type, renderer) {
  if (typeof type !== 'string' || !type.trim() || builtins.has(type)) throw new TypeError('Only a named non-built-in renderer type may be registered');
  if (type !== 'class') throw new TypeError('The shared registry currently reserves only the class renderer slot');
  if (typeof renderer !== 'function') throw new TypeError('renderer must be a function');
  if (registered.has(type)) throw new DiagramInputError(`Renderer already registered for ${type}`, [{ phase: 'planned', severity: 'error', code: 'RENDERER_DUPLICATE', path: '$.type', message: 'A renderer is already registered', value: type }]);
  registered.set(type, renderer);
  return () => { if (registered.get(type) === renderer) registered.delete(type); };
}

export function renderInput(input, { style: styleOverrides = {}, renderers = registered } = {}) {
  const data = normalizeInput(input), style = mergeStyle(loadStyle(input?.style ?? {}), styleOverrides);
  let cells, diagnostics = [...(data.diagnostics ?? [])];
  if (data.type === 'generic') { diagnostics.push(...validateGeneric(data)); cells = renderGeneric(data); }
  else {
    const renderer = builtins.get(data.type) ?? renderers.get?.(data.type);
    if (!renderer) throw new DiagramInputError(`No renderer is registered for diagram type ${data.type}`, [{ phase: 'planned', severity: 'error', code: 'RENDERER_UNREGISTERED', path: '$.type', message: 'Register a renderer before dispatching this type', value: data.type }]);
    const result = renderer(data, style, { helpers: { serializeCells } });
    if (Array.isArray(result)) cells = result;
    else if (result && Array.isArray(result.cells)) { cells = result.cells; diagnostics.push(...(result.diagnostics ?? [])); }
    else throw new DiagramInputError(`Renderer ${data.type} must return cells or { cells, diagnostics, page }`, [{ phase: 'planned', severity: 'error', code: 'RENDERER_RESULT', path: '$renderer.result', message: 'Expected an array of cells or a renderer model' }]);
    if (result?.page) cells.page = result.page;
  }
  return { type: data.type, cells, diagnostics, page: data.page ?? cells.page };
}

async function runCli() {
  try {
    const { positional, options, help } = parseCli(process.argv.slice(2), usage);
    if (help) { console.log(usage); process.exit(0); }
    ensureOptions(options, ['style', 'output']);
    const input = positional[0]; if (!input || positional.length !== 1) throw new Error(usage);
    const output = options.output ?? input.replace(/\.json$/i, '.drawio'); assertSafeOutput(input, output); assertOutsideReferenceTree(output);
    const raw = parseJsonText(fs.readFileSync(input, 'utf8'), input), cliStyle = options.style ? parseJsonText(fs.readFileSync(options.style, 'utf8'), options.style) : {};
    if (raw.type === 'class') {
      const { renderClass } = await import('./class.mjs');
      registerRenderer('class', renderClass);
    }
    const rendered = renderInput(raw, { style: cliStyle });
    const xml = docXml(raw.title ?? path.basename(input), serializeCells(rendered.cells), rendered.page);
    const parsed = parseDrawioText(xml), modelCells = cellsFromModel(parsed.graph);
    const ids = modelCells.map(c => c.attrs.id), idSet = new Set(ids), errors = [], outputWarnings = [];
    if (new Set(ids).size !== ids.length) errors.push({ phase: 'xml', severity: 'error', code: 'ID_DUPLICATE', path: '$output.cells', message: 'Rendered output contains duplicate IDs' });
    if (!idSet.has('0') || !idSet.has('1')) errors.push({ phase: 'xml', severity: 'error', code: 'ROOT_CELLS', path: '$output.cells', message: 'Rendered output must include root and layer cells 0 and 1' });
    const pageWidth = Number(parsed.graph.attrs.pageWidth), pageHeight = Number(parsed.graph.attrs.pageHeight);
    for (const cell of modelCells) {
      const id = cell.attrs.id ?? '', g = cell.geometry;
      if (!['0', '1'].includes(id) && cell.vertex === cell.edge) errors.push({ phase: 'xml', severity: 'error', code: 'CELL_KIND', path: `$output.cells.${id}`, message: 'Rendered cell must be exactly one of vertex or edge' });
      if ((cell.vertex || cell.edge) && !cell.hasGeometry) errors.push({ phase: 'xml', severity: 'error', code: 'GEOMETRY_REQUIRED', path: `$output.cells.${id}.geometry`, message: 'Rendered vertex or edge requires mxGeometry' });
      if (cell.vertex) {
        const dimensions = ['x', 'y', 'width', 'height'].map(k => Number(g[k]));
        if (dimensions.some(n => !Number.isFinite(n))) errors.push({ phase: 'xml', severity: 'error', code: 'GEOMETRY_FINITE', path: `$output.cells.${id}.geometry`, message: 'Rendered vertex geometry must be finite' });
        if (Number(g.width) < 0 || Number(g.height) < 0) errors.push({ phase: 'xml', severity: 'error', code: 'GEOMETRY_SIZE', path: `$output.cells.${id}.geometry`, message: 'Rendered vertex size cannot be negative' });
        if (cell.attrs.parent === '1' && Number.isFinite(pageWidth) && Number.isFinite(pageHeight) && (Number(g.x) < 0 || Number(g.y) < 0 || Number(g.x) + Number(g.width) > pageWidth || Number(g.y) + Number(g.height) > pageHeight)) outputWarnings.push({ phase: 'xml', severity: 'warning', code: 'PAGE_OVERFLOW', path: `$output.cells.${id}.geometry`, message: 'Rendered vertex extends beyond page bounds' });
      }
      if (cell.edge) for (const [index, point] of g.points.entries()) if ((!point.as || ['points', 'sourcePoint', 'targetPoint'].includes(point.as)) && (!Number.isFinite(Number(point.x)) || !Number.isFinite(Number(point.y)))) errors.push({ phase: 'xml', severity: 'error', code: 'POINT_GEOMETRY', path: `$output.cells.${id}.geometry.points[${index}]`, message: 'Rendered route point must be finite' });
      if (id && id !== '0' && id !== '1' && cell.attrs.parent && !idSet.has(cell.attrs.parent)) errors.push({ phase: 'xml', severity: 'error', code: 'PARENT_UNRESOLVED', path: `$output.cells.${id}.parent`, message: `Unresolved parent ${cell.attrs.parent}` });
      for (const key of ['source', 'target']) if (cell.edge && !idSet.has(cell.attrs[key])) errors.push({ phase: 'xml', severity: 'error', code: 'ENDPOINT_UNRESOLVED', path: `$output.cells.${id}.${key}`, message: `Unresolved ${key} ${cell.attrs[key] ?? ''}` });
    }
    if (errors.length) { const e = new Error('Rendered XML failed structural checks'); e.diagnostics = errors; throw e; }
    writeOut(output, xml);
    console.log(JSON.stringify({ ok: true, output, type: rendered.type, cells: rendered.cells.length, diagnostics: [...rendered.diagnostics, ...outputWarnings] }, null, 2));
  } catch (error) { reportError(error); process.exitCode = 2; }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) runCli();
