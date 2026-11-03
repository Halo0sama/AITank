(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.AITankArt=api})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  // One vector language for crates, the HUD legend and future original skills.
  const glyphs=Object.freeze({
    laser:'M3 8h6v8H3z M10 12h12 M13 8l2 4-2 4 M19 8v2 M19 14v2',
    double:'M3 7h5v10H3z M8 7h13v4H8 M8 13h13v4H8 M18 7v4 M18 13v4',
    shotgun:'M3 14l7-4 2 4-7 4z M13 9l3-3 M15 12l4-1 M14 16l4 2 M19 4h1 M21 10h1 M20 19h1',
    homing:'M5 18l3-6 6-6 5-1-1 5-6 6z M8 12l4 4 M7 17l-3 3 M8 19l-1 2 M13 4a8 8 0 0 1 8 8 M18 2v3 M20 9h3',
    mine:'M4 14c0-3 16-3 16 0v3c0 3-16 3-16 0z M9 11V7h6v4 M12 7V3 M4 10l-2-2 M20 10l2-2 M7 21h10 M10 15h4',
    shield:'M12 2l8 3v6c0 5-5 9-8 11-3-2-8-6-8-11V5z M8 11l3 3 5-6',
    gatling:'M3 8h4v10H3z M7 6h11l3 3v6l-3 3H7z M8 10h12 M8 14h12 M17 6v12 M2 12H1',
    frag:'M9 7V4h6v4 M15 4l4-2 2 3-4 2 M8 9c-6 3-4 13 4 13s10-10 4-13z M9 13l6 5 M8 17l7-4 M2 4l2 2 M21 12h2',
    deathray:'M2 9h5v6H2z M8 12h14 M12 4l-2 6 4-1-2 6 M17 3v6 M17 15v6 M21 7l-2 2 M21 17l-2-2',
    remote:'M13 7l3-5 3 5v10l-3 3-3-3z M13 13l-3 5h3 M19 13l3 5h-3 M16 20v3 M3 12a6 6 0 0 1 6-6 M5 13a4 4 0 0 1 4-4 M7 14a2 2 0 0 1 2-2',
    original:'M12 2l9 10-9 10L3 12z M12 7v10 M7 12h10'
  });
  const paths=new Map();
  function glyph(type,item={}){return item.glyph||glyphs[type]||glyphs.original}
  function drawIcon(ctx,type,x,y,size,color,item={}){
    const data=glyph(type,item);let path=paths.get(data);
    if(!path){try{path=new Path2D(data)}catch{path=new Path2D(glyphs.original)}paths.set(data,path)}
    ctx.save();ctx.translate(x-size/2,y-size/2);ctx.scale(size/24,size/24);
    ctx.strokeStyle=color;ctx.lineWidth=1.8;ctx.lineCap='round';ctx.lineJoin='round';ctx.stroke(path);ctx.restore();
  }
  function iconElement(type,item={}){
    const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg'),path=document.createElementNS(ns,'path');
    svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');svg.setAttribute('focusable','false');svg.classList.add('weaponGlyph');
    path.setAttribute('d',glyph(type,item));path.setAttribute('fill','none');path.setAttribute('stroke','currentColor');path.setAttribute('stroke-width','1.8');path.setAttribute('stroke-linecap','round');path.setAttribute('stroke-linejoin','round');svg.append(path);return svg;
  }
  function createTracks(){
    const states=new Map(),wrap=v=>((v%7)+7)%7;
    function reset(tanks=[]){states.clear();for(const t of tanks)states.set(t.id,{x:t.x,y:t.y,a:t.a,left:0,right:0})}
    function update(tanks=[]){
      for(const t of tanks){const old=states.get(t.id);if(!old){states.set(t.id,{x:t.x,y:t.y,a:t.a,left:0,right:0});continue}
        const dx=t.x-old.x,dy=t.y-old.y,da=Math.atan2(Math.sin(t.a-old.a),Math.cos(t.a-old.a)),heading=old.a+da*.5;
        if(t.alive&&Math.hypot(dx,dy)<80&&Math.abs(da)<Math.PI/2){
          const distance=dx*Math.cos(heading)+dy*Math.sin(heading);
          old.left+=distance+da*17;old.right+=distance-da*17;
        }
        old.x=t.x;old.y=t.y;old.a=t.a;
      }
    }
    return{reset,update,phase:(id,side,scale=1)=>wrap(((side<0?states.get(id)?.left:states.get(id)?.right)||0)/scale),snapshot:id=>states.has(id)?{...states.get(id)}:null};
  }
  return{glyphs,glyph,drawIcon,iconElement,createTracks};
});
