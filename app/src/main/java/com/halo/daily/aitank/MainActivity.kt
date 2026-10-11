package com.halo.daily.aitank

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.os.Bundle
import android.util.Base64
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.LargeTopAppBar
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Shapes
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.graphics.layer.drawLayer
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.graphics.rememberGraphicsLayer
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import kotlin.math.PI
import kotlin.math.min

/* ==================== CLI 总线 ==================== */

object KeyInput {
    @Volatile var up = false
    @Volatile var down = false
    @Volatile var left = false
    @Volatile var right = false
    @Volatile var fireQueued = false
    fun heldDir(): Dir? = when {
        up -> Dir.UP; down -> Dir.DOWN; left -> Dir.LEFT; right -> Dir.RIGHT; else -> null
    }
}

object CliBus {
    var onCommand: ((String) -> Unit)? = null

    @Volatile
    var snapshot: String = "App 未启动或未上报"
}

/** 内置调试 CLI：adb shell am broadcast -a com.halo.daily.aitank.CLI --es cmd <命令> */
class CliReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val cmd = intent.getStringExtra("cmd") ?: return
        if (cmd == "state") {
            Log.i("CliState", CliBus.snapshot)
        } else {
            val sink = CliBus.onCommand
            if (sink != null) {
                Log.i("CliState", "cli 收到 $cmd")
                sink(cmd)
            } else {
                Log.w("CliState", "App 未在前台，无法执行 $cmd（仅 state 可用）")
            }
        }
    }
}

/* ==================== 入口与主题 ==================== */

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // 游戏前台时常亮：息屏会导致按键无响应、帧循环冻结（离开 app 自动释放，不改全局息屏设置）
        window.addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        androidx.core.content.ContextCompat.registerReceiver(
            this,
            CliReceiver(),
            android.content.IntentFilter("com.halo.daily.aitank.CLI"),
            androidx.core.content.ContextCompat.RECEIVER_EXPORTED
        )
        setContent { AppRoot() }
    }

    override fun dispatchKeyEvent(event: android.view.KeyEvent): Boolean {
        // 游戏键在视图分发之前拦截：空格不会再触发获得焦点的 ⚙/开炮 等按钮
        when (event.keyCode) {
            android.view.KeyEvent.KEYCODE_W, android.view.KeyEvent.KEYCODE_DPAD_UP -> {
                KeyInput.up = event.action == android.view.KeyEvent.ACTION_DOWN
                return true
            }
            android.view.KeyEvent.KEYCODE_S, android.view.KeyEvent.KEYCODE_DPAD_DOWN -> {
                KeyInput.down = event.action == android.view.KeyEvent.ACTION_DOWN
                return true
            }
            android.view.KeyEvent.KEYCODE_A, android.view.KeyEvent.KEYCODE_DPAD_LEFT -> {
                KeyInput.left = event.action == android.view.KeyEvent.ACTION_DOWN
                return true
            }
            android.view.KeyEvent.KEYCODE_D, android.view.KeyEvent.KEYCODE_DPAD_RIGHT -> {
                KeyInput.right = event.action == android.view.KeyEvent.ACTION_DOWN
                return true
            }
            android.view.KeyEvent.KEYCODE_SPACE -> {
                if (event.action == android.view.KeyEvent.ACTION_DOWN) KeyInput.fireQueued = true
                return true
            }
        }
        return super.dispatchKeyEvent(event)
    }
}

@Composable
fun AppRoot() {
    val ctx = LocalContext.current
    val dark = isSystemInDarkTheme()
    val scheme = if (dark) androidx.compose.material3.dynamicDarkColorScheme(ctx)
    else androidx.compose.material3.dynamicLightColorScheme(ctx)
    val shapes = Shapes(
        extraSmall = RoundedCornerShape(8.dp),
        small = RoundedCornerShape(14.dp),
        medium = RoundedCornerShape(20.dp),
        large = RoundedCornerShape(28.dp),
        extraLarge = RoundedCornerShape(36.dp),
    )
    MaterialTheme(
        colorScheme = scheme,
        shapes = shapes,
        content = { Surface(modifier = Modifier.fillMaxSize()) { TankScreen() } }
    )
}

