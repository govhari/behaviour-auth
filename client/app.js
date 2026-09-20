import { BioPrintSDK } from './sdk.js';
import { createStepUp } from './stepup.js';
import { createDashboard, createLiveStrip, words } from './dashboard.js';
import { LOCAL_ENROLLMENT_KEY, DEMO_PASSWORD_MIN, recordingSessionLabel } from './local-demo.js';

const $=id=>document.getElementById(id);
const sdk=new BioPrintSDK();
const dash=createDashboard(document);
const live=createLiveStrip({keys:$('live-keys'),path:$('live-path'),keysCount:$('live-keys-count'),pathCount:$('live-path-count')});
const form=$('login-form'),usernameField=$('login-username'),passwordField=$('login-password'),submitButton=$('login-submit');

const state={user:'',password:null,flow:null,wizard:null,mode:'login',capture:null,typed:false,armedAt:0,loginId:null,busy:false,source:'human',paused:false,waiting:false,widget:null};
const knownPasswords=new Map();
let monitor=null,monitorCapture=null,monitorTimer=null,monitorGeneration=0;

const label=()=>{$('study-session').textContent=recordingSessionLabel(state.user||$('user').value);return $('study-session').textContent;};
const badge=(id,text,tone)=>{const el=$(id);el.textContent=text;el.className=`badge${tone?` ${tone}`:''}`;};
const note=(text,tone)=>{const el=$('login-note');el.textContent=text??'';el.className=`status${tone?` ${tone}`:''}`;};
let toastTimer=null;
const toast=(text,tone)=>{const el=$('toast');el.textContent=text;el.className=`toast${tone?` ${tone}`:''}`;el.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>{el.hidden=true;},1600);};
const configure=()=>{sdk.deviceClass=$('device-mode').value||undefined;label();};
const friendly=code=>({
  ALREADY_ENROLLED:'This account is already enrolled. Just log in below.',
  ENROLLMENT_UNAUTHORIZED:'Enrollment is not authorized on this server.',
  PROFILE_NOT_FOUND:'No profile for that account yet. Enroll it first.',
  PASSIVE_PROFILE_REQUIRED:'Enroll the account before enrolling a device.',
  DEVICE_ALREADY_ENROLLED:'This browser is already trusted for that account.',
  ENROLLMENT_IN_PROGRESS:'An enrollment is already in progress for that account.',
  RATE_LIMITED:'Too many requests. Wait a moment and try again.',
  CHALLENGE_NOT_BOUND:'The account could not be verified. Try again.',
  INVALID_USER:'Usernames use letters, numbers, - and _ only.',
  INVALID_CREDENTIALS:'That is not this account\'s password.',
  WEAK_PASSWORD:`Passwords need at least ${DEMO_PASSWORD_MIN} characters.`,
  USERNAME_TAKEN:'That username is already taken.',
})[code]??`Something went wrong: ${words(code)}.`;
async function run(fn){
  if(state.busy)return;state.busy=true;
  try{await fn();}
  catch(e){const message=friendly(e.message);note(message,'bad');toast(message,'bad');console.warn('[bioprint demo]',e);}
  finally{state.busy=false;}
}

