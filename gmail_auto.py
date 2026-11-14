#!/usr/bin/env python3
"""Read and send Gmail messages over IMAP/SMTP using an app password."""

from __future__ import annotations

import argparse
import email
import imaplib
import json
import smtplib
import sys
import time
from datetime import date, datetime
from email.header import decode_header, make_header
from email.message import EmailMessage
from email.utils import make_msgid, parseaddr, parsedate_to_datetime
from pathlib import Path
from typing import Any


IMAP_HOST = "imap.gmail.com"
IMAP_PORT = 993
SMTP_HOST = "smtp.gmail.com"
SMTP_PORT = 465
CONFIG_PATH = Path(__file__).with_name("config.json")
RESULTS_DIR = Path(__file__).with_name("results")


class GmailAssignmentError(Exception):
    """An expected, user-actionable Gmail assignment error."""


def decode_mime(value: str | None) -> str:
    if not value:
        return "(無)"
    try:
        return str(make_header(decode_header(value)))
    except (LookupError, UnicodeError, TypeError, ValueError):
        return value


def load_config(path: Path = CONFIG_PATH) -> dict[str, str]:
    try:
        config: Any = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as error:
        raise GmailAssignmentError(
            "找不到 config.json。請複製 config.example.json 為 config.json，"
            "再填入自己的 Gmail 與應用程式密碼。"
        ) from error
    except json.JSONDecodeError as error:
        raise GmailAssignmentError(
            f"config.json 格式錯誤（第 {error.lineno} 行）：{error.msg}"
        ) from error
    except OSError as error:
        raise GmailAssignmentError(f"無法讀取設定檔：{error}") from error

    if not isinstance(config, dict):
        raise GmailAssignmentError("config.json 最外層必須是 JSON 物件。")

    account = config.get("email")
    app_password = config.get("app_password")
    if not isinstance(account, str) or "@" not in account:
        raise GmailAssignmentError("config.json 的 email 欄位不是有效的 Gmail 地址。")
    if not isinstance(app_password, str):
        raise GmailAssignmentError("config.json 缺少 app_password 字串欄位。")

    normalized_password = "".join(app_password.split())
    if len(normalized_password) != 16:
        raise GmailAssignmentError(
            "應用程式密碼應為 16 個字元；請確認複製完整，且不要把密碼貼到報告。"
        )
    return {"email": account.strip(), "app_password": normalized_password}


def open_imap(config: dict[str, str]) -> imaplib.IMAP4_SSL:
    client = imaplib.IMAP4_SSL(IMAP_HOST, IMAP_PORT, timeout=20)
    try:
        client.login(config["email"], config["app_password"])
    except (imaplib.IMAP4.error, OSError):
        try:
            client.logout()
        except (imaplib.IMAP4.error, OSError):
            pass
        raise
    return client


def parse_message(raw: bytes) -> dict[str, str]:
    message = email.message_from_bytes(raw)
    date_header = message.get("Date")
    parsed_date = ""
    if date_header:
        try:
            parsed_date = parsedate_to_datetime(date_header).astimezone().isoformat(
                timespec="seconds"
            )
        except (OverflowError, TypeError, ValueError):
            parsed_date = decode_mime(date_header)
    sender_name, sender_address = parseaddr(decode_mime(message.get("From")))
    sender = f"{sender_name} <{sender_address}>" if sender_name else sender_address
    return {
        "date": parsed_date or "(無)",
        "from": sender or "(無)",
        "subject": decode_mime(message.get("Subject")),
    }


def read_inbox(
    config: dict[str, str],
    limit: int,
    unread_only: bool = False,
    after: date | None = None,
    subject_keyword: str | None = None,
) -> tuple[int, list[dict[str, str]]]:
    if limit < 1:
        raise GmailAssignmentError("--limit 必須大於 0。")

    client = open_imap(config)
    try:
        status, _ = client.select("INBOX", readonly=True)
        if status != "OK":
            raise GmailAssignmentError("無法開啟 Gmail 收件匣。")
        status, search_data = client.search(None, "UNSEEN" if unread_only else "ALL")
        if status != "OK" or not search_data:
            raise GmailAssignmentError("無法搜尋 Gmail 收件匣。")

        message_ids = search_data[0].split()
        mailbox_total = len(message_ids)
        results: list[dict[str, str]] = []
        for message_id in reversed(message_ids):
            status, fetched = client.fetch(
                message_id, "(BODY.PEEK[HEADER.FIELDS (DATE FROM SUBJECT)])"
            )
            if status != "OK":
                raise GmailAssignmentError(
                    f"無法讀取郵件 ID {message_id.decode('ascii', errors='replace')}。"
                )
            raw_message = next(
                (
                    part[1]
                    for part in fetched
                    if isinstance(part, tuple) and isinstance(part[1], bytes)
                ),
                None,
            )
            if raw_message is None:
                continue
            item = parse_message(raw_message)
            if after is not None:
                try:
                    item_date = parsedate_to_datetime(
                        email.message_from_bytes(raw_message).get("Date", "")
                    )
                    if item_date.date() <= after:
                        continue
                except (OverflowError, TypeError, ValueError):
                    continue
            if subject_keyword and subject_keyword.casefold() not in item["subject"].casefold():
                continue
            results.append(item)
            if len(results) >= limit:
                break
        return mailbox_total, results
    finally:
        try:
            client.logout()
        except (imaplib.IMAP4.error, OSError):
            pass


