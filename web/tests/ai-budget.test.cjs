const test=require('node:test'),assert=require('node:assert/strict'),Budget=require('../ai-budget.js');

const state=()=>({round:1,target:'P',tactic:'learned',goalStatus:'moving',stuck:false,danger:false,near:2,visible:false,
  tanks:[{id:'E',alive:true,ammo:5},{id:'P',alive:true,ammo:5}],pickups:[]});
test('economy dispatch waits through ordinary motion and responds to tactical changes with a bounded cadence',()=>{
  const s=state(),mark=Budget.marker(s),last={time:100,marker:mark};
  assert.equal(Budget.due(100,null,mark),'首次指挥');
  s.tanks[0].x=600;assert.equal(Budget.marker(s),mark);
  assert.equal(Budget.due(6099,last,mark),null);assert.equal(Budget.due(20099,last,mark),null);
  assert.equal(Budget.due(20100,last,mark),'定期检查');
  for(const mutate of [s=>s.pickups.push({id:4}),s=>s.tanks[1].weapon={type:'laser',ammo:1},s=>s.tanks[0].ammo=0,s=>s.goalStatus='arrived',s=>s.stuck=true,s=>s.fault='bad_code',s=>s.near=0,s=>s.tanks[1].alive=false]){
    const next=state();mutate(next);const changed=Budget.marker(next);assert.notEqual(changed,mark);
    assert.equal(Budget.due(6099,last,changed),null);assert.equal(Budget.due(6100,last,changed),'战局变化');
  }
});
test('economy packets preserve every projectile and beam geometry without selecting actions',()=>{
  const s={self:{x:100,y:100},enemies:[{id:'P',x:500,y:300}],bullets:Array.from({length:130},(_,i)=>({id:i,x:i,y:i+1,vx:128,vy:-50,life:4,own:i%2?'P':'E',kind:'pellet',radius:2}))};
  s.bullets.push({id:131,x:10,y:20,kind:'deathray',rayPath:[{x1:0,y1:0,x2:10,y2:20}],pierceWalls:true});
  const original=JSON.stringify(s),p=Budget.pack(s);assert.equal(p.bullets.rows.length,131);assert.equal(JSON.stringify(s),original);
  const unpack=row=>Object.fromEntries(p.bullets.columns.map((name,i)=>[name,row[i]]));
  for(let i=0;i<130;i++)for(const key of Object.keys(s.bullets[i]))assert.deepEqual(unpack(p.bullets.rows[i])[key],s.bullets[i][key]);
  assert.deepEqual(unpack(p.bullets.rows[130]).rayPath,s.bullets[130].rayPath);assert.deepEqual(p.enemies,s.enemies);
  assert.equal(p.moveTo,undefined);assert.equal(p.fire,undefined);
});