let accountTimer=null;
async function refreshAccount(){
  const name=$('user').value.trim();
  usernameField.placeholder=name||'username';
  if(!/^[a-zA-Z0-9_-]{1,64}$/.test(name)){$('account-status').textContent='Usernames use letters, numbers, - and _ only.';badge('account-badge','INVALID','bad');return;}
  try{
    const response=await fetch(`/bioprint/profile/${encodeURIComponent(name)}/status`,{credentials:'include'});
    const s=await response.json();
    $('account-password-label').textContent=s.account?'Your password':'Choose a password';
    $('account-password').autocomplete=s.account?'current-password':'new-password';
    if(s.passiveEnrolled){
      $('account-status').textContent=`${name} is enrolled · ${s.passiveRounds} typing rounds · ${s.trustedDevices} trusted device${s.trustedDevices===1?'':'s'}${s.ambientEnrolled?' · pre-login model':''}`;
      badge('account-badge','ENROLLED','good');$('enroll').textContent='Enrolled';$('enroll').disabled=true;
    }else if(s.enrolled){
      $('account-status').textContent=`${name} has a movement profile only. Enroll adds the typing profile.`;badge('account-badge','PARTIAL','warn');$('enroll').textContent='Enroll';$('enroll').disabled=false;
    }else if(s.account){
      $('account-status').textContent=`${name} has an account but no profile yet. Enter its password and click Enroll to continue.`;badge('account-badge','NO PROFILE','warn');$('enroll').textContent='Enroll';$('enroll').disabled=false;
    }else{
      $('account-status').textContent=`${name} is not enrolled yet. Choose a password; enrollment takes about two minutes of ordinary logins.`;badge('account-badge','NEW','');$('enroll').textContent='Enroll';$('enroll').disabled=false;
    }
  }catch{$('account-status').textContent='Server unreachable.';badge('account-badge','OFFLINE','bad');}
}
$('user').addEventListener('input',()=>{clearTimeout(accountTimer);accountTimer=setTimeout(refreshAccount,250);label();});
$('user').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();$('account-password').focus();}});
$('account-password').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();$('enroll').click();}});
$('device-mode').addEventListener('change',()=>{configure();if(state.mode==='login')armLogin({fresh:true});});

const onCaptureEvent=e=>{if(e.type==='keydown')state.typed=true;live.event(e);};
function cancelCapture(){state.capture?.cancel();state.capture=null;}
function showForm({locked=false,clear=false}={}){
  form.hidden=false;$('stepup-mount').hidden=true;
  for(const el of [usernameField,passwordField,submitButton]){el.disabled=locked;}
  if(clear){usernameField.value='';passwordField.value='';}
}
function loginLabels(){
  $('password-label').textContent='Password';passwordField.type='password';passwordField.autocomplete='current-password';
  $('password-hint').textContent='The password you chose when you enrolled.';
  submitButton.textContent='Log in';
  $('login-instruction').textContent='Type your username and password, then click the button. BioPrint checks the rhythm, not just the letters.';
}
async function bindChallenge(capture,name){
  try{const c=await sdk.passiveChallenge(name,null);if(state.capture===capture)capture.bind(c);return true;}
  catch(e){if(state.capture===capture)note(e.message==='PROFILE_NOT_FOUND'?`No profile for ${name} yet — enroll first, or type an enrolled username.`:friendly(e.message),'warn');return false;}
}
async function armLogin({fresh=false}={}){
  if(state.mode!=='login')return;
  if(!fresh&&state.capture&&(state.typed||performance.now()-state.armedAt<90000))return;
  cancelCapture();configure();loginLabels();
  showForm({locked:false,clear:fresh||!state.typed});
  $('login-actions').hidden=true;badge('login-badge','READY','');
  if(fresh)note('');
  state.typed=false;state.armedAt=performance.now();live.reset();
  const capture=sdk.capturePassive(null,{form,username:usernameField,password:passwordField,submit:submitButton,studySessionId:label(),onEvent:onCaptureEvent});
  state.capture=capture;
  const name=usernameField.value.trim()||$('user').value.trim();
  if(name)await bindChallenge(capture,name);
}
form.addEventListener('focusin',()=>{if(state.mode==='login'&&!state.busy)armLogin();});
$('again').onclick=()=>run(async()=>{state.mode='login';await armLogin({fresh:true});usernameField.focus();});

