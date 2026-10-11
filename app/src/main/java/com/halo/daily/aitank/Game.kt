package com.halo.daily.aitank

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.sqrt
import kotlin.random.Random

/* ============ 经典 Tank Trouble 引擎 ============
 * 程序生成随机迷宫（密度+连通修复，每回合不同）
 * 坦克：车体旋转 + 前进/后退（经典双轴操控）
 * 子弹：1.5x 车速、反弹无上限、15s 寿命、可炸死自己
 */

enum class Dir { UP, DOWN, LEFT, RIGHT }

data class Cell(val c: Int, val r: Int)

data class WallSeg(val x: Float, val y: Float, val w: Float, val h: Float)

class Bullet(var x: Float, var y: Float, var vx: Float, var vy: Float, val owner: Int) {
    var life = 15f
    var alive = true
}

class Explosion(var x: Float, var y: Float, var life: Float)

/** 控制工具调用：rotate(度) thrust(ms,dir) fire wait(ms) run(自定义工具名) */
data class PlanStep(val tool: String, val num: Float = 0f, val dir: Int = 1, val name: String = "", val depth: Int = 0)

class Brain {
    var status = "未启动"
    var inFlight = false
}

class Tank(val id: Int, val name: String, var isBot: Boolean) {
    var x = 0f
    var y = 0f
    var bodyAngle = 0f        // 弧度；0=朝右，顺时针为正（屏幕系）
    var alive = true
    var score = 0
    var liveBullets = 0
    var fireCd = 0f
    var respawnIn = 0f
    var invuln = 0f
    var colorIdx = 0
    // 玩家输入（键盘/按钮按住生效）
    var thrust = 0f    // -1 后退 1 前进 0 停
    var rotDir = 0f    // -1 逆时针 1 顺时针 0
    // AI 计划队列（DeepSeek 工具调用序列）
    val planQueue = ArrayDeque<PlanStep>()
    var cur: PlanStep? = null
    var stepMs = 0f
    var stepThrust = 1
    var stepRotTotal = 0f
    var stepRotDone = 0f
    // 大脑状态
    val brain = Brain()
    // 自主游走（大脑计划空档时的本地行为）
    var wpX = 0f
    var wpY = 0f
    var wpTimer = 0f
}

class Game {
    companion object {
        const val COLS = 7
        const val ROWS = 8
        const val CELL = 100f
        const val WALL_T = 14f
        const val FIELD_W = COLS * CELL
        const val FIELD_H = ROWS * CELL
        const val TANK_SPEED = 70f
        const val BULLET_SPEED = 105f   // 1.5x 车速
        const val TANK_R = 26f
        const val BULLET_R = 6f
        const val MAGAZINE = 5
        const val FIRE_CD = 0.4f
        const val BULLET_LIFE = 15f
        const val ROT_SPEED = 110f      // 度/秒（转向有分量，不至于原地疯转）
        fun angleDiff(a: Float, b: Float): Float {
            var d = a - b
            val twoPi = (2 * PI).toFloat()
            while (d > PI.toFloat()) d -= twoPi
            while (d < -PI.toFloat()) d += twoPi
            return d
        }
    }

    var vWalls: Array<BooleanArray> = Array(COLS + 1) { BooleanArray(ROWS) { false } }
    var hWalls: Array<BooleanArray> = Array(COLS) { BooleanArray(ROWS + 1) { false } }
    var wallRects = listOf<WallSeg>()
    val tanks = mutableListOf<Tank>()
    val bullets = mutableListOf<Bullet>()
    val explosions = mutableListOf<Explosion>()
    var round = 1
    var intermission = 0f
    var paused = false              // 复盘挂起
    var userPaused = false          // 玩家手动暂停
    var events = 0L
    var time = 0f
    var lastKillText = ""
    var reviewPending = false
    var lastRoundLog = ""
    var autopilot = false          // AI 代打玩家（自主演示）
    val roundLog = mutableListOf<String>()
    var externalTools: Map<String, List<PlanStep>> = emptyMap()

    var aiPosture: String = "engage"   // LLM 指挥官战略姿态：engage/evade/roam
    var aiPostureComment = ""

    fun setPosture(p: String) {
        aiPosture = when (p) { "evade" -> "evade"; "roam" -> "roam"; else -> "engage" }
    }

