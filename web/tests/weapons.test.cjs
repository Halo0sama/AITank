const test=require('node:test');
const assert=require('node:assert/strict');
const Weapons=require('../weapons.js');

function arena(){
  const system=Weapons.create(),events=[],hits=[],released=[],held=new Set();let sequence=0;
  const tank=(id,x,y)=>({id,x,y,a:0,alive:true,cd:0,live:0});
  const world={time:0,width:1100,height:700,walls:[],tanks:[tank('P',150,150),tank('P2',150,550),tank('E',900,400)],bullets:[],enabled:false,
    constants:{cellSize:100,tankRadius:23.4,bulletRadius:6,bulletSpeed:128,bulletLifetime:15},random:()=>.5,held:id=>held.has(id),
    spawn:b=>{b.id=++sequence;world.bullets.push(b);return b},release:b=>released.push(b.id),
    hit:(t,b)=>{if(t.alive){t.alive=false;hits.push({victim:t.id,owner:b.own,kind:b.kind})}},event:(type,event)=>events.push({type,...event})};
  system.reset(world);
  function step(seconds,combat=true){for(let remaining=seconds;remaining>1e-8;){const dt=Math.min(.01,remaining);world.time+=dt;for(const t of world.tanks)t.cd=Math.max(0,t.cd-dt);system.update(world,dt,combat);remaining-=dt}}
  return {system,world,P:world.tanks[0],P2:world.tanks[1],E:world.tanks[2],events,hits,released,held,step};
}

test('crates respect walls, occupied inventory and shield coexistence',()=>{
  const {system:s,world:w,P,step}=arena();assert.equal(Object.keys(Weapons.catalog).length,10);
  w.enabled=true;w.walls=[{x:490,y:0,w:20,h:700}];assert.equal(s.spawnPickup(w,'laser',500,250),null);
  s.spawnPickup(w,'shotgun',P.x,P.y);step(.01);assert.equal(P.weapon.type,'shotgun');assert.equal(s.pickups.length,0);
  s.spawnPickup(w,'laser',P.x,P.y);step(.01);assert.equal(P.weapon.type,'shotgun');assert.equal(s.pickups.length,1);
  assert.equal(s.equip(w,P,'shield'),false);P.weapon=null;assert.equal(s.equip(w,P,'shield'),true);assert.equal(P.weapon.type,'shield');assert.equal(P.shieldUntil,0);s.fire(w,P);assert.equal(P.weapon,null);assert.equal(s.equip(w,P,'shield'),false);
  assert.ok(P.shieldUntil>w.time);P.alive=false;assert.equal(s.equip(w,P,'mine'),false);
});

test('laser uses swept substeps, bounces, and only its moving tip is lethal',()=>{
  const {system:s,world:w,P,E,hits,step,released}=arena();E.x=300;E.y=P.y;
  s.equip(w,P,'laser');assert.equal(s.fire(w,P),true);assert.equal(s.locked(w,P),true);
  // A 0.15s frame would cross the entire target without swept collision.
  w.time=.15;s.update(w,.15);assert.equal(E.alive,false);assert.equal(hits[0].kind,'laser');assert.equal(P.live,0);assert.equal(released.length,0);
  assert.equal(s.locked(w,P),false);assert.ok(s.beams.length>0);
  E.x=240;E.alive=true;step(.01);assert.equal(E.alive,true,'a rendered trail cannot deal a second hit');
  const a=arena();a.P.x=1000;a.P.y=150;a.system.equip(a.world,a.P,'laser');a.system.fire(a.world,a.P);a.step(.13);
  assert.equal(a.P.alive,false,'wall reflection can kill the shooter');
});

test('death ray charges before firing, crosses internal walls and pierces both teammates',()=>{
  const {system:s,world:w,P,P2,E,hits,step}=arena();P.x=450;P.y=350;P2.x=650;P2.y=350;E.x=150;E.y=350;
  w.walls=[{x:300,y:0,w:12,h:700}];s.equip(w,E,'deathray');s.fire(w,E);
  step(.59);assert.equal(w.bullets.length,0);assert.equal(s.locked(w,E),true);assert.equal(P.alive,true);
  step(.28);assert.equal(P.alive,false);assert.equal(P2.alive,false);assert.equal(hits.length,2);assert.equal(w.bullets.length,1);
  step(.5);assert.equal(w.bullets.length,0,'exterior border stops the ray');assert.equal(s.locked(w,E),false);
  const a=arena();a.system.equip(a.world,a.E,'deathray');a.system.fire(a.world,a.E);a.E.alive=false;a.step(.8);
  assert.equal(a.world.bullets.length,0);assert.equal(a.system.charges.length,0);
});

test('double barrels alternate; shotgun and gatling consume their own ammunition',()=>{
  const a=arena();a.system.equip(a.world,a.P,'double');a.system.fire(a.world,a.P);a.P.cd=0;a.system.fire(a.world,a.P);
  assert.ok(a.world.bullets[0].y<a.P.y);assert.ok(a.world.bullets[1].y>a.P.y);assert.equal(a.P.weapon.ammo,8);assert.equal(a.P.live,0);
  const b=arena();b.system.equip(b.world,b.P,'shotgun');b.system.fire(b.world,b.P);
  assert.equal(b.world.bullets.length,20);assert.equal(b.P.weapon.ammo,2);assert.ok(b.world.bullets.every(p=>p.slot===false));
  b.step(1.2,false);assert.equal(b.world.bullets.length,0);assert.deepEqual(b.released,[]);
  const c=arena();c.system.equip(c.world,c.P,'gatling');c.held.add('P');c.step(.6);assert.equal(c.world.bullets.length,0);
  c.step(.4);assert.ok(c.P.weapon.ammo<30);const remaining=c.P.weapon.ammo;
  c.held.clear();c.step(.3);assert.equal(c.P.weapon.ammo,remaining);assert.equal(c.P.gatlingStart,null);
});

