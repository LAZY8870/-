# 作業二：QR Code 導引到自架網頁

本目錄是獨立的第二份作業頁面；瀏覽器版部署於 `https://LAZY8870.github.io/-/qrcode/`。它可產生 QR Code、下載 PNG，並用 JavaScript 解碼比對。Python 程式 `qr_web.py` 負責作業要求的圖片產生、OpenCV 解碼、容錯等級比較，以及區域網路本機網站和真實訪問記錄。

## 安裝

```powershell
python -m pip install -r requirements-qrcode.txt
```

## 產生圖片、解碼、比較容錯

```powershell
python qr_web.py make --url https://www.google.com --out qr_google.png --label Google
python qr_web.py decode qr_google.png
python qr_web.py compare --url https://www.google.com
```

`make` 會列印 QR 版本、模組數、容錯等級、圖片像素和檔案大小，並用 OpenCV 解碼後逐字驗證網址。`compare` 產生 L/M/Q/H 四種容錯圖片和實測資料。每次命令將結果寫到 `results/qr_模式_日期時間.md` 與 `.json`。

## 啟動本機網站與手機掃描

```powershell
python qr_web.py serve --name "你的姓名" --student-id "你的學號" --port 8000
```

命令會在 `site/index.html` 產生個人頁、偵測區網 IP、建立 `qr_site.png`，並啟動 HTTP 伺服器。伺服器繫結所有網卡以允許同 Wi-Fi 的手機連入；掃描程式列印的區網 QR Code，至少用兩台手機測試。按 Ctrl+C 正常結束，結果會存到 `results/`。原始 IP 與瀏覽器紀錄只留在本機，分享前請遮蔽個資。

若 Windows 防火牆詢問是否允許 Python 網路存取，僅允許私人網路；若手機無法連線，確認電腦與手機使用同一 Wi-Fi，並檢查路由器是否啟用裝置隔離。

GitHub Pages 是靜態託管，不能取得掃描者來源 IP 或執行 Python 伺服器。因此 GitHub Pages QR 僅用於示範；F4、F5 的正式實測須在本機執行 `serve`，不能以網站瀏覽數或自行產生的測試紀錄替代。

## 網頁版

GitHub Pages 的第二份作業頁提供網頁 QR 產生、PNG 下載、檔案解碼、QR 版本／模組數與 L/M/Q/H 容錯比較。CDN 載入 qrcodejs 與 jsQR 函式庫；若離線或 CDN 無法載入，請使用 Python 程式。

## 報告

請依 `report_qrcode.md` 補上 Python/套件版本、手機型號、本人掃描截圖、兩台手機的實際連線紀錄和心得。尚未進行的實測維持待填，請勿以示範或虛構資料冒充。

## 自動測試

```powershell
python -m unittest -v test_qr_web
```
