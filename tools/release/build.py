#!/usr/bin/env python3
"""Build a portable web-only release using a strict public-file allowlist."""
import hashlib
import json
import re
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WEB = ROOT / 'web'
OUT = ROOT / 'dist'


def build():
    package = json.loads((WEB / 'package.json').read_text())
    version = package['version']
    if not re.fullmatch(r'\d+\.\d+\.\d+', version):
        raise ValueError('Invalid release version')
    lock = json.loads((WEB / 'package-lock.json').read_text())
    if lock['version'] != version or lock['packages']['']['version'] != version:
        raise ValueError('Package and lock versions differ')
    page = (WEB / 'index.html').read_text()
    if f'name="application-version" content="{version}"' not in page:
        raise ValueError('Page version differs')
    paths = [ROOT / 'LICENSE', ROOT / 'CHANGELOG.md']
    paths += sorted(p for p in WEB.iterdir() if p.is_file() and p.suffix in {'.html', '.js', '.css'})
    paths += sorted(p for p in (WEB / 'assets').rglob('*') if p.is_file())
    paths += sorted((ROOT / 'tools' / 'macos').glob('*.py'))
    paths = sorted(set(paths))
    allowed = {p.relative_to(ROOT).as_posix() for p in paths}
    for p in paths:
        if p.is_symlink():
            raise ValueError('Release cannot contain symlinks')
        relative = p.relative_to(ROOT)
        if any(x.startswith('.') for x in relative.parts) or p.suffix.lower() in {'.docx', '.pem', '.key'}:
            raise ValueError('Private or hidden path in release')
    for reference in re.findall(r'(?:src|href)="([^"?#]+)(?:\?[^"#]*)?"', page):
        if reference.endswith(('.js', '.css')) and 'web/' + reference not in allowed:
            raise ValueError('Missing page dependency: ' + reference)
    manifest = json.loads((WEB / 'assets/audio/manifest.json').read_text())
    for clip in manifest['clips']:
        p = WEB / 'assets/audio' / clip['file']
        if 'web/assets/audio/' + clip['file'] not in allowed or hashlib.sha256(p.read_bytes()).hexdigest() != clip['sha256']:
            raise ValueError('Missing or changed audio asset: ' + clip['file'])
    title = 'AITank-v' + version
    readme = f'''# AI Tank / AI 坦克动荡 v{version}

此包包含可直接运行的网页版与 macOS 快捷启动器安装脚本。无需 Node.js 或 npm，运行本地服务需要 Python 3。

## 启动游戏

1. 完整解压此文件夹，打开终端并进入解压后的目录。
2. 执行：

   python3 -m http.server 8000 --bind 127.0.0.1 --directory web

   Windows 可将 python3 替换为 py -3。
3. 在浏览器打开 http://127.0.0.1:8000/?paused=1 。先进入主界面，点击进入战场才启动对局。
4. 人机模式在设置中配置自己的 Anthropic 兼容 API；同键盘 PvP 无需 API Key。

macOS 已安装 Edge 时，可运行 python3 tools/macos/install.py 安装 Applications 中的快捷启动器。

## 操作与学习

- P1：W/S 前后，A/D 转向，空格或 J 开火。
- P2：P/分号键前后，L/单引号键转向，Enter 开火。
- Esc 暂停。切换窗口自动暂停。技能说明、画质、声音及难度都在设置中。
- 学习保存在当前浏览器配置及页面来源下。继续使用同一浏览器与 127.0.0.1:8000 地址可保留原档案；更换地址前先从设置导出。
- 此包不包含个人学习、接口凭据或 node_modules。

源码与完整说明：https://github.com/Halo0sama/AITank/tree/v{version}
音效来源与授权：web/assets/audio/CREDITS.md
许可：LICENSE（代码 MIT；音效来源标记 CC0）
'''
    OUT.mkdir(exist_ok=True)
    destination = OUT / (title + '-web.zip')
    with zipfile.ZipFile(destination, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        data = {'README.md': readme.encode(), 'VERSION': (version + '\n').encode()}
        data.update({p.relative_to(ROOT).as_posix(): p.read_bytes() for p in paths})
        for name, content in sorted(data.items()):
            info = zipfile.ZipInfo(title + '/' + name, date_time=(2000, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, content)
    digest = hashlib.sha256(destination.read_bytes()).hexdigest()
    (OUT / 'SHA256SUMS.txt').write_text(digest + '  ' + destination.name + '\n')
    print(json.dumps({'version': version, 'file': str(destination), 'files': len(data), 'bytes': destination.stat().st_size, 'sha256': digest}))


if __name__ == '__main__':
    build()
