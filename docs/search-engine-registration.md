# 검색엔진 등록 · 사이트맵 제출 (구글 / 네이버 / Bing)

> 사이트 주소: `https://thegolftrend.co.kr` (www는 자동으로 이 주소로 이동)  ·  사이트맵: `https://thegolftrend.co.kr/sitemap.xml`
> 등록은 **소유자 본인 계정**으로만 가능해서 직접 해 주셔야 합니다. 소유 확인에 필요한 코드·파일은 Claude에게 알려 주시면 사이트에 넣어 드립니다(아래 ⭐ 표시).
> ⚠️ 상품 정적 페이지(`/golf/…`)와 사이트맵 PR을 **먼저 병합**한 뒤 사이트맵을 제출하세요. 병합 전에는 사이트맵에 홈 1개뿐입니다.

## 1. 구글 서치콘솔 (Google Search Console)
1. <https://search.google.com/search-console> 접속 → 구글 계정으로 로그인
2. 왼쪽 위 속성 선택 → **속성 추가**
3. 두 가지 중 하나를 고르세요.
   - **도메인** (권장): `thegolftrend.co.kr` 입력 → 안내되는 **TXT 레코드** 값을 복사 → 가비아 DNS에 추가 (아래 DNS 방법)
   - **URL 접두어**: `https://thegolftrend.co.kr/` 입력 → 확인 방법 **HTML 태그** 선택 → `<meta name="google-site-verification" content="…">` 한 줄 복사 → ⭐ Claude에게 전달
4. DNS 방법(도메인 속성): 가비아 → **My가비아 > 서비스 관리 > 도메인 > DNS 관리(DNS 설정)** → 레코드 추가: 타입 **TXT**, 호스트 **@**, 값 = 구글이 준 값(`google-site-verification=…`), TTL 기본값 → 저장 → 서치콘솔에서 **확인** (반영에 몇 분~몇 시간)
5. 소유권이 확인되면 왼쪽 메뉴 **Sitemaps(사이트맵)** → "새 사이트맵 추가"에 `sitemap.xml` 입력 → **제출** → 상태가 "성공"이면 완료
6. 왼쪽 위 검색창(URL 검사)에 `https://thegolftrend.co.kr/golf/` 입력 → **색인 생성 요청** (대표 상품 페이지 2~3개도 같은 방법)
7. 며칠 뒤 **페이지(색인 생성)** 에서 등록된 페이지 수가 늘어나는지, **개선사항 > 제품 스니펫**에 오류가 없는지 확인

## 2. 네이버 서치어드바이저
1. <https://searchadvisor.naver.com> 접속 → 네이버 계정으로 로그인 → **웹마스터 도구**
2. **사이트 등록**에 `https://thegolftrend.co.kr` 입력 → 등록
3. 소유 확인(둘 중 하나)
   - **HTML 파일 업로드**: 안내되는 `naverxxxxxxxx.html` 파일을 내려받아 ⭐ Claude에게 전달(저장소 맨 위에 넣어 드립니다)
   - **HTML 태그**: `<meta name="naver-site-verification" content="…">` 한 줄을 ⭐ Claude에게 전달
4. 병합·배포 후 **소유확인** 버튼 클릭
5. **요청 > 사이트맵 제출**: `https://thegolftrend.co.kr/sitemap.xml` 입력 → 확인
6. **요청 > 웹페이지 수집**: `https://thegolftrend.co.kr/golf/` 입력 → 수집 요청 (대표 상품 페이지 몇 개도)
7. **검증 > robots.txt**에서 수집이 허용되어 있는지 확인(현재 전체 허용)
8. www 주소(`https://www.thegolftrend.co.kr`)는 자동으로 위 주소로 이동하므로 따로 등록하지 않아도 됩니다.

## 3. Bing 웹마스터 도구 (Bing Webmaster Tools)
Bing은 Microsoft Copilot과 ChatGPT 검색이 참고하는 색인이므로 **AI 노출에 중요**합니다.
1. <https://www.bing.com/webmasters> 접속 → Microsoft·구글·페이스북 계정으로 로그인
2. **가장 쉬운 방법**: 구글 서치콘솔 등록을 마친 뒤 **Google Search Console에서 가져오기(Import)** → 구글 계정으로 허용하면 사이트와 사이트맵이 한 번에 등록됩니다.
3. 직접 등록할 때: **사이트 추가**에 `https://thegolftrend.co.kr` 입력 → 소유 확인 방법 중 하나 선택
   - **XML 파일**: `BingSiteAuth.xml` 내려받아 ⭐ Claude에게 전달
   - **메타 태그**: `<meta name="msvalidate.01" content="…">` 한 줄을 ⭐ Claude에게 전달
   - **CNAME(DNS)**: 가비아 DNS에 안내된 CNAME 레코드 추가
4. 확인 후 왼쪽 **사이트맵(Sitemaps)** → **사이트맵 제출** → `https://thegolftrend.co.kr/sitemap.xml`
5. **URL 제출**로 `https://thegolftrend.co.kr/golf/` 등 대표 주소를 제출
6. (2단계 작업 예정) **IndexNow** 키는 Bing 웹마스터 도구에서 발급할 수 있습니다.

## 등록 후 점검표
- [ ] 세 곳 모두 소유권 확인 완료
- [ ] 세 곳 모두 `sitemap.xml` 제출, 상태 "성공"
- [ ] 구글·Bing에서 `/golf/` 색인 요청
- [ ] 1~2주 뒤: 서치콘솔 색인 페이지 수 ≈ 사이트맵 페이지 수(현재 약 38개)
- [ ] 한 달 뒤: ChatGPT·Perplexity·Gemini·네이버에 "일본 골프여행 패키지" 같은 질문을 직접 입력해 보고 인용 여부 기록

> 검색엔진이 페이지를 색인하고 AI 답변에 반영하기까지는 며칠~몇 주가 걸리며, 노출 순위나 인용 여부는 보장할 수 없습니다.
