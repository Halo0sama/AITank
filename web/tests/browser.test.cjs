const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('playwright');

let browser, server, origin;
const streams=[];
const reviews=[];
let reviewReply=null;
let closedStreams=0;
test.before(async()=>{
  server=http.createServer(async(request,response)=>{
    if(request.url==='/mock/messages'){
      let raw='';for await(const chunk of request)raw+=chunk;
      const body=JSON.parse(raw);
      if(!body.stream){reviews.push(body);response.setHeader('Content-Type','application/json');response.end(JSON.stringify({content:[{type:'text',text:JSON.stringify(reviewReply||{memory_add:['先检查反弹弹道'],set_algo:null})}]}));return}
      streams.push(body);
      response.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache'});
      response.on('close',()=>closedStreams++);
      const text='{"set_algo":{"name":"stream_policy","desc":"避开 {墙}","steps":[{"when":"always","do":"chase_and_fire"}]}}\n{"cmd":"algo","name":"chase_and_fire","set_algo":{"name":"wrapped_meta","steps":[{"when":"always","do":"roam"}]}}\n{"cmd":"combat","mode":"duel"}\n{"cmd":"gunnery","mode":"pressure"}';
      const frame=Buffer.from('event: content_block_delta\r\ndata: '+JSON.stringify({type:'content_block_delta',delta:{type:'text_delta',text}})+'\r\n\r\n');
      for(let i=0;i<frame.length&&!response.destroyed;i+=7){response.write(frame.subarray(i,i+7));await new Promise(resolve=>setImmediate(resolve))}
      const later=setTimeout(()=>{
        if(!response.destroyed)response.write('data: '+JSON.stringify({type:'content_block_delta',delta:{type:'text_delta',text:'\n{"cmd":"fire"}'}})+'\n\n');
      },100);
      response.on('close',()=>clearTimeout(later));
      // Keep the response open so the client must cancel and refresh its snapshot.
      return;
    }
    const name=request.url.split('?')[0]==='/'?'index.html':request.url.split('?')[0].slice(1);
    if(!['index.html','game.css','effects.js','audio.js','presentation.js','ai-core.js','ai-budget.js','ai-programs.js','ai-dodge.js','ai-ammo.js','ai-tactics.js','skill-registry.js','weapons.js','custom-skills.js','ai-sandbox.html','tests/live-api.html','tests/weapon-live.html','tests/weapon-mastery.html','tests/scripted-opponent.js'].includes(name)&&!/^assets\/audio\/[a-z0-9-]+\.mp3$/.test(name)){response.writeHead(404);response.end();return}
    response.setHeader('Content-Type',name.endsWith('.mp3')?'audio/mpeg':name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html');
    response.end(fs.readFileSync(path.join(__dirname,'..',name)));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  origin='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH}:{})});
});
test.after(async()=>{await browser?.close();server?.closeAllConnections();await new Promise(resolve=>server?.close(resolve))});

async function pageFor(t,options={}){
  const {home=false,live,shortReview,powerups=false,difficulty:chosenDifficulty='expert',...contextOptions}=options;
  const context=await browser.newContext({viewport:{width:1280,height:1100},...contextOptions});
  const page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(enabled=>{if(window===top)localStorage.setItem('aitank_powerups',String(enabled))},powerups);
  if(chosenDifficulty)await page.addInitScript(id=>{if(window===top)localStorage.setItem('aitank_difficulty',id)},chosenDifficulty);
  page.setDefaultTimeout(12000);
  if(!live)await page.addInitScript(()=>{window.requestAnimationFrame=()=>0});
  if(shortReview)await page.addInitScript(()=>{const timer=window.setTimeout;window.setTimeout=(callback,ms,...args)=>timer(callback,ms===20000?25:ms,...args)});
  await page.goto(origin);
  if(!home)await page.evaluate(()=>leaveHome());
  t.after(async()=>{assert.deepEqual(errors,[]);await context.close()});
  return page;
}
async function reloadArena(page){await page.reload();await page.evaluate(()=>leaveHome());}
async function fixture(page){await page.evaluate(()=>{cfg.key='test-key';streamOn=false;if(homeOpen)leaveHome();walls=[];bullets=[];P.x=500;P.y=300;P.a=Math.PI;E.x=300;E.y=300;E.a=0;paused=false;phase='playing';E.hold=true})}
async function coopFixture(page){
  reviewReply=null;await fixture(page);
  await page.evaluate(endpoint=>{
    setGameMode('coop');cfg.endpoint=endpoint;walls=[];bullets=[];
    P.x=150;P.y=300;P.a=0;P2.x=150;P2.y=500;P2.a=0;E.x=850;E.y=400;E.a=Math.PI;E.hold=true;
  },origin+'/mock/messages');
}
async function weaponFixture(page,{staticAI=true}={}){
  await coopFixture(page);
  await page.evaluate(fixed=>{
    powerupsEnabled=true;weapons.nextSpawn=999;
    // Physics cases keep targets still; AI decision cases retain the real controller.
    if(fixed)aiLocal=()=>{};
    window.runFrames=seconds=>{for(let left=seconds;left>1e-8;){const dt=Math.min(.01,left);advance(dt);left-=dt}};
  },staticAI);
}

test('configuration is required before either tank can play',async t=>{
  const page=await pageFor(t);
  const state=await page.evaluate(()=>{const x=P.x,ex=E.x;keys.fwd=true;advance(.05);return{player:P.x-x,ai:E.x-ex,fire:fire(P),round}});
  assert.deepEqual(state,{player:0,ai:0,fire:false,round:1});
});

test('multi-command input, stop, interrupt and rotation limits work',async t=>{
  const page=await pageFor(t);await fixture(page);
  const state=await page.evaluate(()=>{
    feedLine('{"cmd":"algo","name":"keep_distance"}\n{"cmd":"algo","name":"chase_and_fire"}');const algo=E.curAlgo;
    applyCmd({cmd:'stop'});const x=E.x;aiLocal(.05);const moved=E.x-x;
    applyCmd({cmd:'fwd',ms:1000});applyCmd({cmd:'face',deg:90});const old=E.a;aiLocal(.05);
    const rotation=E.a-old,driveCleared=E.act===null;
    const angle=E.turnTarget;applyCmd({cmd:'face',deg:Infinity});
    return{algo,moved,driveCleared,rotation,invalidIgnored:E.turnTarget===angle};
  });
  assert.equal(state.algo,'chase_and_fire');assert.equal(state.moved,0);assert.equal(state.driveCleared,true);
  assert.ok(state.rotation<=Math.PI*.05+1e-10);assert.equal(state.invalidIgnored,true);
});

test('pause, settings typing, focus loss and safe memory rendering',async t=>{
  const page=await pageFor(t);await fixture(page);
  await page.evaluate(()=>togglePause());await page.keyboard.press('Space');
  assert.equal(await page.evaluate(()=>bullets.length),0);
  await page.evaluate(()=>{togglePause();keys.fwd=true;window.dispatchEvent(new Event('blur'))});
  assert.deepEqual(await page.evaluate(()=>({paused,fwd:keys.fwd})),{paused:true,fwd:false});
  await page.evaluate(()=>{lessons=['<img src=x onerror="window.hacked=true">'];showSettings()});
  await page.locator('#cfgKey').fill('wasdp');await page.keyboard.press('Space');
  assert.equal(await page.evaluate(()=>keys.fwd||keys.back||keys.cw||keys.ccw),false);
  assert.equal(await page.locator('#memBox img').count(),0);
});

test('maze spawn clearance and transient state reset across 300 rounds',async t=>{
  const page=await pageFor(t);await fixture(page);
  const state=await page.evaluate(()=>{
    let invalid=0;
    for(let i=0;i<300;i++){
      E.curAlgo='chase_and_fire';E.act={type:'drive',dir:1,until:999};E.turnTarget=100;newRound();
      if(blk(P.x,P.y)||blk(E.x,E.y)||Math.hypot(P.x-E.x,P.y-E.y)<350||regions()!==1)invalid++;
    }
    const random=Math.random;try{Math.random=()=>.01;newRound();if(regions()!==1)invalid++}finally{Math.random=random}
    return{invalid,act:E.act,turn:E.turnTarget,algo:E.curAlgo};
  });
  assert.deepEqual(state,{invalid:0,act:null,turn:null,algo:null});
});

test('probabilities, pure threat queries and dodge-only rotation',async t=>{
  const page=await pageFor(t);await fixture(page);
  const state=await page.evaluate(()=>{
    let hits=0;for(let i=0;i<1000;i++)if(condMatch('random:0.5',E,{enemy:P,bullets}))hits++;
    bullets=[{x:450,y:300,vx:-128,vy:0,life:5,own:'P'}];
    const before=E.turnTarget;condMatch('bullet_threat',E,{enemy:P,bullets,blk,bblk,los});
    const pure=before===E.turnTarget;dodgeOnly=true;const old=E.a;aiLocal(.05);
    const boundedTurn=Math.abs(angDiff(E.a,old))<=ROT*.05+1e-9,moved=Math.hypot(E.x-300,E.y-300);cfg.key='';const debugFire=fire(P),count=evolution.completed;
    E.alive=false;roundOver(E,{own:'P'});advance(3);
    return{hits,pure,boundedTurn,moved,debugFire,unlearned:evolution.completed===count&&!reviewPending};
  });
  assert.ok(state.hits>350&&state.hits<650);assert.equal(state.pure,true);assert.equal(state.boundedTurn,true);assert.ok(state.moved>0&&state.moved<=100*.05+1e-9);
  assert.equal(state.debugFire,true);assert.equal(state.unlearned,true);
});

test('reflection learns executable policy, settles once, and survives reload',async t=>{
  const page=await pageFor(t);await fixture(page);
  const state=await page.evaluate(async()=>{
    cfg.remember=true;
    const review={memory_add:['提前计算弹道','提前计算弹道'],set_algo:{name:'learned_tactics',desc:'先追击',steps:[{when:'always',do:'chase_and_fire'}]}};
    window.fetch=async()=>new Response(JSON.stringify({content:[{type:'text',text:JSON.stringify(review)}]}),{headers:{'Content-Type':'application/json'}});
    E.alive=false;roundOver(E,{own:'E'});roundOver(P,{own:'E'});await reflectTask;
    const reviewPhase=phase,counter=evolution.completed,score=P.score,log=lastRoundLog;
    advance(.1);const before=round;advance(3);
    return{reviewPhase,counter,score,log,before,round,algo:E.curAlgo,generation:evolution.generation,memories:lessons.length};
  });
  assert.equal(state.reviewPhase,'review');assert.equal(state.counter,1);assert.equal(state.score,1);assert.match(state.log,/自己的反弹弹/);
  assert.equal(state.before,1);assert.equal(state.round,2);assert.equal(state.algo,'learned_tactics');assert.equal(state.generation,1);assert.equal(state.memories,1);
  await reloadArena(page);
  assert.deepEqual(await page.evaluate(()=>({completed:evolution.completed,reviews:evolution.reviews,algo:E.curAlgo,generation:evolution.generation})),{completed:1,reviews:1,algo:'learned_tactics',generation:1});
  await fixture(page);
  assert.ok(await page.evaluate(()=>{const x=E.x;aiLocal(.05);return E.x>x}));
});

test('slow or failed reflection never runs combat on the dead round or skips rounds',async t=>{
  const page=await pageFor(t);await fixture(page);
  await page.evaluate(()=>{
    window.fetch=()=>new Promise(resolve=>{window.finishReview=()=>resolve(new Response('',{status:503}))});
    E.alive=false;roundOver(E,{own:'P'});advance(3);
  });
  assert.deepEqual(await page.evaluate(()=>({round,phase,waiting:reviewPending,time:gT})),{round:1,phase:'review',waiting:true,time:0});
  await page.evaluate(async()=>{window.finishReview();await reflectTask;advance(.05)});
  assert.deepEqual(await page.evaluate(()=>({round,phase,reviews:evolution.reviews,alive:E.alive})),{round:2,phase:'playing',reviews:0,alive:true});
});

test('reset invalidates an in-flight review and leaves API configuration intact',async t=>{
  const page=await pageFor(t);await fixture(page);
  await page.evaluate(()=>{
    window.fetch=()=>new Promise(resolve=>{window.finishReview=()=>resolve(new Response(JSON.stringify({content:[{type:'text',text:'{"memory_add":["stale lesson"],"set_algo":null}'}]})))});
    E.alive=false;roundOver(E,{own:'P'});showSettings();
  });
  page.once('dialog',dialog=>dialog.accept());await page.locator('#memClr').click();
  await page.evaluate(async()=>{window.finishReview();await reflectTask});
  assert.deepEqual(await page.evaluate(()=>({completed:evolution.completed,reviews:evolution.reviews,memories:lessons.length,key:cfg.key})),{completed:0,reviews:0,memories:0,key:'test-key'});
});

test('review deadline cancels a stalled API and resumes with the saved strategy',async t=>{
  const page=await pageFor(t,{shortReview:true});await fixture(page);
  const state=await page.evaluate(async()=>{
    window.fetch=(_url,{signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')),{once:true}));
    E.alive=false;roundOver(E,{own:'P'});await reflectTask;const status=statusEl.textContent;advance(3);
    return{round,phase,reviews:evolution.reviews,status};
  });
  assert.equal(state.round,2);assert.equal(state.phase,'playing');assert.equal(state.reviews,0);assert.match(state.status,/超时/);
});

test('late control response cannot write strategies or commands into a new round',async t=>{
  const page=await pageFor(t);
  await page.evaluate(()=>{
    window.fetch=()=>new Promise(resolve=>{window.finishOld=()=>{
      const text='{"set_algo":{"name":"old_policy","steps":[{"when":"always","do":"roam"}]}}\n{"cmd":"algo","name":"ricochet_fire"}';
      resolve(new Response('data: '+JSON.stringify({type:'content_block_delta',delta:{type:'text_delta',text}})+'\n\n'));
    }});
    cfg.key='test-key';
  });
  await page.waitForFunction(()=>!!window.finishOld,null,{polling:50});
  await page.evaluate(()=>{streamOn=false;newRound();window.finishOld()});
  await page.waitForFunction(()=>streamAbort===null,null,{polling:50});
  assert.deepEqual(await page.evaluate(()=>({generation:evolution.generation,policy:!!ALGOS.old_policy,turn:E.turnTarget,algo:E.curAlgo})),{generation:0,policy:false,turn:null,algo:null});
});

test('API key persistence is opt-in; exporting learning excludes credentials',async t=>{
  const page=await pageFor(t);await fixture(page);
  await page.evaluate(()=>{cfg.remember=false;saveMem();showSettings()});
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('aitank_lessons')).cfg.key),'');
  const downloadPromise=page.waitForEvent('download');await page.locator('#memExport').click();
  const download=await downloadPromise,stream=await download.createReadStream();let raw='';for await(const chunk of stream)raw+=chunk;
  assert.ok(!raw.includes('test-key'));assert.ok(!Object.hasOwn(JSON.parse(raw),'cfg'));
});

test('real fragmented SSE makes tactical decisions, ignores online code writes, and refreshes battle summaries',async t=>{
  const page=await pageFor(t);const start=streams.length,closed=closedStreams;
  await page.evaluate(endpoint=>{cfg.key='test-key';cfg.endpoint=endpoint;E.hold=true},origin+'/mock/messages');
  await page.waitForFunction(()=>E.curAlgo==='chase_and_fire',null,{polling:50,timeout:10000});
  await page.waitForFunction(()=>E.combatMode==='duel',null,{polling:25,timeout:2000});
  await page.waitForFunction(()=>E.gunneryMode==='pressure',null,{polling:25,timeout:2000});
  await page.waitForFunction(()=>E.shotRequested,null,{polling:25,timeout:2000});
  assert.equal(streams.length,start+1);assert.notEqual(await page.evaluate(()=>streamAbort),null);
  assert.equal(await page.evaluate(()=>evolution.generation),0);
  assert.equal(await page.evaluate(()=>!!ALGOS.stream_policy),false);
  assert.equal(await page.evaluate(()=>!!ALGOS.wrapped_meta),false);
  assert.ok(streams[start].max_tokens<=1024);assert.equal(streams[start].thinking.type,'disabled');assert.ok(!streams[start].system.includes('JavaScript 函数体'));
  assert.ok(!streams[start].messages[0].content.includes('history'));
  await page.evaluate(()=>{E.x=450;gT=13});
  const deadline=Date.now()+10000;
  while(streams.length<start+2&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,100));
  assert.ok(streams.length>=start+2);assert.ok(closedStreams>closed);
  assert.equal(JSON.parse(streams[start+1].messages[0].content.split('\n')[0]).self.x,450);
  assert.ok(streams[start+1].messages[0].content.includes('"combatMode":"duel"'));
  assert.ok(streams[start+1].messages[0].content.includes('"mode":"pressure"'));
  assert.ok(streams[start+1].messages[0].content.includes('地图'));
  await page.evaluate(()=>togglePause());
  await new Promise(resolve=>setTimeout(resolve,100));assert.equal(await page.evaluate(()=>streamAbort),null);
  const resumedCount=streams.length;
  await page.evaluate(()=>{togglePause();gT=26});
  const resumedDeadline=Date.now()+5000;
  while(streams.length===resumedCount&&Date.now()<resumedDeadline)await new Promise(resolve=>setTimeout(resolve,50));
  assert.ok(streams.length>resumedCount);
});

test('desktop and touch layouts leave the playfield clear and fit the viewport',async t=>{
  fs.mkdirSync(path.join(__dirname,'..','test-results'),{recursive:true});
  for(const [name,options] of [['desktop',{}],['mobile',{viewport:{width:390,height:844},isMobile:true,hasTouch:true}]]){
    const page=await pageFor(t,{...options,difficulty:null});await page.evaluate(()=>render());
    const size=await page.evaluate(()=>({width:document.documentElement.scrollWidth,viewport:innerWidth,overlays:document.querySelectorAll('#stage #chips, #stage #brain').length}));
    assert.ok(size.width<=size.viewport);assert.equal(size.overlays,0);
    if(name==='mobile'){
      assert.equal(await page.locator('#ctrl').isVisible(),true);
      const control=await page.locator('#ctrl').boundingBox();assert.ok(control.y+control.height<=844);
    }
    await page.screenshot({path:path.join(__dirname,'..','test-results',name+'.png'),fullPage:true});
    await page.locator('#cfgBtn').click();await page.screenshot({path:path.join(__dirname,'..','test-results',name+'-settings.png'),fullPage:true});
  }
});

test('priority rules keep motion ownership while allowing a lower-priority fire channel',async t=>{
  const page=await pageFor(t);await fixture(page);
  const state=await page.evaluate(()=>{
    installPolicy({name:'priority',steps:[{when:'always',priority:0,do:['fwd','face:90','fire']},{when:'always',priority:80,do:['back','face:0']}]});
    applyCmd({cmd:'algo',name:'priority'});applyCmd({cmd:'fire'});const x=E.x;aiLocal(.05);
    return{moved:E.x-x,angle:E.a,shots:roundShots.E,algo:E.curAlgo};
  });
  assert.ok(state.moved<0);assert.equal(state.angle,0);assert.equal(state.shots,1);assert.equal(state.algo,'priority');
});

test('incoming bullet takes motion ownership immediately and permits a safe shot while escaping',async t=>{
  const page=await pageFor(t);await fixture(page);
  const state=await page.evaluate(()=>{
    applyCmd({cmd:'combat',mode:'evade'});
    installPolicy({name:'dodge_and_fire',steps:[{when:'always',priority:0,do:'fwd'},{when:'bullet_threat',priority:100,do:['dodge_bullets','fire_safe']}]});
    applyCmd({cmd:'algo',name:'dodge_and_fire'});E.act={type:'drive',dir:1,until:10};
    bullets=[{x:300,y:470,vx:0,vy:-128,life:5,own:'P'}];const x=E.x;aiLocal(.1);
    const during={moved:E.x-x,emergency:E.emergency,shots:roundShots.E,interrupted:E.act===null,algo:E.curAlgo};
    // The barrel follows the body. A threat alone does not make a shot safe;
    // line up a clear target and verify that fire still works during escape.
    P.x=E.x+Math.cos(E.a)*150;P.y=E.y+Math.sin(E.a)*150;E.prediction=null;enemyHistory=[];
    applyCmd({cmd:'fire'});aiLocal(.016);const safeShot={emergency:E.emergency,shots:roundShots.E};
    bullets=[];const nextX=E.x;gT+=.2;aiLocal(.1);
    return{during,safeShot,resumed:E.x>nextX&&!E.emergency};
  });
  assert.ok(Math.abs(state.during.moved)>0);assert.equal(state.during.emergency,true);assert.equal(state.during.shots,0);
  assert.deepEqual(state.safeShot,{emergency:true,shots:1});
  assert.equal(state.during.interrupted,true);assert.equal(state.during.algo,'dodge_and_fire');assert.equal(state.resumed,true);
});

test('a sudden close shot triggers immediate counterfire and evasive movement without waiting for the commander',async t=>{
  const page=await pageFor(t);await fixture(page);
  const result=await page.evaluate(()=>{
    cfg.endpoint=location.origin+'/mock/messages';P.x=450;P.y=300;P.a=Math.PI;E.a=0;E.hold=true;
    fire(P);const x=E.x;advance(1/60);
    const first={response:E.emergencyResponse,shots:roundShots.E,angle:E.a,moved:E.x-x,mode:E.combatMode};
    for(let frame=0;frame<90&&phase==='playing';frame++)advance(1/60);
    render();return{first,alive:E.alive,playerAlive:P.alive,execution:roundExecution};
  });
  assert.equal(result.first.mode,'auto');assert.equal(result.first.response,'duel');assert.equal(result.first.shots,1);
  assert.ok(Math.abs(result.first.angle)<=Math.PI/60+1e-9);assert.ok(Math.abs(result.first.moved)>0);
  assert.equal(result.alive,true);assert.equal(result.playerAlive,false);assert.ok(result.execution.counterfireShots>=1);
  assert.ok(result.execution.duelSeconds>0);assert.ok(result.execution.reflexReversals<=4);
  fs.mkdirSync(path.join(__dirname,'..','test-results'),{recursive:true});
  await page.screenshot({path:path.join(__dirname,'..','test-results','close-duel.png'),fullPage:true});
});

test('commander can choose emergency combat independently of navigation and stale modes are rejected',async t=>{
  const page=await pageFor(t);await fixture(page);
  const result=await page.evaluate(()=>{
    applyTacticalDecision({cmd:'move_to',x:700,y:500});const goal=E.goal;
    const accepted=applyTacticalDecision({cmd:'combat',mode:'duel'}),snapshot=programSnapshot(),summary=tacticalSummary();
    const rejected=[{cmd:'combat',mode:'invincible'},{cmd:'combat',mode:'evade',round_id:roundId-1}].map(applyTacticalDecision);
    const preserved=E.goal===goal&&E.curAlgo==='navigate_to'&&E.combatMode==='duel';
    applyTacticalDecision({cmd:'combat',mode:'evade'});const evade=E.combatMode;newRound();
    return{accepted,rejected,preserved,evade,nextMode:E.combatMode,snapshotMode:snapshot.combat.mode,summaryMode:summary.self.combatMode,prompt:controlPrompt()};
  });
  assert.equal(result.accepted,true);assert.deepEqual(result.rejected,[false,false]);assert.equal(result.preserved,true);
  assert.equal(result.evade,'evade');assert.equal(result.nextMode,'auto');assert.equal(result.snapshotMode,'duel');assert.equal(result.summaryMode,'duel');
  assert.ok(result.prompt.includes('"cmd":"combat"'));assert.ok(result.prompt.includes('不能默认直线逃跑能甩掉子弹'));
});

test('safe fighting tactics can control emergency movement while a drive into the incoming shell is rejected',async t=>{
  for(const [name,doActions,incoming,expectedOwner] of [
    ['back_and_fire',['back','face:0','fire_safe'],{x:300,y:470,vx:0,vy:-128},'tactic:back_and_fire'],
    ['drive_into_shell',['fwd','face:0','fire_safe'],{x:418.6,y:300,vx:-128,vy:0},'native']
  ]){
    const page=await pageFor(t);await fixture(page);
    const result=await page.evaluate(({name,doActions,incoming})=>{
      P.x=450;P.y=300;E.a=0;installPolicy({name,steps:[{when:'always',do:doActions}]});
      applyTacticalDecision({cmd:'algo',name});applyTacticalDecision({cmd:'combat',mode:'duel'});
      bullets=[{...incoming,life:5,own:'P'}];aiLocal(1/60);
      return{owner:E.reflexOwner,response:E.emergencyResponse,shots:roundShots.E,x:E.x,execution:roundExecution};
    },{name,doActions,incoming});
    assert.equal(result.owner,expectedOwner);assert.equal(result.response,'duel');assert.equal(result.shots,1);assert.ok(result.x<300);
  }
});

test('a safe saved escape program can be passed over for close combat without being marked faulty',async t=>{
  const page=await pageFor(t);await fixture(page);
  const code=`return (${require('../ai-dodge.js').plan.toString()})({...state,combat:{mode:'evade'}},memory);`;
  await page.evaluate(code=>{
    REFLEXES.saved_escape={name:'saved_escape',code,desc:'旧版只脱离'};evolution.activeReflex='saved_escape';saveReflexes();saveEvolution();
  },code);
  await reloadArena(page);await fixture(page);
  await page.evaluate(()=>{
    P.x=450;P.y=300;E.a=0;applyTacticalDecision({cmd:'combat',mode:'duel'});
    bullets=[{x:300,y:470,vx:0,vy:-128,life:5,own:'P'}];aiLocal(1/60);
  });
  await page.waitForFunction(()=>!!reflexState?.value,null,{polling:20,timeout:4000});
  const result=await page.evaluate(()=>{
    gT+=.12;aiLocal(1/60);return{owner:E.reflexOwner,response:E.emergencyResponse,shots:roundShots.E,disabled:!!REFLEXES.saved_escape.disabled,vetoes:roundExecution.reflexVetoes};
  });
  assert.equal(result.owner,'native');assert.equal(result.response,'duel');assert.equal(result.shots,1);
  assert.equal(result.disabled,false);assert.equal(result.vetoes,0);
});

test('unavoidable point-blank danger still permits a legal countershot and respects ammunition, cooldown and walls',async t=>{
  for(const situation of ['ready','cooldown','empty','wall']){
    const page=await pageFor(t);await fixture(page);
    const result=await page.evaluate(situation=>{
      P.x=situation==='wall'?450:370;P.y=300;P.a=Math.PI;E.a=0;
      applyTacticalDecision({cmd:'combat',mode:'duel'});
      if(situation==='cooldown')E.cd=.5;
      if(situation==='empty')E.live=MAG;
      if(situation==='wall')walls=[{x:370,y:260,w:14,h:80}];
      bullets=[situation==='wall'?{x:300,y:400,vx:0,vy:-128,own:'P',life:5}:{x:338.6,y:300,vx:-128,vy:0,own:'P',life:5}];
      const a=E.a;aiLocal(1/60);
      return{response:E.emergencyResponse,shots:roundShots.E,rotation:Math.abs(angDiff(E.a,a)),live:E.live,decision:E.defenseDecision};
    },situation);
    assert.equal(result.shots,situation==='ready'?1:0);assert.ok(result.rotation<=Math.PI/60+1e-9);assert.ok(result.live<=5);
    if(situation==='ready'){assert.equal(result.response,'last_stand');assert.equal(result.decision.canEscape,false)}
  }
});

test('old cell-valued rules migrate once without losing matches or changing legacy pixel thresholds',async t=>{
  const page=await pageFor(t);
  await page.evaluate(()=>{
    localStorage.setItem('aitank_algos',JSON.stringify({old_tactics:{desc:'三格以内撤退',composed:[{when:'enemy_near:3',do:'keep_distance'},{when:'enemy_far:250',do:'chase_and_fire'}]}}));
    localStorage.setItem('aitank_evolution',JSON.stringify({...evolution,completed:27,generation:21,activePolicy:'old_tactics'}));
  });
  await reloadArena(page);
  assert.deepEqual(await page.evaluate(()=>({completed:evolution.completed,generation:evolution.generation,steps:ALGOS.old_tactics.composed.map(step=>step.when)})),{completed:27,generation:22,steps:['enemy_near_cells:3','enemy_far_px:250']});
  await reloadArena(page);assert.equal(await page.evaluate(()=>evolution.generation),22);
});

test('AI code can fit an enemy trajectory from raw history and execute bounded movement',async t=>{
  const page=await pageFor(t);await fixture(page);
  await page.evaluate(async()=>{
    enemyHistory=Array.from({length:6},(_,i)=>({x:450+i*10,y:300,a:0,time:i*.1}));P.x=500;P.a=0;gT=.5;
    const code=`const h=state.enemy.history; const mt=h.reduce((s,p)=>s+p.time,0)/h.length; const mx=h.reduce((s,p)=>s+p.x,0)/h.length;
      const denominator=h.reduce((s,p)=>s+(p.time-mt)**2,0); const vx=denominator?h.reduce((s,p)=>s+(p.time-mt)*(p.x-mx),0)/denominator:0;
      return {move:0.5,turn:0,fire:false,prediction:{x:api.clamp(state.enemy.x+vx,40,state.width-40),y:state.enemy.y},memory:{ticks:(memory.ticks||0)+1}};`;
    await installCode({name:'fitted_prediction',desc:'历史最小二乘预测',code});
    applyCmd({cmd:'algo',name:'fitted_prediction'});aiLocal(.01);
  });
  await page.waitForFunction(()=>programState?.value,null,{polling:50,timeout:4000});
  const state=await page.evaluate(()=>{bullets=[];const x=E.x;aiLocal(.1);return{prediction:E.prediction,moved:E.x-x,fault:E.programFault,code:!!ALGOS.fitted_prediction.code}});
  assert.ok(Math.abs(state.prediction.x-600)<.01);assert.ok(state.moved>0&&state.moved<=100*.1);assert.equal(state.fault,null);assert.equal(state.code,true);
  await reloadArena(page);assert.equal(await page.evaluate(()=>!!ALGOS.fitted_prediction.code),true);
});

test('generated code cannot access DOM, credentials or network primitives and invalid code never replaces a strategy',async t=>{
  const page=await pageFor(t);await fixture(page);
  const state=await page.evaluate(async()=>{
    const runner=new AIProgramSandbox();
    await runner.load(`return {move:0,fire:typeof window!=='undefined'||typeof document!=='undefined'||typeof localStorage!=='undefined'||typeof fetch!=='undefined'||typeof XMLHttpRequest!=='undefined'||Object.hasOwn(state,'cfg')};`);
    const output=await runner.tick(programSnapshot());runner.stop();
    let syntaxRejected=false,outputRejected=false;
    try{await installCode({name:'bad_syntax',code:'return {'})}catch{syntaxRejected=true}
    try{await installCode({name:'bad_position',code:'return {move:99,prediction:{x:99999,y:0}};'})}catch{outputRejected=true}
    return{output,syntaxRejected,outputRejected,registered:!!ALGOS.bad_syntax||!!ALGOS.bad_position};
  });
  assert.equal(state.output.fire,false);assert.equal(state.syntaxRejected,true);assert.equal(state.outputRejected,true);assert.equal(state.registered,false);
});

test('runaway code times out outside the game thread and paused computations cannot apply output',async t=>{
  const page=await pageFor(t);await fixture(page);
  const state=await page.evaluate(async()=>{
    let timedOut=false;
    try{await installCode({name:'infinite',code:'while(true){}'})}catch(error){timedOut=/超时/.test(error.message)}
    const before=P.x;keys.fwd=true;advance(.05);
    await installCode({name:'late_program',code:'return {move:1,turn:0,prediction:{x:state.enemy.x,y:state.enemy.y}};'});
    applyCmd({cmd:'algo',name:'late_program'});aiLocal(.01);togglePause();
    return{timedOut,gameAdvanced:P.x!==before};
  });
  assert.equal(state.timedOut,true);assert.equal(state.gameAdvanced,true);
  await page.waitForFunction(()=>!programState?.busy,null,{polling:50,timeout:4000});
  assert.equal(await page.evaluate(()=>programState?.value),null);
});

test('desktop uses a landscape battlefield and sidebar at 1366x768 without scrolling',async t=>{
  const page=await pageFor(t,{viewport:{width:1366,height:768}});
  const state=await page.evaluate(()=>{
    const canvas=cv.getBoundingClientRect(),sidebar=document.getElementById('sidebar').getBoundingClientRect();
    return{COLS,ROWS,ratio:canvas.width/canvas.height,right:canvas.right,sidebar:sidebar.left,bottom:canvas.bottom,scroll:document.documentElement.scrollHeight,viewport:innerHeight};
  });
  assert.equal(state.COLS,11);assert.equal(state.ROWS,7);assert.ok(state.ratio>1.4);assert.ok(state.sidebar>state.right);assert.ok(state.bottom<=768);assert.ok(state.scroll<=state.viewport);
  await page.evaluate(()=>render());await page.screenshot({path:path.join(__dirname,'..','test-results','landscape.png'),fullPage:true});
});

test('a learned predictor runs locally across tactical changes and persists independently',async t=>{
  const page=await pageFor(t);await fixture(page);
  await page.evaluate(async()=>{
    await installPredictor({name:'lead_model',desc:'本地预测',code:'return {prediction:{x:api.clamp(state.enemy.x+25,40,state.width-40),y:state.enemy.y},memory:{calls:(memory.calls||0)+1}};'});
    applyTacticalDecision({cmd:'posture',mode:'roam'});aiLocal(.01);
  });
  await page.waitForFunction(()=>E.prediction?.owner==='predictor',null,{polling:50,timeout:4000});
  assert.equal(await page.evaluate(()=>E.prediction.x),525);
  await page.evaluate(()=>{gT=.2;applyTacticalDecision({cmd:'posture',mode:'evade'});aiLocal(.01)});
  await page.waitForFunction(()=>!predictionState?.busy,null,{polling:50,timeout:4000});
  assert.deepEqual(await page.evaluate(()=>({predictor:evolution.activePredictor,tactic:E.curAlgo,x:E.prediction.x})),{predictor:'lead_model',tactic:'keep_distance',x:525});
  await reloadArena(page);assert.equal(await page.evaluate(()=>evolution.activePredictor),'lead_model');
  assert.equal(await page.evaluate(()=>!!PREDICTORS.lead_model.code),true);
});

test('predictor proposals cannot drive tanks, and commander payloads cannot write code or override predictions',async t=>{
  const page=await pageFor(t);await fixture(page);
  const state=await page.evaluate(async()=>{
    let rejected=false;
    try{await installPredictor({name:'bad_predictor',code:'return {move:1,prediction:{x:500,y:300}};'})}catch{rejected=true}
    const accepted=applyTacticalDecision({cmd:'posture',mode:'engage',set_code:{name:'forbidden',code:'while(true){}'},prediction:{x:1,y:2}});
    const declined=applyTacticalDecision({cmd:'face',deg:45});
    const summary=stateText(),prompt=controlPrompt();
    return{rejected,accepted,declined,code:!!ALGOS.forbidden,predictor:!!PREDICTORS.bad_predictor,summary,prompt};
  });
  assert.equal(state.rejected,true);assert.equal(state.accepted,true);assert.equal(state.declined,false);
  assert.equal(state.code,false);assert.equal(state.predictor,false);assert.ok(!state.summary.includes('history'));
  assert.ok(!state.prompt.includes('JavaScript 函数体'));assert.ok(!JSON.parse(state.summary).opponentThreats.scenarios);assert.ok(state.summary.length<3200,`commander snapshot grew to ${state.summary.length} chars`);
});

test('commander sees all current tank coordinates, ammunition, bullets and complete map',async t=>{
  const page=await pageFor(t);await fixture(page);
  const state=await page.evaluate(()=>{
    bullets=[{x:250,y:260,vx:128,vy:0,life:8,own:'E'},{x:600,y:350,vx:-100,vy:20,life:5,own:'P'}];
    P.live=1;E.live=2;
    return{snapshot:JSON.parse(stateText()),map:asciiMap()};
  });
  assert.equal(state.snapshot.self.x,300);assert.equal(state.snapshot.enemy.x,500);
  assert.equal(state.snapshot.self.ammo,3);assert.equal(state.snapshot.enemy.ammo,4);
  assert.equal(state.snapshot.bullets.length,2);assert.equal(state.snapshot.bullets[0].owner,'self');assert.equal(state.snapshot.bullets[1].vx,-100);
  assert.equal(state.snapshot.arena.width,1100);assert.equal(state.map.split('\n').slice(1).length,15);
});

test('move_to sets a persistent goal without teleporting and fire does not cancel navigation',async t=>{
  const page=await pageFor(t);await fixture(page);
  const state=await page.evaluate(()=>{
    P.x=950;P.y=600;E.live=MAG;
    const x=E.x,accepted=applyTacticalDecision({cmd:'move_to',x:600,y:300});
    for(let i=0;i<10;i++)applyTacticalDecision({cmd:'move_to',x:600,y:300});
    const stayed=E.x===x;applyTacticalDecision({cmd:'fire'});const goal=E.goal;
    let maxMove=0,maxRotation=0;
    for(let i=0;i<300;i++){
      const px=E.x,py=E.y,a=E.a;gT+=.025;aiLocal(.025);
      maxMove=Math.max(maxMove,Math.hypot(E.x-px,E.y-py));maxRotation=Math.max(maxRotation,Math.abs(angDiff(E.a,a)));
    }
    return{accepted,stayed,preserved:E.goal===goal,algo:E.curAlgo,status:E.goal.status,distance:Math.hypot(E.x-600,E.y-300),maxMove,maxRotation};
  });
  assert.equal(state.accepted,true);assert.equal(state.stayed,true);assert.equal(state.preserved,true);assert.equal(state.algo,'navigate_to');
  assert.equal(state.status,'arrived');assert.ok(state.distance<=12);assert.ok(state.maxMove<=100*.025+1e-9);assert.ok(state.maxRotation<=Math.PI*.025+1e-9);
});

test('navigation finds a route around connected maze walls and never enters the wall',async t=>{
  const page=await pageFor(t);await fixture(page);
  const state=await page.evaluate(()=>{
    vWalls=Array.from({length:COLS+1},()=>Array(ROWS).fill(false));hWalls=Array.from({length:COLS},()=>Array(ROWS+1).fill(false));
    for(let r=0;r<ROWS;r++)vWalls[0][r]=vWalls[COLS][r]=true;
    for(let c=0;c<COLS;c++)hWalls[c][0]=hWalls[c][ROWS]=true;
    for(let r=2;r<=4;r++)vWalls[5][r]=true;
    walls=[{x:493,y:193,w:14,h:314}];P.x=950;P.y=600;E.x=300;E.y=350;E.a=0;E.live=MAG;
    applyTacticalDecision({cmd:'move_to',x:700,y:350});let collisions=0;
    for(let i=0;i<1000&&E.goal.status!=='arrived';i++){gT+=.025;aiLocal(.025);if(blk(E.x,E.y))collisions++}
    return{collisions,status:E.goal.status,distance:Math.hypot(E.x-700,E.y-350),x:E.x};
  });
  assert.equal(state.collisions,0);assert.equal(state.status,'arrived');assert.ok(state.distance<=12);assert.ok(state.x>500);
});

test('emergency dodging preserves a navigation goal and resumes it after the threat clears',async t=>{
  const page=await pageFor(t);await fixture(page);
  const state=await page.evaluate(()=>{
    P.x=950;P.y=600;E.live=MAG;applyTacticalDecision({cmd:'move_to',x:600,y:300});
    const goal=E.goal;bullets=[{x:300,y:470,vx:0,vy:-128,life:5,own:'P'}];const x=E.x;aiLocal(.1);
    const during={moved:E.x-x,emergency:E.emergency,goalPreserved:E.goal===goal,status:E.goal.status};
    bullets=[];const nextX=E.x;gT+=.2;aiLocal(.1);
    return{during,resumed:E.x>nextX&&!E.emergency,goal:E.goal};
  });
  assert.ok(Math.abs(state.during.moved)>0);assert.equal(state.during.emergency,true);assert.equal(state.during.goalPreserved,true);
  assert.equal(state.resumed,true);assert.equal(state.goal.x,600);assert.equal(state.goal.y,300);
});

test('tank bodies cannot overlap, wall goals are corrected, and stale or invalid destinations are rejected',async t=>{
  const page=await pageFor(t);await fixture(page);
  const state=await page.evaluate(()=>{
    P.x=352;P.y=300;const before=E.x;drive(E,.1,1);const prevented=E.x===before;
    keys.fwd=true;advance(.05);keys.fwd=false;const separated=Math.hypot(E.x-P.x,E.y-P.y)>=TR*2;
    walls=[{x:493,y:193,w:14,h:314}];applyTacticalDecision({cmd:'move_to',x:500,y:300});
    const corrected=!blk(E.goal.x,E.goal.y)&&Math.abs(E.goal.x-500)>1;
    const goal=E.goal;
    const invalid=[{cmd:'move_to',x:Infinity,y:0},{cmd:'move_to',x:-1,y:0},{cmd:'move_to',x:FW+1,y:0},{cmd:'move_to',x:600,y:300,round_id:roundId-1}].map(applyTacticalDecision);
    return{prevented,separated,corrected,invalid,preserved:E.goal===goal};
  });
  assert.equal(state.prevented,true);assert.equal(state.separated,true);assert.equal(state.corrected,true);
  assert.deepEqual(state.invalid,[false,false,false,false]);assert.equal(state.preserved,true);
});

test('sustained emergency dodging escapes a narrow corridor without oscillation or getting hit',async t=>{
  const page=await pageFor(t);await fixture(page);
  const result=await page.evaluate(()=>{
    P.x=650;P.y=600;E.hold=true;E.live=MAG;
    walls=[{x:230,y:0,w:14,h:700},{x:356,y:0,w:14,h:700}];
    bullets=[{x:300,y:470,vx:0,vy:-128,life:5,own:'P'}];
    let collision=false,maxMove=0,maxTurn=0;
    for(let frame=0;frame<240&&phase==='playing';frame++){
      const x=E.x,y=E.y,a=E.a;advance(1/60);
      maxMove=Math.max(maxMove,Math.hypot(E.x-x,E.y-y));maxTurn=Math.max(maxTurn,Math.abs(angDiff(E.a,a)));
      if(blk(E.x,E.y))collision=true;
    }
    return{alive:E.alive,collision,displacement:Math.hypot(E.x-300,E.y-300),maxMove,maxTurn,execution:roundExecution};
  });
  assert.equal(result.alive,true);assert.equal(result.collision,false);assert.ok(result.displacement>32);
  assert.ok(result.execution.reflexSeconds>1);assert.ok(result.execution.reflexReversals<=4);assert.ok(result.execution.reflexStalledSeconds<.2);
  assert.ok(result.maxMove<=100/60+1e-9);assert.ok(result.maxTurn<=Math.PI/60+1e-9);
});

test('dodging two crossing bullets near a corner produces real clearance instead of turning in place',async t=>{
  const page=await pageFor(t);await fixture(page);
  const result=await page.evaluate(()=>{
    P.x=950;P.y=600;E.x=80;E.y=80;E.a=Math.PI/4;E.hold=true;E.live=MAG;
    bullets=[{x:80,y:230,vx:0,vy:-128,life:5,own:'P'},{x:230,y:80,vx:-128,vy:0,life:5,own:'P'}];
    for(let frame=0;frame<180&&phase==='playing';frame++)advance(1/60);
    return{alive:E.alive,x:E.x,y:E.y,displacement:Math.hypot(E.x-80,E.y-80),execution:roundExecution};
  });
  assert.equal(result.alive,true);assert.ok(result.displacement>32);assert.ok(result.x>=23.4&&result.y>=23.4);
  assert.ok(result.execution.reflexReversals<=4);assert.equal(result.execution.incidents.length,0);
});

test('coach sees an actual oscillation and can replace the reflex with validated persistent code',async t=>{
  const page=await pageFor(t);await fixture(page);
  const start=reviews.length;
  // A real Edge save used the name "native" for learned code. It must stay
  // distinguishable from the built-in planner in execution records.
  reviewReply={memory_add:['窄通道避弹需要保持逃逸方向'],set_reflex:{name:'native',desc:'保持方向并预测碰撞',code:require('../ai-dodge.js').source()}};
  t.after(()=>{reviewReply=null});
  await page.evaluate(()=>{
    cfg.endpoint=location.origin+'/mock/messages';P.x=650;P.y=600;E.hold=true;E.live=MAG;
    window.originalDodge=ALGOS.dodge_bullets.fn;
    ALGOS.dodge_bullets.fn=(t,dt,ctx)=>{
      const threat=findThreat(t,ctx);if(!threat)return false;
      const left=Math.atan2(-threat.vx,threat.vy),right=left+Math.PI;
      const angle=freeRoom(t,left,ctx)>=freeRoom(t,right,ctx)?left:right;
      const forward=Math.abs(angDiff(angle,t.a))<=Math.PI/2;
      turnToward(t,forward?angle:angle+Math.PI,dt);drive(t,dt,forward?1:-1);return true;
    };
    walls=[{x:230,y:0,w:14,h:700},{x:356,y:0,w:14,h:700}];
    bullets=[{x:300,y:470,vx:0,vy:-128,life:5,own:'P'}];
    for(let frame=0;frame<100&&phase==='playing';frame++)advance(1/60);
    ALGOS.dodge_bullets.fn=window.originalDodge;
  });
  await page.waitForFunction(()=>evolution.activeReflex==='native'&&!reviewPending,null,{polling:20,timeout:10000});
  const learned=await page.evaluate(()=>({generation:evolution.generation,history:evolution.history.at(-1),reflex:REFLEXES.native,source:localStorage.getItem('aitank_reflexes'),label:reflexLabel()}));
  assert.ok(learned.history.execution.incidents.some(x=>x.type==='dodge_oscillation'));
  assert.ok(learned.history.execution.reflexReversals>10);assert.ok(learned.generation>0);
  assert.ok(learned.reflex.validation.every(x=>x.survived&&x.displacement>=32));assert.ok(learned.source.includes('"native"'));assert.equal(learned.label,'自写 native');
  assert.equal(reviews.length,start+1);assert.ok(reviews[start].messages[0].content.includes('dodge_oscillation'));
  assert.ok(reviews[start].messages[0].content.includes('自己的实际控制与位置样本'));assert.ok(reviews[start].system.includes('set_reflex'));
  await reloadArena(page);assert.equal(await page.evaluate(()=>evolution.activeReflex),'native');
  assert.ok(await page.evaluate(()=>REFLEXES.native.code.length>100));
  await page.evaluate(()=>{
    cfg.key='test-key';streamOn=false;newRound();walls=[];bullets=[{x:300,y:470,vx:0,vy:-128,life:5,own:'P'}];
    P.x=650;P.y=600;E.x=300;E.y=300;E.a=0;E.hold=true;paused=false;phase='playing';aiLocal(.1);
  });
  await page.waitForFunction(()=>!!reflexState?.value,null,{polling:20,timeout:4000});
  const owner=await page.evaluate(()=>{gT+=.12;aiLocal(.016);return E.reflexOwner});
  assert.equal(owner,'learned:native');
});

test('a no-progress reflex proposal fails the physical replay and rejection feedback survives reload',async t=>{
  const page=await pageFor(t);await fixture(page);
  reviewReply={memory_add:['修改避弹'],set_reflex:{name:'jitter',code:'return {turn:0,move:state.self.x>=300?-1:1};'}};
  t.after(()=>{reviewReply=null});
  await page.evaluate(()=>{cfg.endpoint=location.origin+'/mock/messages';E.alive=false;roundOver(E,{own:'P'})});
  await page.waitForFunction(()=>!reviewPending,null,{polling:20,timeout:6000});
  const result=await page.evaluate(()=>({reflex:evolution.activeReflex,version:evolution.generation,exists:!!REFLEXES.jitter,rejection:evolution.lastRejection}));
  assert.equal(result.reflex,null);assert.equal(result.version,0);assert.equal(result.exists,false);assert.ok(result.rejection.reason.includes('避弹回放未通过'));
  await reloadArena(page);assert.ok(await page.evaluate(()=>evolution.lastRejection.reason.includes('避弹回放未通过')));
});

test('ammo observations distinguish available slots, flying shells and their individual return',async t=>{
  const page=await pageFor(t);await fixture(page);
  const result=await page.evaluate(()=>{
    P.x=900;P.y=300;E.live=2;P.live=1;
    bullets=[{id:1,x:700,y:50,vx:128,vy:0,life:.02,own:'E'},{id:2,x:750,y:50,vx:128,vy:0,life:6,own:'E'},{id:3,x:750,y:600,vx:-128,vy:0,life:8,own:'P'}];
    const before=programSnapshot(),commander=tacticalSummary();advance(.03);const after=programSnapshot();
    return{before,commander,after,returned:roundExecution.ammunition.returned,sample:selfHistory.at(-1)};
  });
  assert.equal(result.before.self.ammo,3);assert.equal(result.before.enemy.ammo,4);
  assert.equal(result.before.ammunition.inFlight,2);assert.equal(result.before.ammunition.opponentInFlight,1);assert.equal(result.before.ammunition.nextExpiryIn,.02);
  assert.equal(result.commander.self.inFlight,2);assert.equal(result.commander.ammunition.available,3);
  assert.equal(result.after.self.ammo,4);assert.equal(result.after.ammunition.inFlight,1);assert.equal(result.returned,1);
  assert.equal(result.sample.ammo,3);assert.equal(result.sample.enemyAmmo,4);
  assert.ok(result.before.ammunition.recovery.includes('没有自动换弹'));
});

test('automatic navigation avoids a same-lane pile while pressure intent can spend the full magazine',async t=>{
  const results={};
  for(const mode of ['auto','pressure']){
    const page=await pageFor(t);await fixture(page);
    results[mode]=await page.evaluate(mode=>{
      P.x=900;P.y=300;E.a=0;applyTacticalDecision({cmd:'move_to',x:800,y:300});applyTacticalDecision({cmd:'gunnery',mode});
      for(let i=0;i<120;i++)advance(1/60);
      return{shots:roundShots.E,ammo:MAG-E.live,x:E.x,telemetry:roundExecution.ammunition,decision:E.frameShotDecision};
    },mode);
    if(mode==='auto'){
      fs.mkdirSync(path.join(__dirname,'..','test-results'),{recursive:true});
      await page.evaluate(()=>render());await page.screenshot({path:path.join(__dirname,'..','test-results','ammo-control.png'),fullPage:true});
    }
  }
  assert.ok(results.auto.shots>=1&&results.auto.shots<results.pressure.shots);
  assert.equal(results.pressure.shots,5);assert.equal(results.pressure.ammo,0);assert.ok(results.pressure.x>300);
  assert.ok(results.auto.telemetry.waitSeconds>0);assert.ok(results.pressure.telemetry.redundantShots>0);
  assert.ok(results.pressure.telemetry.shots.at(-1).time<2.1);
});

test('an explicit fire order can override a negative automatic value without cancelling navigation',async t=>{
  const page=await pageFor(t);await fixture(page);
  const result=await page.evaluate(()=>{
    P.x=900;P.y=300;E.a=0;applyTacticalDecision({cmd:'move_to',x:800,y:300});aiLocal(1/60);
    for(let i=0;i<30;i++)advance(1/60);
    const score=shotOpportunity().score,goal=E.goal,mode=E.gunneryMode;
    applyTacticalDecision({cmd:'fire'});aiLocal(1/60);
    return{score,mode,shots:roundShots.E,preserved:E.goal===goal,shot:roundExecution.ammunition.shots.at(-1)};
  });
  assert.ok(result.score<0);assert.equal(result.mode,'auto');assert.equal(result.shots,2);assert.equal(result.preserved,true);
  assert.equal(result.shot.source,'explicit');assert.ok(result.shot.score<0);
});

test('scarcity changes pursuit advice but neither zero ammo movement nor the final useful shot is forbidden',async t=>{
  const page=await pageFor(t);await fixture(page);
  const result=await page.evaluate(()=>{
    const spent=()=>Array.from({length:5},(_,i)=>({id:i+1,x:700+i*20,y:50,vx:128,vy:0,life:10,own:'E'}));
    E.live=5;bullets=spent();P.x=500;P.y=300;E.a=0;applyTacticalDecision({cmd:'algo',name:'chase_and_fire'});
    const firstX=E.x;aiLocal(.05);const cautious=E.x<firstX;
    applyTacticalDecision({cmd:'move_to',x:450,y:300});const navX=E.x;gT+=.1;aiLocal(.05);const explicitAdvance=E.x>navX;
    P.live=5;applyTacticalDecision({cmd:'gunnery',mode:'pressure'});applyTacticalDecision({cmd:'algo',name:'chase_and_fire'});
    const pressureX=E.x;gT+=.1;aiLocal(.05);const pressureAdvance=E.x>pressureX;
    E.x=300;E.y=300;E.a=0;P.x=370;P.live=0;E.live=4;E.cd=0;bullets=spent().slice(0,4);
    applyTacticalDecision({cmd:'gunnery',mode:'conserve'});applyTacticalDecision({cmd:'algo',name:'chase_and_fire'});gT+=.1;aiLocal(1/60);
    return{cautious,explicitAdvance,pressureAdvance,lastShot:roundExecution.ammunition.shots.at(-1),shots:roundShots.E,remaining:MAG-E.live};
  });
  assert.equal(result.cautious,true);assert.equal(result.explicitAdvance,true);assert.equal(result.pressureAdvance,true);
  assert.equal(result.shots,1);assert.equal(result.remaining,0);assert.equal(result.lastShot.availableBefore,1);
  assert.equal(result.lastShot.source,'automatic');assert.ok(result.lastShot.score>0);
});

test('coach receives shot evidence and learns an independent gunnery program that persists across navigation and reload',async t=>{
  const page=await pageFor(t);await fixture(page);const start=reviews.length;
  reviewReply={memory_add:['用新覆盖收益比较已有弹道，不用固定保留弹数'],set_gunnery:{name:'adaptive_fire',code:'const o=state.gunnery.current; return {fire:o.hitValue+o.newCoverageValue>o.slotCost+o.duplicateCost};'}};
  t.after(()=>{reviewReply=null});
  await page.evaluate(()=>{
    cfg.endpoint=location.origin+'/mock/messages';fire(E);gT+=.5;E.cd=0;fire(E);E.alive=false;roundOver(E,{own:'P'});
  });
  await page.waitForFunction(()=>evolution.activeGunnery==='adaptive_fire'&&!reviewPending,null,{polling:20,timeout:6000});
  assert.equal(reviews.length,start+1);assert.ok(reviews[start].messages[0].content.includes('availableBefore'));
  assert.ok(reviews[start].system.includes('set_gunnery'));assert.ok(reviews[start].system.includes('不可越过的留弹数'));
  await reloadArena(page);await fixture(page);
  assert.equal(await page.evaluate(()=>evolution.activeGunnery),'adaptive_fire');
  await page.evaluate(()=>{
    P.x=900;P.y=300;E.a=0;E.live=4;E.gunneryMode='conserve';bullets=[{id:1,x:850,y:300,vx:128,vy:0,life:10,own:'E'},{id:2,x:850,y:250,vx:128,vy:0,life:10,own:'E'},{id:3,x:850,y:350,vx:128,vy:0,life:10,own:'E'},{id:4,x:950,y:300,vx:-128,vy:0,life:10,own:'E'}];
    applyTacticalDecision({cmd:'move_to',x:800,y:300});runGunnery();
  });
  await page.waitForFunction(()=>gunneryState?.value?.fire===false,null,{polling:20,timeout:4000});
  const waiting=await page.evaluate(()=>{gT+=.12;aiLocal(1/60);return{shots:roundShots.E,source:E.frameShotDecision?.source,x:E.x,goal:E.goal}});
  assert.equal(waiting.shots,0);assert.equal(waiting.source,'learned:adaptive_fire');assert.ok(waiting.x>300);assert.equal(waiting.goal.x,800);
  const forced=await page.evaluate(()=>{applyTacticalDecision({cmd:'fire'});aiLocal(1/60);return{shots:roundShots.E,source:roundExecution.ammunition.shots.at(-1).source}});
  assert.deepEqual(forced,{shots:1,source:'explicit'});
});

test('gunnery cannot acquire movement authority and invalid code preserves the accepted program',async t=>{
  const page=await pageFor(t);await fixture(page);
  const result=await page.evaluate(async()=>{
    await installGunnery({name:'choice',code:'return {fire:true};'});const version=evolution.generation;
    let error='';try{await installGunnery({name:'choice',code:'return {fire:true,move:1};'})}catch(e){error=e.message}
    return{error,version,now:evolution.generation,source:GUNNERIES.choice.code,active:evolution.activeGunnery};
  });
  assert.ok(result.error.includes('不能驾驶'));assert.equal(result.now,result.version);
  assert.equal(result.source,'return {fire:true};');assert.equal(result.active,'choice');
});

test('new useful coverage remains eligible while another shell occupies a previous firing lane',async t=>{
  const page=await pageFor(t);await fixture(page);
  const result=await page.evaluate(()=>{
    P.x=900;P.y=500;E.a=Math.atan2(200,600);E.live=1;
    bullets=[{id:1,x:500,y:300,vx:128,vy:0,life:10,own:'E'}];
    applyTacticalDecision({cmd:'algo',name:'chase_and_fire'});aiLocal(1/60);
    return{shots:roundShots.E,ammo:MAG-E.live,shot:roundExecution.ammunition.shots.at(-1)};
  });
  assert.equal(result.shots,1);assert.equal(result.ammo,3);assert.equal(result.shot.source,'automatic');
  assert.ok(result.shot.score>0);assert.ok(result.shot.redundancy<.75);
});

test('a learned fire choice can accept a negative default score rather than being blocked by a spending rule',async t=>{
  const page=await pageFor(t);await fixture(page);
  await page.evaluate(async()=>{
    await installGunnery({name:'intentional_pressure',code:'return {fire:true};'});
    P.x=900;P.y=300;E.a=0;E.live=4;E.gunneryMode='conserve';bullets=[{id:1,x:850,y:300,vx:128,vy:0,life:10,own:'E'},{id:2,x:850,y:250,vx:128,vy:0,life:10,own:'E'},{id:3,x:850,y:350,vx:128,vy:0,life:10,own:'E'},{id:4,x:950,y:300,vx:-128,vy:0,life:10,own:'E'}];
    applyTacticalDecision({cmd:'move_to',x:800,y:300});runGunnery();
  });
  await page.waitForFunction(()=>gunneryState?.value?.fire===true,null,{polling:20,timeout:4000});
  const result=await page.evaluate(()=>{gT+=.12;aiLocal(1/60);return{shots:roundShots.E,shot:roundExecution.ammunition.shots.at(-1)}});
  assert.equal(result.shots,1);assert.equal(result.shot.source,'learned:intentional_pressure');assert.ok(result.shot.score<0,JSON.stringify(result));
});

test('a runaway gunnery program falls back while movement continues on the game thread',async t=>{
  const page=await pageFor(t);await fixture(page);
  await page.evaluate(async()=>{
    await installGunnery({name:'broken_later',code:'if(state.self.x>400)while(true){}; return {fire:false};'});
    E.x=450;P.x=950;applyTacticalDecision({cmd:'move_to',x:700,y:300});aiLocal(.05);
  });
  await page.waitForFunction(()=>E.gunneryFault==='broken_later',null,{polling:20,timeout:5000});
  const result=await page.evaluate(()=>{const x=E.x;gT+=.1;aiLocal(.05);return{moved:E.x-x,runner:gunneryState,fault:tacticalSummary().gunnery.fault,alive:E.alive}});
  assert.ok(result.moved>0);assert.equal(result.runner,null);assert.equal(result.fault,'broken_later');assert.equal(result.alive,true);
});

test('difficulty defaults to standard, persists through reload and keeps existing learning',async t=>{
  const page=await pageFor(t,{difficulty:null});await fixture(page);
  assert.equal(await page.locator('#difficultySelect').inputValue(),'normal');
  await page.evaluate(()=>{installPolicy({name:'keep_learning',steps:[{when:'always',do:'roam'}]});evolution.completed=205;saveEvolution()});
  await page.locator('#cfgBtn').click();await page.locator('#difficultySelect').selectOption('easy');await page.locator('#save').click();
  await reloadArena(page);
  assert.deepEqual(await page.evaluate(()=>({level:difficultyId,completed:evolution.completed,policy:evolution.activePolicy,generation:evolution.generation})),{level:'easy',completed:205,policy:'keep_learning',generation:1});
  await page.evaluate(()=>setDifficulty('__proto__'));assert.equal(await page.locator('#difficultySelect').inputValue(),'easy');
});

test('lower difficulties hold smooth motion with their actual reduced physical speeds',async t=>{
  const page=await pageFor(t);await fixture(page);
  const result=await page.evaluate(()=>{
    const outcomes={};let calls=0;
    reg('reaction_probe','test',(tank,dt)=>{calls++;turnToward(tank,0,dt);drive(tank,dt,1)});
    for(const id of ['easy','normal','hard','expert']){
      setDifficulty(id);localControl=null;gT=0;E.x=300;E.y=300;E.a=0;E.curAlgo='reaction_probe';E.turnTarget=null;E.act=null;E.emergency=false;E.dodgeUntil=0;calls=0;
      for(let frame=0;frame<60;frame++){gT+=1/60;aiLocal(1/60)}
      outcomes[id]={calls,travel:E.x-300};
    }
    return outcomes;
  });
  for(const [id,speed]of Object.entries({easy:60,normal:78,hard:90,expert:100}))assert.ok(Math.abs(result[id].travel-speed)<.001,JSON.stringify(result));
  assert.ok(result.easy.calls<result.normal.calls);assert.ok(result.normal.calls<result.hard.calls);assert.ok(result.hard.calls<result.expert.calls);
  assert.equal(result.expert.calls,60);
});

test('easy mode delays reacting to new bullets while expert reacts on the next frame',async t=>{
  const page=await pageFor(t);await fixture(page);
  const result=await page.evaluate(()=>{
    const outcomes={};
    for(const id of ['easy','expert']){
      setDifficulty(id);localControl=null;gT=0;bullets=[];E.x=300;E.y=300;E.a=0;E.curAlgo=null;E.turnTarget=null;E.hold=true;E.emergency=false;E.dodgeUntil=0;E.cd=0;E.live=0;
      aiLocal(.02);bullets=[{x:240,y:300,vx:128,vy:0,own:'P',life:5}];gT=.02;aiLocal(.02);const immediate=E.emergency;
      gT=.46;aiLocal(.02);outcomes[id]={immediate,later:E.emergency};
    }
    return outcomes;
  });
  assert.deepEqual(result,{easy:{immediate:false,later:true},expert:{immediate:true,later:true}});
});

test('easy mode adds no ammunition reserve or extra physical firing interval',async t=>{
  const page=await pageFor(t);await fixture(page);
  const state=await page.evaluate(()=>{
    setDifficulty('easy');reg('full_fire_probe','test',tank=>fire(tank));E.curAlgo='full_fire_probe';
    for(let frame=0;frame<100;frame++){gT+=.02;E.cd=Math.max(0,E.cd-.02);aiLocal(.02)}
    return{shots:roundShots.E,ammo:MAG-E.live,times:roundExecution.ammunition.shots.map(shot=>shot.time)};
  });
  assert.equal(state.shots,5);assert.equal(state.ammo,0);
  assert.ok(state.times[1]-state.times[0]<=.42);assert.ok(state.times.at(-1)-state.times[0]<=1.68);
});

test('short completed streams wait for the lower difficulty cadence before requesting again',async t=>{
  const page=await pageFor(t,{difficulty:'normal'});
  await page.evaluate(()=>{
    window.requests=[];window.fetch=async(_url,options)=>{
      requests.push(JSON.parse(options.body));
      return new Response('data: '+JSON.stringify({type:'content_block_delta',delta:{type:'text_delta',text:'{"cmd":"algo","name":"roam"}'}})+'\n\n');
    };cfg.key='test-key';
  });
  await page.waitForFunction(()=>requests.length===1&&streamAbort===null,null,{polling:20,timeout:5000});
  await new Promise(resolve=>setTimeout(resolve,550));
  const state=await page.evaluate(()=>({requests:requests.length,remaining:nextControlAt-performance.now(),body:requests[0]}));
  assert.equal(state.requests,1);assert.ok(state.remaining>6500);assert.equal(state.body.max_tokens,384);assert.equal(state.body.thinking.type,'disabled');
  assert.ok(state.body.system.length<await page.evaluate(()=>controlPrompt(DIFFICULTIES.expert).length));
  const summary=JSON.parse(state.body.messages[0].content.split('\n')[0]);assert.ok(summary.self);assert.ok(summary.enemy);assert.ok(Array.isArray(summary.bullets));assert.match(state.body.messages[0].content,/地图/);
  await page.evaluate(()=>{nextControlAt=0});await page.waitForFunction(()=>requests.length===2,null,{polling:20,timeout:5000});
  await page.evaluate(()=>togglePause());await new Promise(resolve=>setTimeout(resolve,250));assert.equal(await page.evaluate(()=>requests.length),2);
});

test('batched reviews retain each match through reload, then update and save executable learning',async t=>{
  const page=await pageFor(t,{difficulty:null});await fixture(page);
  await page.evaluate(()=>{
    window.fetch=()=>{throw new Error('review requested too early')};
    for(let i=0;i<2;i++){E.alive=false;roundOver(E,{own:'P'});advance(3)}
  });
  assert.deepEqual(await page.evaluate(()=>({queue:reviewQueue.length,completed:evolution.completed,reviews:evolution.reviews,round})),{queue:2,completed:2,reviews:0,round:3});
  await reloadArena(page);await fixture(page);
  const state=await page.evaluate(async()=>{
    window.requests=[];window.fetch=async(_url,options)=>{requests.push(JSON.parse(options.body));return new Response(JSON.stringify({content:[{type:'text',text:JSON.stringify({memory_add:['集中复盘保留实际证据'],set_algo:{name:'batch_learned',steps:[{when:'always',do:'roam'}]}})}]}))};
    E.alive=false;roundOver(E,{own:'P'});await reflectTask;
    return{queue:reviewQueue.length,completed:evolution.completed,reviews:evolution.reviews,generation:evolution.generation,policy:evolution.activePolicy,body:requests[0],count:requests.length,stored:JSON.parse(localStorage.getItem('aitank_review_queue')).length};
  });
  assert.equal(state.count,1);assert.equal(state.completed,3);assert.equal(state.reviews,1);assert.equal(state.queue,0);assert.equal(state.stored,0);assert.equal(state.policy,'batch_learned');assert.equal(state.generation,1);assert.equal(state.body.max_tokens,2800);
  for(const round of [1,2,3])assert.ok(state.body.messages[0].content.includes('第'+round+'局'));
  assert.ok(state.body.messages[0].content.includes('档位变化'));assert.ok(state.body.messages[0].content.includes('不是程序卡顿'));
  await reloadArena(page);assert.equal(await page.evaluate(()=>evolution.activePolicy),'batch_learned');
});

test('each difficulty batches the configured number of matches without blocking intervening rounds',async t=>{
  const page=await pageFor(t);await fixture(page);
  const result=await page.evaluate(async()=>{
    const outcomes={};
    for(const id of ['easy','normal','hard','expert']){
      setDifficulty(id);reviewQueue=[];let count=0;phase='playing';E.alive=true;
      window.fetch=async()=>{count++;return new Response(JSON.stringify({content:[{type:'text',text:'{"memory_add":[],"set_algo":null}'}]}))};
      for(let i=0;i<difficulty().reviewEvery;i++){
        E.alive=false;roundOver(E,{own:'P'});if(reflectTask)await reflectTask;
        if(i<difficulty().reviewEvery-1&&count)throw new Error('early review');
        advance(3);
      }
      outcomes[id]={count,queue:reviewQueue.length,phase};
    }
    return outcomes;
  });
  for(const value of Object.values(result))assert.deepEqual(value,{count:1,queue:0,phase:'playing'});
});

test('pause cancels an active review and resumes the saved report only after continuing',async t=>{
  const page=await pageFor(t);await fixture(page);
  await page.evaluate(async()=>{
    window.reviewCalls=0;window.wasAborted=false;window.fetch=(_url,{signal})=>{
      reviewCalls++;
      if(reviewCalls>1)return Promise.resolve(new Response(JSON.stringify({content:[{type:'text',text:'{"memory_add":["resume lesson"],"set_algo":null}'}]})));
      return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>{wasAborted=true;reject(new DOMException('aborted','AbortError'))},{once:true}));
    };
    E.alive=false;roundOver(E,{own:'P'});togglePause();await reflectTask;advance(3);
  });
  await new Promise(resolve=>setTimeout(resolve,250));
  assert.deepEqual(await page.evaluate(()=>({calls:reviewCalls,aborted:wasAborted,pending:reviewPending,queue:reviewQueue.length,round,phase})),{calls:1,aborted:true,pending:true,queue:1,round:1,phase:'review'});
  await page.evaluate(async()=>{togglePause();advance(.1);await reflectTask;advance(3)});
  assert.deepEqual(await page.evaluate(()=>({calls:reviewCalls,queue:reviewQueue.length,reviews:evolution.reviews,round,phase})),{calls:2,queue:0,reviews:1,round:2,phase:'playing'});
});

