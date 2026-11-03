const test = require('node:test');
const assert = require('node:assert/strict');
const AI = require('../ai-core.js');

test('SSE and nested commands survive arbitrary network and UTF-8 splits', () => {
  const commands = [{cmd:'face',deg:45}, {set_algo:{name:'learned',desc:'避开 {墙} 与 "炮弹"',steps:[{when:'always',do:'roam'}]}}, {cmd:'stop'}];
  const text = commands.map(value => JSON.stringify(value)).join('\n');
  const event = 'event: content_block_delta\r\ndata: ' + JSON.stringify({type:'content_block_delta',delta:{type:'text_delta',text}}) + '\r\n\r\n';
  const bytes = new TextEncoder().encode(event);
  for (const size of [1,2,7,31,bytes.length]) {
    const received = [], objects = AI.jsonObjects(value => received.push(value));
    const parser = AI.sseText(value => objects.push(value)), decoder = new TextDecoder();
    for (let i=0;i<bytes.length;i+=size) parser.push(decoder.decode(bytes.slice(i,i+size),{stream:true}));
    parser.push(decoder.decode()); parser.finish();
    assert.deepEqual(received,commands);
  }
});

test('multiple text deltas and unterminated final SSE event are consumed', () => {
  const received=[], objects=AI.jsonObjects(value=>received.push(value)), parser=AI.sseText(text=>objects.push(text));
  for (const text of ['{"cmd":','"fire"}\n{"cmd":"stop"}']) parser.push('data: '+JSON.stringify({type:'content_block_delta',delta:{type:'text_delta',text}})+'\n\n');
  parser.push('data: [DONE]');parser.finish();
  assert.deepEqual(received,[{cmd:'fire'},{cmd:'stop'}]);
});

test('SSE API errors propagate instead of silently ignoring them',()=>{
  const parser=AI.sseText(()=>{});
  assert.throws(()=>parser.push('data: {"type":"error","error":{"message":"rate limit"}}\n\n'),/rate limit/);
});

test('malformed complete command does not discard the next valid command',()=>{
  const received=[],parser=AI.jsonObjects(value=>received.push(value));
  parser.push('```json\n{invalid}\n{"cmd":"stop"}\n```');
  assert.deepEqual(received,[{cmd:'stop'}]);
  assert.throws(()=>parser.push('{"name":"'+'x'.repeat(17000)),/过长/);
});

const registry=()=>Object.assign(Object.create(null),{roam:{builtin:true},dodge_bullets:{builtin:true},chase_and_fire:{builtin:true}});
const policy=(name,action)=>({name,steps:[{when:'always',do:action}]});
test('direct and indirect recursive policies are rejected',()=>{
  const r=registry();
  assert.throws(()=>AI.policy(policy('attack','attack'),r),/循环/);
  r.first={builtin:false,composed:[{when:'always',do:'second'}]};
  r.second={builtin:false,composed:[{when:'always',do:'roam'}]};
  assert.throws(()=>AI.policy(policy('second','first'),r),/循环/);
});
test('policy inputs reject unknown actions, prototype names and builtin overrides',()=>{
  const r=registry();
  for(const name of ['__proto__','constructor','roam'])assert.throws(()=>AI.policy(policy(name,'roam'),r));
  assert.throws(()=>AI.policy(policy('attack','made_up'),r),/动作/);
  assert.throws(()=>AI.policy(policy('attack','turn:999999999'),r),/动作/);
  assert.throws(()=>AI.policy({name:'attack',steps:[]},r),/步骤/);
});
test('decimal probabilities work and unknown conditions are invalid',()=>{
  for(const condition of ['random:0','random:0.5','random:.25','random:1','enemy_near:250.5'])assert.equal(AI.condition(condition),true);
  for(const condition of ['random:2','random:-1','enemy_near:0','enemy_far:99999','typo',''])assert.equal(AI.condition(condition),false);
});
test('valid conditional policy can delegate to another safe policy',()=>{
  const r=registry();r.first={builtin:false,composed:[{when:'always',do:'roam'}]};
  const value=AI.policy({name:'attack',steps:[{when:'bullet_threat',do:'dodge_bullets'},{when:'random:0.5',do:'first'},{when:'always',do:'face:90'}]},r);
  assert.equal(value.steps.length,3);
});
test('memories remain bounded, deduplicated strings across reviews',()=>{
  assert.deepEqual(AI.memories(['avoid walls'],[' avoid walls ',null,12,'new lesson']),['avoid walls','new lesson']);
  assert.equal(AI.memories([],Array.from({length:100},(_,i)=>String(i))).length,24);
});
test('corrupt learning metadata cannot break counters or history',()=>{
  const state=AI.evolution({completed:-1,generation:'oops',aiWins:NaN,history:[null,{}, {generation:1,aiWon:true}]});
  assert.equal(state.completed,0);assert.equal(state.generation,0);assert.equal(state.aiWins,0);assert.equal(state.history.length,1);
});

test('explicit units and legacy cell-valued distances are normalized without changing pixel distances',()=>{
  assert.equal(AI.normalizeCondition('enemy_near:3'),'enemy_near_cells:3');
  assert.equal(AI.normalizeCondition('enemy_far:250'),'enemy_far_px:250');
  const value=AI.policy({name:'units',steps:[{when:{all:['enemy_near:3','ammo_ready']},do:['dodge_bullets','fire_safe'],priority:100}]},registry());
  assert.deepEqual(value.steps[0].when,{all:['enemy_near_cells:3','ammo_ready']});
  assert.equal(value.steps[0].priority,100);
});
test('parallel rules reject invalid priorities and cyclic delegation in action arrays',()=>{
  assert.throws(()=>AI.policy({name:'parallel',steps:[{when:'always',do:['roam','parallel']}]},registry()),/循环/);
  assert.throws(()=>AI.policy({name:'parallel',steps:[{when:'always',do:['roam'],priority:101}]},registry()),/优先级/);
  assert.throws(()=>AI.policy({name:'parallel',steps:[{when:{all:['invalid']},do:'roam'}]},registry()),/条件/);
});
test('code output only allows bounded movement, finite orientation and valid prediction coordinates',()=>{
  assert.deepEqual(AI.intent({move:.5,turn:Math.PI,fire:false,prediction:{x:200,y:300}},1100,700),{move:.5,turn:Math.PI,fire:false,prediction:{x:200,y:300}});
  for(const value of [{move:10},{turn:Infinity},{fire:1},{prediction:{x:NaN,y:0}},{prediction:{x:2000,y:0}}])assert.throws(()=>AI.intent(value,1100,700));
  assert.throws(()=>AI.codeProgram({name:'attack',code:'x'.repeat(12001)}),/代码/);
});

test('learned objectives validate pickup IDs and movement goals independently of motor outputs',()=>{
  assert.deepEqual(AI.intent({pickupId:12,fire:false},1100,700),{pickupId:12,fire:false});
  assert.deepEqual(AI.intent({moveTo:{x:300,y:400},fire:true},1100,700),{moveTo:{x:300,y:400},fire:true});
  for(const value of [{pickupId:0},{pickupId:1.2},{pickupId:'1'},{moveTo:{x:-1,y:300}},{moveTo:{x:NaN,y:0}},{moveTo:{x:300,y:900}},{pickupId:1,moveTo:{x:300,y:400}}])assert.throws(()=>AI.intent(value,1100,700));
});
