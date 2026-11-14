# 作業一：Gmail 自動讀寫

依課程 Word 說明的必要規格，作業一程式為 [`gmail_auto.py`](./gmail_auto.py)：使用 Python 標準函式庫、Google 應用程式密碼、IMAP 讀信和 SMTP 寄信，並可在寄給自己的測試信後驗證收件匣。沒有第三方 Python 套件需求。先依 `config.example.json` 建立本機 `config.json`；設定檔已由 `.gitignore` 排除，**不可上傳、繳交或截圖暴露密碼**。使用方式與報告填寫項目見 [`report_gmail.md`](./report_gmail.md)。

```text
python gmail_auto.py selftest
python gmail_auto.py read --limit 5
python gmail_auto.py send --to 自己的Gmail --subject "Gmail 作業測試" --body "這是一封自我測試郵件" --verify
```

`results/` 會記錄執行摘要，亦已由 `.gitignore` 排除以免公開郵件資料；繳交時請先檢查及遮蔽個資，再手動把必要紀錄放進作業 ZIP。

## 額外瀏覽器版（非 IMAP/SMTP）

同一 repository 的首頁是另一種 Gmail 網頁版實作，使用 Google OAuth 2.0 與 Gmail API 讀取、寄送郵件。瀏覽器不能安全地直接連線 IMAP/SMTP；此網頁不要求輸入或儲存 Gmail 密碼、應用程式密碼或 OAuth client secret。**它不是課程 Word 指定的 Python＋應用程式密碼版本，報告不可把 OAuth 說成 IMAP/SMTP。**

## Google OAuth 設定

1. 在 Google Cloud Console 建立專案並啟用 **Gmail API**。
2. 設定 OAuth 同意畫面，依 Google 規定設定測試使用者或完成應用程式驗證。
3. 建立 OAuth 用戶端 ID，應用程式類型選 **Web application**。
4. 在「已授權的 JavaScript 來源」加入實際網頁來源，例如：
   - `http://localhost:8000`（本機測試）
   - `https://LAZY8870.github.io`（GitHub Pages）
5. 將產生的用戶端 ID 填入 `index.html` 的 `GOOGLE_CLIENT_ID`。用戶端 ID 不是密碼；不要建立或放入 client secret。
6. 在 GitHub repository 的 **Settings → Pages** 將部署來源設為 `main` 分支的 `/ (root)`。部署完成後，網站網址會是 `https://LAZY8870.github.io/-/`。

## 本機預覽

以 VS Code 的 Live Server 開啟 `index.html`，或在本目錄執行任何本機靜態 HTTP server。不要直接用 `file://` 測試 Google OAuth；OAuth 需要符合設定的 HTTP(S) 網頁來源。

## 功能

- Google 網頁授權；僅要求 Gmail 讀信和寄信權限。
- 顯示最新 10 封收件匣郵件的日期、寄件者和主旨。
- 支援主旨關鍵字與日期之後篩選。
- 寄送文字郵件；寄給登入帳號時自動搜尋收件匣並驗證是否收到。
- 使用後可登出並撤銷授權。
- 每次讀信、寄信、驗證與錯誤均顯示於執行狀態區。

> 此 OAuth 網頁版與原作業指定的 16 字元應用程式密碼 + IMAP/SMTP 不同。報告應明確描述實際採用的 Gmail API/OAuth 方法及實際測試結果，不可宣稱使用 IMAP/SMTP。

## 作業二：QR Code 導引網頁

第二份作業已獨立放在 [qrcode/](./qrcode/)；部署網址為 [`https://LAZY8870.github.io/-/qrcode/`](https://LAZY8870.github.io/-/qrcode/)。此頁提供瀏覽器版 QR Code 產生與解碼驗證，Python 作業程式則支援 `make`、`decode`、`compare` 與 `serve`。本機 `serve` 模式會記錄實際連線時間、來源 IP 與瀏覽器，GitHub Pages 本身是靜態網站，不能取代此本機連線紀錄。

## 作業三：餐廳候位系統

第三份作業位於 [waitlist/](./waitlist/)，包含顧客候位頁、員工管理頁、自寫 FIFO Queue 與 Google Apps Script Gmail 通知後端。預設示範模式只儲存資料於同一瀏覽器，不會跨裝置同步或真的寄信；正式功能須依 [waitlist/README.md](./waitlist/README.md) 部署 Apps Script，並設定後端網址與員工金鑰。
