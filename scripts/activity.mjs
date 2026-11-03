import { DiagramInputError, htmlText, textWidth, validatePage } from './common.mjs';
import { routeOrthogonalEdges } from './geometry.mjs';

const text = value => String(value ?? '').trim();
const key = value => encodeURIComponent(String(value));
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function lineCount(value, fontSize, availableWidth) {
  return String(value ?? '').split(/\r?\n/).reduce((count, line) =>
    count + Math.max(1, Math.ceil(textWidth(line, fontSize) / availableWidth)), 0);
}

function labelSize(value, fontSize, maxWidth = 240) {
  const width = clamp(textWidth(value, fontSize) + 16, 72, maxWidth);
  const lines = lineCount(value, fontSize, width - 16);
  return { width, height: Math.max(fontSize + 10, Math.ceil(lines * fontSize * 1.4 + 10)) };
}

function pageFor(data, positions) {
  if (data.page) return validatePage(data.page);
  const right = Math.max(0, ...[...positions.values()].map(bounds => bounds.x + bounds.width));
  const bottom = Math.max(0, ...[...positions.values()].map(bounds => bounds.y + bounds.height));
  return { width: Math.max(1200, right + 60), height: Math.max(800, bottom + 60) };
}

function layoutError(diagnostics) {
  const errors = diagnostics.filter(item => item.severity === 'error');
  if (errors.length) throw new DiagramInputError('Activity geometry planning failed', errors);
}

function routeWithPortFallback(obstacles, requests, page, clearance) {
  const copyRequests = source => source.map(request => ({
    ...request,
    source: { ...request.source, ...(request.source.port ? { port: { ...request.source.port } } : {}) },
    target: { ...request.target, ...(request.target.port ? { port: { ...request.target.port } } : {}) }
  }));
  let selected = copyRequests(requests);
  let routed = routeOrthogonalEdges({ obstacles, edges: selected, page, clearance });
  const sideOrder = ['north', 'east', 'south', 'west'];
  for (let pass = 0; pass < requests.length && routed.diagnostics.some(item => item.severity === 'error'); pass++) {
    let bestCount = routed.diagnostics.filter(item => item.severity === 'error').length;
    let best;
    for (const diagnostic of routed.diagnostics.filter(item => item.severity === 'error')) {
      const failedPath = diagnostic.path.replace(/^edges\./, '');
      const edge = selected.find(request => failedPath === request.id || failedPath === `${request.id}.label`);
      if (!edge || edge.source.nodeId === edge.target.nodeId) continue;
      for (const sourceSide of sideOrder) for (const targetSide of sideOrder) {
        if (edge.source.port?.side === sourceSide && edge.target.port?.side === targetSide) continue;
        const trial = copyRequests(selected), candidate = trial.find(request => request.id === edge.id);
        candidate.source.port = { ...(candidate.source.port || {}), side: sourceSide };
        candidate.target.port = { ...(candidate.target.port || {}), side: targetSide };
        const result = routeOrthogonalEdges({ obstacles, edges: trial, page, clearance });
        const count = result.diagnostics.filter(item => item.severity === 'error').length;
        if (count < bestCount) { bestCount = count; best = { requests: trial, routed: result }; }
        if (bestCount === 0) break;
      }
      if (bestCount === 0) break;
    }
    if (!best) break;
    selected = best.requests;
    routed = best.routed;
  }
  return routed;
}

