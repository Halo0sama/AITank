const test=require('node:test'),assert=require('node:assert/strict');
const Art=require('../presentation.js'),Audio=require('../audio.js');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');

test('treads follow signed physical travel and opposite sides rotate during a pivot',()=>{
 const tracks=Art.createTracks(),t={id:'P',x:100,y:100,a:0,alive:true};tracks.reset([t]);
 t.x+=10;tracks.update([t]);const forward=tracks.snapshot('P');assert.equal(forward.left,10);assert.equal(forward.right,10);
 t.x-=4;tracks.update([t]);assert.equal(tracks.snapshot('P').left,6);
 t.a=.2;tracks.update([t]);const pivot=tracks.snapshot('P');assert.ok(pivot.left>6);assert.ok(pivot.right<6);
 const unchanged=tracks.snapshot('P');tracks.update([t]);assert.deepEqual(tracks.snapshot('P'),unchanged);
});
test('teleports, dead tanks and reset never fabricate treadmill motion or mutate physics',()=>{
 const tracks=Art.createTracks(),t={id:'E',x:100,y:100,a:0,alive:true};tracks.reset([t]);t.x=700;tracks.update([t]);assert.equal(tracks.snapshot('E').left,0);
 t.alive=false;t.x+=10;const before={...t};tracks.update([t]);assert.equal(tracks.snapshot('E').left,0);assert.deepEqual(t,before);
 const exposed=tracks.snapshot('E');exposed.left=99;assert.equal(tracks.snapshot('E').left,0);tracks.reset([t]);assert.equal(tracks.phase('E',-1),0);
});
test('every weapon has a distinct graphic and original skills can supply a path',()=>{
 assert.equal(Object.keys(Art.glyphs).length,11);assert.equal(new Set(Object.values(Art.glyphs)).size,11);
 assert.equal(Art.glyph('unknown'),Art.glyphs.original);assert.equal(Art.glyph('custom',{glyph:'M2 2L20 20'}),'M2 2L20 20');
});
test('audio preferences tolerate invalid data and bound the actual gain',()=>{
 assert.deepEqual(Audio.settings(null),Audio.defaults);assert.deepEqual(Audio.settings({enabled:false,volume:5}),{enabled:false,volume:1});
 assert.equal(Audio.settings({volume:-1}).volume,0);assert.equal(Audio.settings({volume:NaN}).volume,.55);assert.equal(Audio.settings({enabled:'yes'}).enabled,true);
});
test('muted and unsupported audio fail quietly without creating queues or changing game randomness',async()=>{
 const saved=Math.random;Math.random=()=>{throw new Error('sound must not use game randomness')};
 try{
  const sound=Audio.create({enabled:false});assert.equal(await sound.unlock(),false);assert.equal(sound.play('fire'),false);assert.equal(sound.stats().ready,false);
  sound.configure({enabled:true});assert.equal(await sound.unlock(),false);assert.equal(sound.stats().unavailable,true);assert.equal(sound.stats().voices,0);sound.stopAll();
 }finally{Math.random=saved}
});

test('the shipped sample bank covers every combat cue, uses CC0 sources and matches its measured files',()=>{
 const folder=path.join(__dirname,'..','assets','audio'),manifest=JSON.parse(fs.readFileSync(path.join(folder,'manifest.json'))),sources=JSON.parse(fs.readFileSync(path.join(folder,'sources.json')));
 const known=new Set(sources.map(s=>s.key));assert.equal(manifest.clips.length,26);assert.ok(sources.every(s=>s.license==='CC0'&&s.sourcePage.startsWith('https://freesound.org/people/')));
 assert.deepEqual(Audio.files.slice().sort(),manifest.clips.map(c=>c.id).sort());
 for(const clip of manifest.clips){
  const file=fs.readFileSync(path.join(folder,clip.file));assert.equal(crypto.createHash('sha256').update(file).digest('hex'),clip.sha256);
  assert.ok(clip.seconds>=.06&&clip.seconds<=1.1);assert.ok(clip.peak<.95&&clip.rms>.001);assert.ok(clip.sources.every(s=>known.has(s)));
 }
 assert.ok(manifest.clips.reduce((n,c)=>n+c.bytes,0)<150000);
 assert.equal(manifest.style,'soft-arcade');assert.ok(manifest.clips.filter(c=>!c.loop).every(c=>c.seconds<=.6));
 assert.ok(!['fs:448002','fs:163455','fs:171971','fs:186934','fs:30932','fs:560510'].some(key=>known.has(key)));
 const ids=['normal','double','shotgun','gatling','laser','homing','remote','frag','mine','deathray','shield'];
 assert.equal(new Set(ids.map(weapon=>Audio.cueFor('fire',{weapon}))).size,ids.length);
 assert.equal(Audio.cueFor('fire',{weapon:'future_original_skill'}),'cannon');assert.equal(Audio.cueFor('unknown'),null);
});

