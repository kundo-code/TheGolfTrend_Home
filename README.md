# 🏌️ THE GOLF TREND
> 국내·해외 골프 투어 전문 여행사 **(주)더골프트렌드** 의 공식 홈페이지 — 서버 없이 단일 HTML로 동작하는 풀 CMS 내장 브랜드 사이트, Supabase 기반 크로스 디바이스 동기화 + **AI 추천 · 리드 관리 영업 플랫폼** (Prototype 3차)

## 🤖 Prototype 3차 — AI 추천 & 영업 플랫폼

기존 "상품 소개 홈페이지"에서 **"AI가 추천하고 고객이 문의하는 영업 플랫폼"**으로 고도화했습니다.

* **AI 골프 여행 추천 (`#aiRecommend`)** — 권역·예산·일정·선호 스타일 4문항에 답하면, 전체 상품 카탈로그를 규칙 기반으로 스코어링해 상위 추천 여행을 카드로 제시. 외부 AI API 없이 클라이언트에서 즉시 동작하며, 관리자가 상품/요금표 문구를 채울수록 매칭 정확도가 함께 좋아집니다.
* **추천 → 문의 연결** — 추천 카드의 "이 상품으로 상담 신청"을 누르면 하단 상담 폼(희망 여행지·선호 스타일·세부요청)이 자동으로 채워진 채 예약 문의 섹션으로 이동합니다.
* **AI 리드 관리 (관리자 패널 `AI 리드` 탭)** — 상담 신청은 기존 이메일 발송과 별개로 Supabase `kundo_leads` 테이블에도 저장됩니다. 관리자 로그인 후 리드 목록 조회, 상태 변경(신규·연락중·성사·보류·취소), CSV 내보내기가 가능하며 AI 추천에서 시작된 문의는 추천 상품명과 함께 표시됩니다.
* **DB 마이그레이션 필요** — `kundo_leads` 테이블과 RLS 정책은 anon key만으로 생성할 수 없어 자동 적용되지 않습니다. Supabase SQL Editor에서 [`docs/sql/2026-08-28_phase3_leads.sql`](./docs/sql/2026-08-28_phase3_leads.sql)을 한 번 실행해주세요. 테이블 적용 전에는 상담 폼(이메일 발송)과 AI 추천 기능은 정상 동작하며, 관리자 패널의 리드 목록만 안내 메시지를 표시합니다.

---

