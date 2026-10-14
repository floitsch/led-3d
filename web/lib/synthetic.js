// Copyright (C) 2026 Toit contributors.
// MIT license; see LICENSE.
import {unit,cross,dot,sub,random} from './math.js';
import {project} from './reconstruction.js';
export function lookAt(eye,target=[0,0,0]) {
  const z=unit(sub(target,eye)), x=unit(cross([0,1,0],z)), y=cross(z,x), r=[x,y,z];
  return {r,t:r.map(row=>-dot(row,eye))};
}
export function treePoints(count=100) {
  return Array.from({length:count},(_,i)=>{const t=i/(count-1), a=t*Math.PI*14, radius=.15+.65*(1-t); return [radius*Math.cos(a),1.8*t-.9,radius*Math.sin(a)];});
}
export function syntheticCapture({count=100,views=12,noise=.3,outliers=0,missing=0,arc=1.5,focal=720,seed=42}={}) {
  const rng=random(seed), points=treePoints(count), width=960,height=720;
  const k={f:focal,cx:width/2,cy:height/2};
  const frames=Array.from({length:views},(_,i)=>{
    const angle=-arc/2+arc*i/(views-1), camera=lookAt([3*Math.sin(angle),.2*Math.sin(angle*3),-3*Math.cos(angle)]);
    const observations=[];
    points.forEach((point,id)=>{
      if(rng()<missing)return;
      let [x,y,z]=project(camera,point,k);
      x+=(rng()-.5)*noise*2;y+=(rng()-.5)*noise*2;
      if(rng()<outliers){x=rng()*width;y=rng()*height;}
      if(z>0 && x>=0&&y>=0&&x<width&&y<height)observations.push({id,x,y});
    });
    return {time:i*.5,observations};
  });
  return {version:1,count,width,height,focal,frames};
}