    fun player(): Tank = tanks.first { it.id == 0 }
    fun bots(): List<Tank> = tanks.filter { it.id != 0 }

    init { newRound() }

    /* ---- 程序生成随机迷宫（密度 + 连通修复） ---- */
    private fun generateMaze() {
        val vv = Array(COLS + 1) { BooleanArray(ROWS) { false } }
        val hh = Array(COLS) { BooleanArray(ROWS + 1) { false } }
        for (r in 0 until ROWS) { vv[0][r] = true; vv[COLS][r] = true }
        for (c in 0 until COLS) { hh[c][0] = true; hh[c][ROWS] = true }
        val density = 0.32f
        for (c in 1 until COLS) for (r in 0 until ROWS) if (Random.nextFloat() < density) vv[c][r] = true
        for (c in 0 until COLS) for (r in 1 until ROWS) if (Random.nextFloat() < density) hh[c][r] = true
        var guard = 0
        while (regions(vv, hh) > 1 && guard++ < 400) {
            if (Random.nextBoolean()) {
                val c = Random.nextInt(1, COLS)
                val r = Random.nextInt(0, ROWS)
                if (vv[c][r]) vv[c][r] = false
            } else {
                val c = Random.nextInt(0, COLS)
                val r = Random.nextInt(1, ROWS)
                if (hh[c][r]) hh[c][r] = false
            }
        }
        vWalls = vv; hWalls = hh
        buildRects()
    }

    private fun regions(vv: Array<BooleanArray>, hh: Array<BooleanArray>): Int {
        val seen = Array(COLS) { BooleanArray(ROWS) }
        var count = 0
        fun neighbors(c: Int, r: Int): List<Cell> {
            val out = mutableListOf<Cell>()
            if (c > 0 && !vv[c][r]) out.add(Cell(c - 1, r))
            if (c < COLS - 1 && !vv[c + 1][r]) out.add(Cell(c + 1, r))
            if (r > 0 && !hh[c][r]) out.add(Cell(c, r - 1))
            if (r < ROWS - 1 && !hh[c][r + 1]) out.add(Cell(c, r + 1))
            return out
        }
        for (c in 0 until COLS) for (r in 0 until ROWS) {
            if (seen[c][r]) continue
            count++
            val stack = mutableListOf(Cell(c, r))
            seen[c][r] = true
            while (stack.isNotEmpty()) {
                val cur = stack.removeAt(stack.size - 1)
                for (n in neighbors(cur.c, cur.r)) {
                    if (!seen[n.c][n.r]) { seen[n.c][n.r] = true; stack.add(n) }
                }
            }
        }
        return count
    }

    private fun buildRects() {
        val t = WALL_T
        val rects = mutableListOf<WallSeg>()
        for (c in 0..COLS) for (r in 0 until ROWS) {
            if (vWalls[c][r]) rects.add(WallSeg(c * CELL - t / 2, r * CELL - t / 2, t, CELL + t))
        }
        for (c in 0 until COLS) for (r in 0..ROWS) {
            if (hWalls[c][r]) rects.add(WallSeg(c * CELL - t / 2, r * CELL - t / 2, CELL + t, t))
        }
        wallRects = rects
    }

    fun newRound() {
        generateMaze()
        bullets.clear(); explosions.clear()
        if (tanks.isEmpty()) {
            tanks.add(Tank(0, "玩家", false))
            tanks.add(Tank(1, "AI", true))
        }
        // 随机出生：远离彼此的空闲位置
        var ax = CELL * 1.5f; var ay = CELL * 1.5f
        var ex = FIELD_W - CELL * 1.5f; var ey = FIELD_H - CELL * 1.5f
        var tries = 0
        while (tries++ < 30) {
            val c = Random.nextInt(0, COLS); val r = Random.nextInt(0, ROWS)
            val x = (c + 0.5f) * CELL; val y = (r + 0.5f) * CELL
            if (blocked(x, y)) continue
            if (sqrt((x - ex) * (x - ex) + (y - ey) * (y - ey)) > 300f) { ax = x; ay = y; break }
        }
        tanks[0].x = ax; tanks[0].y = ay
        tanks[1].x = ex; tanks[1].y = ey
        tanks.forEachIndexed { i, t ->
            t.alive = true; t.respawnIn = 0f
            t.fireCd = 0f; t.liveBullets = 0
            t.bodyAngle = Random.nextFloat() * 2f * PI.toFloat()
            t.planQueue.clear(); t.cur = null
            t.thrust = 0f; t.rotDir = 0f
        }
        roundLog.add("[round $round 开始] 新迷宫")
    }

