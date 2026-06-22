# 학술 보고서 메일러

유료 사용자 로그인 후 키워드를 입력하면 DBpia와 Google Scholar 호환 API에서 학술 검색 결과를 수집하고, 요약 보고서를 생성한 뒤 이메일로 발송하는 웹사이트입니다.

## 기능

- 유료 접근 코드 기반 프리미엄 로그인
- 키워드와 이메일 입력 폼
- DBpia OpenAPI 검색 결과 수집
- SerpApi Google Scholar 엔진 기반 검색 결과 수집
- Gemini API 기반 보고서 요약
- Gemini API 키가 없을 때 규칙형 요약으로 대체
- SMTP를 통한 HTML/Text 이메일 발송
- API 키가 없을 때도 화면 흐름을 확인할 수 있는 데모 데이터

## 준비

```bash
npm install
copy .env.example .env
```

`.env`에 필요한 값을 채웁니다.

- `PREMIUM_ACCESS_CODE`: 유료 로그인에 사용할 접근 코드입니다. 개발 환경에서 비워두면 `demo-premium`으로 테스트할 수 있습니다.
- `SESSION_SECRET`: 로그인 세션 토큰 서명용 비밀값입니다. 운영 환경에서는 반드시 긴 랜덤 문자열로 설정하세요.
- `DBPIA_API_KEY`: DBpia OpenAPI 키입니다. DBpia OpenAPI 페이지에서 발급합니다.
- `SERPAPI_API_KEY`: Google Scholar 검색용 SerpApi 키입니다. Google Scholar는 공식 API가 없으므로 기본 구현은 SerpApi의 `google_scholar` 엔진을 사용합니다.
- `GEMINI_API_KEY`: 검색 결과를 자연어 보고서로 요약할 때 사용합니다. 비워두면 규칙형 요약을 생성합니다.
- `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`: 이메일 발송용 SMTP 설정입니다. Gmail을 쓰는 경우 일반 비밀번호가 아니라 앱 비밀번호가 필요할 수 있습니다.

API 키나 SMTP 값이 비어 있으면 검색은 데모 데이터로 대체되고 이메일 발송은 건너뜁니다.

## DBpia 유료 접근 방식

이 프로젝트는 DBpia 계정 비밀번호를 받아 자동 로그인하거나 유료 원문을 크롤링하지 않습니다. DBpia 자료는 공식 OpenAPI 키로 조회 가능한 메타데이터와 링크를 사용합니다. 유료 원문 제공이 필요하면 DBpia와 별도 계약/API 권한을 확보한 뒤 서버 API를 그 계약 범위에 맞춰 확장해야 합니다.

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
  "accessCode": "demo-premium"
}
```

응답의 `token`을 `/api/report` 요청의 `Authorization: Bearer <token>` 헤더로 전달합니다.

### `POST /api/report`

요청:

```json
{
  "keyword": "생성형 AI 교육",
  "email": "name@example.com"
}
```

응답에는 생성된 보고서와 이메일 발송 여부가 포함됩니다.
