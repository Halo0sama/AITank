# 原创技能接口 v3

在 `custom-skills.js` 中用 `AITankWeapons.register(definition)` 注册。入口在游戏启动前加载；目前留空，不改变现有十种道具。内置技能 ID 不可覆盖，重复 ID 会报错。注册后自动加入随机道具池、设置说明、拾取、HUD、战报以及 AI 当前可见技能说明。

```js
AITankWeapons.register({
  id: 'prism_bolt', name: '棱光弹', icon: 'PR', color: '#99e9d5',
  ammo: 2, cooldown: 0.3,
  hint: '两发独立弹药的反弹光弹',
  aiDescription: '独立弹量；普通五个槽位占满仍可发射，存在自伤与友伤。',
  projectile: {speed: 260, radius: 4, life: 2}
});
```

这是示例，未在游戏中启用。`spawn: false` 可禁止随机掉落，但仍可通过 `weapons.spawnPickup(world, id, x, y)` 布置测试箱。技能只有实际出现在场上、装备中或相关战报里时才把描述传给模型，避免扩展整个技能库后增加每次请求的长度。

## 定义与生命周期

`id` 为 2–32 位小写字母、数字或下划线，以字母开头；`normal` 保留。必须提供 `name`、短 `icon`、六位十六进制 `color`、整数 `ammo`。`cooldown` 默认 0.4 秒。`slot` 默认 `weapon`；`buff` 需要正数 `duration`，拾取后先占待命武器槽（1 次启用），按开火后才调用 `equip` 并开始计时；启用后的增益可以与新武器同时存在，同种增益不可重复拾取。注册元数据只读。

武器提供 `projectile` 就能复用现有弹体物理：速度、半径、寿命，以及可选 `pierceWalls`、`pierceTanks`、`damage` 布尔值。默认反弹、伤害所有车体，包含发射者和队友；特殊弹体不占普通五槽，也不会归还普通槽位。关闭伤害可配合 `hit` 实现其他效果。护盾和整局胜负仍通过同一本地模拟结算。

| 回调 | 输入与职责 |
| --- | --- |
| `equip(ctx)` | 武器拾取时初始化状态；增益在按开火启用时初始化 |
| `canUse(ctx)` | 可选额外可用条件；返回布尔值，省略则检查剩余弹量；原有生存、冷却与锁定检查仍有效 |
| `fire(ctx)` | 主动释放；返回 `true` 或 `{consume: 1, cooldown: 0.3, keepEquipped: false}` 才视为成功；返回 `false` 拒绝 |
| `update({...ctx, dt})` | 有效战斗时间推进；持续技能逻辑在此运行 |
| `hit({...ctx, projectile, victim})` | 弹体实际接触坦克，随后由默认伤害规则处理 |
| `expire({...ctx, projectile})` | 弹体寿命耗尽；命中消失或穿出边界不调用此回调 |
| `cleanup(ctx)` | 弹量耗尽、增益到期、死亡清理、重新开局或关闭道具时释放自身临时状态 |

`ctx` 含真实 `world`、`tank`、独立 JSON `state`，以及 `spawn(options)`、`damage(victim, source)`、`finish()`、`emit(name, data)`。`spawn` 自动使用本技能弹体参数和坦克朝向；可传角度、横向偏移或弹体参数，归属与普通槽位属性由系统维护。`damage` 接入现有命中归属和胜负；`emit` 写入技能事件。最后一发消耗后武器会清理，已发射的弹体继续存在；弹体长期状态应存入弹体自身，不能依赖仍装备武器。`cleanup` 必须能撤销自身施加的修改。

主动回调应先判断能否成功，再产生效果，并返回合法消耗与冷却；系统不会回滚回调已产生的副作用。异常回调在本局停用该回调并记录故障，其余系统继续运行。回调是可信项目代码，不能写长循环、发网络请求或直接操作学习档案。模型生成的战术代码继续走隔离 Worker，不能注册或修改技能物理。