/* ==================== 主界面 ==================== */

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TankScreen() {
    val ctx = LocalContext.current
    val prefs = remember { ctx.getSharedPreferences("aitank", Context.MODE_PRIVATE) }
    val scope = androidx.compose.runtime.rememberCoroutineScope()
    val game = remember { Game() }
    var uiTick by remember { mutableIntStateOf(0) }
    var paused by remember { mutableStateOf(false) }
    var brainOn by remember { mutableStateOf(true) }
    var showSettings by remember { mutableStateOf(false) }
    var captureFn by remember { mutableStateOf<(suspend () -> ImageBitmap?)?>(null) }
    var frameStamp by remember { mutableLongStateOf(0L) } // 每帧写入 → 画布订阅重绘
    var heldDir by remember { mutableStateOf<Dir?>(null) }
    val dark = isSystemInDarkTheme()
    var lessons by remember { mutableStateOf(prefs.getString("lessons", "")?.split("\n")?.filter { it.isNotBlank() } ?: emptyList()) }
    var reflectBusy by remember { mutableStateOf(false) }

    fun loadCfg(): AiConfig = AiConfig(
        apiKey = prefs.getString("apiKey", "").orEmpty().ifBlank { BuildConfig.DEEPSEEK_API_KEY },
        model = prefs.getString("model", "").orEmpty().ifBlank { Ai.DEFAULT_MODEL },
        endpoint = prefs.getString("endpoint", "").orEmpty().ifBlank { Ai.DEFAULT_ENDPOINT },
    )

    fun handleCli(cmd: String) {
        when {
            cmd == "reset" -> { game.resetScores(); Log.i("CliState", "reset ok") }
            cmd == "newround" -> game.newRound()
            cmd.startsWith("move:") -> {
                val d = cmd.removePrefix("move:").trim()
                game.applyBrain(game.player(), d.ifBlank { "stop" }, false)
            }
            cmd == "fire" -> game.tryFire(game.player())
            cmd == "brain:on" -> brainOn = true
            cmd == "brain:off" -> brainOn = false
            cmd == "brain:status" -> Log.i("CliState", "posture=${game.aiPosture} comment=${game.aiPostureComment} brain=${game.bots().firstOrNull()?.brain?.status}")
            cmd == "memory" -> {
                val l = prefs.getString("lessons", "")?.split("\n")?.filter { it.isNotBlank() } ?: emptyList()
                Log.i("CliState", if (l.isEmpty()) "记忆为空" else "记忆 ${l.size} 条：\n" + l.joinToString("\n") { "- $it" })
            }
            cmd == "memory:clear" -> {
                prefs.edit().putString("lessons", "").apply()
                lessons = emptyList()
                Log.i("CliState", "记忆已清空")
            }
            cmd.startsWith("posture:") -> {
                game.setPosture(cmd.removePrefix("posture:").trim())
                Log.i("CliState", "posture 手动=${game.aiPosture}")
            }
            cmd == "map" -> Log.i("CliState", "AI 视角战场图:\n" + game.stateAscii())
            cmd == "pause" -> paused = true
            cmd == "resume" -> paused = false
            else -> Log.w("CliState", "未知命令 $cmd")
        }
    }

    // 游戏帧循环 + 玩家键盘方向
    LaunchedEffect(Unit) {
        CliBus.onCommand = { handleCli(it) }
        CliBus.snapshot = game.stateSummary()
        var last = withFrameNanos { it }
        var frames = 0
        while (true) {
            withFrameNanos { now ->
                val dt = ((now - last) / 1_000_000_000f).coerceAtMost(0.05f)
                last = now
                val p0 = game.player()
                p0.thrust = when {
                    KeyInput.up || heldDir == Dir.UP -> 1f
                    KeyInput.down || heldDir == Dir.DOWN -> -1f
                    else -> 0f
                }
                p0.rotDir = when {
                    KeyInput.left || heldDir == Dir.LEFT -> -1f
                    KeyInput.right || heldDir == Dir.RIGHT -> 1f
                    else -> 0f
                }
                if (KeyInput.fireQueued) {
                    KeyInput.fireQueued = false
                    game.tryFire(game.player())
                }
                game.update(dt)
                frameStamp = now
            }
            frames++
            if (frames % 10 == 0) {
                uiTick++
                CliBus.snapshot = game.stateSummary()
            }
        }
    }

    // LLM 指挥官循环：每 ~3s 读战局 → 下达战略姿态（反射层毫秒级执行）
    LaunchedEffect(brainOn) {
        while (brainOn) {
            if (!paused && game.intermission <= 0f && game.tanks.any { it.alive }) {
                val res = withContext(Dispatchers.IO) { Ai.command(game.stateText(), lessons, loadCfg()) }
                if (res.posture != null) {
                    game.setPosture(res.posture)
                    game.aiPostureComment = res.comment ?: ""
                    game.bots().firstOrNull()?.brain?.status = "战略：${res.posture}（${game.aiPostureComment}）"
                    Log.i("CliState", "director posture=${res.posture} comment=${res.comment}")
                } else {
                    game.bots().firstOrNull()?.brain?.status = "指挥官失败：${res.error}"
                    Log.w("CliState", "director fail ${res.error}")
                }
            }
            delay(3000)
        }
    }

    // 复盘循环：每回合结束自动暂停，等 DeepSeek 复盘出教训后再开新局
    LaunchedEffect(Unit) {
        while (true) {
            if (game.reviewPending && !reflectBusy) {
                reflectBusy = true
                paused = true
                val res = withContext(Dispatchers.IO) { Ai.reflect(game.lastRoundLog, loadCfg()) }
                if (res.memoryAdd.isNotEmpty()) {
                    val cur = prefs.getString("lessons", "")?.split("\n")?.filter { it.isNotBlank() }?.toMutableList() ?: mutableListOf()
                    for (l in res.memoryAdd) if (l !in cur) cur.add(l)
                    while (cur.size > 12) cur.removeAt(0)
                    prefs.edit().putString("lessons", cur.joinToString("\n")).apply()
                    lessons = cur
                    Log.i("CliState", "复盘教训：${res.memoryAdd.joinToString("；")}")
                }
                if (res.error != null) Log.w("CliState", "复盘失败 ${res.error}")
                game.reviewPending = false
                game.newRound()
                paused = false
                reflectBusy = false
            }
            delay(1000)
        }
    }

    Scaffold(
        topBar = {
            LargeTopAppBar(
                title = {
                    Column {
                        Text("AI 坦克动荡", fontWeight = FontWeight.Black, fontSize = 28.sp)
                        Text(
                            "经典坦克动荡 · 对手大脑 = DeepSeek",
                            fontSize = 12.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                },
                actions = {
                    FilledIconButton(
                        onClick = { paused = !paused },
                        modifier = Modifier.padding(end = 12.dp)
                    ) { Text(if (paused) "▶" else "⏸", fontSize = 16.sp) }
                    FilledIconButton(
                        onClick = { showSettings = true },
                        modifier = Modifier.padding(end = 12.dp)
                    ) { Text("⚙", fontSize = 18.sp) }
                },
                colors = TopAppBarDefaults.largeTopAppBarColors(containerColor = Color.Transparent),
            )
        },
        modifier = Modifier,
        ) { pad ->
        Column(
            Modifier
                .fillMaxSize()
                .padding(pad)
                .padding(horizontal = 14.dp)
        ) {
            key(uiTick) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    game.tanks.forEach { t ->
                        Card(
                            colors = CardDefaults.cardColors(
                                containerColor = if (t.alive) MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.6f)
                                else MaterialTheme.colorScheme.errorContainer.copy(alpha = 0.6f)
                            ),
                            modifier = Modifier.weight(1f)
                        ) {
                            Column(Modifier.padding(horizontal = 10.dp, vertical = 6.dp)) {
                                Text(
                                    "${t.name} · 第${game.round}回合",
                                    fontSize = 11.sp,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                                Text("${t.score}", fontSize = 20.sp, fontWeight = FontWeight.Black)
                            }
                        }
                    }
                }
            }
            Spacer(Modifier.height(6.dp))
            key(uiTick) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text("键盘", fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    listOf("W" to KeyInput.up, "A" to KeyInput.left, "S" to KeyInput.down, "D" to KeyInput.right).forEach { (label, pressed) ->
                        Text(
                            label,
                            fontSize = 12.sp,
                            fontWeight = FontWeight.Bold,
                            color = if (pressed) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.35f),
                            modifier = Modifier
                                .background(
                                    if (pressed) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceVariant,
                                    RoundedCornerShape(6.dp)
                                )
                                .padding(horizontal = 8.dp, vertical = 2.dp)
                        )
                    }
                    Text(
                        if (KeyInput.heldDir() != null || heldDir != null) "移动中" else "未移动",
                        fontSize = 11.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }

            Spacer(Modifier.height(6.dp))

            Box(
                Modifier
                    .fillMaxWidth()
                    .weight(1f)
                    .clip(RoundedCornerShape(28.dp))
                    .background(MaterialTheme.colorScheme.surfaceContainerLow)
            ) {
                val palette = listOf(
                    MaterialTheme.colorScheme.primary,
                    MaterialTheme.colorScheme.error,
                )
                val layer = rememberGraphicsLayer()
                LaunchedEffect(Unit) { captureFn = { layer.toImageBitmap() } }
                Canvas(Modifier.fillMaxSize()) {
                    val stamp = frameStamp // 绘制阶段读取 → 每帧重绘
                    layer.record {
                        val s = min(size.width / Game.FIELD_W, size.height / Game.FIELD_H)
                        val ox = (size.width - Game.FIELD_W * s) / 2f
                        val oy = (size.height - Game.FIELD_H * s) / 2f
                        withTransform({ translate(ox, oy); scale(s, s, pivot = Offset.Zero) }) {
                            drawArena(game, dark, palette)
                        }
                    }
                    drawLayer(layer)
                }
            }

            Spacer(Modifier.height(8.dp))
            // 底部操控：D-pad + 开炮
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
                    DirBtn("▲", heldDir == Dir.UP, { heldDir = Dir.UP }, { heldDir = null })
                    Row {
                        DirBtn("◀", heldDir == Dir.LEFT, { heldDir = Dir.LEFT }, { heldDir = null })
                        Spacer(Modifier.size(46.dp))
                        DirBtn("▶", heldDir == Dir.RIGHT, { heldDir = Dir.RIGHT }, { heldDir = null })
                    }
                    DirBtn("▼", heldDir == Dir.DOWN, { heldDir = Dir.DOWN }, { heldDir = null })
                }
                Spacer(Modifier.size(20.dp))
                FilledIconButton(
                    onClick = { game.tryFire(game.player()) },
                    modifier = Modifier.size(84.dp)
                ) {
                    Text("开炮", fontSize = 16.sp, fontWeight = FontWeight.Bold)
                }
            }
            Spacer(Modifier.height(6.dp))
            Text(
                "对手大脑：" + (game.bots().firstOrNull()?.brain?.status ?: "") + if (paused) " ｜ 已暂停" else "",
                fontSize = 12.sp,
                color = if (paused) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(bottom = 10.dp)
            )
        }
    }

    if (showSettings) {
        SettingsDialog(
            initial = loadCfg(),
            initialVision = prefs.getBoolean("useVision", false),
            onDismiss = { showSettings = false },
            onSave = { c, vision ->
                prefs.edit()
                    .putString("apiKey", c.apiKey).putString("model", c.model).putString("endpoint", c.endpoint)
                    .putBoolean("useVision", vision)
                    .apply()
                showSettings = false
            },
        )
    }
}

