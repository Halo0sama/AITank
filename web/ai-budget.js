(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.AITankBudget=api})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  // Scheduling only: never chooses a target, move, pickup, or fire action.
  const minInterval=6000,maxInterval=20000;
  function marker(s){
    const resource=t=>[t.id,t.alive,t.weapon?.type||null,t.weapon?.ammo===0,Math.min(2,Math.ceil(t.ammo/2)),!!t.shield];
    return JSON.stringify([s.round,s.target,s.tactic,s.goalStatus,!!s.stuck,s.fault||null,!!s.danger,s.near,s.visible,
      s.tanks.map(resource),s.pickups.map(p=>p.id).sort()]);
  }
  function due(now,last,current){
    if(!last)return '首次指挥';
    if(now-last.time<minInterval)return null;
    if(current!==last.marker)return '战局变化';
    if(now-last.time>=maxInterval)return '定期检查';
    return null;
  }
  function pack(s){
    // Preserve every actual projectile; only repeated column names are removed.
    const columns=['id','x','y','vx','vy','life','own','kind','radius','seekAt','pierceWalls','rayPath'];
    const projectiles={columns,rows:s.bullets.map(b=>columns.map(k=>b[k]??null))};
    return {...s,bullets:projectiles};
  }
  return Object.freeze({minInterval,maxInterval,marker,due,pack});
});
