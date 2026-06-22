const crypto = require("crypto");
const nodemailer = require("nodemailer");
const { parseStringPromise } = require("xml2js");

const MAX_RESULTS = Number(process.env.MAX_RESULTS || 5);
const SESSION_TTL_MS = Number(process.env.PREMIUM_SESSION_TTL_HOURS || 12) * 60 * 60 * 1000;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

async function createPremiumSession({ email, accessCode, dbpiaLoginConfirmed }) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const normalizedCode = String(accessCode || "").trim();
  const expectedCode = getPremiumAccessCode();

  if (!isEmail(normalizedEmail)) {
    throw httpError(400, "DBpia 로그인 확인에 사용할 이메일 형식이 올바르지 않습니다.");
  }

  if (dbpiaLoginConfirmed !== true && !expectedCode) {
    throw httpError(500, "PREMIUM_ACCESS_CODE 환경변수를 설정해 주세요.");
  }

  if (dbpiaLoginConfirmed !== true && !safeEqual(normalizedCode, expectedCode)) {
    throw httpError(401, "유료 접근 코드가 올바르지 않습니다.");
  }

  const expiresAt = Date.now() + SESSION_TTL_MS;
  const token = signSession({
    email: normalizedEmail,
    plan: "premium",
    provider: dbpiaLoginConfirmed === true ? "dbpia" : "access-code",
    expiresAt
  });

  return {
    token,
    user: {
      email: normalizedEmail,
      plan: "premium",
      provider: dbpiaLoginConfirmed === true ? "dbpia" : "access-code",
      expiresAt
    }
  };
}

async function createAcademicReport({ keyword, email, authorization }) {
  const session = verifyPremiumAuthorization(authorization);

  if (!keyword || typeof keyword !== "string" || keyword.trim().length < 2) {
    throw httpError(400, "두 글자 이상의 키워드를 입력해 주세요.");
  }

  if (!email || typeof email !== "string" || !isEmail(email)) {
    throw httpError(400, "보고서를 받을 이메일 주소를 입력해 주세요.");
  }

  const normalizedKeyword = keyword.trim();
  const [dbpiaResults, scholarResults] = await Promise.all([
    searchDbpia(normalizedKeyword),
    searchGoogleScholar(normalizedKeyword)
  ]);

  const report = await buildReport(normalizedKeyword, dbpiaResults, scholarResults);
  const emailResult = await sendReportEmail(email.trim(), report);

  return {
    keyword: normalizedKeyword,
    user: {
      email: session.email,
      plan: session.plan
    },
    report,
    email: emailResult
  };
}

function verifyPremiumAuthorization(authorization) {
  const token = String(authorization || "").replace(/^Bearer\s+/i, "").trim();

  if (!token) {
    throw httpError(401, "유료 로그인 후 보고서를 생성할 수 있습니다.");
  }

  const session = verifySession(token);
  if (session.plan !== "premium") {
    throw httpError(403, "유료 사용자만 보고서를 생성할 수 있습니다.");
  }

  return session;
}

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

