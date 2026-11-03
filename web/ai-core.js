/* Shared protocol and policy validation. Plain script also works with file://. */
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AITankAI = api;
})(typeof globalThis === 'object' ? globalThis : this, function() {
  'use strict';

  function jsonObjects(onObject) {
    let buffer = '', depth = 0, quoted = false, escaped = false;
    return {
      push(text) {
        for (const char of text) {
          if (!depth) {
            if (char !== '{') continue;
            buffer = ''; depth = 1; quoted = false; escaped = false;
            buffer = char;
            continue;
          }
          buffer += char;
          if (buffer.length > 16384) throw new Error('AI 指令过长');
          if (quoted) {
            if (escaped) escaped = false;
            else if (char === '\\') escaped = true;
            else if (char === '"') quoted = false;
          } else if (char === '"') quoted = true;
          else if (char === '{') depth++;
          else if (char === '}') depth--;
          if (!depth) {
            let object;
            try { object = JSON.parse(buffer); } catch { continue; }
            onObject(object);
          }
        }
      }
    };
  }

  function sseText(onText) {
    let buffer = '', data = [];
    function dispatch() {
      if (!data.length) return;
      const raw = data.join('\n'); data = [];
      if (raw === '[DONE]') return;
      const event = JSON.parse(raw);
      if (event.type === 'error') throw new Error(event.error?.message || 'AI 流错误');
      if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
        onText(event.delta.text || '');
      }
    }
    function line(text) {
      if (text.endsWith('\r')) text = text.slice(0, -1);
      if (!text) dispatch();
      else if (text.startsWith('data:')) data.push(text.slice(5).replace(/^ /, ''));
    }
    return {
      push(text) {
        buffer += text;
        if (buffer.length > 65536) throw new Error('AI 响应过长');
        let end;
        while ((end = buffer.indexOf('\n')) >= 0) {
          line(buffer.slice(0, end)); buffer = buffer.slice(end + 1);
        }
      },
      finish() { if (buffer) line(buffer); buffer = ''; dispatch(); }
    };
  }

  const NUMBER = '-?(?:\\d+(?:\\.\\d+)?|\\.\\d+)';
  function condition(when) {
    if (['always', 'bullet_threat', 'aligned', 'safe_shot', 'predicted_aligned', 'ammo_ready'].includes(when)) return true;
    if (/^enemy_(near|far)(?:_px|_cells)?:\d+(?:\.\d+)?$/.test(when)) {
      const value = Number(when.split(':')[1]); return value > 0 && value <= 2000;
    }
    if (/^random:(?:\d+(?:\.\d+)?|\.\d+)$/.test(when)) {
      const value = Number(when.slice(7)); return value >= 0 && value <= 1;
    }
    return false;
  }
  function normalizeCondition(when) {
    if (typeof when === 'string') {
      const old = when.match(/^enemy_(near|far):(\d+(?:\.\d+)?)$/);
      // Legacy LLMs used 3/4/6 to mean maze cells despite the pixel-only prompt.
      return old ? `enemy_${old[1]}_${Number(old[2]) <= 12 ? 'cells' : 'px'}:${old[2]}` : when;
    }
    if (when && typeof when === 'object') {
      for (const operator of ['all','any']) if (Array.isArray(when[operator]) && when[operator].length && when[operator].length <= 8) {
        return {[operator]:when[operator].map(normalizeCondition)};
      }
    }
    throw new Error('算法条件无效');
  }
  function validCondition(when,depth=0) {
    if (depth > 4) return false;
    if (typeof when === 'string') return condition(when);
    return when && ['all','any'].some(key=>Array.isArray(when[key]) && when[key].length > 0 && when[key].length <= 8 && when[key].every(value=>validCondition(value,depth+1)));
  }
  function policy(input, registry) {
    if (!input || !/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(input.name || '') ||
        ['constructor','prototype','__proto__','toString','hasOwnProperty'].includes(input.name)) {
      throw new Error('算法名无效');
    }
    if (registry[input.name]?.builtin) throw new Error('不能覆盖内置算法');
    if (!registry[input.name] && Object.values(registry).filter(a => !a.builtin).length >= 16) {
      throw new Error('自写算法已达 16 个');
    }
    if (!Array.isArray(input.steps) || !input.steps.length || input.steps.length > 16) {
      throw new Error('算法需要 1–16 个步骤');
    }
    const steps = input.steps.map(step => {
      if (!step || !validCondition(step.when)) {
        throw new Error('算法条件无效');
      }
      const actions = Array.isArray(step.do) ? step.do : [step.do];
      if (!actions.length || actions.length > 4) throw new Error('并行动作需要 1–4 项');
      for (const action of actions) {
        const angle = typeof action === 'string' && action.match(new RegExp('^(?:turn|face):(' + NUMBER + ')$'));
        if (!(typeof action === 'string' && (['fwd','back','fire','fire_safe','fire_predict','fire_ricochet','stop'].includes(action) ||
            (angle && Math.abs(Number(angle[1])) <= 360) || registry[action] || action === input.name))) {
          throw new Error('算法动作无效');
        }
      }
      if (step.priority !== undefined && (!Number.isInteger(step.priority) || step.priority < 0 || step.priority > 100)) throw new Error('优先级必须是 0–100 的整数');
      return {when:normalizeCondition(step.when), do:Array.isArray(step.do)?actions:actions[0], ...(step.priority!==undefined?{priority:step.priority}:{})};
    });
    const graph = Object.fromEntries(Object.entries(registry).map(([name, value]) => [name, value.composed || []]));
    graph[input.name] = steps;
    const visiting = new Set(), visited = new Set();
    function visit(name) {
      if (visiting.has(name)) throw new Error('算法不能循环调用');
      if (visited.has(name)) return;
      visiting.add(name);
      for (const step of graph[name] || []) for (const action of Array.isArray(step.do)?step.do:[step.do]) if (Object.hasOwn(graph, action)) visit(action);
      visiting.delete(name); visited.add(name);
    }
    visit(input.name);
    return {name:input.name, desc:String(input.desc || '').slice(0, 100),
      hint:String(input.hint || '').slice(0, 100), steps};
  }
  function codeProgram(input) {
    if (!input || !/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(input.name || '') || ['constructor','prototype','__proto__'].includes(input.name)) throw new Error('算法名无效');
    if (typeof input.code !== 'string' || !input.code.trim() || input.code.length > 12000) throw new Error('代码需要 1–12000 个字符');
    return {name:input.name,desc:String(input.desc||'').slice(0,200),code:input.code};
  }
  function intent(value,width,height) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('代码算法必须返回动作对象');
    const result={};
    if (value.move!==undefined) {if(!Number.isFinite(value.move)||Math.abs(value.move)>1)throw new Error('move 必须介于 -1 和 1');result.move=value.move}
    if (value.turn!==undefined) {if(!Number.isFinite(value.turn)||Math.abs(value.turn)>Math.PI*8)throw new Error('turn 必须是有限的弧度');result.turn=value.turn}
    if (value.fire!==undefined) {if(typeof value.fire!=='boolean')throw new Error('fire 必须为布尔值');result.fire=value.fire}
    if (value.prediction!==undefined) {
      const point=value.prediction;
      if(!point||!Number.isFinite(point.x)||!Number.isFinite(point.y)||point.x<0||point.y<0||point.x>width||point.y>height)throw new Error('预测位置超出战场');
      result.prediction={x:point.x,y:point.y};
    }
    if(value.pickupId!==undefined){
      if(!Number.isSafeInteger(value.pickupId)||value.pickupId<=0)throw new Error('pickupId 必须是有效箱子 ID');
      result.pickupId=value.pickupId;
    }
    if(value.moveTo!==undefined){
      const point=value.moveTo;
      if(!point||!Number.isFinite(point.x)||!Number.isFinite(point.y)||point.x<0||point.y<0||point.x>width||point.y>height)throw new Error('移动目标超出战场');
      if(value.pickupId!==undefined)throw new Error('每次只能选择一个移动或拾取目标');
      result.moveTo={x:point.x,y:point.y};
    }
    return result;
  }

  function memories(previous, additions) {
    return [...new Set([...previous, ...additions].filter(x => typeof x === 'string')
      .map(x => x.trim().slice(0, 240)).filter(Boolean))].slice(-24);
  }
  function evolution(saved) {
    const number = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;
    const state = saved && typeof saved === 'object' ? saved : {};
    return {version:1, completed:number(state.completed), reviews:number(state.reviews),
      generation:number(state.generation), aiWins:number(state.aiWins), selfDeaths:number(state.selfDeaths),
      activePolicy:typeof state.activePolicy === 'string' ? state.activePolicy.slice(0,40) : null,
      activePredictor:typeof state.activePredictor === 'string' ? state.activePredictor.slice(0,40) : null,
      activeReflex:typeof state.activeReflex === 'string' ? state.activeReflex.slice(0,40) : null,
      activeGunnery:typeof state.activeGunnery === 'string' ? state.activeGunnery.slice(0,40) : null,
      lastRejection:state.lastRejection&&typeof state.lastRejection.reason==='string'?{round:number(state.lastRejection.round),reason:state.lastRejection.reason.slice(0,240)}:null,
      history:Array.isArray(state.history) ? state.history.filter(x => x && typeof x === 'object' &&
        Number.isSafeInteger(x.generation) && typeof x.aiWon === 'boolean').slice(-30) : []};
  }
  return {jsonObjects, sseText, policy, condition, normalizeCondition, codeProgram, intent, memories, evolution};
});