test('failed batch stays saved for a later review rather than losing learning evidence',async t=>{
  const page=await pageFor(t,{difficulty:'hard'});await fixture(page);
  const state=await page.evaluate(async()=>{
    window.fetch=async()=>new Response('',{status:503});
    E.alive=false;roundOver(E,{own:'P'});advance(3);E.alive=false;roundOver(E,{own:'P'});await reflectTask;advance(3);
    return{queue:reviewQueue.length,saved:JSON.parse(localStorage.getItem('aitank_review_queue')).length,reviews:evolution.reviews,phase,round};
  });
  assert.deepEqual(state,{queue:2,saved:2,reviews:0,phase:'playing',round:3});
});

test('learned local code remains executable at the slowest reaction cadence',async t=>{
  const page=await pageFor(t);await fixture(page);
  await page.evaluate(async()=>{
    setDifficulty('easy');await installCode({name:'slow_code',code:'return {move:-1,turn:0};'});E.curAlgo='slow_code';aiLocal(.02);
  });
  await page.waitForFunction(()=>!!programState?.value,null,{polling:20,timeout:5000});
  const state=await page.evaluate(()=>{const x=E.x;gT+=.46;aiLocal(.02);return{move:E.x-x,fault:E.programFault,policy:E.curAlgo}});
  assert.ok(state.move<0);assert.equal(state.fault,null);assert.equal(state.policy,'slow_code');
});

