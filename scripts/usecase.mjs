import { htmlText, vertex, edge } from './common.mjs';

const text = (v) => String(v ?? '').trim();
const key = (v) => encodeURIComponent(String(v));

export function renderUsecase(d, styles = {}) {
  const actors = d.actors || [], cases = d.useCases || [], rels = d.relationships || [];
  if (!actors.length || !cases.length) throw Error('usecase requires actors[] and useCases[]');
  const ids = new Set();
  for (const [kind, rows] of [['actor', actors], ['use case', cases]]) for (const [i, row] of rows.entries()) {
    if (!text(row.id) || !text(row.label)) throw Error(`${kind} at index ${i} requires nonempty id and label`);
    if (ids.has(row.id)) throw Error(`duplicate use-case diagram id: ${row.id}`);
    ids.add(row.id);
  }
  const actorIds = new Set(actors.map(x => x.id)), caseIds = new Set(cases.map(x => x.id));
  const seenRel = new Set(), relIds = new Set(), caseActors = new Map(), actorAssociations = new Map(actors.map(actor => [actor.id, []]));
  for (const [i, r] of rels.entries()) {
    const type = r.type || r.kind;
    if (!['association', 'include', 'extend', 'generalization'].includes(type)) throw Error(`relationships[${i}].type must be association, include, extend, or generalization`);
    if (!text(r.from) || !text(r.to)) throw Error(`relationships[${i}] requires from and to`);
    if (type === 'association') {
      if (!(actorIds.has(r.from) && caseIds.has(r.to) || actorIds.has(r.to) && caseIds.has(r.from))) throw Error(`relationships[${i}] association must connect one declared actor and one declared use case`);
      const actorId = actorIds.has(r.from) ? r.from : r.to, caseId = actorIds.has(r.from) ? r.to : r.from;
      if (!caseActors.has(caseId)) caseActors.set(caseId, new Set());
      caseActors.get(caseId).add(actorId);
      actorAssociations.get(actorId).push(caseId);
    } else if (!(caseIds.has(r.from) && caseIds.has(r.to))) throw Error(`relationships[${i}] ${type} must connect declared use cases`);
    const sig = `${type}:${r.from}:${r.to}`;
    if (seenRel.has(sig)) throw Error(`duplicate relationship ${sig}`);
    seenRel.add(sig);
    if (r.id && relIds.has(r.id)) throw Error(`duplicate relationship id: ${r.id}`);
    if (r.id) relIds.add(r.id);
  }

  const st = styles.usecase || {}, ast = st.actor || {}, ust = st.useCase || {}, bst = st.boundary || {}, rst = st.relationship || {};
  const fontSize = st.fontSize || 14;
  const longest = Math.max(0, ...cases.map(c => text(c.label).split(/\n/).reduce((a, s) => Math.max(a, s.length), 0)));
  const caseW = Math.max(150, Math.min(260, longest * fontSize * 0.62 + 44));
  const caseH = Math.max(66, ...cases.map(c => Math.max(1, text(c.label).split('\n').length) * fontSize * 1.35 + 24));
  // With exactly two actors whose associations partition the use cases, place
  // each actor's cases in its own column. Other inputs retain a one-column grid.
  const twoActorColumns = actors.length === 2 && cases.every(c => caseActors.get(c.id)?.size === 1) &&
    actors.every(a => cases.some(c => caseActors.get(c.id)?.has(a.id)));
  const colByActor = new Map(actors.map((a, i) => [a.id, i]));
  const caseCol = new Map(cases.map(c => [c.id, twoActorColumns ? colByActor.get([...caseActors.get(c.id)][0]) : 0]));
  const colCases = Array.from({ length: twoActorColumns ? 2 : 1 }, (_, col) => cases.filter(c => caseCol.get(c.id) === col));
  const rowByCase = new Map();
  colCases.forEach((list, col) => list.forEach((c, row) => rowByCase.set(c.id, row)));
  const rows = Math.max(...colCases.map(list => list.length));
  const gapY = 70, gapX = 100, margin = 54, header = 48, top = 55;
  const symbolW = 64, symbolH = 72, actorW = Math.max(220, Math.min(300, ...actors.map(a => Math.max(220, text(a.label).length * 8 + 24))));
  const leftActorX = actorW + 10, boundaryLeft = leftActorX + symbolW + 42;
  const cols = twoActorColumns ? 2 : 1;
  const bw = margin * 2 + cols * caseW + (cols - 1) * gapX;
  const bh = header + margin + rows * caseH + (rows - 1) * gapY + 36;
  const rightActorX = boundaryLeft + bw + 42;
  const minWidth = actors.length === 2 ? rightActorX + symbolW + actorW + 50 : boundaryLeft + bw + 50;
  const pageW = d.page?.width || Math.max(900, minWidth), pageH = d.page?.height || Math.max(540, top + bh + 65);
  if (minWidth > pageW || top + bh + 30 > pageH) throw Error(`use-case boundary or actors do not fit page (${pageW}x${pageH}); increase page dimensions`);

  const out = [];
  out.push(vertex('system_boundary', '', `rounded=0;html=1;fillColor=${bst.fillColor || 'none'};strokeColor=${bst.strokeColor || '#000000'};strokeWidth=${bst.strokeWidth || 1};`, boundaryLeft, top, bw, bh));
  out.push(vertex('system_boundary_title', htmlText(d.systemName || d.title || 'System'), `text;html=1;whiteSpace=wrap;align=left;verticalAlign=middle;fillColor=none;strokeColor=none;fontSize=${fontSize};`, boundaryLeft + 12, top + 8, bw - 24, 28));
  const caseGeo = new Map();
  cases.forEach(c => {
    const col = caseCol.get(c.id), row = rowByCase.get(c.id), localX = margin + col * (caseW + gapX), localY = header + 18 + row * (caseH + gapY);
    const global = { x: boundaryLeft + localX, y: top + localY, w: caseW, h: caseH, col, row };
    caseGeo.set(c.id, global);
    out.push(vertex(`usecase_${key(c.id)}`, htmlText(text(c.label)), `shape=${ust.shape || 'ellipse'};html=1;whiteSpace=wrap;fillColor=${ust.fillColor || '#ffffff'};strokeColor=${ust.strokeColor || '#000000'};strokeWidth=${ust.strokeWidth || 1};fontSize=${fontSize};`, localX, localY, caseW, caseH, 'system_boundary'));
  });
  const actorGeo = new Map();
  actors.forEach((a, i) => {
    const targets = cases.filter(c => caseActors.get(c.id)?.has(a.id)).map(c => caseGeo.get(c.id));
    const symbolY = targets.length ? targets.reduce((s, c) => s + c.y + c.h / 2, 0) / targets.length - symbolH / 2 : top + 40 + i * 150;
    const side = actors.length === 2 ? (i === 0 ? 'left' : 'right') : 'left';
    const symbolX = side === 'left' ? leftActorX : rightActorX;
    actorGeo.set(a.id, { x: symbolX, y: symbolY, w: symbolW, h: symbolH, side });
    out.push(vertex(`actor_${key(a.id)}`, '', `shape=${ast.shape || 'umlActor'};html=1;fillColor=${ast.fillColor || '#ffffff'};strokeColor=${ast.strokeColor || '#000000'};strokeWidth=${ast.strokeWidth || 1};`, symbolX, symbolY, symbolW, symbolH));
    const labelX = side === 'left' ? 0 : symbolX + symbolW + 8;
    out.push(vertex(`actor_label_${key(a.id)}`, htmlText(text(a.label)), `text;html=1;whiteSpace=wrap;align=${side === 'left' ? 'right' : 'left'};verticalAlign=middle;fillColor=none;strokeColor=none;fontSize=${fontSize};`, labelX, symbolY, actorW, symbolH));
  });

  rels.forEach(r => {
    const type = r.type || r.kind;
    let from = r.from, to = r.to, label = text(r.label);
    if (type === 'association') {
      if (!actorIds.has(from)) [from, to] = [to, from];
      const actor = actorGeo.get(from), target = caseGeo.get(to);
      const actorOnLeft = actor.side === 'left';
      const actorTargets = actorAssociations.get(from), portIndex = actorTargets.indexOf(to);
      const exitY = actorTargets.length < 2 ? 0.5 : 0.15 + 0.7 * portIndex / (actorTargets.length - 1);
      const associationStyle = `html=1;noEdgeStyle=1;edgeStyle=none;rounded=0;strokeColor=${rst.strokeColor || '#000000'};strokeWidth=${rst.strokeWidth || 1};startArrow=none;endArrow=none;exitX=${actorOnLeft ? 1 : 0};exitY=${exitY};exitDx=0;exitDy=0;exitPerimeter=1;entryX=${actorOnLeft ? 0 : 1};entryY=0.5;entryDx=0;entryDy=0;entryPerimeter=1;`;
      out.push(edge(`relationship_${key(r.id || `${type}_${from}_${to}`)}`, `actor_${key(from)}`, `usecase_${key(to)}`, '', associationStyle));
      return;
    }
    label = htmlText(label);
    const style = `html=1;noEdgeStyle=1;edgeStyle=none;rounded=0;strokeColor=${rst.strokeColor || '#000000'};strokeWidth=${rst.strokeWidth || 1};fontSize=${rst.fontSize || 12};`;
    if (type === 'include') { label ||= '«include»'; }
    else if (type === 'extend') { label ||= '«extend»'; }
    if (type === 'include' || type === 'extend') out.push(edge(`relationship_${key(r.id || `${type}_${from}_${to}`)}`, `usecase_${key(from)}`, `usecase_${key(to)}`, label, `${style}dashed=1;dashPattern=6 4;endArrow=open;endFill=0;endSize=8;`, '1'));
    else out.push(edge(`relationship_${key(r.id || `${type}_${from}_${to}`)}`, `usecase_${key(from)}`, `usecase_${key(to)}`, label, `${style}endArrow=block;endFill=0;`, '1'));
  });
  return out;
}