form.addEventListener('submit',event=>{event.preventDefault();run(()=>submitForm(event));});
async function submitForm(event){
  if(state.mode==='stepup'||state.mode==='active-training')return;
  const training=state.mode==='training';
  if(!training&&!state.capture)await armLogin();
  const capture=state.capture;if(!capture)throw Error('CHALLENGE_NOT_BOUND');
  const name=usernameField.value.trim(),secret=passwordField.value;
  if(training&&secret!==state.password){note('That is not the password you chose for this account. Type it exactly.','bad');passwordField.select();return;}
  if(!training){
    if(!name){note('Type your username first.','bad');usernameField.focus();return;}
    if(capture.bound()?.userId!==name&&!await bindChallenge(capture,name)){
      capture.cancel();state.capture=null;
      dash.render({decision:'UNAVAILABLE',unavailable:true,reasons:['PROFILE_NOT_FOUND']},{source:state.source,user:name});
      state.source='human';$('login-actions').hidden=false;showForm({locked:true});return;
    }
  }
  const payload=capture.finish(event);state.capture=null;
  passwordField.value='';showForm({locked:true});badge('login-badge','DECIDING…','warn');
  const started=performance.now();
  const result=await sdk.submitPassive(payload,training?{enrollment:state.flow.passiveEnrollment}:{password:secret});
  const roundTripMs=performance.now()-started;
  if(training)return trainingResult(result,roundTripMs);
  const source=state.source;state.source='human';
  if(result.password==='PASS')knownPasswords.set(name,secret);
  dash.render(result,{roundTripMs,source,user:name});
  if(result.decision==='STEP_UP'){state.loginId=result.loginId;return stepUp(name);}
  finishLogin(result,name);
}
function finishLogin(result,name){
  state.mode='login';$('login-actions').hidden=false;
  const tone=result.allowed?'good':result.decision==='REJECT'?'bad':'warn';
  badge('login-badge',result.allowed?'ACCEPTED':result.decision==='REJECT'?'BLOCKED':words(result.decision).toUpperCase(),tone);
  note(result.allowed?`Welcome back, ${name}. Logged in on rhythm alone${result.phase==='final'?' plus one quick check':''}.`:result.decision==='REJECT'?'Blocked. Choose Log in again for a fresh attempt.':'',tone);
  if(result.allowed&&result.loginId)startMonitoring(name,result.loginId);
}

async function stepUp(name){
  state.mode='stepup';form.hidden=true;$('stepup-mount').hidden=false;badge('login-badge','ONE MORE CHECK','warn');
  note('The login form alone was not enough. One short check, about ten seconds.','warn');
  const c=await sdk.stepUpChallenge(name,state.loginId);
  const widget=createStepUp(sdk,c,{mount:$('stepup-mount'),title:'One more check',note:`Type the phrase, then ${c.interaction==='drag'?'drag the arrow to':'click'} the ${c.targets.length} numbered targets in order.`,studySessionId:label(),cancellable:true});
  state.widget=widget;widget.focus();
  const payload=await widget.done;widget.destroy();state.widget=null;
  $('stepup-mount').hidden=true;showForm({locked:true});
  if(!payload){const declined={decision:'REJECT',allowed:false,phase:'final',reasons:['STEP_UP_DECLINED']};dash.render(declined,{source:'stepup',user:name});finishLogin(declined,name);return;}
  const started=performance.now();
  const result=await sdk.finishStepUp(payload,state.loginId);
  dash.render(result,{roundTripMs:performance.now()-started,source:'stepup',user:name});
  finishLogin(result,name);
}