test('slow reactions do not repeat a consumed fire order or overshoot an arrived navigation goal',async t=>{
  const page=await pageFor(t);await fixture(page);
  const state=await page.evaluate(()=>{
    setDifficulty('easy');E.a=0;applyTacticalDecision({cmd:'fire'});
    for(let frame=0;frame<22;frame++){gT+=.02;E.cd=Math.max(0,E.cd-.02);aiLocal(.02)}
    const shots=roundShots.E;
    // Isolate navigation from shots; aiLocal alone does not advance projectiles.
    bullets=[];E.live=MAG;E.cd=0;localControl=null;E.x=300;E.y=300;E.a=0;applyTacticalDecision({cmd:'move_to',x:335,y:300});
    for(let frame=0;frame<50;frame++){gT+=.02;aiLocal(.02)}
    return{shots,x:E.x,status:E.goal.status,goal:E.goal.x};
  });
  assert.equal(state.shots,1);assert.equal(state.status,'arrived');assert.ok(Math.abs(state.x-state.goal)<=12);
});

test('opening settings suspends a review without restarting requests behind the dialog',async t=>{
  const page=await pageFor(t);await fixture(page);
  await page.evaluate(async()=>{
    window.reviewCalls=0;window.fetch=(_url,{signal})=>{reviewCalls++;return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')),{once:true}))};
    E.alive=false;roundOver(E,{own:'P'});showSettings();await reflectTask;advance(3);await doReflect();
  });
  assert.deepEqual(await page.evaluate(()=>({calls:reviewCalls,pending:reviewPending,queue:reviewQueue.length,dialog:dlg.style.display,round})),{calls:1,pending:true,queue:1,dialog:'flex',round:1});
});

test('easy mode closes the actual SSE after its command budget and changing difficulty refreshes safely',async t=>{
  const page=await pageFor(t,{difficulty:'easy'}),start=streams.length,closed=closedStreams;
  await page.evaluate(endpoint=>{cfg.key='test-key';cfg.endpoint=endpoint},origin+'/mock/messages');
  await page.waitForFunction(()=>E.gunneryMode==='pressure'&&streamAbort===null,null,{polling:20,timeout:5000});
  await new Promise(resolve=>setTimeout(resolve,350));
  assert.equal(streams.length,start+1);assert.ok(closedStreams>closed);assert.equal(streams[start].max_tokens,256);
  assert.equal(await page.evaluate(()=>E.shotRequested),false);
  await page.locator('#cfgBtn').click();await page.locator('#difficultySelect').selectOption('expert');await page.locator('#save').click();
  await page.waitForFunction(()=>E.shotRequested&&streamAbort!==null,null,{polling:20,timeout:5000});
  assert.equal(streams.length,start+2);assert.equal(streams[start+1].max_tokens,1024);assert.equal(streams[start+1].thinking.type,'disabled');
  await page.evaluate(()=>togglePause());
});

test('cooperative mode spawns three separated tanks and persists without resetting learning',async t=>{
  const page=await pageFor(t);await fixture(page);
  await page.evaluate(()=>{installPolicy({name:'coop_existing',steps:[{when:'always',do:'roam'}]});saveMem()});
  await page.locator('#cfgBtn').click();await page.locator('#modeSelect').selectOption('coop');await page.locator('#save').click();
  const state=await page.evaluate(()=>{
    let invalid=0;
    for(let i=0;i<300;i++){
      newRound();if(allTanks().some(t=>!t.alive||blk(t.x,t.y))||regions()!==1||Math.hypot(P.x-P2.x,P.y-P2.y)<TR*2||humanTanks().some(t=>Math.hypot(t.x-E.x,t.y-E.y)<350))invalid++;
    }
    return{invalid,mode:gameMode,completed:evolution.completed,policy:evolution.activePolicy,players:allTanks().length};
  });
  assert.deepEqual(state,{invalid:0,mode:'coop',completed:0,policy:'coop_existing',players:3});
  await reloadArena(page);assert.deepEqual(await page.evaluate(()=>({mode:gameMode,alive:P2.alive,policy:evolution.activePolicy})),{mode:'coop',alive:true,policy:'coop_existing'});
  await page.locator('#cfgBtn').click();await page.locator('#modeSelect').selectOption('solo');await page.locator('#save').click();assert.equal(await page.evaluate(()=>P2.alive),false);
  assert.equal(await page.evaluate(()=>evolution.completed),0);
});

test('one keyboard can drive, turn and fire both players independently, with P reserved for P2',async t=>{
  const page=await pageFor(t);await coopFixture(page);
  await page.keyboard.down('w');await page.keyboard.down('p');
  await page.evaluate(()=>advance(.05));
  assert.deepEqual(await page.evaluate(()=>({p1:P.x,p2:P2.x,paused})),{p1:155,p2:155,paused:false});
  await page.keyboard.up('w');await page.keyboard.up('p');
  await page.keyboard.down('a');await page.keyboard.down("'");await page.evaluate(()=>advance(.05));
  const turns=await page.evaluate(()=>({p1:P.a,p2:P2.a}));assert.ok(turns.p1<0);assert.ok(turns.p2>0);
  await page.keyboard.up('a');await page.keyboard.up("'");
  await page.keyboard.down(';');await page.evaluate(()=>advance(.05));await page.keyboard.up(';');
  assert.ok(await page.evaluate(()=>P2.x<155));
  await page.keyboard.press('Space');await page.keyboard.press('Enter');
  assert.deepEqual(await page.evaluate(()=>({p1:P.live,p2:P2.live,shots:{...roundShots},owners:bullets.map(b=>b.own)})),{p1:1,p2:1,shots:{P:1,P2:1,E:0},owners:['P','P2']});
});

test('P2 physical punctuation keys, pause, settings and focus loss cannot leave stuck inputs',async t=>{
  const page=await pageFor(t);await coopFixture(page);
  await page.evaluate(()=>{
    document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'；',code:'Semicolon',bubbles:true}));
    document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'’',code:'Quote',bubbles:true}));
  });
  assert.deepEqual(await page.evaluate(()=>({back:keys2.back,right:keys2.cw})),{back:true,right:true});
  await page.keyboard.press('Escape');
  assert.deepEqual(await page.evaluate(()=>({paused,held:Object.values(keys2).some(Boolean)})),{paused:true,held:false});
  await page.keyboard.press('Enter');assert.equal(await page.evaluate(()=>P2.live),0);
  await page.keyboard.press('Escape');await page.keyboard.down('p');await page.keyboard.down('w');
  await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
  assert.deepEqual(await page.evaluate(()=>({paused,held:[...Object.values(keys),...Object.values(keys2)].some(Boolean)})),{paused:true,held:false});
  await page.locator('#cfgBtn').click();await page.locator('#cfgKey').fill("pl;'wasd");await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(()=>bullets.length),0);assert.equal(await page.evaluate(()=>Object.values(keys2).some(Boolean)),false);
});

test('either teammate can inflict friendly damage without ending the round or crediting AI a kill',async t=>{
  const page=await pageFor(t);await coopFixture(page);
  const outcomes=await page.evaluate(()=>{
    const out=[];
    for(const shooterId of ['P','P2']){
      newRound();walls=[];E.x=900;E.y=600;E.hold=true;
      const shooter=shooterId==='P'?P:P2,victim=shooter===P?P2:P;
      shooter.x=150;shooter.y=300;shooter.a=0;victim.x=350;victim.y=300;fire(shooter);
      for(let frame=0;frame<100&&victim.alive;frame++)advance(.025);
      out.push({shooter:shooterId,victim:victim.id,dead:!victim.alive,phase,completed:evolution.completed,score:E.score,slot:shooter.live,event:eliminations[0],target:E.targetId});
    }
    return out;
  });
  for(const state of outcomes){assert.equal(state.dead,true);assert.equal(state.phase,'playing');assert.equal(state.completed,0);assert.equal(state.score,0);assert.equal(state.slot,0);assert.equal(state.event.by,state.shooter);assert.equal(state.event.friendly,true);assert.equal(state.target,state.shooter)}
});

test('after P1 falls, P2 remains controllable and AI death still awards the human team a win',async t=>{
  const page=await pageFor(t);await coopFixture(page);
  const state=await page.evaluate(()=>{
    roundOver(P,{own:'E'});const phaseAfterFirst=phase;streamOn=true;const controls=canControl();streamOn=false;
    const x=P.x,a=P.a,x2=P2.x;keys.fwd=keys.cw=true;keys2.fwd=true;advance(.05);
    return{phaseAfterFirst,controls,p1Moved:P.x!==x||P.a!==a,p2Move:P2.x-x2,p1CanFire:fire(P),completed:evolution.completed};
  });
  assert.deepEqual(state,{phaseAfterFirst:'playing',controls:true,p1Moved:false,p2Move:5,p1CanFire:false,completed:0});
  await page.evaluate(async()=>{roundOver(E,{own:'P2'});await reflectTask});
  assert.deepEqual(await page.evaluate(()=>({winner:roundResult,humanScore:P.score,aiScore:E.score,completed:evolution.completed,aiWins:evolution.aiWins,mode:evolution.history.at(-1).mode})),{winner:'humans',humanScore:1,aiScore:0,completed:1,aiWins:0,mode:'coop'});
});

