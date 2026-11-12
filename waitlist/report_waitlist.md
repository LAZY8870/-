# 以 GitHub Pages 與 Apps Script 建置餐廳線上候位系統

> 報告草稿。請以自己的 Apps Script 部署、實際操作截圖、測試 E-mail 與事件紀錄補完方括號欄位；沒有實際完成的測試請如實標記為未完成。公開前遮蔽顧客個資與員工密碼。

## 目的

紙本或現場排隊需要顧客留在餐廳門口等待，也不方便即時掌握前方人數。本系統讓顧客透過 QR Code 開啟候位頁，填寫姓名、性別、E-mail 和人數後取得號碼，並查看自己的排隊位置；輪到時由員工通知顧客回櫃台。前端使用 GitHub Pages，後端使用 Google Apps Script、PropertiesService 和 MailApp，不需自架伺服器或外部資料庫。系統以自己實作的 FIFO Queue 管理加入順序，並提供員工驗證、通知、入座、取消和操作紀錄。

## 3.1 執行環境

- GitHub：`LAZY8870`
- GitHub Pages 顧客頁：<https://lazy8870.github.io/-/waitlist/>
- GitHub Pages 員工頁：<https://lazy8870.github.io/-/waitlist/staff.html>
- Apps Script 部署：[填入自己的 `/exec` 網址；不公開分享員工密碼]
- Google 帳號：[部分遮蔽]
- 測試手機型號與數量：[依本人實際測試填寫]
- 瀏覽器：[實際測試瀏覽器及版本]
- 證據：[附環境畫面與兩個 Pages 網頁截圖]

## 3.2 系統規劃

```text
顧客手機 ── GitHub Pages 顧客頁 ── Apps Script API ── PropertiesService FIFO Queue
員工瀏覽器 ── GitHub Pages 員工頁 ── Apps Script 密碼驗證 ── MailApp / Gmail 通知
```

| Action | 方法 | 功能 |
|---|---|---|
| `count` / `publicQueue` | GET | 公開等候組數及安全的 Queue 預覽 |
| `join` | POST | 加入 Queue，回傳號碼與前方組數 |
| `status` / `leave` | POST | 以票券 token 查詢狀態或取消 |
| `queue` / `log` | POST | 員工驗證後查 Queue、統計與事件 |
| `notify` / `seat` / `cancel` | POST | 員工通知、入座或取消 |
| `reset` | POST | 員工重設測試資料 |

## 3.3 Queue 設計說明

Queue 是依取號順序排列的 JSON 陣列，保存在 Apps Script Script Properties 的 `queue`。`enqueue` 取得遞增 ID 並加入尾端；`positionOf` 以陣列索引計算前方組數；`remove` 用 `splice` 移除入座或取消的票券。Apps Script Script Lock 保護並行請求；目前每個儲存值有位元組上限，因此候位上限設定為 50 組。

請附上 `Code.gs` 中 `Queue.enqueue`、`Queue.positionOf`、`Queue.remove` 的實際程式碼截圖，並依程式說明。

## 3.4 部署過程

- Apps Script 部署執行身分：[實際設定]
- 網頁應用程式存取權：[實際設定]
- `?action=count` 回應：[貼上實際 JSON]
- GitHub Pages 顧客頁與員工頁：[附上線截圖]
- 證據：[附部署頁面與 API 回應截圖；不要顯示密碼]

## 3.5 前後端溝通說明

`index.html` 是顧客頁，`staff.html` 是員工管理頁，`app.js` 包含共用 API 與示範 Queue 邏輯，`waitlist.css` 為共用介面樣式。正式模式使用 `fetch` 呼叫 Apps Script。POST body 使用 JSON 字串且不指定 `Content-Type`，讓瀏覽器不發出 CORS preflight；Apps Script 從 `postData.contents` 解析資料。

## 3.6 顧客端實測

請附手機掃描 QR、填表、取得候位號碼、查看前方組數的實際截圖。

| 測試顧客 | 號碼 | 前方組數 | 測試裝置／時間 |
|---|---:|---:|---|
| 一 | [實際結果] | [實際結果] | [實際結果] |
| 二 | [實際結果] | [實際結果] | [實際結果] |
| 三 | [實際結果] | [實際結果] | [實際結果] |

## 3.7 員工端實測

- 登入成功畫面：[附截圖]
- 至少三組候位的 Queue 表格：[附截圖，遮蔽 E-mail]
- 錯誤密碼畫面：[附截圖]

## 3.8 通知功能實測

- 員工通知操作提示：[實際結果]
- 顧客 E-mail 收件截圖：[附實際收到的通知信]
- 顧客頁狀態轉為「已通知」：[附截圖]

> 示範模式只更新瀏覽器資料、不會寄信。正式寄送需先部署 Apps Script 並完成 Google MailApp 授權。

## 3.9 入座／取消實測

- 入座前 Queue：[實際組數與截圖]
- 入座後 Queue：[實際組數與截圖]
- 後續顧客前方組數變化：[實際結果]
- 取消結果：[實際結果]

## 3.10 事件紀錄

- `?action=log` 或員工頁事件紀錄：[貼上實際輸出]
- 候位組數：[實際數字]
- 通知數／入座數／取消數：[實際數字]

## 3.11 錯誤與排除

- 實際錯誤：[填寫；若無，依作業要求故意設定錯誤的 Apps Script URL 並記錄]
- 原因：[填寫]
- 排除方式：[填寫]

## 3.12 結論與心得

[依照實際端對端測試結果說明系統是否達成目的。若真的供餐廳使用，還需考慮顧客個資保護、服務可用性、濫用防護、郵件額度、候位上限與資料保留期限等。]
