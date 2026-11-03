const sides = new Set(['north', 'east', 'south', 'west']);
const diagnostic = (severity, code, path, message, value) => ({ phase: 'planned', severity, code, path, message, ...(value === undefined ? {} : { value }) });
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const num = value => Number.isFinite(Number(value)) ? Number(value) : NaN;

function boundsOf(value, path) {
  const b = value?.bounds ?? value;
  const result = { x: num(b?.x), y: num(b?.y), width: num(b?.width), height: num(b?.height) };
  if (Object.values(result).some(n => !Number.isFinite(n)) || result.width < 0 || result.height < 0) throw new TypeError(`${path} requires finite x/y and nonnegative width/height`);
  return result;
}
const expand = (r, n) => ({ x: r.x - n, y: r.y - n, width: r.width + n * 2, height: r.height + n * 2 });
const inside = (p, r) => p.x > r.x && p.x < r.x + r.width && p.y > r.y && p.y < r.y + r.height;
function crosses(a, b, rect) {
  if (a.x === b.x) return a.x > rect.x && a.x < rect.x + rect.width && Math.max(Math.min(a.y, b.y), rect.y) < Math.min(Math.max(a.y, b.y), rect.y + rect.height);
  if (a.y === b.y) return a.y > rect.y && a.y < rect.y + rect.height && Math.max(Math.min(a.x, b.x), rect.x) < Math.min(Math.max(a.x, b.x), rect.x + rect.width);
  return true;
}
function overlapsTrack(a, b, c, d) {
  if (a.x === b.x && c.x === d.x && a.x === c.x) return Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)) < Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y));
  if (a.y === b.y && c.y === d.y && a.y === c.y) return Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)) < Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x));
  return false;
}
const keyPoint = p => `${p.x},${p.y}`;
const direction = (a, b) => a.x === b.x ? (b.y < a.y ? 'n' : 's') : (b.x < a.x ? 'w' : 'e');
const normSide = d => ({ n: 'north', e: 'east', s: 'south', w: 'west' })[d];
function cleanPath(points) {
  const result = [];
  for (const point of points) {
    if (result.length && keyPoint(result.at(-1)) === keyPoint(point)) continue;
    while (result.length > 1) {
      const a = result.at(-2), b = result.at(-1);
      if ((a.x === b.x && b.x === point.x) || (a.y === b.y && b.y === point.y)) result.pop(); else break;
    }
    result.push(point);
  }
  return result;
}

// Small binary heap used by the grid A* search.
class Heap {
  items = [];
  push(value) { let i = this.items.push(value) - 1; while (i) { const p = (i - 1) >> 1; if (this.items[p].f <= value.f) break; this.items[i] = this.items[p]; i = p; } this.items[i] = value; }
  pop() {
    if (!this.items.length) return undefined;
    const first = this.items[0], last = this.items.pop();
    if (this.items.length) { let i = 0; while (true) { let c = i * 2 + 1; if (c >= this.items.length) break; if (c + 1 < this.items.length && this.items[c + 1].f < this.items[c].f) c++; if (this.items[c].f >= last.f) break; this.items[i] = this.items[c]; i = c; } this.items[i] = last; }
    return first;
  }
}

