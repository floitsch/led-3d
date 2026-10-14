// Copyright (C) 2026 Toit contributors.
// MIT license; see LICENSE.
export const PROTOCOL_VERSION=1;
export const SLOT_MS=100;
export const SYNC_SLOTS=3;
export const DATA_BITS=20;
export const CYCLE_SLOTS=SYNC_SLOTS+DATA_BITS;
export function checksum(id) {
  let crc=0xa7;
  for(const byte of [id>>8,id&255]) {
    crc^=byte;
    for(let j=0;j<8;j++)crc=((crc<<1)^((crc&128)?7:0))&255;
  }
  return crc;
}
export function codeword(id) {
  if(!Number.isInteger(id)||id<0||id>4095)throw new Error('LED index must be 0–4095.');
  return (id<<8)|checksum(id);
}
export function patternColor(id,elapsedMs,brightness=80) {
  const slot=Math.floor(elapsedMs/SLOT_MS)%CYCLE_SLOTS;
  if(slot<SYNC_SLOTS)return [8,brightness,8];
  const bit=(codeword(id)>>(DATA_BITS-1-(slot-SYNC_SLOTS)))&1;
  return bit?[brightness,8,8]:[8,8,brightness];
}
export function classifyColor(r,g,b) {
  const top=Math.max(r,g,b), low=Math.min(r,g,b);
  if(top<25||top-low<top*.28)return null;
  if(g>r*1.35&&g>b*1.35)return 'sync';
  if(r>g*1.35&&r>b*1.35)return 1;
  if(b>g*1.35&&b>r*1.35)return 0;
  return null;
}
export class IdentityDecoder {
  constructor(count){this.count=count;this.reset();}
  reset(){this.greenStart=null;this.lastGreen=null;this.start=null;this.votes=Array.from({length:DATA_BITS},()=>[0,0]);this.reported=false;}
  push(time,color) {
    if(color==='sync') {
      if(this.lastGreen===null||time-this.lastGreen>SLOT_MS*1.8){
        this.greenStart=time;this.start=null;
        if(this.reported)this.votes=Array.from({length:DATA_BITS},()=>[0,0]);
        this.reported=false;
      }
      this.lastGreen=time;return null;
    }
    if(color!==0&&color!==1)return null;
    if(this.start===null) {
      if(this.lastGreen===null||time-this.lastGreen>SLOT_MS*.8||this.lastGreen-this.greenStart<SLOT_MS*.8)return null;
      this.start=(this.lastGreen+time)/2;
    }
    const phase=(time-this.start)/SLOT_MS, index=Math.floor(phase), fraction=phase-index;
    // Skip transitions to tolerate rolling shutter and uncertain frame timing.
    if(index<0||index>=DATA_BITS||fraction<.22||fraction>.78)return null;
    this.votes[index][color]++;
    if(this.reported||!this.votes.every(v=>v[0]+v[1]>0&&v[0]!==v[1]))return null;
    this.reported=true;
    const word=this.votes.reduce((w,v)=>(w<<1)|(v[1]>v[0]?1:0),0), id=word>>>8;
    return id<this.count && checksum(id)===(word&255)?id:null;
  }
}
