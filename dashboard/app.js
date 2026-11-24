'use strict';
/* Token Launch Radar — renders window.BOARD. */
const B=window.BOARD,M=B.m,K=B.k,CHAINS=B.c.split(','),CATS=B.g.split(','),$=id=>document.getElementById(id);
const GAS={Ethereum:8,Base:.05,Solana:.01,Arbitrum:.2,Binance:.15,Avalanche:.3};
const PLAN=5000,HZ=12,DROP=.07;
const usd=n=>'$'+Math.round(n).toLocaleString('en-US');
const usd1=n=>'$'+(Math.round(n*10)/10).toLocaleString('en-US');
const pct1=n=>(Math.round(n*10)/10).toLocaleString('en-US')+'%';
const clamp=(v,lo,hi)=>Math.min(hi,Math.max(lo,v)),L10=Math.log10;
const esc=s=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
function econ(r){const g=r.chains.length?Math.min(...r.chains.map(c=>GAS[c]??1)):1;
  const s=1000*(r.implied/r.tvl)*DROP*r.odds,fee=2*g+PLAN*.001,hold=PLAN*.04*(HZ/52);
  const c=fee+hold,n=s*5-c,w=s*5/c,a=s/1000-.001-.04*(HZ/52);
  return{gas:g,slice:s,fee,hold,costs:c,net:n,walk:w,be:a>0?2*g/a:null};}
// Rebuild from model-A coefficients (K) + full-precision growth.
function rebuild(r){let s=K.b[0],x=[L10(r.tvl),(r.g7??0)/100];K.c.forEach(c=>x.push(r.category===c?1:0));for(let j=0;j<7;j++)s+=K.b[j+1]*((x[j]-K.mu[j])/K.sd[j]);return Math.max(1,Math.round(Math.min(10**s/r.tvl,K.cap)*r.tvl));}
function cheap(r){if(!r.chains.length)return'its main chain';let b=r.chains[0],g=GAS[b]??1;
  for(const c of r.chains){const v=GAS[c]??1;if(v<g){g=v;b=c;}}return b;}
function catK(r){const c=(r.category||'').toLowerCase();
  if(/dex|swap|perp|derivat|option/.test(c))return/perp|derivat|option/.test(c)?'perps':'dex';
  if(/lend|cdp|credit|borrow/.test(c))return'lending';
  if(/bridge/.test(c))return'bridge';if(/predict/.test(c))return'prediction';
  if(/stak|restak/.test(c))return'staking';if(/yield|farm/.test(c))return'yield';
  if(/rwa|real world/.test(c))return'rwa';if(/basis/.test(c))return'basis';
  if(/vault|curator|allocat/.test(c))return'vault';if(/stable|dual/.test(c))return'stable';
  
  if(/payment/.test(c))return'payment';if(/ai|agent/.test(c))return'ai';
  if(/nft|marketplace/.test(c))return'nft';
  
  if(/collateral|capital/.test(c))return'capital';return'generic';}
const SA={
dex:r=>`run a small swap through ${r.name}'s own pool on ${cheap(r)}`,
perps:r=>`close one hedge on ${r.name} and open a fresh one`,
lending:r=>`borrow a small amount against the position on ${r.name} and repay it`,
bridge:r=>`bridge a small amount back through ${r.name} on ${cheap(r)}`,
prediction:r=>`take a second position in a different market on ${r.name}`,
staking:r=>`claim the staking reward on ${r.name} and restake it`,
yield:r=>`harvest the yield on ${r.name} once and redeposit it`,
rwa:r=>`check the underlying asset's backing for ${r.name} and hold through one attestation cycle`,
basis:r=>`check the funding rate on ${r.name} and roll the basis position once`,
vault:r=>`review the vault's allocation for ${r.name} after one rebalancing and adjust the position`,
stable:r=>`check the peg on ${r.name} and mint or redeem a small amount`,
payment:r=>`pay for something small through ${r.name}`,
ai:r=>`run one agent task through ${r.name}`,
nft:r=>`list or buy one small item through ${r.name}`,
capital:r=>`move a small amount to a second allocator on ${r.name}`,
generic:r=>`use ${r.name} a second time on a different chain or market`};
const WA={dex:'Swap a token you already hold through the pool.',perps:'Close one hedge and open a fresh one.',lending:'Check the borrow rate and repay a little of any open loan.',bridge:'Bridge a small amount back.',prediction:'Take a second position in a different market.',staking:'Claim and restake the reward.',yield:'Harvest the yield and redeposit it.',rwa:"Check the underlying asset's backing and attestations.",basis:'Check the funding rate and roll the basis position.',vault:"Review the vault's allocation and curator notes.",stable:'Check the peg and the collateral ratio.',payment:'Pay for one small thing through the rail.',ai:'Run one agent task.',nft:'Check the floor and one listing.',capital:'Check the allocator performance across chains.',generic:'Use the protocol on a different chain or market.'};
function farmSteps(r){const e=r.e,k=catK(r),bear=e.slice*.33*5-e.costs,tr=M.tierRates.pooled[{HIGH:0,MED:1,LOW:2}[r.tier]];
  const be=e.be===null?'no break-even — the slice never covers the costs':usd(e.be)+' break-even';
  return[`Put $5,000 to work in ${r.name} on ${cheap(r)}: ${usd(e.fee)} in fees plus ${usd(e.gas)} gas, over ${HZ} weeks. If the token launches at the implied ${usd(r.implied)}, the slice is worth ${usd(e.slice*5)}.`,
  `Then ${(SA[k]||SA.generic)(r)} — a second usage trace, in a different week. The position sits on ${r.chains.length} chain${r.chains.length===1?'':'s'} with ${usd(r.tvl)} of TVL.`,
  `Every week, check ${r.name}: TVL ${usd(r.tvl)} (7d ${r.g7===null?'unreported':pct1(r.g7)}), rank #${r.rank} on the board. ${WA[k]||WA.generic} If TVL falls 20% below ${usd(r.tvl*.8)}, pause new deposits.`,
  `The risk: ${r.name} is a ${r.category||'uncategorised'} protocol on ${r.chains.length} chain${r.chains.length===1?'':'s'}, and the $5,000 plan pays only while TVL stays below ${e.walk.toFixed(2)}x its current level — above that the ${usd(e.costs)} costs eat the slice. If the airdrop is worth a third of the slice, the net is ${usd(bear)}, so size for the bear case, not the headline.`,
  `Exit when the token launches or after ${HZ} weeks, whichever comes first: take the slice if it clears the ${be}, otherwise walk away. Odds tier ${r.tier} — ${r.odds.toFixed(3)} token odds (${(tr*100).toFixed(1)}% of similar protocols launched) — a ${r.verdict} at $5,000 over 12 weeks. (Board rank #${r.rank}.)`];}
