# 以 GitHub Pages 與 Google Apps Script 建置海大餐廳線上候位系統

> 報告填寫版：程式與 Pages 網址已先填入；所有 `[待本人實測]` 欄位須依自己的 Apps Script、手機和信箱操作補完。不得把示範模式結果寫成跨裝置同步或實際寄信。截圖需遮蔽顧客個資、員工密碼及取消 token。

## 作業目的

傳統現場候位常要求顧客留在餐廳附近等候，紙本登記也不易即時掌握排序，輪到時還需員工逐一聯絡。本系統讓顧客掃描 QR Code，在手機填寫姓名、性別、E-mail 與用餐人數，取得號碼並查看前方組數；員工可在管理頁查看 Queue、寄送候位通知，並登記入座或取消。前端採用 GitHub Pages，後端使用 Google Apps Script、PropertiesService 與 MailApp，不必自架伺服器或建立資料庫；Queue 由程式自行以 FIFO 陣列實作。預期讓顧客不必一直守在店門口，並讓員工能以一致流程管理候位。正式跨裝置同步及 Gmail 通知須在完成 Apps Script 部署與授權後驗證。

## 3.1 執行環境

| 項目 | 實際資料 |
|---|---|
| GitHub 帳號 | `LAZY8870` |
| GitHub 儲存庫 | <https://github.com/LAZY8870/-> |
| 顧客頁 | <https://lazy8870.github.io/-/waitlist/> |
| 員工頁 | <https://lazy8870.github.io/-/waitlist/staff.html> |
| Apps Script `/exec` 網址 | [待本人部署後填寫；不要貼員工密碼] |
| Google 帳號 | [待本人填寫，可部分遮蔽] |
| 手機型號／數量 | [待本人以手機掃描 QR Code 後填寫] |
| 瀏覽器及版本 | [待本人填寫] |
| 測試日期 | [待本人填寫] |
| 證據 | [附手機掃碼、顧客頁與員工頁截圖；遮蔽個資] |

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

- 專案名稱：[待本人填寫]
- Script Properties：已設定 `STAFF_KEY`（至少 12 字元隨機密碼）及 `RESTAURANT`：[待本人確認]
- MailApp 授權：[`authorizeMail` 執行及本人同意授權的實際結果]
- Web App 執行身分：[`我` 的部署設定截圖]
- Web App 存取權：[`所有人` 的部署設定截圖]
- `/exec?action=count` 實際回應：[貼上實際 JSON；預期初始值為 `{"waiting":0}`]

### GitHub Pages

- 顧客頁：<https://lazy8870.github.io/-/waitlist/>
- 員工頁：<https://lazy8870.github.io/-/waitlist/staff.html>
- 上線證據：[附本人瀏覽器截圖]
- `app.js` 的 `API_URL`：[尚未設定前端正式 API 時，須標示為示範模式；完成設定後記錄部署版本]

## 3.5 前後端溝通

`index.html` 提供顧客表單、個人票券和公開 Queue 預覽；`staff.html` 提供員工登入、完整候位表格、統計及事件紀錄區；`app.js` 共用 API、輪詢、表單驗證、畫面更新和示範 Queue；`waitlist.css` 負責兩頁的共用樣式。正式模式由 `fetch` 將 JSON 傳給 Apps Script。POST body 使用 `JSON.stringify` 且不指定 `Content-Type`，讓瀏覽器使用 safelisted 的文字型別，避免 CORS preflight；`Code.gs` 從 `event.postData.contents` 解析 JSON。遇到錯誤時前端會顯示後端錯誤訊息。

## 3.6 顧客端實測

需以手機掃描顧客頁的 QR Code，至少用三組不同測試資料加入。只能使用本人或同組同學同意提供的測試信箱。

| 測試組別 | 候位號碼 | 加入時前方組數 | 手機／瀏覽器／時間 |
|---|---:|---:|---|
| 1 | [實測] | [實測] | [實測] |
| 2 | [實測] | [實測] | [實測] |
| 3 | [實測] | [實測] | [實測] |

證據：[附 QR 掃描後的手機頁面、三組票券及前方組數截圖。正式模式需確認不同裝置看見同一 Queue。]

## 3.7 員工端實測

- 正確密碼登入結果：[實測及截圖]
- Queue 至少三組，並確認號碼、姓名、性別、人數、E-mail、候位時間、狀態欄位：[實測及截圖；遮蔽 E-mail]
- 錯誤密碼登入結果：[實測及截圖，確認 Queue 沒有顯示且不可操作]

## 3.8 通知功能實測

- 員工按「通知」後的前端提示：[實際提示]
- 顧客測試信箱收到的通知信：[附實際收件截圖]
- 顧客票券狀態更新為「已通知」：[附實際截圖]
- MailApp 每日剩餘額度（如有記錄）：[實際值]

> 示範模式的通知只改變本機資料、不會寄信。若尚未部署 Apps Script 或未收到測試郵件，請明確寫「尚未完成」，不可用示範通知畫面代替收件證據。

## 3.9 入座／取消實測

- 入座前 Queue 組數與後續顧客前方組數：[實測及截圖]
- 員工執行入座後 Queue 組數：[實測及截圖]
- 後續顧客前方組數是否減少一組：[實測結果]
- 員工取消及顧客自助取消結果：[實測及截圖]

## 3.10 事件紀錄

請由已部署的正式後端取得 `log` 輸出並另存為 `waitlist_log.txt`。依要求，正式測試至少包含 3 組候位、1 次實際通知及 1 次入座。輸出需遮蔽或移除姓名、E-mail 等個資後再交件。

- 正式 `log` 輸出檔：[附 `waitlist_log.txt`]
- 候位總數：[按實際事件計算]
- 通知次數：[按實際事件計算]
- 入座組數：[按實際事件計算]
- 取消組數：[按實際事件計算]

## 3.11 錯誤與排除

| 實際錯誤 | 原因 | 排除方式與證據 |
|---|---|---|
| [記錄實際錯誤；若沒有，依作業要求暫時將 `API_URL` 改錯一字後測試] | [實際原因] | [修正方式及畫面] |

## 3.12 結論與心得

[依本人實際結果撰寫：哪些功能已通過，是否完成手機 QR 實測、跨裝置 Queue 和 Gmail 收信；若未完成請如實說明。另討論正式使用仍需改善的個資保護、濫用防護、重複取號、郵件額度、50 組上限及資料保存期限。]

## 繳交前檢查

- [ ] GitHub 儲存庫及顧客／員工 Pages 網址
- [ ] `waitlist/` 前端程式與 `Code.gs`
- [ ] 提交副本中的 `STAFF_KEY` 與 `API_URL` 已改成假值；正式 GAS 密碼未放進 GitHub
- [ ] 指向顧客頁的 QR Code 圖片
- [ ] 填妥並附實際證據的報告
- [ ] 含 3 組候位、1 次通知、1 次入座的正式 `waitlist_log.txt`
- [ ] 壓縮為 `學號_姓名_候位系統.zip`
- [ ] 測試完成後清除 Queue 中的測試個資，並封存／移除公開部署
