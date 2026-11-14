# 以 Gmail 應用程式密碼實作自動讀信與寄信

> 個資提醒：請勿將 `config.json`、16 字元應用程式密碼、完整信件內容或未遮蔽的第三方個資放進報告／截圖。此報告已填入本次實際測試結果；Google 設定過程與收件匣畫面仍請附上本人截圖並遮蔽資訊。

## 目的

本作業以 Python 程式讀取 Gmail 收件匣最新郵件，並透過 SMTP 寄出測試信，再用 IMAP 搜尋確認寄給自己的信件是否抵達。程式從本機設定檔讀取 Google 應用程式密碼，不在原始碼中寫入一般帳號密碼；應用程式密碼可在需要時由使用者撤銷，降低憑證暴露的風險。透過自動列出郵件日期、寄件者與主旨，以及寄信後的收件匣驗證，可減少重複手動檢查。本次已實際測試 IMAP/SMTP 登入、讀取 5 封郵件、寄送自我測試信並在收件匣找到該信；詳細結果及遮蔽紀錄列於以下各節。

## 3.1 執行環境

| 項目 | 實際資料 |
|---|---|
| 作業系統 | Windows 10（10.0.19045） |
| Python 版本 | Python 3.11.5 |
| 使用套件 | Python 標準函式庫：`imaplib`、`smtplib`、`email`、`json`、`argparse`、`pathlib`、`datetime` |
| Gmail 帳號 | `w***@gmail.com`（部分遮蔽） |
| 測試日期 | 2026-11-14 |
| 程式檔案 | `gmail_auto.py` |

## 3.2 認證設定過程

1. 在 Google 帳戶開啟兩步驟驗證並建立 Gmail 應用程式密碼。
2. 將 Gmail 地址及應用程式密碼存於本機 `config.json`；程式成功使用該設定登入 IMAP 與 SMTP。
3. `config.json` 已列入 `.gitignore`，確認不會進入 Git 版本控制；密碼未寫入程式、紀錄或本報告。

登入測試紀錄：`results/submission_selftest_log.md`。證據：[請附兩步驟驗證／建立應用程式密碼流程截圖及本機成功連線畫面；密碼欄位必須遮蔽。]

## 3.3 程式架構說明

`gmail_auto.py` 只使用 Python 標準函式庫。`load_config` 讀取本機 JSON 設定並檢查欄位與密碼長度；`open_imap` 以 SSL 登入 Gmail IMAP；`read_inbox` 讀最新信件並可依未讀、日期、主旨過濾；`send_message` 透過 SMTP SSL 傳送純文字郵件；`verify_in_inbox` 在寄給自己的測試郵件送出後輪詢收件匣；`save_result` 將每次執行的安全摘要存入 `results/`。

連線端點：IMAP `imap.gmail.com:993`；SMTP SSL `smtp.gmail.com:465`。

## 3.4 讀信結果

- 執行命令：`python gmail_auto.py read --limit 5`
- 信箱搜尋到總數：13,692 封
- 本次讀取筆數：5 封
- 執行時間：2026-11-14 21:24（UTC+8）
- 執行紀錄檔：`results/submission_read_log.md`

| 日期（UTC+8） | 寄件者 | 主旨 |
|---|---|---|
| 2026-11-14 20:05:19 | 已遮蔽 | 已遮蔽 |
| 2026-11-14 20:04:23 | 已遮蔽 | 已遮蔽 |
| 2026-11-14 19:36:40 | 已遮蔽 | 已遮蔽 |
| 2026-11-14 16:26:59 | 已遮蔽 | 已遮蔽 |
| 2026-11-14 12:57:19 | 已遮蔽 | 已遮蔽 |

證據：請附遮蔽後的 `results/submission_read_log.md` 或執行畫面。

## 3.5 寄信結果

- 執行方式：以 `gmail_auto.py` 的 `send_message` SMTP SSL 功能寄給設定檔中的帳號本人。
- 收件者：本人 Gmail（`w***@gmail.com`，部分遮蔽）
- 主旨：`Gmail Assignment Verification 20261114-212407`
- 寄送時間：約 2026-11-14 21:24（程式執行途中曾中斷，精確 SMTP 完成時間未保存）
- 收件時間：2026-11-14 21:24:11（IMAP 收件匣 Date 標頭）
- 執行紀錄檔：`results/submission_send_verification_log.md`
- 收件端實際收到：是；本人確認收到，且 IMAP 後續找到相同寄件者與完整主旨。請附本人收件匣截圖並遮蔽地址。

## 3.6 寄送後驗證

- 寄給登入帳號本人並驗證：[是]
- 收件匣找到剛寄出的信：[是；寄件者與完整主旨均符合]
- 驗證耗時：1.62 秒
- 程式最佳化：只搜尋符合主旨的郵件標頭，避免在大型收件匣下載完整信件內容。
- 驗證紀錄：`results/submission_send_verification_log.md`

## 3.7 錯誤與排除

| 實際錯誤 | 原因 | 排除方式 |
|---|---|---|
| 將應用程式密碼於記憶體中故意改錯一個字元後測試 IMAP，登入遭拒（`imaplib.IMAP4.error`）。錯誤值未寫入檔案。 | Gmail 拒絕不正確的應用程式密碼。 | 有效設定的 IMAP／SMTP 登入成功；未將錯誤密碼存檔或提交。紀錄：`results/submission_bad_password_log.md`。 |

## 3.8 結論與心得

本次已完成實際 Gmail 測試：IMAP 與 SMTP 登入成功、讀取收件匣最新 5 封郵件、寄送自我測試郵件並在收件匣驗證成功，錯誤密碼也被正確拒絕；因此 F1–F5 的核心功能均已驗證。讀取紀錄遮蔽了寄件者與主旨，以保護信件隱私。可再改善之處包括以 IMAP 搜尋條件直接縮小讀取範圍，並持續避免將設定檔、密碼與私人郵件資料納入公開或繳交內容。

## 執行與繳交

```text
python gmail_auto.py selftest
python gmail_auto.py read --limit 5
python gmail_auto.py send --to 自己的Gmail --subject "Gmail 作業測試" --body "這是一封自我測試郵件" --verify
```

繳交前確認壓縮檔包含 `gmail_auto.py`、報告及至少一筆成功執行紀錄；**不要包含 `config.json`**。檔名依課程格式使用 `學號_姓名_gmail作業.zip`。完成後到 Google 帳戶移除這次使用的應用程式密碼。
