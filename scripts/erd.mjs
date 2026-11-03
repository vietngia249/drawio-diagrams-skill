import { DiagramInputError, htmlText, textWidth } from './common.mjs';
import { routeOrthogonalEdges } from './geometry.mjs';

const CARDINALITY_ARROW = Object.freeze({
  '1': 'ERone',
  '0..1': 'ERzeroToOne',
  '0..*': 'ERzeroToMany',
  '1..*': 'ERoneToMany',
});
const safeId = value => String(value).replace(/[^A-Za-z0-9_.-]/g, '_');
const stableHash = value => {
  let hash = 2166136261;
  for (const char of String(value)) hash = Math.imul(hash ^ char.codePointAt(0), 16777619);
  return (hash >>> 0).toString(16);
};
const entityId = name => `ent_${safeId(name)}_${stableHash(name)}`;
const error = (code, path, message, value) => new DiagramInputError(`ERD ${path}: ${message}`, [{ phase: 'planned', severity: 'error', code, path, message, ...(value === undefined ? {} : { value }) }]);
const cardinality = (relation, side) => relation[`${side}Cardinality`] ?? relation[`${side}Multiplicity`];
const markerText = (markers, labels) => markers.map(marker => `[${labels[marker] ?? marker}]`).join(' ');
const boundsOf = geometry => ({ x: geometry.x, y: geometry.y, width: geometry.width, height: geometry.height });

function readAttribute(raw, entityName, index, pathPrefix) {
  const at = `${pathPrefix}.attributes[${index}]`;
  const attr = typeof raw === 'string' ? { name: raw } : raw;
  if (!attr || typeof attr !== 'object' || Array.isArray(attr)) throw error('ERD_ATTRIBUTE', at, 'expected an attribute name or object');
  const name = attr.name ?? attr.n;
  if (typeof name !== 'string' || !name.trim()) throw error('ERD_ATTRIBUTE_NAME', `${at}.name`, 'expected a nonempty string');
  const type = attr.type ?? attr.t;
  const rawKey = attr.key ?? attr.k;
  const key = typeof rawKey === 'string' ? rawKey.trim().toUpperCase() : '';
  const markers = key === 'PRIMARY KEY' || key === 'PRIMARY_KEY' ? ['PK']
    : key === 'FOREIGN KEY' || key === 'FOREIGN_KEY' ? ['FK']
      : key.split(/[\s,|+]+/).filter(part => part === 'PK' || part === 'FK');
  return { name, type: type == null ? '' : String(type), markers: [...new Set(markers)] };
}

function textBox(text, fontSize, minWidth = 0, maxWidth = 460) {
  const width = Math.max(minWidth, Math.min(maxWidth, textWidth(text, fontSize) + 42));
  const lines = String(text).split(/\r?\n/).reduce((total, line) => total + Math.max(1, Math.ceil(textWidth(line, fontSize) / (width - 24))), 0);
  return { width, height: Math.max(36, lines * Math.max(18, fontSize * 1.65) + 8) };
}

