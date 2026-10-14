import test from 'node:test';
import assert from 'node:assert/strict';
import {patternColor,IdentityDecoder,classifyColor} from '../web/lib/protocol.js';
import {detectBlobs,CaptureSession} from '../web/lib/vision.js';
test('identities decode at 30 fps with arbitrary clock phase and dropped frames',()=>{
  for(const id of [0,1,99,1023,4095]) {
    const decoder=new IdentityDecoder(4096),found=[];
    for(let i=0;i<420;i++) {if(i%13===0)continue;const t=i*1000/30+17;const value=decoder.push(t,classifyColor(...patternColor(id,t)));if(value!==null)found.push(value);}
    assert.ok(found.length>=2,`No identity for ${id}`);assert.ok(found.every(x=>x===id));
  }
});
test('wrong bit fails checksum',()=>{
  const decoder=new IdentityDecoder(100),found=[];
  for(let i=0;i<69;i++){const t=i*1000/30+13;let c=classifyColor(...patternColor(42,t));if(t>400&&t<500)c=1-c;const v=decoder.push(t,c);if(v!==null)found.push(v);}
  assert.deepEqual(found,[]);
});
test('rendered moving LEDs are detected, tracked and labeled retrospectively',()=>{
  const width=320,height=240,session=new CaptureSession(12,width,height);
  for(let frame=0;frame<150;frame++) {
    const t=frame*1000/30+11,rgba=new Uint8ClampedArray(width*height*4);
    for(let id=0;id<12;id++) {
      const x=40+(id%4)*60+Math.round(8*Math.sin(t/700)), y=40+Math.floor(id/4)*65+Math.round(5*Math.sin(t/500));
      const c=patternColor(id,t,180);
      for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){if(dx*dx+dy*dy>5)continue;const p=((y+dy)*width+x+dx)*4;rgba.set([...c,255],p);}
    }
    session.push(detectBlobs(rgba,width,height),t);
  }
  const result=session.export();assert.ok(result.frames.length>=8);
  assert.ok(result.frames.every(f=>f.observations.length===12));
  assert.equal(new Set(result.frames[0].observations.map(o=>o.id)).size,12);
});

function identifiedScene(session,until=2600){
  for(let time=10;time<until;time+=1000/30){
    const blobs=Array.from({length:12},(_,id)=>({x:30+(id%4)*65,y:30+Math.floor(id/4)*65,color:classifyColor(...patternColor(id,time,160))}));
    session.push(blobs,time);
  }
}
test('a later ambiguous crossing preserves previously verified keyframes',()=>{
  const session=new CaptureSession(12,320,240);
  identifiedScene(session);
  const before=session.export();assert.ok(before.frames.length>=4);
  const crossing=Array.from({length:12},(_,id)=>[
    {x:29+(id%4)*65,y:30+Math.floor(id/4)*65,color:0},
    {x:31+(id%4)*65,y:30+Math.floor(id/4)*65,color:1}
  ]).flat();
  session.push(crossing,2610);
  const after=session.export();assert.deepEqual(after,before);
});
test('identity changes do not relabel the verified prefix or export the uncertain tail',()=>{
  const session=new CaptureSession(12,320,240);
  for(let time=10;time<4700;time+=1000/30){
    session.push(Array.from({length:12},(_,id)=>({x:30+(id%4)*65,y:30+Math.floor(id/4)*65,color:classifyColor(...patternColor(time<2300?id:(id+1)%12,time,160))})),time);
  }
  const capture=session.export();assert.ok(capture.frames.length>=4);
  assert.ok(capture.frames.every(frame=>frame.time<2.3));
  for(const frame of capture.frames)for(const o of frame.observations)assert.equal(o.x,30+(o.id%4)*65);
});
