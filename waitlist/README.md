# 作業三：海大餐廳線上候位系統

顧客頁：`https://lazy8870.github.io/-/waitlist/`
員工頁：`https://lazy8870.github.io/-/waitlist/staff.html`

系統由 GitHub Pages 靜態前端及 Google Apps Script 後端組成。Apps Script 用 Script Properties 保存自行實作的 FIFO Queue，並以 Gmail `MailApp` 寄送候位通知。預設 `API_URL` 留白為瀏覽器示範模式：資料只在該瀏覽器的 localStorage，不能跨裝置同步或真的寄信。

## 示範模式

- 顧客頁填姓名、性別、E-mail 與人數，加入 Queue 後取得號碼、前方組數和自動更新狀態；提供取消候位。
- 員工頁示範密碼為 `staff`，可查看完整 Queue、通知狀態、入座、取消、今日統計與最近事件紀錄。
- 示範模式的通知按鈕只更新「已通知」狀態，**不會真的寄信**；這個前端密碼也不是安全認證。
- 示範資料以同瀏覽器 localStorage 儲存。請勿在共用瀏覽器輸入真實顧客資料；員工頁可以清除示範資料。

## 正式後端設定

1. 在 `https://script.google.com` 建立新專案，將 `Code.gs` 貼入 Apps Script 編輯器。
2. 專案設定 → 指令碼屬性，新增：
   - `STAFF_KEY`：至少 12 個字元的隨機員工密碼。密碼只存於 Apps Script，不放在 GitHub 程式碼。
   - `RESTAURANT`：餐廳顯示名稱（例如 `海大餐廳`）。
3. 儲存並在 Apps Script 編輯器選取 `authorizeMail` →「執行」，依 Google 提示授權 MailApp 存取寄信額度。
4. 部署 → 新增部署作業 → 網頁應用程式；執行身分選「我」，存取權選「所有人」。授權後複製結尾為 `/exec` 的網址。
5. 把 `app.js` 開頭的 `API_URL` 換成自己的 `/exec` 網址並推送 GitHub。網址不是密碼；不要提交 `STAFF_KEY` 或其他私人資料。
6. 用瀏覽器開啟 `API_URL?action=count`，應回傳 `{"waiting":0}`。

目前已部署的 Web App：<https://script.google.com/macros/s/AKfycbx2HTwCydpXYtJ0h6DTHIEGhH4LwrZaehZQISnKa9hrgAppT3PRCtmQny2xgf_mfpxL/exec>。2026-11-14 已測試三組正式取號、通知信收件、入座及取消；清除測試資料後 `?action=count` 回傳 `{"waiting":0}`。結果依本人確認；手機、跨裝置、操作截圖及正式事件紀錄匯出仍待完成。

Apps Script 對顧客端公開姓名及人數以顯示 Queue 預覽；E-mail、性別和取消驗證 token 不會公開。員工密碼以及取消 token 透過 POST JSON 傳送，避免放在 URL。前端 POST 不設定 `Content-Type`，保持瀏覽器的 safelisted `text/plain`，避免 CORS preflight。

## API

| Action | 方法 | 權限 | 用途 |
|---|---|---|---|
| `count` | GET | 公開 | 回報目前候位組數 |
| `publicQueue` | GET | 公開 | 回傳候位號碼、姓名、人數（不含 E-mail） |
| `join` | POST | 公開 | 驗證欄位並 enqueue，回傳號碼與前方組數 |
| `status` / `leave` | POST | 需對應候位 token | 查詢票券狀態／自助取消 |
| `queue` / `log` | POST | 員工密碼 | 完整 Queue、統計和事件紀錄 |
| `notify` / `seat` / `cancel` | POST | 員工密碼 | 寄信通知／入座／員工取消 |
| `reset` | POST | 員工密碼 | 清除 Queue、計數與事件資料 |

Queue 有 50 組上限；使用 Script Lock 保護多人同時取號。通知寄出成功後才更新狀態，並阻止重複通知。測試寄信前先用自己的地址取號。

## 測試

1. 開啟顧客頁加入數組示範候位。
2. 開啟員工頁，示範模式輸入 `staff`；錯誤密碼不得顯示資料。
3. 嘗試通知、入座、取消，確認候位順序及顧客前方組數更新。
4. 正式部署後再用自有測試信箱確認收到 MailApp 信件。不要把示範狀態說成實際寄信。

## QR Code

`qr_waitlist_demo.png` 是指向此 GitHub Pages 顧客頁的掃描範例。課程要求的顧客手機實測、通知收件截圖和員工操作截圖，請由本人依實際部署結果補上。

## 報告

依 `report_waitlist.md` 填入 Apps Script 網頁應用程式網址（可遮蔽敏感部分）、操作截圖、測試結果和事件紀錄。請不要將員工密碼、顧客真實資料或取消 token 放入公開報告。
