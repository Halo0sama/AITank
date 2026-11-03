(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./skill-registry.js'):root.AITankSkills);if(typeof module==='object'&&module.exports)module.exports=api;else root.AITankWeapons=api})(typeof globalThis!=='undefined'?globalThis:this,function weaponLibrary(Skills){
  'use strict';
  const builtins={
    laser:{name:'激光',icon:'L',color:'#70e2ff',ammo:1,hint:'高速反弹，开火短暂停车'},
    double:{name:'双管炮',icon:'2',color:'#ffc66c',ammo:10,hint:'左右炮管交替，短程快射'},
    shotgun:{name:'霰弹枪',icon:'SG',color:'#ffae72',ammo:3,hint:'每次散射20枚短程弹'},
    homing:{name:'追踪导弹',icon:'H',color:'#ff809b',ammo:1,hint:'两秒后追逐最近坦克，包括自己'},
    mine:{name:'隐形地雷',icon:'M',color:'#e5bd71',ammo:3,hint:'身后布雷，踩中后离开引爆'},
    shield:{name:'反弹护盾',icon:'S',color:'#8ee8c4',ammo:1,hint:'拾取待命，按开火启用六秒反弹护盾'},
    gatling:{name:'加特林',icon:'G',color:'#ffdf71',ammo:30,hint:'按住开火蓄转后连续发射'},
    frag:{name:'破片炸弹',icon:'F',color:'#f8a9e1',ammo:1,hint:'再按开火引爆，超时自动爆裂'},
    deathray:{name:'死亡射线',icon:'D',color:'#cb9bff',ammo:1,hint:'定身蓄能后射出微弯的穿墙光柱'},
    remote:{name:'遥控导弹',icon:'RC',color:'#a6b8ff',ammo:1,hint:'左右键控制导弹，车体暂时锁定'}
  };
  const traits={laser:{cooldown:.4,lock:.12},double:{cooldown:.19},shotgun:{cooldown:.6,pellets:20,spread:.627},homing:{cooldown:.4,seekDelay:2,targets:'nearest including owner'},mine:{cooldown:.5,armDelay:.7,duration:24,trigger:'step on then leave',explosionRadius:37.4},shield:{cooldown:.2,duration:6,reflects:true,activation:'fire'},gatling:{cooldown:.09,spinup:.65},frag:{cooldown:.4,fuse:3,shrapnel:24,trigger:'fire again',explosionRadius:37.4},deathray:{cooldown:.78,charge:.6,lock:.78,pierceWalls:true,pierceTanks:true},remote:{cooldown:.4,lock:'until missile expires',turnRate:2.5}};
  const mechanics={
    laser:{control:'single',ricochet:true,lethal:'moving tip only',aimGuide:true,selfDamage:true},
    double:{control:'single',barrelOffsets:[-9,9],rangeType:'path length including bounces',selfDamage:true},
    shotgun:{control:'single',pelletAngles:'20 at (i-9.5)*0.033 radians',pathRange:330,halfSpread:.3135,rangeIncludesBounces:true,volleyCanReturnAfterHit:true,selfDamage:true},
    homing:{control:'single',turnRate:2.5,turnSpeedFactorMin:.65,retargetEvery:.15,ricochet:true,selfDamage:true},
    mine:{control:'place behind',placementOffset:'tankRadius+14',hiddenAfterArming:true,shrapnel:{count:24,speed:310,life:1.05,radius:2},selfDamage:true},
    shield:{control:'activate',radiusExtra:12,keepsProjectileOwner:true,ownReboundsCanKill:true},
    gatling:{control:'hold',spreadRadians:.1,releaseStopsSpin:true,requiresContinuousIntent:true,selfDamage:true},
    frag:{control:'fire then fire again to detonate',shrapnel:{count:24,speed:310,life:1.05,radius:2},selfDamage:true},
    deathray:{control:'single',pierceInternalWalls:true,stopsAtArenaEdge:true,locksMovementAndRotation:true,lockThrough:'charge and live column',lethal:'growing beam column',beamRadius:6,maxBendRadians:.07,curvaturePerPixel:.00016,targets:'living tanks except owner within forward cone',selfDamage:true},
    remote:{control:'fire then steer',vehicleLockedWhileActive:true,ricochet:true,selfDamage:true}
  };
  const registry=Skills.create(),catalog=registry.catalog;
  for(const[id,meta]of Object.entries(builtins))registry.register({id,...meta},{builtin:true});
  const copy=value=>JSON.parse(JSON.stringify(value));
  const view=w=>({time:w.time,width:w.width,height:w.height,walls:copy(w.walls),tanks:w.tanks.map(t=>({id:t.id,x:t.x,y:t.y,a:t.a,alive:t.alive,weapon:t.weapon?copy(t.weapon):null,skills:t.skills?copy(t.skills):{},shieldUntil:t.shieldUntil||0,lockUntil:t.lockUntil||0,remoteId:t.remoteId||null})),constants:{...w.constants}});
  const angleDiff=(a,b)=>Math.atan2(Math.sin(a-b),Math.cos(a-b));
  const radius=b=>b.radius??6;
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const rayOptions=angle=>({speed:2100,radius:6,life:1.1,pierceWalls:true,pierceTanks:true,hitIds:[],rayAngle:angle,rayPath:[]});
  const segmentDistance=(x,y,p)=>{const dx=p.tx-p.x,dy=p.ty-p.y,f=clamp(((x-p.x)*dx+(y-p.y)*dy)/(dx*dx+dy*dy||1),0,1);return Math.hypot(x-p.x-dx*f,y-p.y-dy*f)};
  function recordRay(b,x,y){
    if(!b.rayPath)return;
    const p={x,y,tx:b.x,ty:b.y},last=b.rayPath.at(-1);
    if(last&&Math.hypot(last.tx-x,last.ty-y)<.01&&Math.abs((last.tx-last.x)*(p.ty-y)-(last.ty-last.y)*(p.tx-x))<.00001){last.tx=p.tx;last.ty=p.ty}else b.rayPath.push(p);
  }
  function bendRay(w,b,distance){
    if(b.kind!=='deathray'||b.rayReflected)return;
    const origin=b.rayAngle??Math.atan2(b.vy,b.vx),heading=Math.atan2(b.vy,b.vx);
    const candidates=w.tanks.filter(t=>t.alive!==false&&t.id!==b.own&&Math.abs(angleDiff(Math.atan2(t.y-b.y,t.x-b.x),origin))<.22);
    if(!candidates.length)return;
    const target=candidates.reduce((a,t)=>Math.hypot(a.x-b.x,a.y-b.y)<=Math.hypot(t.x-b.x,t.y-b.y)?a:t);
    const wanted=origin+clamp(angleDiff(Math.atan2(target.y-b.y,target.x-b.x),origin),-.07,.07),speed=Math.hypot(b.vx,b.vy);
    const next=heading+clamp(angleDiff(wanted,heading),-distance*.00016,distance*.00016);
    b.vx=Math.cos(next)*speed;b.vy=Math.sin(next)*speed;
  }
  function incomingRisk(report,point,from=0,to=report?.horizon||0){
    if(!report||!point||![point.x,point.y,from,to].every(Number.isFinite))return{score:0,possibleHitIn:null,actors:[],unknown:true};
    if(to<from||from>report.horizon||to<0||!Number.isFinite(point.radius??report.tankRadius)||(point.radius??report.tankRadius)<0)return{score:0,possibleHitIn:null,actors:[],unknown:true};
    const outside=from<0||to>report.horizon;from=Math.max(0,from);to=Math.min(to,report.horizon);
    const body=point.radius??report.tankRadius,byActor=new Map();let first=Infinity,clearance=Infinity;
    const distance=(x,y,a,b,c,d)=>{const dx=c-a,dy=d-b,t=clamp(((x-a)*dx+(y-b)*dy)/(dx*dx+dy*dy||1),0,1);return Math.hypot(x-a-dx*t,y-b-dy*t)};
    for(const scenario of report.scenarios||[]){
      if(!scenario.available)continue;let value=0,eta=Infinity;
      for(const p of scenario.paths||[]){
        if(p[1]<from||p[0]>to)continue;
        const span=p[1]-p[0]||1,a=clamp((from-p[0])/span,0,1),b=clamp((to-p[0])/span,0,1);
        const x=p[2]+(p[4]-p[2])*a,y=p[3]+(p[5]-p[3])*a,tx=p[2]+(p[4]-p[2])*b,ty=p[3]+(p[5]-p[3])*b;
        const gap=distance(point.x,point.y,x,y,tx,ty)-body-p[6];clearance=Math.min(clearance,gap);
        if(gap<18)value=Math.max(value,clamp(1-gap/18,0,1));if(gap<=0)eta=Math.min(eta,Math.max(from,p[0]));
      }
      for(const z of scenario.zones||[]){
        if(z.role==='defense'||z.until<from||z.from>to)continue;
        if(z.role==='damage'&&point.shieldUntil>report.time+Math.max(from,z.from))continue;
        if(z.lineOfSight&&report.geometry&&!lineClear(report.geometry,z.x,z.y,point.x,point.y,2))continue;
        const gap=Math.hypot(point.x-z.x,point.y-z.y)-body-z.radius;clearance=Math.min(clearance,gap);
        if(gap<18)value=Math.max(value,clamp(1-gap/18,0,1)*(z.conditional?.6:1));if(gap<=0)eta=Math.min(eta,Math.max(from,z.from));
      }
      const score=value*(scenario.assumption==='current_heading'?1:.65);
      if(score>(byActor.get(scenario.ownerId)||0))byActor.set(scenario.ownerId,score);
      if(eta<first)first=eta;
    }
    return{score:clamp([...byActor.values()].reduce((a,b)=>a+b,0),0,1),possibleHitIn:first===Infinity?null:first,clearance:clearance===Infinity?null:clearance,actors:[...byActor.keys()],hypothetical:true,unknown:!!(outside||report.truncated||report.incomplete)};
  }
  const blocked=(w,x,y,r)=>x<r||y<r||x>w.width-r||y>w.height-r||w.walls.some(a=>x+r>a.x&&x-r<a.x+a.w&&y+r>a.y&&y-r<a.y+a.h);
  function lineClear(w,x,y,tx,ty,r=3){
    const n=Math.max(1,Math.ceil(Math.hypot(tx-x,ty-y)/8));
    for(let i=0;i<=n;i++)if(blocked(w,x+(tx-x)*i/n,y+(ty-y)*i/n,r))return false;
    return true;
  }
  function route(w,b,target){
    if(lineClear(w,b.x,b.y,target.x,target.y,radius(b)))return target;
    const cell=w.constants.cellSize||100,cols=Math.round(w.width/cell),rows=Math.round(w.height/cell);
    const key=(x,y)=>x+','+y,start=[Math.floor(b.x/cell),Math.floor(b.y/cell)],end=[Math.floor(target.x/cell),Math.floor(target.y/cell)];
    const queue=[start],prev=new Map([[key(...start),null]]);
    for(let i=0;i<queue.length;i++){
      const [x,y]=queue[i];if(x===end[0]&&y===end[1])break;
      for(const [nx,ny] of [[x-1,y],[x+1,y],[x,y-1],[x,y+1]]){
        if(nx<0||ny<0||nx>=cols||ny>=rows||prev.has(key(nx,ny)))continue;
        if(!lineClear(w,(x+.5)*cell,(y+.5)*cell,(nx+.5)*cell,(ny+.5)*cell,radius(b)))continue;
        prev.set(key(nx,ny),[x,y]);queue.push([nx,ny]);
      }
    }
    if(!prev.has(key(...end)))return target;
    let next=end;while(prev.get(key(...next))&&key(...prev.get(key(...next)))!==key(...start))next=prev.get(key(...next));
    const point={x:(next[0]+.5)*cell,y:(next[1]+.5)*cell};
    return lineClear(w,b.x,b.y,point.x,point.y,radius(b))?point:{x:(start[0]+.5)*cell,y:(start[1]+.5)*cell};
  }
  function steer(w,b,angle,dt){
    const old=Math.atan2(b.vy,b.vx),difference=angleDiff(angle,old),turn=Math.max(-2.5*dt,Math.min(2.5*dt,difference));
    const speed=(b.speed||210)*(1-.35*Math.min(1,Math.abs(difference)));
    b.vx=Math.cos(old+turn)*speed;b.vy=Math.sin(old+turn)*speed;
  }
  function guide(w,b,dt){
    const custom=registry.get(b.kind);
    if(custom&&!custom.builtin&&custom.guide){
      let result;try{result=custom.guide({world:view(w),projectile:copy(b),dt})}catch{return}
      if(result&&Number.isFinite(result.vx)&&Number.isFinite(result.vy)&&Math.hypot(result.vx,result.vy)<=5000){b.vx=result.vx;b.vy=result.vy}
      return;
    }
    if(b.kind!=='homing'||w.time<(b.seekAt||0))return;
    const living=w.tanks.filter(t=>t.alive!==false);if(!living.length)return;
    const target=living.reduce((a,t)=>Math.hypot(a.x-b.x,a.y-b.y)<=Math.hypot(t.x-b.x,t.y-b.y)?a:t);
    if(!b.nav||w.time-b.nav.time>=.15||b.nav.target!==target.id||Math.hypot(b.x-b.nav.x,b.y-b.nav.y)<12){const p=route(w,b,target);b.nav={x:p.x,y:p.y,target:target.id,time:w.time}}
    b.targetId=target.id;steer(w,b,Math.atan2(b.nav.y-b.y,b.nav.x-b.x),dt);
  }
  // Shared by live simulation, weapon aiming and the local defensive forecast.
  function move(w,b,dt,onSegment){
    guide(w,b,dt);const n=Math.max(3,Math.ceil(Math.hypot(b.vx,b.vy)*dt/4)),r=radius(b);
    for(let sub=0;sub<n;sub++){
      bendRay(w,b,Math.hypot(b.vx,b.vy)*dt/n);
      const px=b.x,py=b.y,nx=b.x+b.vx*dt/n;let bounced=false;
      if(b.pierceWalls){b.x=nx;b.y+=b.vy*dt/n;if(b.x<r||b.y<r||b.x>w.width-r||b.y>w.height-r){b.life=0;return}}
      else{
        if(blocked(w,nx,b.y,r)){b.vx=-b.vx;bounced=true}else b.x=nx;
        const ny=b.y+b.vy*dt/n;if(blocked(w,b.x,ny,r)){b.vy=-b.vy;bounced=true}else b.y=ny;
      }
      recordRay(b,px,py);
      if(onSegment&&onSegment(b,px,py,bounced)===false)return;
    }
  }
  function emitBurst(w,source,beams){
    w.event?.('detonate',{time:w.time,owner:source.own,weapon:source.kind,x:source.x,y:source.y});
    for(const t of w.tanks)if(t.alive&&Math.hypot(t.x-source.x,t.y-source.y)<w.constants.tankRadius+14&&!(t.shieldUntil>w.time)&&lineClear(w,source.x,source.y,t.x,t.y,2))w.hit(t,source);
    for(let i=0;i<24;i++){
      const a=i*Math.PI/12,x=source.x+Math.cos(a)*10,y=source.y+Math.sin(a)*10;
      if(!blocked(w,x,y,2))w.spawn({kind:'shrapnel',x,y,vx:Math.cos(a)*310,vy:Math.sin(a)*310,own:source.own,slot:false,life:1.05,radius:2});
    }
    beams.push({kind:'burst',x:source.x,y:source.y,life:.25});
  }
  function create(){
    const system={pickups:[],mines:[],beams:[],charges:[],nextSpawn:4.5,sequence:0};
    let solutionCache=null;
    const bankThreatCache=new Map();
    const emit=(w,type,data)=>w.event?.(type,{time:w.time,...data});
    const custom=id=>{const d=registry.get(id);return d&&!d.builtin?d:null};
    const faults=new Set();
    const invoke=(w,definition,hook,context)=>{
      if(!definition?.[hook]||faults.has(definition.id+':'+hook))return;
      try{return definition[hook](context)}catch(error){faults.add(definition.id+':'+hook);emit(w,'skill_error',{weapon:definition.id,hook,message:String(error.message).slice(0,180)})}
    };
    const context=(w,t,id,state)=>({world:w,tank:t,state,spawn:(options={})=>add(w,t,id,options.angle??t.a,{...registry.get(id).projectile,...options}),damage:(victim,source={})=>w.hit(victim,{x:t.x,y:t.y,...source,own:t.id,kind:id}),finish:()=>{const active=(t.weapon?.type===id&&custom(id)?.meta.slot!=='buff')||!!t.skills?.[id];if(t.weapon?.type===id)t.weapon=null;delete t.skills?.[id];if(active)invoke(w,custom(id),'cleanup',context(w,t,id,state))},emit:(name,data={})=>emit(w,'skill_event',{...data,owner:t.id,weapon:id,event:name})});
    const add=(w,owner,kind,angle,options={})=>{
      const r=options.radius??4,offset=options.offset||0,distance=w.constants.tankRadius+r+3;
      const b={kind,x:owner.x+Math.cos(angle)*distance-Math.sin(angle)*offset,y:owner.y+Math.sin(angle)*distance+Math.cos(angle)*offset,vx:Math.cos(angle)*(options.speed||240),vy:Math.sin(angle)*(options.speed||240),own:owner.id,slot:false,life:options.life||2,radius:r,...options,kind,own:owner.id,slot:false};
      if(b.pierceTanks&&!Array.isArray(b.hitIds))b.hitIds=[];
      if(b.pierceWalls?(b.x<r||b.y<r||b.x>w.width-r||b.y>w.height-r):blocked(w,b.x,b.y,r))return null;
      return w.spawn(b);
    };
    function finish(t,type){if(t.weapon?.type===type)t.weapon=null}
    function remove(w,b){
      if(b.removed)return;b.removed=true;
      if(b.slot!==false)w.release(b);
      const owner=w.tanks.find(t=>t.id===b.own);
      if(owner?.remoteId===b.id){owner.remoteId=null;finish(owner,'remote')}
      if(owner?.weapon?.projectileId===b.id)finish(owner,'frag');
    }
    function burst(w,source){emitBurst(w,source,system.beams)}
    system.reset=w=>{
      for(const t of w.tanks){const d=custom(t.weapon?.type);if(d)context(w,t,d.id,t.weapon.state||{}).finish();for(const[id,s]of Object.entries(t.skills||{}))context(w,t,id,s.state).finish()}
      for(const array of[system.pickups,system.mines,system.beams,system.charges])array.length=0;
      system.nextSpawn=w.time+4.5;
      faults.clear();for(const t of w.tanks){t.weapon=null;t.skills={};t.shieldUntil=0;t.lockUntil=0;t.remoteId=null;t.gatlingStart=null;t.weaponTrigger=-Infinity;t.guideCache=null;t.remoteAim=null}
    };
    system.shieldActive=(w,t)=>t.alive&&Number.isFinite(t.shieldUntil)&&t.shieldUntil>w.time;
    system.canEquip=(w,t,type)=>t.alive&&w.canPickup?.(t,type)!==false&&Object.hasOwn(catalog,type)&&(!t.weapon&&!(type==='shield'&&t.shieldUntil>w.time)&&!t.skills?.[type]);
    system.equip=(w,t,type)=>{
      if(!system.canEquip(w,t,type))return false;
      const definition=custom(type);
      if(type==='shield'&&t.shieldUntil>w.time)return false;
      if(t.weapon)return false;
      const activation=definition?.meta.slot==='buff';
      t.weapon={type,ammo:activation?1:catalog[type].ammo,barrel:0};
      if(activation)t.weapon.slot='buff';
      if(definition){t.weapon.capacity=activation?1:definition.meta.ammo;t.weapon.state={};if(!activation)invoke(w,definition,'equip',context(w,t,type,t.weapon.state))}
      if(type==='gatling')t.gatlingStart=null;
      emit(w,'pickup',{owner:t.id,weapon:type});return true;
    };
    system.spawnPickup=(w,type,x,y)=>{
      if(!Object.hasOwn(catalog,type)||blocked(w,x,y,18)||system.pickups.some(p=>Math.hypot(p.x-x,p.y-y)<35))return null;
      const p={id:++system.sequence,type,x,y,expires:w.time+24};system.pickups.push(p);return p;
    };
    system.remote=(w,t)=>w.bullets.find(b=>b.kind==='remote'&&b.id===t.remoteId&&!b.removed)||null;
    system.lockRemaining=(w,t)=>Math.max(0,(t.lockUntil||0)-w.time,...w.bullets.filter(b=>b.kind==='deathray'&&b.own===t.id&&!b.removed).map(b=>b.life));
    system.locked=(w,t)=>t.lockUntil>w.time||!!system.remote(w,t)||w.bullets.some(b=>b.kind==='deathray'&&b.own===t.id&&!b.removed&&b.life>0);
    system.steerRemote=(w,t,angle,dt)=>{const b=system.remote(w,t);if(b)steer(w,b,angle,dt)};
    system.canUse=(w,t)=>{if(!t.weapon||!t.alive)return false;const d=custom(t.weapon.type);if(d){if(system.locked(w,t)||t.cd>0)return false;if(d.meta.slot==='buff')return true;const result=invoke(w,d,'canUse',context(w,t,d.id,t.weapon.state));return result===undefined?t.weapon.ammo>0:result===true}return!!(t.weapon.projectileId||(!system.locked(w,t)&&t.cd<=0&&t.weapon.ammo>0))};
    system.fire=(w,t,continuing=false)=>{
      const weapon=t.weapon;if(!weapon)return null;
      if(!t.alive||!system.canUse(w,t))return false;
      const type=weapon.type;
      const definition=custom(type);
      if(type==='shield'){
        t.shieldUntil=w.time+6;t.cd=.2;finish(t,type);emit(w,'activate',{owner:t.id,weapon:type,until:t.shieldUntil});return true;
      }
      if(definition?.meta.slot==='buff'){
        t.skills||={};const state=weapon.state;t.skills[type]={until:w.time+definition.duration,state};t.weapon=null;t.cd=definition.cooldown;
        invoke(w,definition,'equip',context(w,t,type,state));emit(w,'activate',{owner:t.id,weapon:type,until:t.skills[type]?.until});return true;
      }
      if(definition){
        const ctx=context(w,t,type,weapon.state),result=definition.fire?invoke(w,definition,'fire',ctx):!!ctx.spawn();
        if(result!==true&&(!result||typeof result!=='object'))return false;
        const consume=typeof result==='object'?(result.consume??1):1,cooldown=typeof result==='object'?(result.cooldown??definition.cooldown):definition.cooldown;
        if(!Number.isSafeInteger(consume)||consume<0||consume>weapon.ammo||!Number.isFinite(cooldown)||cooldown<0||cooldown>60)return false;
        weapon.ammo-=consume;t.cd=cooldown;emit(w,'fire',{owner:t.id,weapon:type,remaining:weapon.ammo});
        if(weapon.ammo<=0&&!result.keepEquipped)ctx.finish();return true;
      }
      if(type==='frag'&&weapon.projectileId){
        const bomb=w.bullets.find(b=>b.id===weapon.projectileId);if(bomb){burst(w,bomb);bomb.life=0;remove(w,bomb);finish(t,'frag');return true}finish(t,'frag');return false;
      }
      let shots=[],cooldown=.4;
      if(type==='gatling'){
        if(!continuing)t.weaponTrigger=w.time;if(t.gatlingStart===null)t.gatlingStart=w.time;
        if(w.time-t.gatlingStart<.65)return true;
        const shot=add(w,t,'gatling',t.a+(w.random()-.5)*.1,{speed:285,radius:2,life:1.55});if(shot)shots.push(shot);cooldown=.09;
      }else if(type==='deathray'){
        system.charges.push({own:t.id,x:t.x,y:t.y,angle:t.a,ready:w.time+.6});t.lockUntil=w.time+.78;t.cd=.78;weapon.ammo=0;
        emit(w,'fire',{owner:t.id,weapon:type,projectiles:1,remaining:0});return true;
      }else if(type==='mine'){
        const x=t.x-Math.cos(t.a)*(w.constants.tankRadius+14),y=t.y-Math.sin(t.a)*(w.constants.tankRadius+14);
        if(blocked(w,x,y,9))return false;
        system.mines.push({id:++system.sequence,kind:'mine',x,y,own:t.id,armedAt:w.time+.7,expires:w.time+24,triggerId:null});cooldown=.5;
      }else if(type==='shotgun'){
        for(let i=0;i<20;i++){const shot=add(w,t,'pellet',t.a+(i-9.5)*.033,{speed:300,radius:2,life:1.1});if(shot)shots.push(shot)}cooldown=.6;
      }else if(type==='double'){
        const shot=add(w,t,'double',t.a,{offset:weapon.barrel%2?9:-9,speed:220,radius:4,life:2.3});if(shot)shots.push(shot);weapon.barrel++;cooldown=.19;
      }else{
        const options={laser:{speed:1700,radius:2,life:.8},homing:{speed:210,radius:5,life:9,seekAt:w.time+2},remote:{speed:210,radius:5,life:8},frag:{speed:160,radius:7,life:3}}[type];
        const shot=add(w,t,type,t.a,options);if(shot)shots.push(shot);
        if(type==='laser'&&shot)t.lockUntil=w.time+.12;
        if(type==='remote'&&shot)t.remoteId=shot.id;
        if(type==='frag'&&shot)weapon.projectileId=shot.id;
      }
      if(type!=='mine'&&!shots.length)return false;
      weapon.ammo--;t.cd=cooldown;
      emit(w,'fire',{owner:t.id,weapon:type,projectiles:shots.length,remaining:weapon.ammo});
      if(weapon.ammo<=0&&!['frag','remote'].includes(type))finish(t,type);
      return true;
    };
    function reflect(w,b,t,px,py){
      if(!(t.shieldUntil>w.time))return false;
      const r=w.constants.tankRadius+12+radius(b),d=Math.hypot(b.x-t.x,b.y-t.y),previous=Math.hypot(px-t.x,py-t.y);
      if(d>r||previous<r-.01||(b.x-t.x)*b.vx+(b.y-t.y)*b.vy>=0)return false;
      const nx=(b.x-t.x)/(d||1),ny=(b.y-t.y)/(d||1),dot=b.vx*nx+b.vy*ny;
      b.vx-=2*dot*nx;b.vy-=2*dot*ny;b.x=t.x+nx*(r+.1);b.y=t.y+ny*(r+.1);
      b.nav=null;if(b.kind==='deathray')b.rayReflected=true;emit(w,'deflect',{owner:t.id,projectileOwner:b.own,weapon:b.kind||'normal',x:b.x,y:b.y});return true;
    }
    system.update=(w,dt,combat=true)=>{
      for(const effect of system.beams)effect.life-=dt;system.beams=system.beams.filter(e=>e.life>0);
      if(combat){
        for(const t of w.tanks){
          if(t.shieldUntil&&(!t.alive||t.shieldUntil<=w.time)){t.shieldUntil=0;emit(w,'deactivate',{owner:t.id,weapon:'shield'})}
          const d=custom(t.weapon?.type);if(d){const ctx=context(w,t,d.id,t.weapon.state);if(!t.alive)ctx.finish();else if(d.meta.slot!=='buff')invoke(w,d,'update',{...ctx,dt})}
          for(const[id,active]of Object.entries(t.skills||{})){
            const definition=custom(id);if(!definition)continue;
            const ctx=context(w,t,id,active.state);
            if(!t.alive||active.until<=w.time)ctx.finish();else invoke(w,definition,'update',{...ctx,dt});
          }
          if(!t.alive)continue;
          if(t.weapon?.type==='gatling'){
            const held=t.id==='E'?w.time-t.weaponTrigger<.18:w.held(t.id);
            if(held)system.fire(w,t,true);else t.gatlingStart=null;
          }
        }
        for(let i=system.charges.length-1;i>=0;i--){
          const charge=system.charges[i],owner=w.tanks.find(t=>t.id===charge.own);
          if(!owner?.alive){system.charges.splice(i,1);continue}
          if(w.time>=charge.ready){add(w,{...owner,x:charge.x,y:charge.y},'deathray',charge.angle,rayOptions(charge.angle));w.visual?.('ray',{...charge,id:owner.id,a:charge.angle});finish(owner,'deathray');system.charges.splice(i,1)}
        }
        for(const mine of system.mines){
          if(w.time<mine.armedAt)continue;
          const onTop=w.tanks.find(t=>t.alive&&Math.hypot(t.x-mine.x,t.y-mine.y)<w.constants.tankRadius+11);
          if(!mine.triggerId&&onTop){mine.triggerId=onTop.id;emit(w,'mine_trigger',{owner:mine.own,victim:onTop.id,x:mine.x,y:mine.y})}
          if(mine.triggerId&&!onTop){burst(w,mine);mine.expires=-1}
        }
        system.mines=system.mines.filter(m=>m.expires>w.time);
      }
      const active=w.bullets.slice();
      for(const b of active){
        if(b.removed)continue;
        b.life-=dt;
        if(b.life<=0){if(combat&&b.kind==='frag')burst(w,b);if(combat){const d=custom(b.kind),owner=w.tanks.find(t=>t.id===b.own);if(d&&owner)invoke(w,d,'expire',{...context(w,owner,d.id,owner.weapon?.type===d.id?owner.weapon.state:{}),projectile:b})}remove(w,b);continue}
        const trail=[];
        move(w,b,dt,(shot,px,py,bounced)=>{
          if(combat&&bounced)w.visual?.('ricochet',{x:shot.x,y:shot.y,kind:shot.kind,owner:shot.own});
          if(['laser','deathray'].includes(shot.kind))trail.push({x:px,y:py,tx:shot.x,ty:shot.y});
          if(!combat)return;
          if(w.traceOnly){
            w.trace?.(shot,px,py);
            for(const t of w.tanks)if(t.alive){
              reflect(w,shot,t,px,py);
              if(shot.kind==='frag'&&Math.hypot(t.x-shot.x,t.y-shot.y)<w.constants.tankRadius+radius(shot)){burst(w,shot);shot.life=0;return false}
            }
            return;
          }
          for(const t of w.tanks){
            if(!t.alive)continue;
            if(reflect(w,shot,t,px,py))continue;
            if(Math.hypot(t.x-shot.x,t.y-shot.y)>=w.constants.tankRadius+radius(shot)||shot.hitIds?.includes(t.id))continue;
            if(shot.kind==='frag'){burst(w,shot);shot.life=0;return false}
            const d=custom(shot.kind),owner=w.tanks.find(t=>t.id===shot.own);
            if(d&&owner)invoke(w,d,'hit',{...context(w,owner,d.id,owner.weapon?.type===d.id?owner.weapon.state:{}),projectile:shot,victim:t});
            if(d?.projectile?.damage!==false)w.hit(t,shot);
            if(shot.pierceTanks){shot.hitIds.push(t.id);continue}
            shot.life=0;return false;
          }
        });
        if(b.rayPath?.length){
          if(combat)for(const p of b.rayPath){
            if(w.traceOnly){w.trace?.({...b,x:p.tx,y:p.ty},p.x,p.y);continue}
            for(const t of w.tanks)if(t.alive&&!b.hitIds.includes(t.id)&&!(t.shieldUntil>w.time)&&segmentDistance(t.x,t.y,p)<w.constants.tankRadius+radius(b)){
              w.hit(t,b);b.hitIds.push(t.id);
            }
          }
          const beam=system.beams.find(e=>e.projectileId===b.id);
          if(beam){beam.path=b.rayPath.map(p=>({...p}));beam.life=.12}else system.beams.push({projectileId:b.id,kind:b.kind,path:b.rayPath.map(p=>({...p})),radius:radius(b),life:.12});
        }else if(trail.length)system.beams.push({kind:b.kind,path:trail,life:.12});
        if(b.life<=0)remove(w,b);
      }
      for(let i=w.bullets.length-1;i>=0;i--)if(w.bullets[i].removed)w.bullets.splice(i,1);
      if(!combat)return;
      if(w.enabled){
        system.pickups=system.pickups.filter(p=>p.expires>w.time);
        for(const p of system.pickups){
          const taker=w.tanks.find(t=>t.alive&&w.canCollect?.(t,p)!==false&&Math.hypot(t.x-p.x,t.y-p.y)<w.constants.tankRadius+18&&system.equip(w,t,p.type));
          if(taker)p.expires=-1;
        }
        system.pickups=system.pickups.filter(p=>p.expires>w.time);
        if(w.time>=system.nextSpawn){
          system.nextSpawn=w.time+6+w.random()*3;
          if(system.pickups.length<3){
            const cell=w.constants.cellSize||100,places=[];
            for(let x=cell/2;x<w.width;x+=cell)for(let y=cell/2;y<w.height;y+=cell)if(!blocked(w,x,y,18)&&w.tanks.every(t=>!t.alive||Math.hypot(t.x-x,t.y-y)>90)&&system.pickups.every(p=>Math.hypot(p.x-x,p.y-y)>cell))places.push({x,y});
            if(places.length){const p=places[Math.floor(w.random()*places.length)],types=registry.list().filter(d=>d.spawn).map(d=>d.id);system.spawnPickup(w,types[Math.floor(w.random()*types.length)],p.x,p.y)}
          }
        }
      }
    };
    system.definitions=(w,extraIds=[])=>[...new Set([...extraIds,...system.pickups.map(p=>p.type),...w.bullets.map(b=>({pellet:'shotgun',shrapnel:'frag'}[b.kind]||b.kind)),...w.tanks.flatMap(t=>[t.weapon?.type,...Object.keys(t.skills||{})])])].map(id=>{const d=registry.get(id);if(!d)return null;if(!d.builtin)return registry.descriptions([id])[0];const spec=['shield','mine'].includes(id)?null:system.spec(w,{weapon:{type:id}});return{id,name:catalog[id].name,ammo:catalog[id].ammo,activation:'fire',...traits[id],projectile:spec?{...spec,range:spec.speed*spec.life}:null,...mechanics[id],description:catalog[id].hint}}).filter(Boolean);
    system.rulebook=w=>system.definitions(w,Object.keys(builtins));
    system.snapshot=(w,viewer)=>({
      ...(w.tanks.some(t=>t.id===viewer&&w.canPickup?.(t)===false)?{pickupAllowed:false}:{}),
      enabled:w.enabled,pickups:system.pickups.map(p=>({id:p.id,type:p.type,x:p.x,y:p.y})),
      mines:system.mines.filter(m=>m.own===viewer||w.time<m.armedAt||m.triggerId).map(m=>({...m})),
      charges:system.charges.map(c=>({...c})),
      tanks:w.tanks.map(t=>({id:t.id,weapon:t.weapon?copy(t.weapon):null,...(Object.keys(t.skills||{}).length?{skills:copy(t.skills)}:{}),shieldRemaining:Math.max(0,(t.shieldUntil||0)-w.time),lockRemaining:system.lockRemaining(w,t),...(w.bullets.some(b=>b.kind==='deathray'&&b.own===t.id&&!b.removed)?{lockEstimate:'upper bound; ends earlier at arena edge'}:{}),remoteId:t.remoteId||null,...(t.weapon?.type==='gatling'?{spinupRemaining:Math.max(0,.65-(Number.isFinite(t.gatlingStart)?w.time-t.gatlingStart:0))}:{})})),
      ...(system.definitions(w).length?{definitions:system.definitions(w)}:{})
    });
    system.forecast=(w,horizon=1.5,step=.05)=>{
      const shots=w.bullets.filter(b=>!b.removed).map(b=>({...b,nav:b.nav?{...b.nav}:null,...(b.rayPath?{rayPath:b.rayPath.map(p=>({...p}))}:{})})),charges=system.charges.map(c=>({...c})),frames=[];
      for(let elapsed=step;elapsed<=horizon+.001;elapsed+=step){
        const frameTime=w.time+elapsed,world={...w,time:frameTime};
        for(const c of charges)if(!c.used&&c.ready<=frameTime){const spec=rayOptions(c.angle),r=spec.radius;shots.push({...spec,kind:'deathray',own:c.own,x:c.x+Math.cos(c.angle)*(w.constants.tankRadius+r+3),y:c.y+Math.sin(c.angle)*(w.constants.tankRadius+r+3),vx:Math.cos(c.angle)*spec.speed,vy:Math.sin(c.angle)*spec.speed});c.used=true}
        const points=[];
        for(const b of shots){
          b.life-=step;
          if(b.life<=0){if(b.kind==='frag'&&!b.burst){b.burst=true;for(let n=0;n<24;n++){const a=n*Math.PI/12;shots.push({kind:'shrapnel',x:b.x,y:b.y,vx:Math.cos(a)*310,vy:Math.sin(a)*310,radius:2,life:1.05})}}continue}
          move(world,b,step,(shot,px,py)=>{for(const t of w.tanks)reflect({...world,event:null},shot,t,px,py);points.push({x:shot.x,y:shot.y,vx:shot.vx,vy:shot.vy,radius:radius(shot)})});
          for(const p of b.rayPath||[]){const n=Math.max(1,Math.ceil(Math.hypot(p.tx-p.x,p.ty-p.y)/8));for(let i=0;i<=n;i++)points.push({x:p.x+(p.tx-p.x)*i/n,y:p.y+(p.ty-p.y)*i/n,vx:0,vy:0,radius:radius(b)})}
        }
        frames.push({time:frameTime,points});
      }
      const active=new Set([...w.bullets.map(b=>b.kind),...w.tanks.flatMap(t=>[t.weapon?.type,...Object.keys(t.skills||{})])]);
      for(const id of active){const d=custom(id);if(!d?.forecast)continue;
        const extra=invoke({...w,event:null},d,'forecast',{world:view(w),projectiles:copy(w.bullets.filter(b=>b.kind===id)),horizon,step});
        if(!Array.isArray(extra))continue;let count=0;
        for(const frame of extra){const index=Math.round((frame.time-w.time)/step)-1;if(!Number.isFinite(frame.time)||!frames[index]||!Array.isArray(frame.points))continue;
          for(const point of frame.points){if(++count>5000)break;if([point.x,point.y,point.radius,point.vx??0,point.vy??0].every(Number.isFinite)&&point.radius>=1&&point.radius<=200)frames[index].points.push({x:point.x,y:point.y,radius:point.radius,vx:point.vx??0,vy:point.vy??0})}
        }
      }
      return{time:w.time,step,frames};
    };
    system.hasSpecial=w=>w.bullets.some(b=>b.kind&&b.kind!=='normal')||system.charges.length>0||system.mines.length>0||w.tanks.some(t=>t.shieldUntil>w.time||custom(t.weapon?.type)||Object.keys(t.skills||{}).length);
    // Conditional attacks are kept separate from actual bullets and never mutate combat.
    system.projectAttack=(w,source,options={})=>{
      const type=source.weapon?.type||'normal',def=custom(type),viewer=w.tanks.find(t=>t.id===options.viewerId),angle=Number.isFinite(options.angle)?options.angle:source.a;
      const horizon=clamp(Number.isFinite(options.horizon)?options.horizon:3.6,.1,8),step=.05,normalAmmo=source.ammo??Math.max(0,(w.constants.magazineSize||5)-(source.live||0));
      const remote=source.remoteId&&w.bullets.find(b=>b.id===source.remoteId&&!b.removed),detonate=type==='frag'&&source.weapon.projectileId;
      const action=remote?'steer':detonate?'detonate':type==='shield'?'activate':type==='mine'?'place':type==='gatling'?'short_burst':'fire';
      const turnTime=Math.abs(angleDiff(angle,source.a))/(source.motion?.rotationSpeed||w.constants.rotationSpeed||Math.PI);
      const readyIn=action==='steer'||action==='detonate'?0:Math.max(source.cd??source.cooldown??0,system.lockRemaining(w,source),turnTime);
      const result={ownerId:source.id,weapon:type,action,angle,readyIn,available:source.alive!==false&&(remote||detonate||source.weapon?.ammo>0||(!source.weapon&&normalAmmo>0))?true:false,paths:[],zones:[],horizon,estimated:true,...(type==='gatling'?{burstSeconds:.27}:{})};
      if(!result.available||readyIn>horizon)return result;
      if(def?.threatForecast){
        result.coverage='extension';const extra=invoke({...w,event:null},def,'threatForecast',{world:view(w),tank:copy(source),viewerId:options.viewerId,angle,readyIn,horizon,step});
        if(!Array.isArray(extra)){result.coverage='unknown';return result}
        let count=0;if(extra.length>160)result.truncated=true;
        for(const frame of extra.slice(0,160)){if(!frame||!Number.isFinite(frame.time)||!Array.isArray(frame.points)){result.truncated=true;continue}const time=frame.time-w.time;if(time<0||time>horizon)continue;
          if(frame.points.length>128)result.truncated=true;
          for(const p of frame.points.slice(0,128)){
            if(++count>2048){result.truncated=true;return result}
            if(p&&[p.x,p.y,p.radius].every(Number.isFinite)&&p.radius>=1&&p.radius<=1000)result.zones.push({x:p.x,y:p.y,radius:p.radius,from:time,until:Math.min(horizon,time+step),role:p.defense?'defense':'damage',conditional:true});else result.truncated=true;
          }
        }return result;
      }
      let test;
      if(def){const portable=weaponLibrary(Skills);if(def.projectile)portable.register({id:type,...def.meta,cooldown:def.cooldown,projectile:def.projectile});test=portable.create();result.coverage=def.projectile?'projectile_parameters_only':'unknown';if(!def.projectile){if(def.meta.slot==='buff')result.zones.push({role:'defense',x:source.x,y:source.y,radius:0,from:readyIn,until:Math.min(horizon,readyIn+def.duration)});return result}}
      else test=create();
      const tanks=w.tanks.map(t=>({...copy(t),weapon:null,skills:{}})),actor=tanks.find(t=>t.id===source.id);if(!actor){result.available=false;return result}
      Object.assign(actor,{weapon:source.weapon?copy(source.weapon):null,a:angle,cd:source.cd??source.cooldown??0});
      if(type==='gatling')actor.gatlingStart=Number.isFinite(source.spinupRemaining)?w.time-(.65-source.spinupRemaining):source.gatlingStart??null;
      const initial=action==='steer'?w.bullets.filter(b=>b.id===source.remoteId):action==='detonate'?w.bullets.filter(b=>b.id===source.weapon.projectileId):type==='shield'?w.bullets:[];
      let sequence=Math.max(0,...w.bullets.map(b=>b.id||0)),elapsed=0,started=false,detonated=false;
      let spreadIndex=0;
      const last=new Map(),world={...w,tanks,bullets:copy(initial),enabled:false,traceOnly:true,visual:null,canPickup:()=>false,random:()=>[.001,.5,.999][spreadIndex++%3],release:()=>{},hit:()=>{},held:id=>id===actor.id&&started&&elapsed<=readyIn+spinup+.27,
        spawn:b=>{b.id=++sequence;world.bullets.push(b);return b},
        event:(kind,event)=>{if(kind==='detonate')result.zones.push({x:event.x,y:event.y,radius:14,from:elapsed,until:elapsed+step,role:'damage',lineOfSight:true})},
        trace:(b,x,y)=>{
          if(custom(b.kind)?.projectile?.damage===false)return;
          if(result.paths.length>=6000){result.truncated=true;return}
          const prior=last.get(b.id),p=[Math.max(0,elapsed-step),elapsed,x,y,b.x,b.y,radius(b)];
          if(prior&&Math.floor(prior[0]*10)===Math.floor(p[0]*10)&&Math.hypot(prior[4]-x,prior[5]-y)<.01&&Math.abs((prior[4]-prior[2])*(b.y-y)-(prior[5]-prior[3])*(b.x-x))<.001){prior[1]=elapsed;prior[4]=b.x;prior[5]=b.y}
          else{result.paths.push(p);last.set(b.id,p)}
        }};
      let spinup=type==='gatling'?Math.max(0,.65-(Number.isFinite(actor.gatlingStart)?w.time-actor.gatlingStart:0)):0;
      for(let frame=0;frame<=Math.ceil(horizon/step);frame++){
        elapsed=Math.min(horizon,frame*step);world.time=w.time+elapsed;
        for(const t of tanks)t.cd=Math.max(0,(t.cd||0)-(frame?step:0));
        if(!started&&elapsed+.0001>=readyIn){
          started=true;actor.cd=0;
          if(type==='gatling'){
            if(Number.isFinite(source.gatlingStart)||Number.isFinite(source.spinupRemaining)&&source.spinupRemaining<.65)spinup=Math.max(0,spinup-readyIn);
            actor.gatlingStart=spinup<.65?world.time-(.65-spinup):null;result.spinup=spinup;result.spreadSampled=true;
          }
          if(action==='steer')actor.remoteId=source.remoteId;
          else if(type==='normal'){
            const r=w.constants.bulletRadius,d=w.constants.tankRadius+r+2,x=actor.x+Math.cos(angle)*d,y=actor.y+Math.sin(angle)*d;
            if(!blocked(w,x,y,r))world.spawn({x,y,vx:Math.cos(angle)*w.constants.bulletSpeed,vy:Math.sin(angle)*w.constants.bulletSpeed,life:w.constants.bulletLifetime||15,own:source.id,kind:'normal',radius:r,slot:false});else result.blockedMuzzle=true;
          }else if(!test.fire(world,actor))result.blockedMuzzle=true;
          if(type==='shield')result.zones.push({role:'defense',x:actor.x,y:actor.y,radius:w.constants.tankRadius+12,from:elapsed,until:Math.min(horizon,elapsed+6)});
          if(type==='mine')for(const m of test.mines)result.zones.push({role:'trigger',x:m.x,y:m.y,radius:11,from:m.armedAt-w.time,until:Math.min(horizon,m.expires-w.time),conditional:'step_on_then_leave',blastRadius:w.constants.tankRadius+14,fragmentReach:310*1.05});
        }
        if(type==='gatling'&&started&&actor.weapon?.ammo>0&&elapsed<=readyIn+spinup+.27)actor.weaponTrigger=world.time;
        if(type==='frag'&&!detonate&&Number.isFinite(options.detonateAfter)&&!detonated&&elapsed>=readyIn+options.detonateAfter&&actor.weapon?.projectileId){test.fire(world,actor);detonated=true}
        if(type==='mine'&&Number.isFinite(options.triggerAfter)&&!detonated&&elapsed>=readyIn+Math.max(.7,options.triggerAfter)){
          const mine=test.mines[0];if(mine){emitBurst(world,mine,test.beams);mine.expires=-1;for(const zone of result.zones)if(zone.role==='trigger')zone.until=Math.min(zone.until,elapsed);result.conditional='someone_steps_on_then_leaves';detonated=true}
        }
        if(action==='steer'||type==='remote'){const missile=test.remote(world,actor);if(missile&&viewer){const hop=route(world,missile,viewer);test.steerRemote(world,actor,Math.atan2(hop.y-missile.y,hop.x-missile.x),step)}}
        if(frame)test.update(world,step,true);
      }
      result.paths=result.paths.map(p=>p.map(v=>Math.round(v*1000)/1000));return result;
    };
    system.threats=(w,viewerId='E',options={})=>{
      const viewer=w.tanks.find(t=>t.id===viewerId),horizon=clamp(options.horizon||3.6,.1,8),scenarios=[],actors=[];
      const report={time:w.time,horizon,advisoryOnly:true,hypothetical:true,assumptions:'conditional firing; fixed observed positions; sampled headings; no future inputs; conservative projectile absorption',tankRadius:w.constants.tankRadius,scenarios,actors,geometry:{width:w.width,height:w.height,walls:w.walls}};
      if(!viewer)return report;
      for(const actor of w.tanks.filter(t=>t.id!==viewerId&&t.alive!==false&&(t.id==='E')!==(viewerId==='E'))){
        const type=actor.weapon?.type||'normal',direct=Math.atan2(viewer.y-actor.y,viewer.x-actor.x),choices=[{angle:actor.a,assumption:type==='remote'?'possible_guided_steering':'current_heading'}];
        if(!['shield','mine'].includes(type)&&!actor.remoteId&&!actor.weapon?.projectileId&&Math.abs(angleDiff(direct,actor.a))>.08)choices.push({angle:direct,assumption:'turn_toward_observed_target'});
        if(type==='laser'&&options.bankShots!==false){
          const cached=bankThreatCache.get(actor.id),key=[actor.weapon?.ammo,actor.shieldUntil,viewer.shieldUntil].join(':');
          let best;if(cached&&cached.key===key&&cached.walls===w.walls&&w.time>=cached.time&&w.time-cached.time<.6&&Math.hypot(actor.x-cached.x,actor.y-cached.y)<18&&Math.hypot(viewer.x-cached.tx,viewer.y-cached.ty)<18)best=cached.value;
          else{best=system.solution(w,actor,viewer);bankThreatCache.set(actor.id,{key,walls:w.walls,time:w.time,x:actor.x,y:actor.y,tx:viewer.x,ty:viewer.y,value:best})}
          if(best?.hit&&choices.every(c=>Math.abs(angleDiff(c.angle,best.angle))>.08))choices.push({angle:best.angle,assumption:'possible_bank_shot'});
        }
        if(type==='frag'&&!actor.weapon?.projectileId)choices.push({angle:actor.a,assumption:'possible_early_detonation',detonateAfter:.8});
        if(type==='mine')choices.push({angle:actor.a,assumption:'possible_mine_trigger_and_departure',triggerAfter:.8});
        const spec=['shield','mine'].includes(type)||custom(type)?.meta.slot==='buff'?null:system.spec(w,actor);
        const summary={id:actor.id,weapon:type,normalAvailable:actor.ammo??Math.max(0,(w.constants.magazineSize||5)-(actor.live||0)),specialAmmo:actor.weapon?.ammo??null,shieldRemaining:Math.max(0,(actor.shieldUntil||0)-w.time),range:spec?spec.speed*spec.life:null,scenarios:[]};
        for(const choice of choices){
          const scenario=system.projectAttack(w,actor,{...choice,horizon,viewerId});Object.assign(scenario,{id:actor.id+':'+scenarios.length,assumption:choice.assumption});scenarios.push(scenario);
          const exposure=incomingRisk({...report,scenarios:[scenario]},viewer,0,horizon);
          summary.scenarios.push({id:scenario.id,action:scenario.action,assumption:scenario.assumption,angle:scenario.angle,readyIn:scenario.readyIn,available:scenario.available,coverage:scenario.coverage||'builtin_physics',risk:exposure.score,possibleHitIn:exposure.possibleHitIn,...(scenario.zones.length?{zones:scenario.zones}:{}),...(scenario.truncated?{truncated:true}:{})});
        }actors.push(summary);
      }
      report.truncated=scenarios.some(s=>s.truncated);report.incomplete=scenarios.some(s=>s.coverage==='unknown'||s.coverage==='projectile_parameters_only');report.atSelf=incomingRisk(report,viewer,0,horizon);
      const headings=[viewer.a,viewer.a+Math.PI/2,viewer.a-Math.PI/2,viewer.a+Math.PI,viewer.a+Math.PI/4,viewer.a-Math.PI/4],motions=[];
      const motionHorizon=Math.min(1.5,horizon),dt=.05,speed=viewer.motion?.tankSpeed||w.constants.tankSpeed||100,rotation=viewer.motion?.rotationSpeed||w.constants.rotationSpeed||Math.PI;
      for(const turn of headings)for(const move of[0,1,-1]){
        if(move===0&&motions.some(m=>m.move===0))continue;
        let x=viewer.x,y=viewer.y,a=viewer.a,risk=0,hit=null,blockedSteps=0,travel=0;
        for(let time=dt;time<=motionHorizon+.001;time+=dt){
          a+=clamp(angleDiff(turn,a),-rotation*dt,rotation*dt);const distance=speed*move*(move<0?.65:1)*dt,nx=x+Math.cos(a)*distance,ny=y+Math.sin(a)*distance;
          const collides=(px,py)=>blocked(w,px,py,w.constants.tankRadius)||w.tanks.some(t=>t!==viewer&&t.alive!==false&&Math.hypot(px-t.x,py-t.y)<2*w.constants.tankRadius);
          const ox=x,oy=y;if(!collides(nx,y))x=nx;if(!collides(x,ny))y=ny;
          const d=Math.hypot(x-ox,y-oy);travel+=d;if(move&&d<.01)blockedSteps++;
          const r=incomingRisk(report,{x,y,shieldUntil:viewer.shieldUntil},Math.max(0,time-dt),time);risk=Math.max(risk,r.score);if(hit===null&&r.possibleHitIn!==null)hit=r.possibleHitIn;
        }
        motions.push({turn:Math.atan2(Math.sin(turn),Math.cos(turn)),move,risk,possibleHitIn:hit,end:{x,y},seconds:motionHorizon,travel,blockedSeconds:blockedSteps*dt});
      }
      report.motions=motions.sort((a,b)=>a.risk-b.risk||a.blockedSeconds-b.blockedSeconds||b.travel-a.travel);return report;
    };
    system.label=(w,t)=>{
      let label=t.weapon?catalog[t.weapon.type].name+(t.weapon.projectileId?' · 再按引爆':t.remoteId?' · 操控中':' ×'+t.weapon.ammo):'普通炮';
      if(t.shieldUntil>w.time)label+=' · 盾'+Math.ceil(t.shieldUntil-w.time)+'s';for(const[id,s]of Object.entries(t.skills||{}))label+=' · '+catalog[id].name+Math.ceil(s.until-w.time)+'s';return label;
    };
    system.spec=(w,t)=>custom(t.weapon?.type)?.projectile||({speed:{laser:1700,double:220,shotgun:300,homing:210,remote:210,frag:160,deathray:2100,gatling:285}[t.weapon?.type]||w.constants.bulletSpeed,radius:{laser:2,shotgun:2,gatling:2,deathray:6,frag:7,homing:5,remote:5,double:4}[t.weapon?.type]||w.constants.bulletRadius,life:{laser:.8,double:2.3,shotgun:1.1,frag:3,deathray:1.1,gatling:1.55,homing:9,remote:8}[t.weapon?.type]||w.constants.bulletLifetime,pierceWalls:t.weapon?.type==='deathray'});
    // Execute an isolated candidate with the same fire/update/collision code as combat.
    // The target point is an estimate supplied by the caller, never future input.
    system.preview=(w,t,angle,target)=>{
      const spec=system.spec(w,t),type=t.weapon?.type||'normal',distance=Math.hypot(target.x-t.x,target.y-t.y),range=spec.speed*spec.life;
      const info={weapon:type,range,distance,estimated:true};
      if(type==='frag'&&t.weapon.projectileId||type==='remote'&&t.remoteId){
        const tanks=w.tanks.map(body=>body.id===target.id?{...body,x:target.x,y:target.y}:body),world={...w,tanks};
        const projected=system.projectAttack(world,t,{angle,viewerId:target.id}),report={time:w.time,horizon:projected.horizon,tankRadius:w.constants.tankRadius,scenarios:[{...projected,assumption:'current_heading'}],geometry:{width:w.width,height:w.height,walls:w.walls}};
        const hit=incomingRisk(report,target,0,projected.horizon),self=incomingRisk(report,t,0,projected.horizon);
        return{...info,hit:hit.possibleHitIn!==null&&self.possibleHitIn===null,selfHit:self.possibleHitIn!==null,eta:hit.possibleHitIn,targetId:hit.possibleHitIn!==null?target.id:null,action:projected.action,available:projected.available};
      }
      if(type==='shield'||type==='mine'||custom(type)?.meta.slot==='buff')return{...info,hit:false,deployment:true};
      // Being beyond the target's reach says nothing about a volley returning to us.
      if(!['homing','frag','remote'].includes(type)&&distance>range+w.constants.tankRadius*2+spec.radius+3)info.outOfRange=true;
      const test=create(),hits=[],tanks=w.tanks.map(body=>({...copy(body),weapon:null,skills:{}}));
      let shooter=tanks.find(body=>body.id===t.id);if(!shooter){shooter={...copy(t),weapon:null};tanks.push(shooter)}
      Object.assign(shooter,{x:t.x,y:t.y,a:angle,alive:true,weapon:t.weapon?copy(t.weapon):null,cd:0,gatlingStart:w.time-1,weaponTrigger:-100});
      let victim=tanks.find(body=>body.id===target.id);
      if(!victim)victim=tanks.find(body=>body.id!==t.id&&(body.id==='E')!==(t.id==='E'));
      if(!victim){victim={id:target.id||'prediction_target',alive:true,shieldUntil:target.shieldUntil||0};tanks.push(victim)}
      Object.assign(victim,{x:target.x,y:target.y,alive:true});
      let sequence=0;
      const world={...w,tanks,bullets:[],enabled:false,event:null,visual:null,random:()=>.5,held:()=>false,
        spawn:shot=>{shot.id=++sequence;world.bullets.push(shot);return shot},release:()=>{},
        hit:(body,shot)=>{if(!body.alive)return;body.alive=false;hits.push({id:body.id,time:world.time-w.time,kind:shot.kind})}};
      if(type==='normal'){
        const r=w.constants.bulletRadius,muzzle=w.constants.tankRadius+r+2,x=t.x+Math.cos(angle)*muzzle,y=t.y+Math.sin(angle)*muzzle;
        if(blocked(w,x,y,r))return{...info,hit:false,blockedMuzzle:true};
        world.spawn({kind:'normal',own:t.id,x,y,vx:Math.cos(angle)*spec.speed,vy:Math.sin(angle)*spec.speed,life:spec.life,radius:r,slot:false});
      }else if(!test.fire(world,shooter))return{...info,hit:false,blockedMuzzle:true};
      for(const body of tanks)body.weapon=null;
      const horizon=Math.min(type==='normal'?6:12,spec.life+(type==='deathray'?.6:type==='frag'?1.1:0));
      for(let elapsed=.02;elapsed<=horizon+.0001;elapsed+=.02){
        world.time=w.time+elapsed;test.update(world,.02,true);
        if(hits.some(h=>h.id===t.id)||(type!=='shotgun'&&hits.some(h=>h.id===victim.id))||(!world.bullets.length&&!test.charges.length))break;
      }
      const selfHit=hits.some(h=>h.id===t.id),hit=hits.find(h=>h.id!==t.id&&(h.id==='E')!==(t.id==='E'));
      return{...info,hit:!!hit&&!selfHit,selfHit,selfHitIn:hits.find(h=>h.id===t.id)?.time??null,eta:hit?.time??null,targetId:hit?.id??null,hitIds:hits.map(h=>h.id),
        ...(type==='gatling'||type==='shotgun'?{spreadEstimate:true}:{}),...(custom(type)?{custom:true}:{} )};
    };
    system.aimPath=(w,t)=>{
      const b={x:t.x+Math.cos(t.a)*(w.constants.tankRadius+5),y:t.y+Math.sin(t.a)*(w.constants.tankRadius+5),vx:Math.cos(t.a)*1700,vy:Math.sin(t.a)*1700,radius:2,life:.4},path=[];
      for(let i=0;i<40;i++)move(w,b,.01,(shot,px,py)=>path.push({x:px,y:py,tx:shot.x,ty:shot.y}));return path;
    };
    system.solution=(w,t,target)=>{
      const type=t.weapon?.type,spec=system.spec(w,t),distance=Math.hypot(target.x-t.x,target.y-t.y);
      const cache=solutionCache,key=[type,t.id,t.weapon?.barrel,target.id,target.shieldUntil,t.shieldUntil,target.vx,target.vy].join(':');
      if(cache&&cache.key===key&&cache.walls===w.walls&&w.time>=cache.time&&w.time-cache.time<.12&&Math.hypot(t.x-cache.x,t.y-cache.y)<6&&Math.hypot(target.x-cache.tx,target.y-cache.ty)<6)return cache.value;
      const windup=type==='deathray'?.6:type==='gatling'?Math.max(0,.65-(t.gatlingStart==null?0:w.time-t.gatlingStart)):0;
      let eta=distance/spec.speed+windup,point={x:target.x,y:target.y};
      for(let n=0;n<3;n++){
        point={x:target.x,y:target.y};const steps=Math.ceil(Math.min(4,eta)/.025);
        for(let i=0;i<steps;i++){const nx=point.x+(target.vx||0)*.025,ny=point.y+(target.vy||0)*.025;if(!blocked(w,nx,point.y,w.constants.tankRadius))point.x=nx;if(!blocked(w,point.x,ny,w.constants.tankRadius))point.y=ny}
        eta=Math.hypot(point.x-t.x,point.y-t.y)/spec.speed+windup;
      }
      const direct=Math.atan2(point.y-t.y,point.x-t.x),angles=[direct,t.a];
      if(type==='shotgun')angles.push(direct-.16,direct+.16,direct-.3,direct+.3);
      if(type==='double')angles.push(direct+Math.atan2(9,distance),direct-Math.atan2(9,distance));
      if(type==='homing'||type==='remote'){const hop=route(w,{x:t.x,y:t.y,radius:spec.radius},point);angles.push(Math.atan2(hop.y-t.y,hop.x-t.x))}
      let best=null;
      const consider=angle=>{const result=system.preview(w,t,angle,{...target,...point}),score=(result.selfHit?-10:0)+(result.hit?3:0)-Math.abs(angleDiff(angle,direct))*.01-(result.eta||0)*.001;if(!best||score>best.quality)best={angle,...result,quality:score,point,windup};return result.hit&&!result.selfHit};
      for(const angle of angles)consider(angle);
      if(type==='laser'&&!best.hit)for(let n=0;n<180;n++)consider(n*Math.PI/90);
      solutionCache={key,walls:w.walls,time:w.time,x:t.x,y:t.y,tx:target.x,ty:target.y,value:best};return best;
    };
    system.mineAdvice=(w,t,target)=>{
      const offset=w.constants.tankRadius+14,hop=route(w,{x:target.x,y:target.y,radius:w.constants.tankRadius},t),options=[];
      const evaluate=(x,y,angle,travel=0)=>{
        const tank={x:x+Math.cos(angle)*offset,y:y+Math.sin(angle)*offset},valid=!blocked(w,x,y,9)&&!blocked(w,tank.x,tank.y,w.constants.tankRadius);
        const exits=[0,Math.PI/2,Math.PI,-Math.PI/2].filter(a=>lineClear(w,x,y,x+Math.cos(a)*70,y+Math.sin(a)*70,w.constants.tankRadius));
        const choke=exits.length===2&&Math.abs(Math.cos(exits[0]-exits[1])+1)<.1?1:exits.length>=3?.45:0;
        const routeDistance=segmentDistance(x,y,{x:target.x,y:target.y,tx:hop.x,ty:hop.y});
        const routeTraffic=Math.max(0,1-routeDistance/100),vx=target.vx||0,vy=target.vy||0,speed2=vx*vx+vy*vy;
        const eta=speed2?clamp(((x-target.x)*vx+(y-target.y)*vy)/speed2,0,4):null;
        const intercept=eta===null?0:Math.max(0,1-Math.hypot(target.x+vx*eta-x,target.y+vy*eta-y)/90)*Math.min(1,eta/.7);
        const escape=lineClear(w,tank.x,tank.y,tank.x+Math.cos(angle)*90,tank.y+Math.sin(angle)*90,w.constants.tankRadius);
        const duplicate=system.mines.some(m=>(m.own===t.id||w.time<m.armedAt||m.triggerId)&&Math.hypot(m.x-x,m.y-y)<65),near=Math.hypot(target.x-x,target.y-y);
        const score=valid?-.65+routeTraffic*.85+intercept*.85+choke*.65+(escape?.25:-.8)-travel/260-(duplicate?1.4:0)-(near<45?.6:0):-4;
        return{x,y,angle,tank,score,valid,escape,choke,routeTraffic,intercept,arrivalIn:eta,travel,conditional:'observed_motion_or_route_toward_self'};
      };
      const current=evaluate(t.x-Math.cos(t.a)*offset,t.y-Math.sin(t.a)*offset,t.a);
      const cell=w.constants.cellSize||100;
      for(let x=cell/2;x<w.width;x+=cell)for(let y=cell/2;y<w.height;y+=cell){
        if(Math.hypot(x-t.x,y-t.y)>350)continue;
        for(const [dx,dy]of[[0,0],[cell/2,0],[0,cell/2]])for(const angle of[0,Math.PI/2,Math.PI,-Math.PI/2]){
          const choice=evaluate(x+dx,y+dy,angle,Math.hypot(x+dx-t.x,y+dy-t.y));
          if(choice.valid&&lineClear(w,t.x,t.y,choice.tank.x,choice.tank.y,w.constants.tankRadius))options.push(choice);
        }
      }
      options.sort((a,b)=>b.score-a.score);
      return{score:current.score,weapon:'mine',deployment:true,armDelay:.7,placement:current,placementOptions:options.slice(0,4),advisoryOnly:true,reason:'比较路口、狭道、可见运动与假设来路、布雷后出口和重复覆盖；位置由AI选择'};
    };
    system.advice=(w,t,target)=>{
      const type=t.weapon?.type;if(!type)return null;
      const distance=Math.hypot(t.x-target.x,t.y-target.y);
      if(type==='shield'){
        const forecast=system.forecast(w,2,.05);let eta=Infinity;
        for(const f of forecast.frames)if(f.points.some(p=>Math.hypot(p.x-t.x,p.y-t.y)<w.constants.tankRadius+12+p.radius)){eta=f.time-w.time;break}
        const enemyArmed=target.weapon?.ammo>0||target.ammo>0||(target.live??5)<5;
        const enemyRange=system.spec(w,target),reach=enemyRange.speed*enemyRange.life;
        return{score:(eta<2?1.5-eta*.4:0)+(enemyArmed?Math.max(0,1-distance/Math.min(500,reach)):0)-.25,weapon:type,deployment:true,duration:6,incomingEta:eta===Infinity?null:eta,enemyArmed,enemyRange:reach,advisoryOnly:true,reason:'比较真实来弹预演、敌方射程与护盾有效期；没有危险时可保存，AI决定启用'};
      }
      const d=custom(type);if(d?.meta.slot==='buff')return{score:.4,weapon:type,deployment:true,reason:'主动启用增益'};
      if(d?.advice){const result=invoke({...w,event:null},d,'advice',{world:view(w),tank:copy(t),state:copy(t.weapon.state),target:copy(target)});if(result&&Number.isFinite(result.score))return result}
      if(type==='mine')return system.mineAdvice(w,t,target);
      if(type==='frag'&&t.weapon.projectileId){const b=w.bullets.find(b=>b.id===t.weapon.projectileId);if(!b)return{score:-1};return{score:1.5-Math.hypot(b.x-target.x,b.y-target.y)/120-Math.max(0,1-Math.hypot(b.x-t.x,b.y-t.y)/100)*3,weapon:type,detonate:true,reason:'比较破片对目标与自身的风险'}}
      const aim=system.solution(w,t,target),ray=system.preview(w,t,t.a,{...target,...aim.point}),spec=system.spec(w,t);
      const angular=type==='shotgun'?.3:.12,difference=Math.abs(angleDiff(aim.angle,t.a)),shieldPenalty=target.shieldUntil>w.time+(ray.eta||0)?.9:0;
      const overshoot=Math.max(0,distance-spec.speed*spec.life)/(spec.speed*spec.life||1);
      const score=ray.selfHit?-4:(ray.hit?1.3:-1.1)-difference/angular-shieldPenalty-overshoot*2;
      return{score,weapon:type,range:spec.speed*spec.life,distance,outOfRange:!!ray.outOfRange,hit:ray.hit,selfHit:!!ray.selfHit,selfHitIn:ray.selfHitIn,eta:ray.eta,
        ...(type==='shotgun'?{pattern:{pellets:20,halfSpread:.3135,pathRange:330,widthAtTarget:2*Math.tan(.3135)*Math.min(distance,330),wholeVolley:true},reposition:ray.outOfRange?'approach_or_flank':ray.selfHit?'change_firing_lane':null}:{}),
        aim:{angle:aim.angle,hit:aim.hit,eta:aim.eta,point:aim.point,windup:aim.windup,selfHit:aim.selfHit},
        reason:ray.selfHit?'候选射击会自伤':ray.outOfRange?'目标超出当前武器路径射程':ray.hit?'按当前武器的真实发射、反弹、穿透与寿命可命中':'当前射角无法命中，可选择瞄准建议或改变位置'};
    };
    system.drawProjectile=(ctx,b,visual={})=>{const d=custom(b.kind);if(!d?.drawProjectile)return false;ctx.save();try{return invoke({event:null},d,'drawProjectile',{ctx,projectile:copy(b),...visual})===true}finally{ctx.restore()}};
    system.drawWorld=(ctx,w,visual={})=>{
      const ids=new Set([...w.bullets.map(b=>b.kind),...w.tanks.flatMap(t=>[t.weapon?.type,...Object.keys(t.skills||{})])]);
      for(const id of ids){const d=custom(id);if(d?.drawWorld){ctx.save();try{invoke({event:null},d,'drawWorld',{ctx,world:view(w),...visual})}finally{ctx.restore()}}}
    };
    return system;
  }
  return{catalog,create,move,route,radius,lineClear,incomingRisk,sandboxSource:()=>"("+weaponLibrary.toString()+")("+Skills.source()+")",register:input=>registry.register(input),definition:id=>registry.get(id),descriptions:registry.descriptions,apiVersion:4};
});
