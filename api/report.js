const nodemailer = require("nodemailer");
const { parseStringPromise } = require("xml2js");

const MAX_RESULTS = Number(process.env.MAX_RESULTS || 5);

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ message: "POST 요청만 지원합니다." });
  }

  const { keyword, email } = req.body || {};

  if (!keyword || typeof keyword !== "string" || keyword.trim().length < 2) {
    return res.status(400).json({ message: "두 글자 이상의 키워드를 입력해 주세요." });
  }

  if (!email || typeof email !== "string" || !email.includes("@")) {
    return res.status(400).json({ message: "보고서를 받을 이메일 주소를 입력해 주세요." });
  }

  try {
    const normalizedKeyword = keyword.trim();
    const [dbpiaResults, scholarResults] = await Promise.all([
      searchDbpia(normalizedKeyword),
      searchGoogleScholar(normalizedKeyword)
    ]);

    const report = buildReport(normalizedKeyword, dbpiaResults, scholarResults);
    const emailResult = await sendReportEmail(email, report);

    return res.status(200).json({
      keyword: normalizedKeyword,
      report,
      email: emailResult
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      message: "보고서를 생성하는 중 오류가 발생했습니다.",
      detail: process.env.NODE_ENV === "production" ? undefined : error.message
    });
  }
};

async function searchDbpia(keyword) {
  const apiKey = process.env.DBPIA_API_KEY;

  if (!apiKey) {
    return demoResults("DBpia", keyword);
  }

  const endpoint = process.env.DBPIA_API_URL || "http://api.dbpia.co.kr/v2/search/search.xml";
  const url = new URL(endpoint);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("target", "se");
  url.searchParams.set("searchall", keyword);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`DBpia API 요청 실패: ${response.status}`);
  }

  const xml = await response.text();
  const parsed = await parseStringPromise(xml, { explicitArray: false, mergeAttrs: true });
  return normalizeDbpiaItems(parsed).slice(0, MAX_RESULTS);
}

async function searchGoogleScholar(keyword) {
  const apiKey = process.env.SERPAPI_API_KEY || process.env.GOOGLE_SCHOLAR_API_KEY;

  if (!apiKey) {
    return demoResults("Google Scholar", keyword);
  }

  const endpoint = process.env.GOOGLE_SCHOLAR_API_URL || "https://serpapi.com/search.json";
  const url = new URL(endpoint);
  url.searchParams.set("engine", "google_scholar");
  url.searchParams.set("q", keyword);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("num", String(MAX_RESULTS));
  url.searchParams.set("hl", process.env.GOOGLE_SCHOLAR_LANG || "ko");

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Google Scholar API 요청 실패: ${response.status}`);
  }

  const data = await response.json();
  return (data.organic_results || []).slice(0, MAX_RESULTS).map((item) => ({
    source: "Google Scholar",
    title: item.title || "제목 없음",
    authors: item.publication_info?.authors?.map((author) => author.name).join(", ") || item.publication_info?.summary || "",
    publication: item.publication_info?.summary || "",
    year: extractYear(item.publication_info?.summary),
    abstract: item.snippet || "",
    link: item.link || item.result_id || "",
    citations: item.inline_links?.cited_by?.total || 0
  }));
}

function normalizeDbpiaItems(parsed) {
  const items =
    parsed?.root?.result?.items?.item ||
    parsed?.root?.items?.item ||
    parsed?.result?.items?.item ||
    parsed?.items?.item ||
    [];

  const list = Array.isArray(items) ? items : [items];

  return list.filter(Boolean).map((item) => ({
    source: "DBpia",
    title: valueOf(item.title) || valueOf(item.article_title) || valueOf(item.item_title) || "제목 없음",
    authors: valueOf(item.author) || valueOf(item.authors) || valueOf(item.author_name) || "",
    publication: valueOf(item.publication) || valueOf(item.journal) || valueOf(item.publisher) || "",
    year: extractYear(valueOf(item.pubdate) || valueOf(item.issue_yymm) || valueOf(item.year)),
    abstract: valueOf(item.abstract) || valueOf(item.description) || "",
    link: valueOf(item.link_url) || valueOf(item.link) || valueOf(item.url) || "",
    citations: 0
  }));
}

function buildReport(keyword, dbpiaResults, scholarResults) {
  const allResults = [...dbpiaResults, ...scholarResults];
  const topKeywords = buildRelatedTerms(keyword, allResults);

  return {
    title: `"${keyword}" 학술 검색 보고서`,
    createdAt: new Date().toISOString(),
    summary: createSummary(keyword, dbpiaResults, scholarResults, topKeywords),
    stats: {
      dbpiaCount: dbpiaResults.length,
      googleScholarCount: scholarResults.length,
      totalCount: allResults.length
    },
    topKeywords,
    sections: [
      {
        title: "DBpia 검색 결과",
        items: dbpiaResults
      },
      {
        title: "Google Scholar 검색 결과",
        items: scholarResults
      }
    ]
  };
}

function createSummary(keyword, dbpiaResults, scholarResults, topKeywords) {
  const total = dbpiaResults.length + scholarResults.length;
  if (total === 0) {
    return `"${keyword}"에 대한 검색 결과가 없습니다. 키워드를 더 넓게 바꾸거나 API 설정을 확인해 주세요.`;
  }

  const relatedText = topKeywords.length ? ` 주요 연관어는 ${topKeywords.slice(0, 5).join(", ")}입니다.` : "";
  return `"${keyword}"에 대해 DBpia ${dbpiaResults.length}건, Google Scholar ${scholarResults.length}건을 수집했습니다.${relatedText} 아래 결과를 중심으로 최신 연구 흐름과 반복 출현 주제를 검토할 수 있습니다.`;
}

function buildRelatedTerms(keyword, results) {
  const stopWords = new Set([
    keyword.toLowerCase(),
    "the",
    "and",
    "for",
    "with",
    "from",
    "using",
    "study",
    "analysis",
    "research"
  ]);

  const counts = new Map();
  results
    .flatMap((result) => `${result.title} ${result.abstract}`.toLowerCase().match(/[a-z0-9가-힣]{2,}/g) || [])
    .filter((word) => !stopWords.has(word))
    .forEach((word) => counts.set(word, (counts.get(word) || 0) + 1));

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([word]) => word);
}

async function sendReportEmail(to, report) {
  if (!hasSmtpConfig()) {
    return {
      sent: false,
      reason: "SMTP 환경변수가 없어 이메일 발송은 건너뛰었습니다."
    };
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });

  await transporter.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to,
    subject: report.title,
    text: reportToText(report),
    html: reportToHtml(report)
  });

  return { sent: true };
}

function reportToText(report) {
  const sections = report.sections
    .map((section) => {
      const items = section.items
        .map((item, index) => {
          return `${index + 1}. ${item.title}
저자: ${item.authors || "-"}
출처: ${item.publication || item.source}
링크: ${item.link || "-"}`;
        })
        .join("\n\n");
      return `## ${section.title}\n${items || "검색 결과 없음"}`;
    })
    .join("\n\n");

  return `${report.title}
생성일: ${new Date(report.createdAt).toLocaleString("ko-KR")}

${report.summary}

${sections}`;
}