function paintWizard(){
  const w=state.wizard;if(!w)return;
  const passive=w.passiveDone<w.passiveReq||w.passiveReady===false,active=!passive&&(w.activeDone<w.activeReq||w.activeReady===false);
  const done=passive?w.passiveDone:active?w.activeDone:w.activeBase,base=passive?w.passiveBase:w.activeBase,extra=done>=base;
  const phase=passive?'Typing':'Movement';
  $('ring').style.setProperty('--p',String(Math.min(100,done/base*100)));$('ring-text').textContent=`${Math.min(done,base)}/${base}`;
  $('wizard-phase').textContent=passive||active?(extra?`Extra ${phase.toLowerCase()} round ${done-base+1}`:`${phase} round ${done+1} of ${base}`):'Saving your profile';
  $('wizard-instruction').textContent=passive?(extra?'Your rounds disagreed a little, so one more ordinary login. Type both fields by hand, then click the button.':'One ordinary login per round. Type both fields by hand, then click the button with your mouse.'):active?(extra?'One more so the movement rounds agree with each other.':'Type the phrase and hit the targets. This trains the extra check used when a login is uncertain.'):'Calibrating from your rounds.';
  badge('login-badge',passive?'STEP 1 · TYPING':active?'STEP 2 · MOVEMENT':'SAVING','warn');
  $('pause').textContent=state.paused?'Resume':'Pause';
}
async function startEnrollment(device){
  if(state.mode!=='login'&&!state.wizard)return;
  configure();cancelCapture();stopMonitor();
  state.user=$('user').value.trim();
  const secret=$('account-password').value;
  if(secret.length<DEMO_PASSWORD_MIN){
    const message=`Choose a password of at least ${DEMO_PASSWORD_MIN} characters for ${state.user||'this account'}.`;
    $('account-status').textContent=message;badge('account-badge','PASSWORD','warn');$('account-password').focus();toast(message,'bad');return;
  }
  await sdk.request('/demo/register',{userId:state.user,password:secret});
  state.password=secret;knownPasswords.set(state.user,secret);$('account-password').value='';
  refreshUsers();
  const flow=device?await sdk.startDeviceEnrollment(state.user,LOCAL_ENROLLMENT_KEY):await sdk.startEnrollmentFlow(state.user,LOCAL_ENROLLMENT_KEY);
  state.flow=flow;state.paused=false;state.waiting=false;
  const passiveReq=flow.passiveRoundsRequired??8,activeReq=flow.activeComplete?0:(flow.activeRoundsRequired??flow.activeEnrollment?.roundsRequired??6);
  const passiveDone=flow.passiveRoundsAccepted??0,activeDone=flow.activeEnrollment?.roundsAccepted??0;
  state.wizard={passiveDone,passiveReq,passiveBase:passiveReq,passiveReady:passiveDone>=passiveReq?null:false,activeDone,activeReq,activeBase:activeReq,activeReady:activeDone>=activeReq?null:false,
    ceiling:flow.passiveRoundsMaximum??passiveReq+6,activeCeiling:flow.activeRoundsMaximum??12};
  $('login-stage-title').textContent=device?`Enrolling this device for ${state.user}`:`Enrolling ${state.user}`;$('wizard').hidden=false;$('login-actions').hidden=true;
  // Move the person to the card they now have to work in.
  document.body.classList.add('enrolling');$('login-card').scrollIntoView({behavior:'smooth',block:'start'});
  dash.idle('ENROLLING',`Learning how ${state.user} types and moves.`,'Each round is one ordinary login. Rounds are accepted automatically; this panel shows the quality of each capture.');
  toast(device?'Device enrollment started':'Enrollment started','good');
  await advance();
}
async function advance(){
  const w=state.wizard;if(!w)return;
  state.waiting=false;paintWizard();
  if(w.passiveDone<w.passiveReq||w.passiveReady===false)return armTraining();
  if(w.activeDone<w.activeReq||w.activeReady===false)return activeRound();
  return finishEnrollment();
}
async function armTraining(){
  state.mode='training';cancelCapture();
  const c=await sdk.passiveChallenge(state.user,state.flow.passiveEnrollment);
  showForm({locked:false,clear:true});
  $('password-label').textContent='Password';passwordField.type='password';passwordField.autocomplete='off';
  $('password-hint').textContent=`Type the password you chose for ${state.user}.`;
  submitButton.textContent='Submit round';
  $('login-instruction').textContent=`Type ${state.user}, Tab to the password and type it, then move your mouse to the button and click it — exactly as you normally log in.`;
  state.typed=false;live.reset();
  state.capture=sdk.capturePassive(c,{form,username:usernameField,password:passwordField,submit:submitButton,studySessionId:label(),onEvent:onCaptureEvent});
  usernameField.focus();
}
function trainingResult(result,roundTripMs){
  const w=state.wizard;
  dash.render(result,{roundTripMs,source:'enrollment',user:state.user});
  if(result.decision==='SAMPLE_ACCEPTED'){
    w.passiveDone=Number.isFinite(result.roundsAccepted)?result.roundsAccepted:w.passiveDone+1;
    if(Number.isFinite(result.roundsRequired))w.passiveReq=Math.min(w.ceiling,result.roundsRequired);
    w.passiveReady=typeof result.readyToComplete==='boolean'?result.readyToComplete:(w.passiveDone>=w.passiveReq?null:false);
    toast(`Round ${w.passiveDone+w.activeDone} accepted ✓`,'good');
    note('');
  }else{
    note(`Round not accepted: ${(result.reasons??[]).map(words).join(', ')||'not enough signal'}. Type both fields by hand and click the button with your mouse — redoing this round.`,'warn');
  }
  paintWizard();scheduleAdvance();
}
function scheduleAdvance(){
  if(state.paused){state.waiting=true;note('Paused. Choose Resume to continue enrollment.','warn');return;}
  setTimeout(()=>{if(state.wizard&&!state.paused)run(advance);else state.waiting=true;},650);
}
async function activeRound(){
  const w=state.wizard;state.mode='active-training';cancelCapture();
  form.hidden=true;$('stepup-mount').hidden=false;
  const c=await sdk.challenge(state.user,state.flow.activeEnrollment);
  const widget=createStepUp(sdk,c,{mount:$('stepup-mount'),title:`Movement round ${w.activeDone+1} of ${w.activeReq}`,
    note:`Type the phrase, then ${c.interaction==='drag'?'drag the arrow to':'click'} the ${c.targets.length} numbered targets in order.`,studySessionId:label(),cancellable:true});
  state.widget=widget;widget.focus();
  const payload=await widget.done;widget.destroy();state.widget=null;
  if(!state.wizard)return;
  if(!payload){state.paused=true;state.waiting=true;paintWizard();$('stepup-mount').hidden=true;note('Enrollment paused. Choose Resume to continue.','warn');return;}
  const started=performance.now();
  const result={...await sdk.verify(payload,state.flow.activeEnrollment),phase:'active'};
  dash.render(result,{roundTripMs:performance.now()-started,source:'enrollment',user:state.user});
  if(result.decision==='SAMPLE_ACCEPTED'){
    w.activeDone=Number.isFinite(result.roundsAccepted)?result.roundsAccepted:w.activeDone+1;
    if(Number.isFinite(result.roundsRequired))w.activeReq=Math.min(w.activeCeiling,result.roundsRequired);
    w.activeReady=typeof result.readyToComplete==='boolean'?result.readyToComplete:(w.activeDone>=w.activeReq?null:false);
    toast(`Round ${w.passiveDone+w.activeDone} accepted ✓`,'good');note('');
  }
  else note(`Round not accepted: ${(result.reasons??[]).map(words).join(', ')||'incomplete'}. Type the phrase exactly and hit every target — redoing this round.`,'warn');
  paintWizard();scheduleAdvance();
}
async function finishEnrollment(){
  const w=state.wizard;
  try{
    const started=performance.now();
    const result=await sdk.completeEnrollmentFlow(state.user,state.flow);
    dash.render(result,{roundTripMs:performance.now()-started,source:'enrollment',user:state.user});
    state.flow=null;state.wizard=null;$('wizard').hidden=true;$('login-stage-title').textContent='Log in';
    document.body.classList.remove('enrolling');
    toast(`${state.user} enrolled ✓`,'good');
    state.mode='login';await armLogin({fresh:true});
    badge('login-badge','ENROLLED · LOG IN NOW','good');
    note(`${state.user} is enrolled. Now log in: type ${state.user} and your password the way you normally would, then click Log in.`,'good');
    $('login-card').scrollIntoView({behavior:'smooth',block:'start'});usernameField.focus();
    state.password=null;
    refreshAccount();refreshUsers();
  }catch(e){
    if(['PASSIVE_ENROLLMENT_INCONSISTENT','MORE_PASSIVE_DEVICE_ENROLLMENT_REQUIRED','MORE_PASSIVE_ENROLLMENT_REQUIRED'].includes(e.message)&&w.passiveDone<w.ceiling){w.passiveReq=w.passiveDone+1;w.passiveReady=false;note('');return advance();}
    if(['ENROLLMENT_INCONSISTENT','MORE_ENROLLMENT_REQUIRED'].includes(e.message)&&w.activeDone<w.activeCeiling){w.activeReq=w.activeDone+1;w.activeReady=false;note('');return advance();}
    document.body.classList.remove('enrolling');
    throw e;
  }
}
$('enroll').onclick=()=>run(()=>startEnrollment(false));
$('enroll-device').onclick=()=>run(()=>startEnrollment(true));
$('pause').onclick=()=>{
  state.paused=!state.paused;paintWizard();
  if(state.paused){note('Paused. Choose Resume to continue enrollment.','warn');return;}
  note('');if(state.waiting)run(advance);
};
$('motion').onclick=()=>run(async()=>{toast(await sdk.enableMotion()?'Motion sensors enabled for active checks':'Motion sensors unavailable','');});

