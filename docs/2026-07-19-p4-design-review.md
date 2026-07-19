# P4 이미지 스튜디오 설계 — 적대적 리뷰 결과 (2026-07-19)

리뷰 대상 = docs/2026-07-18-p4-image-studio-design.md (v2, 2026-07-19 세션 수정 누적본). 대조 근거 = 상위 설계서 §4·§5 / CLAUDE.md / status/OPS.md / status/SCHEMA.md cdp_assets 절(실측 13컬럼) / status/lessons/LESSONS_BACKEND.md. **소스 코드는 열지 않았다** — 코드 사실이 필요한 항목은 전부 "착수 전 확정"(§4)에 검증 방법과 함께 두었다. 이 문서는 다음 구현 세션(Opus 4.8) 인계용.

---

## 1. 치명 결함 (구현 전 반드시 해결)

### C-1. "DDL 0" 주장 붕괴 — cdp_assets에 channel_spec·width·height 컬럼이 없다
- 위치: 설계서 §5-2 라이브러리 픽커 게이팅("bytes·channel_spec 기존 컬럼 재사용 — DDL 0"), §5-1-6("신규 DDL 0")
- 결함: SCHEMA.md 실측 13컬럼(id·company_id·created_by·kind·source_asset_id·url·filename·bytes·format·origin·prompt·created_at·updated_at)에 **channel_spec 없음**. width/height도 없음. 상위 설계서 §5-1의 설계안(width/height/channel_spec 포함)과 실제 P3 DDL이 다른데, P4 설계서는 설계안 쪽을 "기존 컬럼"으로 오인.
- 실패 시나리오: 구현자가 `WHERE channel_spec='mms'` 작성 → tsc 통과 → 운영 배포 → PG "column does not exist" → 라이브러리 픽커 500 → 전 채널 에디터의 이미지 선택 마비(공용 컴포넌트). 0528 campaigns 사고와 동일 구조.
- 권장 수정: `ALTER TABLE cdp_assets ADD COLUMN channel_spec varchar(20)` 1건을 P4 DDL로 공식화(information_schema 선검증 + Harold 직접 실행 + 라우트 catch 503 DB_MIGRATION_PENDING 분기 부활 — db_alter_safety_net). width/height 동반 추가는 §3-4 결정 후.
- 심각도: 치명 / 확신도: 높음 (SCHEMA.md 실측 절 직접 대조)

### C-2. 크레딧 차감 CT 계약이 실제 구조와 어긋남 — "기존 CT 재사용"이 성립하지 않을 수 있다
- 위치: 설계서 §5-1-7("기존 크레딧 CT 재사용 — 구현 시 소비처 grep으로 함수 확정")
- 결함: LESSONS_BACKEND "유료 AI 기능 신설 = 크레딧 3점 세트" — AI 크레딧 차감은 `callAIWithFallback`이 creditCost 사전 확인+성공 후 차감까지 **자체 처리**(backend CREDIT_COST_MAP + frontend CONFIRM_CREDIT_COSTS + CreditConfirmModal 세트). 그런데 이미지 스튜디오는 Gemini 직접 호출 = callAIWithFallback을 **타지 않는다**. 별도 축인 `prepaidDeduct`(utils/prepaid.ts)는 발송 선불 지갑이며 **비멱등**(같은 reference 매 호출 차감 — 여정 J1 사고 실증). "AI 크레딧"과 "발송 선불"이 같은 지갑인지도 미확정.
- 실패 시나리오: 구현자가 prepaidDeduct를 재사용 → ①지갑 축이 다르면 요금제 정합 붕괴 ②재시도 경로에서 중복 차감(비멱등) ③frontend 3점 세트(표시=실차감) 누락 → 표시≠차감 결함 재발(2026-07-02 사고 동형).
- 권장 수정: 착수 전 grep으로 ①AI 크레딧 지갑·차감 함수 실명 ②CREDIT_COST_MAP 구조 ③callAIWithFallback 밖 수동 차감 선례(있는지) 확정 → 설계서 §5-1-7을 "함수 실명 + 차감 시점(생성 성공 직후 1회) + reference=생성 요청 UUID + 재시도=새 요청(재차감 방지)"로 재작성. 3점 세트(CREDIT_COST_MAP·CONFIRM_CREDIT_COSTS·모달) 등재를 구현 체크리스트에 명시.
- 심각도: 치명(돈) / 확신도: 높음 (LESSONS 실명 근거, 함수 계약만 미확정)

