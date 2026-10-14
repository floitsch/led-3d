// Copyright (C) 2026 Toit contributors.
// MIT license; see LICENSE.
import {flash,validateNetwork} from './lib/installer.js';

const $=id=>document.getElementById(id);
let flashBundle=null,installing=false;
function readSaved(key){try{return localStorage.getItem(key);}catch{return null;}}
function save(key,value){try{localStorage.setItem(key,value);}catch{}}
function notice(message,error=false){$('notice').hidden=false;$('notice').textContent=message;$('notice').classList.toggle('error',error);}
async function showConnection(host,key){
  const link=new URL('./capture.html',location.href);
  link.hash=new URLSearchParams({device:host,key}).toString();
  $('saved-address').value=host;$('saved-key').value=key;
  $('wifi-link').href=link.href;$('phone-link').value=link.href;$('installed').hidden=false;
  $('qr').hidden=true;
  try{
    const qr=await import('https://esm.sh/qrcode@1.5.4');
    // A preceding QR request may finish after a new installation.
    if($('phone-link').value!==link.href)return;
    await qr.default.toCanvas($('qr'),link.href,{width:240,margin:1});
    $('qr').hidden=false;
  }catch{notice('Use the device address and pairing key, or copy the connection link; QR generation is unavailable.');}
}
const savedAddress=readSaved('led3d.address'),savedKey=savedAddress&&readSaved(`led3d.key.${savedAddress}`);
if(savedAddress&&savedKey)void showConnection(savedAddress,savedKey);

$('firmware-file').onchange=async()=>{
  try{
    const file=$('firmware-file').files[0];if(!file)return;
    if(file.size>7*1024*1024)throw new Error('Firmware bundle is too large.');
    flashBundle=JSON.parse(await file.text());notice(`Selected firmware for ${flashBundle.manifest?.chip}.`);
  }catch(e){notice(e.message,true);}
};
$('install-form').onsubmit=async event=>{
  event.preventDefault();if(installing)return;
  installing=true;$('install-button').disabled=true;
  try{
    const key=Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,'0')).join('');
    const settings={ssid:$('ssid').value,password:$('password').value,hostname:$('hostname').value,key};
    validateNetwork(settings);$('flash-progress').hidden=false;
    await flash(settings,{bundle:flashBundle,onStatus:s=>$('flash-status').textContent=s,onProgress:n=>$('flash-progress').value=n});
    $('password').value='';const host=`${settings.hostname}.local`;
    save('led3d.address',host);save(`led3d.key.${host}`,key);
    notice('Installed. Use the connection details below on your phone.');
    await showConnection(host,key);
  }catch(e){notice(e.message||String(e),true);}
  finally{installing=false;$('install-button').disabled=false;}
};