function ambientStatus(s){
  const pill=$('ambient-pill');
  if(s?.stopped){pill.dataset.state='off';$('ambient-status').textContent=`Observation stopped (${words(s.reason)})`;return;}
  if(s?.error){pill.dataset.state='off';$('ambient-status').textContent=`Observation error: ${words(s.error)}`;return;}
  pill.dataset.state='on';
  $('ambient-status').textContent=`Observing · ${s?.accepted??0} window${s?.accepted===1?'':'s'}${Number.isFinite(s?.quality)?` · quality ${s.quality.toFixed(2)}`:''}`;
}
async function startAmbient(){
  try{await sdk.startAmbientCollection({root:document,view:'demo',studySessionId:label(),onWindow:ambientStatus});$('ambient-pill').dataset.state='on';$('ambient-status').textContent='Observing this page · no account attached yet';}
  catch(e){$('ambient-pill').dataset.state='off';$('ambient-status').textContent=`Observation unavailable: ${words(e.message)}`;}
}

const monitorText=(text,tone)=>{$('monitor-status').textContent=text;$('monitor-dot').className=`foot-dot${tone?` ${tone}`:''}`;};
function stopMonitor(message='Session monitoring stopped.'){
  monitorGeneration++;clearTimeout(monitorTimer);monitorCapture?.cancel();monitorCapture=null;
  if(monitor){sdk.stopMonitoring(monitor.user,monitor.id).catch(()=>{});monitor=null;}
  $('monitor-stop').hidden=true;monitorText(message,'');
}
async function monitorWindow(generation){
  if(generation!==monitorGeneration||!monitor)return;
  try{
    const c=await sdk.monitorChallenge(monitor.user,monitor.id);if(generation!==monitorGeneration)return;
    monitorCapture=sdk.captureContinuous(c,{roots:[document]});
    monitorTimer=setTimeout(async()=>{
      if(generation!==monitorGeneration)return;
      try{
        const payload=monitorCapture.finish();monitorCapture=null;const r=await sdk.submitMonitor(payload);
        if(generation!==monitorGeneration)return;
        if(r.reauthenticationRequired){stopMonitor('Session monitoring asked for a fresh login.');$('monitor-dot').className='foot-dot bad';return;}
        monitorText(`Session monitoring for ${monitor.user}: ${words(r.decision)} · identity ${Number.isFinite(r.identityScore)?r.identityScore.toFixed(2):'—'} · window ${r.windows??'?'}${r.renewals?` · renewed ${r.renewals}×`:''}`,'on');
        await monitorWindow(generation);
      }catch(e){if(generation===monitorGeneration)stopMonitor(`Session monitoring stopped: ${words(e.message)}.`);}
    },30000);
  }catch(e){if(generation===monitorGeneration)stopMonitor(`Session monitoring stopped: ${words(e.message)}.`);}
}
async function startMonitoring(user,loginId){
  stopMonitor();
  try{
    const session=await sdk.startMonitoring(user,loginId);monitor={id:session.monitorId,user};
    const generation=++monitorGeneration;$('monitor-stop').hidden=false;
    monitorText(`Session monitoring for ${user}: observing this page in 30-second windows. It can only ask for a fresh login, never grant one.`,'on');
    await monitorWindow(generation);
  }catch(e){stopMonitor(`Session monitoring unavailable: ${words(e.message)}.`);}
}
$('monitor-stop').onclick=()=>stopMonitor();

