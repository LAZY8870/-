"use strict";

(() => {
  const form = document.querySelector("#qrForm");
  const nameInput = document.querySelector("#studentName");
  const idInput = document.querySelector("#studentId");
  const urlInput = document.querySelector("#targetUrl");
  const correctionInput = document.querySelector("#correction");
  const pixelInput = document.querySelector("#pixelSize");
  const labelInput = document.querySelector("#labelText");
  const output = document.querySelector("#qrOutput");
  const placeholder = document.querySelector("#qrPlaceholder");
  const downloadButton = document.querySelector("#download");
  const scanFileButton = document.querySelector("#scanFile");
  const scannerInput = document.querySelector("#scannerInput");
  const stats = document.querySelector("#stats");
  const verification = document.querySelector("#verification");
  let generatedUrl = "";

  const profileParams = new URLSearchParams(window.location.hash.slice(1));
  const linkedName = profileParams.get("name");
  const linkedId = profileParams.get("student_id");
  if (linkedName || linkedId) {
    document.querySelector("#profileName").textContent = linkedName || "未提供";
    document.querySelector("#profileId").textContent = linkedId || "未提供";
    document.querySelector("#personalProfile").hidden = false;
  }

  urlInput.value = new URL("./", window.location.href).href;

  function makeTargetUrl() {
    const url = new URL(urlInput.value.trim());
    if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
      throw new Error("請輸入 HTTPS 網址；區網作業網址請透過 Python serve 產生。");
    }
    const name = nameInput.value.trim();
    const studentId = idInput.value.trim();
    if (name || studentId) {
      const profile = new URLSearchParams();
      if (name) profile.set("name", name);
      if (studentId) profile.set("student_id", studentId);
      url.hash = profile.toString();
    }
    return url.href;
  }

  function showVerification(message, passed) {
    verification.hidden = false;
    verification.classList.toggle("error", !passed);
    verification.textContent = message;
  }

  function outputCanvas() {
    return output.querySelector("canvas");
  }

  function drawLabel(canvas, label) {
    if (!label) return canvas;
    const padding = 18;
    const bandHeight = 48;
    const finalCanvas = document.createElement("canvas");
    finalCanvas.width = canvas.width;
    finalCanvas.height = canvas.height + bandHeight;
    const context = finalCanvas.getContext("2d");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, finalCanvas.width, finalCanvas.height);
    context.drawImage(canvas, 0, 0);
    context.font = "600 20px system-ui, sans-serif";
    const availableWidth = finalCanvas.width - padding * 2;
    let text = label;
    while (text.length > 1 && context.measureText(text).width > availableWidth) {
      text = `${text.slice(0, -2)}…`;
    }
    context.fillStyle = "#172033";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(text, finalCanvas.width / 2, canvas.height + bandHeight / 2);
    return finalCanvas;
  }

  function verifyCanvas(canvas, expected) {
    if (typeof jsQR !== "function") {
      showVerification("已產生 QR Code；解碼函式庫載入失敗，請檢查網路後重試。", false);
      return;
    }
    const context = canvas.getContext("2d", { willReadFrequently: true });
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    const decoded = jsQR(image.data, image.width, image.height);
    if (decoded && decoded.data === expected) {
      showVerification(`解碼驗證成功：圖片內容與原始網址完全一致。\\n${decoded.data}`, true);
    } else {
      showVerification("無法解碼 QR Code，或解碼網址與原始網址不一致。", false);
    }
  }

  function generate() {
    try {
      if (typeof window.QRCode !== "function" || !window.QRCode.CorrectLevel) {
        throw new Error("QR Code 函式庫尚未載入，請檢查網路連線後重試。");
      }
      const target = makeTargetUrl();
      const pixelSize = Number(pixelInput.value);
      output.replaceChildren();
      const generator = new window.QRCode(output, {
        text: target,
        width: pixelSize * 45,
        height: pixelSize * 45,
        colorDark: "#111827",
        colorLight: "#ffffff",
        correctLevel: window.QRCode.CorrectLevel[correctionInput.value],
      });

      window.setTimeout(() => {
        const baseCanvas = outputCanvas();
        if (!baseCanvas) {
          showVerification("QR Code 圖片產生失敗，請縮短網址或提高每模組像素。", false);
          downloadButton.disabled = true;
          return;
        }
        generatedUrl = target;
        const finalCanvas = drawLabel(baseCanvas, labelInput.value.trim());
        output.replaceChildren(finalCanvas);
        const moduleCount = generator._oQRCode.getModuleCount();
        const version = generator._oQRCode.typeNumber;
        document.querySelector("#statVersion").textContent = String(version);
        document.querySelector("#statModules").textContent = `${moduleCount} × ${moduleCount}`;
        document.querySelector("#statCorrection").textContent = correctionInput.value;
        document.querySelector("#statPixels").textContent = `${finalCanvas.width} × ${finalCanvas.height} px`;
        stats.hidden = false;
        placeholder.hidden = true;
        verifyCanvas(finalCanvas, generatedUrl);
        downloadButton.disabled = false;
      }, 0);
    } catch (error) {
      showVerification(error instanceof Error ? error.message : String(error), false);
    }
  }

  function downloadPng() {
    const canvas = outputCanvas();
    if (!canvas || !generatedUrl) return;
    const anchor = document.createElement("a");
    anchor.download = "qrcode.png";
    anchor.href = canvas.toDataURL("image/png");
    anchor.click();
  }

  async function decodeFile(file) {
    if (typeof jsQR !== "function") {
      throw new Error("解碼函式庫尚未載入，請檢查網路後重試。");
    }
    const bitmap = await createImageBitmap(file);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      context.drawImage(bitmap, 0, 0);
      const image = context.getImageData(0, 0, canvas.width, canvas.height);
      const result = jsQR(image.data, image.width, image.height);
      if (!result) {
        showVerification("圖片中找不到可讀取的 QR Code。", false);
        return;
      }
      showVerification(`解碼成功：\\n${result.data}`, true);
    } finally {
      bitmap.close();
    }
  }

  form.addEventListener("submit", event => {
    event.preventDefault();
    generate();
  });
  downloadButton.addEventListener("click", downloadPng);
  scanFileButton.addEventListener("click", () => scannerInput.click());
  scannerInput.addEventListener("change", async () => {
    const [file] = scannerInput.files || [];
    if (!file) return;
    try {
      await decodeFile(file);
    } catch (error) {
      showVerification(error instanceof Error ? error.message : String(error), false);
    } finally {
      scannerInput.value = "";
    }
  });
})();
