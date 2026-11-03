import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {renderDfd} from '../scripts/dfd.mjs';

const style=JSON.parse(readFileSync(new URL('../scripts/style.json',import.meta.url),'utf8'));
const model=JSON.parse(readFileSync(new URL('./fixtures/dfd-fittrackai-logical-level1.json',import.meta.url),'utf8'));
const render=(data=model)=>renderDfd(data,style).join('\n');
const cells=xml=>[...xml.matchAll(/<mxCell\b[\s\S]*?<\/mxCell>/g)].map(match=>match[0]);
const attr=(cell,name)=>cell.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1]??'';
const value=cell=>attr(cell,'value').replaceAll('&lt;','<').replaceAll('&gt;','>').replaceAll('&amp;','&').replaceAll('&quot;','"');
const waypoints=cell=>[...cell.matchAll(/<mxPoint\b[^>]*\bx="([^"]+)"[^>]*\by="([^"]+)"/g)].map(m=>[Number(m[1]),Number(m[2])]);
const rectOf=cell=>{const g=cell.match(/<mxGeometry\b([^>]*)\/>/);if(!g)return null;const a={};for(const [,k,v] of g[1].matchAll(/(x|y|width|height)="([^"]+)"/g))a[k]=Number(v);return a};

test('example declares a logical Level 1 DFD and names the perspective',()=>{
  const example=JSON.parse(readFileSync(new URL('../examples/dfd.json',import.meta.url),'utf8'));
  assert.equal(example.level,1);
  assert.equal(example.perspective,'logical');
  assert.match(example.title,/Logical Level 1/);
});

test('flow labels describe business data and omit transport protocol details',()=>{
  for(const flow of model.flows){
    assert.ok(flow.label.trim().length>0,`flow ${flow.id} needs a data name`);
    assert.doesNotMatch(flow.label,/\b(?:GET|POST|PUT|PATCH|DELETE|HTTP|HTTPS|\d{3})\b|Bearer\s+token/i,flow.id);
  }
  assert.ok(model.flows.some(f=>/lựa chọn bài tập|tiến trình buổi tập/i.test(f.label)));
  assert.ok(model.flows.some(f=>/kết quả buổi tập/i.test(f.label)));
});

test('each Level 1 process has source-evidenced meaningful inputs and outputs',()=>{
  const ids=new Set(model.nodes.filter(n=>n.kind==='process').map(n=>n.id));
  for(const id of ids){
    assert.ok(model.flows.some(f=>f.to===id&&f.label.trim()),`${id} needs a named input`);
    assert.ok(model.flows.some(f=>f.from===id&&f.label.trim()),`${id} needs a named output`);
  }
  assert.deepEqual(model.nodes.filter(n=>n.kind==='dataStore').map(n=>n.id),['plans','sessions']);
  assert.ok(!model.nodes.some(n=>/localStorage|postgres|api|database|http/i.test(n.label)), 'logical perspective does not depict implementation endpoints');
});

test('selected Yourdon/Coad convention keeps all flows directed and process-mediated',()=>{
  for(const flow of model.flows){
    const from=model.nodes.find(n=>n.id===flow.from),to=model.nodes.find(n=>n.id===flow.to);
    assert.ok(from&&to,`${flow.id} resolves`);
    assert.ok(from.kind==='process'||to.kind==='process',`${flow.id} touches a process`);
    assert.notEqual(flow.from,flow.to);
  }
  const out=cells(render());
  assert.equal(out.filter(c=>attr(c,'edge')==='1').length,model.flows.length);
  assert.ok(out.filter(c=>attr(c,'edge')==='1').every(c=>/endArrow=block/.test(attr(c,'style'))&&/startArrow=none/.test(attr(c,'style'))));
});

test('reverse and parallel edges have distinct ports and do not share route segments',()=>{
  const data={type:'dfd',nodes:[{id:'a',kind:'externalEntity',label:'Athlete'},{id:'p',kind:'process',label:'1. Record session'}],flows:[
    {id:'in-a',from:'a',to:'p',label:'Workout selection'},{id:'in-b',from:'a',to:'p',label:'Set details'},
    {id:'out-a',from:'p',to:'a',label:'Session summary'},{id:'out-b',from:'p',to:'a',label:'Completion result'}
  ]};
  const edges=cells(render(data)).filter(c=>attr(c,'edge')==='1');
  assert.equal(edges.length,4);
  const ports=edges.map(c=>[...attr(c,'style').matchAll(/(?:exit|entry)([XY])=([\d.]+)/g)].map(m=>m[0]).join(';'));
  assert.equal(new Set(ports).size,4,'each flow gets distinct source and target ports');
  const routes=edges.map(waypoints);
  assert.ok(routes.every(r=>r.length>=2),'each edge has explicit route bends');
  const segments=routes.flatMap((route,i)=>route.slice(1).map((p,j)=>({i,a:route[j],b:p})));
  for(let i=0;i<segments.length;i++)for(let j=i+1;j<segments.length;j++)if(segments[i].i!==segments[j].i){
    const a=segments[i],b=segments[j];
    assert.notDeepEqual([a.a,a.b],[b.a,b.b],'distinct edges must not share a route segment');
  }
});

test('routes and labels avoid unrelated nodes, labels, and routes',()=>{
  const out=render(),all=cells(out),vertices=all.filter(c=>attr(c,'vertex')==='1'),edges=all.filter(c=>attr(c,'edge')==='1');
  const labels=vertices.filter(c=>attr(c,'id').startsWith('dfd_flow_label_'));
  assert.equal(labels.length,model.flows.length);
  assert.ok(edges.every(e=>waypoints(e).length>=2),'routes are explicit and inspectable');
  for(const label of labels)assert.ok(rectOf(label),'flow label has measurable geometry');
  for(const edge of edges)assert.ok(/exitX=|entryX=/.test(attr(edge,'style')),'edge declares explicit ports');
});

test('Level 1 layout stays compact and sizes nodes and labels for readable text',()=>{
  const all=cells(render()),vertices=all.filter(c=>attr(c,'vertex')==='1');
  const nodeCells=vertices.filter(c=>attr(c,'id').startsWith('dfd_node_'));
  const bounds=nodeCells.map(rectOf);
  assert.ok(bounds.every(b=>b&&b.width>=150&&b.height>=60));
  const width=Math.max(...bounds.map(b=>b.x+b.width))-Math.min(...bounds.map(b=>b.x));
  const height=Math.max(...bounds.map(b=>b.y+b.height))-Math.min(...bounds.map(b=>b.y));
  assert.ok(width<=1800,`logical overview width ${width} should remain compact`);
  assert.ok(height<=900,`logical overview height ${height} should remain compact`);
  assert.ok(vertices.filter(c=>attr(c,'id').startsWith('dfd_flow_label_')).every(c=>value(c).trim().length>0&&rectOf(c)?.height>=24));
});

test('DFD uses only native Desktop evidenced shape names',()=>{
  const styles=cells(render()).filter(c=>attr(c,'vertex')==='1').map(c=>attr(c,'style'));
  const shapes=styles.flatMap(s=>[...s.matchAll(/(?:^|;)shape=([^;]+)/g)].map(m=>m[1]));
  assert.ok(shapes.length>0);
  // The original FitTrackAI Desktop-exported DFD uses shape=default for its
  // external entity; rect and ellipse are also present in Desktop examples.
  assert.ok(shapes.every(s=>['default','rect','ellipse'].includes(s)),`unexpected native shape name: ${shapes.join(', ')}`);
});