### C-3. [★정정 2026-07-19 — Harold 지적 + 공식 문서 재정독으로 방향 수정] "4K 격상"은 멀티턴 보존 편집으로 성립한다
> 정정: 업스케일 전용 SKU가 없는 것은 사실이나, **공식 멀티턴 패턴**(Interactions `previous_interaction_id` / generateContent에서는 이전 이미지+thoughtSignature 재전송 + "다른 요소 변경 금지" + image_size 목표 해상도)으로 **같은 구도를 보존한 4K 재출력이 가능**(공식 문서 스페인어 인포그래픽 예시 실증). 아래 원문은 기록용으로 유지 — 반영 결과 = 설계서 v3 §4-3(픽셀 동일은 아니므로 "같은 구도로 4K" 정직 라벨 + 실측 1건 확정 게이트).

### (원문) "4K 격상"이 레이어 합성 구조에서 성립 불가 — 같은 그림의 4K는 만들 수 없다
- 위치: 설계서 §3 사용자 선택지 B("고른 1장 4K로 격상 +2크레딧"), §5-2 결과 버튼 "[4K로(2크레딧)]"
- 결함: Gemini generateContent에는 시드 고정·업스케일 개념이 없다(실측 API 표면 기준). "고른 배경의 4K판" = 같은 프롬프트 재생성 = **다른 배경이 나온다**. 사용자 기대("마음에 든 걸 크게")와 계약 불일치.
- 실패 시나리오: 사용자가 2크레딧으로 후보 고름 → +2크레딧 4K 격상 → 전혀 다른 배경 도착 → "돈 냈는데 고른 게 아니다" 클레임. 품질 우선 결정의 정면 배반 지점.
- 권장 수정: 선택지 B를 "생성 시점 옵션"으로 이동 — 생성 전 [2K 2크레딧 / 4K 4크레딧] 선택(후보 2장 동일 해상도). 결과 단계 격상 버튼은 제거하거나 "비슷한 분위기로 새로 생성(4K)" 정직 라벨로 재정의. §7 Harold 결정 항목으로 승격.
- 심각도: 치명(UX·과금 계약) / 확신도: 높음

### C-4. 프론트 canvas가 최종 산출물의 진실 — 재현성·모바일 한계·서버 검증 부재
- 위치: 설계서 §5-1-4("프론트 canvas 합성이 담당"), §5-2 내보내기 2형(②프론트 canvas 픽셀 렌더)
- 결함: 발송될 소재의 최종 굽기가 클라이언트 canvas. ①4K 배경(3584×4800)은 iOS Safari canvas 한계(~16.7MP) 경계 — 기기별 실패/축소 ②DPR·폰트 로딩 타이밍·색 프로파일로 기기마다 산출물이 다름 ③서버는 산출물을 검증하지 않음(MMS ≤300KB 강제도 클라 신뢰) — 변조·우회 가능.
- 실패 시나리오: iPhone 사용자가 4K 소재 내보내기 → canvas 생성 실패(무음) 또는 축소 저장 → 4크레딧 지불한 4K가 실제로는 저해상 / 조작된 클라가 500KB 이미지를 MMS 자산으로 저장 → 발송 실패 클레임(§4 트랙 분리가 지키려던 바로 그 사고).
- 권장 수정: 최종 굽기를 서버로 이관 — 프론트는 미리보기+좌표/스케일/타이포 데이터만 전송, 서버 PIL(rembg와 동반 설치)이 합성·굽기·≤300KB 검증까지 수행. 서버가 산출물 bytes를 실측해 cdp_assets 등재(클라 신고값 불신).
- 심각도: 치명(산출물 신뢰) / 확신도: 높음

---

## 2. 완성도 보강 (우선순위 순)

### H-1. 배경-제품 광원·원근 불일치("붙인 티") 방지 스펙 부재 — 높음 / 확신도 높음
- §5-1-0 buildMarketingPrompt에 배경 광원·앵글 제약이 없다. 실측 배경(좌측 창광)에 정면 누끼+수직 타원 그림자를 얹으면 그림자 방향 모순. 로컬 목업은 플랫 그라데이션이라 이 문제가 미검증.
- 권장: 배경 프롬프트에 "soft diffuse frontal lighting, eye-level, flat horizontal surface, no strong directional shadows" 고정 + 구현 중 실배경 1회 시각 실측을 §6-1에 추가.

