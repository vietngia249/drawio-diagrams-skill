import {vertex,edge,htmlText} from './common.mjs';

const fragmentKinds=new Set(['alt','opt','loop','par']);
const numberOr=(value,fallback)=>Number.isFinite(Number(value))?Number(value):fallback;
const lineCount=(value,charsPerLine=60)=>String(value??'').split(/\r?\n/).reduce((count,line)=>count+Math.max(1,Math.ceil(line.length/charsPerLine)),0);
const labelOf=item=>item.label??item.text??'';

function wrapText(value,maxChars){
 const result=[];
 for(const paragraph of String(value??'').split(/\r?\n/)){
  let line='';
  for(let word of paragraph.split(/\s+/).filter(Boolean)){
   if(line&&line.length+1+word.length<=maxChars){line+=` ${word}`;continue}
   if(line)result.push(line);
   line='';
   while(word.length>maxChars){result.push(word.slice(0,maxChars));word=word.slice(maxChars)}
   line=word;
  }
  result.push(line);
 }
 return result.join('\n');
}

function collectMessages(owner,result=[]){
 result.push(...(owner.messages||[]));
 for(const fragment of owner.fragments||[])for(const branch of fragment.branches||[])collectMessages(branch,result);
 return result;
}

function orderedItems(owner){
 const combined=[...(owner.messages||[]).map((item,index)=>({item,index,source:'message'})),...(owner.fragments||[]).map((item,index)=>({item,index,source:'fragment'}))];
 return combined.sort((a,b)=>{
  const ao=Number(a.item.order),bo=Number(b.item.order),av=a.item.order!==undefined&&a.item.order!==null&&a.item.order!==''&&Number.isFinite(ao),bv=b.item.order!==undefined&&b.item.order!==null&&b.item.order!==''&&Number.isFinite(bo);
  if(av&&bv&&ao!==bo)return ao-bo;
  if(av!==bv)return av?-1:1;
  return a.source===b.source?a.index-b.index:(a.source==='message'?-1:1);
 }).map(entry=>entry.item);
}