test('AI only wins after both humans fall, and the next round revives both with separate full ammunition',async t=>{
  const page=await pageFor(t);await coopFixture(page);
  const state=await page.evaluate(async()=>{
    roundOver(P2,{own:'E'});const first={phase,completed:evolution.completed};roundOver(P,{own:'E'});await reflectTask;
    const end={winner:roundResult,aiScore:E.score,completed:evolution.completed,reviews:evolution.reviews,deaths:eliminations.length};
    roundOver(P,{own:'E'});keys2.fwd=true;advance(3);
    return{first,end,next:{round,alive:humanTanks().map(t=>t.alive),ammo:humanTanks().map(t=>MAG-t.live),held:keys2.fwd,bullets:bullets.length}};
  });
  assert.deepEqual(state.first,{phase:'playing',completed:0});assert.deepEqual(state.end,{winner:'ai',aiScore:1,completed:1,reviews:1,deaths:2});
  assert.deepEqual(state.next,{round:2,alive:[true,true],ammo:[5,5],held:false,bullets:0});
});

test('same-frame AI and human eliminations always award humans victory regardless of bullet order',async t=>{
  const page=await pageFor(t);await coopFixture(page);
  const states=await page.evaluate(async()=>{
    const out=[];
    for(const reverse of [false,true]){
      newRound();walls=[];P.x=150;P.y=150;P2.x=150;P2.y=500;E.x=850;E.y=400;E.hold=true;
      bullets=[{x:P.x,y:P.y,vx:128,vy:0,own:'E',life:5},{x:P2.x,y:P2.y,vx:128,vy:0,own:'E',life:5},{x:E.x,y:E.y,vx:128,vy:0,own:'P2',life:5}];
      if(reverse)bullets.reverse();E.live=2;P2.live=1;advance(.01);await reflectTask;
      out.push({winner:roundResult,humans:humanTanks().map(t=>t.alive),ai:E.alive,deaths:eliminations.length,aiWon:evolution.history.at(-1).aiWon});
    }
    return out;
  });
  for(const state of states)assert.deepEqual(state,{winner:'humans',humans:[false,false],ai:false,deaths:3,aiWon:false});
});

test('a fallen teammate projectile can still win, while P2 expiry and self hits return only P2 slots',async t=>{
  const page=await pageFor(t);await coopFixture(page);
  const state=await page.evaluate(async()=>{
    P2.live=1;bullets=[{x:200,y:500,vx:128,vy:0,own:'P2',life:.001}];advance(.02);const expiry={p2:P2.live,ai:E.live};
    P2.live=1;bullets=[{x:P2.x,y:P2.y,vx:128,vy:0,own:'P2',life:5}];advance(.01);const selfHit={alive:P2.alive,p2:P2.live,self:eliminations.at(-1).selfHit,phase};
    P.live=1;bullets=[{x:E.x,y:E.y,vx:128,vy:0,own:'P2',life:5}];P2.live=1;advance(.01);await reflectTask;
    return{expiry,selfHit,winner:roundResult,source:eliminations.find(event=>event.id==='E').by,aiReturned:roundExecution.ammunition.returned};
  });
  assert.deepEqual(state.expiry,{p2:0,ai:0});assert.deepEqual(state.selfHit,{alive:false,p2:0,self:true,phase:'playing'});assert.equal(state.winner,'humans');assert.equal(state.source,'P2');assert.equal(state.aiReturned,0);
});

test('AI sees both histories and may retarget without mixing predictions or cancelling navigation',async t=>{
  const page=await pageFor(t);await coopFixture(page);
  const state=await page.evaluate(()=>{
    P.x=700;P.y=200;P2.x=300;P2.y=400;E.x=150;E.y=200;
    enemyHistory=[{x:680,y:200,a:0,time:0},{x:700,y:200,a:0,time:1}];enemyHistory2=[{x:300,y:380,a:Math.PI/2,time:0},{x:300,y:400,a:Math.PI/2,time:1}];
    applyTacticalDecision({cmd:'move_to',x:500,y:500});const goal=E.goal;
    const accepted=applyTacticalDecision({cmd:'target',id:'P2'}),pred=predictEnemy(.5,'linear'),snapshot=programSnapshot(),summary=tacticalSummary(),map=asciiMap();
    const locked=E.targetLocked;applyTacticalDecision({cmd:'target',id:'P',round_id:roundId-1});const stale=E.targetId;
    P2.alive=false;const rejected=applyTacticalDecision({cmd:'target',id:'P2'});selectAITarget();
    return{accepted,pred,snapshot,summary,map,locked,stale,rejected,retarget:E.targetId,goalKept:E.goal===goal};
  });
  assert.equal(state.accepted,true);assert.equal(state.snapshot.enemy.id,'P2');assert.equal(state.snapshot.enemies.length,2);assert.equal(state.snapshot.enemies[0].history[0].x,680);assert.equal(state.snapshot.enemies[1].history[0].y,380);
  assert.ok(Math.abs(state.pred.x-300)<.001);assert.ok(Math.abs(state.pred.y-410)<.001);assert.equal(state.summary.mode,'coop');assert.equal(state.summary.rules.humanCount,2);assert.equal(state.summary.enemies.length,2);assert.match(state.map,/C=P2/);
  assert.equal(state.locked,true);assert.equal(state.stale,'P2');assert.equal(state.rejected,false);assert.equal(state.retarget,'P');assert.equal(state.goalKept,true);
});

test('target stays with the chosen opponent until commander delegates automatic target selection',async t=>{
  const page=await pageFor(t);await coopFixture(page);
  const state=await page.evaluate(()=>{
    E.x=850;E.y=400;P.x=150;P.y=300;P2.x=650;P2.y=400;gT=2;selectAITarget();const local=E.targetId;
    applyTacticalDecision({cmd:'target',id:'P'});gT+=2;selectAITarget();const locked=E.targetId;
    applyTacticalDecision({cmd:'target',id:'auto'});return{local,locked,auto:E.targetId,targetLocked:E.targetLocked};
  });
  assert.deepEqual(state,{local:'P',locked:'P',auto:'P2',targetLocked:false});
});

test('retargeting discards old learned predictions and recomputes for the surviving player',async t=>{
  const page=await pageFor(t);await coopFixture(page);
  await page.evaluate(async()=>{
    await installPredictor({name:'coop_predictor',code:'return {prediction:{x:state.enemy.x+25,y:state.enemy.y}};'});aiLocal(.02);
  });
  await page.waitForFunction(()=>E.prediction?.owner==='predictor',null,{polling:20,timeout:5000});
  await page.evaluate(()=>{applyTacticalDecision({cmd:'target',id:'P2'});if(E.prediction!==null)throw new Error('stale prediction retained');gT+=.12;aiLocal(.02)});
  await page.waitForFunction(()=>E.prediction?.owner==='predictor',null,{polling:20,timeout:5000});
  assert.equal(await page.evaluate(()=>E.prediction.y),500);
  await page.evaluate(()=>{roundOver(P2,{own:'P'});gT+=.12;aiLocal(.02)});
  await page.waitForFunction(()=>E.prediction?.owner==='predictor',null,{polling:20,timeout:5000});
  assert.equal(await page.evaluate(()=>E.prediction.y),300);assert.equal(await page.evaluate(()=>E.targetId),'P');
});

test('bodies and defensive rollout include the second opponent, and P2 bullets count as hostile',async t=>{
  const page=await pageFor(t);await coopFixture(page);
  const state=await page.evaluate(()=>{
    E.x=300;E.y=300;E.a=0;P.x=900;P.y=600;P2.x=355;P2.y=300;
    const blocked=tankBlocked(E,315,300),outcome=AITankDodge.assess(programSnapshot(),{move:1,turn:0});
    P2.x=600;P2.y=300;P2.live=1;bullets=[{x:400,y:300,vx:-128,vy:0,own:'P2',life:5}];weaponCache=null;
    const resources=ammunitionReport();P2.alive=false;const empty=tankBlocked(E,600,300);
    return{blocked,displacement:outcome.displacement,resources,empty};
  });
  assert.equal(state.blocked,true);assert.ok(state.displacement<10);assert.ok(state.resources.danger>0);assert.equal(state.resources.opponents.length,2);assert.equal(state.resources.opponents.find(t=>t.id==='P2').inFlight,1);assert.equal(state.empty,false);
});

test('cooperative review and export retain friendly-fire attribution, both players and mode',async t=>{
  const page=await pageFor(t);await coopFixture(page);const start=reviews.length;
  await page.evaluate(async()=>{
    enemyHistory=[{x:150,y:300,a:0,time:0}];enemyHistory2=[{x:150,y:500,a:0,time:0}];roundOver(P,{own:'P2'});roundOver(E,{own:'P2'});await reflectTask;
  });
  assert.equal(reviews.length,start+1);assert.match(reviews[start].messages[0].content,/模式 coop/);assert.match(reviews[start].messages[0].content,/P2 独立运动样本/);assert.match(reviews[start].messages[0].content,/被队友 P2 击毁/);
  const history=await page.evaluate(()=>evolution.history.at(-1));assert.equal(history.mode,'coop');assert.equal(history.eliminations[0].friendly,true);assert.equal(history.eliminations[0].by,'P2');assert.equal(history.aiWon,false);
  const downloadPromise=page.waitForEvent('download');await page.locator('#cfgBtn').click();await page.locator('#memExport').click();const download=await downloadPromise,stream=await download.createReadStream();let raw='';for await(const chunk of stream)raw+=chunk;
  const exported=JSON.parse(raw);assert.equal(exported.version,9);assert.equal(exported.mode,'coop');assert.ok(!raw.includes('test-key'));
});

test('switching modes abandons a live round without a loss and rejects late review writes',async t=>{
  const page=await pageFor(t);await coopFixture(page);
  await page.evaluate(()=>{
    window.fetch=()=>new Promise(resolve=>{window.finishCoopReview=()=>resolve(new Response(JSON.stringify({content:[{type:'text',text:'{"memory_add":["stale coop"],"set_algo":{"name":"stale_coop","steps":[{"when":"always","do":"roam"}]}}'}]})))});
    roundOver(E,{own:'P2'});keys.fwd=true;keys2.fwd=true;setGameMode('solo');
  });
  await page.evaluate(async()=>{finishCoopReview();await reflectTask});
  assert.deepEqual(await page.evaluate(()=>({mode:gameMode,completed:evolution.completed,reviews:evolution.reviews,p2:P2.alive,held:keys.fwd||keys2.fwd,stale:!!ALGOS.stale_coop,queue:reviewQueue.length})),{mode:'solo',completed:1,reviews:0,p2:false,held:false,stale:false,queue:1});
  await page.evaluate(()=>{setGameMode('coop');setGameMode('solo')});assert.equal(await page.evaluate(()=>evolution.completed),1);
});

test('cooperative desktop and narrow layouts show three tanks and keep status outside the battlefield',async t=>{
  fs.mkdirSync(path.join(__dirname,'..','test-results'),{recursive:true});
  for(const [name,options] of [['desktop',{viewport:{width:1366,height:768}}],['mobile',{viewport:{width:390,height:844},isMobile:true,hasTouch:true}]]){
    const page=await pageFor(t,options);await coopFixture(page);
    await page.evaluate(()=>{newRound();render()});
    const state=await page.evaluate(()=>({width:document.documentElement.scrollWidth,viewport:innerWidth,height:document.documentElement.scrollHeight,tanks:allTanks().filter(t=>t.alive).length,overlays:document.querySelectorAll('#stage select,#stage #humanStatus').length}));
    assert.ok(state.width<=state.viewport);assert.equal(state.tanks,3);assert.equal(state.overlays,0);if(name==='desktop')assert.ok(state.height<=768);
    assert.equal(await page.locator('#humanStatus').isVisible(),true);assert.match(await page.locator('#keyHelp').textContent(),/Enter/);
    await page.screenshot({path:path.join(__dirname,'..','test-results','coop-'+name+'.png'),fullPage:true});
    if(name==='desktop'){
      await page.evaluate(async()=>{roundOver(P,{own:'P2'});roundOver(E,{own:'P2'});await reflectTask;render()});
      await page.screenshot({path:path.join(__dirname,'..','test-results','coop-victory.png'),fullPage:true});
    }
  }
});

test('weapon crates collect by driving, preserve normal slots and appear in commander snapshots',async t=>{
  const page=await pageFor(t,{powerups:true});await weaponFixture(page);
  const state=await page.evaluate(()=>{
    weapons.spawnPickup(weaponWorld(),'shotgun',P.x+47,P.y);keys.fwd=true;runFrames(.1);keys.fwd=false;
    P.live=5;const fired=fire(P),summary=tacticalSummary();
    const shieldBox=weapons.spawnPickup(weaponWorld(),'shield',E.x,E.y);applyCmd({cmd:'pickup',id:shieldBox.id});advance(.01);
    return{fired,normal:P.live,ammo:P.weapon.ammo,shells:bullets.filter(b=>b.kind==='pellet').length,seen:summary.enemies.find(t=>t.id==='P').weapon.type,
      recorded:roundExecution.weapons.pickups.some(p=>p.owner==='P'&&p.weapon==='shotgun'),shield:E.shieldUntil>gT,pending:E.weapon?.type,crates:weapons.pickups.length};
  });
  assert.deepEqual(state,{fired:true,normal:5,ammo:2,shells:20,seen:'shotgun',recorded:true,shield:false,pending:'shield',crates:0});
});

test('special expiration does not return normal slots; ordinary expiry still returns its own',async t=>{
  const page=await pageFor(t,{powerups:true});await weaponFixture(page);
  const state=await page.evaluate(()=>{
    P.live=2;bullets=[{id:900,x:400,y:100,vx:128,vy:0,own:'P',life:5},{id:901,x:400,y:200,vx:128,vy:0,own:'P',life:.001}];
    weapons.equip(weaponWorld(),P,'shotgun');fire(P);runFrames(1.2);
    return{normal:P.live,liveNormal:bullets.filter(b=>b.slot!==false).length,special:bullets.filter(b=>b.slot===false).length,ammo:P.weapon.ammo};
  });assert.deepEqual(state,{normal:1,liveNormal:1,special:0,ammo:2});
});

test('laser and death-ray locks freeze movement, rotation and ordinary follow-up fire',async t=>{
  const page=await pageFor(t,{powerups:true});await weaponFixture(page);
  const states=await page.evaluate(()=>{
    const out=[];for(const type of ['laser','deathray']){
      newRound();walls=[];E.x=900;E.y=600;P.x=150;P.y=150;P.a=0;weapons.nextSpawn=999;P2.x=900;P2.y=400;
      weapons.equip(weaponWorld(),P,type);const x=P.x,a=P.a;fire(P);keys.fwd=keys.cw=true;runFrames(.05);
      const follow=fire(P),frozen=P.x===x&&P.a===a;keys.cw=false;runFrames(type==='laser'?.15:.8);
      const columnFrozen=type!=='deathray'||P.x===x;if(type==='deathray')runFrames(.5);out.push({type,frozen,follow,columnFrozen,resumed:P.x>x});clearInput();
    }return out;
  });for(const s of states){assert.equal(s.frozen,true);assert.equal(s.follow,false);assert.equal(s.columnFrozen,true);assert.equal(s.resumed,true)}
});

test('P2 Enter fires a piercing ray with friendly-fire attribution and human victory',async t=>{
  const page=await pageFor(t,{powerups:true});await weaponFixture(page);const before=reviews.length;
  await page.evaluate(()=>{P2.x=150;P2.y=350;P2.a=0;P.x=450;P.y=350;E.x=650;E.y=350;walls=[{x:300,y:0,w:14,h:700}];weapons.equip(weaponWorld(),P2,'deathray')});
  await page.keyboard.press('Enter');
  const s=await page.evaluate(async()=>{runFrames(.9);await reflectTask;return{winner:roundResult,completed:evolution.completed,deaths:eliminations,shots:roundExecution.weapons.shots,history:evolution.history.at(-1)}});
  assert.equal(s.winner,'humans');assert.equal(s.completed,1);assert.equal(s.deaths.length,2);assert.equal(s.deaths.find(e=>e.id==='P').friendly,true);
  assert.equal(s.deaths.find(e=>e.id==='E').weapon,'deathray');assert.equal(s.shots.deathray,1);assert.equal(s.history.execution.weapons.pickups[0].owner,'P2');
  assert.equal(reviews.length,before+1);assert.match(reviews[before].messages[0].content,/deathray/);
});

test('single AI ray settles both human eliminations once',async t=>{
  const page=await pageFor(t,{powerups:true});await weaponFixture(page);
  const s=await page.evaluate(async()=>{
    E.x=150;E.y=350;E.a=0;P.x=450;P.y=350;P2.x=510;P2.y=350;weapons.equip(weaponWorld(),E,'deathray');fire(E);runFrames(.59);advance(.25);await reflectTask;
    return{winner:roundResult,completed:evolution.completed,score:E.score,deaths:eliminations.map(e=>e.id),returned:roundExecution.ammunition.returned};
  });assert.deepEqual(s,{winner:'ai',completed:1,score:1,deaths:['P','P2'],returned:0});
});

test('remote controls steer the missile while freezing P2; pause freezes its fuse and expiry unlocks',async t=>{
  const page=await pageFor(t,{powerups:true});await weaponFixture(page);await page.evaluate(()=>weapons.equip(weaponWorld(),P2,'remote'));
  await page.keyboard.press('Enter');await page.keyboard.down('Quote');await page.keyboard.down('p');
  const s=await page.evaluate(()=>{const x=P2.x,a=P2.a;runFrames(.15);const m=weapons.remote(weaponWorld(),P2);return{x:P2.x-x,a:P2.a-a,angle:Math.atan2(m.vy,m.vx)}});
  assert.equal(s.x,0);assert.equal(s.a,0);assert.ok(s.angle>0);
  await page.keyboard.press('Escape');assert.deepEqual(await page.evaluate(()=>{const before=JSON.stringify(bullets),time=gT;runFrames(1);return{same:before===JSON.stringify(bullets),time:gT===time,held:heldFire.P2.size}}),{same:true,time:true,held:0});
  await page.keyboard.up('Quote');await page.keyboard.up('p');await page.keyboard.press('Escape');
  await page.evaluate(()=>{weapons.remote(weaponWorld(),P2).life=.001;advance(.01)});await page.keyboard.down('p');
  assert.equal(await page.evaluate(()=>{const x=P2.x;runFrames(.1);return P2.x>x&&!P2.weapon&&!P2.remoteId}),true);await page.keyboard.up('p');
});

test('gatling hold supports both P1 aliases and stops on release or settings',async t=>{
  const page=await pageFor(t,{powerups:true});await weaponFixture(page);await page.evaluate(()=>weapons.equip(weaponWorld(),P,'gatling'));
  await page.keyboard.down('Space');await page.keyboard.down('j');await page.keyboard.up('Space');assert.equal(await page.evaluate(()=>{runFrames(.9);return P.weapon.ammo<30&&P.live===0}),true);
  await page.keyboard.up('j');const remaining=await page.evaluate(()=>P.weapon.ammo);await page.evaluate(()=>runFrames(.3));assert.equal(await page.evaluate(()=>P.weapon.ammo),remaining);
  await page.keyboard.down('j');await page.evaluate(()=>showSettings());assert.equal(await page.evaluate(()=>heldFire.P.size===0&&P.gatlingStart===null),true);await page.keyboard.up('j');
});

test('frag ignores OS repeat and detonates on the next press without stealing ordinary ammo',async t=>{
  const page=await pageFor(t,{powerups:true});await weaponFixture(page);await page.evaluate(()=>{weapons.equip(weaponWorld(),P,'frag');P.live=3});
  await page.keyboard.down('Space');await page.keyboard.down('Space');assert.equal(await page.evaluate(()=>!!P.weapon.projectileId&&bullets.filter(b=>b.kind==='shrapnel').length===0),true);
  await page.keyboard.up('Space');await page.keyboard.press('Space');
  assert.deepEqual(await page.evaluate(()=>({normal:P.live,weapon:P.weapon,shells:bullets.filter(b=>b.kind==='shrapnel').length,detonations:roundExecution.weapons.events.filter(e=>e.type==='detonate').length})),{normal:3,weapon:null,shells:24,detonations:1});
});

test('commander snapshots include every special projectile and hide armed enemy mines',async t=>{
  const page=await pageFor(t,{powerups:true});await weaponFixture(page);
  const s=await page.evaluate(()=>{
    weapons.equip(weaponWorld(),P,'mine');fire(P);runFrames(.8);P.weapon=null;P.cd=0;weapons.equip(weaponWorld(),P,'shotgun');fire(P);weapons.equip(weaponWorld(),P2,'double');fire(P2);
    const summary=tacticalSummary(),snapshot=programSnapshot();return{groups:summary.specialProjectiles,normal:summary.bullets.length,actual:bullets.length,mines:summary.weapons.mines.length,localMines:snapshot.weapons.mines.length,forecast:snapshot.ballistics.frames.length,raw:snapshot.bullets.length};
  });assert.equal(s.groups.reduce((n,g)=>n+g.samples.length,0),s.actual);assert.equal(s.actual,21);assert.equal(s.normal,0);assert.equal(s.raw,21);
  assert.equal(s.mines,0);assert.equal(s.localMines,0);assert.ok(s.forecast>0);assert.equal(s.groups[0].format,'[id,x,y,vx,vy,life,seekAt]');
});

test('AI can collect a crate, fire with five normal slots occupied and guide its remote locally',async t=>{
  const page=await pageFor(t,{powerups:true});await weaponFixture(page,{staticAI:false});
  const s=await page.evaluate(()=>{
    E.x=150;E.y=150;E.a=0;P.x=850;P.y=150;P2.x=850;P2.y=500;
    const crate=weapons.spawnPickup(weaponWorld(),'shotgun',200,150),accepted=applyTacticalDecision({cmd:'pickup',id:crate.id});runFrames(.2);
    const collected=E.weapon?.type;E.live=5;E.cd=0;const ready=condMatch('ammo_ready',E,{enemy:P}),fired=attemptAIShot('explicit',P),remaining=E.weapon.ammo;
    bullets=[];weaponForecastCache=null;E.weapon=null;E.cd=0;weapons.equip(weaponWorld(),E,'remote');fire(E);const m=weapons.remote(weaponWorld(),E);P.y=350;const x=E.x,a=E.a;runFrames(.15);
    return{accepted,collected,ready,fired,remaining,locked:E.x===x&&E.a===a,turned:Math.abs(m.vy)>0,normal:E.live};
  });assert.deepEqual(s,{accepted:true,collected:'shotgun',ready:true,fired:true,remaining:2,locked:true,turned:true,normal:5});
});

test('AI defensive forecast sees a charging ray and can hold on a triggered mine',async t=>{
  const page=await pageFor(t,{powerups:true});await weaponFixture(page,{staticAI:false});
  const s=await page.evaluate(()=>{
    E.x=500;E.y=300;P.x=150;P.y=300;P.a=0;weapons.equip(weaponWorld(),P,'deathray');fire(P);
    const snapshot=programSnapshot(),threat=findThreat(E,{enemy:P,bullets,walls,bblk}),standing=AITankDodge.assess(snapshot,{move:0,turn:0});
    weapons.charges=[];P.weapon=null;P.lockUntil=0;P.x=900;P.y=600;weapons.mines=[{id:999,kind:'mine',own:'P',x:E.x,y:E.y,armedAt:gT-1,expires:gT+10,triggerId:'E'}];weaponForecastCache=null;
    const held=AITankDodge.plan(programSnapshot());return{kind:threat.kind,hitTime:standing.hitTime,move:held.move,mineSurvival:held.diagnostic.hitTime};
  });assert.equal(s.kind,'weapon');assert.ok(s.hitTime<1);assert.equal(s.move,0);assert.equal(s.mineSurvival,Infinity);
});

test('disabling powerups clears special state while preserving normal slots and learning',async t=>{
  const page=await pageFor(t,{powerups:true});await weaponFixture(page);
  await page.evaluate(()=>{lessons=['keep learned'];P.live=1;bullets=[{x:500,y:100,vx:128,vy:0,own:'P',life:5}];weapons.equip(weaponWorld(),P,'remote');fire(P);weapons.equip(weaponWorld(),E,'shield');weapons.spawnPickup(weaponWorld(),'laser',500,500);showSettings()});
  await page.locator('#cfgPowerups').uncheck();await page.locator('#save').click();
  assert.deepEqual(await page.evaluate(()=>({enabled:powerupsEnabled,stored:localStorage.getItem('aitank_powerups'),bullets:bullets.length,normal:P.live,weapon:P.weapon,lock:weapons.locked(weaponWorld(),P),pickups:weapons.pickups.length,shield:E.shieldUntil,lesson:lessons[0]})),{enabled:false,stored:'false',bullets:1,normal:1,weapon:null,lock:false,pickups:0,shield:0,lesson:'keep learned'});
});

test('new rounds clear weapons, held fire and mode-specific remote locks',async t=>{
  const page=await pageFor(t,{powerups:true});await weaponFixture(page);
  const s=await page.evaluate(()=>{weapons.equip(weaponWorld(),P2,'remote');fire(P2);weapons.equip(weaponWorld(),E,'shield');weapons.equip(weaponWorld(),P,'mine');fire(P);heldFire.P.add('j');weapons.spawnPickup(weaponWorld(),'laser',500,500);setGameMode('solo');setGameMode('coop');return{bullets:bullets.length,mines:weapons.mines.length,crates:weapons.pickups.length,charges:weapons.charges.length,weapons:[P,P2,E].map(t=>t.weapon),locks:[P,P2,E].map(t=>weapons.locked(weaponWorld(),t)),held:heldFire.P.size,score:evolution.completed}});
  assert.deepEqual(s,{bullets:0,mines:0,crates:0,charges:0,weapons:[null,null,null],locks:[false,false,false],held:0,score:0});
});

test('armed cooperative layouts keep weapon status outside the arena on desktop and mobile',async t=>{
  fs.mkdirSync(path.join(__dirname,'..','test-results'),{recursive:true});
  for(const [name,options] of [['desktop',{viewport:{width:1366,height:768}}],['mobile',{viewport:{width:390,height:844},isMobile:true,hasTouch:true}]]){
    const page=await pageFor(t,{...options,powerups:true});await weaponFixture(page);
    await page.evaluate(()=>{newRound();weapons.equip(weaponWorld(),P,'laser');weapons.equip(weaponWorld(),P2,'remote');weapons.equip(weaponWorld(),E,'deathray');weapons.equip(weaponWorld(),E,'shield');const world=weaponWorld();for(const [i,type] of ['homing','shotgun','mine'].entries()){outer:for(let x=150+i*100;x<FW;x+=100)for(let y=150;y<FH;y+=100)if(weapons.spawnPickup(world,type,x,y))break outer}hud();render()});
    const s=await page.evaluate(()=>{const arena=document.getElementById('stage').getBoundingClientRect(),hud=document.getElementById('weaponStatus').getBoundingClientRect();return{width:document.documentElement.scrollWidth,viewport:innerWidth,height:document.documentElement.scrollHeight,overlap:!(hud.left>=arena.right||hud.top>=arena.bottom||hud.right<=arena.left||hud.bottom<=arena.top)}});
    assert.ok(s.width<=s.viewport);assert.equal(s.overlap,false);if(name==='desktop')assert.ok(s.height<=768,'armed desktop HUD must fit the viewport');assert.equal(await page.locator('#weaponStatus').isVisible(),true);
    await page.screenshot({path:path.join(__dirname,'..','test-results','weapons-'+name+'.png'),fullPage:true});
  }
});

