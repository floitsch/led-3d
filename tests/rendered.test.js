import test from 'node:test';
import assert from 'node:assert/strict';
import {CaptureSession,detectBlobs} from '../web/lib/vision.js';
import {patternColor} from '../web/lib/protocol.js';
import {project,reconstruct} from '../web/lib/reconstruction.js';
import {lookAt} from '../web/lib/synthetic.js';
import {norm,sub} from '../web/lib/math.js';
test('pixels → temporal IDs → 3D on a continuously moving, shaky camera',()=>{
  const width=480,height=360,count=30,focal=500,session=new CaptureSession(count,width,height);
  const points=Array.from({length:count},(_,id)=>[(id%6-2.5)*.25,(Math.floor(id/6)-2)*.3,.32*Math.sin(id*1.7)]);
  for(let frame=0;frame<420;frame++){
    if(frame%19===0)continue;
    const time=frame/30,angle=-.45+time*.065+.003*Math.sin(time*23),camera=lookAt([3*Math.sin(angle),.03*Math.sin(time*19),-3*Math.cos(angle)]);
    const image=new Uint8ClampedArray(width*height*4);
    points.forEach((p,id)=>{
      const [xf,yf]=project(camera,p,{f:focal,cx:width/2,cy:height/2});const x=Math.round(xf),y=Math.round(yf),color=patternColor(id,time*1000+19,160);
      for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){
        if(dx*dx+dy*dy>5||x+dx<0||x+dx>=width||y+dy<0||y+dy>=height)continue;
        image.set([...color,255],((y+dy)*width+x+dx)*4);
      }
    });
    session.push(detectBlobs(image,width,height),time*1000);
  }
  const capture=session.export();capture.focal=focal;
  assert.ok(capture.frames.length>=15,'Temporal decoder must supply overlapping keyframes');
  const result=reconstruct(capture),measured=result.leds.filter(l=>l.position);
  assert.ok(measured.length>=27,`Only ${measured.length}/${count} reconstructed`);
  const pairs=[];
  for(let i=0;i<measured.length;i++)for(let j=i+1;j<measured.length;j++)pairs.push([norm(sub(measured[i].position,measured[j].position)),norm(sub(points[measured[i].id],points[measured[j].id]))]);
  const factor=pairs.reduce((s,[a,b])=>s+a*b,0)/pairs.reduce((s,[a])=>s+a*a,0);
  const error=Math.sqrt(pairs.reduce((s,[a,b])=>s+(a*factor-b)**2,0)/pairs.reduce((s,[,b])=>s+b*b,0));
  assert.ok(error<.05,`Relative shape error ${(error*100).toFixed(2)}%`);
});