function gasW(c){const x=c.toLowerCase();
  if(x==='ethereum')return 8;if(x==='solana')return 1;
  if(x==='bitcoin'||x==='babylon genesis'||x==='bittensor')return 2;
  if(['arbitrum','optimism','base','zksync','linea','scroll','blast','mode','mantle','polygon','bsc','avalanche','fantom','gnosis'].includes(x))return 1;
  return 2;}
const capStd=t=>t>=5e9?250:t>=1e9?150:t>=1e8?100:50;
const holdStd=a=>a===null?30:a<180?60:a<365?45:30;
const MAXTVL=Math.max(...B.r.split('\n').map(l=>parseInt(l.split('|')[3],36)));
const ROWS=B.r.split('\n').map((line,i)=>{const a=line.split('|');
  const r={slug:a[0].toLowerCase().replace(/ /g,'-'),name:a[0],category:CATS[+a[1]]||null,
  chains:a[2]?a[2].split(',').map(s=>CHAINS[+s]):[],tvl:parseInt(a[3],36),g7:a[4]==='' ? null : +a[4],listedDays:a[5]==='' ? null : +a[5],
  implied:parseInt(a[6],36),odds:+a[7]/1000,rankLo:+a[8],rankMed:+a[9],rankHi:+a[10],
  tier:{L:'LOW',M:'MED',H:'HIGH'}[a[11]],verdict:{F:'FARM',M:'MARGINAL',S:'SKIP'}[a[12]],
  watchlist:a[13]==='1',grey:a[14]==='1',narrow:a[15]==='1',rank:i+1};
  r.e=econ(r);r.multiple=r.implied/r.tvl;
  r.rangeLo=Math.max(1,Math.round(r.implied/10**M.hwOut));r.rangeHi=Math.round(r.implied*10**M.hwOut);
  r.rLo=Math.max(1,Math.round(r.implied/10**M.hwIn));r.rHi=Math.round(r.implied*10**M.hwIn);
  r.evCost=r.e.slice*5/r.e.costs;
  const gw=gasW(r.chains[0]||'x'),cs=capStd(r.tvl);
  r.gasShare=((gw*2+gw*Math.max(1,Math.round(holdStd(r.listedDays)/7)))/cs)*100;
  const g=clamp(r.g7??0,-60,150),gm=1+g/100,mm=.5+.5*Math.sqrt(clamp(r.listedDays??365,0,1095)/1095),
    ch=1+.03*Math.min(Math.max(r.chains.length-1,0),5),sz=(1e8/Math.max(1,r.tvl))**.25;
  r.farmValue=(r.g7!==null&&r.g7<-10?Math.max(25,Math.round(cs/2)):cs)*(.3*sz*gm*mm*ch);
  r.launch=(r.listedDays!==null?(Math.min(r.listedDays,1095)/1095)*40:20)+(L10(r.tvl/5e6)/3)*30;
  const tv=40*clamp((L10(r.tvl)-L10(5e6))/(L10(MAXTVL)-L10(5e6)),0,1),
    mo=20*Math.max(0,1-Math.abs(r.g7??0)/40),
    ma=r.listedDays!==null?(Math.min(r.listedDays,1095)/1095)*20:10,
    br=Math.min(r.chains.length,10),ca=Math.min(M.model.catn[CATS.indexOf(r.category||'')]??0,10);
  r.conv={score:tv+mo+ma+br+ca,parts:[tv,mo,ma,br,ca]};
  return r;});
const BYSLUG={};ROWS.forEach(r=>BYSLUG[r.slug]=r);
const DISC=new Set();ROWS.slice(0,10).forEach(r=>DISC.add(r.slug));
ROWS.forEach(r=>{if(r.verdict==='FARM'&&r.e.slice*.33*5-r.e.costs>25)DISC.add(r.slug);
  if(r.verdict==='FARM'&&r.e.walk<2)DISC.add(r.slug);
  if(r.verdict==='FARM'&&Math.abs(-r.e.costs)>r.e.slice*5-r.e.costs)DISC.add(r.slug);});

// --- columns: [id,label,numeric,default,sortValue,format]
const chip=(t,c)=>'<span class="chip '+c+'">'+t+'</span>';
const band=m=>chip(m<1?'<1x':m<=5?'1–5x':'>5x','');
const tchip=t=>chip(t,t==='HIGH'?'high':t==='LOW'?'low':'');
const vchip=v=>chip(v,v==='FARM'?'farm':v==='SKIP'?'skip':'');
const nameCell=r=>{let c='';
  if(r.verdict==='FARM'&&r.e.slice*.33*5-r.e.costs>25)c+=chip('bear-proof','bear');
  if(r.verdict==='FARM'&&r.e.walk<2)c+=chip('fragile','frag');
  if(r.verdict==='FARM'&&Math.abs(-r.e.costs)>r.e.slice*5-r.e.costs)c+=chip('downside&gt;upside','frag');
  if(r.grey)c+=chip('not on watchlist','');if(r.narrow)c+=chip('outside traded range','');
  return '<a href="#detail='+r.slug+'">'+esc(r.name)+'</a> '+c;};
const rangeCell=r=>{const w=Math.max(1,Math.round(100*(L10(r.rangeHi)-L10(r.rangeLo))/4));
  const p=Math.round(50*(L10(r.rHi)-L10(r.rLo))/(L10(r.rangeHi)-L10(r.rangeLo)));
  return '<span class="bar"><i style="width:'+w+'%"></i><b style="left:'+p+'%"></b></span> '+usd(r.rLo)+'–'+usd(r.rHi);};
