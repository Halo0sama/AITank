(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.AITankDodge=api})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  // This function is self-contained so the coach can edit its source in an isolated Worker.
  function plan(state,memory={}){
    const c=state.constants,s=state.self,step=.05;
    const radius=c.tankRadius+c.bulletRadius,angleDiff=(a,b)=>Math.atan2(Math.sin(a-b),Math.cos(a-b));
    const e=state.enemy,distance=Math.hypot(e.x-s.x,e.y-s.y),mode=state.combat?.mode||'auto';
    const fighting=mode!=='evade'&&(s.ammo>0||s.weapon?.ammo>0||s.weapon?.projectileId)&&e.alive!==false&&distance<=(mode==='duel'?350:250);
    const shotValue=Number.isFinite(state.gunnery?.current?.score)?Math.max(.05,Math.min(1.5,(state.gunnery.current.score+.5)/1.8)):1;
    const horizon=distance<=350?1.3:Math.max(.55,Math.min(1.1,(state.threat?.eta||.55)+.25));
    const bodies=state.enemies||[state.enemy];
    const blocked=(x,y,r,body=false)=>x<r||y<r||x>state.width-r||y>state.height-r||state.walls.some(w=>x+r>w.x&&x-r<w.x+w.w&&y+r>w.y&&y-r<w.y+w.h)||(body&&bodies.some(t=>t.alive!==false&&Math.hypot(x-t.x,y-t.y)<c.tankRadius*2));
    const canAim=(x,y,a,time)=>{
      const tx=e.x+(e.vx||0)*time,ty=e.y+(e.vy||0)*time,d=Math.hypot(tx-x,ty-y);
      if(d<radius||Math.abs(angleDiff(Math.atan2(ty-y,tx-x),a))>Math.asin(Math.min(1,radius/d)))return false;
      for(let n=c.tankRadius+c.bulletRadius+2;n<d;n+=10)if(blocked(x+Math.cos(a)*n,y+Math.sin(a)*n,c.bulletRadius))return false;
      return true;
    };
    const frames=[],shells=state.bullets.map(b=>({...b}));
    const simulated=state.ballistics?.frames;
    if(simulated?.length){for(let time=step;time<=horizon+step/2;time+=step){const frame=simulated.find(f=>f.time>=state.time+time-.001);frames.push(frame?frame.points:[])}}
    else for(let time=step;time<=horizon+step/2;time+=step){
      for(const b of shells){
        b.life-=step;if(b.life<=0)continue;
        for(let sub=0;sub<3;sub++){
          const nx=b.x+b.vx*step/3;if(blocked(nx,b.y,c.bulletRadius))b.vx=-b.vx;else b.x=nx;
          const ny=b.y+b.vy*step/3;if(blocked(b.x,ny,c.bulletRadius))b.vy=-b.vy;else b.y=ny;
        }
      }
      frames.push(shells.filter(b=>b.life>0).map(b=>({x:b.x,y:b.y})));
    }
    const evaluate=(turn,move)=>{
      let x=s.x,y=s.y,a=s.a,clearance=200,hitTime=Infinity,blockedSteps=0,minePenalty=0;
      let shotTime=fighting&&s.cooldown<=0&&canAim(x,y,a,0)?0:Infinity,aimSeconds=0;
      for(let i=0;i<frames.length;i++){
        const difference=angleDiff(turn,a);a+=Math.sign(difference)*Math.min(Math.abs(difference),c.rotationSpeed*step);
        const oldX=x,oldY=y,speed=c.tankSpeed*move*(move<0?.65:1);
        const nx=x+Math.cos(a)*speed*step;if(!blocked(nx,y,c.tankRadius,true))x=nx;
        const ny=y+Math.sin(a)*speed*step;if(!blocked(x,ny,c.tankRadius,true))y=ny;
        if(Math.hypot(x-oldX,y-oldY)<.01)blockedSteps++;
        for(const b of frames[i]){
          const r=c.tankRadius+(b.radius??c.bulletRadius),reach=clearance+r,dx=b.x-x,dy=b.y-y,squared=dx*dx+dy*dy;
          if(reach<=0||squared>=reach*reach)continue;
          const gap=Math.sqrt(squared)-r;clearance=gap;if(gap<0&&hitTime===Infinity)hitTime=(i+1)*step;
        }
        for(const mine of state.weapons?.mines||[]){
          if(mine.armedAt>state.time+(i+1)*step||s.shieldUntil>state.time+(i+1)*step)continue;
          const d=Math.hypot(x-mine.x,y-mine.y),start=Math.hypot(s.x-mine.x,s.y-mine.y);
          if(d<c.tankRadius+11&&!mine.triggerId)minePenalty=180;
          if(mine.triggerId===s.id&&start<c.tankRadius+11&&d>=c.tankRadius+11&&hitTime===Infinity)hitTime=(i+1)*step;
        }
        const time=(i+1)*step;
        if(fighting&&time<hitTime&&canAim(x,y,a,time)){aimSeconds+=step;if(time>=s.cooldown&&shotTime===Infinity)shotTime=time}
      }
      const displacement=Math.hypot(x-s.x,y-s.y);
      const continuity=state.continuity&&state.time-state.continuity.time<.5?state.continuity:memory;
      const reversing=move&&continuity.move&&Math.sign(move)!==Math.sign(continuity.move);
      const changeCost=(reversing?32:0)+(Number.isFinite(continuity.turn)?Math.abs(angleDiff(turn,continuity.turn))*5:0);
      const anticipated=state.opponentThreats?.motions?.find(m=>m.move===move&&Math.abs(angleDiff(m.turn,turn))<.1),anticipatedRisk=anticipated?.risk||0;
      const score=-changeCost+(hitTime===Infinity?0:-800-(horizon-hitTime)*400)+Math.min(fighting?35:100,clearance)*3+Math.min(60,displacement)*.6-blockedSteps*2-Math.abs(angleDiff(turn,s.a))*2-minePenalty-40*anticipatedRisk+shotValue*((fighting&&shotTime!==Infinity?110*Math.max(0,1-shotTime/.7):0)+75*aimSeconds/horizon);
      return{turn:Math.atan2(Math.sin(turn),Math.cos(turn)),move,score,clearance,hitTime,displacement,shotTime,fighting,anticipatedRisk};
    };
    if(state.checkIntent)return{diagnostic:evaluate(state.checkIntent.turn,state.checkIntent.move)};
    const perpendicular=state.threat?Math.atan2(-state.threat.vx,state.threat.vy):s.a;
    const angles=[s.a,s.a+Math.PI/4,s.a-Math.PI/4,s.a+Math.PI/2,s.a-Math.PI/2,s.a+Math.PI,perpendicular,perpendicular+Math.PI];
    // Curved movement near the firing angle can evade without surrendering the
    // barrel. Body and barrel still share the same limited rotation.
    if(fighting){const aim=Math.atan2(e.y-s.y,e.x-s.x);angles.push(aim,aim+.22,aim-.22,aim+.45,aim-.45,aim+.7,aim-.7)}
    let best=null;
    const better=(a,b)=>a.hitTime===Infinity&&b.hitTime!==Infinity?true:a.hitTime!==Infinity&&b.hitTime===Infinity?false:a.hitTime!==Infinity&&Math.abs(a.hitTime-b.hitTime)>.025?a.hitTime>b.hitTime:a.score>b.score;
    const holdingMine=(state.weapons?.mines||[]).some(m=>m.triggerId===s.id&&Math.hypot(s.x-m.x,s.y-m.y)<c.tankRadius+11&&!(s.shieldUntil>state.time));
    for(const angle of angles)for(const move of(holdingMine?[0,1,-1]:[1,-1])){const candidate=evaluate(angle,move);if(!best||better(candidate,best))best=candidate}
    const previous=Number.isFinite(memory.turn)&&Math.abs(memory.move)===1?evaluate(memory.turn,memory.move):null;
    // Keep a working escape side. Replan immediately when blocked or when it would be hit.
    if(previous&&previous.displacement>2&&previous.hitTime===Infinity&&best.hitTime===Infinity&&((state.time<Number(memory.holdUntil))||best.score-previous.score<14))best=previous;
    const changed=!previous||Math.abs(angleDiff(best.turn,previous.turn))>.1||best.move!==previous.move;
    return{move:best.move,turn:best.turn,...(fighting?{fire:true}:{}),memory:{turn:best.turn,move:best.move,holdUntil:changed?state.time+.3:memory.holdUntil,mode,fighting},diagnostic:{...best,changed,response:fighting?(best.hitTime===Infinity?'duel':'last_stand'):'evade'}};
  }
  function fixtures(){
    const constants={cellSize:100,tankRadius:23.4,bulletRadius:6,tankSpeed:100,bulletSpeed:128,rotationSpeed:Math.PI};
    const make=(name,walls)=>({name,time:0,dt:.1,width:700,height:700,round:1,self:{x:300,y:300,a:0,ammo:5,cooldown:0,history:[]},enemy:{x:650,y:600,a:0,alive:true,vx:0,vy:0,angularVelocity:0,history:[]},bullets:[{x:300,y:470,vx:0,vy:-128,life:5,own:'P'}],walls,constants,execution:{reflexSeconds:0,reflexDistance:0,reflexReversals:0,incidents:[]}});
    const duel=make('close_duel',[]);duel.enemy.x=450;duel.enemy.y=300;duel.combat={mode:'duel'};
    duel.bullets=[{x:450-constants.tankRadius-constants.bulletRadius-2,y:300,vx:-128,vy:0,life:5,own:'P'}];
    return[make('open_crossing',[]),make('narrow_corridor',[{x:230,y:0,w:14,h:700},{x:356,y:0,w:14,h:700}]),duel];
  }
  function advance(state,intent,dt){
    const c=state.constants,s=state.self,r=c.tankRadius;
    const blocked=(x,y,r,body=false)=>x<r||y<r||x>state.width-r||y>state.height-r||state.walls.some(w=>x+r>w.x&&x-r<w.x+w.w&&y+r>w.y&&y-r<w.y+w.h)||(body&&(state.enemies||[state.enemy]).some(t=>t.alive!==false&&Math.hypot(x-t.x,y-t.y)<r*2));
    const difference=Math.atan2(Math.sin(intent.turn-s.a),Math.cos(intent.turn-s.a));s.a+=Math.sign(difference)*Math.min(Math.abs(difference),c.rotationSpeed*dt);
    const distance=c.tankSpeed*intent.move*(intent.move<0?.65:1)*dt;
    const nx=s.x+Math.cos(s.a)*distance;if(!blocked(nx,s.y,r,true))s.x=nx;
    const ny=s.y+Math.sin(s.a)*distance;if(!blocked(s.x,ny,r,true))s.y=ny;
    for(const b of state.bullets){
      b.life-=dt;
      for(let sub=0;sub<3;sub++){
        const bx=b.x+b.vx*dt/3;if(blocked(bx,b.y,c.bulletRadius))b.vx=-b.vx;else b.x=bx;
        const by=b.y+b.vy*dt/3;if(blocked(b.x,by,c.bulletRadius))b.vy=-b.vy;else b.y=by;
      }
      if(b.life>0&&Math.hypot(b.x-s.x,b.y-s.y)<r+c.bulletRadius)state.hit=true;
    }
    state.time+=dt;
  }
  async function probe(run,reset=()=>{}){
    const results=[];
    for(const state of fixtures()){
      await reset();let intent,lastMove=0,reversals=0,blockedSeconds=0,travel=0;
      const startX=state.self.x,startY=state.self.y;
      for(let frame=0;frame<88&&!state.hit;frame++){
        const shell=state.bullets[0],gap=Math.hypot(shell.x-state.self.x,shell.y-state.self.y);
        state.threat={vx:shell.vx,vy:shell.vy,eta:Math.max(0,(gap-state.constants.tankRadius-state.constants.bulletRadius)/Math.hypot(shell.vx,shell.vy)),d:gap};
        if(frame%4===0){
          state.self.history.push({time:state.time,x:state.self.x,y:state.self.y,a:state.self.a,emergency:true});state.self.history=state.self.history.slice(-60);
          state.fallback=plan(state,{});
          intent=await run(state);
          if(!intent||!Number.isFinite(intent.turn)||!Number.isFinite(intent.move)||Math.abs(intent.move)>1)throw new Error('避弹程序必须返回有效 move 和 turn');
          if(lastMove&&intent.move&&Math.sign(intent.move)!==lastMove)reversals++;
          if(intent.move)lastMove=Math.sign(intent.move);
        }
        const x=state.self.x,y=state.self.y;advance(state,intent,.025);
        const moved=Math.hypot(state.self.x-x,state.self.y-y);travel+=moved;if(intent.move&&moved<.01)blockedSeconds+=.025;
      }
      results.push({name:state.name,survived:!state.hit,displacement:Number(Math.hypot(state.self.x-startX,state.self.y-startY).toFixed(2)),travel:Number(travel.toFixed(2)),reversals,blockedSeconds:Number(blockedSeconds.toFixed(3))});
    }
    return results;
  }
  async function baseline(){let memory={};return probe(state=>{const value=plan(state,memory);memory=value.memory;return value},()=>{memory={}})}
  return{plan,fixtures,advance,probe,baseline,assess:(state,intent)=>plan({...state,checkIntent:intent}).diagnostic,source:()=>`return (${plan.toString()})(state,memory);`};
});
