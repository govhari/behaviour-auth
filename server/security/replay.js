import { median } from '../features/index.js';
export function replayFingerprint(events,challenge){
  const keys=events.filter(e=>['keydown','keyup'].includes(e.type));
  const pointer=events.filter(e=>['move','down','up'].includes(e.type));
  const normalize=es=>{const deltas=es.slice(1).map((e,i)=>e.t-es[i].t),scale=median(deltas.filter(x=>x>0))??1;return deltas.map(x=>x/Math.max(scale,.001));};
  return {phrase:challenge.phrase,interaction:challenge.interaction??'point',types:keys.map(e=>e.type+':'+e.key).join('|'),pointerTypes:pointer.map(e=>e.type).join('|'),keyboard:normalize(keys),pointer:normalize(pointer)};
}
export function nearReplay(a,b){
  if(!a||!b||a.phrase!==b.phrase||a.interaction!==b.interaction||a.types!==b.types||a.pointerTypes!==b.pointerTypes||(a.interaction!=='drag'&&a.keyboard.length<35)||a.pointer.length<40)return false;
  const close=(x,y)=>x.length===y.length&&x.every((v,i)=>Math.abs(v-y[i])<.035)&&x.reduce((s,v,i)=>s+Math.abs(v-y[i]),0)/x.length<.012;
  return (a.interaction==='drag'||close(a.keyboard,b.keyboard))&&close(a.pointer,b.pointer);
}
