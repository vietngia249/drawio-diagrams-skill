import {vertex,edge,htmlText} from './common.mjs';

const kinds=new Set(['process','dataStore','externalEntity']);
const clean=v=>String(v??'').trim();
const labelOf=n=>n.label??n.name??'';
const flowLabel=f=>f.label??f.text??'';
const stableId=(prefix,value)=>`${prefix}_${Buffer.from(String(value),'utf8').toString('hex')||'empty'}`;
function approxWidth(value,fontSize){
  const lines=String(value??'').replace(/\r\n?/g,'\n').split('\n');
  return Math.ceil(Math.max(1,...lines.map(line=>[...line].reduce((n,ch)=>n+(ch.charCodeAt(0)>0x2ff?1:.56),0)))*fontSize*1.12);
}
function resolveNode(nodes,ref,flowIndex,side){
  const matches=nodes.filter(n=>n.id===ref||n.name===ref||labelOf(n)===ref);
  if(!matches.length)throw Error(`DFD flow ${flowIndex} ${side} endpoint ${JSON.stringify(ref)} does not resolve to a declared node`);
  if(matches.length>1)throw Error(`DFD flow ${flowIndex} ${side} endpoint ${JSON.stringify(ref)} is ambiguous; use a node ID`);
  return matches[0];
}

/** Render a directed DFD using Yourdon/DeMarco process-mediated flow semantics.
 * A data store is composed from two editable horizontal strokes and an editable label.
 */
