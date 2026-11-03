import { DiagramInputError, htmlText, serializeCells, textWidth } from './common.mjs';
import { routeOrthogonalEdges } from './geometry.mjs';

const fragmentKinds = new Set(['alt', 'opt', 'loop', 'par']);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const labelOf = item => item.label ?? item.text ?? '';
const numberOr = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const vertex = (id, value, style, x, y, width, height, parent = '1') => ({
  kind: 'vertex', id, value, style, parent, geometry: { x, y, width, height }
});

function wrapText(value, maxChars) {
  const wrapped = [];
  for (const paragraph of String(value ?? '').split(/\r?\n/)) {
    const words = paragraph.split(/\s+/u).filter(Boolean);
    if (!words.length) { wrapped.push(''); continue; }
    let line = '';
    for (let word of words) {
      const chars = [...word];
      while (chars.length > maxChars) {
        if (line) { wrapped.push(line); line = ''; }
        wrapped.push(chars.splice(0, maxChars).join(''));
        word = chars.join('');
      }
      if (!word) continue;
      if (line && [...line].length + 1 + [...word].length <= maxChars) line += ` ${word}`;
      else { if (line) wrapped.push(line); line = word; }
    }
    if (line) wrapped.push(line);
  }
  return wrapped.join('\n');
}

function lineCount(value) { return String(value ?? '').split(/\r?\n/).length; }

function orderedItems(owner) {
  const combined = [
    ...(owner.messages || []).map((item, index) => ({ item, index, source: 'message' })),
    ...(owner.fragments || []).map((item, index) => ({ item, index, source: 'fragment' }))
  ];
  return combined.sort((a, b) => {
    const ao = Number(a.item.order), bo = Number(b.item.order);
    const av = a.item.order !== undefined && a.item.order !== null && a.item.order !== '' && Number.isFinite(ao);
    const bv = b.item.order !== undefined && b.item.order !== null && b.item.order !== '' && Number.isFinite(bo);
    if (av && bv && ao !== bo) return ao - bo;
    if (av !== bv) return av ? -1 : 1;
    return a.source === b.source ? a.index - b.index : (a.source === 'message' ? -1 : 1);
  }).map(entry => entry.item);
}

function pageSize(data, contentWidth, contentHeight) {
  const page = data.page ?? {};
  return {
    width: page.width ?? Math.max(800, contentWidth),
    height: page.height ?? Math.max(800, contentHeight)
  };
}

function messageMetrics(item, fontSize) {
  const text = String(labelOf(item));
  const width = clamp(textWidth(text, fontSize) + 36, 100, 460);
  const charsPerLine = Math.max(16, Math.floor((width - 24) / (fontSize * 0.58)));
  const displayLabel = wrapText(text, charsPerLine);
  const height = Math.max(22, lineCount(displayLabel) * Math.ceil(fontSize * 1.3) + 8);
  return { text, width, height, displayLabel };
}

function collectMessageIndexes(node, result = []) {
  if (!node) return result;
  if (node.kind === 'message') result.push(node.index);
  else for (const branch of node.branches) for (const child of branch.nodes) collectMessageIndexes(child, result);
  return result;
}

function routeBounds(route) {
  const values = [route.sourcePort.point, ...route.points, route.targetPort.point];
  const xs = values.map(point => point.x), ys = values.map(point => point.y);
  return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}

/**
 * Plan semantic cells using the shared router, then adapt to the pre-migration
 * direct-call contract by returning serialized cells. The dispatcher accepts
 * these strings through serializeCells() during the migration window.
 */