```js
// 增益示例：拾取待命，开火启用后释放武器槽；暂停时不倒计时。
AITankWeapons.register({
  id: 'signal_aura', name: '信号光环', icon: 'AU', color: '#aaccee',
  slot: 'buff', ammo: 0, duration: 5, spawn: false,
  equip: ({state}) => { state.elapsed = 0; },
  update: ({state, dt}) => { state.elapsed += dt; },
  cleanup: ({state}) => { state.elapsed = 0; }
});
```

## 预测、AI 与绘制

`guide({world, projectile, dt})` 返回 `{vx, vy}`，实际弹体、瞄准预览和防御预测共同使用。`forecast({world, projectiles, horizon, step})` 补充非弹体危险，返回 `[{time, points: [{x, y, radius, vx: 0, vy: 0}]}]`，时间使用绝对游戏秒。`advice({world, tank, state, target})` 可返回 `{score, reason}` 作为本地火控建议；它不强制模型服从评分。

上述预测/建议输入均为副本，必须纯计算，不能写游戏状态或依赖随机数、真实时间。默认弹体不需要另写 `forecast`；区域、光束等自定义伤害必须同时实现相应危险预测，保持实际碰撞与避弹判断一致。技能维护者负责这两部分规则一致。

`threatForecast({world,tank,viewerId,angle,readyIn,horizon,step})` 可描述“若此技能被使用”的潜在危险或防御区域，返回 `[{time,points:[{x,y,radius,defense:false}]}]`，使用绝对游戏秒。这是条件预演，不能消耗弹药、生成真实伤害或读取未来输入；输入为副本，仅影响 advisoryOnly 的 opponentThreats，不会进入实际来弹。每个点代表该帧的作用范围；`defense:true` 表示保护区域，不能当成直接伤害。范围、延迟和墙体遮挡需与本技能实际规则一致。主线程使用此回调，Worker 收到纯预演数据与查询接口，不执行扩展回调。

未提供 `threatForecast` 时，带 projectile 的技能按声明弹体参数作保守预演，并标注 `projectile_parameters_only/unknown`；没有通用弹体的专用技能标记 `unknown`。不要把缺少预测当作零威胁或必然安全。`weapons.definitions` 会注明是否提供 threatForecast，便于 AI 识别覆盖能力。

`drawProjectile({ctx, projectile, time, fx})` 返回 `true` 表示自己已画弹体，否则继续默认核心绘制。`drawWorld({ctx, world, time, fx})` 绘制技能附加层。绘制输入为副本，画笔会 save/restore。装饰效果应遵循 `fx.config` 的质量、强度和减少动态选项；关闭特效时仍需保留可判断危险的核心画面。通用开火、命中、拾取特效会自动使用注册颜色。

AI 实时输入中的 `weapons.definitions` 描述当前相关原创技能；`self.weapon` 包含独立 `ammo/capacity/state`，`self.skills` 和各坦克快照包含当前增益。流式指挥继续发拾取、移动、交战和开火意图；复盘能据此更新本地预测、战术、避弹与火控，逐帧计算继续在本地执行。

## 验证

`npm test` 与 `npm run test:browser` 使用模拟接口，不消耗真实额度。`tests/live-api.html` 是手动验收页：明确点击后才使用当前浏览器已保存的 API 配置，最多 3 次请求，在无存档权限的临时 iframe 中测试原创技能、指挥和算法更新，结束自动暂停；它不写真实学习档案。请求已生成的 token 不会因暂停退回。


## 道具图标与声音

可选 `glyph` 是 24×24 坐标系中的 SVG 路径字符串，例如 `glyph:'M12 2L22 12 12 22 2 12Z'`。它与 `color` 一起用于战场箱子和设置图例，二者共享同一路径；必须提供合法路径数据，最多 2048 字符，不接受 SVG 标签或 HTML。未提供时显示通用晶体图标和技能中文名。保留必填的短 `icon` 字段兼容旧注册协议，画面不再把这个缩写当作道具图形。

普通注册技能自动获得开火、拾取和激活声音；`fire` 使用独立武器事件，不能对每枚散弹或预测帧重复播放。声音由 `audio.js` 管理音量、暂停、空间声像和并发回收，不进入 AI 输入或改变物理随机数。自定义绘制仍应遵循减少动态设置。