test('homing starts after two seconds and can switch to its owner',()=>{
  const {system:s,world:w,P,P2,E,step}=arena();P.x=100;P.y=100;P2.alive=false;E.x=950;E.y=600;
  s.equip(w,P,'homing');s.fire(w,P);step(1.9);let missile=w.bullets[0];assert.equal(missile.targetId,undefined);assert.equal(missile.vy,0);
  step(.15);assert.equal(missile.targetId,'P');assert.ok(Math.abs(missile.vy)>0);
  E.x=missile.x;E.y=missile.y+80;P.x=100;P.y=600;step(.02);assert.equal(missile.targetId,'E');
  assert.ok(Math.hypot(missile.vx,missile.vy)<=210.001);
});

test('remote missile steers at a bounded rate and unlocks on removal',()=>{
  const {system:s,world:w,P,step}=arena();s.equip(w,P,'remote');s.fire(w,P);const missile=s.remote(w,P);
  assert.ok(missile);assert.equal(s.locked(w,P),true);assert.equal(s.fire(w,P),false);
  s.steerRemote(w,P,Math.PI/2,.02);assert.ok(Math.atan2(missile.vy,missile.vx)<=.050001);
  const position={x:P.x,y:P.y};P.alive=false;step(.5);assert.ok(s.remote(w,P),'existing missile survives its shooter');
  assert.deepEqual({x:P.x,y:P.y},position);missile.life=.001;step(.01);
  assert.equal(s.remote(w,P),null);assert.equal(P.weapon,null);assert.equal(s.locked(w,P),false);
});

test('frag can be detonated manually or by fuse, with self and friendly damage',()=>{
  const a=arena();a.system.equip(a.world,a.P,'frag');a.system.fire(a.world,a.P);const bomb=a.world.bullets[0];
  a.P.x=bomb.x;a.P.y=bomb.y;a.P2.x=bomb.x+30;a.P2.y=bomb.y;a.system.fire(a.world,a.P);
  assert.equal(a.P.alive,false);assert.equal(a.P2.alive,false);assert.equal(a.P.weapon,null);
  assert.equal(a.world.bullets.filter(b=>b.kind==='shrapnel').length,24);assert.deepEqual(a.released,[]);
  a.step(.01);assert.equal(a.events.filter(e=>e.type==='detonate').length,1);
  const b=arena();b.system.equip(b.world,b.P,'frag');b.system.fire(b.world,b.P);b.P.alive=false;b.step(3.02);
  assert.equal(b.events.filter(e=>e.type==='detonate').length,1);assert.ok(b.world.bullets.some(p=>p.kind==='shrapnel'));
});

test('mine is hidden after arming, holds its trigger, and explodes when vacated',()=>{
  const {system:s,world:w,P,E,hits,step}=arena();s.equip(w,P,'mine');s.fire(w,P);const mine=s.mines[0];
  assert.equal(s.snapshot(w,'E').mines.length,1);step(.8);assert.equal(s.snapshot(w,'E').mines.length,0);assert.equal(s.snapshot(w,'P').mines.length,1);
  E.x=mine.x;E.y=mine.y;step(.01);assert.equal(mine.triggerId,'E');assert.equal(E.alive,true);assert.equal(s.snapshot(w,'E').mines.length,1);
  step(.2);assert.equal(E.alive,true);assert.equal(s.mines.length,1);
  E.x=mine.x+35;step(.01);assert.equal(s.mines.length,0);assert.equal(hits.find(h=>h.victim==='E').owner,'P');
});

test('shield reflects without transferring ownership or prematurely returning a normal slot',()=>{
  const {system:s,world:w,P,E,events,released,step}=arena();E.x=400;E.y=P.y;s.equip(w,E,'shield');s.fire(w,E);
  const b=w.spawn({x:350,y:E.y,vx:128,vy:0,own:'P',life:3});step(.15);
  assert.equal(E.alive,true);assert.ok(b.vx<0);assert.equal(b.own,'P');assert.equal(released.length,0);assert.equal(events.filter(e=>e.type==='deflect').length,1);
  step(2);assert.equal(P.alive,false);assert.deepEqual(released,[b.id]);
  const a=arena();a.system.equip(a.world,a.P,'shield');a.system.fire(a.world,a.P);a.world.spawn({x:a.P.x+32,y:a.P.y,vx:-128,vy:0,own:'P',life:3});a.step(.1);
  assert.equal(a.P.alive,false,'a shot already inside the bubble can kill its owner');
  const c=arena();c.system.equip(c.world,c.P,'shield');c.system.fire(c.world,c.P);c.step(6.01);assert.equal(c.P.shieldUntil>c.world.time,false);
});

