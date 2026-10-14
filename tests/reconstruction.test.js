import test from 'node:test';
import assert from 'node:assert/strict';
import {eigenSymmetric,mv,sub,norm,mm,transpose,svd3} from '../web/lib/math.js';
import {reconstruct,fillShortGaps,validateCapture} from '../web/lib/reconstruction.js';
import {syntheticCapture,treePoints} from '../web/lib/synthetic.js';
test('Jacobi eigenvectors and SVD reconstruct a non-symmetric matrix',()=>{
  const a=[[3,1,2],[1,4,-1],[2,-1,5]], e=eigenSymmetric(a);
  for(let j=0;j<3;j++){const v=e.vectors.map(r=>r[j]);assert.ok(norm(sub(mv(a,v),v.map(x=>x*e.values[j])))<1e-8);}
  const b=[[2,1,4],[-1,3,2],[0,1,5]],{u,s,v}=svd3(b), got=mm(mm(u,s.map((x,i)=>s.map((_,j)=>i===j?x:0))),transpose(v));
  assert.ok(norm(sub(got.flat(),b.flat()))<1e-8);
});
function relativeShapeError(result,truth) {
  const distances=[];
  for(let i=0;i<result.leds.length;i++)for(let j=i+1;j<result.leds.length;j++){
    const a=result.leds[i].position,b=result.leds[j].position;if(!a||!b)continue;
    distances.push([norm(sub(a,b)),norm(sub(truth[i],truth[j]))]);
  }
  const factor=distances.reduce((s,[a,b])=>s+a*b,0)/distances.reduce((s,[a])=>s+a*a,0);
  return Math.sqrt(distances.reduce((s,[a,b])=>s+(a*factor-b)**2,0)/distances.reduce((s,[,b])=>s+b*b,0));
}
test('moving camera reconstructs noisy, occluded LEDs with outliers',()=>{
  const capture=syntheticCapture({count:60,views:10,noise:.6,outliers:.06,missing:.2});
  const result=reconstruct(capture);
  assert.ok(result.leds.filter(o=>o.position).length>=55);
  assert.ok(result.medianError<1.5);
  assert.ok(relativeShapeError(result,treePoints(60))<.04);
});
test('unknown object scale and approximate camera lens recover shape',()=>{
  const capture=syntheticCapture({count:45,views:8,focal:850,noise:.2});delete capture.focal;
  const result=reconstruct(capture);
  assert.ok(relativeShapeError(result,treePoints(45))<.1);
});
test('stationary camera is rejected instead of inventing depth',()=>{
  assert.throws(()=>reconstruct(syntheticCapture({count:30,views:4,arc:0,noise:0})),/view|Depth/);
});
test('chain estimates preserve measured positions and do not extrapolate ends',()=>{
  const map={leds:[null,[0,0,0],null,null,[3,0,0],null].map((p,id)=>({id,position:p,status:p?'measured':'missing'}))};
  const result=fillShortGaps(map);
  assert.equal(result.leds[0].position,null);assert.equal(result.leds[5].position,null);
  assert.deepEqual(result.leds[2].position,[1,0,0]);assert.equal(result.leds[2].status,'estimated');assert.equal(map.leds[2].position,null);
});
test('capture imports reject duplicate IDs and non-finite coordinates',()=>{
  const capture=syntheticCapture();capture.frames[0].observations[1].id=0;
  assert.throws(()=>validateCapture(capture),/duplicate/);
  const invalidLens=syntheticCapture();invalidLens.focal=-500;
  assert.throws(()=>validateCapture(invalidLens),/focal/);
});
