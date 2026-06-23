const loginForm = document.querySelector("#login-form");
const loginStatusEl = document.querySelector("#login-status");
const loginButton = document.querySelector("#login-button");
const form = document.querySelector("#report-form");
const statusEl = document.querySelector("#status");
const reportEl = document.querySelector("#report");
const submitButton = document.querySelector("#submit-button");

const session = loadSession();
if (session?.token) {
  unlockReportForm(session.user);
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const formData = new FormData(loginForm);
  const payload = {
    email: formData.get("email"),
    dbpiaLoginConfirmed: formData.get("dbpiaLoginConfirmed") === "on"
  };

  setLoginLoading(true);
  setLoginStatus("DBpia 기관인증 완료 여부를 확인하는 중입니다...");

  try {
    const response = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.message || "DBpia 기관인증 확인에 실패했습니다.");
    }

    localStorage.setItem("premiumSession", JSON.stringify(data));
    unlockReportForm(data.user);
    setLoginStatus(`${data.user.email} 계정으로 DBpia 기관인증 확인이 완료되었습니다.`);
  } catch (error) {
    localStorage.removeItem("premiumSession");
    submitButton.disabled = true;
    setLoginStatus(error.message, true);
  } finally {
    setLoginLoading(false);
  }
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const currentSession = loadSession();
  if (!currentSession?.token) {
    setStatus("DBpia 기관인증 확인 후 보고서를 생성할 수 있습니다.", true);
    return;
  }

  const formData = new FormData(form);
  const payload = {
    keyword: formData.get("keyword"),
    reportTopic: formData.get("reportTopic"),
    email: formData.get("email")
  };

  setLoading(true);
  setStatus("검색 결과를 수집하고 입력한 주제에 맞춰 레포트를 작성하는 중입니다...");
  reportEl.classList.add("hidden");
  reportEl.innerHTML = "";

  try {
    const response = await fetch("/api/report", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${currentSession.token}`
      },
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
  const references = (report.references || [])
    .map(renderReferenceItem)
    .join("");
  const opinion = renderOpinion(report.opinion);
  const presentation = renderPresentation(report.presentation);

  const insights = (report.insights || [])
    .map(
      (section) => `
        <article class="insight-card">
          <h3>${escapeHtml(section.title)}</h3>
          <div>${formatText(section.body)}</div>
        </article>
      `
    )
    .join("");

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
      <div class="summary">${formatText(report.summary)}</div>
      <div class="download-actions">
        <button type="button" data-download="markdown">Markdown 다운로드</button>
        <button type="button" data-download="json" class="secondary-button">JSON 다운로드</button>
      </div>
      <div class="stats">
        <span>DBpia ${report.stats.dbpiaCount}건</span>
        <span>총 ${report.stats.totalCount}건</span>
      </div>
      ${
        report.topKeywords.length
          ? `<div class="chips">${report.topKeywords.map((word) => `<span>${escapeHtml(word)}</span>`).join("")}</div>`
          : ""
      }
    </div>
    ${opinion}
    ${insights ? `<section class="insights">${insights}</section>` : ""}
    ${presentation}
    ${
      references
        ? `<section class="reference-links">
            <div class="section-heading">
              <p class="eyebrow">Source Links</p>
              <h3>검색 결과 링크</h3>
            </div>
            <div class="reference-list">${references}</div>
          </section>`
        : ""
    }
    ${sections}
  `;
  bindDownloadButtons(report);
  reportEl.classList.remove("hidden");
}

function renderOpinion(opinion) {
  if (!opinion) {
    return "";
  }

  const rationale = (opinion.rationale || [])
    .map((item) => `<li>${escapeHtml(item)}</li>`)
    .join("");
  const references = (opinion.supportingReferences || [])
    .map((item) => {
      const label = `[${item.source}] ${item.title}${item.year ? ` (${item.year})` : ""}`;
      return `<li>${item.link ? `<a href="${escapeHtml(item.link)}" target="_blank" rel="noreferrer">${escapeHtml(label)}</a>` : escapeHtml(label)}</li>`;
    })
    .join("");

  return `
    <section class="opinion-panel">
      <div class="section-heading">
        <p class="eyebrow">Evidence-Based Opinion</p>
        <h3>검색 결과를 토대로 한 의견</h3>
      </div>
      <div class="opinion-grid">
        <article class="opinion-main">
          <span class="stance-badge">${escapeHtml(opinion.stance || "의견")}</span>
          <p>${escapeHtml(opinion.thesis || "")}</p>
        </article>
        <article>
          <h4>의견 근거</h4>
          <ul>${rationale}</ul>
        </article>
        <article>
          <h4>반대 관점과 한계</h4>
          <p>${escapeHtml(opinion.counterpoint || "")}</p>
        </article>
        <article>
          <h4>최종 제언</h4>
          <p>${escapeHtml(opinion.recommendation || "")}</p>
        </article>
      </div>
      <p class="muted">${escapeHtml(opinion.evidenceScope || "")}</p>
      ${references ? `<div class="opinion-references"><h4>의견에 사용한 대표 근거</h4><ol>${references}</ol></div>` : ""}
    </section>
  `;
}

function bindDownloadButtons(report) {
  reportEl.querySelector('[data-download="markdown"]')?.addEventListener("click", () => {
    downloadFile(`${toSafeFilename(report.reportTopic || report.title)}.md`, reportToMarkdown(report), "text/markdown;charset=utf-8");
  });

  reportEl.querySelector('[data-download="json"]')?.addEventListener("click", () => {
    downloadFile(`${toSafeFilename(report.reportTopic || report.title)}.json`, JSON.stringify(report, null, 2), "application/json;charset=utf-8");
  });
}

function renderPresentation(presentation) {
  if (!presentation) {
    return "";
  }

  const slides = (presentation.slides || [])
    .map(
      (slide) => `
        <article class="slide-card">
          <h4>${escapeHtml(slide.title)}</h4>
          <ul>
            ${(slide.bullets || []).map((bullet) => `<li>${escapeHtml(bullet)}</li>`).join("")}
          </ul>
          <p class="speaker-note"><strong>발표자 메모</strong><br>${escapeHtml(slide.speakerNote || "")}</p>
        </article>
      `
    )
    .join("");

  const qna = (presentation.qnaPrep || [])
    .map(
      (item) => `
        <article class="qna-item">
          <p class="reference-title">Q. ${escapeHtml(item.question)}</p>
          <p>A. ${escapeHtml(item.answer)}</p>
        </article>
      `
    )
    .join("");

  return `
    <section class="presentation-plan">
      <div class="section-heading">
        <p class="eyebrow">Presentation Ready</p>
        <h3>${escapeHtml(presentation.headline || "발표용 구성안")}</h3>
        <p>${escapeHtml(presentation.keyMessage || "")}</p>
        <p class="muted">${escapeHtml(presentation.audienceTakeaway || "")}</p>
      </div>
      <div class="slide-list">${slides}</div>
      ${qna ? `<div class="qna-list"><h3>예상 Q&A</h3>${qna}</div>` : ""}
    </section>
  `;
}

function renderReferenceItem(item) {
  const meta = [item.source, item.publication, item.year].filter(Boolean).join(" · ");

  return `
    <article class="reference-item">
      <div>
        <p class="reference-title">${escapeHtml(item.title)}</p>
        <p class="muted">${escapeHtml(meta || "출처 정보 없음")}</p>
      </div>
      ${
        item.link
          ? `<a href="${escapeHtml(item.link)}" target="_blank" rel="noreferrer">검색 결과 보기</a>`
          : `<span class="disabled-link">링크 없음</span>`
      }
    </article>
  `;
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
          ? `<a href="${escapeHtml(item.link)}" target="_blank" rel="noreferrer">검색 결과 보기</a>`
          : ""
      }
    </article>
  `;
}

function reportToMarkdown(report) {
  const lines = [
    `# ${report.title}`,
    "",
    `- 검색 키워드: ${report.keyword || "-"}`,
    `- 레포트 주제: ${report.reportTopic || "-"}`,
    `- 생성일: ${report.createdAt ? new Date(report.createdAt).toLocaleString("ko-KR") : "-"}`,
    "",
    "## 핵심 요약",
    report.summary || "-",
    ""
  ];

  if (report.insights?.length) {
    if (report.opinion) {
      lines.push("## 검색 결과를 토대로 한 의견", "");
      lines.push(`- 입장: ${report.opinion.stance || "-"}`);
      lines.push("", report.opinion.thesis || "-", "");
      lines.push("### 의견 근거");
      (report.opinion.rationale || []).forEach((item) => lines.push(`- ${item}`));
      lines.push("", "### 반대 관점과 한계", report.opinion.counterpoint || "-", "");
      lines.push("### 최종 제언", report.opinion.recommendation || "-", "");
      if (report.opinion.evidenceScope) {
        lines.push(`근거 범위: ${report.opinion.evidenceScope}`, "");
      }
    }

    lines.push("## 검색 결과 기반 레포트", "");
    report.insights.forEach((section) => {
      lines.push(`### ${section.title}`, section.body || "-", "");
    });
  }

  if (report.presentation) {
    lines.push("## 발표용 구성안", "", `### 핵심 메시지`, report.presentation.keyMessage || "-", "");
    lines.push("### 청중 Takeaway", report.presentation.audienceTakeaway || "-", "");

    (report.presentation.slides || []).forEach((slide) => {
      lines.push(`### ${slide.title}`);
      (slide.bullets || []).forEach((bullet) => lines.push(`- ${bullet}`));
      lines.push("", `발표자 메모: ${slide.speakerNote || "-"}`, "");
    });

    if (report.presentation.qnaPrep?.length) {
      lines.push("### 예상 Q&A", "");
      report.presentation.qnaPrep.forEach((item) => {
        lines.push(`**Q. ${item.question}**`, "", `A. ${item.answer}`, "");
      });
    }
  }

  if (report.references?.length) {
    lines.push("## 검색 결과 링크", "");
    report.references.forEach((item, index) => {
      const meta = [item.source, item.publication, item.year].filter(Boolean).join(" · ");
      lines.push(`${index + 1}. ${item.link ? `[${item.title}](${item.link})` : item.title}`);
      if (meta) lines.push(`   - ${meta}`);
      if (item.authors) lines.push(`   - 저자: ${item.authors}`);
    });
    lines.push("");
  }

  if (report.sections?.length) {
    lines.push("## 검색 결과 상세", "");
    report.sections.forEach((section) => {
      lines.push(`### ${section.title}`, "");
      (section.items || []).forEach((item, index) => {
        lines.push(`${index + 1}. ${item.link ? `[${item.title}](${item.link})` : item.title}`);
        if (item.authors) lines.push(`   - 저자: ${item.authors}`);
        if (item.publication || item.source) lines.push(`   - 출처: ${item.publication || item.source}`);
        if (item.abstract) lines.push(`   - 요약: ${item.abstract}`);
      });
      lines.push("");
    });
  }

  return lines.join("\n");
}

function downloadFile(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function toSafeFilename(value) {
  return String(value || "academic-report")
    .trim()
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 80) || "academic-report";
}

function setLoading(isLoading) {
  submitButton.disabled = isLoading;
  submitButton.textContent = isLoading ? "생성 중..." : "보고서 생성 및 발송";
}

function setLoginLoading(isLoading) {
  loginButton.disabled = isLoading;
  loginButton.textContent = isLoading ? "확인 중..." : "기관인증 완료 후 계속";
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
}

function setLoginStatus(message, isError = false) {
  loginStatusEl.textContent = message;
  loginStatusEl.classList.toggle("error", isError);
}

function unlockReportForm(user) {
  submitButton.disabled = false;
  const emailInput = document.querySelector("#email");
  if (user?.email && !emailInput.value) {
    emailInput.value = user.email;
  }
}

function loadSession() {
  try {
    return JSON.parse(localStorage.getItem("premiumSession"));
  } catch {
    return null;
  }
}

function formatText(value) {
  return escapeHtml(value)
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${paragraph.replaceAll("\n", "<br>")}</p>`)
    .join("");
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