test('forecast is non-mutating and shares guided motion and charged rays with live physics',()=>{
  const {system:s,world:w,P,E}=arena();s.equip(w,P,'homing');s.fire(w,P);w.bullets[0].seekAt=0;s.equip(w,E,'deathray');s.fire(w,E);
  const before=JSON.stringify({bullets:w.bullets,charges:s.charges,tanks:w.tanks});const future=s.forecast(w,.1,.05);
  assert.equal(JSON.stringify({bullets:w.bullets,charges:s.charges,tanks:w.tanks}),before);
  w.time=.05;s.update(w,.05,false);const last=future.frames[0].points.at(-1),real=w.bullets[0];
  assert.ok(Math.abs(last.x-real.x)<1e-7);assert.ok(Math.abs(last.y-real.y)<1e-7);
  const long=s.forecast(w,1,.05);assert.ok(long.frames.some(f=>f.points.some(p=>p.vx>2000)));
});

test('random crates stay in usable cells and do not grow without bound',()=>{
  const {system:s,world:w}=arena();w.enabled=true;w.tanks.forEach(t=>t.alive=false);w.random=Math.random;
  for(let i=0;i<100;i++){w.time=s.nextSpawn;s.update(w,0);assert.ok(s.pickups.length<=3);for(const p of s.pickups)assert.equal(Weapons.lineClear(w,p.x,p.y,p.x,p.y,18),true)}
  assert.ok(s.pickups.length>0);
});

test('guided routing follows open corridors around a wall without crossing it',()=>{
  const {world:w,system:s,P,P2,E,step}=arena();P.x=100;P.y=650;P2.alive=false;E.x=550;E.y=150;
  w.walls=[{x:493,y:0,w:14,h:400}];const missile=w.spawn({kind:'homing',x:450,y:150,vx:210,vy:0,own:'P',slot:false,radius:5,life:9,seekAt:0});
  const hop=Weapons.route(w,missile,E);assert.equal(hop.x,450);assert.ok(hop.y>150);
  let reachedBottom=false;
  for(let i=0;i<600&&!missile.removed;i++){
    step(.01);if(missile.y>410)reachedBottom=true;
    assert.equal(Weapons.lineClear(w,missile.x,missile.y,missile.x,missile.y,5),true);
  }
  assert.equal(reachedBottom,true);assert.equal(E.alive,false,'the missile must follow the open corridor to the target');
});

test('a blocked laser muzzle neither spends its charge nor starts a tank lock',()=>{
  const {world:w,system:s,P}=arena();w.walls=[{x:175,y:0,w:14,h:700}];s.equip(w,P,'laser');
  assert.equal(s.fire(w,P),false);assert.equal(P.weapon.ammo,1);assert.equal(s.locked(w,P),false);assert.equal(w.bullets.length,0);
});

test('skill registration rejects invalid definitions, overrides and mutable metadata',()=>{
  const Registry=require('../skill-registry.js'),r=Registry.create(),definition={id:'test_bolt',name:'测试弹',icon:'TB',color:'#88ffaa',ammo:2,projectile:{speed:250,radius:3,life:2}};
  r.register(definition);assert.throws(()=>r.register(definition),/已注册/);assert.throws(()=>r.register({...definition,id:'normal'}));assert.throws(()=>r.register({...definition,id:'bad_speed',projectile:{speed:Infinity,radius:3,life:2}}));
  r.catalog.test_bolt={name:'tampered'};assert.equal(r.catalog.test_bolt.name,'测试弹');assert.ok(Object.isFrozen(r.catalog.test_bolt));
  assert.throws(()=>Weapons.register({...definition,id:'laser'}),/已注册/);
});

test('registered original projectiles use pickup, prediction, friendly damage and independent ammunition',()=>{
  let impacts=0,cleaned=0;
  Weapons.register({id:'test_original_bolt',name:'原创弹测试',icon:'OB',color:'#88ffaa',ammo:2,cooldown:.2,spawn:false,projectile:{speed:300,radius:3,life:2},aiDescription:'两发反弹弹，独立弹量',hit:ctx=>{impacts++;ctx.emit('impact')},cleanup:()=>cleaned++});
  const {system:s,world:w,P,P2,released,step}=arena();w.enabled=true;P.live=5;P2.x=300;P2.y=P.y;s.spawnPickup(w,'test_original_bolt',P.x,P.y);step(.01);
  assert.equal(P.weapon.type,'test_original_bolt');assert.equal(P.weapon.capacity,2);assert.equal(s.spec(w,P).speed,300);assert.equal(s.snapshot(w,'E').definitions[0].id,'test_original_bolt');
  assert.equal(s.fire(w,P),true);const bullet=w.bullets[0];assert.equal(bullet.kind,'test_original_bolt');assert.equal(bullet.slot,false);step(.5);
  assert.equal(P2.alive,false);assert.equal(impacts,1);assert.equal(P.live,5);assert.deepEqual(released,[]);P.cd=0;s.fire(w,P);assert.equal(P.weapon,null);assert.equal(cleaned,1);
});

