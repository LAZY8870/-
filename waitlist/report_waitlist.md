# 以 GitHub Pages 與 Google Apps Script 建置海大餐廳線上候位系統

> Apps Script Web App 已部署；GitHub Pages 顧客頁已連到正式後端，實際顯示 0 組候位。正式取號、跨裝置同步、手機掃描及真實寄信仍未完成。不可將示範模式結果當成正式後端測試。截圖需遮蔽顧客個資、員工密碼及取消 token。

## 作業目的

傳統現場候位常要求顧客留在餐廳附近等候，紙本登記也不易即時掌握排序，輪到時還需員工逐一聯絡。本系統讓顧客掃描 QR Code，在手機填寫姓名、性別、E-mail 與用餐人數，取得號碼並查看前方組數；員工可在管理頁查看 Queue、寄送候位通知，並登記入座或取消。前端採用 GitHub Pages，後端使用 Google Apps Script、PropertiesService 與 MailApp，不必自架伺服器或建立資料庫；Queue 由程式自行以 FIFO 陣列實作。預期讓顧客不必一直守在店門口，並讓員工能以一致流程管理候位。正式跨裝置同步及 Gmail 通知仍須以實際取號及測試郵件驗證。

## 3.1 執行環境

| 項目 | 實際資料 |
|---|---|
| GitHub 帳號 | `LAZY8870` |
| GitHub 儲存庫 | <https://github.com/LAZY8870/-> |
| 顧客頁 | <https://lazy8870.github.io/-/waitlist/> |
| 員工頁 | <https://lazy8870.github.io/-/waitlist/staff.html> |
| 工作站 | Windows 10 Pro（Build 19045） |
| Apps Script `/exec` 網址 | <https://script.google.com/macros/s/AKfycbx2HTwCydpXYtJ0h6DTHIEGhH4LwrZaehZQISnKa9hrgAppT3PRCtmQny2xgf_mfpxL/exec> |
| 手機型號／數量 | 待本人實際掃描後填寫；本次測試未使用手機 |
| 瀏覽器及版本 | 桌面瀏覽器；測試環境未記錄瀏覽器版本 |
| 示範模式測試日期 | 2026-11-14，約 23:33（UTC+8） |
| 證據 | GitHub Pages 顧客頁及員工頁可開啟；需另附本人手機掃碼與正式後端操作截圖 |

## 3.2 系統規劃

### 架構圖

```text
顧客手機／員工電腦
        │ HTTPS
        ▼
GitHub Pages（靜態前端）
  ├─ waitlist/index.html：顧客候位表單、票券、Queue 預覽
  ├─ waitlist/staff.html：員工登入與管理介面
  ├─ waitlist/app.js：Queue 示範模式、前後端 fetch、畫面更新
  └─ waitlist/waitlist.css：共用樣式
        │ JSON fetch（API_URL）
        ▼
Google Apps Script（Code.gs）
  ├─ PropertiesService：FIFO Queue、遞增號碼、統計與事件
  ├─ Script Lock：保護同時取號／操作
  └─ MailApp：寄送候位通知
```

### 主要流程

```text
顧客掃 QR → 開啟顧客頁 → 填表 → POST join → Queue.enqueue
     ↑                                  ↓ 回傳號碼、前方組數
     └──── 每 5 秒 POST status ←────── 顯示票券與狀態

員工登入 → POST queue（驗證 STAFF_KEY）→ 查看候位清單
                                      ├─ POST notify → MailApp 寄信 → 狀態 notified
                                      ├─ POST seat → 移出 Queue、記錄入座
                                      └─ POST cancel → 移出 Queue、記錄取消
```

### API 清單（依本專案實際程式）

| Action | 方法 | 權限 | 用途 |
|---|---|---|---|
| `count`、`publicQueue` | GET | 公開 | 顯示等候組數及不含 E-mail 的候位預覽 |
| `join` | POST | 公開 | 驗證欄位並加入 FIFO Queue |
| `status`、`leave` | POST | 票券 ID 與隨機取消 token | 查詢票券／顧客自助取消 |
| `queue`、`log` | POST | 員工密碼 | 查詢 Queue、統計與事件 |
| `notify`、`seat`、`cancel` | POST | 員工密碼 | 通知、入座、員工取消 |
| `reset` | POST | 員工密碼 | 清除測試資料 |

