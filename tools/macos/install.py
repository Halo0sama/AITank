#!/usr/bin/python3
"""Install the AITank web launcher in /Applications without moving game data."""

import json
import plistlib
import shutil
import subprocess
import tempfile
from pathlib import Path


APP = Path("/Applications/AI 坦克动荡.app")
IDENTIFIER = "com.halo.aitank.launcher"
SOURCE = '''on run
    try
        set helper to POSIX path of (path to resource "launcher.py")
        do shell script "/usr/bin/python3 " & quoted form of helper
    on error reason
        display alert "AI 坦克动荡启动失败" message reason as critical
    end try
end run
'''


def main():
    here = Path(__file__).resolve().parent
    web = here.parents[1] / "web"
    if not (web / "index.html").is_file():
        raise RuntimeError("游戏目录不存在：" + str(web))
    if not Path("/Applications/Microsoft Edge.app").is_dir():
        raise RuntimeError("未找到 Microsoft Edge，请先安装后重试。")
    if APP.exists():
        with (APP / "Contents" / "Info.plist").open("rb") as stream:
            if plistlib.load(stream).get("CFBundleIdentifier") != IDENTIFIER:
                raise RuntimeError("同名应用已存在，未覆盖：" + str(APP))
    with tempfile.TemporaryDirectory(prefix="aitank-launcher-") as temporary:
        root = Path(temporary)
        script = root / "launcher.applescript"
        script.write_text(SOURCE, encoding="utf-8")
        bundle = root / APP.name
        subprocess.run(["/usr/bin/osacompile", "-o", str(bundle), str(script)], check=True)
        resources = bundle / "Contents" / "Resources"
        shutil.copy2(here / "launcher.py", resources / "launcher.py")
        (resources / "config.json").write_text(json.dumps({"web_directory": str(web)}, ensure_ascii=False), encoding="utf-8")
        info = bundle / "Contents" / "Info.plist"
        with info.open("rb") as stream:
            metadata = plistlib.load(stream)
        metadata.update({
            "CFBundleIdentifier": IDENTIFIER,
            "CFBundleName": "AI 坦克动荡",
            "CFBundleDisplayName": "AI 坦克动荡",
            "CFBundleVersion": "1",
            "CFBundleShortVersionString": "1.0",
            "LSApplicationCategoryType": "public.app-category.games",
            "LSUIElement": True,
        })
        with info.open("wb") as stream:
            plistlib.dump(metadata, stream)
        subprocess.run(["/usr/bin/codesign", "--force", "--sign", "-", str(bundle)], check=True)
        if APP.exists():
            backup_root = Path(tempfile.mkdtemp(prefix="aitank-previous-launcher-"))
            shutil.move(str(APP), str(backup_root / APP.name))
        shutil.move(str(bundle), str(APP))
    print(APP)


if __name__ == "__main__":
    main()
