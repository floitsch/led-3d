// Copyright (C) 2026 Toit contributors.
import {mm,mv,rodrigues} from './math.js';
import {effectColor} from './effects.js';
export function orient(p,angles){return mv(mm(mm(rodrigues([0,0,angles[2]]),rodrigues([0,angles[1],0])),rodrigues([angles[0],0,0])),p);}
export class Viewer {
  constructor(canvas){
    this.canvas=canvas;this.map=null;this.yaw=.35;this.pitch=-.15;this.angles=[0,0,0];this.effect='rainbow';this.speed=1;this.brightness=.7;this.showChain=true;
    let last,pointer;
    canvas.addEventListener('pointerdown',e=>{if(last)return;pointer=e.pointerId;last=[e.clientX,e.clientY];canvas.setPointerCapture(pointer);});
    canvas.addEventListener('pointermove',e=>{if(last&&e.pointerId===pointer){this.rotateView((e.clientX-last[0])*.01,(e.clientY-last[1])*.01);last=[e.clientX,e.clientY];}});
    const stop=e=>{if(e.pointerId===pointer)last=null;};canvas.addEventListener('pointerup',stop);canvas.addEventListener('pointercancel',stop);canvas.addEventListener('lostpointercapture',stop);
    const draw=time=>{this.draw(time/1000);requestAnimationFrame(draw);};requestAnimationFrame(draw);
  }
  resetView(){this.yaw=.35;this.pitch=-.15;}
  rotateView(yaw,pitch){this.yaw+=yaw;this.pitch+=pitch;}
  draw(time){
    const canvas=this.canvas,rect=canvas.getBoundingClientRect(),ratio=Math.min(devicePixelRatio||1,2);
    const w=Math.round(rect.width*ratio),h=Math.round(rect.height*ratio);if(!w||!h)return;
    if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}
    const ctx=canvas.getContext('2d');ctx.clearRect(0,0,w,h);
    ctx.strokeStyle='#273447';ctx.lineWidth=ratio;
    for(let i=-4;i<=4;i++){ctx.beginPath();ctx.moveTo(w*.1,h*.8+i*8*ratio);ctx.lineTo(w*.9,h*.8+i*8*ratio);ctx.stroke();}
    if(!this.map){ctx.fillStyle='#9ba9ba';ctx.textAlign='center';ctx.font=`${14*ratio}px system-ui`;ctx.fillText('Your lights, in three dimensions',w/2,h/2);return;}
    const points=this.map.leds.map(led=>{
      if(!led.position)return null;
      const world=orient(led.position,this.angles),view=orient(world,[this.pitch,this.yaw,0]),f=2.8/(3.8-view[2]),size=Math.min(w,h)*.43;
      return {led,world,x:w/2+view[0]*size*f,y:h/2-view[1]*size*f,z:view[2],f};
    });
    if(this.showChain){ctx.strokeStyle='#34495c';ctx.beginPath();let previous=null;for(const p of points){if(!p){previous=null;continue;}if(previous)ctx.lineTo(p.x,p.y);else ctx.moveTo(p.x,p.y);previous=p;}ctx.stroke();}
    for(const p of points.filter(Boolean).sort((a,b)=>a.z-b.z)){
      const color=p.led.status==='estimated'?[255,179,71]:effectColor(this.effect,p.world,time,this.speed,this.brightness),rgb=`rgb(${color.join(',')})`;
      ctx.beginPath();ctx.arc(p.x,p.y,Math.max(2,4*p.f)*ratio,0,Math.PI*2);ctx.fillStyle=rgb;ctx.shadowColor=rgb;ctx.shadowBlur=10*ratio;ctx.fill();ctx.shadowBlur=0;
      if(p.led.status==='estimated'){ctx.strokeStyle='#ffcf80';ctx.stroke();}
    }
  }
}
