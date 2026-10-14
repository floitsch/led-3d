// Copyright (C) 2026 Toit contributors.
// MIT license; see LICENSE.
export function deviceOrigin(value) {
  const url=new URL(value.includes('://')?value:`http://${value}`);
  if(url.protocol!=='http:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error('Enter a .local hostname or local IPv4 address, optionally with a port.');
  const host=url.hostname, parts=host.split('.').map(Number);
  const ipv4=parts.length===4&&parts.every(n=>Number.isInteger(n)&&n>=0&&n<=255);
  const local=ipv4&&(parts[0]===10||(parts[0]===192&&parts[1]===168)||(parts[0]===172&&parts[1]>=16&&parts[1]<=31)||(parts[0]===169&&parts[1]===254)||parts[0]===127);
  if(!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.local$/i.test(host)&&!local&&host!=='localhost')throw new Error('Use a .local hostname or a private IPv4 address.');
  return url.origin;
}
export class Device {
  constructor(address,token=''){this.origin=deviceOrigin(address);this.token=token;}
  async request(path,data) {
    let response;
    try {response=await fetch(this.origin+'/api/'+path,{method:data===undefined?'GET':'POST',mode:'cors',credentials:'omit',targetAddressSpace:'local',headers:{...(data===undefined?{}:{'Content-Type':'application/json'}),...(this.token?{'X-LED-Key':this.token}:{})},body:data===undefined?undefined:JSON.stringify(data),signal:AbortSignal.timeout(12000)});}
    catch {throw new Error('Cannot reach the ESP32. Use the same Wi-Fi, allow local-network access in Chrome, and check the hostname (or try its IP address).');}
    const body=await response.json();
    if(!response.ok)throw new Error(body.error||`Device returned ${response.status}`);
    return body;
  }
}
export function validateMap(map) {
  if(map?.version!==1||!Number.isInteger(map.count)||map.count<1||map.count>4096||!Array.isArray(map.leds)||map.leds.length!==map.count)throw new Error('Invalid position map.');
  map.leds.forEach((p,i)=>{
    if(p.id!==i||!['measured','estimated','missing'].includes(p.status)||((p.position===null)!==(p.status==='missing')))throw new Error('Invalid LED identity/status.');
    if(p.position!==null&&(!Array.isArray(p.position)||p.position.length!==3||!p.position.every(v=>Number.isFinite(v)&&Math.abs(v)<=10)))throw new Error('Invalid LED coordinates.');
  });
  return map;
}
