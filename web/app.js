// Copyright (C) 2026 Toit contributors.
// MIT license; see LICENSE.
import {Device,validateMap} from './lib/device.js';
import {Viewer,orient} from './lib/viewer.js';
import {fillShortGaps,validateCapture} from './lib/reconstruction.js';
import {syntheticCapture} from './lib/synthetic.js';
import {flash,validateNetwork} from './lib/installer.js';

const $=id=>document.getElementById(id),viewer=new Viewer($('viewer'));
let device=null,deviceConfig=null,capture=null,baseMap=null,stream=null,captureWorker=null,solveWorker=null,scanning=false,frameBusy=false,flashBundle=null,scanTimer=null,videoFrameHandle=null;
let startingScan=false,finishingScan=false,stopRequest=null;
const params=new URLSearchParams(location.hash.slice(1));
function readSaved(key){try{return localStorage.getItem(key);}catch{return null;}}
function save(key,value){try{localStorage.setItem(key,value);}catch{}}
const address=params.get('device')||readSaved('led3d.address')||'led-tree.local';
$('address').value=address;$('device-key').value=params.get('key')||readSaved(`led3d.key.${address}`)||'';
// Pairing keys are carried in fragments, never sent to GitHub in HTTP requests.
if(params.has('key')){save(`led3d.key.${address}`,params.get('key'));history.replaceState(null,'',`#device=${encodeURIComponent(address)}`);}
function notice(message,error=false){$('notice').hidden=false;$('notice').textContent=message;$('notice').classList.toggle('error',error);}
function captureBusy(){return startingScan||finishingScan||scanning||!!solveWorker||!!stopRequest;}
function updateCaptureButtons(){
  $('start-scan').disabled=captureBusy();
  $('finish-scan').disabled=!scanning;
  $('cancel-scan').disabled=startingScan||finishingScan||(!scanning&&!solveWorker);
  $('demo').disabled=captureBusy();$('new-capture').disabled=captureBusy();
}
function step(name){
  if(captureBusy()&&name!=='scan'){notice('Finish the current scan before changing steps.');return;}
  for(const section of document.querySelectorAll('.stage'))section.hidden=section.id!==name;
  for(const b of document.querySelectorAll('nav button'))b.classList.toggle('active',b.dataset.step===name);
}
document.querySelectorAll('[data-step]').forEach(b=>b.onclick=()=>step(b.dataset.step));
function action(id,fn){$(id).addEventListener($(id).tagName==='FORM'?'submit':'click',async event=>{
  event.preventDefault();const button=event.submitter||$(id);button.disabled=true;
  try{await fn(event);}catch(e){notice(e.message||String(e),true);}finally{
    button.disabled=false;
    updateCaptureButtons();
  }
});}
function requireDevice(){if(!device)throw new Error('Connect to the ESP32 first.');return device;}
function updateDeviceButtons(){for(const id of ['configure','test-led','test-off','load-device-map'])$(id).disabled=!device;$('save-map').disabled=!device||!baseMap;$('send-effect').disabled=!device;}
function download(name,value){const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function displayMap(map){
  validateMap(map);baseMap=map;$('fill-gaps').checked=false;viewer.angles=[0,0,0];for(const id of ['rotate-x','rotate-y','rotate-z'])$(id).value=0;
  refreshMap();$('export-map').disabled=false;updateDeviceButtons();step('play');
}
function refreshMap(){
  if(!baseMap)return;
  viewer.map=$('fill-gaps').checked?fillShortGaps(baseMap):baseMap;
  const measured=viewer.map.leds.filter(p=>p.status==='measured').length,estimated=viewer.map.leds.filter(p=>p.status==='estimated').length;
  $('map-summary').textContent=`${measured} measured · ${estimated} estimated · ${viewer.map.count-measured-estimated} missing`;
  $('map-quality').textContent=[baseMap.registeredViews?`${baseMap.registeredViews}/${baseMap.totalViews} views registered.`:'',Number.isFinite(baseMap.medianError)?`Median image error: ${baseMap.medianError.toFixed(2)} px.`:'','Missing LEDs stay off. Estimates use string order; they may not follow the actual bends.',...(baseMap.warnings||[])].join(' ');
}
function orientedMap(){const m=structuredClone(viewer.map);m.leds.forEach(p=>{if(p.position)p.position=orient(p.position,viewer.angles);});m.orientation=[0,0,0];return m;}

action('connect-form',async()=>{
  const candidate=new Device($('address').value.trim(),$('device-key').value.trim()),status=await candidate.request('status');
  if(status.version!==1)throw new Error('This device uses an incompatible protocol. Update its firmware.');
  if(device&&device.origin!==candidate.origin){capture=null;$('export-capture').disabled=true;}
  device=candidate;deviceConfig=status.config;save('led3d.address',$('address').value.trim());save(`led3d.key.${$('address').value.trim()}`,device.token);
  $('connection').textContent=`Connected · ${status.hostname}`;$('pin').value=status.config.pin;$('count').value=status.config.count;$('test-index').value=status.config.count;$('order').value=status.config.order;
  updateDeviceButtons();notice(status.error||'Connected. Check your strip settings, then scan.',!!status.error);
});
action('config-form',async()=>{
  const config={pin:Number($('pin').value),count:Number($('count').value),order:$('order').value};
  await requireDevice().request('config',config);
  if(JSON.stringify(config)!==JSON.stringify(deviceConfig)){capture=null;$('export-capture').disabled=true;}
  deviceConfig=config;$('test-index').value=config.count;notice('Strip settings saved. Test an LED and its colors.');
});
action('test-led',async()=>{await requireDevice().request('test',{index:Number($('test-index').value)-1,color:$('test-color').value});notice('Test LED is lit for 30 seconds.');});
action('test-off',()=>requireDevice().request('stop',{}));
action('load-device-map',async()=>{
  const map=await requireDevice().request('map');if(!map)throw new Error('No positions saved on this device yet.');
  const estimated=new Set(map.estimated);
  displayMap({version:1,count:map.count,leds:map.points.map((position,id)=>({id,position,status:position?(estimated.has(id)?'estimated':'measured'):'missing',views:0,error:null})),units:'normalized'});
});
action('save-map',async()=>{
  const map=orientedMap();if(map.count!==deviceConfig.count)throw new Error('The map LED count does not match this device.');
  await requireDevice().request('map',{version:1,count:map.count,points:map.leds.map(p=>p.position?.map(x=>Math.round(x*1e6)/1e6)||null),estimated:map.leds.filter(p=>p.status==='estimated').map(p=>p.id)});
  notice('Positions saved on the ESP32. Choose an effect and press Play on lights.');
});
action('send-effect',async()=>{await requireDevice().request('effect',{name:$('effect').value,speed:Number($('speed').value),brightness:Number($('brightness').value)});notice('Playing on the ESP32. You can close this page.');});
action('export-map',()=>download('led-3d-positions.json',orientedMap()));
action('export-capture',()=>download('led-3d-capture.json',capture));
action('new-capture',()=>{
  if(captureBusy())throw new Error('Finish or cancel the current scan first.');
  capture=null;$('export-capture').disabled=true;$('start-scan').textContent='Start camera & scan';
  $('identified').textContent='0';$('keyframes').textContent='0';notice('Ready for a fresh capture. Your current position map is retained until a new reconstruction succeeds.');
});
$('fill-gaps').onchange=refreshMap;$('chain').onchange=()=>viewer.showChain=$('chain').checked;
for(const id of ['effect','speed','brightness','rotate-x','rotate-y','rotate-z'])$(id).oninput=()=>{
  viewer.effect=$('effect').value;viewer.speed=Number($('speed').value);viewer.brightness=Number($('brightness').value);
  viewer.angles=['rotate-x','rotate-y','rotate-z'].map(id=>Number($(id).value)*Math.PI/180);
};
$('brightness').oninput();

function reconstruct(data){
  if(solveWorker)throw new Error('Reconstruction is already running.');
  validateCapture(data);capture=data;$('export-capture').disabled=false;
  $('scan-status').textContent='Reconstructing in your browser…';$('start-scan').disabled=true;$('demo').disabled=true;$('cancel-scan').disabled=false;
  solveWorker=new Worker(new URL('./reconstruct-worker.js',import.meta.url),{type:'module'});
  updateCaptureButtons();
  function finish(){solveWorker?.terminate();solveWorker=null;updateCaptureButtons();$('start-scan').textContent='Capture more views';}
  solveWorker.onmessage=({data})=>{
    if(data.type==='progress')$('scan-status').textContent=data.message;
    else if(data.type==='result'){finish();displayMap(data.map);notice('Reconstruction ready. Check the shape and set its orientation before saving.');}
    else if(data.type==='error'){finish();$('scan-status').textContent=data.message;notice(data.message,true);}
  };
  solveWorker.onerror=event=>{finish();notice(`Reconstruction failed: ${event.message}`,true);};
  solveWorker.postMessage(data);
}
action('demo',()=>{if(captureBusy())throw new Error('Finish or cancel capture first.');capture=null;reconstruct(syntheticCapture({count:80,views:12,noise:.5,missing:.12,outliers:.03}));});
$('import').onchange=async()=>{
  try{if(captureBusy())throw new Error('Finish the current scan first.');const file=$('import').files[0];if(!file)return;if(file.size>8*1024*1024)throw new Error('Capture file exceeds 8 MiB.');const value=JSON.parse(await file.text());if(value.leds)displayMap(value);else reconstruct(value);}catch(e){notice(e.message,true);}finally{$('import').value='';}
};

const imageCanvas=document.createElement('canvas'),imageContext=imageCanvas.getContext('2d',{willReadFrequently:true});
function stopCamera(){
  scanning=false;clearTimeout(scanTimer);
  if(videoFrameHandle!==null){if($('video').cancelVideoFrameCallback)$('video').cancelVideoFrameCallback(videoFrameHandle);else cancelAnimationFrame(videoFrameHandle);videoFrameHandle=null;}
  stream?.getTracks().forEach(t=>t.stop());stream=null;$('video').srcObject=null;$('camera-empty').hidden=false;$('finish-scan').disabled=true;$('cancel-scan').disabled=true;$('start-scan').disabled=false;
}
function stopDevice(){
  if(!stopRequest){
    stopRequest=Promise.resolve().then(()=>device?.request('stop',{})).finally(()=>{stopRequest=null;updateCaptureButtons();});
    updateCaptureButtons();
  }
  return stopRequest;
}
async function cancelCapture(message,error=false){
  finishingScan=true;
  stopCamera();captureWorker?.terminate();captureWorker=null;solveWorker?.terminate();solveWorker=null;
  updateCaptureButtons();$('scan-status').textContent=message;
  if(error)notice(message,true);
  try{await stopDevice();}catch(e){notice(e.message,true);}
  finally{finishingScan=false;updateCaptureButtons();}
}
action('start-scan',async()=>{
  requireDevice();if(captureBusy())throw new Error('Finish the current scan first.');
  if(!navigator.mediaDevices?.getUserMedia)throw new Error('Camera access requires HTTPS. Open the GitHub Pages app in Android Chrome.');
  if(capture&&(capture.count!==deviceConfig.count))capture=null;
  startingScan=true;updateCaptureButtons();$('scan-status').textContent='Opening the camera…';
  let scanCommandSent=false;
  try{
    stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720},frameRate:{ideal:30}},audio:false});
    $('video').srcObject=stream;await $('video').play();
    const video=$('video'),factor=Math.min(1,720/Math.max(video.videoWidth,video.videoHeight)),width=Math.round(video.videoWidth*factor),height=Math.round(video.videoHeight*factor);
    if(capture&&(capture.width!==width||capture.height!==height))throw new Error('Image dimensions changed. Choose Start fresh, and keep the same phone orientation throughout the new capture.');
    imageCanvas.width=width;imageCanvas.height=height;$('overlay').width=width;$('overlay').height=height;
    const worker=new Worker(new URL('./capture-worker.js',import.meta.url),{type:'module'});
    captureWorker=worker;worker.postMessage({type:'start',count:deviceConfig.count,width,height});
    captureWorker.onmessage=({data})=>{
      if(captureWorker!==worker)return;
      if(data.type==='frame'){
        frameBusy=false;const ctx=$('overlay').getContext('2d');ctx.clearRect(0,0,width,height);
        for(const t of data.tracks){ctx.strokeStyle=t.id===null?'#ffca75':'#b6f36d';ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(t.x,t.y,6,0,2*Math.PI);ctx.stroke();if(t.id!==null){ctx.fillStyle='#b6f36d';ctx.font='10px system-ui';ctx.fillText(String(t.id+1),t.x+8,t.y-5);}}
        $('identified').textContent=new Set(data.tracks.filter(t=>t.id!==null).map(t=>t.id)).size;$('keyframes').textContent=data.frames;
      }else if(data.type==='capture'){
        captureWorker.terminate();captureWorker=null;
        finishingScan=false;
        try{
          const current=data.capture;
          if(capture){current.frames=[...capture.frames,...current.frames];if(current.frames.length>180){const all=current.frames;current.frames=Array.from({length:180},(_,i)=>all[Math.round(i*(all.length-1)/179)]);}}
          const focal=Number($('focal').value);if(focal>0)current.focal=focal;
          capture=current;reconstruct(current);
        }catch(e){$('export-capture').disabled=!capture;notice(e.message,true);}
        updateCaptureButtons();
      }else if(data.type==='error'){void cancelCapture(data.message,true);}
    };
    captureWorker.onerror=e=>{if(captureWorker===worker)void cancelCapture(`Capture worker failed: ${e.message}`,true);};
    scanCommandSent=true;
    await device.request('scan',{brightness:Number($('scan-brightness').value)});
    if(captureWorker!==worker)throw new Error('Capture worker stopped before the scan could start.');
    if(document.hidden)throw new Error('Keep the camera page visible while scanning.');
    scanning=true;frameBusy=false;$('camera-empty').hidden=true;$('start-scan').disabled=true;$('finish-scan').disabled=false;$('cancel-scan').disabled=false;
    $('scan-status').textContent='Scanning. Move slowly around the lights. Identification can take several seconds.';
    let lastMediaTime=-1;const sourceWidth=video.videoWidth,sourceHeight=video.videoHeight;
    const frame=(_now,metadata)=>{
      if(!scanning)return;
      if(video.videoWidth!==sourceWidth||video.videoHeight!==sourceHeight){notice('Camera dimensions changed; finishing this capture. Keep the same phone orientation for additional views.');$('finish-scan').click();return;}
      const time=metadata?.mediaTime??video.currentTime;
      if(!frameBusy&&time!==lastMediaTime){
        lastMediaTime=time;frameBusy=true;imageContext.drawImage(video,0,0,width,height);const image=imageContext.getImageData(0,0,width,height);
        captureWorker.postMessage({type:'frame',buffer:image.data.buffer,time:time*1000,threshold:Number($('threshold').value)},[image.data.buffer]);
      }
      videoFrameHandle=video.requestVideoFrameCallback?video.requestVideoFrameCallback(frame):requestAnimationFrame(frame);
    };
    videoFrameHandle=video.requestVideoFrameCallback?video.requestVideoFrameCallback(frame):requestAnimationFrame(frame);
    scanTimer=setTimeout(()=>$('finish-scan').click(),80_000);
  }catch(e){
    stopCamera();captureWorker?.terminate();captureWorker=null;
    if(scanCommandSent)await stopDevice().catch(()=>{});
    $('scan-status').textContent=e.message;throw e;
  }finally{startingScan=false;updateCaptureButtons();}
});
action('finish-scan',async()=>{
  if(!scanning)return;const worker=captureWorker;finishingScan=true;stopCamera();updateCaptureButtons();
  $('scan-status').textContent='Finishing capture…';
  await stopDevice().catch(e=>notice(e.message,true));
  if(captureWorker===worker&&worker)worker.postMessage({type:'finish'});
  else {finishingScan=false;updateCaptureButtons();}
});
action('cancel-scan',()=>cancelCapture('Cancelled. Earlier capture data is retained.'));
document.addEventListener('visibilitychange',()=>{if(document.hidden&&scanning)$('finish-scan').click();});

