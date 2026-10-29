# 링크 미리보기 썸네일 · 홈 화면 앱 아이콘

| 용도 | 파일 | 설정 위치 |
|---|---|---|
| 카카오톡·SNS 링크 미리보기 | `assets/og-thumbnail.jpg` (1200×630) | `index.html` `<head>`의 `og:image` · `twitter:image` |
| 아이폰 "홈 화면에 추가" 아이콘 | `assets/apple-touch-icon.png` (180×180) | `<link rel="apple-touch-icon">` |
| 안드로이드 "홈 화면에 추가" 아이콘 | `assets/icon-192.png` · `icon-512.png` · `icon-maskable-512.png` | `manifest.webmanifest` (`<link rel="manifest">`) |
| 브라우저 탭 아이콘 | `favicon.ico` · `assets/favicon-32.png` · `favicon-16.png` (G 로고 확대) | `<link rel="icon">` |

앱 이름은 홈 화면에 **더골프트렌드**로 표시됩니다(`manifest.webmanifest`의 `short_name`, `apple-mobile-web-app-title`).

## 이미 공유한 링크의 옛 미리보기가 그대로 보일 때
카카오톡·페이스북·네이버는 한 번 본 링크의 미리보기를 저장해 둡니다. 배포 후에도 옛 이미지가 보이면 캐시를 새로 받게 하세요.
- 카카오톡: <https://developers.kakao.com/tool/clear/og> 에 `https://thegolftrend.co.kr/` 입력 → **초기화**(카카오 로그인 필요)
- 페이스북: <https://developers.facebook.com/tools/debug/> 에 주소 입력 → **다시 스크랩**
- 네이버: 웹마스터도구(서치어드바이저) → 웹페이지 수집 요청

## 아이콘을 바꿀 때
- 링크 미리보기 이미지: **파일 이름을 새로 지어서**(예: `og-thumbnail-2.jpg`) `index.html`의 `og:image`·`twitter:image`와 구조화 데이터 `image`를 함께 바꾸세요(같은 이름이면 SNS 캐시 때문에 옛 이미지가 남습니다).
- 홈 화면 아이콘: 파일을 교체하고 `index.html`의 `?v=2`를 `?v=3`으로 올리세요. 이미 홈 화면에 추가한 아이콘은 **삭제 후 다시 추가**해야 바뀝니다.
