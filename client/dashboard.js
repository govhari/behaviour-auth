
export const words=s=>String(s??'').replaceAll('_',' ').toLowerCase();
const num=(v,d=2)=>Number.isFinite(v)?v.toFixed(d):'—';
const pct=v=>Number.isFinite(v)?`${Math.round(v*100)}%`:'—';
const clamp=v=>Math.max(0,Math.min(1,v));

const STATE={
  ACCEPT:['ACCEPTED','good'],STEP_UP:['STEP-UP','warn'],REJECT:['BLOCKED','bad'],
  SAMPLE_ACCEPTED:['ROUND ACCEPTED','good'],MORE_DATA:['REDO ROUND','warn'],
  UNAVAILABLE:['NO PROFILE','warn'],CANCELLED:['CANCELLED','warn'],ENROLLED:['ENROLLED','good'],ERROR:['ERROR','bad'],
};
const SIGNAL_LABELS={username:'Username rhythm',password:'Password rhythm',pointer:'Mouse path',click:'Button click',crossModal:'Hand-off timing',keyboard:'Typing rhythm',scroll:'Scrolling',rhythm:'Rhythm'};

const FRAUD={
  AUTOMATION_RISK:['Automation detected','no human behavioral signature'],
  EXACT_REPLAY:['Exact replay','these exact events were already seen'],
  NEAR_REPLAY:['Near replay','almost identical to an earlier recording'],
  AMBIENT_REPLAY:['Replayed pre-login behavior','ambient window seen before'],
  SYNTHETIC_EVENT_HINT:['Synthetic input events','browser flagged the events as script-generated'],
  WEBDRIVER_HINT:['Automation driver','navigator.webdriver is set'],
  UNIFORM_USERNAME_TIMING:['Uniform keystroke timing','username typed at one fixed interval'],
  UNIFORM_PASSWORD_TIMING:['Uniform keystroke timing','password typed at one fixed interval'],
  LOW_ENTROPY_USERNAME_TIMING:['Low-entropy timing','username rhythm too regular'],
  LOW_ENTROPY_PASSWORD_TIMING:['Low-entropy timing','password rhythm too regular'],
  IMPLAUSIBLE_USERNAME_TIMING:['Impossibly fast keys','username key holds shorter than a human can'],
  IMPLAUSIBLE_PASSWORD_TIMING:['Impossibly fast keys','password key holds shorter than a human can'],
  IMPLAUSIBLE_CROSS_MODAL_TIMING:['Impossible hand-off','keyboard to mouse with no transition time'],
  PERIODIC_POINTER_SAMPLING:['Machine-periodic pointer','samples arrived on a fixed clock'],
  PERFECT_POINTER_GEOMETRY:['Perfectly straight pointer path','no curvature or correction at all'],
  PASSWORD_INCORRECT:['Wrong password','credential check failed'],
  USERNAME_MISMATCH:['Username mismatch','typed name differs from the claimed account'],
};
const REASON_TEXT={
  PASSIVE_PROFILE_MISSING:'no behavioral profile for this account yet',
  NEW_DEVICE:'this browser has not been trained for the account',
  INSUFFICIENT_PASSIVE_EVIDENCE:'not enough usable typing and pointer evidence',
  PASSIVE_IDENTITY_UNCERTAIN:'the rhythm did not clearly match the enrolled profile',
  PASSIVE_HUMANITY_UNCERTAIN:'the capture did not look hand-made',
  AMBIENT_IDENTITY_UNCERTAIN:'pre-login behavior disagreed with this person',
  AMBIENT_CANNOT_RESCUE:'pre-login behavior cannot lift a low score',
  IDENTITY_MISMATCH:'the active check did not match the enrolled profile',
  FINAL_IDENTITY_MISMATCH:'combined evidence did not match the enrolled profile',
  INSUFFICIENT_EVIDENCE:'the challenge was not completed cleanly',
  INSUFFICIENT_PASSIVE_TRAINING:'not enough natural typing and mouse movement in this round',
  STEP_UP_DECLINED:'the extra check was declined',
  INCOMPATIBLE_DEVICE_MODALITY:'this input mode was never enrolled',
  INSUFFICIENT_COMPATIBLE_EXEMPLARS:'not enough comparable enrollment rounds',
  PROFILE_NOT_FOUND:'no profile for this account',
  EXPIRED_CHALLENGE:'the login took too long; try again',
  EXPIRED_LOGIN:'the login took too long; try again',
  MISSING_SUBMIT:'the form was never submitted',
  CAPTURE_LIMIT_REACHED:'too much input was recorded',
};

