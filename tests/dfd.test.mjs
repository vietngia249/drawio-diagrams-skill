import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {renderDfd} from '../scripts/dfd.mjs';
import {serializeCells} from '../scripts/common.mjs';

const style=JSON.parse(readFileSync(new URL('../scripts/style.json',import.meta.url),'utf8'));
const model=JSON.parse(readFileSync(new URL('./fixtures/dfd-fittrackai-logical-level1.json',import.meta.url),'utf8'));
const physical=JSON.parse(readFileSync(new URL('./fixtures/dfd-fittrackai-physical-level1.json',import.meta.url),'utf8'));
const stress=JSON.parse(readFileSync(new URL('./fixtures/dfd-parallel-reverse.json',import.meta.url),'utf8'));
const acceptance=JSON.parse(readFileSync(new URL('./fixtures/acceptance/dfd.json',import.meta.url),'utf8'));
const render=(data=model)=>serializeCells(renderDfd(data,style).cells).join('\n');
const cells=xml=>[...xml.matchAll(/<mxCell\b[\s\S]*?<\/mxCell>/g)].map(match=>match[0]);
const attr=(cell,name)=>cell.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1]??'';
const value=cell=>attr(cell,'value').replaceAll('&lt;','<').replaceAll('&gt;','>').replaceAll('&amp;','&').replaceAll('&quot;','"');
const waypoints=cell=>[...cell.matchAll(/<mxPoint\b[^>]*\bx="([^"]+)"[^>]*\by="([^"]+)"/g)].map(m=>[Number(m[1]),Number(m[2])]);
const rectOf=cell=>{const g=cell.match(/<mxGeometry\b([^>]*)\/>/);if(!g)return null;const a={};for(const [,k,v] of g[1].matchAll(/(x|y|width|height)="([^"]+)"/g))a[k]=Number(v);return a};
const styleNum=(cell,key)=>Number(attr(cell,'style').match(new RegExp(`(?:^|;)${key}=([\\d.]+)`))?.[1]);
const portPoint=(cell,node,which)=>{const b=rectOf(node),x=styleNum(cell,`${which}X`),y=styleNum(cell,`${which}Y`);return [b.x+b.width*x,b.y+b.height*y]};
const crossesRect=(a,b,r)=>a[0]===b[0]?a[0]>r.x&&a[0]<r.x+r.width&&Math.max(Math.min(a[1],b[1]),r.y)<Math.min(Math.max(a[1],b[1]),r.y+r.height):a[1]===b[1]&&a[1]>r.y&&a[1]<r.y+r.height&&Math.max(Math.min(a[0],b[0]),r.x)<Math.min(Math.max(a[0],b[0]),r.x+r.width);
const sharesTrack=(a,b,c,d)=>a[0]===b[0]&&c[0]===d[0]&&a[0]===c[0]?Math.max(Math.min(a[1],b[1]),Math.min(c[1],d[1]))<Math.min(Math.max(a[1],b[1]),Math.max(c[1],d[1])):a[1]===b[1]&&c[1]===d[1]&&a[1]===c[1]&&Math.max(Math.min(a[0],b[0]),Math.min(c[0],d[0]))<Math.min(Math.max(a[0],b[0]),Math.max(c[0],d[0]));

test('example declares a logical Level 1 DFD and names the perspective',()=>{
  const example=JSON.parse(readFileSync(new URL('../examples/dfd.json',import.meta.url),'utf8'));
  assert.equal(example.level,1);
  assert.equal(example.perspective,'logical');
  assert.match(example.title,/Logical Level 1/);
});

test('clean Vietnamese acceptance labels survive DFD XML serialization',()=>{
  const rendered=renderDfd(acceptance,style),xml=serializeCells(rendered.cells).join('\n');
  assert.deepEqual(rendered.diagnostics,[],'clean UTF-8 acceptance example fits its explicit page');
  assert.equal(acceptance.title,'Synthetic UTF-8 DFD: Tra cứu & phản hồi <demo>');
  assert.ok(acceptance.nodes.some(node=>node.label==='D1 Hồ sơ khách hàng <đã lưu>'));
  assert.ok(acceptance.flows.some(flow=>flow.label==='Kết quả <hợp lệ> & ghi chú'));
  assert.ok(xml.includes('Tra cứu'));
  assert.ok(xml.includes('Hồ sơ khách hàng'));
  assert.ok(xml.includes('hợp lệ'));
  assert.doesNotMatch(xml,/(?:Ã.|á»|Â.)/);
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

test('physical perspective keeps client active-session state separate from PostgreSQL records',()=>{
  assert.equal(physical.level,1);
  assert.equal(physical.perspective,'physical');
  const stores=physical.nodes.filter(n=>n.kind==='dataStore');
  assert.deepEqual(stores.map(n=>n.id),['local','postgres']);
  assert.match(stores[0].label,/client active-session state/i);
  assert.match(stores[1].label,/postgresql workout records/i);
  assert.ok(physical.flows.some(f=>f.from==='client'&&f.to==='local'));
  assert.ok(physical.flows.some(f=>f.from==='local'&&f.to==='client'));
  assert.ok(physical.flows.some(f=>f.from==='postgres'&&f.to==='completion'));
  assert.ok(physical.flows.some(f=>f.from==='completion'&&f.to==='postgres'));
  for(const flow of physical.flows)assert.doesNotMatch(flow.label,/\b(?:GET|POST|PUT|PATCH|DELETE|HTTP|HTTPS|\d{3})\b|Bearer\s+token/i,flow.id);
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
  const edges=cells(render(stress)).filter(c=>attr(c,'edge')==='1');
  assert.equal(edges.length,stress.flows.length);
  const ports=edges.map(c=>[...attr(c,'style').matchAll(/(?:exit|entry)([XY])=([\d.]+)/g)].map(m=>m[0]).join(';'));
  assert.equal(new Set(ports).size,4,'each flow gets distinct source and target ports');
  const nodes=cells(render(stress)).filter(c=>attr(c,'vertex')==='1'&&attr(c,'id').startsWith('dfd_node_'));
  const routes=edges.map(edge=>{
    const source=nodes.find(node=>attr(node,'id')===attr(edge,'source')),target=nodes.find(node=>attr(node,'id')===attr(edge,'target'));
    const points=[portPoint(edge,source,'exit'),...waypoints(edge),portPoint(edge,target,'entry')];
    assert.ok(points.length>=4,'each edge has distinct port escapes and explicit bends');
    return points.slice(1).map((point,i)=>[points[i],point]);
  });
  for(let i=0;i<routes.length;i++)for(let j=i+1;j<routes.length;j++)for(const [a,b] of routes[i])for(const [c,d] of routes[j])assert.equal(sharesTrack(a,b,c,d),false,'distinct edges must not share a positive-length route segment');
});

test('routes and labels avoid unrelated nodes, labels, and routes',()=>{
  const out=render(),all=cells(out),vertices=all.filter(c=>attr(c,'vertex')==='1'),edges=all.filter(c=>attr(c,'edge')==='1');
  const labels=vertices.filter(c=>attr(c,'id').startsWith('dfd_flow_label_'));
  const nodes=vertices.filter(c=>attr(c,'id').startsWith('dfd_node_'));
  assert.equal(labels.length,model.flows.length);
  assert.ok(edges.every(e=>waypoints(e).length>=2),'routes are explicit and inspectable');
  for(const label of labels)assert.ok(rectOf(label),'flow label has measurable geometry');
  for(const edge of edges){
    assert.ok(/exitX=|entryX=/.test(attr(edge,'style')),'edge declares explicit ports');
    const source=nodes.find(node=>attr(node,'id')===attr(edge,'source')),target=nodes.find(node=>attr(node,'id')===attr(edge,'target'));
    const route=[portPoint(edge,source,'exit'),...waypoints(edge),portPoint(edge,target,'entry')];
    for(let i=1;i<route.length;i++)assert.ok(route[i][0]===route[i-1][0]||route[i][1]===route[i-1][1],'route segment is orthogonal');
    for(const node of nodes)if(![attr(edge,'source'),attr(edge,'target')].includes(attr(node,'id'))){
      for(let i=1;i<route.length;i++)assert.equal(crossesRect(route[i-1],route[i],rectOf(node)),false,`route crosses unrelated node ${attr(node,'id')}`);
    }
    const ownLabel=labels.find(label=>attr(label,'id')===attr(edge,'id').replace(/^dfd_flow_/,'dfd_flow_label_'));
    for(const label of labels)if(label!==ownLabel){
      const box=rectOf(label);
      for(let i=1;i<route.length;i++)assert.equal(crossesRect(route[i-1],route[i],box),false,`route crosses unrelated label ${attr(label,'id')}`);
    }
  }
  for(let i=0;i<labels.length;i++)for(let j=i+1;j<labels.length;j++){
    const a=rectOf(labels[i]),b=rectOf(labels[j]);
    assert.ok(a.x+a.width<=b.x||b.x+b.width<=a.x||a.y+a.height<=b.y||b.y+b.height<=a.y,'flow labels overlap');
  }
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

test('default DFD node and flow text uses a readable 12 point minimum',()=>{
  const xml=render(model);
  assert.match(xml,/fontSize=12(?:;|&quot;)/,'renderer should lift the 9.5 point repository default to 12');
  const fontSizes=[...xml.matchAll(/fontSize=([\d.]+)/g)].map(match=>Number(match[1]));
  assert.ok(fontSizes.length>0);
  assert.ok(fontSizes.every(size=>size>=12),`found undersized DFD text: ${fontSizes.join(', ')}`);
  assert.match(xml,/strokeColor=#000000/);
  assert.match(xml,/fillColor=#ffffff/);
});

test('shared presentation tokens style DFD roles while preserving native notation',()=>{
  const tokenized=structuredClone(style);
  Object.assign(tokenized.presentation,{
    fontFamily:'Verdana',
    fontSizes:{...tokenized.presentation.fontSizes,body:18,label:16},
    colors:{...tokenized.presentation.colors,stroke:'#123456',fill:'#eeeeee'},
    strokeWidth:2,
    label:{...tokenized.presentation.label,background:'#fff2cc'}
  });
  const simple={nodes:[{id:'source',kind:'externalEntity',label:'Source'},{id:'work',kind:'process',label:'Work'},{id:'store',kind:'dataStore',label:'Records'}],flows:[{id:'input',from:'source',to:'work',label:'Source data'},{id:'save',from:'work',to:'store',label:'Saved records'}]};
  const output=renderDfd(simple,tokenized),process=output.cells.find(cell=>cell.id==='dfd_node_776f726b');
  const storeTop=output.cells.find(cell=>cell.id==='dfd_store_top_73746f7265');
  const storeLabel=output.cells.find(cell=>cell.id==='dfd_store_label_73746f7265');
  const flow=output.cells.find(cell=>cell.kind==='edge');
  const flowLabel=output.cells.find(cell=>cell.id.startsWith('dfd_flow_label_'));
  assert.match(process.style,/shape=ellipse/);
  assert.match(process.style,/fontFamily=Verdana/);
  assert.match(process.style,/fontSize=18/);
  assert.match(process.style,/fontColor=#123456/);
  assert.match(process.style,/strokeColor=#123456/);
  assert.match(process.style,/fillColor=#eeeeee/);
  assert.match(process.style,/strokeWidth=2/);
  assert.match(storeTop.style,/shape=rect/);
  assert.match(storeTop.style,/fillColor=#123456/);
  assert.match(storeTop.style,/strokeWidth=2/);
  assert.match(storeLabel.style,/fontSize=18/);
  assert.match(storeLabel.style,/fillColor=#fff2cc/);
  assert.match(storeLabel.style,/fontColor=#123456/);
  assert.match(flow.style,/fontFamily=Verdana/);
  assert.match(flow.style,/fontSize=16/);
  assert.match(flow.style,/strokeColor=#123456/);
  assert.match(flow.style,/strokeWidth=2/);
  assert.match(flow.style,/endArrow=block/);
  assert.match(flow.style,/startArrow=none/);
  assert.match(flowLabel.style,/fontSize=16/);
  assert.match(flowLabel.style,/fillColor=#fff2cc/);
  assert.match(flowLabel.style,/fontColor=#123456/);
  assert.equal(output.cells.filter(cell=>cell.id.startsWith('dfd_store_')&&cell.id.includes('store')).length,3);
});

test('shared route-clearance tokens preserve DFD style overrides and notation',()=>{
  const roomy=structuredClone(style);
  roomy.presentation.spacing.routeClearance=40;
  roomy.presentation.fontFamily='Verdana';
  roomy.presentation.fontSizes={...roomy.presentation.fontSizes,body:18,label:16};
  roomy.presentation.colors={...roomy.presentation.colors,stroke:'#abcdef',fill:'#dddddd'};
  roomy.presentation.strokeWidth=2;
  roomy.dfd.fontFamily='Georgia';
  roomy.dfd.fontSize=13;
  roomy.dfd.process.fillColor='#eeeeee';
  roomy.dfd.process.strokeColor='#123456';
  roomy.dfd.process.strokeWidth=3;
  roomy.dfd.dataStore.fillColor='#f0f0f0';
  roomy.dfd.dataStore.strokeColor='#222222';
  roomy.dfd.dataStore.strokeWidth=5;
  roomy.dfd.dataFlow.strokeColor='#654321';
  roomy.dfd.dataFlow.strokeWidth=4;
  roomy.dfd.dataFlow.arrow='open';
  const simple={nodes:[{id:'source',kind:'externalEntity',label:'Source'},{id:'work',kind:'process',label:'Work'},{id:'store',kind:'dataStore',label:'Records'}],flows:[{id:'input',from:'source',to:'work'},{id:'save',from:'work',to:'store'}]};
  const baseline=renderDfd(simple,style),adjusted=renderDfd(simple,roomy);
  const baselineProcess=baseline.cells.find(cell=>cell.kind==='vertex'&&cell.style.includes('shape=ellipse'));
  const process=adjusted.cells.find(cell=>cell.kind==='vertex'&&cell.style.includes('shape=ellipse'));
  assert.notEqual(process.geometry.x,baselineProcess.geometry.x,'larger shared route clearance should widen the inter-column gap');
  assert.match(process.style,/shape=ellipse/);
  assert.match(process.style,/fontFamily=Georgia/);
  assert.match(process.style,/fontSize=13/);
  assert.match(process.style,/fillColor=#eeeeee/);
  assert.match(process.style,/strokeColor=#123456/);
  assert.match(process.style,/strokeWidth=3/);
  const storeTop=adjusted.cells.find(cell=>cell.id==='dfd_store_top_73746f7265');
  const storeLabel=adjusted.cells.find(cell=>cell.id==='dfd_store_label_73746f7265');
  assert.match(storeTop.style,/fillColor=#222222/);
  assert.match(storeTop.style,/strokeWidth=5/);
  assert.match(storeLabel.style,/fillColor=#f0f0f0/);
  const flows=adjusted.cells.filter(cell=>cell.kind==='edge');
  assert.ok(flows.length>0);
  assert.ok(flows.every(cell=>cell.style.includes('fontFamily=Georgia;')&&cell.style.includes('fontSize=13;')&&cell.style.includes('strokeColor=#654321;')&&cell.style.includes('strokeWidth=4;')&&cell.style.includes('endArrow=open;')&&cell.style.includes('startArrow=none;')));
});
