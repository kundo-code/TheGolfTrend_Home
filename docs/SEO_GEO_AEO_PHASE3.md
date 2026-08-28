# THE GOLF TREND — 기술 SEO / GEO·AEO 강화 (Phase 3)

기준 파일: `index.html` / `THE GOLF TREND.html` (완전히 동일한 사본, 항상 함께 수정·배포)
원칙: 디자인·레이아웃·기능·관리자 패널·상품 데이터 구조는 그대로 두고, `<head>`·구조화 데이터·시맨틱 마크업·이미지·접근성·내부 링크·성능만 보강했습니다. 기존 id/class/JS 함수명은 전부 유지했습니다.

---

## 1. 현재 홈페이지의 기술 SEO 문제점 분석 (수정 전 상태)

| 영역 | 문제 |
|---|---|
| `<head>` | canonical, robots meta, theme-color, OG/Twitter 태그, favicon, Supabase/jsDelivr preconnect가 전혀 없었음 |
| 구조화 데이터 | Schema.org JSON-LD가 전혀 없어 검색엔진·AI가 "골프 전문 여행사"라는 엔티티를 알 방법이 없었음 |
| 시맨틱 HTML | `<header>`/`<main>` 랜드마크가 없어 `<body>` 최상위가 전부 `<div>`/`<section>` 나열이었음 |
| 이미지 | 국내 6권역·해외 9개국·상품 이미지가 전부 CSS `background-image`(div)라 `alt` 자체가 존재할 수 없는 구조. 상품 상세 갤러리 `<img>`는 `alt=""`로 비어 있었음 |
| 내부 링크 | 푸터의 국내 권역/해외 국가 목록이 `<a onclick=...>`뿐이고 `href`가 없어 크롤러가 따라갈 수 없는 링크였음 |
| 접근성 | 스타일 다중선택 드롭다운 트리거가 `<div onclick>`이라 키보드로 열 수 없었음. 관리자 패널·법적고지 모달·홈 팝업이 ESC로 닫히지 않았고, 닫혀 있어도 `aria-hidden`이 없어 스크린리더/크롤러가 숨겨진 UI 텍스트까지 읽을 수 있었음 |
| 엔티티 일관성 | ~~푸터 이메일과 예약 폼/`SITE_CONTACT` 이메일이 서로 달랐던 문제~~ → **해결됨**: 푸터의 `kitty2yamyam@gmail.com` 표기를 삭제하고, `edgar.meshugas@gmail.com`(예약 폼·`SITE_CONTACT`와 동일)으로 통일했습니다. 단, 상담 신청 폼의 mailto 수신자 목록(`kitty2yamyam@gmail.com` 포함)은 실제 업무용 수신함일 수 있어 그대로 유지했습니다 — 더 이상 필요 없다면 별도로 요청해주세요. 주소는 README(`가든파이브라이프 7층 7074호`)와 실제 화면(`...7층 리빙관 7074호`)이 여전히 다르니 확인 부탁드립니다 |
| 성능 | 히어로 배경·헤드라인 배너가 IndexedDB/Supabase에서 비동기로 로드된 뒤 JS가 `style.backgroundImage`/`<img src>`를 채우는 구조라, 정적 `<head>` 시점에 우선순위를 줄 수 있는 고정 리소스가 없음 (LCP 관련, 8번 참고) |
| sitemap/robots | 둘 다 없었음 |

---

## 2. 우선순위 S / A / B 등급 분류

**S (즉시 반영, 이번 패치에 포함)**
- head 메타(canonical/robots/OG/Twitter/favicon/preconnect)
- Organization/TravelAgency/WebSite/WebPage/BreadcrumbList JSON-LD
- `<header>`/`<main>` 시맨틱 래핑, 스킵 링크
- 배경이미지 div `role=img aria-label`, 상품 갤러리 `alt`, `loading=lazy`
- 푸터 내부 링크 `href` 보강
- sitemap.xml / robots.txt

**A (이번 패치에 포함, 영향 범위가 조금 더 넓음)**
- 스타일 드롭다운 키보드 접근성(`role=button tabindex aria-expanded`)
- 모달 3종(관리자 패널/법적고지/홈 팝업) ESC 닫기 + `aria-hidden`
- Organization `sameAs` 런타임 동기화(`updateOrganizationSameAs`)
- `buildProductJsonLd()` 준비 함수 (미주입)