const verdictFor=(score,gate,available=true)=>!available||!Number.isFinite(score)?'unavailable':score>=gate?'match':score>=gate-.15?'uncertain':'mismatch';

export function explain(result,{user='',source='human'}={}){
  if(result?.explanation&&typeof result.explanation==='object'){
    const x=result.explanation;
    return {
      verdict:x.verdict??result.decision,headline:x.headline??'',summary:x.summary??'',
      confidence:Number.isFinite(x.confidence)?x.confidence:(result.fusedIdentityScore??result.identityScore??null),
      signals:Array.isArray(x.signals)?x.signals:[],fraud:Array.isArray(x.fraud)?x.fraud:[],
    };
  }
  const r=result??{},reasons=r.reasons??[],decision=r.enrolled?'ENROLLED':r.decision??(r.unavailable?'UNAVAILABLE':'ERROR');
  const name=user||r.userId||'this account';
  const fraudCodes=[...new Set([...reasons.filter(c=>FRAUD[c]),...(r.signals??[]).filter(c=>FRAUD[c]),...(r.passive?.signals??[]).filter(c=>FRAUD[c])])];
  const fraud=fraudCodes.map(code=>({code,label:FRAUD[code][0],detail:FRAUD[code][1]}));
  const signals=[];
  const passive=r.phase==='final'?r.passive??{}:r;
  const threshold=passive.threshold??r.threshold;
  const eq=passive.evidenceQuality??{},mods=passive.modalities??{},fw=passive.fusionWeights??{};
  for(const key of ['username','password','pointer','click','crossModal']){
    if(!(key in eq)&&!(key in mods))continue;
    const q=eq[key],s=mods[key],available=q!==0&&Number.isFinite(s);
    signals.push({key,label:SIGNAL_LABELS[key],verdict:verdictFor(s,Number.isFinite(threshold)?threshold:.85,available),score:available?s:null,weight:fw[key]??null,
      detail:q===0?'no usable evidence':!Number.isFinite(s)?`captured · ${pct(q)} evidence`:`${num(s)} similarity · ${pct(q)} evidence`});
  }
  if(r.phase==='final'&&r.active){
    const a=r.active;
    signals.push({key:'active',label:'Active check',verdict:verdictFor(a.identityScore,a.threshold??.75,Number.isFinite(a.identityScore)),score:a.identityScore??null,weight:r.fusionWeights?.active??null,
      detail:Number.isFinite(a.identityScore)?`${num(a.identityScore)} vs ${num(a.threshold)} · ${words(a.decision)}`:words(a.decision)||'—'});
  }
  const amb=passive.ambient??r.ambient;
  if(amb&&(amb.used||Number.isFinite(amb.identityScore))){
    signals.push({key:'ambient',label:'Pre-login behavior',verdict:amb.used?verdictFor(amb.identityScore,amb.threshold??.7):'unavailable',score:amb.identityScore??null,weight:amb.weight??null,
      detail:amb.used?`${num(amb.identityScore)} vs ${num(amb.threshold)} · ${amb.windows} window${amb.windows===1?'':'s'}`:`not used${amb.reasons?.length?` · ${amb.reasons.map(words).join(', ')}`:''}`});
  }
  if(r.password)signals.push({key:'password',label:'Password',verdict:r.password==='FAIL'?'mismatch':'pass',score:null,detail:r.password==='TRAINING'?'training round':r.password==='PASS'?'correct':'incorrect'});
  if(Number.isFinite(r.humanScore)){const gate=r.humanMinimum??.8;signals.push({key:'human',label:'Human rhythm',verdict:r.humanScore>=gate?'pass':'suspicious',score:r.humanScore,detail:`${num(r.humanScore)} · needs ${num(gate)}`});}
  if(typeof r.fresh==='boolean')signals.push({key:'fresh',label:'Fresh evidence',verdict:r.fresh?'pass':'suspicious',score:null,detail:r.fresh?'never seen before':'seen before'});
  if(r.deviceState)signals.push({key:'device',label:'Known device',verdict:r.deviceState==='trusted'?'pass':'unavailable',score:null,detail:r.deviceState==='trusted'?'trained on this browser':'new browser for this account'});

  const score=r.fusedIdentityScore??r.identityScore??null;
  let headline='',summary='';
  const said=reasons.map(c=>REASON_TEXT[c]??words(c)).filter(Boolean);
  if(decision==='ENROLLED'){headline=r.deviceOnly?'This device is now trusted':`${name} is enrolled`;summary=r.deviceOnly?'Passive profile added for this browser. Existing profiles were kept.':`${r.passiveRounds??''} typing rounds and ${r.activeRounds??''} movement rounds learned${r.ambient?.enrolled?', plus a pre-login model':''}. Log in below to try it.`;}
  else if(decision==='ACCEPT'){headline=`Behavior matches ${name}`;summary=Number.isFinite(score)?`Identity ${num(score)} cleared the ${num(r.threshold)} threshold ${r.phase==='final'?'after the active check':'from the login form alone'}. Password correct, evidence fresh, human rhythm.`:'Accepted.';}
  else if(decision==='STEP_UP'){headline='Not sure enough yet — one quick check';summary=`The login form alone could not reach ACCEPT: ${said.join('; ')||'more evidence needed'}.`;}
  else if(decision==='REJECT'){
    const lead=reasons[0];
    if(lead==='AUTOMATION_RISK'){const hint=fraud.find(f=>f.code!=='AUTOMATION_RISK');headline=`Automation detected${hint?`: ${hint.label.toLowerCase()}`:''}`;summary=source==='bot'?'Correct password. Blocked: no human behavioral signature.':'The password was right, but the input did not carry a human behavioral signature.';}
    else if(lead==='EXACT_REPLAY'||lead==='NEAR_REPLAY'){headline='Replayed behavior';summary='Correct password and a genuine recording — but BioPrint had already seen exactly this behavior. Blocked: evidence must be fresh every time.';}
    else if(lead==='PASSWORD_INCORRECT'){headline='Wrong password';summary='The credential check failed before any behavior was compared.';}
    else if(lead==='USERNAME_MISMATCH'){headline='Username does not match the account';summary='The typed username differs from the account this login was started for.';}
    else if(lead==='IDENTITY_MISMATCH'||lead==='FINAL_IDENTITY_MISMATCH'){headline=`Behavior does not match ${name}`;summary=`Correct password, wrong rhythm. Identity ${num(score)} stayed below the ${num(r.threshold)} threshold.`;}
    else {headline='Blocked';summary=said.join('; ')||'The server rejected this attempt.';}
  }
  else if(decision==='SAMPLE_ACCEPTED'){headline='Round accepted';summary=`Capture quality ${num(r.observedQuality??r.quality)} · human rhythm ${num(r.humanScore)}. Learning how ${name} types and moves.`;}
  else if(decision==='MORE_DATA'){headline='Round not usable';summary=`${said.join('; ')||'not enough evidence'}. Type both fields by hand and click the button with your mouse, then try the round again.`;}
  else if(decision==='UNAVAILABLE'){headline=`No behavioral profile for ${name}`;summary='Enroll the account first, then log in.';}
  else if(decision==='CANCELLED'){headline='Cancelled';summary='The check was cancelled before it was scored.';}
  else {headline=words(decision).toUpperCase()||'Result';summary=said.join('; ');}
  return {verdict:decision,headline,summary,confidence:score,signals,fraud};
}