function chooseSide(from, to, requested) {
  if (requested && !sides.has(requested)) throw new TypeError(`port.side must be north, east, south, or west; received ${requested}`);
  if (requested) return requested;
  const dx = to.x + to.width / 2 - (from.x + from.width / 2), dy = to.y + to.height / 2 - (from.y + from.height / 2);
  return Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 'east' : 'west') : (dy >= 0 ? 'south' : 'north');
}
function allocatePorts(edges, obstacles) {
  const byId = new Map(obstacles.map(o => [o.id, o])), requests = [];
  for (const edge of edges) for (const end of ['source', 'target']) {
    const endpoint = edge[end], node = byId.get(endpoint.nodeId);
    if (!node) throw new TypeError(`edges.${edge.id}.${end}.nodeId does not resolve: ${endpoint.nodeId}`);
    const other = byId.get(edge[end === 'source' ? 'target' : 'source'].nodeId);
    if (!other) throw new TypeError(`edges.${edge.id} endpoint does not resolve`);
    const side = chooseSide(node.bounds, other.bounds, endpoint.port?.side);
    requests.push({ edgeId: edge.id, end, endpoint, node, side });
  }
  const grouped = new Map();
  for (const request of requests) { const key = `${request.node.id}\0${request.side}`; if (!grouped.has(key)) grouped.set(key, []); grouped.get(key).push(request); }
  const result = new Map();
  for (const group of grouped.values()) {
    group.sort((a, b) => compare(a.edgeId, b.edgeId) || compare(a.end, b.end));
    const used = [];
    group.forEach((request, index) => {
      const b = request.node.bounds, vertical = request.side === 'east' || request.side === 'west';
      let offset = request.endpoint.port?.preferredOffset;
      if (offset === undefined) offset = request.endpoint.port?.offset;
      if (offset !== undefined && (!Number.isFinite(Number(offset)) || Number(offset) < 0 || Number(offset) > 1)) throw new TypeError(`edges.${request.edgeId}.${request.end}.port.preferredOffset must be in [0,1]`);
      if (offset === undefined || used.some(n => Math.abs(n - Number(offset)) < 0.08)) {
        const candidates = group.length === 1 ? [0.5] : group.map((_, i) => 0.12 + 0.76 * i / (group.length - 1));
        offset = candidates.find(candidate => used.every(n => Math.abs(n - candidate) >= 0.08));
      }
      if (offset === undefined) offset = Math.max(0.05, Math.min(0.95, 0.12 + 0.76 * index / Math.max(1, group.length - 1)));
      offset = Number(Number(offset).toFixed(6)); used.push(offset);
      const point = request.side === 'east' ? { x: b.x + b.width, y: b.y + b.height * offset }
        : request.side === 'west' ? { x: b.x, y: b.y + b.height * offset }
          : request.side === 'south' ? { x: b.x + b.width * offset, y: b.y + b.height }
            : { x: b.x + b.width * offset, y: b.y };
      result.set(`${request.edgeId}\0${request.end}`, { nodeId: request.node.id, side: request.side, offset, point });
    });
  }
  return result;
}

function portEscape(port, obstacle, clearance) {
  const distance = Math.max(1, clearance + 1), p = port.point, b = obstacle.bounds;
  if (port.side === 'east') return { x: Math.min(b.x + b.width + distance, Infinity), y: p.y };
  if (port.side === 'west') return { x: b.x - distance, y: p.y };
  if (port.side === 'south') return { x: p.x, y: b.y + b.height + distance };
  return { x: p.x, y: b.y - distance };
}