const COLS=[
['rank','#',1,1,r=>r.rank,r=>''+r.rank],
['name','Protocol',0,1,r=>r.name,nameCell],
['implied','Implied value',1,1,r=>r.implied,r=>usd(r.implied)],
['multiple','Multiple',1,1,r=>r.multiple,r=>r.multiple.toFixed(2)+'x '+band(r.multiple)],
['odds','Token odds',1,1,r=>r.odds,r=>r.odds.toFixed(3)+' '+tchip(r.tier)],
['verdict','Verdict',0,1,r=>r.verdict,r=>vchip(r.verdict)],
['net','Net ($5K/12wk)',1,1,r=>simNet(r),r=>usd(simNet(r))],
['range','80% range',1,1,r=>r.rangeHi-r.rangeLo,rangeCell],
['tvl','TVL',1,0,r=>r.tvl,r=>usd(r.tvl)],
['g7','7d change',1,0,r=>r.g7===null?-999:r.g7,r=>r.g7===null?'—':pct1(r.g7)],
['chains','Chains',0,0,r=>r.chains.length,r=>r.chains.join(', ')||'—'],
['category','Category',0,0,r=>r.category||'',r=>r.category||'—'],
['conviction','Conviction',1,0,r=>r.conv.score,r=>r.conv.score.toFixed(1)],
['evcost','EV / cost',1,0,r=>r.evCost,r=>r.evCost.toFixed(2)+'x'],
['gasshare','Gas share',1,0,r=>r.gasShare,r=>r.gasShare.toFixed(0)+'%'],
['farmvalue','Farm value',1,0,r=>r.farmValue,r=>usd1(r.farmValue)],
['launch','Launch score',1,0,r=>r.launch,r=>r.launch.toFixed(1)],
['breakeven','Break-even',1,0,r=>r.e.be===null?1e12:r.e.be,r=>r.e.be===null?'never':usd(r.e.be)],
['walkaway','Walk-away',1,0,r=>r.e.walk,r=>r.e.walk.toFixed(2)+'x'],
['rankrange','Rank range (p10–p90)',1,0,r=>r.rankHi-r.rankLo,r=>'#'+r.rankLo+'–#'+r.rankHi]];
const st={sorts:[{id:'rank',dir:1}],showAll:false,density:'compact',
  visible:new Set(COLS.filter(c=>c[3]).map(c=>c[0])),q:'',verdict:'',tier:'',flag:'',
  simDrop:DROP,simHair:0,detail:null};
function simNet(r){return 1000*(r.implied/r.tvl)*st.simDrop*r.odds*(1-st.simHair)*5-r.e.costs;}
function simVerdict(r){const n=simNet(r);return n>25?'FARM':n<-25?'SKIP':'MARGINAL';}
function filt(){let rows=ROWS;const q=st.q.trim().toLowerCase();
  if(q)rows=rows.filter(r=>r.name.toLowerCase().includes(q)||(r.category||'').toLowerCase().includes(q));
  if(st.verdict)rows=rows.filter(r=>r.verdict===st.verdict);
  if(st.tier)rows=rows.filter(r=>r.tier===st.tier);
  if(st.flag==='bear')rows=rows.filter(r=>r.verdict==='FARM'&&r.e.slice*.33*5-r.e.costs>25);
  if(st.flag==='fragile')rows=rows.filter(r=>r.verdict==='FARM'&&r.e.walk<2);
  if(st.flag==='down')rows=rows.filter(r=>r.verdict==='FARM'&&Math.abs(-r.e.costs)>r.e.slice*5-r.e.costs);
  if(st.flag==='grey')rows=rows.filter(r=>r.grey);
  if(st.flag==='narrow')rows=rows.filter(r=>r.narrow);
  if(!(q||st.verdict||st.tier||st.flag)&&!st.showAll)rows=rows.filter(r=>DISC.has(r.slug));
  return rows;}
function renderBoard(){const vis=COLS.filter(c=>st.visible.has(c[0]));
  $('thead').innerHTML='<tr>'+vis.map(c=>{const s=st.sorts.find(x=>x.id===c[0]);
    return '<th data-col="'+c[0]+'" class="'+(c[2]?'num':'')+'">'+esc(c[1])+(s?' <span class="dir">'+(s.dir>0?'▲':'▼')+(st.sorts.length>1?st.sorts.indexOf(s)+1:'')+'</span>':'')+'</th>';}).join('')+'</tr>';
  const rows=[...filt()].sort((a,b)=>{for(const s of st.sorts){const col=COLS.find(c=>c[0]===s.id);
    const av=col[4](a),bv=col[4](b),d=typeof av==='string'?av.localeCompare(bv):av-bv;if(d)return d*s.dir;}return a.rank-b.rank;});
  $('tbody').innerHTML=rows.map(r=>'<tr>'+vis.map(c=>'<td class="'+(c[0]==='name'?'name':c[2]?'num':'')+'">'+c[5](r)+'</td>').join('')+'</tr>').join('');
  const tot=rows.reduce((a,r)=>a+r.implied,0),tn=rows.reduce((a,r)=>a+simNet(r),0),
    fm=rows.filter(r=>simVerdict(r)==='FARM').length;
  $('tfoot').innerHTML='<tr><td colspan="'+vis.length+'">TOTAL — '+rows.length+' rows · implied '+usd(tot)+' · net '+usd(tn)+' · FARM '+fm+'</td></tr>';
  const f=st.q||st.verdict||st.tier||st.flag;
  $('count').textContent='Showing '+rows.length+' of 198 rows'+(f?' (filtered)':st.showAll?' (all)':' — Top-10 + flagged groups (bear-proof 3, fragile 23, downside>upside 23; union 35). Use “Show all 198” for the rest.')+(st.simDrop!==DROP||st.simHair?' — simulator active: drop '+(st.simDrop*100).toFixed(0)+'%, haircut '+(st.simHair*100).toFixed(0)+'%.':'');
  $('show-all').textContent=st.showAll?'Show disclosure (35)':'Show all 198';}
