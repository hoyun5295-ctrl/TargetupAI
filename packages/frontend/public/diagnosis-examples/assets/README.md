# 이미지 슬롯 배치 안내

24개 목업 HTML은 모두 같은 폴더에 있고, 이미지는 이 폴더의 `assets/` 아래를 상대경로로 참조합니다.
폰트 1개 + 이미지 파일들을 아래 경로에 넣으면 완성됩니다. 외부 요청은 0입니다.

## 1) 폰트 (필수 · 1개)

    assets/fonts/PretendardVariable.woff2

## 2) 이미지 슬롯 목록

권장 비율대로 렌더해서 파일명 그대로 `assets/`에 넣으면 됩니다.
이미지가 없어도 레이아웃은 깨지지 않고 회색(#eee) 면으로 보입니다.

| 파일명 | 비율 | 쓰이는 곳 |
|---|---|---|
| fashion-email-hero.png | 4:3 | 이메일 히어로 |
| fashion-dm-hero.png | 9:16 | DM 풀블리드 히어로 (상단 60%에 인물/제품) |
| fashion-inapp.png | 1:1 | 인앱 배너 썸네일 |
| fashion-p1 ~ p5.png | 1:1 | 신상 3종 · 재입고 2종 |
| beauty-email-hero.png | 4:3 | 이메일 히어로 |
| beauty-dm-hero.png | 9:16 | DM 히어로 |
| beauty-inapp.png | 1:1 | 인앱 전면 카드 |
| fnb-email-hero.png | 4:3 | 이메일 히어로 |
| fnb-dm-hero.png | 9:16 | DM 히어로 |
| fnb-inapp.png | 1:1 | 인앱 카드 |
| fnb-p1, p2.png | 1:1 | 신메뉴 2종 |
| ecommerce-email-hero.png | 4:3 | 이메일 히어로 |
| ecommerce-dm-hero.png | 16:9 | DM 상단 밴드 |
| ecommerce-inapp.png | 1:1 | 인앱 배너 썸네일 |
| ecommerce-p1 ~ p6.png | 1:1 | 장바구니 3 · 추천 3 |
| medical-email-hero.png | 4:3 | 건강정보 이미지 |
| medical-dm-hero.png | 16:9 | DM 상단 밴드 |
| medical-inapp.png | 1:1 | 인앱 카드 |
| education-email-hero.png | 4:3 | 이메일 히어로 |
| education-dm-hero.png | 16:9 | DM 상단 밴드 |
| education-inapp.png | 1:1 | 인앱 전면 카드 |
| travel-email-hero.png | 4:3 | 이메일 히어로 (하단에 카피 오버레이) |
| travel-dm-hero.png | 9:16 | DM 히어로 |
| travel-inapp.png | 1:1 | 인앱 전면 카드 |
| travel-p1, p2.png | 4:3 | 상품 2종 |
| fitness-email-hero.png | 4:3 | 이메일 히어로 (하단에 카피 오버레이) |
| fitness-dm-hero.png | 9:16 | DM 히어로 |
| fitness-inapp.png | 1:1 | 인앱 카드 |
| fitness-p1.png | 1:1 | PT 체험 블록 |

## 3) 카피가 겹치는 슬롯

아래 3개는 이미지 위에 흰색 카피가 얹힙니다. 하단 40%는 어둡거나 단순한 컷이 좋습니다.
(HTML에 이미 어두운 그라데이션 스크림이 깔려 있습니다.)

- travel-email-hero.png
- fitness-email-hero.png
- fashion-dm-hero.png / beauty-dm-hero.png / fnb-dm-hero.png / travel-dm-hero.png / fitness-dm-hero.png
