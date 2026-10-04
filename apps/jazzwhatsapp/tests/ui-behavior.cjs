const vm = require('node:vm');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const path = require('node:path').join(__dirname, '../app/src/main/assets/app.js');
const elements = new Map();
function element(id) {
  if (!elements.has(id)) elements.set(id, {innerHTML:'', textContent:'', value:'', style:{setProperty(){}}, classList:{add(){},remove(){},contains(){return true}},addEventListener(){},setAttribute(k,v){this[k]=v}, dataset:{}, focus(){}});
  return elements.get(id);
}
const document = {querySelector: element, querySelectorAll:()=>[], addEventListener(){}, createElement:()=>element('new')};
const calls=[];
const native = {boot:()=>JSON.stringify({signedIn:'false',connection:'Connected'}),camera:()=>false,requestCamera:()=>calls.push('requestCamera'),microphone:()=>true,callScreen:raw=>calls.push(JSON.parse(raw)),voice:raw=>calls.push('voice'),endVoice(){},request(){}};
const context = vm.createContext({document, Native:native, window:{Native:native},crypto:require('node:crypto'),setTimeout:()=>1,clearTimeout(){},setInterval(){},requestAnimationFrame:fn=>fn(),localStorage:{getItem:()=>null},navigator:{},console});
vm.runInContext(fs.readFileSync(path,'utf8'),context);
const run=script=>vm.runInContext(script, context);
(async()=>{
 run('state.apiVersion="1.0.5";page="chat";renderChat();');
 assert.match(element('#app').innerHTML,/data-action="videoJazz"/);
 assert.match(element('#app').innerHTML,/id="composerButton" data-action="dictate"/);
 element('#message').value='Hello'; run('updateComposer()'); assert.equal(element('#composerButton').type,'submit');
 element('#message').value=''; run('updateComposer()'); assert.equal(element('#composerButton').dataset.action,'dictate');
 run('state.messages=[{id:"image1",image:"data:image/jpeg;base64,YQ==",text:"Shared image",createdAt:Date.now(),sender:"user"}];showImage("image1");');
 assert.match(element('#modal').innerHTML,/data-action="downloadImage"/); assert.match(element('#modal').innerHTML,/data-action="askImage"/);
 run('currentCall={id:"ongoing",status:"active",createdAt:new Date().toISOString()};page="chat";renderChat();');
 assert.match(element('#app').innerHTML,/Return to call/);
 await run('callJazz()'); assert.equal(calls.at(-1).id,'ongoing'); assert.ok(!calls.includes('voice'),'resume must not restart voice');
 await run('callJazz(true)'); assert.equal(calls.at(-1).cameraMode,true);
 run('window.onNativeEvent({type:"call.ended",call:{id:"ongoing",status:"ended"}})');
 assert.equal(run('state.calls.find(c=>c.id==="ongoing").status'),'ended');
 assert.equal(run('currentCall'),null);
 console.log('UI behavior checks passed: video control, mic/send switching, image preview/download, active-call resume without restarting voice, ended-call state. DOM/native bridge mocked; no visual or Android hardware validation.');
})().catch(e=>{console.error(e);process.exitCode=1});