function layoutEntities(entities, attrsByName, style, portCounts, relations, requestedPage) {
  const fontSize = Number(style.fontSize ?? 14), attrFont = Number(style.attribute?.fontSize ?? fontSize);
  const markerLabels = { PK: String(style.primaryKey?.marker ?? 'PK'), FK: String(style.foreignKey?.marker ?? 'FK') };
  const layout = entities.map(entity => {
    const header = textBox(entity.name, fontSize, 200);
    header.height = Math.max(header.height, portHeight(portCounts.get(`${entity.name}\0`) ?? 0));
    const rows = (attrsByName.get(entity.name).length ? attrsByName.get(entity.name) : [{ name: '', type: '', markers: [] }]).map(attr => {
      const label = `${markerText(attr.markers, markerLabels)}${attr.markers.length ? ' ' : ''}${attr.name}${attr.type ? ` : ${attr.type}` : ''}`;
      const measure = textBox(label, attrFont, 200);
      measure.height = Math.max(measure.height, portHeight(portCounts.get(`${entity.name}\0${attr.name}`) ?? 0));
      return { ...attr, label, measure };
    });
    return { name: entity.name, id: entityId(entity.name), header, rows, width: Math.max(header.width, ...rows.map(row => row.measure.width)), height: header.height + rows.reduce((sum, row) => sum + row.measure.height, 0) };
  });
  const cols = Math.max(1, Math.ceil(Math.sqrt(layout.length))), rows = Math.ceil(layout.length / cols);
  const entityColumn = new Map(entities.map((entity, index) => [entity.name, index % cols]));
  const entityRow = new Map(entities.map((entity, index) => [entity.name, Math.floor(index / cols)]));
  const colWidths = Array.from({ length: cols }, (_, col) => Math.max(...layout.filter((_, i) => i % cols === col).map(item => item.width), 0));
  const rowHeights = Array.from({ length: rows }, (_, row) => Math.max(...layout.slice(row * cols, (row + 1) * cols).map(item => item.height), 0));
  const routeDemand = (axis, boundary) => {
    const start = relation => axis === 'x' ? entityColumn.get(relation.from ?? relation.a) : entityRow.get(relation.from ?? relation.a);
    const end = relation => axis === 'x' ? entityColumn.get(relation.to ?? relation.b) : entityRow.get(relation.to ?? relation.b);
    const crossing = relations.filter(relation => {
      const a = start(relation), b = end(relation);
      return a !== undefined && b !== undefined && Math.min(a, b) <= boundary && Math.max(a, b) > boundary;
    });
    const labels = crossing.map(relation => relation.name ? textBox(String(relation.name), Number(style.relation?.fontSize ?? fontSize), 70, 190) : { width: 0, height: 0 });
    return { lanes: crossing.length, labelWidth: Math.max(0, ...labels.map(label => label.width)), labelHeight: Math.max(0, ...labels.map(label => label.height)) };
  };
  const xGaps = Array.from({ length: Math.max(0, cols - 1) }, (_, boundary) => {
    const demand = routeDemand('x', boundary);
    return Math.max(72, 56 + demand.lanes * 56 + demand.labelWidth);
  });
  const yGaps = Array.from({ length: Math.max(0, rows - 1) }, (_, boundary) => {
    const demand = routeDemand('y', boundary);
    return Math.max(72, 56 + demand.lanes * 56 + demand.labelHeight);
  });
  const gapX = requestedPage && cols > 1
    ? Math.max(Math.max(...xGaps), (requestedPage.width - 160 - colWidths.reduce((sum, value) => sum + value, 0)) / (cols - 1))
    : undefined;
  const gapY = requestedPage && rows > 1
    ? Math.max(Math.max(...yGaps), (requestedPage.height - 160 - rowHeights.reduce((sum, value) => sum + value, 0)) / (rows - 1))
    : undefined;
  const colX = [], rowY = [];
  for (let col = 0; col < cols; col++) colX[col] = 80 + colWidths.slice(0, col).reduce((sum, value, index) => sum + value + (gapX ?? xGaps[index]), 0);
  for (let row = 0; row < rows; row++) rowY[row] = 80 + rowHeights.slice(0, row).reduce((sum, value, index) => sum + value + (gapY ?? yGaps[index]), 0);
  for (const [i, item] of layout.entries()) { item.x = colX[i % cols]; item.y = rowY[Math.floor(i / cols)]; }
  const longestLabel = Math.max(0, ...relations.map(relation => relation.name ? textBox(String(relation.name), Number(style.relation?.fontSize ?? fontSize), 70, 190).width : 0));
  const margin = 56 + longestLabel + relations.length * 12;
  return { layout, page: { width: Math.ceil((colX.at(-1) ?? 0) + (colWidths.at(-1) ?? 0) + margin), height: Math.ceil((rowY.at(-1) ?? 0) + (rowHeights.at(-1) ?? 0) + margin) } };
}

function portHeight(count) {
  if (count === 0) return 0;
  if (count === 1) return 80;
  return Math.ceil(Math.max(36, 14 / 0.12, 14 * (count - 1) / 0.76) + 2);
}

