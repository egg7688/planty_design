const elements = {
  phaseLabel: document.querySelector("#phase-label"),
  timerDisplay: document.querySelector("#timer-display"),
  hourglassTimer: document.querySelector(".hourglass-timer"),
  hourglassSandTop: document.querySelector("#hourglass-sand-top"),
  hourglassSandTopRidge: document.querySelector("#hourglass-sand-top-ridge"),
  hourglassSandBottom: document.querySelector("#hourglass-sand-bottom"),
  hourglassSandRidge: document.querySelector("#hourglass-sand-ridge"),
  startButton: document.querySelector("#start-button"),
  pauseButton: document.querySelector("#pause-button"),
  resetButton: document.querySelector("#reset-button"),
  focusMinutes: document.querySelector("#focus-minutes"),
  breakMinutes: document.querySelector("#break-minutes"),
  autoBreak: document.querySelector("#auto-break"),
  internetLimitMinutes: document.querySelector("#internet-limit-minutes"),
  internetDisplay: document.querySelector("#internet-display"),
  internetProgressFill: document.querySelector("#internet-progress-fill"),
  internetStartButton: document.querySelector("#internet-start-button"),
  internetStopButton: document.querySelector("#internet-stop-button"),
  internetResetButton: document.querySelector("#internet-reset-button"),
  internetStatus: document.querySelector("#internet-status"),
  contentCheckInput: document.querySelector("#content-check-input"),
  contentCheckButton: document.querySelector("#content-check-button"),
  contentClearButton: document.querySelector("#content-clear-button"),
  contentCheckResult: document.querySelector("#content-check-result"),
  calendarMonth: document.querySelector("#calendar-month"),
  calendarGrid: document.querySelector("#calendar-grid"),
  prevMonthButton: document.querySelector("#prev-month-button"),
  nextMonthButton: document.querySelector("#next-month-button"),
  sessionCount: document.querySelector("#session-count"),
  historyList: document.querySelector("#history-list"),
};

const HISTORY_STORAGE_KEY = "time-control-history";
const INTERNET_STORAGE_KEY = "time-control-internet";
const DEFAULT_INTERNET_LIMIT_MINUTES = 120;
const HOURGLASS_SAND_HEIGHT = 92;

let mode = "focus";
let totalSeconds = getMinutes(elements.focusMinutes) * 60;
let remainingSeconds = totalSeconds;
let timerId = null;
let internetTimerId = null;
let history = loadHistory();
let internetState = loadInternetState();
let calendarDate = new Date();

elements.internetLimitMinutes.value = internetState.limitMinutes.toString();
syncInternetUsage();
render();
renderHistory();
renderCalendar();
renderInternet();
resumeInternetTimer();
registerServiceWorker();

elements.startButton.addEventListener("click", async () => {
  await requestNotificationPermission();
  startTimer();
});

elements.pauseButton.addEventListener("click", pauseTimer);
elements.resetButton.addEventListener("click", resetTimer);
elements.focusMinutes.addEventListener("change", handleSettingChange);
elements.breakMinutes.addEventListener("change", handleSettingChange);
elements.internetLimitMinutes.addEventListener("change", handleInternetLimitChange);
elements.internetStartButton.addEventListener("click", async () => {
  await requestNotificationPermission();
  startInternetTimer();
});
elements.internetStopButton.addEventListener("click", stopInternetTimer);
elements.internetResetButton.addEventListener("click", resetInternetToday);
elements.contentCheckButton.addEventListener("click", checkContentSafety);
elements.contentClearButton.addEventListener("click", clearContentCheck);
elements.prevMonthButton.addEventListener("click", () => changeCalendarMonth(-1));
elements.nextMonthButton.addEventListener("click", () => changeCalendarMonth(1));

function startTimer() {
  if (timerId) {
    return;
  }

  timerId = window.setInterval(tick, 1000);
  elements.startButton.textContent = "진행 중";
  elements.startButton.disabled = true;
  elements.pauseButton.disabled = false;
  render();
}

function pauseTimer() {
  window.clearInterval(timerId);
  timerId = null;
  elements.startButton.textContent = "다시 시작";
  elements.startButton.disabled = false;
  elements.pauseButton.disabled = true;
  render();
}

function resetTimer() {
  pauseTimer();
  mode = "focus";
  totalSeconds = getMinutes(elements.focusMinutes) * 60;
  remainingSeconds = totalSeconds;
  elements.startButton.textContent = "시작";
  render();
}

function tick() {
  remainingSeconds -= 1;

  if (remainingSeconds <= 0) {
    completeCurrentTimer();
    return;
  }

  render();
}