function reportToHtml(report) {
  const sections = report.sections
    .map((section) => {
      const items = section.items
        .map(
          (item) => `<li>
            <strong>${escapeHtml(item.title)}</strong><br>
            <span>저자: ${escapeHtml(item.authors || "-")}</span><br>
            <span>출처: ${escapeHtml(item.publication || item.source)}</span><br>
            ${item.link ? `<a href="${escapeHtml(item.link)}">원문 보기</a>` : ""}
          </li>`
        )
        .join("");

      return `<h2>${escapeHtml(section.title)}</h2><ol>${items || "<li>검색 결과 없음</li>"}</ol>`;
    })
    .join("");

  return `<main>
    <h1>${escapeHtml(report.title)}</h1>
    <p>${escapeHtml(report.summary)}</p>
    ${sections}
  </main>`;
}

function hasSmtpConfig() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function demoResults(source, keyword) {
  return [
    {
      source,
      title: `${keyword} 관련 연구 동향 분석`,
      authors: "Demo Author",
      publication: `${source} Demo Journal`,
      year: new Date().getFullYear(),
      abstract: `${keyword} 분야의 주요 연구 흐름과 적용 사례를 요약한 데모 결과입니다.`,
      link: "",
      citations: 0
    },
    {
      source,
      title: `${keyword} 기반 방법론과 사례 연구`,
      authors: "Demo Researcher",
      publication: `${source} Demo Proceedings`,
      year: new Date().getFullYear() - 1,
      abstract: `${keyword}를 활용한 방법론, 한계, 후속 연구 방향을 다룹니다.`,
      link: "",
      citations: 0
    }
  ].slice(0, MAX_RESULTS);
}

function valueOf(value) {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(valueOf).filter(Boolean).join(", ");
  if (typeof value === "object") return value._ || value.name || value.href || "";
  return "";
}

function extractYear(value) {
  const match = String(value || "").match(/(19|20)\d{2}/);
  return match ? Number(match[0]) : "";
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