test('outgoing special shells do not trigger reflexes until a return path threatens the AI',async t=>{
  const page=await pageFor(t,{powerups:true});await weaponFixture(page);
  const state=await page.evaluate(()=>{
    E.x=150;E.y=350;E.a=0;P.x=900;P.y=600;weapons.equip(weaponWorld(),E,'shotgun');fire(E);
    const outgoing=findThreat(E,{enemy:P,bullets,walls,bblk});bullets.forEach(b=>{b.x=300;b.y=350;b.vx=-300;b.vy=0});weaponForecastCache=null;
    const incoming=findThreat(E,{enemy:P,bullets,walls,bblk});return{outgoing:!!outgoing,incoming:!!incoming};
  });assert.deepEqual(state,{outgoing:false,incoming:true});
});

test('AI explicit gatling spins up and learned fire can override a poor special-weapon score',async t=>{
  const page=await pageFor(t,{powerups:true});await weaponFixture(page,{staticAI:false});
  const spin=await page.evaluate(()=>{
    E.x=150;E.y=150;E.a=0;P.x=900;P.y=600;P2.x=900;P2.y=450;weapons.equip(weaponWorld(),E,'gatling');applyTacticalDecision({cmd:'fire'});runFrames(.9);
    return{remaining:E.weapon.ammo,shots:roundExecution.weapons.shots.gatling};
  });assert.ok(spin.remaining<30);assert.ok(spin.shots>0);
  await page.evaluate(async()=>{
    clearInput();E.weapon=null;bullets=[];E.cd=0;E.fireIntentUntil=0;E.a=Math.PI;weapons.equip(weaponWorld(),E,'shotgun');
    await installGunnery({name:'weapon_aware',code:'return {fire:state.self.weapon?.type==="shotgun" && state.self.weapon.ammo===3};'});runGunnery();
  });await page.waitForFunction(()=>gunneryState?.value?.fire===true,null,{polling:20,timeout:4000});
  const shot=await page.evaluate(()=>{const defaultScore=weapons.advice(weaponWorld(),E,enemyTank()).score;return{defaultScore,fired:attemptAIShot('safe',enemyTank()),remaining:E.weapon.ammo}});
  assert.ok(shot.defaultScore<0);assert.equal(shot.fired,true);assert.equal(shot.remaining,2);
  await reloadArena(page);assert.equal(await page.evaluate(()=>evolution.activeGunnery),'weapon_aware');
});

test('unified settings collect all controls, trap focus, freeze combat and restore focus on cancel',async t=>{
  const page=await pageFor(t);await coopFixture(page);
  await page.evaluate(()=>{keys.fwd=true;keys2.cw=true;heldFire.P.add('j');fire(P);advance(.01)});
  await page.locator('#cfgBtn').click();
  assert.equal(await page.locator('#sidebar select').count(),0);assert.equal(await page.locator('.settingsNav button').count(),4);
  for(const id of ['modeSelect','difficultySelect','cfgPowerups','cfgKey','fxQuality','memExport','keyHelp','programView','dodgeOnlyBtn'])assert.equal(await page.locator('#dlg #'+id).count(),1);
  const pausedState=await page.evaluate(()=>{const before=JSON.stringify({P,P2,E,bullets,time:gT}),visual=fx.stats().time;advance(.5);return{same:before===JSON.stringify({P,P2,E,bullets,time:gT}),visualFrozen:fx.stats().time===visual,canRequest:canControl(),held:heldFire.P.size,input:keys.fwd||keys2.cw,inert:document.querySelector('main').inert}});
  assert.deepEqual(pausedState,{same:true,visualFrozen:true,canRequest:false,held:0,input:false,inert:true});
  await page.locator('.settingsNav button').first().focus();await page.keyboard.press('Shift+Tab');assert.equal(await page.evaluate(()=>document.activeElement.id),'save');
  await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.dataset.section),'visualSettings');
  await page.keyboard.press('Escape');assert.equal(await page.locator('#dlg').isVisible(),false);assert.equal(await page.evaluate(()=>document.activeElement.id),'cfgBtn');assert.equal(await page.evaluate(()=>document.querySelector('main').inert),false);
});

test('quality changes preview actual canvas output; cancel restores graphics, mode, difficulty and API',async t=>{
  const page=await pageFor(t);await fixture(page);await page.locator('#cfgBtn').click();
  const before=await page.evaluate(()=>({graphics:visualPrefs,mode:gameMode,level:difficultyId,key:cfg.key,round:roundId}));
  await page.locator('#fxQuality').selectOption('off');const off=await page.locator('#fxPreview').evaluate(c=>c.toDataURL());
  await page.locator('#fxQuality').selectOption('ultra');const ultra=await page.locator('#fxPreview').evaluate(c=>c.toDataURL());assert.notEqual(off,ultra);
  await page.locator('#fxIntensity').fill('40');assert.equal(await page.locator('#fxIntensityValue').textContent(),'40%');
  await page.locator('#modeSelect').selectOption('coop');await page.locator('#difficultySelect').selectOption('easy');await page.locator('#cfgKey').fill('unsaved');
  await page.locator('#cfgClose').click();const after=await page.evaluate(()=>({graphics:fx.config,mode:gameMode,level:difficultyId,key:cfg.key,round:roundId}));assert.deepEqual(after,before);
});

test('saved visual and game preferences persist together without resetting learning or resuming a paused match',async t=>{
  const page=await pageFor(t,{difficulty:null});await fixture(page);await page.evaluate(()=>{lessons=['retain experience'];evolution.completed=12;saveEvolution();togglePause()});
  await page.locator('#cfgBtn').click();await page.locator('#fxQuality').selectOption('low');await page.locator('#fxIntensity').fill('50');await page.locator('#fxGlow').uncheck();await page.locator('#fxShake').check();
  await page.locator('#modeSelect').selectOption('coop');await page.locator('#difficultySelect').selectOption('easy');await page.locator('#save').click();
  const state=await page.evaluate(()=>({quality:fx.config.quality,intensity:fx.config.intensity,glow:fx.config.glow,shake:fx.config.shake,mode:gameMode,level:difficultyId,paused,completed:evolution.completed,lesson:lessons[0],stored:JSON.parse(localStorage.getItem('aitank_visuals'))}));
  assert.equal(state.quality,'low');assert.equal(state.intensity,.5);assert.equal(state.glow,false);assert.equal(state.shake,true);assert.equal(state.mode,'coop');assert.equal(state.level,'easy');assert.equal(state.paused,true);assert.equal(state.completed,12);assert.equal(state.lesson,'retain experience');assert.equal(state.stored.quality,'low');
  await reloadArena(page);assert.deepEqual(await page.evaluate(()=>({quality:fx.config.quality,intensity:fx.config.intensity,mode:gameMode,level:difficultyId,lesson:lessons[0],completed:evolution.completed})),{quality:'low',intensity:.5,mode:'coop',level:'easy',lesson:'retain experience',completed:12});
});

test('reduced-motion preference is respected and corrupt graphics storage cannot break startup',async t=>{
  const page=await pageFor(t,{reducedMotion:'reduce'});assert.equal(await page.evaluate(()=>fx.config.reducedMotion),true);
  await page.evaluate(()=>localStorage.setItem('aitank_visuals','{broken'));await reloadArena(page);assert.equal(await page.evaluate(()=>fx.config.quality),'high');assert.equal(await page.evaluate(()=>fx.config.reducedMotion),true);
  await page.evaluate(()=>localStorage.setItem('aitank_visuals',JSON.stringify({quality:'__proto__',intensity:200,glow:'false',shake:true,reducedMotion:true})));await reloadArena(page);
  assert.deepEqual(await page.evaluate(()=>{fx.explosion(200,200);return{quality:fx.config.quality,intensity:fx.config.intensity,glow:fx.config.glow,offset:fx.offset()}}),{quality:'high',intensity:1,glow:true,offset:{x:0,y:0}});
});

test('visual presets leave seeded combat, ammunition and game randomness identical',async t=>{
  const page=await pageFor(t,{powerups:true});await weaponFixture(page);
  const states=await page.evaluate(()=>{
    const original=Math.random,results=[];
    try{for(const quality of ['off','low','high','ultra']){
      let seed=123456,calls=0;Math.random=()=>{calls++;seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296};
      gT=0;newRound();walls=[];weapons.nextSpawn=999;bulletSequence=0;P.x=150;P.y=150;P.a=0;P2.x=150;P2.y=550;P2.a=0;E.x=900;E.y=350;E.a=Math.PI;
      fx.configure({...AITankFX.defaults,quality,shake:true});weapons.equip(weaponWorld(),P,'shotgun');weapons.equip(weaponWorld(),E,'shield');weapons.equip(weaponWorld(),P2,'homing');fire(P);fire(P2);
      for(let i=0;i<90;i++){advance(.01);render()}
      results.push({tanks:allTanks().map(t=>({id:t.id,x:t.x,y:t.y,a:t.a,alive:t.alive,cd:t.cd,live:t.live,weapon:t.weapon,shield:t.shieldUntil})),bullets:JSON.parse(JSON.stringify(bullets)),time:gT,calls});
    }}finally{Math.random=original}return results;
  });for(const state of states.slice(1))assert.deepEqual(state,states[0]);
});

test('actual fire, wall reflection and explosion emit bounded effects that pause and reset with the round',async t=>{
  const page=await pageFor(t,{powerups:true});await weaponFixture(page);
  const state=await page.evaluate(()=>{
    fx.configure({quality:'high'});P.x=1000;P.y=150;P.a=0;fire(P);const fired=fx.stats().particles;const failed=fire(P),unchanged=fx.stats().particles===fired;
    runFrames(.6);const reflected=fx.stats().particles>0&&bullets[0].vx<0;fx.explosion(600,400);const rings=fx.stats().rings;togglePause();const before=JSON.stringify(fx.stats());advance(.5);const frozen=before===JSON.stringify(fx.stats());togglePause();advance(.05);const progressed=fx.stats().time>JSON.parse(before).time;newRound();
    return{fired,failed,unchanged,reflected,rings,frozen,progressed,after:fx.stats()};
  });assert.ok(state.fired>0);assert.equal(state.failed,false);assert.equal(state.unchanged,true);assert.equal(state.reflected,true);assert.ok(state.rings>0);assert.equal(state.frozen,true);assert.equal(state.progressed,true);assert.equal(state.after.particles+state.after.rings+state.after.trails,0);
});

test('effects off retains projectile cores, laser beams, shields and charge indicators',async t=>{
  const page=await pageFor(t,{powerups:true});await weaponFixture(page);
  const state=await page.evaluate(()=>{
    fx.configure({quality:'off',intensity:0});weapons.equip(weaponWorld(),P,'shield');fire(P);P.cd=0;weapons.equip(weaponWorld(),P2,'deathray');fire(P2);fire(P);advance(.01);render();
    const b=bullets[0],pixel=[...ctx.getImageData(Math.round(b.x),Math.round(b.y+20),1,1).data];
    return{pixel,beamRule:weapons.charges.length,shield:P.shieldUntil>gT,effects:fx.stats().particles+fx.stats().rings};
  });assert.ok(state.pixel[0]>150&&state.pixel[1]>150&&state.pixel[2]>150);assert.equal(state.beamRule,1);assert.equal(state.shield,true);assert.equal(state.effects,0);
});

test('visual settings and representative effects fit desktop and touch layouts',async t=>{
  fs.mkdirSync(path.join(__dirname,'..','test-results'),{recursive:true});
  for(const [name,options] of [['desktop',{viewport:{width:1366,height:768}}],['mobile',{viewport:{width:390,height:844},isMobile:true,hasTouch:true}]]){
    const page=await pageFor(t,{...options,powerups:true});await weaponFixture(page);
    await page.evaluate(()=>{
      newRound();walls=[{x:0,y:0,w:FW,h:14},{x:0,y:FH-14,w:FW,h:14},{x:0,y:0,w:14,h:FH},{x:FW-14,y:0,w:14,h:FH},{x:300,y:100,w:14,h:200},{x:300,y:300,w:200,h:14},{x:600,y:350,w:14,h:200}];
      P.x=190;P.y=250;P.a=-.6;P2.x=450;P2.y=470;P2.a=-.4;E.x=FW-180;E.y=220;E.a=2.5;E.hold=true;fx.configure({quality:'high'});
      weapons.equip(weaponWorld(),E,'shield');fire(E);weapons.equip(weaponWorld(),P,'homing');fire(P);fire(P2);runFrames(.25);fx.explosion(550,220);fx.update(.1,{tanks:allTanks(),bullets});fx.ricochet(610,430,'laser','E');
      weapons.spawnPickup(weaponWorld(),'deathray',450,150);weapons.spawnPickup(weaponWorld(),'shotgun',180,500);
      brainEl.textContent='机动交战';statusEl.textContent='本地程序运行中 · 赛后复盘学习';hud();render();
    });
    const layout=await page.evaluate(()=>({width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight,viewport:innerWidth,inside:document.querySelectorAll('#stage select,#stage button').length}));assert.ok(layout.width<=layout.viewport);assert.equal(layout.inside,0);if(name==='desktop')assert.ok(layout.height<=768);
    await page.screenshot({path:path.join(__dirname,'..','test-results','effects-'+name+'.png'),fullPage:true});
    await page.locator('#cfgBtn').click();await page.locator('[data-section="visualSettings"]').click();
    const modal=await page.locator('.box').boundingBox();assert.ok(modal.y>=0&&modal.y+modal.height<=(name==='desktop'?768:844));
    await page.screenshot({path:path.join(__dirname,'..','test-results','effects-settings-'+name+'.png'),fullPage:true});
    await page.locator('[data-section="learningSettings"]').click();
    await page.waitForFunction(()=>document.querySelector('[data-section="learningSettings"]').getAttribute('aria-current')==='true',null,{polling:20,timeout:2000});
    assert.ok(await page.evaluate(()=>Math.abs(document.getElementById('learningSettings').getBoundingClientRect().top-document.getElementById('settingsBody').getBoundingClientRect().top)<3));
    await page.screenshot({path:path.join(__dirname,'..','test-results','settings-learning-'+name+'.png'),fullPage:true});
  }
});

test('original skill metadata reaches UI, local programs and live orders while preserving friendly fire and slots',async t=>{
  const page=await pageFor(t,{powerups:true});await weaponFixture(page,{staticAI:false});
  const state=await page.evaluate(()=>{
    AITankWeapons.register({id:'browser_prism',name:'原创棱光',icon:'PR',color:'#99e9d5',ammo:2,cooldown:.3,spawn:false,projectile:{speed:260,radius:4,life:2},aiDescription:'独立弹量，存在友伤'});
    AITankWeapons.register({id:'unused_prism',name:'未上场技能',icon:'UP',color:'#99e9d5',ammo:1,spawn:false,projectile:{speed:200,radius:4,life:2}});
    E.x=150;E.y=350;E.a=0;E.cd=100;P.x=850;P.y=550;P2.x=950;P2.y=550;
    const box=weapons.spawnPickup(weaponWorld(),'browser_prism',E.x+120,E.y);
    const order=applyTacticalDecision({cmd:'pickup',id:box.id});
    runFrames(1.5);
    return{order,goal:E.goal,weapon:E.weapon?.type};
  });
  assert.equal(state.order,true);
  assert.equal(state.weapon,'browser_prism');
  const combat=await page.evaluate(()=>{
    aiLocal=()=>{};E.weapon=null;weapons.pickups=[];weapons.spawnPickup(weaponWorld(),'browser_prism',P.x,P.y);advance(.01);
    P.live=5;P.a=0;P2.x=P.x+150;P2.y=P.y;const fired=fire(P),summary=tacticalSummary(),snapshot=programSnapshot();runFrames(.6);hud();
    const result={fired,normal:P.live,ammo:P.weapon?.ammo,seen:summary.enemies.find(t=>t.id==='P').weapon.type,definitions:snapshot.weapons.definitions.map(d=>d.id),friendly:!P2.alive,phase,recorded:roundExecution.weapons.pickups.some(p=>p.weapon==='browser_prism')};
    showSettings();return result;
  });
  assert.deepEqual(combat,{fired:true,normal:5,ammo:1,seen:'browser_prism',definitions:['browser_prism'],friendly:true,phase:'playing',recorded:true});
  assert.ok((await page.locator('#weaponHelp').textContent()).includes('原创棱光'));
  assert.equal(await page.evaluate(()=>{
    newRound();
    const text=reviewInput([{round:1,mode:'coop',difficulty:'expert',report:'历史技能使用',execution:{weapons:{pickups:[],shots:{browser_prism:1}}}}],DIFFICULTIES.expert);
    return text.includes('原创棱光')&&!text.includes('未上场技能');
  }),true,'batched review describes a skill used in an earlier round');
});

test('original buff hooks freeze with pause, expose state and clean up on a new round',async t=>{
  const page=await pageFor(t,{powerups:true});await weaponFixture(page);
  const state=await page.evaluate(()=>{
    window.buffCleaned=0;
    AITankWeapons.register({id:'browser_aura',name:'原创光环',icon:'AU',color:'#aabbff',ammo:0,slot:'buff',duration:3,spawn:false,
      equip:({state})=>{state.elapsed=0},update:({state,dt})=>{state.elapsed+=dt},cleanup:()=>buffCleaned++,
      forecast:({world,step})=>{world.tanks[0].x=-100;return[{time:world.time+step,points:[{x:450,y:300,radius:30}]}]}});
    weapons.equip(weaponWorld(),E,'browser_aura');fire(E);E.cd=0;weapons.equip(weaponWorld(),E,'shotgun');advance(.1);hud();
    const originalX=P.x,before=E.skills.browser_aura.state.elapsed,forecast=weapons.forecast(weaponWorld(),.1,.05),snapshot=programSnapshot(),summary=tacticalSummary();
    togglePause();advance(.5);const frozen=before===E.skills.browser_aura.state.elapsed;togglePause();advance(.1);
    const pure=P.x===originalX,progressed=E.skills.browser_aura.state.elapsed>before,visible=document.getElementById('weaponStatus').textContent.includes('原创光环');newRound();
    return{frozen,progressed,visible,elapsed:snapshot.self.skills.browser_aura.state.elapsed,seen:!!summary.self.skills.browser_aura,hazard:forecast.frames[0].points.some(p=>p.radius===30),pure,cleaned:buffCleaned,cleared:Object.keys(E.skills).length===0};
  });
  assert.equal(state.frozen,true);assert.equal(state.progressed,true);assert.equal(state.visible,true);assert.ok(state.elapsed>0);assert.equal(state.seen,true);assert.equal(state.hazard,true);assert.equal(state.pure,true);assert.equal(state.cleaned,1);assert.equal(state.cleared,true);
});

test('custom drawing keeps canvas and physics intact and default cores survive effects off',async t=>{
  const page=await pageFor(t,{powerups:true});await weaponFixture(page);
  const state=await page.evaluate(()=>{
    window.renderHooks=0;
    AITankWeapons.register({id:'paint_prism',name:'绘制测试',icon:'PP',color:'#99e9d5',ammo:2,spawn:false,projectile:{speed:260,radius:4,life:2},
      drawProjectile:({ctx,projectile})=>{renderHooks++;projectile.x=-100;ctx.globalAlpha=0;ctx.translate(99,99);return false},
      drawWorld:({ctx,world})=>{world.tanks[0].x=-100;ctx.globalAlpha=.1;ctx.translate(99,99)}});
    fx.configure({quality:'off'});weapons.equip(weaponWorld(),P,'paint_prism');fire(P);const before=JSON.stringify({bullets,tanks:allTanks()});render();
    const b=bullets[0],pixel=[...ctx.getImageData(Math.round(b.x),Math.round(b.y+20),1,1).data];
    return{pure:before===JSON.stringify({bullets,tanks:allTanks()}),hooks:renderHooks,alpha:ctx.globalAlpha,pixel,effects:fx.stats().particles+fx.stats().rings};
  });
  assert.equal(state.pure,true);assert.ok(state.hooks>0);assert.equal(state.alpha,1);assert.ok(state.pixel[0]>100&&state.pixel[1]>100);assert.equal(state.effects,0);
});

test('manual API harness isolates saved learning and pauses after its three-request budget',async t=>{
  const page=await pageFor(t);let count=0;
  await page.route('**/mock/messages',async route=>{
    const body=route.request().postDataJSON();count++;
    const value=body.stream?(count===1?'{"cmd":"fire"}':'{"cmd":"combat","mode":"auto"}\n{"cmd":"gunnery","mode":"auto"}\n{"cmd":"pickup","id":1}'):JSON.stringify({memory_add:['识别独立技能弹量'],set_gunnery:{name:'original_skill_fire',code:'return {fire:!!state.self.weapon && state.self.weapon.ammo>0};'}});
    await route.fulfill({status:200,headers:{'Access-Control-Allow-Origin':'*','Content-Type':body.stream?'text/event-stream':'application/json'},body:body.stream?'data: '+JSON.stringify({type:'content_block_delta',delta:{type:'text_delta',text:value}})+'\n\ndata: [DONE]\n\n':JSON.stringify({content:[{type:'text',text:value}]})});
  });
  const saved=JSON.stringify({lessons:['keep personal learning'],cfg:{key:'test-key',endpoint:origin+'/mock/messages',model:'test-model',format:'anthropic',remember:true}});
  await page.evaluate(value=>{localStorage.setItem('aitank_lessons',value);localStorage.setItem('aitank_review_queue','[]')},saved);
  await page.goto(origin+'/tests/live-api.html');
  await page.waitForFunction(()=>document.getElementById('game').dataset.ready==='true',null,{polling:20});
  await page.locator('#start').click();
  await page.waitForFunction(()=>document.getElementById('status').textContent==='测试结束 · AI 已暂停',null,{polling:20,timeout:20000});
  const result=JSON.parse(await page.locator('#result').innerText());
  assert.equal(count,3);assert.equal(result.paused,true);assert.equal(result.backgroundRequestsAllowed,false);assert.equal(result.error,undefined);assert.ok(result.checks.every(c=>c.ok),JSON.stringify(result.checks));
  assert.equal(await page.evaluate(()=>localStorage.getItem('aitank_lessons')),saved);
  assert.equal(await page.evaluate(()=>localStorage.getItem('aitank_gunneries')),null);
  await page.waitForTimeout(250);assert.equal(count,3);assert.equal(await page.locator('#start').isDisabled(),true);
});

test('pickup advice cannot move the tank or collect a crate until the commander chooses it',async t=>{
 const page=await pageFor(t,{powerups:true});await weaponFixture(page,{staticAI:false});
 const state=await page.evaluate(()=>{
  E.x=200;E.y=350;E.a=-Math.PI/2;E.live=5;E.hold=false;E.curAlgo=null;P.x=700;P.y=550;P2.alive=false;
  const box=weapons.spawnPickup(weaponWorld(),'homing',200,230),before={x:E.x,y:E.y,a:E.a},advice=tacticalSummary().advice;
  const snapshot=programSnapshot();runFrames(.8);const waiting={x:E.x,y:E.y,a:E.a,weapon:E.weapon};
  const accepted=applyTacticalDecision({cmd:'pickup',id:box.id});runFrames(1.2);
  return{before,waiting,advice,snapshotAdvice:snapshot.advice,accepted,picked:E.weapon?.type,slots:E.live,decisions:roundExecution.tactics.decisions};
 });assert.deepEqual(state.waiting,{...state.before,weapon:null});assert.equal(state.advice.advisoryOnly,true);assert.equal(state.snapshotAdvice.advisoryOnly,true);assert.ok(state.advice.pickups[0].score>.3);
 assert.equal(state.accepted,true);assert.equal(state.picked,'homing');assert.equal(state.slots,5);assert.equal(state.decisions.at(-1).owner,'commander');
});

test('all built-in skill speeds, charge and steering rules reach AI, and active shields expire visually and physically',async t=>{
 const page=await pageFor(t,{powerups:true});await weaponFixture(page);
 const state=await page.evaluate(()=>{
  const definitions=weapons.definitions(weaponWorld(),Object.keys(AITankWeapons.catalog));
  weapons.equip(weaponWorld(),P,'shield');const pending={active:weapons.shieldActive(weaponWorld(),P),type:P.weapon.type,ammo:P.weapon.ammo};
  fire(P);const activated=weapons.shieldActive(weaponWorld(),P);togglePause();advance(7);const frozen=weapons.shieldActive(weaponWorld(),P);togglePause();runFrames(6.1);render();const expired=cv.toDataURL();
  P.shieldUntil=0;render();const clean=cv.toDataURL();
  return{definitions,pending,activated,frozen,expiredClear:expired===clean,shieldUntil:P.shieldUntil,events:roundExecution.weapons.events.filter(e=>['activate','deactivate'].includes(e.type))};
 });assert.deepEqual(state.pending,{active:false,type:'shield',ammo:1});assert.equal(state.activated,true);assert.equal(state.frozen,true);assert.equal(state.expiredClear,true);assert.equal(state.shieldUntil,0);assert.equal(state.events.length,2);
 const by=Object.fromEntries(state.definitions.map(d=>[d.id,d]));assert.equal(by.laser.projectile.speed,1700);assert.equal(by.shotgun.projectile.speed,300);assert.equal(by.homing.seekDelay,2);assert.equal(by.deathray.charge,.6);assert.equal(by.remote.turnRate,2.5);assert.equal(by.shield.activation,'fire');
});

test('empty static tactics are not replaced by retreat advice, and explicit navigation stays authoritative',async t=>{
 const page=await pageFor(t,{powerups:true});await weaponFixture(page,{staticAI:false});
 const state=await page.evaluate(()=>{
  E.x=300;E.y=350;E.a=0;P.x=550;P.y=350;P2.alive=false;E.live=5;E.hold=false;E.curAlgo='ricochet_fire';
  const before={x:E.x,y:E.y},advice=tacticalSummary().advice;runFrames(.8);const after={x:E.x,y:E.y};
  applyCmd({cmd:'move_to',x:500,y:500});const old=E.goal;aiLocal(.01);return{before,after,advice,goal:old===E.goal,cur:E.curAlgo,slots:E.live};
 });assert.deepEqual(state.after,state.before);assert.ok(state.advice.reposition.score>.22);assert.equal(state.goal,true);assert.equal(state.cur,'navigate_to');assert.equal(state.slots,5);
});

