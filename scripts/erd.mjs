import { htmlText, vertex, edge } from './common.mjs';

const CARDINALITY_ARROW = Object.freeze({
  '1': 'ERone',
  '0..1': 'ERzeroToOne',
  '0..*': 'ERzeroToMany',
  '1..*': 'ERoneToMany',
});

const fail = (path, message) => { throw new Error(`ERD ${path}: ${message}`); };
const safeId = value => String(value).replace(/[^A-Za-z0-9_.-]/g, '_');
const stableHash = value => {
  let hash = 2166136261;
  for (const char of String(value)) hash = Math.imul(hash ^ char.codePointAt(0), 16777619);
  return (hash >>> 0).toString(16);
};
const text = value => String(value ?? '');

function readAttribute(raw, entityName, index) {
  const at = `entities[${entityName}].attributes[${index}]`;
  const attr = typeof raw === 'string' ? { name: raw } : raw;
  if (!attr || typeof attr !== 'object' || Array.isArray(attr)) fail(at, 'expected an attribute name or object');
  const name = attr.name ?? attr.n;
  if (typeof name !== 'string' || !name.trim()) fail(`${at}.name`, 'expected a nonempty string');
  const type = attr.type ?? attr.t;
  const rawKey = attr.key ?? attr.k;
  const key = typeof rawKey === 'string' ? rawKey.trim().toUpperCase() : '';
  const markers = key === 'PRIMARY KEY' || key === 'PRIMARY_KEY' ? ['PK']
    : key === 'FOREIGN KEY' || key === 'FOREIGN_KEY' ? ['FK']
      : key.split(/[\s,|+]+/).filter(part => part === 'PK' || part === 'FK');
  return { name, type: type == null ? '' : text(type), markers: [...new Set(markers)] };
}

function chooseLayout(entities, attributes, style) {
  const cols = Math.max(1, Math.ceil(Math.sqrt(entities.length)));
  const fontSize = style.fontSize ?? 14;
  const attributeFontSize = style.attribute?.fontSize ?? fontSize;
  const headerLineHeight = Math.max(42, fontSize * 2.5);
  const attributeLineHeight = Math.max(36, attributeFontSize * 2.5);
  const keyLabel = marker => String((marker === 'PK' ? style.primaryKey?.marker : style.foreignKey?.marker) ?? marker);
  const widths = entities.map(entity => {
    const headerWidth = entity.name.length * fontSize * 0.58;
    const attributeWidth = Math.max(...attributes[entity.name].map(attr => {
      const keyText = attr.markers.map(keyLabel).map(marker => `[${marker}]`).join(' ');
      const value = `${keyText}${keyText ? ' ' : ''}${attr.name}${attr.type ? ` : ${attr.type}` : ''}`;
      return Math.max(...value.split('\n').map(line => line.length * attributeFontSize * 0.58), 0);
    }), 0);
    return Math.max(200, Math.min(520, 40 + Math.max(headerWidth, attributeWidth)));
  });
  const attributeHeights = entities.map((entity, i) => {
    const rows = attributes[entity.name].length ? attributes[entity.name] : [{ name: '', type: '', markers: [] }];
    return rows.map(attr => {
      const keyText = attr.markers.map(keyLabel).map(marker => `[${marker}]`).join(' ');
      const textValue = `${keyText}${keyText ? ' ' : ''}${attr.name}${attr.type ? ` : ${attr.type}` : ''}`;
      const wrappedLines = Math.ceil(Math.max(...textValue.split('\n').map(line => line.length * attributeFontSize * 0.58), 1) / widths[i]);
      return Math.max(attributeLineHeight, textValue.split('\n').length * attributeLineHeight, wrappedLines * attributeLineHeight);
    });
  });
  const headerHeights = entities.map((entity, i) => {
    const explicitLines = entity.name.split('\n').length;
    const wrappedLines = Math.ceil(entity.name.length * fontSize * 0.58 / widths[i]);
    return Math.max(headerLineHeight, explicitLines * headerLineHeight, wrappedLines * headerLineHeight);
  });
  const heights = entities.map((entity, i) => headerHeights[i] + attributeHeights[i].reduce((sum, height) => sum + height, 0));
  const colWidths = Array.from({ length: cols }, (_, col) => Math.max(...widths.filter((_, i) => i % cols === col), 0));
  const rowHeights = Array.from({ length: Math.ceil(entities.length / cols) }, (_, row) => Math.max(...heights.slice(row * cols, (row + 1) * cols)));
  const colX = [], rowY = [];
  for (let c = 0; c < cols; c++) colX[c] = 40 + colWidths.slice(0, c).reduce((a, b) => a + b + 300, 0);
  for (let r = 0; r < rowHeights.length; r++) rowY[r] = 170 + rowHeights.slice(0, r).reduce((a, b) => a + b + 90, 0);
  return entities.map((entity, i) => ({ x: colX[i % cols], y: rowY[Math.floor(i / cols)], width: widths[i], height: heights[i], headerHeight: headerHeights[i], rowHeights: attributeHeights[i] }));
}