    fun setTools(tools: Map<String, List<PlanStep>>) { externalTools = tools }

    /* ---- 碰撞 ---- */
    private fun blocked(x: Float, y: Float): Boolean {
        if (x < TANK_R || y < TANK_R || x > FIELD_W - TANK_R || y > FIELD_H - TANK_R) return true
        for (w in wallRects) {
            if (x + TANK_R > w.x && x - TANK_R < w.x + w.w && y + TANK_R > w.y && y - TANK_R < w.y + w.h) return true
        }
        return false
    }

    private fun bulletBlocked(x: Float, y: Float): Boolean {
        if (x < BULLET_R || y < BULLET_R || x > FIELD_W - BULLET_R || y > FIELD_H - BULLET_R) return true
        for (w in wallRects) {
            if (x + BULLET_R > w.x && x - TANK_R < w.x + w.w && y + BULLET_R > w.y && y - TANK_R < w.y + w.h) return true
        }
        return false
    }

    /* ---- 主更新 ---- */
    fun update(dt: Float) {
        if (paused || userPaused) return
        time += dt
        if (intermission > 0f) {
            intermission -= dt
            if (intermission <= 0f) newRound()
            tickFx(dt)
            return
        }
        for (t in tanks) {
            if (!t.alive) {
                t.respawnIn -= dt
                if (t.respawnIn <= 0f) respawn(t)
                continue
            }
            t.fireCd = (t.fireCd - dt).coerceAtLeast(0f)
            t.invuln = (t.invuln - dt).coerceAtLeast(0f)
            if (t.isBot || (t.id == 0 && autopilot)) {
                val dodge = bulletDodgeDir(t)
                if (dodge != null) {
                    t.cur = null
                    t.bodyAngle = dodgeAngle(t.bodyAngle, dodge)
                    moveTank(t, cos(t.bodyAngle) * TANK_SPEED * dt, sin(t.bodyAngle) * TANK_SPEED * dt)
                } else if (t.planQueue.isEmpty() && t.cur == null) {
                    autonomousBehavior(t, dt)
                } else {
                    tickPlan(t, dt)
                }
            } else {
                t.bodyAngle += t.rotDir * ROT_SPEED * dt
                if (t.thrust != 0f) {
                    val d = if (t.thrust > 0f) 1f else -0.65f
                    moveTank(t, cos(t.bodyAngle) * TANK_SPEED * d * dt, sin(t.bodyAngle) * TANK_SPEED * d * dt)
                }
            }
        }
        updateBullets(dt)
        tickFx(dt)
        pushApart()
    }

    private fun pushApart() {
        for (i in tanks.indices) for (j in i + 1 until tanks.size) {
            val a = tanks[i]; val b = tanks[j]
            if (!a.alive || !b.alive) continue
            val dx = b.x - a.x; val dy = b.y - a.y
            val d = sqrt(dx * dx + dy * dy)
            if (d in 0.01f..(TANK_R * 2)) {
                val push = (TANK_R * 2 - d) / 2
                val nx = dx / d; val ny = dy / d
                a.x -= nx * push; a.y -= ny * push
                b.x += nx * push; b.y += ny * push
            }
        }
    }

    /* ---- AI 计划执行器（工具调用序列） ---- */
    private fun tickPlan(t: Tank, dt: Float) {
        if (t.cur == null) {
            val next = t.planQueue.removeFirstOrNull() ?: return
            if (next.tool == "run") {
                val steps = externalTools[next.name]
                if (steps != null && next.depth < 2) {
                    for (i in steps.indices.reversed()) t.planQueue.addFirst(steps[i].copy(depth = next.depth + 1))
                }
                return
            }
            t.cur = next; t.stepMs = 0f
            when (next.tool) {
                "rotate" -> { t.stepRotTotal = abs(next.num); t.stepRotDone = 0f }
                "thrust" -> t.stepThrust = next.dir
            }
        }
        val s = t.cur ?: return
        val rad = t.bodyAngle
        when (s.tool) {
            "thrust" -> {
                val d = if (s.dir >= 0) 1f else -0.65f
                moveTank(t, cos(rad) * TANK_SPEED * d * dt, sin(rad) * TANK_SPEED * d * dt)
            }
            "rotate" -> {
                val speed = 150f * dt
                val remaining = t.stepRotTotal - t.stepRotDone
                val turn = min(speed * dt, remaining) * (if (s.num >= 0) 1f else -1f)
                t.bodyAngle += turn
                t.stepRotDone += abs(turn)
            }
            "wait" -> {}
        }
        t.stepMs += dt * 1000f
        val need = when (s.tool) {
            "rotate" -> t.stepRotTotal / 150f * 1000f
            else -> s.num
        }
        if (t.stepMs >= need) finishStep(t)
    }