test('original buff state expires or resets once; custom hazards and guidance use detached prediction state',()=>{
  let cleaned=0;
  Weapons.register({id:'test_original_aura',name:'光环测试',icon:'AU',color:'#aabbff',ammo:0,slot:'buff',duration:.2,spawn:false,
    equip:({tank,state})=>{state.total=0;tank.testAura=true},update:({state,dt})=>{state.total+=dt},cleanup:({tank})=>{cleaned++;delete tank.testAura},
    forecast:({world,step})=>{world.tanks[0].x=-100;return[{time:world.time+step,points:[{x:450,y:300,radius:30,vx:0,vy:0}]}]}});
  Weapons.register({id:'test_guided_bolt',name:'制导测试',icon:'GB',color:'#ffaa88',ammo:1,spawn:false,projectile:{speed:100,radius:3,life:2},guide:({world,projectile})=>{world.tanks[0].x=-100;projectile.x=-100;return{vx:0,vy:100}}});
  const {system:s,world:w,P,step}=arena();s.equip(w,P,'test_original_aura');assert.equal(P.testAura,undefined);s.fire(w,P);P.cd=0;s.equip(w,P,'test_guided_bolt');assert.equal(s.equip(w,P,'test_original_aura'),false);s.fire(w,P);
  const before=JSON.stringify({tanks:w.tanks,bullets:w.bullets});const predicted=s.forecast(w,.1,.05);assert.equal(JSON.stringify({tanks:w.tanks,bullets:w.bullets}),before);assert.ok(predicted.frames[0].points.some(p=>p.radius===30));
  step(.1);assert.equal(P.x,150);assert.ok(w.bullets[0].y>P.y);assert.ok(P.skills.test_original_aura.state.total>0);step(.15);assert.equal(P.testAura,undefined);assert.equal(cleaned,1);
  s.equip(w,P,'test_original_aura');P.cd=0;s.fire(w,P);s.reset(w);assert.equal(P.testAura,undefined);assert.equal(cleaned,2);assert.deepEqual(P.skills,{});
});

test('failing extension hooks report once and do not spend ammo or stop existing physics',()=>{
  Weapons.register({id:'test_broken_skill',name:'故障测试',icon:'XX',color:'#aabbcc',ammo:2,spawn:false,fire:()=>{throw new Error('test failure')}});
  const {system:s,world:w,P,events,step}=arena();s.equip(w,P,'test_broken_skill');for(let i=0;i<5;i++)assert.equal(s.fire(w,P),false);
  assert.equal(events.filter(e=>e.type==='skill_error').length,1);assert.equal(P.weapon.ammo,2);
  w.spawn({x:500,y:500,vx:128,vy:0,life:1,own:'E'});step(.1);assert.ok(w.bullets[0].x>500);
});

test('extension spawn and event helpers retain owner, skill identity and special-slot attribution',()=>{
  Weapons.register({id:'test_spawn_owner',name:'归属测试',icon:'OW',color:'#aabbcc',ammo:1,spawn:false,
    projectile:{speed:240,radius:3,life:2},fire:ctx=>{ctx.spawn({own:'E',kind:'normal',slot:true});ctx.emit('test',{owner:'E',weapon:'normal'});return true}});
  const {system:s,world:w,P,events,released,step}=arena();s.equip(w,P,'test_spawn_owner');s.fire(w,P);
  assert.equal(w.bullets[0].own,'P');assert.equal(w.bullets[0].kind,'test_spawn_owner');assert.equal(w.bullets[0].slot,false);
  const event=events.find(e=>e.type==='skill_event');assert.equal(event.owner,'P');assert.equal(event.weapon,'test_spawn_owner');
  step(2.1);assert.deepEqual(released,[]);
});

test('an equipped original can forecast its hazard before creating a projectile',()=>{
  Weapons.register({id:'test_charged_area',name:'区域预警',icon:'AR',color:'#aabbcc',ammo:1,spawn:false,fire:()=>false,
    forecast:({world,step})=>[{time:world.time+step,points:[{x:400,y:300,radius:40}]}]});
  const {system:s,world:w,P}=arena();s.equip(w,P,'test_charged_area');
  assert.ok(s.hasSpecial(w));assert.equal(w.bullets.length,0);assert.equal(s.forecast(w,.1,.05).frames[0].points[0].radius,40);
});

test('world pickup policy enforces restricted actors for physical boxes and direct equips',()=>{
 const {system:s,world:w,P,E,step}=arena();w.enabled=true;w.canPickup=t=>t.id!=='E';
 s.spawnPickup(w,'laser',E.x,E.y);s.spawnPickup(w,'shield',P.x,P.y);step(.01);
 assert.equal(E.weapon,null);assert.equal(P.weapon.type,'shield');assert.equal(s.pickups.length,1);assert.equal(s.snapshot(w,'E').pickupAllowed,false);
 for(const type of Object.keys(Weapons.catalog))assert.equal(s.equip(w,E,type),false);
 w.canPickup=()=>true;step(.01);assert.equal(E.weapon.type,'laser');assert.equal(s.pickups.length,0);
});

test('physical collection can require a selected crate while players still collect on contact',()=>{
 const {system:s,world:w,P,E,step}=arena();w.enabled=true;
 const selected=s.spawnPickup(w,'shotgun',E.x+20,E.y),other=s.spawnPickup(w,'laser',E.x-20,E.y);
 s.spawnPickup(w,'shield',P.x,P.y);let authorized=false;
 w.canCollect=(t,p)=>t.id!=='E'||authorized&&p.id===selected.id;
 step(.01);assert.equal(E.weapon,null);assert.equal(P.weapon.type,'shield');
 authorized=true;step(.01);assert.equal(E.weapon.type,'shotgun');assert.deepEqual(s.pickups.map(p=>p.id),[other.id]);
});

