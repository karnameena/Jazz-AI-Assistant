import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import {spawn} from "node:child_process";
import {DatabaseSync} from "node:sqlite";
import {hashSecret} from "../src/auth/password.mjs";

const root = path.resolve(import.meta.dirname,"..");
const sleep = ms => new Promise(resolve=>setTimeout(resolve,ms));

async function freePort() {
  const listener=net.createServer();
  await new Promise(resolve=>listener.listen(0,"127.0.0.1",resolve));
  const port=listener.address().port;
  await new Promise(resolve=>listener.close(resolve));
  return port;
}
test("authenticated Lost Mode heartbeat reports real location toggle status without modifying it", {timeout:45000},async t=>{
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),"jazz-location-readback-"));
  t.after(()=>fs.rmSync(temporary,{recursive:true,force:true}));
  const dbfile=path.join(temporary,"lost-mode.db");
  const db=new DatabaseSync(dbfile);
  const schema=fs.readFileSync(path.join(root,"migrations/001_initial.sql"),"utf8");
  db.exec(schema);
  const ownerPassword="TestOwnerPassword123!";
  const token=crypto.randomBytes(24).toString("hex");
  const owner=db.prepare("INSERT INTO users(username,password_hash) VALUES(?,?)").run("test-owner",hashSecret(ownerPassword));
  const device=db.prepare("INSERT INTO devices(user_id,device_id,device_name,credential_hash) VALUES(?,?,?,?)")
    .run(Number(owner.lastInsertRowid),"test-companion","Test Device",hashSecret(token));
  const id=Number(device.lastInsertRowid);
  db.prepare("INSERT INTO device_state(device_id) VALUES(?)").run(id);
  db.close();
  const port=await freePort();
  const host="http://127.0.0.1:"+port;
  const server=spawn(process.execPath,["src/server.mjs"],{
    cwd:root,
    env:{...process.env,PORT:String(port),LOST_MODE_DB_PATH:dbfile,LOST_MODE_COOKIE_SECURE:"false",
      LOST_MODE_PUBLIC_ORIGIN:"http://localhost:5190"},
    stdio:["ignore","pipe","pipe"]
  });
  let stderr="";
  server.stderr.on("data",d=>stderr+=String(d));
  t.after(()=>server.kill("SIGTERM"));
  let ready=false;
  for(let i=0;i<100;i++){
    if(server.exitCode!==null)break;
    try{const response=await fetch(host+"/health");if(response.ok){ready=true;break;}}catch{}
    await sleep(100);
  }
  assert.ok(ready,"Server didn't start: "+stderr);
  async function json(method,url,body,headers={}){
    const result=await fetch(host+url,{method,headers:{"Content-Type":"application/json",...headers},body:body?JSON.stringify(body):undefined});
    return {status:result.status,response:await result.json(),cookie:result.headers.get("set-cookie")};
  }
  const session=await json("POST","/api/auth/login",{username:"test-owner",password:ownerPassword});
  assert.equal(session.status,200);
  const cookie=session.cookie.split(";")[0];
  const ownerHeaders={Cookie:cookie};
  async function status(){return await json("GET","/api/devices/"+id,undefined,ownerHeaders);}
  let response=await status();
  assert.equal(response.response.device.locationServices,"OFFLINE");
  async function heartbeat(value){
    return await json("POST","/android/device/heartbeat",{
      deviceId:"test-companion",mode:"NORMAL_MODE",
      status:{online:true,network:"WIFI",battery:82,charging:false,locationServices:value,locationServicesTimestamp:Date.now()}
    },{"Authorization":"Bearer "+token,"X-Jazz-Lost-Device-Id":"test-companion"});
  }
  assert.equal((await heartbeat("ON")).status,200);
  response=await status();
  assert.equal(response.response.device.locationServices,"ON");
  assert.ok(response.response.device.locationServicesLastConfirmed);
  assert.equal((await heartbeat("OFF")).status,200);
  response=await status();
  assert.equal(response.response.device.locationServices,"OFF");
  assert.equal((await heartbeat("invalid")).status,200);
  response=await status();
  assert.equal(response.response.device.locationServices,"UNKNOWN");
  const unauthorized=await json("GET","/api/devices/"+id);
  assert.equal(unauthorized.status,401);
  const unsupportedAction=await json("POST","/api/devices/"+id+"/actions",
    {action:"LOCATION_ENABLE"},ownerHeaders);
  assert.equal(unsupportedAction.status,400,"Do not advertise an unimplemented remote setter");
  const existing=await json("POST","/api/devices/"+id+"/actions",{action:"RING_DEVICE"},ownerHeaders);
  assert.equal(existing.status,202,"Existing ring device command must still queue");
});
