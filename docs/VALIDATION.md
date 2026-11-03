# v1.1.0 发布检查

检查日期：2026-11-04。范围为网页版，使用独立浏览器测试上下文与模拟模型接口；不读取个人 Edge 档案，不消耗真实模型额度。

## 已通过的本地检查

- `cd web && npm test`：79 项单元/协议测试通过。
- `cd web && PLAYWRIGHT_EXECUTABLE_PATH='/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge' npm run test:browser`：160 项浏览器测试通过。
- `git diff --check`：通过。

覆盖 AI 目标与拾取授权、自写程序的放弃/等待/不开火、紧急避弹与反击、弹药和特殊武器、合作/PvP、难度数值、省 token 请求调度、主界面、暂停、过期响应和学习持久化。音频检查包含全部采样的解码、混音、音源回收、加载失败重试、过期试听、静音及暂停；素材清单与哈希均受单元测试检查。

## 分发和持续验证

`python3 tools/release/build.py` 仅打包本地运行必需的网页模块、静态素材、许可和 macOS 启动器源码。构建脚本检查所有页面脚本/样式引用、音效哈希与包路径，排除测试输出、个人复盘、学习导出、依赖目录及凭据。

GitHub Actions 对 main、版本标签和拉取请求运行相同协议/浏览器测试，再构建分发包。浏览器检查使用 Playwright 自带 Chromium；本地验证使用安装的 Edge。

## 证据边界

测试通过证明受控场景的协议、物理执行和保存行为，不证明真人胜率提升，也不替代音效听感评审。历史学习、API Key 与浏览器个人配置不随源码或分发包发布。
