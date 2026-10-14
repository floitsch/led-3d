// Copyright (C) 2026 Toit contributors.
// MIT license; see LICENSE.
import {classifyColor,IdentityDecoder} from './protocol.js';

export function detectBlobs(rgba,width,height,{threshold=45,maxArea=500,maxBlobs=1500}={}) {
  const mask=new Uint8Array(width*height),stack=new Int32Array(width*height), blobs=[];
  for(let i=0;i<mask.length;i++) {
    const r=rgba[i*4],g=rgba[i*4+1],b=rgba[i*4+2], top=Math.max(r,g,b), bottom=Math.min(r,g,b);
    if(top>=threshold&&(top-bottom>top*.25||top>220))mask[i]=1;
  }
  for(let seed=0;seed<mask.length;seed++)if(mask[seed]) {
    let end=1,start=0,area=0,weight=0,sx=0,sy=0,sr=0,sg=0,sb=0,minX=width,maxX=0,minY=height,maxY=0;
    stack[0]=seed;mask[seed]=0;
    while(start<end) {
      const p=stack[start++],x=p%width,y=Math.floor(p/width),r=rgba[p*4],g=rgba[p*4+1],b=rgba[p*4+2],w=Math.max(r,g,b);
      area++;weight+=w;sx+=x*w;sy+=y*w;sr+=r;sg+=g;sb+=b;
      minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
      for(const q of [x>0?p-1:-1,x<width-1?p+1:-1,y>0?p-width:-1,y<height-1?p+width:-1])if(q>=0&&mask[q]){mask[q]=0;stack[end++]=q;}
    }
    if(area>=2&&area<=maxArea&&(maxX-minX+1)/(maxY-minY+1)<4&&(maxY-minY+1)/(maxX-minX+1)<4) {
      blobs.push({x:sx/weight,y:sy/weight,area,color:classifyColor(sr/area,sg/area,sb/area),brightness:weight/area});
      if(blobs.length>=maxBlobs)break;
    }
  }
  return blobs;
}
export class Tracker {
  constructor(count){this.count=count;this.tracks=[];this.next=0;this.frame=0;}
  update(blobs,time) {
    this.frame++;
    this.tracks=this.tracks.filter(t=>time-t.time<150);
    const candidates=[];
    for(const t of this.tracks) {
      const dt=Math.min(80,time-t.time), px=t.x+t.vx*dt,py=t.y+t.vy*dt;
      const nearby=blobs.map((b,i)=>({i,d:Math.hypot(b.x-px,b.y-py)})).filter(o=>o.d<Math.min(40,10+dt*.3)).sort((a,b)=>a.d-b.d);
      if(!nearby.length)continue;
      // End an ambiguous track. Earlier checksum-confirmed observations survive.
      if(nearby[1]&&nearby[1].d<nearby[0].d*1.8+3){t.invalid=true;continue;}
      candidates.push({t,...nearby[0]});
    }
    const used=new Set();
    candidates.sort((a,b)=>a.d-b.d);
    for(const {t,i} of candidates) {
      if(used.has(i)){t.invalid=true;continue;}
      used.add(i);
      const b=blobs[i],dt=Math.max(1,time-t.time);
      t.vx=.6*t.vx+.4*(b.x-t.x)/dt;t.vy=.6*t.vy+.4*(b.y-t.y)/dt;
      Object.assign(t,{x:b.x,y:b.y,time,visible:this.frame});
      const id=t.decoder.push(time,b.color);
      if(id!==null){
        if(t.id!==null&&t.id!==id)t.invalid=true;
        else {t.id=id;t.confirmedThrough=time;}
      }
    }
    for(let i=0;i<blobs.length;i++)if(!used.has(i)) {
      const b=blobs[i],t={key:this.next++,x:b.x,y:b.y,time,vx:0,vy:0,id:null,confirmedThrough:-Infinity,invalid:false,visible:this.frame,decoder:new IdentityDecoder(this.count)};
      t.decoder.push(time,b.color);this.tracks.push(t);
    }
    this.tracks=this.tracks.filter(t=>!t.invalid);
    return this.tracks.filter(t=>t.visible===this.frame);
  }
}
export class CaptureSession {
  constructor(count,width,height){this.count=count;this.width=width;this.height=height;this.tracker=new Tracker(count);this.frames=[];this.lastKeyframe=-Infinity;}
  push(blobs,time) {
    const tracks=this.tracker.update(blobs,time);
    if(time-this.lastKeyframe>=450&&tracks.length>=8&&this.frames.length<180) {
      this.frames.push({time:time/1000,observations:tracks.map(t=>({track:t,time,x:t.x,y:t.y}))});this.lastKeyframe=time;
    }
    return tracks;
  }
  export() {
    return {version:1,count:this.count,width:this.width,height:this.height,frames:this.frames.map(f=>{
      // Identity remains trustworthy only through the last verified codeword.
      // In particular, a later crossing must not erase that verified prefix or
      // backfill its identity into an unverified tail belonging to another LED.
      const observations=f.observations.filter(o=>o.track.id!==null&&o.time<=o.track.confirmedThrough), counts=new Map();
      for(const o of observations)counts.set(o.track.id,(counts.get(o.track.id)||0)+1);
      return {time:f.time,observations:observations.filter(o=>counts.get(o.track.id)===1).map(o=>({id:o.track.id,x:o.x,y:o.y}))};
    }).filter(f=>f.observations.length>=8)};
  }
}
