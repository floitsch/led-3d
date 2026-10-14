// Copyright (C) 2026 Toit contributors.
// MIT license; see LICENSE.
const utf8=s=>new TextEncoder().encode(s);
export function validateNetwork(s) {
  if(!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(s.hostname))throw new Error('Use a device name with lowercase letters, digits, and hyphens.');
  if(typeof s.ssid!=='string'||utf8(s.ssid).length<1||utf8(s.ssid).length>32||s.ssid.includes('\0'))throw new Error('Wi-Fi name must be 1–32 UTF-8 bytes.');
  if(typeof s.password!=='string'||s.password.includes('\0')||(s.password!==''&&(utf8(s.password).length<8||utf8(s.password).length>63)))throw new Error('Wi-Fi password must be empty or 8–63 UTF-8 bytes.');
  if(!/^[a-f0-9]{32}$/.test(s.key))throw new Error('Invalid pairing key.');
}
// The Toit firmware config region contains a length-prefixed UBJSON object.
export function encodeConfig(value) {
  const output=[];
  function length(n){if(n>255)throw new Error('Configuration field too long.');output.push(85,n);}
  function encode(v){
    if(typeof v==='string'){const b=utf8(v);output.push(83);length(b.length);output.push(...b);return;}
    output.push(123);for(const [key,entry] of Object.entries(v)){const b=utf8(key);length(b.length);output.push(...b);encode(entry);}output.push(125);
  }
  encode(value);return new Uint8Array(output);
}
const chipIds={esp32:0,esp32s2:2,esp32c3:5,esp32s3:9,esp32c6:13};
export async function prepareFirmware(bundle,settings) {
  validateNetwork(settings);
  const m=bundle?.manifest;
  if(m?.version!==1||!(m.chip in chipIds)||typeof bundle.image!=='string')throw new Error('Invalid firmware bundle.');
  const image=Uint8Array.from(atob(bundle.image),c=>c.charCodeAt(0));
  const digest=async b=>new Uint8Array(await crypto.subtle.digest('SHA-256',b));
  const hash=Array.from(await digest(image),b=>b.toString(16).padStart(2,'0')).join('');
  if(hash!==m.sha256)throw new Error('Firmware checksum mismatch.');
  const {appOffset:a,appSize:n,configOffset:c,configSize:s}=m;
  if(![a,n,c,s].every(Number.isSafeInteger)||a<0||n<24||a+n>image.length||c<a+24||s<4||c+s>a+n||image.length>4*1024*1024)throw new Error('Invalid firmware layout.');
  const view=new DataView(image.buffer);
  if(image[a]!==0xe9||view.getUint16(a+12,true)!==chipIds[m.chip]||image[a+23]!==1)throw new Error('Unexpected ESP image format.');
  const segments=[],count=image[a+1];let offset=a+24;
  if(count<1||count>16)throw new Error('Invalid segment count.');
  for(let i=0;i<count;i++){
    if(offset+8>a+n)throw new Error('Truncated firmware segment.');
    const size=view.getUint32(offset+4,true),start=offset+8;
    if(start+size>a+n)throw new Error('Truncated firmware segment.');
    segments.push({start,end:start+size});offset=start+size;
  }
  const checksum=a+Math.ceil((offset-a+1)/16)*16-1;
  if(checksum+33!==a+n||!segments.some(p=>c>=p.start&&c+s<=p.end))throw new Error('Invalid configuration region.');
  const config=encodeConfig({wifi:{'wifi.ssid':settings.ssid,'wifi.password':settings.password},'led-3d':{hostname:settings.hostname,key:settings.key}});
  if(config.length+4>s)throw new Error('Configuration exceeds firmware capacity.');
  image.fill(0,c,c+s);view.setUint32(c,config.length,true);image.set(config,c+4);
  let xor=0xef;for(const p of segments)for(let i=p.start;i<p.end;i++)xor^=image[i];
  image[checksum]=xor;image.set(await digest(image.subarray(a,checksum+1)),checksum+1);
  return image;
}
export async function flash(settings,{bundle,onProgress,onStatus}={}) {
  validateNetwork(settings);
  if(!navigator.serial)throw new Error('Install using Chrome on a computer with a USB connection. Then scan from Android Chrome.');
  // Request the port before any asynchronous fetch to preserve user activation.
  const port=await navigator.serial.requestPort();let transport;
  try {
    const {ESPLoader,Transport}=await import('../vendor/esptool.js');
    transport=new Transport(port,false);
    const loader=new ESPLoader({transport,baudrate:460800,terminal:{clean(){},writeLine:onStatus,write:onStatus}});
    onStatus('Connecting to the bootloader…');await loader.main();
    const chip=loader.chip.CHIP_NAME.toLowerCase().replaceAll('-','');
    const detectedSize=await loader.detectFlashSize();
    if(!detectedSize||loader.flashSizeBytes(detectedSize)<4*1024*1024)throw new Error('This firmware requires a board with at least 4 MiB of detected flash.');
    if(!bundle){const response=await fetch(`firmware/${chip}.json`);if(!response.ok)throw new Error(`No released firmware for ${loader.chip.CHIP_NAME} yet. Build and import a matching bundle.`);bundle=await response.json();}
    if(bundle.manifest.chip!==chip)throw new Error(`This firmware is for ${bundle.manifest.chip}, but the connected chip is ${chip}.`);
    const image=await prepareFirmware(bundle,settings);
    onStatus('Installing firmware and Wi-Fi settings…');
    await loader.writeFlash({fileArray:[{data:image,address:0}],flashSize:bundle.manifest.flashSize,flashMode:'keep',flashFreq:'keep',eraseAll:true,compress:true,reportProgress:(_,written,total)=>onProgress(100*written/total)});
    await loader.after('custom_reset',undefined,'D0|R1|W100|R0');
    onProgress(100);onStatus('Installed. The ESP32 is joining Wi-Fi.');
  }finally{if(transport)await transport.disconnect().catch(()=>{});if(port.readable)await port.close().catch(()=>{});}
}
