import {getStore} from "@netlify/blobs";
import crypto from "node:crypto";
const PIN=process.env.OWNER_PIN||"1234",SECRET=process.env.SECRET||"change-me-in-production";
const TOKEN=crypto.createHmac("sha256",SECRET).update("owner:"+PIN).digest("hex");
const MENU=[["Salted Popcorn",150],["Caramel Popcorn",180],["Cheese Popcorn",190],["Coke",90],["Pepsi",90],["Cold Coffee",120],["Water Bottle",40],["Veg Burger",140],["Samosa (2 pcs)",60],["French Fries",110],["Nachos with Cheese",160],["Large Popcorn + 2 Cokes",380],["Ice Cream Cup",80]].map((m,i)=>({id:"m"+i,name:m[0],price:m[1]}));
const FLOW=["RECEIVED","PREPARING","READY","OUT_FOR_DELIVERY","DELIVERED"];
const J=(o,s=200)=>new Response(JSON.stringify(o),{status:s,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}});
export default async (req)=>{
 const store=getStore({name:"seatserve",consistency:"strong"});
 const p=new URL(req.url).pathname.replace(/^\/api/,"")||"/",m=req.method;
 const authed=req.headers.get("authorization")==="Bearer "+TOKEN;
 let b={};if(m==="POST"||m==="PATCH"){try{b=await req.json()}catch{}}
 const sold=async()=>(await store.get("sold",{type:"json"}))||[];
 const get=id=>store.get("o:"+id,{type:"json"}),save=o=>store.setJSON("o:"+o.id,o);
 if(p==="/sold"&&m==="GET")return J({ids:await sold()});
 if(p==="/sold"&&m==="POST"){if(!authed)return J({error:"Owner login required"},401);const id=String(b.id);if(!MENU.some(x=>x.id===id))return J({error:"Unknown item"},400);
  const s=await sold(),n=s.includes(id)?s.filter(x=>x!==id):[...s,id];await store.setJSON("sold",n);return J({ids:n})}
 if(p==="/login"&&m==="POST"){const a=Buffer.from(String(b.pin||"")),c=Buffer.from(PIN);if(a.length===c.length&&crypto.timingSafeEqual(a,c))return J({token:TOKEN});return J({error:"Wrong PIN"},401)}
 if(p==="/orders"&&m==="GET"){if(!authed)return J({error:"Owner login required"},401);const {blobs}=await store.list({prefix:"o:"});
  const a=(await Promise.all(blobs.map(x=>store.get(x.key,{type:"json"})))).filter(Boolean).sort((x,y)=>x.t-y.t);return J(a)}
 if(p==="/pay"&&m==="POST"){const s=b.seat||{},upi=String(b.upi||"").trim().toLowerCase();
  if(!/^\d{1,2}$/.test(String(s.scr))||!/^[A-Za-z]{1,2}$/.test(String(s.row))||!/^\d{1,3}$/.test(String(s.no)))return J({error:"Invalid seat"},400);
  if(!/^[\w.-]+@[\w-]+$/.test(upi))return J({error:"Enter a valid UPI ID."},400);
  if(upi.startsWith("fail"))return J({error:"Payment failed. Try again or use another UPI ID."},402);
  const so=await sold(),items=[];let sub=0;
  for(const it of Array.isArray(b.items)?b.items.slice(0,20):[]){const x=MENU.find(y=>y.id===it.id),q=Math.min(10,Math.max(0,parseInt(it.q)||0));if(!x||!q)continue;if(so.includes(x.id))return J({error:x.name+" is sold out."},409);items.push({n:x.name,q,p:x.price});sub+=x.price*q}
  if(!items.length)return J({error:"Cart is empty."},400);
  const o={id:"SS"+crypto.randomBytes(3).toString("hex").toUpperCase(),seat:`Screen ${s.scr} · Row ${String(s.row).toUpperCase()} · Seat ${s.no}`,screen:String(s.scr),row:String(s.row).toUpperCase(),name:String(b.name||"Guest").slice(0,40),note:String(b.note||"").slice(0,120),items,total:Math.round(sub*1.05),status:"RECEIVED",paid:"UPI "+upi,t:Date.now()};
  await save(o);return J(o)}
 const mm=p.match(/^\/orders\/(\w+)$/);
 if(mm){const o=await get(mm[1]);if(!o)return J({error:"Not found"},404);if(m==="GET")return J(o);
  if(m==="PATCH"){const a=b.action;
   if(a==="issue"){if(o.status==="DELIVERED"||o.status==="CANCELLED")return J({error:"Closed"},400);o.issue=true}
   else{if(!authed)return J({error:"Owner login required"},401);
    if(a==="advance"){const i=FLOW.indexOf(o.status);if(i<0||i>=FLOW.length-1)return J({error:"Cannot advance"},400);o.status=FLOW[i+1];o.issue=false}
    else if(a==="cancel"){if(!["RECEIVED","PREPARING"].includes(o.status))return J({error:"Cannot cancel"},400);o.status="CANCELLED"}
    else return J({error:"Unknown action"},400)}
   await save(o);return J(o)}}
 return J({error:"Not found"},404)};
export const config={path:"/api/*"};
