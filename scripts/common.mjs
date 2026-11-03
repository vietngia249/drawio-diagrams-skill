import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export class DiagramInputError extends Error {
  constructor(message, diagnostics = []) { super(message); this.name = 'DiagramInputError'; this.diagnostics = diagnostics; }
}

export const esc = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;').replaceAll('\r', '&#xd;').replaceAll('\n', '&#xa;');
export const htmlText = value => String(value ?? '').replace(/\r\n?/g, '\n').split('\n')
  .map(line => line ? line.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;') : '&#xa0;').join('<br>');
export function textWidth(text, fontSize = 14, fontFamily = 'Arial') {
  if (!Number.isFinite(fontSize) || fontSize <= 0) throw new DiagramInputError('fontSize must be a positive finite number', [diagnostic('error', 'FONT_SIZE', '$fontSize', 'Expected a positive finite number', fontSize)]);
  const lines = String(text ?? '').split(/\r?\n/);
  // Layout estimate, not font metrics. The family name is accepted for future-compatible callers.
  void fontFamily;
  return Math.ceil(Math.max(0, ...lines.map(line => [...line].length)) * fontSize * 0.58);
}
const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const diagnostic = (severity, code, pathName, message, value) => ({ severity, code, path: pathName, message, ...(value === undefined ? {} : { value }) });

export function parseJsonText(text, source = '<input>') {
  try { return JSON.parse(String(text).replace(/^\uFEFF/, '')); }
  catch (error) { throw new DiagramInputError(`Invalid JSON in ${source}: ${error.message}`, [diagnostic('error', 'JSON_PARSE', '$', error.message)]); }
}

export function normalizeInput(data) {
  const diagnostics = [];
  if (!isObject(data)) throw new DiagramInputError('Input must be a JSON object', [diagnostic('error', 'INPUT_OBJECT', '$', 'Expected a JSON object')]);
  if (data.elements !== undefined && !Array.isArray(data.elements)) throw new DiagramInputError('elements must be an array', [diagnostic('error', 'ELEMENTS_ARRAY', '$.elements', 'Expected an array')]);
  if (Array.isArray(data.elements)) {
    const elements = data.elements.map((item, i) => {
      const p = `$.elements[${i}]`;
      if (!isObject(item)) throw new DiagramInputError(`${p} must be an object`, [diagnostic('error', 'ELEMENT_OBJECT', p, 'Expected an object')]);
      const vertex = item.vertex === true || item.vertex === 1 || item.vertex === '1';
      const edge = item.edge === true || item.edge === 1 || item.edge === '1';
      const attrs = isObject(item.attrs) ? { ...item.attrs } : {};
      for (const k of ['id', 'value', 'style', 'parent', 'source', 'target']) if (item[k] !== undefined && attrs[k] !== undefined && String(item[k]) !== String(attrs[k])) diagnostics.push(diagnostic('warning', 'ALIAS_CONFLICT', `${p}.${k}`, 'Top-level and attrs values differ; attrs takes precedence', { topLevel: item[k], attrs: attrs[k] }));
      for (const k of ['id', 'value', 'style', 'parent', 'source', 'target']) if (attrs[k] === undefined && item[k] !== undefined) attrs[k] = item[k];
      if (vertex === edge) throw new DiagramInputError(`${p} must declare exactly one of vertex or edge`, [diagnostic('error', 'CELL_KIND', p, 'Expected exactly one of vertex or edge')]);
      return { ...item, attrs, vertex, edge, geometry: item.geometry ?? {} };
    });
    return { ...data, elements, type: 'generic', diagnostics };
  }
  const type = data.type;
  if (!['sequence', 'erd', 'dfd', 'usecase', 'activity', 'class'].includes(type)) throw new DiagramInputError(`Unsupported diagram type: ${String(type)}. Supported types: sequence, erd, dfd, usecase, activity, class registration slot, or generic elements`, [diagnostic('error', 'UNSUPPORTED_TYPE', '$.type', 'Expected sequence, erd, dfd, usecase, activity, class registration slot, or generic elements', type)]);
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const conflict = (canonicalPath, legacyPath, canonical, legacy) => { if (canonical !== undefined && legacy !== undefined && !equal(canonical, legacy)) diagnostics.push(diagnostic('warning', 'ALIAS_CONFLICT', canonicalPath, `Conflicting legacy field ${legacyPath}; renderer precedence applies`, { canonical, legacy })); };
  if (type === 'erd') {
    for (const [i, entity] of (Array.isArray(data.entities) ? data.entities : []).entries()) conflict(`$.entities[${i}].attributes`, `$.entities[${i}].attrs`, entity?.attributes, entity?.attrs);
    for (const [i, relation] of (Array.isArray(data.relations) ? data.relations : []).entries()) { conflict(`$.relations[${i}].from`, `$.relations[${i}].a`, relation?.from, relation?.a); conflict(`$.relations[${i}].to`, `$.relations[${i}].b`, relation?.to, relation?.b); }
  } else if (type === 'dfd') {
    conflict('$.nodes', '$.processes', data.nodes, data.processes); conflict('$.flows', '$.edges', data.flows, data.edges);
    for (const [i, flow] of (Array.isArray(data.flows ?? data.edges) ? data.flows ?? data.edges : []).entries()) conflict(`$.flows[${i}].label`, `$.flows[${i}].text`, flow?.label, flow?.text);
  } else if (type === 'sequence') {
    const messages = Array.isArray(data.messages) ? data.messages : [];
    for (const [i, message] of messages.entries()) conflict(`$.messages[${i}].label`, `$.messages[${i}].text`, message?.label, message?.text);
  } else if (type === 'usecase') {
    for (const [i, relationship] of (Array.isArray(data.relationships) ? data.relationships : []).entries()) conflict(`$.relationships[${i}].type`, `$.relationships[${i}].kind`, relationship?.type, relationship?.kind);
  } else if (type === 'activity') {
    for (const [i, transition] of (Array.isArray(data.transitions) ? data.transitions : []).entries()) conflict(`$.transitions[${i}].guard`, `$.transitions[${i}].label`, transition?.guard, transition?.label);
  }
  return { ...data, type, diagnostics };
}

export function validateGeneric(data) {
  const errors = [], warnings = [], ids = new Set(['0', '1']);
  const elements = data.elements;
  for (const [i, el] of elements.entries()) {
    const p = `$.elements[${i}]`, a = el.attrs, id = a.id;
    if (typeof id !== 'string' && typeof id !== 'number' || String(id ?? '').trim() === '') { errors.push(diagnostic('error', 'ID_REQUIRED', `${p}.attrs.id`, 'A nonempty cell id is required', id)); continue; }
    const key = String(id);
    if (['0', '1'].includes(key)) errors.push(diagnostic('error', 'ID_RESERVED', `${p}.attrs.id`, 'IDs 0 and 1 are reserved', key));
    if (ids.has(key)) errors.push(diagnostic('error', 'ID_DUPLICATE', `${p}.attrs.id`, 'Cell IDs must be unique', key));
    ids.add(key);
    const parent = a.parent ?? '1';
    if (!['0', '1'].includes(String(parent)) && !elements.some(other => String(other.attrs.id) === String(parent))) errors.push(diagnostic('error', 'PARENT_UNRESOLVED', `${p}.attrs.parent`, `Parent ${parent} does not resolve`, parent));
    const g = el.geometry;
    if (!isObject(g)) { errors.push(diagnostic('error', 'GEOMETRY_OBJECT', `${p}.geometry`, 'Geometry must be an object')); continue; }
    if (el.vertex) {
      for (const k of ['x', 'y', 'width', 'height']) if (!Number.isFinite(g[k] ?? (k === 'x' || k === 'y' ? 0 : undefined))) errors.push(diagnostic('error', 'GEOMETRY_FINITE', `${p}.geometry.${k}`, 'Geometry must be finite numeric values', g[k]));
      for (const k of ['width', 'height']) if (Number.isFinite(g[k]) && g[k] < 0) errors.push(diagnostic('error', 'GEOMETRY_SIZE', `${p}.geometry.${k}`, 'Size must be nonnegative', g[k]));
    }
    if (el.edge) for (const k of ['source', 'target']) {
      const endpoint = a[k] ?? el[k];
      if (endpoint === undefined || String(endpoint).trim() === '') errors.push(diagnostic('error', 'ENDPOINT_REQUIRED', `${p}.attrs.${k}`, `${k} is required`));
      else if (!ids.has(String(endpoint)) && !elements.some(other => String(other.attrs.id) === String(endpoint))) errors.push(diagnostic('error', 'ENDPOINT_UNRESOLVED', `${p}.attrs.${k}`, `${k} ${endpoint} does not resolve`, endpoint));
    }
    if (el.edge && g.points !== undefined && !Array.isArray(g.points)) errors.push(diagnostic('error', 'POINTS_ARRAY', `${p}.geometry.points`, 'Edge points must be an array'));
    if (el.edge && g.points !== undefined && Array.isArray(g.points)) for (const [j, point] of g.points.entries()) if (!isObject(point) || !Number.isFinite(point.x) || !Number.isFinite(point.y)) errors.push(diagnostic('error', 'POINT_GEOMETRY', `${p}.geometry.points[${j}]`, 'Expected finite x and y', point));
  }
  const elementById = new Map(elements.map(el => [String(el.attrs.id), el]));
  for (const [i, el] of elements.entries()) {
    const id = String(el.attrs.id), seen = new Set([id]); let parent = String(el.attrs.parent ?? '1');
    while (parent !== '0' && parent !== '1' && elementById.has(parent)) {
      if (seen.has(parent)) { errors.push(diagnostic('error', 'PARENT_CYCLE', `$.elements[${i}].attrs.parent`, 'Parent hierarchy contains a cycle', parent)); break; }
      seen.add(parent); parent = String(elementById.get(parent).attrs.parent ?? '1');
    }
  }
  if (errors.length) throw new DiagramInputError('Generic diagram input validation failed', errors);
  const byId = elementById;
  for (const [i, el] of elements.entries()) {
    if (!el.vertex) continue;
    const parent = byId.get(String(el.attrs.parent ?? '1'));
    if (!parent?.vertex) continue;
    const childGeo = el.geometry, parentGeo = parent.geometry;
    const x = childGeo.x ?? 0, y = childGeo.y ?? 0, w = childGeo.width, h = childGeo.height;
    if (x < 0 || y < 0 || x + w > parentGeo.width || y + h > parentGeo.height) warnings.push(diagnostic('warning', 'PARENT_OVERFLOW', `$.elements[${i}].geometry`, 'Child vertex extends beyond its parent bounds', { parent: el.attrs.parent, x, y, width: w, height: h }));
  }
  const page = validatePage(data.page);
  for (const [i, el] of elements.entries()) if (el.vertex && String(el.attrs.parent ?? '1') === '1') {
    const g = el.geometry, x = g.x ?? 0, y = g.y ?? 0, w = g.width, h = g.height;
    if (x < 0 || y < 0 || x + w > page.width || y + h > page.height) warnings.push(diagnostic('warning', 'PAGE_OVERFLOW', `$.elements[${i}].geometry`, 'Vertex extends beyond page bounds', { x, y, width: w, height: h, ...page }));
  }
  return warnings;
}

export function validatePage(page = {}) {
  if (!isObject(page)) throw new DiagramInputError('page must be an object', [diagnostic('error', 'PAGE_OBJECT', '$.page', 'Expected an object')]);
  const result = { width: page.width ?? 1200, height: page.height ?? 800 };
  for (const k of ['width', 'height']) if (!Number.isFinite(result[k]) || result[k] <= 0) throw new DiagramInputError(`page.${k} must be a positive finite number`, [diagnostic('error', 'PAGE_DIMENSION', `$.page.${k}`, 'Expected a positive finite number', result[k])]);
  return result;
}

function mergeObject(base, override, where) {
  if (!isObject(override)) throw new DiagramInputError(`${where} must be an object`, [diagnostic('error', 'STYLE_OBJECT', where, 'Expected an object')]);
  const result = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (!(key in base)) throw new DiagramInputError(`Unknown style key ${where}.${key}`, [diagnostic('error', 'STYLE_UNKNOWN', `${where}.${key}`, 'Unknown style key')]);
    if (isObject(value)) {
      if (!isObject(base[key])) throw new DiagramInputError(`${where}.${key} must be a scalar`, [diagnostic('error', 'STYLE_VALUE', `${where}.${key}`, 'Expected a scalar value')]);
      result[key] = mergeObject(base[key], value, `${where}.${key}`);
    } else {
      if (typeof value !== typeof base[key] || (typeof value === 'number' && !Number.isFinite(value))) throw new DiagramInputError(`${where}.${key} has an invalid value type`, [diagnostic('error', 'STYLE_VALUE', `${where}.${key}`, `Expected ${typeof base[key]}`, value)]);
      if (typeof value === 'string' && !value.trim()) throw new DiagramInputError(`${where}.${key} cannot be empty`, [diagnostic('error', 'STYLE_VALUE', `${where}.${key}`, 'Expected a nonempty string')]);
      if (typeof value === 'number' && ((/fontSize|strokeWidth/i.test(key) && value <= 0) || (/rounded|lineHeight/i.test(key) && value < 0))) throw new DiagramInputError(`${where}.${key} is outside its supported range`, [diagnostic('error', 'STYLE_VALUE', `${where}.${key}`, 'Expected a positive dimension or a nonnegative radius', value)]);
      result[key] = value;
    }
  }
  return result;
}
export function mergeStyle(defaults, override = {}) { return mergeObject(defaults, override, '$.style'); }
export function loadStyle(override = {}) {
  const defaults = parseJsonText(fs.readFileSync(new URL('./style.json', import.meta.url), 'utf8'), 'scripts/style.json');
  return mergeStyle(defaults, override);
}

