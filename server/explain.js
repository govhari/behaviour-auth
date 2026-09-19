
const MODALITY={
  username:'Username rhythm',password:'Password rhythm',pointer:'Pointer movement',click:'Click',crossModal:'Cross-modal timing',
  keyboard:'Typing rhythm',scroll:'Scrolling',rhythm:'Activity rhythm',touch:'Touch',pen:'Pen',motion:'Motion'};
const ORDER=['username','password','keyboard','pointer','click','crossModal','scroll','rhythm','touch','pen','motion'];
const FEATURE={
  dwell:['key hold','ms'],flight:['inter-key interval','ms'],upDown:['release-to-press gap','ms'],overlap:['key overlap','ratio'],
  correction:['correction rate','ratio'],corrections:['correction rate','ratio'],pauseRatio:['pause rate','ratio'],pauseMedian:['pause length','ms'],pauseSpread:['pause variability','ms'],
  burstLength:['burst length','count'],modifierRatio:['modifier use','ratio'],shiftRatio:['Shift use','ratio'],dd:['press-to-press interval','ms'],ud:['release-to-press gap','ms'],uu:['release-to-release interval','ms'],
  velocity:['pointer speed','speed'],entryVelocity:['speed on reaching the button','speed'],acceleration:['pointer acceleration','accel'],jerk:['pointer jerk','accel'],
  efficiency:['path straightness','ratio'],turn:['turning angle','rad'],correctionRatio:['direction-correction rate','ratio'],curvature:['path curvature','curv'],overshoot:['overshoot','ratio'],approachAngle:['approach angle','rad'],
  hold:['click hold','ms'],click:['click hold','ms'],arrival:['hover before click','ms'],arrivalToClick:['hover before click','ms'],reaction:['reaction delay','ms'],x:['click position across the button','pos'],y:['click position down the button','pos'],
  fieldTransition:['username-to-password pause','ms'],keyToPointer:['last key to first pointer move','ms'],approach:['travel time to the button','ms'],transitionTab:['Tab to move fields','ratio'],transitionClick:['click to move fields','ratio']};
const SIGNAL={
  UNIFORM_USERNAME_TIMING:['Uniform username key timing','Inter-key intervals in the username varied by under 1 ms; human typing never does.'],
  UNIFORM_PASSWORD_TIMING:['Uniform password key timing','Inter-key intervals in the password varied by under 1 ms; human typing never does.'],
  UNIFORM_KEY_TIMING:['Uniform key timing','Inter-key intervals varied by under 1 ms; human typing never does.'],
  LOW_ENTROPY_USERNAME_TIMING:['Low-entropy username timing','Username inter-key intervals fell into only a few distinct values.'],
  LOW_ENTROPY_PASSWORD_TIMING:['Low-entropy password timing','Password inter-key intervals fell into only a few distinct values.'],
  LOW_ENTROPY_KEY_TIMING:['Low-entropy key timing','Inter-key intervals fell into only a few distinct values.'],
  IMPLAUSIBLE_USERNAME_TIMING:['Implausibly fast username typing','Median key hold under 8 ms or interval under 20 ms: faster than a hand can type.'],
  IMPLAUSIBLE_PASSWORD_TIMING:['Implausibly fast password typing','Median key hold under 8 ms or interval under 20 ms: faster than a hand can type.'],
  IMPLAUSIBLE_KEY_TIMING:['Implausibly fast typing','Median key hold under 8 ms or interval under 20 ms: faster than a hand can type.'],
  IMPLAUSIBLE_CROSS_MODAL_TIMING:['No keyboard-to-mouse pause','The pointer moved within 5 ms of the last keystroke; a hand needs time to leave the keyboard.'],
  IMMEDIATE_CROSS_MODAL_TRANSITION:['No keyboard-to-mouse pause','The pointer moved within 5 ms of the last keystroke; a hand needs time to leave the keyboard.'],
  ALL_EVENTS_UNTRUSTED:['Every input event was script-generated','The browser marked every keystroke and pointer event isTrusted=false: dispatched by code, not by an input device.'],
  SYNTHETIC_EVENT_HINT:['Some events were script-generated','The browser marked some events isTrusted=false, meaning a script dispatched them.'],
  UNTRUSTED_EVENTS:['Script-generated events','The browser marked events isTrusted=false, meaning a script dispatched them.'],
  WEBDRIVER_HINT:['WebDriver flag set','navigator.webdriver was true: a browser under automation control.'],
  PERIODIC_POINTER_SAMPLING:['Metronomic pointer sampling','Pointer samples arrived at a fixed interval with under 0.1 ms of jitter; real devices jitter.'],
  PERFECT_POINTER_GEOMETRY:['Perfectly straight pointer path','The pointer travelled a mathematically straight line with no turning; hand movement always curves.'],
  SYNTHETIC_POINTER_PATH:['Synthetic pointer path','A ruler-straight path sampled on a metronome: a scripted cursor, not a hand.'],
  UNIFORM_CLICK_BEHAVIOR:['Identical clicks','Every click had the same hold time and landed on the same spot.'],
  EXACT_REPLAY:['Exact replay','This recording is identical to one already submitted, shifted in time.'],
  NEAR_REPLAY:['Near replay','Timing and path match a recent submission too closely to be a new performance.'],
  REPLAYED_CHALLENGE:['Challenge reused','The one-time challenge for this attempt had already been consumed.'],
  REPLAYED_WINDOW:['Monitoring window replayed','This activity window repeats one already submitted.'],
  AMBIENT_REPLAY:['Pre-login windows replayed','The pre-login activity repeats windows already consumed.'],
  AUTOMATION_RISK:['Automation detected','Independent bot signals combined leave no human explanation for this input.']};
