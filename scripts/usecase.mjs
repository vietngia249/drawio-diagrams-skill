import { DiagramInputError, fitShapeToBounds, htmlText, spacingFor, styleForRole, textWidth, validatePage } from './common.mjs';
import { routeOrthogonalEdges } from './geometry.mjs';

const text = value => String(value ?? '').trim();
const key = value => encodeURIComponent(String(value));
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function wrappedLines(value, fontSize, availableWidth) {
  return String(value ?? '').split(/\r?\n/).reduce((count, line) =>
    count + Math.max(1, Math.ceil(textWidth(line, fontSize) / availableWidth)), 0);
}

function measuredLabel(value, fontSize, maxWidth, padding = 16) {
  const width = clamp(textWidth(value, fontSize) + padding, 72, maxWidth);
  const lines = wrappedLines(value, fontSize, width - padding);
  return { width, height: Math.max(fontSize + 10, Math.ceil(lines * fontSize * 1.4 + 10)) };
}

function roleTokens(presentation, { font, fontSize, strokeColor, fillColor, strokeWidth } = {}) {
  const tokens = { ...presentation, fontSizes: { ...presentation.fontSizes }, colors: { ...presentation.colors } };
  if (fontSize !== undefined) tokens.fontSizes[font] = fontSize;
  if (strokeColor !== undefined) tokens.colors.stroke = strokeColor;
  if (fillColor !== undefined) tokens.colors.fill = fillColor;
  if (strokeWidth !== undefined) tokens.strokeWidth = strokeWidth;
  return tokens;
}

function layoutError(diagnostics) {
  const errors = diagnostics.filter(item => item.severity === 'error');
  if (errors.length) throw new DiagramInputError('Use-case geometry planning failed', errors);
}

