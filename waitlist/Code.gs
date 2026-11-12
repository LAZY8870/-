/**
 * Google Apps Script backend for the restaurant waitlist.
 *
 * Set STAFF_KEY and RESTAURANT in Project Settings > Script properties before deployment.
 * The FIFO queue is stored as JSON in Script Properties and mail is sent by MailApp.
 */
const MAX_QUEUE = 50;
const MAX_PROPERTY_BYTES = 8500;
const MAX_EVENTS = 40;
const store = PropertiesService.getScriptProperties();

const Queue = {
  load() {
    const raw = store.getProperty("queue") || "[]";
    const queue = JSON.parse(raw);
    if (!Array.isArray(queue)) throw new Error("候位資料格式錯誤。");
    return queue;
  },

  save(queue) {
    const serialized = JSON.stringify(queue);
    if (Utilities.newBlob(serialized).getBytes().length > MAX_PROPERTY_BYTES) {
      throw new Error("候位資料容量已滿，請聯絡員工處理。");
    }
    store.setProperty("queue", serialized);
  },

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

  find(id) {
    return this.load().find(ticket => String(ticket.id) === String(id)) || null;
  },

  positionOf(id) {
    return this.load().findIndex(ticket => String(ticket.id) === String(id));
  },

  update(id, fields) {
    const queue = this.load();
    const ticket = queue.find(item => String(item.id) === String(id));
    if (!ticket) return null;
    Object.assign(ticket, fields);
    this.save(queue);
    return ticket;
  },

  remove(id, reason) {
    const queue = this.load();
    const position = queue.findIndex(ticket => String(ticket.id) === String(id));
    if (position < 0) return null;
    const [ticket] = queue.splice(position, 1);
    this.save(queue);
    updateStats_(reason);
    return ticket;
  },
};

function doGet(event) {
  const params = event && event.parameter ? event.parameter : {};
  const action = params.action || "count";
  if (action !== "count" && action !== "publicQueue") {
    return output_({ error: "此操作請使用 POST。" });
  }
  return output_(withLock_(() => {
    if (action === "count") return { waiting: Queue.load().length };
    return {
      queue: Queue.load().map(ticket => ({
        id: ticket.id,
        name: ticket.name,
        party_size: ticket.party_size,
      })),
    };
  }));
}

function doPost(event) {
  let params;
  try {
    const raw = event && event.postData ? event.postData.contents : "";
    params = raw ? JSON.parse(raw) : {};
  } catch (error) {
    return output_({ error: "請求內容不是有效 JSON。" });
  }
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    return output_({ error: "請求格式錯誤。" });
  }
  return output_(withLock_(() => handle_(params)));
}

function withLock_(callback) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    return callback();
  } catch (error) {
    return { error: error && error.message ? error.message : String(error) };
  } finally {
    lock.releaseLock();
  }
}

function output_(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}

function handle_(params) {
  switch (String(params.action || "")) {
    case "join":
      return join_(params);
    case "status":
      return status_(params);
    case "leave":
      return leave_(params);
    case "queue":
      requireStaff_(params.key);
      return queueForStaff_();
    case "notify":
      requireStaff_(params.key);
      return notify_(params.id);
    case "seat":
      requireStaff_(params.key);
      return closeTicket_(params.id, "seated", "入座");
    case "cancel":
      requireStaff_(params.key);
      return closeTicket_(params.id, "cancelled", "員工取消");
    case "log":
      requireStaff_(params.key);
      return { log: loadEvents_() };
    case "reset":
      requireStaff_(params.key);
      return reset_();
    default:
      return { error: "未知的候位操作。" };
  }
}

function join_(params) {
  const name = cleanText_(params.name, 60);
  const email = cleanText_(params.email, 254).toLowerCase();
  const gender = cleanText_(params.gender, 20);
  const partySize = Number(params.party_size);
  const cancelToken = String(params.cancel_token || "");

  if (!name) throw new Error("請填寫姓名。");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("請填寫正確的 E-mail。");
  if (!["男", "女", "其他"].includes(gender)) throw new Error("請選擇有效的性別選項。");
  if (!Number.isInteger(partySize) || partySize < 1 || partySize > 20) {
    throw new Error("用餐人數必須介於 1 到 20 位。");
  }
  if (!/^[a-f0-9]{48}$/.test(cancelToken)) throw new Error("候位驗證資訊無效，請重新送出表單。");
  const now = now_();
  const ticket = Queue.enqueue({
    name,
    gender,
    email,
    party_size: partySize,
    cancel_token: cancelToken,
    status: "waiting",
    created_at: now,
    notified_at: "",
  });
  recordEvent_("候位", `${ticket.id} 號 ${ticket.name}（${ticket.party_size} 位）`);
  return {
    id: ticket.id,
    ahead: Queue.positionOf(ticket.id),
    waiting: Queue.load().length,
  };
}

function status_(params) {
  const ticket = Queue.find(params.id);
  if (!ticket || !safeCompare_(ticket.cancel_token, params.cancel_token)) {
    throw new Error("找不到這個候位號碼（可能已入座或取消）。");
  }
  return {
    id: ticket.id,
    name: ticket.name,
    party_size: ticket.party_size,
    status: ticket.status,
    created_at: ticket.created_at,
    ahead: Queue.positionOf(ticket.id),
    waiting: Queue.load().length,
  };
}