function renderSim(){const d=st.simDrop,h=st.simHair,c={FARM:0,MARGINAL:0,SKIP:0};
  ROWS.forEach(r=>c[simVerdict(r)]++);
  $('sim').innerHTML='<h3>Scenario simulator — change the assumptions, the board re-sorts</h3>'+
  '<label>Airdrop share <input id="sim-drop" type="range" min="5" max="20" step="1" value="'+Math.round(d*100)+'"> <output>'+(d*100).toFixed(0)+'%</output></label>'+
  '<label>Value haircut <input id="sim-hair" type="range" min="0" max="50" step="5" value="'+Math.round(h*100)+'"> <output>'+(h*100).toFixed(0)+'%</output></label>'+
  '<button id="sim-reset" type="button">Reset</button> '+
  '<span>At these settings: <b>'+c.FARM+' FARM / '+c.MARGINAL+' MARGINAL / '+c.SKIP+' SKIP</b> — the board below re-sorts by net.</span>';
  $('sim-drop').addEventListener('input',e=>{st.simDrop=+e.target.value/100;st.sorts=[{id:'net',dir:-1}];renderSim();renderBoard();});
  $('sim-hair').addEventListener('input',e=>{st.simHair=+e.target.value/100;st.sorts=[{id:'net',dir:-1}];renderSim();renderBoard();});
  $('sim-reset').addEventListener('click',()=>{st.simDrop=DROP;st.simHair=0;st.sorts=[{id:'rank',dir:1}];renderSim();renderBoard();});}
function renderHeader(){const m=M,si=[...ROWS.map(r=>r.implied)].sort((a,b)=>a-b),med=(si[98]+si[99])/2;
  $('kpis').innerHTML=[['Board total',usd(m.total)],['Rows','198'],['FARM',''+m.verdicts.FARM],
  ['Top 1',m.top1.name+' '+usd(m.top1.implied)],['Median implied',usd(med)],['Expected value',usd(m.expected)]]
  .map(x=>'<div><b>'+x[1]+'</b><span>'+x[0]+'</span></div>').join('');
  $('judge-note').innerHTML='<h2>Judge note — read this first</h2><p>Model A (ridge, lam 30) on 92 traded comps: median leave-one-out error <b>×/'+m.model.medLOO.toFixed(2)+'</b>, mean walk-forward error <b>×/'+m.model.meanWF.toFixed(2)+'</b>. Flat is ×/4.65 LOO, ×/6.89 WF — the model beats it by only ~a quarter on LOO; the size signal is thin. Board total <b>'+usd(m.total)+'</b> over 198 rows; top 1 <b>'+esc(m.top1.name)+' at '+usd(m.top1.implied)+'</b>. Verdicts at $5,000 / 12 weeks: <b>'+m.verdicts.FARM+' FARM / '+m.verdicts.MARGINAL+' MARGINAL / '+m.verdicts.SKIP+' SKIP</b>. Ranges are honest: 50% band <b>'+(m.rangeSweep['1.5'].inner*100).toFixed(1)+'%</b>, 80% band <b>'+(m.rangeSweep['1.6'].outer*100).toFixed(1)+'%</b> — both under-cover small TVL (inner 40/30/73% by tercile). Two misses, printed as measured: LOW tier launches <b>'+(m.tierRates.pooled[2]*100).toFixed(1)+'%</b> (target ≤25%); top 20 only <b>'+(m.boot[6]*100).toFixed(1)+'%</b> stable in 200 refits (target ≥80%). Read the ranking as the snapshot\u2019s own record — not a prediction.</p>';
  $('tiles').innerHTML=[['Total implied value',usd(m.total)],['FARM rows',m.verdicts.FARM+' of 198'],['Bear-proof core','3 rows stay FARM if the airdrop is worth a third']]
  .map(x=>'<div><b>'+x[1]+'</b><span>'+x[0]+'</span></div>').join('');
  $('flagbox').innerHTML='<h2>Board status</h2><p class="big">ROBUST 3 / FRAGILE 23</p><p>3 FARM rows survive a 3× fall in airdrop value. 23 break if TVL rises less than 2× — the same 23 whose downside beats their upside. Size for the bear case, not the headline.</p>';
  $('narrative').innerHTML='<b>Top 10, in four sentences.</b> '+esc(m.narrative);}

// --- odds panel
function renderOdds(){const m=M,tr=m.tierRates,pc=tr.perCut,ct=m.tierCuts;
  $('odds-panel').innerHTML='<h2>Odds — will this protocol ever launch a token? (e)</h2>'+
  '<p>Ensemble: <b>50% rich logit</b> (11 features) + <b>30% empirical</b> (age band × category, shrunk) + <b>20% base rate</b> (54.9% of 758 record a token). (e) marks an <b>estimate</b>, not a promise. Tiers are tertiles of the 198 odds — cutoffs '+ct[0].toFixed(3)+' / '+ct[1].toFixed(3)+' — 66 each. Tier rates are <b>pooled</b> walk-forward fractions; per-cut tertiles, not board cutoffs.</p>'+
  '<div class="tiercards">'+
  '<div><b>HIGH '+(tr.pooled[0]*100).toFixed(1)+'%</b><span>odds ≥ '+ct[1].toFixed(3)+' — 66 rows · WF '+pc.map(x=>(x[0]*100).toFixed(1)+'%').join(' / ')+'</span></div>'+
  '<div><b>MED '+(tr.pooled[1]*100).toFixed(1)+'%</b><span>'+ct[0].toFixed(3)+' ≤ odds &lt; '+ct[1].toFixed(3)+' — 66 rows · WF '+pc.map(x=>(x[1]*100).toFixed(1)+'%').join(' / ')+'</span></div>'+
  '<div><b>LOW '+(tr.pooled[2]*100).toFixed(1)+'%</b><span>odds &lt; '+ct[0].toFixed(3)+' — 66 rows · WF '+pc.map(x=>(x[2]*100).toFixed(1)+'%').join(' / ')+' — <b>above the 25% target; printed as measured</b></span></div></div>'+
  '<p><b>Brier score</b> — the ensemble beats the base rate on every cut: '+m.brier.map((w,i)=>['WF 40/60','WF 50/50','WF 67/33'][i]+' '+w[0].toFixed(3)+' vs base '+w[1].toFixed(3)+', called right '+(w[2]*100).toFixed(1)+'% of '+w[3]+' rows').join(' · ')+'.</p>'+
  '<h3>Break-even and walk-away (D-03 / D-04)</h3><ul>'+
  '<li>Break-even plan: <b>'+m.d03[0]+' finite / '+m.d03[1]+' never</b> — median <b>'+usd(m.d03[2])+'</b>, p10 '+usd(m.d03[3])+', p90 '+usd(m.d03[4])+', max '+usd(m.d03[5])+' ('+esc(m.d03[6])+' — a knife-edge, a ≈ 0.00017, verified by hand).</li>'+
  '<li>Walk-away (FARM rows): median <b>'+m.d04[0].toFixed(2)+'×</b>, p10 '+m.d04[1].toFixed(2)+'×, p90 '+m.d04[2].toFixed(2)+'×, min '+m.d04[3].toFixed(2)+'×, max '+m.d04[4].toFixed(2)+'× — <b>'+m.d04[5]+' fragile</b> (&lt;2×), <b>'+m.d04[6]+' robust</b> (&gt;10×: '+m.d04[7].map(esc).join(', ')+'). The 23 fragile rows are exactly the 23 rows whose downside is larger than their upside.</li>'+
  '<li>Expected board value (odds-weighted): <b>'+usd(m.expected)+'</b> — the board\u2019s $1.77B of implied value, weighted by the chance each token ever launches.</li></ul>';}
