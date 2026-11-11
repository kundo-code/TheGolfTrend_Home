# 검색엔진·AI 검색용 상품 페이지 (자동 생성)

## 왜 만들었나
홈페이지의 상품은 관리자가 입력해 Supabase에 저장되고, 방문자의 브라우저에서 JS가 읽어 화면을 그립니다.
그런데 AI 검색 크롤러(ChatGPT·Perplexity·Claude 등)와 일부 검색엔진은 JS를 실행하지 않아, 처음 받는 HTML에는 상품이 하나도 없었습니다(상품명 "구마모토"를 홈페이지 원본 소스에서 찾을 수 없음).
그래서 상품마다 **처음부터 내용이 들어 있는 정적 페이지**를 자동으로 만들어 공개합니다.

## 무엇이 만들어지나 (`golf/` 폴더, 직접 고치지 마세요)
| 주소 | 내용 |
|---|---|
| `/golf/` | 국내·해외 상품 전체 목록 |
| `/golf/overseas/` · `/golf/domestic/` | 해외 / 국내 상품 목록 |
| `/golf/<국가·권역>/` (예: `/golf/japan/`) | 국가·권역별 상품 목록 |
| `/golf/<국가·권역>/<상품코드>/` | 상품 1개 — 한눈에 보기, 요금(요일별·공휴일), 골프장·숙소 정보, 포함·불포함·참고, 예약·취소 안내, 사진, 상담 버튼 |
| `sitemap.xml` | 위 모든 페이지 + 홈 (자동 갱신) |
| `llms.txt` | AI가 사이트를 빨리 파악하도록 돕는 요약 — 회사·상담 정보와 국가별 상품 목록(링크·일정·가격). 등록된 값만 쓰며 자동 갱신 |

- **상품코드**는 상품 고유번호(uid) 기반이라 상품명을 바꿔도 주소가 바뀌지 않습니다. (예: `p-mvm8ojp62o4pit`)
- 각 페이지에는 title·description·canonical·OG 이미지와 **Product / AggregateOffer / BreadcrumbList** 구조화 데이터(JSON-LD)가 들어 있고, 구조화 데이터의 내용은 같은 페이지에 보이는 내용과 같습니다.
- **자주 묻는 질문**(상품 페이지 아래쪽)과 **FAQPage** 구조화 데이터: 등록된 값으로 답할 수 있는 질문만 만듭니다 — 요금, 2인 출발 가능 여부(출발 가능 인원·최소 인원), 일정·구성, 출발 시기, 항공, 이동 시간, 포함·불포함, 상담 방법. 값이 없으면 그 질문은 만들지 않고, 화면에 보이는 문장이 구조화 데이터와 똑같습니다. 등록값은 "항목: 값"으로 그대로 옮기며 이모지만 걷어 냅니다. 새 질문·답을 만들어 내지 않습니다.
- 홈페이지 푸터(Support)와 "여행지" 섹션에 `/golf/` 링크가 있습니다. 기존 `?p=` 딥링크는 그대로 동작합니다.

## 어떤 상품이 공개되나 (홈페이지와 같은 규칙)
- **홈페이지에 지금 보이는 상품만** 만들어집니다(숨김 상품·판매 시기가 지나 자동으로 숨겨진 상품은 제외). 그 상품이 다시 보이면 다음 갱신 때 페이지도 다시 생깁니다.
- **가격**: 홈페이지에 입력된 값만 씁니다. 최저가는 페이지에 보이는 금액(대표가·요금 항목·요일별 요금) 중 가장 낮은 값입니다. "별도 문의"로 설정한 상품은 문구 그대로 "별도문의"로 표시하고 가격 구조화 데이터는 넣지 않습니다.
- **비어 있는 항목은 줄 자체를 만들지 않습니다**(값을 만들어 내지 않음).
- "등록 정보 기준일"은 관리자가 마지막으로 저장한 날짜입니다.

## 자동 실행 켜기 (한 번만)
Claude의 GitHub 연결은 워크플로 파일을 올릴 권한이 없어서, 아래 순서로 직접 만들어 주세요(2분).
1. GitHub 저장소 `kundo-code/TheGolfTrend_Home` → **Add file ▾ → Create new file** (이 PR을 병합한 뒤 `main` 브랜치에서)
2. 파일 이름 칸에 `.github/workflows/build-seo-pages.yml` 입력 (`/`를 치면 폴더가 만들어집니다)
3. 저장소의 `docs/workflows/build-seo-pages.yml` 내용을 전부 복사해 붙여 넣기
4. **Commit changes…** → `main`에 바로 커밋
5. **Actions** 탭 → 왼쪽 "상품 정적 페이지 생성" → **Run workflow**로 한 번 실행해 초록색 체크가 뜨는지 확인
   - 처음 실행이 권한 오류(`Permission denied` / `403`)로 실패하면: 저장소 **Settings → Actions → General → Workflow permissions**에서 **Read and write permissions**를 선택하고 저장한 뒤 다시 실행하세요.
이 설정을 하지 않으면 페이지는 이 PR을 병합한 시점의 상품 정보로 고정되고(자동으로 갱신되지 않음), 직접 갱신하려면 위 "내 컴퓨터/세션에서 직접 만들어 보기"를 실행해야 합니다.