function audioContext(){
 const state={starts:0,stops:0};
 const param=()=>({value:0,setTargetAtTime(){},setValueAtTime(){},cancelScheduledValues(){}});
 const node=()=>({connect(){},disconnect(){}});
 const context={currentTime:0,state:'running',destination:{},createGain:()=>({...node(),gain:param()}),
  createDynamicsCompressor:()=>({...node(),threshold:param(),knee:param(),ratio:param(),attack:param(),release:param()}),
  createStereoPanner:()=>({...node(),pan:param()}),decodeAudioData:async()=>({length:4410,duration:.1}),
  createBufferSource:()=>({...node(),playbackRate:param(),start(){state.starts++},stop(){state.stops++}})};
 return{context,state};
}
test('a pending sample load never queues a shot that can leak through pause, and a failed load can retry',async()=>{
 const {context,state}=audioContext();let release,attempt=0;
 const barrier=new Promise(resolve=>release=resolve);
 const audio=Audio.create({}, {contextFactory:()=>context,assetLoader:async()=>{attempt++;await barrier;if(attempt<=Audio.files.length)throw new Error('temporary unavailable');return new ArrayBuffer(4)}});
 assert.equal(audio.play('fire'),false);const loading=audio.unlock();audio.setBlocked(true);release();await loading;
 assert.equal(audio.stats().failed,26);assert.equal(state.starts,0);assert.equal(audio.play('fire'),false);
 await audio.unlock();assert.equal(audio.stats().loaded,26);assert.equal(audio.stats().voices,0);assert.equal(state.starts,0);
 audio.setBlocked(false);assert.equal(state.starts,0);assert.equal(audio.play('fire'),true);assert.equal(state.starts,1);
 audio.configure({enabled:false});assert.equal(audio.stats().voices,0);assert.equal(state.stops,1);assert.equal(audio.play('fire'),false);
});
test('track sound follows actual physical travel, supports independent owners and stops on death or pause',async()=>{
 const {context,state}=audioContext(),audio=Audio.create({}, {contextFactory:()=>context,assetLoader:async()=>new ArrayBuffer(4)});
 await audio.unlock();const tanks=[{id:'P',x:100,y:100,a:0,alive:true},{id:'E',x:800,y:100,a:0,alive:true}];
 audio.updateMotion(tanks,.05);assert.equal(audio.stats().loops,0);
 tanks[0].x+=5;tanks[1].a+=.15;audio.updateMotion(tanks,.05);assert.equal(audio.stats().loops,2);
 const starts=state.starts;audio.updateMotion(tanks,.05);assert.equal(audio.stats().loops,0);assert.equal(state.starts,starts);
 tanks[0].x+=5;audio.updateMotion(tanks,.05);assert.equal(audio.stats().loops,1);audio.stopOwner('P');assert.equal(audio.stats().loops,0);
 tanks[1].x+=5;audio.updateMotion(tanks,.05);assert.equal(audio.stats().loops,1);audio.setBlocked(true);assert.equal(audio.stats().voices,0);assert.equal(audio.stats().loops,0);
 audio.updateMotion(tanks,.05);assert.equal(audio.stats().loops,0);audio.setBlocked(false);audio.updateMotion(tanks,.05);assert.equal(audio.stats().loops,0);
});
