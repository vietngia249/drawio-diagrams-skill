import {createPresentationTokens, DEFAULT_PRESENTATION_TOKENS, htmlText, loadStyle, spacingFor, styleForRole} from './common.mjs';
import {routeOrthogonalEdges} from './geometry.mjs';

const kinds=new Set(['process','dataStore','externalEntity']);
const defaultDfdStyle=loadStyle().dfd;
const clean=value=>String(value??'').trim();
const labelOf=node=>node.label??node.name??'';
const flowLabel=flow=>flow.label??flow.text??'';
const stableId=(prefix,value)=>`${prefix}_${Buffer.from(String(value),'utf8').toString('hex')||'empty'}`;
const clamp=(value,min,max)=>Math.min(max,Math.max(min,value));

function textWidth(value,fontSize){
  return [...String(value??'')].reduce((width,char)=>width+(char.charCodeAt(0)>0x2ff?1:0.56)*fontSize,0);
}
function wrapText(value,maxWidth,fontSize){
  const maxChars=Math.max(8,Math.floor(maxWidth/(fontSize*0.58))),lines=[];
  for(const paragraph of String(value??'').replace(/\r\n?/g,'\n').split('\n')){
    let line='';
    for(let word of paragraph.split(/\s+/).filter(Boolean)){
      if(line&&line.length+1+word.length<=maxChars){line+=` ${word}`;continue;}
      if(line)lines.push(line);
      line='';
      while(word.length>maxChars){lines.push(word.slice(0,maxChars));word=word.slice(maxChars);}
      line=word;
    }
    lines.push(line);
  }
  return lines.join('\n');
}
function resolveNode(nodes,ref,flowIndex,side){
  const matches=nodes.filter(node=>node.id===ref||node.name===ref||labelOf(node)===ref);
  if(!matches.length)throw Error(`DFD flow ${flowIndex} ${side} endpoint ${JSON.stringify(ref)} does not resolve to a declared node`);
  if(matches.length>1)throw Error(`DFD flow ${flowIndex} ${side} endpoint ${JSON.stringify(ref)} is ambiguous; use a node ID`);
  return matches[0];
}
function vertex(id,value,style,x,y,width,height){
  return {kind:'vertex',id,value,style,parent:'1',geometry:{x,y,width,height}};
}
function edge(id,source,target,style,route){
  return {kind:'edge',id,value:'',style,parent:'1',source,target,ports:{source:{side:route.sourcePort.side,offset:route.sourcePort.offset},target:{side:route.targetPort.side,offset:route.targetPort.offset}},geometry:{relative:1,points:route.points}};
}
function overflow(bounds,page){
  return bounds.x<0||bounds.y<0||bounds.x+bounds.width>page.width||bounds.y+bounds.height>page.height;
}
function overrideOrToken(value,defaultValue,tokenValue){return value===defaultValue?tokenValue:value}
function roleTokens(presentation,{fontSize,fontFamily=presentation.fontFamily,role='node',legacyStyle,legacyDefaults,fillColor,strokeColor,strokeWidth,labelBackground}={}){
  const tokens={...presentation,fontFamily,fontSizes:{...presentation.fontSizes},colors:{...presentation.colors}};
  tokens.fontSizes[role==='label'||role==='edge'?'label':'body']=fontSize;
  if(legacyStyle&&legacyDefaults){
    tokens.colors.stroke=overrideOrToken(legacyStyle.strokeColor,legacyDefaults.strokeColor,presentation.colors.stroke);
    tokens.colors.fill=overrideOrToken(legacyStyle.fillColor,legacyDefaults.fillColor,presentation.colors.fill);
    tokens.strokeWidth=overrideOrToken(legacyStyle.strokeWidth,legacyDefaults.strokeWidth,presentation.strokeWidth);
  }
  if(strokeColor!==undefined)tokens.colors.stroke=strokeColor;
  if(fillColor!==undefined)tokens.colors.fill=fillColor;
  if(strokeWidth!==undefined)tokens.strokeWidth=strokeWidth;
  if(labelBackground!==undefined)tokens.label={...presentation.label,background:labelBackground};
  return tokens;
}

