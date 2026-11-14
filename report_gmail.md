# 以 Gmail 應用程式密碼實作自動讀信與寄信

> 填寫提醒：程式會在本機 `results/` 產生每次執行的 JSON/Markdown 紀錄。請以實際測試結果填寫此報告；不要捏造輸出、不要將 `config.json`、16 字元應用程式密碼、完整信件內容或未遮蔽的第三方個資放進報告／截圖。正式 Gmail 實測需由本人執行。

## 目的

[以 100–200 字說明：本程式如何自動讀取 Gmail 收件匣並寄送郵件；為何使用 Google 應用程式密碼，而非在程式輸入一般帳號密碼；預期如何減少重複收發信操作。]

## 3.1 執行環境

| 項目 | 實際資料 |
|---|---|
| 作業系統 | [實際測試作業系統與版本] |
| Python 版本 | [執行 `python --version` 的結果] |
| 使用套件 | Python 標準函式庫：`imaplib`、`smtplib`、`email`、`json`、`argparse`、`pathlib`、`datetime` |
| Gmail 帳號 | [部分遮蔽，例如 `abc***@gmail.com`] |
| 測試日期 | [實際日期] |
| 程式檔案 | `gmail_auto.py` |

## 3.2 認證設定過程

1. 在 Google 帳戶開啟兩步驟驗證。
2. 建立 Gmail 應用程式密碼並填入本機 `config.json`。
3. `config.json` 已列入 `.gitignore`，不提交、不上傳、不截圖顯示密碼。

證據：[附兩步驟驗證／建立應用程式密碼流程截圖；密碼欄位必須遮蔽。]

## 3.3 程式架構說明

`gmail_auto.py` 只使用 Python 標準函式庫。`load_config` 讀取本機 JSON 設定並檢查欄位與密碼長度；`open_imap` 以 SSL 登入 Gmail IMAP；`read_inbox` 讀最新信件並可依未讀、日期、主旨過濾；`send_message` 透過 SMTP SSL 傳送純文字郵件；`verify_in_inbox` 在寄給自己的測試郵件送出後輪詢收件匣；`save_result` 將每次執行的安全摘要存入 `results/`。

連線端點：IMAP `imap.gmail.com:993`；SMTP SSL `smtp.gmail.com:465`。

## 3.4 讀信結果

- 執行命令：`python gmail_auto.py read --limit 5`
- 信箱搜尋到總數：[實際結果]
- 本次讀取筆數：[實際結果]
- 執行紀錄檔：[實際 `results/run_..._read.md` 檔名]

| 日期 | 寄件者（遮蔽個資） | 主旨 |
|---|---|---|
| [實際結果] | [實際結果] | [實際結果] |

證據：[附實際終端畫面或紀錄檔截圖。]

## 3.5 寄信結果

- 執行命令：[實際命令；只寄給本人或同組且已同意的測試信箱]
- 收件者：[部分遮蔽]
- 主旨：[實際主旨]
- 寄送時間：[實際時間]
- 執行紀錄檔：[實際 `results/run_..._send.md` 檔名]
- 收件端實際收到：[是／否；附收件匣截圖，遮蔽個資]

## 3.6 寄送後驗證

- 使用 `--verify` 寄給登入帳號本人：[是／否]
- 收件匣找到剛寄出的信：[實際結果]
- 驗證耗時：[實際紀錄秒數]
- 若未找到，排查結果：[實際說明]

## 3.7 錯誤與排除

| 實際錯誤 | 原因 | 排除方式 |
|---|---|---|
| [填入實際遇到的錯誤；若沒有，暫時輸入錯誤密碼執行一次] | [實際原因] | [實際處理方式] |

## 3.8 結論與心得

[依實際測試說明 F1–F5 是否通過、讀取與寄送結果、程式錯誤提示，以及仍可改進之處。若未完成 Gmail 實際登入或收信驗證，請明確標示未完成。]

## 執行與繳交

```text
python gmail_auto.py selftest
python gmail_auto.py read --limit 5
python gmail_auto.py send --to 自己的Gmail --subject "Gmail 作業測試" --body "這是一封自我測試郵件" --verify
```

繳交前確認壓縮檔包含 `gmail_auto.py`、報告及至少一筆成功執行紀錄；**不要包含 `config.json`**。檔名依課程格式使用 `學號_姓名_gmail作業.zip`。完成後到 Google 帳戶移除這次使用的應用程式密碼。
