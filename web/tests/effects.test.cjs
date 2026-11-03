const test=require('node:test');
const assert=require('node:assert/strict');
const FX=require('../effects.js');

test('visual preferences tolerate corrupt values and bound effect budgets',()=>{
  const safe=FX.settings({quality:'__proto__',intensity:5,glow:'false',shake:true,untrusted:true});
  assert.equal(safe.quality,'high');assert.equal(safe.intensity,1);assert.equal(safe.glow,true);assert.equal(safe.shake,true);assert.equal(safe.untrusted,undefined);
  assert.deepEqual(FX.settings(null),FX.defaults);
  const fx=FX.create({quality:'ultra'});
  for(let i=0;i<500;i++)fx.explosion(200,200);
  assert.ok(fx.stats().particles<=FX.presets.ultra.particles);assert.ok(fx.stats().rings<=FX.presets.ultra.rings);
  const bullets=Array.from({length:400},(_,id)=>({id,x:id,y:100,own:'P'}));for(let i=0;i<40;i++)fx.update(.03,{bullets});
  assert.ok(fx.stats().trails<=220);assert.ok(fx.stats().trailPoints<=220*FX.presets.ultra.trails);
  fx.configure({quality:'low'});assert.ok(fx.stats().particles<=FX.presets.low.particles);assert.ok(fx.stats().trailPoints<=220*FX.presets.low.trails);
  fx.configure({quality:'off'});assert.equal(fx.stats().particles+fx.stats().rings+fx.stats().trails,0);
});

test('visual work never consumes game randomness or modifies supplied tank and bullet state',()=>{
  const fx=FX.create({shake:true}),world={tanks:[{id:'P',x:100,y:100,a:0,alive:true}],bullets:[{id:1,x:300,y:100,vx:128,vy:0,own:'E'}]},before=JSON.stringify(world),random=Math.random;
  try{Math.random=()=>{throw new Error('visuals touched game RNG')};
    fx.explosion(150,150);fx.muzzle(world.tanks[0]);fx.pickup(world.tanks[0],'shield');fx.deflect(100,100,'P');
    for(let i=0;i<10;i++)fx.update(.03,world);fx.offset();
  }finally{Math.random=random}
  assert.equal(JSON.stringify(world),before);
  fx.configure({reducedMotion:true});assert.deepEqual(fx.offset(),{x:0,y:0});
  fx.configure({intensity:0});assert.equal(fx.stats().particles+fx.stats().rings+fx.stats().trails,0);
});

test('effects expire and a fresh round discards trails, recoil and camera movement',()=>{
  const fx=FX.create({quality:'high',shake:true});fx.explosion(200,200);fx.muzzle({id:'P',x:100,y:100,a:0});
  assert.ok(fx.recoil('P')>0);fx.update(.05,{bullets:[{id:1,x:150,y:100,own:'P'}]});assert.equal(fx.stats().trails,1);
  for(let i=0;i<50;i++)fx.update(.1);assert.equal(fx.stats().particles+fx.stats().rings+fx.stats().trails,0);
  fx.explosion(200,200);fx.reset();assert.equal(fx.stats().time,0);assert.equal(fx.recoil('P'),0);assert.deepEqual(fx.offset(),{x:0,y:0});
});
