# 라이브 배포 가이드 — GitHub Pages 커스텀 도메인

| 구분 | 주소 | 역할 |
|---|---|---|
| **새 주소(대표)** | `https://thegolftrend.co.kr` | 실제 사이트가 열리는 주소 (가비아에서 구매) |
| `https://www.thegolftrend.co.kr` | | 자동으로 대표 주소로 이동 |
| **옛 주소** | `https://the-golftrend.com` | 접속하면 새 주소로 자동 이동 |
| 기존 임시 주소 | `https://kundo-code.github.io/TheGolfTrend_Home/` | 커스텀 도메인 연결 후 자동으로 새 주소로 이동 |

GitHub 계정 `kundo-code` · 저장소 `TheGolfTrend_Home` · 배포 브랜치 `main`

> ⚠️ **순서가 중요합니다.** `main`에 `CNAME` 파일이 들어가면 기존 임시 주소가 새 도메인으로 넘어갑니다.
> 새 도메인의 DNS가 아직 연결되지 않았을 때 합치면 **사이트가 일시적으로 열리지 않습니다.**
> 그래서 **1단계(DNS) → 2단계(확인) → 3단계(코드 병합)** 순서로 진행하세요.

---

## 0. 코드에서 이미 정리한 것 (PR에 포함)

| 파일 | 변경 |
|---|---|
| `CNAME` | `thegolftrend.co.kr` (GitHub Pages가 읽는 대표 도메인 파일) |
| `index.html`, `THE GOLF TREND.html` | canonical · og:url · og:image · twitter:image · 구조화 데이터(JSON-LD) 주소를 새 도메인으로 |
| `robots.txt`, `sitemap.xml` | 사이트맵 주소·URL을 새 도메인으로 |
| `docs/redirect-site/` | **옛 도메인용 이동 페이지** 파일 (5단계에서 사용) |
| `docs/channel-collection-setup.md`, `docs/SEO_GEO_AEO_PHASE3.md`, `README.md` | 주소 안내 갱신 |

> 사이트는 단일 HTML(`index.html`)이고 모든 파일을 상대 경로(`assets/...`)로 불러오므로, 주소가 `/TheGolfTrend_Home/` 하위 경로에서 도메인 루트(`/`)로 바뀌어도 동작에 문제가 없습니다.
> 데이터(상품·카드 태그·블로그·유튜브 등록 정보)는 **Supabase에 저장**되어 있어 도메인이 바뀌어도 그대로 보입니다.

---

## 1. 가비아 DNS 설정 (새 도메인 `thegolftrend.co.kr`)

