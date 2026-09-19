import { optionalFeatures } from './optional.js';
export const FEATURE_SCHEMA_VERSION = 4;
export const median = a => { const s=a.filter(Number.isFinite).sort((a,b)=>a-b);return s.length?(s[(s.length-1)>>1]+s[s.length>>1])/2:null; };
export const mad = a => {const m=median(a);return m===null?null:median(a.map(x=>Math.abs(x-m)));};
const bounded = (a,n=64) => a.length<=n?a:Array.from({length:n},(_,i)=>a[Math.round(i*(a.length-1)/(n-1))]);
export function derive(events, challenge) {
  const downs=[],keys=[],held=new Map(),segments=[];let path=[],corrections=0;
  for(const e of events){
    if(e.type==='keydown'){held.set(e.key,e);if(e.key.length===1)downs.push(e);if(e.key==='Backspace')corrections++;}
    if(e.type==='keyup'&&held.has(e.key)){const d=held.get(e.key);if(e.key.length===1)keys.push({key:e.key,down:d.t,up:e.t,dwell:e.t-d.t});held.delete(e.key);}
    if(['move','down','up'].includes(e.type)){path.push(e);if(e.type==='up'){segments.push(path);path=[];}}
  }
  keys.sort((a,b)=>a.down-b.down);
  const dd=[],ud=[],uu=[],context={};
  for(let i=1;i<keys.length;i++){const a=keys[i-1],b=keys[i];dd.push(b.down-a.down);ud.push(b.down-a.up);uu.push(b.up-a.up);(context[a.key+b.key]??=[]).push(b.down-a.down);if(i>=2)(context[keys[i-2].key+a.key+b.key]??=[]).push(b.down-keys[i-2].down);}
  const velocities=[],accelerations=[],jerks=[],turns=[],efficiencies=[],arrivals=[],clicks=[],sequences=[];
  const curves=[],trajectories=[],crossSequences=[],curvatures=[],reactions=[],approachAngles=[],overshoots=[],entrySpeeds=[],correctionRatios=[];
  for(const [index,p] of segments.entries()){
    if(p.length<2)continue;
    const start=p[0],end=p.at(-1),dx=end.x-start.x,dy=end.y-start.y,chord=Math.max(.05,Math.hypot(dx,dy));let distance=0,previousVelocity=null,previousAcceleration=null;const seq=[];
    for(let i=1;i<p.length;i++){const a=p[i-1],b=p[i],dt=b.t-a.t,dist=Math.hypot(b.x-a.x,b.y-a.y);distance+=dist;if(dt>0){const v=1000*dist/dt/chord;velocities.push(v);if(previousVelocity!==null){const acceleration=(v-previousVelocity)*1000/Math.max(8,dt);accelerations.push(acceleration);if(previousAcceleration!==null)jerks.push((acceleration-previousAcceleration)*1000/Math.max(8,dt));previousAcceleration=acceleration;}previousVelocity=v;seq.push([v,(b.t-start.t)/Math.max(1,end.t-start.t)]);}if(i>1){const q=p[i-2];let angle=Math.atan2(b.y-a.y,b.x-a.x)-Math.atan2(a.y-q.y,a.x-q.x);angle=Math.atan2(Math.sin(angle),Math.cos(angle));turns.push(Math.abs(angle));}}
    efficiencies.push(Math.min(1,chord/Math.max(chord,distance)));sequences.push(bounded(seq,32));
    const down=p.find(e=>e.type==='down'),goal=challenge.targets[index];const arrival=p.find(e=>goal&&Math.hypot(e.x-goal.x,e.y-goal.y)<(goal.radius??.065));
    if(down){clicks.push(end.t-down.t);if(arrival)arrivals.push(Math.max(0,down.t-arrival.t));}
    const curve=[],trajectory=[];let away=0,corrections=0;
    const previousEnd=index?segments[index-1].at(-1).t:Math.max(0,...keys.map(k=>k.up),...events.filter(e=>e.type==='text'&&e.value===challenge.phrase).map(e=>e.t));
    const reaction=Math.max(0,start.t-previousEnd);reactions.push(reaction);
    const targetEntry=p.findIndex(e=>goal&&Math.hypot(e.x-goal.x,e.y-goal.y)<(goal.radius??.065));
    for(let i=0;i<p.length;i++){
      const b=p[i],rx=(b.x-start.x)/chord,ry=(b.y-start.y)/chord;
      trajectory.push([(rx*dx+ry*dy)/chord,(ry*dx-rx*dy)/chord]);
      if(!i)continue;
      const a=p[i-1],dist=Math.hypot(b.x-a.x,b.y-a.y),dt=b.t-a.t;
      if(goal&&Math.hypot(b.x-goal.x,b.y-goal.y)>Math.hypot(a.x-goal.x,a.y-goal.y))away+=dist;
      if(i===targetEntry&&dt>0){
        entrySpeeds.push(1000*dist/dt/chord);
        const angle=Math.atan2(b.y-a.y,b.x-a.x)-Math.atan2(goal.y-a.y,goal.x-a.x);
        approachAngles.push(Math.abs(Math.atan2(Math.sin(angle),Math.cos(angle))));
      }
      if(i>1&&dist>.001){const q=p[i-2],angle=Math.atan2(b.y-a.y,b.x-a.x)-Math.atan2(a.y-q.y,a.x-q.x),theta=Math.abs(Math.atan2(Math.sin(angle),Math.cos(angle))),curvature=theta*chord/dist;
        curvatures.push(curvature);curve.push([Math.min(20,curvature)/5]);if(theta>.35)corrections++;
      }
    }
    curves.push(bounded(curve,32));trajectories.push(bounded(trajectory,32));
    crossSequences.push([reaction/200,(end.t-start.t)/1000,down?(end.t-down.t)/100:0]);
    overshoots.push(distance?away/distance:0);correctionRatios.push(corrections/Math.max(1,p.length-2));
  }
  const pointer=events.filter(e=>['move','down','up'].includes(e.type));
  const scroll=events.filter(e=>e.type==='scroll'),motion=events.filter(e=>e.type==='motion'),focus=events.filter(e=>e.type==='focus');
  const lastKey=keys.at(-1)?.up,firstMove=pointer.find(e=>lastKey!==undefined&&e.t>=lastKey);
  const pressures=pointer.filter(e=>e.pointerType!=='mouse'&&e.pressure>0).map(e=>e.pressure);
  const widths=pointer.filter(e=>e.pointerType!=='mouse'&&e.width>1).map(e=>e.width);
  const stats={keyboard:{dwell:median(keys.map(e=>e.dwell)),dd:median(dd),ud:median(ud),uu:median(uu),overlap:ud.length?ud.filter(v=>v<0).length/ud.length:null,corrections:corrections/Math.max(1,downs.length),pauseRatio:dd.length?dd.filter(v=>v>500).length/dd.length:null},pointer:{velocity:median(velocities),acceleration:median(accelerations.map(Math.abs)),jerk:median(jerks.map(Math.abs)),turn:median(turns),efficiency:median(efficiencies),click:median(clicks)},touch:{pressure:median(pressures),width:median(widths)},scroll:{speed:median(scroll.slice(1).flatMap((e,i)=>e.t>scroll[i].t?[Math.abs(e.position-scroll[i].position)*1000/(e.t-scroll[i].t)]:[]))},motion:{magnitude:median(motion.map(e=>Math.hypot(e.x,e.y,e.z)))},crossModal:{keyToPointer:firstMove?firstMove.t-lastKey:null,arrivalToClick:median(arrivals)}};
  const quality={keyboard:Math.min(1,keys.length/20),pointer:Math.min(1,velocities.length/25),touch:Math.min(1,pressures.length/8),scroll:Math.min(1,scroll.length/5),motion:Math.min(1,motion.length/10),crossModal:firstMove?1:0};
  Object.assign(stats.pointer,{reaction:median(reactions),curvature:median(curvatures),approachAngle:median(approachAngles),overshoot:median(overshoots),entryVelocity:median(entrySpeeds),correctionRatio:median(correctionRatios)});
  const optional=optionalFeatures(events,challenge,median,mad);
  for(const [mod,values] of Object.entries(optional.stats))stats[mod]={...stats[mod],...values};
  Object.assign(quality,optional.quality);
  const gaps=events.slice(1).map((e,i)=>e.t-events[i].t).filter(t=>t>0);
  return {featureSchemaVersion:FEATURE_SCHEMA_VERSION,stats,context,sequences:{keyboard:bounded(keys.map((k,i)=>[k.dwell/100,(dd[i]??median(dd)??0)/150])),pointer:sequences,curvature:curves,touch:challenge.interaction==='drag'?trajectories:[],crossModal:crossSequences},quality,availability:Object.fromEntries(Object.entries(quality).map(([k,v])=>[k,v>0?'AVAILABLE':'UNAVAILABLE'])),timing:{minDelta:gaps.length?Math.min(...gaps):null,coarse:!!gaps.length&&gaps.every(t=>Math.abs(t/50-Math.round(t/50))<.001),interrupted:focus.some(e=>!e.active)}};
}