test('original skill glyph metadata is optional, immutable and rejects markup',()=>{
 const d={id:'test_icon_path',name:'图形技能',icon:'IC',glyph:'M12 2L22 12 12 22 2 12Z',color:'#aabbcc',ammo:1,projectile:{speed:200,radius:3,life:2}};
 Weapons.register(d);assert.equal(Weapons.catalog.test_icon_path.glyph,d.glyph);assert.ok(Object.isFrozen(Weapons.catalog.test_icon_path));
 assert.throws(()=>Weapons.register({...d,id:'test_bad_icon_path',glyph:'<svg onload=1>'}),/SVG/);
});

test('complete weapon rulebook exposes actual activation, lifetime ranges and special controls',()=>{
  const {system:s,world:w}=arena(),rules=s.rulebook(w),by=Object.fromEntries(rules.map(r=>[r.id,r]));
  assert.equal(rules.length,10);assert.equal(by.gatling.projectile.range,285*1.55);assert.equal(by.gatling.spinup,.65);assert.equal(by.gatling.control,'hold');
  assert.equal(by.deathray.charge,.6);assert.equal(by.deathray.pierceInternalWalls,true);assert.equal(by.deathray.locksMovementAndRotation,true);
  assert.equal(by.laser.lethal,'moving tip only');assert.equal(by.shotgun.pellets,20);assert.deepEqual(by.double.barrelOffsets,[-9,9]);
  assert.equal(by.homing.seekDelay,2);assert.match(by.homing.targets,/owner/);assert.equal(by.mine.hiddenAfterArming,true);assert.equal(by.frag.shrapnel.count,24);
  assert.equal(by.shield.keepsProjectileOwner,true);assert.equal(by.remote.vehicleLockedWhileActive,true);
});

test('weapon preview uses finite gatling range while a piercing ray crosses internal walls',()=>{
  const {system:s,world:w,P,E,P2}=arena();P2.alive=false;E.x=150;E.y=350;P.x=900;P.y=350;
  s.equip(w,E,'gatling');const before=JSON.stringify({tanks:w.tanks,bullets:w.bullets}),shot=s.preview(w,E,0,P),advice=s.advice(w,E,P);
  assert.equal(shot.hit,false);assert.equal(shot.outOfRange,true);assert.ok(advice.score<0);assert.equal(JSON.stringify({tanks:w.tanks,bullets:w.bullets}),before);
  E.weapon=null;E.cd=0;s.equip(w,E,'deathray');w.walls=[{x:400,y:0,w:12,h:700}];
  const ray=s.preview(w,E,0,P);assert.equal(ray.hit,true);assert.ok(ray.eta>.6);assert.equal(s.advice(w,E,P).aim.hit,true);
});

test('laser solution finds a real ricochet around cover and avoids a direct self hit',()=>{
  const {system:s,world:w,P,E,P2,step}=arena();P2.alive=false;E.x=150;E.y=350;P.x=650;P.y=350;w.walls=[{x:400,y:180,w:12,h:350}];s.equip(w,E,'laser');
  const direct=s.preview(w,E,0,P),solution=s.solution(w,E,P);assert.equal(direct.selfHit,true);assert.equal(solution.hit,true);assert.equal(solution.selfHit,false);
  E.a=solution.angle;s.fire(w,E);step(.8);assert.equal(P.alive,false);assert.equal(E.alive,true);
});

test('shared sandbox library retains barrel offsets, spread, charge and shield reflection physics',()=>{
  const clone=new Function('return '+Weapons.sandboxSource())();assert.equal(clone.apiVersion,4);
  for(const type of ['double','shotgun','deathray','laser','gatling','homing','remote','frag']){
    const {system:s,world:w,P,E,P2}=arena();P2.alive=false;E.x=150;E.y=350;P.x=380;P.y=350;s.equip(w,E,type);
    const a=s.preview(w,E,.03,P),b=clone.create().preview(w,E,.03,P);assert.deepEqual(b,a,type);
  }
  const {system:s,world:w,P,E,P2}=arena();P2.alive=false;E.x=150;E.y=350;P.x=350;P.y=350;P.shieldUntil=6;s.equip(w,E,'laser');const hit=s.preview(w,E,0,P);
  assert.equal(hit.hit,false);assert.equal(hit.selfHit,true);
});

test('gatling continuation cannot renew AI trigger intent after the controller releases it',()=>{
  const {system:s,world:w,E,P,P2,step}=arena();P.alive=false;P2.alive=false;E.x=150;E.y=350;E.a=0;s.equip(w,E,'gatling');
  for(let i=0;i<80;i++){s.fire(w,E);step(.01)}
  assert.ok(E.weapon.ammo<30);const trigger=E.weaponTrigger;step(.3);const stopped=E.weapon.ammo;
  assert.equal(E.weaponTrigger,trigger);assert.equal(E.gatlingStart,null);step(.5);assert.equal(E.weapon.ammo,stopped);assert.ok(stopped>0);
});

function threatArena(type,range=500){const a=arena();a.P2.alive=false;a.P.x=150;a.P.y=350;a.E.x=150+range;a.E.y=350;if(type)a.system.equip(a.world,a.P,type);return a}