const REASON={
  PASSWORD_INCORRECT:'the password was wrong',USERNAME_MISMATCH:'the typed username did not match the account',INVALID_CHALLENGE:'no such challenge was issued',
  EXPIRED_CHALLENGE:'the challenge had expired',EXPIRED_LOGIN:'the login attempt had expired',CHALLENGE_BINDING_MISMATCH:'the evidence was bound to a different challenge, user or browser session',
  NEW_DEVICE:'this browser is not enrolled for passive login',PASSIVE_PROFILE_MISSING:'no passive profile exists yet',INSUFFICIENT_PASSIVE_EVIDENCE:'the capture was too thin to judge',
  PASSIVE_IDENTITY_UNCERTAIN:'behavior did not match closely enough',PASSIVE_HUMANITY_UNCERTAIN:'some input looked scripted',AMBIENT_IDENTITY_UNCERTAIN:'pre-login behavior did not match',
  AMBIENT_CANNOT_RESCUE:'pre-login evidence may not lift a low passive score',FINAL_IDENTITY_MISMATCH:'the fused identity score fell below the threshold',IDENTITY_MISMATCH:'the challenge behavior did not match the profile',
  INSUFFICIENT_EVIDENCE:'the challenge was not completed cleanly',COARSE_TIMING:'the browser clock was too coarse',FOCUS_INTERRUPTED:'focus left the page mid-task',
  INCOMPATIBLE_DEVICE_MODALITY:'no profile exists for this kind of input device',INSUFFICIENT_COMPATIBLE_EXEMPLARS:'not enough compatible enrollment samples',STEP_UP_ENDPOINT_REQUIRED:'a bound step-up must be completed through its own endpoint',
  PROFILE_NOT_FOUND:'no profile exists',INSUFFICIENT_PASSIVE_TRAINING:'the round was too thin or interrupted to train from',
  FRESH_LOGIN_REQUIRED:'the session no longer corroborates the enrolled behavior',INSUFFICIENT_CONTINUOUS_EVIDENCE:'not enough activity to judge yet',AMBIENT_PROFILE_MISSING:'no free-form behavior profile is enrolled for monitoring',
  INVALID_OR_REUSED_WINDOW:'the monitoring window was invalid or reused',WINDOW_BINDING_MISMATCH:'the window was bound to a different session',EXPIRED_WINDOW:'the monitoring window had expired'};
const FRAUD_REASONS=new Set(['AUTOMATION_RISK','EXACT_REPLAY','NEAR_REPLAY','REPLAYED_CHALLENGE','REPLAYED_WINDOW','AMBIENT_REPLAY']);