export function vertex(id, value, style, x, y, w, h, parent = '1') { return `<mxCell id="${esc(id)}" value="${esc(value)}" style="${esc(style)}" vertex="1" parent="${esc(parent)}"><mxGeometry x="${x}" y="${y}" width="${w}" height="${h}" as="geometry"/></mxCell>`; }
export function edge(id, source, target, value, style, parent = '1', geometry = {}) {
  const points = Array.isArray(geometry?.points) ? geometry.points : [];
  const point = (p, direct = false) => {
    if (!isObject(p) || !Number.isFinite(p.x) || !Number.isFinite(p.y)) throw new DiagramInputError('Edge waypoints require finite x and y', [diagnostic('error', 'POINT_GEOMETRY', '$geometry.points', 'Expected finite x and y', p)]);
    return `<mxPoint x="${p.x}" y="${p.y}"${direct && p.as ? ` as="${esc(p.as)}"` : ''}/>`;
  };
  const direct = points.filter(p => ['sourcePoint', 'targetPoint'].includes(p.as)), routes = points.filter(p => !['sourcePoint', 'targetPoint'].includes(p.as));
  const body = `${direct.map(p => point(p, true)).join('')}${routes.length ? `<Array as="points">${routes.map(p => point(p)).join('')}</Array>` : ''}`;
  return `<mxCell id="${esc(id)}" value="${esc(value)}" style="${esc(style)}" edge="1" parent="${esc(parent)}" source="${esc(source)}" target="${esc(target)}"><mxGeometry relative="${geometry?.relative ?? 1}" as="geometry">${body}</mxGeometry></mxCell>`;
}
const portStyle = (port, end) => {
  if (!port) return '';
  const side = { north: [0.5, 0], east: [1, 0.5], south: [0.5, 1], west: [0, 0.5] }[port.side];
  if (!side || !Number.isFinite(port.offset) || port.offset < 0 || port.offset > 1) throw new DiagramInputError(`Invalid ${end} edge port`, [diagnostic('error', 'PORT_INVALID', `$cell.ports.${end}`, 'Expected side north/east/south/west and normalized offset in [0,1]', port)]);
  const x = port.side === 'east' ? 1 : port.side === 'west' ? 0 : port.offset, y = port.side === 'north' ? 0 : port.side === 'south' ? 1 : port.offset;
  return `${end === 'source' ? 'exit' : 'entry'}X=${x};${end === 'source' ? 'exit' : 'entry'}Y=${y};${end === 'source' ? 'exit' : 'entry'}Dx=0;${end === 'source' ? 'exit' : 'entry'}Dy=0;${end === 'source' ? 'exit' : 'entry'}Perimeter=1;`;
};
export function serializeCells(cells) {
  if (!Array.isArray(cells)) throw new DiagramInputError('cells must be an array', [diagnostic('error', 'CELLS_ARRAY', '$cells', 'Expected an array')]);
  const models = new Map(cells.filter(cell => isObject(cell)).map(cell => [cell.id, cell]));
  const origins = new Map();
  const parentOrigin = (id, active = new Set()) => {
    if (!id || id === '0' || id === '1' || !models.has(id)) return { x: 0, y: 0 };
    if (origins.has(id)) return origins.get(id);
    if (active.has(id)) throw new DiagramInputError(`Parent cycle at ${id}`, [diagnostic('error', 'PARENT_CYCLE', `$cells.${id}.parent`, 'Cell parents must be acyclic', id)]);
    active.add(id);
    const cell = models.get(id), p = parentOrigin(cell.parent, active), g = cell.geometry ?? {};
    const origin = cell.kind === 'vertex' ? { x: p.x + numCoord(g.x), y: p.y + numCoord(g.y) } : p;
    active.delete(id); origins.set(id, origin); return origin;
  };
  const numCoord = value => { const n = Number(value); if (!Number.isFinite(n)) throw new DiagramInputError('Cell geometry coordinates must be finite', [diagnostic('error', 'GEOMETRY_FINITE', '$cells.geometry', 'Expected finite coordinates', value)]); return n; };
  return cells.map((cell, index) => {
    if (typeof cell === 'string') return cell;
    if (!isObject(cell) || typeof cell.id !== 'string' || !cell.id) throw new DiagramInputError(`cells[${index}] requires an ID`, [diagnostic('error', 'CELL_ID', `$cells[${index}].id`, 'Expected a nonempty string')]);
    if (cell.kind === 'vertex') {
      const g = cell.geometry ?? {};
      return vertex(cell.id, cell.value ?? '', cell.style ?? '', g.x, g.y, g.width, g.height, cell.parent ?? '1');
    }
    if (cell.kind === 'edge') {
      const g = cell.geometry ?? {}, ports = cell.ports ?? {};
      const baseStyle = String(cell.style ?? ''), separator = baseStyle && !baseStyle.endsWith(';') ? ';' : '';
      const style = `${baseStyle}${separator}${portStyle(ports.source, 'source')}${portStyle(ports.target, 'target')}`;
      const origin = parentOrigin(cell.parent), local = point => ({ ...point, x: numCoord(point.x) - origin.x, y: numCoord(point.y) - origin.y });
      const points = [...(g.sourcePoint ? [{ ...local(g.sourcePoint), as: 'sourcePoint' }] : []), ...(g.targetPoint ? [{ ...local(g.targetPoint), as: 'targetPoint' }] : []), ...(g.points ?? []).map(local)];
      return edge(cell.id, cell.source, cell.target, cell.value ?? '', style, cell.parent ?? '1', { relative: g.relative ?? 1, points });
    }
    throw new DiagramInputError(`cells[${index}].kind must be vertex or edge`, [diagnostic('error', 'CELL_KIND', `$cells[${index}].kind`, 'Expected vertex or edge', cell.kind)]);
  });
}
export function docXml(title, cells, page = { width: 1200, height: 800 }) { const size = validatePage(page); return `<?xml version="1.0" encoding="UTF-8"?><mxfile host="app.diagrams.net" type="device"><diagram id="diagram1" name="${esc(title)}"><mxGraphModel page="1" pageWidth="${size.width}" pageHeight="${size.height}" grid="1" gridSize="10"><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells.join('')}</root></mxGraphModel></diagram></mxfile>`; }
export function writeOut(out, xml) { fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true }); fs.writeFileSync(out, xml, 'utf8'); }
export function layoutGrid(items, cols = 4, cellW = 220, cellH = 150) { return items.map((it, i) => ({ ...it, x: 40 + (i % cols) * cellW, y: 50 + Math.floor(i / cols) * cellH })); }

