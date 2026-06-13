# DM 이미지 업로드 견고화 설계서 (C) — 2026-06-13

> 모바일 DM 재설계 7개 서브 중 **C**. 연계: A(섹션 editor).

## 배경 (검색 실측)

Harold: "이미지 업로드조차 제대로 안 돼." 실측 원인 3가지.
1. `ImageUploader`(FormControls)가 **4개 editor(Header/Hero/Video/TextCard)에만** 달려 있고, 상품·갤러리·슬라이드 등 **이미지가 핵심인 신규 섹션엔 editor 자체가 없어**(A) 이미지를 못 올린다.
2. `/api/dm/upload-image`(multer memoryStorage, **2MB**, 5장, JPG/PNG/WebP)는 동작하나 — 2MB 제한이 모바일 사진(보통 3~8MB)에 빡빡해 실패 잦음.
3. `dm-viewer`가 이미지를 **base64 인라인**(`inlineImage`)으로 렌더 → 이미지 여러 장이면 HTML 용량 폭발(SMS 링크 로딩 지연).

## 목표

모든 이미지 섹션에서 업로드 가능 + 대용량 사진 자동 처리 + 뷰어 용량 최적화.

## 1. 업로더 전면 적용 (A 연계)

- `ImageUploader`를 A의 16 editor 중 이미지 섹션 전부에 연결: product_carousel(상품별)·gallery·slideshow·tab_cards(image)·instant_coupon·map(선택).
- **`MultiImageUploader`** 신규: 갤러리/슬라이드 다중 선택 + 순서 변경 + 개별 삭제.

## 2. 대용량 자동 처리 (클라이언트 리사이즈)

- 업로드 전 브라우저 canvas로 자동 리사이즈/압축(예: 최대 1080px, JPEG 0.85) → 2MB 이하로 변환 후 전송. 원본이 커도 실패 없이 업로드.
- 서버 한도: 2MB → **5MB**로 상향(리사이즈 후 여유) + 형식에 WebP 유지.
- 진행률 표시 + 실패 시 재시도 버튼 + 드래그앤드롭.

## 3. 뷰어 용량 최적화 (base64 → URL)

- `dm-viewer`의 base64 인라인을 **URL 참조**로 전환: 이미 디스크 저장(`DM_IMAGE_DIR/companyId`) + 공개 서빙(`/api/dm/v/images/:companyId/:filename`)이 있으므로 `<img src="/api/dm/v/images/...">`로 렌더.
- 이점: HTML 경량(SMS 링크 즉시 로딩) + 브라우저 캐시. (base64는 외부 차단 환경 대비 fallback 옵션으로만 유지.)
- 이미지 lazy-loading(`loading="lazy"`) 추가.

## 4. 업로드 응답 처리

- `upload-image` 응답 `{ images: [{ url, filename }] }` 유지(ImageUploader가 `images[0].url` 사용).
- 다중 업로드 시 배열 반환 → MultiImageUploader가 순서대로 매핑.
- 삭제 endpoint(기존 `/images/:companyId/:filename` DELETE) 연계 — 섹션에서 이미지 제거 시 디스크 정리(선택).

## 검증

- backend tsc 0 / frontend tsc 0.
- 한글 파일명 케이스(`toAsciiSafeFilename` 패턴 재사용) — 외부 라이브러리 한글 회귀 방지.
- 실측: 모바일 사진(5MB+) 업로드 → 리사이즈 → 저장 → 뷰어 URL 렌더 1건.
- 자가 grep: 박-단어·모델명 0.

## 배포

`tp-push` → backend는 **ts-node라 `pm2 restart all`만** + frontend `build:safe`. DM_IMAGE_DIR 디스크 용량 모니터(uploads/dm-images).