**B (구조만 준비, 실제 반영은 데이터/URL이 갖춰진 뒤)**
- 상품별 Product/Offer Schema 실제 주입 → 8번 참고
- FAQPage Schema → 실제로 눈에 보이는 FAQ 섹션이 없어서 **의도적으로 추가하지 않음** (없는 FAQ를 스키마에만 넣는 것은 스팸성 구조화 데이터이자 사용자 요청사항 위반이라 판단)
- 상품 스키마에 골프장명/호텔명/포함·불포함사항 필드 자체가 없음 (11번 GEO/AEO 확장 항목 참고)
- 푸터 컬럼 제목(`<h4>국내 권역</h4>` 등)의 헤딩 레벨 — CSS가 태그 선택자(`.foot-grid h4`) 기준이라 임의 변경 시 스타일이 깨짐. 우선순위 낮은 landmark 내부 헤딩이라 이번엔 보류

---

## 3. 수정해야 할 코드 위치 (실제 반영된 위치)

| 항목 | 위치 |
|---|---|
| head 메타 전체 | `<head>` 상단, `<title>`/`<meta description>` 바로 아래 |
| JSON-LD 정적 블록 | `</style>` 직후, `</head>` 직전 |
| `buildProductJsonLd()` | `SITE_CONTACT` 상수 바로 아래 |
| `updateOrganizationSameAs()` | `renderLinks()` 함수 끝, 그 함수에서 즉시 호출 |
| `<header>`/`<main>` 래핑 | `<body>` 시작 직후(top-bar~`</nav>`), 히어로 섹션 시작(`<main id="main">`)~예약 문의 섹션 끝(`</main>`) |
| 스킵 링크 | `<body>` 여는 태그 바로 다음 줄 |
| `catImgAlt`/`productImgAlt` | `getCatBgStyle()` 함수 바로 아래 |
| 카테고리 타일 aria-label | `renderCategoryGrid()` |
| 상품 카드 aria-label | `productCardHTML()` |
| 상품 상세 이미지 alt | `renderProductDetail()` |
| 패키지 포스터 alt | `renderPkgGroup()`의 `cardHTML` |
| 스타일 드롭다운 접근성 | `#sdTags`/`#sdPanel` 마크업 + `toggleStyleMenu()`/`closeStyleMenu()` |
| ESC 통합 처리 | 기존 `document.addEventListener('keydown', ...)` 핸들러 확장 |
| 관리자 패널 aria-hidden | `<aside id="adminPanel">` 마크업 + `toggleAdmin()` |
| 내비 메뉴 aria-expanded | `<button id="navMenuBtn">` + 새 `toggleNavMenu()` 함수 |
| 푸터 내부 링크 href | `<footer>` 국내 권역/해외 국가 `<ul>` |
| sitemap.xml / robots.txt | 저장소 루트 |
| 브랜드 이미지 자산 | `assets/logo.png`, `assets/og-image.jpg`, `assets/favicon-*.png`, `assets/apple-touch-icon.png`, `assets/icon-512.png`, `favicon.ico` (base64로 내장돼 있던 로고와 일본 골프장 사진을 실제 정적 파일로 추출해 OG 이미지·파비콘으로 사용) |

---

## 4. 완성된 수정 코드

전체 diff는 저장소 커밋 히스토리(`claude/phase-3-ai-sales-platform-4s08ae` 브랜치)에 그대로 남아 있습니다. 파일 전체를 다시 옮겨 적는 대신, 위 3번 표의 위치에 실제 코드가 반영되어 있으니 해당 함수/영역을 직접 열어 확인하시면 됩니다. 모든 변경에는 `[Phase 3 ...]` 접두사가 붙은 주석을 남겨, grep 한 번으로 이번 패치 범위만 모아볼 수 있게 했습니다.

```bash
grep -n "Phase 3" index.html
```

---

## 5. 추가한 Schema JSON-LD

`</head>` 직전에 정적으로 주입된 `@graph`(Organization/TravelAgency, WebSite, WebPage, BreadcrumbList)는 본문 코드에 그대로 있습니다. 요약하면:

- **Organization/TravelAgency**: 이름·대표·사업자번호·주소·전화·이메일·areaServed(10개국)·knowsAbout(7개 서비스) — 전부 푸터에 실제로 노출되는 값과 동일
- **WebSite**: 사이트명, url, publisher
- **WebPage**: 현재 페이지, about(Organization), breadcrumb 연결
- **BreadcrumbList**: 현재는 `Home` 1단계만 (아래 8번 참고)
- **Organization.sameAs**: 정적 블록엔 카카오채널만 고정으로 넣고, `renderLinks()`가 실행될 때마다 `#orgSameAsJsonLd`라는 별도 `<script>`(같은 `@id`)를 만들어 **그 시점에 관리자 패널에서 켜져 있는 SNS/블로그/밴드 링크만** 채워 넣습니다. 즉 화면에 보이는 활성 링크와 구조화 데이터가 항상 일치합니다.
- **Product/Offer**: `buildProductJsonLd(catId, idx, pageUrl)` 함수로만 준비되어 있고 어디에도 자동 주입하지 않습니다 (8번 참고).
- **FAQPage**: 추가하지 않음 (실제 화면에 FAQ 섹션이 없기 때문 — 2번 B등급 참고).