## 📌 목차
1. [주요 기능](#-주요-기능)
2. [기술 스택](#-기술-스택)
3. [시작하기 (설치 및 실행)](#-시작하기-설치-및-실행)
4. [사용 방법](#-사용-방법)
5. [프로젝트 구조](#-프로젝트-구조)
6. [데이터 스토리지 구조](#-데이터-스토리지-구조)
7. [Prototype 2차 로드맵](#-prototype-2차-로드맵)
8. [기여 방법](#-기여-방법)
9. [라이선스](#-라이선스)

---

## ✨ 주요 기능

### 🗺 여행지 & 상품 쇼케이스
* **국내 6개 권역** — 강원·충청·호남·영남·수도권·제주 대표 이미지 + 상품 카드 그리드
* **해외 9개국** — 일본·중국·몽골·베트남·태국·필리핀·말레이시아·인도네시아·괌
* **상품 상세 모달** — 갤러리 슬라이더, 다통화 요금표(10종), 항공·공항·티오프 레이블, 연락처·캘린더
* **홈 진입 팝업** — 상품별 팝업 ON/OFF 토글, 세션당 1회 최대 3개 동시 노출

### 🏢 회사소개 (About)
* **핵심가치 4개** — Authenticity · Customer-Centric · Expertise · Relationships (카드 이미지 업로드 지원)
* **역량 및 강점 6개** — 현장경험·파트너십·원스톱서비스·큐레이션·고객대응·신뢰성 (카드 이미지 업로드 지원)
* **반투명 화이트 패널** — About·포스터·상담 섹션 공통 적용

### 📋 패키지 요금 포스터
* **국내·해외 포스터 슬라이드** — px 기반 정확한 슬라이드, 자동 재생 4초 간격
* **라이트박스 확대 보기** — 클릭 시 전체화면, 키보드 ←→/ESC 지원
* **드래그&드롭 순서 변경** — 관리자 패널에서 HTML5 Drag API 로 노출 순서 변경

### 📡 멀티채널 링크 허브
* **밴드** — 공식·B2C·B2B 채널 분리 (B2C·B2B는 별도 CTA 버튼)
* **블로그** — 네이버(국내·해외)·T-Story
* **SNS** — 유튜브·페이스북·인스타그램·틱톡·리틀리(국내·해외)
* **링크별 토글** — URL 입력 시 자동 활성, 비우면 자동 비활성

### 📝 여행 이야기 (Blog)
* **URL 기반 자동 프리뷰** — 네이버·T-Story URL 입력 시 `allorigins.win` 프록시로 OG 태그(제목·이미지) 자동 수집
* **직접 입력 우선** — 타이틀1(제목)/타이틀2(부제목) 수동 입력 시 OG보다 우선 노출
* **이미지 직접 업로드** — OG 이미지 대신 직접 업로드한 이미지 사용 가능

### ✈️ 티타임 상담 탑승권
* **탑승권 스타일 폼** — 여행지·일정·인원·숙박타입·체류기간·여행스타일(14개 다중선택)
* **이메일 전송** — `edgar.meshugas@gmail.com`, `kitty2yamyam@gmail.com` 동시 수신
* **전화 연결** — 확인 다이얼로그 → `010-9405-6842` tel: 직결
* **스타일 드롭다운** — 그룹별 14개 옵션 다중 선택, 골드 태그로 표시

### 🔧 관리자 패널 (내장 CMS)
* **이미지 탭** — 로고·태그라인·회사소개배너 / 헤드라인배너(이미지·동영상) / 국내6·해외9 권역 이미지 / About 카드이미지 10개 / 블로그카드 / 패키지포스터(최대 50장, 드래그&드롭)
* **상품 탭** — 국내·해외 상품 CRUD + 고급 편집 (기본·요금표·미디어·연락처·캘린더 3탭)
* **브랜드 링크 탭** — 채널별 URL + 활성화 토글
* **법적고지 탭** — 약관 7종 URL 관리 + 링크 확인 버튼

---

## 🛠 기술 스택

### Frontend (Prototype 1차)
![HTML5](https://img.shields.io/badge/HTML5-E34F26?style=flat-square&logo=html5&logoColor=white)
![CSS3](https://img.shields.io/badge/CSS3-1572B6?style=flat-square&logo=css3&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-ES2022-F7DF1E?style=flat-square&logo=javascript&logoColor=black)

### 데이터 저장
![LocalStorage](https://img.shields.io/badge/localStorage-JSON-green?style=flat-square)

### 외부 서비스
![Google Fonts](https://img.shields.io/badge/Google_Fonts-4285F4?style=flat-square&logo=google&logoColor=white)
![allorigins](https://img.shields.io/badge/allorigins.win-CORS_Proxy-lightgrey?style=flat-square)

### 서체
| 용도 | 서체 |
|------|------|
| 디스플레이·제목 | Playfair Display, Fraunces, Noto Serif KR |
| 본문 | Noto Sans KR, Inter |

### Prototype 2차 목표 스택
![Next.js](https://img.shields.io/badge/Next.js_14-000000?style=flat-square&logo=next.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white)
![Supabase](https://img.shields.io/badge/Supabase-3ECF8E?style=flat-square&logo=supabase&logoColor=white)
![Vercel](https://img.shields.io/badge/Vercel-000000?style=flat-square&logo=vercel&logoColor=white)

---

## 🚀 시작하기 (설치 및 실행)

### Prototype 1차 — 요구사항
별도 설치 없이 브라우저만 있으면 됩니다.

* 최신 버전의 Chrome / Safari / Edge

### 실행 방법

**옵션 A — 파일 직접 열기 (가장 간단)**
```
THE GOLF TREND.html 파일을 브라우저로 드래그하거나 더블클릭
```

**옵션 B — 로컬 서버로 실행 (권장)**
```bash
# Node.js가 설치된 경우
npx serve .

# Python이 설치된 경우
python -m http.server 3000
```
이후 브라우저에서 `http://localhost:3000/THE GOLF TREND.html` 접속

### 관리자 패널 접근
페이지 우하단 **🔧** 버튼 클릭 → 관리자 패널 슬라이드 오픈
> ⚠️ Prototype 1차는 인증 없음. Prototype 2차에서 Supabase Auth 추가 예정.

---

## 💡 사용 방법

### 방문자 기준
| 목적 | 방법 |
|------|------|
| 국내 상품 탐색 | 여행지 탭 → `국내` → 권역 클릭 → 상품 카드 클릭 |
| 해외 상품 탐색 | 여행지 탭 → `해외` → 국가 클릭 → 상품 카드 클릭 |
| 요금표 확대 보기 | 패키지 요금 포스터 카드 클릭 → 라이트박스 |
| 상담 신청 | 예약 문의 → 폼 작성 → 📧 상담 신청하기 |
| 전화 상담 | 예약 문의 → 📞 전화하기 → 확인 → 전화 연결 |

### 관리자 기준
| 작업 | 경로 |
|------|------|
| 헤드라인 배너 교체 | 🔧 → 이미지 → 헤드라인 배너 |
| 상품 추가/수정 | 🔧 → 상품 → 카테고리 선택 → 추가 or 고급편집 |
| 포스터 업로드 | 🔧 → 이미지 → 패키지 요금 포스터 |
| 링크 활성화 | 🔧 → 브랜드 링크 → URL 입력 → 토글 ON |
| 약관 URL 수정 | 🔧 → 법적고지 및 이용안내 → URL 수정 |
| 전체 초기화 | 🔧 → 하단 `전체 초기화` 버튼 |

---

## 📁 프로젝트 구조

```
the-golf-trend/
├── THE GOLF TREND.html          # 메인 파일 (HTML + CSS + JS 통합, ~1,450KB)
├── images/                      # 이미지 에셋 (HTML에 base64 내장)
│   ├── logo.png                 # 더골프트렌드 로고 원본
│   ├── foot-logo.png            # 푸터용 리사이즈 로고 (195×80px)
│   ├── headline.png / .jpg      # 헤드라인 배너
│   ├── region-gangwon.jpg       # 국내 권역 이미지 (384×384px) × 6
│   ├── region-jeju.jpg
│   ├── japan.jpg                # 해외 국가 이미지 (512×341px) × 9
│   ├── guam.jpg
│   ├── icon-band.png            # SNS 아이콘 × 8
│   └── icon-youtube.png
└── docs/
    ├── README.md                # 이 파일
    ├── 01_PRD.md                # 제품 요구사항 정의서
    ├── 02_화면정의서.md          # 섹션별 와이어프레임 + 컴포넌트 명세
    ├── 03_개발기획서.md          # 기술 스택, 스키마, 함수 목록
    ├── 04_시스템아키텍처.md      # 아키텍처 다이어그램, DB 스키마 SQL
    ├── 05_Claude_Design_기획.md  # 디자인 토큰 + 컴포넌트 시스템
    └── 06_컨텍스트_핸드오프.md   # Claude Code/Design 2차 작업용 컨텍스트
```

---

## 🗃 데이터 스토리지 구조

Prototype 1차는 `localStorage` 13개 키로 모든 데이터를 관리합니다.

| 키 | 타입 | 용도 |
|----|------|------|
| `kundo_images_v1` | `{[catId]: dataURL}` | 여행지 이미지 오버라이드 |
| `kundo_products_v1` | `{[catId]: Product[]}` | 상품 전체 |
| `kundo_links_v1` | `{[key]: url}` | 채널 URL |
| `kundo_link_active_v1` | `{[key]: false}` | 링크 비활성화 플래그 |
| `kundo_headline_v1` | `{type, url}` | 헤드라인 배너 |
| `kundo_blog_v2` | `BlogEntry[]` | 블로그 카드 목록 |
| `kundo_logo_v1` | `dataURL` | TopBar 로고 |
| `kundo_tagline_v1` | `string` | TopBar 태그라인 |
| `kundo_about_banner_v1` | `{type, url}` | 회사소개 헤드라인 배너 |
| `kundo_legal_v1` | `{[key]: url}` | 약관 7종 URL |
| `kundo_cv_images_v1` | `{[cvId]: dataURL}` | 핵심가치 카드 이미지 |
| `kundo_str_images_v1` | `{[strId]: dataURL}` | 역량강점 카드 이미지 |
| `kundo_pkg_posters_v1` | `{domestic[], overseas[]}` | 패키지 요금 포스터 |

> 전체 스키마 상세 → [`docs/03_개발기획서.md`](./03_개발기획서.md)

---

## 🗺 Prototype 2차 로드맵

| Phase | 기간 | 내용 |
|-------|------|------|
| **1** | 1주차 | Next.js 14 초기화, Supabase 스키마, CI/CD(Vercel) |
| **2** | 2-3주차 | 핵심 컴포넌트(Claude Design), 상품 CRUD API, 상담 폼(Resend) |
| **3** | 4주차 | 관리자 인증(Supabase Auth), 이미지 CDN(Cloudflare Images) |
| **4** | 5주차 | SEO, 성능 최적화, 실데이터 마이그레이션, 배포 |

**목표 지표:**
- LCP < 2.5초 | Lighthouse 모바일 80+ | WCAG AA 접근성

> 상세 계획 → [`docs/03_개발기획서.md`](./03_개발기획서.md)
> 아키텍처 → [`docs/04_시스템아키텍처.md`](./04_시스템아키텍처.md)

---

## 🏢 회사 정보

| 항목 | 내용 |
|------|------|
| **회사명** | (주)더골프트렌드 |
| **대표** | 오선영 |
| **사업자번호** | 707-81-03126 |
| **통신판매업** | 제 2024-서울송파-0795호 |
| **여행업 등록** | 종합여행업 제2023-6호 |
| **주소** | 서울특별시 송파구 충민로 66, 가든파이브라이프 7층 7074호 |
| **대표 전화** | 010-9405-6842 |
| **고객센터** | 707-7500-5981 |
| **이메일** | edgar.meshugas@gmail.com |
| **카카오채널** | [pf.kakao.com/_SSxgFG](http://pf.kakao.com/_SSxgFG) |

---

## 🤝 기여 방법

이 프로젝트에 기여하고 싶으시다면 아래 절차를 따라주세요.

1. 이 프로젝트를 포크(Fork)합니다.
2. 새로운 기능 브랜치를 만듭니다.
   ```bash
   git checkout -b feature/기능명
   ```
3. 변경 사항을 커밋합니다.
   ```bash
   git commit -m 'feat: 기능 설명'
   ```
4. 브랜치에 푸시합니다.
   ```bash
   git push origin feature/기능명
   ```
5. Pull Request를 요청합니다.

### 커밋 메시지 컨벤션
```
feat:     새 기능 추가
fix:      버그 수정
style:    CSS/디자인 변경
refactor: 코드 리팩터링
docs:     문서 수정
chore:    설정 변경
```

---

## 📄 라이선스

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.

Copyright © 2024 (주)더골프트렌드. All rights reserved.

---

<div align="center">

**THE GOLF TREND** · "Curating Golf, Connecting People"

[홈페이지](#) · [카카오채널](http://pf.kakao.com/_SSxgFG) · [네이버 블로그](https://blog.naver.com/thegolftrend)

</div>
