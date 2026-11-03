(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.AITankFX=api})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const presets=Object.freeze({
    off:{name:'关闭',particles:0,rings:0,trails:0,density:0,glow:0},
    low:{name:'流畅',particles:70,rings:8,trails:4,density:.3,glow:.35},
    medium:{name:'均衡',particles:180,rings:14,trails:8,density:.6,glow:.65},
    high:{name:'精致',particles:360,rings:22,trails:13,density:1,glow:1},
    ultra:{name:'极致',particles:620,rings:30,trails:18,density:1.6,glow:1.2}
  });
  const defaults=Object.freeze({quality:'high',intensity:.75,glow:true,trails:true,ambient:true,shake:false,reducedMotion:false});
  const colors={P:'#83bdff',P2:'#79e2bd',E:'#ff917b',laser:'#79eaff',deathray:'#cba6ff',homing:'#ff8da8',remote:'#aebeff',frag:'#f2b8eb',shrapnel:'#ffc78b',mine:'#e7bf79',shield:'#9cffe1',double:'#ffd395',shotgun:'#ffbb83',gatling:'#ffdf8c'};
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  function settings(value={},fallback=defaults){
    const out={...fallback};if(!value||typeof value!=='object')return out;
    if(Object.hasOwn(presets,value.quality))out.quality=value.quality;
    if(Number.isFinite(value.intensity))out.intensity=clamp(value.intensity,0,1);
    for(const key of['glow','trails','ambient','shake','reducedMotion'])if(typeof value[key]==='boolean')out[key]=value[key];
    return out;
  }
  function create(input={},extensions={}){
    let config=settings(input),profile=presets[config.quality],time=0,seed=0x7f4a7c15,trailedAt=-1,shakeEnergy=0;
    const particles=[],rings=[],marks=[],tracks=new Map(),recoils=new Map(),sprites=new Map(),tankSamples=new Map();
    // Visual randomness never advances the game's maze, spawn or weapon RNG.
    const random=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return(seed>>>0)/4294967296};
    const enabled=()=>profile.density>0&&config.intensity>0;
    const color=(owner,kind)=>extensions.color?.(kind)||colors[kind]||colors[owner]||'#c7dcff';
    function trim(){particles.splice(0,Math.max(0,particles.length-profile.particles));rings.splice(0,Math.max(0,rings.length-profile.rings));if(!enabled()){particles.length=0;rings.length=0;marks.length=0;tracks.clear();recoils.clear();shakeEnergy=0}for(const track of tracks.values())track.points.splice(0,Math.max(0,track.points.length-profile.trails))}
    function configure(value){config=settings(value,config);profile=presets[config.quality];trim();if(!config.trails)tracks.clear();if(config.reducedMotion||!config.shake)shakeEnergy=0;return{...config}}
    function particle(x,y,tint,angle,speed,life,size,kind='spark'){
      if(!enabled()||particles.length>=profile.particles)return;
      particles.push({x,y,px:x,py:y,vx:Math.cos(angle)*speed,vy:Math.sin(angle)*speed,life,total:life,size,color:tint,kind});
    }
    function spray(x,y,tint,count,speed,life=.5,angle=0,spread=Math.PI*2){
      const n=Math.round(count*profile.density*config.intensity*(config.reducedMotion?.45:1));
      for(let i=0;i<n;i++)particle(x,y,tint,angle+(random()-.5)*spread,speed*(.25+random()*.75),life*(.6+random()*.6),1+random()*2.4);
    }
    function ring(x,y,tint,size=65,life=.6,kind='blast'){
      if(!enabled())return;if(rings.length>=profile.rings)rings.shift();rings.push({x,y,color:tint,size,life,total:life,kind});
    }
    function flash(x,y,tint,size=40){ring(x,y,tint,size,.16,'light')}
    function muzzle(t,kind='normal'){
      if(!enabled())return;const rear=kind==='mine',a=t.a+(rear?Math.PI:0),x=t.x+Math.cos(a)*31,y=t.y+Math.sin(a)*31,tint=color(t.id,kind);
      recoils.set(t.id,time);flash(x,y,tint,kind==='deathray'?70:kind==='shotgun'?54:35);
      spray(x,y,tint,kind==='shotgun'?14:kind==='gatling'?3:6,95,.23,a,.8);if(!rear)spray(x,y,'#ffe3ab',3,55,.22,a,1.2);
    }
    function explosion(x,y,tint='#ffd395'){
      if(!enabled())return;
      spray(x,y,tint,44,220,.75);spray(x,y,'#fff0d5',12,145,.35);
      if(profile.density>=.6&&!config.reducedMotion)for(let i=0;i<Math.round(5*profile.density);i++)particle(x+(random()-.5)*15,y+(random()-.5)*15,'#a5b3cb',random()*7,35,.85,9+random()*16,'smoke');
      ring(x,y,tint,95,.64);ring(x,y,'#edf5ff',50,.32);flash(x,y,'#ffd9a9',100);
      marks.push({x,y,life:3.5,total:3.5});if(marks.length>18)marks.shift();shakeEnergy=Math.min(4,shakeEnergy+2.5);
    }
    function ricochet(x,y,kind,owner){if(!enabled())return;spray(x,y,color(owner,kind),kind==='laser'?8:4,95,.25);flash(x,y,color(owner,kind),22)}
    function pickup(t,kind){if(!enabled())return;ring(t.x,t.y,color(t.id,kind),48,.5,'pickup');spray(t.x,t.y,color(t.id,kind),18,75,.65)}
    function deflect(x,y,owner){if(!enabled())return;ring(x,y,'#9cffe1',25,.3,'deflect');spray(x,y,'#b1ffdf',9,80,.3)}
    function reset(){particles.length=0;rings.length=0;marks.length=0;tracks.clear();recoils.clear();tankSamples.clear();time=0;trailedAt=-1;shakeEnergy=0}
    function update(dt,world={}){
      dt=clamp(Number.isFinite(dt)?dt:0,0,.1);time+=dt;shakeEnergy*=Math.exp(-dt*12);
      for(let i=particles.length-1;i>=0;i--){const p=particles[i];p.life-=dt;if(p.life<=0){particles.splice(i,1);continue}p.px=p.x;p.py=p.y;p.x+=p.vx*dt;p.y+=p.vy*dt;const drag=Math.exp(-dt*(p.kind==='smoke'?2:4));p.vx*=drag;p.vy*=drag}
      for(const array of[rings,marks])for(let i=array.length-1;i>=0;i--){array[i].life-=dt;if(array[i].life<=0)array.splice(i,1)}
      for(const[id,stamp]of recoils)if(time-stamp>.2)recoils.delete(id);
      if(!enabled())return;
      const shells=world.bullets||[],live=new Set(shells.map(b=>b.id));for(const[id]of tracks)if(!live.has(id))tracks.delete(id);
      if(config.trails&&time-trailedAt>=.025){
        trailedAt=time;for(const b of shells){if(!Number.isFinite(b.id)||b.removed)continue;
          if(!tracks.has(b.id)&&tracks.size>=220)continue;
          let track=tracks.get(b.id);if(!track){track={color:color(b.own,b.kind),kind:b.kind,points:[]};tracks.set(b.id,track)}
          track.points.push({x:b.x,y:b.y});if(track.points.length>profile.trails)track.points.shift();
          if((b.kind==='homing'||b.kind==='remote')&&!config.reducedMotion)spray(b.x,b.y,'#ffd2a1',2,35,.35,Math.atan2(-b.vy,-b.vx),.4);
        }
      }
      for(const t of world.tanks||[]){const old=tankSamples.get(t.id);tankSamples.set(t.id,{x:t.x,y:t.y,time});
        if(!old||!t.alive||!config.ambient||config.reducedMotion||time-old.time>.15||Math.hypot(t.x-old.x,t.y-old.y)<.4)continue;
        if(random()<dt*10*profile.density)particle(t.x-Math.cos(t.a)*22,t.y-Math.sin(t.a)*22,color(t.id),t.a+Math.PI,15,.4,2,'dust');
      }
    }
    function glow(ctx,x,y,size,tint,alpha=1){
      if(!config.glow||!enabled())return;
      let sprite=sprites.get(tint);if(!sprite){
        const canvas=typeof OffscreenCanvas!=='undefined'?new OffscreenCanvas(64,64):document.createElement('canvas');canvas.width=canvas.height=64;
        const c=canvas.getContext('2d'),g=c.createRadialGradient(32,32,0,32,32,32);g.addColorStop(0,tint+'a0');g.addColorStop(.22,tint+'50');g.addColorStop(1,tint+'00');c.fillStyle=g;c.fillRect(0,0,64,64);sprite=canvas;sprites.set(tint,sprite);
      }
      ctx.save();ctx.globalCompositeOperation='lighter';ctx.globalAlpha=clamp(alpha*config.intensity*profile.glow,0,1);ctx.drawImage(sprite,x-size,y-size,size*2,size*2);ctx.restore();
    }
    function drawUnder(ctx){
      if(!enabled())return;ctx.save();
      for(const m of marks){ctx.globalAlpha=m.life/m.total*.18*config.intensity;ctx.fillStyle='#030814';ctx.beginPath();ctx.ellipse(m.x,m.y,35,22,.3,0,Math.PI*2);ctx.fill()}
      if(config.trails)for(const track of tracks.values()){
        const points=track.points;if(points.length<2)continue;const missile=['homing','remote'].includes(track.kind),beam=['laser','deathray'].includes(track.kind);
        if(beam)continue;
        ctx.lineCap='round';for(let i=1;i<points.length;i++){ctx.globalAlpha=i/points.length*.34*config.intensity;ctx.strokeStyle=track.color;ctx.lineWidth=(missile?5:2.4)*i/points.length;ctx.beginPath();ctx.moveTo(points[i-1].x,points[i-1].y);ctx.lineTo(points[i].x,points[i].y);ctx.stroke()}
        const end=points.at(-1);if(missile)glow(ctx,end.x,end.y,24,track.color,.6);
      }ctx.restore();
    }
    function drawOver(ctx){
      if(!enabled())return;ctx.save();
      for(const r of rings){const progress=1-r.life/r.total,alpha=(1-progress)*config.intensity;
        if(r.kind==='light'){glow(ctx,r.x,r.y,r.size*(.55+progress*.45),r.color,alpha*.8);continue}
        const size=r.size*(config.reducedMotion?.75:.15+.85*(1-Math.pow(1-progress,3)));
        ctx.globalAlpha=alpha*(r.kind==='blast'?.65:.5);ctx.strokeStyle=r.color;ctx.lineWidth=(1-progress)*2+.5;ctx.beginPath();
        if(r.kind==='pickup'){
          for(const side of[-1,1])for(const up of[-1,1]){ctx.moveTo(r.x+side*size,r.y+up*(size-8));ctx.lineTo(r.x+side*size,r.y+up*size);ctx.lineTo(r.x+side*(size-8),r.y+up*size)}
        }else ctx.arc(r.x,r.y,size,0,Math.PI*2);ctx.stroke();
        if(r.kind==='blast'&&profile.density>=1){ctx.globalAlpha=alpha*.07;ctx.fillStyle=r.color;ctx.fill()}
      }
      for(const p of particles){const ratio=p.life/p.total;ctx.globalAlpha=ratio*config.intensity;
        if(p.kind==='smoke'){ctx.globalAlpha=ratio*.1*config.intensity;ctx.fillStyle=p.color;ctx.beginPath();ctx.arc(p.x,p.y,p.size*(1.3-ratio*.6),0,Math.PI*2);ctx.fill();continue}
        if(profile.density>=1&&p.kind==='spark')glow(ctx,p.x,p.y,p.size*5,p.color,ratio*.4);
        ctx.strokeStyle=p.color;ctx.fillStyle=p.color;ctx.lineWidth=p.size*ratio;ctx.lineCap='round';ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(p.x-p.vx*.025,p.y-p.vy*.025);ctx.stroke();
      }ctx.restore();
    }
    function beam(ctx,effect){
      const life=clamp(effect.life/.12,0,1),tint=effect.kind==='laser'?colors.laser:colors.deathray;
      ctx.save();ctx.lineCap='round';ctx.lineJoin='round';const path=()=>{ctx.beginPath();let last=null;for(const p of effect.path){if(!last||Math.hypot(last.tx-p.x,last.ty-p.y)>.1)ctx.moveTo(p.x,p.y);ctx.lineTo(p.tx,p.ty);last=p}ctx.stroke()};
      if(enabled()&&config.glow){ctx.globalCompositeOperation='lighter';ctx.strokeStyle=tint;ctx.globalAlpha=life*.12*config.intensity;ctx.lineWidth=effect.kind==='laser'?14:25;path();ctx.globalAlpha=life*.5*config.intensity;ctx.lineWidth=effect.kind==='laser'?5:10;path()}
      ctx.globalCompositeOperation='source-over';ctx.globalAlpha=life*.9;
      if(effect.kind==='deathray'){ctx.strokeStyle=tint;ctx.lineWidth=(effect.radius||6)*2;path();ctx.strokeStyle='#eddcff';ctx.lineWidth=7;path()}
      ctx.strokeStyle=enabled()?'#f1faff':effect.kind==='deathray'?'#f7edff':tint;ctx.lineWidth=effect.kind==='laser'?1.8:3.5;path();ctx.restore();
    }
    function offset(){return config.shake&&!config.reducedMotion&&enabled()?{x:Math.sin(time*83)*shakeEnergy*config.intensity,y:Math.cos(time*97)*shakeEnergy*config.intensity}:{x:0,y:0}}
    function stats(){return{time,quality:config.quality,particles:particles.length,rings:rings.length,trails:tracks.size,trailPoints:[...tracks.values()].reduce((n,t)=>n+t.points.length,0),limits:{...profile}}}
    return{configure,reset,update,muzzle,explosion,ricochet,pickup,deflect,glow,drawUnder,drawOver,beam,offset,stats,color,
      get config(){return{...config}},get time(){return time},get active(){return enabled()},recoil:id=>Math.max(0,1-(time-(recoils.get(id)??-10))/.16)};
  }
  function preview(canvas,config){
    const ctx=canvas.getContext('2d'),w=canvas.width,h=canvas.height,fx=create(config),g=ctx.createLinearGradient(0,0,w,h);g.addColorStop(0,'#0c1827');g.addColorStop(1,'#141322');ctx.fillStyle=g;ctx.fillRect(0,0,w,h);
    ctx.strokeStyle='#263a51';ctx.lineWidth=1;for(let x=20;x<w;x+=40){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,h);ctx.stroke()}
    ctx.fillStyle='#30485c';ctx.fillRect(w*.72,25,8,h-50);fx.explosion(w*.72,h*.48);fx.muzzle({id:'P',x:w*.16,y:h*.6,a:-.15},'normal');
    for(let i=0;i<7;i++)fx.update(.02,{bullets:[{id:1,x:w*.23+i*14,y:h*.6-i*2,vx:140,vy:-20,own:'P'}]});
    fx.drawUnder(ctx);fx.glow(ctx,w*.35,h*.56,30,'#83bdff');ctx.fillStyle='#ecf8ff';ctx.beginPath();ctx.arc(w*.35,h*.56,4,0,Math.PI*2);ctx.fill();
    ctx.save();ctx.translate(w*.16,h*.6);ctx.rotate(-.15);ctx.fillStyle='#5183aa';ctx.fillRect(-18,-13,36,26);ctx.fillStyle='#c0e7ff';ctx.fillRect(0,-2,29,4);ctx.restore();fx.drawOver(ctx);
  }
  return{presets,defaults,settings,create,preview};
});