    private fun finishStep(t: Tank) { t.cur = null }

    private fun moveTank(t: Tank, dx: Float, dy: Float) {
        val nx = t.x + dx
        if (!blocked(nx, t.y)) t.x = nx
        val ny = t.y + dy
        if (!blocked(t.x, ny)) t.y = ny
    }

    private fun tickFx(dt: Float) {
        val it2 = explosions.iterator()
        while (it2.hasNext()) {
            val e = it2.next()
            e.life -= dt
            if (e.life <= 0f) it2.remove()
        }
    }

    private fun respawn(t: Tank) {
        var bestX = 110f; var bestY = 110f; var bestD = -1f
        val spots = listOf(
            floatArrayOf(110f, 110f), floatArrayOf(FIELD_W - 110f, 110f),
            floatArrayOf(110f, FIELD_H - 110f), floatArrayOf(FIELD_W - 110f, FIELD_H - 110f),
            floatArrayOf(FIELD_W / 2, 110f), floatArrayOf(FIELD_W / 2, FIELD_H - 110f),
        )
        for (spot in spots) {
            var minD = Float.MAX_VALUE
            for (o in tanks) if (o !== t && o.alive) {
                val d = sqrt((o.x - spot[0]) * (o.x - spot[0]) + (o.y - spot[1]) * (o.y - spot[1]))
                if (d < minD) minD = d
            }
            if (minD > bestD) { bestD = minD; bestX = spot[0]; bestY = spot[1] }
        }
        t.x = bestX; t.y = bestY
        t.alive = true; t.invuln = 1.2f
        t.bodyAngle = Random.nextFloat() * 2f * PI.toFloat()
        t.planQueue.clear(); t.cur = null
    }

    private fun boom(x: Float, y: Float, colorIdx: Int) {
        explosions.add(Explosion(x, y, 0.5f))
    }

    /* ---- 反射：弹道预测躲避 ---- */
    private fun lineOfSight(x1: Float, y1: Float, x2: Float, y2: Float): Boolean {
        val dx = x2 - x1
        val dy = y2 - y1
        val dist = sqrt(dx * dx + dy * dy)
        val steps = (dist / 20f).toInt().coerceAtLeast(1)
        for (i in 1 until steps) {
            val t = i.toFloat() / steps
            if (blocked(x1 + dx * t, y1 + dy * t)) return false
        }
        return true
    }

    private fun bulletDodgeDir(t: Tank): Dir? {
        for (b in bullets) {
            var bx = b.x; var by = b.y
            var vx = b.vx; var vy = b.vy
            var threat = false
            repeat(80) {
                val nx = bx + vx / 60f
                val ny = by + vy / 60f
                if (bulletBlocked(nx, by)) vx = -vx else bx = nx
                if (bulletBlocked(bx, ny)) vy = -vy else by = ny
                val ddx = t.x - bx
                val ddy = t.y - by
                if (sqrt(ddx * ddx + ddy * ddy) < TANK_R + BULLET_R + 14f) threat = true
            }
            if (!threat) continue
            return if (abs(vx) >= abs(vy)) {
                val up = freeRunDist(t.x, t.y, 0f, -1f)
                val down = freeRunDist(t.x, t.y, 0f, 1f)
                if (up >= down) Dir.UP else Dir.DOWN
            } else {
                val l = freeRunDist(t.x, t.y, -1f, 0f)
                val r = freeRunDist(t.x, t.y, 1f, 0f)
                if (l >= r) Dir.LEFT else Dir.RIGHT
            }
        }
        return null
    }

    private fun dodgeAngle(current: Float, dodge: Dir): Float = when (dodge) {
        Dir.UP -> -PI.toFloat() / 2
        Dir.DOWN -> PI.toFloat() / 2
        Dir.LEFT -> PI.toFloat()
        else -> 0f
    }

