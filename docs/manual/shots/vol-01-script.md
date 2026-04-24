# Vol.01 촬영 대본 · 한줄로란? + 첫 화면

> **목적:** Vol.01 HTML에 들어갈 실제 스크린샷 캡처 리스트.
> **실행자:** Claude (Playwright MCP) — Harold님 테스트 계정 `hoyun` 로그인 후 순회 촬영.
> **저장 경로:** `docs/manual/captures/vol-01/*.png`
> **파일명 규약:** `cap-{번호}-{slug}.png` (예: `cap-01-login.png`)

---

## 🛠 촬영 환경 (표준)

| 항목 | 값 |
|------|------|
| 브라우저 | Chromium (Playwright 기본) |
| 뷰포트 | 1440 × 900 (데스크톱) |
| DPR | 2× (레티나 품질) |
| 배율 | 100% |
| 테마 | Light mode 기본 |
| 쿠키/캐시 | 깨끗한 상태 (로그인 1회만) |
| 날짜 표시 | 캡처 시점의 실제 날짜 (2026-04-23 기준) |
| 데이터 상태 | 실데이터 또는 샘플 (Harold님 판단) |

**모바일 캡처 (선택):** 390 × 844 (iPhone 14 Pro) — 반응형 확인용.

---

## 📸 캡처 목록 (총 5컷)

### cap-01 · 로그인 페이지

| 항목 | 값 |
|------|------|
| **파일명** | `cap-01-login.png` |
| **URL** | `https://app.hanjul.ai/login` |
| **로그인 상태** | ❌ 미로그인 (쿠키 클리어 상태) |
| **상호작용** | 페이지 로딩 후 1초 대기 (애니메이션 완료) |
| **강조 영역** | 로고 + 로그인 카드 전체 |
| **주석 핀** | 없음 |
| **캡션** | `Fig 01-A · 한줄로 로그인 화면` |
| **매뉴얼 배치** | § 04 "첫 화면 투어" 도입부 |

### cap-02 · 대시보드 랜딩 (로그인 직후)

| 항목 | 값 |
|------|------|
| **파일명** | `cap-02-dashboard-landing.png` |
| **URL** | `https://app.hanjul.ai/` |
| **로그인 상태** | ✅ `hoyun` 계정 로그인 |
| **상호작용** | 로그인 성공 후 대시보드 자동 리다이렉트 → 2초 대기 |
| **강조 영역** | 헤더 + 환영 메시지 + 첫 섹션 카드 (스크롤 없이 보이는 첫 화면만) |
| **주석 핀** | ① 로고 ② 헤더 메뉴 ③ 사용자 프로필/요금제 ④ DB 현황 카드 |
| **캡션** | `Fig 01-B · 로그인 직후 보이는 첫 화면 — 4개의 영역` |
| **매뉴얼 배치** | § 04 "첫 화면 투어" 메인 스크린샷 |

### cap-03 · 대시보드 전체 스크롤 (Full page)

| 항목 | 값 |
|------|------|
| **파일명** | `cap-03-dashboard-full.png` |
| **URL** | `https://app.hanjul.ai/` |
| **로그인 상태** | ✅ `hoyun` |
| **상호작용** | `fullPage: true` 전체 스크롤 캡처 |
| **강조 영역** | 페이지 전체 (헤더 → DB 카드 → 요금제 카드 → 최근 발송 → 퀵 액션) |
| **주석 핀** | 없음 (전체 오버뷰용) |
| **캡션** | `Fig 01-C · 대시보드 전체 구조` |
| **매뉴얼 배치** | § 04 오른쪽 세로 스크롤 컬럼 (긴 스크린샷을 작게 표시) |

### cap-04 · 헤더 메뉴 상세

| 항목 | 값 |
|------|------|
| **파일명** | `cap-04-header-menu.png` |
| **URL** | `https://app.hanjul.ai/` |
| **로그인 상태** | ✅ `hoyun` |
| **상호작용** | 헤더 영역만 크롭 (상단 80px 영역) |
| **강조 영역** | 헤더 메뉴 전체 (AI 분석 / 자동발송 / 직접발송 / 결과 / 고객DB / 설정) |
| **주석 핀** | ① AI 분석 ② 자동발송 ③ 직접발송 ④ 결과 ⑤ 고객 DB ⑥ 설정 |
| **캡션** | `Fig 01-D · 헤더 메뉴 6개 — 가장 많이 쓰는 기능부터` |
| **매뉴얼 배치** | § 05 "헤더 메뉴 가이드" |

### cap-05 · DB 현황 카드 클로즈업

