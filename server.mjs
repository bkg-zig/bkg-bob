import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { URL } from 'node:url';

const HOST = process.env.BKG_BOB_HOST || '0.0.0.0';
const PORT = Number(process.env.BKG_BOB_PORT || 8787);
const DATA_DIR = process.env.BKG_BOB_DATA_DIR || '/data/bkg-bob';
const STORE = join(DATA_DIR, 'keys.json');
const DEFAULT_UPSTREAM = 'https://api.us-east.bob.ibm.com/inference/v1';
const PROFILE_BASE = 'https://api.us-east.bob.ibm.com';
const UPSTREAM = (process.env.BKG_BOB_UPSTREAM_URL || DEFAULT_UPSTREAM).replace(/\/$/, '');
const ADMIN_TOKEN = (process.env.BKG_BOB_ADMIN_TOKEN || '').trim();
const POLL_MS = Number(process.env.BKG_BOB_USAGE_POLL_MS || 120000);
const clients = new Set();
const recalls = new Map();
let store = { version: 1, keys: [] };
let writeQueue = Promise.resolve();

function hashKey(key) { return createHash('sha256').update(key).digest('hex'); }
function fingerprint(key) { const h = hashKey(key); return `${h.slice(0, 6)}…${h.slice(-6)}`; }
function json(res, status, body) { const data = JSON.stringify(body); res.writeHead(status, {'content-type':'application/json; charset=utf-8','cache-control':'no-store'}); res.end(data); }
function safeString(v, max=4096) { return typeof v === 'string' ? v.trim().slice(0,max) : ''; }
function admin(req) {
  if (!ADMIN_TOKEN) return true;
  const auth = req.headers.authorization || '';
  return auth === `Bearer ${ADMIN_TOKEN}` || req.headers['x-bkg-bob-admin'] === ADMIN_TOKEN;
}
function publicKey(k) {
  return { id:k.id, fingerprint:k.fingerprint, label:k.label, enabled:k.enabled, status:k.status, bobcoins:k.bobcoins, usedBobcoins:k.usedBobcoins, remainingBobcoins:k.remainingBobcoins, plan:k.plan, resetAt:k.resetAt, account:k.account, lastCheckedAt:k.lastCheckedAt, lastError:k.lastError, inFlight:k.inFlight, createdAt:k.createdAt };
}
function snapshot() { return { generatedAt:new Date().toISOString(), keys:store.keys.map(publicKey), summary:{ total:store.keys.length, enabled:store.keys.filter(k=>k.enabled).length, withCoins:store.keys.filter(k=>k.enabled && (k.remainingBobcoins ?? 0) > 0).length, remainingBobcoins:store.keys.reduce((n,k)=>n+(Number(k.remainingBobcoins)||0),0) } }; }
async function load() {
  await mkdir(DATA_DIR, {recursive:true});
  if (!existsSync(STORE)) { await persist(); return; }
  try { store = JSON.parse(await readFile(STORE,'utf8')); if (!Array.isArray(store.keys)) throw new Error('invalid store'); }
  catch { store = {version:1,keys:[]}; await persist(); }
}
function persist() { writeQueue = writeQueue.then(async()=>{ await mkdir(DATA_DIR,{recursive:true}); const tmp=`${STORE}.tmp`; await writeFile(tmp,JSON.stringify(store,null,2),{mode:0o600}); await chmod(tmp,0o600); await import('node:fs/promises').then(fs=>fs.rename(tmp,STORE)); }); return writeQueue; }
function emit(event, data) { const payload=`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`; for (const res of clients) res.write(payload); }
async function body(req) { let s=''; for await (const c of req) { s+=c; if(s.length>1024*1024) throw new Error('body too large'); } return s ? JSON.parse(s) : {}; }
function normalizeInput(v) { const s=safeString(v); if (!s) return ''; const m=s.match(/(?:^|[?&#])(?:api[_-]?key|key|code)=([^&#\s]+)/i); return m ? decodeURIComponent(m[1]) : s; }
function authHeader(key) { return key.includes('.') && key.split('.').length===3 ? `Bearer ${key}` : `Apikey ${key}`; }
function trustedBobUrl(raw) {
  const u = new URL(raw);
  if (u.protocol !== 'https:' || u.username || u.password || u.port || u.pathname !== '/' || u.search || u.hash) throw new Error('untrusted Bob URL');
  const h=(u.hostname||'').toLowerCase(); if (!(h==='bob.ibm.com'||h.endsWith('.bob.ibm.com'))) throw new Error('untrusted Bob host'); return u;
}
async function usage(key) {
  const profile = await fetch(`${PROFILE_BASE}/admin/v1/profile`, {headers:{accept:'application/json',authorization:authHeader(key), 'user-agent':'bkg-bob/0.1'}});
  if (!profile.ok) throw new Error(`profile HTTP ${profile.status}`);
  const p=await profile.json(); let used=0, budget=0, finite=true, resetAt=null, plan='', account='';
  for (const inst of (Array.isArray(p.instances)?p.instances:[])) {
    account=account || inst.instance_name || inst.name || inst.instance_id || '';
    plan=plan || inst.plan_name || '';
    if (inst.refresh_at) resetAt=typeof inst.refresh_at==='number'?new Date(inst.refresh_at*1000).toISOString():String(inst.refresh_at);
    const region=inst.region_domain ? (String(inst.region_domain).startsWith('api.')?String(inst.region_domain):`api.${inst.region_domain}`) : 'api.us-east.bob.ibm.com';
    const u=trustedBobUrl(`https://${region}/`);
    for (const team of (Array.isArray(inst.teams)?inst.teams:[])) {
      if (!inst.user_id || !team.id) continue;
      const t=new URL(`/admin/v1/teams/${encodeURIComponent(team.id)}/users/${encodeURIComponent(inst.user_id)}`,u);
      const r=await fetch(t,{headers:{accept:'application/json',authorization:authHeader(key),'x-instance-id':inst.instance_id||'','x-team-id':team.id,'user-agent':'bkg-bob/0.1'}});
      if (!r.ok) throw new Error(`team HTTP ${r.status}`);
      const x=await r.json(); used+=Math.max(0,Number(x.usage)||0); const b=x.budget_limit ?? team.budget_limit; if (b == null) finite=false; else budget+=Math.max(0,Number(b)||0);
    }
  }
  const remaining=finite ? Math.max(0,budget-used) : null;
  return {usedBobcoins:used,bobcoins:finite?budget:null,remainingBobcoins:remaining,plan,account,resetAt};
}
function check(k) { return usage(k.secret).then(u=>{Object.assign(k,u,{status:(u.remainingBobcoins===null||u.remainingBobcoins>0)?'ready':'depleted',lastCheckedAt:new Date().toISOString(),lastError:null})}).catch(e=>{k.status=/401|403/.test(e.message)?'invalid':'unknown';k.lastError=e.message;k.lastCheckedAt=new Date().toISOString()}); }
function makeRecall() { const token=randomBytes(18).toString('base64url'); const expiresAt=Date.now()+15*60_000; recalls.set(token,{expiresAt,client:null}); return token; }
function recallHtml(token) { return '<!doctype html><html><body style="background:#05070a;color:#d9f7ff;font:16px system-ui;padding:40px"><h1 style="color:#00e5ff">BKG Bob // SSE Recall</h1><p>Paste the Bob API key or callback/auth value. The dashboard will receive the new lane live.</p><form id=f><input id=k style="width:80%;padding:12px;background:#0e151c;color:white;border:1px solid #00e5ff" autocomplete=off><button>Add</button></form><pre id=s>waiting...</pre><script>const token='+JSON.stringify(token)+';const s=document.getElementById("s");const es=new EventSource("/recall/"+token+"/events");es.onmessage=e=>s.textContent=e.data;document.getElementById("f").onsubmit=async e=>{e.preventDefault();const r=await fetch("/recall/"+token,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({key:document.getElementById("k").value})});const x=await r.json();s.textContent=x.error||"Key added. You can close this page."}</script></body></html>'; }
async function addKey(input) {
  const secret=normalizeInput(input.key || input.authCode || input.callbackUrl || input.recall);
  if (!secret || secret.length < 12) throw new Error('No usable Bob API key/code supplied');
  const fp=fingerprint(secret); if(store.keys.some(k=>k.fingerprint===fp)) return store.keys.find(k=>k.fingerprint===fp);
  const k={id:randomBytes(8).toString('hex'),secret,fingerprint:fp,label:safeString(input.label,120)||`Bob ${store.keys.length+1}`,enabled:true,status:'checking',bobcoins:null,usedBobcoins:0,remainingBobcoins:null,plan:'',account:'',resetAt:null,lastCheckedAt:null,lastError:null,inFlight:false,createdAt:new Date().toISOString()}; store.keys.push(k); await persist(); emit('keys',snapshot()); await check(k); await persist(); emit('keys',snapshot()); return k;
}
async function proxy(req,res,url) {
  const tried=new Set();
  for (let attempt=0; attempt<store.keys.length+1; attempt++) {
    const candidates=store.keys.filter(k=>k.enabled && !k.inFlight && k.status!=='invalid' && (k.remainingBobcoins===null || k.remainingBobcoins>0) && !tried.has(k.id)).sort((a,b)=>(a.remainingBobcoins??Infinity)-(b.remainingBobcoins??Infinity));
    const key=candidates[0];
    if(!key){ json(res,503,{error:'No Bob key with available Bobcoins'}); return; }
    tried.add(key.id); key.inFlight=true; emit('keys',snapshot());
    try {
      const target=new URL(url.pathname.replace(/^\/proxy/, '')+url.search,UPSTREAM+'/');
      const headers=new Headers(req.headers); headers.delete('host'); headers.set('authorization',authHeader(key.secret));
      const init={method:req.method,headers}; if(!['GET','HEAD'].includes(req.method)) init.body=req;
      const upstream=await fetch(target,init);
      if([401,403,429].includes(upstream.status)){ key.status=upstream.status===429?'depleted':'invalid'; key.lastError=`upstream HTTP ${upstream.status}`; key.remainingBobcoins=upstream.status===429?0:key.remainingBobcoins; key.inFlight=false; await check(key); await persist(); emit('keys',snapshot()); continue; }
      res.writeHead(upstream.status,Object.fromEntries(upstream.headers));
      if(upstream.body) for await (const chunk of upstream.body) res.write(chunk); res.end();
      key.inFlight=false; await check(key); await persist(); emit('keys',snapshot()); return;
    } catch(e) { key.inFlight=false; key.lastError=e instanceof Error?e.message:String(e); await persist(); emit('keys',snapshot()); if(!res.headersSent){json(res,502,{error:key.lastError});} else res.destroy(); return; }
  }
}

const html = readFileSync(process.env.BKG_BOB_HTML || join(process.cwd(), 'public/index.html'), 'utf8');
const server=createServer(async(req,res)=>{try{
  const u=new URL(req.url,`http://${req.headers.host||'localhost'}`);
  if(u.pathname==='/health'){json(res,200,{ok:true,keys:store.keys.length,withCoins:snapshot().summary.withCoins});return}
  if(u.pathname==='/admin'||u.pathname==='/settings'){if(!admin(req)){json(res,401,{error:'unauthorized'});return}res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});res.end(html);return}
  if(u.pathname==='/api/snapshot'){if(!admin(req)){json(res,401,{error:'unauthorized'});return}json(res,200,snapshot());return}
  if(u.pathname==='/api/events'){if(!admin(req)){json(res,401,{error:'unauthorized'});return}res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache','connection':'keep-alive'});res.write(`event: keys\ndata: ${JSON.stringify(snapshot())}\n\n`);clients.add(res);req.on('close',()=>clients.delete(res));return}
  if(u.pathname==='/api/recall'&&req.method==='POST'){if(!admin(req)){json(res,401,{error:'unauthorized'});return}const token=makeRecall();json(res,200,{url:`/recall/${token}`,expiresAt:new Date(recalls.get(token).expiresAt).toISOString()});return}
  if(u.pathname.startsWith('/recall/')&&u.pathname.endsWith('/events')){const token=u.pathname.split('/')[2];const r=recalls.get(token);if(!r||r.expiresAt<Date.now()){json(res,410,{error:'recall expired'});return}res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache','connection':'keep-alive'});res.write('data: waiting\n\n');r.client=res;req.on('close',()=>{if(r.client===res)r.client=null});return}
  if(u.pathname.startsWith('/recall/')&&req.method==='GET'){const token=u.pathname.split('/')[2];const r=recalls.get(token);if(!r||r.expiresAt<Date.now()){json(res,410,{error:'recall expired'});return}res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});res.end(recallHtml(token));return}
  if(u.pathname.startsWith('/recall/')&&req.method==='POST'){const token=u.pathname.split('/')[2];const r=recalls.get(token);if(!r||r.expiresAt<Date.now()){json(res,410,{error:'recall expired'});return}const input=await body(req);const k=await addKey(input);if(r.client){r.client.write('data: key added\n\n');r.client.end();}recalls.delete(token);json(res,200,publicKey(k));return}
  if(u.pathname==='/api/keys'&&req.method==='POST'){if(!admin(req)){json(res,401,{error:'unauthorized'});return}const k=await addKey(await body(req));json(res,200,publicKey(k));return}
  if(u.pathname.startsWith('/api/keys/')&&req.method==='DELETE'){if(!admin(req)){json(res,401,{error:'unauthorized'});return}const id=u.pathname.split('/').pop();const k=store.keys.find(x=>x.id===id);if(!k){json(res,404,{error:'not found'});return}k.enabled=false;k.status='disabled';await persist();emit('keys',snapshot());json(res,200,{ok:true});return}
  if(u.pathname.startsWith('/proxy')){await proxy(req,res,u);return}
  json(res,404,{error:'not found'});
}catch(e){json(res,400,{error:e instanceof Error?e.message:String(e)})}});
await load();
for(const k of store.keys) check(k).then(()=>persist()).catch(()=>{});
setInterval(async()=>{for(const k of store.keys.filter(k=>k.enabled)) await check(k); await persist(); emit('keys',snapshot())},POLL_MS).unref();
server.listen(PORT,HOST,()=>console.log(`bkg-bob listening on ${HOST}:${PORT}`));