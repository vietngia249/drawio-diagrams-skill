import { ensureOptions, parseCli, reportError } from './common.mjs';
import { cellsFromModel, readDrawio } from './drawio_xml.mjs';

const usage = 'Usage: node scripts/compare_drawio.mjs generated.drawio reference.drawio [--generated-page selector] [--reference-page selector] [--blind]\n--blind omits label text from the report; input files are still read locally and this option is not a privacy guarantee.';
function summarize(file, selection) {
  const { page, pageCount, graph } = readDrawio(file, selection), cells = cellsFromModel(graph), vertices = cells.filter(c => c.vertex), edges = cells.filter(c => c.edge);
  const styles = { fontFamily: {}, fontSize: {}, fillColor: {}, strokeColor: {}, shape: {} }, bump = (map, val) => { if (val) map[val] = (map[val] ?? 0) + 1; };
  for (const c of cells) { const style = c.attrs.style ?? ''; for (const key of Object.keys(styles)) bump(styles[key], style.match(new RegExp(`(?:^|;)${key}=([^;]+)`))?.[1]); }
  const participants = vertices.filter(v => /shape=umlLifeline/.test(v.attrs.style ?? '')).map(v => ({ id: v.attrs.id, value: v.attrs.value ?? '', x: Number(v.geometry.x ?? 0) + Number(v.geometry.width ?? 0) / 2 }));
  const parentOf = new Map(vertices.map(v => [v.attrs.id, v]));
  const nearest = id => { let cur = id; for (let n = 0; cur && n < 20; n++) { if (participants.some(p => p.id === cur)) return cur; cur = parentOf.get(cur)?.attrs.parent; } const v = parentOf.get(id); if (!v || !participants.length) return id; return participants.reduce((best, p) => Math.abs(p.x - Number(v.geometry.x ?? 0) - Number(v.geometry.width ?? 0) / 2) < Math.abs(best.x - Number(v.geometry.x ?? 0) - Number(v.geometry.width ?? 0) / 2) ? p : best, participants[0]).id; };
  const index = new Map(participants.map((p, i) => [p.id, i])), pairs = edges.map(e => [index.get(nearest(e.attrs.source)) ?? -1, index.get(nearest(e.attrs.target)) ?? -1]);
  const fragments = {};
  for (const v of vertices) { const kind = (v.attrs.value ?? '').trim().toLowerCase(); if (/^(alt|opt|loop|par)$/.test(kind) && /shape=umlFrame/.test(v.attrs.style ?? '')) fragments[kind] = (fragments[kind] ?? 0) + 1; }
  return { file, page: { id: page.id, name: page.name }, pageCount, cells, vertices, edges, participants, pairs, fragments, styles, labels: new Set(cells.map(c => c.attrs.value).filter(Boolean)) };
}
const major = o => Object.entries(o).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
const similarity = (actual, expected) => 1 - Math.abs(actual - expected) / Math.max(1, expected);
function lcs(a, b) { let prev = Array(b.length + 1).fill(0); for (const x of a) { const row = [0]; for (let j = 0; j < b.length; j++) row.push(x[0] === b[j][0] && x[1] === b[j][1] ? prev[j] + 1 : Math.max(prev[j + 1], row[j])); prev = row; } return prev.at(-1); }
try {
  const { positional, options, help } = parseCli(process.argv.slice(2), usage); if (help) { console.log(usage); process.exit(0); }
  ensureOptions(options, ['generated-page', 'reference-page', 'blind']);
  if (positional.length !== 2) throw new Error(usage);
  const a = summarize(positional[0], options['generated-page']), b = summarize(positional[1], options['reference-page']);
  const style = Object.fromEntries(Object.keys(a.styles).map(k => [k, major(a.styles[k]) === major(b.styles[k]) ? 1 : 0]));
  const result = options.blind ? {
    mode: 'blind', generatedPage: a.page, referencePage: b.page,
    generatedCounts: { participants: a.participants.length, messages: a.edges.length, fragments: a.fragments },
    referenceCounts: { participants: b.participants.length, messages: b.edges.length, fragments: b.fragments },
    scores: { participants: a.participants.length === b.participants.length ? 1 : 0, messages: similarity(a.edges.length, b.edges.length), fragments: Object.fromEntries([...new Set([...Object.keys(a.fragments), ...Object.keys(b.fragments)])].map(k => [k, (a.fragments[k] ?? 0) === (b.fragments[k] ?? 0) ? 1 : 0])), orderedPairLcs: lcs(a.pairs, b.pairs) / Math.max(1, b.pairs.length), style },
    caveat: '--blind omits labels from this report only. Both input files are read locally, and no privacy or anonymization guarantee is provided.'
  } : {
    mode: 'roundtrip', generated: a.file, reference: b.file, generatedPage: a.page, referencePage: b.page,
    generatedCounts: { cells: a.cells.length, shapes: a.vertices.length, edges: a.edges.length, labels: a.labels.size },
    referenceCounts: { cells: b.cells.length, shapes: b.vertices.length, edges: b.edges.length, labels: b.labels.size },
    scores: { shapes: similarity(a.vertices.length, b.vertices.length), edges: similarity(a.edges.length, b.edges.length), labels: [...a.labels].filter(v => b.labels.has(v)).length / Math.max(1, b.labels.size), style }
  };
  console.log(JSON.stringify(result, null, 2));
} catch (error) { reportError(error); process.exitCode = 2; }
