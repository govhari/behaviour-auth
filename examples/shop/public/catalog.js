export const CATEGORIES=['all','plants','pots','tools','care'];

export const PRODUCTS=[
  {id:'monstera',   name:'Monstera Deliciosa',   category:'plants', price:48,  rating:4.8, stock:12, blurb:'Split leaves, fast grower, forgiving of a missed watering.',   tone:['#2f6b46','#7fc49a']},
  {id:'fiddle',     name:'Fiddle Leaf Fig',      category:'plants', price:72,  rating:4.1, stock:5,  blurb:'Dramatic and opinionated. Bright indirect light only.',        tone:['#356b3c','#a8d48a']},
  {id:'zz',         name:'ZZ Plant',             category:'plants', price:34,  rating:4.9, stock:26, blurb:'Survives low light, low water and low attention.',            tone:['#24503a','#68b487']},
  {id:'pothos',     name:'Golden Pothos',        category:'plants', price:22,  rating:4.7, stock:41, blurb:'Trailing vine that roots from almost any cutting.',           tone:['#3d6b32','#bcd98a']},
  {id:'snake',      name:'Snake Plant',          category:'plants', price:29,  rating:4.6, stock:18, blurb:'Upright, architectural, nearly indestructible.',              tone:['#2b5d45','#8fc9a1']},
  {id:'terracotta', name:'Terracotta Pot 16cm',  category:'pots',   price:14,  rating:4.5, stock:60, blurb:'Unglazed clay that breathes. Drainage hole included.',        tone:['#a8593a','#e2a780']},
  {id:'stoneware',  name:'Stoneware Planter',    category:'pots',   price:38,  rating:4.4, stock:9,  blurb:'Matte glaze, hidden saucer, weighty enough for tall stems.',  tone:['#5a5f6b','#b8bfc9']},
  {id:'hanging',    name:'Hanging Cradle',       category:'pots',   price:26,  rating:4.2, stock:15, blurb:'Cotton macramé rated to four kilograms.',                     tone:['#8a6a44','#dcc39a']},
  {id:'snips',      name:'Precision Snips',      category:'tools',  price:19,  rating:4.8, stock:33, blurb:'Spring-loaded, stainless, for stems under a centimetre.',     tone:['#3f4a55','#9fb0c0']},
  {id:'mister',     name:'Brass Mister',         category:'tools',  price:24,  rating:4.3, stock:21, blurb:'Fine spray for the humidity-hungry. Holds 300ml.',            tone:['#8a7132','#e0cb8c']},
  {id:'moisture',   name:'Moisture Meter',       category:'tools',  price:16,  rating:3.9, stock:48, blurb:'Settles the argument about whether it needs water.',          tone:['#45606b','#a5c7d1']},
  {id:'feed',       name:'Monthly Plant Feed',   category:'care',   price:12,  rating:4.6, stock:75, blurb:'Balanced NPK concentrate. One capful per litre.',             tone:['#4a6b2f','#c3dd90']},
  {id:'mix',        name:'Aroid Potting Mix',    category:'care',   price:18,  rating:4.7, stock:30, blurb:'Bark, perlite and coir. Drains in seconds.',                  tone:['#5c4a33','#c6ab88']},
  {id:'neem',       name:'Neem Oil Spray',       category:'care',   price:15,  rating:4.0, stock:27, blurb:'For the week the fungus gnats arrive.',                       tone:['#3f6b4e','#9ed3ac']},
];

export const SORTS={
  relevance:{label:'Most relevant',  compare:null},
  priceUp:  {label:'Price: low to high', compare:(a,b)=>a.price-b.price},
  priceDown:{label:'Price: high to low', compare:(a,b)=>b.price-a.price},
  rating:   {label:'Best rated',     compare:(a,b)=>b.rating-a.rating},
};

export function search(products,query){
  const terms=query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if(!terms.length)return products;
  return products.filter(p=>{
    const haystack=`${p.name} ${p.category} ${p.blurb}`.toLowerCase();
    return terms.every(term=>haystack.includes(term));
  });
}
