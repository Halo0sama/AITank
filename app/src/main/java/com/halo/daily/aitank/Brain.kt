package com.halo.daily.aitank

import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL

data class AiConfig(val apiKey: String, val model: String, val endpoint: String)

data class BrainResult(val move: String?, val fire: Boolean?, val error: String?)

/** DeepSeek Anthropic 格式（官方文档 https://api-docs.deepseek.com/guides/anthropic_api） */
object Ai {
    const val DEFAULT_MODEL = "deepseek-flash"
    const val DEFAULT_ENDPOINT = "https://api.deepseek.com/anthropic/v1/messages"
    private const val MAX_TOKENS = 4096

    private const val SYSTEM = """你是一辆坦克的战斗大脑，在玩经典 Tank Trouble（坦克动荡）：网格迷宫，坦克四向移动，子弹碰墙反弹、可炸死任何人（包括自己），每车同时最多 5 发，射速有限。
每回合你会收到：战场截图 + 局面文本（你的格坐标与朝向、弹匣余量、对手格坐标与朝向、场上每颗子弹的格坐标与飞行方向）。
看图并结合局面，输出下一个决策（该决策将执行约 1.5 秒）。只输出一个 JSON 对象：
{"move":"up|down|left|right|stop","fire":true|false}
判断要点：
1. 若有子弹朝你飞来且距离近（≤2 格），优先躲：move 选一个不会被子弹经过的方向。
2. 若与对手同格或视线无墙阻隔，move 逼近/走位，fire=true 开炮。
3. 贴墙时别朝墙开炮（反弹会炸死自己）。
4. 没有威胁也没有机会时，move 朝对手大概方向移动寻找交战。"""

    private fun post(body: String, cfg: AiConfig): Pair<Int, String> {
        val conn = (URL(cfg.endpoint).openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            connectTimeout = 20_000
            readTimeout = 90_000
            doOutput = true
            setRequestProperty("Content-Type", "application/json")
            setRequestProperty("x-api-key", cfg.apiKey)
        }
        conn.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
        val code = conn.responseCode
        val text = (if (code in 200..299) conn.inputStream else conn.errorStream)?.let { stream ->
            BufferedReader(InputStreamReader(stream, Charsets.UTF_8)).use { it.readText() }
        } ?: ""
        return code to text
    }

    private fun extractText(text: String): String {
        val arr = JSONObject(text).getJSONArray("content")
        var out = ""
        for (i in 0 until arr.length()) {
            val block = arr.getJSONObject(i)
            if (block.optString("type") == "text") out += block.optString("text")
        }
        return out.trim()
    }

    data class PostureResult(val posture: String?, val comment: String?, val error: String?)

    private const val DIRECTOR_SYSTEM = """你是坦克战斗指挥官。依据战局为我方 AI 坦克选择未来 3 秒的战术姿态。只输出一个 JSON 对象：
{"posture":"engage|evade|roam","comment":"不超过12字的战术意图"}
engage=逼近对手并开火；evade=保持距离躲避弹幕伺机反击；roam=游走寻找有利战机。
局面文本含双方格坐标、朝向、场上子弹坐标与方向。子弹会反弹，小心被自己的反弹弹击中。
历史教训（必须遵守）：
{LESSONS}"""

    private const val REFLECT_SYSTEM = """你是坦克复盘教练。输入：上一局完整战报。找出败因与可执行改进，输出 JSON：
{"memory_add":["具体教训，每条不超过20字",最多3条]}
要求：教训必须具体可执行（如"贴墙1格内勿开炮""对手逼近时先横向躲"）；不要空话；只输出 JSON。"""

    data class ReflectOut(val memoryAdd: List<String>, val note: String?, val error: String?)

    /** 复盘：上一局战报 → 教训列表 */
    fun reflect(roundLog: String, cfg: AiConfig): ReflectOut {
        if (cfg.apiKey.isBlank()) return ReflectOut(emptyList(), null, "未配置 API key")
        return try {
            val body = JSONObject()
                .put("model", cfg.model)
                .put("max_tokens", MAX_TOKENS)
                .put("thinking", JSONObject().put("type", "disabled"))
                .put("system", REFLECT_SYSTEM)
                .put("messages", JSONArray().put(JSONObject().put("role", "user").put("content", "上一局战报：\n$roundLog")))
                .toString()
            val (code, text) = post(body, cfg)
            if (code !in 200..299) return ReflectOut(emptyList(), null, "HTTP $code：${text.take(180)}")
            val picked = extractText(text)
            if (picked.isBlank()) return ReflectOut(emptyList(), null, "模型返回了空内容")
            val jsonStart = picked.indexOf('{')
            val jsonEnd = picked.lastIndexOf('}')
            if (jsonStart < 0 || jsonEnd <= jsonStart) return ReflectOut(emptyList(), null, "无法解析：${picked.take(80)}")
            val o = JSONObject(picked.substring(jsonStart, jsonEnd + 1))
            val arr = o.optJSONArray("memory_add")
            val lessons = mutableListOf<String>()
            if (arr != null) for (i in 0 until arr.length()) lessons.add(arr.getString(i))
            ReflectOut(lessons, o.optString("note"), null)
        } catch (e: Exception) {
            ReflectOut(emptyList(), null, "调用失败：${e.message}")
        }
    }

