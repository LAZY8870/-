"""Generate, decode, compare, and locally serve QR Code assignment pages."""

from __future__ import annotations

import argparse
import html
import json
import socket
import sys
from datetime import datetime
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

try:
    import cv2
    import numpy as np
    import qrcode
    from PIL import Image, ImageDraw, ImageFont
    from qrcode.constants import (
        ERROR_CORRECT_H,
        ERROR_CORRECT_L,
        ERROR_CORRECT_M,
        ERROR_CORRECT_Q,
    )
except ImportError as exc:
    missing = exc.name or "required package"
    raise SystemExit(
        f"缺少套件 {missing}。請先執行：python -m pip install -r requirements-qrcode.txt"
    ) from exc


BASE_DIR = Path(__file__).resolve().parent
RESULTS_DIR = BASE_DIR / "results"
SITE_DIR = BASE_DIR / "site"
ERROR_LEVELS = {
    "L": ERROR_CORRECT_L,
    "M": ERROR_CORRECT_M,
    "Q": ERROR_CORRECT_Q,
    "H": ERROR_CORRECT_H,
}


class AssignmentError(Exception):
    """A user-facing QR assignment operation error."""


def timestamp() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def validate_url(value: str) -> str:
    url = value.strip()
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise AssignmentError("網址必須是完整的 http:// 或 https:// URL。")
    return url


def save_result(mode: str, data: dict[str, Any], run_stamp: str | None = None) -> Path:
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    stamp = run_stamp or datetime.now().strftime("%Y%m%d_%H%M%S")
    stem = f"qr_{mode}_{stamp}"
    json_path = RESULTS_DIR / f"{stem}.json"
    md_path = RESULTS_DIR / f"{stem}.md"
    json_path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    rows = [
        f"# QR Code 執行紀錄：{mode}",
        "",
        f"- 開始時間：{data.get('started_at', '')}",
        f"- 結束時間：{data.get('finished_at', '')}",
        "",
        "| 項目 | 結果 |",
        "|---|---|",
    ]
    for key, value in data.items():
        if key in ("started_at", "finished_at", "events", "comparison"):
            continue
        if isinstance(value, list):
            value = ", ".join(str(entry) for entry in value)
        safe = str(value).replace("|", "\\|").replace("\n", " ")
        rows.append(f"| {key} | {safe} |")
    comparison = data.get("comparison")
    if comparison:
        rows.extend([
            "",
            "## 容錯比較",
            "",
            "| 等級 | 版本 | 模組數 | 像素 | 檔案大小（bytes） | 解碼驗證 |",
            "|---|---:|---:|---:|---:|---|",
        ])
        for item in comparison:
            rows.append(
                f"| {item['level']} | {item['version']} | {item['module_count']} "
                f"| {item['pixels']} | {item['file_size']} | {'成功' if item['verified'] else '失敗'} |"
            )
    events = data.get("events")
    if events is not None:
        rows.extend([
            "",
            "## 本機連線事件",
            "",
            "| 時間 | 事件 | 來源 IP | 瀏覽器 | 簽到名稱 |",
            "|---|---|---|---|---|",
        ])
        for event in events:
            agent = event.get("user_agent", "").replace("|", "\\|")
            visitor = event.get("visitor", "").replace("|", "\\|")
            rows.append(
                f"| {event['time']} | {event['event']} | {event['ip']} | {agent} | {visitor} |"
            )
    md_path.write_text("\n".join(rows) + "\n", encoding="utf-8")
    print(f"執行紀錄已存至：{md_path}")
    return md_path