    private fun freeRunDist(x: Float, y: Float, dx: Float, dy: Float): Int {
        var n = 0
        var cx = x
        var cy = y
        while (n < 12 && !blocked(cx + dx * 24f, cy + dy * 24f)) { cx += dx * 24f; cy += dy * 24f; n++ }
        return n
    }

    /* ---- 自主行为：计划空档时按姿态行动 ---- */
    private fun autonomousBehavior(t: Tank, dt: Float) {
        val enemy = tanks.firstOrNull { it !== t && it.alive } ?: return
        val dx = enemy.x - t.x
        val dy = enemy.y - t.y
        val dist = sqrt(dx * dx + dy * dy)
        when (aiPosture) {
            "engage" -> {
                // 追击：朝对手转向并逼近，对齐就开炮
                t.bodyAngle = atan2(dy, dx)
                if (dist > CELL * 1.2f) {
                    moveTank(t, cos(t.bodyAngle) * TANK_SPEED * dt, sin(t.bodyAngle) * TANK_SPEED * dt)
                }
                val alignedX = abs(dy) < TANK_R
                val alignedY = abs(dx) < TANK_R
                if (t.fireCd <= 0f && t.liveBullets < MAGAZINE &&
                    ((alignedX && lineOfSight(t.x, t.y, enemy.x, enemy.y)) ||
                     (alignedY && lineOfSight(t.x, t.y, enemy.x, enemy.y)))
                ) {
                    tryFire(t)
                }
            }
            "evade" -> {
                // 拉开距离
                t.bodyAngle = atan2(-dy, -dx)
                if (dist < CELL * 3f) {
                    moveTank(t, cos(t.bodyAngle) * TANK_SPEED * 0.8f * dt, sin(t.bodyAngle) * TANK_SPEED * 0.8f * dt)
                }
            }
            else -> { /* roam：原地待机 */ }
        }
    }

    /* ---- 子弹 ---- */
    private fun updateBullets(dt: Float) {
        val bit = bullets.iterator()
        while (bit.hasNext()) {
            val b = bit.next()
            b.life -= dt
            if (b.life <= 0f) {
                boom(b.x, b.y, 0); bit.remove()
                tanks.firstOrNull { it.id == b.owner }?.liveBullets -= 1
                continue
            }
            val nx = b.x + b.vx * dt
            if (bulletBlocked(nx, b.y)) b.vx = -b.vx else b.x = nx
            val ny = b.y + b.vy * dt
            if (bulletBlocked(b.x, ny)) b.vy = -b.vy else b.y = ny
            for (t in tanks) {
                if (!t.alive) continue
                val d = sqrt((t.x - b.x) * (t.x - b.x) + (t.y - b.y) * (t.y - b.y))
                if (d < TANK_R) {
                    boom(t.x, t.y, t.colorIdx)
                    bit.remove()
                    tanks.firstOrNull { it.id == b.owner }?.liveBullets -= 1
                    roundOver(loser = t)
                    break
                }
            }
        }
    }


    fun resetScores() {
        tanks.forEach { it.score = 0 }
        round = 1
        newRound()
    }

    /** CLI move:/fire 兼容入口（度数语义：up=-90 down=90 left=180 right=0） */
    fun applyBrain(t: Tank, move: String?, fire: Boolean) {
        when (move?.lowercase()) {
            "up" -> { t.bodyAngle = -90f * PI.toFloat() / 180f; enqueueThrust(t) }
            "down" -> { t.bodyAngle = 90f * PI.toFloat() / 180f; enqueueThrust(t) }
            "left" -> { t.bodyAngle = 180f * PI.toFloat() / 180f; enqueueThrust(t) }
            "right" -> { t.bodyAngle = 0f; enqueueThrust(t) }
            "stop" -> { t.planQueue.clear(); t.cur = null }
        }
        if (fire) tryFire(t)
    }

    private fun enqueueThrust(t: Tank) {
        t.planQueue.addLast(PlanStep("thrust", 600f, 1))
    }