### H-2. 연동 몰 상품 이미지 인제스트 경로 스펙 0 — 높음 / 확신도 높음
- MallProductPickerModal이 주는 것은 외부 CDN URL(카페24 등). 누끼 입력이 되려면 서버가 fetch해야 함 — SSRF 가드(내부망 IP 차단)·타임아웃·크기 상한·포맷 검증·대형 원본 다운스케일(rembg CPU 추론 시간 직결) 스펙이 설계에 없다.
- 권장: §5-1에 "POST /ingest-product {url} → 검증 fetch → 다운스케일(최장변 ~2000px) → temp 등재" 명세 추가. 픽커 반환 계약(URL인지 로컬 사본인지)은 착수 전 grep.

### H-3. rembg 운용 형태 미결 — subprocess vs 상주 서비스 — 높음 / 확신도 높음
- 매 요청 subprocess = 모델(179MB) 재로드 수 초+메모리 스파이크. 상주 서비스 = ~1.5-2GB 상시 점유 + systemd 관리 + **127.0.0.1 바인딩 의무**(0.0.0.0 금지 — 2026-02-28 랜섬웨어 교훈). 서버 python3 버전·모델 파일 경로 고정·서비스 다운 시 503 폴백도 미명세.
- 권장: 상주 HTTP 서비스(127.0.0.1 전용·systemd·모델 프리로드·단일 워커 큐)로 확정 명세. 서버 python3 -V·메모리 여유 실측을 착수 절차에 추가.

### H-4. in-flight 맵 직렬화 = 단일 프로세스 전제 — 높음 / 확신도 중간
- §5-1-1 회사당 직렬화가 in-memory 맵. PM2 cluster 모드면 프로세스별 맵이라 무효. 현 pm2 실행 모드(fork/cluster) 미확인.
- 권장: 착수 전 `pm2 describe`로 모드 확정. cluster면 Redis 락(Redis 상주 — OPS)으로 대체 명세.

### H-5. Gemini 에러 원문 노출 = 모델명 UI 노출 경로 — 높음 / 확신도 높음
- 세이프티 거부·429·400 등의 error.message에 "gemini-3-pro-image" 등 모델 문자열 포함 가능. 그대로 응답에 실으면 no_model_name_ui_exposure 위반.
- 권장: §5-3에 "Gemini 에러는 서버에서 코드 매핑(SAFETY_BLOCKED/RATE_LIMITED/GEN_FAILED) 후 추상 메시지만 반환, 원문은 PM2 로그" 명시.

### H-6. 유저 보조 프롬프트가 가드레일을 뚫는 경로 — 높음 / 확신도 높음
- "원하는 느낌 한 줄"에 "30% 할인 크게 넣어줘" 입력 시: buildMarketingPrompt의 금지 지시와 유저 요청이 충돌 — 모델이 어느 쪽을 따를지 확률적. 지시 우선순위·유저 텍스트 필터 스펙 없음.
- 권장: ①유저 텍스트는 "장면 묘사 힌트"로만 삽입(구조상 뒤가 아닌 앞, 금지 지시가 마지막) ②혜택 패턴(%·원·할인·쿠폰) 감지 시 사전 안내("문구는 텍스트 편집에서") ③산출물에 텍스트가 새겨진 경우 재생성 유도 안내.

### H-7. MMS 트랙 생성 파라미터 실종 + 문서 자기모순 — 높음 / 확신도 높음
- 2트랙 분리 때 프리셋 표에서 MMS 행이 사라져 트랙 B의 aspect_ratio/image_size 미기재(1K? 3:4?). §4 하단 "프리셋 5종 = 전 채널 커버(위 표)"는 표가 4종이라 모순. §4 제목·첫 줄은 여전히 "Interactions API·interactions.create" — 실측 확정(generateContent)과 모순. §7-1도 옛 수치("생성 1크레딧=2장, 4K=2크레딧") 잔존 — §3 확정(2크레딧·+2)과 불일치. §0-2 끝의 "다음 미검증 = 누끼 품질"도 §7-3 해결과 모순(스테일).
- 권장: 트랙 B에 "3:4·1K 생성 → 서버 1080px 리사이즈+JPEG ≤300KB" 명기 + 모순 4곳 일괄 정정(구현자가 옛 기술을 진실로 오독하는 사고 차단).

