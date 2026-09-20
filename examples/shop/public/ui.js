export const $=selector=>document.querySelector(selector);

export function h(tag,props={},...children){
  const node=document.createElement(tag);
  for(const [key,value] of Object.entries(props)){
    if(value===undefined||value===null||value===false)continue;
    if(key==='class')node.className=value;
    else if(key==='dataset')Object.assign(node.dataset,value);
    else if(key.startsWith('on')&&typeof value==='function')node.addEventListener(key.slice(2).toLowerCase(),value);
    else if(key.includes('-')||key==='role')node.setAttribute(key,String(value));
    else node[key]=value;
  }
  node.append(...children.flat().filter(c=>c!==null&&c!==undefined&&c!==false));
  return node;
}

export const money=cents=>`£${cents.toFixed(2)}`;

export function createModal(host){
  let onClose=null;
  const panel=h('div',{class:'modal-panel',role:'dialog','aria-modal':'true'});
  const close=h('button',{class:'modal-close',type:'button','aria-label':'Close',textContent:'✕',onclick:()=>api.close()});
  const backdrop=h('div',{class:'modal-backdrop',hidden:true},h('div',{class:'modal-shell'},close,panel));
  backdrop.addEventListener('click',e=>{if(e.target===backdrop)api.close();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!backdrop.hidden)api.close();});
  host.append(backdrop);
  const api={
    open(content,{dismissable=true,onClose:handler=null}={}){
      onClose=handler;close.hidden=!dismissable;backdrop.dataset.dismissable=String(dismissable);
      panel.replaceChildren(content);backdrop.hidden=false;document.body.classList.add('modal-open');
    },
    replace(content){panel.replaceChildren(content);},
    close(){
      if(backdrop.hidden)return;
      if(backdrop.dataset.dismissable==='false')return;
      backdrop.hidden=true;panel.replaceChildren();document.body.classList.remove('modal-open');
      const handler=onClose;onClose=null;handler?.();
    },
    forceClose(){backdrop.dataset.dismissable='true';close.hidden=false;api.close();},
    setDismissable(flag){backdrop.dataset.dismissable=String(flag);close.hidden=!flag;},
    isOpen:()=>!backdrop.hidden,
    panel,
  };
  return api;
}
