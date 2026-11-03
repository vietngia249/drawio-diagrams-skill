import fs from 'node:fs';
import zlib from 'node:zlib';
import { DiagramInputError } from './common.mjs';

const fail = (code, message, value) => { throw new DiagramInputError(message, [{ severity: 'error', code, path: '$xml', message, ...(value === undefined ? {} : { value }) }]); };
function decodeEntities(text) {
  if (/&(?!(?:#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);)/i.test(text)) fail('XML_ENTITY', 'Unknown or malformed XML entity');
  return text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (all, entity) => {
    if (entity[0] === '#') { const hex = entity[1]?.toLowerCase() === 'x', code = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10); if (!Number.isFinite(code) || code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) fail('XML_ENTITY', `Invalid character entity ${all}`); return String.fromCodePoint(code); }
    return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[entity.toLowerCase()];
  });
}
export function parseXml(xml) {
  const root = { name: '#document', attrs: {}, children: [], text: '' }, stack = [root]; let i = 0;
  const nameRe = /^[A-Za-z_][\w:.-]*/;
  while (i < xml.length) {
    if (xml[i] !== '<') { const end = xml.indexOf('<', i), j = end < 0 ? xml.length : end; stack.at(-1).text += decodeEntities(xml.slice(i, j)); i = j; continue; }
    if (xml.startsWith('<!--', i)) { const end = xml.indexOf('-->', i + 4); if (end < 0) fail('XML_COMMENT', 'Unclosed XML comment'); i = end + 3; continue; }
    if (xml.startsWith('<![CDATA[', i)) { const end = xml.indexOf(']]>', i + 9); if (end < 0) fail('XML_CDATA', 'Unclosed CDATA section'); stack.at(-1).text += xml.slice(i + 9, end); i = end + 3; continue; }
    if (xml.startsWith('<?', i)) { const end = xml.indexOf('?>', i + 2); if (end < 0) fail('XML_PI', 'Unclosed processing instruction'); i = end + 2; continue; }
    if (xml.startsWith('<!', i)) fail('XML_DECLARATION', 'DOCTYPE and other declarations are not supported');
    if (xml.startsWith('</', i)) {
      i += 2; const m = xml.slice(i).match(nameRe); if (!m) fail('XML_CLOSE', 'Malformed closing tag'); const name = m[0]; i += name.length; while (/\s/.test(xml[i] ?? '')) i++; if (xml[i++] !== '>') fail('XML_CLOSE', `Malformed closing tag ${name}`);
      if (stack.length === 1 || stack.at(-1).name !== name) fail('XML_NESTING', `Mismatched closing tag ${name}`); stack.pop(); continue;
    }
    i++; const nm = xml.slice(i).match(nameRe); if (!nm) fail('XML_TAG', 'Malformed start tag'); const node = { name: nm[0], attrs: {}, children: [], text: '' }; i += nm[0].length;
    while (i < xml.length) {
      while (/\s/.test(xml[i] ?? '')) i++;
      if (xml.startsWith('/>', i)) { i += 2; stack.at(-1).children.push(node); break; }
      if (xml[i] === '>') { i++; stack.at(-1).children.push(node); stack.push(node); break; }
      const am = xml.slice(i).match(nameRe); if (!am) fail('XML_ATTRIBUTE', `Malformed attribute in ${node.name}`); const key = am[0]; i += key.length;
      if (key in node.attrs) fail('XML_ATTRIBUTE_DUPLICATE', `Duplicate attribute ${key}`);
      while (/\s/.test(xml[i] ?? '')) i++; if (xml[i++] !== '=') fail('XML_ATTRIBUTE', `Expected '=' after ${key}`); while (/\s/.test(xml[i] ?? '')) i++;
      const quote = xml[i++]; if (quote !== '"' && quote !== "'") fail('XML_ATTRIBUTE', `Expected quoted value for ${key}`); const end = xml.indexOf(quote, i); if (end < 0) fail('XML_ATTRIBUTE', `Unclosed value for ${key}`); node.attrs[key] = decodeEntities(xml.slice(i, end)); i = end + 1;
    }
  }
  if (stack.length !== 1) fail('XML_NESTING', `Unclosed tag ${stack.at(-1).name}`);
  const roots = root.children.filter(n => n.name !== '#text'); if (roots.length !== 1 || root.text.trim()) fail('XML_ROOT', 'XML must have exactly one document root and no text outside it'); return roots[0];
}

function decodeDiagramPayload(node) {
  const text = node.text.trim(); if (!text) fail('DIAGRAM_EMPTY', `Diagram page ${node.attrs.name || node.attrs.id || ''} has an empty payload`);
  try {
    const bytes = Buffer.from(text.replace(/\s/g, ''), 'base64');
    for (const inflate of [zlib.inflateRawSync, zlib.inflateSync]) {
      try { const decoded = inflate(bytes).toString('utf8'); return decodeURIComponent(decoded); } catch { /* try next supported container */ }
    }
  } catch { /* report below */ }
  fail('DIAGRAM_DECOMPRESS', 'Unable to decode compressed draw.io page payload');
}

export function parseDrawioText(source, selection) {
  let document = parseXml(source.replace(/^\uFEFF/, ''));
  let pages;
  if (document.name === 'mxGraphModel') pages = [{ id: 'page1', name: 'Page-1', model: document }];
  else if (document.name === 'mxfile') {
    pages = document.children.filter(n => n.name === 'diagram').map((node, index) => {
      const first = node.children.find(n => n.name === 'mxGraphModel');
      const embedded = node.text.trim();
      const model = first ?? (embedded.startsWith('<mxGraphModel') ? parseXml(embedded) : parseXml(decodeDiagramPayload(node)));
      return { id: node.attrs.id ?? `page${index + 1}`, name: node.attrs.name ?? `Page-${index + 1}`, model };
    });
    const pageIds = new Set();
    for (const page of pages) {
      if (pageIds.has(page.id)) fail('PAGE_ID_DUPLICATE', `Diagram page IDs must be unique: ${page.id}`, page.id);
      pageIds.add(page.id);
    }
  } else fail('DRAWIO_ROOT', 'Expected an mxfile or mxGraphModel root');
  if (!pages.length) fail('DRAWIO_PAGES', 'No diagram pages were found');
  let page;
  if (selection === undefined) {
    if (pages.length !== 1) fail('PAGE_SELECTION_REQUIRED', `Input has ${pages.length} pages; select one with --page`, pages.map(p => ({ id: p.id, name: p.name })));
    page = pages[0];
  } else {
    page = pages[Number.isInteger(Number(selection)) ? Number(selection) : -1] ?? pages.find(p => p.id === selection || p.name === selection);
    if (!page) fail('PAGE_NOT_FOUND', `Page selection ${selection} did not match a page`, pages.map(p => ({ id: p.id, name: p.name })));
  }
  const graph = page.model.name === 'mxGraphModel' ? page.model : page.model.children.find(n => n.name === 'mxGraphModel');
  if (!graph) fail('GRAPH_MODEL', 'Selected page has no mxGraphModel');
  return { document, page, pageCount: pages.length, graph };
}
export function readDrawio(file, selection) { return parseDrawioText(fs.readFileSync(file, 'utf8'), selection); }

export function cellsFromModel(model) {
  const root = model.children.find(n => n.name === 'root'); if (!root) fail('GRAPH_ROOT', 'mxGraphModel is missing root');
  return root.children.filter(n => n.name === 'mxCell').map(cell => {
    const geometry = cell.children.find(n => n.name === 'mxGeometry');
    return { attrs: { ...cell.attrs }, geometry: geometry ? { ...geometry.attrs, points: geometry.children.flatMap(c => c.name === 'mxPoint' ? [{ ...c.attrs }] : c.name === 'Array' ? c.children.filter(p => p.name === 'mxPoint').map(p => ({ ...p.attrs })) : []) } : {}, hasGeometry: Boolean(geometry), vertex: cell.attrs.vertex === '1', edge: cell.attrs.edge === '1' };
  });
}