const round=(v,d=2)=>Number.isFinite(v)?Number(v.toFixed(d)):null;
const pct=v=>Math.round(v*100)+'%';
function fmt(v,unit){
  if(!Number.isFinite(v))return 'n/a';
  switch(unit){
    case 'ms':return Math.round(v)+' ms';
    case 'ratio':return pct(v);
    case 'rad':return Math.round(v*180/Math.PI)+'°';
    case 'count':return round(v,1)+' keys';
    case 'speed':return round(v,2)+' widths/s';
    case 'accel':return Math.round(v)+' widths/s²';
    case 'curv':return round(v,2);
    case 'pos':return pct(v)+' across';
    default:return round(v,3);
  }
}
function featureLabel(name){
  const slot=name.match(/^pos:(\d+)(?:-(\d+))?:(dwell|dd)$/);
  if(slot)return slot[3]==='dwell'?`hold on character ${Number(slot[1])+1}`:`gap from character ${Number(slot[1])+1} to ${Number(slot[2])+1}`;
  if(name.startsWith('digraph:'))return `the "${name.slice(8)}" letter pair`;
  const keyHold=name.match(/^key:(.+):dwell$/);
  if(keyHold)return `hold on the "${keyHold[1]}" key`;
  return FEATURE[name]?.[0]??name.replace(/([A-Z])/g,' $1').toLowerCase();
}
function featureUnit(name){return name.startsWith('digraph:')||name.startsWith('key:')||name.startsWith('pos:')?'ms':FEATURE[name]?.[1]??'raw';}
function describe(term,prefix){
  const unit=featureUnit(term.name),label=featureLabel(term.name),context=/^(digraph|key):/.test(term.name);
  const lead=context?`${label[0].toUpperCase()+label.slice(1)}${prefix?' in the '+prefix.toLowerCase():''}`:prefix?prefix+' '+label:label[0].toUpperCase()+label.slice(1);
  const seen=fmt(term.value,unit),enrolled=fmt(term.center,unit);
  if(!Number.isFinite(term.z))return `${lead} was not measurable in this attempt.`;
  const more=unit==='ms'?['longer','shorter']:unit==='speed'?['faster','slower']:['higher','lower'];
  const direction=term.value>=term.center?more[0]:more[1];
  const relative=Math.abs(term.center)>1e-9&&unit!=='ratio'&&unit!=='pos'&&unit!=='rad'?`${pct(Math.abs(term.value-term.center)/Math.abs(term.center))} ${direction} than`:`${direction} than`;
  return `${lead} was ${relative} the enrolled median (${seen} vs ${enrolled}, ${round(term.z,1)} scales off).`;
}
function within(term,prefix){const label=featureLabel(term.name),lead=prefix&&!/^(di|tri)graph:/.test(term.name)?prefix+' '+label:label[0].toUpperCase()+label.slice(1);return `${lead} ${fmt(term.value,featureUnit(term.name))} sits inside the enrolled range (median ${fmt(term.center,featureUnit(term.name))}).`;}
const informative=(a,b)=>(featureUnit(b.name)==='ms')-(featureUnit(a.name)==='ms')||b.weight-a.weight||a.z-b.z;

