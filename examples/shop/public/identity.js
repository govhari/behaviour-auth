import { h } from './ui.js';

const api=async(path,payload)=>{
  const response=await fetch(path,{
    method:payload?'POST':'GET',credentials:'same-origin',
    ...(payload?{headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}:{}),
  });
  const body=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(body.error??'REQUEST_FAILED');
  return body;
};

const readable=reason=>String(reason??'').replaceAll('_',' ').toLowerCase();

export function createIdentity({bp,modal,hud,onSession,onActivity}){
  let session={user:null,enrolling:null,profile:null},monitor=null,credential=null;

  const note=(text,tone='')=>h('p',{class:`note ${tone}`,textContent:text});

  async function refresh(){
    session=await api('/api/session').catch(()=>({user:null,enrolling:null,profile:null}));
    onSession(session);
    return session;
  }

  function stopMonitoring(reason){
    monitor?.stop();monitor=null;
    onActivity({monitoring:false,reason});
  }

  function beginMonitoring(userId,loginId){
    stopMonitoring();
    onActivity({monitoring:true,decision:null});
    monitor=bp.startMonitoring({
      userId,loginId,roots:[document],windowMs:30000,
      onWindow:result=>onActivity({monitoring:true,result}),
      onReauthentication:()=>{
        api('/api/signout',{}).catch(()=>{});
        refresh().then(()=>openAuth('signin',{message:'Your session needed a fresh login. Please sign in again.'}));
      },
      onStopped:reason=>onActivity({monitoring:false,reason}),
    });
  }

  function signInPanel({message=null}={}){
    const username=h('input',{id:'signin-user',name:'username',autocomplete:'username',autocapitalize:'off',spellcheck:false,maxLength:64,required:true});
    const password=h('input',{id:'signin-pass',name:'password',type:'password',autocomplete:'current-password',maxLength:128,required:true});
    const submit=h('button',{class:'primary wide',type:'submit',textContent:'Sign in'});
    const status=h('p',{class:'note',role:'status',textContent:message??'Type naturally. An extra check appears only if the evidence is thin.'});
    const form=h('form',{class:'auth-form',autocomplete:'on'},
      h('label',{class:'field',for:'signin-user'},'Username',username),
      h('label',{class:'field',for:'signin-pass'},'Password',password),
      status,submit,
      h('button',{class:'link danger',type:'button',textContent:'Delete this account instead',onclick:()=>deleteAccount({username:username.value.trim(),password:password.value,report})}),
    );

    let handle=bp.watchLogin({form,username,password,submit});
    let busy=false;

    const report=text=>{
      if(form.isConnected)return void(status.textContent=text);
      modal.replace(h('div',{class:'auth'},
        h('h2',{textContent:'Not signed in'}),
        note(text,'warn'),
        h('button',{class:'primary wide',type:'button',textContent:'Try again',onclick:()=>openAuth('signin')}),
        h('button',{class:'ghost wide',type:'button',textContent:'Keep browsing',onclick:()=>modal.forceClose()}),
      ));
    };

    form.addEventListener('submit',async event=>{
      event.preventDefault();
      if(busy)return;busy=true;submit.disabled=true;
      const name=username.value.trim(),secret=password.value;
      status.textContent='Checking…';
      try{
        const result=await handle.submit({password:secret,event});
        hud?.capture(result.phase==='final'?'step-up login':'login',result.phase==='final'?{...result.passive,...result,recorded:result.recorded}:result);
        if(result.phase==='final')hud?.challenge('step-up challenge',result.active);
        if(result.unavailable){
          const outcome=await api('/api/signin/password',{username:name,password:secret}).catch(e=>({error:e.message}));
          if(outcome.error){report(`Could not sign in: ${readable(outcome.error)}`);return;}
          credential={userId:name,password:secret};
          await refresh();
          return showEnrollOffer(name);
        }
        password.value='';
        if(result.allowed){
          credential={userId:name,password:secret};
          await refresh();
          beginMonitoring(name,result.loginId);
          return showAccepted(result);
        }
        report(`Not accepted: ${(result.reasons??[]).map(readable).join(' · ')||readable(result.decision)}`);
      }catch(e){
        report(`Could not sign in: ${readable(e.message)}`);
      }finally{
        busy=false;submit.disabled=false;
        handle.cancel();
        if(form.isConnected)handle=bp.watchLogin({form,username,password,submit});
      }
    });
    return form;
  }

  function showAccepted(result){
    const passive=result.phase==='final'?result.passive:result;
    modal.replace(h('div',{class:'auth'},
      h('h2',{textContent:'Signed in'}),
      note(result.phase==='final'
        ?'Passive evidence was uncertain, so you completed an active check. The session is now being monitored.'
        :'Accepted on passive evidence alone — no extra challenge was needed. The session is now being monitored.','good'),
      h('dl',{class:'evidence'},
        h('div',{},h('dt',{textContent:'Identity'}),h('dd',{textContent:fmt(result.identityScore)})),
        h('div',{},h('dt',{textContent:'Humanity'}),h('dd',{textContent:fmt(result.humanScore)})),
        h('div',{},h('dt',{textContent:'Quality'}),h('dd',{textContent:fmt(result.quality)})),
        h('div',{},h('dt',{textContent:'Pre-login evidence'}),h('dd',{textContent:passive?.ambient?.used?`used · ${passive.ambient.windows} window${passive.ambient.windows===1?'':'s'}`:'not used'})),
      ),
      h('button',{class:'primary wide',type:'button',textContent:'Continue shopping',onclick:()=>modal.forceClose()}),
    ));
  }

  const fmt=value=>Number.isFinite(value)?value.toFixed(2):'—';

  function showEnrollOffer(userId){
    modal.replace(h('div',{class:'auth'},
      h('h2',{textContent:'Signed in with your password'}),
      note('This account has no behavioral profile yet, so only the password was checked. Training one takes a few minutes and lets future sign-ins be verified by how you type and move.','warn'),
      h('button',{class:'primary wide',type:'button',textContent:'Train my profile now',onclick:()=>startEnrollment(userId)}),
      h('button',{class:'ghost wide',type:'button',textContent:'Not now',onclick:()=>modal.forceClose()}),
    ));
  }

  function registerPanel(){
    const username=h('input',{id:'reg-user',name:'username',autocomplete:'username',autocapitalize:'off',spellcheck:false,maxLength:64,required:true,pattern:'[a-zA-Z0-9_\\-]{3,64}'});
    const password=h('input',{id:'reg-pass',name:'password',type:'password',autocomplete:'new-password',minLength:8,maxLength:128,required:true});
    const status=h('p',{class:'note',role:'status',textContent:'Letters, numbers, dash and underscore. At least eight characters for the password.'});
    const submit=h('button',{class:'primary wide',type:'submit',textContent:'Create account'});
    const form=h('form',{class:'auth-form'},
      h('label',{class:'field',for:'reg-user'},'Choose a username',username),
      h('label',{class:'field',for:'reg-pass'},'Choose a password',password),
      status,submit,
    );
    form.addEventListener('submit',async event=>{
      event.preventDefault();submit.disabled=true;status.textContent='Creating…';
      try{
        const created=await api('/api/register',{username:username.value.trim(),password:password.value});
        credential={userId:created.userId,password:password.value};
        await refresh();
        startEnrollment(created.userId);
      }catch(e){status.textContent=`Could not create the account: ${readable(e.message)}`;submit.disabled=false;}
    });
    return form;
  }

  async function startEnrollment(userId){
    const progressBar=h('div',{class:'bar'},h('span',{}));
    const heading=h('h2',{textContent:'Train your behavior profile'});
    const caption=h('p',{class:'note',textContent:'Starting…'});
    const stage=h('div',{class:'stage'});
    const panel=h('div',{class:'auth wizard'},heading,progressBar,caption,stage);
    modal.open(panel,{dismissable:true,onClose:()=>{active?.destroy?.();passive?.cancel?.();}});
    let wizard,active=null,passive=null,completionAttempts=0;

    const paint=p=>{
      const phase=p.stage==='passive'?p.passive:p.stage==='active'?p.active:null,name=p.stage==='passive'?'typing':'movement';
      const base=Math.max(1,phase?.minimum??phase?.required??1),done=phase?.done??base;
      progressBar.firstChild.style.width=`${Math.round(100*Math.min(1,done/base))}%`;
      caption.textContent=!phase?'All rounds accepted. Saving your profile…'
        : done>=base?`Extra ${name} round ${done-base+1}: the rounds disagreed a little, so one more.`
        : `${name[0].toUpperCase()+name.slice(1)} round ${done+1} of ${base}.`;
    };

    const retry=text=>h('div',{},note(text,'warn'),
      h('button',{class:'primary wide',type:'button',textContent:'Try again',onclick:()=>step()}),
      h('button',{class:'ghost wide',type:'button',textContent:'Finish later',onclick:()=>modal.forceClose()}),
    );

    hud?.log(`enrollment started for ${userId}`);
    try{wizard=await bp.beginEnrollment({userId});}
    catch(e){stage.replaceChildren(note(`Enrollment could not start: ${readable(e.message)}`,'warn'));return;}
    paint(wizard.progress());

    const passiveStage=async(message=null)=>{
      const username=h('input',{id:'train-user',name:'username',autocomplete:'off',autocapitalize:'off',spellcheck:false,maxLength:64});
      const secret=h('input',{id:'train-pass',name:'password',type:'password',autocomplete:'off',maxLength:128});
      const submit=h('button',{class:'primary wide',type:'submit',textContent:'Record this round'});
      const status=h('p',{class:`note${message?' warn':''}`,role:'status',
        textContent:message??`Sign in exactly as you would for real: type ${userId}, then your password.`});
      const form=h('form',{class:'auth-form'},
        h('label',{class:'field',for:'train-user'},'Username',username),
        h('label',{class:'field',for:'train-pass'},'Password',secret),
        status,submit,
      );
      let recorded=false,ready=false;
      form.addEventListener('submit',async event=>{
        event.preventDefault();
        if(recorded)return;
        if(!ready){status.textContent='Still preparing this round — one moment.';return;}
        if(username.value.trim()!==userId){status.textContent=`Type ${userId} in the username field.`;return;}
        recorded=true;submit.disabled=true;
        const round=passive;passive=null;
        try{
          const result=await round.submit(event);
          hud?.capture(`enrollment round ${result.progress.passive.done+(result.decision==='SAMPLE_ACCEPTED'?0:1)}`,result);
          hud?.enrollment(result.progress,{text:`${result.decision==='SAMPLE_ACCEPTED'?'accepted':'not usable'} · quality ${(result.quality??0).toFixed(2)}`,
            tone:result.decision==='SAMPLE_ACCEPTED'?'good':'warn'});
          paint(result.progress);
          await step(result.decision==='SAMPLE_ACCEPTED'?null
            :`Round not usable: ${(result.reasons??[]).map(readable).join(' · ')||'more natural typing needed'}. Try again.`);
        }catch(e){
          await step(e.message==='TRAINING_TEXT_MISMATCH'
            ?'That was not the password you registered with. Try the round again.'
            :`Round failed: ${readable(e.message)}. Try again.`);
        }
      });
      stage.replaceChildren(form);
      username.focus();
      try{
        passive=await wizard.passiveRound({form,username,password:secret,submit,
          expectedText:credential?.userId===userId?credential.password:null});
        ready=true;
      }catch(e){
        stage.replaceChildren(retry(`Could not start this round: ${readable(e.message)}.`));
      }
    };

    const activeStage=async()=>{
      const host=h('div',{});
      stage.replaceChildren(h('p',{class:'note',textContent:'Type the phrase, then follow the targets. This teaches the system how you move, not just how you type.'}),host);
      let round;
      try{round=active=await wizard.activeRound({mount:host,title:`Movement round ${wizard.progress().active.done+1} of ${wizard.progress().active.minimum}`});}
      catch(e){return stage.replaceChildren(retry(`Could not start this round: ${readable(e.message)}.`));}
      round.focus();
      let result;
      try{result=await round.submit();}
      catch(e){active=null;return stage.replaceChildren(retry(`Round failed: ${readable(e.message)}.`));}
      active=null;
      hud?.challenge(`enrollment movement round ${wizard.progress().active.done}`,result);
      hud?.enrollment(result.progress,{text:`movement round ${result.decision==='SAMPLE_ACCEPTED'?'accepted':readable(result.decision)}`,
        tone:result.decision==='SAMPLE_ACCEPTED'?'good':'warn'});
      hud?.log(`movement round: ${readable(result.decision)}`,result.decision==='SAMPLE_ACCEPTED'?'good':'warn');
      paint(result.progress);
      if(result.decision==='CANCELLED')return stage.replaceChildren(
        note('Round cancelled. The rounds you already recorded are still saved.','warn'),
        h('button',{class:'primary wide',type:'button',textContent:'Continue training',onclick:()=>step()}),
        h('button',{class:'ghost wide',type:'button',textContent:'Finish later',onclick:()=>modal.forceClose()}),
      );
      await step();
    };

    const step=async(message=null)=>{
      try{
        const p=wizard.progress();paint(p);
        if(p.stage==='passive')return await passiveStage(message);
        if(p.stage==='active')return await activeStage();
        try{
          const done=await wizard.complete();
          hud?.enrollment(wizard.progress(),{text:'profile saved',tone:'good'});
          hud?.log(`profile saved · ambient ${done.ambient?.enrolled?`${done.ambient.windows} windows`:'not modelled'}`,
            done.ambient?.enrolled?'good':'warn');
          await refresh();
          stage.replaceChildren(
            note('Profile saved. Your next sign-in will be verified by behavior as well as your password.','good'),
            h('p',{class:'note',textContent:done.ambient?.enrolled
              ?`Ambient browsing collected while you did this contributed ${done.ambient.windows} window${done.ambient.windows===1?'':'s'}.`
              :'Not enough ambient browsing was collected to model it; only the sign-in rhythm was learned.'}),
            h('button',{class:'primary wide',type:'button',textContent:'Done',onclick:()=>modal.forceClose()}),
          );
          caption.textContent='Enrollment complete.';
          progressBar.firstChild.style.width='100%';
        }catch(e){
          if(++completionAttempts>6)return stage.replaceChildren(retry(`Enrollment could not be completed: ${readable(e.message)}.`));
          stage.replaceChildren(note(`Needs another round: ${readable(e.message)}`,'warn'));
          setTimeout(step,900);
        }
      }catch(e){
        stage.replaceChildren(retry(`Enrollment stopped: ${readable(e.message)}.`));
      }
    };
    await step();
  }

  function openAuth(tab='signin',{message=null}={}){
    const body=h('div',{class:'stage'});
    const tabs=h('div',{class:'tabs',role:'tablist'});
    const select=name=>{
      for(const button of tabs.children)button.classList.toggle('on',button.dataset.tab===name);
      body.replaceChildren(name==='signin'?signInPanel({message}):registerPanel());
      body.querySelector('input')?.focus();
    };
    for(const [name,label] of [['signin','Sign in'],['register','Create account']])
      tabs.append(h('button',{class:'tab',type:'button',role:'tab',dataset:{tab:name},textContent:label,onclick:()=>select(name)}));
    modal.open(h('div',{class:'auth'},h('h2',{textContent:'Your account'}),tabs,body));
    select(tab);
  }

  async function signOut(){
    stopMonitoring('SIGNED_OUT');
    credential=null;
    await api('/api/signout',{}).catch(()=>{});
    await refresh();
  }

  async function deleteAccount({username=null,password=null,report=null}={}){
    const name=username||session.user;
    if(!name){report?.('Type the username and password of the account to delete.');return;}
    if(!confirm(`Delete the account "${name}", its behavioral profile and every recording? This cannot be undone.`))return;
    try{
      const result=await api('/api/account/delete',username?{username,password}:{});
      hud?.log(`account deleted: ${result.deleted}`,'warn');
      if(result.deleted===session.user){stopMonitoring('ACCOUNT_DELETED');credential=null;}
      await refresh();
      if(report)report(`Account "${result.deleted}" deleted.`);else modal.forceClose();
    }catch(e){
      const text=`Could not delete the account: ${readable(e.message)}`;
      if(report)report(text);else hud?.log(text,'bad');
    }
  }

  async function resetDemo(){
    if(!confirm('Clear everything? Every account, behavioral profile and recording on this demo server will be deleted.'))return;
    try{
      const result=await api('/api/reset',{});
      stopMonitoring('DEMO_RESET');credential=null;
      hud?.log(`demo cleared: ${result.accounts} account${result.accounts===1?'':'s'} removed`,'warn');
      await refresh();
      bp.stopAmbient();await bp.startAmbient();
    }catch(e){hud?.log(`could not clear the demo: ${readable(e.message)}`,'bad');}
  }

  return {refresh,openAuth,signOut,startEnrollment,deleteAccount,resetDemo,session:()=>session,monitoring:()=>!!monitor};
}
