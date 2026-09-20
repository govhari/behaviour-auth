import { createBioPrint } from '/sdk/bioprint.js';
import { h, money, createModal } from './ui.js';
import { createStore } from './store.js';
import { createIdentity } from './identity.js';
import { createHud } from './hud.js';

const root=document.getElementById('app');
const layer=document.getElementById('layer');
const modal=createModal(layer);
const hud=createHud(layer);

const bp=createBioPrint({
  endpoint:'/bioprint',
  view:'catalog',
  ambient:true,
  stepUp:{
    mount(element,{reasons}){
      hud.challengeRequested(reasons);
      modal.open(h('div',{class:'auth'},
        h('h2',{textContent:'One more check'}),
        h('p',{class:'note warn',textContent:`Passive evidence was not conclusive${reasons?.length?`: ${reasons.map(r=>r.replaceAll('_',' ').toLowerCase()).join(' · ')}`:''}.`}),
        element,
      ),{dismissable:false});
    },
    dismiss(){modal.setDismissable(true);},
  },
  onAmbient:state=>hud.ambient(state),
  onEvent:(event,source)=>hud.event(event,source),
  onError:error=>hud.log(error.message.replaceAll('_',' ').toLowerCase(),'bad'),
});

let store=null;
const identity=createIdentity({
  bp,modal,
  hud,
  onSession:session=>{
    hud.session(session);
    store?.render();
  },
  onActivity:state=>hud.monitor(state),
});

function accountView(){
  const session=identity.session();
  if(!session.user)return h('section',{class:'account'},
    h('h1',{textContent:'Your account'}),
    h('p',{class:'muted',textContent:'Sign in to check out. Browsing needs no account at all.'}),
    h('button',{class:'primary',type:'button',textContent:'Sign in or create an account',onclick:()=>identity.openAuth('signin')}),
    demoControls(),
  );
  const profile=session.profile;
  return h('section',{class:'account'},
    h('h1',{textContent:`Hello, ${session.user}`}),
    h('dl',{class:'evidence wide'},
      h('div',{},h('dt',{textContent:'Behavioral profile'}),h('dd',{textContent:profile?.passiveEnrolled?`trained · ${profile.passiveRounds} rounds`:'not trained'})),
      h('div',{},h('dt',{textContent:'Pre-login model'}),h('dd',{textContent:profile?.ambientEnrolled?`${profile.ambientWindows} windows`:'none'})),
      h('div',{},h('dt',{textContent:'Trusted devices'}),h('dd',{textContent:String(profile?.trustedDevices??0)})),
      h('div',{},h('dt',{textContent:'Session monitoring'}),h('dd',{textContent:identity.monitoring()?'observing':'not running until next sign-in'})),
    ),
    h('div',{class:'row'},
      profile?.passiveEnrolled?null:h('button',{class:'primary',type:'button',textContent:'Train my profile',onclick:()=>identity.startEnrollment(session.user)}),
      h('button',{class:'ghost',type:'button',textContent:'Sign out',onclick:()=>identity.signOut()}),
      h('button',{class:'ghost danger',type:'button',textContent:'Delete this account',onclick:()=>identity.deleteAccount()}),
    ),
    demoControls(),
  );
}
function demoControls(){
  return h('div',{class:'demo-controls'},
    h('p',{class:'muted',textContent:'Demo controls'}),
    h('button',{class:'ghost danger',type:'button',textContent:'Clear everything',onclick:()=>identity.resetDemo()}),
  );
}

store=createStore({
  mount:root,
  user:()=>identity.session()?.user??null,
  setView:token=>{bp.setView(token);hud.view(token);},
  onAccount:accountView,
  onCheckout(){
    const session=identity.session();
    if(!session.user)return identity.openAuth('signin',{message:'Sign in to complete your order.'});
    const amount=store.total();
    modal.open(h('div',{class:'auth'},
      h('h2',{textContent:'Order placed'}),
      h('p',{class:'note good',textContent:`${money(amount)} charged to nothing at all — this example has no payment backend.`}),
      h('button',{class:'primary wide',type:'button',textContent:'Back to the catalogue',onclick:()=>{modal.forceClose();store.clear();store.go('catalog');}}),
    ));
  },
});

hud.view('catalog');
identity.refresh();
