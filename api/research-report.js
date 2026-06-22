const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const SERPAPI_ENDPOINT = "https://serpapi.com/search.json";
const RESEND_ENDPOINT = "https://api.resend.com/emails";

module.exports = async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    response.status(405).json({ error: "POST 요청만 지원합니다." });
    return;
  }

  const keyword = typeof request.body?.keyword === "string" ? request.body.keyword.trim() : "";
  const email = typeof request.body?.email === "string" ? request.body.email.trim() : "";

  if (!keyword || !email) {
    response.status(400).json({ error: "키워드와 이메일을 모두 입력하세요." });
    return;
  }

  if (!isEmail(email)) {
    response.status(400).json({ error: "이메일 형식이 올바르지 않습니다." });
    return;
  }

  try {
    const [dbpiaResults, googleScholarResults] = await Promise.all([
      searchDbpia(keyword),
      searchGoogleScholar(keyword),
    ]);
    const report = await createReport(keyword, dbpiaResults, googleScholarResults);

    await sendReportEmail({
      to: email,
      keyword,
      report,
      dbpiaResults,
      googleScholarResults,
    });

    response.status(200).json({
      keyword,
      email,
      sources: {
        dbpia: dbpiaResults.length,
        googleScholar: googleScholarResults.length,
      },
    });
  } catch (error) {
    response.status(500).json({ error: error.message ?? "보고서 생성 중 오류가 발생했습니다." });
  }
};

async function searchDbpia(keyword) {
  const apiUrl = process.env.DBPIA_API_URL;

  if (!apiUrl) {
    return [];
  }

  const url = new URL(apiUrl);
  url.searchParams.set("query", keyword);
  url.searchParams.set("q", keyword);
  url.searchParams.set("keyword", keyword);

  const headers = {};

  if (process.env.DBPIA_API_KEY) {
    headers.Authorization = `Bearer ${process.env.DBPIA_API_KEY}`;
    headers["X-API-Key"] = process.env.DBPIA_API_KEY;
  }

  const response = await fetch(url, { headers });

  if (!response.ok) {
    throw new Error("DBpia 검색 API 호출에 실패했습니다.");
  }

  const payload = await response.json();
  return normalizeAcademicResults(payload, "DBpia").slice(0, 8);
}

async function searchGoogleScholar(keyword) {
  const serpApiKey = process.env.SERPAPI_API_KEY || process.env.GOOGLE_SCHOLAR_API_KEY;

  if (!serpApiKey) {
    return [];
  }

  const url = new URL(SERPAPI_ENDPOINT);
  url.searchParams.set("engine", "google_scholar");
  url.searchParams.set("q", keyword);
  url.searchParams.set("hl", "ko");
  url.searchParams.set("api_key", serpApiKey);

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error("구글 학술검색 API 호출에 실패했습니다.");
  }

  const payload = await response.json();
  return (payload.organic_results ?? []).slice(0, 8).map((item) => ({
    source: "Google Scholar",
    title: item.title ?? "제목 없음",
    authors: item.publication_info?.authors?.map((author) => author.name).join(", ") ?? "",
    year: extractYear(item.publication_info?.summary ?? ""),
    abstract: item.snippet ?? "",
    link: item.link ?? item.resources?.[0]?.link ?? "",
  }));
}

