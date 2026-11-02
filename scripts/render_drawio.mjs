import fs from 'node:fs';
import path from 'node:path';
import {docXml,loadStyle,writeOut,renderGeneric} from './common.mjs';
import {renderSequence} from './sequence.mjs';
import {renderErd} from './erd.mjs';
import {renderDfd} from './dfd.mjs';
const args=process.argv.slice(2),input=args[0];if(!input){console.error('Usage: node scripts/render_drawio.mjs input.json [-o output.drawio]');process.exit(2)}
const oi=args.indexOf('-o'),out=oi>=0?args[oi+1]:input.replace(/\.json$/i,'.drawio');const d=JSON.parse(fs.readFileSync(input,'utf8').replace(/^\\uFEFF/,''));const style=loadStyle();let cells;
if(d.elements)cells=renderGeneric(d);else if(d.type==='sequence')cells=renderSequence(d,style);else if(d.type==='erd')cells=renderErd(d,style);else if(d.type==='dfd')cells=renderDfd(d,style);else throw Error(`Unsupported type ${d.type}; use sequence, erd, or dfd`);
const xml=docXml(d.title||path.basename(input),cells,d.page);writeOut(out,xml);console.log(`Rendered ${out}: ${cells.length} cells`);