export function createDashboard(root){
  const $=id=>root.querySelector('#'+id);
  const card=$('verdict-card');
  const setText=(id,text,tone)=>{const el=$(id);el.textContent=text??'—';el.className=tone?tone:'';};

  const render=(result,{roundTripMs=null,source='human',user='',latencyLabel=null}={})=>{
    const x=explain(result,{user,source});
    const [label,tone]=STATE[x.verdict]??STATE[result?.decision]??[String(x.verdict??'RESULT').replaceAll('_',' '),'warn'];
    card.dataset.state=tone;
    $('verdict-state').textContent=label;
    $('verdict-headline').textContent=x.headline;
    $('verdict-summary').textContent=x.summary;
    const src=$('verdict-source');src.textContent=source==='bot'?'SCRIPTED BOT':source==='replay'?'REPLAY ATTACK':source==='enrollment'?'ENROLLMENT':source==='stepup'?'ACTIVE CHECK':'LIVE LOGIN';
    src.className=`badge ${tone}`;

    const training=Number.isFinite(result?.trainingMinimum)||result?.decision==='SAMPLE_ACCEPTED';
    const value=training?(result.observedQuality??result.quality):x.confidence;
    const gate=training?result.trainingMinimum:(result?.threshold??null);
    $('conf-label').textContent=training?'capture quality':'identity confidence';
    $('conf-value').textContent=Number.isFinite(value)?num(value):'—';
    const fill=$('conf-fill'),mark=$('conf-mark');
    fill.style.width=Number.isFinite(value)?`${clamp(value)*100}%`:'0%';
    fill.dataset.state=!Number.isFinite(value)?'none':!Number.isFinite(gate)?'warn':value>=gate?'pass':'fail';
    if(Number.isFinite(gate)){mark.hidden=false;mark.style.left=`${clamp(gate)*100}%`;$('conf-gate').textContent=`${training?'minimum':'threshold'} ${num(gate)} · ${Number.isFinite(value)?value>=gate?'cleared':'not cleared':'no comparison'}`;}
    else {mark.hidden=true;$('conf-gate').textContent=Number.isFinite(value)?'no threshold reported':(result?.decision==='REJECT'?'no comparison made — blocked before matching':'no profile to compare against');}

    const server=result?.latencyMs??result?.verificationMs;
    setText('latency',latencyLabel??(Number.isFinite(server)||Number.isFinite(roundTripMs)
      ?`${Number.isFinite(server)?`${server<1?server.toFixed(1):Math.round(server)} ms`:'—'}${Number.isFinite(roundTripMs)?` · ${Math.round(roundTripMs)} ms trip`:''}`:'—'));
    $('latency').title=Number.isFinite(server)?`Server decided in ${num(server,1)} ms; browser round trip ${Math.round(roundTripMs??0)} ms`:'';
    const pw=result?.password;
    setText('password-state',pw==='PASS'?'correct':pw==='FAIL'?'wrong':pw==='TRAINING'?'training':'—',pw==='PASS'?'good':pw==='FAIL'?'bad':'');
    const hs=result?.humanScore,hm=result?.humanMinimum??.8;
    setText('human-value',Number.isFinite(hs)?num(hs):'—',Number.isFinite(hs)?(hs>=hm?'good':'bad'):'');
    const q=result?.quality??result?.observedQuality,qm=result?.qualityMinimum??result?.trainingMinimum??.75;
    setText('quality-value',Number.isFinite(q)?pct(q):'—',Number.isFinite(q)?(q>=qm?'good':'warn'):'');

    const fraud=$('fraud');fraud.replaceChildren(...x.fraud.map(f=>{const s=document.createElement('span');s.textContent=f.label;if(f.detail)s.title=f.detail;if(tone!=='bad')s.className='warn';return s;}));
    const list=$('signals');list.replaceChildren(...x.signals.map(s=>{
      const li=document.createElement('li');
      const name=document.createElement('span');name.className='name';name.textContent=s.label??SIGNAL_LABELS[s.key]??words(s.key);
      const pill=document.createElement('span');pill.className='pill';pill.dataset.v=s.verdict??'info';pill.textContent=words(s.verdict??'info');
      const bar=document.createElement('span');bar.className='bar';const i=document.createElement('i');i.dataset.v=s.verdict??'info';i.style.width=Number.isFinite(s.score)?`${clamp(s.score)*100}%`:'0%';bar.append(i);
      const score=document.createElement('span');score.className='score';score.textContent=Number.isFinite(s.score)?num(s.score):'';
      const detail=document.createElement('span');detail.className='detail';detail.textContent=s.detail??'';
      li.append(name,pill,bar,score,detail);return li;
    }));
    $('raw').textContent=JSON.stringify(result,null,2);
    return x;
  };

  const idle=(state,headline,summary)=>{card.dataset.state='idle';$('verdict-state').textContent=state;$('verdict-headline').textContent=headline;$('verdict-summary').textContent=summary??'';$('verdict-source').textContent='WAITING';$('verdict-source').className='badge';};
  return {render,idle};
}

