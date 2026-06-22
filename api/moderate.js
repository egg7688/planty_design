const MODEL = "gemini-2.5-flash";
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

module.exports = async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    response.status(405).json({ error: "POST 요청만 지원합니다." });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    response.status(500).json({ error: "Vercel 환경 변수 GEMINI_API_KEY가 설정되지 않았습니다." });
    return;
  }

  const text = typeof request.body?.text === "string" ? request.body.text.trim() : "";

  if (!text) {
    response.status(400).json({ error: "검사할 내용을 입력하세요." });
    return;
  }

  if (text.length > 4000) {
    response.status(400).json({ error: "검사할 내용은 4000자 이하로 입력하세요." });
    return;
  }

  try {
    const geminiResponse = await fetch(`${GEMINI_ENDPOINT}?key=${apiKey}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        generationConfig: {
          temperature: 0,
          responseMimeType: "application/json",
        },
        contents: [
          {
            role: "user",
            parts: [
              {
                text: buildModerationPrompt(text),
              },
            ],
          },
        ],
      }),
    });
    const payload = await geminiResponse.json();

    if (!geminiResponse.ok) {
      response.status(502).json({
        error: payload.error?.message ?? "Gemini API 호출에 실패했습니다.",
      });
      return;
    }

    response.status(200).json(parseModerationResult(payload));
  } catch (error) {
    response.status(500).json({ error: error.message ?? "콘텐츠 검사 중 오류가 발생했습니다." });
  }
};

function buildModerationPrompt(text) {
  return `
청소년 보호용 콘텐츠 필터입니다.
입력된 URL, 검색어, 제목, 문장이 청소년에게 유해한지 판단하세요.

차단해야 하는 콘텐츠:
- 성인/음란/성착취/노골적 성적 콘텐츠
- 폭력, 자해, 극단적 위험 행위 조장
- 불법 약물, 도박, 범죄 방법 안내
- 혐오, 괴롭힘, 착취, 청소년에게 부적절한 선정적 표현

허용할 수 있는 콘텐츠:
- 교육, 건강, 뉴스, 안전 안내처럼 유해 행위를 조장하지 않는 설명
- 모호하지만 청소년에게 직접 유해하지 않은 일반 정보

반드시 아래 JSON 형식만 반환하세요.
{
  "blocked": true 또는 false,
  "category": "adult|violence|self_harm|drugs|gambling|crime|hate|safe|unknown",
  "reason": "한국어로 짧은 이유"
}

검사 대상:
${text}
`.trim();
}

function parseModerationResult(payload) {
  const rawText = payload.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
  const parsed = JSON.parse(rawText);
  const blocked = Boolean(parsed.blocked);
  const category = typeof parsed.category === "string" ? parsed.category : "unknown";
  const reason =
    typeof parsed.reason === "string" && parsed.reason.trim()
      ? parsed.reason.trim()
      : blocked
        ? "청소년에게 부적절할 수 있는 내용입니다."
        : "청소년에게 직접 유해한 내용으로 판단되지 않았습니다.";

  return { blocked, category, reason, model: MODEL };
}
