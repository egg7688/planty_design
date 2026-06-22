const form = document.querySelector("#report-form");
const statusEl = document.querySelector("#status");
const reportEl = document.querySelector("#report");
const submitButton = document.querySelector("#submit-button");

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const formData = new FormData(form);
  const payload = {
    keyword: formData.get("keyword"),
    email: formData.get("email")
  };

  setLoading(true);
  setStatus("검색 결과를 수집하고 보고서를 생성하는 중입니다...");
  reportEl.classList.add("hidden");
  reportEl.innerHTML = "";

  try {
    const response = await fetch("/api/report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.message || "요청에 실패했습니다.");
    }

    renderReport(data.report);
    setStatus(data.email.sent ? "보고서가 생성되고 이메일로 발송되었습니다." : data.email.reason);
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    setLoading(false);
  }
});

function renderReport(report) {
  const sections = report.sections
    .map(
      (section) => `
        <article class="report-section">
          <h3>${escapeHtml(section.title)}</h3>
          ${
            section.items.length
              ? `<div class="cards">${section.items.map(renderResultCard).join("")}</div>`
              : "<p>검색 결과가 없습니다.</p>"
          }
        </article>
      `
    )
    .join("");

  reportEl.innerHTML = `
    <div class="report-header">
      <p class="eyebrow">생성 완료</p>
      <h2>${escapeHtml(report.title)}</h2>
      <p>${escapeHtml(report.summary)}</p>
      <div class="stats">
        <span>DBpia ${report.stats.dbpiaCount}건</span>
        <span>Google Scholar ${report.stats.googleScholarCount}건</span>
        <span>총 ${report.stats.totalCount}건</span>
      </div>
      ${
        report.topKeywords.length
          ? `<div class="chips">${report.topKeywords.map((word) => `<span>${escapeHtml(word)}</span>`).join("")}</div>`
          : ""
      }
    </div>
    ${sections}
  `;
  reportEl.classList.remove("hidden");
}

function renderResultCard(item) {
  return `
    <article class="card">
      <div class="card-meta">
        <span>${escapeHtml(item.source)}</span>
        ${item.year ? `<span>${escapeHtml(item.year)}</span>` : ""}
        ${item.citations ? `<span>인용 ${escapeHtml(item.citations)}</span>` : ""}
      </div>
      <h4>${escapeHtml(item.title)}</h4>
      <p class="muted">${escapeHtml(item.authors || "저자 정보 없음")}</p>
      <p>${escapeHtml(item.abstract || "초록 정보가 없습니다.")}</p>
      ${
        item.link
          ? `<a href="${escapeHtml(item.link)}" target="_blank" rel="noreferrer">원문 보기</a>`
          : ""
      }
    </article>
  `;
}

function setLoading(isLoading) {
  submitButton.disabled = isLoading;
  submitButton.textContent = isLoading ? "생성 중..." : "보고서 생성 및 발송";
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