與課程簡例不同，本程式將員工密碼及票券 token 放在 POST JSON，而不放 URL；POST 不設定 `Content-Type`，避免 Apps Script 的 CORS preflight 問題。所有報告描述以本表及實際程式為準。

## 3.3 Queue 設計說明

正式模式將依加入順序排列的票券陣列序列化為 JSON，存在 Apps Script Script Properties 的 `queue`，下一個號碼存在 `next_id`。`enqueue` 將新票券推入尾端；`positionOf` 回傳陣列索引，也就是前方組數；`remove` 用 `splice` 移除入座或取消的票券。Script Lock 保護同時操作。單一儲存值設有 8,500 bytes 安全上限，候位最多 50 組。

以下摘錄自本專案 `waitlist/Code.gs`：

```javascript
enqueue(ticket) {
  const queue = this.load();
  if (queue.length >= MAX_QUEUE) throw new Error("候位已滿，請稍後再試。");
  const id = Number(store.getProperty("next_id") || "1");
  if (!Number.isSafeInteger(id) || id < 1) throw new Error("候位號碼資料錯誤。");
  const entry = { ...ticket, id };
  queue.push(entry);
  this.save(queue);
  store.setProperty("next_id", String(id + 1));
  return entry;
},

positionOf(id) {
  return this.load().findIndex(ticket => String(ticket.id) === String(id));
},

remove(id, reason) {
  const queue = this.load();
  const position = queue.findIndex(ticket => String(ticket.id) === String(id));
  if (position < 0) return null;
  const [ticket] = queue.splice(position, 1);
  this.save(queue);
  updateStats_(reason);
  return ticket;
}
```

`find` 依號碼取得票券；`update` 修改通知狀態；`remove` 也更新當日入座／取消統計。這些操作都在 `withLock_` 取得 Script Lock 後執行。示範模式則在瀏覽器 `localStorage` 使用同樣的 FIFO 概念，不能跨裝置同步。

## 3.4 部署過程

### Apps Script

- 專案名稱：海大餐廳候位系統。
- Script Properties：已設定 `STAFF_KEY` 與 `RESTAURANT`；報告不記錄員工密碼。
- MailApp 授權：已由本人授權並成功執行 `authorizeMail`；尚未寄出測試郵件。
- Web App：已部署；執行身分為專案擁有者，存取權為「所有人」。
- `/exec?action=count`：2026-11-14 實際回應 `{"waiting":0}`。

### GitHub Pages

- 顧客頁：<https://lazy8870.github.io/-/waitlist/>
- 員工頁：<https://lazy8870.github.io/-/waitlist/staff.html>
- 上線檢查：顧客頁與員工頁均可開啟並顯示「正式後端模式」；顧客頁顯示 0 組候位及空 Queue。
- `app.js` 已填入正式 `/exec` 網址並發布到 GitHub Pages。
- 瀏覽器實際確認 Pages 可連線取得 `{"waiting":0}`；正式取號、跨裝置同步與寄信尚未實測。
- 證據：Apps Script `authorizeMail` 執行完成、部署成功及 `count` 回應；仍待本人補上操作截圖。

## 3.5 前後端溝通

`index.html` 提供顧客表單、個人票券和公開 Queue 預覽；`staff.html` 提供員工登入、完整候位表格、統計及事件紀錄區；`app.js` 共用 API、輪詢、表單驗證、畫面更新和示範 Queue；`waitlist.css` 負責兩頁的共用樣式。正式模式由 `fetch` 將 JSON 傳給 Apps Script。POST body 使用 `JSON.stringify` 且不指定 `Content-Type`，讓瀏覽器使用 safelisted 的文字型別，避免 CORS preflight；`Code.gs` 從 `event.postData.contents` 解析 JSON。遇到錯誤時前端會顯示後端錯誤訊息。

## 3.6 顧客端實測

桌面瀏覽器示範模式已用虛構資料測試三組取號；這不等同作業要求的手機 QR 掃描或正式後端測試。

| 測試組別 | 候位號碼 | 加入時前方組數 | 測試環境／時間 |
|---|---:|---:|---|
| 1 | #1 | 0 | 桌面瀏覽器、示範模式，2026-11-14 約 23:33 |
| 2 | #2 | 1 | 桌面瀏覽器、示範模式，2026-11-14 約 23:33 |
| 3 | #3 | 2 | 桌面瀏覽器、示範模式，2026-11-14 約 23:33 |