function relationEnd(raw, side, entities, byName, attributeCells) {
  const entityName = raw[side] ?? raw[side === 'from' ? 'a' : 'b'];
  if (typeof entityName !== 'string' || !byName.has(entityName)) fail(`relations.${side}`, `unknown entity ${JSON.stringify(entityName)}`);
  const endpointAttribute = raw[`${side}Attribute`];
  if (endpointAttribute == null || endpointAttribute === '') {
    const box = byName.get(entityName);
    return { id: box.id, entityName, y: box.y, height: box.headerHeight };
  }
  if (typeof endpointAttribute !== 'string') fail(`relations.${side}Attribute`, 'expected an attribute name');
  let resolvedEntity = entityName, attributeName = endpointAttribute;
  if (endpointAttribute.includes('.')) {
    const splitAt = endpointAttribute.indexOf('.');
    resolvedEntity = endpointAttribute.slice(0, splitAt);
    attributeName = endpointAttribute.slice(splitAt + 1);
    if (resolvedEntity !== entityName) fail(`relations.${side}Attribute`, `attribute must belong to endpoint entity ${entityName}`);
  }
  const matches = attributeCells.get(entityName).get(attributeName) || [];
  if (matches.length !== 1) fail(`relations.${side}Attribute`, matches.length ? `attribute ${attributeName} is ambiguous; qualify it as Entity.attribute` : `unknown attribute ${attributeName} on ${entityName}`);
  return { ...matches[0], entityName, attributeName };
}

function selfRoute(box, index, source, target) {
  const x = box.x + box.width + 44 + index * 24;
  return [
    { x, y: source.y + source.height / 2 },
    { x, y: target.y + target.height / 2 },
  ];
}

