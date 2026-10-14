// Copyright (C) 2026 Toit contributors.
// Evaluated inside the browser test page. Only the camera input is replaced;
// video playback, frame callbacks, capture workers, and reconstruction are real.
async () => {
  const {lookAt}=await import('./lib/synthetic.js');
  const {project}=await import('./lib/reconstruction.js');
  const {patternColor}=await import('./lib/protocol.js');
  const width=480,height=360,focal=500,count=30;
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  // Real camera frames are opaque. Transparent canvas frames would accumulate
  // old LED positions when composited into the application's sampling canvas.
  const context=canvas.getContext('2d',{alpha:false});
  const points=Array.from({length:count},(_,id)=>[(id%6-2.5)*.25,(Math.floor(id/6)-2)*.3,.32*Math.sin(id*1.7)]);
  const original=navigator.mediaDevices.getUserMedia;
  const fixture={points,elapsed:0,stream:null,restore(){
    cancelAnimationFrame(handle);
    fixture.stream?.getTracks().forEach(t=>t.stop());
    navigator.mediaDevices.getUserMedia=original;
  }};
  let handle,start;
  function render(now){
    const time=(now-start)/1000;fixture.elapsed=time;
    const angle=-.45+time*.065+.003*Math.sin(time*23);
    const camera=lookAt([3*Math.sin(angle),.03*Math.sin(time*19),-3*Math.cos(angle)]);
    const image=context.createImageData(width,height);
    for(let i=3;i<image.data.length;i+=4)image.data[i]=255;
    points.forEach((point,id)=>{
      const [xf,yf]=project(camera,point,{f:focal,cx:width/2,cy:height/2});
      const x=Math.round(xf),y=Math.round(yf),color=patternColor(id,time*1000+19,160);
      for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){
        if(dx*dx+dy*dy>5||x+dx<0||x+dx>=width||y+dy<0||y+dy>=height)continue;
        image.data.set([...color,255],((y+dy)*width+x+dx)*4);
      }
    });
    context.putImageData(image,0,0);
    handle=requestAnimationFrame(render);
  }
  navigator.mediaDevices.getUserMedia=async()=>{
    start=performance.now();render(start);
    fixture.stream=canvas.captureStream(30);
    return fixture.stream;
  };
  window.cameraFixture=fixture;
}
