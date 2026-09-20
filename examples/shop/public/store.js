import { h, money } from './ui.js';
import { PRODUCTS, CATEGORIES, SORTS, search } from './catalog.js';

const VIEW={catalog:'catalog',product:'product',cart:'cart',account:'account'};
const CART_KEY='verdant.cart';

const loadCart=()=>{
  try{
    const raw=JSON.parse(localStorage.getItem(CART_KEY)??'[]');
    return new Map(Array.isArray(raw)
      ? raw.filter(([id,qty])=>PRODUCTS.some(p=>p.id===id)&&Number.isInteger(qty)&&qty>0)
           .map(([id,qty])=>[id,Math.min(99,qty)])
      : []);
  }catch{return new Map();}
};
const saveCart=cart=>{try{localStorage.setItem(CART_KEY,JSON.stringify([...cart]));}catch{/* storage may be unavailable */}};

const readHash=()=>{
  const [route,id]=(location.hash.replace(/^#\/?/,'')||'catalog').split('/');
  if(route==='product'&&id&&PRODUCTS.some(p=>p.id===id))return {name:'product',id};
  return VIEW[route]&&route!=='product'?{name:route,id:null}:{name:'catalog',id:null};
};
const writeHash=route=>{
  const next=route.name==='catalog'?'#/':`#/${route.name}${route.id?`/${route.id}`:''}`;
  if(location.hash!==next)history.pushState(null,'',next);
};

export function createStore({mount,setView,onCheckout,onAccount,user=()=>null}){
  const state={route:readHash(),query:'',category:'all',sort:'relevance',cart:loadCart()};
  let searchInput=null;

  const lines=()=>[...state.cart.entries()].map(([id,qty])=>({product:PRODUCTS.find(p=>p.id===id),qty}));
  const total=()=>lines().reduce((sum,l)=>sum+l.product.price*l.qty,0);
  const count=()=>[...state.cart.values()].reduce((a,b)=>a+b,0);

  const go=(name,id=null,{push=true}={})=>{
    state.route={name,id};
    if(push)writeHash(state.route);
    try{setView(VIEW[name]);}catch{/* a stopped ambient session is not fatal */}
    render();
    if(name==='catalog'&&searchInput)requestAnimationFrame(()=>searchInput.focus({preventScroll:true}));
    window.scrollTo({top:0,behavior:'smooth'});
  };

  const commit=()=>{saveCart(state.cart);render();};
  const add=(product,qty=1)=>{state.cart.set(product.id,Math.min(99,(state.cart.get(product.id)??0)+qty));commit();};
  const setQty=(id,qty)=>{if(qty<=0)state.cart.delete(id);else state.cart.set(id,Math.min(99,qty));commit();};

  const thumb=(product,size)=>h('div',{class:`thumb ${size}`,style:`--a:${product.tone[0]};--b:${product.tone[1]}`,'aria-hidden':'true'},
    h('span',{class:'thumb-mark',textContent:product.name.slice(0,1)}));

  const card=product=>h('article',{class:'card product'},
    h('button',{class:'card-open',type:'button','aria-label':`Open ${product.name}`,onclick:()=>go('product',product.id)},
      thumb(product,'small'),
      h('div',{class:'card-body'},
        h('h3',{textContent:product.name}),
        h('p',{class:'muted',textContent:product.blurb}),
        h('div',{class:'card-meta'},
          h('strong',{textContent:money(product.price)}),
          h('span',{class:'rating',textContent:`★ ${product.rating.toFixed(1)}`}),
        ),
      ),
    ),
    h('button',{class:'primary wide',type:'button',textContent:'Add to basket',onclick:()=>add(product)}),
  );

  const filters=()=>h('div',{class:'filters'},
    h('div',{class:'chips',role:'group','aria-label':'Category'},
      CATEGORIES.map(category=>h('button',{
        class:`chip${state.category===category?' on':''}`,type:'button',textContent:category,
        'aria-pressed':String(state.category===category),
        onclick:()=>{state.category=category;render();},
      })),
    ),
    h('label',{class:'sort'},'Sort',
      h('select',{value:state.sort,onchange:e=>{state.sort=e.target.value;render();}},
        Object.entries(SORTS).map(([key,{label}])=>h('option',{value:key,textContent:label,selected:state.sort===key})),
      ),
    ),
  );

  const catalogView=()=>{
    let results=search(PRODUCTS,state.query);
    if(state.category!=='all')results=results.filter(p=>p.category===state.category);
    const compare=SORTS[state.sort].compare;
    if(compare)results=[...results].sort(compare);
    return h('section',{},
      h('div',{class:'hero'},
        h('h1',{textContent:'Things that grow, and things to grow them in.'}),
        h('p',{class:'muted',textContent:'Browse as long as you like. You only need an account at the checkout.'}),
      ),
      filters(),
      h('p',{class:'muted count',textContent:`${results.length} item${results.length===1?'':'s'}${state.query?` matching “${state.query}”`:''}`}),
      results.length
        ? h('div',{class:'grid'},results.map(card))
        : h('p',{class:'empty',textContent:'Nothing matched. Try a shorter search.'}),
    );
  };

  const productView=()=>{
    const product=PRODUCTS.find(p=>p.id===state.route.id);
    if(!product)return h('p',{class:'empty',textContent:'That item is gone.'});
    let qty=1;
    const qtyLabel=h('output',{class:'qty-value',textContent:'1'});
    const step=delta=>{qty=Math.max(1,Math.min(99,qty+delta));qtyLabel.textContent=String(qty);};
    return h('section',{class:'detail'},
      h('button',{class:'back',type:'button',textContent:'← Back to catalogue',onclick:()=>go('catalog')}),
      h('div',{class:'detail-grid'},
        thumb(product,'large'),
        h('div',{},
          h('p',{class:'eyebrow',textContent:product.category}),
          h('h1',{textContent:product.name}),
          h('p',{class:'lede',textContent:product.blurb}),
          h('p',{class:'price',textContent:money(product.price)}),
          h('p',{class:'muted',textContent:`★ ${product.rating.toFixed(1)} · ${product.stock} in stock`}),
          h('div',{class:'qty'},
            h('button',{type:'button','aria-label':'Decrease quantity',textContent:'−',onclick:()=>step(-1)}),
            qtyLabel,
            h('button',{type:'button','aria-label':'Increase quantity',textContent:'+',onclick:()=>step(1)}),
          ),
          h('div',{class:'row'},
            h('button',{class:'primary',type:'button',textContent:'Add to basket',onclick:()=>add(product,qty)}),
            h('button',{class:'ghost',type:'button',textContent:'View basket',onclick:()=>go('cart')}),
          ),
        ),
      ),
    );
  };

  const cartView=()=>{
    const items=lines();
    return h('section',{class:'cart'},
      h('h1',{textContent:'Your basket'}),
      items.length?h('div',{class:'lines'},items.map(({product,qty})=>h('div',{class:'line'},
        thumb(product,'tiny'),
        h('div',{},h('strong',{textContent:product.name}),h('p',{class:'muted',textContent:money(product.price)})),
        h('div',{class:'qty small'},
          h('button',{type:'button','aria-label':`Fewer ${product.name}`,textContent:'−',onclick:()=>setQty(product.id,qty-1)}),
          h('output',{textContent:String(qty)}),
          h('button',{type:'button','aria-label':`More ${product.name}`,textContent:'+',onclick:()=>setQty(product.id,qty+1)}),
        ),
        h('strong',{class:'line-total',textContent:money(product.price*qty)}),
      ))):h('p',{class:'empty',textContent:'Nothing in the basket yet.'}),
      h('div',{class:'totals'},
        h('span',{textContent:'Subtotal'}),
        h('strong',{textContent:money(total())}),
      ),
      h('div',{class:'row'},
        h('button',{class:'primary',type:'button',textContent:'Checkout',disabled:!items.length,onclick:()=>onCheckout()}),
        h('button',{class:'ghost',type:'button',textContent:'Keep browsing',onclick:()=>go('catalog')}),
      ),
    );
  };

  const views={catalog:catalogView,product:productView,cart:cartView,account:()=>onAccount()};

  const header=()=>{
    searchInput=h('input',{
      class:'search',type:'search',placeholder:'Search the catalogue',value:state.query,
      autocomplete:'off','aria-label':'Search products',
      oninput:e=>{state.query=e.target.value;if(state.route.name!=='catalog')go('catalog');else renderMain();},
    });
    return h('header',{class:'top'},
      h('button',{class:'brand',type:'button',onclick:()=>go('catalog')},'❧ Verdant'),
      searchInput,
      h('nav',{},
        (who=>h('button',{class:`ghost${who?' signed-in':''}`,type:'button',
          textContent:who?`Account · ${who}`:'Account',onclick:()=>go('account')}))(user()),
        h('button',{class:'ghost cart-button',type:'button',onclick:()=>go('cart')},`Basket${count()?` · ${count()}`:''}`),
      ),
    );
  };

  const main=h('main',{});
  const renderMain=()=>{
    const cursor=searchInput?{start:searchInput.selectionStart,end:searchInput.selectionEnd}:null;
    main.replaceChildren(views[state.route.name]());
    if(cursor&&searchInput&&document.activeElement===searchInput)searchInput.setSelectionRange(cursor.start,cursor.end);
  };
  const shell=h('div',{class:'shell'});

  function render(){
    const focused=document.activeElement===searchInput;
    const selection=searchInput?{start:searchInput.selectionStart,end:searchInput.selectionEnd}:null;
    shell.replaceChildren(header(),main);
    renderMain();
    if(focused&&searchInput){searchInput.focus({preventScroll:true});if(selection)searchInput.setSelectionRange(selection.start,selection.end);}
  }

  mount.append(shell);
  render();
  window.addEventListener('popstate',()=>{const r=readHash();go(r.name,r.id,{push:false});});
  return {go,render,state,count,total,lines,clear(){state.cart.clear();saveCart(state.cart);render();}};
}
