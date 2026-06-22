# 학술 보고서 메일러

키워드를 입력하면 DBpia와 Google Scholar 호환 API에서 학술 검색 결과를 수집하고, 간단한 보고서를 생성한 뒤 이메일로 발송하는 웹사이트입니다.

## 기능

- 키워드와 이메일 입력 폼
- DBpia OpenAPI 검색 결과 수집
- SerpApi Google Scholar 엔진 기반 검색 결과 수집
- 수집 결과 요약, 연관어, 출처별 목록 생성
- SMTP를 통한 HTML/Text 이메일 발송
- API 키가 없을 때도 화면 흐름을 확인할 수 있는 데모 데이터

## 준비

```bash
npm install
copy .env.example .env
```

`.env`에 필요한 값을 채웁니다.

- `DBPIA_API_KEY`: DBpia OpenAPI 키입니다. DBpia OpenAPI 페이지에서 발급합니다.
- `SERPAPI_API_KEY`: Google Scholar 검색용 SerpApi 키입니다. Google Scholar는 공식 API가 없으므로 기본 구현은 SerpApi의 `google_scholar` 엔진을 사용합니다.
- `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`: 이메일 발송용 SMTP 설정입니다. Gmail을 쓰는 경우 일반 비밀번호가 아니라 앱 비밀번호가 필요할 수 있습니다.

API 키나 SMTP 값이 비어 있으면 검색은 데모 데이터로 대체되고 이메일 발송은 건너뜁니다.

## 실행

```bash
npm run dev
```

브라우저에서 `http://localhost:3000`을 엽니다.

## API

### `POST /api/report`

요청:

```json
{
  "keyword": "생성형 AI 교육",
  "email": "name@example.com"
}
```

응답에는 생성된 보고서와 이메일 발송 여부가 포함됩니다.