### H-8. MMS 포맷·판별 허점 — 높음 / 확신도 중간
- bytes ≤300KB만으로 MMS 탭 노출 시: 소형 PNG(알파)·GIF·초소형 로고 등 발송 부적합/저품질 자산이 MMS 가능으로 분류. 통신사/QTmsg/비토 Agent의 허용 포맷(jpg만인지)도 미확정.
- 권장: MMS 판별 = `channel_spec='mms'` 태그 단독(스튜디오 MMS 트랙 산출물만) 원칙으로 단순화, bytes는 2차 안전망. 허용 포맷은 발송 라인 실계약으로 확정(착수 전 확인 항목).

### M-1. temp 인증 서빙과 <img src> 비호환 — 중간 / 확신도 높음
- 토큰 헤더 인증이면 `<img src>` 직접 로드 불가. 선례 = agent-builds 다운로드 "fetch+blob"(OPS 7-7).
- 권장: §5-1-3에 fetch+blob 패턴 명시(또는 단수명 서명 URL — 채택 시 서명 스펙 필요).

### M-2. save 멱등 부재 — 중간 / 확신도 높음
- 같은 tempId로 save 더블클릭 → cdp_assets 중복 등재+용량 이중 계상.
- 권장: tempId 1회성 소비(이동 성공 시 무효화) + 중복 요청 409 명세.

### M-3. 다중 객체·인물 포함 이미지의 누끼 예측 불가 — 중간 / 확신도 높음
- isnet-general-use는 "가장 두드러진 객체"를 딴다. 모델(인물)+제품 광고컷이면 인물을 딸 수 있음(시세이도 메인이미지가 정확히 이 유형).
- 권장: UI에 "단일 제품 사진 권장" 가이드 + 누끼 결과 확인 단계(사용자 승인 후 합성 진행)를 §5-2 흐름에 명시.

### M-4. 회사당 직렬화의 다중 사용자 UX 미정 — 중간 / 확신도 높음
- 같은 회사 직원 2명 동시 생성 시 둘째의 경험(대기? 거부? 안내 문구?)이 미정 — 구현자 추측 지점.
- 권장: 즉시 409 + "다른 생성이 진행 중" ConfirmModal 안내로 명세(폴링 큐는 v2).

### M-5. 타임아웃 체인 실측 항목 누락 — 중간 / 확신도 중간
- 4K 28초·2장 병렬 + 인제스트 + 누끼가 한 요청에 겹치면 60초 근접 가능. nginx proxy_read_timeout(기본 60s)·express·프론트 fetch 각 층 실측치 미확인.
- 권장: 착수 절차에 nginx 설정 실측 추가, /generate는 생성만(누끼·인제스트 분리 호출) 원칙 명시.

### M-6. temp 상한·스윕 경합 세부 — 중간 / 확신도 중간
- 회사당 temp 상한 수치 미정. 스윕(mtime 7일)과 "6.9일째 편집 중" 자산의 경합, save 이동 중 스윕 삭제 경합 처리 미명세.
- 권장: 상한 기본값(예: 회사당 200MB — Harold 확인) + 스윕은 mtime 기준이므로 접근 시 touch로 연명 또는 "저장 안 한 산출물은 7일 후 삭제" 화면 문구 유지로 수용(후자 권장 — 단순).

### M-7. 시즌 제안 카드 크레딧 오기 — 중간 / 확신도 높음
- §5-2 시즌 카드 "생성 클릭 시 1크레딧" vs §3 생성 1회=2크레딧. 표시=실차감 룰 위반 씨앗.
- 권장: 2크레딧으로 정정(생성 1회와 동일).

### M-8. AI 편집(/edit)의 산출물 왜곡 고지 부재 — 중간 / 확신도 중간
- /edit는 이미지 입력 재생성 = C-3과 같은 원리로 라벨 왜곡 가능(레이어 합성 확정의 근거가 여기에도 적용됨). "AI 편집" 버튼이 제품 포함 이미지에 쓰이면 1급 흐름이 막은 왜곡이 뒷문으로 재유입.
- 권장: /edit 대상을 "배경/전체 무드 수정"으로 한정 라벨링 + 제품 포함 입력 시 왜곡 가능 고지, 또는 v1 범위에서 /edit 제외 검토(Harold 결정).