function placeRelationLabel(route, label, obstacles, routes, placed, page, clearance) {
  const width = label.width, height = label.height, distances = [0, 40, 90, 160, 260, 400, 600];
  const points = [route.sourcePort.point, ...route.points, route.targetPort.point];
  const routeY = (route.sourcePort.point.y + route.targetPort.point.y) / 2;
  const isClear = bounds => {
    if (bounds.x < 0 || bounds.y < 0 || bounds.x + width > page.width || bounds.y + height > page.height || bounds.y + height > routeY - 8) return false;
    if (obstacles.some(obstacle => overlaps(bounds, obstacle.bounds, clearance / 2)) || placed.some(other => overlaps(bounds, other, 2))) return false;
    return !routes.some(candidate => {
      const routePoints = [candidate.sourcePort.point, ...candidate.points, candidate.targetPort.point];
      return routePoints.slice(1).some((point, segment) => segmentHitsRect(routePoints[segment], point, bounds));
    });
  };
  const segments = points.slice(1).map((b, index) => ({ a: points[index], b, index, horizontal: points[index].y === b.y })).sort((a, b) => Number(b.horizontal) - Number(a.horizontal) || a.index - b.index);
  for (const { a, b } of segments) {
    if (a.x === b.x && a.y === b.y) continue;
    const horizontal = a.y === b.y;
    const centers = [0.2, 0.35, 0.5, 0.65, 0.8].map(fraction => ({ x: a.x + (b.x - a.x) * fraction, y: a.y + (b.y - a.y) * fraction }));
    for (const mid of centers) for (const distance of distances) for (const sign of [-1, 1]) {
      const bounds = horizontal
        ? { x: mid.x - width / 2, y: mid.y + sign * (height / 2 + clearance + 4 + distance), width, height }
        : { x: mid.x + sign * (width / 2 + clearance + 4 + distance), y: mid.y - height / 2, width, height };
      if (isClear(bounds)) return bounds;
    }
  }
  const centerX = (route.sourcePort.point.x + route.targetPort.point.x) / 2;
  for (let row = 0; row < 8; row++) {
    const y = routeY - height - clearance - 8 - row * (height + clearance);
    for (const offset of [0, 50, -50, 110, -110, 180, -180, 260, -260]) {
      const bounds = { x: centerX + offset - width / 2, y, width, height };
      if (isClear(bounds)) return bounds;
    }
  }
  return undefined;
}
function overlaps(a, b, pad = 0) {
  return a.x < b.x + b.width + pad && a.x + a.width > b.x - pad && a.y < b.y + b.height + pad && a.y + a.height > b.y - pad;
}
function segmentHitsRect(a, b, box) {
  if (a.x === b.x) return a.x > box.x && a.x < box.x + box.width && Math.max(Math.min(a.y, b.y), box.y) < Math.min(Math.max(a.y, b.y), box.y + box.height);
  return a.y === b.y && a.y > box.y && a.y < box.y + box.height && Math.max(Math.min(a.x, b.x), box.x) < Math.min(Math.max(a.x, b.x), box.x + box.width);
}

function endpoint(raw, side, byName, attrRows, relationIndex) {
  const name = raw[side] ?? raw[side === 'from' ? 'a' : 'b'];
  if (typeof name !== 'string' || !byName.has(name)) throw error('ERD_ENDPOINT_ENTITY', `$.relations[${relationIndex}].${side}`, `unknown entity ${JSON.stringify(name)}`, name);
  const attribute = raw[`${side}Attribute`];
  if (attribute == null || attribute === '') return byName.get(name).headerCell;
  if (typeof attribute !== 'string') throw error('ERD_ENDPOINT_ATTRIBUTE', `$.relations[${relationIndex}].${side}Attribute`, 'expected an attribute name', attribute);
  const matches = attrRows.get(name).get(attribute) ?? [];
  if (matches.length !== 1) throw error('ERD_ENDPOINT_ATTRIBUTE', `$.relations[${relationIndex}].${side}Attribute`, matches.length ? `attribute ${attribute} is ambiguous on ${name}` : `unknown attribute ${attribute} on ${name}`, attribute);
  return matches[0];
}