async function createReport(keyword, dbpiaResults, googleScholarResults) {
  const apiKey = process.env.GEMINI_API_KEY;
  const fallback = buildFallbackReport(keyword, dbpiaResults, googleScholarResults);

  if (!apiKey) {
    return fallback;
  }

  const geminiResponse = await fetch(`${GEMINI_ENDPOINT}?key=${apiKey}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      generationConfig: {
        temperature: 0.2,
      },
      contents: [
        {
          role: "user",
          parts: [
            {
              text: buildReportPrompt(keyword, dbpiaResults, googleScholarResults),
            },
          ],
        },
      ],
    }),
  });

  if (!geminiResponse.ok) {
    return fallback;
  }

  const payload = await geminiResponse.json();
  return payload.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || fallback;
}

async function sendReportEmail({ to, keyword, report, dbpiaResults, googleScholarResults }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.REPORT_FROM_EMAIL;

  if (!apiKey || !from) {
    throw new Error("Vercel 환경 변수 RESEND_API_KEY와 REPORT_FROM_EMAIL을 설정하세요.");
  }

  const response = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to,
      subject: `[학술 보고서] ${keyword}`,
      text: report,
      html: renderReportHtml(keyword, report, dbpiaResults, googleScholarResults),
    }),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.message ?? "이메일 발송에 실패했습니다.");
  }
}

function normalizeAcademicResults(payload, source) {
  const candidates =
    payload.items ??
    payload.documents ??
    payload.results ??
    payload.data ??
    payload.response?.docs ??
    [];

  if (!Array.isArray(candidates)) {
    return [];
  }

  return candidates.map((item) => ({
    source,
    title: item.title ?? item.articleTitle ?? item.name ?? "제목 없음",
    authors: normalizeAuthors(item.authors ?? item.author ?? item.creators),
    year: item.year ?? item.pubYear ?? item.publishedYear ?? extractYear(item.date ?? item.publicationDate ?? ""),
    abstract: item.abstract ?? item.summary ?? item.description ?? "",
    link: item.link ?? item.url ?? item.href ?? "",
  }));
}

function normalizeAuthors(authors) {
  if (Array.isArray(authors)) {
    return authors.map((author) => (typeof author === "string" ? author : author.name)).filter(Boolean).join(", ");
  }

  return typeof authors === "string" ? authors : "";
}

function extractYear(text) {
  const match = String(text).match(/\b(19|20)\d{2}\b/);
  return match?.[0] ?? "";
}

function buildReportPrompt(keyword, dbpiaResults, googleScholarResults) {
  return `
아래 학술 검색 결과를 바탕으로 한국어 학술 보고서를 작성하세요.
과장하지 말고, 제공된 자료에서 추론 가능한 내용만 사용하세요.

보고서 형식:
1. 제목
2. 핵심 요약
3. 주요 연구 흐름
4. 자료별 시사점
5. 향후 탐구 질문
6. 참고문헌 목록

키워드: ${keyword}

DBpia 결과:
${formatResultsForPrompt(dbpiaResults)}

구글 학술검색 결과:
${formatResultsForPrompt(googleScholarResults)}
`.trim();
}

function buildFallbackReport(keyword, dbpiaResults, googleScholarResults) {
  return `
# ${keyword} 학술 보고서

## 핵심 요약
DBpia와 구글 학술검색에서 수집한 자료를 바탕으로 관련 연구를 정리했습니다.

## 수집 자료
${formatReferenceList([...dbpiaResults, ...googleScholarResults]) || "- 검색 결과가 없습니다."}

## 참고
Gemini API 키가 설정되지 않은 경우 자동 종합 대신 수집 자료 목록 중심으로 보고서를 생성합니다.
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
   - 연도: ${item.year || "미상"}
   - 초록/요약: ${item.abstract || "요약 없음"}
   - 링크: ${item.link || "링크 없음"}`;
    })
    .join("\n");
}

function formatReferenceList(results) {
  return results
    .map((item) => `- [${item.source}] ${item.title}${item.authors ? `, ${item.authors}` : ""}${item.year ? ` (${item.year})` : ""}${item.link ? `\n  ${item.link}` : ""}`)
    .join("\n");
}

function renderReportHtml(keyword, report, dbpiaResults, googleScholarResults) {
  const escapedReport = escapeHtml(report).replace(/\n/g, "<br />");

  return `
    <main style="font-family: Apple SD Gothic Neo, AppleGothic, Arial, sans-serif; line-height: 1.6; color: #262626;">
      <h1>${escapeHtml(keyword)} 학술 보고서</h1>
      <section>${escapedReport}</section>
      <hr />
      <p>DBpia ${dbpiaResults.length}건, 구글 학술검색 ${googleScholarResults.length}건을 반영했습니다.</p>
    </main>
  `;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
