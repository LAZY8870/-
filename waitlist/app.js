"use strict";

(() => {
  const API_URL = "https://script.google.com/macros/s/AKfycbx2HTwCydpXYtJ0h6DTHIEGhH4LwrZaehZQISnKa9hrgAppT3PRCtmQny2xgf_mfpxL/exec";
  const RESTAURANT = "海大餐廳";
  const STORAGE_KEY = "restaurantWaitlist.demo.v1";
  const TICKET_KEY = "restaurantWaitlist.ticket.v1";
  const POLL_INTERVAL = 5000;
  const MAX_QUEUE = 50;

  const isLive = Boolean(API_URL);
  const params = new URLSearchParams(window.location.search);
  const page = document.body.dataset.page;
  const nameInput = document.querySelector("#customerName");
  const genderInput = document.querySelector("#customerGender");
  const emailInput = document.querySelector("#customerEmail");
  const partyInput = document.querySelector("#partySize");
  const joinForm = document.querySelector("#joinForm");
  const joinButton = document.querySelector("#joinButton");
  const cancelButton = document.querySelector("#cancelTicket");
  const ticketPanel = document.querySelector("#ticketPanel");
  const currentCount = document.querySelector("#currentCount");
  const queuePreview = document.querySelector("#queuePreview");
  const queueList = document.querySelector("#queueList");
  const notice = document.querySelector("#notice");
  const modeBanner = document.querySelector("#modeBanner");
  const staffLoginForm = document.querySelector("#staffLoginForm");
  const staffPassword = document.querySelector("#staffPassword");
  const staffPanel = document.querySelector("#staffPanel");
  const staffLoginNotice = document.querySelector("#staffNotice");
  const staffNotice = document.querySelector("#staffActionNotice") || staffLoginNotice;
  const staffQueue = document.querySelector("#staffQueue");
  const eventLog = document.querySelector("#eventLog");
  let staffKey = "";
  let activeTicketId = "";
  let busy = false;
  let pollingTimer = null;
  let requestsInFlight = 0;

  if (modeBanner) {
    modeBanner.classList.toggle("live", isLive);
    modeBanner.querySelector("strong").textContent = isLive ? "正式後端模式" : "示範模式";
    modeBanner.querySelector("[data-mode-description]").textContent = isLive
      ? "資料存在 Google Apps Script；員工通知會由已授權的 Gmail 寄出。"
      : "候位資料只存在此瀏覽器，不會跨裝置同步，也不會真的寄送通知信。";
  }

  function setNotice(element, message, type = "") {
    if (!element) return;
    element.textContent = message;
    element.className = `notice${type ? ` ${type}` : ""}`;
    element.setAttribute("role", type === "error" ? "alert" : "status");
  }

  function setBusy(value) {
    busy = value;
    if (joinButton) joinButton.disabled = value;
    if (cancelButton) cancelButton.disabled = value;
    document.querySelectorAll("[data-staff-action]").forEach(button => {
      button.disabled = value;
    });
  }

  function readDemoData() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      const currentDay = new Date().toLocaleDateString("en-CA");
      return {
        queue: Array.isArray(saved.queue) ? saved.queue : [],
        nextId: Number.isInteger(saved.nextId) && saved.nextId > 0 ? saved.nextId : 1,
        events: Array.isArray(saved.events) ? saved.events : [],
        stats: saved.stats && saved.stats.day === currentDay
          ? saved.stats
          : { day: currentDay, joined: 0, seated: 0, cancelled: 0 },
      };
    } catch (error) {
      throw new Error(`本機候位資料損毀，請清除本頁示範資料後重試：${error.message}`);
    }
  }

  function writeDemoData(data) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }

  function recordDemoEvent(data, event, details) {
    data.events.unshift({
      at: new Date().toISOString(),
      event,
      details,
    });
    data.events = data.events.slice(0, 40);
  }

  function positionOf(queue, id) {
    return queue.findIndex(ticket => String(ticket.id) === String(id));
  }

  function removeTicket(data, id, reason, eventName) {
    const position = positionOf(data.queue, id);
    if (position < 0) throw new Error("找不到這個候位號碼，可能已入座或取消。");
    const [ticket] = data.queue.splice(position, 1);
    ticket.status = reason;
    ticket.closed_at = new Date().toISOString();
    data.stats[reason] = (data.stats[reason] || 0) + 1;
    const waitMinutes = Math.max(0, Math.round(
      (Date.now() - new Date(ticket.created_at).getTime()) / 60000
    ));
    data.events.unshift({
      at: new Date().toISOString(),
      event: eventName,
      details: `${ticket.id} 號 ${ticket.name}`,
      waitMinutes,
    });
    data.events = data.events.slice(0, 40);
    return ticket;
  }

  function addDemoTicket(payload) {
    const data = readDemoData();
    if (data.queue.length >= MAX_QUEUE) throw new Error("目前候位已滿，請稍後再試。");
    const ticket = {
      id: data.nextId++,
      name: payload.name,
      gender: payload.gender,
      email: payload.email,
      party_size: payload.party_size,
      cancel_token: payload.cancel_token,
      status: "waiting",
      created_at: new Date().toISOString(),
      notified_at: "",
    };
    data.queue.push(ticket);
    data.stats.joined += 1;
    recordDemoEvent(data, "候位", `${ticket.id} 號 ${ticket.name}（${ticket.party_size} 位）`);
    writeDemoData(data);
    return { id: ticket.id, ahead: positionOf(data.queue, ticket.id), waiting: data.queue.length };
  }

  async function api(action, values = {}, method = "GET") {
    if (!isLive) return demoAction(action, values);
    if (method === "GET") {
      const query = new URLSearchParams({ action, ...stringifyValues(values) });
      const response = await fetch(`${API_URL}?${query}`);
      if (!response.ok) throw new Error(`候位服務回應 HTTP ${response.status}。`);
      return parseApiResponse(response);
    }
    const response = await fetch(API_URL, {
      method: "POST",
      body: JSON.stringify({ action, ...values }),
    });
    if (!response.ok) throw new Error(`候位服務回應 HTTP ${response.status}。`);
    return parseApiResponse(response);
  }

  function stringifyValues(values) {
    return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, String(value)]));
  }

  async function parseApiResponse(response) {
    const text = await response.text();
    let result;
    try {
      result = JSON.parse(text);
    } catch {
      throw new Error("後端回傳非 JSON；請確認 Apps Script 已部署為任何人可存取的網頁應用程式。");
    }
    if (result.error) {
      throw new Error(result.error === "unauthorized" ? "員工密碼錯誤，無法檢視候位資料。" : result.error);
    }
    return result;
  }

  async function demoAction(action, values) {
    const data = readDemoData();
    switch (action) {
      case "count":
        return { waiting: data.queue.length };
      case "publicQueue":
        return { queue: data.queue.map(ticket => ({
          id: ticket.id,
          name: ticket.name,
          party_size: ticket.party_size,
        })) };
      case "join":
        return addDemoTicket(values);
      case "status": {
        const ticket = data.queue.find(item => String(item.id) === String(values.id));
        if (!ticket || ticket.cancel_token !== values.cancel_token) {
          throw new Error("找不到這個候位號碼（可能已入座或取消）。");
        }
        return pickCustomerTicket(ticket, data.queue);
      }
      case "leave": {
        const ticket = data.queue.find(item => String(item.id) === String(values.id));
        if (!ticket || ticket.cancel_token !== values.cancel_token) {
          throw new Error("找不到這個候位號碼（可能已入座或取消）。");
        }
        removeTicket(data, values.id, "cancelled", "顧客取消");
        writeDemoData(data);
        return { ok: true };
      }
      case "queue":
        requireDemoStaffKey(values.key);
        return {
          queue: data.queue,
          seated: data.stats.seated,
          cancelled: data.stats.cancelled,
          joined: data.stats.joined,
          averageWaitMinutes: calculateAverageWait(data.events),
          events: data.events,
        };
      case "notify": {
        requireDemoStaffKey(values.key);
        const ticket = data.queue.find(item => String(item.id) === String(values.id));
        if (!ticket) throw new Error("找不到這個候位號碼。");
        if (ticket.status === "notified") throw new Error("此顧客已通知，請勿重複寄送。");
        ticket.status = "notified";
        ticket.notified_at = new Date().toISOString();
        recordDemoEvent(data, "通知（示範，未寄信）", `${ticket.id} 號 ${ticket.name}`);
        writeDemoData(data);
        return { ok: true, detail: "示範模式不會真的寄送 E-mail。" };
      }
      case "seat":
        requireDemoStaffKey(values.key);
        removeTicket(data, values.id, "seated", "入座");
        writeDemoData(data);
        return { ok: true };
      case "cancel":
        requireDemoStaffKey(values.key);
        removeTicket(data, values.id, "cancelled", "員工取消");
        writeDemoData(data);
        return { ok: true };
      case "log":
        requireDemoStaffKey(values.key);
        return { log: data.events };
      case "reset":
        requireDemoStaffKey(values.key);
        localStorage.removeItem(STORAGE_KEY);
        return { ok: true };
      default:
        throw new Error(`未知的候位操作：${action}`);
    }
  }

  function pickCustomerTicket(ticket, queue) {
    return {
          ...ticket,
          cancel_token: undefined,
          ahead: positionOf(queue, ticket.id),
          waiting: queue.length,
        };
  }

  function createCancelToken() {
    const bytes = new Uint8Array(24);
    window.crypto.getRandomValues(bytes);
    return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
  }

  function requireDemoStaffKey(key) {
    if (key !== "staff") throw new Error("員工密碼錯誤，無法檢視候位資料。");
  }

  function calculateAverageWait(events) {
    const durations = events
      .filter(event => event.event === "入座" && event.waitMinutes !== undefined)
      .map(event => Number(event.waitMinutes))
      .filter(value => Number.isFinite(value));
    if (durations.length === 0) return 0;
    return Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length);
  }

  function escapeText(value) {
    return String(value === null || value === undefined ? "" : value);
  }

  function renderPublicQueue(queue) {
    if (!currentCount || !queueList) return;
    currentCount.textContent = String(queue.length);
    queueList.replaceChildren();
    if (queue.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = "現在沒有候位，歡迎直接入座。";
      queueList.append(empty);
      return;
    }
    queue.slice(0, 5).forEach(ticket => {
      const row = document.createElement("div");
      row.className = "queue-row";
      const label = document.createElement("div");
      label.className = "queue-row-name";
      label.textContent = `${ticket.name} · ${ticket.party_size} 位`;
      const number = document.createElement("span");
      number.className = "queue-number";
      number.textContent = `#${ticket.id}`;
      row.append(label, number);
      queueList.append(row);
    });
    if (queue.length > 5) {
      const more = document.createElement("div");
      more.className = "field-hint";
      more.textContent = `另有 ${queue.length - 5} 組候位`;
      queueList.append(more);
    }
  }

  function renderTicket(ticket) {
    if (!ticketPanel) return;
    ticketPanel.hidden = false;
    document.querySelector("#ticketNumber").textContent = `#${ticket.id}`;
    document.querySelector("#ticketName").textContent = escapeText(ticket.name);
    document.querySelector("#ticketParty").textContent = `${ticket.party_size} 位`;
    document.querySelector("#ticketAhead").textContent = String(
      ticket.ahead === null || ticket.ahead === undefined ? 0 : ticket.ahead,
    );
    const status = document.querySelector("#ticketStatus");
    status.textContent = ticket.status === "notified" ? "已通知，請準備前往櫃台" : "候位中";
    status.classList.toggle("notified", ticket.status === "notified");
    joinForm.hidden = true;
    setNotice(notice, "每 5 秒自動更新目前候位位置。", "success");
  }

  async function refreshPublic() {
    if (requestsInFlight > 0) return;
    requestsInFlight += 1;
    try {
      const count = await api("count");
      const activeId = activeTicketId || sessionStorage.getItem(TICKET_KEY);
      if (activeId) {
        try {
          const cancelToken = sessionStorage.getItem(`${TICKET_KEY}.${activeId}`) || "";
          const ticket = await api("status", { id: activeId, cancel_token: cancelToken }, "POST");
          activeTicketId = String(ticket.id);
          renderTicket(ticket);
        } catch (error) {
          sessionStorage.removeItem(`${TICKET_KEY}.${activeId}`);
          activeTicketId = "";
          sessionStorage.removeItem(TICKET_KEY);
          ticketPanel.hidden = true;
          joinForm.hidden = false;
          setNotice(notice, error.message, "error");
        }
      }
      if (count.queue) {
        renderPublicQueue(count.queue);
      } else {
        const publicResult = await api("publicQueue");
        renderPublicQueue(publicResult.queue || []);
      }
      if (currentCount && Number.isFinite(count.waiting)) currentCount.textContent = String(count.waiting);
    } catch (error) {
      setNotice(notice, error.message || "無法連線候位服務，請稍後重試。", "error");
    } finally {
      requestsInFlight -= 1;
    }
  }

  function validateCustomerForm() {
    const name = nameInput.value.trim();
    const email = emailInput.value.trim();
    const partySize = Number(partyInput.value);
    if (!name || name.length > 60) throw new Error("請輸入 1 到 60 個字的姓名。");
    if (!genderInput.value) throw new Error("請選擇性別。");
    if (!emailInput.validity.valid || email.length > 254) throw new Error("請輸入有效的 E-mail 地址。");
    if (!Number.isInteger(partySize) || partySize < 1 || partySize > 20) {
      throw new Error("用餐人數請填寫 1 到 20 位。");
    }
    return { name, email, gender: genderInput.value, party_size: partySize };
  }

  async function joinQueue(event) {
    event.preventDefault();
    if (busy) return;
    let payload;
    try {
      payload = validateCustomerForm();
    } catch (error) {
      setNotice(notice, error.message, "error");
      return;
    }
    setBusy(true);
    setNotice(notice, "正在為你取得候位號碼……");
    try {
      const cancelToken = createCancelToken();
      const ticket = await api("join", { ...payload, cancel_token: cancelToken }, "POST");
      activeTicketId = String(ticket.id);
      sessionStorage.setItem(TICKET_KEY, activeTicketId);
      sessionStorage.setItem(`${TICKET_KEY}.${activeTicketId}`, cancelToken);
      renderTicket({ ...payload, ...ticket, status: "waiting" });
      if (currentCount && Number.isFinite(ticket.waiting)) {
        currentCount.textContent = String(ticket.waiting);
      }
      await refreshPublic();
      setNotice(notice, `候位成功，號碼 #${ticket.id}；前面還有 ${ticket.ahead} 組。`, "success");
    } catch (error) {
      setNotice(notice, error.message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function cancelCustomerTicket() {
    if (!activeTicketId || busy) return;
    if (!window.confirm("確定取消這筆候位嗎？")) return;
    setBusy(true);
    try {
      const cancelToken = sessionStorage.getItem(`${TICKET_KEY}.${activeTicketId}`) || "";
      await api("leave", { id: activeTicketId, cancel_token: cancelToken }, "POST");
      sessionStorage.removeItem(`${TICKET_KEY}.${activeTicketId}`);
      activeTicketId = "";
      sessionStorage.removeItem(TICKET_KEY);
      ticketPanel.hidden = true;
      joinForm.hidden = false;
      setNotice(notice, "已取消候位。", "success");
      await refreshPublic();
    } catch (error) {
      setNotice(notice, error.message, "error");
    } finally {
      setBusy(false);
    }
  }

  function createActionButton(label, action, id, style = "") {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `subtle${style ? ` ${style}` : ""}`;
    button.textContent = label;
    button.dataset.staffAction = action;
    button.dataset.ticketId = String(id);
    return button;
  }

  function renderStaffQueue(result) {
    if (!staffQueue) return;
    staffQueue.replaceChildren();
    document.querySelector("#staffCount").textContent = String(result.queue.length);
    document.querySelector("#seatedCount").textContent = String(result.seated || 0);
    document.querySelector("#cancelledCount").textContent = String(result.cancelled || 0);
    document.querySelector("#joinedCount").textContent = String(result.joined || 0);
    document.querySelector("#averageWait").textContent = `${result.averageWaitMinutes || 0} 分`;
    if (result.queue.length === 0) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = 7;
      cell.className = "empty-state";
      cell.textContent = "目前沒有候位資料。";
      row.append(cell);
      staffQueue.append(row);
      return;
    }
    result.queue.forEach((ticket, index) => {
      const row = document.createElement("tr");
      const number = document.createElement("td");
      number.textContent = `#${ticket.id}`;
      const person = document.createElement("td");
      const personName = document.createElement("div");
      personName.className = "person-name";
      personName.textContent = ticket.name;
      const email = document.createElement("div");
      email.className = "person-email";
      email.textContent = ticket.email;
      person.append(personName, email);
      const gender = document.createElement("td");
      gender.textContent = ticket.gender;
      const party = document.createElement("td");
      party.textContent = `${ticket.party_size} 位`;
      const created = document.createElement("td");
      created.textContent = new Date(ticket.created_at).toLocaleString();
      const statusCell = document.createElement("td");
      const status = document.createElement("span");
      status.className = `status-chip${ticket.status === "notified" ? " notified" : ""}`;
      status.textContent = ticket.status === "notified" ? "已通知" : "候位中";
      statusCell.append(status);
      const actions = document.createElement("td");
      const actionGroup = document.createElement("div");
      actionGroup.className = "row-actions";
      if (ticket.status !== "notified") {
        actionGroup.append(createActionButton("通知", "notify", ticket.id));
      }
      actionGroup.append(
        createActionButton("入座", "seat", ticket.id),
        createActionButton("取消", "cancel", ticket.id, "danger"),
      );
      actions.append(actionGroup);
      row.append(number, person, gender, party, created, statusCell, actions);
      staffQueue.append(row);
      const position = positionOf(result.queue, ticket.id);
      if (position !== index) throw new Error("候位 Queue 順序不一致。");
    });
  }

  function renderEventLog(events) {
    if (!eventLog) return;
    eventLog.replaceChildren();
    if (!events.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = "尚無操作紀錄。";
      eventLog.append(empty);
      return;
    }
    events.slice(0, 40).forEach(event => {
      const item = document.createElement("div");
      item.className = "history-item";
      const time = document.createElement("span");
      time.className = "history-time";
      time.textContent = `${new Date(event.at).toLocaleString()} · `;
      const description = document.createElement("strong");
      description.textContent = `${event.event}：`;
      const details = document.createTextNode(event.details);
      item.append(time, description, details);
      eventLog.append(item);
    });
  }

  async function loadStaffQueue() {
    if (!staffKey || busy) return;
    try {
      const result = await api("queue", { key: staffKey }, "POST");
      if (result.events) renderEventLog(result.events);
      renderStaffQueue(result);
    } catch (error) {
      setNotice(staffNotice, error.message, "error");
      if (error.message.includes("密碼錯誤")) {
        staffKey = "";
        staffPanel.hidden = true;
        staffLoginForm.hidden = false;
      }
    }
  }

  async function loginStaff(event) {
    event.preventDefault();
    if (busy) return;
    const key = staffPassword.value;
    if (!key) {
      setNotice(staffLoginNotice, "請輸入員工密碼。", "error");
      return;
    }
    setBusy(true);
    setNotice(staffLoginNotice, "正在驗證員工密碼……");
    try {
      const result = await api("queue", { key }, "POST");
      staffKey = key;
      staffLoginForm.hidden = true;
      staffPanel.hidden = false;
      staffPassword.value = "";
      renderStaffQueue(result);
      if (result.events) renderEventLog(result.events);
      setNotice(staffNotice, isLive ? "登入成功，已連線正式候位資料。" : "示範模式登入成功；密碼為 staff，資料僅存在此瀏覽器。", "success");
      startStaffPolling();
    } catch (error) {
      setNotice(staffLoginNotice, error.message, "error");
      staffPassword.select();
    } finally {
      setBusy(false);
    }
  }

  async function handleStaffAction(event) {
    const button = event.target.closest("[data-staff-action]");
    if (!button || busy || !staffKey) return;
    const action = button.dataset.staffAction;
    const id = button.dataset.ticketId;
    if (action === "seat" && !window.confirm(`確認將 #${id} 標記入座？`)) return;
    if (action === "cancel" && !window.confirm(`確認取消 #${id} 的候位？`)) return;
    const actionText = { notify: "通知", seat: "入座", cancel: "取消" }[action] || action;
    setBusy(true);
    setNotice(staffNotice, `正在執行「${actionText}」……`);
    try {
      const result = await api(action, { key: staffKey, id }, "POST");
      if (action === "notify" && result.detail) {
        setNotice(staffNotice, result.detail, isLive ? "success" : "");
      } else {
        setNotice(staffNotice, `已完成「${actionText}」操作。`, "success");
      }
      const queue = await api("queue", { key: staffKey }, "POST");
      renderStaffQueue(queue);
      if (queue.events) renderEventLog(queue.events);
    } catch (error) {
      setNotice(staffNotice, error.message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function resetDemo() {
    if (!staffKey || isLive) return;
    if (!window.confirm("確定清除本瀏覽器中的所有示範候位資料？此操作無法復原。")) return;
    setBusy(true);
    try {
      await api("reset", { key: staffKey }, "POST");
      sessionStorage.removeItem(TICKET_KEY);
      activeTicketId = "";
      setNotice(staffNotice, "示範資料已清除。", "success");
      const result = await api("queue", { key: staffKey }, "POST");
      renderStaffQueue(result);
      renderEventLog(result.events || []);
    } catch (error) {
      setNotice(staffNotice, error.message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function logoutStaff() {
    staffKey = "";
    staffPanel.hidden = true;
    staffLoginForm.hidden = false;
    if (pollingTimer) window.clearInterval(pollingTimer);
    setNotice(staffNotice, "已登出員工管理頁。");
  }

  function startPublicPolling() {
    if (pollingTimer) window.clearInterval(pollingTimer);
    void refreshPublic();
    pollingTimer = window.setInterval(() => void refreshPublic(), POLL_INTERVAL);
  }

  function startStaffPolling() {
    if (pollingTimer) window.clearInterval(pollingTimer);
    pollingTimer = window.setInterval(() => void loadStaffQueue(), POLL_INTERVAL);
  }

  function initCustomerPage() {
    if (isLive && joinForm) {
      document.querySelectorAll("[data-demo-mode-note]").forEach(node => {
        node.hidden = true;
      });
    }
    const fromHash = window.location.hash.match(/(?:^#|&)ticket=([^&]+)/);
    activeTicketId = fromHash ? decodeURIComponent(fromHash[1]) : sessionStorage.getItem(TICKET_KEY) || "";
    if (activeTicketId) sessionStorage.setItem(TICKET_KEY, activeTicketId);
    joinForm.addEventListener("submit", joinQueue);
    cancelButton.addEventListener("click", cancelCustomerTicket);
    document.querySelector("#refreshQueue").addEventListener("click", refreshPublic);
    startPublicPolling();
    window.addEventListener("hashchange", () => {
      const ticket = window.location.hash.match(/(?:^#|&)ticket=([^&]+)/);
      if (ticket) {
        activeTicketId = decodeURIComponent(ticket[1]);
        sessionStorage.setItem(TICKET_KEY, activeTicketId);
        void refreshPublic();
      }
    });
  }

  function initStaffPage() {
    if (isLive) {
      document.querySelectorAll("[data-demo-mode-note], .demo-tools").forEach(node => {
        node.hidden = true;
      });
    }
    staffLoginForm.addEventListener("submit", loginStaff);
    staffQueue.addEventListener("click", handleStaffAction);
    document.querySelector("#refreshStaff").addEventListener("click", loadStaffQueue);
    document.querySelector("#logoutStaff").addEventListener("click", logoutStaff);
    document.querySelector("#resetDemo").addEventListener("click", resetDemo);
  }

  if (page === "customer") initCustomerPage();
  if (page === "staff") initStaffPage();
})();