---

## 6. sitemap.xml

**현재 실제 파일**(저장소 루트 `sitemap.xml`, 실제 존재하는 URL 1개만 포함):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://kundo-code.github.io/TheGolfTrend_Home/</loc>
    <lastmod>2026-08-28</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>
```

**향후 확장 예시** (아직 존재하지 않는 URL — 실제 sitemap.xml에는 넣지 않았습니다. 8번처럼 상품별 독립 URL이 생기면 이 형태로 추가하세요):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
  <url><loc>https://kundo-code.github.io/TheGolfTrend_Home/</loc><priority>1.0</priority></url>
  <url><loc>https://kundo-code.github.io/TheGolfTrend_Home/japan/</loc><priority>0.9</priority></url>
  <url><loc>https://kundo-code.github.io/TheGolfTrend_Home/japan/shizuoka/</loc><priority>0.8</priority></url>
  <url><loc>https://kundo-code.github.io/TheGolfTrend_Home/japan/fukuoka/</loc><priority>0.8</priority></url>
  <url><loc>https://kundo-code.github.io/TheGolfTrend_Home/china/</loc><priority>0.8</priority></url>
  <url><loc>https://kundo-code.github.io/TheGolfTrend_Home/malaysia/</loc><priority>0.8</priority></url>
  <url>
    <loc>https://kundo-code.github.io/TheGolfTrend_Home/japan/shizuoka/kawana-hotel-fuji/</loc>
    <priority>0.7</priority>
    <image:image>
      <image:loc>https://kundo-code.github.io/TheGolfTrend_Home/assets/og-image.jpg</image:loc>
      <image:caption>일본 시즈오카 카와나 호텔 후지 코스 골프여행</image:caption>
    </image:image>
  </url>
  <url><loc>https://kundo-code.github.io/TheGolfTrend_Home/golf-courses/</loc><priority>0.6</priority></url>
  <url><loc>https://kundo-code.github.io/TheGolfTrend_Home/packages/</loc><priority>0.6</priority></url>
  <url><loc>https://kundo-code.github.io/TheGolfTrend_Home/guides/</loc><priority>0.5</priority></url>
  <url><loc>https://kundo-code.github.io/TheGolfTrend_Home/compare/</loc><priority>0.5</priority></url>
  <url><loc>https://kundo-code.github.io/TheGolfTrend_Home/faq/</loc><priority>0.5</priority></url>
  <url><loc>https://kundo-code.github.io/TheGolfTrend_Home/reviews/</loc><priority>0.5</priority></url>
  <url><loc>https://kundo-code.github.io/TheGolfTrend_Home/company/</loc><priority>0.4</priority></url>
</urlset>
```

---

## 7. robots.txt

저장소 루트 `robots.txt`(실제 파일 그대로):

```
User-agent: *
Allow: /
# Disallow: /admin        ← 관리자 기능이 별도 경로/서브도메인으로 분리되면 주석 해제
# Disallow: /admin/*

Sitemap: https://kundo-code.github.io/TheGolfTrend_Home/sitemap.xml
```

지금은 관리자 패널이 별도 URL이 아니라 같은 페이지 안의 로그인 게이트라서 막을 경로가 없습니다. `aria-hidden` 처리(2번 A등급)로 닫혀 있을 때 텍스트 노출은 줄였지만, 완전히 분리된 라우트가 생기기 전까지는 robots.txt로 원천 차단할 방법이 없다는 점은 참고해주세요.

---

## 8. 향후 상품별 독립 URL 전환 방법

지금은 상품이 `openProductDetail(catId, idx)`로 여는 모달일 뿐, 고유 URL이 없습니다. 실제 URL(`/japan/shizuoka/kawana-hotel-fuji/` 같은)이 생기면:

1. **라우팅**: 이미 넣어둔 `data-route` 속성(6번 내부 링크 항목 참고)과 `CATEGORIES`/`DEFAULT_PRODUCTS` 데이터를 그대로 활용해 정적 라우트를 생성 (Next.js `generateStaticParams` 또는 별도 정적 페이지 빌드 스크립트).
2. **Product/Offer JSON-LD**: 상세페이지 `<head>`에서 `buildProductJsonLd(catId, idx, pageUrl)`을 호출해 나온 객체를 그대로 `<script type="application/ld+json">`로 주입. `pageUrl`에 실제 확정 URL을 반드시 넣어야 함.
3. **BreadcrumbList**: `#breadcrumb` JSON-LD의 `itemListElement`를 페이지별로 `Home → 국가 → 지역 → 골프장 → 패키지` 순서로 채움 (지금 구조가 그대로 확장 가능하도록 `@id` 기반 `@graph` 패턴으로 만들어 둠).
4. **canonical**: 각 상세페이지의 canonical을 그 페이지 URL로 지정 (지금처럼 루트로 고정하면 안 됨).
5. **sitemap.xml**: 6번의 "향후 확장 예시" 형태로 `<url>` 항목 추가.
6. **상품 데이터 필드 보강**: 지금 상품 스키마엔 골프장명/호텔명/포함·불포함사항이 없어 Product Schema의 완성도가 제한적입니다. `newExtendedFields()`/`ensureExtended()` 근처에 필드를 추가하고 관리자 패널 고급 편집(`openAdvEditor`)에 입력 UI를 붙이는 순서를 권장합니다.