### M-9. env 키 위치 이관 — 중간 / 확신도 높음
- 실측 등록 위치 = 루트 ~/targetup-app/.env, backend 로드 = packages/backend/.env(OPS 9-7 실례). §0 착수 절차의 경로 안내도 루트 기준.
- 권장: §0을 packages/backend/.env 기준으로 정정 + 착수 시 grep -c로 위치 확인 절차.

### L-1. 픽커 "AI로 만들기" 탭과 MMS 편집기 진입점 시퀀싱 — 낮음 / 확신도 중간
- DM·이메일·MMS 에디터의 라이브러리 진입점 자체가 P3-b 잔여(v1은 인앱만). §5-2 역진입·게이팅 서술이 전 채널 완성을 전제한 듯 읽힘.
- 권장: v1 범위(인앱+스튜디오)와 P3-b 확장분을 절 안에서 명시 구분.

### L-2. 산출물 포맷 체계 미정 — 낮음 / 확신도 높음
- 배경=JPEG(실측), 누끼=PNG(알파), 합성 최종=? (고품질 PNG면 대용량 — 이메일/DM 로딩 저하). 권장: 합성 최종 = JPEG(q~90), 누끼 중간산출만 PNG로 명세.

---

## 3. Harold 결정 필요 항목

1. **4K 선택지 재정의(C-3)**: 생성 시점 [2K 2크레딧 / 4K 4크레딧] 방식으로 변경 승인 여부. 결과 단계 "4K 격상" 버튼은 제거 또는 "새로 생성" 정직 라벨.
2. **서버 합성 이관(C-4)**: 최종 굽기 서버 수행 승인(프론트=미리보기 전용).
3. temp 회사당 상한 수치(제안 기본 200MB).
4. /edit(AI 편집)의 v1 포함 여부(M-8 — 왜곡 뒷문 관리 비용 대비).
5. width/height 컬럼 동반 ALTER 여부(픽커 표시·저해상 경고에 유용 — channel_spec ALTER와 묶으면 DDL 1회).

## 4. Opus 구현자 착수 전 확정 (검증 쿼리·grep 목록)

**DB (information_schema — 서버 psql, Harold 실행)**
```sql
SELECT column_name FROM information_schema.columns WHERE table_name='cdp_assets' ORDER BY ordinal_position;
-- channel_spec 부재 재확인 → ALTER 문안 확정(§3-5 결정 반영)
```

**소스 grep (구현 세션에서 — 순서대로)**
1. AI 크레딧 지갑·차감 함수 실명: `grep -rn "CREDIT_COST_MAP\|getCreditCost\|CONFIRM_CREDIT_COSTS" packages/` → callAIWithFallback 밖 수동 차감 선례 확인 (C-2)
2. AssetLibraryPickerModal 소비처 전수: `grep -rn "AssetLibraryPickerModal" packages/frontend/src/` (channel prop 무파손 확장)
3. MallProductPickerModal 반환 계약(URL vs 로컬 사본) (H-2)
4. 브랜드 키트 자산 실명: brand 색·톤 저장 위치 (buildMarketingPrompt 주입원)
5. 시즌 컨텍스트 자산 실명 (시즌 제안 카드)
6. 스튜디오 밖 MMS 이미지 업로드 경로 + ≤300KB/포맷 검증 유무 (§4 인접 사각)
7. SUB_MODULE_CARDS·마케팅 캘린더 진입 링크 전수 (메뉴 교체 영향표)
8. temp 서빙 인증 선례: agent-builds fetch+blob 패턴 (M-1)

**인프라 실측 (Harold 실행 명령 제공 대상)**
- `pm2 describe <backend>` — fork/cluster (H-4)
- nginx proxy_read_timeout 실값 (M-5)
- 서버 `python3 -V`·메모리 여유·디스크 여유 (H-3)
- MMS 발송 라인 허용 이미지 포맷(jpg 단독 여부) (H-8)
- packages/backend/.env에 GEMINI_* 존재 확인 (M-9)

## 5. 총평 아닌 잔여 리스크 한 줄

설계의 뼈대(레이어 합성·2트랙·크레딧 상향)는 실측 근거가 있으나, **돈 계약(C-2)·과금 UX 계약(C-3)·산출물 신뢰(C-4)·스키마 사실(C-1)** 4개가 미해결인 채 구현에 들어가면 각각 운영 사고 재발 패턴(0528 컬럼·0702 표시≠차감·여정 J1 중복 차감)과 정확히 같은 길을 간다. C-1~C-4 해소 후 착수가 안전하다.
