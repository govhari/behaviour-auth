import { median, mad } from '../features/index.js';
export function automation(events,rich,legacyReasons){
  const signals=legacyReasons.map(code=>({code,penalty:code==='IMPLAUSIBLE_KEY_TIMING'?.65:.5}));
  const moves=events.filter(e=>e.type==='move'),gaps=moves.slice(1).map((e,i)=>e.t-moves[i].t).filter(t=>t>0);
  if(gaps.length>=40&&mad(gaps)<.05)signals.push({code:'PERIODIC_POINTER_SAMPLING',penalty:.05});
  if(moves.length>=40&&rich.stats.pointer.efficiency>.9999&&rich.stats.pointer.turn<.001)signals.push({code:'PERFECT_POINTER_GEOMETRY',penalty:.05});
  if(rich.stats.crossModal.keyToPointer!==null&&rich.stats.crossModal.keyToPointer<5)signals.push({code:'IMMEDIATE_CROSS_MODAL_TRANSITION',penalty:.05});
  if(signals.some(s=>s.code==='PERIODIC_POINTER_SAMPLING')&&signals.some(s=>s.code==='PERFECT_POINTER_GEOMETRY'))signals.push({code:'SYNTHETIC_POINTER_PATH',penalty:.3});
  const intervals=events.filter(e=>e.type==='keydown').map(e=>e.t);const deltas=intervals.slice(1).map((t,i)=>t-intervals[i]);
  const bins=new Map();for(const x of deltas){const b=Math.floor(x/10);bins.set(b,(bins.get(b)??0)+1);}
  const entropy=deltas.length?-Array.from(bins.values()).reduce((sum,n)=>{const p=n/deltas.length;return sum+p*Math.log2(p);},0):null;
  return {score:Math.max(0,.9-signals.reduce((s,x)=>s+x.penalty,0)),signals,entropy,medianPointerInterval:median(gaps)};
}