def decode_image(path: Path) -> str:
    if not path.is_file():
        raise AssignmentError(f"找不到圖片檔：{path}")
    image = cv2.imdecode(np.frombuffer(path.read_bytes(), dtype=np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise AssignmentError(f"無法讀取圖片：{path}")
    content, _points, _straight = cv2.QRCodeDetector().detectAndDecode(image)
    if not content:
        raise AssignmentError("圖片中找不到可解碼的 QR Code。")
    return content


def build_qr(url: str, level: str, box_size: int, border: int, label: str | None) -> tuple[Image.Image, dict[str, Any]]:
    if level not in ERROR_LEVELS:
        raise AssignmentError("容錯等級必須是 L、M、Q 或 H。")
    qr = qrcode.QRCode(
        version=None,
        error_correction=ERROR_LEVELS[level],
        box_size=box_size,
        border=border,
    )
    qr.add_data(url)
    qr.make(fit=True)
    image = qr.make_image(fill_color="black", back_color="white").convert("RGB")

    if label:
        padding = max(12, box_size * 2)
        band_height = max(36, box_size * 5)
        canvas = Image.new("RGB", (image.width, image.height + band_height), "white")
        canvas.paste(image, (0, 0))
        draw = ImageDraw.Draw(canvas)
        font = ImageFont.load_default()
        text_width = draw.textbbox((0, 0), label, font=font)[2]
        if text_width > canvas.width - 2 * padding:
            raise AssignmentError("標籤文字太長，請縮短標籤或增加 QR 圖片尺寸。")
        draw.text(
            ((canvas.width - text_width) / 2, image.height + (band_height - 12) / 2),
            label,
            fill="black",
            font=font,
        )
        image = canvas

    stats = {
        "version": qr.version,
        "module_count": len(qr.modules),
        "error_level": level,
        "pixels": f"{image.width}x{image.height}",
    }
    return image, stats


def generate_qr(url: str, output: Path, level: str, box_size: int, border: int,
                label: str | None) -> dict[str, Any]:
    url = validate_url(url)
    image, stats = build_qr(url, level, box_size, border, label)
    output.parent.mkdir(parents=True, exist_ok=True)
    image.save(output, format="PNG")
    decoded = decode_image(output)
    verified = decoded == url
    data: dict[str, Any] = {
        **stats,
        "url": url,
        "output": str(output.resolve()),
        "file_size": output.stat().st_size,
        "decoded_content": decoded,
        "verified": verified,
    }
    if not verified:
        raise AssignmentError(f"解碼內容與原網址不相同：{decoded}")
    print(f"QR Code 已產生：{output}")
    print(f"網址：{url}")
    print(
        f"版本：{stats['version']}；模組：{stats['module_count']}x{stats['module_count']}；"
        f"容錯：{level}；像素：{stats['pixels']}；檔案：{data['file_size']} bytes"
    )
    print(f"OpenCV 解碼驗證：成功（{decoded}）")
    return data


def run_make(args: argparse.Namespace, started_at: str) -> int:
    output = Path(args.out)
    data = {
        "mode": "make",
        "started_at": started_at,
        "url": args.url,
        **generate_qr(args.url, output, args.level, args.box_size, args.border, args.label),
        "finished_at": timestamp(),
    }
    save_result("make", data)
    return 0


def run_decode(args: argparse.Namespace, started_at: str) -> int:
    image_path = Path(args.image)
    content = decode_image(image_path)
    data = {
        "mode": "decode",
        "started_at": started_at,
        "image": str(image_path.resolve()),
        "decoded_content": content,
        "finished_at": timestamp(),
    }
    print(f"解碼內容：{content}")
    save_result("decode", data)
    return 0


def run_compare(args: argparse.Namespace, started_at: str) -> int:
    url = validate_url(args.url)
    output_dir = Path(args.out_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    results = []
    for level in ERROR_LEVELS:
        output = output_dir / f"qr_{level}.png"
        item = generate_qr(url, output, level, args.box_size, args.border, None)
        item["level"] = level
        results.append(item)
    data = {
        "mode": "compare",
        "started_at": started_at,
        "url": url,
        "comparison": results,
        "finished_at": timestamp(),
    }
    save_result("compare", data)
    return 0 if all(item["verified"] for item in results) else 1


def discover_lan_ip() -> str:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
            probe.connect(("8.8.8.8", 80))
            address = probe.getsockname()[0]
            if not address.startswith("127."):
                return address
    except OSError:
        pass
    addresses = socket.gethostbyname_ex(socket.gethostname())[2]
    for address in addresses:
        if not address.startswith("127."):
            return address
    raise AssignmentError("無法偵測區網 IP；請確認電腦已連上 Wi-Fi 或網路。")


def create_personal_page(name: str, student_id: str) -> None:
    template = SITE_DIR / "index.template.html"
    if not template.is_file():
        raise AssignmentError(f"找不到個人網站範本：{template}")
    source = template.read_text(encoding="utf-8")
    rendered = source.replace("__NAME__", html.escape(name)).replace(
        "__STUDENT_ID__", html.escape(student_id)
    )
    (SITE_DIR / "index.html").write_text(rendered, encoding="utf-8")


def run_serve(args: argparse.Namespace, started_at: str) -> int:
    name = args.name.strip()
    student_id = args.student_id.strip()
    if not name or not student_id:
        raise AssignmentError("啟動個人頁面前請提供非空白姓名與學號。")
    create_personal_page(name, student_id)
    address = discover_lan_ip()
    url = f"http://{address}:{args.port}/"
    qr_path = BASE_DIR / "qr_site.png"
    qr_data = generate_qr(url, qr_path, args.level, args.box_size, 4, name)
    run_stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    log_path = RESULTS_DIR / f"qr_serve_{run_stamp}.json"
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    events: list[dict[str, str]] = []
    metadata: dict[str, Any] = {
        "mode": "serve",
        "started_at": started_at,
        "url": url,
        "name": name,
        "student_id": student_id,
        "qr_image": str(qr_path.resolve()),
        "qr_version": qr_data["version"],
        "qr_module_count": qr_data["module_count"],
        "qr_error_level": args.level,
        "qr_pixels": qr_data["pixels"],
        "qr_file_size": qr_data["file_size"],
        "events": events,
    }

    class RequestHandler(SimpleHTTPRequestHandler):
        def _write_json(self, status: int, payload: dict[str, Any]) -> None:
            content = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(content)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(content)

        def _record(self, event_type: str, visitor: str = "") -> None:
            event = {
                "time": timestamp(),
                "event": event_type,
                "ip": self.client_address[0],
                "user_agent": self.headers.get("User-Agent", "unknown"),
                "visitor": visitor,
            }
            events.append(event)
            metadata["finished_at"] = timestamp()
            log_path.write_text(
                json.dumps(metadata, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
            print(
                f"[{event['time']}] {event_type} ip={event['ip']} "
                f"browser={event['user_agent']}"
                + (f" visitor={visitor}" if visitor else "")
            )

        def do_GET(self) -> None:
            path = urlparse(self.path).path
            if path == "/api/status":
                self._write_json(200, {
                    "visits": sum(event["event"] == "page_view" for event in events),
                    "checkins": sum(event["event"] == "checkin" for event in events),
                })
                return
            if path == "/":
                try:
                    self._record("page_view")
                except OSError as exc:
                    self.send_error(500, f"無法寫入連線紀錄：{exc}")
                    return
            super().do_GET()

        def do_POST(self) -> None:
            if urlparse(self.path).path != "/api/checkins":
                self.send_error(404, "Not found")
                return
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if length > 4096:
                    self._write_json(413, {"error": "Request too large"})
                    return
                payload = json.loads(self.rfile.read(length).decode("utf-8"))
                visitor = str(payload.get("visitor", "")).strip()[:40]
                self._record("checkin", visitor)
                total = sum(event["event"] == "checkin" for event in events)
                self._write_json(200, {"ok": True, "total": total})
            except (UnicodeDecodeError, json.JSONDecodeError, ValueError) as exc:
                self._write_json(400, {"error": f"Invalid request: {exc}"})
            except OSError as exc:
                self._write_json(500, {"error": f"Could not write visit log: {exc}"})

        def log_message(self, fmt: str, *values: object) -> None:
            print(f"[HTTP] {self.address_string()} {fmt % values}")

    server = ThreadingHTTPServer(
        (args.host, args.port),
        partial(RequestHandler, directory=str(SITE_DIR)),
    )
    server.daemon_threads = True
    server.timeout = 1
    metadata["finished_at"] = timestamp()
    log_path.write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"個人網站：{SITE_DIR / 'index.html'}")
    print(f"電腦瀏覽網址：http://127.0.0.1:{args.port}/")
    print(f"同一 Wi-Fi 手機網址：{url}")
    print(f"QR Code：{qr_path}")
    print("請用至少兩台連接同一 Wi-Fi 的手機掃描 QR Code。按 Ctrl+C 結束並產生摘要。")
    exit_code = 0
    try:
        while True:
            server.handle_request()
    except KeyboardInterrupt:
        print("\n已收到結束指令，正在儲存連線摘要。")
    except OSError as exc:
        exit_code = 1
        print(f"網站伺服器錯誤：{exc}", file=sys.stderr)
    finally:
        server.server_close()
        metadata["finished_at"] = timestamp()
        metadata["events"] = events
        save_result("serve", metadata, run_stamp=run_stamp)
    return exit_code


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="QR Code 產生、解碼、比較與本機網站工具")
    subparsers = parser.add_subparsers(dest="command", required=True)

    make = subparsers.add_parser("make", help="產生 QR PNG 並用 OpenCV 解碼驗證")
    make.add_argument("--url", required=True, help="要編入 QR Code 的完整網址")
    make.add_argument("--out", default="qrcode.png", help="輸出 PNG 路徑")
    make.add_argument("--label", help="在圖片下方加入文字標籤")
    make.add_argument("--level", choices=ERROR_LEVELS.keys(), default="M")
    make.add_argument("--box-size", type=int, default=10)
    make.add_argument("--border", type=int, default=4)

    decode = subparsers.add_parser("decode", help="解碼 QR 圖片")
    decode.add_argument("image", help="圖片路徑")

    compare = subparsers.add_parser("compare", help="比較 L/M/Q/H 容錯等級")
    compare.add_argument("--url", required=True)
    compare.add_argument("--out-dir", default=str(BASE_DIR / "results" / "comparison"))
    compare.add_argument("--box-size", type=int, default=10)
    compare.add_argument("--border", type=int, default=4)

    serve = subparsers.add_parser("serve", help="啟動區網個人網站並記錄訪問")
    serve.add_argument("--name", required=True, help="個人頁顯示姓名")
    serve.add_argument("--student-id", required=True, help="個人頁顯示學號")
    serve.add_argument("--host", default="0.0.0.0", help=argparse.SUPPRESS)
    serve.add_argument("--port", type=int, default=8000)
    serve.add_argument("--level", choices=ERROR_LEVELS.keys(), default="M")
    serve.add_argument("--box-size", type=int, default=10)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    started_at = timestamp()
    try:
        if args.command == "make":
            return run_make(args, started_at)
        if args.command == "decode":
            return run_decode(args, started_at)
        if args.command == "compare":
            return run_compare(args, started_at)
        if args.command == "serve":
            return run_serve(args, started_at)
        raise AssignmentError("未知命令。")
    except (AssignmentError, OSError, cv2.error, ValueError) as exc:
        print(f"錯誤：{exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