$('firmware-file').onchange=async()=>{try{const file=$('firmware-file').files[0];if(!file)return;if(file.size>7*1024*1024)throw new Error('Firmware bundle is too large.');flashBundle=JSON.parse(await file.text());notice(`Selected firmware for ${flashBundle.manifest?.chip}.`);}catch(e){notice(e.message,true);}};
action('install-form',async()=>{
  const key=Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,'0')).join('');
  const settings={ssid:$('ssid').value,password:$('password').value,hostname:$('hostname').value,key};validateNetwork(settings);
  $('flash-progress').hidden=false;
  await flash(settings,{bundle:flashBundle,onStatus:s=>$('flash-status').textContent=s,onProgress:n=>$('flash-progress').value=n});
  $('password').value='';const host=`${settings.hostname}.local`,link=new URL('./',location.href);link.hash=new URLSearchParams({device:host,key}).toString();
  $('address').value=host;$('device-key').value=key;save('led3d.address',host);save(`led3d.key.${host}`,key);
  $('wifi-link').href=link.href;$('phone-link').value=link.href;$('installed').hidden=false;
  try{const qr=await import('https://esm.sh/qrcode@1.5.4');await qr.default.toCanvas($('qr'),link.href,{width:240,margin:1});}
  catch{$('qr').hidden=true;notice('Installed. Copy the connection link to your phone; QR generation is unavailable.');}
});