/* ==================== 操控按钮 ==================== */

@Composable
fun DirBtn(label: String, active: Boolean, onPress: () -> Unit, onRelease: () -> Unit) {
    FilledTonalButton(
        onClick = {},
        colors = androidx.compose.material3.ButtonDefaults.filledTonalButtonColors(
            containerColor = if (active) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surfaceVariant
        ),
        modifier = Modifier
            .size(width = 56.dp, height = 46.dp)
            .pointerInput(Unit) {
                detectTapGestures(
                    onPress = {
                        onPress()
                        try { awaitRelease() } finally { onRelease() }
                    }
                )
            }
    ) { Text(label, fontSize = 16.sp) }
}

/* ==================== AI 设置 ==================== */

@Composable
fun SettingsDialog(initial: AiConfig, initialVision: Boolean, onDismiss: () -> Unit, onSave: (AiConfig, Boolean) -> Unit) {
    var key by remember { mutableStateOf(initial.apiKey) }
    var model by remember { mutableStateOf(initial.model) }
    var endpoint by remember { mutableStateOf(initial.endpoint) }
    var vision by remember { mutableStateOf(initialVision) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("AI 设置") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                OutlinedTextField(
                    value = key, onValueChange = { key = it },
                    label = { Text("API Key（留空使用内置）") },
                    singleLine = true, modifier = Modifier.fillMaxWidth()
                )
                OutlinedTextField(
                    value = model, onValueChange = { model = it },
                    label = { Text("模型名") },
                    singleLine = true, modifier = Modifier.fillMaxWidth()
                )
                OutlinedTextField(
                    value = endpoint, onValueChange = { endpoint = it },
                    label = { Text("接口地址（Anthropic 格式）") },
                    singleLine = true, modifier = Modifier.fillMaxWidth()
                )
                Row(verticalAlignment = Alignment.CenterVertically) {
                    androidx.compose.material3.Checkbox(checked = vision, onCheckedChange = { vision = it })
                    Text("用视觉（截图；更快建议关）", fontSize = 13.sp)
                }
            }
        },
        confirmButton = {
            TextButton(onClick = {
                onSave(
                    AiConfig(
                        apiKey = key.trim(),
                        model = model.trim().ifBlank { Ai.DEFAULT_MODEL },
                        endpoint = endpoint.trim().ifBlank { Ai.DEFAULT_ENDPOINT },
                    ),
                    vision
                )
            }) { Text("保存") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("取消") } }
    )
}

