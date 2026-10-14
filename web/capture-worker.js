import {detectBlobs,CaptureSession} from './lib/vision.js';
let session;
self.onmessage=({data})=>{
  try {
    if(data.type==='start'){session=new CaptureSession(data.count,data.width,data.height);return;}
    if(data.type==='finish'){self.postMessage({type:'capture',capture:session.export()});return;}
    if(data.type==='frame'){
      const blobs=detectBlobs(new Uint8ClampedArray(data.buffer),session.width,session.height,{threshold:data.threshold});
      const tracks=session.push(blobs,data.time);
      self.postMessage({type:'frame',tracks:tracks.map(t=>({x:t.x,y:t.y,id:t.id})),frames:session.frames.length});
    }
  }catch(e){self.postMessage({type:'error',message:e.message});}
};
