# 상품 레이블 등급 체계 (AI 추천 고도화용)

상품 카드 우상단에 붙는 레이블 이미지는 장식이 아니라 **상품의 등급·상태를 나타내는 데이터**다.
관리자 패널 > 상품 > 상품등록 > 고급편집 > 레이블 이미지에서 "카드에 노출"을 켠 레이블이 그 상품에 **적용된** 레이블이다.

## 등급 (grade) — 한 상품에 하나만
| Level | 레이블 | key | 파일 |
|---|---|---|---|
| 5 (최고) | 럭셔리 | `luxury` | `assets/card-labels/label-7.png` |
| 4 | 프리미엄 | `premium` | `label-5.png` |
| 3 | 품격 | `quality` | `label-4.png` |
| 2 | 스탠다드 | `standard` | `label-3.png` |
| 1 (최저) | 실속+ | `value` | `label-2.png` |

등급 레이블 하나를 켜면 다른 등급 레이블은 자동으로 꺼진다.

## 상태 (flag) — 등급과 별개로 함께 적용 가능
| 레이블 | key | 의미 | 파일 |
|---|---|---|---|
| 신상품 | `new` | 새로 등록한 상품 | `label-6.png` |
| 특가 | `special` | 기간한정 또는 긴급하게 판매를 목적으로 하는 상품 | `label-1.png` |

## 코드에서 쓰는 방법 (`index.html`)
- `CARD_LABEL_META` — 레이블 파일 → `{key, type('grade'|'flag'), level, name, desc}`
- `productLabelProfile(p)` — 상품의 적용 레이블 요약:
  `{grade: 0~5, gradeKey, gradeName, isNew, isSpecial, keys: [...]}`
- `computeAiRecommendations()`의 후보(result)마다 `labelProfile`을 담아 둠(아직 점수에는 반영하지 않음).
- 상품 카드 `<article class="product">`에 `data-label-grade`, `data-label-new`, `data-label-special` 속성이 붙는다(통계·분석용).

## 고도화 아이디어
- 예산/스타일 조건에 따라 등급 가중치 (예: "숙박 시설 중시" → Level 4~5 가산, "실속형" → Level 1~2 가산)
- 신상품 노출 가산, 특가는 "특가 선호" 조건 또는 기간 한정 안내와 연계
- 추천 사유에 "Level N 등급" / "신상품" / "특가" 표시