export function renderErd(d, s) {
  const entities = d.entities || [];
  if (!Array.isArray(entities)) fail('entities', 'expected an array');
  const names = new Set();
  for (const [i, entity] of entities.entries()) {
    if (!entity || typeof entity.name !== 'string' || !entity.name.trim()) fail(`entities[${i}].name`, 'expected a nonempty string');
    if (names.has(entity.name)) fail(`entities[${i}].name`, `duplicate entity ${entity.name}`);
    names.add(entity.name);
  }
  const attrsByEntity = Object.fromEntries(entities.map(entity => {
    const attrs = entity.attributes ?? entity.attrs ?? [];
    if (!Array.isArray(attrs)) fail(`entities[${entity.name}].attributes`, 'expected an array');
    return [entity.name, attrs.map((attr, i) => readAttribute(attr, entity.name, i))];
  }));
  const st = s?.erd || {};
  const boxes = chooseLayout(entities, attrsByEntity, st);
  const entityByName = new Map(entities.map((entity, i) => [entity.name, { ...boxes[i], id: `ent_${safeId(entity.name)}_${stableHash(entity.name)}` }]));
  const attributeCells = new Map(entities.map(entity => [entity.name, new Map()]));
  const cells = [];
  const fontSize = st.fontSize ?? 14;
  const attributeFontSize = st.attribute?.fontSize ?? fontSize;
  const keyLabels = { PK: String(st.primaryKey?.marker ?? 'PK'), FK: String(st.foreignKey?.marker ?? 'FK') };
  const entityStroke = st.entity?.strokeColor ?? '#000000';
  const entityStrokeWidth = st.entity?.strokeWidth ?? 1;
  const commonRowStyle = `shape=rect;rounded=0;html=1;whiteSpace=wrap;align=left;verticalAlign=middle;spacingTop=6;spacingBottom=6;fontFamily=${st.fontFamily ?? 'Arial,Helvetica,sans-serif'};fillColor=#ffffff;strokeColor=${entityStroke};strokeWidth=${entityStrokeWidth};`;
  const headerStyle = `${commonRowStyle}fontSize=${fontSize};fontStyle=1;fillColor=${st.entity?.fillColor ?? '#ffffff'};`;
  const attributeStyle = `${commonRowStyle}fontSize=${attributeFontSize};`;
  for (const [i, entity] of entities.entries()) {
    const box = entityByName.get(entity.name), attrs = attrsByEntity[entity.name];
    cells.push(vertex(box.id, htmlText(entity.name), headerStyle, box.x, box.y, box.width, box.headerHeight));
    const rows = attrs.length ? attrs : [{ name: '', type: '', markers: [] }];
    let rowY = box.y + box.headerHeight;
    rows.forEach((attr, ai) => {
      const id = `${box.id}_attr_${ai}`;
      const displayedKeys = attr.markers.map(marker => `[${keyLabels[marker] ?? marker}]`);
      const label = `${displayedKeys.length ? `${displayedKeys.join(' ')} ` : ''}${attr.name}${attr.type ? ` : ${attr.type}` : ''}`;
      const rowHeight = box.rowHeights[ai];
      cells.push(vertex(id, htmlText(label), attributeStyle, box.x, rowY, box.width, rowHeight));
      if (!attributeCells.get(entity.name).has(attr.name)) attributeCells.get(entity.name).set(attr.name, []);
      attributeCells.get(entity.name).get(attr.name).push({ id, y: rowY, height: rowHeight });
      rowY += rowHeight;
    });
  }
  const relations = d.relations || [];
  if (!Array.isArray(relations)) fail('relations', 'expected an array');
  const pairKey = relation => {
    const from = relation.from ?? relation.a, to = relation.to ?? relation.b;
    return [from, to].sort().join('\u0000');
  };
  const labelCounts = new Map();
  for (const relation of relations) if (relation.name) labelCounts.set(pairKey(relation), (labelCounts.get(pairKey(relation)) || 0) + 1);
  const labelIndexes = new Map();
  const relationLabels = [];
  let contentRight = Math.max(0, ...[...entityByName.values()].map(box => box.x + box.width));
  let contentBottom = Math.max(0, ...[...entityByName.values()].map(box => box.y + box.height));
  relations.forEach((relation, i) => {
    const source = relationEnd(relation, 'from', entities, entityByName, attributeCells);
    const target = relationEnd(relation, 'to', entities, entityByName, attributeCells);
    if (source.attributeName) source.attributeIndex = attrsByEntity[source.entityName].findIndex(a => a.name === source.attributeName);
    if (target.attributeName) target.attributeIndex = attrsByEntity[target.entityName].findIndex(a => a.name === target.attributeName);
    const cardinalityStyle = ['from', 'to'].map((side, end) => {
      const cardinality = relation[`${side}Cardinality`] ?? relation[`${side}Multiplicity`];
      if (cardinality == null || cardinality === '') return `${end ? 'end' : 'start'}Arrow=none;`;
      const arrow = CARDINALITY_ARROW[cardinality];
      if (!arrow) fail(`relations[${i}].${side}Cardinality`, `unsupported cardinality ${JSON.stringify(cardinality)}; use 1, 0..1, 0..*, or 1..*`);
      return `${end ? 'end' : 'start'}Arrow=${arrow};`;
    }).join('');
    const a = entityByName.get(source.entityName), b = entityByName.get(target.entityName);
    let exitX = 1, entryX = 0, styleExitY, styleEntryY;
    if (source.entityName === target.entityName) {
      const side = 1;
      exitX = entryX = side;
    }
    else {
      const sameColumn = Math.abs(a.x - b.x) < 1;
      if (sameColumn) {
        const sourceAbove = a.y < b.y;
        exitX = entryX = 0.5;
        styleExitY = sourceAbove ? 1 : 0;
        styleEntryY = sourceAbove ? 0 : 1;
      } else {
        const sourceIsLeft = a.x + a.width / 2 < b.x + b.width / 2;
        exitX = sourceIsLeft ? 1 : 0;
        entryX = sourceIsLeft ? 0 : 1;
      }
    }
    const exitY = styleExitY ?? 0.5, entryY = styleEntryY ?? 0.5;
    const edgeStyle = source.entityName === target.entityName ? 'edgeStyle=none;' : 'edgeStyle=orthogonalEdgeStyle;orthogonalLoop=1;';
    const style = `${edgeStyle}rounded=0;html=1;jettySize=auto;exitX=${exitX};exitY=${exitY};exitPerimeter=1;entryX=${entryX};entryY=${entryY};entryPerimeter=1;${cardinalityStyle}strokeColor=${st.relation?.strokeColor ?? '#000000'};strokeWidth=${st.relation?.strokeWidth ?? 1};`;
    const points = source.entityName === target.entityName ? selfRoute(a, i, source, target) : [];
    for (const point of points) { contentRight = Math.max(contentRight, point.x); contentBottom = Math.max(contentBottom, point.y); }
    cells.push(edge(`rel_${i}`, source.id, target.id, '', style, '1', { points }));
    if (relation.name) {
      const key = pairKey(relation), lane = labelIndexes.get(key) || 0;
      labelIndexes.set(key, lane + 1);
      const relationFontSize = st.relation?.fontSize ?? fontSize;
      const textWidth = Math.max(56, Math.min(168, relation.name.length * 8 + 8));
      const charsPerLine = Math.max(1, Math.floor((textWidth - 12) / (relationFontSize * 0.58)));
      const lineCount = relation.name.split(/\r?\n/).reduce((count, line) => count + Math.max(1, Math.ceil(line.length / charsPerLine)), 0);
      const textHeight = Math.max(20, Math.ceil(lineCount * relationFontSize * 1.35 + 6));
      let labelX, labelY;
      if (source.entityName === target.entityName) {
        const routeX = a.x + a.width + 44 + i * 24;
        const sourceY = source.y + source.height / 2, targetY = target.y + target.height / 2;
        labelX = routeX + 12;
        labelY = (Math.min(sourceY, targetY) + Math.max(sourceY, targetY) - textHeight) / 2 - lane * (textHeight + 6);
      } else {
        const sourceIsLeft = a.x + a.width / 2 < b.x + b.width / 2;
        const gapStart = sourceIsLeft ? a.x + a.width : b.x + b.width;
        const gapEnd = sourceIsLeft ? b.x : a.x;
        const availableWidth = Math.max(48, gapEnd - gapStart - 12);
        labelX = (gapStart + gapEnd - Math.min(textWidth, availableWidth)) / 2;
        const routeTop = Math.min(source.y + source.height / 2, target.y + target.height / 2);
        labelY = routeTop - textHeight - 10 - lane * (textHeight + 6);
      }
      relationLabels.push(vertex(`rel_label_${i}`, htmlText(relation.name), `shape=rect;rounded=0;html=1;whiteSpace=wrap;align=center;verticalAlign=middle;fontFamily=${st.fontFamily ?? 'Arial,Helvetica,sans-serif'};fontSize=${relationFontSize};fillColor=#ffffff;strokeColor=none;spacing=2;`, labelX, labelY, textWidth, textHeight));
      contentRight = Math.max(contentRight, labelX + textWidth);
      contentBottom = Math.max(contentBottom, labelY + textHeight);
    }
  });
  const result = [...cells, ...relationLabels];
  // The shared renderer consumes this hint only when the input omits page size.
  // Keep margins around entities, relation labels, and self-relation routes.
  result.page = { width: Math.ceil(contentRight + 40), height: Math.ceil(contentBottom + 40) };
  return result;
}
