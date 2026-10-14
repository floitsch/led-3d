import test from 'node:test';
import assert from 'node:assert/strict';
import {effectColor} from '../web/lib/effects.js';
import {orient} from '../web/lib/viewer.js';
test('rising ring travels toward positive Y',()=>{
  assert.deepEqual(effectColor('rings',[0,-1,0],0,1,1),[26,179,255]);
  assert.deepEqual(effectColor('rings',[0,-.4,0],1,1,1),[26,179,255]);
  assert.ok(effectColor('rings',[0,-1,0],1,1,1)[2]<5);
});
test('orientation rotates saved coordinates rather than camera orbit',()=>{
  const point=orient([1,0,0],[0,0,Math.PI/2]);assert.ok(Math.abs(point[0])<1e-10);assert.ok(Math.abs(point[1]-1)<1e-10);
});
