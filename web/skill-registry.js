(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.AITankSkills=api})(typeof globalThis!=='undefined'?globalThis:this,function skillLibrary(){
  'use strict';
  const hooks=['equip','canUse','fire','update','expire','hit','guide','forecast','threatForecast','advice','drawProjectile','drawWorld','cleanup'];
  const finite=(v,min,max)=>Number.isFinite(v)&&v>=min&&v<=max;
  function create(){
    const metadata=Object.create(null),definitions=new Map();
    const catalog=new Proxy(metadata,{set:()=>false,deleteProperty:()=>false,defineProperty:()=>false});
    function register(input,{builtin=false}={}){
      const id=input?.id;if(typeof id!=='string'||!/^[a-z][a-z0-9_]{1,31}$/.test(id)||id==='normal')throw new Error('技能 id 必须是 2–32 位小写字母、数字或下划线');
      if(definitions.has(id))throw new Error('技能已注册：'+id);
      if(typeof input.name!=='string'||!input.name.trim()||input.name.length>32||typeof input.icon!=='string'||!input.icon||input.icon.length>4||!/^#[0-9a-f]{6}$/i.test(input.color||''))throw new Error('技能需要名称、短图标和六位颜色');
      if(!Number.isSafeInteger(input.ammo)||input.ammo<0||input.ammo>999)throw new Error('技能弹量无效');
      const cooldown=input.cooldown??.4;if(!finite(cooldown,0,60))throw new Error('技能冷却无效');
      const duration=input.duration??0;if(!finite(duration,0,300))throw new Error('技能持续时间无效');
      if(input.slot!==undefined&&!['weapon','buff'].includes(input.slot))throw new Error('技能槽位无效');
      if(!builtin&&input.slot==='buff'&&duration<=0)throw new Error('持续增益需要有效 duration');
      for(const name of hooks)if(input[name]!==undefined&&typeof input[name]!=='function')throw new Error('技能回调无效：'+name);
      const projectile=input.projectile;
      if(projectile&&(!finite(projectile.speed,1,5000)||!finite(projectile.radius,1,40)||!finite(projectile.life,.01,60)))throw new Error('技能弹体需要有效 speed/radius/life');
      if(projectile)for(const name of ['pierceWalls','pierceTanks','damage'])if(projectile[name]!==undefined&&typeof projectile[name]!=='boolean')throw new Error('弹体开关必须是布尔值');
      if(!builtin&&input.slot!=='buff'&&!projectile&&!input.fire)throw new Error('主动技能需要 projectile 或 fire');
      if(input.glyph!==undefined&&(typeof input.glyph!=='string'||!input.glyph.trim()||input.glyph.length>2048||!/^[MmLlHhVvCcSsQqTtAaZz0-9eE.,+\-\s]+$/.test(input.glyph)))throw new Error('技能图标需要有效的 SVG 路径');
      const hint=String(input.hint||'').slice(0,180),aiDescription=String(input.aiDescription||hint).slice(0,240);
      const meta=Object.freeze({name:input.name.trim(),icon:input.icon,color:input.color,ammo:input.ammo,hint,...(input.glyph?{glyph:input.glyph}:{}),slot:input.slot||'weapon',...(builtin?{}:{original:true})});
      const definition=Object.freeze({id,meta,builtin,cooldown,duration,spawn:input.spawn!==false,projectile:projectile?Object.freeze({...projectile}):null,aiDescription,...Object.fromEntries(hooks.filter(k=>input[k]).map(k=>[k,input[k]]))});
      definitions.set(id,definition);metadata[id]=meta;return id;
    }
    return{catalog,register,get:id=>definitions.get(id),list:()=>[...definitions.values()],descriptions:ids=>[...definitions.values()].filter(d=>!d.builtin&&(!ids||ids.includes(d.id))).map(d=>({id:d.id,name:d.meta.name,slot:d.meta.slot,ammo:d.meta.ammo,cooldown:d.cooldown,...(d.duration?{duration:d.duration}:{}),...(d.projectile?{projectile:d.projectile}:{}),...(d.threatForecast?{threatForecast:true}:{}),description:d.aiDescription}))};
  }
  return{create,source:()=>"("+skillLibrary.toString()+")()"};
});