export function createLiveStrip({keys,path,keysCount,pathCount}){
  const kctx=keys.getContext('2d'),pctx=path.getContext('2d');
  let intervals=[],points=[],lastDown=null,frame=null,keyTotal=0,pointTotal=0;
  const accent=getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()||'#5eead4';
  const faint=getComputedStyle(document.documentElement).getPropertyValue('--faint').trim()||'#5f6f82';
  const draw=()=>{
    frame=null;
    const W=keys.width,H=keys.height;kctx.clearRect(0,0,W,H);
    const n=Math.max(24,intervals.length),bw=W/n,max=Math.max(300,...intervals);
    intervals.forEach((v,i)=>{const h=Math.max(2,(Math.min(v,max)/max)*(H-8));kctx.fillStyle=v>600?faint:accent;kctx.globalAlpha=.55+.45*(i/intervals.length);kctx.fillRect(i*bw+1,H-h-2,Math.max(2,bw-2),h);});
    kctx.globalAlpha=1;
    const PW=path.width,PH=path.height;pctx.clearRect(0,0,PW,PH);
    if(points.length>1){pctx.strokeStyle=accent;pctx.lineWidth=1.5;pctx.lineJoin='round';pctx.beginPath();points.forEach((p,i)=>{const x=p.x*(PW-6)+3,y=p.y*(PH-6)+3;i?pctx.lineTo(x,y):pctx.moveTo(x,y);});pctx.stroke();}
    for(const p of points.filter(p=>p.click)){pctx.fillStyle='#fb7185';pctx.beginPath();pctx.arc(p.x*(PW-6)+3,p.y*(PH-6)+3,3,0,Math.PI*2);pctx.fill();}
    if(keysCount)keysCount.textContent=String(keyTotal);if(pathCount)pathCount.textContent=String(pointTotal);
  };
  const schedule=()=>{if(!frame)frame=requestAnimationFrame(draw);};
  return {
    event(e){
      if(e.type==='keydown'){keyTotal++;if(lastDown!==null)intervals.push(Math.max(1,e.t-lastDown));lastDown=e.t;if(intervals.length>48)intervals=intervals.slice(-48);schedule();}
      else if(e.type==='move'){pointTotal++;points.push({x:e.x,y:e.y});if(points.length>240)points=points.slice(-240);schedule();}
      else if(e.type==='down'){points.push({x:e.x,y:e.y,click:true});schedule();}
    },
    reset(){intervals=[];points=[];lastDown=null;keyTotal=0;pointTotal=0;schedule();},
  };
}