/** Render a directed DFD with process-mediated flow semantics and shared planned geometry. */
export function renderDfd(data,styleConfig){
  const input=data.nodes??data.processes??[],flows=data.flows??data.edges??[];
  if(!Array.isArray(input)||!Array.isArray(flows))throw Error('DFD nodes and flows must be arrays');
  if(data.level!==undefined&&(!Number.isInteger(data.level)||data.level<0))throw Error('DFD level must be a nonnegative integer');
  if(data.perspective!==undefined&&!['logical','physical'].includes(data.perspective))throw Error('DFD perspective must be logical or physical');
  const dfdStyle=styleConfig?.dfd??defaultDfdStyle,presentation=createPresentationTokens(styleConfig?.presentation??{});
  const configuredFontSize=Number(dfdStyle.fontSize),legacyFontSize=Number.isFinite(configuredFontSize)&&configuredFontSize!==Number(defaultDfdStyle.fontSize);
  const baseFontSize=Number.isFinite(configuredFontSize)?configuredFontSize:12;
  const fontSize=Math.max(12,legacyFontSize?configuredFontSize:presentation.fontSizes.body!==DEFAULT_PRESENTATION_TOKENS.fontSizes.body?presentation.fontSizes.body:baseFontSize);
  const labelFontSize=Math.max(12,legacyFontSize?configuredFontSize:presentation.fontSizes.label!==DEFAULT_PRESENTATION_TOKENS.fontSizes.label?presentation.fontSizes.label:baseFontSize);
  const fontFamily=dfdStyle.fontFamily===defaultDfdStyle.fontFamily?presentation.fontFamily:dfdStyle.fontFamily;
  const ids=new Set();
  const nodes=input.map((node,index)=>{
    if(!node||typeof node!=='object')throw Error(`DFD node ${index} must be an object`);
    const id=clean(node.id),kind=node.kind||'process',label=clean(labelOf(node));
    if(!id)throw Error(`DFD node ${index} requires a nonempty id`);
    if(ids.has(id))throw Error(`DFD node IDs must be unique: ${JSON.stringify(id)}`);
    ids.add(id);
    if(!kinds.has(kind))throw Error(`DFD node ${JSON.stringify(id)} has unsupported kind ${JSON.stringify(kind)}`);
    if(!label)throw Error(`DFD node ${JSON.stringify(id)} requires a nonempty label`);
    const nodeStyle=dfdStyle[kind];
    if(!nodeStyle||!nodeStyle.shape||!nodeStyle.fillColor||!nodeStyle.strokeColor||!Number.isFinite(Number(nodeStyle.strokeWidth)))throw Error(`DFD style for ${kind} requires shape, fillColor, strokeColor, and numeric strokeWidth`);
    if(kind!=='dataStore'&&!['default','rect','ellipse'].includes(nodeStyle.shape))throw Error(`DFD style for ${kind} uses unverified native shape ${JSON.stringify(nodeStyle.shape)}`);
    const maxWidth=kind==='dataStore'?320:260,minWidth=kind==='process'?180:160;
    const contentWidth=clamp(textWidth(label,fontSize)+40,minWidth,maxWidth);
    const innerWidth=contentWidth-(kind==='dataStore'?32:28);
    const display=wrapText(label,innerWidth,fontSize),lineCount=display.split('\n').length,lineHeight=Math.ceil(fontSize*1.35);
    const width=contentWidth,height=kind==='process'?Math.max(104,lineCount*lineHeight+32):kind==='externalEntity'?Math.max(82,lineCount*lineHeight+26):Math.max(86,lineCount*lineHeight+54);
    const cellId=stableId('dfd_node',id);
    return {...node,id,kind,label,display,width,height,_cell:cellId,_style:nodeStyle};
  });
  if(!nodes.length)throw Error('DFD requires at least one node');

  const normalized=flows.map((flow,index)=>{
    if(!flow||typeof flow!=='object')throw Error(`DFD flow ${index} must be an object`);
    const src=resolveNode(nodes,flow.from,index,'source'),dst=resolveNode(nodes,flow.to,index,'target');
    if(src.id===dst.id)throw Error(`DFD flow ${index} cannot connect a node to itself`);
    if(src.kind!=='process'&&dst.kind!=='process')throw Error(`DFD flow ${index} violates Yourdon/Coad rules: every flow must connect to a process`);
    const label=String(flowLabel(flow)??'').trim();
    const id=flow.id===undefined?String(index):clean(flow.id);
    if(!id)throw Error(`DFD flow ${index} id must not be empty`);
    return {flow,index,id,src,dst,label};
  });
  const flowIds=new Set();
  for(const item of normalized){if(flowIds.has(item.id))throw Error(`DFD flow IDs must be unique: ${JSON.stringify(item.id)}`);flowIds.add(item.id);}

  const columns=['externalEntity','process','dataStore'];
  const colWidths=columns.map(kind=>Math.max(0,...nodes.filter(node=>node.kind===kind).map(node=>node.width)));
  const largestLabel=Math.max(160,...normalized.map(({label})=>Math.min(360,textWidth(label,labelFontSize)+32)));
  const clearance=Math.max(18,spacingFor('routeClearance',presentation)),colGap=Math.max(230,Math.min(560,largestLabel+2*clearance+40)),top=84,rowGap=128,pad=64;
  const xStarts=[pad,pad+colWidths[0]+colGap,pad+colWidths[0]+colGap+colWidths[1]+colGap];
  const rows=Object.fromEntries(columns.map(kind=>[kind,0]));
  for(const node of nodes){
    const col=columns.indexOf(node.kind);
    node.x=xStarts[col]+(colWidths[col]-node.width)/2;
    node.y=top+(rows[node.kind]++)*(Math.max(0,...nodes.filter(other=>other.kind===node.kind).map(other=>other.height))+rowGap);
    node.bounds={x:node.x,y:node.y,width:node.width,height:node.height};
  }
  const right=Math.max(...nodes.map(node=>node.x+node.width)),bottom=Math.max(...nodes.map(node=>node.y+node.height));
  const explicitPage=data.page;
  const page={width:explicitPage?.width??right+pad+Math.min(260,colGap*0.55),height:explicitPage?.height??bottom+pad+150};
  for(const key of ['width','height'])if(!Number.isFinite(page[key])||page[key]<=0)throw Error(`DFD page.${key} must be positive and finite`);

  const labelSizes=new Map();
  const edgeRequests=normalized.map(({id,src,dst,label})=>{
    let labelSize;
    if(label){
      const width=clamp(textWidth(label,labelFontSize)+32,160,360),display=wrapText(label,width-20,labelFontSize),height=Math.max(28,display.split('\n').length*(labelFontSize+5)+8);
      labelSize={id:stableId('dfd_flow_label',id),width,height,display};labelSizes.set(id,labelSize);
    }
    return {id:stableId('dfd_flow',id),source:{nodeId:src._cell},target:{nodeId:dst._cell},...(labelSize?{label:{id:labelSize.id,width:labelSize.width,height:labelSize.height}}:{})};
  });
  const obstacles=nodes.map(node=>({id:node._cell,kind:'node',bounds:node.bounds}));
  const routed=routeOrthogonalEdges({obstacles,edges:edgeRequests,page,clearance});
  const diagnostics=[...routed.diagnostics];
  for(const node of nodes)if(overflow(node.bounds,page))diagnostics.push({phase:'planned',severity:'warning',code:'DFD_PAGE_OVERFLOW',path:`nodes.${node.id}`,message:'Node extends beyond the explicit DFD page bounds',value:node.bounds});
  if(diagnostics.some(item=>item.severity==='error')){
    const error=new Error(`DFD geometry planning failed: ${diagnostics.filter(item=>item.severity==='error').map(item=>item.message).join('; ')}`);
    error.diagnostics=diagnostics;throw error;
  }

  const routeById=new Map(routed.routes.map(route=>[route.edgeId,route])),cells=[];
  for(const node of nodes){
    const style=node._style;
    if(node.kind==='dataStore'){
      // One invisible semantic endpoint spans the documented editable two-line store glyph.
      cells.push(vertex(node._cell,'','shape=rect;fillColor=none;strokeColor=none;opacity=0;',node.x,node.y,node.width,node.height));
      const storeTokens=roleTokens(presentation,{fontFamily,fontSize,legacyStyle:style,legacyDefaults:defaultDfdStyle.dataStore});
      const lineColor=storeTokens.colors.stroke;
      const lineStyle=styleForRole('node',roleTokens(presentation,{fontFamily,fontSize,fillColor:lineColor,strokeColor:lineColor,strokeWidth:storeTokens.strokeWidth}),'shape=rect;html=1;');
      cells.push(vertex(stableId('dfd_store_top',node.id),'',lineStyle,node.x+8,node.y+20,node.width-16,2));
      cells.push(vertex(stableId('dfd_store_bottom',node.id),'',lineStyle,node.x+8,node.y+node.height-20,node.width-16,2));
      const labelBackground=overrideOrToken(style.fillColor,defaultDfdStyle.dataStore.fillColor,presentation.label.background);
      const labelStyle=styleForRole('label',roleTokens(presentation,{fontFamily,fontSize,role:'label',labelBackground}),'text;html=1;whiteSpace=wrap;align=center;verticalAlign=middle;strokeColor=none;');
      cells.push(vertex(stableId('dfd_store_label',node.id),htmlText(node.display),labelStyle,node.x+12,node.y+24,node.width-24,node.height-48));
    }else{
      const shapeStyle=styleForRole('node',roleTokens(presentation,{fontFamily,fontSize,legacyStyle:style,legacyDefaults:defaultDfdStyle[node.kind]}),`shape=${style.shape};whiteSpace=wrap;html=1;rounded=${style.rounded??0};`);
      cells.push(vertex(node._cell,htmlText(node.display),shapeStyle,node.x,node.y,node.width,node.height));
    }
  }
  const cfg=dfdStyle.dataFlow||{};
  if(!cfg.strokeColor||!Number.isFinite(Number(cfg.strokeWidth))||!cfg.arrow)throw Error('DFD dataFlow style requires strokeColor, numeric strokeWidth, and arrow');
  for(const item of normalized){
    const route=routeById.get(stableId('dfd_flow',item.id));
    if(!route)throw Error(`DFD geometry did not return flow ${item.id}`);
    const flowTokens=roleTokens(presentation,{fontFamily,fontSize:labelFontSize,role:'edge',legacyStyle:cfg,legacyDefaults:defaultDfdStyle.dataFlow});
    const edgeStyle=styleForRole('edge',flowTokens,`edgeStyle=orthogonalEdgeStyle;rounded=0;jettySize=auto;endArrow=${cfg.arrow};startArrow=none;html=1;whiteSpace=wrap;`);
    cells.push(edge(stableId('dfd_flow',item.id),item.src._cell,item.dst._cell,edgeStyle,route));
    const label=labelSizes.get(item.id);
    if(label){
      const b=route.label.bounds,textStyle=styleForRole('label',roleTokens(presentation,{fontFamily,fontSize:labelFontSize,role:'label'}),'text;html=1;whiteSpace=wrap;align=center;verticalAlign=middle;strokeColor=none;');
      cells.push(vertex(label.id,htmlText(label.display),textStyle,b.x,b.y,b.width,b.height));
    }
  }
  return {cells,diagnostics,page};
}