function modalitySignal(key,score,weight,threshold,terms,quality,prefix){
  const label=MODALITY[key]??key,available=Number.isFinite(score);
  const signal={key,label,verdict:'unavailable',score:round(score,3),weight:round(weight,3),detail:''};
  if(!available){
    signal.detail=quality===0?`No usable ${label.toLowerCase()} evidence in this attempt (autofill, composition or nothing captured).`:terms&&!terms.length?`${label} is not part of this profile yet.`:`${label} could not be compared.`;
    return signal;
  }
  signal.verdict=score>=threshold?'match':'mismatch';
  const scored=(terms??[]).filter(t=>Number.isFinite(t.z)),off=scored.filter(t=>t.z>1.5).sort((a,b)=>b.z-a.z);
  if(scored.length){
    if(signal.verdict==='mismatch'||off.length)signal.detail=off.slice(0,2).map(t=>describe(t,prefix)).join(' ')||`${label} scored ${round(score,2)} against a bar of ${round(threshold,2)}, with no single feature far off.`;
    else{const best=scored.slice().sort(informative)[0];signal.detail=`${within(best,prefix)} ${scored.length} features compared, all within 1.5 scales.`;}
  }else signal.detail=`${label} scored ${round(score,2)} against a bar of ${round(threshold,2)}${Number.isFinite(quality)&&quality<1?` on ${pct(quality)} of the usual evidence`:''}.`;
  return signal;
}
function fraudEntries(codes){
  return [...new Set(codes.filter(Boolean))].map(code=>{const [label,detail]=SIGNAL[code]??[code.toLowerCase().replace(/_/g,' '),'Flagged by the automation detector.'];return {code,label,detail};});
}
function humanitySignal(result,fraud){
  const score=result.humanScore,minimum=result.humanMinimum??.8,hard=result.reasons?.includes('AUTOMATION_RISK');
  const verdict=hard||(Number.isFinite(score)&&score<minimum)?'suspicious':Number.isFinite(score)?'pass':'unavailable';
  const automation=fraud.filter(f=>!['EXACT_REPLAY','NEAR_REPLAY','REPLAYED_CHALLENGE','REPLAYED_WINDOW','AMBIENT_REPLAY'].includes(f.code));
  const detail=hard?`Hard automation: ${automation.filter(f=>f.code!=='AUTOMATION_RISK').map(f=>f.label.toLowerCase()).join(', ')||'combined bot signals'}.`
    :automation.length?`Weak hints only (${automation.map(f=>f.label.toLowerCase()).join(', ')}); humanity ${round(score,2)} against a floor of ${minimum}.`
    :Number.isFinite(score)?`No automation signals; timing jitter, path curvature and event provenance all look human (${round(score,2)}).`:'Not assessed.';
  return {key:'humanity',label:'Human, not scripted',verdict,score:round(score,2),weight:null,detail};
}
function freshnessSignal(result){
  const replay=(result.reasons??[]).find(r=>['EXACT_REPLAY','NEAR_REPLAY','REPLAYED_CHALLENGE','REPLAYED_WINDOW','AMBIENT_REPLAY'].includes(r));
  if(replay)return {key:'freshness',label:'Fresh, not replayed',verdict:'suspicious',score:null,weight:null,detail:SIGNAL[replay][1]};
  if(result.fresh===false)return {key:'freshness',label:'Fresh, not replayed',verdict:'suspicious',score:null,weight:null,detail:'One of the stages matched an earlier recording.'};
  return {key:'freshness',label:'Fresh, not replayed',verdict:result.fresh===true?'pass':'unavailable',score:null,weight:null,detail:result.fresh===true?'One-time challenge consumed; no exact or near match against recent recordings.':'Freshness was not evaluated for this result.'};
}
function evidenceSignal(result,core=null){
  const q=result.quality,min=result.qualityMinimum??null,thin=Number.isFinite(q)&&Number.isFinite(min)&&q<min||(result.reasons??[]).some(r=>r==='INSUFFICIENT_PASSIVE_EVIDENCE'||r==='INSUFFICIENT_EVIDENCE'||r==='INSUFFICIENT_CONTINUOUS_EVIDENCE');
  const missing=Object.entries(result.availability??{}).filter(([m,v])=>v==='UNAVAILABLE'&&(!core||core.includes(m))).map(([m])=>(MODALITY[m]??m).toLowerCase());
  return {key:'evidence',label:'Evidence quality',verdict:!Number.isFinite(q)?'unavailable':thin?'unavailable':'pass',score:round(q,2),weight:null,
    detail:!Number.isFinite(q)?'No evidence was scored.':`${pct(q)} of the evidence the profile expects${Number.isFinite(min)?` (floor ${pct(min)})`:''}${missing.length?`; missing: ${missing.join(', ')}`:''}${result.complete===false?'; capture ended mid-gesture':''}.`};
}
function deviceSignal(result){
  const state=result.deviceState;if(!state)return null;
  const trusted=state==='trusted';
  return {key:'device',label:'Device',verdict:trusted?'pass':(result.reasons??[]).includes('NEW_DEVICE')?'mismatch':'unavailable',score:null,weight:null,
    detail:trusted?'This browser installation holds a trained profile.':state==='candidate'?'This browser is a candidate: seen before but not yet promoted to trusted.':'This browser installation has no trained profile, so passive acceptance is not available here.'};
}
function ambientSignal(result){
  const a=result.ambient;if(!a)return null;
  const used=a.used===true,score=a.identityScore;
  return {key:'ambient',label:'Pre-login behavior',verdict:!used?'unavailable':(result.reasons??[]).includes('AMBIENT_IDENTITY_UNCERTAIN')?'mismatch':'match',score:round(score,3),weight:round(a.weight,3),
    detail:!used?`Pre-login activity was ${a.windows?'too thin to compare':'not captured'}; it can only withhold confidence, never supply it.`:`${a.windows} pre-login windows scored ${round(score,2)} against their own bar of ${round(a.threshold,2)}${a.lifted?' and lifted the fused score':''}.`};
}
function credentialSignal(result){
  if(!result.password)return null;
  return {key:'credential',label:'Password',verdict:result.password==='PASS'?'pass':result.password==='FAIL'?'mismatch':'unavailable',score:null,weight:null,
    detail:result.password==='PASS'?'Correct. A correct password is the entry ticket, not the decision.':result.password==='FAIL'?'Incorrect; behavior was not scored.':'Training round: no credential is checked.'};
}
function possessive(user){return user?`${user}'s profile`:'the enrolled profile';}
function list(items){return items.length<=1?items.join(''):items.slice(0,-1).join(', ')+' and '+items.at(-1);}