function completeCurrentTimer() {
  const completedMode = mode;
  addHistory(completedMode);
  notify(completedMode === "focus" ? "집중 시간이 끝났어요" : "휴식 시간이 끝났어요");

  if (completedMode === "focus" && elements.autoBreak.checked) {
    mode = "break";
    totalSeconds = getMinutes(elements.breakMinutes) * 60;
    remainingSeconds = totalSeconds;
    render();
    return;
  }

  pauseTimer();
  mode = "focus";
  totalSeconds = getMinutes(elements.focusMinutes) * 60;
  remainingSeconds = totalSeconds;
  elements.startButton.textContent = "시작";
  render();
}

function handleSettingChange() {
  normalizeInput(elements.focusMinutes, 1, 180);
  normalizeInput(elements.breakMinutes, 1, 60);

  if (!timerId) {
    totalSeconds = getMinutes(mode === "focus" ? elements.focusMinutes : elements.breakMinutes) * 60;
    remainingSeconds = totalSeconds;
    render();
  }
}

function render() {
  const minutes = Math.floor(remainingSeconds / 60).toString().padStart(2, "0");
  const seconds = (remainingSeconds % 60).toString().padStart(2, "0");
  const elapsed = totalSeconds - remainingSeconds;
  const progress = totalSeconds === 0 ? 0 : Math.min((elapsed / totalSeconds) * 100, 100);

  elements.phaseLabel.textContent = mode === "focus" ? "집중 중" : "휴식 중";
  elements.timerDisplay.textContent = `${minutes}:${seconds}`;
  renderHourglass(progress);
  document.title = `${minutes}:${seconds} - 시간 제어`;
}

function renderHourglass(progress) {
  const topHeight = Math.max(HOURGLASS_SAND_HEIGHT * (1 - progress / 100), 0);
  const bottomHeight = Math.min(HOURGLASS_SAND_HEIGHT * (progress / 100), HOURGLASS_SAND_HEIGHT);
  const pileProgress = progress / 100;
  const topSurfaceLeftY = 50 + (HOURGLASS_SAND_HEIGHT - topHeight) * 0.78;
  const topSurfaceRightY = topSurfaceLeftY + 8;
  const pileBaseHalfWidth = 18 + 55 * pileProgress;
  const pilePeakY = 248 - bottomHeight * 0.78;
  const pileLeftX = 120 - pileBaseHalfWidth;
  const pileRightX = 120 + pileBaseHalfWidth;
  const ridgeY = pilePeakY + Math.max(bottomHeight * 0.18, 1);
  const pileShoulderY = 250 - bottomHeight * 0.3;
  const pileSideY = 247 - bottomHeight * 0.08;

  elements.hourglassSandTop.setAttribute(
    "d",
    topHeight < 1
      ? "M120 136L120 136L120 136Z"
      : `M64 ${topSurfaceLeftY} C86 ${topSurfaceLeftY - 7} 116 ${topSurfaceRightY + 5} 176 ${topSurfaceRightY} C166 101 141 121 120 136 C99 121 74 101 64 ${topSurfaceLeftY} Z`,
  );
  elements.hourglassSandTopRidge.setAttribute(
    "d",
    topHeight < 1
      ? "M120 136L120 136"
      : `M64 ${topSurfaceLeftY} C86 ${topSurfaceLeftY - 7} 116 ${topSurfaceRightY + 5} 176 ${topSurfaceRightY}`,
  );
  elements.hourglassSandBottom.setAttribute(
    "d",
    bottomHeight < 1
      ? "M120 248L120 248L120 248Z"
      : `M${pileLeftX} ${pileSideY} C${pileLeftX - 14} ${pileShoulderY} ${120 - 46} ${ridgeY + 3} 120 ${pilePeakY} C${120 + 46} ${ridgeY + 3} ${pileRightX + 14} ${pileShoulderY} ${pileRightX} ${pileSideY} C${pileRightX - 10} 256 ${pileLeftX + 10} 256 ${pileLeftX} ${pileSideY} Z`,
  );
  elements.hourglassSandRidge.setAttribute(
    "d",
    bottomHeight < 1
      ? "M120 248L120 248"
      : `M${pileLeftX + 12} ${pileSideY - 1} C${120 - 40} ${ridgeY + 8} ${120 - 15} ${pilePeakY + 4} 120 ${pilePeakY} C${120 + 15} ${pilePeakY + 4} ${120 + 40} ${ridgeY + 8} ${pileRightX - 12} ${pileSideY - 1}`,
  );
  elements.hourglassTimer.classList.toggle("is-running", Boolean(timerId) && progress < 100);
}

function addHistory(completedMode) {
  const minutes = completedMode === "focus" ? getMinutes(elements.focusMinutes) : getMinutes(elements.breakMinutes);
  history.unshift({
    mode: completedMode,
    minutes,
    completedAt: new Date().toISOString(),
  });
  history = history.slice(0, 365);
  localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history));
  renderHistory();
  renderCalendar();
}