test('pending piercing attacks forecast real damage across cover without touching combat or random inputs',()=>{
  const a=threatArena('deathray');a.world.walls=[{x:400,y:0,w:12,h:700}];a.world.random=()=>{throw Error('read actual RNG')};a.world.held=()=>{throw Error('read future input')};
  const before=JSON.stringify({tanks:a.world.tanks,bullets:a.world.bullets,mines:a.system.mines,charges:a.system.charges});
  const r=a.system.threats(a.world);assert.equal(r.hypothetical,true);assert.equal(r.advisoryOnly,true);assert.ok(r.atSelf.score>0);assert.ok(r.atSelf.possibleHitIn>=.6);assert.ok(r.motions.some(m=>m.risk===0&&m.travel>30));
  assert.equal(JSON.stringify({tanks:a.world.tanks,bullets:a.world.bullets,mines:a.system.mines,charges:a.system.charges}),before);
  a.system.fire(a.world,a.P);a.step(.9);assert.equal(a.E.alive,false);
  const b=threatArena();b.world.walls=a.world.walls;assert.equal(b.system.threats(b.world).atSelf.score,0,'normal shells cannot cross the same solid wall');
});

test('future attacks respect empty ordinary slots, independent special ammo and real cooldown',()=>{
  const a=threatArena(null,240);a.P.live=5;let r=a.system.threats(a.world);assert.equal(r.scenarios[0].available,false);assert.equal(r.atSelf.score,0);
  a.system.equip(a.world,a.P,'shotgun');a.P.cd=.8;r=a.system.threats(a.world);assert.equal(r.scenarios[0].available,true);assert.equal(r.scenarios[0].readyIn,.8);assert.equal(Weapons.incomingRisk(r,a.E,0,.6).score,0);assert.ok(r.atSelf.score>0);
  a.P.alive=false;assert.equal(a.system.threats(a.world).actors.length,0);
});

test('hypothetical gatling includes spinup, finite reach and sampled spread rather than a normal cannon',()=>{
  const a=threatArena('gatling',300),r=a.system.threats(a.world);assert.ok(r.atSelf.score>0);assert.ok(r.atSelf.possibleHitIn>.65);assert.equal(Weapons.incomingRisk(r,a.E,0,.6).score,0);assert.ok(r.scenarios[0].paths.length>0);assert.equal(r.scenarios[0].spreadSampled,true);
  a.E.x=950;assert.equal(a.system.threats(a.world).atSelf.score,0);assert.equal(a.P.weapon.ammo,30);
});

test('hypothetical shield activation predicts reflected damage while keeping projectile ownership and inventory',()=>{
  const a=threatArena('shield',200);a.world.bullets.push({id:99,kind:'normal',x:300,y:350,vx:-128,vy:0,own:'E',life:15,radius:6});
  const before=JSON.stringify(a.world.bullets),r=a.system.threats(a.world);assert.equal(r.scenarios[0].action,'activate');assert.equal(r.scenarios[0].zones[0].role,'defense');assert.ok(r.atSelf.score>0);assert.equal(a.P.shieldUntil,0);assert.equal(a.P.weapon.type,'shield');assert.equal(JSON.stringify(a.world.bullets),before);
  a.system.fire(a.world,a.P);a.step(3);assert.equal(a.E.alive,false);assert.equal(a.world.bullets.length,0);
});

test('prospective mines show only the hypothetical placement and conditional trigger, never hidden actual mines',()=>{
  const a=threatArena('mine');a.system.mines.push({id:99,own:'P',x:777,y:666,armedAt:0,expires:24});
  const r=a.system.threats(a.world),zone=r.scenarios[0].zones[0];assert.equal(zone.role,'trigger');assert.equal(zone.x,a.P.x-23.4-14);assert.equal(zone.from,.7);assert.equal(zone.conditional,'step_on_then_leave');assert.equal(zone.fragmentReach,310*1.05);const hidden=a.system.mines;a.system.mines=[];assert.deepEqual(a.system.threats(a.world),r);a.system.mines=hidden;assert.equal(a.system.mines.length,1);
});

test('an existing frag bomb can threaten manual detonation with zero remaining ammunition',()=>{
  const a=threatArena('frag',300);a.system.fire(a.world,a.P);a.world.bullets[0].x=a.E.x-20;a.world.bullets[0].y=a.E.y;
  const before=JSON.stringify({weapon:a.P.weapon,bullets:a.world.bullets}),r=a.system.threats(a.world);assert.equal(r.scenarios[0].action,'detonate');assert.equal(r.scenarios[0].available,true);assert.ok(r.scenarios[0].zones.some(z=>z.role==='damage'&&z.from===0));assert.ok(r.atSelf.score>0);assert.equal(JSON.stringify({weapon:a.P.weapon,bullets:a.world.bullets}),before);
  a.system.fire(a.world,a.P);assert.equal(a.E.alive,false);
});

test('turn-to-target alternatives include rotation delay and never claim a certain future command',()=>{
  const a=threatArena('deathray',500);a.P.a=Math.PI/2;const r=a.system.threats(a.world),turn=r.actors[0].scenarios.find(s=>s.assumption==='turn_toward_observed_target');assert.ok(turn);assert.equal(turn.readyIn,.5);assert.ok(turn.possibleHitIn>=1.1);assert.equal(r.actors[0].scenarios[0].risk,0);assert.equal(r.hypothetical,true);
});

