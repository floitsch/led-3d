import {reconstruct} from './lib/reconstruction.js';
self.onmessage=({data})=>{
  try { self.postMessage({type:'result',map:reconstruct(data,message=>self.postMessage({type:'progress',message}))}); }
  catch(error){self.postMessage({type:'error',message:error.message});}
};