---

## 9. Google Search Console 연결 체크리스트

- [ ] search.google.com/search-console 에서 속성 추가 (URL 접두어: `https://kundo-code.github.io/TheGolfTrend_Home/`)
- [ ] 소유권 확인 — HTML 태그 방식 사용 시 `<head>`에 `<meta name="google-site-verification" content="...">` 한 줄만 추가하면 됨 (이번 패치엔 실제 인증 코드가 없어 넣지 않았습니다 — 발급받으신 코드를 알려주시면 바로 추가해드릴 수 있습니다)
- [ ] 사이트맵 제출: `sitemap.xml` 등록
- [ ] URL 검사 도구로 색인 요청
- [ ] 모바일 사용성 리포트 확인
- [ ] 페이지 환경(Core Web Vitals) 리포트 모니터링 시작

## 10. Naver Search Advisor 연결 체크리스트

- [ ] searchadvisor.naver.com 에서 사이트 등록
- [ ] 소유 확인 (HTML 파일 업로드 또는 메타태그 방식 — 메타태그 방식이면 GSC와 동일하게 `<head>`에 한 줄 추가)
- [ ] 사이트맵 제출: `sitemap.xml`
- [ ] robots.txt 제출/검증
- [ ] 웹마스터도구 → 요청 → 웹페이지 수집 요청 (신규 페이지 수동 수집 요청)
- [ ] "봇 노출 진단" 기능으로 실제 렌더링 확인 (JS 렌더링 특성상 중요)

---

## 11. GEO / AEO 향후 확장 항목

AI 검색(ChatGPT/Gemini/Perplexity)이 "일본 골프여행", "60대 일본 골프여행", "부산 출발 해외골프" 같은 질의에서 THE GOLF TREND를 인용하려면, 지금 구조에 없는 다음 데이터가 상품 단위로 쌓여야 합니다 (요청하신 항목 기준):

**지금 상품 스키마(`ensureExtended`)에 이미 있는 것**: 국가/지역(catId), 상품명, 일정(nights), 골프 라운드 수(rounds), 가격(priceEntries), 항공/공항/출발요일 레이블(labels), 연락처.

**지금 없어서 추가가 필요한 것**: 골프장명(개별 필드로 분리), 추천 연령대, 추천 시즌, 평균 기온, 공항→호텔/호텔→골프장 이동시간, 호텔명·객실 등급, 카트·캐디 포함 여부(현재는 요금 레이블에 텍스트로만 존재), 2인 출발 가능 여부, 싱글룸 추가비, 우천/취소 정책, 장단점, 추천 대상, 마지막 업데이트 날짜, 정보 출처.

**적용 순서 제안**:
1. 관리자 패널 고급 편집(상품 탭)에 위 필드들을 위한 입력 폼 추가 — 지금 구조(`newExtendedFields`, `openAdvEditor`)를 그대로 확장.
2. 상품 상세 모달에 **실제로 눈에 보이는 텍스트**로 노출 (숨김 데이터 금지 원칙 유지).
3. 상품별 독립 URL이 생기면 `buildProductJsonLd()`의 `additionalProperty` 배열에 위 필드들을 추가해 구조화 데이터로도 노출.
4. FAQ 섹션을 실제로 만들면(예: "일본 골프여행 몇 박이 적당한가요?" 등) 그 시점에 FAQPage Schema를 화면 내용과 1:1로 추가.

---

## 참고 — 엔티티 일관성 관련 확인 요청

- **이메일**: 푸터의 `kitty2yamyam@gmail.com` 표기를 삭제하고 `edgar.meshugas@gmail.com`으로 통일했습니다 (요청 반영 완료). 상담 신청 폼의 mailto 수신자 목록에는 여전히 `kitty2yamyam@gmail.com`이 포함되어 있습니다 — 실제 문의를 받는 업무용 주소일 수 있어 별도 요청이 있을 때까지 유지했습니다.
- **주소**: 실제 화면 "...가든파이브라이프 7층 **리빙관** 7074호" vs. README "...7층 7074호"(리빙관 누락) — 여전히 확인 필요합니다.
