const express=require("express"),{DatabaseSync}=require("node:sqlite"),crypto=require("crypto"),path=require("path");
const PIN=process.env.OWNER_PIN||"1234",SECRET=process.env.SECRET||"change-me-in-production";
const TOKEN=crypto.createHmac("sha256",SECRET).update("owner:"+PIN).digest("hex");
const db=new DatabaseSync(process.env.DB_PATH||path.join(__dirname,"seatserve.db"));
db.exec("create table if not exists orders(id text primary key,t integer,json text);create table if not exists cfg(k text primary key,v text)");
const MENU=[["Salted Popcorn",150],["Caramel Popcorn",180],["Cheese Popcorn",190],["Coke",90],["Pepsi",90],["Cold Coffee",120],["Water Bottle",40],["Veg Burger",140],["Samosa (2 pcs)",60],["French Fries",110],["Nachos with Cheese",160],["Large Popcorn + 2 Cokes",380],["Ice Cream Cup",80]].map((m,i)=>({id:"m"+i,name:m[0],price:m[1]}));
const FLOW=["RECEIVED","PREPARING","READY","OUT_FOR_DELIVERY","DELIVERED"];
const getOrder=id=>{const r=db.prepare("select json from orders where id=?").get(id);return r&&JSON.parse(r.json)};
const saveOrder=o=>db.prepare("insert or replace into orders(id,t,json) values(?,?,?)").run(o.id,o.t,JSON.stringify(o));
const allOrders=()=>db.prepare("select json from orders order by t").all().map(r=>JSON.parse(r.json));
const getSold=()=>{const r=db.prepare("select v from cfg where k='sold'").get();return r?JSON.parse(r.v):[]};
const setSold=a=>db.prepare("insert or replace into cfg(k,v) values('sold',?)").run(JSON.stringify(a));
const clients=new Set();
const send=(pred,msg)=>{const d="data: "+JSON.stringify(msg)+"\n\n";for(const c of clients)if(pred(c))c.res.write(d)};
const pushOrder=o=>send(c=>c.owner||c.order===o.id,{type:"order",order:o});
const hits=new Map();
const limited=ip=>{const now=Date.now(),a=(hits.get(ip)||[]).filter(t=>now-t<36e5);a.push(now);hits.set(ip,a);return a.length>30};
const app=express();app.set("trust proxy",1);app.use(express.json({limit:"20kb"}));
const auth=(req,res,next)=>req.get("authorization")==="Bearer "+TOKEN?next():res.status(401).json({error:"Owner login required"});
app.get("/healthz",(q,r)=>r.send("ok"));
app.get("/api/sold",(q,r)=>r.json({ids:getSold()}));
app.post("/api/login",(req,res)=>{const a=Buffer.from(String(req.body.pin||"")),b=Buffer.from(PIN);
 if(a.length===b.length&&crypto.timingSafeEqual(a,b))return res.json({token:TOKEN});res.status(401).json({error:"Wrong PIN"})});
app.get("/api/orders",auth,(q,r)=>r.json(allOrders()));
app.get("/api/orders/:id",(q,r)=>{const o=getOrder(q.params.id);o?r.json(o):r.status(404).json({error:"Not found"})});
app.post("/api/pay",(req,res)=>{
 if(limited(req.ip))return res.status(429).json({error:"Too many orders. Try again later."});
 const b=req.body||{},s=b.seat||{},upi=String(b.upi||"").trim().toLowerCase();
 if(!/^\d{1,2}$/.test(String(s.scr))||!/^[A-Za-z]{1,2}$/.test(String(s.row))||!/^\d{1,3}$/.test(String(s.no)))return res.status(400).json({error:"Invalid seat"});
 if(!/^[\w.-]+@[\w-]+$/.test(upi))return res.status(400).json({error:"Enter a valid UPI ID."});
 if(upi.startsWith("fail"))return res.status(402).json({error:"Payment failed. Try again or use another UPI ID."});
 const sold=getSold(),items=[];let sub=0;
 for(const it of Array.isArray(b.items)?b.items.slice(0,20):[]){const m=MENU.find(x=>x.id===it.id),q=Math.min(10,Math.max(0,parseInt(it.q)||0));
  if(!m||!q)continue;if(sold.includes(m.id))return res.status(409).json({error:m.name+" is sold out."});items.push({n:m.name,q,p:m.price});sub+=m.price*q}
 if(!items.length)return res.status(400).json({error:"Cart is empty."});
 const o={id:"SS"+crypto.randomBytes(3).toString("hex").toUpperCase(),seat:`Screen ${s.scr} · Row ${String(s.row).toUpperCase()} · Seat ${s.no}`,screen:String(s.scr),row:String(s.row).toUpperCase(),name:String(b.name||"Guest").slice(0,40),note:String(b.note||"").slice(0,120),items,total:Math.round(sub*1.05),status:"RECEIVED",paid:"UPI "+upi,t:Date.now()};
 saveOrder(o);pushOrder(o);res.json(o)});
app.patch("/api/orders/:id",(req,res)=>{const o=getOrder(req.params.id);if(!o)return res.status(404).json({error:"Not found"});const a=req.body.action;
 if(a==="issue"){if(o.status==="DELIVERED"||o.status==="CANCELLED")return res.status(400).json({error:"Closed"});o.issue=true}
 else{if(req.get("authorization")!=="Bearer "+TOKEN)return res.status(401).json({error:"Owner login required"});
  if(a==="advance"){const i=FLOW.indexOf(o.status);if(i<0||i>=FLOW.length-1)return res.status(400).json({error:"Cannot advance"});o.status=FLOW[i+1];o.issue=false}
  else if(a==="cancel"){if(!["RECEIVED","PREPARING"].includes(o.status))return res.status(400).json({error:"Cannot cancel"});o.status="CANCELLED"}
  else return res.status(400).json({error:"Unknown action"})}
 saveOrder(o);pushOrder(o);res.json(o)});
app.post("/api/sold",auth,(req,res)=>{const id=String(req.body.id),s=getSold();if(!MENU.some(m=>m.id===id))return res.status(400).json({error:"Unknown item"});
 const n=s.includes(id)?s.filter(x=>x!==id):[...s,id];setSold(n);send(()=>true,{type:"sold",ids:n});res.json({ids:n})});
app.get("/api/events",(req,res)=>{res.set({"Content-Type":"text/event-stream","Cache-Control":"no-cache",Connection:"keep-alive","X-Accel-Buffering":"no"});res.flushHeaders();
 const c={res,owner:req.query.token===TOKEN,order:String(req.query.order||"")};clients.add(c);res.write(": ok\n\n");
 const hb=setInterval(()=>res.write(": hb\n\n"),25000);req.on("close",()=>{clearInterval(hb);clients.delete(c)})});
app.use(express.static(path.join(__dirname,"public")));
app.listen(process.env.PORT||3000,()=>console.log("SeatServe running on port "+(process.env.PORT||3000)));
