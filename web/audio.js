(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.AITankAudio=api})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const defaults=Object.freeze({enabled:true,volume:.55});
  const cues=Object.freeze(Object.fromEntries(Object.entries({
    cannon:{label:'普通炮 · 弹性短响',files:['cannon-1','cannon-2'],gain:.42,group:'gun',priority:2},
    double:{label:'双管炮 · 交替轻点',files:['double'],gain:.35,group:'gun',priority:2},
    shotgun:{label:'霰弹枪 · 蓬松散射',files:['shotgun'],gain:.45,group:'gun',priority:2},
    gatling:{label:'加特林 · 短脉冲',files:['gatling'],gain:.2,group:'gun',priority:1},
    laser:{label:'激光 · 清亮短咻',files:['laser'],gain:.3,group:'gun',priority:2},
    homing:{label:'追踪弹 · 上扬滑音',files:['homing'],gain:.3,group:'gun',priority:2},
    remote:{label:'遥控导弹 · 回旋滑音',files:['remote'],gain:.28,group:'gun',priority:2},
    frag:{label:'破片弹 · 轻巧投射',files:['frag'],gain:.32,group:'gun',priority:2},
    mine:{label:'地雷 · 轻扣布设',files:['mine'],gain:.25,group:'utility',priority:1},
    deathray:{label:'死亡射线 · 柔亮能量束',files:['deathray'],gain:.37,group:'gun',priority:3},
    charge:{label:'死亡射线 · 蓄能',files:['charge'],gain:.18,group:'charge',priority:2},
    shield:{label:'护盾 · 力场展开',files:['shield'],gain:.3,group:'utility',priority:2},
    deflect:{label:'护盾 · 清脆反射',files:['deflect'],gain:.23,group:'impact',priority:2},
    deactivate:{label:'护盾 · 消散',files:['shield-off'],gain:.18,group:'utility',priority:1},
    bounce:{label:'炮弹 · 轻弹回响',files:['ricochet-1','ricochet-2'],gain:.16,group:'impact',priority:0},
    explosion:{label:'坦克 / 弹体 · 电子碎爆',files:['explosion-1','explosion-2'],gain:.45,group:'explosion',priority:3},
    pickup:{label:'道具 · 拾取确认',files:['pickup'],gain:.27,group:'utility',priority:2},
    mine_trigger:{label:'地雷 · 触发警示',files:['mine-trigger'],gain:.25,group:'utility',priority:2},
    ui:{label:'界面 · 轻触选择',files:['ui-click'],gain:.13,group:'ui',priority:0},
    start:{label:'对局 · 出击提示',files:['round-start'],gain:.24,group:'ui',priority:2},
    victory:{label:'对局 · 人类方获胜',files:['victory'],gain:.3,group:'result',priority:3},
    defeat:{label:'对局 · AI 方获胜',files:['defeat'],gain:.23,group:'result',priority:3},
    motion:{label:'坦克 · 轻柔运动细响',files:['tread-loop'],gain:.035,group:'motion',priority:-1}
  }).map(([id,cue])=>[id,Object.freeze({...cue,files:Object.freeze(cue.files)})])));
  const files=Object.freeze([...new Set(Object.values(cues).flatMap(c=>c.files))]);
  const bankVersion='arcade-2';
  const encoded=new Map();
  const fetchAsset=typeof globalThis.fetch==='function'?globalThis.fetch.bind(globalThis):null;
  function settings(value={},fallback=defaults){
    const out={...fallback};if(!value||typeof value!=='object')return out;
    if(typeof value.enabled==='boolean')out.enabled=value.enabled;
    if(Number.isFinite(value.volume))out.volume=Math.max(0,Math.min(1,value.volume));return out;
  }
  function cueFor(event,params={}){
    if(event==='fire')return ['double','shotgun','gatling','laser','homing','remote','frag','mine','deathray','shield'].includes(params.weapon)?params.weapon:'cannon';
    return Object.hasOwn(cues,event)?event:null;
  }
  function create(input={},options={}){
    let config=settings(input),context=null,master=null,blocked=false,loading=null,played=0,unavailable=false,failed=0,seed=0x4f3b2a19;
    const voices=new Set(),lastEvents=new Map(),buffers=new Map(),motions=new Map(),positions=new Map(),limit=12;
    const groupLimits={gun:5,impact:3,explosion:3,utility:4,motion:3,ui:2,result:2,charge:2};
    const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296};
    const running=()=>!!context&&(context.state==='running'||!!options.offline);
    const permitted=preview=>running()&&config.enabled&&config.volume>0&&(!blocked||preview);
    function finish(voice){if(voice.finished)return;voice.finished=true;for(const node of voice.nodes)try{node.disconnect()}catch{}voices.delete(voice)}
    function stopVoice(voice,immediate=false){
      if(voice.stopping||voice.finished)return;voice.stopping=true;
      const now=context.currentTime;voice.gain.gain.cancelScheduledValues(now);
      if(immediate)voice.gain.gain.setValueAtTime(0,now);else voice.gain.gain.setTargetAtTime(.00001,now,.004);
      try{voice.source.stop(now+(immediate?0:.025))}catch{}
      voices.delete(voice);
    }
    function stopAll(){
      if(context)for(const voice of [...voices])stopVoice(voice);
      motions.clear();positions.clear();lastEvents.clear();
    }
    function stopMotion(){
      if(context)for(const voice of [...voices])if(voice.group==='motion')stopVoice(voice);
      motions.clear();positions.clear();
    }
    function stopOwner(id){
      if(context)for(const voice of [...voices])if(voice.owner===id&&['motion','charge'].includes(voice.group))stopVoice(voice);
      motions.delete(id);positions.delete(id);
    }
    function configure(value){
      config=settings(value,config);if(master)master.gain.setTargetAtTime(config.enabled?config.volume:0,context.currentTime,.015);
      if(!config.enabled||config.volume===0)stopAll();return{...config};
    }
    function asset(file){
      if(options.assetLoader)return options.assetLoader(file);
      const base=options.baseURL||(typeof document!=='undefined'?document.baseURI:undefined),url=new URL('assets/audio/'+file+'.mp3?bank='+bankVersion,base).href;
      if(!fetchAsset)throw new Error('Audio asset transport unavailable');
      if(!encoded.has(url))encoded.set(url,fetchAsset(url).then(response=>{if(!response.ok)throw new Error('Sound asset '+response.status);return response.arrayBuffer()}).catch(error=>{encoded.delete(url);throw error}));
      return encoded.get(url);
    }
    async function preload(){
      if(!context)return false;if(loading)return loading;
      const task=(async()=>{
        failed=0;
        await Promise.all(files.filter(file=>!buffers.has(file)).map(async file=>{
          try{const bytes=await asset(file),buffer=await context.decodeAudioData(bytes.slice(0));if(buffer.length&&buffer.duration>0)buffers.set(file,buffer);else failed++}catch{failed++}
        }));return buffers.size===files.length;
      })();
      loading=task;try{return await task}finally{if(loading===task)loading=null}
    }
    async function unlock(){
      if(!config.enabled||config.volume<=0||unavailable)return false;
      try{
        if(!context){
          const Constructor=typeof globalThis!=='undefined'&&(globalThis.AudioContext||globalThis.webkitAudioContext);
          if(!options.contextFactory&&!Constructor){unavailable=true;return false}
          context=options.contextFactory?options.contextFactory():new Constructor();master=context.createGain();master.gain.value=config.volume;
          const limiter=context.createDynamicsCompressor();limiter.threshold.value=-14;limiter.knee.value=12;limiter.ratio.value=6;limiter.attack.value=.002;limiter.release.value=.16;
          master.connect(limiter);limiter.connect(context.destination);
        }
        if(context.state==='suspended'&&!options.offline)await context.resume();
        await preload();return running()&&buffers.size>0;
      }catch{unavailable=true;return false}
    }
    function start(id,params={},loop=false){
      const cue=cues[id];if(!cue||!permitted(params.preview))return null;
      const available=cue.files.filter(file=>buffers.has(file));if(!available.length)return null;
      const group=[...voices].filter(voice=>voice.group===cue.group);
      if(group.length>=groupLimits[cue.group]){
        if(loop)return null;stopVoice(group[0],true);
      }
      while(voices.size>=limit){
        const quietest=[...voices].sort((a,b)=>a.priority-b.priority||a.time-b.time)[0];
        if(quietest.priority>cue.priority)return null;stopVoice(quietest,true);
      }
      const file=available[Math.floor(random()*available.length)],now=context.currentTime,source=context.createBufferSource(),gain=context.createGain(),pan=context.createStereoPanner?.();
      source.buffer=buffers.get(file);source.loop=loop;source.playbackRate.value=params.rate??(loop?1:.98+random()*.04);
      const volume=cue.gain*(params.preview?.8:1)*(params.gain??1)/Math.sqrt(1+group.length*.18);
      gain.gain.setValueAtTime(loop?.00001:volume,now);
      source.connect(gain);const nodes=[source,gain];
      if(pan){pan.pan.value=Math.max(-.7,Math.min(.7,Number.isFinite(params.pan)?params.pan:0));gain.connect(pan);pan.connect(master);nodes.push(pan)}else gain.connect(master);
      const voice={source,gain,pan,nodes,owner:params.owner,group:cue.group,priority:cue.priority,time:now,baseVolume:volume,file,loop};
      voices.add(voice);source.onended=()=>finish(voice);source.start(now);played++;return voice;
    }
    function play(event,params={}){
      const id=cueFor(event,params);if(!id||!permitted(params.preview))return false;
      const now=context.currentTime,key=id+':'+(params.weapon||'')+':'+(params.owner??Math.round((params.pan||0)*4));
      const interval=id==='bounce'?.045:id==='gatling'?.055:.025;
      if(now-(lastEvents.get(key)??-100)<interval)return false;
      const voice=start(id,params);if(!voice)return false;lastEvents.set(key,now);return true;
    }
    function updateMotion(tanks,dt){
      if(!permitted(false)||!Number.isFinite(dt)||dt<=0){stopMotion();return}
      const living=new Set();
      for(const t of tanks){
        if(!t.alive)continue;living.add(t.id);const old=positions.get(t.id);positions.set(t.id,{x:t.x,y:t.y,a:t.a});
        const travel=old?Math.hypot(t.x-old.x,t.y-old.y):0,rotation=old?Math.abs(Math.atan2(Math.sin(t.a-old.a),Math.cos(t.a-old.a))):0;
        const speed=(travel+rotation*15)/dt,moving=!!old&&(travel>.01||rotation>.002)&&travel<40;
        let voice=motions.get(t.id);if(voice&&!voices.has(voice)){motions.delete(t.id);voice=null}
        if(!moving){if(voice)stopVoice(voice);motions.delete(t.id);continue}
        if(!voice){voice=start('motion',{owner:t.id,pan:t.pan,gain:.8},true);if(voice)motions.set(t.id,voice)}
        if(voice){const now=context.currentTime;voice.source.playbackRate.setTargetAtTime(.96+Math.min(1.3,speed/100)*.1,now,.08);voice.gain.gain.setTargetAtTime(voice.baseVolume*Math.min(1,speed/60),now,.035);voice.pan?.pan.setTargetAtTime(Math.max(-.7,Math.min(.7,t.pan||0)),now,.04)}
      }
      for(const id of positions.keys())if(!living.has(id)){stopOwner(id);positions.delete(id)}
    }
    function setBlocked(value){blocked=!!value;if(blocked)stopAll()}
    function stats(){return{ready:running()&&buffers.size===files.length,unavailable,blocked,voices:voices.size,limit,played,loaded:buffers.size,total:files.length,loading:!!loading,failed,engine:'freesound-samples',loops:motions.size}}
    return{configure,unlock,preload,play,updateMotion,stopMotion,stopOwner,stopAll,setBlocked,stats,get config(){return{...config}}};
  }
  return{defaults,settings,cues,files,cueFor,create};
});