function identitySignal(result){
  const score=result.identityScore,accept=result.threshold,reject=result.rejectThreshold;
  if(!Number.isFinite(accept))return null;
  const clear=(result.reasons??[]).includes('IDENTITY_MISMATCH')||(result.reasons??[]).includes('FINAL_IDENTITY_MISMATCH');
  const verdict=!Number.isFinite(score)?'unavailable':score>=accept?'match':'mismatch';
  const detail=!Number.isFinite(score)?'No identity score: nothing to compare against.':clear?`${round(score,2)} is below the clear-mismatch bar of ${round(reject,2)}: too far from this person's own range to be a bad day. Blocked on behavior alone.`
    :score>=accept?`${round(score,2)} clears the accept bar of ${round(accept,2)}, set where this person's own weakest enrollment round landed.`
    :Number.isFinite(reject)?`${round(score,2)} sits between the clear-mismatch bar (${round(reject,2)}) and the accept bar (${round(accept,2)}): uncertain on its own, the band an active challenge settles.`:`${round(score,2)} is below the accept bar of ${round(accept,2)}.`;
  return {key:'identity',label:'Identity',verdict,score:round(score,3),weight:null,detail,threshold:round(accept,3),rejectThreshold:Number.isFinite(reject)?round(reject,3):null};
}
function passiveExplanation(result,user){
  const threshold=result.threshold??.85,fw=result.fusionWeights??{},eq=result.evidenceQuality??{},mt=result.modalityThresholds??{};
  const signals=[];
  const identity=identitySignal(result);if(identity)signals.push(identity);
  for(const m of ORDER)if(m in (result.modalities??{}))signals.push(modalitySignal(m,result.modalities[m],fw[m]??null,mt[m]??threshold,result.features?.[m],eq[m],m==='username'?'Username':m==='password'?'Password':''));
  const fraud=fraudEntries([...(result.reasons??[]).filter(r=>FRAUD_REASONS.has(r)),...(result.signals??[])]);
  signals.push(humanitySignal(result,fraud),freshnessSignal(result),evidenceSignal(result));
  const device=deviceSignal(result),ambient=ambientSignal(result),credential=credentialSignal(result);
  if(device)signals.push(device);if(ambient)signals.push(ambient);if(credential)signals.push(credential);
  return finish(result,user,signals,fraud,'passive');
}
function activeExplanation(result,user){
  const threshold=result.threshold??.75,fw=result.fusionWeights??{};
  const signals=[];
  for(const m of ['keyboard','pointer'])if(m in (result.modalities??{}))signals.push(modalitySignal(m,result.modalities[m],fw[m]??1,threshold,result.features?.[m],result.evidenceQuality?.[m],m==='keyboard'?'Phrase':'Target'));
  for(const [m,score] of Object.entries(result.modalities??{}))if(!['keyboard','pointer'].includes(m))signals.push(modalitySignal(m,score,null,threshold,null,result.evidenceQuality?.[m],''));
  const fraud=fraudEntries([...(result.reasons??[]).filter(r=>FRAUD_REASONS.has(r)),...(result.signals??[]),...(result.automation?.signals??[]).map(s=>s.code)]);
  signals.push(humanitySignal({...result,humanMinimum:.6},fraud),freshnessSignal(result),evidenceSignal({...result,qualityMinimum:1},['keyboard','pointer','crossModal']));
  const device=deviceSignal(result);if(device)signals.push(device);
  return finish(result,user,signals,fraud,'active');
}
function finalExplanation(result,user){
  const passive=result.passive?passiveExplanation(result.passive,user):null,active=result.active?activeExplanation(result.active,user):null;
  const w=result.fusionWeights??{};
  const signals=[];
  const identity=identitySignal(result);if(identity)signals.push(identity);
  if(passive)signals.push({key:'passiveStage',label:'Passive login stage',verdict:passive.confidence===null?'unavailable':passive.confidence>=(result.passive.threshold??.85)?'match':'mismatch',score:passive.confidence,weight:round(w.passive,3),detail:passive.headline});
  for(const s of active?.signals??[])if(!['humanity','freshness','evidence','device'].includes(s.key))signals.push({...s,weight:s.weight===null?null:round((w.active??0)*s.weight,3)});
  const fraud=fraudEntries([...(result.reasons??[]).filter(r=>FRAUD_REASONS.has(r)),...(active?.fraud??[]).map(f=>f.code),...(passive?.fraud??[]).map(f=>f.code)]);
  signals.push(humanitySignal(result,fraud),freshnessSignal(result));
  if(active)signals.push(...active.signals.filter(s=>s.key==='evidence'||s.key==='device'));
  return finish(result,user,signals,fraud,'final');
}
function monitorExplanation(result,user){
  const threshold=result.threshold??.6,eq=result.evidenceQuality??{};
  const signals=[];
  for(const m of ORDER)if(m in (result.modalities??{}))signals.push(modalitySignal(m,result.modalities[m],null,threshold,null,eq[m],''));
  const fraud=fraudEntries([...(result.reasons??[]).filter(r=>FRAUD_REASONS.has(r)),...(result.signals??[])]);
  signals.push(humanitySignal({...result,humanMinimum:.7},fraud),freshnessSignal(result),evidenceSignal(result));
  return finish(result,user,signals,fraud,'monitor');
}