async function buildReport(keyword, dbpiaResults, scholarResults) {
  const allResults = [...dbpiaResults, ...scholarResults];
  const topKeywords = buildRelatedTerms(keyword, allResults);
  const summary = await createReportSummary(keyword, dbpiaResults, scholarResults, topKeywords);

  return {
    title: `"${keyword}" 학술 검색 보고서`,
    createdAt: new Date().toISOString(),
    summary,
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

async function createReportSummary(keyword, dbpiaResults, scholarResults, topKeywords) {
  const fallback = createFallbackSummary(keyword, dbpiaResults, scholarResults, topKeywords);

  if (!process.env.GEMINI_API_KEY) {
    return fallback;
  }

  const response = await fetch(`${GEMINI_ENDPOINT}?key=${process.env.GEMINI_API_KEY}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      generationConfig: {
        temperature: 0.2
      },
      contents: [
        {
          role: "user",
          parts: [
            {
              text: buildReportPrompt(keyword, dbpiaResults, scholarResults)
            }
          ]
        }
      ]
    })
  });

  if (!response.ok) {
    return fallback;
  }

  const payload = await response.json();
  return payload.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || fallback;
}

function createFallbackSummary(keyword, dbpiaResults, scholarResults, topKeywords) {
  const total = dbpiaResults.length + scholarResults.length;
  if (total === 0) {
    return `"${keyword}"에 대한 검색 결과가 없습니다. 키워드를 더 넓게 바꾸거나 API 설정을 확인해 주세요.`;
  }

  const relatedText = topKeywords.length ? `\n\n주요 연관어: ${topKeywords.slice(0, 6).join(", ")}` : "";
  return `핵심 요약
"${keyword}"에 대해 DBpia ${dbpiaResults.length}건, Google Scholar ${scholarResults.length}건을 수집했습니다.

주요 연구 흐름
검색 결과의 제목과 초록에서 반복 출현하는 용어를 기준으로 관련 연구의 적용 사례, 방법론, 후속 연구 방향을 검토할 수 있습니다.

자료별 시사점
DBpia 결과는 국내 연구 맥락과 학술지 중심 자료를 확인하는 데 유용하고, Google Scholar 결과는 국제 연구 흐름과 인용 기반 확장 탐색에 유용합니다.${relatedText}`;
}

function buildReportPrompt(keyword, dbpiaResults, scholarResults) {
  return `
아래 학술 검색 결과만 근거로 한국어 보고서를 작성하세요.
원문 전문을 읽은 것처럼 표현하지 말고, 제목/저자/초록/출처에서 확인 가능한 내용만 요약하세요.

보고서 형식:
1. 핵심 요약
2. 주요 연구 흐름
3. 자료별 시사점
4. 후속 탐구 질문
5. 참고문헌 후보

키워드: ${keyword}

DBpia 결과:
${formatResultsForPrompt(dbpiaResults)}

Google Scholar 결과:
${formatResultsForPrompt(scholarResults)}
`.trim();
}

function formatResultsForPrompt(results) {
  if (results.length === 0) {
    return "- 결과 없음";
  }

  return results
    .map((item, index) => {
      return `${index + 1}. ${item.title}
   - 저자: ${item.authors || "미상"}
   - 발행/출처: ${item.publication || item.source || "미상"}
   - 연도: ${item.year || "미상"}
   - 초록/요약: ${item.abstract || "요약 없음"}
   - 링크: ${item.link || "링크 없음"}`;
    })
    .join("\n");
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
    <section>${escapeHtml(report.summary).replaceAll("\n", "<br>")}</section>
    ${sections}
  </main>`;
}

function signSession(payload) {
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = createSignature(encodedPayload);
  return `${encodedPayload}.${signature}`;
}

function verifySession(token) {
  const [encodedPayload, signature] = token.split(".");

  if (!encodedPayload || !signature || !safeEqual(signature, createSignature(encodedPayload))) {
    throw httpError(401, "유료 로그인 세션이 유효하지 않습니다.");
  }

  const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  if (!payload.expiresAt || Date.now() > payload.expiresAt) {
    throw httpError(401, "유료 로그인 세션이 만료되었습니다.");
  }

  return payload;
}

function createSignature(value) {
  return crypto.createHmac("sha256", getSessionSecret()).update(value).digest("base64url");
}

function getSessionSecret() {
  return process.env.SESSION_SECRET || process.env.PREMIUM_ACCESS_CODE || "local-development-session-secret";
}

function getPremiumAccessCode() {
  return process.env.PREMIUM_ACCESS_CODE || (process.env.NODE_ENV === "production" ? "" : "demo-premium");
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));

  if (left.length !== right.length) {
    return false;
  }

  return crypto.timingSafeEqual(left, right);
}

function base64UrlEncode(value) {
  return Buffer.from(value).toString("base64url");
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

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || ""));
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

module.exports = {
  createAcademicReport,
  createPremiumSession
};