test('planned pressure fire can close an escape route without requiring a hit at the current opponent centre',async t=>{
 const page=await pageFor(t);await fixture(page);
 const state=await page.evaluate(()=>{
  E.x=200;E.y=350;E.a=0;P.x=600;P.y=300;P.a=Math.PI;E.live=2;E.gunneryMode='pressure';
  bullets=[{id:1,own:'E',x:400,y:300,vx:128,vy:0,life:4},{id:2,own:'E',x:550,y:150,vx:0,vy:128,life:4}];weaponRevision++;
  const plan=firePlanning();E.a=plan.angle;weaponCache=null;const physical=willHit(E,P,E.a),fired=attemptAIShot('predict',P);
  return{plan,physical,fired,slots:E.live,shot:roundExecution.ammunition.shots.at(-1)};
 });assert.equal(state.physical.hit,false);assert.equal(state.plan.role,'deny_escape');assert.ok(state.plan.combinedCoverage>state.plan.existingCoverage);assert.equal(state.fired,true,JSON.stringify(state));assert.equal(state.slots,3);assert.ok(state.shot.planning.marginalCoverage>0);
});

test('a ninth validated reflex can be learned without deleting existing programs or accepting invalid physics',async t=>{
 const page=await pageFor(t);await fixture(page);
 const state=await page.evaluate(async()=>{
  for(let i=0;i<8;i++)REFLEXES['old_reflex_'+i]={name:'old_reflex_'+i,code:'return {move:0,turn:state.self.a};'};
  const accepted=await installReflex({name:'new_reflex',code:AITankDodge.source()});
  return{accepted,count:Object.keys(REFLEXES).length,active:evolution.activeReflex,old:!!REFLEXES.old_reflex_0};
 });assert.equal(state.accepted,true);assert.equal(state.count,9);assert.equal(state.old,true);assert.equal(state.active,'new_reflex');await reloadArena(page);assert.equal(await page.evaluate(()=>Object.keys(REFLEXES).length),9);assert.equal(await page.evaluate(()=>evolution.activeReflex),'new_reflex');
});

test('continuous combat against a complete scripted opponent exercises every skill without API or physics shortcuts',async t=>{
 const page=await pageFor(t,{powerups:true});await weaponFixture(page,{staticAI:false});
 await page.addScriptTag({path:path.join(__dirname,'scripted-opponent.js')});
 const results=await page.evaluate(()=>{
  const rows=[];streamOn=false;testMode=false;doReflect=()=>{reviewPending=false;return Promise.resolve()};window.fetch=()=>{throw new Error('scripted match must use no API')};
  for(const layout of ['open','cover'])for(const type of Object.keys(AITankWeapons.catalog)){
   let seed=type.split('').reduce((n,c)=>n+c.charCodeAt(0),layout==='cover'?200:100);Math.random=()=>((seed=(seed*1664525+1013904223)>>>0)/4294967296);
   newRound();walls=layout==='cover'?[{x:493,y:0,w:14,h:300},{x:493,y:400,w:14,h:300}]:[];vWalls=Array.from({length:COLS+1},()=>Array(ROWS).fill(false));hWalls=Array.from({length:COLS},()=>Array(ROWS+1).fill(false));if(layout==='cover')for(let r=0;r<ROWS;r++)vWalls[5][r]=r!==3;weapons.nextSpawn=999;P.x=350;P.y=350;P.a=0;E.x=650;E.y=350;E.a=Math.PI;P2.alive=false;E.curAlgo='chase_and_fire';E.hold=false;E.cd=P.cd=0;
   weapons.equip(weaponWorld(),P,type);weapons.spawnPickup(weaponWorld(),'shield',E.x,E.y-90);
   const start=performance.now();let steps=0;
   for(;steps<500&&E.alive&&P.alive;steps++){scriptedOpponent(.02);advance(.02)}
   rows.push({type,layout,seconds:steps*.02,aiAlive:E.alive,opponentAlive:P.alive,shots:roundExecution.weapons?.shots||{},activations:roundExecution.tactics?.activations||0,reflex:roundExecution.reflexSeconds,reversals:roundExecution.reflexReversals,stalled:roundExecution.reflexStalledSeconds,cpuMs:performance.now()-start});
  }paused=true;return rows;
 });
 fs.mkdirSync(path.join(__dirname,'..','test-results'),{recursive:true});fs.writeFileSync(path.join(__dirname,'..','test-results','scripted-opponent-results.json'),JSON.stringify(results,null,2));
 assert.equal(results.length,20);assert.ok(results.every(r=>r.seconds>0));assert.ok(results.reduce((n,r)=>n+r.reflex,0)>0);assert.ok(results.reduce((n,r)=>n+Object.values(r.shots).reduce((a,b)=>a+b,0)+r.activations,0)>5);
 for(const row of results)assert.ok(row.stalled<row.seconds*.7,JSON.stringify(row));
 await page.evaluate(()=>{testMode=false;paused=true;hud();render()});await page.screenshot({path:path.join(__dirname,'..','test-results','tactical-combat.png'),fullPage:true});
});

test('legacy learned fire refusal is respected and commander can explicitly activate its held shield',async t=>{
 const page=await pageFor(t,{powerups:true});await weaponFixture(page,{staticAI:false});
 await page.evaluate(()=>{
  window.savedOldCode='return {fire:false};';registerCode({name:'legacy_guard',code:savedOldCode});
  E.x=700;E.y=350;E.a=Math.PI;E.live=5;E.curAlgo='legacy_guard';E.hold=false;P.x=100;P.y=350;P.a=0;P2.alive=false;
  weapons.equip(weaponWorld(),E,'shield');aiLocal(.01);
 });
 await page.waitForFunction(()=>programState?.value?.fire===false,null,{polling:20});
 const state=await page.evaluate(()=>{
  runFrames(.2);const held={active:E.shieldUntil>gT,x:E.x,y:E.y,sourceUnchanged:ALGOS.legacy_guard.code===savedOldCode,oldVersion:ALGOS.legacy_guard.weaponInterface};
  applyCmd({cmd:'fire'});aiLocal(.01);return{held,activated:E.shieldUntil>gT};
 });assert.deepEqual(state.held,{active:false,x:700,y:350,sourceUnchanged:true,oldVersion:1});assert.equal(state.activated,true);
 await page.evaluate(async()=>{
  newRound();walls=[];E.x=150;E.y=350;E.a=0;P.x=450;P.y=350;P2.alive=false;E.hold=false;E.curAlgo='chase_and_fire';
  await installGunnery({name:'save_shield',code:'return {fire:false};'});weapons.equip(weaponWorld(),E,'shield');runGunnery();
 });
 await page.waitForFunction(()=>gunneryState?.value?.fire===false,null,{polling:20});
 assert.equal(await page.evaluate(()=>attemptAIShot('weapon',enemyTank())),false);
});

test('PvP starts without an API key and both keyboard players move and fire without running AI',async t=>{
 const page=await pageFor(t,{powerups:true});
 await page.locator('#cfgBtn').click();await page.locator('#modeSelect').selectOption('pvp');
 assert.equal(await page.locator('#difficultySelect').isDisabled(),true);assert.equal(await page.locator('#cfgAiPowerups').isDisabled(),true);
 await page.locator('#save').click();
 const initial=await page.evaluate(()=>{paused=false;walls=[];P.x=150;P.y=250;P.a=0;P2.x=150;P2.y=450;P2.a=0;aiLocal=()=>{throw new Error('PvP ran AI')};window.apiCalls=0;window.fetch=async()=>{apiCalls++;throw new Error('PvP called API')};return{mode:gameMode,key:cfg.key,tanks:allTanks().map(t=>t.id),aiAlive:E.alive,control:!!canControl(),blocked:inputBlocked()}});
 assert.deepEqual(initial,{mode:'pvp',key:'',tanks:['P','P2'],aiAlive:false,control:false,blocked:false});
 await page.keyboard.down('w');await page.keyboard.down('p');await page.evaluate(()=>advance(.05));await page.keyboard.up('w');await page.keyboard.up('p');
 assert.deepEqual(await page.evaluate(()=>({p1:P.x,p2:P2.x,paused})),{p1:155,p2:155,paused:false});
 await page.keyboard.press('Space');await page.keyboard.press('Enter');
 assert.deepEqual(await page.evaluate(()=>({owners:bullets.map(b=>b.own),ammo:[P.live,P2.live],api:apiCalls})),{owners:['P','P2'],ammo:[1,1],api:0});
 assert.equal(await page.locator('#humanLabel').innerText(),'P1');assert.equal(await page.locator('#opponentLabel').innerText(),'P2');assert.equal(await page.locator('#learningHud').isVisible(),false);
 await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>paused),true);
 await reloadArena(page);assert.equal(await page.evaluate(()=>gameMode),'pvp');assert.equal(await page.evaluate(()=>E.alive),false);
});

test('PvP scores ordinary kills and self hits separately from AI learning and restores both players next round',async t=>{
 const page=await pageFor(t,{powerups:true});await fixture(page);
 const result=await page.evaluate(()=>{
  lessons=['preserve learning'];evolution.completed=20;evolution.aiWins=12;P.score=8;E.score=12;saveMem();saveEvolution();
  setGameMode('pvp');walls=[];paused=false;const before=JSON.stringify({evolution,lessons,reviewQueue,round});
  P.x=150;P.y=350;P2.x=450;P2.y=350;P.live=1;weaponWorld().spawn({x:P2.x,y:P2.y,vx:0,vy:0,own:'P',life:1});advance(.01);
  const first={winner:roundResult,phase,scores:{...pvpScores},aiScores:[P.score,E.score],friendly:eliminations[0].friendly};
  advance(2.3);const reset=P.alive&&P2.alive&&!E.alive&&P.live===0&&P2.live===0;
  walls=[];weaponWorld().spawn({x:P.x,y:P.y,vx:0,vy:0,own:'P',life:1});advance(.01);
  return{first,reset,second:roundResult,scores:{...pvpScores},untouched:before===JSON.stringify({evolution,lessons,reviewQueue,round}),api:!!canControl()};
 });
 assert.deepEqual(result.first,{winner:'P',phase:'review',scores:{P:1,P2:0,draws:0},aiScores:[8,12],friendly:false});assert.equal(result.reset,true);assert.equal(result.second,'P2');assert.deepEqual(result.scores,{P:1,P2:1,draws:0});assert.equal(result.untouched,true);assert.equal(result.api,false);
 await reloadArena(page);assert.deepEqual(await page.evaluate(()=>pvpScores),{P:1,P2:1,draws:0});
 await page.evaluate(()=>setGameMode('solo'));assert.deepEqual(await page.evaluate(()=>({p:P.score,ai:E.score,alive:E.alive,completed:evolution.completed})),{p:8,ai:12,alive:true,completed:20});
});

test('simultaneous PvP eliminations draw regardless of projectile order and settle exactly once',async t=>{
 const page=await pageFor(t,{powerups:true});await fixture(page);
 const states=await page.evaluate(()=>{
  setGameMode('pvp');const rows=[];
  for(const reverse of[false,true]){
   newRound();walls=[];paused=false;P.x=200;P.y=300;P2.x=800;P2.y=300;
   const shots=[{x:P.x,y:P.y,vx:0,vy:0,own:'P2',life:1},{x:P2.x,y:P2.y,vx:0,vy:0,own:'P',life:1}];
   for(const shot of reverse?shots.reverse():shots)weaponWorld().spawn(shot);
   advance(.01);roundOver(P,{own:'P2'});rows.push({winner:roundResult,p:P.alive,p2:P2.alive,scores:{...pvpScores},completed:evolution.completed});
  }return rows;
 });assert.deepEqual(states,[{winner:'draw',p:false,p2:false,scores:{P:0,P2:0,draws:1},completed:0},{winner:'draw',p:false,p2:false,scores:{P:0,P2:0,draws:2},completed:0}]);
});

test('AI pickup restriction saves only on confirmation and blocks real collection while both players retain access',async t=>{
 const page=await pageFor(t,{powerups:true});await weaponFixture(page);
 await page.locator('#cfgBtn').click();await page.locator('#cfgAiPowerups').uncheck();await page.locator('#cfgClose').click();assert.equal(await page.evaluate(()=>aiPowerupsEnabled),true);
 await page.locator('#cfgBtn').click();assert.equal(await page.locator('#cfgAiPowerups').isChecked(),true);await page.locator('#cfgAiPowerups').uncheck();await page.locator('#save').click();
 const state=await page.evaluate(()=>{
  weapons.spawnPickup(weaponWorld(),'laser',E.x,E.y);weapons.spawnPickup(weaponWorld(),'shotgun',P.x,P.y);weapons.spawnPickup(weaponWorld(),'shield',P2.x,P2.y);advance(.01);
  const crate=weapons.pickups.find(p=>p.type==='laser'),accepted=applyTacticalDecision({cmd:'pickup',id:crate.id});
  return{ai:E.weapon,p:P.weapon.type,p2:P2.weapon.type,crates:weapons.pickups.length,direct:weapons.equip(weaponWorld(),E,'homing'),accepted,flag:weapons.snapshot(weaponWorld(),'E').pickupAllowed,prompt:controlPrompt().includes('禁止 AI 拾取'),stored:localStorage.getItem('aitank_ai_powerups'),players:allTanks().length};
 });assert.deepEqual(state,{ai:null,p:'shotgun',p2:'shield',crates:1,direct:false,accepted:false,flag:false,prompt:true,stored:'false',players:3});
 await reloadArena(page);assert.equal(await page.evaluate(()=>aiPowerupsEnabled),false);assert.equal(await page.evaluate(()=>powerupsEnabled),true);
 await page.locator('#cfgBtn').click();await page.locator('#modeSelect').selectOption('pvp');await page.locator('#save').click();
 await page.locator('#cfgBtn').click();await page.locator('#modeSelect').selectOption('coop');await page.locator('#save').click();assert.equal(await page.evaluate(()=>aiPowerupsEnabled),false);
});

test('disabling AI pickup cancels only a pickup goal and preserves existing weapons, projectiles and explicit movement',async t=>{
 const page=await pageFor(t,{powerups:true});await weaponFixture(page);
 const state=await page.evaluate(()=>{
  const box=weapons.spawnPickup(weaponWorld(),'laser',E.x-100,E.y);applyCmd({cmd:'pickup',id:box.id});setAiPowerups(false);const canceled=E.goal===null;
  applyCmd({cmd:'move_to',x:700,y:600});setAiPowerups(true);const heldGoal=E.goal;
  weapons.equip(weaponWorld(),E,'homing');fire(E);E.cd=0;weapons.equip(weaponWorld(),E,'double');const before=E.weapon.ammo,count=bullets.length;
  setAiPowerups(false);const kept=E.weapon.type==='double'&&bullets.length===count&&heldGoal===E.goal;fire(E);
  return{canceled,kept,before,after:E.weapon.ammo,bullets:bullets.length,normal:E.live};
 });assert.deepEqual(state,{canceled:true,kept:true,before:10,after:9,bullets:2,normal:0});
});

test('switching from an in-flight AI review to PvP rejects late writes and keeps pending AI reports',async t=>{
 const page=await pageFor(t);await fixture(page);
 await page.evaluate(()=>{
  window.fetch=()=>new Promise(resolve=>{window.finishOldReview=()=>resolve(new Response(JSON.stringify({content:[{type:'text',text:'{"memory_add":["late"],"set_algo":null}'}]})))});
  roundOver(E,{own:'P'});setGameMode('pvp');
 });
 const state=await page.evaluate(async()=>{finishOldReview();await reflectTask;return{completed:evolution.completed,reviews:evolution.reviews,queue:reviewQueue.length,late:lessons.includes('late'),mode:gameMode,p2:P2.alive,ai:E.alive}});
 assert.deepEqual(state,{completed:1,reviews:0,queue:1,late:false,mode:'pvp',p2:true,ai:false});
});

test('PvP and pickup settings fit desktop and narrow layouts with two clear player labels',async t=>{
 fs.mkdirSync(path.join(__dirname,'..','test-results'),{recursive:true});
 for(const [name,options]of[['desktop',{viewport:{width:1366,height:768}}],['mobile',{viewport:{width:390,height:844},isMobile:true,hasTouch:true}]]){
  const page=await pageFor(t,{...options,powerups:true});await page.evaluate(()=>{setGameMode('pvp');paused=true;hud();render()});
  assert.equal(await page.locator('#opponentLabel').innerText(),'P2');assert.equal(await page.locator('#humanStatus').isVisible(),true);
  const layout=await page.evaluate(()=>({width:document.documentElement.scrollWidth,viewport:innerWidth,height:document.documentElement.scrollHeight}));assert.ok(layout.width<=layout.viewport);if(name==='desktop')assert.ok(layout.height<=768);
  await page.screenshot({path:path.join(__dirname,'..','test-results','pvp-'+name+'.png'),fullPage:true});
  await page.locator('#cfgBtn').click();await page.locator('[data-section="gameSettings"]').click();
  assert.equal(await page.locator('#cfgAiPowerups').isDisabled(),true);await page.screenshot({path:path.join(__dirname,'..','test-results','pvp-settings-'+name+'.png'),fullPage:true});
 }
});

test('AI only collects its selected crate, ignores incidental crates and cancels pickup on a new order',async t=>{
 const page=await pageFor(t,{powerups:true});await weaponFixture(page,{staticAI:false});
 const state=await page.evaluate(()=>{
  E.x=200;E.y=200;E.a=0;E.hold=false;P.x=850;P.y=600;P2.alive=false;
  const incidental=weapons.spawnPickup(weaponWorld(),'laser',250,200),chosen=weapons.spawnPickup(weaponWorld(),'shotgun',400,200);
  applyCmd({cmd:'pickup',id:chosen.id});applyCmd({cmd:'move_to',x:NaN,y:200});const invalidKept=E.pickupOrder===chosen.id;runFrames(1.8);
  const picked={type:E.weapon?.type,otherStillThere:weapons.pickups.some(p=>p.id===incidental.id)};
  E.weapon=null;E.cd=0;const canceled=weapons.spawnPickup(weaponWorld(),'shield',E.x,E.y);
  applyCmd({cmd:'pickup',id:canceled.id});applyCmd({cmd:'stop'});runFrames(.1);
  return{picked,invalidKept,canceled:E.weapon===null&&weapons.pickups.some(p=>p.id===canceled.id),order:E.pickupOrder,held:E.hold};
 });assert.deepEqual(state,{picked:{type:'shotgun',otherStillThere:true},invalidKept:true,canceled:true,order:null,held:true});
});

test('a learned policy can choose a lower-ranked crate and execute it locally without any model request',async t=>{
 const page=await pageFor(t,{powerups:true});await weaponFixture(page,{staticAI:false});
 await page.evaluate(async()=>{
  E.x=200;E.y=350;E.a=Math.PI/2;E.hold=false;P.x=850;P.y=600;P2.alive=false;
  weapons.spawnPickup(weaponWorld(),'shield',200,310);weapons.spawnPickup(weaponWorld(),'homing',200,500);
  window.adviceFirst=tacticalSummary().advice.pickups[0].type;window.modelCalls=0;window.fetch=()=>{modelCalls++;throw new Error('local learned policy must not request model')};
  await installCode({name:'select_homing',code:"const p=state.weapons.pickups.find(p=>p.type==='homing');return p?{pickupId:p.id,fire:false}:{move:0,fire:false};"});
  applyCmd({cmd:'algo',name:'select_homing'});aiLocal(.01);
 });
 await page.waitForFunction(()=>programState?.value?.pickupId!==undefined,null,{polling:20,timeout:3000});
 for(let i=0;i<16;i++){await page.evaluate(()=>runFrames(.12));await page.waitForTimeout(20)}
 const state=await page.evaluate(()=>({first:adviceFirst,type:E.weapon?.type,other:weapons.pickups.map(p=>p.type),cur:E.curAlgo,calls:modelCalls,shots:bullets.length,owners:roundExecution.tactics.decisions.map(d=>d.owner)}));
 assert.equal(state.first,'shield');assert.equal(state.type,'homing');assert.deepEqual(state.other,['shield']);assert.equal(state.cur,'select_homing');assert.equal(state.calls,0);assert.equal(state.shots,0);assert.ok(state.owners.includes('learned:select_homing'));
 await reloadArena(page);assert.equal(await page.evaluate(()=>evolution.activePolicy),'select_homing');assert.match(await page.evaluate(()=>ALGOS.select_homing.code),/pickupId/);
});

test('learned policy can abandon a crate, change its movement goal and choose to wait despite positive advice',async t=>{
 const page=await pageFor(t,{powerups:true});await weaponFixture(page,{staticAI:false});
 await page.evaluate(async()=>{
  E.x=200;E.y=350;E.a=0;E.hold=false;P.x=850;P.y=600;P2.alive=false;
  weapons.spawnPickup(weaponWorld(),'laser',400,350);
  await installCode({name:'reconsider',code:"if(state.time<.35)return {pickupId:state.weapons.pickups[0].id,fire:false};if(state.time<.8)return {moveTo:{x:200,y:550},fire:false};return {move:0,fire:false};"});
  applyCmd({cmd:'algo',name:'reconsider'});aiLocal(.01);
 });
 await page.waitForFunction(()=>programState?.value?.pickupId!==undefined,null,{polling:20,timeout:3000});
 for(let i=0;i<11;i++){await page.evaluate(()=>runFrames(.12));await page.waitForTimeout(20)}
 const state=await page.evaluate(()=>({weapon:E.weapon,goal:E.goal,authorized:E.authorizedPickup,move:localControl.result.move,cur:E.curAlgo,advice:tacticalSummary().advice.pickups[0].score,choices:roundExecution.tactics.decisions.map(d=>d.mode)}));
 assert.equal(state.weapon,null);assert.equal(state.goal,null);assert.equal(state.authorized,null);assert.equal(state.move,0);assert.equal(state.cur,'reconsider');assert.ok(state.advice>0);assert.deepEqual(state.choices,['pickup','move_to']);
});

test('delegated collection waits when boxes disappear and a new commander order overrides learned goals',async t=>{
 const page=await pageFor(t,{powerups:true});await weaponFixture(page,{staticAI:false});
 const result=await page.evaluate(()=>{
  E.x=200;E.y=350;E.a=0;E.hold=false;P.x=850;P.y=600;P2.alive=false;
  const box=weapons.spawnPickup(weaponWorld(),'laser',350,350);applyCmd({cmd:'algo',name:'collect_powerup'});aiLocal(.01);
  const delegated=E.authorizedPickup===box.id;weapons.pickups=[];const old={x:E.x,y:E.y};runFrames(.2);const waiting=E.x===old.x&&E.y===old.y&&E.curAlgo==='collect_powerup';
  registerCode({name:'old_goal',code:'return {moveTo:{x:500,y:500}};'});E.curAlgo='old_goal';programState={name:'old_goal',value:{moveTo:{x:500,y:500},time:gT,weaponType:null,projectileId:null,targetId:enemyTank().id},busy:true,runner:{stop(){}}};
  aiLocal(.01);applyCmd({cmd:'move_to',x:200,y:550});runFrames(.1);
  return{delegated,waiting,cur:E.curAlgo,goal:E.goal,order:E.pickupOrder};
 });assert.equal(result.delegated,true);assert.equal(result.waiting,true);assert.equal(result.cur,'navigate_to');assert.equal(result.goal.x,200);assert.equal(result.goal.y,550);assert.equal(result.order,null);
});

test('predictors, reflexes and gunnery cannot smuggle strategic objectives into their outputs',async t=>{
 const page=await pageFor(t);await fixture(page);
 const rejected=await page.evaluate(async()=>{
  const rows=[];
  for(const [install,name,code] of [[installPredictor,'not_nav',"return {prediction:{x:200,y:300},moveTo:{x:300,y:300}};"],[installGunnery,'not_pick',"return {fire:false,pickupId:1};"],[installReflex,'not_collect',"return {move:1,turn:state.self.a,pickupId:1};"]]){
   try{await install({name,code});rows.push(false)}catch{rows.push(true)}
  }return rows;
 });assert.deepEqual(rejected,[true,true,true]);
});

test('emergency evasion temporarily controls motion and then resumes the learned objective',async t=>{
 const page=await pageFor(t,{powerups:true});await weaponFixture(page,{staticAI:false});
 await page.evaluate(async()=>{
  E.x=350;E.y=350;E.a=-Math.PI/2;E.hold=false;P.x=850;P.y=600;P2.alive=false;
  await installCode({name:'keep_my_goal',code:'return {moveTo:{x:350,y:150},fire:false};'});applyCmd({cmd:'algo',name:'keep_my_goal'});aiLocal(.01);
 });
 await page.waitForFunction(()=>programState?.value?.moveTo!==undefined,null,{polling:20,timeout:3000});
 const state=await page.evaluate(()=>{
  aiLocal(.01);bullets=[{id:900,own:'P',x:350,y:250,vx:0,vy:128,life:4}];weaponRevision++;aiLocal(.02);
  const during={emergency:E.emergency,goal:{...E.goal},cur:E.curAlgo,controller:E.reflexOwner};
  bullets=[];weaponRevision++;gT+=.2;aiLocal(.01);
  return{during,after:{emergency:E.emergency,goal:{...E.goal},cur:E.curAlgo,angleError:Math.abs(angDiff(localControl.result.turn,Math.atan2(150-E.y,350-E.x)))}};
 });assert.equal(state.during.emergency,true);assert.ok(state.during.controller);assert.equal(state.during.goal.owner,'learned:keep_my_goal');assert.equal(state.after.emergency,false);assert.equal(state.after.cur,'keep_my_goal');assert.equal(state.after.goal.owner,'learned:keep_my_goal');assert.ok(state.after.angleError<.01);
});

test('every remastered sample decodes to a distinct bounded waveform without touching game randomness',async t=>{
 const page=await pageFor(t);await fixture(page);
 const signals=await page.evaluate(async()=>{
  const rows=[];const original=Math.random;Math.random=()=>{throw new Error('audio advanced game RNG')};
  try{
   for(const event of Object.keys(AITankAudio.cues)){
    const weapon=null;
    const context=new OfflineAudioContext(2,44100*3,44100),s=AITankAudio.create({volume:.5},{contextFactory:()=>context,offline:true});await s.unlock();const played=s.play(event,{weapon}),buffer=await context.startRendering(),data=buffer.getChannelData(0);
    let energy=0,tail=0,signature=0,peak=0;for(let i=0;i<data.length;i++){energy+=data[i]*data[i];peak=Math.max(peak,Math.abs(data[i]));if(i>44100*2.8)tail+=data[i]*data[i];if(i%97===0)signature+=data[i]*(i+1)}
    rows.push({event,weapon,played,energy,tail,signature,peak,voices:s.stats().voices});
   }
  }finally{Math.random=original}return rows;
 });
 for(const row of signals){assert.equal(row.played,true);assert.ok(row.energy>.001,JSON.stringify(row));assert.equal(row.tail,0);assert.ok(row.peak<1);assert.equal(row.voices,0)}
 assert.equal(new Set(signals.map(r=>r.signature.toFixed(4))).size,signals.length);
});