function renderHistory() {
  const focusCount = history.filter((item) => item.mode === "focus").length;
  elements.sessionCount.textContent = `${focusCount}회 완료`;

  if (history.length === 0) {
    elements.historyList.innerHTML = '<li class="empty-state">아직 완료한 시간이 없습니다.</li>';
    return;
  }

  elements.historyList.innerHTML = history
    .slice(0, 10)
    .map((item) => {
      const label = item.mode === "focus" ? "집중" : "휴식";
      const time = new Intl.DateTimeFormat("ko-KR", {
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(item.completedAt));

      return `<li><strong>${label} ${item.minutes}분</strong> 완료 · ${time}</li>`;
    })
    .join("");
}

function renderCalendar() {
  const year = calendarDate.getFullYear();
  const month = calendarDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const startDate = new Date(year, month, 1 - firstDay.getDay());
  const focusByDate = getFocusByDate();

  elements.calendarMonth.textContent = new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "long",
  }).format(calendarDate);

  elements.calendarGrid.innerHTML = Array.from({ length: 42 }, (_, index) => {
    const day = new Date(startDate);
    day.setDate(startDate.getDate() + index);

    const key = getDateKey(day);
    const focus = focusByDate.get(key);
    const isCurrentMonth = day.getMonth() === month;
    const isToday = key === getTodayKey();
    const classes = [
      "calendar-day",
      isCurrentMonth ? "" : "is-outside",
      focus ? "has-focus" : "",
      isToday ? "is-today" : "",
    ]
      .filter(Boolean)
      .join(" ");

    return `
      <div class="${classes}">
        <span class="calendar-date">${day.getDate()}</span>
        ${
          focus
            ? `<span class="calendar-focus">${focus.minutes}분</span><span class="calendar-count">${focus.count}회 집중</span>`
            : ""
        }
      </div>
    `;
  }).join("");
}

function changeCalendarMonth(direction) {
  calendarDate = new Date(calendarDate.getFullYear(), calendarDate.getMonth() + direction, 1);
  renderCalendar();
}

function getFocusByDate() {
  return history.reduce((map, item) => {
    if (item.mode !== "focus") {
      return map;
    }

    const key = getDateKey(new Date(item.completedAt));
    const current = map.get(key) ?? { minutes: 0, count: 0 };
    current.minutes += item.minutes;
    current.count += 1;
    map.set(key, current);

    return map;
  }, new Map());
}

function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_STORAGE_KEY)) ?? [];
  } catch {
    return [];
  }
}

async function checkContentSafety() {
  const text = elements.contentCheckInput.value.trim();

  if (!text) {
    setContentCheckResult("검사할 내용을 먼저 입력하세요.", "neutral");
    return;
  }

  elements.contentCheckButton.disabled = true;
  setContentCheckResult("Gemini 2.5 Flash로 유해 여부를 검사 중입니다.", "checking");

  try {
    const response = await fetch("/api/moderate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text }),
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error ?? "콘텐츠 검사에 실패했습니다.");
    }

    if (data.blocked) {
      setContentCheckResult(`차단됨: ${data.reason}`, "blocked");
      return;
    }

    setContentCheckResult(`허용됨: ${data.reason}`, "safe");
  } catch (error) {
    setContentCheckResult(error.message, "blocked");
  } finally {
    elements.contentCheckButton.disabled = false;
  }
}

function clearContentCheck() {
  elements.contentCheckInput.value = "";
  setContentCheckResult("검사할 내용을 입력하면 결과가 표시됩니다.", "neutral");
}

function setContentCheckResult(message, state) {
  elements.contentCheckResult.textContent = message;
  elements.contentCheckResult.className = `guard-result is-${state}`;
}

function startInternetTimer() {
  if (internetTimerId) {
    return;
  }

  syncInternetUsage();

  if (getInternetRemainingSeconds() <= 0) {
    notify("오늘 사용할 수 있는 인터넷 시간이 끝났어요");
    renderInternet();
    return;
  }

  internetState.runningSince = Date.now();
  saveInternetState();
  resumeInternetTimer();
  renderInternet();
}

function stopInternetTimer() {
  syncInternetUsage();
  window.clearInterval(internetTimerId);
  internetTimerId = null;
  internetState.runningSince = null;
  saveInternetState();
  renderInternet();
}

function resetInternetToday() {
  window.clearInterval(internetTimerId);
  internetTimerId = null;
  internetState = {
    date: getTodayKey(),
    limitMinutes: getMinutes(elements.internetLimitMinutes),
    usedSeconds: 0,
    runningSince: null,
  };
  saveInternetState();
  renderInternet();
}