export function renderSequence(data,styleConfig){
 const participants=data.participants||[];
 const ids=participants.map((participant,index)=>typeof participant==='string'?participant:(participant.id??`p${index}`));
 const participantIndexes=new Map();
 ids.forEach((id,index)=>{
  const key=String(id);
  if(participantIndexes.has(key))throw new Error(`Duplicate sequence participant id ${JSON.stringify(key)} at participants[${index}] (already declared at participants[${participantIndexes.get(key)}])`);
  participantIndexes.set(key,index);
 });
 const labels=participants.map((participant,index)=>typeof participant==='string'?participant:(participant.label??participant.id??`P${index+1}`));
 const seq=styleConfig.sequence||{},participantStyle=seq.participant||{},fragmentStyle=seq.fragment||{},messageStyle=seq.message||{};
 const widths=labels.map(label=>Math.max(130,Math.min(260,Math.ceil(String(label).length*8+30))));
 const messageFontSize=numberOr(messageStyle.fontSize,numberOr(seq.fontSize,16));
 const messageWidth=item=>Math.max(180,Math.min(480,Math.max(...String(labelOf(item)).split(/\r?\n/).map(line=>line.length),0)*messageFontSize*0.56+36));
 const gaps=widths.slice(0,-1).map((_,index)=>Math.max(80,Math.min(180,String(labels[index]).length*2+65)));
 const centersFor=()=>{const values=[];let cursor=90;widths.forEach((width,index)=>{values[index]=cursor+width/2;cursor+=width+(gaps[index]||0)});return values};
 for(const item of collectMessages(data)){
  const fromIndex=ids.indexOf(item.from),toIndex=ids.indexOf(item.to),desired=messageWidth(item)+32;
  if(fromIndex<0||toIndex<0||!gaps.length)continue;
  if(fromIndex===toIndex){const lane=fromIndex===0?fromIndex:fromIndex-1;if(lane>=0&&lane<gaps.length)gaps[lane]=Math.max(gaps[lane],desired);continue}
  const low=Math.min(fromIndex,toIndex),high=Math.max(fromIndex,toIndex),centers=centersFor(),current=centers[high]-centers[low];
  if(current<desired){const extra=(desired-current)/(high-low);for(let lane=low;lane<high;lane++)gaps[lane]+=extra;}
 }
 const centers=centersFor();
 const xOf=new Map(ids.map((id,index)=>[id,centers[index]]));
 const left=centers.length?Math.min(...centers.map((center,index)=>center-widths[index]/2))-35:45;
 const right=centers.length?Math.max(...centers.map((center,index)=>center+widths[index]/2))+35:180;
 const frameWidth=Math.max(100,right-left),out=[];
 let nextMessage=0,nextFragment=0;

 function plan(owner,start){
  let y=start;const nodes=[];
  for(const item of orderedItems(owner)){
   const kind=String(item.kind||item.type||'').toLowerCase();
   if(item.from!==undefined||kind==='message'){
    const text=labelOf(item),from=xOf.get(item.from),to=xOf.get(item.to),fromIndex=ids.indexOf(item.from),toIndex=ids.indexOf(item.to),span=from===undefined||to===undefined?180:Math.abs(from-to),self=fromIndex===toIndex;
    const labelWidth=self?messageWidth(item):Math.max(160,Math.min(messageWidth(item),span-32));
    const charsPerLine=Math.max(16,Math.floor((labelWidth-20)/(messageFontSize*0.56)));
    const displayLabel=wrapText(text,charsPerLine),labelLines=lineCount(displayLabel,charsPerLine),labelHeight=Math.max(20,labelLines*18);
    const height=labelHeight+30;
    nodes.push({kind:'message',item,y,height,index:nextMessage++,self,fromIndex,toIndex,labelWidth,displayLabel,labelHeight});y+=height+18;continue;
   }
   if(!fragmentKinds.has(kind))throw new Error(`Unsupported sequence fragment: ${kind}`);
   // `par` is represented as visual interaction-operand grouping; this layout does not model concurrent execution.
   const fragment={kind,item,start:y,branches:[],index:nextFragment++};
   const branches=item.branches||[];
   y+=36;
   for(let branchIndex=0;branchIndex<branches.length;branchIndex++){
    const branch=branches[branchIndex];
    if(branchIndex)y+=24;
    const guard=String(branch.guard??branch.condition??'').replace(/^\[|\]$/g,'');
    const guardChars=Math.max(40,Math.min(84,Math.floor((frameWidth-24)/((fragmentStyle.guardFontSize||14)*0.58))));
    const displayGuard=wrapText(guard,guardChars),guardLines=guard?lineCount(displayGuard,guardChars):0;
    const guardHeight=guard?Math.max(30,guardLines*Math.max(18,(fragmentStyle.guardFontSize||14)*1.35)+12):8;
    const guardY=y;y+=guardHeight+(guard?22:8);
    const content=plan({messages:branch.messages||[],fragments:branch.fragments||[]},y);
    fragment.branches.push({guard,guardY,guardHeight,start:y,nodes:content.nodes,end:content.end});
    y=content.end;
   }
   fragment.end=y+16; y=fragment.end+24;nodes.push(fragment);
  }
  return{nodes,end:y};
 }

 const root=plan(data,126),frames=[],guards=[],separators=[],messages=[];
 function draw(nodes){
  for(const node of nodes){
   if(node.kind==='message'){
    const item=node.item,from=xOf.get(item.from),to=xOf.get(item.to);
    if(from===undefined||to===undefined)throw new Error(`sequence message ${node.index} has undeclared endpoint (${item.from} -> ${item.to})`);
    const kind=String(item.kind||'sync').toLowerCase();
    if(!['sync','async','return'].includes(kind))throw new Error(`sequence message ${node.index} has unsupported kind ${kind}`);
    const start=`msg_from_${node.index}`,end=`msg_to_${node.index}`,edgeId=`message_${node.index}`,y=node.y+node.height-8;
    messages.push(vertex(start,'','opacity=0;fillColor=none;strokeColor=none;',from,y,2,2),vertex(end,'','opacity=0;fillColor=none;strokeColor=none;',to,y,2,2));
    // Message arrowheads encode UML notation and cannot be overridden by presentation styles.
    const arrow=kind==='sync'?'block':'open',dashed=kind==='return'?1:0;
    const routePoints=[];
    if(from===to){
     const loopX=from+42,loopBottom=y+25;
     routePoints.push({x:loopX,y},{x:loopX,y:loopBottom},{x:from,y:loopBottom});
    }
    messages.push(edge(edgeId,start,end,'',`edgeStyle=orthogonalEdgeStyle;orthogonalLoop=1;jettySize=auto;endArrow=${arrow};startArrow=none;dashed=${dashed};html=1;strokeColor=${messageStyle.strokeColor||'#000000'};`,'1',{points:routePoints}));
    const participantLeft=centers[node.fromIndex]-widths[node.fromIndex]/2,participantRight=centers[node.fromIndex]+widths[node.fromIndex]/2;
    const labelX=node.self?(node.fromIndex===0?participantRight+12:participantLeft-node.labelWidth-12):(Math.min(from,to)+Math.abs(from-to)/2-node.labelWidth/2);
    const labelStyle=`text;html=1;align=center;verticalAlign=middle;whiteSpace=wrap;fillColor=#ffffff;strokeColor=none;fontSize=${messageFontSize};`;
    messages.push(vertex(`message_label_${node.index}`,htmlText(node.displayLabel),labelStyle,labelX,node.y,node.labelWidth,node.labelHeight));
    continue;
   }
   const id=`fragment_${node.index}`;
   frames.push(vertex(id,node.kind,`shape=${fragmentStyle.shape||'umlFrame'};html=1;whiteSpace=wrap;pointerEvents=0;fillColor=${fragmentStyle.fillColor||'#eeeeee'};strokeColor=${fragmentStyle.strokeColor||'#999999'};strokeWidth=${fragmentStyle.strokeWidth||1};fontSize=${fragmentStyle.fontSize||seq.fontSize||16};`,left,node.start,frameWidth,node.end-node.start));
   for(let branchIndex=0;branchIndex<node.branches.length;branchIndex++){
    const branch=node.branches[branchIndex];
    if(branchIndex){
     const y=branch.guardY-12,base=`${id}_sep_${branchIndex}`;
     separators.push(vertex(`${base}_a`,'','opacity=0;',left+1,y,0,0),vertex(`${base}_b`,'','opacity=0;',right-1,y,0,0),edge(base,`${base}_a`,`${base}_b`,'',`${fragmentStyle.separatorStyle||'dashed=1;strokeColor=#999999;strokeWidth=1;'};startArrow=none;endArrow=none;`));
    }
    if(branch.guard){
     const guardChars=Math.max(40,Math.min(84,Math.floor((frameWidth-24)/((fragmentStyle.guardFontSize||14)*0.58))));
     guards.push(vertex(`${id}_guard_${branchIndex}`,htmlText(`[${wrapText(branch.guard,guardChars)}]`),`text;html=1;align=left;verticalAlign=top;whiteSpace=wrap;fillColor=#ffffff;strokeColor=none;fontSize=${fragmentStyle.guardFontSize||14};`,left+12,branch.guardY,frameWidth-24,branch.guardHeight));
    }
    draw(branch.nodes);
   }
  }
 }
 draw(root.nodes);

 const participantsAndLines=[];
 participants.forEach((participant,index)=>{
  const x=centers[index]-widths[index]/2,label=labels[index];
  participantsAndLines.push(vertex(`participant_${index}`,htmlText(label),`rounded=${participantStyle.rounded??0};html=1;whiteSpace=wrap;fontSize=${seq.fontSize||16};shape=${participantStyle.shape||'umlLifeline'};fillColor=${participantStyle.fillColor||'none'};strokeColor=${participantStyle.strokeColor||'#999999'};strokeWidth=${participantStyle.strokeWidth||1};`,x,45,widths[index],52));
 });
 const lifeBottom=Math.max(root.end+30,220);
 ids.forEach((_,index)=>participantsAndLines.push(vertex(`lifeline_${index}`,'',`dashed=1;strokeColor=${participantStyle.strokeColor||'#999999'};strokeWidth=${participantStyle.strokeWidth||1};`,centers[index],97,1,lifeBottom-97)));
 return[...frames,...participantsAndLines,...separators,...guards,...messages];
}