    /** 指挥官：只定战略姿态（反射层毫秒级执行，不受此延迟影响） */
    fun command(stateText: String, lessons: List<String>, cfg: AiConfig): PostureResult {
        if (cfg.apiKey.isBlank()) return PostureResult(null, null, "未配置 API key")
        return try {
            val body = JSONObject()
                .put("model", cfg.model)
                .put("max_tokens", MAX_TOKENS)
                .put("thinking", JSONObject().put("type", "disabled"))
                .put("system", DIRECTOR_SYSTEM.replace("{LESSONS}", if (lessons.isEmpty()) "（暂无）" else lessons.joinToString("\n") { "- $it" }))
                .put("messages", JSONArray().put(JSONObject().put("role", "user").put("content", stateText)))
                .toString()
            val (code, text) = post(body, cfg)
            if (code !in 200..299) return PostureResult(null, null, "HTTP $code：${text.take(180)}")
            val picked = extractText(text)
            if (picked.isBlank()) return PostureResult(null, null, "模型返回了空内容")
            val jsonStart = picked.indexOf('{')
            val jsonEnd = picked.lastIndexOf('}')
            if (jsonStart < 0 || jsonEnd <= jsonStart) return PostureResult(null, null, "无法解析：${picked.take(80)}")
            val o = JSONObject(picked.substring(jsonStart, jsonEnd + 1))
            val posture = when (o.optString("posture")) {
                "engage" -> "engage"; "evade" -> "evade"; "roam" -> "roam"; else -> null
            }
            if (posture == null) PostureResult(null, picked, "posture 无效：${picked.take(80)}")
            else PostureResult(posture, o.optString("comment"), null)
        } catch (e: Exception) {
            PostureResult(null, null, "调用失败：${e.message}")
        }
    }

    /** 决策：局面文本 + 可选战场截图 → (move, fire) */
    fun decide(stateText: String, pngBase64: String?, cfg: AiConfig): BrainResult {
        if (cfg.apiKey.isBlank()) return BrainResult(null, null, "未配置 API key")
        return try {
            val content = JSONArray().put(
                JSONObject().put("type", "text").put("text", stateText)
            )
            if (!pngBase64.isNullOrBlank()) {
                content.put(
                    JSONObject().put("type", "image").put(
                        "source", JSONObject().put("type", "base64").put("media_type", "image/png").put("data", pngBase64)
                    )
                )
            }
            val body = JSONObject()
                .put("model", cfg.model)
                .put("max_tokens", MAX_TOKENS)
                // 实时对战：关思考（官方 thinking 参数）。实测开思考 3.4s 且常空内容，关思考 0.6-0.8s
                .put("thinking", JSONObject().put("type", "disabled"))
                .put("system", SYSTEM)
                .put("messages", JSONArray().put(JSONObject().put("role", "user").put("content", content)))
                .toString()
            val (code, text) = post(body, cfg)
            if (code !in 200..299) return BrainResult(null, null, "HTTP $code：${text.take(180)}")
            val picked = extractText(text)
            if (picked.isBlank()) {
                Log.w("CliState", "AI 响应无内容，原文片段: ${text.take(240)}")
                return BrainResult(null, null, "模型返回了空内容")
            }
            val jsonStart = picked.indexOf('{')
            val jsonEnd = picked.lastIndexOf('}')
            if (jsonStart < 0 || jsonEnd <= jsonStart) {
                Log.w("CliState", "AI 原文: ${picked.take(200)}")
                return BrainResult(null, null, "模型输出无法解析：${picked.take(80)}")
            }
            val o = JSONObject(picked.substring(jsonStart, jsonEnd + 1))
            val move = o.optString("move", "stop")
            val fire = o.optBoolean("fire", false)
            BrainResult(move, fire, null)
        } catch (e: Exception) {
            BrainResult(null, null, "调用失败：${e.message ?: e.javaClass.simpleName}")
        }
    }
}
