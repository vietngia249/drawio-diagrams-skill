import { DiagramInputError, htmlText, textWidth } from './common.mjs';
import { routeOrthogonalEdges } from './geometry.mjs';

const RELATION_TYPES = new Set(['association', 'dependency', 'generalization', 'aggregation', 'composition', 'realization']);
const VISIBILITY = Object.freeze({ public: '+', private: '-', protected: '#', package: '~', 'package-private': '~' });
const safeId = value => String(value).replace(/[^A-Za-z0-9_.-]/g, '_');
const stableHash = value => {
  let hash = 2166136261;
  for (const char of String(value)) hash = Math.imul(hash ^ char.codePointAt(0), 16777619);
  return (hash >>> 0).toString(16);
};
const classId = value => `uml_class_${safeId(value)}_${stableHash(value)}`;
const issue = (code, path, message, value) => new DiagramInputError(`Class diagram ${path}: ${message}`, [{ phase: 'planned', severity: 'error', code, path, message, ...(value === undefined ? {} : { value }) }]);
const text = value => String(value ?? '');
const valueLabel = (value, key) => value?.[key] == null ? '' : String(value[key]);

function visibility(value, path) {
  const result = VISIBILITY[value ?? 'package'];
  if (!result) throw issue('CLASS_VISIBILITY', path, 'visibility must be public, private, protected, or package', value);
  return result;
}

function normalizeClasses(data) {
  const input = data.classes ?? data.elements;
  if (!Array.isArray(input)) throw issue('CLASS_ARRAY', '$.classes', 'expected an array');
  if (input.length === 0) throw issue('CLASS_EMPTY', '$.classes', 'expected at least one class or interface');
  const keys = new Set(), models = input.map((item, index) => {
    const at = `$.classes[${index}]`;
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw issue('CLASS_OBJECT', at, 'expected a class object');
    const key = item.id ?? item.name;
    if (typeof key !== 'string' || !key.trim()) throw issue('CLASS_NAME', `${at}.name`, 'expected a nonempty class id or name');
    if (keys.has(key)) throw issue('CLASS_DUPLICATE', `${at}.id`, `duplicate class ${key}`, key);
    keys.add(key);
    const kind = item.kind ?? 'class';
    if (!['class', 'interface', 'external', 'datatype'].includes(kind)) throw issue('CLASS_KIND', `${at}.kind`, 'kind must be class, interface, external, or datatype', kind);
    const attributes = item.attributes ?? item.attrs ?? [];
    const operations = item.operations ?? [];
    if (!Array.isArray(attributes) || !Array.isArray(operations)) throw issue('CLASS_MEMBERS', at, 'attributes and operations must be arrays');
    const normalizedAttributes = attributes.map((attribute, memberIndex) => {
      if (!attribute || typeof attribute !== 'object' || Array.isArray(attribute) || typeof attribute.name !== 'string' || !attribute.name.trim()) throw issue('CLASS_ATTRIBUTE', `${at}.attributes[${memberIndex}]`, 'expected an attribute with a name');
      return { ...attribute, visibility: visibility(attribute.visibility, `${at}.attributes[${memberIndex}].visibility`), type: text(attribute.type) };
    });
    const normalizedOperations = operations.map((operation, memberIndex) => {
      const opPath = `${at}.operations[${memberIndex}]`;
      if (!operation || typeof operation !== 'object' || Array.isArray(operation) || typeof operation.name !== 'string' || !operation.name.trim()) throw issue('CLASS_OPERATION', opPath, 'expected an operation with a name');
      const parameters = operation.parameters ?? operation.params ?? [];
      if (!Array.isArray(parameters)) throw issue('CLASS_PARAMETERS', `${opPath}.parameters`, 'expected an array');
      return { ...operation, visibility: visibility(operation.visibility, `${opPath}.visibility`), parameters: parameters.map((parameter, parameterIndex) => {
        if (!parameter || typeof parameter !== 'object' || Array.isArray(parameter) || typeof parameter.name !== 'string' || !parameter.name.trim()) throw issue('CLASS_PARAMETER', `${opPath}.parameters[${parameterIndex}]`, 'expected a parameter with a name');
        return parameter;
      }) };
    });
    const displayName = item.name ?? item.id;
    const stereotype = item.stereotype ?? (kind === 'interface' ? 'interface' : kind === 'external' ? 'external' : kind === 'datatype' ? 'type' : '');
    return { ...item, key, displayName, id: classId(key), kind, stereotype, attributes: normalizedAttributes, operations: normalizedOperations };
  });
  return models;
}