test('audio remains silent before gesture, limits overlapping voices and stops immediately when paused',async t=>{
 const page=await pageFor(t);await fixture(page);
 assert.equal(await page.evaluate(()=>audio.stats().ready),false);
 await page.keyboard.press('x');await page.waitForFunction(()=>audio.stats().ready,null,{polling:20,timeout:2000});
 const state=await page.evaluate(()=>{
  const before=audio.stats().played;P.a=0;fire(P);const after=audio.stats().played;
  for(let i=0;i<40;i++)audio.play('fire',{weapon:'custom_'+i});const bounded=audio.stats();togglePause();const stopped=audio.stats(),refused=audio.play('fire',{weapon:'laser'});
  audio.play('pickup',{preview:true});window.dispatchEvent(new Event('blur'));const background=audio.stats().voices;
  return{before,after,bounded,stopped,refused,background};
 });assert.equal(state.after,state.before+1);assert.ok(state.bounded.voices<=12);assert.equal(state.stopped.voices,0);assert.equal(state.stopped.blocked,true);assert.equal(state.refused,false);assert.equal(state.background,0);
});

test('sound controls preview, cancel, persist and mute without altering saved AI learning',async t=>{
 const page=await pageFor(t);await fixture(page);await page.evaluate(()=>{lessons=['keep my learning'];saveMem()});
 await page.locator('#cfgBtn').click();await page.locator('[data-section="visualSettings"]').click();
 await page.locator('#soundVolume').fill('25');await page.locator('#soundVolume').dispatchEvent('input');
 const before=await page.evaluate(()=>audio.stats().played);await page.locator('#soundPreview').click();await page.waitForFunction(n=>audio.stats().played>n,before,{polling:20,timeout:2000});
 await page.locator('#soundEnabled').uncheck();assert.equal(await page.locator('#soundPreview').isDisabled(),true);await page.locator('#cfgClose').click();
 assert.deepEqual(await page.evaluate(()=>audio.config),{enabled:true,volume:.55});
 await page.locator('#cfgBtn').click();await page.locator('#soundVolume').fill('30');await page.locator('#soundVolume').dispatchEvent('input');await page.locator('#soundEnabled').uncheck();await page.locator('#save').click();
 await reloadArena(page);assert.deepEqual(await page.evaluate(()=>({sound:audio.config,lesson:lessons[0],ready:audio.stats().ready})),{sound:{enabled:false,volume:.3},lesson:'keep my learning',ready:false});
});

test('real travel animates visible treads, blocked movement and pause freeze them, and reduced motion stays still',async t=>{
 const page=await pageFor(t);await fixture(page);
 const state=await page.evaluate(()=>{
  fx.configure({quality:'off',reducedMotion:false});P.x=300;P.y=300;P.a=0;E.x=850;E.y=600;trackMotion.reset(allTanks());
  const stamp=()=>{ctx.fillStyle='#101b26';ctx.fillRect(0,0,FW,FH);drawTank({...P,x:300,y:300},'#5b89b5');return cv.toDataURL()};
  const first=stamp();keys.fwd=true;advance(.02);keys.fwd=false;const second=stamp(),forward=trackMotion.snapshot('P');
  const pixel=[...ctx.getImageData(300,280,1,1).data];const unchanged=stamp()===second;
  togglePause();const pausedState=trackMotion.snapshot('P');keys.fwd=true;advance(.2);const frozen=JSON.stringify(pausedState)===JSON.stringify(trackMotion.snapshot('P'));keys.fwd=false;togglePause();
  walls=[{x:P.x+TR+1,y:P.y-80,w:14,h:160}];keys.fwd=true;const blockedBefore=trackMotion.snapshot('P');advance(.02);keys.fwd=false;const blocked=trackMotion.snapshot('P').left===blockedBefore.left;
  walls=[];fx.configure({reducedMotion:true});const calm=stamp();keys.fwd=true;advance(.02);keys.fwd=false;const calmStill=stamp()===calm;
  return{changed:first!==second,forward,unchanged,pixel,frozen,blocked,calmStill};
 });assert.equal(state.changed,true);assert.equal(state.unchanged,true);assert.ok(state.forward.left>0);assert.ok(state.pixel[0]>40&&state.pixel[1]>55);assert.equal(state.frozen,true);assert.equal(state.blocked,true);assert.equal(state.calmStill,true);
});

test('all ten crates render distinct illustrated icons with names and the legend fits desktop and mobile',async t=>{
 for(const [name,options]of [['desktop',{viewport:{width:1440,height:900}}],['mobile',{viewport:{width:390,height:844},isMobile:true,hasTouch:true}]]){
  const page=await pageFor(t,{...options,powerups:true});await weaponFixture(page,{staticAI:false});
  const state=await page.evaluate(()=>{
   walls=[];weapons.pickups=[];P.x=100;P.y=FH-70;P.a=-.2;E.x=FW-100;E.y=FH-70;E.a=Math.PI+.2;P2.alive=false;E.hold=true;trackMotion.reset(allTanks());
   const cols=FW>800?5:3,spacing=(FW-200)/(cols-1);Object.keys(AITankWeapons.catalog).forEach((type,i)=>weapons.spawnPickup(weaponWorld(),type,100+i%cols*spacing,110+Math.floor(i/cols)*140));
   const icons=[];for(const[type,item]of Object.entries(AITankWeapons.catalog)){const canvas=document.createElement('canvas');canvas.width=canvas.height=40;AITankArt.drawIcon(canvas.getContext('2d'),type,20,20,30,item.color,item);icons.push(canvas.toDataURL())}
   refreshWeaponHelp();hud();render();return{count:weapons.pickups.length,unique:new Set(icons).size,legend:document.querySelectorAll('#weaponHelp svg').length,letters:[...document.querySelectorAll('#weaponHelp')].some(el=>/SG ·|RC ·/.test(el.textContent)),width:document.documentElement.scrollWidth,viewport:innerWidth};
  });assert.equal(state.count,10);assert.equal(state.unique,10);assert.equal(state.legend,10);assert.equal(state.letters,false);assert.ok(state.width<=state.viewport);
  await page.screenshot({path:path.join(__dirname,'..','test-results','illustrated-crates-'+name+'.png'),fullPage:true});
  await page.locator('#cfgBtn').click();await page.locator('[data-section="gameSettings"]').click();await page.getByText('道具图标与操作',{exact:true}).click();
  await page.screenshot({path:path.join(__dirname,'..','test-results','weapon-legend-'+name+'.png'),fullPage:true});
  await page.locator('[data-section="visualSettings"]').click();await page.locator('#soundEnabled').scrollIntoViewIfNeeded();
  await page.screenshot({path:path.join(__dirname,'..','test-results','sound-settings-'+name+'.png'),fullPage:true});
 }
});

test('selected chase approaches a distant gatling target without wasting short-range ammunition',async t=>{
  const page=await pageFor(t,{powerups:true});await weaponFixture(page,{staticAI:false});
  const state=await page.evaluate(()=>{
    E.x=150;E.y=350;E.a=0;P.x=900;P.y=350;P2.alive=false;weapons.equip(weaponWorld(),E,'gatling');applyCmd({cmd:'algo',name:'chase_and_fire'});
    const advice=skillOpportunity();runFrames(1);return{x:E.x,ammo:E.weapon?.ammo,shots:roundExecution.weapons.shots.gatling||0,advice};
  });assert.ok(state.x>200);assert.equal(state.ammo,30);assert.equal(state.shots,0);assert.equal(state.advice.outOfRange,true);
});

test('selected chase fires its death ray through cover instead of treating walls as a firing veto',async t=>{
  const page=await pageFor(t,{powerups:true});await weaponFixture(page,{staticAI:false});
  const state=await page.evaluate(()=>{
    E.x=150;E.y=350;E.a=0;P.x=650;P.y=350;P2.x=950;P2.y=550;walls=[{x:400,y:0,w:12,h:700}];weapons.equip(weaponWorld(),E,'deathray');
    applyCmd({cmd:'algo',name:'chase_and_fire'});runFrames(1);return{alive:P.alive,shots:roundExecution.weapons.shots.deathray,decisions:roundExecution.weapons.decisions};
  });assert.equal(state.alive,false);assert.equal(state.shots,1);assert.equal(state.decisions[0].weapon,'deathray');assert.equal(state.decisions[0].hit,true);assert.ok(state.decisions[0].range>500);
});

test('isolated generated programs see real weapon shot results and the full rulebook',async t=>{
  const page=await pageFor(t,{powerups:true});await weaponFixture(page);
  const result=await page.evaluate(async()=>{
    E.x=150;E.y=350;E.a=0;P.x=900;P.y=350;P2.alive=false;weapons.equip(weaponWorld(),E,'gatling');
    const runner=new AIProgramSandbox();try{
      await runner.load('const r=api.shot(state.self.a,state.enemy);return {fire:api.willHit(state.self.a,state.enemy),move:state.weapons.rulebook.length===10?0:1,prediction:{x:r.range/10,y:r.distance/10}};');
      const gatling=await runner.tick(programSnapshot());E.weapon=null;E.cd=0;weapons.equip(weaponWorld(),E,'deathray');walls=[{x:400,y:0,w:12,h:700}];
      const deathray=await runner.tick(programSnapshot());return{gatling,deathray,eta:programSnapshot().gunnery.current.eta};
    }finally{runner.stop()}
  });assert.equal(result.gatling.fire,false);assert.equal(result.gatling.move,0);assert.equal(result.gatling.prediction.x,285*1.55/10);assert.equal(result.deathray.fire,true);assert.ok(result.eta>.6);
});

test('stale learned special gunnery cannot fire after a weapon or target-facing change',async t=>{
  const page=await pageFor(t,{powerups:true});await weaponFixture(page);
  await page.evaluate(async()=>{
    E.x=150;E.y=350;E.a=Math.PI;P.x=900;P.y=350;P2.alive=false;weapons.equip(weaponWorld(),E,'shotgun');
    await installGunnery({name:'test_current_shot',code:'return {fire:true};'});runGunnery();
  });await page.waitForFunction(()=>gunneryState?.value?.fire===true,null,{polling:20,timeout:4000});
  const result=await page.evaluate(()=>{
    const first=attemptAIShot('safe',enemyTank());E.cd=0;E.a+=.3;const angle=attemptAIShot('safe',enemyTank());E.a-=.3;E.weapon=null;weapons.equip(weaponWorld(),E,'gatling');
    const changed=attemptAIShot('safe',enemyTank());return{first,angle,changed,remaining:E.weapon.ammo};
  });assert.deepEqual(result,{first:true,angle:false,changed:false,remaining:30});
});

test('all model roles receive weapon mechanics while old learned sources stay unchanged',async t=>{
  const page=await pageFor(t,{powerups:true});await weaponFixture(page);
  const result=await page.evaluate(async()=>{
    await installCode({name:'old_fire',code:'return {fire:false};'});const code=ALGOS.old_fire.code;weapons.equip(weaponWorld(),E,'laser');
    const commander=controlPrompt(),coach=SYS_REF,program=programSnapshot();return{codeUnchanged:ALGOS.old_fire.code===code,all:program.weapons.rulebook.length,commander,coach,api:PROGRAM_API};
  });assert.equal(result.codeUnchanged,true);assert.equal(result.all,10);assert.match(result.commander,/"spinup":0.65/);assert.match(result.commander,/"pierceInternalWalls":true/);assert.match(result.coach,/execution.weapons.decisions/);assert.match(result.api,/shot\(/);
});

test('learned refusal releases an already spinning gatling without a trailing automatic burst',async t=>{
  const page=await pageFor(t,{powerups:true});await weaponFixture(page,{staticAI:false});
  const result=await page.evaluate(()=>{
    E.x=150;E.y=350;E.a=0;P.x=900;P.y=600;P2.alive=false;weapons.equip(weaponWorld(),E,'gatling');applyCmd({cmd:'fire'});runFrames(.75);
    E.fireIntentUntil=0;E.hold=true;executeLocalPlan(.01,{move:0,turn:null,fire:false});const ammo=E.weapon.ammo;runFrames(.3);return{ammo,after:E.weapon.ammo,spin:E.gatlingStart};
  });assert.ok(result.ammo<30);assert.equal(result.after,result.ammo);assert.equal(result.spin,null);
});

test('selected laser tactic turns to a real bank shot before firing and its visible beam matches combat',async t=>{
  const page=await pageFor(t,{powerups:true});await weaponFixture(page,{staticAI:false});
  await page.evaluate(()=>{
    E.x=150;E.y=350;E.a=0;P.x=650;P.y=350;P2.alive=false;walls=[{x:400,y:180,w:12,h:350}];weapons.equip(weaponWorld(),E,'laser');
    applyCmd({cmd:'algo',name:'ricochet_fire'});runFrames(.5);paused=true;hud();render();
  });
  fs.mkdirSync(path.join(__dirname,'..','test-results'),{recursive:true});await page.screenshot({path:path.join(__dirname,'..','test-results','weapon-laser-ricochet.png'),fullPage:true});
  const result=await page.evaluate(()=>{paused=false;runFrames(.5);return{ai:E.alive,player:P.alive,decisions:roundExecution.weapons.decisions}});
  assert.equal(result.ai,true);assert.equal(result.player,false);assert.equal(result.decisions.length,1);assert.ok(result.decisions[0].angle>.5);assert.equal(result.decisions[0].hit,true);assert.equal(result.decisions[0].selfHit,false);
});

test('weapon live harness bounds requests, protects personal learning and pauses after completion',async t=>{
  const page=await pageFor(t);let count=0;
  await page.route('**/mock/messages',async route=>{
    const body=route.request().postDataJSON();count++;
    const value=body.stream?'{"cmd":"algo","name":"chase_and_fire"}':JSON.stringify({set_code:{name:'weapon_mechanism_policy',code:'const a=api.weaponAim();return {turn:a?.angle??state.self.a,fire:!!api.shot(state.self.a).hit};'}});
    await route.fulfill({status:200,headers:{'Access-Control-Allow-Origin':'*','Content-Type':body.stream?'text/event-stream':'application/json'},body:body.stream?'data: '+JSON.stringify({type:'content_block_delta',delta:{type:'text_delta',text:value}})+'\n\ndata: [DONE]\n\n':JSON.stringify({content:[{type:'text',text:value}]})});
  });
  const saved=JSON.stringify({lessons:['personal learning must remain'],cfg:{key:'test-key',endpoint:origin+'/mock/messages',model:'test-model',remember:true}});
  await page.evaluate(value=>localStorage.setItem('aitank_lessons',value),saved);await page.goto(origin+'/tests/weapon-live.html');
  await page.waitForFunction(()=>document.getElementById('game').dataset.ready==='true',null,{polling:20});await page.locator('#start').click();
  await page.waitForFunction(()=>document.getElementById('status').textContent==='测试结束 · AI 已暂停',null,{polling:20,timeout:20000});
  const result=JSON.parse(await page.locator('#result').innerText());assert.equal(result.error,undefined);assert.equal(count,4);assert.equal(result.paused,true);assert.equal(result.backgroundRequestsAllowed,false);
  assert.equal(result.checks.at(-1).evaluations.length,10);assert.equal(await page.evaluate(()=>localStorage.getItem('aitank_lessons')),saved);assert.equal(await page.evaluate(()=>localStorage.getItem('aitank_algos')),null);
  await page.waitForTimeout(150);assert.equal(count,4);
});

test('invalid real-model-style weapon code is rejected and the isolated test still cancels all AI work',async t=>{
  const page=await pageFor(t);let count=0;
  await page.route('**/mock/messages',async route=>{
    const body=route.request().postDataJSON();count++;
    const value=body.stream?'{"cmd":"algo","name":"chase_and_fire"}':JSON.stringify({set_code:{name:'weapon_mechanism_policy',code:'const invalid; return {fire:true};'}});
    await route.fulfill({status:200,headers:{'Access-Control-Allow-Origin':'*','Content-Type':body.stream?'text/event-stream':'application/json'},body:body.stream?'data: '+JSON.stringify({type:'content_block_delta',delta:{type:'text_delta',text:value}})+'\n\n':JSON.stringify({content:[{type:'text',text:value}]})});
  });
  const saved=JSON.stringify({lessons:['keep'],cfg:{key:'test-key',endpoint:origin+'/mock/messages',model:'test-model',remember:true}});
  await page.evaluate(value=>localStorage.setItem('aitank_lessons',value),saved);await page.goto(origin+'/tests/weapon-live.html');
  await page.waitForFunction(()=>document.getElementById('game').dataset.ready==='true',null,{polling:20});await page.locator('#start').click();
  await page.waitForFunction(()=>document.getElementById('status').textContent==='测试结束 · AI 已暂停',null,{polling:20,timeout:20000});
  const result=JSON.parse(await page.locator('#result').innerText());assert.match(result.error,/initializer|初始化|Unexpected/i);assert.equal(count,4);assert.equal(result.paused,true);assert.equal(result.backgroundRequestsAllowed,false);
  assert.equal(await page.evaluate(()=>localStorage.getItem('aitank_lessons')),saved);assert.equal(await page.evaluate(()=>localStorage.getItem('aitank_algos')),null);
});

test('pending player attacks reach commander and all local programs without becoming real bullets or an emergency',async t=>{
  const page=await pageFor(t,{powerups:true});await weaponFixture(page,{staticAI:false});
  const result=await page.evaluate(()=>{
    E.x=650;E.y=350;E.a=0;P.x=150;P.y=350;P.a=0;P2.x=150;P2.y=550;P2.a=0;walls=[{x:400,y:0,w:12,h:700}];weapons.equip(weaponWorld(),P,'deathray');weapons.equip(weaponWorld(),P2,'gatling');
    const before={x:E.x,y:E.y};aiLocal(.01);const state=programSnapshot(),summary=JSON.parse(stateText());
    return{before,after:{x:E.x,y:E.y},danger:E.emergency,bullets:bullets.length,charges:weapons.charges.length,actors:state.opponentThreats.actors.map(a=>a.id),risk:state.opponentThreats.atSelf.score,paths:state.opponentThreats.scenarios[0].paths.length,commander:summary.opponentThreats,prompt:controlPrompt(),ammo:P.weapon.ammo};
  });assert.deepEqual(result.after,result.before);assert.equal(result.danger,false);assert.equal(result.bullets,0);assert.equal(result.charges,0);assert.equal(result.ammo,1);assert.deepEqual(result.actors,['P','P2']);assert.ok(result.risk>0);assert.ok(result.paths>0);assert.equal(result.commander.advisoryOnly,true);assert.equal(result.commander.scenarios,undefined);assert.match(result.prompt,/不是已经出现的子弹/);
});

test('Worker incoming-risk and opponent-shot helpers can inspect a pending piercing weapon locally',async t=>{
  const page=await pageFor(t,{powerups:true});await weaponFixture(page);
  const result=await page.evaluate(async()=>{
    E.x=650;E.y=350;E.a=Math.PI;P.x=150;P.y=350;P.a=0;P2.alive=false;walls=[{x:400,y:0,w:12,h:700}];weapons.equip(weaponWorld(),P,'deathray');
    const runner=new AIProgramSandbox();try{await runner.load('const r=api.incomingRisk(state.self,0,1.5),p=api.opponentShot("P",0);return {fire:r.score>0&&p.hit&&p.available,move:0,prediction:{x:r.score*100,y:(r.possibleHitIn||0)*100}};');return await runner.tick(programSnapshot())}finally{runner.stop()}
  });assert.equal(result.fire,true);assert.equal(result.move,0);assert.ok(result.prediction.x>0);assert.ok(result.prediction.y>=60);
});

test('only a selected anticipation tactic moves out of a pending ray and it survives the later real attack',async t=>{
  const page=await pageFor(t,{powerups:true});await weaponFixture(page,{staticAI:false});
  const result=await page.evaluate(()=>{
    E.x=650;E.y=350;E.a=0;P.x=150;P.y=350;P.a=0;P2.alive=false;walls=[{x:400,y:0,w:12,h:700}];weapons.equip(weaponWorld(),P,'deathray');
    runFrames(.3);const waiting={x:E.x,y:E.y,emergency:E.emergency};applyCmd({cmd:'algo',name:'anticipate_attack'});runFrames(.75);const proactive={x:E.x,y:E.y,emergency:E.emergency};
    fire(P);runFrames(1);togglePause();hud();render();return{waiting,proactive,alive:E.alive,shots:roundExecution.weapons.shots.deathray,anticipation:roundExecution.anticipation};
  });assert.deepEqual(result.waiting,{x:650,y:350,emergency:false});assert.ok(Math.abs(result.proactive.y-350)>30);assert.equal(result.proactive.emergency,false);assert.equal(result.alive,true);assert.equal(result.shots,1);assert.ok(result.anticipation.samples.length>0);assert.equal(result.anticipation.actualAttacks[0].weapon,'deathray');
  fs.mkdirSync(path.join(__dirname,'..','test-results'),{recursive:true});await page.screenshot({path:path.join(__dirname,'..','test-results','opponent-threat-anticipation.png'),fullPage:true});
});

test('potential attack advice preserves an explicit navigation goal and pause freezes every real mechanism',async t=>{
  const page=await pageFor(t,{powerups:true});await weaponFixture(page,{staticAI:false});
  const result=await page.evaluate(()=>{
    E.x=650;E.y=350;E.a=Math.PI/2;P.x=150;P.y=350;P.a=0;P2.alive=false;walls=[{x:400,y:0,w:12,h:700}];weapons.equip(weaponWorld(),P,'deathray');
    applyCmd({cmd:'move_to',x:650,y:550});const goal=E.goal;runFrames(.1);const kept=E.goal===goal&&E.curAlgo==='navigate_to',risk=opponentThreats().atSelf.score;
    togglePause();const before=JSON.stringify({P,E,bullets,time:gT,charges:weapons.charges});runFrames(.8);return{kept,risk,same:before===JSON.stringify({P,E,bullets,time:gT,charges:weapons.charges}),paused,requestsAllowed:!!canControl()};
  });assert.equal(result.kept,true);assert.ok(result.risk>0);assert.equal(result.same,true);assert.equal(result.paused,true);assert.equal(result.requestsAllowed,false);
});

test('coach sees conditional threat evidence and actual attacks rather than invented enemy intentions',async t=>{
  const page=await pageFor(t,{powerups:true});await weaponFixture(page,{staticAI:false});const start=reviews.length;
  await page.evaluate(async()=>{
    E.x=650;E.y=350;E.a=0;P.x=150;P.y=350;P.a=0;P2.alive=false;walls=[{x:400,y:0,w:12,h:700}];weapons.equip(weaponWorld(),P,'deathray');aiLocal(.01);fire(P);E.alive=false;roundOver(E,{own:'P',kind:'deathray'});await reflectTask;
  });const body=reviews[start];assert.ok(body);assert.match(body.system,/execution.anticipation/);assert.match(body.messages[0].content,/actualAttacks/);assert.match(body.messages[0].content,/current_heading/);
});

test('prospective analysis stays bounded across cached coop laser and frag updates without changing game state',async t=>{
  const page=await pageFor(t,{powerups:true});await weaponFixture(page);
  const measured=await page.evaluate(()=>{
    E.x=650;E.y=350;E.a=0;P.x=150;P.y=350;P.a=0;P2.x=150;P2.y=550;P2.a=0;walls=[{x:400,y:180,w:12,h:350}];weapons.equip(weaponWorld(),P,'laser');weapons.equip(weaponWorld(),P2,'frag');const initial=JSON.stringify({P,P2,E,bullets}),samples=[];let paths=0;
    for(let i=0;i<180;i++){gT+=1/60;const start=performance.now(),r=opponentThreats();samples.push(performance.now()-start);paths=Math.max(paths,r.scenarios.reduce((n,s)=>n+s.paths.length,0))}
    samples.sort((a,b)=>a-b);return{meanMs:samples.reduce((a,b)=>a+b,0)/samples.length,p95Ms:samples[Math.floor(samples.length*.95)],maxMs:samples.at(-1),paths,unchanged:initial===JSON.stringify({P,P2,E,bullets})};
  });assert.equal(measured.unchanged,true);assert.ok(measured.paths>0);assert.ok(measured.paths<18000);fs.mkdirSync(path.join(__dirname,'..','test-results'),{recursive:true});fs.writeFileSync(path.join(__dirname,'..','test-results','opponent-threat-performance.json'),JSON.stringify(measured,null,2));
});

test('Worker opponent-shot queries can evaluate manual detonation with an empty special weapon',async t=>{
  const page=await pageFor(t,{powerups:true});await weaponFixture(page);
  const result=await page.evaluate(async()=>{
    E.x=700;E.y=350;P.x=150;P.y=350;P.a=0;P2.alive=false;weapons.equip(weaponWorld(),P,'frag');fire(P);bullets[0].x=E.x-20;
    const runner=new AIProgramSandbox();try{await runner.load('const p=api.opponentShot("P");return {fire:p.available&&p.hit,move:0};');return await runner.tick(programSnapshot())}finally{runner.stop()}
  });assert.deepEqual(result,{move:0,fire:true});
});

test('delegated shotgun combat approaches a distant target and keeps its whole volley until a useful shot',async t=>{
 const page=await pageFor(t,{powerups:true});await weaponFixture(page,{staticAI:false});
 const result=await page.evaluate(()=>{
  E.x=150;E.y=350;E.a=0;E.hold=false;P.x=900;P.y=350;P2.alive=false;weapons.equip(weaponWorld(),E,'shotgun');applyCmd({cmd:'algo',name:'use_weapon'});
  const far=skillOpportunity();runFrames(1);return{x:E.x,ammo:E.weapon.ammo,shots:roundExecution.weapons.shots.shotgun||0,far,snapshot:programSnapshot().gunnery.weaponActions};
 });assert.ok(result.x>220);assert.equal(result.ammo,3);assert.equal(result.shots,0);assert.equal(result.far.outOfRange,true);assert.equal(result.far.pattern.wholeVolley,true);assert.ok(result.snapshot.options.some(o=>o.command.name==='use_weapon'));
});

test('AI gatling can explicitly tap once, hold across shots, release and pause without trailing fire',async t=>{
 const page=await pageFor(t,{powerups:true});await weaponFixture(page,{staticAI:false});
 const result=await page.evaluate(()=>{
  E.x=150;E.y=350;E.a=0;E.hold=true;P.x=900;P.y=600;P2.alive=false;weapons.equip(weaponWorld(),E,'gatling');
  const tap=applyTacticalDecision({cmd:'trigger',mode:'tap'});runFrames(1.1);const afterTap=E.weapon.ammo;
  const hold=applyTacticalDecision({cmd:'trigger',mode:'hold',ms:1800});runFrames(1);const afterHold=E.weapon.ammo;
  applyTacticalDecision({cmd:'trigger',mode:'release'});runFrames(.4);const afterRelease=E.weapon.ammo;
  applyCmd({cmd:'trigger',mode:'hold',ms:2000});runFrames(.4);togglePause();const frozen=E.weapon.ammo;runFrames(.8);togglePause();runFrames(.5);
  return{tap,hold,afterTap,afterHold,afterRelease,frozen,afterResume:E.weapon.ammo,trigger:E.triggerOrder,spin:E.gatlingStart};
 });assert.equal(result.tap,true);assert.equal(result.hold,true);assert.equal(result.afterTap,29);assert.ok(result.afterHold<27);assert.equal(result.afterRelease,result.afterHold);assert.equal(result.afterResume,result.frozen);assert.equal(result.trigger,null);assert.equal(result.spin,null);
});

test('delegated shield waits for an opportunity and activates against an incoming own rebound',async t=>{
 const page=await pageFor(t,{powerups:true});await weaponFixture(page,{staticAI:false});
 const result=await page.evaluate(()=>{
  E.x=550;E.y=350;E.a=0;E.hold=false;P.x=100;P.y=100;P.live=5;P2.alive=false;weapons.equip(weaponWorld(),E,'shield');
  applyCmd({cmd:'algo',name:'use_weapon'});runFrames(.2);const saved=E.weapon?.type==='shield'&&!(E.shieldUntil>gT);
  bullets.push({id:++bulletSequence,kind:'normal',own:'E',x:670,y:350,vx:-128,vy:0,life:2,radius:BR,slot:false});weaponRevision++;runFrames(.1);
  return{saved,active:E.shieldUntil>gT,weapon:E.weapon,events:roundExecution.weapons.events.filter(e=>e.type==='activate')};
 });assert.equal(result.saved,true);assert.equal(result.active,true);assert.equal(result.weapon,null);assert.equal(result.events.length,1);
});

test('mine tactics require delegation and place on a compared corridor with an exit',async t=>{
 const page=await pageFor(t,{powerups:true});await weaponFixture(page,{staticAI:false});
 const result=await page.evaluate(()=>{
  E.x=550;E.y=350;E.a=0;E.hold=true;P.x=250;P.y=350;P2.alive=false;walls=[{x:0,y:270,w:FW,h:20},{x:0,y:410,w:FW,h:20}];weapons.equip(weaponWorld(),E,'mine');runFrames(.15);
  const waiting={mines:weapons.mines.length,x:E.x},options=skillOpportunity().placementOptions;applyCmd({cmd:'algo',name:'use_weapon'});runFrames(3.5);
  return{waiting,options,mines:weapons.mines.map(m=>({...m})),decisions:roundExecution.tactics?.decisions,alive:E.alive};
 });assert.deepEqual(result.waiting,{mines:0,x:550});assert.ok(result.options.some(p=>p.choke>0&&p.escape));assert.ok(result.mines.length>0);assert.ok(result.decisions.some(d=>d.mode==='mine_position'));assert.equal(result.alive,true);
});

test('curved death-ray column stays visible with effects off and paused AI consumes no requests',async t=>{
 const page=await pageFor(t,{powerups:true});await weaponFixture(page);
 const result=await page.evaluate(()=>{
  E.x=150;E.y=350;E.a=0;P.x=850;P.y=395;P2.alive=false;weapons.equip(weaponWorld(),E,'deathray');fx.configure({quality:'off'});fire(E);runFrames(.84);togglePause();render();
  const beam=weapons.beams.find(b=>b.kind==='deathray'),first=beam.path[0],last=beam.path.at(-1);
  return{paused,canControl:canControl(),first,last,radius:beam.radius,life:beam.life,segments:beam.path.length,curved:last.ty>first.y};
 });assert.equal(result.paused,true);assert.equal(result.canControl,false);assert.equal(result.curved,true);assert.ok(result.segments>5);assert.equal(result.radius,6);assert.ok(result.first.x<190);assert.ok(result.last.tx>600);
 fs.mkdirSync(path.join(__dirname,'../test-results'),{recursive:true});await page.screenshot({path:path.join(__dirname,'../test-results/deathray-column.png'),fullPage:true});
});

test('weapon calibration isolates learning, validates model code and only applies on a separate explicit action',async t=>{
 const page=await pageFor(t,{powerups:true}),proposal={name:'ignored_name',desc:'测试武器分支',code:`const s=state.self,w=s.weapon,a=state.gunnery.current;
 if(w.type==='shield')return {fire:a.score>0};
 if(w.type==='mine'){const p=memory.ammo===w.ammo?memory.goal:a.placementOptions.find(p=>p.escape&&p.score>0);if(!p)return {fire:false};if(Math.hypot(s.x-p.tank.x,s.y-p.tank.y)>12)return {moveTo:p.tank,fire:false,memory:{goal:p,ammo:w.ammo}};return {move:0,turn:p.angle,fire:Math.abs(api.angleDiff(p.angle,s.a))<.08&&a.score>0,memory:{goal:p,ammo:w.ammo}};}
 const angle=a.aim?.angle??Math.atan2(state.enemy.y-s.y,state.enemy.x-s.x);return {turn:angle,move:a.outOfRange?1:0,fire:a.score>0};`};
 await page.evaluate(()=>{
  localStorage.setItem('aitank_lessons',JSON.stringify({cfg:{key:'test-key',endpoint:location.origin+'/mastery-api',model:'test',remember:true},lessons:['preserve me']}));
  localStorage.setItem('aitank_algos',JSON.stringify({old_policy:{name:'old_policy',desc:'保留普通行为',code:'return {move:0,fire:false};',weaponInterface:1}}));
  localStorage.setItem('aitank_evolution',JSON.stringify({completed:458,reviews:441,generation:100,activePolicy:'old_policy',activeGunnery:null,history:[]}));
 });let calls=0;
 await page.route('**/mastery-api',route=>{calls++;const request=route.request().postDataJSON();assert.equal(request.thinking.type,'disabled');return route.fulfill({headers:{'Access-Control-Allow-Origin':'*'},json:{content:[{type:'text',text:JSON.stringify({set_code:proposal})}],usage:{input_tokens:10,output_tokens:10}}})});
 await page.goto(origin+'/tests/weapon-mastery.html');await page.getByRole('button',{name:'开始真实模型校准',exact:true}).click();
 try{await page.waitForFunction(()=>document.querySelector('#result').textContent.length>0,null,{polling:20,timeout:30000})}catch(error){throw Error(error.message+'; API calls='+calls+'; status='+await page.locator('#status').innerText())}
 const result=await page.locator('#result').evaluate(el=>JSON.parse(el.textContent));assert.equal(result.passed,true,JSON.stringify(result));assert.equal(result.paused,true);assert.equal(result.backgroundRequestsAllowed,false);assert.equal(calls,1);assert.equal(result.checks[0].results.length,10);
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('aitank_evolution')).generation),100);assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('aitank_algos')).old_policy.code),'return {move:0,fire:false};');
 await page.getByRole('button',{name:'另存并启用已验证策略',exact:true}).click();
 const after=await page.evaluate(()=>({e:JSON.parse(localStorage.getItem('aitank_evolution')),algos:JSON.parse(localStorage.getItem('aitank_algos')),lessons:JSON.parse(localStorage.getItem('aitank_lessons')).lessons,backup:Object.keys(localStorage).filter(k=>k.startsWith('aitank_weapon_backup_')).length}));
 assert.equal(after.e.completed,458);assert.equal(after.e.reviews,441);assert.equal(after.e.generation,101);assert.equal(after.e.activePolicy,'weapon_mastery_v101');assert.equal(after.algos.old_policy.code,'return {move:0,fire:false};');assert.ok(after.algos.weapon_mastery_v101.code.endsWith('return {move:0,fire:false};'));assert.deepEqual(after.lessons,['preserve me']);assert.equal(after.backup,1);
});