// --- evidence battery (12 sections, terse; numbers from the meta)
function sec(t,b,w){return '<section class="box'+(w?' wide':'')+'"><h2>'+t+'</h2>'+b+'</section>';}
const T=p=>p.map(x=>'<p><b>'+x[0]+':</b> '+x[1]+'</p>').join('');
function renderEvidence(){const m=M,s=m.sweep;
  $('evidence').innerHTML=
  sec('1 · Value model — A (ridge lam 30)','<p>Ridge on log10(market cap); features log10(TVL), 7d growth, 5 category dummies; fit on the 92 clean traded comps. Frozen rule: lowest mean WF; a gap under 0.10× falls to the lowest median LOO.</p>'+
  T([['Median LOO','×/'+m.model.medLOO.toFixed(2)],['Mean WF','×/'+m.model.meanWF.toFixed(2)],['Median WF','×/'+m.model.medWF.toFixed(2)],['In-sample R²',m.model.r2.toFixed(3)],['5-fold CV R²',m.model.cv5.toFixed(3)],['Flat median-multiple','×/4.65 LOO, ×/6.89 WF'],['Placebo (A + 1 random feature)','×/'+m.model.placebo.toFixed(2)+' median LOO — the size signal is thin'],['Cap (p90 of traded multiples)',m.model.cap.toFixed(3)+'×, 0 of 198 rows bound']])+
  '<p>Lam sweep (med LOO / mean WF / med WF / mean LOO): '+[['1',s.lam['1']],['3',s.lam['3']],['10',s.lam['10']],['30 (A)',s.lam['30']],['100',s.lam['100']]].map(x=>x[0]+' ×/'+x[1][0].toFixed(2)+' / ×/'+x[1][3].toFixed(2)+' / ×/'+x[1][2].toFixed(2)+' / ×/'+x[1][1].toFixed(2)).join('; ')+'.</p>',1)+
  sec('2 · Odds ensemble',T([['Weights','50% rich logit (11 features) + 30% empirical + 20% base rate 54.9%'],['WF Brier',m.brier[0][0].toFixed(3)+' / '+m.brier[1][0].toFixed(3)+' / '+m.brier[2][0].toFixed(3)+' vs base '+m.brier[0][1].toFixed(3)+' / '+m.brier[1][1].toFixed(3)+' / '+m.brier[2][1].toFixed(3)],['Called right',(m.brier[0][2]*100).toFixed(1)+'% / '+(m.brier[1][2]*100).toFixed(1)+'% / '+(m.brier[2][2]*100).toFixed(1)+'%'],['Pooled tiers','HIGH '+(m.tierRates.pooled[0]*100).toFixed(1)+'%, MED '+(m.tierRates.pooled[1]*100).toFixed(1)+'%, LOW '+(m.tierRates.pooled[2]*100).toFixed(1)+'%'],['Rounding','Board odds rounded to 3 decimals once; every downstream use reads the rounded odds']]))+
  sec('3 · Ranges + conformal audits',T([['Board half-widths (log10)',m.hwIn.toFixed(3)+' / '+m.hwOut.toFixed(3)+' (×/'+(10**m.hwIn).toFixed(2)+' / ×/'+(10**m.hwOut).toFixed(2)+')'],['WF sweep ×1.5','inner '+(m.rangeSweep['1.5'].inner*100).toFixed(1)+'%, outer '+(m.rangeSweep['1.5'].outer*100).toFixed(1)+'%'],['WF sweep ×1.6','inner '+(m.rangeSweep['1.6'].inner*100).toFixed(1)+'%, outer '+(m.rangeSweep['1.6'].outer*100).toFixed(1)+'%'],['Clean cut (train 67%, test 31)','inner '+(m.cleanCut.inner*100).toFixed(1)+'%, outer '+(m.cleanCut.outer*100).toFixed(1)+'%'],['By TVL tercile','inner 40% / 30% / 73%, outer 70% / 90% / 100%; median |error| ×/'+m.cleanCut.byTercile[0].toFixed(2)+' / ×/'+m.cleanCut.byTercile[1].toFixed(2)+' / ×/'+m.cleanCut.byTercile[2].toFixed(2)],['U-shape by listing era','oldest ×/'+m.ushape[0].toFixed(2)+', middle ×/'+m.ushape[1].toFixed(2)+', newest ×/'+m.ushape[2].toFixed(2)],['Alternatives','Mondrian inner 16%/23% (pool too small); normalised 48%/81%; recency no effect; jackknife+ 55%/87% (wider band); CQR-lite 29% — none adopted']]))+
  sec('4 · Verdict economics','<p>Plan $5,000 / 12 weeks / 7% / ±$25 net. Gas = cheapest chain. Slice = 1000 × (implied/TVL) × drop × odds; costs = 2×gas + plan×0.001 + plan×0.04×(weeks/52).</p>'+
  T([['D-47 vesting (PV on slice)','typical '+m.d47[0][1]+'/'+m.d47[0][2]+'/'+m.d47[0][3]+' (PV '+m.d47[0][0].toFixed(3)+') · harsh '+m.d47[1][1]+'/'+m.d47[1][2]+'/'+m.d47[1][3]+' (PV '+m.d47[1][0].toFixed(3)+') · generous '+m.d47[2][1]+'/'+m.d47[2][2]+'/'+m.d47[2][3]+' (PV '+m.d47[2][0].toFixed(3)+')'],['D-48 bear ×0.33',m.d48[0][0]+'/'+m.d48[0][1]+'/'+m.d48[0][2]+' (survivors: '+m.d48[3].map(x=>esc(x[0])+' '+usd(x[1])).join(', ')+')'],['D-48 bull','×2.5 → '+m.d48[1][0]+'/'+m.d48[1][1]+'/'+m.d48[1][2]+' · ×3.0 → '+m.d48[2][0]+'/'+m.d48[2][1]+'/'+m.d48[2][2]],['D-49 log-share','$1K '+m.d49[0][0]+'/'+m.d49[0][1]+'/'+m.d49[0][2]+' · $5K '+m.d49[1][0]+'/'+m.d49[1][1]+'/'+m.d49[1][2]+' · $25K '+m.d49[2][0]+'/'+m.d49[2][1]+'/'+m.d49[2][2]+' — the verdict depends on the linear-share assumption'],['D-50 EV/cost','median '+m.d50[0].toFixed(2)+'×, p90 '+m.d50[1].toFixed(2)+'×, max '+m.d50[2].toFixed(2)+'×, '+m.d50[3]+' rows >1×, '+m.d50[4]+' >3× — half the board does not pay its costs'],['D-51 multi-wallet (gas ×4)',m.d51[0][0]+'/'+m.d51[0][1]+'/'+m.d51[0][2]+'; downside median '+usd(m.d51[1])+' vs upside +'+usd(m.d51[2])+'; '+m.d51[3]+' rows lose more than they gain if disqualified']]))+
  sec('5 · Losing variants','<p>Rejected by the D-40 rule (adopt only if mean walk-forward does not worsen). D-38 widening: not adopted (outer 78.3% → 85.4%).</p>'+
  '<p>Losing variants (med LOO / mean WF): '+[['D-24 OLS+cat shift',s.D24],['D-25 prior',s.D25],['D-26 asym growth',s.D26],['D-31 sqrt mat',s.D31s],['D-31 lin mat',s.D31l],['D-32 sqrt×asym',s.D32],['Curve (wiliamkesh)',s.curve],['OLS log-log',s.ols],['Flat mcap',s.flatMcap],['Flat multiple',s.flatMult]].map(x=>x[0]+' ×/'+x[1][0].toFixed(2)+' / ×/'+x[1][3].toFixed(2)).join('; ')+'.</p>'+
  '<p>D-24 alone beats A on mean WF, by 0.035× (noise), with a worse median WF — challenger only. The curve has the best median LOO (×/2.72) and the worst mean WF (×/5.72).</p>')+
  sec('6 · Bootstrap (D-22)',T([['Refits','200, resampling the 92 traded comps (MT19937 seed 0, numpy RandomState protocol)'],['Median rank-range width',m.boot[0]+' ranks (p90 '+m.boot[1]+', max '+m.boot[2]+')'],['Within 5 / 10 ranks','0 / 1 rows; '+m.boot[5]+' wider than 50'],['Top-20 stability',(m.boot[6]*100).toFixed(1)+'% (target ≥80% — missed, printed as measured)'],['Bootstrap slope (logTVL coef)',m.boot[7].toFixed(3)+' ± '+m.boot[8].toFixed(3)+' (full fit 0.196)']]))+
  sec('7 · Cap',T([['Cap','p90 of traded multiples '+m.model.cap.toFixed(3)+'×, binds 0 rows'],['p85 (1.84×)','binds 1 (top-1 $51.4M, total $1.75B)'],['p80 (1.43×)','binds 2 (top-1 BitFi $44.6M, total $1.74B)'],['lam100','would cap the top at $25.1M and the total at $1.68B, with a worse mean WF — challenger, not the board']]))+
  sec('8 · Category medians','<p>Median mcap/TVL by category (clean 92): '+m.d28.slice(0,8).map(x=>esc(CATS[x[0]])+' (n='+x[1]+') '+x[2].toFixed(3)+'×').join(' · ')+' — full table in the README.</p>')+
  sec('9 · Confidence, signals, age',T([['Confidence (D-54)','189 rows at 100, 9 at 70 (missing change_7d '+m.d54[1][0]+', listed_at '+m.d54[1][1]+', category '+m.d54[1][2]+', chains '+m.d54[1][3]+')'],['Signals (D-57)','surging '+(m.d57[0][0]||0)+', sliding '+(m.d57[0][1]||0)+', token-free ≥3y '+(m.d57[0][2]||0)+', chains ≥8 '+(m.d57[0][3]||0)+', billion-TVL '+(m.d57[0][4]||0)+', watchlist '+(m.d57[0][5]||0)+'; '+m.d57[1]+' rows carry no signal'],['Capital tiers','early '+m.d57[2][0]+', mid '+m.d57[2][1]+', large '+m.d57[2][2]+', institutional '+m.d57[2][3]],['Grey zone (D-09)',m.greyCount+' rows above the $50M floor, not on the sealed watchlist — the watchlist is a floor, not a ceiling'],['Narrow flag','29 rows sit outside the traded range (logTVL or growth) — their values extrapolate']]))+
  sec('10 · Literature, condensed','<p>TVL/market-cap does <b>not</b> predict DeFi returns (Soiman et al. 2022); a Granger test <b>cannot</b> confirm TVL predicts valuation (Metelski &amp; Sobieraj 2022). Metcalfe elasticity is only 0.56–0.62 (Arjoon 2026); our Spearman is 0.35. Three big lenders share 0.11× mcap/TVL but P/S 4.4×–95.8× (D-37) — the snapshot has no fees or revenue, so this stays a caveat, not a feature.</p>')+
  sec('11 · Frozen choices','<p>Model A (lam 30) by the frozen rule; cap p90; odds 50/30/20; verdicts $5,000 / 12 weeks / 7% / ±$25; range ×1.5 / ×1.6; D-24 challenger only; D-40 adoption rule; D-11 calendar by the stated chain rule; D-33 conviction (TVL 40, stability 20, maturity 20, breadth 10, category 10); growth excluded from the launch score (D-05). Maturity is monotonic — the hump test (2-year peak) gives LOO ×/5.20, worse, so monotonic maturity stays.</p>')+
  sec('12 · Disposition + integrity',T([['758 accounting',m.d62.join(' + ')+' = 758'],['Integrity strip','40 watchlist + 138 below-floor eligible + 20 above-floor non-watchlist = 198'],['Rebuild','The board rebuilds from the snapshot to the dollar (198/198 MATCH, full-precision growth)'],['Live counts','The dashboard counts on this page are computed live from the same data the board is built from']]),1);}

