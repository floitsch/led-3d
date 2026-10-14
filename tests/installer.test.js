import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {prepareFirmware,validateNetwork} from '../web/lib/installer.js';
import {deviceOrigin,validateMap} from '../web/lib/device.js';
const settings={hostname:'led-tree',ssid:'test-network',password:'testing-only',key:'0123456789abcdef0123456789abcdef'};
test('device addresses are local and do not accept URL credentials or paths',()=>{
  assert.equal(deviceOrigin('tree.local'),'http://tree.local');assert.equal(deviceOrigin('192.168.1.23:8080'),'http://192.168.1.23:8080');
  for(const url of ['example.com','tree.local/api','http://x:y@tree.local','8.8.8.8','https://tree.local'])assert.throws(()=>deviceOrigin(url));
});
test('network config checks UTF-8 lengths and pairing keys',()=>{
  validateNetwork(settings);assert.throws(()=>validateNetwork({...settings,ssid:'é'.repeat(17)}));assert.throws(()=>validateNetwork({...settings,hostname:'-tree'}));assert.throws(()=>validateNetwork({...settings,key:''}));
});
test('position import rejects NaN, invalid statuses, and mismatched IDs',()=>{
  const map={version:1,count:1,leds:[{id:0,status:'measured',position:[0,0,0]}]};validateMap(map);
  assert.throws(()=>validateMap({...map,leds:[{id:0,status:'missing',position:[0,0,0]}]}));
  assert.throws(()=>validateMap({...map,leds:[{id:0,status:'measured',position:[NaN,0,0]}]}));
});
for(const chip of ['esp32','esp32s3'])test(`${chip} provisioning preserves layout and repairs ESP image checksums`,async t=>{
  let bundle;try{bundle=JSON.parse(await readFile(`web/firmware/${chip}.json`,'utf8'));}catch(e){if(e.code==='ENOENT'){t.skip('Build firmware first');return;}throw e;}
  const image=await prepareFirmware(bundle,settings),m=bundle.manifest,original=Buffer.from(bundle.image,'base64'),view=new DataView(image.buffer);
  const config=new TextDecoder().decode(image.subarray(m.configOffset+4,m.configOffset+4+view.getUint32(m.configOffset,true)));
  assert.ok(config.includes(settings.ssid)&&config.includes(settings.password)&&config.includes(settings.hostname)&&config.includes(settings.key));
  const originalConfig=new TextDecoder().decode(original.subarray(m.configOffset,m.configOffset+m.configSize));assert.ok(!originalConfig.includes(settings.password));
  let pos=m.appOffset+24,xor=0xef;
  for(let i=0;i<image[m.appOffset+1];i++){const size=view.getUint32(pos+4,true);for(let j=pos+8;j<pos+8+size;j++)xor^=image[j];pos+=8+size;}
  const checksum=m.appOffset+Math.ceil((pos-m.appOffset+1)/16)*16-1;
  assert.equal(image[checksum],xor);
  assert.deepEqual(Buffer.from(image.subarray(checksum+1,checksum+33)),createHash('sha256').update(image.subarray(m.appOffset,checksum+1)).digest());
  for(let i=0;i<image.length;i++)if(!(i>=m.configOffset&&i<m.configOffset+m.configSize)&&!(i>=checksum&&i<checksum+33))assert.equal(image[i],original[i]);
  await assert.rejects(()=>prepareFirmware({...bundle,manifest:{...m,sha256:'0'.repeat(64)}},settings),/checksum/);
});