export function renderDfd(d,s){
  const input=d.nodes??d.processes??[],flows=d.flows??d.edges??[];
  if(!Array.isArray(input)||!Array.isArray(flows))throw Error('DFD nodes and flows must be arrays');
  const ids=new Set();
  const nodes=input.map((node,index)=>{
    if(!node||typeof node!=='object')throw Error(`DFD node ${index} must be an object`);
    const id=clean(node.id),kind=node.kind||'process',label=clean(labelOf(node));
    if(!id)throw Error(`DFD node ${index} requires a nonempty id`);
    if(ids.has(id))throw Error(`DFD node IDs must be unique: ${JSON.stringify(id)}`);
    ids.add(id);
    if(!kinds.has(kind))throw Error(`DFD node ${JSON.stringify(id)} has unsupported kind ${JSON.stringify(kind)}`);
    if(!label)throw Error(`DFD node ${JSON.stringify(id)} requires a nonempty label`);
    const style=s?.dfd?.[kind];
    if(!style||!style.shape||!style.fillColor||!style.strokeColor||!Number.isFinite(Number(style.strokeWidth)))throw Error(`DFD style for ${kind} requires shape, fillColor, strokeColor, and numeric strokeWidth`);
    return {...node,id,kind,label,_cell:stableId('dfd_node',id),_style:style};
  });
  if(!nodes.length)throw Error('DFD requires at least one node');
  const normalized=flows.map((flow,index)=>{
    if(!flow||typeof flow!=='object')throw Error(`DFD flow ${index} must be an object`);
    const src=resolveNode(nodes,flow.from,index,'source'),dst=resolveNode(nodes,flow.to,index,'target');
    if(src.id===dst.id)throw Error(`DFD flow ${index} cannot connect a node to itself`);
    if(src.kind!=='process'&&dst.kind!=='process')throw Error(`DFD flow ${index} violates Yourdon/DeMarco rules: every flow must connect to a process`);
    const label=String(flowLabel(flow)??'');
    return {flow,index,src,dst,label};
  });
  const flowIds=new Set();
  for(const {flow,index} of normalized)if(flow.id!==undefined){const id=clean(flow.id);if(!id)throw Error(`DFD flow ${index} id must not be empty`);if(flowIds.has(id))throw Error(`DFD flow IDs must be unique: ${JSON.stringify(id)}`);flowIds.add(id)}

  const columns=['externalEntity','process','dataStore'];
  const fontSize=Number(s.dfd.fontSize)||10;
  const gap=Math.max(230,...normalized.map(({label})=>Math.min(approxWidth(label,fontSize)+80,700)));
  const widths=columns.map(kind=>Math.max(220,...nodes.filter(n=>n.kind===kind).map(n=>Math.min(Math.max(approxWidth(n.label,fontSize)+44,160),420))));
  const xStarts=[40,40+widths[0]+gap,40+widths[0]+gap+widths[1]+gap];
  const rows=Object.fromEntries(columns.map(k=>[k,0]));
  for(const node of nodes){
    const column=columns.indexOf(node.kind),labelWidth=Math.min(Math.max(approxWidth(node.label,fontSize)+36,160),420);
    node.width=labelWidth;node.height=node.kind==='process'?100:86;
    node.x=xStarts[column]+(widths[column]-node.width)/2;
    node.y=160+rows[node.kind]++*260;
  }
  const cells=[];
  for(const node of nodes){
    const st=node._style;
    if(node.kind==='dataStore'){
      // Keep an invisible rectangular endpoint for flows. The visible glyph is
      // the Yourdon/Coad pair of horizontal store lines, not the configured box.
      cells.push(vertex(node._cell,'',`shape=rect;fillColor=none;strokeColor=none;opacity=0;`,node.x,node.y,node.width,node.height));
      const lineStyle=`shape=rect;html=1;fillColor=${st.strokeColor};strokeColor=${st.strokeColor};strokeWidth=${st.strokeWidth};`;
      const lineX=node.x+6,lineWidth=node.width-12,topY=node.y+23,bottomY=node.y+63;
      cells.push(vertex(stableId('dfd_store_top',node.id),'',lineStyle,lineX,topY,lineWidth,2));
      cells.push(vertex(stableId('dfd_store_bottom',node.id),'',lineStyle,lineX,bottomY,lineWidth,2));
      const labelStyle=`text;html=1;whiteSpace=wrap;align=center;verticalAlign=middle;fontFamily=${s.dfd.fontFamily||'Arial'};fontSize=${fontSize};fillColor=${st.fillColor};strokeColor=none;`;
      cells.push(vertex(stableId('dfd_store_label',node.id),htmlText(node.label),labelStyle,node.x+8,node.y+29,node.width-16,28));
    }else{
      const style=`shape=${st.shape};whiteSpace=wrap;html=1;fontFamily=${s.dfd.fontFamily||'Arial'};fontSize=${fontSize};fillColor=${st.fillColor};strokeColor=${st.strokeColor};strokeWidth=${st.strokeWidth};rounded=${st.rounded??0};`;
      cells.push(vertex(node._cell,htmlText(node.label),style,node.x,node.y,node.width,node.height));
    }
  }

  // Keep each pair's reverse and parallel flows on distinct ports and tracks.
  const pairTotals=new Map(),pairUse=new Map();
  for(const {src,dst} of normalized){const pair=[src.id,dst.id].sort().join('\0');pairTotals.set(pair,(pairTotals.get(pair)||0)+1)}
  for(const {flow,index,src,dst,label} of normalized){
    const pair=[src.id,dst.id].sort().join('\0'),ordinal=pairUse.get(pair)||0;pairUse.set(pair,ordinal+1);
    const total=pairTotals.get(pair),slot=total===1?.5:.08+ordinal*.84/(total-1),labelSide=slot<.5?-1:slot>.5?1:(src.id.localeCompare(dst.id)<0?-1:1);
    const horizontal=Math.abs((dst.x+dst.width/2)-(src.x+src.width/2))>=Math.abs((dst.y+dst.height/2)-(src.y+src.height/2));
    let anchors,points,labelX,labelY;
    if(horizontal){
      const sourceOnLeft=src.x+src.width/2<dst.x+dst.width/2;
      const srcY=slot,dstY=slot;
      const midX=sourceOnLeft?(src.x+src.width+dst.x)/2:(dst.x+dst.width+src.x)/2;
      anchors=`exitX=${sourceOnLeft?1:0};exitY=${srcY};entryX=${sourceOnLeft?0:1};entryY=${dstY};`;
      const trackY=(src.y+src.height*srcY+dst.y+dst.height*dstY)/2;
      points=[{x:midX,y:trackY}];labelX=midX;
      labelY=(src.y+src.height*srcY+dst.y+dst.height*dstY)/2;
    }else{
      const sourceAbove=src.y+src.height/2<dst.y+dst.height/2;
      const srcX=slot,dstX=slot;
      const midY=sourceAbove?(src.y+src.height+dst.y)/2:(dst.y+dst.height+src.y)/2;
      const routeX=(src.x+src.width*srcX+dst.x+dst.width*dstX)/2;
      anchors=`exitX=${srcX};exitY=${sourceAbove?1:0};entryX=${dstX};entryY=${sourceAbove?0:1};`;
      points=[{x:routeX,y:midY}];labelX=routeX+labelSide*90;
      labelY=midY;
    }
    const cfg=s.dfd.dataFlow||{};
    if(!cfg.strokeColor||!Number.isFinite(Number(cfg.strokeWidth))||!cfg.arrow)throw Error('DFD dataFlow style requires strokeColor, numeric strokeWidth, and arrow');
    const style=`edgeStyle=orthogonalEdgeStyle;rounded=0;jettySize=auto;${anchors}endArrow=${cfg.arrow};startArrow=none;html=1;whiteSpace=wrap;fontFamily=${s.dfd.fontFamily||'Arial'};fontSize=${fontSize};strokeColor=${cfg.strokeColor};strokeWidth=${cfg.strokeWidth};`;
    const xml=edge(stableId('dfd_flow',flow.id??index),src._cell,dst._cell,'',style,'1',{points});
    cells.push(xml);
    if(label.trim()){
      const labelWidth=Math.min(Math.max(220,approxWidth(label,fontSize)+20),Math.max(220,gap-50),500);
      const lineCount=Math.max(...label.split(/\r?\n/).map(line=>Math.max(1,Math.ceil(approxWidth(line,fontSize)/(labelWidth-20)))));
      const labelHeight=Math.max(28,lineCount*(fontSize+5)+8);
      if(horizontal)labelY=points[0].y+labelSide*(labelHeight/2+10);
      else labelX=points[0].x+labelSide*(labelWidth/2+10);
      const labelStyle=`text;html=1;whiteSpace=wrap;align=center;verticalAlign=middle;fontFamily=${s.dfd.fontFamily||'Arial'};fontSize=${fontSize};fillColor=#ffffff;strokeColor=none;`;
      cells.push(vertex(stableId('dfd_flow_label',flow.id??index),htmlText(label),labelStyle,labelX-labelWidth/2,labelY-labelHeight/2,labelWidth,labelHeight));
    }
  }
  return cells;
}