export function renderGeneric(data) {
  validateGeneric(data);
  return data.elements.map(el => {
    const a = el.attrs, g = el.geometry;
    if (el.edge) {
      const points = Array.isArray(g.points) ? g.points : [];
      const point = (p, direct = false) => { if (!isObject(p) || !Number.isFinite(p.x) || !Number.isFinite(p.y)) throw new DiagramInputError('Edge points require finite x and y', [diagnostic('error', 'POINT_GEOMETRY', '$.elements.geometry.points', 'Expected finite x and y', p)]); return `<mxPoint x="${p.x}" y="${p.y}"${direct && p.as ? ` as="${esc(p.as)}"` : ''}/>`; };
      const direct = points.filter(p => p.as === 'sourcePoint' || p.as === 'targetPoint'), routes = points.filter(p => !['sourcePoint', 'targetPoint'].includes(p.as));
      return `<mxCell id="${esc(a.id)}" value="${esc(a.value ?? '')}" style="${esc(a.style ?? '')}" edge="1" parent="${esc(a.parent ?? '1')}" source="${esc(a.source)}" target="${esc(a.target)}"><mxGeometry relative="${g.relative ?? 1}" as="geometry">${direct.map(p => point(p, true)).join('')}${routes.length ? `<Array as="points">${routes.map(p => point(p)).join('')}</Array>` : ''}</mxGeometry></mxCell>`;
    }
    return vertex(a.id, a.value ?? '', a.style ?? '', g.x ?? 0, g.y ?? 0, g.width, g.height, a.parent ?? '1');
  });
}