function routeOne(start, goal, obstacles, excluded, occupied, page, clearance) {
  const expanded = obstacles.filter(o => !excluded.has(o.id)).map(o => ({ id: o.id, bounds: expand(o.bounds, clearance) }));
  const xs = new Set([start.x, goal.x, 0, page.width]), ys = new Set([start.y, goal.y, 0, page.height]);
  for (const o of expanded) {
    const b = o.bounds;
    for (const x of [b.x - 1, b.x, b.x + b.width, b.x + b.width + 1]) if (x >= 0 && x <= page.width) xs.add(x);
    for (const y of [b.y - 1, b.y, b.y + b.height, b.y + b.height + 1]) if (y >= 0 && y <= page.height) ys.add(y);
  }
  const xList = [...xs].sort((a, b) => a - b), yList = [...ys].sort((a, b) => a - b);
  const coord = new Map(); xList.forEach((x, i) => coord.set(`x${x}`, i)); yList.forEach((y, i) => coord.set(`y${y}`, i));
  const s = { ix: coord.get(`x${start.x}`), iy: coord.get(`y${start.y}`) }, g = { ix: coord.get(`x${goal.x}`), iy: coord.get(`y${goal.y}`) };
  const idOf = (ix, iy, dir) => `${ix},${iy},${dir}`;
  const heap = new Heap(), best = new Map(), previous = new Map();
  const h = (ix, iy) => Math.abs(xList[ix] - goal.x) + Math.abs(yList[iy] - goal.y);
  const initial = { ix: s.ix, iy: s.iy, dir: '', g: 0 }; initial.f = h(initial.ix, initial.iy); heap.push(initial); best.set(idOf(initial.ix, initial.iy, ''), 0);
  let final;
  while (heap.items.length) {
    const current = heap.pop(), currentId = idOf(current.ix, current.iy, current.dir);
    if (current.g !== best.get(currentId)) continue;
    if (current.ix === g.ix && current.iy === g.iy) { final = current; break; }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ix = current.ix + dx, iy = current.iy + dy;
      if (ix < 0 || iy < 0 || ix >= xList.length || iy >= yList.length) continue;
      const a = { x: xList[current.ix], y: yList[current.iy] }, b = { x: xList[ix], y: yList[iy] };
      if (expanded.some(o => crosses(a, b, o.bounds)) || occupied.some(([p, q]) => overlapsTrack(a, b, p, q))) continue;
      const dir = direction(a, b), bend = current.dir && current.dir !== dir ? 28 : 0;
      const proximity = occupied.reduce((cost, [p, q]) => {
        if (p.x === q.x && a.x === b.x && Math.abs(a.x - p.x) < 24 && Math.max(Math.min(a.y, b.y), Math.min(p.y, q.y)) < Math.min(Math.max(a.y, b.y), Math.max(p.y, q.y))) return cost + (24 - Math.abs(a.x - p.x)) * 0.25;
        if (p.y === q.y && a.y === b.y && Math.abs(a.y - p.y) < 24 && Math.max(Math.min(a.x, b.x), Math.min(p.x, q.x)) < Math.min(Math.max(a.x, b.x), Math.max(p.x, q.x))) return cost + (24 - Math.abs(a.y - p.y)) * 0.25;
        return cost;
      }, 0);
      const nextG = current.g + Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + bend + proximity, nextId = idOf(ix, iy, dir);
      if (nextG >= (best.get(nextId) ?? Infinity)) continue;
      best.set(nextId, nextG); previous.set(nextId, currentId);
      const next = { ix, iy, dir, g: nextG }; next.f = nextG + h(ix, iy); heap.push(next);
    }
  }
  if (!final) return null;
  const ids = []; let current = idOf(final.ix, final.iy, final.dir);
  while (current) { ids.push(current); current = previous.get(current); }
  return cleanPath(ids.reverse().map(key => { const [ix, iy] = key.split(',').map(Number); return { x: xList[ix], y: yList[iy] }; }));
}

function labelPlacement(label, points, obstacles, page, clearance, occupied) {
  if (!label) return undefined;
  const width = num(label.width), height = num(label.height);
  if (!(width > 0 && height > 0)) throw new TypeError(`edge label ${label.id ?? ''} requires positive width and height`);
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], horizontal = a.y === b.y;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    for (const sign of [-1, 1]) {
      const center = horizontal ? { x: mid.x, y: mid.y + sign * (height / 2 + clearance + 4) } : { x: mid.x + sign * (width / 2 + clearance + 4), y: mid.y };
      const rect = { x: center.x - width / 2, y: center.y - height / 2, width, height };
      if (rect.x < 0 || rect.y < 0 || rect.x + width > page.width || rect.y + height > page.height) continue;
      if (obstacles.some(o => crossesRect(rect, o.bounds, clearance))) continue;
      if (points.slice(1).some((p, index) => index !== i - 1 && crossesRect(rect, { x: Math.min(points[index].x, p.x), y: Math.min(points[index].y, p.y), width: Math.abs(points[index].x - p.x) || 0.01, height: Math.abs(points[index].y - p.y) || 0.01 }, 1))) continue;
      if (occupied.some(([a, b]) => crossesRect(rect, { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x) || 0.01, height: Math.abs(a.y - b.y) || 0.01 }, 1))) continue;
      return { id: label.id, bounds: rect, segmentIndex: i - 1, position: 'center' };
    }
  }
  return undefined;
}
function crossesRect(a, b, pad = 0) {
  const r = expand(b, pad);
  return a.x < r.x + r.width && a.x + a.width > r.x && a.y < r.y + r.height && a.y + a.height > r.y;
}