1. [가비아](https://www.gabia.com) 로그인 → **My가비아** → **서비스 관리** → **도메인** → `thegolftrend.co.kr` 오른쪽 **[관리]**
2. **DNS 정보**에서 네임서버가 **가비아 기본 네임서버**인지 확인합니다. (다른 곳으로 바꿔 둔 적이 없다면 기본값입니다.)
3. **DNS 설정**(또는 *DNS 관리툴*) → **레코드 추가**로 아래를 입력합니다.

   | 타입 | 호스트 | 값/위치 | TTL |
   |---|---|---|---|
   | A | `@` | `185.199.108.153` | 600 |
   | A | `@` | `185.199.109.153` | 600 |
   | A | `@` | `185.199.110.153` | 600 |
   | A | `@` | `185.199.111.153` | 600 |
   | AAAA | `@` | `2606:50c0:8000::153` | 600 |
   | AAAA | `@` | `2606:50c0:8001::153` | 600 |
   | AAAA | `@` | `2606:50c0:8002::153` | 600 |
   | AAAA | `@` | `2606:50c0:8003::153` | 600 |
   | CNAME | `www` | `kundo-code.github.io` | 600 |

   - `@`는 `thegolftrend.co.kr` 자체(루트)를 뜻합니다. 가비아 화면에서 호스트 칸을 비워 두는 방식이면 비워 두세요.
   - CNAME 값 끝에 점(`.`)이 필요한 화면이면 `kundo-code.github.io.` 로 입력합니다.
   - 이미 `@` 또는 `www`에 **다른 A·CNAME 레코드(가비아 기본 주차 페이지 등)가 있으면 삭제**하세요. 같은 호스트에 겹치면 연결이 불안정해집니다.
   - **MX·TXT 레코드(메일 등)는 지우지 마세요.**
4. (권장) **도메인 소유 인증** — 다른 사람이 이 도메인을 GitHub Pages에 가로채지 못하게 막습니다.
   - GitHub 우측 상단 프로필 → **Settings** → **Pages** → **Add a domain** → `thegolftrend.co.kr` 입력
   - 화면에 나온 TXT 레코드(호스트 `_github-pages-challenge-kundo-code`, 값은 화면에 표시된 코드)를 가비아에 **TXT**로 추가 → GitHub에서 **Verify**

## 2. DNS 반영 확인 (5분~수 시간, 보통 30분 이내)

```bash
# Windows는 nslookup, Mac/Linux는 dig
nslookup thegolftrend.co.kr
nslookup www.thegolftrend.co.kr
```
- `thegolftrend.co.kr` → 위 A 주소(185.199.x.153)가 나오고, `www` → `kundo-code.github.io`가 나오면 완료입니다.
- 웹에서는 [dnschecker.org](https://dnschecker.org)에서 `thegolftrend.co.kr` **A** 를 조회해 여러 지역에서 초록 체크가 뜨는지 봅니다.

## 3. GitHub — 코드 병합과 Pages 설정

1. 이 작업 PR을 **`main`에 병합**합니다. (`CNAME` 파일이 `main` 루트에 생깁니다.)
2. 저장소 `kundo-code/TheGolfTrend_Home` → **Settings** → **Pages**
   - **Build and deployment → Source**: *Deploy from a branch* · Branch: **main** · Folder: **/(root)**
   - **Custom domain**에 `thegolftrend.co.kr`이 보이는지 확인합니다. (비어 있으면 직접 입력 후 **Save**)
3. 몇 분 뒤 **"DNS check successful"** 이 뜹니다. (실패하면 2단계 DNS를 다시 확인하세요.)
4. **Enforce HTTPS** 를 체크합니다. (인증서 발급에 몇 분~최대 24시간. 체크 칸이 잠겨 있으면 잠시 뒤 새로고침)

## 4. Supabase 설정

프로젝트 `zjanojlayndtgmzohpyb` (<https://supabase.com/dashboard>)

1. **Authentication → URL Configuration**
   - **Site URL**: `https://thegolftrend.co.kr`
   - **Redirect URLs**에 추가:
     - `https://thegolftrend.co.kr/**`
     - `https://www.thegolftrend.co.kr/**`
     - `https://kundo-code.github.io/**` (전환 기간 동안만. 안정화 후 삭제 가능)
   - **Save**
   - 이 설정은 **관리자 비밀번호 재설정 메일**의 링크 주소에 쓰입니다.
2. 그 밖에 바꿀 것은 없습니다.
   - 사이트가 쓰는 Supabase 주소와 공개(anon) 키는 그대로이고, 도메인별 CORS 허용 목록은 따로 없습니다.
   - 상담 신청(`kundo_leads`)·방문 기록·사이트 설정(`kundo_site_state`) 테이블은 그대로 사용합니다.
3. **채널 수집 서버(Cloudflare Worker)를 쓰고 있다면**: Cloudflare → Workers → `golftrend-collector` → **Settings → Variables**에서 `ALLOWED_ORIGINS` 값을 아래로 바꾸고 **Deploy**
   ```
   https://thegolftrend.co.kr,https://www.thegolftrend.co.kr,https://kundo-code.github.io
   ```
   (바꾸지 않으면 새 도메인의 관리자 화면에서 블로그·유튜브 수집이 거부됩니다.)

## 5. 옛 도메인 `the-golftrend.com` → 새 주소로 자동 이동

GitHub Pages는 **저장소 하나에 도메인 하나**만 연결할 수 있어서, 옛 도메인은 "이동 안내 전용 저장소"를 하나 더 만들어 연결합니다. (무료, HTTPS 자동)

**A. 저장소 만들기**
1. GitHub → **New repository** → 이름 `the-golftrend-redirect` · **Public** · README 없이 생성
2. **Add file → Upload files**로 이 저장소의 `docs/redirect-site/` 안 파일 **3개**(`index.html`, `404.html`, `CNAME`)를 올리고 **Commit**
3. 그 저장소 **Settings → Pages** → Source: *Deploy from a branch* · **main / (root)** · Custom domain `the-golftrend.com` (CNAME 파일을 올렸으면 자동 입력됨)

**B. 옛 도메인 DNS** (`the-golftrend.com`을 관리하는 곳 — 구입처 DNS 관리 화면)

| 타입 | 호스트 | 값 |
|---|---|---|
| A | `@` | `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153` (4개) |
| AAAA | `@` | `2606:50c0:8000::153` ~ `2606:50c0:8003::153` (4개, 선택) |
| CNAME | `www` | `kundo-code.github.io` |

- 옛 도메인에 기존 A/CNAME(예전 사이트·주차 페이지)이 있으면 **삭제 후** 위 값으로 바꿉니다. MX·TXT(메일)는 유지하세요.
- DNS 확인 후 **Enforce HTTPS** 체크.

**C. 동작**: `the-golftrend.com`·`www.the-golftrend.com` 어느 주소로 들어와도(경로·`?검색어`·`#admin` 포함) `https://thegolftrend.co.kr/`로 즉시 이동합니다.

> 이 방식은 서버 301이 아니라 자동 이동 페이지입니다. 새 도메인으로 완전히 옮기기까지 충분히 쓸 수 있고, 검색 노출 이전을 더 확실히 하려면 옛 도메인 DNS를 Cloudflare(무료)로 옮겨 **Redirect Rule(301)** 로 처리하는 방법도 있습니다. 필요하면 말씀해 주세요.

## 6. 배포 확인 체크리스트

```bash
curl -I https://thegolftrend.co.kr            # 200
curl -I https://www.thegolftrend.co.kr        # 301 → https://thegolftrend.co.kr/
curl -I http://thegolftrend.co.kr             # 301 → https://
curl -I https://kundo-code.github.io/TheGolfTrend_Home/   # 301 → https://thegolftrend.co.kr/
```
- [ ] `https://thegolftrend.co.kr` 접속, 주소창에 자물쇠(HTTPS) 표시
- [ ] 상품 카드·이미지·블로그/유튜브 영역이 정상 표시 (Supabase 데이터 로드)
- [ ] **시크릿 창**에서도 같은 내용이 보임 (내 브라우저 저장값이 아니라 서버 데이터로 보이는지 확인)
- [ ] `the-golftrend.com`, `www.the-golftrend.com` 접속 시 새 주소로 이동
- [ ] 상담 신청 1건 테스트 → 관리자 패널 상담예약에 접수되는지
- [ ] AI 골프여행 추천 동작
- [ ] 관리자 로그인: `https://thegolftrend.co.kr/?admin`
- [ ] 모바일(카카오톡 인앱 브라우저 포함)에서 접속

> **관리자 로그인과 브라우저 저장값은 도메인마다 따로** 저장됩니다. 새 도메인에서 **관리자는 다시 로그인**해야 하고, 예전 주소에서 저장하지 않은 수정은 보이지 않습니다. 전환 전에 예전 주소에서 마지막 수정을 모두 저장(자동 저장)해 두세요.

## 7. 도메인 변경 후 해야 할 것

- **Google Search Console**: 속성 추가(`thegolftrend.co.kr`, DNS TXT 인증) → 사이트맵 `https://thegolftrend.co.kr/sitemap.xml` 제출
- **네이버 서치어드바이저**: 사이트 등록(HTML 태그 인증 코드를 알려 주시면 `index.html`에 넣어 드립니다) → 사이트맵·robots.txt 제출
- 카카오톡 채널 관리자센터·네이버 블로그·인스타그램·리틀리 등 **홈페이지 주소를 새 주소로 변경**
- 약관·개인정보 처리방침(gamma 페이지)에 옛 주소가 적혀 있으면 수정
- 카카오톡/페이스북 **공유 미리보기 캐시 갱신** — 카카오 [공유 디버거](https://developers.kakao.com/tool/debugger/sharing), 페이스북 공유 디버거에서 새 주소로 다시 스크랩

## 문제 해결

| 증상 | 확인 |
|---|---|
| GitHub Pages에서 "DNS check unsuccessful" | 가비아 A/AAAA/CNAME 값 오타, 겹치는 기존 레코드, 반영 대기(최대 24시간) |
| `Enforce HTTPS` 체크가 잠겨 있음 | DNS 확인 성공 후 인증서 발급 대기. 도메인을 지웠다가 다시 입력하면 재시도 |
| 새 도메인에서 "404 There isn't a GitHub Pages site here" | Pages 소스가 `main`/`(root)`인지, `CNAME` 파일이 `main` 루트에 있는지 |
| 관리자 비밀번호 재설정 메일 링크가 이전 주소로 열림 | Supabase **Site URL**이 새 도메인인지 |
| 관리자에서 블로그·유튜브 수집 실패 | Cloudflare Worker `ALLOWED_ORIGINS`에 새 도메인 추가 |
| 되돌리기 | 저장소 `CNAME` 파일 삭제(되돌리기 커밋) + Settings → Pages → Custom domain 비우기 → 임시 주소로 복귀 |
