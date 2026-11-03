const test=require('node:test'),assert=require('node:assert/strict'),T=require('../ai-tactics.js'),Ammo=require('../ai-ammo.js');
const state=()=>({time:0,width:1100,height:700,walls:[],bullets:[],self:{id:'E',x:200,y:350,a:0,ammo:0},enemy:{id:'P',x:450,y:350,a:Math.PI,ammo:5,vx:0,vy:0},constants:{cellSize:100,tankRadius:23.4,bulletRadius:6,tankSpeed:100,bulletSpeed:128,rotationSpeed:Math.PI,bulletLifetime:15,magazineSize:5}});
test('route and pickup scores use wall geometry and reject unreachable boxes',()=>{
 const s=state();s.walls=[{x:300,y:0,w:14,h:700}];assert.equal(T.route(s,{x:450,y:350}),null);assert.equal(T.pickup(s,[{id:1,type:'laser',x:450,y:350}]),null);
 s.walls[0].h=450;const path=T.route(s,{x:450,y:350});assert.ok(path.distance>250);assert.ok(path.point.y>350);
});
test('empty resources favour a safe useful pickup and cover rather than facing a loaded enemy',()=>{
 const s=state();s.walls=[{x:300,y:100,w:14,h:130}];const r=Ammo.observe(s),box=T.pickup(s,[{id:1,type:'laser',x:200,y:250}]);assert.ok(box.score>.3);
 const retreat=T.reposition(s,r);assert.ok(retreat.score>.22);assert.ok(Math.hypot(retreat.goal.x-s.enemy.x,retreat.goal.y-s.enemy.y)>250||retreat.cover);
 s.enemy.ammo=0;s.self.ammo=5;assert.ok(T.readiness(s.self).attack>T.readiness(s.enemy).attack);
 s.enemy.weapon={type:'shotgun',ammo:3};assert.equal(T.readiness(s.enemy).attack,1);assert.equal(Ammo.observe(s).opponentAttackReady,1);
});
test('multi-shot planning measures marginal escape-route coverage, is pure and uses no random future inputs',()=>{
 const s=state();s.self.ammo=3;s.enemy.x=600;s.enemy.y=300;s.bullets=[{id:1,own:'E',x:400,y:300,vx:128,vy:0,life:4},{id:2,own:'E',x:550,y:150,vx:0,vy:128,life:4}];
 const before=JSON.stringify(s),plan=T.firePlan(s,Ammo.observe(s));assert.equal(JSON.stringify(s),before);assert.ok(plan.horizon>=4);assert.ok(plan.marginalCoverage>0);assert.ok(plan.combinedCoverage>plan.existingCoverage);assert.equal(plan.role,'deny_escape');assert.ok(Number.isFinite(plan.angle));
});
test('coverage without ordinary bullets still permits useful attack and never invents infinite ammunition',()=>{
 const s=state();s.self.ammo=1;const r=Ammo.observe(s),plan=T.firePlan(s,r);assert.equal(r.available,1);assert.ok(plan.marginalCoverage>0);assert.equal(plan.existingCoverage,0);
 s.self.weapon={type:'shield',ammo:1};assert.equal(T.readiness(s.self).attack,0);assert.equal(T.readiness(s.self).defense,1);
});

test('pickup advice exposes all reachable options without mutating state or imposing a score cutoff',()=>{
 const s=state();s.self.ammo=5;const boxes=[{id:1,type:'shield',x:200,y:300},{id:2,type:'remote',x:1000,y:600}],before=JSON.stringify({s,boxes});
 const options=T.pickupOptions(s,boxes);
 assert.equal(JSON.stringify({s,boxes}),before);assert.equal(options.length,2);assert.equal(options[0].id,1);assert.ok(options[1].score<0);
});