export function routeOrthogonalEdges({ obstacles: rawObstacles = [], edges: rawEdges = [], page: rawPage, clearance = 12 } = {}) {
  const diagnostics = [], routes = [];
  if (!Array.isArray(rawObstacles) || !Array.isArray(rawEdges)) throw new TypeError('obstacles and edges must be arrays');
  if (!Number.isFinite(clearance) || clearance < 0) throw new TypeError('clearance must be a finite nonnegative number');
  const obstacles = rawObstacles.map((o, i) => {
    if (!o || typeof o.id !== 'string' || !o.id || !['node', 'label', 'container', 'helper'].includes(o.kind)) throw new TypeError(`obstacles[${i}] requires id and supported kind`);
    return { ...o, bounds: boundsOf(o, `obstacles[${i}]`) };
  });
  const page = { width: num(rawPage?.width), height: num(rawPage?.height) };
  if (!(page.width > 0 && page.height > 0)) throw new TypeError('page requires positive finite width and height');
  const edges = [...rawEdges].sort((a, b) => compare(a?.id ?? '', b?.id ?? ''));
  if (edges.some(e => !e || typeof e.id !== 'string' || !e.id) || new Set(edges.map(e => e.id)).size !== edges.length) throw new TypeError('edges require unique nonempty string IDs');
  const ports = allocatePorts(edges, obstacles), occupied = [], allocatedObstacles = [...obstacles];
  for (const edge of edges) {
    const sourcePort = ports.get(`${edge.id}\0source`), targetPort = ports.get(`${edge.id}\0target`), sourceObstacle = obstacles.find(o => o.id === sourcePort.nodeId), targetObstacle = obstacles.find(o => o.id === targetPort.nodeId);
    if (sourcePort.nodeId === targetPort.nodeId && !edge.allowSelfLoop) {
      diagnostics.push(diagnostic('error', 'ROUTE_SELF_LOOP_UNSUPPORTED', `edges.${edge.id}`, 'Self edges require an explicit self-loop routing request', edge.id)); continue;
    }
    const start = portEscape(sourcePort, sourceObstacle, clearance), goal = portEscape(targetPort, targetObstacle, clearance);
    if ([start, goal].some(p => p.x < 0 || p.x > page.width || p.y < 0 || p.y > page.height)) {
      diagnostics.push(diagnostic('error', 'ROUTE_BOUNDS', `edges.${edge.id}`, 'Endpoint clearance extends beyond the page bounds', { start, goal })); continue;
    }
    const endpointIds = new Set([sourcePort.nodeId, targetPort.nodeId]);
    const blockedStub = [[sourcePort.point, start], [goal, targetPort.point]].some(([a, b]) => allocatedObstacles.some(o => !endpointIds.has(o.id) && crosses(a, b, expand(o.bounds, clearance))));
    if (blockedStub) { diagnostics.push(diagnostic('error', 'ROUTE_ENDPOINT_BLOCKED', `edges.${edge.id}`, 'Endpoint clearance cannot leave or reach its node without crossing another obstacle')); continue; }
    const path = routeOne(start, goal, allocatedObstacles, endpointIds, occupied, page, clearance);
    if (!path) { diagnostics.push(diagnostic('error', 'ROUTE_UNAVAILABLE', `edges.${edge.id}`, 'No obstacle-free, non-overlapping orthogonal route fits within page bounds')); continue; }
    const full = cleanPath([sourcePort.point, ...path, targetPort.point]);
    const label = labelPlacement(edge.label, full, allocatedObstacles, page, clearance, occupied);
    if (edge.label && !label) diagnostics.push(diagnostic('error', 'LABEL_ROUTE_UNAVAILABLE', `edges.${edge.id}.label`, 'No clear in-page position is available for this edge label', edge.label.id));
    const segments = full.slice(1).map((point, i) => [full[i], point]); occupied.push(...segments);
    if (label) allocatedObstacles.push({ id: `route-label:${edge.id}`, kind: 'label', ownerId: edge.id, bounds: label.bounds });
    const xs = full.map(p => p.x), ys = full.map(p => p.y);
    routes.push({ edgeId: edge.id, sourcePort, targetPort, points: full.slice(1, -1), bounds: { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) }, ...(label ? { label } : {}) });
  }
  return { routes, diagnostics, page };
}