function leave_(params) {
  const ticket = Queue.find(params.id);
  if (!ticket || !safeCompare_(ticket.cancel_token, params.cancel_token)) {
    throw new Error("找不到這個候位號碼（可能已入座或取消）。");
  }
  const removed = closeTicket_(ticket.id, "cancelled", "顧客取消");
  return { ok: true, id: removed.id };
}

function queueForStaff_() {
  const queue = Queue.load();
  const stats = todayStats_();
  const events = loadEvents_();
  return {
    queue: queue.map(ticket => ({
      id: ticket.id,
      name: ticket.name,
      gender: ticket.gender,
      email: ticket.email,
      party_size: ticket.party_size,
      status: ticket.status,
      created_at: ticket.created_at,
      notified_at: ticket.notified_at,
    })),
    joined: stats.joined,
    seated: stats.seated,
    cancelled: stats.cancelled,
    averageWaitMinutes: averageWait_(events),
    events,
  };
}

function notify_(id) {
  const ticket = Queue.find(id);
  if (!ticket) throw new Error("找不到這個候位號碼。");
  if (ticket.status === "notified") throw new Error("此顧客已通知，請勿重複寄送。");
  if (ticket.status !== "waiting") throw new Error("此候位狀態不可寄送通知。");
  const restaurant = store.getProperty("RESTAURANT") || "海大餐廳";
  const honor = { 男: "先生", 女: "小姐" }[ticket.gender] || "";
  const body = [
    `${ticket.name} ${honor}您好：`,
    "",
    `您在${restaurant}的候位號碼 ${ticket.id} 號（${ticket.party_size} 位）已輪到。`,
    "請於 5 分鐘內至櫃台報到，逾時可能視同放棄。",
    "",
    `候位時間：${ticket.created_at}`,
    `通知時間：${now_()}`,
    "",
    `${restaurant} 敬上`,
  ].join("\n");
  const subject = `【${restaurant}】候位通知：${ticket.id} 號請準備入座`;
  MailApp.sendEmail({ to: ticket.email, subject, body, name: restaurant });
  Queue.update(ticket.id, { status: "notified", notified_at: now_() });
  recordEvent_("通知", `${ticket.id} 號 ${ticket.name}`);
  return {
    ok: true,
    detail: `通知信已寄出至 ${ticket.email}。`,
    remainingQuota: MailApp.getRemainingDailyQuota(),
  };
}

function closeTicket_(id, reason, eventName) {
  const ticket = Queue.remove(id, reason);
  if (!ticket) throw new Error("找不到這個候位號碼。");
  if (reason === "seated") {
    const waitMinutes = Math.max(
      0,
      Math.round((new Date(now_()).getTime() - new Date(ticket.created_at).getTime()) / 60000),
    );
    recordEvent_(eventName, `${ticket.id} 號 ${ticket.name}`, waitMinutes);
  } else {
    recordEvent_(eventName, `${ticket.id} 號 ${ticket.name}`);
  }
  return ticket;
}

function requireStaff_(providedKey) {
  const savedKey = store.getProperty("STAFF_KEY");
  if (!savedKey || savedKey.length < 12) throw new Error("後端尚未設定安全的員工密碼。");
  const candidate = String(providedKey || "");
  if (candidate.length > 256 || !safeCompare_(savedKey, candidate)) {
    throw new Error("員工密碼錯誤，無法檢視候位資料。");
  }
}

function safeCompare_(expected, actual) {
  const left = String(expected || "");
  const right = String(actual || "");
  let mismatch = left.length ^ right.length;
  const maxLength = Math.max(left.length, right.length);
  for (let index = 0; index < maxLength; index += 1) {
    mismatch |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return mismatch === 0;
}

function cleanText_(value, maxLength) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim()
    .slice(0, maxLength);
}

function todayKey_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
}

function todayStats_() {
  return JSON.parse(store.getProperty(`stats:${todayKey_()}`) || '{"joined":0,"seated":0,"cancelled":0}');
}

function updateStats_(reason) {
  const key = `stats:${todayKey_()}`;
  const stats = todayStats_();
  stats[reason] = (stats[reason] || 0) + 1;
  store.setProperty(key, JSON.stringify(stats));
}

function loadEvents_() {
  const events = JSON.parse(store.getProperty("events") || "[]");
  return Array.isArray(events) ? events : [];
}

function recordEvent_(event, details, waitMinutes) {
  const events = loadEvents_();
  const item = { at: now_(), event, details };
  if (Number.isFinite(waitMinutes)) item.waitMinutes = waitMinutes;
  events.unshift(item);
  while (events.length > MAX_EVENTS) events.pop();
  store.setProperty("events", JSON.stringify(events));
  if (event === "候位") {
    const stats = todayStats_();
    stats.joined += 1;
    store.setProperty(`stats:${todayKey_()}`, JSON.stringify(stats));
  }
}

function averageWait_(events) {
  const durations = events
    .filter(item => item.event === "入座" && Number.isFinite(item.waitMinutes))
    .map(item => item.waitMinutes);
  if (!durations.length) return 0;
  return Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length);
}

function reset_() {
  const properties = store.getProperties();
  Object.keys(properties).forEach(key => {
    if (key !== "STAFF_KEY" && key !== "RESTAURANT") store.deleteProperty(key);
  });
  recordEvent_("系統", "員工清除候位資料");
  return { ok: true };
}

function now_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ssXXX");
}

function authorizeMail() {
  return MailApp.getRemainingDailyQuota();
}