    fun tryFire(t: Tank): Boolean {
        if (!t.alive || t.fireCd > 0f || t.liveBullets >= MAGAZINE) return false
        t.fireCd = FIRE_CD
        t.liveBullets++
        val deg = t.bodyAngle * 180f / PI.toFloat()
        bullets.add(Bullet(t.x + cos(t.bodyAngle) * (TANK_R + BULLET_R + 2), t.y + sin(t.bodyAngle) * (TANK_R + BULLET_R + 2), cos(t.bodyAngle) * BULLET_SPEED, sin(t.bodyAngle) * BULLET_SPEED, t.id))
        roundLog.add("[${"%.1f".format(time)}s] ${t.name} 开炮 ${"%.0f".format(deg)}°")
        return true
    }

    private fun killTank(t: Tank, byId: Int) {
        t.alive = false
        t.respawnIn = 2f
        events++
        val by = tanks.firstOrNull { it.id == byId }
        if (by != null && by !== t) by.score++
        roundLog.add("[${"%.1f".format(time)}s] ${by?.name ?: "???"} 击毁 ${t.name}")
        lastKillText = "${by?.name ?: "???"} 击毁 ${t.name}"
        boom(t.x, t.y, t.colorIdx)
    }

    private fun roundOver(loser: Tank) {
        val winner = tanks.firstOrNull { it !== loser }
        winner?.score = winner.score + 1
        roundLog.add("[${"%.1f".format(time)}s] 回合结束 ${winner?.name} 得分")
        lastRoundLog = roundLog.joinToString("\n") + "\n[终局] 比分 玩家${player().score}:${bots().firstOrNull()?.score ?: 0}"
        roundLog.clear()
        reviewPending = true
        intermission = 2.2f
        events++
    }

    /* ---- 状态 ---- */
    fun stateSummary(): String {
        val scores = tanks.joinToString("; ") { "${it.name}${if (it.isBot) "(AI)" else ""}=${it.score}${if (it.alive) "" else "(阵亡)"}" }
        return "回合$round t=${"%.1f".format(time)}s 弹${bullets.size} $scores 复盘待办=$reviewPending 用户暂停=$userPaused"
    }

    fun stateText(): String {
        fun cellOf(x: Float, y: Float) = "(${(x / CELL).toInt()},${(y / CELL).toInt()})"
        val ai = bots().first()
        val sb = StringBuilder()
        sb.append("迷宫 ${COLS}x${ROWS} 格。你(E)=${cellOf(ai.x, ai.y)} 朝向${"%.0f".format(ai.bodyAngle * 180f / PI.toFloat())}°，弹匣余 ${MAGAZINE - ai.liveBullets}。\n")
        sb.append("对手(A)=${cellOf(player().x, player().y)} 朝向${"%.0f".format(player().bodyAngle * 180f / PI.toFloat())}°。\n")
        if (bullets.isEmpty()) sb.append("场上无子弹。\n")
        else {
            sb.append("场上子弹：")
            bullets.forEach { b -> sb.append("${cellOf(b.x, b.y)}(vx=${if (b.vx > 0) "右" else if (b.vx < 0) "左" else "0"},vy=${if (b.vy > 0) "下" else if (b.vy < 0) "上" else "0"}) ") }
            sb.append("\n")
        }
        sb.append("比分 你${ai.score}:${player().score}对手。回合 $round。\n")
        return sb.toString()
    }

    fun stateAscii(): String {
        val W = 2 * COLS + 1
        val grid = Array(2 * ROWS + 1) { CharArray(W) { ' ' } }
        for (c in 0..COLS) for (r in 0 until ROWS) if (vWalls[c][r]) grid[2 * r + 1][2 * c] = '#'
        for (c in 0 until COLS) for (r in 0..ROWS) if (hWalls[c][r]) grid[2 * r][2 * c] = '#'
        fun put(x: Float, y: Float, ch: Char) {
            val cc = (x / CELL).toInt().coerceIn(0, COLS - 1)
            val rr = (y / CELL).toInt().coerceIn(0, ROWS - 1)
            grid[2 * rr + 1][2 * cc + 1] = ch
        }
        bullets.forEach { put(it.x, it.y, 'B') }
        tanks.forEach { t -> put(t.x, t.y, if (t.id == 0) 'A' else 'E') }
        val sb = StringBuilder("战场图(#=墙 .=空 A=玩家=你的对手 E=你自己 B=子弹)，7列x8行：\n")
        for (r in 0 until 2 * ROWS + 1) { sb.append(grid[r]).append('\n') }
        return sb.toString()
    }
}

private fun abs(v: Float) = kotlin.math.abs(v)