export function renderUsecase(data, styles = {}) {
  const actors = data.actors || [], cases = data.useCases || [], relationships = data.relationships || [];
  if (!actors.length || !cases.length) throw new DiagramInputError('usecase requires actors[] and useCases[]');

  const ids = new Set();
  for (const [kind, rows] of [['actor', actors], ['use case', cases]]) for (const [index, row] of rows.entries()) {
    if (!text(row.id) || !text(row.label)) throw new DiagramInputError(`${kind} at index ${index} requires nonempty id and label`);
    if (ids.has(row.id)) throw new DiagramInputError(`duplicate use-case diagram id: ${row.id}`);
    ids.add(row.id);
  }

  const actorIds = new Set(actors.map(actor => actor.id)), caseIds = new Set(cases.map(item => item.id));
  const caseActors = new Map(), actorAssociations = new Map(actors.map(actor => [actor.id, []]));
  const signatures = new Set(), relationshipIds = new Set();
  const normalizedRelationships = relationships.map((relationship, index) => {
    const type = relationship.type || relationship.kind;
    if (!['association', 'include', 'extend', 'generalization'].includes(type))
      throw new DiagramInputError(`relationships[${index}].type must be association, include, extend, or generalization`);
    if (!text(relationship.from) || !text(relationship.to)) throw new DiagramInputError(`relationships[${index}] requires from and to`);
    let from = relationship.from, to = relationship.to;
    if (type === 'association') {
      if (!(actorIds.has(from) && caseIds.has(to) || actorIds.has(to) && caseIds.has(from)))
        throw new DiagramInputError(`relationships[${index}] association must connect one declared actor and one declared use case`);
      if (!actorIds.has(from)) [from, to] = [to, from];
      if (!caseActors.has(to)) caseActors.set(to, new Set());
      caseActors.get(to).add(from);
      actorAssociations.get(from).push(to);
    } else if (!(caseIds.has(from) && caseIds.has(to))) throw new DiagramInputError(`relationships[${index}] ${type} must connect declared use cases`);
    const signature = type === 'association' ? `${type}:${from}:${to}` : `${type}:${from}:${to}`;
    if (signatures.has(signature)) throw new DiagramInputError(`duplicate relationship ${signature}`);
    signatures.add(signature);
    if (relationship.id && relationshipIds.has(relationship.id)) throw new DiagramInputError(`duplicate relationship id: ${relationship.id}`);
    if (relationship.id) relationshipIds.add(relationship.id);
    const semanticId = relationship.id || `${type}_${from}_${to}`;
    let label = text(relationship.label);
    if (type === 'include') label ||= '«include»';
    else if (type === 'extend') label ||= '«extend»';
    return { ...relationship, type, from, to, semanticId, label };
  });

  const usecaseStyle = styles.usecase || {}, actorStyle = usecaseStyle.actor || {}, caseStyle = usecaseStyle.useCase || {};
  const boundaryStyle = usecaseStyle.boundary || {}, relationshipStyle = usecaseStyle.relationship || {};
  const presentation = styles.presentation || {};
  const fontSize = presentation.fontSizes?.body ?? usecaseStyle.fontSize ?? 14, actorFontSize = actorStyle.fontSize ?? fontSize;
  const caseFontSize = caseStyle.fontSize ?? fontSize;
  const caseWidth = clamp(Math.max(0, ...cases.map(item => textWidth(item.label, caseFontSize))) + 44, 150, 300);
  const caseHeight = Math.max(66, ...cases.map(item => Math.ceil(wrappedLines(item.label, caseFontSize, caseWidth - 40) * caseFontSize * 1.35 + 24)));
  const twoActorColumns = actors.length === 2 && cases.every(item => caseActors.get(item.id)?.size === 1) &&
    actors.every(actor => cases.some(item => caseActors.get(item.id)?.has(actor.id)));
  const columnByActor = new Map(actors.map((actor, index) => [actor.id, index]));
  const caseColumn = new Map(cases.map(item => [item.id, twoActorColumns ? columnByActor.get([...caseActors.get(item.id)][0]) : 0]));
  const columnCases = Array.from({ length: twoActorColumns ? 2 : 1 }, (_, column) => cases.filter(item => caseColumn.get(item.id) === column));
  const rowByCase = new Map();
  columnCases.forEach(items => items.forEach((item, row) => rowByCase.set(item.id, row)));
  const rows = Math.max(0, ...columnCases.map(items => items.length));
  const title = data.systemName || data.title || 'System';
  const titleFontSize = usecaseStyle.titleFontSize ?? presentation.fontSizes?.heading ?? fontSize;
  const titleSize = measuredLabel(title, titleFontSize, 320, 16);
  const header = Math.max(48, titleSize.height + 16);
  const gapScale = spacingFor('nodeGap', presentation) / 32;
  const paddingScale = spacingFor('containerPadding', presentation) / 24;
  const gapY = 70 * gapScale, gapX = 100 * gapScale, margin = 54 * paddingScale, top = 55;
  const actorWidth = clamp(Math.max(...actors.map(actor => textWidth(actor.label, actorFontSize))) + 24, 220, 360);
  const symbolWidth = 64, symbolHeight = 72, leftActorX = actorWidth + 10;
  const boundaryLeft = leftActorX + symbolWidth + 42, columns = twoActorColumns ? 2 : 1;
  const boundaryWidth = margin * 2 + columns * caseWidth + (columns - 1) * gapX;
  const boundaryHeight = header + margin + rows * caseHeight + Math.max(0, rows - 1) * gapY + 36;
  const rightActorX = boundaryLeft + boundaryWidth + 42;
  const hasRightActors = actors.some((_, index) => actors.length > 1 && index % 2 === 1);
  const requiredWidth = hasRightActors ? rightActorX + symbolWidth + actorWidth + 50 : boundaryLeft + boundaryWidth + 50;
  const requiredHeight = top + boundaryHeight + 65;
  const page = data.page ? validatePage(data.page) : { width: Math.max(900, requiredWidth), height: Math.max(540, requiredHeight) };
  const diagnostics = [];
  if (requiredWidth > page.width || requiredHeight > page.height) diagnostics.push({
    phase: 'planned', severity: 'warning', code: 'PAGE_OVERFLOW', path: '$page', message: 'Use-case layout extends beyond explicit page dimensions',
    value: { requiredWidth, requiredHeight, ...page }
  });

  const cells = [], obstacles = [], caseBounds = new Map(), actorLayout = new Map();
  const boundaryBounds = { x: boundaryLeft, y: top, width: boundaryWidth, height: boundaryHeight };
  // The invisible container owns child-local geometry. Its visible outline uses
  // four line cells so relationship paths can enter contained use cases.
  cells.push({ kind: 'vertex', id: 'system_boundary', value: '', style: 'shape=rect;html=1;fillColor=none;strokeColor=none;opacity=0;', parent: '1', geometry: boundaryBounds });
  const corners = [
    ['nw', boundaryLeft, top], ['ne', boundaryLeft + boundaryWidth, top],
    ['se', boundaryLeft + boundaryWidth, top + boundaryHeight], ['sw', boundaryLeft, top + boundaryHeight]
  ];
  for (const [name, x, y] of corners) cells.push({ kind: 'vertex', id: `system_boundary_${name}`, value: '', style: 'ellipse;fillColor=none;strokeColor=none;opacity=0;', parent: '1', geometry: { x, y, width: 0, height: 0 } });
  const boundaryLines = [['nw', 'ne'], ['ne', 'se'], ['se', 'sw'], ['sw', 'nw']];
  boundaryLines.forEach(([from, to], index) => cells.push({
    kind: 'edge', id: `system_boundary_line_${index}`, value: '',
    style: styleForRole('edge', roleTokens(presentation, { font: 'label', strokeColor: boundaryStyle.strokeColor, strokeWidth: boundaryStyle.strokeWidth }), 'edgeStyle=none;html=1;startArrow=none;endArrow=none;'),
    parent: '1', source: `system_boundary_${from}`, target: `system_boundary_${to}`, geometry: { relative: 1, points: [] }
  }));
  const titleBounds = { x: boundaryLeft + 12, y: top + 8, ...titleSize };
  cells.push({ kind: 'vertex', id: 'system_boundary_title', value: htmlText(title), style: styleForRole('heading', roleTokens(presentation, { font: 'heading', fontSize: titleFontSize }), 'text;html=1;whiteSpace=wrap;align=left;verticalAlign=middle;'), parent: '1', geometry: titleBounds });
  obstacles.push({ id: 'system_boundary_title', kind: 'label', bounds: titleBounds });

  cases.forEach(item => {
    const column = caseColumn.get(item.id), row = rowByCase.get(item.id);
    const x = margin + column * (caseWidth + gapX), y = header + 18 + row * (caseHeight + gapY);
    const pageBounds = { x: boundaryLeft + x, y: top + y, width: caseWidth, height: caseHeight };
    caseBounds.set(item.id, pageBounds);
    cells.push({
      kind: 'vertex', id: `usecase_${key(item.id)}`, value: htmlText(item.label),
      style: styleForRole('node', roleTokens(presentation, {
        font: 'body', fontSize: caseFontSize,
        fillColor: caseStyle.fillColor, strokeColor: caseStyle.strokeColor, strokeWidth: caseStyle.strokeWidth
      }), `shape=${caseStyle.shape || 'ellipse'};html=1;whiteSpace=wrap;`),
      parent: 'system_boundary', geometry: { x, y, width: caseWidth, height: caseHeight }
    });
    obstacles.push({ id: `usecase_${key(item.id)}`, kind: 'node', bounds: pageBounds });
  });

  actors.forEach((actor, index) => {
    const targets = cases.filter(item => caseActors.get(item.id)?.has(actor.id)).map(item => caseBounds.get(item.id));
    const symbolY = targets.length
      ? targets.reduce((sum, bounds) => sum + bounds.y + bounds.height / 2, 0) / targets.length - symbolHeight / 2
      : top + 40 + index * 150;
    const side = actors.length > 1 && index % 2 === 1 ? 'right' : 'left';
    const symbolX = side === 'left' ? leftActorX : rightActorX;
    const labelMetrics = measuredLabel(actor.label, actorFontSize, actorWidth, 16);
    const labelX = side === 'left' ? 0 : symbolX + symbolWidth + 8;
    const labelY = symbolY + symbolHeight / 2 - labelMetrics.height / 2;
    const actorId = `actor_${key(actor.id)}`, labelId = `actor_label_${key(actor.id)}`;
    const symbolBounds = fitShapeToBounds({ x: symbolX, y: symbolY, width: symbolWidth, height: symbolHeight }, presentation.proportions?.actor ?? 64 / 72);
    const labelBounds = { x: labelX, y: labelY, ...labelMetrics };
    actorLayout.set(actor.id, { id: actorId, side, bounds: symbolBounds });
    cells.push({ kind: 'vertex', id: actorId, value: '', style: styleForRole('node', roleTokens(presentation, {
      font: 'body', fontSize: actorStyle.fontSize ?? fontSize, fillColor: actorStyle.fillColor,
      strokeColor: actorStyle.strokeColor, strokeWidth: actorStyle.strokeWidth
    }), `shape=${actorStyle.shape || 'umlActor'};html=1;`), parent: '1', geometry: symbolBounds });
    cells.push({ kind: 'vertex', id: labelId, value: htmlText(actor.label), style: styleForRole('label', roleTokens(presentation, {
      font: 'label', fontSize: actorStyle.fontSize ?? presentation.fontSizes?.label ?? actorFontSize
    }), `text;html=1;whiteSpace=wrap;align=${side === 'left' ? 'right' : 'left'};verticalAlign=middle;`), parent: '1', geometry: labelBounds });
    obstacles.push({ id: actorId, kind: 'node', bounds: symbolBounds }, { id: labelId, kind: 'label', bounds: labelBounds });
  });

  const requests = normalizedRelationships.map(relationship => {
    const association = relationship.type === 'association';
    const sourceId = association ? actorLayout.get(relationship.from).id : `usecase_${key(relationship.from)}`;
    const targetId = `usecase_${key(relationship.to)}`;
    const request = { id: `relationship_${key(relationship.semanticId)}`, source: { nodeId: sourceId }, target: { nodeId: targetId } };
    if (association) {
      const actor = actorLayout.get(relationship.from), target = caseBounds.get(relationship.to);
      const preferredOffset = clamp((target.y + target.height / 2 - actor.bounds.y) / actor.bounds.height, 0.12, 0.88);
      const sourceSide = actor.side === 'left' ? 'east' : 'west';
      request.source.port = { side: sourceSide, preferredOffset };
      request.target.port = { side: actor.side === 'left' ? 'west' : 'east', preferredOffset: 0.5 };
    } else {
      const source = caseBounds.get(relationship.from), target = caseBounds.get(relationship.to);
      if (Math.abs(source.x + source.width / 2 - target.x - target.width / 2) < 24) {
        const side = 'east';
        request.source.port = { side, preferredOffset: 0.5 };
        request.target.port = { side, preferredOffset: 0.5 };
      }
    }
    if (relationship.label) request.label = { id: `relationship_label_${key(relationship.semanticId)}`, ...measuredLabel(relationship.label, relationshipStyle.fontSize ?? presentation.fontSizes?.label ?? fontSize, 220) };
    return { relationship, request };
  });

  // Boundary containment is intentional. Route against its title and visible
  // contents, but omit the enclosing rectangle as a blocker so edges can enter.
  const routed = routeOrthogonalEdges({ obstacles, edges: requests.map(item => item.request), page, clearance: usecaseStyle.clearance ?? spacingFor('routeClearance', presentation) });
  diagnostics.push(...routed.diagnostics);
  layoutError(diagnostics);
  const routeById = new Map(routed.routes.map(route => [route.edgeId, route]));
  for (const { relationship, request } of requests) {
    const route = routeById.get(request.id);
    if (!route) continue;
    const association = relationship.type === 'association';
    let lineStyle = styleForRole('edge', roleTokens(presentation, {
      font: 'label', fontSize: relationshipStyle.fontSize ?? presentation.fontSizes?.label,
      strokeColor: relationshipStyle.strokeColor, strokeWidth: relationshipStyle.strokeWidth
    }), 'edgeStyle=none;rounded=0;html=1;');
    if (association) lineStyle += 'startArrow=none;endArrow=none;';
    else if (relationship.type === 'include' || relationship.type === 'extend') lineStyle += 'dashed=1;dashPattern=6 4;endArrow=open;endFill=0;endSize=8;';
    else lineStyle += 'endArrow=block;endFill=0;';
    cells.push({
      kind: 'edge', id: request.id, value: '', style: lineStyle, parent: '1', source: request.source.nodeId, target: request.target.nodeId,
      ports: { source: { side: route.sourcePort.side, offset: route.sourcePort.offset }, target: { side: route.targetPort.side, offset: route.targetPort.offset } },
      geometry: { relative: 1, points: route.points }
    });
    if (relationship.label && route.label) cells.push({
      kind: 'vertex', id: request.label.id, value: htmlText(relationship.label),
      style: styleForRole('label', roleTokens(presentation, { font: 'label', fontSize: relationshipStyle.fontSize ?? presentation.fontSizes?.label ?? fontSize }), 'text;html=1;whiteSpace=wrap;align=center;verticalAlign=middle;'),
      parent: '1', geometry: { x: route.label.bounds.x, y: route.label.bounds.y, width: route.label.bounds.width, height: route.label.bounds.height }
    });
  }

  return { cells, diagnostics, page };
}