function abortEnrollment(){
  if(!state.wizard&&state.mode==='login')return;
  cancelCapture();state.widget?.destroy();state.widget=null;
  state.flow=null;state.wizard=null;state.paused=false;state.waiting=false;state.password=null;
  $('wizard').hidden=true;$('stepup-mount').hidden=true;$('login-stage-title').textContent='Log in';
  document.body.classList.remove('enrolling');
  state.mode='login';
}
const el=(tag,className,text)=>{const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;};
async function refreshUsers(){
  const list=$('user-list');
  try{
    const {users}=await (await fetch('/bioprint/demo/users',{credentials:'include'})).json();
    if(!users.length)return list.replaceChildren(el('li','hint','No users yet.'));
    list.replaceChildren(...users.map(u=>{
      const li=el('li');
      const tag=el('span',`badge ${u.passiveEnrolled?'good':'warn'}`,u.passiveEnrolled?`ENROLLED · ${u.passiveRounds} rounds`:u.account?'NO PROFILE':'PROFILE ONLY');
      const del=el('button','ghost small danger','Delete');del.type='button';del.onclick=()=>run(()=>deleteUser(u.userId));
      li.append(el('b',null,u.userId),tag,del);return li;
    }));
  }catch{list.replaceChildren(el('li','hint','User list unavailable.'));}
}
async function deleteUser(name){
  if(!confirm(`Delete ${name}? The account, its behavioral profile and every recording will be removed.`))return;
  const result=await sdk.request('/demo/users/delete',{userId:name});
  knownPasswords.delete(name);
  if(monitor?.user===name)stopMonitor('Session monitoring stopped: the account was deleted.');
  if(state.user===name)abortEnrollment();
  toast(`${name} deleted${result.profile?' with its profile':''}`,'warn');
  sdk.stopAmbientCollection();await startAmbient();
  await refreshUsers();await refreshAccount();
  if(state.mode==='login')await armLogin({fresh:true});
}
async function resetDemo(){
  if(!confirm('Clear everything? Every account, behavioral profile and recording on this demo server will be deleted.'))return;
  const result=await sdk.request('/demo/reset',{});
  knownPasswords.clear();
  stopMonitor('Session monitoring starts after an accepted login.');abortEnrollment();
  dash.idle('WAITING','Log in to see a decision.','Every decision is explained here: which signals matched, which did not, and anything that looked automated or replayed.');
  note('');
  toast(`Cleared: ${result.accounts} account${result.accounts===1?'':'s'} removed`,'warn');
  sdk.stopAmbientCollection();await startAmbient();
  await refreshUsers();await refreshAccount();await armLogin({fresh:true});
}
$('reset-all').onclick=()=>run(resetDemo);
$('manage-users').addEventListener('toggle',()=>{if($('manage-users').open)refreshUsers();});

label();refreshAccount();refreshUsers();startAmbient();armLogin({fresh:true});
{
  const params=new URLSearchParams(location.search),auto=params.get('auto'),who=params.get('user');
  if(who&&/^[a-zA-Z0-9_-]{1,64}$/.test(who)){$('user').value=who;refreshAccount();}
  if(auto==='enroll')setTimeout(()=>$('enroll').click(),900);
}
