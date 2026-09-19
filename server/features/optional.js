export function optionalFeatures(events,challenge,median,mad){
  const gyro=events.filter(e=>e.type==='gyro'),motion=events.filter(e=>e.type==='motion');
  const pen=events.filter(e=>e.pointerType==='pen'&&['move','down','up'].includes(e.type));
  const scroll=events.filter(e=>e.type==='scroll'),wheel=events.filter(e=>e.type==='wheel');
  const speeds=[],accelerations=[],gaps=[],bursts=[];let burst=0,reversals=0,lastDirection=0,crossings=0;
  for(let i=1;i<scroll.length;i++){
    const a=scroll[i-1],b=scroll[i],dt=b.t-a.t,delta=b.position-a.position;
    if(dt<=0)continue;
    gaps.push(dt);const speed=delta*1000/dt;
    if(speeds.length)accelerations.push(Math.abs(speed-speeds.at(-1))*1000/dt);speeds.push(speed);
    const direction=Math.sign(delta);if(direction&&lastDirection&&direction!==lastDirection)reversals++;if(direction)lastDirection=direction;
    if(dt>150){bursts.push(burst);burst=0;}else burst+=dt;
    if(challenge.scrollTarget!=null&&(a.position-challenge.scrollTarget)*(b.position-challenge.scrollTarget)<0)crossings++;
  }
  if(scroll.length>1)bursts.push(burst);
  const pressure=pen.map(e=>e.pressure).filter(Number.isFinite),tilt=pen.filter(e=>Number.isFinite(e.tiltX)&&Number.isFinite(e.tiltY)),twist=pen.map(e=>e.twist).filter(Number.isFinite);
  return {stats:{
    motion:{linearMagnitude:median(motion.filter(e=>[e.ax,e.ay,e.az].every(Number.isFinite)).map(e=>Math.hypot(e.ax,e.ay,e.az))),rotationMagnitude:median(gyro.map(e=>Math.hypot(e.x,e.y,e.z))),rotationSpread:mad(gyro.map(e=>Math.hypot(e.x,e.y,e.z)))},
    scroll:{acceleration:median(accelerations),cadence:median(gaps),burstDuration:median(bursts),reversalRatio:speeds.length?reversals/speeds.length:null,overshootCount:scroll.length>1?crossings:null,wheelMagnitude:median(wheel.map(e=>Math.hypot(e.deltaX,e.deltaY)*(e.deltaMode===1?16:e.deltaMode===2?160:1)))},
    pen:{pressure:median(pressure),pressureSpread:mad(pressure),tilt:median(tilt.map(e=>Math.hypot(e.tiltX,e.tiltY))),tiltSpread:mad(tilt.map(e=>Math.hypot(e.tiltX,e.tiltY))),twistSin:median(twist.map(v=>Math.sin(v*Math.PI/180))),twistCos:median(twist.map(v=>Math.cos(v*Math.PI/180))),contactHeight:median(pen.map(e=>e.height).filter(v=>v>1))}
  },quality:{pen:Math.min(1,pen.length/12),motion:Math.min(1,Math.max(motion.length,gyro.length)/10)}};
}