| 항목 | 값 |
|------|------|
| **파일명** | `cap-05-db-cards.png` |
| **URL** | `https://app.hanjul.ai/` (스크롤: DB 현황 카드 영역까지) |
| **로그인 상태** | ✅ `hoyun` |
| **상호작용** | DB 현황 카드 섹션만 스크롤하여 중앙 정렬 후 크롭 |
| **강조 영역** | 고객 수 · 등급별 · 성별 · 델타 뱃지 등 주요 카드 6~8개 |
| **주석 핀** | ① 전체 고객 수 ② 델타 뱃지 (D+N) ③ 카드 클릭 → 상세 모달 |
| **캡션** | `Fig 01-E · DB 현황 카드 — 클릭하면 6개월 추이 상세 모달` |
| **매뉴얼 배치** | § 04 말미 (다음 챕터 Vol.02 예고) |

---

## 🤖 Playwright 촬영 스크립트 (의사코드)

```
// Step 1. 로그인 전 캡처
await preview_start({ url: 'https://app.hanjul.ai/login' })
await sleep(1000)
await preview_screenshot({ path: 'captures/vol-01/cap-01-login.png', fullPage: false })

// Step 2. 로그인
await preview_fill({ selector: 'input[name="loginId"]', value: 'hoyun' })
await preview_fill({ selector: 'input[name="password"]', value: '<세션 입력>' })
await preview_click({ selector: 'button[type="submit"]' })
await sleep(2000)  // 리다이렉트 대기

// Step 3. 대시보드 랜딩
await preview_screenshot({ path: 'captures/vol-01/cap-02-dashboard-landing.png' })

// Step 4. 전체 스크롤
await preview_screenshot({ path: 'captures/vol-01/cap-03-dashboard-full.png', fullPage: true })

// Step 5. 헤더 크롭
await preview_screenshot({ path: 'captures/vol-01/cap-04-header-menu.png', clip: { x: 0, y: 0, width: 1440, height: 80 } })

// Step 6. DB 현황 카드 영역
await preview_eval({ script: 'document.querySelector("[data-section=\\"db-cards\\"]").scrollIntoView({ behavior: \"instant\", block: \"center\" })' })
await sleep(500)
await preview_screenshot({ path: 'captures/vol-01/cap-05-db-cards.png', clip: { ... } })
```

**주의:**
- 비밀번호는 **세션에서 Harold님이 알려주신 값을 인메모리로만** 사용. 파일/로그에 기록 금지.
- 촬영 후 브라우저 세션 닫기 (`preview_stop`).
- 캡처 완료 후 Harold님께 "5컷 완료" 보고 → 이상 없으면 Vol.01 콘텐츠 팩 작성 단계로.

---

## 📝 콘텐츠 팩 프리뷰 (Vol.01)

> 실제 콘텐츠 팩은 촬영 완료 후 `docs/manual/chapters/vol-01-content.md` 로 별도 작성.
> 여기는 **어떤 톤으로 갈지** 미리 감 잡으시라고 일부만.

### § 04 "첫 화면 — 대시보드 투어" 샘플

```
# 04. 첫 화면 — 4개의 영역

로그인 직후 당신이 보게 될 것은, 크게 네 가지입니다.

① **상단 헤더** — 주요 기능 6개로 이동하는 관문입니다.
② **환영 영역** — 오늘 날짜, 요금제 상태, 남은 체험 기간.
③ **DB 현황 카드** — 고객 수, 등급, 성별, 생일 — 한눈에.
④ **최근 발송** — 바로 전 캠페인의 성과를 가장 먼저.

[Fig 01-B — 대시보드 첫 화면]

이 네 가지는 화면 어디에 있든 기억해두시면 좋습니다.
모든 작업의 출발점이 여기이고, 모든 결과의 도착지도 여기니까요.
```

---

## ✅ 체크리스트 (촬영 전)

- [ ] Harold님께 비밀번호 재확인 (세션 내 인메모리)
- [ ] `preview_start` 가능한 환경 확인
- [ ] 테스트 계정 `hoyun`에 샘플 데이터 존재 여부 확인 (빈 DB면 "§ 04 투어" 의미 반감)
- [ ] 실데이터인 경우 개인정보 마스킹 필요 여부 Harold님 확인
- [ ] 촬영 후 captures/vol-01/ 폴더에 5개 PNG 존재 확인

---

## ❓ Harold님 확인 필요

1. **샘플 데이터 상태** — `hoyun` 계정에 DB 현황 카드가 의미 있게 찰 만큼 고객 데이터 있나요? 비어있으면 빈 화면이 나와서 매뉴얼용으로는 허전합니다.
2. **개인정보 마스킹** — 실데이터가 노출될 경우 이름/번호를 마스킹해야 하는지, 아니면 샘플 데이터만 있는 별도 계정을 쓸지?
3. **촬영 시점** — 지금 바로 할지, 아니면 Harold님이 샘플 데이터 세팅 후 일정 잡을지?

**위 3가지 답해주시면 바로 촬영 착수하겠습니다.**