test('pending code output and cached controls cannot fire a newly acquired weapon using an old snapshot',async t=>{
 const page=await pageFor(t,{powerups:true});await weaponFixture(page,{staticAI:false});
 await page.evaluate(()=>{
  E.x=150;E.y=350;E.a=0;E.hold=false;P.x=900;P.y=350;P2.alive=false;
  registerCode({name:'delayed_weapon',code:'return {fire:true};'});E.curAlgo='delayed_weapon';
  window.pendingWeaponOutput=null;
  programState={name:'delayed_weapon',source:ALGOS.delayed_weapon.code,loaded:true,busy:false,lastInput:-Infinity,value:null,runner:{load:async()=>{},tick:()=>new Promise(resolve=>{window.pendingWeaponOutput=resolve}),stop(){}}};
  scheduleProgram('delayed_weapon');
 });
 await page.waitForFunction(()=>!!window.pendingWeaponOutput,null,{polling:20});
 const result=await page.evaluate(async()=>{
  const oldControl={move:0,turn:0,fire:true,weaponType:null};weapons.equip(weaponWorld(),E,'shotgun');window.pendingWeaponOutput({fire:true});await Promise.resolve();await Promise.resolve();
  const ignored=programState.value===null;executeLocalPlan(.01,oldControl);const after=E.weapon.ammo;
  E.triggerOrder={mode:'hold',until:gT+2};E.fireIntentUntil=gT+1;weapons.equip(weaponWorld(),P,'laser');togglePause();
  return{ignored,after,shots:roundExecution.weapons.shots.shotgun||0,trigger:E.triggerOrder,fireUntil:E.fireIntentUntil};
 });assert.equal(result.ignored,true);assert.equal(result.after,3);assert.equal(result.shots,0);assert.equal(result.trigger,null);assert.equal(result.fireUntil,0);
});

test('the launch menu blocks game input and API work, then offers a playable keyboard PvP entry',async t=>{
  const page=await pageFor(t,{home:true});
  await page.evaluate(()=>{
    cfg.key='test-key';window.menuCalls=0;window.fetch=async()=>{menuCalls++;throw new Error('menu must not call API')};
    evolution.completed=459;evolution.generation=101;refreshHome();
  });
  await page.keyboard.press('Escape');await page.keyboard.press('Space');await page.keyboard.down('w');
  const frozen=await page.evaluate(()=>{const x=P.x,time=gT;advance(.05);return{home:homeOpen,paused,play:canControl(),moved:P.x-x,time:gT-time,bullets:bullets.length}});
  await page.keyboard.up('w');assert.deepEqual(frozen,{home:true,paused:true,play:false,moved:0,time:0,bullets:0});
  await page.locator('[data-mode="pvp"]').click();assert.equal(await page.locator('#homeDifficultyField button').first().isDisabled(),true);
  fs.mkdirSync(path.join(__dirname,'..','test-results'),{recursive:true});
  await page.locator('[data-mode="solo"]').click();await page.locator('[data-difficulty="expert"]').click();await page.locator('[data-commander="economy"]').click();
  await page.screenshot({path:path.join(__dirname,'..','test-results','main-menu-desktop.png'),fullPage:true});
  assert.equal(await page.locator('#homeCompleted').textContent(),'459');
  await page.locator('[data-mode="pvp"]').click();await page.locator('#startGame').click();
  assert.equal(await page.locator('#layout').isVisible(),true);assert.equal(await page.locator('#home').isVisible(),false);
  await page.evaluate(()=>{walls=[];P.x=300;P.y=300;P.a=0});await page.keyboard.down('w');await page.evaluate(()=>advance(.05));await page.keyboard.up('w');
  assert.equal(await page.evaluate(()=>P.x),305);
  await page.locator('#homeBtn').click();await page.keyboard.press('Escape');
  await new Promise(resolve=>setTimeout(resolve,250));
  assert.deepEqual(await page.evaluate(()=>({calls:menuCalls,home:homeOpen,paused,completed:evolution.completed,generation:evolution.generation})),{calls:0,home:true,paused:true,completed:459,generation:101});
});

test('mobile menu fits the viewport and settings return to a silent menu with saved preferences',async t=>{
  const page=await pageFor(t,{home:true,viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  await page.locator('#startGame').click();assert.equal(await page.locator('#dlg').isVisible(),true);
  await page.locator('#cfgKey').fill('test-key');await page.locator('#cfgRemember').check();
  await page.locator('#difficultySelect').selectOption('expert');await page.locator('#commanderSelect').selectOption('economy');
  await page.locator('#save').click();
  assert.deepEqual(await page.evaluate(()=>({home:homeOpen,paused,level:difficultyId,commander:commanderMode,enabled:canControl()})),{home:true,paused:true,level:'expert',commander:'economy',enabled:false});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:path.join(__dirname,'..','test-results','main-menu-mobile.png'),fullPage:true});
  await page.reload();assert.deepEqual(await page.evaluate(()=>({home:homeOpen,paused,level:difficultyId,commander:commanderMode,enabled:canControl()})),{home:true,paused:true,level:'expert',commander:'economy',enabled:false});
  await page.locator('#homeSettings').click();await page.keyboard.press('Escape');assert.equal(await page.locator('#home').isVisible(),true);
});

test('difficulty physics and all prediction surfaces expose different self and player mobility',async t=>{
  const page=await pageFor(t);await fixture(page);
  const result=await page.evaluate(()=>{
    const rows=[];
    for(const id of ['easy','normal','hard','expert']){
      setDifficulty(id);E.x=300;E.y=300;E.a=0;E.turnTarget=null;E.emergency=false;P.x=800;P.y=500;P.a=0;
      const s=programSnapshot(),summary=tacticalSummary(),playerX=P.x;
      drive(P,1,1);executeLocalPlan(.1,{move:0,turn:Math.PI/2,fire:null});
      const forward=E.a;E.a=0;const x=E.x;drive(E,1,1);
      rows.push({id,travel:E.x-x,rotation:forward,player:P.x-playerX,selfSpeed:s.constants.tankSpeed,enemySpeed:s.enemy.motion.tankSpeed,summarySpeed:summary.self.motion.tankSpeed,bodySpeed:E.motion.tankSpeed});
    }return rows;
  });
  for(const [i,speed]of [60,78,90,100].entries()){
    const x=result[i];assert.ok(Math.abs(x.travel-speed)<1e-8);assert.ok(Math.abs(x.rotation-Math.PI*.1*speed/100)<1e-8);
    assert.equal(x.player,100);assert.equal(x.selfSpeed,speed);assert.equal(x.bodySpeed,speed);assert.equal(x.enemySpeed,100);assert.equal(x.summarySpeed,speed);
  }
});

test('expert economy reuses learned authority at full physical and local reaction strength',async t=>{
  const page=await pageFor(t);await fixture(page);
  await page.evaluate(async()=>{
    await installCode({name:'economy_authority',code:'return {move:0,fire:false};'});E.curAlgo='economy_authority';
    window.priorCode=localStorage.getItem('aitank_algos');window.priorEvolution=localStorage.getItem('aitank_evolution');
    setCommanderMode('economy');aiLocal(.02);
  });
  await page.waitForFunction(()=>!!programState?.value,null,{polling:20});
  const result=await page.evaluate(()=>{
    const x=E.x,shots=roundShots.E;gT+=.12;aiLocal(.02);
    const level=controlLevel(),preserved=priorCode===localStorage.getItem('aitank_algos')&&priorEvolution===localStorage.getItem('aitank_evolution');
    E.x=300;E.y=300;E.a=0;bullets=[{id:99,x:240,y:300,vx:128,vy:0,own:'P',life:5}];gT+=.02;aiLocal(.02);
    return{level,preserved,movement:x===300,shots:roundShots.E-shots,reacted:E.emergency,speed:tankMotion(E).tankSpeed,policy:E.curAlgo,controls:canControl()};
  });
  assert.equal(result.preserved,true);assert.equal(result.movement,true);assert.equal(result.shots,0);assert.equal(result.reacted,true);
  assert.equal(result.speed,100);assert.equal(result.level.reaction,0);assert.equal(result.level.reviewEvery,3);assert.equal(result.level.controlTokens,384);assert.equal(result.policy,'economy_authority');
  await page.evaluate(()=>setCommanderMode('continuous'));
  assert.deepEqual(await page.evaluate(()=>({tokens:controlLevel().controlTokens,every:controlLevel().controlEvery,review:controlLevel().reviewEvery,reaction:controlLevel().reaction})),{tokens:1024,every:3000,review:1,reaction:0});
});

test('economy dispatch actually waits, wakes on a resource change and rejects a late stream after returning home',async t=>{
  const page=await pageFor(t);await fixture(page);
  await page.evaluate(()=>{
    setCommanderMode('economy');streamOn=true;window.budgetRequests=[];window.releaseOld=null;
    window.fetch=async(_url,options)=>{
      budgetRequests.push(JSON.parse(options.body));
      if(budgetRequests.length===1)return new Response('data: '+JSON.stringify({type:'content_block_delta',delta:{type:'text_delta',text:'{"cmd":"keep"}'}})+'\n\n');
      return new Response(new ReadableStream({start(controller){window.releaseOld=()=>{try{controller.enqueue(new TextEncoder().encode('data: '+JSON.stringify({type:'content_block_delta',delta:{type:'text_delta',text:'{"cmd":"move_to","x":800,"y":300}'}})+'\n\n'));controller.close()}catch{}}}}));
    };
  });
  await page.waitForFunction(()=>budgetRequests.length===1&&!streamAbort,null,{polling:20});
  await new Promise(resolve=>setTimeout(resolve,300));assert.equal(await page.evaluate(()=>budgetRequests.length),1);
  await page.evaluate(()=>{nextControlAt=0;budgetLast.time=performance.now()-7000});
  await new Promise(resolve=>setTimeout(resolve,250));assert.equal(await page.evaluate(()=>budgetRequests.length),1);
  await page.evaluate(()=>{P.live=5});
  await page.waitForFunction(()=>budgetRequests.length===2&&!!releaseOld,null,{polling:20});
  const body=await page.evaluate(()=>budgetRequests[0]);assert.equal(body.thinking.type,'disabled');assert.equal(body.max_tokens,384);
  await page.locator('#homeBtn').click();await page.evaluate(()=>releaseOld());await new Promise(resolve=>setTimeout(resolve,250));
  assert.deepEqual(await page.evaluate(()=>({requests:budgetRequests.length,goal:E.goal,home:homeOpen,paused,aborted:streamAbort===null})),{requests:2,goal:null,home:true,paused:true,aborted:true});
});

test('economy packets cut repeated context while retaining the full map, players, weapons and every projectile',async t=>{
  const page=await pageFor(t);await coopFixture(page);
  const result=await page.evaluate(()=>{
    powerupsEnabled=true;weapons.spawnPickup(weaponWorld(),'shotgun',550,250);weapons.equip(weaponWorld(),P,'laser');
    bullets=Array.from({length:40},(_,i)=>({id:i+1,x:150+i*10,y:50,vx:128,vy:0,own:i%2?'P':'E',life:7}));
    const expertSystem=controlPrompt(DIFFICULTIES.expert),expertState=stateText()+'\n'+asciiMap();
    setCommanderMode('economy');const system=controlPrompt(),state=economyStateText();
    const value=JSON.parse(state);return{full:expertSystem.length+expertState.length,compact:system.length+state.length+asciiMap().length,value,system,geometry:asciiMap()};
  });
  assert.equal(result.value.bullets.rows.length,40);assert.equal(result.value.enemies.length,2);assert.equal(result.value.enemies[0].weapon.type,'laser');assert.equal(result.value.weapons.pickups[0].type,'shotgun');
  assert.ok(result.system.includes('护盾')&&result.system.includes('shotgun')&&result.system.includes('fire:false'));assert.match(result.geometry,/地图/);
  assert.ok(result.compact<result.full*.8,JSON.stringify({compact:result.compact,full:result.full}));
  const report={measurement:'controlled request character counts; not API token billing or win-rate evidence',continuousCharacters:result.full,economyCharacters:result.compact,reduction:1-result.compact/result.full};
  fs.writeFileSync(path.join(__dirname,'..','test-results','budget-comparison.json'),JSON.stringify(report,null,2));
});

test('economy review batches three rounds, preserves lessons and records the commander without losing prior results',async t=>{
  const page=await pageFor(t);await fixture(page);
  const result=await page.evaluate(async()=>{
    setCommanderMode('economy');window.budgetReviews=[];
    window.fetch=async(_url,options)=>{budgetReviews.push(JSON.parse(options.body));return new Response(JSON.stringify({content:[{type:'text',text:'{"memory_add":["集中复盘仍改进"],"set_algo":null}'}]}))};
    for(let i=0;i<3;i++){
      E.alive=false;roundOver(E,{own:'P'});if(reflectTask)await reflectTask;
      if(i<2&&budgetReviews.length)throw new Error('premature review');advance(3);
    }
    return{calls:budgetReviews.length,tokens:budgetReviews[0].max_tokens,completed:evolution.completed,reviews:evolution.reviews,queue:reviewQueue.length,histories:evolution.history.map(x=>({commander:x.commander,balance:x.balanceVersion})),lesson:lessons[0]};
  });
  assert.equal(result.calls,1);assert.equal(result.tokens,4000);assert.equal(result.completed,3);assert.equal(result.reviews,1);assert.equal(result.queue,0);assert.equal(result.lesson,'集中复盘仍改进');assert.ok(result.histories.every(x=>x.commander==='economy'&&x.balance===2));
  await page.reload();assert.deepEqual(await page.evaluate(()=>({home:homeOpen,completed:evolution.completed,reviews:evolution.reviews,commander:commanderMode,lessons:lessons.length})),{home:true,completed:3,reviews:1,commander:'economy',lessons:1});
});

test('delayed audio decoding cannot replay a dismissed preview, and engines follow motion and pause',async t=>{
 const page=await pageFor(t);await fixture(page);
 let release;const gate=new Promise(resolve=>release=resolve);t.after(()=>release());
 await page.route('**/assets/audio/*.mp3*',async route=>{await gate;try{await route.continue()}catch{}});
 await page.locator('#cfgBtn').click();await page.locator('[data-section="visualSettings"]').click();
 await page.locator('#soundCue').selectOption('deathray');await page.locator('#soundPreview').click();
 const count=await page.evaluate(()=>audio.stats().played);await page.locator('#cfgClose').click();release();
 await page.waitForFunction(()=>audio.stats().ready,null,{polling:20,timeout:5000});
 assert.equal(await page.evaluate(()=>audio.stats().played),count);
 const state=await page.evaluate(()=>{
  walls=[];P.x=200;P.y=200;P.a=0;E.x=900;E.y=500;E.curAlgo=null;E.hold=true;
  advance(.05);keys.fwd=true;advance(.05);const moving=audio.stats();keys.fwd=false;advance(.05);const stopped=audio.stats();
  keys.cw=true;advance(.05);const turning=audio.stats();togglePause();const pausedSound=audio.stats();advance(.05);
  return{moving,stopped,turning,pausedSound,after:audio.stats()};
 });
 assert.equal(state.moving.loops,1);assert.equal(state.stopped.loops,0);assert.equal(state.turning.loops,1);assert.equal(state.pausedSound.voices,0);assert.equal(state.after.loops,0);
});

test('sample mix stays bounded under simultaneous effects and actually renders without clipping',async t=>{
 const page=await pageFor(t);await fixture(page);
 const result=await page.evaluate(async()=>{
  const context=new OfflineAudioContext(2,44100*3,44100),mix=AITankAudio.create({volume:1},{contextFactory:()=>context,offline:true});await mix.unlock();
  const events=['cannon','double','shotgun','gatling','laser','deathray','bounce','deflect','shield','explosion','explosion','explosion','pickup','victory'];
  for(let i=0;i<events.length;i++)mix.play(events[i],{owner:'stress_'+i,pan:i%2?.6:-.6});
  const active=mix.stats(),buffer=await context.startRendering();let peak=0,energy=0;
  for(let channel=0;channel<buffer.numberOfChannels;channel++)for(const x of buffer.getChannelData(channel)){peak=Math.max(peak,Math.abs(x));energy+=x*x}
  return{active,peak,energy,finished:mix.stats()};
 });assert.ok(result.active.voices<=12);assert.ok(result.energy>1);assert.ok(result.peak<.98,JSON.stringify(result));assert.equal(result.finished.voices,0);
});

test('sound audition lists the complete bank and menu, death and round transitions stop motor loops',async t=>{
 const page=await pageFor(t);await fixture(page);await page.keyboard.press('x');await page.waitForFunction(()=>audio.stats().ready,null,{polling:20});
 assert.equal(await page.locator('#soundCue option').count(),23);
 const events=await page.evaluate(()=>{
  cfg.endpoint=location.origin+'/mock/messages';walls=[];P.x=200;P.y=200;P.a=0;E.x=900;E.y=500;E.hold=true;
  advance(.05);keys.fwd=true;advance(.05);const loop=audio.stats().loops;keys.fwd=false;
  const before=audio.stats().played;fire(P);const fired=audio.stats().played>before;
  const count=audio.stats().played;roundOver(E,{own:'P'});const result={loop,fired,ended:audio.stats().loops,resultPlayed:audio.stats().played>count};returnHome();return{...result,home:homeOpen,voices:audio.stats().voices};
 });assert.deepEqual(events,{loop:1,fired:true,ended:0,resultPlayed:true,home:true,voices:0});
 await page.locator('#homeSettings').click();await page.locator('#soundCue').selectOption('shield');
 const before=await page.evaluate(()=>audio.stats().played);await page.locator('#soundPreview').click();await page.waitForFunction(n=>audio.stats().played>n,before,{polling:20});
 await page.locator('#cfgClose').click();assert.equal(await page.evaluate(()=>homeOpen),true);
});

test('sample loading uses only local files and never enters the model request adapter',async t=>{
 const page=await pageFor(t);await fixture(page);
 await page.evaluate(()=>{window.modelAdapterCalls=0;window.fetch=async()=>{modelAdapterCalls++;throw new Error('audio entered AI transport')}});
 await page.keyboard.press('x');await page.waitForFunction(()=>audio.stats().ready,null,{polling:20,timeout:5000});
 assert.deepEqual(await page.evaluate(()=>({calls:modelAdapterCalls,loaded:audio.stats().loaded,engine:audio.stats().engine})),{calls:0,loaded:26,engine:'freesound-samples'});
});
