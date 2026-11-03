(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.AITankAmmo=api})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
  const attack=t=>t.weapon?((t.weapon.type==='shield'||t.weapon.slot==='buff')?0:clamp(t.weapon.ammo/(t.weapon.capacity||{gatling:30,double:10,shotgun:3,mine:3}[t.weapon.type]||1),0,1)):clamp((t.ammo||0)/5,0,1);
  const ours=b=>b.own==='E'||b.owner==='self';
  function trace(state,shell,target=state.enemy,moving=true){
    const c=state.constants,r=c.tankRadius+c.bulletRadius,dt=1/30;
    const blocked=(x,y,rad)=>x<rad||y<rad||x>state.width-rad||y>state.height-rad||state.walls.some(w=>x+rad>w.x&&x-rad<w.x+w.w&&y+rad>w.y&&y-rad<w.y+w.h);
    let x=shell.x,y=shell.y,vx=shell.vx,vy=shell.vy,tx=target.x,ty=target.y;
    let gap=Infinity,eta=null,returnIn=null;
    for(let time=dt;time<=Math.min(6,shell.life)+.0001;time+=dt){
      if(moving){const nx=tx+(target.vx||0)*dt,ny=ty+(target.vy||0)*dt;if(!blocked(nx,ty,c.tankRadius))tx=nx;if(!blocked(tx,ny,c.tankRadius))ty=ny}
      for(let sub=0;sub<2;sub++){
        const nx=x+vx*dt/2;if(blocked(nx,y,c.bulletRadius))vx=-vx;else x=nx;
        const ny=y+vy*dt/2;if(blocked(x,ny,c.bulletRadius))vy=-vy;else y=ny;
      }
      const d=Math.hypot(x-tx,y-ty);
      if(d<gap){gap=d;eta=time}
      if(d<r){returnIn=time;break}
      const other=(state.enemies||[]).find(t=>t.alive!==false&&t.id!==target.id&&Math.hypot(x-t.x,y-t.y)<r);
      if(other){returnIn=time;if(ours(shell)){gap=0;eta=time}break}
      if(Math.hypot(x-state.self.x,y-state.self.y)<r){returnIn=time;break}
    }
    const quality=gap===Infinity?0:Math.exp(-Math.pow(gap/(r+8),2)/2);
    return{quality,eta:eta===null?null:Number(eta.toFixed(2)),returnInEstimate:returnIn===null?shell.life:Number(returnIn.toFixed(2))};
  }
  function observe(state){
    const capacity=state.constants.magazineSize||5;
    const projectiles=state.bullets.filter(b=>b.life>0&&ours(b)).map(b=>({...b,...trace(state,b)}));
    const hostile=state.bullets.filter(b=>b.life>0&&!ours(b));
    const incoming=hostile.map(b=>trace({...state,self:state.enemy},b,state.self,false));
    const slots=projectiles.filter(b=>b.slot!==false),nextReturn=slots.length?Math.min(...slots.map(b=>b.returnInEstimate)):null;
    const nextExpiry=slots.length?Math.min(...slots.map(b=>b.life)):null;
    const pressure=clamp(projectiles.reduce((sum,b)=>sum+b.quality/(1+(b.eta||0)),0),0,1);
    const danger=clamp(incoming.reduce((sum,b)=>sum+b.quality/(1+(b.eta||0)),0),0,1);
    const approaching=incoming.filter(b=>b.quality>.7&&b.eta!==null);
    return{capacity,available:state.self.ammo,inFlight:slots.length,specialInFlight:projectiles.length-slots.length,weapon:state.self.weapon||null,nextReturnInEstimate:nextReturn,nextExpiryIn:nextExpiry,
      opponentAttackReady:attack(state.enemy),opponentAvailable:state.enemy.ammo,opponentInFlight:hostile.length,opponents:(state.enemies||[state.enemy]).map(t=>({id:t.id,alive:t.alive!==false,available:t.ammo,attackReady:attack(t),inFlight:hostile.filter(b=>b.own===t.id).length})),pressure,danger,
      incomingEta:approaching.length?Math.min(...approaching.map(b=>b.eta)):null,projectiles};
  }
  function scoreShot(state,resources,angle=state.self.a,target=state.enemy){
    const c=state.constants,s=state.self,r=c.tankRadius+c.bulletRadius;
    const muzzle={x:s.x+Math.cos(angle)*(r+2),y:s.y+Math.sin(angle)*(r+2)};
    const proposed=trace(state,{...muzzle,own:'E',vx:Math.cos(angle)*c.bulletSpeed,vy:Math.sin(angle)*c.bulletSpeed,life:c.bulletLifetime||15},target,false);
    let redundancy=0;
    for(const b of resources.projectiles){
      const speed=Math.hypot(b.vx,b.vy)||1,alignment=Math.max(0,(b.vx*Math.cos(angle)+b.vy*Math.sin(angle))/speed);
      const cross=Math.abs((b.x-muzzle.x)*Math.sin(angle)-(b.y-muzzle.y)*Math.cos(angle));
      const lane=Math.pow(alignment,8)*Math.exp(-Math.pow(cross/(r*2),2)/2);
      const timeOverlap=Math.exp(-Math.pow(((proposed.eta||0)-(b.eta||0))/1.2,2)/2);
      redundancy=Math.max(redundancy,Math.max(lane,b.quality*.8)*timeOverlap);
    }
    const ready=clamp(resources.available/resources.capacity,0,1),scarcity=1-ready;
    const distance=Math.hypot(state.enemy.x-s.x,state.enemy.y-s.y),close=clamp(1-distance/350,0,1);
    const urgency=resources.incomingEta===null?0:clamp(1-resources.incomingEta/1.2,0,1);
    const mode=state.gunneryMode||'auto',spending=mode==='pressure'?.25:mode==='conserve'?1.6:1;
    const duplicateWeight=mode==='pressure'?.2:mode==='conserve'?1.2:1;
    const shieldPenalty=state.enemy.shieldUntil>state.time+(proposed.eta||0)?.9:0;
    const hitValue=proposed.quality*(1.4+close*.7+urgency*.8)*(1-shieldPenalty);
    const slotCost=(.12+.65*scarcity*scarcity+.25*clamp((resources.nextReturnInEstimate??15)/15,0,1)+.25*Math.max(0,(resources.opponentAvailable||0)/resources.capacity-ready))*spending;
    const duplicateCost=redundancy*(1.8+.4*scarcity)*duplicateWeight;
    const newCoverageValue=(1-redundancy)*proposed.quality*.25;
    const score=hitValue+newCoverageValue-slotCost-duplicateCost;
    return{score,hitValue,slotCost,duplicateCost,newCoverageValue,redundancy,hitQuality:proposed.quality,eta:proposed.eta,mode,
      reason:score>0?(urgency>.4?'来弹紧迫，还击价值高':'新增射击机会'):(redundancy>.5?'已有子弹覆盖相近弹道，等待或换射角':'当前命中收益低于弹药机会成本')};
  }
  function movement(state,resources){
    const capacity=resources.capacity,weapon=state.self.weapon;
    const ready=attack(state.self),scarcity=1-ready;
    const distance=Math.hypot(state.enemy.x-state.self.x,state.enemy.y-state.self.y);
    const pursuit=clamp((distance-120)/500,0,1),pressure=resources.pressure;
    const enemyReady=resources.opponents?.length>1?resources.opponents.filter(t=>t.alive).reduce((sum,t)=>sum+(t.attackReady??t.available/capacity)*capacity,0):(resources.opponentAttackReady??(resources.opponentAvailable||0)/capacity)*capacity;
    const risk=clamp(enemyReady/capacity*(1-pressure*.8)+resources.danger,0,1.5);
    const mode=state.gunneryMode||'auto';
    const scores={advance:pursuit*(.45+ready+pressure*.6)-risk*scarcity*(.5+.5*clamp(1-distance/500,0,1))+(mode==='pressure'?.35:mode==='conserve'?-.15*scarcity:0),
      hold:.05+.15*scarcity,back:risk*scarcity*.8-pursuit*.25-pressure*.3};
    const preferred=Object.keys(scores).reduce((a,b)=>scores[a]>=scores[b]?a:b);
    return{scores,preferred,move:preferred==='advance'?1:preferred==='back'?-1:0};
  }
  return{observe,scoreShot,movement};
});