test('custom skills can provide a detached prospective threat extension and missing coverage stays explicit',()=>{
  Weapons.register({id:'future_storm',name:'测试风暴',icon:'FS',color:'#9988ff',ammo:1,spawn:false,projectile:{speed:200,radius:3,life:1},threatForecast:({world})=>[{time:world.time+.4,points:[{x:650,y:350,radius:40}]}]});
  const a=threatArena('future_storm'),r=a.system.threats(a.world);assert.equal(r.scenarios[0].coverage,'extension');assert.ok(r.atSelf.score>0);assert.equal(a.P.weapon.ammo,1);assert.equal(a.world.bullets.length,0);
  Weapons.register({id:'unknown_storm',name:'未知扩展',icon:'US',color:'#9988ee',ammo:1,spawn:false,fire:()=>true});const b=threatArena('unknown_storm');assert.equal(b.system.threats(b.world).atSelf.unknown,true);
});

test('conditional mine explosion includes real fragment reach after a tank triggers and leaves it',()=>{
  const a=threatArena('mine');a.E.x=a.P.x-23.4-14;a.E.y=500;
  const r=a.system.threats(a.world),conditional=r.scenarios.find(s=>s.conditional==='someone_steps_on_then_leaves');assert.ok(conditional);assert.ok(conditional.paths.length>0);assert.ok(r.atSelf.score>0);
  a.system.fire(a.world,a.P);const mine=a.system.mines[0];a.P2.alive=true;a.P2.x=mine.x;a.P2.y=mine.y;a.step(.71);assert.equal(mine.triggerId,'P2');a.P2.x=mine.x-60;a.step(.6);assert.equal(a.E.alive,false);
});

test('queries beyond the sampled horizon stay unknown rather than promising safety',()=>{
  const a=threatArena('deathray'),r=a.system.threats(a.world);assert.equal(Weapons.incomingRisk(r,a.E,5,6).unknown,true);assert.equal(Weapons.incomingRisk(r,a.E,0,8).unknown,true);assert.equal(Weapons.incomingRisk(r,{x:650,y:350,radius:NaN},0,1).unknown,true);
});

test('prospective homing preserves its two-second delay and a launched remote models bounded steering without new ammo',()=>{
  const a=threatArena('homing',700);a.P.x=100;a.P.y=100;a.E.y=600;const homing=a.system.projectAttack(a.world,a.P,{viewerId:'E',horizon:3});
  assert.ok(homing.paths.filter(p=>p[1]<1.9).every(p=>Math.abs(p[3]-100)<.01&&Math.abs(p[5]-100)<.01));assert.ok(homing.paths.some(p=>p[0]>2&&Math.abs(p[3]-p[5])>.01));
  const b=threatArena('remote',400);b.system.fire(b.world,b.P);assert.equal(b.P.weapon.ammo,0);const before=JSON.stringify(b.world.bullets),r=b.system.threats(b.world);assert.equal(r.scenarios[0].action,'steer');assert.equal(r.scenarios[0].available,true);assert.ok(r.atSelf.score>0);assert.equal(JSON.stringify(b.world.bullets),before);assert.equal(b.P.weapon.ammo,0);
});

test('single-shot queries also evaluate a real in-flight frag detonation and remote steering',()=>{
  const a=threatArena('frag',550);a.system.fire(a.world,a.P);a.world.bullets[0].x=a.E.x-20;const detonation=a.system.preview(a.world,a.P,0,a.E);assert.equal(detonation.action,'detonate');assert.equal(detonation.hit,true);assert.equal(detonation.selfHit,false);assert.equal(a.P.weapon.ammo,0);
  const b=threatArena('remote',400);b.system.fire(b.world,b.P);const steering=b.system.preview(b.world,b.P,0,b.E);assert.equal(steering.action,'steer');assert.equal(steering.hit,true);assert.equal(b.P.weapon.ammo,0);
});

test('malformed threat extension frames remain incomplete and cannot crash or mutate the game',()=>{
  Weapons.register({id:'malformed_storm',name:'异常扩展',icon:'MS',color:'#7788ff',ammo:1,spawn:false,projectile:{speed:200,radius:3,life:1},threatForecast:({world})=>[null,{time:world.time+.4,points:[null,{x:650,y:350,radius:30}]}]});
  const a=threatArena('malformed_storm'),r=a.system.threats(a.world);assert.equal(r.atSelf.unknown,true);assert.ok(r.atSelf.score>0);assert.equal(a.world.bullets.length,0);assert.equal(a.P.weapon.ammo,1);
});

test('a distant shotgun target still reports the full volley returning into the shooter',()=>{
 const {system:s,world:w,E,P,P2}=arena();E.x=150;E.y=350;E.a=0;P.x=900;P.y=350;P2.alive=false;w.walls=[{x:230,y:0,w:14,h:700}];s.equip(w,E,'shotgun');
 const before=JSON.stringify({tanks:w.tanks,bullets:w.bullets}),shot=s.preview(w,E,0,P),a=s.advice(w,E,P);
 assert.equal(shot.outOfRange,true);assert.equal(shot.hit,false);assert.equal(shot.selfHit,true);assert.ok(shot.selfHitIn<.6);assert.equal(a.pattern.pathRange,330);assert.equal(a.pattern.wholeVolley,true);assert.ok(a.score<0);assert.equal(JSON.stringify({tanks:w.tanks,bullets:w.bullets}),before);
});

