// Copyright (C) 2026 Toit contributors.
// MIT license; see LICENSE.
export const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
export const norm = a => Math.sqrt(dot(a, a));
export const add = (a, b) => a.map((x, i) => x + b[i]);
export const sub = (a, b) => a.map((x, i) => x - b[i]);
export const scale = (a, s) => a.map(x => x * s);
export const unit = a => scale(a, 1 / Math.max(norm(a), 1e-15));
export const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
export const eye = n => Array.from({length:n}, (_, i) => Array.from({length:n}, (_, j) => +(i === j)));
export const transpose = a => a[0].map((_, j) => a.map(r => r[j]));
export const mv = (a, x) => a.map(r => dot(r, x));
export const mm = (a, b) => a.map(r => transpose(b).map(c => dot(r, c)));
export const det3 = a => dot(a[0], cross(a[1], a[2]));
export const median = a => { const s = [...a].sort((x,y)=>x-y); return s.length ? s[Math.floor(s.length/2)] : Infinity; };

// Symmetric Jacobi eigensolver. Eigenvectors are columns, sorted ascending.
export function eigenSymmetric(input) {
  const a = input.map(r => [...r]), n = a.length, v = eye(n);
  for (let step = 0; step < 100*n*n; step++) {
    let p = 0, q = 1, largest = 0;
    for (let i=0;i<n;i++) for(let j=i+1;j<n;j++) if(Math.abs(a[i][j])>largest) { largest=Math.abs(a[i][j]); p=i; q=j; }
    if (largest < 1e-13 * Math.max(1, ...a.map((r,i)=>Math.abs(r[i])))) break;
    const angle = .5*Math.atan2(2*a[p][q], a[q][q]-a[p][p]);
    const c=Math.cos(angle), s=Math.sin(angle), app=a[p][p], aqq=a[q][q], apq=a[p][q];
    for(let k=0;k<n;k++) if(k!==p && k!==q) {
      const x=a[k][p], y=a[k][q];
      a[k][p]=a[p][k]=c*x-s*y; a[k][q]=a[q][k]=s*x+c*y;
    }
    a[p][p]=c*c*app-2*s*c*apq+s*s*aqq;
    a[q][q]=s*s*app+2*s*c*apq+c*c*aqq; a[p][q]=a[q][p]=0;
    for(let k=0;k<n;k++) { const x=v[k][p], y=v[k][q]; v[k][p]=c*x-s*y; v[k][q]=s*x+c*y; }
  }
  const order=Array.from({length:n},(_,i)=>i).sort((i,j)=>a[i][i]-a[j][j]);
  return {values:order.map(i=>a[i][i]), vectors:v.map(r=>order.map(i=>r[i]))};
}
export function nullVector(rows) {
  const n=rows[0].length, a=Array.from({length:n},()=>Array(n).fill(0));
  for(const row of rows) for(let i=0;i<n;i++) for(let j=i;j<n;j++) a[i][j]+=row[i]*row[j];
  for(let i=0;i<n;i++) for(let j=0;j<i;j++) a[i][j]=a[j][i];
  return eigenSymmetric(a).vectors.map(r=>r[0]);
}
export function svd3(a) {
  const e=eigenSymmetric(mm(transpose(a),a));
  const vc=transpose(e.vectors).reverse(), s=e.values.map(x=>Math.sqrt(Math.max(0,x))).reverse();
  const u0=unit(mv(a,vc[0]));
  let u1=mv(a,vc[1]); u1=unit(sub(u1,scale(u0,dot(u0,u1))));
  let u2=unit(cross(u0,u1));
  if(dot(u2,mv(a,vc[2]))<0) u2=scale(u2,-1);
  return {u:transpose([u0,u1,u2]), s, v:transpose(vc)};
}
export function solve(a, b) {
  const n=b.length, m=a.map((r,i)=>[...r,b[i]]);
  for(let k=0;k<n;k++) {
    let p=k; for(let i=k+1;i<n;i++) if(Math.abs(m[i][k])>Math.abs(m[p][k])) p=i;
    if(Math.abs(m[p][k])<1e-15) return null;
    [m[k],m[p]]=[m[p],m[k]];
    const d=m[k][k]; for(let j=k;j<=n;j++) m[k][j]/=d;
    for(let i=0;i<n;i++) if(i!==k) { const s=m[i][k]; for(let j=k;j<=n;j++) m[i][j]-=s*m[k][j]; }
  }
  return m.map(r=>r[n]);
}
export function rodrigues(w) {
  const theta=norm(w); if(theta<1e-14) return eye(3);
  const [x,y,z]=scale(w,1/theta), c=Math.cos(theta), s=Math.sin(theta), d=1-c;
  return [[c+x*x*d,x*y*d-z*s,x*z*d+y*s],[y*x*d+z*s,c+y*y*d,y*z*d-x*s],[z*x*d-y*s,z*y*d+x*s,c+z*z*d]];
}
export function rotationVector(r) {
  const t=Math.acos(Math.max(-1,Math.min(1,(r[0][0]+r[1][1]+r[2][2]-1)/2)));
  if(t<1e-8) return [0,0,0];
  return scale([r[2][1]-r[1][2],r[0][2]-r[2][0],r[1][0]-r[0][1]],t/(2*Math.sin(t)));
}

// Damped finite-difference least squares with a Huber loss.
export function optimize(initial, residual, iterations=20, huber=3) {
  let x=[...initial], lambda=1e-3;
  const loss = r => r.reduce((s,v)=>s+(Math.abs(v)<=huber?v*v:2*huber*Math.abs(v)-huber*huber),0);
  let r=residual(x), cost=loss(r);
  for(let it=0;it<iterations;it++) {
    const n=x.length, cols=x.map((v,j)=>{
      const h=1e-5*Math.max(1,Math.abs(v)), y=[...x]; y[j]+=h;
      return residual(y).map((v,i)=>(v-r[i])/h);
    });
    const a=Array.from({length:n},()=>Array(n).fill(0)), b=Array(n).fill(0);
    for(let k=0;k<r.length;k++) {
      const w=Math.min(1,huber/Math.max(Math.abs(r[k]),1e-12));
      for(let i=0;i<n;i++) { b[i]-=w*cols[i][k]*r[k]; for(let j=0;j<n;j++) a[i][j]+=w*cols[i][k]*cols[j][k]; }
    }
    for(let i=0;i<n;i++) a[i][i]+=lambda*(a[i][i]+1);
    const dx=solve(a,b); if(!dx) break;
    const y=add(x,dx), ry=residual(y), cy=loss(ry);
    if(Number.isFinite(cy) && cy<cost) { x=y; r=ry; cost=cy; lambda=Math.max(1e-9,lambda/3); if(norm(dx)<1e-7) break; }
    else lambda*=10;
  }
  return x;
}
export function random(seed=1234567) { return () => {seed|=0; seed=seed+0x6D2B79F5|0; let t=Math.imul(seed^seed>>>15,1|seed); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296;}; }
export function sample(a, n, rng) { const s=new Set(); while(s.size<n) s.add(Math.floor(rng()*a.length)); return [...s].map(i=>a[i]); }
