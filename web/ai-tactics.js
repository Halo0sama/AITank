(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.AITankTactics=api})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),diff=(a,b)=>Math.atan2(Math.sin(a-b),Math.cos(a-b));
  const blocked=(s,x,y,r)=>x<r||y<r||x>s.width-r||y>s.height-r||s.walls.some(w=>x+r>w.x&&x-r<w.x+w.w&&y+r>w.y&&y-r<w.y+w.h);
  function clear(s,a,b,r=s.constants.tankRadius){const n=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.y-a.y)/12));for(let i=0;i<=n;i++)if(blocked(s,a.x+(b.x-a.x)*i/n,a.y+(b.y-a.y)*i/n,r))return false;return true}
  // The same geometry used by the simulation, independent of generated maze arrays.
  function route(s,goal,from=s.self){
    if(clear(s,from,goal))return{distance:Math.hypot(goal.x-from.x,goal.y-from.y),point:goal};
    const size=s.constants.cellSize||100,cols=Math.ceil(s.width/size),rows=Math.ceil(s.height/size),key=(x,y)=>x+','+y;
    const start=[Math.floor(from.x/size),Math.floor(from.y/size)],end=[Math.floor(goal.x/size),Math.floor(goal.y/size)],q=[start],prev=new Map([[key(...start),null]]),dist=new Map([[key(...start),0]]);
    const point=cell=>({x:(cell[0]+.5)*size,y:(cell[1]+.5)*size});
    for(let i=0;i<q.length;i++){const cell=q[i];if(key(...cell)===key(...end))break;
      for(const n of[[cell[0]-1,cell[1]],[cell[0]+1,cell[1]],[cell[0],cell[1]-1],[cell[0],cell[1]+1]]){
        if(n[0]<0||n[1]<0||n[0]>=cols||n[1]>=rows||prev.has(key(...n)))continue;
        if(!clear(s,key(...cell)===key(...start)?from:point(cell),point(n)))continue;
        prev.set(key(...n),cell);dist.set(key(...n),dist.get(key(...cell))+size);q.push(n);
      }
    }
    if(!prev.has(key(...end))||!clear(s,point(end),goal))return null;
    let cell=end;while(prev.get(key(...cell))&&key(...prev.get(key(...cell)))!==key(...start))cell=prev.get(key(...cell));
    return{distance:dist.get(key(...end))+Math.hypot(goal.x-point(end).x,goal.y-point(end).y),point:point(cell)};
  }
  function readiness(t,capacity=5){
    const special=t.weapon,normal=clamp((t.ammo??capacity)/capacity,0,1);
    return special?(special.type==='shield'||special.slot==='buff')?{attack:0,defense:1}:{attack:clamp(special.ammo/(special.capacity||{gatling:30,double:10,shotgun:3,mine:3}[special.type]||1),0,1),defense:0}:{attack:normal,defense:0};
  }
  function pickupOptions(s,boxes,previous){
    const options=[];const ready=readiness(s.self).attack;
    for(const box of boxes){const path=route(s,box);if(!path)continue;const seconds=path.distance/s.constants.tankSpeed;if(box.expires&&seconds>box.expires-s.time)continue;
      const distance=Math.hypot(s.enemy.x-box.x,s.enemy.y-box.y),armed=readiness(s.enemy).attack,exposed=clear(s,box,s.enemy,3)?armed*.7/(1+distance/220):0;
      const closeThreat=s.bullets.filter(b=>b.own!==s.self.id&&Math.hypot(b.x-box.x,b.y-box.y)<100).length*.25;
      const fit=box.type==='shield'?.55:box.type==='shotgun'&&distance<350?.85:box.type==='remote'&&distance<180?-.3:.65;
      const score=fit+(1-ready)*.65-seconds*.13-exposed-closeThreat+(previous?.id===box.id?.18:0);
      options.push({...box,score,seconds,point:path.point,reason:'比较路径耗时、敌方火力、拾取收益与暴露风险'});
    }return options.sort((a,b)=>b.score-a.score);
  }
  function pickup(s,boxes,previous){return pickupOptions(s,boxes,previous)[0]||null;
  }
  function reposition(s,resources,previous){
    const attack=readiness(s.self).attack,enemy=readiness(s.enemy).attack,scarcity=1-attack,pressure=resources.pressure||0;
    const distance=Math.hypot(s.self.x-s.enemy.x,s.self.y-s.enemy.y),angle=Math.atan2(s.self.y-s.enemy.y,s.self.x-s.enemy.x);
    const options=[];
    for(const da of[0,.7,-.7,1.4,-1.4,Math.PI]){
      const goal={x:clamp(s.self.x+Math.cos(angle+da)*180,30,s.width-30),y:clamp(s.self.y+Math.sin(angle+da)*180,30,s.height-30)},path=route(s,goal);if(!path)continue;
      const cover=clear(s,goal,s.enemy,4)?0:1,range=Math.hypot(goal.x-s.enemy.x,goal.y-s.enemy.y)-distance;
      const score=scarcity*enemy*(cover*1.3+clamp(range/180,-1,1)*.65)+pressure*clamp(-range/180,-1,1)*.7-path.distance/1200-.12+(previous?.goal&&Math.hypot(previous.goal.x-goal.x,previous.goal.y-goal.y)<50?.15:0);
      options.push({goal,point:path.point,score,cover,reason:cover?'利用掩体等待弹药归还':'改变距离与射角，比较在途压制和敌方火力'});
    }return options.sort((a,b)=>b.score-a.score)[0]||null;
  }
  const segmentDistance=(p,a,b)=>{const dx=b.x-a.x,dy=b.y-a.y,t=clamp(((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy||1),0,1);return Math.hypot(p.x-a.x-dx*t,p.y-a.y-dy*t)};
  // Receding-horizon coverage of feasible escape routes; no access to future inputs.
  function firePlan(s,resources){
    const c=s.constants,e=s.enemy,dt=.15,horizon=4.2,n=Math.ceil(horizon/dt),paths=[];
    const heading=Math.hypot(e.vx||0,e.vy||0)>10?Math.atan2(e.vy,e.vx):e.a;
    for(const turn of[heading,heading+.7,heading-.7,heading+1.5,heading-1.5])for(const move of[1,-1]){
      let x=e.x,y=e.y,a=e.a;const points=[];
      const rotation=e.motion?.rotationSpeed??c.rotationSpeed,speed=e.motion?.tankSpeed??c.tankSpeed;
      for(let i=0;i<n;i++){a+=clamp(diff(turn,a),-rotation*dt,rotation*dt);const d=speed*move*(move<0?.65:1)*dt,nx=x+Math.cos(a)*d,ny=y+Math.sin(a)*d;if(!blocked(s,nx,y,c.tankRadius))x=nx;if(!blocked(s,x,ny,c.tankRadius))y=ny;points.push({x,y})}paths.push(points);
    }
    paths.push(Array.from({length:n},()=>({x:e.x,y:e.y})));
    function sample(shell){let {x,y,vx,vy,life}=shell;const frames=[];
      for(let i=0;i<n;i++){const segments=[];if((life-=dt)<=0){frames.push(segments);continue}const count=Math.max(1,Math.ceil(Math.hypot(vx,vy)*dt/8));
        for(let j=0;j<count;j++){const a={x,y},nx=x+vx*dt/count,ny=y+vy*dt/count;if(blocked(s,nx,y,shell.radius||c.bulletRadius))vx=-vx;else x=nx;if(blocked(s,x,ny,shell.radius||c.bulletRadius))vy=-vy;else y=ny;segments.push([a,{x,y}])}frames.push(segments);
      }return frames;
    }
    function coverage(frames){return paths.map(path=>path.some((point,i)=>frames[i].some(([a,b])=>segmentDistance(point,a,b)<c.tankRadius+c.bulletRadius+4)))}
    const occupied=paths.map(()=>false);
    for(const shell of resources.projectiles.filter(b=>b.slot!==false)){const hits=coverage(sample(shell));hits.forEach((hit,i)=>{occupied[i]||=hit})}
    const base=Math.atan2(e.y-s.self.y,e.x-s.self.x),angles=[s.self.a,...[0,.16,-.16,.35,-.35,.65,-.65].map(d=>base+d)];
    // Nearby passages can be covered without aiming at the opponent's current centre.
    for(const p of[{x:e.x+100,y:e.y},{x:e.x-100,y:e.y},{x:e.x,y:e.y+100},{x:e.x,y:e.y-100}])if(!blocked(s,p.x,p.y,c.tankRadius))angles.push(Math.atan2(p.y-s.self.y,p.x-s.self.x));
    const existing=occupied.filter(Boolean).length/paths.length;let best=null;
    for(const angle of angles){const muzzle={x:s.self.x+Math.cos(angle)*(c.tankRadius+c.bulletRadius+2),y:s.self.y+Math.sin(angle)*(c.tankRadius+c.bulletRadius+2)};if(blocked(s,muzzle.x,muzzle.y,c.bulletRadius))continue;
      const frames=sample({...muzzle,vx:Math.cos(angle)*c.bulletSpeed,vy:Math.sin(angle)*c.bulletSpeed,life:c.bulletLifetime||15});
      // A planned rebound through the shooter's present position is too risky.
      if(frames.slice(1).some(frame=>frame.some(([a,b])=>segmentDistance(s.self,a,b)<c.tankRadius+c.bulletRadius)))continue;
      const hits=coverage(frames),marginal=hits.filter((hit,i)=>hit&&!occupied[i]).length/paths.length,combined=hits.filter((hit,i)=>hit||occupied[i]).length/paths.length;
      const turnCost=Math.abs(diff(angle,s.self.a))*.12,slotCost=(.18+.45*(1-(resources.available||0)/(resources.capacity||5)))*(s.gunneryMode==='pressure'?.3:s.gunneryMode==='conserve'?1.5:1);
      const synergy=existing>0?marginal*combined*.9:0,score=marginal*1.5+synergy-slotCost-turnCost;
      const result={angle,score,marginalCoverage:marginal,existingCoverage:existing,combinedCoverage:combined,horizon,role:existing>0&&marginal>0?'deny_escape':'intercept',reason:'对多个可行逃逸轨迹比较已有弹道与新弹的联合覆盖；滚动重算'};
      if(!best||score>best.score)best=result;
    }return best;
  }
  return{route,clear,readiness,pickup,pickupOptions,reposition,firePlan};
});
