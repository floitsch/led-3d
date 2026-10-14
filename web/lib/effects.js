// Copyright (C) 2026 Toit contributors.
export function effectColor(name,p,time,speed=1,brightness=.3) {
  const t=time*speed,[x,y,z]=p;let c;
  if(name==='off')return [0,0,0];
  if(name==='rings') {const phase=((y-t*.6)%2+2)%2, glow=Math.exp(-(((phase-1)/.13)**2));c=[.1*glow,.7*glow,glow];}
  else if(name==='swipe') {const glow=Math.max(0,1-Math.abs(x-Math.sin(t))/.35);c=[glow,.25*glow,.6*glow];}
  else if(name==='fire') {const flicker=.5+.25*Math.sin(x*13+z*9+t*5)+.25*Math.sin(z*17-x*7-t*3),heat=Math.max(0,Math.min(1,(1-y)*.55+flicker*.5));c=[heat,heat**3*.6,heat**8*.1];}
  else c=[.5+.5*Math.sin(t+x*3),.5+.5*Math.sin(t+y*3+2.1),.5+.5*Math.sin(t+z*3+4.2)];
  return c.map(v=>Math.round(v*255*brightness));
}
