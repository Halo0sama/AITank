#!/usr/bin/python3
"""Start the existing web game at its saved Edge origin, then open Edge."""

import argparse
import fcntl
import functools
import json
import socket
import subprocess
import sys
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import HTTPRedirectHandler, build_opener


HOST = "127.0.0.1"
PORT = 8000
URL = "http://127.0.0.1:8000/?paused=1"
TITLE = "<title>AI 坦克动荡 · 网页版</title>"
EDGE = "com.microsoft.edgemac"


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, new_url):
        return None


def is_game():
    try:
        with build_opener(NoRedirect).open(URL, timeout=1) as response:
            page = response.read(1024 * 1024).decode("utf-8", errors="replace")
            return response.status == 200 and TITLE in page and 'src="weapons.js' in page
    except (OSError, HTTPError, URLError):
        return False


def port_in_use():
    try:
        with socket.create_connection((HOST, PORT), timeout=0.5):
            return True
    except OSError:
        return False


def web_directory(value):
    if value:
        directory = Path(value)
    else:
        config = Path(__file__).with_name("config.json")
        if config.exists():
            directory = Path(json.loads(config.read_text(encoding="utf-8"))["web_directory"])
        else:
            directory = Path(__file__).resolve().parents[2] / "web"
    directory = directory.resolve()
    if not (directory / "index.html").is_file() or not (directory / "weapons.js").is_file():
        raise RuntimeError("找不到游戏文件，请检查项目目录：" + str(directory))
    return directory


def serve(directory):
    class Handler(SimpleHTTPRequestHandler):
        def log_message(self, message, *args):
            if args and isinstance(args[0], str) and args[0].startswith("GET "):
                return
            super().log_message(message, *args)

    handler = functools.partial(Handler, directory=str(directory))
    with ThreadingHTTPServer((HOST, PORT), handler) as server:
        print("AITank listening at " + URL, flush=True)
        server.serve_forever()


def ensure_server(directory):
    cache = Path.home() / "Library" / "Caches" / "AITank"
    logs = Path.home() / "Library" / "Logs" / "AITank"
    cache.mkdir(parents=True, exist_ok=True)
    logs.mkdir(parents=True, exist_ok=True)
    with (cache / "launcher.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if is_game():
            return
        if port_in_use():
            raise RuntimeError("8000 端口正在被其他服务使用。请关闭该服务后重新打开游戏；游戏地址保持不变，以便沿用学习存档。")
        with (logs / "server.log").open("ab", buffering=0) as log:
            child = subprocess.Popen(
                [sys.executable, str(Path(__file__).resolve()), "--serve", "--web-directory", str(directory)],
                cwd=str(directory), stdin=subprocess.DEVNULL, stdout=log, stderr=log,
                start_new_session=True, close_fds=True,
            )
        for _ in range(50):
            if is_game():
                return
            if child.poll() is not None:
                raise RuntimeError("游戏服务启动失败，日志位于：" + str(logs / "server.log"))
            time.sleep(0.1)
        raise RuntimeError("游戏服务未及时就绪，请稍后重试。日志位于：" + str(logs / "server.log"))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--web-directory")
    parser.add_argument("--serve", action="store_true")
    parser.add_argument("--server-only", action="store_true")
    args = parser.parse_args()
    directory = web_directory(args.web_directory)
    if args.serve:
        serve(directory)
        return
    ensure_server(directory)
    if not args.server_only:
        subprocess.run(["/usr/bin/open", "-b", EDGE, URL], check=True)
    print(URL)


if __name__ == "__main__":
    try:
        main()
    except (OSError, RuntimeError, ValueError, subprocess.CalledProcessError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
