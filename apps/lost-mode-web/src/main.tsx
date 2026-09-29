import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

type Device = { id:number; deviceName:string; deviceType:string; online:boolean; battery:number|null; network:string; lastSeen:string|null; mode:string; location:any; photo:any };

async function api(path:string, options?:RequestInit){
  const r=await fetch(path,{credentials:"include",...options,headers:{"Content-Type":"application/json",...(options?.headers||{})}});
  const d=await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(d.error||"Request failed");
  return d;
}

function Login({done}:{done:()=>void}){
  const [username,setUsername]=useState(""); const [password,setPassword]=useState(""); const [error,setError]=useState("");
  async function submit(e:React.FormEvent){e.preventDefault();setError("");try{await api("/api/auth/login",{method:"POST",body:JSON.stringify({username,password})});setPassword("");done();}catch(err){setError(err instanceof Error?err.message:"Login failed");}}
  return <main className="center"><section className="card login"><div className="orb">J</div><b>JAZZ</b><h1>DEVICE RECOVERY</h1><p>Find • Secure • Recover • Always With You</p><h2>LOST MODE LOGIN</h2><form onSubmit={submit}><input placeholder="Username" value={username} onChange={e=>setUsername(e.target.value)} autoComplete="username"/><input placeholder="Password" type="password" value={password} onChange={e=>setPassword(e.target.value)} autoComplete="current-password"/>{error&&<p className="error">{error}</p>}<button>ENTER LOST MODE</button></form></section><footer>Developed by 😈gunakarna😈</footer></main>;
}

function App(){
 const [ready,setReady]=useState(false),[login,setLogin]=useState(false); const [devices,setDevices]=useState<Device[]>([]); const [selected,setSelected]=useState<number|null>(null); const [device,setDevice]=useState<Device|null>(null); const [msg,setMsg]=useState("");
 async function load(){const d=await api("/api/devices");setDevices(d.items||[]);if(!selected&&d.items?.length)setSelected(d.items[0].id);}
 async function refresh(id=selected){if(!id)return;const d=await api(`/api/devices/${id}`);setDevice(d.device);}
 useEffect(()=>{api("/api/auth/session").then(()=>setLogin(true)).catch(()=>setLogin(false)).finally(()=>setReady(true));},[]);
 useEffect(()=>{if(login)void load();},[login]); useEffect(()=>{if(login&&selected)void refresh(selected);},[login,selected]);
 async function action(name:string,args:any={}){if(!selected)return;setMsg("Sending secure recovery request…");try{const d=await api(`/api/devices/${selected}/actions`,{method:"POST",body:JSON.stringify({action:name,args})});setMsg(`Queued: ${d.commandId}`);setTimeout(()=>void refresh(selected),2500);}catch(e){setMsg(e instanceof Error?e.message:"Action failed");}}
 async function logout(){await api("/api/auth/logout",{method:"POST",body:"{}"}).catch(()=>{});setLogin(false);setDevices([]);setDevice(null);}
 if(!ready)return <div className="center">Loading…</div>; if(!login)return <Login done={()=>setLogin(true)}/>;
 return <div className="shell"><header><div><b>JAZZ</b><h1>LOST MODE</h1></div><button className="small" onClick={logout}>Logout</button></header><div className="grid"><aside className="card"><h3>MY DEVICES</h3>{devices.map(d=><button key={d.id} className={selected===d.id?"selected":""} onClick={()=>setSelected(d.id)}>{d.deviceName}<small>{d.deviceType} • {d.online?"Online":"Offline"}</small></button>)}</aside><main>{device&&<><section className="card hero"><div><span className={device.online?"online":"offline"}>{device.online?"● ONLINE":"● OFFLINE"}</span><h2>{device.deviceName}</h2><p>{device.deviceType} • Battery {device.battery??"--"}% • {device.network}</p><p>Last Seen: {device.lastSeen?new Date(device.lastSeen).toLocaleString():"Unknown"}</p></div><b>{device.mode}</b></section><section className="actions"><button onClick={()=>action("DEVICE_STATUS")}>📱 Device Status</button><button onClick={()=>action("GET_LOCATION")}>📍 Get Location</button><button onClick={()=>action("RING_DEVICE")}>🔊 Ring Device</button><button onClick={()=>action("RECOVERY_PHOTO",{camera:"front"})}>📷 Front Camera</button><button onClick={()=>action("RECOVERY_PHOTO",{camera:"rear"})}>📷 Back Camera</button><button onClick={()=>action("SET_RECOVERY_MODE",{enabled:true})}>🛡 Enable Lost Mode</button></section>{msg&&<div className="card notice">{msg}</div>}<section className="details"><div className="card"><h3>LAST KNOWN LOCATION</h3>{device.location?<><p>{device.location.latitude}, {device.location.longitude}</p><p>Accuracy: {device.location.accuracyMeters??"--"} m</p><a target="_blank" href={`https://www.google.com/maps?q=${device.location.latitude},${device.location.longitude}`}>Open in Maps</a></>:<p>No location yet.</p>}</div><div className="card"><h3>LATEST RECOVERY PHOTO</h3>{device.photo?<><img src={device.photo.dataUrl}/><p>{device.photo.camera}</p><a href={device.photo.dataUrl} download="jazz-recovery.jpg">Download Photo</a></>:<p>No photo yet.</p>}</div></section></>}</main></div><footer>Developed by 😈gunakarna😈</footer></div>;
}
createRoot(document.getElementById("root")!).render(<App/>);
