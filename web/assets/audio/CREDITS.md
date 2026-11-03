# 音效素材与授权

本游戏音效采样通过 sound 技能从 Freesound 获取，以下素材均由上传者标记为 **CC0**。
素材经裁剪、调速、滤波、分层混音、响度控制与淡入淡出，制作为适合即时对战的短音效。
所有文件随游戏本地提供，运行时无需连接 Freesound，也不消耗模型 token。

构建：`python3 tools/audio/build.py <原始预览素材目录>`。精确配方见 `tools/audio/recipes.json`，输出时长、峰值与校验和见 `manifest.json`。

| 原素材 | 作者 | 下载 / 评分快照 | 授权 |
|---|---|---|---|
| [Spacey 1up/Power up](https://freesound.org/people/GameAudio/sounds/220173/) | GameAudio | ↓24748 ★4.7(191) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| [SFX UI Button Click](https://freesound.org/people/suntemple/sounds/253168/) | suntemple | ↓7605 ★4.8(80) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| [Game Powerup](https://freesound.org/people/Jofae/sounds/368651/) | Jofae | ↓7226 ★4.6(67) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| [Ricochet 2.wav](https://freesound.org/people/morganpurkis/sounds/392975/) | morganpurkis | ↓2596 ★4.7(32) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| [Retro, Laser Shot 01.wav](https://freesound.org/people/LilMati/sounds/413057/) | LilMati | ↓3434 ★4.5(53) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| [Retro, Laser Shot 04.wav](https://freesound.org/people/LilMati/sounds/414888/) | LilMati | ↓4765 ★4.7(72) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| [Retro, Explosion 05.wav](https://freesound.org/people/LilMati/sounds/441497/) | LilMati | ↓2754 ★4.8(40) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| [Retro, Underwater Explosion](https://freesound.org/people/LilMati/sounds/459150/) | LilMati | ↓2473 ★4.7(55) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| [Beep_Error_1.wav](https://freesound.org/people/JonnyRuss01/sounds/478191/) | JonnyRuss01 | ↓1481 ★4.0(22) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| [Charge up](https://freesound.org/people/SamsterBirdies/sounds/483883/) | SamsterBirdies | ↓2296 ★4.8(28) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| [Pop 02](https://freesound.org/people/LilMati/sounds/506545/) | LilMati | ↓5214 ★4.7(77) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| [Pop 01](https://freesound.org/people/LilMati/sounds/506546/) | LilMati | ↓5899 ★4.5(107) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| [Landing Forcefield](https://freesound.org/people/unfa/sounds/584173/) | unfa | ↓1129 ★5.0(23) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| [SciFi Inspect Sound, UI, or In-Game Notification 01.wav](https://freesound.org/people/LilMati/sounds/657945/) | LilMati | ↓3364 ★4.8(48) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| [Robot walk, looped](https://freesound.org/people/Magnesus/sounds/729437/) | Magnesus | ↓1122 ★4.8(25) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |

当前版本：soft-arcade（2026-11-03 调整）。采用短 pop、电子滑音、卡通反弹和轻量伺服细响；移除写实枪炮、TNT 爆炸与坦克引擎素材。
来源与热度快照仅用于筛选；风格最终以玩家实际听感为准。