function memberWidth(models, style) {
  const font = Number(style.fontSize ?? 13);
  return models.map(model => {
    const header = `${model.stereotype ? `<<${model.stereotype}>> ` : ''}${model.displayName}`;
    const attrs = model.attributes.map(attribute => `${attribute.visibility} ${attribute.name}${attribute.type ? ` : ${attribute.type}` : ''}`);
    const operations = model.operations.map(operation => {
      const params = operation.parameters.map(parameter => `${parameter.name}${parameter.optional ? '?' : ''} : ${text(parameter.type)}`).join(', ');
      return `${operation.visibility} ${operation.name}(${params})${operation.returnType ? ` : ${operation.returnType}` : ''}`;
    });
    const width = Math.max(240, Math.min(900, Math.max(textWidth(header, font), ...attrs.map(line => textWidth(line, font)), ...operations.map(line => textWidth(line, font))) + 42));
    const lineHeight = Math.ceil(font * 1.65 + 6);
    const wrappedLineCount = lines => Math.max(1, lines.reduce((count, line) => count + Math.max(1, Math.ceil(textWidth(line, font) / (width - 24))), 0));
    const attrLineCount = wrappedLineCount(attrs), operationLineCount = wrappedLineCount(operations);
    const height = 42 + attrLineCount * lineHeight + 2 + operationLineCount * lineHeight;
    return { ...model, header, attrLines: attrs, operationLines: operations, width, height, headerHeight: 42, attrHeight: attrLineCount * lineHeight, operationHeight: operationLineCount * lineHeight };
  });
}

function pointSide(a, b, tie) {
  const dx = b.x + b.width / 2 - (a.x + a.width / 2), dy = b.y + b.height / 2 - (a.y + a.height / 2);
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'east' : 'west';
  if (Math.abs(dy) > Math.abs(dx)) return dy > 0 ? 'south' : 'north';
  return tie;
}

function roleLabelBoxes(port, label, fontSize) {
  const lines = label.split(/\r?\n/), width = Math.max(28, Math.min(150, Math.max(...lines.map(line => textWidth(line, fontSize))) + 8));
  const height = Math.max(20, lines.length * Math.ceil(fontSize * 1.45) + 4), gap = 8, distances = [0, 32, 72, 120, 180];
  if (port.side === 'east' || port.side === 'west') {
    const x = port.side === 'east' ? port.point.x + gap : port.point.x - gap - width;
    return distances.flatMap(distance => [
      { x, y: port.point.y - height - gap - distance, width, height },
      { x, y: port.point.y + gap + distance, width, height },
    ]);
  }
  const y = port.side === 'north' ? port.point.y - gap - height : port.point.y + gap;
  return distances.flatMap(distance => [
    { x: port.point.x - width - gap - distance, y, width, height },
    { x: port.point.x + gap + distance, y, width, height },
  ]);
}

function overlaps(a, b, pad = 0) {
  return a.x < b.x + b.width + pad && a.x + a.width > b.x - pad && a.y < b.y + b.height + pad && a.y + a.height > b.y - pad;
}
function segmentHitsBox(a, b, box) {
  if (a.x === b.x) return a.x > box.x && a.x < box.x + box.width && Math.max(Math.min(a.y, b.y), box.y) < Math.min(Math.max(a.y, b.y), box.y + box.height);
  return a.y === b.y && a.y > box.y && a.y < box.y + box.height && Math.max(Math.min(a.x, b.x), box.x) < Math.min(Math.max(a.x, b.x), box.x + box.width);
}

