import { BioPrintSDK } from './sdk.js';
import { createStepUp } from './stepup.js';

const VIEW=/^[a-zA-Z0-9_-]{1,32}$/;

const summarize=events=>{
  const count=(type,field)=>events.filter(e=>e.type===type&&(!field||e.field===field||e.target===field)).length;
  return {
    events:events.length,
    usernameKeys:count('keydown','username'),
    passwordKeys:count('keydown','password'),
    pointerSamples:count('move'),
    clicks:count('down'),
    corrections:events.filter(e=>e.type==='keydown'&&e.action==='correction').length,
    autofilled:events.some(e=>e.type==='input'&&e.source!=='typing'),
    spanMs:events.length?Math.round(events.at(-1).t-events[0].t):0,
  };
};

export function createBioPrint({
  endpoint='/bioprint',
  deviceClass=undefined,
  view=null,
  ambient=true,
  ambientRoot=document,
  studySessionId=null,
  stepUp=null,
  onAmbient=()=>{},
  onError=()=>{},
  onEvent=null,
}={}){
  const sdk=new BioPrintSDK({endpoint});
  if(deviceClass)sdk.deviceClass=deviceClass;
  let currentView=view,ambientState={windows:0,running:false};

  const report=state=>{ambientState={...ambientState,...state};onAmbient(ambientState);};

  const api={
    sdk,
    async startAmbient(){
      if(!ambient)return null;
      try{
        const session=await sdk.startAmbientCollection({root:ambientRoot,view:currentView,studySessionId,
          onEvent:onEvent&&(e=>onEvent(e,'ambient')),onWindow:w=>{
          if(w.stopped)return report({running:false,stopped:true,reason:w.reason});
          report({running:true,windows:w.accepted??ambientState.windows,quality:w.quality,reasons:w.reasons??[],
            humanScore:w.humanScore,availability:w.availability??{},events:w.events??null,sent:w.sent??null});
        }});
        report({running:true,stopped:false});
        return session;
      }catch(e){report({running:false,error:e.message});onError(e);return null;}
    },
    stopAmbient(){sdk.stopAmbientCollection();report({running:false,stopped:true,reason:'STOPPED'});},
    ambientId:()=>sdk.ambientId(),
    ambient:()=>({...ambientState}),
    setView(token){
      if(!VIEW.test(String(token??'')))throw Error('INVALID_VIEW_TOKEN');
      currentView=token;sdk.ambient?.setView(token);
    },
    async status(userId){
      const response=await fetch(`${endpoint}/profile/${encodeURIComponent(userId)}/status`,{credentials:'include'});
      if(!response.ok)throw Error((await response.json().catch(()=>({}))).error??'STATUS_UNAVAILABLE');
      return response.json();
    },

    watchLogin({form,username,password,submit,userId=null,autoIdentify=true}){
      const capture=sdk.capturePassive(null,{form,username,password,submit,studySessionId,onEvent:onEvent&&(e=>onEvent(e,'login form'))});
      const controller=new AbortController();
      let claimed=null,unavailable=null,pending=null;
      const identify=async id=>{
        const name=String(id??'').trim();
        if(!name||name===claimed)return {ok:!!claimed,userId:claimed,reason:unavailable};
        claimed=null;unavailable=null;
        pending=(async()=>{
          try{const challenge=await sdk.passiveChallenge(name,null);capture.bind(challenge);claimed=name;return {ok:true,userId:name,reason:null};}
          catch(e){unavailable=e.message;return {ok:false,userId:name,reason:e.message};}
        })();
        return pending;
      };
      if(autoIdentify&&username)username.addEventListener('change',()=>identify(username.value).catch(()=>{}),{signal:controller.signal});
      if(userId)identify(userId).catch(()=>{});
      return {
        identify,
        claimed:()=>claimed,
        async submit({password:secret,event=null,onStepUp=null}={}){
          if(pending)await pending.catch(()=>{});
          if(!claimed){
            const outcome=await identify(username?.value).catch(()=>null);
            if(!outcome?.ok){capture.cancel();return {decision:'UNAVAILABLE',allowed:false,reasons:[outcome?.reason??'PROFILE_NOT_FOUND'],unavailable:true};}
          }
          const payload=capture.finish(event);
          const recorded=summarize(payload.events);
          const result={...await sdk.submitPassive(payload,{password:secret}),recorded};
          if(result.decision!=='STEP_UP')return result;
          onStepUp?.(result);
          if(!stepUp)return result;
          return {...await api.runStepUp(claimed,result),recorded};
        },
        cancel(){controller.abort();capture.cancel();},
      };
    },

    async runStepUp(userId,passiveResult){
      if(!stepUp?.mount)throw Error('STEP_UP_PRESENTER_REQUIRED');
      const challenge=await sdk.stepUpChallenge(userId,passiveResult.loginId);
      const widget=createStepUp(sdk,challenge,{studySessionId,title:'One more behavior check',
        note:`Passive evidence was uncertain. Type the phrase, then ${challenge.interaction==='drag'?'drag the arrow to':'select'} ${challenge.targets.length} targets.`});
      stepUp.mount(widget.element,{challenge,reasons:passiveResult.reasons??[]});
      widget.focus();
      try{
        const payload=await widget.done;
        if(!payload)return {...passiveResult,reasons:[...(passiveResult.reasons??[]),'STEP_UP_DECLINED']};
        return await sdk.finishStepUp(payload,passiveResult.loginId);
      }finally{widget.destroy();stepUp.dismiss?.();}
    },

    async beginEnrollment({userId,key,device=false}){
      const flow=device?await sdk.startDeviceEnrollment(userId,key):await sdk.startEnrollmentFlow(userId,key);
      let passiveDone=flow.passiveRoundsAccepted,activeDone=flow.activeEnrollment?.roundsAccepted??0;
      let passiveTarget=flow.passiveRoundsRequired,activeTarget=flow.activeComplete?0:8;
      const passiveMinimum=passiveTarget,activeMinimum=activeTarget;
      const passiveCeiling=flow.passiveRoundsRequired+6;
      const progress=()=>({
        stage:passiveDone<passiveTarget?'passive':activeDone<activeTarget?'active':'ready',
        passive:{done:passiveDone,required:passiveTarget,minimum:passiveMinimum},active:{done:activeDone,required:activeTarget,minimum:activeMinimum},
        deviceOnly:!!flow.deviceOnly,
      });
      return {
        userId,flow,progress,
        async passiveRound({form,username,password,submit,expectedText=null}){
          const challenge=await sdk.passiveChallenge(userId,flow.passiveEnrollment);
          const capture=sdk.capturePassive(challenge,{form,username,password,submit,studySessionId,onEvent:onEvent&&(e=>onEvent(e,'training round'))});
          return {
            challenge,
            cancel(){capture.cancel();},
            async submit(event=null){
              if(expectedText!==null&&password.value!==expectedText){capture.cancel();throw Error('TRAINING_TEXT_MISMATCH');}
              const payload=capture.finish(event);
              const recorded=summarize(payload.events);
              const result=await sdk.submitPassive(payload,{enrollment:flow.passiveEnrollment});
              if(Number.isFinite(result.roundsAccepted))passiveDone=result.roundsAccepted;
              return {...result,recorded,progress:progress()};
            },
          };
        },
        /** One active round, rendered by the shared step-up widget. */
        async activeRound({mount,title='Build your behavior profile'}={}){
          const challenge=await sdk.challenge(userId,flow.activeEnrollment);
          const widget=createStepUp(sdk,challenge,{mount,studySessionId,title,cancellable:true});
          return {
            challenge,element:widget.element,focus:()=>widget.focus(),
            destroy(){widget.destroy();},
            async submit(){
              const payload=await widget.done;
              widget.destroy();
              if(!payload)return {decision:'CANCELLED',allowed:false,reasons:['ROUND_CANCELLED'],progress:progress()};
              const result=await sdk.verify(payload,flow.activeEnrollment);
              if(Number.isFinite(result.roundsAccepted))activeDone=result.roundsAccepted;
              return {...result,phase:'active',progress:progress()};
            },
          };
        },
        async complete(){
          try{return {...await sdk.completeEnrollmentFlow(userId,flow),progress:progress()};}
          catch(e){
            if(['PASSIVE_ENROLLMENT_INCONSISTENT','MORE_PASSIVE_DEVICE_ENROLLMENT_REQUIRED','MORE_PASSIVE_ENROLLMENT_REQUIRED'].includes(e.message)&&passiveDone<passiveCeiling)passiveTarget=passiveDone+1;
            else if(['ENROLLMENT_INCONSISTENT','MORE_ENROLLMENT_REQUIRED'].includes(e.message)&&activeDone<12)activeTarget=activeDone+1;
            throw e;
          }
        },
      };
    },

    startMonitoring({userId,loginId,roots=[document],windowMs=30000,onWindow=()=>{},onReauthentication=()=>{},onStopped=()=>{}}){
      let session=null,capture=null,timer=null,live=true;
      const stop=(reason='STOPPED')=>{
        if(!live)return;live=false;clearTimeout(timer);capture?.cancel();capture=null;
        if(session)sdk.stopMonitoring(userId,session).catch(()=>{});
        session=null;onStopped(reason);
      };
      const cycle=async()=>{
        if(!live)return;
        try{
          const challenge=await sdk.monitorChallenge(userId,session);if(!live)return;
          capture=sdk.captureContinuous(challenge,{roots});
          timer=setTimeout(async()=>{
            if(!live)return;
            try{
              const payload=capture.finish();capture=null;
              const result=await sdk.submitMonitor(payload);if(!live)return;
              onWindow(result);
              if(result.reauthenticationRequired){stop('REAUTHENTICATION_REQUIRED');onReauthentication(result);return;}
              await cycle();
            }catch(e){onError(e);stop(e.message);}
          },windowMs);
        }catch(e){onError(e);stop(e.message);}
      };
      (async()=>{
        try{const started=await sdk.startMonitoring(userId,loginId);session=started.monitorId;await cycle();}
        catch(e){onError(e);stop(e.message);}
      })();
      return {stop,running:()=>live};
    },
  };
  if(ambient)api.startAmbient();
  return api;
}
