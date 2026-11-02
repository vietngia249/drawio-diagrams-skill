import { htmlText, vertex, edge } from './common.mjs';

const text = (v) => String(v ?? '').trim();
const key = (v) => encodeURIComponent(String(v));

export function renderActivity(d, styles = {}) {
  const nodes = d.nodes || [], transitions = d.transitions || [];
  if (!nodes.length) throw Error('activity requires nodes[]');
  const ids = new Set();
  for (const [i, n] of nodes.entries()) {
    if (!text(n.id) || !['initial', 'action', 'decision', 'merge', 'final', 'activityFinal', 'flowFinal'].includes(n.kind)) throw Error(`nodes[${i}] requires an id and supported kind (initial, action, decision, merge, final, flowFinal)`);
    if (ids.has(n.id)) throw Error(`duplicate activity node id: ${n.id}`);
    ids.add(n.id);
    if (n.kind === 'action' && !text(n.label)) throw Error(`nodes[${i}].label is required for action`);
  }
  const transitionIds = new Set();
  for (const [i, t] of transitions.entries()) {
    if (!ids.has(t.from) || !ids.has(t.to)) throw Error(`transitions[${i}] has unresolved from/to endpoint`);
    const semanticId = t.id || `${t.from}_${t.to}_${text(t.guard || t.label)}`;
    if (transitionIds.has(semanticId)) throw Error(`duplicate transition id: ${semanticId}`);
    transitionIds.add(semanticId);
  }
  const st = styles.activity || {}, ast = st.action || {}, nst = st.node || {}, est = st.edge || {};
  const positions = new Map();
  nodes.forEach((n, i) => {
    const x = Number.isFinite(n.x) ? n.x : 250 + (i % 3) * 250;
    const y = Number.isFinite(n.y) ? n.y : 60 + Math.floor(i / 3) * 135;
    const kind = n.kind;
    const w = kind === 'action' ? Math.max(150, Math.min(250, Math.max(...text(n.label).split('\n').map(s => s.length), 12) * 8 + 32)) : kind === 'decision' || kind === 'merge' ? 72 : kind === 'initial' || kind === 'final' || kind === 'activityFinal' || kind === 'flowFinal' ? 34 : 72;
    const h = kind === 'action' ? Math.max(58, text(n.label).split('\n').length * 22 + 20) : kind === 'decision' || kind === 'merge' ? 72 : kind === 'initial' || kind === 'final' || kind === 'activityFinal' || kind === 'flowFinal' ? 34 : 72;
    positions.set(n.id, { x, y, w, h });
  });
  const out = [];
  nodes.forEach(n => {
    const p = positions.get(n.id), kind = n.kind;
    let style, label = text(n.label);
    if (kind === 'action') style = `rounded=1;arcSize=20;whiteSpace=wrap;html=1;fillColor=${ast.fillColor || '#ffffff'};strokeColor=${ast.strokeColor || '#000000'};strokeWidth=${ast.strokeWidth || 1};fontSize=${st.fontSize || 14};`;
    else if (kind === 'decision' || kind === 'merge') style = `rhombus;whiteSpace=wrap;html=1;fillColor=${nst.fillColor || '#ffffff'};strokeColor=${nst.strokeColor || '#000000'};strokeWidth=${nst.strokeWidth || 1};fontSize=${st.fontSize || 12};`;
    else if (kind === 'initial') style = `ellipse;html=1;fillColor=#000000;strokeColor=#000000;`;
    else if (kind === 'flowFinal') { style = `ellipse;html=1;fillColor=#ffffff;strokeColor=#000000;strokeWidth=1.5;`; label = '×'; }
    else if (kind === 'final' || kind === 'activityFinal') { style = `ellipse;html=1;fillColor=#ffffff;strokeColor=#000000;strokeWidth=2;`; }
    else style = `ellipse;html=1;fillColor=#ffffff;strokeColor=#000000;`;
    out.push(vertex(`activity_${key(n.id)}`, htmlText(label), style, p.x, p.y, p.w, p.h));
    if (kind === 'final' || kind === 'activityFinal') out.push(vertex(`activity_${key(n.id)}_inner`, '', `ellipse;html=1;fillColor=#000000;strokeColor=#000000;`, 9, 9, p.w - 18, p.h - 18, `activity_${key(n.id)}`));
  });
  transitions.forEach(t => out.push(edge(`transition_${key(t.id || `${t.from}_${t.to}_${text(t.guard || t.label)}`)}`, `activity_${key(t.from)}`, `activity_${key(t.to)}`, htmlText(text(t.guard || t.label)), `html=1;strokeColor=${est.strokeColor || '#000000'};strokeWidth=${est.strokeWidth || 1};endArrow=block;`)));
  return out;
}