function handleInternetLimitChange() {
  normalizeInput(elements.internetLimitMinutes, 1, 1440);
  syncInternetUsage();
  internetState.limitMinutes = getMinutes(elements.internetLimitMinutes);

  if (getInternetRemainingSeconds() <= 0) {
    internetState.usedSeconds = internetState.limitMinutes * 60;
    internetState.runningSince = null;
    window.clearInterval(internetTimerId);
    internetTimerId = null;
  }

  saveInternetState();
  renderInternet();
}

function resumeInternetTimer() {
  if (!internetState.runningSince || internetTimerId) {
    return;
  }

  internetTimerId = window.setInterval(updateInternetTimer, 1000);
}

function updateInternetTimer() {
  syncInternetUsage();

  if (getInternetRemainingSeconds() <= 0) {
    internetState.usedSeconds = internetState.limitMinutes * 60;
    internetState.runningSince = null;
    window.clearInterval(internetTimerId);
    internetTimerId = null;
    notify("오늘 사용할 수 있는 인터넷 시간이 끝났어요");
  }

  saveInternetState();
  renderInternet();
}

function renderInternet() {
  const limitSeconds = internetState.limitMinutes * 60;
  const remaining = getInternetRemainingSeconds();
  const used = limitSeconds - remaining;
  const progress = limitSeconds === 0 ? 0 : Math.min((used / limitSeconds) * 100, 100);

  elements.internetDisplay.textContent = formatDuration(remaining);
  elements.internetProgressFill.style.width = `${progress}%`;
  elements.internetStartButton.disabled = Boolean(internetTimerId) || remaining <= 0;
  elements.internetStopButton.disabled = !internetTimerId;

  if (remaining <= 0) {
    elements.internetStatus.textContent = "오늘 인터넷 사용 한도를 모두 사용했습니다.";
  } else if (internetTimerId) {
    elements.internetStatus.textContent = "인터넷 사용 시간을 기록 중입니다.";
  } else {
    elements.internetStatus.textContent = "인터넷을 사용할 때 시작을 누르면 오늘 남은 시간을 추적합니다.";
  }
}

function syncInternetUsage() {
  const today = getTodayKey();

  if (internetState.date !== today) {
    internetState = {
      date: today,
      limitMinutes: internetState.limitMinutes,
      usedSeconds: 0,
      runningSince: internetState.runningSince ? Date.now() : null,
    };
  }

  if (!internetState.runningSince) {
    saveInternetState();
    return;
  }

  const elapsedSeconds = Math.floor((Date.now() - internetState.runningSince) / 1000);

  if (elapsedSeconds <= 0) {
    return;
  }

  internetState.usedSeconds = Math.min(
    internetState.usedSeconds + elapsedSeconds,
    internetState.limitMinutes * 60,
  );
  internetState.runningSince = Date.now();
  saveInternetState();
}

function getInternetRemainingSeconds() {
  return Math.max(internetState.limitMinutes * 60 - internetState.usedSeconds, 0);
}

function loadInternetState() {
  const fallback = {
    date: getTodayKey(),
    limitMinutes: DEFAULT_INTERNET_LIMIT_MINUTES,
    usedSeconds: 0,
    runningSince: null,
  };

  try {
    const saved = JSON.parse(localStorage.getItem(INTERNET_STORAGE_KEY));

    return {
      ...fallback,
      ...saved,
      limitMinutes: Number.parseInt(saved?.limitMinutes, 10) || fallback.limitMinutes,
      usedSeconds: Number.parseInt(saved?.usedSeconds, 10) || 0,
      runningSince: saved?.runningSince || null,
    };
  } catch {
    return fallback;
  }
}

function saveInternetState() {
  localStorage.setItem(INTERNET_STORAGE_KEY, JSON.stringify(internetState));
}

function getTodayKey() {
  return getDateKey(new Date());
}

function getDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function formatDuration(totalSeconds) {
  const hours = Math.floor(totalSeconds / 3600).toString().padStart(2, "0");
  const minutes = Math.floor((totalSeconds % 3600) / 60).toString().padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");

  return `${hours}:${minutes}:${seconds}`;
}

function getMinutes(input) {
  return Number.parseInt(input.value, 10) || 1;
}

function normalizeInput(input, min, max) {
  const value = Math.min(Math.max(getMinutes(input), min), max);
  input.value = value.toString();
}

async function requestNotificationPermission() {
  if (!("Notification" in window) || Notification.permission !== "default") {
    return;
  }

  await Notification.requestPermission();
}

function notify(message) {
  if ("Notification" in window && Notification.permission === "granted") {
    new Notification(message, {
      body: "다음 루틴을 시작할 시간입니다.",
      icon: "icon.svg",
    });
  }

  if ("vibrate" in navigator) {
    navigator.vibrate([180, 80, 180]);
  }
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js");
  }
}
