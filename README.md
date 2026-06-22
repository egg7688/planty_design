# 시간 제어 앱

핸드폰에서 집중 시간과 휴식 시간을 정해 사용할 수 있는 간단한 모바일 PWA입니다.

## 기능

- 집중 시간과 휴식 시간 설정
- 시작, 일시정지, 초기화
- 집중 완료 후 자동 휴식 시작
- 하루 인터넷 사용 가능 시간 설정
- 인터넷 사용 시작/중지와 남은 시간 추적
- Gemini 2.5 Flash 기반 청소년 유해 콘텐츠 검사
- 키워드 기반 학술 보고서 생성 및 이메일 발송
- 월별 캘린더에서 날짜별 집중 시간 확인
- 오늘 완료 기록 저장
- 알림과 진동으로 완료 안내
- 홈 화면에 추가해서 앱처럼 실행

## 실행 방법

이 폴더에서 로컬 서버를 실행한 뒤 브라우저로 접속합니다.

```bash
python -m http.server 8080
```

그 다음 핸드폰과 PC가 같은 Wi-Fi에 연결되어 있다면 `http://PC의-IP주소:8080`으로 접속하세요.

휴대폰에서 앱처럼 설치하려면 브라우저 메뉴에서 `홈 화면에 추가`를 선택하면 됩니다.

## Vercel 환경 변수

청소년 유해 콘텐츠 검사는 Vercel 서버리스 함수에서 Gemini API를 호출합니다. Vercel 프로젝트의 Environment Variables에 아래 값을 추가하세요.

```text
GEMINI_API_KEY=발급받은_Gemini_API_Key
```

브라우저에는 API 키가 전달되지 않고, `/api/moderate` 함수에서만 사용됩니다.

학술 보고서 생성과 이메일 발송을 사용하려면 아래 값도 추가하세요.

```text
DBPIA_API_URL=DBpia_검색_API_URL
DBPIA_API_KEY=DBpia_API_Key
SERPAPI_API_KEY=Google_Scholar_검색용_SerpAPI_Key
RESEND_API_KEY=Resend_API_Key
REPORT_FROM_EMAIL=verified@example.com
```

`DBPIA_API_KEY`는 사용하는 DBpia API 방식에 따라 선택 사항일 수 있습니다. 구글 학술검색은 공식 직접 API가 없어 `SERPAPI_API_KEY` 또는 호환되는 Google Scholar 검색 API 키를 서버에서 사용합니다.

## 참고

일반 앱은 보안 정책 때문에 핸드폰의 시스템 시간이나 전체 인터넷 연결을 직접 변경하거나 차단할 수 없습니다. 이 앱은 시스템 설정을 바꾸는 대신 사용자의 집중/휴식 루틴과 하루 인터넷 사용 가능 시간을 추적하고, 앱 안에 입력한 콘텐츠를 검사하는 방식입니다.