export function renderSequence(data, styleConfig = {}) {
  const participants = data.participants || [];
  const ids = participants.map((participant, index) => typeof participant === 'string' ? participant : (participant.id ?? `p${index}`));
  const labels = participants.map((participant, index) => typeof participant === 'string' ? participant : (participant.label ?? participant.id ?? `P${index + 1}`));
  const participantIndexes = new Map();
  ids.forEach((id, index) => {
    const key = String(id);
    if (participantIndexes.has(key)) throw new Error(`Duplicate sequence participant id ${JSON.stringify(key)} at participants[${index}] (already declared at participants[${participantIndexes.get(key)}])`);
    participantIndexes.set(key, index);
  });

  const sequenceStyle = styleConfig.sequence || {}, participantStyle = sequenceStyle.participant || {};
  const fragmentStyle = sequenceStyle.fragment || {}, messageStyle = sequenceStyle.message || {};
  const fontSize = numberOr(sequenceStyle.fontSize, 16), messageFontSize = numberOr(messageStyle.fontSize, fontSize);
  const guardFontSize = numberOr(fragmentStyle.guardFontSize, 14);
  const headerWrapChars = Math.max(14, Math.floor((260 - 24) / (fontSize * 0.58)));
  const participantMetrics = labels.map(label => {
    const raw = String(label ?? '');
    const width = clamp(Math.ceil(textWidth(raw, fontSize) + 30), 130, 260);
    const maxChars = headerWrapChars;
    const display = wrapText(raw, maxChars), lines = lineCount(display);
    const height = Math.max(52, Math.ceil(lines * fontSize * 1.35 + 16));
    return { width, height, display };
  });

  const messageRecords = [];
  let nextFragment = 0;
  function plan(owner, startY) {
    let y = startY;
    const nodes = [];
    for (const item of orderedItems(owner)) {
      const kind = String(item.kind || item.type || '').toLowerCase();
      if (item.from !== undefined || kind === 'message') {
        const metrics = messageMetrics(item, messageFontSize), index = messageRecords.length;
        const record = { kind: 'message', index, item, metrics, y, height: metrics.height + 30 };
        messageRecords.push(record); nodes.push(record);
        y += record.height + 18;
        continue;
      }
      if (!fragmentKinds.has(kind)) throw new Error(`Unsupported sequence fragment: ${kind}`);
      const fragment = { kind: 'fragment', fragmentKind: kind, item, index: nextFragment++, start: y, branches: [] };
      y += 34;
      for (let branchIndex = 0; branchIndex < (item.branches || []).length; branchIndex++) {
        const branch = item.branches[branchIndex];
        if (branchIndex) y += 22;
        const guard = String(branch.guard ?? branch.condition ?? '').replace(/^\[|\]$/g, '');
        const guardChars = Math.max(24, Math.floor((Math.max(300, participantMetrics.reduce((sum, p) => sum + p.width, 0)) - 40) / (guardFontSize * 0.58)));
        const displayGuard = wrapText(guard, guardChars), guardHeight = guard ? Math.max(28, lineCount(displayGuard) * Math.ceil(guardFontSize * 1.3) + 10) : 8;
        const guardY = y; y += guardHeight + (guard ? 16 : 8);
        const content = plan({ messages: branch.messages || [], fragments: branch.fragments || [] }, y);
        fragment.branches.push({ guard, displayGuard, guardY, guardHeight, nodes: content.nodes, start: y, end: content.end });
        y = content.end;
      }
      fragment.end = y + 16; y = fragment.end + 20; nodes.push(fragment);
    }
    return { nodes, end: y };
  }

  const timelineStart = 200;
  const planned = plan(data, timelineStart);
  const headerTop = 45;
  const widths = participantMetrics.map(metric => metric.width);
  const gaps = widths.slice(0, -1).map((_, gapIndex) => {
    const needed = messageRecords.reduce((max, record) => {
      const from = participantIndexes.get(String(record.item.from)), to = participantIndexes.get(String(record.item.to));
      if (from === undefined || to === undefined || from === to) return max;
      const low = Math.min(from, to), high = Math.max(from, to);
      return gapIndex >= low && gapIndex < high ? Math.max(max, record.metrics.width + 28) : max;
    }, 0);
    return Math.max(130, needed);
  });
  const centers = [];
  let cursor = 80;
  widths.forEach((width, index) => { centers[index] = cursor + width / 2; cursor += width + (gaps[index] || 0); });
  const rawLeft = centers.length ? Math.min(...centers.map((center, index) => center - widths[index] / 2)) - 32 : 48;
  const rawRight = centers.length ? Math.max(...centers.map((center, index) => center + widths[index] / 2)) + 32 : 180;
  const contentHeight = Math.max(planned.end + 140, messageRecords.length * 100 + 260, 800);
  const page = pageSize(data, rawRight - rawLeft + 80, contentHeight);
  const left = Math.max(20, rawLeft), right = Math.min(page.width - 20, rawRight);
  const lineTop = Math.max(...participantMetrics.map(metric => headerTop + metric.height), headerTop + 52);
  const lineBottom = Math.max(lineTop + 300, page.height - 48);
  const lineHeight = lineBottom - lineTop;
  const timelineHeight = Math.max(1, planned.end - timelineStart);

  const obstacles = [];
  participants.forEach((_, index) => {
    obstacles.push({ id: `participant_${index}`, kind: 'node', bounds: { x: centers[index] - 0.5, y: lineTop, width: 1, height: lineHeight } });
  });
  const edgeRequests = messageRecords.map(record => {
    const item = record.item;
    const fromIndex = participantIndexes.get(String(item.from)), toIndex = participantIndexes.get(String(item.to));
    if (fromIndex === undefined || toIndex === undefined) throw new Error(`sequence message ${record.index} has undeclared endpoint (${item.from} -> ${item.to})`);
    const centerY = record.y + record.height / 2;
    const preferredOffset = clamp((centerY - timelineStart) / timelineHeight, 0.04, 0.96);
    const self = fromIndex === toIndex;
    const sourceSide = self ? 'east' : (centers[toIndex] >= centers[fromIndex] ? 'east' : 'west');
    const targetSide = self ? 'west' : (centers[fromIndex] >= centers[toIndex] ? 'east' : 'west');
    const kind = String(item.kind || 'sync').toLowerCase();
    if (!['sync', 'async', 'return'].includes(kind)) throw new Error(`sequence message ${record.index} has unsupported kind ${kind}`);
    return {
      id: `route_${String(record.index).padStart(6, '0')}`,
      allowSelfLoop: self,
      source: { nodeId: `participant_${fromIndex}`, port: { side: sourceSide, preferredOffset } },
      target: { nodeId: `participant_${toIndex}`, port: { side: targetSide, preferredOffset } },
      ...(!self ? { label: { id: `message_label_${record.index}`, width: record.metrics.width, height: record.metrics.height } } : {})
    };
  });

  const endpointGroups = new Map();
  edgeRequests.forEach((request, index) => {
    for (const end of ['source', 'target']) {
      const endpoint = request[end], side = endpoint.port.side, key = `${endpoint.nodeId}\0${side}`;
      if (!endpointGroups.has(key)) endpointGroups.set(key, []);
      endpointGroups.get(key).push({ request, end, index });
    }
  });
  for (const group of endpointGroups.values()) {
    group.sort((a, b) => a.index - b.index || (a.end === b.end ? 0 : (a.end === 'source' ? -1 : 1)));
    if (group.length > 13) throw new DiagramInputError('Sequence lifeline side has more simultaneous message ports than the shared router can separate', [{ phase: 'planned', severity: 'error', code: 'PORT_CAPACITY', path: '$.messages', message: 'At most 13 distinct ports fit on one lifeline side with the shared router spacing', value: group.length }]);
    const offsets = group.map(entry => entry.request[entry.end].port.preferredOffset);
    for (let index = 1; index < offsets.length; index++) offsets[index] = Math.max(offsets[index], offsets[index - 1] + 0.080001);
    const shift = Math.max(0, offsets.at(-1) - 0.98);
    offsets.forEach((offset, index) => { group[index].request[group[index].end].port.preferredOffset = Number((offset - shift).toFixed(6)); });
  }

  const routed = routeOrthogonalEdges({ obstacles, edges: edgeRequests, page, clearance: 8 });
  const routeErrors = routed.diagnostics.filter(diagnostic => diagnostic.severity === 'error');
  if (routeErrors.length) throw new DiagramInputError('Sequence routing failed', routeErrors);
  const routeByMessage = new Map(routed.routes.map((route, index) => [index, route]));

  // The router assigns distinct semantic lifeline ports. A sequence self call
  // is then given its notation-specific outward loop on a unique horizontal track.
  const assignedSelfLabels = [];
  const routedLabelBounds = routed.routes.flatMap(route => route.label ? [route.label.bounds] : []);
  const collides = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
  const segmentHitsRect = (a, b, rect) => a.y === b.y
    ? a.y >= rect.y && a.y <= rect.y + rect.height && Math.max(Math.min(a.x, b.x), rect.x) < Math.min(Math.max(a.x, b.x), rect.x + rect.width)
    : a.x >= rect.x && a.x <= rect.x + rect.width && Math.max(Math.min(a.y, b.y), rect.y) < Math.min(Math.max(a.y, b.y), rect.y + rect.height);
  for (const record of messageRecords) {
    const item = record.item, route = routeByMessage.get(record.index);
    if (String(item.from) !== String(item.to)) continue;
    const participantIndex = participantIndexes.get(String(item.from));
    const offset = 42 + record.index * 8;
    const rightSpace = page.width - (centers[participantIndex] + offset), leftSpace = centers[participantIndex] - offset;
    const rightFits = rightSpace >= record.metrics.width + 24, leftFits = leftSpace >= record.metrics.width + 24;
    const loopSide = rightFits && leftFits ? (rightSpace >= leftSpace ? 1 : -1) : rightFits ? 1 : leftFits ? -1 : (rightSpace >= leftSpace ? 1 : -1);
    const trackX = centers[participantIndex] + loopSide * offset;
    const occupiedOffsets = routed.routes.flatMap((otherRoute, otherIndex) => otherIndex === record.index ? [] : [otherRoute.sourcePort, otherRoute.targetPort])
      .filter(port => port.nodeId === route.targetPort.nodeId && port.side === route.targetPort.side).map(port => port.offset);
    const desiredTargetOffset = clamp(route.sourcePort.offset + 28 / lineHeight, 0.04, 0.96);
    const offsetCandidates = [];
    offsetCandidates.push(desiredTargetOffset);
    for (let delta = 0.01; delta <= 0.5; delta += 0.01) offsetCandidates.push(desiredTargetOffset - delta, desiredTargetOffset + delta);
    offsetCandidates.sort((a, b) => Math.abs(a - desiredTargetOffset) - Math.abs(b - desiredTargetOffset));
    const nearbyOffset = offsetCandidates.find(candidate => candidate >= 0.04 && candidate <= 0.96
      && occupiedOffsets.every(used => Math.abs(used - candidate) >= 0.08));
    if (nearbyOffset !== undefined) {
      route.targetPort.offset = Number(nearbyOffset.toFixed(6));
      route.targetPort.point.y = lineTop + route.targetPort.offset * lineHeight;
    }
    const startY = route.sourcePort.point.y, endY = route.targetPort.point.y;
    route.points = [{ x: trackX, y: startY }, { x: trackX, y: endY }];
    route.bounds = routeBounds(route);
    const metrics = record.metrics;
    const labelX = loopSide > 0 ? trackX + 12 : trackX - metrics.width - 12;
    const middleY = (startY + endY) / 2 - metrics.height / 2;
    const yCandidates = [middleY];
    for (let delta = 8; delta <= lineHeight; delta += 8) yCandidates.push(middleY - delta, middleY + delta);
    const labelBounds = yCandidates.map(y => ({ x: labelX, y, width: metrics.width, height: metrics.height }))
      .find(bounds => bounds.x >= 8 && bounds.x + bounds.width <= page.width - 8 && bounds.y >= lineTop && bounds.y + bounds.height <= lineBottom
        && ![...routedLabelBounds, ...assignedSelfLabels].some(other => collides(bounds, other))
        && !messageRecords.some(otherRecord => {
          if (otherRecord.index === record.index) return false;
          const otherRoute = routeByMessage.get(otherRecord.index), path = [otherRoute.sourcePort.point, ...otherRoute.points, otherRoute.targetPort.point];
          return path.slice(1).some((point, index) => segmentHitsRect(path[index], point, bounds));
        }));
    if (!labelBounds) throw new DiagramInputError(`Sequence self-message ${record.index} has no clear label position`, [{ phase: 'planned', severity: 'error', code: 'LABEL_ROUTE_UNAVAILABLE', path: `messages[${record.index}].label`, message: 'No clear position remains beside the self-call track' }]);
    route.label = { id: `message_label_${record.index}`, bounds: labelBounds, segmentIndex: 1, position: 'center' };
    assignedSelfLabels.push(labelBounds);
  }

  const model = [];
  function frameCells(node) {
    if (node.kind !== 'fragment') return;
    const branchRanges = node.branches.map(branch => {
      const indexes = branch.nodes.flatMap(child => collectMessageIndexes(child));
      const routes = indexes.map(index => routeByMessage.get(index)).filter(Boolean);
      const ys = routes.flatMap(route => [route.bounds.y, route.bounds.y + route.bounds.height, ...(route.label ? [route.label.bounds.y, route.label.bounds.y + route.label.bounds.height] : [])]);
      return { branch, indexes, top: ys.length ? Math.min(...ys) : branch.start, bottom: ys.length ? Math.max(...ys) : branch.end };
    });
    const nonempty = branchRanges.filter(range => range.bottom >= range.top);
    const largestGuard = Math.max(0, ...branchRanges.map(range => range.branch.guardHeight));
    const top = Math.max(lineTop + 8, (nonempty.length ? Math.min(...nonempty.map(range => range.top)) : node.start) - largestGuard - 20);
    const bottom = Math.min(lineBottom - 2, (nonempty.length ? Math.max(...nonempty.map(range => range.bottom)) : node.end) + 38);
    const id = `fragment_${node.index}`;
    model.push(vertex(id, node.fragmentKind,
      `shape=${fragmentStyle.shape || 'umlFrame'};html=1;whiteSpace=wrap;pointerEvents=0;fillColor=${fragmentStyle.fillColor || '#eeeeee'};strokeColor=${fragmentStyle.strokeColor || '#999999'};strokeWidth=${fragmentStyle.strokeWidth || 1};fontSize=${fragmentStyle.fontSize || fontSize};`,
      left, top, Math.max(100, right - left), Math.max(56, bottom - top)));
    branchRanges.forEach((range, branchIndex) => {
      if (branchIndex) {
        const previous = branchRanges[branchIndex - 1];
        const y = clamp((previous.bottom + range.top) / 2, top + 28, bottom - 8), sep = `${id}_sep_${branchIndex}`;
        model.push(vertex(`${sep}_a`, '', 'opacity=0;fillColor=none;strokeColor=none;', left + 1, y, 2, 2));
        model.push(vertex(`${sep}_b`, '', 'opacity=0;fillColor=none;strokeColor=none;', right - 3, y, 2, 2));
        model.push({ kind: 'edge', id: sep, value: '', style: `${fragmentStyle.separatorStyle || 'dashed=1;strokeColor=#999999;strokeWidth=1'};startArrow=none;endArrow=none;edgeStyle=none;`, parent: '1', source: `${sep}_a`, target: `${sep}_b`, ports: { source: { side: 'east', offset: 0.5 }, target: { side: 'west', offset: 0.5 } }, geometry: { relative: 1, sourcePoint: { x: left + 3, y: y + 1 }, targetPoint: { x: right - 3, y: y + 1 }, points: [{ x: (left + right) / 2, y: y + 1 }] } });
      }
      if (range.branch.guard) {
        const guardY = branchIndex ? clamp(range.top - range.branch.guardHeight - 12, top + 26, bottom - range.branch.guardHeight - 8) : top + 8;
        model.push(vertex(`${id}_guard_${branchIndex}`, htmlText(`[${range.branch.displayGuard}]`),
          `text;html=1;align=left;verticalAlign=top;whiteSpace=wrap;fillColor=#ffffff;strokeColor=none;fontSize=${guardFontSize};`,
          left + 12, guardY, Math.max(100, right - left - 24), range.branch.guardHeight));
      }
      range.branch.nodes.forEach(frameCells);
    });
  }
  planned.nodes.forEach(frameCells);

  participants.forEach((participant, index) => {
    const metric = participantMetrics[index], x = centers[index] - metric.width / 2;
    model.push(vertex(`participant_${index}`, '', `sequenceRole=umlLifeline;dashed=1;strokeColor=${participantStyle.strokeColor || '#999999'};strokeWidth=${participantStyle.strokeWidth || 1};`, centers[index] - 0.5, lineTop, 1, lineHeight));
    model.push(vertex(`participant_header_${index}`, htmlText(metric.display),
      `rounded=${participantStyle.rounded ?? 0};html=1;whiteSpace=wrap;fontSize=${fontSize};shape=${participantStyle.shape || 'umlLifeline'};fillColor=${participantStyle.fillColor || 'none'};strokeColor=${participantStyle.strokeColor || '#999999'};strokeWidth=${participantStyle.strokeWidth || 1};`,
      x, headerTop, metric.width, metric.height));
  });

  messageRecords.forEach(record => {
    const route = routeByMessage.get(record.index), request = edgeRequests[record.index];
    const itemKind = String(record.item.kind || 'sync').toLowerCase();
    const arrow = itemKind === 'sync' ? 'block' : 'open', dashed = itemKind === 'return' && messageStyle.returnDashed !== false ? 1 : 0;
    const edgeStyle = `edgeStyle=none;rounded=0;html=1;endArrow=${arrow};startArrow=none;dashed=${dashed};strokeColor=${messageStyle.strokeColor || '#000000'};strokeWidth=${messageStyle.strokeWidth || 1};`;
    if (!route.points.length) {
      const start = route.sourcePort.point, end = route.targetPort.point;
      route.points = [{ x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }];
    }
    model.push({ kind: 'edge', id: `message_${record.index}`, value: '', style: edgeStyle, parent: '1', source: request.source.nodeId, target: request.target.nodeId,
      ports: { source: { side: route.sourcePort.side, offset: route.sourcePort.offset }, target: { side: route.targetPort.side, offset: route.targetPort.offset } },
      geometry: { relative: 1, sourcePoint: route.sourcePort.point, targetPoint: route.targetPort.point, points: route.points } });
  });

  messageRecords.forEach(record => {
    const route = routeByMessage.get(record.index), bounds = route.label?.bounds;
    if (!bounds) throw new DiagramInputError(`Sequence message ${record.index} has no clear label position`, [{ phase: 'planned', severity: 'error', code: 'LABEL_ROUTE_UNAVAILABLE', path: `messages[${record.index}].label`, message: 'The shared router could not place the message label with clearance' }]);
    model.push(vertex(`message_label_${record.index}`, htmlText(record.metrics.displayLabel),
      `text;html=1;align=center;verticalAlign=middle;whiteSpace=wrap;fillColor=#ffffff;strokeColor=none;fontSize=${messageFontSize};`,
      bounds.x, bounds.y, bounds.width, bounds.height));
  });

  const result = serializeCells(model);
  result.page = page;
  return result;
}