def save_result(command: str, data: dict[str, Any]) -> tuple[Path, Path]:
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().astimezone().strftime("%Y%m%d_%H%M%S")
    stem = f"run_{timestamp}_{command}"
    json_path = RESULTS_DIR / f"{stem}.json"
    markdown_path = RESULTS_DIR / f"{stem}.md"
    data["command"] = command
    data["recorded_at"] = datetime.now().astimezone().isoformat(timespec="seconds")
    json_path.write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    markdown_path.write_text(render_markdown(data), encoding="utf-8")
    return json_path, markdown_path


def render_markdown(data: dict[str, Any]) -> str:
    lines = [
        f"# Gmail 作業執行紀錄：{data['command']}",
        "",
        f"- 執行時間：{data['recorded_at']}",
        f"- 測試帳號：{data.get('account', '(未提供)')}",
        f"- 結果：{data.get('status', 'unknown')}",
    ]
    if "mailbox_total" in data:
        lines.extend(
            [
                f"- 收件匣信件總數：{data['mailbox_total']}",
                f"- 本次讀取筆數：{len(data.get('messages', []))}",
                "",
                "| 日期 | 寄件者 | 主旨 |",
                "|---|---|---|",
            ]
        )
        for item in data.get("messages", []):
            values = [item.get(key, "").replace("|", "\\|").replace("\n", " ") for key in ("date", "from", "subject")]
            lines.append("| " + " | ".join(values) + " |")
    if "recipient" in data:
        lines.extend(
            [
                "",
                f"- 收件者：{data['recipient']}",
                f"- 主旨：{data['subject']}",
                f"- 寄送時間：{data['sent_at']}",
                f"- 收件匣驗證：{data['verified']}",
            ]
        )
    if data.get("error"):
        lines.extend(["", f"- 錯誤：{data['error']}"])
    return "\n".join(lines) + "\n"


def print_messages(total: int, messages: list[dict[str, str]]) -> None:
    print(f"收件匣搜尋到 {total} 封；本次讀取 {len(messages)} 封。")
    if not messages:
        print("沒有符合條件的郵件。")
        return
    for index, item in enumerate(messages, start=1):
        print(f"\n{index}. 日期：{item['date']}")
        print(f"   寄件者：{item['from']}")
        print(f"   主旨：{item['subject']}")


def check_connection(config: dict[str, str]) -> None:
    imap_client = open_imap(config)
    try:
        status, _ = imap_client.select("INBOX", readonly=True)
        if status != "OK":
            raise GmailAssignmentError("IMAP 登入成功，但無法開啟收件匣。")
    finally:
        try:
            imap_client.logout()
        except (imaplib.IMAP4.error, OSError):
            pass

    with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, timeout=20) as smtp:
        smtp.login(config["email"], config["app_password"])


def send_message(
    config: dict[str, str], recipient: str, subject: str, body: str
) -> dict[str, Any]:
    message = EmailMessage()
    message["From"] = config["email"]
    message["To"] = recipient
    message["Subject"] = subject
    message["Message-ID"] = make_msgid()
    message.set_content(body)
    sent_at = datetime.now().astimezone().isoformat(timespec="seconds")
    with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, timeout=20) as smtp:
        smtp.login(config["email"], config["app_password"])
        smtp.send_message(message)
    return {
        "recipient": recipient,
        "subject": subject,
        "sent_at": sent_at,
        "message_id": message["Message-ID"],
    }