test('a pellet hitting the opponent does not hide the rest of the volley killing its owner',()=>{
 const {system:s,world:w,E,P,P2,step}=arena();E.x=1000;E.y=350;E.a=0;P.x=1060;P.y=375;P2.alive=false;s.equip(w,E,'shotgun');
 const p=s.preview(w,E,0,P);assert.ok(p.hitIds.includes('P'));assert.equal(p.selfHit,true);assert.equal(p.hit,false);
 s.fire(w,E);step(1.1);assert.equal(P.alive,false);assert.equal(E.alive,false);
});

test('shield timing distinguishes a nearby departing shell from an incoming own rebound',()=>{
 const {system:s,world:w,E,P,P2}=arena();P2.alive=false;E.x=550;E.y=350;P.x=100;P.y=100;P.live=5;s.equip(w,E,'shield');
 w.bullets=[{id:40,kind:'normal',own:'P',x:600,y:350,vx:128,vy:0,life:1,radius:6}];const outgoing=s.advice(w,E,P);assert.equal(outgoing.incomingEta,null);assert.ok(outgoing.score<0);
 w.bullets=[{id:41,kind:'normal',own:'E',x:650,y:350,vx:-128,vy:0,life:1,radius:6}];const incoming=s.advice(w,E,P);assert.ok(incoming.incomingEta<1);assert.ok(incoming.score>0);assert.equal(E.weapon.type,'shield');assert.equal(E.shieldUntil,0);
});

test('mine placement compares chokepoints, traffic, exits and existing coverage without exposing hidden mines',()=>{
 const {system:s,world:w,E,P,P2}=arena();P2.alive=false;E.x=550;E.y=350;E.a=0;P.x=250;P.y=350;P.vx=100;P.vy=0;
 w.walls=[{x:0,y:270,w:1100,h:20},{x:0,y:410,w:1100,h:20}];s.equip(w,E,'mine');
 const before=JSON.stringify(w),a=s.advice(w,E,P);assert.equal(a.deployment,true);assert.ok(a.placement.choke>0);assert.ok(a.placementOptions.some(p=>p.score>0&&p.escape));assert.equal(JSON.stringify(w),before);assert.equal(s.mines.length,0);
 s.mines.push({id:88,own:'P',x:a.placementOptions[0].x,y:a.placementOptions[0].y,armedAt:-1,expires:24});assert.deepEqual(s.advice(w,E,P),a);
 s.mines[0].own='E';const b=s.advice(w,E,P);assert.ok(b.placementOptions[0].x!==a.placementOptions[0].x||b.placementOptions[0].y!==a.placementOptions[0].y);
});

test('death ray is a bounded gently bending column and remains lethal behind its tip',()=>{
 const {system:s,world:w,E,P,P2,step}=arena();E.x=150;E.y=350;E.a=0;P.x=750;P.y=390;P2.alive=false;w.walls=[{x:400,y:0,w:14,h:700}];s.equip(w,E,'deathray');
 assert.equal(s.preview(w,E,0,P).hit,true);s.fire(w,E);step(.8);const b=w.bullets[0];assert.ok(b.rayPath.length>5);assert.ok(b.y>350);assert.ok(Math.atan2(b.vy,b.vx)<=.070001);assert.ok(s.beams[0].path[0].x<190);
 P2.alive=true;P2.x=300;P2.y=351;step(.01);assert.equal(P2.alive,false,'entering the lit column behind the head deals damage');step(.4);assert.equal(P.alive,false);assert.equal(w.bullets.length,0);assert.equal(E.alive,true);
});

test('curved ray forecasts and live motion agree without mutating the accumulated column',()=>{
 const {system:s,world:w,E,P,P2,step}=arena();E.x=150;E.y=350;E.a=0;P.x=750;P.y=390;P2.alive=false;s.equip(w,E,'deathray');s.fire(w,E);step(.7);
 const before=JSON.stringify(w.bullets),future=s.forecast(w,.05,.05);assert.equal(JSON.stringify(w.bullets),before);
 const clone=new Function('return '+Weapons.sandboxSource())();assert.deepEqual(clone.create().preview(w,{...E,weapon:{type:'deathray',ammo:1}},0,P),s.preview(w,{...E,weapon:{type:'deathray',ammo:1}},0,P));
 w.time+=.05;s.update(w,.05,false);const head=future.frames[0].points.find(p=>p.vx>2000);assert.ok(head);const live=w.bullets[0];assert.ok(future.frames[0].points.filter(p=>p.vx>2000).some(p=>Math.hypot(p.x-live.x,p.y-live.y)<.001));
});

test('death ray locks the firing tank for the live column and releases it on reaching the border',()=>{
 const {system:s,world:w,E,P,P2,step}=arena();E.x=150;E.y=350;P.x=900;P.y=600;P2.alive=false;s.equip(w,E,'deathray');s.fire(w,E);step(.85);
 assert.equal(s.locked(w,E),true);assert.ok(s.snapshot(w,'E').tanks.find(t=>t.id==='E').lockRemaining>0);step(.4);assert.equal(s.locked(w,E),false);assert.equal(s.lockRemaining(w,E),0);
});