export function renderErd(data, styles = {}) {
  const entities = data.entities ?? [];
  if (!Array.isArray(entities)) throw error('ERD_ENTITIES', '$.entities', 'expected an array');
  const names = new Set(), attrsByName = new Map();
  for (const [i, entity] of entities.entries()) {
    if (!entity || typeof entity.name !== 'string' || !entity.name.trim()) throw error('ERD_ENTITY_NAME', `$.entities[${i}].name`, 'expected a nonempty entity name');
    if (names.has(entity.name)) throw error('ERD_ENTITY_DUPLICATE', `$.entities[${i}].name`, `duplicate entity ${entity.name}`, entity.name);
    names.add(entity.name);
    const attrs = entity.attributes ?? entity.attrs ?? [];
    if (!Array.isArray(attrs)) throw error('ERD_ATTRIBUTES', `$.entities[${i}].attributes`, 'expected an array');
    attrsByName.set(entity.name, attrs.map((attr, index) => readAttribute(attr, entity.name, index, `$.entities[${i}]`)));
  }
  const relations = data.relations ?? [];
  if (!Array.isArray(relations)) throw error('ERD_RELATIONS', '$.relations', 'expected an array');
  const portCounts = new Map();
  for (const [i, relation] of relations.entries()) {
    if (!relation || typeof relation !== 'object' || Array.isArray(relation)) throw error('ERD_RELATION', `$.relations[${i}]`, 'expected an object');
    for (const side of ['from', 'to']) {
      const name = relation[side] ?? relation[side === 'from' ? 'a' : 'b'];
      const attribute = relation[`${side}Attribute`];
      if (typeof name === 'string') {
        const key = `${name}\0${attribute ?? ''}`;
        portCounts.set(key, (portCounts.get(key) ?? 0) + 1);
      }
      const value = cardinality(relation, side);
      if (value != null && value !== '' && !CARDINALITY_ARROW[value]) throw error('ERD_CARDINALITY', `$.relations[${i}].${side}Cardinality`, `unsupported cardinality ${JSON.stringify(value)}; use 1, 0..1, 0..*, or 1..*`, value);
    }
  }

  const style = styles.erd ?? {}, fontSize = Number(style.fontSize ?? 14), attrFont = Number(style.attribute?.fontSize ?? fontSize);
  const { layout, page: inferredPage } = layoutEntities(entities, attrsByName, style, portCounts, relations, data.page);
  const cells = [], obstacles = [], byName = new Map(), attrRows = new Map();
  const entityStroke = style.entity?.strokeColor ?? '#000000', strokeWidth = style.entity?.strokeWidth ?? 1;
  const common = `rounded=0;html=1;whiteSpace=wrap;align=left;verticalAlign=middle;spacingLeft=8;spacingTop=4;spacingBottom=4;fontFamily=${style.fontFamily ?? 'Arial,Helvetica,sans-serif'};fillColor=#ffffff;strokeColor=${entityStroke};strokeWidth=${strokeWidth};`;
  for (const item of layout) {
    const headerHeight = item.header.height, width = item.width;
    const headGeometry = { x: item.x, y: item.y, width, height: headerHeight };
    const headerCell = { kind: 'vertex', id: `${item.id}_header`, value: htmlText(item.name), style: `${common}fontSize=${fontSize};fontStyle=1;fillColor=${style.entity?.fillColor ?? '#ffffff'};`, parent: '1', geometry: headGeometry };
    cells.push(headerCell); obstacles.push({ id: headerCell.id, kind: 'node', bounds: boundsOf(headGeometry) });
    const entry = { x: item.x, y: item.y, width, height: item.height, headerCell };
    byName.set(item.name, entry);
    const attrMap = new Map(); let y = item.y + headerHeight;
    for (const [index, attr] of item.rows.entries()) {
      const height = attr.measure.height;
      const geometry = { x: item.x, y, width, height };
      const cell = { kind: 'vertex', id: `${item.id}_attr_${index}`, value: htmlText(attr.label), style: `${common}fontSize=${attrFont};`, parent: '1', geometry };
      cells.push(cell); obstacles.push({ id: cell.id, kind: 'node', bounds: boundsOf(geometry) });
      if (!attrMap.has(attr.name)) attrMap.set(attr.name, []);
      attrMap.get(attr.name).push(cell);
      y += height;
    }
    entry.height = y - item.y;
    attrRows.set(item.name, attrMap);
  }

  const relationRecords = [];
  for (const [index, relation] of relations.entries()) {
    const source = endpoint(relation, 'from', byName, attrRows, index), target = endpoint(relation, 'to', byName, attrRows, index);
    const sourceEntity = byName.get(relation.from ?? relation.a), targetEntity = byName.get(relation.to ?? relation.b);
    const horizontalOverlap = sourceEntity.x < targetEntity.x + targetEntity.width && sourceEntity.x + sourceEntity.width > targetEntity.x;
    const sourceSide = horizontalOverlap ? 'west' : sourceEntity.x + sourceEntity.width / 2 < targetEntity.x + targetEntity.width / 2 ? 'east' : 'west';
    const targetSide = horizontalOverlap ? 'west' : sourceSide === 'east' ? 'west' : 'east';
    const id = `rel_${index}`;
    relationRecords.push({ id, index, relation, source, target, sourceEntity, targetEntity, sourceSide, targetSide });
  }
  const maxX = Math.max(0, ...layout.map(item => item.x + item.width)), maxY = Math.max(0, ...layout.map(item => item.y + item.height));
  const longestLabel = Math.max(0, ...relations.map(relation => relation.name ? textBox(String(relation.name), Number(style.relation?.fontSize ?? fontSize), 70, 190).width : 0));
  const routeMargin = 56 + longestLabel + relations.length * 12;
  const basePage = { width: Math.max(inferredPage.width, maxX + routeMargin, data.page?.width ?? 0), height: Math.max(inferredPage.height, maxY + routeMargin, data.page?.height ?? 0) };
  const clearance = 14, routeClearance = 2, portGroups = new Map();
  for (const record of relationRecords) for (const end of ['source', 'target']) {
    const cell = record[end], side = record[`${end}Side`], key = `${cell.id}\0${side}`;
    if (!portGroups.has(key)) portGroups.set(key, []);
    portGroups.get(key).push({ record, end, cell, side });
  }
  const routeObstacles = obstacles.map(obstacle => ({ ...obstacle, bounds: { x: obstacle.bounds.x - (clearance - routeClearance), y: obstacle.bounds.y - (clearance - routeClearance), width: obstacle.bounds.width + 2 * (clearance - routeClearance), height: obstacle.bounds.height + 2 * (clearance - routeClearance) } })), requests = [];
  for (const group of portGroups.values()) {
    group.sort((a, b) => a.record.index - b.record.index || a.end.localeCompare(b.end));
    for (const [index, endpointRecord] of group.entries()) {
      const { record, end, cell, side } = endpointRecord;
      const offset = group.length === 1 ? 0.5 : 0.12 + 0.76 * index / (group.length - 1), box = cell.geometry;
      const point = side === 'east' ? { x: box.x + box.width, y: box.y + box.height * offset }
        : side === 'west' ? { x: box.x, y: box.y + box.height * offset }
          : side === 'south' ? { x: box.x + box.width * offset, y: box.y + box.height }
            : { x: box.x + box.width * offset, y: box.y };
      const anchor = side === 'east' ? { x: point.x + clearance + 2, y: point.y }
        : side === 'west' ? { x: point.x - clearance - 2, y: point.y }
          : side === 'south' ? { x: point.x, y: point.y + clearance + 2 }
            : { x: point.x, y: point.y - clearance - 2 };
      const anchorId = `route_anchor_${record.index}_${end}`;
      routeObstacles.push({ id: anchorId, kind: 'helper', bounds: { x: anchor.x, y: anchor.y, width: 0, height: 0 } });
      record[`${end}Port`] = { nodeId: cell.id, side, offset, point, anchor, anchorId };
    }
  }
  for (const record of relationRecords) requests.push({ id: record.id, allowSelfLoop: record.sourceEntity === record.targetEntity,
    source: { nodeId: record.sourcePort.anchorId, port: { side: record.sourcePort.side } },
    target: { nodeId: record.targetPort.anchorId, port: { side: record.targetPort.side } } });
  const pairKey = record => [record.sourceEntity.name, record.targetEntity.name].sort().join('\0');
  const pairCounts = new Map();
  for (const record of relationRecords) pairCounts.set(pairKey(record), (pairCounts.get(pairKey(record)) ?? 0) + 1);
  const rank = [...relationRecords].sort((a, b) => {
    const ac = a.source.geometry, at = a.target.geometry, bc = b.source.geometry, bt = b.target.geometry;
    const aDistance = Math.abs(ac.x + ac.width / 2 - bt.x - bt.width / 2) + Math.abs(ac.y + ac.height / 2 - bt.y - bt.height / 2);
    const bDistance = Math.abs(bc.x + bc.width / 2 - at.x - at.width / 2) + Math.abs(bc.y + bc.height / 2 - at.y - at.height / 2);
    return pairCounts.get(pairKey(b)) - pairCounts.get(pairKey(a)) || bDistance - aDistance || a.index - b.index;
  });
  rank.forEach((record, index) => { record.routeId = `route_${String(index).padStart(4, '0')}`; requests.find(request => request.id === record.id).id = record.routeId; });
  const routed = routeOrthogonalEdges({ obstacles: routeObstacles, edges: requests, page: basePage, clearance: routeClearance });
  const routeErrors = routed.diagnostics.filter(diagnostic => diagnostic.severity === 'error');
  if (routeErrors.length) throw new DiagramInputError('ERD route planning failed', routeErrors);
  const recordByRouteId = new Map(relationRecords.map(record => [record.routeId, record]));
  const routeById = new Map(routed.routes.map(route => {
    const record = recordByRouteId.get(route.edgeId);
    return [record.id, { ...route, sourcePort: record.sourcePort, targetPort: record.targetPort, points: [route.sourcePort.point, ...route.points, route.targetPort.point] }];
  }));
  const edgeStyleBase = `edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;jettySize=auto;strokeColor=${style.relation?.strokeColor ?? '#000000'};strokeWidth=${style.relation?.strokeWidth ?? 1};`;
  const placedLabels = [], routeLabels = new Map();
  for (const record of relationRecords) {
    if (!record.relation.name) continue;
    const route = routeById.get(record.id), label = { id: `rel_label_${record.index}`, ...textBox(String(record.relation.name), Number(style.relation?.fontSize ?? fontSize), 70, 190) };
    const bounds = placeRelationLabel(route, label, obstacles, [...routeById.values()], placedLabels, basePage, 14);
    if (!bounds) throw error('ERD_LABEL_ROUTE_UNAVAILABLE', `$.relations[${record.index}].name`, 'no clear page-space position is available for the relation label', record.relation.name);
    placedLabels.push(bounds); routeLabels.set(record.id, { id: label.id, bounds });
  }
  for (const record of relationRecords) {
    const { id, relation, index } = record, route = routeById.get(id);
    if (!route) throw error('ERD_ROUTE_MISSING', `$.relations[${index}]`, 'route planner did not return a route');
    const startArrow = cardinality(relation, 'from'), endArrow = cardinality(relation, 'to');
    const relationStyle = `${edgeStyleBase}${startArrow ? `startArrow=${CARDINALITY_ARROW[startArrow]};` : 'startArrow=none;'}${endArrow ? `endArrow=${CARDINALITY_ARROW[endArrow]};` : 'endArrow=none;'}`;
    cells.push({ kind: 'edge', id, value: '', style: relationStyle, parent: '1', source: record.source.id, target: record.target.id,
      ports: { source: { side: record.sourcePort.side, offset: record.sourcePort.offset }, target: { side: record.targetPort.side, offset: record.targetPort.offset } },
      geometry: { relative: 1, points: route.points } });
    const label = routeLabels.get(id);
    if (label) {
      cells.push({ kind: 'vertex', id: label.id, value: htmlText(String(relation.name)), style: `shape=rect;rounded=0;html=1;whiteSpace=wrap;align=center;verticalAlign=middle;fontFamily=${style.fontFamily ?? 'Arial,Helvetica,sans-serif'};fontSize=${style.relation?.fontSize ?? fontSize};fillColor=#ffffff;strokeColor=none;spacing=2;`, parent: '1', geometry: { ...label.bounds } });
    }
  }
  const allBounds = cells.filter(cell => cell.kind === 'vertex' && cell.parent === '1').map(cell => cell.geometry);
  const page = data.page ?? { width: Math.ceil(Math.max(basePage.width, ...allBounds.map(b => b.x + b.width)) + 24), height: Math.ceil(Math.max(basePage.height, ...allBounds.map(b => b.y + b.height)) + 24) };
  const overflows = data.page && allBounds.some(bounds => bounds.x < 0 || bounds.y < 0 || bounds.x + bounds.width > data.page.width || bounds.y + bounds.height > data.page.height);
  const diagnostics = overflows ? [{ phase: 'planned', severity: 'warning', code: 'PAGE_OVERFLOW', path: '$.page', message: 'Rendered ERD content extends beyond the explicit page dimensions', value: data.page }] : [];
  return { cells, diagnostics, page };
}