export function assertSafeOutput(inputPath, outputPath) {
  const input = path.resolve(inputPath), output = path.resolve(outputPath);
  const canonical = p => {
    let current = p, rest = [];
    while (!fs.existsSync(current)) { const parent = path.dirname(current); if (parent === current) break; rest.unshift(path.basename(current)); current = parent; }
    return path.join(fs.realpathSync.native(current), ...rest);
  };
  if (canonical(input).toLowerCase() === canonical(output).toLowerCase()) throw new DiagramInputError('Output path must not overwrite the input', [diagnostic('error', 'OUTPUT_OVERWRITE', '$output', 'Input and output resolve to the same path')]);
}
export function assertOutsideReferenceTree(outputPath, repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')) {
  const canonical = p => {
    let current = path.resolve(p), rest = [];
    while (!fs.existsSync(current)) { const parent = path.dirname(current); if (parent === current) break; rest.unshift(path.basename(current)); current = parent; }
    return path.join(fs.realpathSync.native(current), ...rest);
  };
  const output = canonical(outputPath), protectedRoot = canonical(path.resolve(repositoryRoot, 'work', 'drawio-references'));
  const relative = path.relative(protectedRoot, output);
  if (relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) throw new DiagramInputError('Output path is inside the read-only reference tree', [diagnostic('error', 'REFERENCE_TREE_WRITE', '$output', 'Choose an output outside work/drawio-references')]);
}