## 언제 갱신되나
- **매일 새벽 4시(한국 시간)** 자동 실행 + 수동 실행. 상품 정보가 바뀐 날만 커밋됩니다(바뀐 게 없으면 아무 일도 없음).
- 지금 바로 반영하고 싶을 때: GitHub 저장소 → **Actions** → "상품 정적 페이지 생성" → **Run workflow**. (1~3분 뒤 사이트에 반영)
- 관리자 패널에서 상품을 고친 뒤 최대 하루 안에 정적 페이지에 반영됩니다. 가격·시기를 바꾼 직후 검색엔진에 빨리 알리려면 위 수동 실행을 하세요.

## 구조
- `scripts/build-seo-pages.js` — 생성기. 홈페이지(index.html)를 헤드리스 브라우저로 열어 홈페이지의 함수(`getProducts`·`isProductVisible`·`aiMergedInfo` 등)로 "지금 보이는 상품"을 그대로 뽑아 HTML을 만듭니다. 그래서 관리자 입력값·기본 상품·노출 기간 규칙이 홈페이지와 항상 같습니다.
- 자동 실행 설정 파일 — `docs/workflows/build-seo-pages.yml`(견본). **GitHub 저장소의 `.github/workflows/build-seo-pages.yml` 위치에 한 번만 직접 만들어 주세요**(아래 "자동 실행 켜기"). 매일/수동 실행하고 결과(`golf/`, `sitemap.xml`)를 `main`에 커밋합니다.
- `scripts/indexnow.js` — 바뀐 페이지를 IndexNow로 알리는 스크립트(키 파일이 있을 때만 동작).
- 안전장치: 상품이 갑자기 절반 넘게 줄어들면(데이터를 일부만 받은 경우) 기존 페이지를 지우지 않고 중단합니다.

## 내 컴퓨터/세션에서 직접 만들어 보기
```bash
cd scripts && npm install && npx playwright install chromium && cd ..
NODE_PATH=scripts/node_modules node scripts/build-seo-pages.js
```
(저장해 둔 상태 파일로 시험: `SEO_SITE_STATE_FILE=파일.json node scripts/build-seo-pages.js`)

## 확인하는 방법
- 브라우저 주소창에 `view-source:https://thegolftrend.co.kr/golf/japan/` 를 열어 상품명이 보이면 크롤러도 읽을 수 있습니다.
- 구글 서치콘솔 "URL 검사"에 상품 페이지 주소를 넣어 "색인 생성 가능"인지, 구조화 데이터(제품)가 인식되는지 봅니다.
- 구조화 데이터 검사: <https://search.google.com/test/rich-results>

## 수집 경로(2단계)
- **robots.txt**: OAI-SearchBot·GPTBot·ChatGPT-User(OpenAI), PerplexityBot·Perplexity-User, ClaudeBot·Claude-SearchBot·Claude-User(Anthropic), Googlebot, Bingbot을 이름으로 명시해 허용합니다. 기존 "전체 허용" 정책은 그대로입니다. 특정 크롤러를 막고 싶으면 해당 이름의 `Allow: /`를 `Disallow: /`로 바꾸면 됩니다.
- **llms.txt**: 생성기가 `golf/`와 함께 자동으로 다시 만듭니다. 손으로 고치지 마세요(다음 실행 때 덮어씁니다).
- **IndexNow**: 상품이 바뀐 날, 정적 페이지를 올린 직후 `scripts/indexnow.js`가 "내용이 진짜 바뀐 페이지"만 Bing 등에 알립니다("등록 정보 기준일"만 바뀐 페이지는 제외). 키 파일이 없으면 아무것도 하지 않습니다.

### IndexNow 켜는 방법 (한 번만)
1. <https://www.bing.com/webmasters> → 사이트 `thegolftrend.co.kr` 선택 → 왼쪽 **IndexNow** → **키 생성**(또는 "API 키 가져오기"). 키는 영문·숫자·하이픈 8~128자입니다.
2. 그 키 문자열을 Claude에게 알려 주세요. 저장소 맨 위에 `<키>.txt`(파일 안에도 같은 키 한 줄)를 만들어 드립니다. 키는 비밀번호가 아니라 누구나 볼 수 있는 공개 파일입니다.
3. 파일이 사이트에 올라가면 `https://thegolftrend.co.kr/<키>.txt`가 열리는지 확인합니다.
4. 워크플로 파일(`.github/workflows/build-seo-pages.yml`)을 `docs/workflows/build-seo-pages.yml` 내용으로 **한 번 더 교체**해야 "IndexNow 알림" 단계와 `llms.txt` 커밋이 자동으로 동작합니다(위 "자동 실행 켜기"와 같은 방법으로, 기존 파일을 열어 내용을 바꾼 뒤 커밋).
5. 시험: `node scripts/indexnow.js --dry-run --base <이전커밋> --head <최근커밋>` — 알릴 주소만 보여 주고 전송하지 않습니다.

## 다음 단계
관리자 상품 고급편집에 입력 항목(추천 대상·장단점·우천/취소 요약 등)을 더하는 안과, AI 유입 집계(4단계)는 아직 포함되지 않았습니다.