function finish(result,user,signals,fraud,kind){
  const decision=result.decision??'REJECT',reasons=result.reasons??[],confidence=Number.isFinite(result.identityScore)?round(result.identityScore,3):null;
  const threshold=Number.isFinite(result.threshold)?round(result.threshold,3):null;
  const modal=signals.filter(s=>['match','mismatch'].includes(s.verdict)&&!['passiveStage','ambient','identity'].includes(s.key)||s.key==='passiveStage');
  const matched=modal.filter(s=>s.verdict==='match').map(s=>s.label.toLowerCase()),off=modal.filter(s=>s.verdict==='mismatch').map(s=>s.label.toLowerCase());
  const worst=modal.filter(s=>s.verdict==='mismatch').sort((a,b)=>(a.score??1)-(b.score??1))[0];
  const who=possessive(user);
  const automation=fraud.filter(f=>f.code!=='AUTOMATION_RISK'),hard=result.hardSignals?.length?automation.filter(f=>result.hardSignals.includes(f.code)):automation;
  const named=(hard.length?hard:automation).slice(0,3),extra=automation.length-named.length;
  const fraudLabels=extra>0?named.map(f=>f.label.toLowerCase()).join(', ')+`, and ${extra} more`:list(named.map(f=>f.label.toLowerCase()));
  const said=reasons.filter(r=>!FRAUD_REASONS.has(r)).map(r=>REASON[r]??r.toLowerCase().replace(/_/g,' '));
  let headline,summary;
  const scoreLine=confidence!==null&&threshold!==null?`Identity ${confidence.toFixed(2)} against a bar of ${threshold.toFixed(2)}.`:'';
  if(fraud.length&&(decision==='REJECT'||reasons.some(r=>FRAUD_REASONS.has(r)))){
    const replay=fraud.find(f=>['EXACT_REPLAY','NEAR_REPLAY','REPLAYED_CHALLENGE','REPLAYED_WINDOW','AMBIENT_REPLAY'].includes(f.code));
    headline=replay?`Blocked: ${replay.label.toLowerCase()} detected; this is a recording, not a person.`:`Blocked: scripted input detected (${fraudLabels||'automation signals'}).`;
    summary=`${replay?replay.detail:'The password may be right, but the input was not produced by a hand: '+fraud.filter(f=>f.code!=='AUTOMATION_RISK').map(f=>f.detail).join(' ')} Flagged as fraud, separately from identity.`;
  }else if(decision==='ACCEPT'){
    headline=`Accepted: ${list(matched)||'behavior'} match${matched.length===1?'es':''} ${who}${confidence!==null?` (confidence ${confidence.toFixed(2)})`:''}.`;
    const best=signals.find(s=>s.verdict==='match'&&s.detail&&s.key!=='identity');
    summary=`${scoreLine} ${best?best.detail:''}${off.length?` ${list(off)} sat below the bar but the fused score cleared it.`:''} No automation or replay signals.`.trim();
  }else if(decision==='STEP_UP'){
    const cause=reasons.includes('NEW_DEVICE')?'this browser is not enrolled for passive login':reasons.includes('PASSIVE_PROFILE_MISSING')?'no passive profile exists yet':reasons.includes('INSUFFICIENT_PASSIVE_EVIDENCE')?'the capture was too thin to judge':reasons.includes('PASSIVE_HUMANITY_UNCERTAIN')?'some input looked scripted':off.length?`${list(off)} did not match ${who} closely enough`:reasons.includes('FRESH_LOGIN_REQUIRED')?'the session stopped corroborating the enrolled behavior':said[0]??'confidence was not high enough';
    headline=kind==='monitor'?`Fresh login required: ${cause}.`:`Extra check: password correct, but ${cause}.`;
    summary=`${scoreLine} ${worst?worst.detail:''} ${kind==='monitor'?'Monitoring cannot grant access; it only decides when to ask again.':'Not rejected: an active challenge will settle it, with no OTP fallback.'}`.replace(/\s+/g,' ').trim();
  }else if(decision==='REJECT'){
    const identity=reasons.includes('FINAL_IDENTITY_MISMATCH')||reasons.includes('IDENTITY_MISMATCH');
    headline=identity?kind==='final'?`Blocked: ${list(off)||'behavior'} did not match ${who}; fused identity ${confidence?.toFixed(2)??'n/a'} fell short of ${threshold?.toFixed(2)??'the bar'}.`:`Blocked: ${list(off)||'behavior'} ${off.length===1?'does':'do'} not match ${who}.`:`Blocked: ${said[0]??'the attempt failed'}.`;
    summary=identity?`${scoreLine} ${worst?worst.detail:''} The password was correct; behavior alone made the decision.`.replace(/\s+/g,' ').trim():`${list(said)||'The attempt failed'}${said.length?'':''}. Behavior was ${confidence!==null?'scored but could not override the gate':'not scored'}.`;
  }else if(decision==='SAMPLE_ACCEPTED'){
    headline=`Training round accepted${Number.isFinite(result.roundsAccepted)?` (${result.roundsAccepted} so far)`:''}.`;
    summary=`Complete, human-looking capture at ${pct(result.quality??0)} quality. Nothing is matched during training; the rounds calibrate ${who}.`;
  }else if(decision==='MORE_DATA'){
    headline=kind==='monitor'?'Not enough activity to judge yet.':`More data needed: ${said[0]??'the round was too thin'}.`;
    summary=`${signals.find(s=>s.key==='evidence')?.detail??''} ${kind==='monitor'?'The session continues unchanged.':'Nothing is decided from an incomplete capture.'}`.trim();
  }else if(decision==='OBSERVE'){
    headline=`Session behavior continues to match ${who}${confidence!==null?` (${confidence.toFixed(2)})`:''}.`;
    summary=`${scoreLine} ${signals.find(s=>s.verdict==='match')?.detail??''} Monitoring renews the session from evidence only.`.replace(/\s+/g,' ').trim();
  }else{headline=`${decision}: ${list(said)||'see reasons'}.`;summary=scoreLine||headline;}
  return {verdict:decision,headline,summary,confidence,thresholds:{accept:threshold,reject:Number.isFinite(result.rejectThreshold)?round(result.rejectThreshold,3):null},signals,fraud};
}

export function explain(result,{kind='passive',user=null}={}){
  if(!result||typeof result!=='object')return null;
  const build=kind==='final'?finalExplanation:kind==='active'?activeExplanation:kind==='monitor'?monitorExplanation:passiveExplanation;
  return build(result,user);
}
export function annotate(result,options={},latencyMs=null){
  const explanation=explain(result,options);
  if(explanation){result.explanation=explanation;result.fraudSignals=explanation.fraud.map(f=>f.code);}
  if(Number.isFinite(latencyMs))result.latencyMs=Number(latencyMs.toFixed(3));
  return result;
}
