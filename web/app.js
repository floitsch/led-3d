// Copyright (C) 2026 Toit contributors.
// MIT license; see LICENSE.
import {Device,validateMap} from './lib/device.js';
import {Viewer,orient} from './lib/viewer.js';
import {fillShortGaps,validateCapture} from './lib/reconstruction.js';
import {syntheticCapture} from './lib/synthetic.js';

const $=id=>document.getElementById(id),viewer=new Viewer($('viewer'));
let device=null,deviceConfig=null,capture=null,baseMap=null,stream=null,captureWorker=null,solveWorker=null,scanning=false,frameBusy=false,scanTimer=null,videoFrameHandle=null;
let startingScan=false,finishingScan=false,stopRequest=null;
let finishTimer=null,workTimer=null,workStarted=0,lastProgress=0,stripQueue=Promise.resolve(),stripPending=0;
const params=new URLSearchParams(location.hash.slice(1));
function readSaved(key){try{return localStorage.getItem(key);}catch{return null;}}
function save(key,value){try{localStorage.setItem(key,value);}catch{}}
const address=params.get('device')||readSaved('led3d.address')||'led-tree.local';
$('address').value=address;$('device-key').value=params.get('key')||readSaved(`led3d.key.${address}`)||'';
// Pairing keys are carried in fragments, never sent to GitHub in HTTP requests.
if(params.has('key')){save(`led3d.key.${address}`,params.get('key'));history.replaceState(null,'',`#device=${encodeURIComponent(address)}`);}
function notice(message,error=false){$('notice').hidden=false;$('notice').textContent=message;$('notice').classList.toggle('error',error);}
function captureBusy(){return startingScan||finishingScan||scanning||!!solveWorker||!!stopRequest||stripPending>0;}
function updateCaptureButtons(){
  $('start-scan').disabled=captureBusy();
  $('finish-scan').disabled=!scanning;
  $('cancel-scan').disabled=startingScan||(!scanning&&!solveWorker&&!(finishingScan&&captureWorker));
  $('demo').disabled=captureBusy();$('new-capture').disabled=captureBusy();
  $('retry-solve').disabled=captureBusy()||!capture;
}
function step(name,completed=false){
  if(!completed&&captureBusy()&&name!=='scan'){notice('Finish the current scan before changing steps.');return;}
  for(const section of document.querySelectorAll('.stage'))section.hidden=section.id!==name;
  for(const b of document.querySelectorAll('nav button'))b.classList.toggle('active',b.dataset.step===name);
  $(name).scrollIntoView({block:'start'});
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
function updateDeviceButtons(){for(const id of ['configure','test-led','test-off','load-device-map'])$(id).disabled=!device;$('save-map').disabled=!device||!baseMap||!!stopRequest;$('send-effect').disabled=!device||!!stopRequest;}
function download(name,value){const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function displayMap(map){
  validateMap(map);baseMap=map;$('fill-gaps').checked=false;viewer.angles=[0,0,0];for(const id of ['rotate-x','rotate-y','rotate-z'])$(id).value=0;
  refreshMap();viewer.resetView();$('export-map').disabled=false;updateDeviceButtons();step('play',true);
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
  $('connection').textContent=`Connected · ${status.hostname}`;$('pin').value=status.config.pin;$('count').value=status.config.count;$('order').value=status.config.order;
  updateDeviceButtons();notice(status.error||'Connected. Check your strip settings, then scan.',!!status.error);
});
function saveStripAndTest(){
  if(!$('config-form').reportValidity())return Promise.resolve();
  const target=requireDevice();
  const config={pin:Number($('pin').value),count:Number($('count').value),order:$('order').value};
  const color=$('test-color').value;
  stripPending++;updateCaptureButtons();
  const operation=stripQueue.then(async()=>{
    if(target!==device)throw new Error('Device changed. Save the strip settings again.');
    // The firmware reports defaults before a strip has ever been opened.
    // Applying even unchanged settings ensures the GPIO is initialized.
    await target.request('config',config);
    if(JSON.stringify(config)!==JSON.stringify(deviceConfig)){
      capture=null;$('export-capture').disabled=true;deviceConfig=config;
    }
    await target.request('test',{index:config.count-1,color});
    notice(`Strip settings saved. LED ${config.count} is lit ${color} for 30 seconds.`);
  }).finally(()=>{stripPending--;updateCaptureButtons();});
  stripQueue=operation.catch(()=>{});
  return operation;
}
action('config-form',saveStripAndTest);
action('test-led',saveStripAndTest);
for(const id of ['count','test-color'])$(id).onchange=()=>{if(device)void saveStripAndTest().catch(e=>notice(e.message,true));};
action('test-off',async()=>{await stripQueue;await requireDevice().request('stop',{});});
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
for(const [id,yaw,pitch] of [['view-left',-.25,0],['view-right',.25,0],['view-up',0,-.25],['view-down',0,.25]])action(id,()=>viewer.rotateView(yaw,pitch));
action('view-reset',()=>viewer.resetView());

function workProgress(message){lastProgress=performance.now();$('scan-status').textContent=message;}
function startWork(message){
  clearInterval(workTimer);workStarted=performance.now();workProgress(message);
  $('solve-progress').hidden=false;$('solve-time').hidden=false;
  const tick=()=>{
    const elapsed=Math.floor((performance.now()-workStarted)/1000),quiet=Math.floor((performance.now()-lastProgress)/1000);
    $('solve-time').textContent=`${elapsed}s elapsed${quiet>=10?` · ${quiet}s since the last progress update`:''}. Processing on this phone; you can cancel and keep the capture data.`;
  };
  tick();workTimer=setInterval(tick,1000);
}
function endWork(message){
  clearInterval(workTimer);workTimer=null;clearTimeout(finishTimer);finishTimer=null;
  $('solve-progress').hidden=true;
  if(workStarted)$('solve-time').textContent=`Processing ended after ${Math.floor((performance.now()-workStarted)/1000)}s.`;
  workProgress(message);
}

function reconstruct(data){
  if(solveWorker)throw new Error('Reconstruction is already running.');
  try{validateCapture(data);}catch(e){endWork(e.message);throw e;}
  capture=data;$('export-capture').disabled=false;
  startWork(`Reconstructing ${data.frames.length} usable views in your browser…`);$('scan-progress').scrollIntoView({block:'start'});
  try{solveWorker=new Worker(new URL('./reconstruct-worker.js',import.meta.url),{type:'module'});}
  catch(e){endWork(`Could not start reconstruction: ${e.message}`);throw e;}
  updateCaptureButtons();
  function finish(){solveWorker?.terminate();solveWorker=null;updateCaptureButtons();$('start-scan').textContent='Capture more views';}
  solveWorker.onmessage=({data})=>{
    if(data.type==='progress')workProgress(data.message);
    else if(data.type==='result'){finish();endWork('Reconstruction ready.');displayMap(data.map);notice('Reconstruction ready. Drag the preview to check the shape, then set its orientation before saving.');}
    else if(data.type==='error'){finish();endWork(data.message);notice(data.message,true);}
  };
  solveWorker.onerror=event=>{finish();endWork(`Reconstruction failed: ${event.message}`);notice($('scan-status').textContent,true);};
  solveWorker.postMessage(data);
}
action('retry-solve',()=>reconstruct(capture));
action('demo',()=>{if(captureBusy())throw new Error('Finish or cancel capture first.');capture=null;reconstruct(syntheticCapture({count:80,views:12,noise:.5,missing:.12,outliers:.03}));});
$('import').onchange=async()=>{
  try{if(captureBusy())throw new Error('Finish the current scan first.');const file=$('import').files[0];if(!file)return;if(file.size>8*1024*1024)throw new Error('Capture file exceeds 8 MiB.');const value=JSON.parse(await file.text());if(value.leds)displayMap(value);else reconstruct(value);}catch(e){notice(e.message,true);}finally{$('import').value='';}
};

const imageCanvas=document.createElement('canvas'),imageContext=imageCanvas.getContext('2d',{willReadFrequently:true});
function stopCamera(){
  scanning=false;clearTimeout(scanTimer);$('camera-panel').classList.remove('is-scanning');
  if(videoFrameHandle!==null){if($('video').cancelVideoFrameCallback)$('video').cancelVideoFrameCallback(videoFrameHandle);else cancelAnimationFrame(videoFrameHandle);videoFrameHandle=null;}
  stream?.getTracks().forEach(t=>t.stop());stream=null;$('video').srcObject=null;$('camera-empty').hidden=false;$('finish-scan').disabled=true;$('cancel-scan').disabled=true;$('start-scan').disabled=false;
}
function stopDevice(){
  if(!stopRequest){
    stopRequest=Promise.resolve().then(()=>device?.request('stop',{})).finally(()=>{stopRequest=null;updateCaptureButtons();updateDeviceButtons();});
    updateCaptureButtons();updateDeviceButtons();
  }
  return stopRequest;
}
async function cancelCapture(message,error=false){
  finishingScan=true;
  stopCamera();captureWorker?.terminate();captureWorker=null;solveWorker?.terminate();solveWorker=null;
  updateCaptureButtons();endWork(message);
  if(error)notice(message,true);
  try{await stopDevice();}catch(e){notice(e.message,true);}
  finally{finishingScan=false;updateCaptureButtons();}
}
action('start-scan',async()=>{
  requireDevice();if(captureBusy())throw new Error('Finish the current scan first.');
  if(!navigator.mediaDevices?.getUserMedia)throw new Error('Camera access requires HTTPS. Open the GitHub Pages app in Android Chrome.');
  if(capture&&(capture.count!==deviceConfig.count))capture=null;
  startingScan=true;updateCaptureButtons();$('scan-status').textContent='Opening the camera…';
  $('camera-panel').scrollIntoView({block:'start'});
  let scanCommandSent=false;
  try{
    stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720},frameRate:{ideal:30}},audio:false});
    $('video').srcObject=stream;await $('video').play();
    const video=$('video'),factor=Math.min(1,720/Math.max(video.videoWidth,video.videoHeight)),width=Math.round(video.videoWidth*factor),height=Math.round(video.videoHeight*factor);
    if(capture&&(capture.width!==width||capture.height!==height))throw new Error('Image dimensions changed. Choose Start fresh, and keep the same phone orientation throughout the new capture.');
    imageCanvas.width=width;imageCanvas.height=height;$('overlay').width=width;$('overlay').height=height;
    $('camera-panel').style.aspectRatio=`${width}/${height}`;
    const worker=new Worker(new URL('./capture-worker.js',import.meta.url),{type:'module'});
    captureWorker=worker;worker.postMessage({type:'start',count:deviceConfig.count,width,height});
    captureWorker.onmessage=({data})=>{
      if(captureWorker!==worker)return;
      if(data.type==='frame'){
        frameBusy=false;const ctx=$('overlay').getContext('2d');ctx.clearRect(0,0,width,height);
        for(const t of data.tracks){ctx.strokeStyle=t.id===null?'#ffca75':'#b6f36d';ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(t.x,t.y,6,0,2*Math.PI);ctx.stroke();if(t.id!==null){ctx.fillStyle='#b6f36d';ctx.font='10px system-ui';ctx.fillText(String(t.id+1),t.x+8,t.y-5);}}
        $('identified').textContent=new Set(data.tracks.filter(t=>t.id!==null).map(t=>t.id)).size;$('keyframes').textContent=data.frames;
      }else if(data.type==='capture'){
        clearTimeout(finishTimer);finishTimer=null;
        captureWorker.terminate();captureWorker=null;
        finishingScan=false;
        try{
          const current=data.capture;
          if(capture){current.frames=[...capture.frames,...current.frames];if(current.frames.length>180){const all=current.frames;current.frames=Array.from({length:180},(_,i)=>all[Math.round(i*(all.length-1)/179)]);}}
          const focal=Number($('focal').value);if(focal>0)current.focal=focal;
          capture=current;$('export-capture').disabled=false;reconstruct(current);
        }catch(e){endWork(e.message);$('export-capture').disabled=!capture;notice(e.message,true);}
        updateCaptureButtons();
      }else if(data.type==='error'){void cancelCapture(data.message,true);}
    };
    captureWorker.onerror=e=>{if(captureWorker===worker)void cancelCapture(`Capture worker failed: ${e.message}`,true);};
    scanCommandSent=true;
    await device.request('scan',{brightness:Number($('scan-brightness').value)});
    if(captureWorker!==worker)throw new Error('Capture worker stopped before the scan could start.');
    if(document.hidden)throw new Error('Keep the camera page visible while scanning.');
    scanning=true;frameBusy=false;$('camera-empty').hidden=true;$('start-scan').disabled=true;$('finish-scan').disabled=false;$('cancel-scan').disabled=false;
    $('camera-panel').classList.add('is-scanning');$('camera-panel').scrollIntoView({block:'start'});
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
  startWork('Collecting identified LED observations…');$('scan-progress').scrollIntoView({block:'start'});
  // Processing the captured video must not wait for a Wi-Fi response.
  if(worker){
    worker.postMessage({type:'finish'});
    finishTimer=setTimeout(()=>{if(captureWorker===worker)void cancelCapture('The capture worker did not respond. Cancelled processing; please start a fresh capture.',true);},10000);
  }else{finishingScan=false;endWork('The capture worker stopped. Please start a fresh capture.');updateCaptureButtons();}
  void stopDevice().catch(e=>notice(`Capture processing is independent of the ESP32 connection. ${e.message}`,true));
});
action('cancel-scan',()=>cancelCapture('Cancelled. Earlier capture data is retained.'));
document.addEventListener('visibilitychange',()=>{if(document.hidden&&scanning)$('finish-scan').click();});