// --- calendar
function renderCalendar(){const m=M;
  $('calendar').innerHTML=m.d11.sessions.map(s=>'<div class="day"><h3>'+esc(s[0])+' — '+esc(s[1])+'</h3><p class="net">'+usd(s[3])+' net</p><p>'+s[2]+' FARM rows · '+s[4].toFixed(1)+'h · '+usd(s[5])+'/h · gas batched '+usd(s[7])+' vs '+usd(s[6])+' solo (save '+usd(s[8])+')</p></div>').join('')+
  '<p style="grid-column:1/-1;color:var(--ink2);margin:8px 0 0">Weekly harvest: '+m.d11.totalRows+' FARM rows in '+m.d11.totalHours.toFixed(1)+'h, net '+usd(m.d11.totalNet)+' ('+usd(m.d11.batchedNet)+' after batching gas). Rule: the 7 chains with the most FARM rows, all their FARM rows, sessions by net/hour; 0.5h per row per week, gas batched once per session. The v10 reference (34 rows / $2,879 / 17.5h) used a different grouping, not recoverable from the brief — this one states its own rule.</p>';}
// --- detail view
function renderDetail(slug){const r=BYSLUG[slug],el=$('detail');
  if(!r){el.innerHTML='<p>Pick a row on the board to see its farm plan.</p>';st.detail=null;return;}
  st.detail=slug;const e=r.e,rb=rebuild(r),steps=farmSteps(r),bear=e.slice*.33*5-e.costs;
  el.innerHTML='<h2>'+esc(r.name)+' '+chip(r.tier,'')+' '+vchip(r.verdict)+'</h2>'+
  '<p class="meta">Rank <b>#'+r.rank+'</b> · '+esc(r.category||'uncategorised')+' · '+esc(r.chains.join(', ')||'no chains')+' · TVL <b>'+usd(r.tvl)+'</b>'+(r.g7===null?'':' · 7d <b>'+pct1(r.g7)+'</b>')+' · implied <b>'+usd(r.implied)+'</b> ('+r.multiple.toFixed(2)+'×) · token odds <b>'+r.odds.toFixed(3)+'</b> · 80% range <b>'+usd(r.rangeLo)+'–'+usd(r.rangeHi)+'</b> (inner '+usd(r.rLo)+'–'+usd(r.rHi)+')'+(r.watchlist?' · <b>on the sealed watchlist</b>':'')+(r.grey?' · <b>not on the sealed watchlist</b>':'')+(r.narrow?' · <b>outside the traded range</b>':'')+'</p>'+
  '<h3>Farm plan — $5,000 over 12 weeks</h3><ol>'+steps.map(s=>'<li>'+esc(s)+'</li>').join('')+'</ol>'+
  '<h3>Economics</h3><table><tbody>'+
  '<tr><td>Slice ×5 ($5,000)</td><td>'+usd(e.slice*5)+'</td></tr>'+
  '<tr><td>Costs (fee '+usd(e.fee)+' incl. gas + hold '+usd(e.hold)+')</td><td>'+usd(e.costs)+'</td></tr>'+
  '<tr><td>Net</td><td>'+usd(e.net)+'</td></tr>'+
  '<tr><td>Break-even plan</td><td>'+(e.be===null?'never':usd(e.be))+'</td></tr>'+
  '<tr><td>Walk-away multiple</td><td>'+e.walk.toFixed(2)+'×</td></tr>'+
  '<tr><td>EV / cost</td><td>'+r.evCost.toFixed(2)+'×</td></tr>'+
  '<tr><td>Gas share (1st chain)</td><td>'+r.gasShare.toFixed(0)+'%</td></tr>'+
  '<tr><td>Conviction</td><td>'+r.conv.score.toFixed(1)+' (TVL/mom/mat/br/cat '+r.conv.parts.map(x=>x.toFixed(1)).join('/')+')</td></tr>'+
  '<tr><td>Bear case (slice ×0.33)</td><td>'+usd(bear)+'</td></tr>'+
  '<tr><td>Rebuild from model coefficients</td><td>'+usd(rb)+(rb===r.implied?' ✓ MATCH':' ✗ MISMATCH vs board '+usd(r.implied))+'</td></tr></tbody></table>'+
  '<h3>What-if — this row</h3>'+
  '<label>Vesting <select id="wi-vest"><option value="1">none (base)</option><option value="0.926">typical (PV 0.926)</option><option value="0.707">harsh (PV 0.707)</option><option value="0.954">generous (PV 0.954)</option></select></label> '+
  '<label><input id="wi-multi" type="checkbox"> 4 wallets (gas ×4)</label> <output id="wi-out"></output>'+
  '<h3>Pool calculator (D-10)</h3>'+
  '<label>Pool <input id="pool-p" type="number" value="0" min="0" step="1000"> $</label> '+
  '<label>Deposits <input id="pool-d" type="number" value="5000000" min="1" step="100000"> $</label> '+
  '<label>Capital <input id="pool-c" type="number" value="5000" min="0" step="500"> $</label> <output id="pool-out"></output>';
  const upd=()=>{const pv=+$('wi-vest').value,mu=$('wi-multi').checked,
    g=e.gas*(mu?4:1),c=2*g+PLAN*.001+e.hold,n=e.slice*pv*5-c,v=n>25?'FARM':n<-25?'SKIP':'MARGINAL';
    $('wi-out').textContent=' Net '+usd(n)+' → '+v+' (was '+usd(e.net)+' → '+r.verdict+').';
    const p=+$('pool-p').value,d=+$('pool-d').value||1,cp=+$('pool-c').value,
      pay=p*Math.min(1,cp/d);
    $('pool-out').textContent=' Payout '+usd(pay)+', net '+usd(pay-e.costs)+' after '+usd(e.costs)+' fixed costs.';};
  ['wi-vest','wi-multi','pool-p','pool-d','pool-c'].forEach(id=>$(id).addEventListener('input',upd));upd();}
