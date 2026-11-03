// Deterministic input driver for isolated tests. No LLM, learned programs, hidden
// state, teleportation, extra ammunition or changes to the combat simulation.
window.scriptedOpponent=function(dt){
  const t=P,target=E,w=weaponWorld();if(!t.alive)return;
  heldFire.P.delete('test-driver');
  const remote=weapons.remote(w,t);if(remote){const hop=AITankWeapons.route(w,remote,target);weapons.steerRemote(w,t,Math.atan2(hop.y-remote.y,hop.x-remote.x),dt);return}
  if(weapons.locked(w,t))return;
  const nearest=weapons.pickups.filter(p=>weapons.canEquip(w,t,p.type)).sort((a,b)=>Math.hypot(a.x-t.x,a.y-t.y)-Math.hypot(b.x-t.x,b.y-t.y))[0];
  const distance=Math.hypot(target.x-t.x,target.y-t.y),phase=Math.floor(gT/1.7)%2?1:-1;
  const targetPoint=nearest||{x:target.x+Math.cos(gT*.8)*160,y:target.y+Math.sin(gT*.8)*160};
  const hop=AITankWeapons.route(w,{x:t.x,y:t.y,radius:TR},targetPoint),a=Math.atan2(hop.y-t.y,hop.x-t.x);
  let aim=Math.atan2(target.y-t.y,target.x-t.x),move=1;
  const incoming=bullets.find(b=>b.own!==t.id&&Math.hypot(b.x-t.x,b.y-t.y)<180);
  if(incoming){aim=Math.atan2(-incoming.vx,incoming.vy)+phase*.25;move=1}
  else if(nearest||distance>300)aim=a;
  else if(t.live>=MAG)aim+=phase*Math.PI/2;
  else move=distance<130?-1:.65;
  const change=angDiff(aim,t.a);t.a+=Math.sign(change)*Math.min(Math.abs(change),ROT*dt);drive(t,dt,move);
  if(t.weapon?.type==='shield'){if(incoming||distance<400)fire(t);return}
  if(t.weapon?.type==='mine'){if(distance<350)fire(t);return}
  if(t.weapon?.projectileId){const bomb=bullets.find(b=>b.id===t.weapon.projectileId);if(bomb&&Math.hypot(bomb.x-target.x,bomb.y-target.y)<100&&Math.hypot(bomb.x-t.x,bomb.y-t.y)>100)fire(t);return}
  if(t.weapon?.type==='gatling'&&Math.abs(angDiff(Math.atan2(target.y-t.y,target.x-t.x),t.a))<.35){heldFire.P.add('test-driver');fire(t);return}
  if(Math.abs(angDiff(Math.atan2(target.y-t.y,target.x-t.x),t.a))<.25)fire(t);
};
