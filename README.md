# 학술 보고서 메일러

DBpia에서 소속 기관/학교 인증을 완료한 뒤 앱으로 돌아와 검색 키워드와 원하는 레포트 주제를 입력하면, DBpia OpenAPI 검색 결과를 근거로 주제 맞춤형 요약 보고서를 생성해 이메일로 발송하는 웹사이트입니다.

## 기능

- DBpia 기관인증 페이지/안내 이동 및 인증 완료 확인 흐름
- 검색 키워드, 원하는 레포트 주제, 이메일 입력 폼
- DBpia OpenAPI 검색 결과 수집
- Gemini API 기반 보고서 요약
- Gemini API 키가 없을 때 규칙형 요약으로 대체
- 검색 결과를 근거로 한 의견, 반대 관점, 최종 제언 생성
- 발표용 핵심 메시지, 슬라이드 구성안, 발표자 메모, 예상 Q&A 생성
- 생성 결과를 Markdown 또는 JSON 파일로 다운로드
- SMTP를 통한 HTML/Text 이메일 발송
- API 키가 없을 때도 화면 흐름을 확인할 수 있는 데모 데이터

## 준비

```bash
npm install
copy .env.example .env
```

`.env`에 필요한 값을 채웁니다.

- `PREMIUM_ACCESS_CODE`: 선택값입니다. DBpia 기관인증 완료 확인 대신 별도 접근 코드 방식도 유지할 때 사용합니다.
- `SESSION_SECRET`: 로그인 세션 토큰 서명용 비밀값입니다. 운영 환경에서는 반드시 긴 랜덤 문자열로 설정하세요.
- `DBPIA_API_KEY`: DBpia OpenAPI 키입니다. DBpia OpenAPI 페이지에서 발급합니다.
- `GEMINI_API_KEY`: 검색 결과를 자연어 보고서로 요약할 때 사용합니다. 비워두면 규칙형 요약을 생성합니다.
- `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`: 이메일 발송용 SMTP 설정입니다. Gmail을 쓰는 경우 일반 비밀번호가 아니라 앱 비밀번호가 필요할 수 있습니다.

API 키나 SMTP 값이 비어 있으면 검색은 데모 데이터로 대체되고 이메일 발송은 건너뜁니다.

## DBpia 유료 접근 방식

이 프로젝트는 사용자를 DBpia 사이트와 기관인증 안내로 이동시켜 소속 기관/학교 인증을 직접 완료하게 합니다. 기관 내부 PC/Wi-Fi에서는 DBpia 접속만으로 자동 인증될 수 있고, 기관 외부에서는 DBpia 상단의 소속 기관/학교 인증 또는 소속 도서관 홈페이지를 통해 인증해야 합니다.

앱은 DBpia 또는 기관 계정 비밀번호를 받거나 저장하지 않고, 브라우저의 DBpia 세션 쿠키에도 접근하지 않습니다.

DBpia 자료는 공식 OpenAPI 키로 조회 가능한 메타데이터와 링크를 사용합니다. 유료 원문 제공이 필요하면 DBpia와 별도 계약/API 권한을 확보한 뒤 서버 API를 그 계약 범위에 맞춰 확장해야 합니다.

## 실행

```bash
npm run dev
```

브라우저에서 `http://localhost:3000`을 엽니다.

## API

### `POST /api/login`

요청:

```json
{
  "email": "name@example.com",
  "dbpiaLoginConfirmed": true
}
```

응답의 `token`을 `/api/report` 요청의 `Authorization: Bearer <token>` 헤더로 전달합니다.

### `POST /api/report`

요청:

```json
{
  "keyword": "생성형 AI 교육",
  "reportTopic": "초등 교육에서 생성형 AI 활용 가능성",
  "email": "name@example.com"
}
```

응답에는 생성된 보고서와 이메일 발송 여부가 포함됩니다.