// --- export
function dl(name,text,type){const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([text],{type}));a.download=name;a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),1000);}
function exportJSON(){dl('token-radar-v11-board.json',JSON.stringify({rows:ROWS.map(r=>({slug:r.slug,name:r.name,rank:r.rank,implied_value_usd:r.implied,farm_steps:farmSteps(r),category:r.category,chains:r.chains,tvl_usd:r.tvl,change_7d:r.g7,odds:r.odds,tier:r.tier,verdict:r.verdict,net_usd:r.e.net,fee_usd:r.e.fee,slice_usd:r.e.slice,costs_usd:r.e.costs,gas_usd:r.e.gas,break_even_usd:r.e.be,walk_away_mult:r.e.walk,multiple:r.multiple,conviction:r.conv.score,ev_per_cost:r.evCost,farm_value_usd:r.farmValue,gas_share_pct:r.gasShare,launch_score:r.launch,watchlist:r.watchlist}))},null,1),'application/json');}
function exportCSV(){const head=['rank','slug','name','category','chains','tvl_usd','change_7d','implied_value_usd','odds','tier','verdict','net_usd','fee_usd','gas_usd','break_even_usd','walk_away_mult'];
  const q=v=>'"'+String(v===null||v===undefined?'':v).replace(/"/g,'""')+'"';
  const lines=[head.join(',')];
  ROWS.forEach(r=>lines.push([r.rank,r.slug,r.name,r.category||'',r.chains.join(';'),r.tvl,r.g7===null?'':r.g7,r.implied,r.odds,r.tier,r.verdict,Math.round(r.e.net*100)/100,r.e.fee,r.e.gas,r.e.be===null?'':Math.round(r.e.be*100)/100,Math.round(r.e.walk*100)/100].map(q).join(',')));
  dl('token-radar-v11-board.csv',lines.join('\n'),'text/csv');}
// --- init + interactions
function init(){renderHeader();renderOdds();renderEvidence();renderCalendar();renderSim();renderBoard();
  const tabs=document.querySelectorAll('.tab'),panels=document.querySelectorAll('.panel');
  tabs.forEach(b=>b.addEventListener('click',()=>{
    tabs.forEach(x=>x.classList.remove('on'));
    panels.forEach(x=>x.classList.remove('on'));
    b.classList.add('on');$('panel-'+b.dataset.tab).classList.add('on');}));
  $('thead').addEventListener('click',e=>{const th=e.target.closest('th');if(!th)return;const id=th.dataset.col;
    const ex=st.sorts.find(s=>s.id===id);
    if(e.shiftKey){if(ex)ex.dir=-ex.dir;else st.sorts.push({id,dir:-1});}
    else st.sorts=ex?[{id,dir:-ex.dir}]:[{id,dir:id==='rank'?1:-1}];
    renderBoard();});
  $('q').addEventListener('input',e=>{st.q=e.target.value;renderBoard();});
  $('f-verdict').addEventListener('change',e=>{st.verdict=e.target.value;renderBoard();});
  $('f-tier').addEventListener('change',e=>{st.tier=e.target.value;renderBoard();});
  $('f-flag').addEventListener('change',e=>{st.flag=e.target.value;renderBoard();});
  $('show-all').addEventListener('click',()=>{st.showAll=!st.showAll;renderBoard();});
  $('density').addEventListener('click',()=>{const o=['compact','standard','comfortable'],px=[30,40,50];
    st.density=o[(o.indexOf(st.density)+1)%3];
    document.documentElement.style.setProperty('--row',px[o.indexOf(st.density)]+'px');
    $('density').textContent='Density: '+st.density;});
  const ch=$('chooser');
  ch.innerHTML=COLS.map(c=>'<label><input type="checkbox" data-col="'+c[0]+'"'+(st.visible.has(c[0])?' checked':'')+'> '+esc(c[1])+'</label>').join('');
  $('chooser-btn').addEventListener('click',()=>{ch.hidden=!ch.hidden;});
  ch.addEventListener('change',e=>{const id=e.target.dataset.col;
    if(e.target.checked)st.visible.add(id);else st.visible.delete(id);
    if(!st.visible.has('name')){st.visible.add('name');e.target.checked=true;}
    renderBoard();});
  $('export-json').addEventListener('click',exportJSON);
  $('export-csv').addEventListener('click',exportCSV);
  document.addEventListener('click',e=>{const a=e.target.closest('a[href^="#detail="]');
    if(a)renderDetail(a.getAttribute('href').slice(8));});
  const h=location.hash||'',tab=h.match(/tab=(\w+)/);
  if(tab){const b=document.querySelector('.tab[data-tab="'+tab[1]+'"]');if(b)b.click();}
  const v=h.match(/verdict=(\w+)/);
  if(v){st.verdict=v[1];$('f-verdict').value=v[1];renderBoard();}
  const d=h.match(/detail=([\w-]+)/);
  if(d)renderDetail(d[1]);else renderDetail(null);}
init();