三組使用虛構姓名與 `example.com` 測試信箱；測試後已清除瀏覽器示範資料。尚未完成手機掃碼及不同裝置共享同一 Queue 的測試，也沒有手機截圖。

## 3.7 員工端實測

- 正確示範密碼 `staff` 可開啟管理頁；這不是正式員工認證。
- 錯誤密碼 `wrong-password` 被拒絕，頁面顯示「員工密碼錯誤，無法檢視候位資料。」
- 示範 Queue 顯示三組虛構測試資料，包含號碼、姓名、性別、人數、E-mail、候位時間與狀態；操作後已清除。
- 截圖：[待本人補正式交件截圖；不得將示範資料描述為正式後端資料]

## 3.8 通知功能實測

- 示範模式按「通知」後，員工事件紀錄顯示「通知（示範，未寄信）」。
- 這只更新示範資料中的狀態，**沒有寄出 E-mail**；未取得收件匣截圖，也未驗證 MailApp 授權或每日額度。
- 正式通知測試：尚未完成；授權成功不代表已寄出或收到郵件。

> 示範模式的通知只改變本機資料、不會寄信。若尚未部署 Apps Script 或未收到測試郵件，請明確寫「尚未完成」，不可用示範通知畫面代替收件證據。

## 3.9 入座／取消實測

- 示範模式先加入四組，員工將 #1 標記入座後，Queue 從 4 組降至 3 組，剩餘 #2、#3、#4。
- 顧客示範票券 #5 自助取消後顯示「已取消候位」；員工取消流程也已操作。
- 示範測試結束後已清除資料。以上不是 Apps Script 正式 Queue 的測試證據。

## 3.10 事件紀錄

目前僅驗證 Apps Script `count` API，尚未建立正式候位資料，故沒有可交件的正式 `log` 輸出。瀏覽器示範事件紀錄不是正式後端紀錄，也不能證明實際寄信。

- 正式 `log` 輸出檔：尚未產生。
- 正式候位／通知／入座／取消統計：尚未測試。
- 待正式部署後完成至少 3 組候位、1 次真實通知及 1 次入座，匯出並遮蔽個資。

## 3.11 錯誤與排除

| 實際錯誤 | 原因 | 排除方式與證據 |
|---|---|---|
| 嘗試用 Node.js `--check` 檢查 `app.js` 時，在 `async function` 報語法錯誤 | 此工作站的 Node.js 是舊版 6.14.0，不支援程式使用的 `async`／`await` 語法；這不代表現代瀏覽器語法錯誤 | 以 GitHub Pages 瀏覽器實際操作示範模式，確認顧客取號、員工登入與管理功能可執行。另需在正式 GAS 部署後測試 API 錯誤處理 |

## 3.12 結論與心得

GitHub Pages 顧客頁與員工頁已連接 Apps Script 正式後端，顧客頁能讀到 0 組候位；示範密碼提示及清除示範資料按鈕在正式模式已隱藏。Apps Script 已完成 MailApp 授權與 Web App 部署。正式取號、員工操作、跨裝置 Queue、手機 QR 掃描及真實通知郵件仍待實測，因此目前不能宣稱完整正式候位流程已測完。正式使用仍須評估顧客個資保護、濫用防護、重複取號、郵件額度、50 組上限及資料保存期限。

## 繳交前檢查

- [ ] GitHub 儲存庫及顧客／員工 Pages 網址
- [ ] `waitlist/` 前端程式與 `Code.gs`
- [ ] 提交副本中的 `STAFF_KEY` 與 `API_URL` 已改成假值；正式 GAS 密碼未放進 GitHub
- [ ] 指向顧客頁的 QR Code 圖片
- [x] 完成 Apps Script 設定、授權及 Web App 部署，將 `/exec` 設定到前端 `API_URL`
- [ ] 以手機掃 QR，並以不同裝置確認正式 Queue 同步
- [ ] 測試真實郵件收件、入座及取消；保存遮蔽個資的截圖
- [ ] 填妥並附正式測試證據的報告
- [ ] 含至少 3 組候位、1 次真實通知、1 次入座的正式 `waitlist_log.txt`
- [ ] 壓縮為 `學號_姓名_候位系統.zip`
- [ ] 測試完成後清除 Queue 中的測試個資，並封存／移除公開部署
