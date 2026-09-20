import { h } from './ui.js';
import { AMBIENT_TYPING_BURST } from '/sdk/ambient.js';

const pct=v=>Number.isFinite(v)?`${Math.round(v*100)}%`:'—';
const num=(v,d=3)=>Number.isFinite(v)?v.toFixed(d):'—';
const words=s=>String(s??'').replaceAll('_',' ').toLowerCase();
const clock=()=>new Date().toLocaleTimeString(undefined,{hour12:false});

const TONE={ACCEPT:'good',SAMPLE_ACCEPTED:'good',OBSERVE:'good',
  STEP_UP:'warn',MORE_DATA:'warn',UNAVAILABLE:'warn',
  REJECT:'bad',CANCELLED:'bad'};

export function createHud(mount){
  const rows={},bars={},sections={};

  const bar=(key,label,{gate='threshold'}={})=>{
    const fill=h('span',{class:'hud-fill'});
    const mark=h('span',{class:'hud-mark',hidden:true});
    const value=h('b',{class:'hud-num',textContent:'—'});
    const gateText=h('i',{class:'hud-gate',textContent:''});
    bars[key]={fill,mark,value,gateText,gate};
    return h('div',{class:'hud-bar'},
      h('div',{class:'hud-bar-head'},h('span',{textContent:label}),value),
      h('div',{class:'hud-track'},fill,mark),
      gateText,
    );
  };

  const row=(key,label)=>{
    const value=h('dd',{textContent:'—'});rows[key]=value;
    return h('div',{},h('dt',{textContent:label}),value);
  };

  const section=(key,title,...children)=>{
    const body=h('div',{class:'hud-body'},...children);
    const head=h('button',{class:'hud-head',type:'button','aria-expanded':'true',onclick:()=>{
      const open=body.hidden;body.hidden=!open;head.setAttribute('aria-expanded',String(open));
      head.dataset.open=String(open);
    }},h('span',{textContent:title}),h('em',{class:'hud-badge',textContent:''}));
    head.dataset.open='true';
    sections[key]={head,body,badge:head.querySelector('.hud-badge')};
    return h('section',{class:'hud-section'},head,body);
  };

  const passiveMods={},ambientMods={};
  const modalities=(store,...names)=>h('div',{class:'hud-mods'},...names.map(name=>{
    const fill=h('span',{class:'hud-fill'});
    const tag=h('em',{textContent:'—'});
    store[name]={fill,tag};
    return h('div',{class:'hud-mod'},
      h('span',{class:'hud-mod-name',textContent:name}),
      h('span',{class:'hud-track thin'},fill),
      tag,
    );
  }));
  const paintMods=(store,quality,availability)=>{
    for(const [name,node] of Object.entries(store)){
      const value=quality?.[name];
      const present=availability?.[name]==='AVAILABLE';
      const width=Number.isFinite(value)?Math.max(0,Math.min(1,value)):(present?1:0);
      node.fill.style.width=`${width*100}%`;
      node.fill.dataset.state=width===0?'none':Number.isFinite(value)?(value>=.75?'pass':'warn'):'pass';
      node.tag.textContent=availability?.[name]==='UNAVAILABLE'?'none'
        :Number.isFinite(value)?pct(value):present?'present':'—';
      node.tag.className=availability?.[name]==='UNAVAILABLE'?'tone-bad':present?'tone-good':'';
    }
  };

  const stages=['recorded','validated','decided'].map(name=>
    h('li',{class:'hud-stage',dataset:{stage:name}},h('i',{}),h('span',{textContent:name})));
  const stageList=h('ol',{class:'hud-stages'},...stages);
  const stageNote=h('p',{class:'hud-note',textContent:'No capture yet.'});

  const feedList=h('ol',{class:'hud-feed'});
  const feedCount=h('span',{class:'hud-feed-count',textContent:'0 events'});
  let feedPaused=true,feedTotal=0,feedQueue=[],feedFrame=null;
  let ambientTyped=0,ambientSent=0,ambientTypedTotal=0,ambientKeyWindows=0;
  const feedPause=h('button',{class:'hud-feed-btn',type:'button',textContent:'resume',dataset:{on:'true'},onclick:()=>{
    feedPaused=!feedPaused;feedPause.textContent=feedPaused?'resume':'pause';
    feedPause.dataset.on=String(feedPaused);
    if(!feedPaused)flushFeed();
  }});
  const feedClear=h('button',{class:'hud-feed-btn',type:'button',textContent:'clear',
    onclick:()=>{feedList.replaceChildren();feedQueue=[];}});
  const held=new Map();

  const describe=(e,source)=>{
    if(e.type==='keydown'){held.set(`${source}:${e.field??''}:${e.position}`,e.t);
      return ['key',`down · ${e.action}`,`#${e.position}${e.field?` ${e.field}`:''}`];}
    if(e.type==='keyup'){
      const key=`${source}:${e.field??''}:${e.position}`,down=held.get(key);held.delete(key);
      return ['key',`up · ${e.action}`,
        `#${e.position}${Number.isFinite(down)?` · dwell ${Math.round(e.t-down)}ms`:''}`];}
    if(e.type==='move')return ['ptr','move',`x ${e.x.toFixed(3)}  y ${e.y.toFixed(3)}`];
    if(e.type==='down'||e.type==='up')return ['ptr',e.type==='down'?'press':'release',
      `x ${e.x.toFixed(3)}  y ${e.y.toFixed(3)}${e.target?` · ${e.target}`:''}`];
    if(e.type==='scroll')return ['scr','scroll',`depth ${Math.round(e.position*100)}%`];
    if(e.type==='wheel')return ['scr','wheel',`dy ${Math.round(e.deltaY)}`];
    if(e.type==='focus')return ['win',e.active?'focus in':'focus out',e.field??''];
    if(e.type==='input')return ['key','input',e.source];
    if(e.type==='view')return ['nav','view',e.view];
    if(e.type==='submit')return ['win','submit',e.method];
    if(e.type==='cancel')return ['ptr','cancel',''];
    return ['·',e.type,''];
  };

  const flushFeed=()=>{
    feedFrame=null;
    if(!feedQueue.length)return;
    const batch=feedQueue;feedQueue=[];
    feedList.prepend(...batch.reverse());
    while(feedList.children.length>150)feedList.lastChild.remove();
  };

  const gateList=h('ul',{class:'hud-gates'});
  const termList=h('div',{class:'hud-terms'});
  const formulaNote=h('p',{class:'hud-note',textContent:'No decision yet.'});
  const termNote=h('p',{class:'hud-note',textContent:''});

  const activeMods={};
  const challengeTerms=h('div',{class:'hud-terms'});
  const challengeNote=h('p',{class:'hud-note',textContent:'No challenge yet.'});
  const whyList=h('ul',{class:'hud-gates hud-why'});
  const whyNote=h('p',{class:'hud-note',textContent:''});
  let lastPassive=null;

  const logList=h('ol',{class:'hud-log'});
  const signalList=h('div',{class:'hud-signals'});

  const collapse=h('button',{class:'hud-collapse',type:'button',title:'Hide inspector','aria-label':'Hide inspector',textContent:'−',
    onclick:()=>{
      const shut=panel.classList.toggle('shut');
      document.body.dataset.hud=shut?'shut':'open';
      collapse.textContent=shut?'☰':'−';
      collapse.title=shut?'Show inspector':'Hide inspector';
      collapse.setAttribute('aria-label',collapse.title);
    }});

  const enrolledChip=h('span',{class:'hud-count',hidden:true});

  const panel=h('aside',{class:'hud'},
    h('header',{class:'hud-top'},
      h('span',{class:'hud-title'},h('i',{class:'hud-dot'}),'BioPrint inspector'),
      enrolledChip,
      collapse,
    ),
    h('div',{class:'hud-scroll'},
      section('capture','Passive capture',stageList,stageNote,
        h('dl',{class:'hud-rows'},
          row('recorded','Events recorded'),
          row('keys','Keystrokes (user / pass)'),
          row('pointer','Pointer samples'),
          row('span','Capture span'),
          row('input','Input source'),
        ),
      ),
      section('scores','Scores against thresholds',
        bar('identity','Identity'),
        bar('quality','Evidence quality'),
        bar('human','Humanity'),
        h('dl',{class:'hud-rows'},
          row('decision','Decision'),
          row('reasons','Reasons'),
          row('fresh','Freshness'),
          row('device','Device state'),
          row('matcher','Matcher'),
          row('latency','Server time'),
        ),
        signalList,
      ),
      section('formula','Decision formula',formulaNote,gateList,termNote,termList),
      section('evidence','Evidence by modality',
        modalities(passiveMods,'username','password','pointer','click','crossModal'),
      ),
      section('ambient','Ambient (pre-login)',
        h('dl',{class:'hud-rows'},
          row('ambientState','Collection'),
          row('ambientWindows','Windows accepted'),
          row('ambientTyping','Typing toward window'),
          row('ambientTypedTotal','Characters kept'),
          row('ambientEvents','Last window events'),
          row('ambientQuality','Last window quality'),
          row('ambientHuman','Last window humanity'),
          row('view','Current view token'),
          row('ambientUse','Used at login'),
        ),
        h('p',{class:'hud-note',textContent:'What that window carried — timing and category only, never text or key names:'}),
        modalities(ambientMods,'keyboard','pointer','click','scroll','crossModal','rhythm'),
      ),
      section('challenge','Active challenge',challengeNote,whyNote,whyList,
        h('dl',{class:'hud-rows'},
          row('challengeDecision','Decision'),
          row('challengeTask','Task set'),
          row('challengeScore','Identity'),
          row('challengeQuality','Task completion'),
          row('challengeShadow','Second matcher'),
          row('challengeExemplars','Past rounds to compare'),
        ),
        modalities(activeMods,'keyboard','pointer'),
        h('p',{class:'hud-note',textContent:'Every term of the mean, worst first \u2014 what matched and what did not:'}),
        challengeTerms,
      ),
      section('enroll','Enrollment',
        h('dl',{class:'hud-rows'},
          row('enrolledAccounts','Accounts enrolled'),
          row('enrolledAmbient','With ambient model'),
          row('enrolledDevices','Trusted devices'),
          row('enrollStage','Stage'),
          row('enrollPassive','Typing rounds'),
          row('enrollActive','Movement rounds'),
          row('enrollLast','Last round'),
        ),
      ),
      section('monitor','Session monitoring',
        h('dl',{class:'hud-rows'},
          row('monitorState','State'),
          row('monitorScore','Last window identity'),
          row('monitorWindows','Windows'),
          row('monitorRenewals','Renewals'),
          row('account','Account'),
        ),
      ),
      section('feed','Live event feed',
        h('div',{class:'hud-feed-top'},feedCount,h('span',{class:'hud-feed-btns'},feedPause,feedClear)),
        h('p',{class:'hud-note',textContent:'Exactly what is kept — timing, action category and normalized coordinates. No text, no key names.'}),
        feedList,
      ),
      section('log','Event log',logList),
    ),
  );
  mount.append(panel);

  const set=(key,value,tone)=>{
    const node=rows[key];if(!node)return;
    node.textContent=value??'—';
    node.className=tone?`tone-${tone}`:'';
  };

  const paintTyping=()=>{
    set('ambientTyping',
      `${Math.min(ambientTyped,AMBIENT_TYPING_BURST)} / ${AMBIENT_TYPING_BURST} chars`,
      ambientTyped>=AMBIENT_TYPING_BURST?'good':undefined);
    set('ambientTypedTotal',
      `${ambientTypedTotal} across ${ambientKeyWindows} window${ambientKeyWindows===1?'':'s'}`,
      ambientKeyWindows?'good':undefined);
  };

  const cmp=(v,g,strict)=>Number.isFinite(v)&&Number.isFinite(g)?`${num(v)} ${strict?'>':'\u2265'} ${num(g)}`:'\u2014';
  const gateRow=(ok,label,detail)=>h('li',{dataset:{state:ok?'pass':'fail'}},
    h('i',{textContent:ok?'\u2713':'\u2717'}),
    h('span',{textContent:label}),
    h('em',{textContent:detail??''}),
  );
  const fmt=v=>!Number.isFinite(v)?'\u2014'
    :Math.abs(v)>=100?v.toFixed(0):Math.abs(v)>=10?v.toFixed(1):Math.abs(v)>=1?v.toFixed(2):v.toFixed(3);

  const featureRow=f=>h('div',{class:'hud-feature',
      dataset:{state:f.score===null?'out':f.score>=.5?'pass':'fail'}},
    h('div',{class:'hud-feature-head'},
      h('span',{textContent:f.name}),
      h('b',{class:'hud-num',textContent:f.score===null?'\u2014':num(f.score,4)}),
    ),
    h('em',{textContent:f.score===null?'not measured in this capture'
      :Number.isFinite(f.center)
        ?`${fmt(f.value)} vs ${fmt(f.center)} \u00b1 ${fmt(f.scale)} \u00b7 ${num(f.z,2)}\u03c3 \u00b7 w ${num(f.weight,2)}`
        :`w ${num(f.weight,2)}`}),
  );

  const termRow=(name,score,weight,note,features)=>{
    const head=h('div',{class:'hud-term',
        dataset:{state:note?'sum':Number.isFinite(score)&&weight>0?'in':'out'}},
      h('span',{textContent:name}),
      h('b',{class:'hud-num',textContent:Number.isFinite(score)?num(score):'\u2014'}),
      h('em',{textContent:note??(weight>0?`w ${num(weight,3)}`:'not in the mean')}),
    );
    if(!features?.length)return head;
    const sorted=[...features].sort((x,y)=>(x.score??2)-(y.score??2));
    const list=h('div',{class:'hud-features',hidden:true},...sorted.map(featureRow));
    const toggle=()=>{list.hidden=!list.hidden;head.dataset.open=String(!list.hidden);};
    head.classList.add('expandable');head.dataset.open='false';
    head.setAttribute('role','button');head.tabIndex=0;
    head.addEventListener('click',toggle);
    head.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();toggle();}});
    return h('div',{class:'hud-term-group'},head,list);
  };

  const shortfall=(v,gate)=>Number.isFinite(v)&&Number.isFinite(gate)?`${num(v)}, needs ${num(gate)}`:'\u2014';
  const WHY={
    PASSIVE_PROFILE_MISSING:()=>['no behavioral profile for this account yet','nothing to compare against'],
    NEW_DEVICE:r=>['this device has never been trained',words(r.deviceState)||'unknown device'],
    INSUFFICIENT_PASSIVE_EVIDENCE:r=>['not enough usable evidence in the login form',
      r.complete===false?'a key or click never finished':shortfall(r.quality,r.qualityMinimum)],
    PASSIVE_IDENTITY_UNCERTAIN:r=>['typing did not match the enrolled profile',shortfall(r.identityScore,r.threshold)],
    PASSIVE_HUMANITY_UNCERTAIN:r=>['the capture did not look hand-made',shortfall(r.humanScore,r.humanMinimum)],
    AMBIENT_REPLAY:()=>['pre-login evidence had been seen before','replayed window'],
    AMBIENT_IDENTITY_UNCERTAIN:r=>['pre-login behavior disagreed with this person',
      Number.isFinite(r.ambient?.identityScore)?shortfall(r.ambient.identityScore,r.ambient.threshold):'mismatch'],
    AMBIENT_CANNOT_RESCUE:()=>['pre-login evidence would have closed the gap','fusion may only lower a score, never raise one'],
    AUTOMATION_RISK:r=>['the capture looked automated',`humanity ${num(r.humanScore,2)}`],
  };

  const paintWhy=(reasons,r)=>{
    const codes=reasons?.length?reasons:(r?.reasons??[]);
    whyNote.textContent=codes.length
      ? 'The login form alone could not reach ACCEPT. Each line below is a check that fell short:'
      : '';
    whyList.replaceChildren(...codes.map(code=>{
      const [label,detail]=WHY[code]?.(r??{})??[words(code),''];
      return gateRow(false,label,detail);
    }));
  };

  const paintFormula=r=>{
    const reasons=new Set(r.reasons??[]);
    const gates=[],terms=[],w=r.fusionWeights??{};
    const replayed=reasons.has('EXACT_REPLAY')||reasons.has('NEAR_REPLAY');
    if(r.phase==='final'){
      formulaNote.textContent='Step-up login. The challenge and the login form are blended, then all five must hold:';
      gates.push(
        gateRow(r.active?.allowed===true,'challenge accepted',words(r.active?.decision)||'\u2014'),
        gateRow(r.fresh===true,'all evidence fresh',r.fresh===false?'replay detected':'fresh'),
        gateRow(r.active?.quality===1,'challenge task completed',num(r.active?.quality,2)),
        gateRow(Number.isFinite(r.identityScore)&&r.identityScore>r.threshold,'identity > threshold',cmp(r.identityScore,r.threshold,true)),
        gateRow(Number.isFinite(r.humanScore)&&r.humanScore>=.8,'humanity \u2265 0.80',num(r.humanScore,2)),
      );
      termNote.textContent='identity = (w\u00b7passive + w\u00b7challenge) \u00f7 \u03a3w \u2014 a weighted average. The challenge carries most of the weight; the login form can only lean on it.';
      const loginTerms=['username','password','pointer','click','crossModal'].map(m=>({
        name:m,value:null,center:null,scale:null,z:null,
        weight:r.passive?.fusionWeights?.[m]??0,score:r.passive?.modalities?.[m]??null}));
      terms.push(
        termRow('login form',r.passive?.identityScore,w.passive,null,loginTerms),
        termRow('challenge',r.active?.identityScore,w.active,null,
          [...(r.active?.features?.keyboard??[]),...(r.active?.features?.pointer??[])]),
        termRow('identity',r.identityScore,1,'\u2190 fused'),
      );
    }else if(Number.isFinite(r.roundsAccepted)||Number.isFinite(r.trainingMinimum)){
      formulaNote.textContent='Enrollment round. Nothing is being identified yet \u2014 the round only has to be usable as training:';
      gates.push(
        gateRow(!replayed,'not a repeat of an earlier round',replayed?'replay detected':'fresh'),
        gateRow(!reasons.has('AUTOMATION_RISK'),'typed by a human',`humanity ${num(r.humanScore,2)}`),
        gateRow(Number.isFinite(r.observedQuality)&&r.observedQuality>=r.trainingMinimum,'capture quality \u2265 minimum',cmp(r.observedQuality,r.trainingMinimum)),
        gateRow(r.complete!==false,'every key and click finished',r.complete===false?'something was left hanging':'complete'),
        gateRow(Number.isFinite(r.humanScore)&&r.humanScore>=.8,'humanity \u2265 0.80',num(r.humanScore,2)),
      );
      termNote.textContent='No identity score: there is no profile to compare against until the rounds are calibrated.';
    }else{
      const objection=[...reasons].filter(x=>x.startsWith('AMBIENT_'));
      formulaNote.textContent='Login form only. ACCEPT needs every one of these \u2014 any failure is a step-up, not a rejection:';
      gates.push(
        gateRow(!replayed,'evidence not replayed',replayed?'replay detected':'fresh'),
        gateRow(!reasons.has('AUTOMATION_RISK'),'not automated',`humanity ${num(r.humanScore,2)}`),
        gateRow(r.deviceState==='trusted','device already trained',words(r.deviceState)||'\u2014'),
        ...(r.ambient?.lifted
          ? [gateRow(Number.isFinite(r.fusedIdentityScore)&&r.fusedIdentityScore>=r.threshold,
              'identity \u2265 threshold, lifted by ambient',cmp(r.fusedIdentityScore,r.threshold))]
          : [gateRow(Number.isFinite(r.identityScore)&&r.identityScore>=r.threshold,'identity \u2265 threshold',cmp(r.identityScore,r.threshold)),
             gateRow(Number.isFinite(r.fusedIdentityScore)&&r.fusedIdentityScore>=r.threshold,'still \u2265 threshold after ambient',cmp(r.fusedIdentityScore,r.threshold))]),
        gateRow(Number.isFinite(r.quality)&&r.quality>=r.qualityMinimum,'evidence quality \u2265 minimum',cmp(r.quality,r.qualityMinimum)),
        gateRow(Number.isFinite(r.humanScore)&&r.humanScore>=r.humanMinimum,'humanity \u2265 minimum',cmp(r.humanScore,r.humanMinimum)),
        gateRow(r.complete!==false,'every key and click finished',r.complete===false?'something was left hanging':'complete'),
        gateRow(!objection.length,'ambient raises no objection',
          objection.map(words).join(' \u00b7 ')||(r.ambient?.used?'corroborates':'nothing to say')),
      );
      termNote.textContent='identity = weighted geometric mean over modalities: exp(\u03a3 w\u00b7ln s \u00f7 \u03a3 w). Each weight is the modality\u2019s share of the model times how much evidence this capture carried.'
        +(r.features?' Open a modality for the dwell, flight and digraph terms its own mean is made of.':'');
      for(const m of ['username','password','pointer','click','crossModal'])terms.push(termRow(m,r.modalities?.[m],w[m],null,r.features?.[m]));
      terms.push(termRow('identity',r.identityScore,1,'\u2190 geometric mean'));
      if(Number.isFinite(r.fusedIdentityScore)&&r.fusedIdentityScore!==r.identityScore)
        terms.push(termRow('after ambient',r.fusedIdentityScore,1,
          r.ambient?.lifted?`\u2190 +${num(r.ambient.bonus,3)} lift from pre-login`:`\u2190 weight ${num(r.ambient?.weight,2)}`));
    }
    gateList.replaceChildren(...gates);
    termList.replaceChildren(...terms);
    const failed=gates.filter(g=>g.dataset.state==='fail').length;
    badge('formula',failed?`${failed} of ${gates.length} failed`:`${gates.length}/${gates.length} passed`,failed?'bad':'good');
  };

  const setBar=(key,value,gate,gateLabel)=>{
    const b=bars[key];if(!b)return;
    const v=Number.isFinite(value)?Math.max(0,Math.min(1,value)):null;
    b.fill.style.width=v===null?'0%':`${v*100}%`;
    b.value.textContent=num(value);
    if(Number.isFinite(gate)){
      b.mark.hidden=false;b.mark.style.left=`${Math.max(0,Math.min(1,gate))*100}%`;
      b.gateText.textContent=`${gateLabel??'needs'} ${num(gate)}`;
      b.fill.dataset.state=v===null?'none':v>=gate?'pass':'fail';
      b.value.className=`hud-num ${v===null?'':v>=gate?'tone-good':'tone-bad'}`;
    }else{
      b.mark.hidden=true;b.gateText.textContent='';
      b.fill.dataset.state='none';b.value.className='hud-num';
    }
  };

  const badge=(key,text,tone)=>{
    const s=sections[key];if(!s)return;
    s.badge.textContent=text??'';
    s.badge.className=`hud-badge${tone?` tone-${tone}`:''}`;
  };

  const stage=(reached,tone)=>{
    const order=['recorded','validated','decided'];
    const index=order.indexOf(reached);
    for(const [i,node] of stages.entries()){
      node.dataset.state=i<index?'done':i===index?(tone??'done'):'pending';
    }
  };

  const log=(text,tone)=>{
    const entry=h('li',{class:tone?`tone-${tone}`:''},
      h('time',{textContent:clock()}),h('span',{textContent:text}));
    logList.prepend(entry);
    while(logList.children.length>60)logList.lastChild.remove();
  };

  return {
    log,

    /** One recorded event, as the collector keeps it. */
    event(e,source){
      feedTotal++;
      if(source==='ambient'&&e.type==='keydown'&&e.action==='character'){ambientTyped++;ambientTypedTotal++;paintTyping();}
      feedCount.textContent=`${feedTotal.toLocaleString()} event${feedTotal===1?'':'s'}`;
      badge('feed',source,undefined);
      if(feedPaused)return;
      const [kind,what,detail]=describe(e,source);
      feedQueue.push(h('li',{},
        h('em',{class:'hud-kind',dataset:{kind},textContent:kind}),
        h('span',{class:'hud-what',textContent:what}),
        h('span',{class:'hud-detail',textContent:detail}),
        h('time',{textContent:`${(e.t/1000).toFixed(2)}s`}),
      ));
      if(feedQueue.length>150)feedQueue=feedQueue.slice(-150);
      if(!feedFrame)feedFrame=requestAnimationFrame(flushFeed);
    },

    challengeRequested(reasons){
      paintWhy(reasons,lastPassive);
      challengeNote.textContent='Waiting for the challenge to be completed.';
      challengeNote.className='hud-note tone-warn';
      set('challengeDecision','asked, not yet answered','warn');
      for(const key of ['challengeTask','challengeScore','challengeQuality','challengeShadow','challengeExemplars'])set(key,null);
      challengeTerms.replaceChildren();
      paintMods(activeMods,{},{});
      badge('challenge','asked','warn');
      log(`step-up asked: ${(reasons??lastPassive?.reasons??[]).map(words).join(' \u00b7 ')||'reason not reported'}`,'warn');
    },

    challenge(phase,r){
      if(!r)return;
      const tone=TONE[r.decision]??'warn';
      const terms=[...(r.features?.keyboard??[]),...(r.features?.pointer??[])];
      challengeNote.textContent=`${phase} \u00b7 ${words(r.decision)}${r.reasons?.length?` \u00b7 ${r.reasons.map(words).join(' \u00b7 ')}`:''}`;
      challengeNote.className=`hud-note tone-${tone}`;
      set('challengeDecision',words(r.decision),tone);
      set('challengeTask',r.task
        ? `${r.task.phrase??'?'}-character phrase \u00b7 ${r.task.targets} target${r.task.targets===1?'':'s'}${r.task.scroll?' \u00b7 scroll marker':''}`
        : '\u2014');
      set('challengeScore',Number.isFinite(r.identityScore)
        ? `${num(r.identityScore)} vs ${num(r.threshold)}`
        : 'no profile to compare against',
        Number.isFinite(r.identityScore)?(r.identityScore>r.threshold?'good':'bad'):undefined);
      set('challengeQuality',r.quality===1?'every key and target completed'
        :Number.isFinite(r.quality)?`incomplete \u00b7 ${num(r.quality,2)}`:'\u2014',
        r.quality===1?'good':'warn');
      const adv=r.advanced;
      set('challengeShadow',adv&&Number.isFinite(adv.score)
        ? `${adv.matcherVersion} (${adv.mode}) \u00b7 ${num(adv.score)}`
        : adv?`${adv.matcherVersion} (${adv.mode}) \u00b7 not enough to score`:'\u2014');
      set('challengeExemplars',adv
        ? `${adv.exemplarCount??0} \u00b7 same phrase, same device class`
        : '\u2014');
      paintMods(activeMods,r.modalities??{},r.availability??{});
      challengeTerms.replaceChildren(...(terms.length
        ? [...terms].sort((x,y)=>(x.score??2)-(y.score??2)).map(featureRow)
        : [h('p',{class:'hud-note',textContent:'No terms: this round is training, so there is no enrolled model to compare it with.'})]));
      badge('challenge',words(r.decision),tone);
      log(`${phase}: ${words(r.decision)}${Number.isFinite(r.identityScore)?` \u00b7 identity ${num(r.identityScore)} vs ${num(r.threshold)}`:''}`,tone);
    },

    capture(phase,result){
      const r=result.recorded;
      if(r){
        stage('recorded');
        set('recorded',`${r.events}`);
        set('keys',`${r.usernameKeys} / ${r.passwordKeys}`);
        set('pointer',`${r.pointerSamples} samples · ${r.clicks} click${r.clicks===1?'':'s'}`);
        set('span',`${(r.spanMs/1000).toFixed(1)}s`);
        set('input',r.autofilled?'autofilled — keystroke evidence voided':'typed',r.autofilled?'bad':'good');
        set('recorded',`${r.events}${r.corrections?` · ${r.corrections} correction${r.corrections===1?'':'s'}`:''}`);
      }
      const decision=result.decision??(result.unavailable?'UNAVAILABLE':'—');
      const tone=TONE[decision]??'warn';

      const parsed=Number.isFinite(result.quality)||Number.isFinite(result.observedQuality);
      stage(parsed?'decided':'validated',tone==='bad'?'fail':tone==='warn'?'warn':'done');
      stageNote.textContent=parsed
        ?`${phase} · parsed and scored · ${words(decision)}`
        :`${phase} · could not be parsed · ${words(result.reasons?.[0])}`;
      stageNote.className=`hud-note tone-${tone}`;

      setBar('identity',result.identityScore,result.threshold,'threshold');
      setBar('quality',result.quality,result.qualityMinimum,'minimum');
      setBar('human',result.humanScore,result.humanMinimum,'minimum');

      set('decision',words(decision),tone);
      set('reasons',(result.reasons??[]).map(words).join(' · ')||'none');
      set('fresh',result.fresh===false?'replayed evidence':'fresh',result.fresh===false?'bad':'good');
      set('device',words(result.deviceState)||'—');
      set('matcher',result.matcherVersion??'—');
      set('latency',Number.isFinite(result.verificationMs)?`${result.verificationMs.toFixed(1)}ms`:'—');

      signalList.replaceChildren(...(result.signals??[]).map(code=>
        h('span',{class:'hud-signal',textContent:words(code)})));

      paintFormula(result);
      if(result.phase!=='final'){
        if(decision==='STEP_UP')lastPassive=result;
        else {lastPassive=null;paintWhy([],null);}
      }
      paintMods(passiveMods,result.evidenceQuality??{},result.availability??{});

      const a=result.ambient;
      set('ambientUse',a?(a.used?(a.lifted
          ? `lifted this login · ${num(a.passiveAlone)} + ${num(a.bonus,3)} · ${a.windows} window${a.windows===1?'':'s'}`
          : `used · ${a.windows} window${a.windows===1?'':'s'} · weight ${num(a.weight,2)}`)
        :`not used${a.reasons?.length?` · ${a.reasons.map(words).join(' · ')}`:''}`):'—',a?.used?'good':undefined);

      badge('scores',words(decision),tone);
      badge('capture',r?`${r.events} events`:'',undefined);
      log(`${phase}: ${words(decision)}${Number.isFinite(result.identityScore)?` · identity ${num(result.identityScore)} vs ${num(result.threshold)}`:''}`,tone);
    },

    ambient(state){
      set('ambientState',state.running?'collecting':`stopped${state.reason?` · ${words(state.reason)}`:''}`,state.running?'good':'warn');
      set('ambientWindows',String(state.windows??0));
      set('ambientEvents',Number.isFinite(state.events)?String(state.events):'—');
      set('ambientQuality',Number.isFinite(state.quality)?num(state.quality):'—');
      set('ambientHuman',Number.isFinite(state.humanScore)?num(state.humanScore):'—');
      if(Number.isFinite(state.sent)&&state.sent!==ambientSent){
        ambientSent=state.sent;ambientTyped=0;
        if(state.availability?.keyboard==='AVAILABLE')ambientKeyWindows++;
      }
      paintTyping();
      paintMods(ambientMods,null,state.availability??{});
      badge('ambient',`${state.windows??0} windows`,state.running?'good':'warn');
    },

    view(token){set('view',token);},

    session(session){
      const e=session.enrolled;
      if(e){
        const total=session.accounts;
        set('enrolledAccounts',
          Number.isFinite(total)&&total>=e.passive?`${e.passive} of ${total} registered`:String(e.passive),
          e.passive?'good':undefined);
        set('enrolledAmbient',String(e.ambient));
        set('enrolledDevices',String(e.devices));
        enrolledChip.hidden=false;
        enrolledChip.textContent=`${e.passive} enrolled`;
        enrolledChip.className=`hud-count${e.passive?' tone-good':''}`;
      }
      set('account',session.user
        ? `${session.user} · ${session.profile?.passiveEnrolled?`trained (${session.profile.passiveRounds} rounds)`:'password only'}`
        : 'not signed in',session.user?'good':undefined);
    },

    enrollment(progress,last){
      if(progress){
        set('enrollStage',progress.stage);
        set('enrollPassive',`${progress.passive.done} / ${progress.passive.required}`);
        set('enrollActive',`${progress.active.done} / ${progress.active.required}`);
        badge('enroll',`${progress.passive.done+progress.active.done}/${progress.passive.required+progress.active.required}`,
          progress.stage==='ready'?'good':'warn');
      }
      if(last)set('enrollLast',last.text,last.tone);
    },

    monitor(state){
      set('monitorState',state.monitoring?'observing':`off${state.reason?` · ${words(state.reason)}`:''}`,
        state.monitoring?'good':'warn');
      if(state.result){
        const r=state.result;
        set('monitorScore',Number.isFinite(r.identityScore)?`${num(r.identityScore)} vs ${num(r.threshold)}`:words(r.reasons?.[0])||'—',
          r.reauthenticationRequired?'bad':Number.isFinite(r.identityScore)?'good':undefined);
        set('monitorWindows',String(r.windows??0));
        set('monitorRenewals',String(r.renewals??0));
        badge('monitor',words(r.decision),TONE[r.decision]??'warn');
        log(`monitor window: ${words(r.decision)}${Number.isFinite(r.identityScore)?` · ${num(r.identityScore)}`:''}`,
          TONE[r.decision]??'warn');
      }else{
        badge('monitor',state.monitoring?'on':'off',state.monitoring?'good':undefined);
      }
    },
  };
}