export function renderActivity(data, styles = {}) {
  const nodes = data.nodes || [], transitions = data.transitions || [];
  if (!nodes.length) throw new DiagramInputError('activity requires nodes[]');

  const ids = new Set();
  for (const [index, node] of nodes.entries()) {
    if (!text(node.id) || !['initial', 'action', 'decision', 'merge', 'final', 'activityFinal', 'flowFinal'].includes(node.kind))
      throw new DiagramInputError(`nodes[${index}] requires an id and supported kind (initial, action, decision, merge, final, flowFinal)`);
    if (ids.has(node.id)) throw new DiagramInputError(`duplicate activity node id: ${node.id}`);
    ids.add(node.id);
    if (node.kind === 'action' && !text(node.label)) throw new DiagramInputError(`nodes[${index}].label is required for action`);
  }

  const transitionIds = new Set();
  for (const [index, transition] of transitions.entries()) {
    if (!ids.has(transition.from) || !ids.has(transition.to)) throw new DiagramInputError(`transitions[${index}] has unresolved from/to endpoint`);
    const semanticId = transition.id || `${transition.from}_${transition.to}_${text(transition.guard || transition.label)}`;
    if (transitionIds.has(semanticId)) throw new DiagramInputError(`duplicate transition id: ${semanticId}`);
    transitionIds.add(semanticId);
  }

  const activityStyle = styles.activity || {}, actionStyle = activityStyle.action || {}, nodeStyle = activityStyle.node || {}, edgeStyle = activityStyle.edge || {};
  const fontSize = activityStyle.fontSize || 14, positions = new Map();
  nodes.forEach((node, index) => {
    const kind = node.kind, label = text(node.label);
    let width, height;
    if (kind === 'action') {
      width = clamp(textWidth(label, fontSize) + 32, 150, 240);
      height = Math.max(58, Math.ceil(lineCount(label, fontSize, width - 32) * fontSize * 1.5 + 20));
    } else if (kind === 'decision' || kind === 'merge') width = height = 72;
    else width = height = 34;
    positions.set(node.id, {
      x: Number.isFinite(node.x) ? node.x : 250 + (index % 3) * 250,
      y: Number.isFinite(node.y) ? node.y : 60 + Math.floor(index / 3) * 135,
      width,
      height
    });
  });

  const page = pageFor(data, positions), diagnostics = [];
  for (const [id, bounds] of positions) if (bounds.x < 0 || bounds.y < 0 || bounds.x + bounds.width > page.width || bounds.y + bounds.height > page.height)
    diagnostics.push({ phase: 'planned', severity: 'warning', code: 'PAGE_OVERFLOW', path: `nodes.${id}`, message: 'Activity node extends beyond page bounds', value: { ...bounds, ...page } });

  const cells = [], obstacles = [], nodeCellIds = new Map();
  for (const node of nodes) {
    const geometry = positions.get(node.id), cellId = `activity_${key(node.id)}`, kind = node.kind;
    nodeCellIds.set(node.id, cellId);
    let style, label = text(node.label);
    if (kind === 'action') style = `rounded=1;arcSize=20;whiteSpace=wrap;html=1;fillColor=${actionStyle.fillColor || '#ffffff'};strokeColor=${actionStyle.strokeColor || '#000000'};strokeWidth=${actionStyle.strokeWidth || 1};fontSize=${fontSize};`;
    else if (kind === 'decision' || kind === 'merge') style = `rhombus;whiteSpace=wrap;html=1;fillColor=${nodeStyle.fillColor || '#ffffff'};strokeColor=${nodeStyle.strokeColor || '#000000'};strokeWidth=${nodeStyle.strokeWidth || 1};fontSize=${fontSize};`;
    else if (kind === 'initial') style = 'ellipse;html=1;fillColor=#000000;strokeColor=#000000;';
    else if (kind === 'flowFinal') { style = 'ellipse;html=1;fillColor=#ffffff;strokeColor=#000000;strokeWidth=1.5;'; label = '×'; }
    else if (kind === 'final' || kind === 'activityFinal') style = 'ellipse;html=1;fillColor=#ffffff;strokeColor=#000000;strokeWidth=2;';
    else style = 'ellipse;html=1;fillColor=#ffffff;strokeColor=#000000;';
    cells.push({ kind: 'vertex', id: cellId, value: htmlText(label), style, parent: '1', geometry });
    obstacles.push({ id: cellId, kind: 'node', bounds: geometry });
    if (kind === 'final' || kind === 'activityFinal') cells.push({
      kind: 'vertex', id: `${cellId}_inner`, value: '', style: 'ellipse;html=1;fillColor=#000000;strokeColor=#000000;', parent: cellId,
      geometry: { x: 9, y: 9, width: geometry.width - 18, height: geometry.height - 18 }
    });
  }

  const edgeRequests = transitions.map(transition => {
    const semanticId = transition.id || `${transition.from}_${transition.to}_${text(transition.guard || transition.label)}`;
    const label = text(transition.guard || transition.label);
    const request = {
      id: `transition_${key(semanticId)}`,
      source: { nodeId: nodeCellIds.get(transition.from) },
      target: { nodeId: nodeCellIds.get(transition.to) },
      ...(transition.from === transition.to ? { allowSelfLoop: true } : {})
    };
    const sourceBounds = positions.get(transition.from), targetBounds = positions.get(transition.to);
    const sourceNode = nodes.find(node => node.id === transition.from);
    const sourceCenterX = sourceBounds.x + sourceBounds.width / 2, targetCenterX = targetBounds.x + targetBounds.width / 2;
    if (label && sourceNode.kind === 'initial') {
      request.source.port = { side: 'east', preferredOffset: 0.5 };
      request.target.port = { side: 'north', preferredOffset: 0.5 };
    } else if (label && sourceNode.kind === 'decision') {
      if (targetBounds.y < sourceBounds.y) {
        request.source.port = { side: 'west', preferredOffset: 0.5 };
        request.target.port = { side: 'west', preferredOffset: 0.5 };
      } else {
        const side = targetCenterX >= sourceCenterX ? 'east' : 'west';
        request.source.port = { side, preferredOffset: 0.5 };
        request.target.port = { side: side === 'east' ? 'north' : 'west', preferredOffset: 0.5 };
      }
    } else if (label && sourceNode.kind === 'merge') {
      request.source.port = { side: 'west', preferredOffset: 0.5 };
      request.target.port = { side: 'south', preferredOffset: 0.5 };
    } else if (label && transition.from !== transition.to && Math.abs(sourceCenterX - targetCenterX) < 80) {
      const side = sourceBounds.y > targetBounds.y ? 'east' : 'west';
      request.source.port = { side, preferredOffset: 0.5 };
      request.target.port = { side, preferredOffset: 0.5 };
    } else if (!label && sourceNode.kind === 'action' && targetBounds.y > sourceBounds.y) {
      request.source.port = { side: 'south', preferredOffset: 0.5 };
    }
    const labelFontSize = edgeStyle.fontSize || Math.min(fontSize, 12);
    if (label) request.label = { id: `transition_label_${key(semanticId)}`, ...labelSize(label, labelFontSize, 120) };
    return { transition, request, label };
  });
  const routed = routeWithPortFallback(obstacles, edgeRequests.map(item => item.request), page, activityStyle.clearance ?? 12);
  diagnostics.push(...routed.diagnostics);
  layoutError(diagnostics);

  const routeById = new Map(routed.routes.map(route => [route.edgeId, route]));
  for (const { transition, request, label } of edgeRequests) {
    const route = routeById.get(request.id);
    if (!route) continue;
    const style = `edgeStyle=none;rounded=0;html=1;strokeColor=${edgeStyle.strokeColor || '#000000'};strokeWidth=${edgeStyle.strokeWidth || 1};endArrow=block;endFill=1;`;
    cells.push({
      kind: 'edge', id: request.id, value: '', style, parent: '1', source: request.source.nodeId, target: request.target.nodeId,
      ports: { source: { side: route.sourcePort.side, offset: route.sourcePort.offset }, target: { side: route.targetPort.side, offset: route.targetPort.offset } },
      geometry: { relative: 1, points: route.points }
    });
    if (label && route.label) cells.push({
      kind: 'vertex', id: request.label.id, value: htmlText(label),
      style: `text;html=1;whiteSpace=wrap;align=center;verticalAlign=middle;fillColor=none;strokeColor=none;fontSize=${edgeStyle.fontSize || Math.min(fontSize, 12)};`,
      parent: '1', geometry: { x: route.label.bounds.x, y: route.label.bounds.y, width: route.label.bounds.width, height: route.label.bounds.height }
    });
  }

  return { cells, diagnostics, page };
}
