export function trace(c,{factor=1,seed=0,uniform=false}={}){
  const events=[];let t=20;
  for(let i=0;i<c.phrase.length;i++){
    const key=c.phrase[i];events.push({type:'keydown',key,t,trusted:true});
    t+=(uniform?50:65+(i*7+seed*3)%35)*factor;events.push({type:'keyup',key,t,trusted:true});
    t+=(uniform?50:40+(i*13+seed*5)%50)*factor;
  }
  let prev={x:.1,y:.1};
  for(const goal of c.targets){
    for(let i=1;i<=20;i++){t+=(16+i%5+seed%3)*factor;events.push({type:'move',t,x:prev.x+(goal.x-prev.x)*i/20,y:prev.y+(goal.y-prev.y)*i/20,trusted:true});}
    t+=70*factor;events.push({type:'down',t,...goal,trusted:true});t+=(80+seed)*factor;events.push({type:'up',t,...goal,trusted:true});prev=goal;
  }return events;
}
export const payload=(c,events)=>({challengeId:c.challengeId,nonce:c.nonce,userId:c.userId,events});
export function enroll(core,user='alice'){
  const e=core.start(user,'test-enrollment-secret');
  for(let i=0;i<8;i++){const c=core.challenge(user,'enroll',e.enrollmentId,e.enrollmentToken);const r=core.submit({...payload(c,trace(c,{seed:i})),enrollmentToken:e.enrollmentToken},'enroll');if(r.decision!=='SAMPLE_ACCEPTED')throw Error(JSON.stringify(r));}
  core.complete(user,e.enrollmentId,e.enrollmentToken);return e;
}
