// Copyright (C) 2026 Toit contributors.
// MIT license; see LICENSE.
import {dot,norm,add,sub,scale,unit,cross,eye,transpose,mv,mm,det3,median,nullVector,svd3,rodrigues,rotationVector,optimize,random,sample} from './math.js';

export function project(camera, point, intrinsics) {
  const q=add(mv(camera.r,point),camera.t), x=q[0]/q[2], y=q[1]/q[2];
  const d=1+(intrinsics.k1||0)*(x*x+y*y);
  return [intrinsics.f*x*d+intrinsics.cx,intrinsics.f*y*d+intrinsics.cy,q[2]];
}
function ray(p,k) {
  let x=(p.x-k.cx)/k.f, y=(p.y-k.cy)/k.f;
  const xd=x, yd=y;
  for(let i=0;i<5;i++) {const d=1+(k.k1||0)*(x*x+y*y); x=xd/d; y=yd/d;}
  return [x,y,1];
}
export function triangulate(observations, cameras, k) {
  const rows=[];
  for(const o of observations) {
    const c=cameras.get(o.frame); if(!c) continue;
    const p=c.r.map((r,i)=>[...r,c.t[i]]), [x,y]=ray(o,k);
    rows.push(p[2].map((v,i)=>x*v-p[0][i]),p[2].map((v,i)=>y*v-p[1][i]));
  }
  if(rows.length<4) return null;
  const h=nullVector(rows); if(Math.abs(h[3])<1e-10) return null;
  const p=scale(h.slice(0,3),1/h[3]);
  return p.every(Number.isFinite)?p:null;
}
function essential(pairs,k) {
  const rows=pairs.map(([a,b])=>{const [x,y]=ray(a,k),[u,v]=ray(b,k); return [u*x,u*y,u,v*x,v*y,v,x,y,1];});
  const h=nullVector(rows), e=[h.slice(0,3),h.slice(3,6),h.slice(6,9)];
  const {u,s,v}=svd3(e), d=(s[0]+s[1])/2;
  return mm(mm(u,[[d,0,0],[0,d,0],[0,0,0]]),transpose(v));
}
function epipolar(e,pair,k) {
  const a=ray(pair[0],k), b=ray(pair[1],k), ea=mv(e,a), eb=mv(transpose(e),b);
  return Math.abs(dot(b,ea))*k.f/Math.sqrt(ea[0]**2+ea[1]**2+eb[0]**2+eb[1]**2+1e-20);
}
function relativePose(pairs,k,rng) {
  let best=[];
  for(let i=0;i<250;i++) {
    const e=essential(sample(pairs,8,rng),k), inliers=pairs.filter(p=>epipolar(e,p,k)<2);
    if(inliers.length>best.length) best=inliers;
    if(best.length>pairs.length*.95 && i>25) break;
  }
  if(best.length<10) return null;
  const e=essential(best,k), {u,v}=svd3(e);
  if(det3(u)<0) for(const row of u) row[2]*=-1;
  if(det3(v)<0) for(const row of v) row[2]*=-1;
  const w=[[0,-1,0],[1,0,0],[0,0,1]], first={r:eye(3),t:[0,0,0]};
  let result=null;
  for(const w0 of [w,transpose(w)]) for(const sign of [-1,1]) {
    const c={r:mm(mm(u,w0),transpose(v)),t:scale(u.map(r=>r[2]),sign)};
    const cameras=new Map([[0,first],[1,c]]), good=[], angles=[];
    for(const [a,b] of best) {
      const p=triangulate([{...a,frame:0},{...b,frame:1}],cameras,k);
      if(!p || p[2]<=0 || project(c,p,k)[2]<=0) continue;
      const ca=unit(p), cb=unit(mv(transpose(c.r),ray(b,k)));
      const angle=Math.acos(Math.max(-1,Math.min(1,dot(ca,cb))));
      if(angle<.008) continue;
      if(Math.hypot(...sub(project(first,p,k).slice(0,2),[a.x,a.y]))>4 || Math.hypot(...sub(project(c,p,k).slice(0,2),[b.x,b.y]))>4) continue;
      good.push([a.id,p]); angles.push(angle);
    }
    if(!result || good.length>result.points.length) result={camera:c,points:good,angle:median(angles)};
  }
  return result && result.points.length>=10 && result.angle>.015 ? result:null;
}
function cameraVector(c) { return [...rotationVector(c.r),...c.t]; }
function vectorCamera(v) { return {r:rodrigues(v.slice(0,3)),t:v.slice(3,6)}; }
function fitCamera(observations,points,k,initial) {
  return vectorCamera(optimize(cameraVector(initial),v=>{
    const c=vectorCamera(v);
    return observations.flatMap(o=>{
      const q=project(c,points.get(o.id),k);
      return q[2]<=0?[1000,1000]:[q[0]-o.x,q[1]-o.y];
    });
  },25));
}
function pnpDLT(obs,points,k) {
  const rows=[];
  for(const o of obs) {
    const p=[...points.get(o.id),1], [x,y]=ray(o,k);
    rows.push([...p,0,0,0,0,...scale(p,-x)],[0,0,0,0,...p,...scale(p,-y)]);
  }
  const h=nullVector(rows), a=[h.slice(0,3),h.slice(4,7),h.slice(8,11)];
  const sign=det3(a)<0?-1:1, b=a.map(r=>scale(r,sign)), {u,s,v}=svd3(b);
  const r=mm(u,transpose(v));
  if(det3(r)<0) return null;
  return {r,t:scale([h[3],h[7],h[11]],sign/((s[0]+s[1]+s[2])/3))};
}
function cameraInliers(c,obs,points,k,threshold=4) {
  return obs.filter(o=>{const q=project(c,points.get(o.id),k);return q[2]>0 && Math.hypot(q[0]-o.x,q[1]-o.y)<threshold;});
}
function locateCamera(obs,points,k,rng,near) {
  const common=obs.filter(o=>points.has(o.id)); if(common.length<8) return null;
  let best=null, inliers=[];
  // A nearby view also handles approximately planar point sets, where DLT is degenerate.
  if(near) {best=fitCamera(common,points,k,near);inliers=cameraInliers(best,common,points,k);}
  for(let i=0;i<120;i++) {
    const c=pnpDLT(sample(common,6,rng),points,k); if(!c) continue;
    const good=cameraInliers(c,common,points,k);
    if(good.length>inliers.length) {best=c;inliers=good;}
    if(inliers.length>common.length*.9 && i>15) break;
  }
  if(inliers.length<8 || inliers.length<common.length*.45) return null;
  best=fitCamera(inliers,points,k,best);
  return cameraInliers(best,common,points,k).length>=8?best:null;
}
function pointError(p,obs,cameras,k) {
  return obs.map(o=>{const c=cameras.get(o.frame);if(!c)return Infinity;const q=project(c,p,k);return q[2]>0?Math.hypot(q[0]-o.x,q[1]-o.y):Infinity;});
}
function parallax(p,obs,cameras) {
  const rays=obs.map(o=>{const c=cameras.get(o.frame),center=scale(mv(transpose(c.r),c.t),-1);return unit(sub(p,center));});
  let angle=0;
  for(let i=0;i<rays.length;i++) for(let j=i+1;j<rays.length;j++) angle=Math.max(angle,Math.acos(Math.max(-1,Math.min(1,dot(rays[i],rays[j])))));
  return angle;
}
function updatePoints(byId,cameras,points,k,rng) {
  for(const [id,all] of byId) {
    const obs=all.filter(o=>cameras.has(o.frame)); if(obs.length<2) continue;
    let best=points.get(id), good=best?obs.filter((o,i)=>pointError(best,[o],cameras,k)[0]<4):[];
    for(let i=0;i<Math.min(30,obs.length*3);i++) {
      const p=triangulate(sample(obs,2,rng),cameras,k);if(!p)continue;
      const errors=pointError(p,obs,cameras,k), keep=obs.filter((_,i)=>errors[i]<4);
      if(keep.length>good.length) {best=p;good=keep;}
    }
    if(good.length<2 || parallax(best,good,cameras)<.015) continue;
    best=optimize(best,p=>good.flatMap(o=>{const q=project(cameras.get(o.frame),p,k);return [q[0]-o.x,q[1]-o.y];}),12);
    points.set(id,best);
  }
}
function initialize(frames,k,rng,onProgress) {
  let best=null;
  // Distributed view pairs avoid initializing on two nearly identical frames.
  const indices=[...new Set(Array.from({length:Math.min(8,frames.length)},(_,i)=>Math.round(i*(frames.length-1)/Math.max(1,Math.min(8,frames.length)-1))))];
  for(let a=0;a<indices.length;a++) for(let b=a+1;b<indices.length;b++) {
    onProgress?.(`Finding starting viewpoints: pair ${a*(2*indices.length-a-1)/2+b-a} of ${indices.length*(indices.length-1)/2}`);
    const i=indices[a], j=indices[b], lookup=new Map(frames[j].observations.map(o=>[o.id,o]));
    const pairs=frames[i].observations.filter(o=>lookup.has(o.id)).map(o=>[o,lookup.get(o.id)]);
    if(pairs.length<12) continue;
    const pose=relativePose(pairs,k,rng); if(!pose)continue;
    const score=pose.points.length*Math.min(pose.angle,.35);
    if(!best || score>best.score) best={...pose,i,j,score};
  }
  return best;
}
function reconstructAtFocal(frames,byId,k,onProgress) {
  const rng=random(), init=initialize(frames,k,rng,onProgress);
  if(!init) throw new Error('Not enough shared LEDs or viewpoint separation. Walk around the object and capture again.');
  const cameras=new Map([[init.i,{r:eye(3),t:[0,0,0]}],[init.j,init.camera]]), points=new Map(init.points);
  for(let pass=0;pass<frames.length;pass++) {
    let added=0;
    for(let i=0;i<frames.length;i++) if(!cameras.has(i)) {
      onProgress?.(`Registering view ${i+1}/${frames.length} · ${cameras.size} registered`);
      const nearest=[...cameras.keys()].sort((a,b)=>Math.abs(a-i)-Math.abs(b-i))[0];
      const c=locateCamera(frames[i].observations,points,k,rng,cameras.get(nearest));
      if(c) {cameras.set(i,c);added++;}
    }
    updatePoints(byId,cameras,points,k,rng);
    onProgress?.(`Registered ${cameras.size}/${frames.length} views; ${points.size} LEDs`);
    if(!added) break;
  }
  if(cameras.size<3) throw new Error('Need at least three overlapping viewpoints to verify depth. Keep walking around the lights.');
  // Alternating robust bundle adjustment. The anchor camera fixes orientation/translation.
  for(let iteration=0;iteration<8;iteration++) {
    onProgress?.(`Refining LED positions: pass ${iteration+1}/8 · ${points.size} LEDs`);
    for(const [i,c] of cameras) if(i!==init.i) {
      const obs=frames[i].observations.filter(o=>points.has(o.id));
      const inliers=cameraInliers(c,obs,points,k,6);
      if(inliers.length>=8) cameras.set(i,fitCamera(inliers,points,k,c));
    }
    updatePoints(byId,cameras,points,k,rng);
  }
  const errors=[];
  for(const [id,p] of points) errors.push(...pointError(p,byId.get(id).filter(o=>cameras.has(o.frame)),cameras,k).filter(e=>e<6));
  return {points,cameras,k,anchor:init.i,error:median(errors),byId};
}
export function validateCapture(capture) {
  if(!capture || capture.version!==1 || !Number.isInteger(capture.count) || capture.count<1 || capture.count>4096) throw new Error('Invalid capture LED count/version.');
  if(!Number.isInteger(capture.width)||!Number.isInteger(capture.height)||capture.width<32||capture.height<32||capture.width>8192||capture.height>8192) throw new Error('Invalid image size.');
  if(capture.focal!==undefined&&(!Number.isFinite(capture.focal)||capture.focal<=0||capture.focal>100000))throw new Error('Invalid camera focal length.');
  if(!Array.isArray(capture.frames)||capture.frames.length>300) throw new Error('Capture needs 3–300 usable views.');
  if(capture.frames.length<3)throw new Error(`Only ${capture.frames.length} usable views with identified LEDs. At least 3 are needed. Capture longer with overlapping LEDs; reduce glare or move more slowly.`);
  for(const frame of capture.frames) {
    if(!Array.isArray(frame.observations)||frame.observations.length>capture.count)throw new Error('Invalid observations.');
    const ids=new Set();
    for(const o of frame.observations) {
      if(!Number.isInteger(o.id)||o.id<0||o.id>=capture.count||ids.has(o.id)||!Number.isFinite(o.x)||!Number.isFinite(o.y)||o.x<0||o.y<0||o.x>=capture.width||o.y>=capture.height)throw new Error('Invalid or duplicate LED observation.');
      ids.add(o.id);
    }
  }
}
export function reconstruct(capture,onProgress) {
  validateCapture(capture);
  const frames=capture.frames.filter(f=>f.observations.length>=8);
  if(frames.length<3)throw new Error('Not enough identified LEDs. Capture longer, reduce glare, and keep the lights in view.');
  const byId=new Map();
  frames.forEach((f,i)=>f.observations.forEach(o=>{if(!byId.has(o.id))byId.set(o.id,[]);byId.get(o.id).push({...o,frame:i});}));
  const base=Math.max(capture.width,capture.height);
  const focals=capture.focal?[capture.focal]:[.65,.9,1.2].map(x=>x*base);
  let best=null, failure;
  for(const [candidate,f] of focals.entries()) {
    const progress=message=>onProgress?.(`Camera model ${candidate+1}/${focals.length} · ${message}`);
    progress(`Solving camera geometry (focal ${Math.round(f)} px)…`);
    try {
      const result=reconstructAtFocal(frames,byId,{f,cx:capture.width/2,cy:capture.height/2,k1:0},progress);
      const score=result.error+2*(1-result.cameras.size/frames.length)+2*(1-result.points.size/byId.size);
      if(!best||score<best.score)best={...result,score};
    } catch(e) {failure=e;}
  }
  if(!best)throw failure;
  // Joint focal/distortion refinement is bounded to avoid unconstrained lens solutions.
  if(!capture.focal) for(let iter=0;iter<5;iter++) {
    onProgress?.(`Refining camera lens: pass ${iter+1}/5`);
    const observations=[];
    for(const [id,p] of best.points) for(const o of byId.get(id)) if(best.cameras.has(o.frame) && pointError(p,[o],best.cameras,best.k)[0]<4) observations.push([o,p]);
    const lens=optimize([Math.log(best.k.f),best.k.k1],v=>{
      const f=Math.exp(v[0]),k1=v[1], k={...best.k,f,k1};
      return [...observations.flatMap(([o,p])=>{const q=project(best.cameras.get(o.frame),p,k);return [q[0]-o.x,q[1]-o.y];}),Math.max(0,.4*base-f)*10,Math.max(0,f-2*base)*10,Math.max(0,Math.abs(k1)-.35)*100];
    },12);
    best.k.f=Math.exp(lens[0]);best.k.k1=lens[1];
    for(const [i,c] of best.cameras)if(i!==best.anchor){const obs=frames[i].observations.filter(o=>best.points.has(o.id));best.cameras.set(i,fitCamera(cameraInliers(c,obs,best.points,best.k,5),best.points,best.k,c));}
    updatePoints(byId,best.cameras,best.points,best.k,random());
  }
  const leds=Array.from({length:capture.count},(_,id)=>({id,position:null,status:'missing',views:0,error:null}));
  for(const [id,p] of best.points) {
    const obs=byId.get(id).filter(o=>best.cameras.has(o.frame));
    const errors=pointError(p,obs,best.cameras,best.k), good=obs.filter((_,i)=>errors[i]<4);
    if(good.length<3||parallax(p,good,best.cameras)<.025)continue;
    leds[id]={id,position:p,status:'measured',views:good.length,error:median(errors.filter(e=>e<4))};
  }
  const measured=leds.filter(o=>o.position);
  if(measured.length<10)throw new Error('Depth remains uncertain. Capture more separated views with overlapping LEDs.');
  const center=[0,1,2].map(i=>median(measured.map(o=>o.position[i])));
  const radius=Math.max(...measured.map(o=>norm(sub(o.position,center))));
  for(const led of measured)led.position=scale(sub(led.position,center),1/radius);
  return {version:1,count:capture.count,leds,intrinsics:best.k,registeredViews:best.cameras.size,totalViews:frames.length,medianError:median(measured.map(o=>o.error)),units:'normalized',orientation:[0,0,0],warnings:capture.focal?[]:['Lens parameters estimated from video. Check the shape before saving.']};
}

// Optional chain interpolation is explicitly an estimate, never a measured point.
export function fillShortGaps(map,maxGap=3) {
  const result=structuredClone(map);
  for(let i=0;i<result.leds.length;i++) {
    if(result.leds[i].position)continue;
    const start=i;while(i<result.leds.length&&!result.leds[i].position)i++;
    if(start===0||i===result.leds.length||i-start>maxGap)continue;
    const a=result.leds[start-1].position,b=result.leds[i].position;
    for(let j=start;j<i;j++)result.leds[j]={...result.leds[j],position:add(a,scale(sub(b,a),(j-start+1)/(i-start+1))),status:'estimated'};
  }
  return result;
}