export function renderClass(data, styles = {}) {
  const style = styles.class ?? {}, fontSize = Number(style.fontSize ?? 13), strokeColor = style.strokeColor ?? '#000000', fillColor = style.fillColor ?? '#ffffff';
  const normalized = normalizeClasses(data), classes = memberWidth(normalized, style);
  const keyMap = new Map(classes.map(model => [model.key, model]));
  const names = new Map();
  for (const model of classes) {
    if (names.has(model.displayName)) throw issue('CLASS_DUPLICATE', '$.classes', `duplicate class name ${model.displayName}`);
    names.set(model.displayName, model);
  }
  const relationships = data.relationships ?? data.relations ?? [];
  if (!Array.isArray(relationships)) throw issue('CLASS_RELATIONSHIPS', '$.relationships', 'expected an array');
  const relationshipIds = new Set();
  for (const [index, relation] of relationships.entries()) {
    const at = `$.relationships[${index}]`;
    if (!relation || typeof relation !== 'object' || Array.isArray(relation)) throw issue('CLASS_RELATIONSHIP', at, 'expected a relationship object');
    const id = relation.id ?? `relation_${index}`;
    if (relationshipIds.has(id)) throw issue('CLASS_RELATIONSHIP_DUPLICATE', `${at}.id`, `duplicate relationship id ${id}`, id);
    relationshipIds.add(id);
    if (!RELATION_TYPES.has(relation.type)) throw issue('CLASS_RELATIONSHIP_TYPE', `${at}.type`, `supported relationship types are ${[...RELATION_TYPES].join(', ')}`, relation.type);
    if (!(keyMap.has(relation.from) || names.has(relation.from))) throw issue('CLASS_ENDPOINT', `${at}.from`, `unknown class ${relation.from}`, relation.from);
    if (!(keyMap.has(relation.to) || names.has(relation.to))) throw issue('CLASS_ENDPOINT', `${at}.to`, `unknown class ${relation.to}`, relation.to);
  }

  const cols = Math.max(1, Math.ceil(Math.sqrt(classes.length))), rows = Math.ceil(classes.length / cols);
  const colWidths = Array.from({ length: cols }, (_, col) => Math.max(...classes.filter((_, index) => index % cols === col).map(model => model.width), 0));
  const rowHeights = Array.from({ length: rows }, (_, row) => Math.max(...classes.slice(row * cols, (row + 1) * cols).map(model => model.height), 0));
  const colX = [], rowY = [];
  for (let col = 0; col < cols; col++) colX[col] = 100 + colWidths.slice(0, col).reduce((sum, width) => sum + width + 430, 0);
  for (let row = 0; row < rows; row++) rowY[row] = 100 + rowHeights.slice(0, row).reduce((sum, height) => sum + height + 320, 0);
  for (const [index, model] of classes.entries()) { model.x = colX[index % cols]; model.y = rowY[Math.floor(index / cols)]; }
  const inferredPage = { width: Math.ceil((colX.at(-1) ?? 0) + colWidths.at(-1) + 700), height: Math.ceil((rowY.at(-1) ?? 0) + rowHeights.at(-1) + 700) };
  const basePage = { width: Math.max(inferredPage.width, data.page?.width ?? 0), height: Math.max(inferredPage.height, data.page?.height ?? 0) };
  const cells = [], obstacles = [];
  const classStyle = `swimlane;horizontal=1;startSize=42;html=1;whiteSpace=wrap;align=center;verticalAlign=middle;fontFamily=${style.fontFamily ?? 'Arial,Helvetica,sans-serif'};fontSize=${fontSize};fontStyle=1;fillColor=${fillColor};strokeColor=${strokeColor};strokeWidth=1;container=1;collapsible=0;recursiveResize=0;`;
  const compartmentStyle = `text;html=1;whiteSpace=wrap;align=left;verticalAlign=top;spacing=5;fontFamily=${style.fontFamily ?? 'Arial,Helvetica,sans-serif'};fontSize=${fontSize};fillColor=none;strokeColor=none;`;
  const separatorStyle = `line;html=1;strokeColor=${strokeColor};strokeWidth=1;fillColor=none;align=left;verticalAlign=middle;spacingTop=-1;spacingLeft=3;spacingRight=10;rotatable=0;labelPosition=left;points=[];portConstraint=eastwest;`;
  const classById = new Map();
  for (const model of classes) {
    const header = model.stereotype ? `&lt;&lt;${model.stereotype}&gt;&gt;<br>${htmlText(model.displayName)}` : htmlText(model.displayName);
    const geometry = { x: model.x, y: model.y, width: model.width, height: model.height };
    const vertex = { kind: 'vertex', id: model.id, value: header, style: classStyle, parent: '1', geometry };
    cells.push(vertex); obstacles.push({ id: model.id, kind: 'node', bounds: geometry }); classById.set(model.key, model); classById.set(model.displayName, model);
    const attrHtml = model.attrLines.map(line => htmlText(line)).join('<br>');
    const operationHtml = model.operationLines.map(line => htmlText(line)).join('<br>');
    cells.push({ kind: 'vertex', id: `${model.id}_attributes`, value: attrHtml, style: compartmentStyle, parent: model.id, geometry: { x: 0, y: model.headerHeight, width: model.width, height: model.attrHeight } });
    cells.push({ kind: 'vertex', id: `${model.id}_separator`, value: '', style: separatorStyle, parent: model.id, geometry: { x: 0, y: model.headerHeight + model.attrHeight, width: model.width, height: 1 } });
    cells.push({ kind: 'vertex', id: `${model.id}_operations`, value: operationHtml, style: compartmentStyle, parent: model.id, geometry: { x: 0, y: model.headerHeight + model.attrHeight + 2, width: model.width, height: model.operationHeight } });
  }

  const edges = relationships.map((relation, index) => {
    const id = relation.id ?? `relation_${index}`, source = classById.get(relation.from), target = classById.get(relation.to);
    const sourceSide = pointSide(source, target, 'east'), targetSide = pointSide(target, source, 'west');
    return { id, relation, source, target, request: { id, allowSelfLoop: source === target, source: { nodeId: source.id, port: { side: sourceSide } }, target: { nodeId: target.id, port: { side: targetSide } }, ...(relation.label ? { label: { id: `${id}_label`, width: Math.min(180, textWidth(relation.label, fontSize) + 16), height: Math.max(22, Math.ceil(fontSize * 1.6)) } } : {}) } };
  });
  const routed = routeOrthogonalEdges({ obstacles, edges: edges.map(item => item.request), page: basePage, clearance: 18 });
  const routeErrors = routed.diagnostics.filter(diagnostic => diagnostic.severity === 'error');
  if (routeErrors.length) throw new DiagramInputError('Class relationship route planning failed', routeErrors);
  const routes = new Map(routed.routes.map(route => [route.edgeId, route]));
  const routeSegments = new Map();
  for (const item of edges) {
    const { id, relation } = item, route = routes.get(id);
    if (!route) throw issue('CLASS_ROUTE_MISSING', `$.relationships.${id}`, 'route planner did not return a route');
    const style = relationStyle(relation.type, strokeColor);
    cells.push({ kind: 'edge', id, value: '', style, parent: '1', source: item.source.id, target: item.target.id,
      ports: { source: { side: route.sourcePort.side, offset: route.sourcePort.offset }, target: { side: route.targetPort.side, offset: route.targetPort.offset } }, geometry: { relative: 1, points: route.points } });
    const points = [route.sourcePort.point, ...route.points, route.targetPort.point];
    routeSegments.set(id, points.slice(1).map((point, index) => [points[index], point]));
    if (route.label) cells.push({ kind: 'vertex', id: route.label.id, value: htmlText(relation.label), style: `shape=rect;html=1;whiteSpace=wrap;align=center;verticalAlign=middle;fontSize=${fontSize};fillColor=#ffffff;strokeColor=none;`, parent: '1', geometry: route.label.bounds });
  }

  const placedRoleLabels = [];
  for (const item of edges) if (item.relation.type === 'association') {
    const route = routes.get(item.id);
    for (const end of ['source', 'target']) {
      const role = valueLabel(item.relation, `${end}Role`), multiplicity = valueLabel(item.relation, `${end}Multiplicity`);
      const label = [multiplicity, role].filter(Boolean).join('\n');
      if (!label) continue;
      const port = route[`${end}Port`], candidates = roleLabelBoxes(port, label, fontSize);
      const otherNodes = obstacles.filter(obstacle => obstacle.id !== port.nodeId);
      const allSegments = [...routeSegments.values()].flat();
      const bounds = candidates.find(candidate => candidate.x >= 0 && candidate.y >= 0 && candidate.x + candidate.width <= basePage.width && candidate.y + candidate.height <= basePage.height
        && !otherNodes.some(obstacle => overlaps(candidate, obstacle.bounds, 4))
        && !allSegments.some(([a, b]) => segmentHitsBox(a, b, candidate))
        && !placedRoleLabels.some(other => overlaps(candidate, other, 2)));
      if (!bounds) throw issue('CLASS_ROLE_LABEL_COLLISION', `$.relationships.${item.id}.${end}Role`, 'no clear placement is available for the role or multiplicity label', label);
      cells.push({ kind: 'vertex', id: `${item.id}_${end}_role`, value: htmlText(label), style: `shape=rect;rounded=0;html=1;whiteSpace=wrap;align=center;verticalAlign=middle;fontFamily=${style.fontFamily ?? 'Arial,Helvetica,sans-serif'};fontSize=${fontSize};fillColor=#ffffff;strokeColor=none;spacing=2;`, parent: '1', geometry: bounds });
      placedRoleLabels.push(bounds);
    }
  }

  const topLevelVertices = cells.filter(cell => cell.kind === 'vertex' && cell.parent === '1').map(cell => cell.geometry);
  const page = data.page ?? { width: Math.ceil(Math.max(basePage.width, ...topLevelVertices.map(bounds => bounds.x + bounds.width)) + 24), height: Math.ceil(Math.max(basePage.height, ...topLevelVertices.map(bounds => bounds.y + bounds.height)) + 24) };
  const overflows = data.page && topLevelVertices.some(bounds => bounds.x < 0 || bounds.y < 0 || bounds.x + bounds.width > data.page.width || bounds.y + bounds.height > data.page.height);
  const diagnostics = overflows ? [{ phase: 'planned', severity: 'warning', code: 'PAGE_OVERFLOW', path: '$.page', message: 'Rendered class diagram content extends beyond the explicit page dimensions', value: data.page }] : [];
  return { cells, diagnostics, page };
}

function relationStyle(type, strokeColor) {
  const base = `html=1;rounded=0;edgeStyle=orthogonalEdgeStyle;jettySize=auto;strokeColor=${strokeColor};strokeWidth=1;`;
  if (type === 'dependency') return `${base}dashed=1;endArrow=open;endFill=0;startArrow=none;`;
  if (type === 'generalization') return `${base}endArrow=block;endFill=0;startArrow=none;`;
  if (type === 'realization') return `${base}dashed=1;endArrow=block;endFill=0;startArrow=none;`;
  if (type === 'aggregation') return `${base}startArrow=diamondThin;startFill=0;endArrow=none;`;
  if (type === 'composition') return `${base}startArrow=diamondThin;startFill=1;endArrow=none;`;
  return `${base}startArrow=none;endArrow=none;`;
}