export function parseCli(argv, usage) {
  const positional = [], options = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') return { help: true, usage };
    if (arg.startsWith('--')) {
      const [key, inline] = arg.slice(2).split('=', 2);
      if (['blind'].includes(key)) { if (key in options) throw new DiagramInputError(`Duplicate option: ${arg}`, [diagnostic('error', 'CLI_OPTION_DUPLICATE', '$args', 'Option was supplied more than once', key)]); options[key] = true; continue; }
      if (!['style', 'page', 'generated-page', 'reference-page', 'type'].includes(key)) throw new DiagramInputError(`Unknown option: ${arg}`, [diagnostic('error', 'CLI_OPTION', '$args', 'Unknown option', arg)]);
      const value = inline ?? argv[++i];
      if (value === undefined || value.startsWith('-')) throw new DiagramInputError(`Option --${key} requires a value`, [diagnostic('error', 'CLI_VALUE', '$args', 'Option requires a value', key)]);
      if (key in options) throw new DiagramInputError(`Duplicate option: --${key}`, [diagnostic('error', 'CLI_OPTION_DUPLICATE', '$args', 'Option was supplied more than once', key)]);
      options[key] = value;
    } else if (arg === '-o') { const value = argv[++i]; if (!value || value.startsWith('-')) throw new DiagramInputError('-o requires an output path', [diagnostic('error', 'CLI_VALUE', '$args', '-o requires a path')]); if ('output' in options) throw new DiagramInputError('Duplicate -o option', [diagnostic('error', 'CLI_OPTION_DUPLICATE', '$args', '-o was supplied more than once')]); options.output = value; }
    else if (arg.startsWith('-')) throw new DiagramInputError(`Unknown option: ${arg}`, [diagnostic('error', 'CLI_OPTION', '$args', 'Unknown option', arg)]);
    else positional.push(arg);
  }
  return { positional, options };
}

export function ensureOptions(options, allowed) {
  for (const key of Object.keys(options)) if (!allowed.includes(key)) throw new DiagramInputError(`Option --${key} is not supported by this command`, [diagnostic('error', 'CLI_OPTION_UNUSED', '$args', 'Option is not supported by this command', key)]);
}

export function reportError(error) { const diagnostics = error.diagnostics?.length ? error.diagnostics : [diagnostic('error', 'FAILURE', '$', error.message)]; console.error(JSON.stringify({ ok: false, error: error.message, diagnostics }, null, 2)); }
