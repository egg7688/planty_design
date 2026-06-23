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
    throw httpError(400, "DBpia 기관인증 확인에 사용할 이메일 형식이 올바르지 않습니다.");
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
    provider: dbpiaLoginConfirmed === true ? "dbpia-institution" : "access-code",
    expiresAt
  });

  return {
    token,
    user: {
      email: normalizedEmail,
      plan: "premium",
      provider: dbpiaLoginConfirmed === true ? "dbpia-institution" : "access-code",
      expiresAt
    }
  };
}

async function createAcademicReport({ keyword, reportTopic, email, authorization }) {
  const session = verifyPremiumAuthorization(authorization);

  if (!keyword || typeof keyword !== "string" || keyword.trim().length < 2) {
    throw httpError(400, "두 글자 이상의 키워드를 입력해 주세요.");
  }

  if (!reportTopic || typeof reportTopic !== "string" || reportTopic.trim().length < 2) {
    throw httpError(400, "두 글자 이상의 레포트 주제를 입력해 주세요.");
  }

  if (!email || typeof email !== "string" || !isEmail(email)) {
    throw httpError(400, "보고서를 받을 이메일 주소를 입력해 주세요.");
  }

  const normalizedKeyword = keyword.trim();
  const normalizedReportTopic = reportTopic.trim();
  const dbpiaResults = await searchDbpia(normalizedKeyword);

  const report = await buildReport(normalizedKeyword, normalizedReportTopic, dbpiaResults);
  const emailResult = await sendReportEmail(email.trim(), report);

  return {
    keyword: normalizedKeyword,
    reportTopic: normalizedReportTopic,
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
    throw httpError(401, "DBpia 기관인증 확인 후 보고서를 생성할 수 있습니다.");
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

async function buildReport(keyword, reportTopic, dbpiaResults) {
  const allResults = [...dbpiaResults];
  const topKeywords = buildRelatedTerms(keyword, allResults);
  const summary = await createReportSummary(keyword, reportTopic, dbpiaResults, topKeywords);
  const insights = buildReportInsights(keyword, reportTopic, dbpiaResults, topKeywords);
  const opinion = buildEvidenceOpinion(keyword, reportTopic, dbpiaResults, topKeywords);
  const presentation = buildPresentationPlan(keyword, reportTopic, dbpiaResults, topKeywords);
  const references = buildReferences(allResults);

  return {
    title: `"${reportTopic}" 학술 검색 보고서`,
    keyword,
    reportTopic,
    createdAt: new Date().toISOString(),
    summary,
    insights,
    opinion,
    presentation,
    references,
    stats: {
      dbpiaCount: dbpiaResults.length,
      totalCount: allResults.length
    },
    topKeywords,
    sections: [
      {
        title: "DBpia 검색 결과",
        items: dbpiaResults
      }
    ]
  };
}

async function createReportSummary(keyword, reportTopic, dbpiaResults, topKeywords) {
  const fallback = createFallbackSummary(keyword, reportTopic, dbpiaResults, topKeywords);

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
              text: buildReportPrompt(keyword, reportTopic, dbpiaResults)
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

function createFallbackSummary(keyword, reportTopic, dbpiaResults, topKeywords) {
  const total = dbpiaResults.length;
  if (total === 0) {
    return `"${keyword}"에 대한 검색 결과가 없어 "${reportTopic}" 레포트를 생성할 수 없습니다. 키워드를 더 넓게 바꾸거나 API 설정을 확인해 주세요.`;
  }

  const allResults = [...dbpiaResults];
  const representativeTitles = allResults
    .slice(0, 3)
    .map((item) => `- ${item.title}${item.year ? ` (${item.year})` : ""}`)
    .join("\n");
  const relatedText = topKeywords.length ? `\n\n주요 연관어\n${topKeywords.slice(0, 6).join(", ")}` : "";

  return `핵심 요약
"${keyword}" 검색 결과 DBpia ${dbpiaResults.length}건을 근거로 "${reportTopic}" 주제의 레포트를 작성했습니다.

주요 연구 흐름
검색 결과의 제목과 초록을 기준으로 볼 때, "${reportTopic}"은 ${topKeywords.slice(0, 3).join(", ") || "관련 연구 주제"}와 연결해 논의할 수 있습니다.

자료별 시사점
DBpia 결과는 "${reportTopic}"의 국내 학술 연구 맥락, 주요 논의 축, 대표 자료를 확인하는 근거로 활용됩니다.

대표 자료
${representativeTitles}${relatedText}`;
}

function buildReportInsights(keyword, reportTopic, dbpiaResults, topKeywords) {
  const allResults = [...dbpiaResults];

  if (allResults.length === 0) {
    return [
      {
        title: "검색 결과 기반 레포트",
        body: `"${keyword}"에 대한 검색 결과가 없어 "${reportTopic}" 레포트를 생성할 수 없습니다. 키워드를 더 넓게 입력하거나 API 설정을 확인해 주세요.`
      }
    ];
  }

  const representative = allResults.slice(0, 4);
  const years = allResults.map((item) => Number(item.year)).filter(Boolean);
  const yearRange = years.length ? `${Math.min(...years)}년~${Math.max(...years)}년` : "연도 정보 없음";
  const sourceText = `DBpia ${dbpiaResults.length}건`;
  const termText = topKeywords.slice(0, 6).join(", ") || "반복 연관어 없음";

  return [
    {
      title: "검색 결과 개요",
      body: `"${keyword}" 키워드로 ${sourceText}을 수집했고, 이 자료를 바탕으로 "${reportTopic}" 주제를 분석했습니다. 확인 가능한 발행연도 범위는 ${yearRange}이며, 반복적으로 나타난 연관어는 ${termText}입니다.`
    },
    {
      title: "주제 중심 분석",
      body: `검색 결과의 제목과 초록을 종합하면 "${reportTopic}"은 "${keyword}" 연구에서 적용 사례, 방법론, 효과 분석, 후속 연구 방향과 연결됩니다. 특히 상위 결과들이 공유하는 표현을 기준으로 ${topKeywords.slice(0, 3).join(", ") || "핵심 개념"} 관련 논의가 두드러집니다.`
    },
    {
      title: "자료별 해석",
      body: `DBpia 자료는 "${reportTopic}"에 대한 국내 학술지와 국내 연구 맥락을 파악하는 데 적합합니다. 따라서 의견과 발표 구성은 국내 연구 결과의 제목, 초록, 출처에서 확인 가능한 범위 안에서 제시됩니다.`
    },
    {
      title: "대표 참고자료",
      body: representative
        .map((item, index) => `${index + 1}. [${item.source}] ${item.title}${item.authors ? `, ${item.authors}` : ""}${item.year ? ` (${item.year})` : ""}`)
        .join("\n")
    },
    {
      title: "후속 탐구 질문",
      body: `1. "${reportTopic}"과 직접 연결되는 "${keyword}" 연구의 방법론은 무엇인가?\n2. DBpia 검색 결과에서 "${reportTopic}"을 바라보는 핵심 초점은 무엇인가?\n3. 최근 국내 연구에서 "${reportTopic}"과 관련해 아직 충분히 다뤄지지 않은 적용 분야나 한계는 무엇인가?`
    }
  ];
}

function buildReferences(results) {
  return results.map((item, index) => ({
    id: index + 1,
    source: item.source,
    title: item.title,
    authors: item.authors,
    publication: item.publication,
    year: item.year,
    link: item.link,
    abstract: item.abstract
  }));
}

function buildEvidenceOpinion(keyword, reportTopic, dbpiaResults, topKeywords) {
  const allResults = [...dbpiaResults];
  const representative = allResults.slice(0, 5);
  const termText = topKeywords.slice(0, 5).join(", ") || "반복 연관어가 충분하지 않음";

  if (allResults.length === 0) {
    return {
      stance: "의견 보류",
      thesis: `"${keyword}" 검색 결과가 없어 "${reportTopic}"에 대한 근거 기반 의견을 제시하기 어렵습니다.`,
      rationale: [
        "검색 결과가 없으므로 주장을 뒷받침할 자료가 부족합니다.",
        "키워드를 더 넓게 바꾸거나 DBpia API 설정을 확인해야 합니다."
      ],
      counterpoint: "자료가 없는 상태에서 긍정 또는 부정 의견을 제시하면 근거 없는 주장으로 보일 수 있습니다.",
      recommendation: "검색 키워드를 조정한 뒤 자료를 다시 수집하고, 최소 3개 이상의 대표 자료를 확인한 다음 의견을 구성하세요.",
      evidenceScope: "검색 결과 없음",
      supportingReferences: []
    };
  }

  const stance = allResults.length >= 3 ? "조건부 긍정" : "신중한 긍정";
  const thesis = `"${reportTopic}"에 대해서는 ${stance} 입장을 제시할 수 있습니다. "${keyword}" 검색 결과에서 ${termText} 관련 논의가 반복적으로 확인되므로, 이 주제는 발표나 보고서에서 다룰 가치가 있습니다. 다만 검색 결과의 제목, 초록, 출처 중심 분석이므로 최종 결론 전 핵심 원문 검토가 필요합니다.`;

  return {
    stance,
    thesis,
    rationale: [
      `검색 결과가 총 ${allResults.length}건 수집되어 "${reportTopic}"에 대한 최소한의 근거 묶음을 구성할 수 있습니다.`,
      `반복 연관어(${termText})가 확인되어 주제와 연결되는 주요 논의 축을 만들 수 있습니다.`,
      "DBpia 검색 결과를 사용하므로 국내 학술 연구 맥락에 초점을 맞춘 의견을 제시할 수 있습니다."
    ],
    counterpoint: `"${reportTopic}"에 대해 단정적인 결론을 내리기에는 원문 전문, 연구 방법, 표본, 한계 검토가 아직 부족할 수 있습니다. 특히 검색 결과의 제목과 초록만으로 효과나 타당성을 확정해서는 안 됩니다.`,
    recommendation: `발표에서는 "${reportTopic}"을 긍정적으로 다루되, 적용 조건과 한계를 함께 제시하는 방식이 적절합니다. 대표 자료를 3~5개 인용하고, 마지막에는 추가 원문 검토와 실제 적용 검증이 필요하다는 제언으로 마무리하세요.`,
    evidenceScope: `검색 키워드 "${keyword}"로 수집한 DBpia ${dbpiaResults.length}건의 제목, 초록, 출처, 링크 기반 의견입니다.`,
    supportingReferences: representative.map((item, index) => ({
      id: index + 1,
      source: item.source,
      title: item.title,
      year: item.year,
      link: item.link
    }))
  };
}

function buildPresentationPlan(keyword, reportTopic, dbpiaResults, topKeywords) {
  const allResults = [...dbpiaResults];
  const sourceText = `DBpia ${dbpiaResults.length}건`;
  const mainTerms = topKeywords.slice(0, 5);
  const representative = allResults.slice(0, 5);
  const keyMessage =
    allResults.length === 0
      ? `"${keyword}" 검색 결과가 부족해 "${reportTopic}"에 대한 발표 근거를 충분히 구성하기 어렵습니다.`
      : `"${reportTopic}"은 "${keyword}" DBpia 검색 결과에서 확인되는 ${mainTerms.slice(0, 3).join(", ") || "핵심 개념"} 논의와 연결해 설명할 수 있으며, 국내 학술 자료를 근거로 의견을 제시하면 설득력이 높아집니다.`;

  return {
    headline: `${reportTopic}: 검색 결과 기반 발표 구성안`,
    keyMessage,
    audienceTakeaway: `청중은 발표 후 "${reportTopic}"이 왜 중요한지, 어떤 검색 근거가 있는지, 앞으로 무엇을 더 검토해야 하는지 이해할 수 있어야 합니다.`,
    slides: [
      {
        title: "1. 발표 주제와 문제 제기",
        bullets: [
          `"${reportTopic}"을 발표 주제로 설정한 이유를 설명합니다.`,
          `"${keyword}" 검색을 통해 확보한 자료 범위(${sourceText})를 밝힙니다.`,
          "검색 결과 기반 발표이므로 원문 전문 해석이 아닌 제목, 초록, 출처 중심 분석임을 전제합니다."
        ],
        speakerNote: "도입부에서는 주제의 필요성을 먼저 제시하고, 자료 수집 방식과 분석 범위를 간단히 밝혀 발표의 신뢰도를 확보합니다."
      },
      {
        title: "2. 검색 결과 개요",
        bullets: [
          `수집 출처는 ${sourceText}입니다.`,
          `반복적으로 확인된 연관어는 ${mainTerms.join(", ") || "충분히 확인되지 않음"}입니다.`,
          "DBpia 자료를 사용해 국내 학술 연구 맥락을 정리합니다."
        ],
        speakerNote: "청중에게 어떤 자료를 근거로 말하는지 먼저 보여주면 이후 해석이 더 설득력 있게 들립니다."
      },
      {
        title: "3. 핵심 연구 흐름",
        bullets: [
          `"${reportTopic}"과 연결되는 적용 사례, 방법론, 효과 분석 흐름을 정리합니다.`,
          "검색 결과의 제목과 초록에서 반복되는 개념을 중심으로 흐름을 묶습니다.",
          "국내 연구에서 반복되는 관심 주제와 한계를 정리합니다."
        ],
        speakerNote: "단순 나열보다 반복되는 주제를 2~3개 축으로 묶어 설명하는 것이 발표용 보고서에 적합합니다."
      },
      {
        title: "4. 대표 근거 자료",
        bullets: representative.length
          ? representative.map((item) => `[${item.source}] ${item.title}${item.year ? ` (${item.year})` : ""}`)
          : ["대표 근거 자료가 없습니다. 검색 키워드를 조정하거나 API 설정을 확인해야 합니다."],
        speakerNote: "대표 자료는 발표 중 화면에 직접 보여주거나 참고문헌 슬라이드로 넘길 수 있습니다."
      },
      {
        title: "5. 시사점과 활용 가능성",
        bullets: [
          `"${reportTopic}"은 실제 적용 가능성, 한계, 후속 검증 필요성을 함께 제시해야 합니다.`,
          "DBpia 결과는 국내 제도와 교육/산업 맥락을 설명하는 근거로 활용합니다.",
          "DBpia 결과에서 확인되는 대표 자료와 반복 주제를 근거로 활용합니다."
        ],
        speakerNote: "시사점 슬라이드에서는 주장을 크게 만들기보다 검색 결과에서 확인 가능한 범위 안에서 신중하게 정리합니다."
      },
      {
        title: "6. 결론과 후속 질문",
        bullets: [
          `결론: "${reportTopic}"은 검색 결과상 중요한 논의 축으로 구성할 수 있습니다.`,
          "후속 질문 1: 어떤 방법론이 가장 자주 활용되는가?",
          "후속 질문 2: 국내 연구에서 강조점이 어떻게 나타나는가?",
          "후속 질문 3: 실제 적용을 위해 추가로 검토해야 할 윤리적, 제도적, 기술적 조건은 무엇인가?"
        ],
        speakerNote: "마지막에는 핵심 메시지를 한 문장으로 다시 말하고, 질문을 열어 토론으로 이어갈 수 있게 마무리합니다."
      }
    ],
    qnaPrep: [
      {
        question: "검색 결과만으로 결론을 내려도 되는가?",
        answer: "이 보고서는 검색 결과의 제목, 초록, 출처를 기반으로 한 발표 초안입니다. 최종 발표 전 핵심 논문 원문 확인이 필요합니다."
      },
      {
        question: "왜 DBpia 자료만 사용했는가?",
        answer: "이번 보고서는 국내 학술 연구 맥락에 집중하기 위해 DBpia 검색 결과만 근거로 사용하도록 구성했습니다."
      },
      {
        question: "발표에서 가장 강조할 메시지는 무엇인가?",
        answer: keyMessage
      }
    ]
  };
}

function buildReportPrompt(keyword, reportTopic, dbpiaResults) {
  return `
아래 학술 검색 결과만 근거로 한국어 보고서를 작성하세요.
원문 전문을 읽은 것처럼 표현하지 말고, 제목/저자/초록/출처에서 확인 가능한 내용만 요약하세요.
검색 키워드는 자료 수집 조건이고, 레포트 본문은 사용자가 원하는 주제에 맞춰 작성하세요.

보고서 형식:
1. 핵심 요약
2. 주제 중심 분석
3. 검색 결과를 근거로 한 의견 또는 입장
4. 그 의견을 뒷받침하는 근거
5. 반대 관점 또는 주의할 한계
6. 최종 제언
7. 참고문헌 후보
8. 발표용 핵심 메시지
9. 5~7장 분량의 슬라이드 구성안
10. 발표자가 말할 수 있는 설명 메모

주의:
- 의견은 반드시 아래 검색 결과에서 확인 가능한 제목, 초록, 출처만 근거로 제시하세요.
- 원문 전문을 읽은 것처럼 단정하지 마세요.
- 근거가 부족한 경우 "조건부 의견" 또는 "추가 검토 필요"라고 명시하세요.

검색 키워드: ${keyword}
사용자가 원하는 레포트 주제: ${reportTopic}

DBpia 결과:
${formatResultsForPrompt(dbpiaResults)}
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
  const opinion = report.opinion
    ? `## 검색 결과를 토대로 한 의견
입장: ${report.opinion.stance || "-"}

${report.opinion.thesis || "-"}

의견 근거
${(report.opinion.rationale || []).map((item) => `- ${item}`).join("\n") || "-"}

반대 관점과 한계
${report.opinion.counterpoint || "-"}

최종 제언
${report.opinion.recommendation || "-"}

근거 범위
${report.opinion.evidenceScope || "-"}`
    : "";

  const insights = (report.insights || [])
    .map((section) => `## ${section.title}\n${section.body}`)
    .join("\n\n");

  const presentationSlides = (report.presentation?.slides || [])
    .map((slide) => {
      const bullets = (slide.bullets || []).map((bullet) => `- ${bullet}`).join("\n");
      return `### ${slide.title}\n${bullets}\n발표자 메모: ${slide.speakerNote || "-"}`;
    })
    .join("\n\n");
  const presentationQna = (report.presentation?.qnaPrep || [])
    .map((item) => `Q. ${item.question}\nA. ${item.answer}`)
    .join("\n\n");

  const references = (report.references || [])
    .map((item, index) => `${index + 1}. [${item.source}] ${item.title}\n${item.link || "링크 없음"}`)
    .join("\n\n");

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

${opinion}

${insights}

## 발표용 구성안
핵심 메시지: ${report.presentation?.keyMessage || "-"}

${presentationSlides || "발표용 구성안 없음"}

## 예상 Q&A
${presentationQna || "예상 Q&A 없음"}

## 검색 결과 링크
${references || "검색 결과 링크 없음"}

${sections}`;
}

function reportToHtml(report) {
  const opinion = report.opinion
    ? `<section>
        <h2>검색 결과를 토대로 한 의견</h2>
        <p><strong>입장:</strong> ${escapeHtml(report.opinion.stance || "-")}</p>
        <p>${escapeHtml(report.opinion.thesis || "-")}</p>
        <h3>의견 근거</h3>
        <ul>${(report.opinion.rationale || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("") || "<li>-</li>"}</ul>
        <h3>반대 관점과 한계</h3>
        <p>${escapeHtml(report.opinion.counterpoint || "-")}</p>
        <h3>최종 제언</h3>
        <p>${escapeHtml(report.opinion.recommendation || "-")}</p>
        <p><strong>근거 범위:</strong> ${escapeHtml(report.opinion.evidenceScope || "-")}</p>
      </section>`
    : "";

  const insights = (report.insights || [])
    .map((section) => {
      return `<section>
        <h2>${escapeHtml(section.title)}</h2>
        <p>${escapeHtml(section.body).replaceAll("\n", "<br>")}</p>
      </section>`;
    })
    .join("");

  const presentationSlides = (report.presentation?.slides || [])
    .map((slide) => {
      const bullets = (slide.bullets || []).map((bullet) => `<li>${escapeHtml(bullet)}</li>`).join("");
      return `<section>
        <h3>${escapeHtml(slide.title)}</h3>
        <ul>${bullets}</ul>
        <p><strong>발표자 메모</strong><br>${escapeHtml(slide.speakerNote || "").replaceAll("\n", "<br>")}</p>
      </section>`;
    })
    .join("");
  const presentationQna = (report.presentation?.qnaPrep || [])
    .map((item) => `<li><strong>Q. ${escapeHtml(item.question)}</strong><br>A. ${escapeHtml(item.answer)}</li>`)
    .join("");

  const references = (report.references || [])
    .map((item, index) => {
      return `<li>
        <strong>${index + 1}. ${escapeHtml(item.title)}</strong><br>
        <span>${escapeHtml([item.source, item.publication, item.year].filter(Boolean).join(" · "))}</span><br>
        ${item.link ? `<a href="${escapeHtml(item.link)}">검색 결과 보기</a>` : "<span>링크 없음</span>"}
      </li>`;
    })
    .join("");

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
    ${opinion}
    ${insights}
    <h2>발표용 구성안</h2>
    <p><strong>핵심 메시지</strong><br>${escapeHtml(report.presentation?.keyMessage || "-")}</p>
    ${presentationSlides}
    <h2>예상 Q&A</h2>
    <ol>${presentationQna || "<li>예상 Q&A 없음</li>"}</ol>
    <h2>검색 결과 링크</h2>
    <ol>${references || "<li>검색 결과 링크 없음</li>"}</ol>
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
