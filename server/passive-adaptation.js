import { calibratePassive, matchPassive, passiveBars } from './passive.js';

export function quarantinePassive(user,record,accepted){
  if(!this.options.passiveAdaptation)return {state:'disabled'};
  const p=this.profile(user),id=record.challenge.device.id,device=p?.passive?.devices?.[id],a=record.derived;
  const threshold=this.options.passiveThreshold??passiveBars(device).threshold;
  const eligible=threshold+.5*(1-threshold);
  const anchor={model:device?.anchorModel??device?.model};
  const anchorMatch=matchPassive(a,anchor);
  if(!accepted||device?.status!=='trusted'||!record.result.fresh||!a.complete||a.quality<.85||a.humanScore<.9||!Number.isFinite(anchorMatch.score)||anchorMatch.score<eligible)return {state:'ineligible'};
  this.db.prepare('DELETE FROM passive_quarantine WHERE user=? AND device=? AND created<?').run(user,id,this.clock()-30*86400000);
  const rows=this.db.prepare('SELECT * FROM passive_quarantine WHERE user=? AND device=? ORDER BY created DESC').all(user,id);
  if(rows[0]&&this.clock()-rows[0].created<600000)return {state:'waiting',samples:rows.length,reason:'SEPARATE_SESSIONS_REQUIRED'};
  const previous=rows.map(r=>JSON.parse(r.body));
  const like=sample=>({model:Object.fromEntries(Object.entries(anchor.model??{}).map(([m,f])=>[m,Object.fromEntries(Object.entries(f).flatMap(([n,q])=>Number.isFinite(sample.stats?.[m]?.[n])?[[n,{...q,center:sample.stats[m][n]}]]:[]))]))});
  if(previous.some(r=>(matchPassive(a,like(r.derived)).score??0)<threshold))return {state:'inconsistent'};
  const batch=[...previous,record];
  if(batch.length<4){this.db.prepare('INSERT INTO passive_quarantine VALUES(?,?,?,?,?)').run(record.sessionId,user,id,this.clock(),JSON.stringify(record));return {state:'quarantined',samples:batch.length,required:4};}
  const baseline=this.db.prepare('SELECT body FROM passive_sessions WHERE user=? AND trusted=1 ORDER BY rowid DESC LIMIT 96').all(user).map(r=>JSON.parse(r.body)).filter(r=>r.challenge.device.id===id).slice(0,20);
  const calibrated=calibratePassive([...baseline,...batch].map(r=>r.derived));
  device.anchorModel??=device.model;
  Object.assign(device,calibrated,{threshold:Math.max(device.threshold,calibrated.threshold),promotedAt:this.clock()});p.version++;
  this.db.exec('BEGIN IMMEDIATE');
  try{
    this.db.prepare('UPDATE profiles SET body=? WHERE user=?').run(JSON.stringify(p),user);
    for(const r of batch)this.db.prepare('UPDATE passive_sessions SET trusted=1 WHERE id=?').run(r.sessionId);
    this.db.prepare('DELETE FROM passive_quarantine WHERE user=? AND device=?').run(user,id);this.db.exec('COMMIT');
  }catch(e){this.db.exec('ROLLBACK');throw e;}
  this.audit(user,'passive_device_adaptation',{device:id,samples:batch.length,version:p.version});return {state:'promoted',samples:batch.length};
}