private fun encodePng(img: ImageBitmap): String {
    val src = img.asAndroidBitmap()
    val targetW = 720
    val scaled = if (src.width > targetW)
        Bitmap.createScaledBitmap(src, targetW, src.height * targetW / src.width, true)
    else src
    val bytes = ByteArrayOutputStream()
        .also { o -> scaled.compress(Bitmap.CompressFormat.PNG, 80, o) }
        .toByteArray()
    return Base64.encodeToString(bytes, Base64.NO_WRAP)
}

/* ==================== 战场渲染 ==================== */

private fun DrawScopeHolder(game: Game, dark: Boolean, palette: List<Color>) = Unit

private fun androidx.compose.ui.graphics.drawscope.DrawScope.drawArena(game: Game, dark: Boolean, palette: List<Color>) {
    // 场地底
    drawRoundRect(
        color = if (dark) Color(0xFF10131A) else Color(0xFFF2F3F8),
        cornerRadius = CornerRadius(28f, 28f),
        size = Size(Game.FIELD_W, Game.FIELD_H),
    )
    // 迷宫墙
    game.wallRects.forEach { w ->
        drawRoundRect(
            color = if (dark) Color(0xFF39415A) else Color(0xFFC9CEDD),
            topLeft = Offset(w.x, w.y),
            size = Size(w.w, w.h),
            cornerRadius = CornerRadius(8f, 8f),
        )
    }
    // 爆炸
    game.explosions.forEach { e ->
        val k = (e.life / 0.5f).coerceIn(0f, 1f)
        drawCircle(Color(0xFFFFB74D).copy(alpha = k), radius = 20f + (1 - k) * 26f, center = Offset(e.x, e.y))
    }
    // 子弹（发光）
    game.bullets.forEach { b ->
        val c = if (b.owner == 0) palette[0] else palette[1]
        drawCircle(c.copy(alpha = 0.18f), radius = 20f, center = Offset(b.x, b.y))
        drawCircle(c.copy(alpha = 0.55f), radius = 12f, center = Offset(b.x, b.y))
        drawCircle(Color.White.copy(alpha = 0.95f), radius = 6f, center = Offset(b.x, b.y))
    }
    // 坦克
    game.tanks.forEach { t ->
        if (!t.alive) return@forEach
        val c = if (t.id == 0) palette[0] else palette[1]
        val alpha = 1f
        rotate(degrees = t.bodyAngle * 180f / PI.toFloat(), pivot = Offset(t.x, t.y)) {
            drawRoundRect(
                color = c.copy(alpha = 0.25f * alpha),
                topLeft = Offset(t.x - 32f, t.y - 26f),
                size = Size(64f, 52f),
                cornerRadius = CornerRadius(12f, 12f),
            )
            drawRoundRect(
                brush = androidx.compose.ui.graphics.Brush.linearGradient(listOf(c, c.copy(alpha = 0.7f))),
                topLeft = Offset(t.x - 24f, t.y - 20f),
                size = Size(48f, 40f),
                cornerRadius = CornerRadius(10f, 10f),
            )
            drawLine(
                Color.White.copy(alpha = 0.9f * alpha),
                Offset(t.x, t.y), Offset(t.x + 36f, t.y),
                strokeWidth = 7f, cap = androidx.compose.ui.graphics.StrokeCap.Round
            )
        }
        if (t.id == 0) {
            drawCircle(
                Color.White.copy(alpha = 0.5f * alpha),
                radius = 38f,
                center = Offset(t.x, t.y),
                style = Stroke(width = 3f)
            )
        }
        drawContext.canvas.nativeCanvas.let { cvs ->
            val paint = android.graphics.Paint().apply {
                color = if (dark) android.graphics.Color.argb(200, 235, 235, 248)
                else android.graphics.Color.argb(200, 40, 44, 58)
                textSize = 26f
                isAntiAlias = true
                textAlign = android.graphics.Paint.Align.CENTER
            }
            cvs.drawText(t.name, t.x, t.y - 46f, paint)
        }
    }
}