def verify_in_inbox(
    config: dict[str, str], subject: str, timeout_seconds: int = 20
) -> tuple[bool, float]:
    started = time.monotonic()
    client = open_imap(config)
    try:
        status, _ = client.select("INBOX", readonly=True)
        if status != "OK":
            raise GmailAssignmentError("無法開啟 Gmail 收件匣以驗證測試郵件。")
        search_terms = subject.split()
        search_term = next(
            (term for term in reversed(search_terms) if any(char.isalpha() for char in term)),
            search_terms[-1],
        )
        while time.monotonic() - started < timeout_seconds:
            status, search_data = client.search(None, "SUBJECT", search_term)
            if status != "OK":
                raise GmailAssignmentError("無法搜尋 Gmail 收件匣以驗證測試郵件。")
            message_ids = search_data[0].split() if search_data else []
            for message_id in reversed(message_ids):
                status, fetched = client.fetch(
                    message_id, "(BODY.PEEK[HEADER.FIELDS (FROM SUBJECT)])"
                )
                if status != "OK":
                    raise GmailAssignmentError("無法讀取測試郵件標頭以完成驗證。")
                raw_header = next(
                    (
                        part[1]
                        for part in fetched
                        if isinstance(part, tuple) and isinstance(part[1], bytes)
                    ),
                    None,
                )
                if raw_header is not None:
                    found = parse_message(raw_header)
                    if (
                        found["subject"] == subject
                        and config["email"].casefold() in found["from"].casefold()
                    ):
                        return True, time.monotonic() - started
            time.sleep(2)
        return False, time.monotonic() - started
    finally:
        try:
            client.logout()
        except (imaplib.IMAP4.error, OSError):
            pass


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="使用 Gmail 應用程式密碼透過 IMAP 讀信、SMTP 寄信。"
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser("selftest", help="測試設定與 IMAP/SMTP 登入")

    read_parser = subparsers.add_parser("read", help="讀取收件匣最新郵件")
    read_parser.add_argument("--limit", type=int, default=5, help="最多讀取幾封（預設 5）")
    read_parser.add_argument("--unread", action="store_true", help="只讀未讀信")
    read_parser.add_argument("--after", type=date.fromisoformat, help="只列出此日期之後的郵件（YYYY-MM-DD）")
    read_parser.add_argument("--subject", help="只列出主旨包含此關鍵字的郵件")

    send_parser = subparsers.add_parser("send", help="寄送一封純文字測試信")
    send_parser.add_argument("--to", required=True, help="收件者；請使用本人或同組同學同意的信箱")
    send_parser.add_argument("--subject", required=True, help="郵件主旨")
    send_parser.add_argument("--body", required=True, help="郵件內文")
    send_parser.add_argument(
        "--verify",
        action="store_true",
        help="若寄給登入帳號本人，寄出後輪詢收件匣驗證",
    )
    return parser


def run(args: argparse.Namespace) -> int:
    config = load_config()
    result: dict[str, Any] = {"account": config["email"], "status": "success"}
    if args.command == "selftest":
        check_connection(config)
        print("設定檔有效；IMAP 與 SMTP 登入測試成功。未寄出任何郵件。")
    elif args.command == "read":
        total, messages = read_inbox(
            config,
            args.limit,
            unread_only=args.unread,
            after=args.after,
            subject_keyword=args.subject,
        )
        print_messages(total, messages)
        result.update(
            {
                "mailbox_total": total,
                "messages": messages,
                "filters": {
                    "unread": args.unread,
                    "after": args.after.isoformat() if args.after else None,
                    "subject": args.subject,
                },
            }
        )
    elif args.command == "send":
        sent = send_message(config, args.to, args.subject, args.body)
        result.update(sent)
        result["verified"] = "not_requested"
        print(
            f"SMTP 已接受郵件：收件者 {sent['recipient']}，"
            f"主旨「{sent['subject']}」，時間 {sent['sent_at']}。"
        )
        if args.verify:
            if args.to.casefold() != config["email"].casefold():
                result["verified"] = "not_possible_other_recipient"
                print("未驗證收件匣：--verify 僅能驗證寄給登入帳號本人的郵件。")
            else:
                try:
                    verified, elapsed = verify_in_inbox(config, args.subject)
                    result["verified"] = verified
                    result["verification_seconds"] = round(elapsed, 2)
                    if verified:
                        print(f"寄送後驗證成功：收件匣已找到測試信（{elapsed:.1f} 秒）。")
                    else:
                        result["status"] = "sent_verification_timeout"
                        print(
                            "SMTP 已接受寄送，但等待期間未在收件匣找到郵件；"
                            "請檢查垃圾郵件、IMAP 狀態或主旨後再確認。"
                        )
                except (GmailAssignmentError, imaplib.IMAP4.error, OSError) as error:
                    result["status"] = "sent_verification_error"
                    result["verified"] = "error"
                    result["verification_error"] = str(error)
                    print(f"郵件已寄出，但驗證時發生錯誤：{error}", file=sys.stderr)
    json_path, markdown_path = save_result(args.command, result)
    print(f"執行紀錄已儲存：{json_path} 與 {markdown_path}")
    return 0 if result["status"] == "success" else 1


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        return run(args)
    except GmailAssignmentError as error:
        print(f"設定／操作錯誤：{error}", file=sys.stderr)
        return 2
    except imaplib.IMAP4.error as error:
        print(
            "IMAP 登入或操作失敗。請確認兩步驟驗證、應用程式密碼、"
            f"Gmail IMAP 設定及帳號：{error}",
            file=sys.stderr,
        )
        return 2
    except smtplib.SMTPAuthenticationError as error:
        print(
            "SMTP 認證失敗。請重新建立應用程式密碼並確認帳號正確；"
            f"伺服器回應碼：{error.smtp_code}",
            file=sys.stderr,
        )
        return 2
    except (smtplib.SMTPException, OSError) as error:
        print(
            "網路或 Gmail 服務錯誤。請檢查網路、IMAP/SMTP 主機及防火牆設定："
            f"{error}",
            file=sys.stderr,
        )
        return 2
    except ValueError as error:
        print(f"輸入內容無效：{error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
