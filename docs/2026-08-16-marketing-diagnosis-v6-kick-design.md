# 마케팅 진단 v6 — 병목 채움 킥 ("이 부족함을 한줄로는 이렇게 채워드립니다") 구현 설계서

> ★2026-08-16 Harold 지시(v5 실측 직후): "리포트는 괜찮은데 한줄로를 사용하면 뭐가 편해지는지 안 나온다.
> 이렇게 하고 계시기 때문에 부족한 부분을 한줄로는 이렇게 채워드립니다 — 이런 킥이 있어야 한다. 설문(답변)마다 다르게."
> **이 문서 하나로 다음 세션이 바로 구현한다** — 문구 원문·데이터 계약·렌더 스펙·테스트 개정·검증까지 전부 여기 있다.
> 전제 지식 = [FEATURE-MARKETING-DIAGNOSIS.md](FEATURE-MARKETING-DIAGNOSIS.md) §12 + [v3 설계서](2026-08-16-marketing-diagnosis-v3-design.md).
> **seed 변경 0 · DDL 0 · SQL 0** — 킥은 코드 원장(copy CT)이 소유한다. 배포만으로 반영된다.

## §1 무엇이 문제였나 (현행 v5 실측)

- 자사 연결이 **30일 실행 각주 2줄**(text-[10px] italic)과 견적 한 줄뿐. 병목 카드(리포트의 심장)에는 자사 0.
- 퍼널 B 미리보기는 30일 실행이 폼 뒤라 **자사 연결 노출 0** — "왜 가입하지?"에 답하는 문장이 화면에 없다.
- 회의의 "은은한 홍보"가 과교정된 상태. Harold 확정 = **병목마다 채움 1줄은 명시한다.** 진단 구간(표지·들은 것·칭찬·판정 표·짚임)의 자사 0은 유지 — 위치 계약의 선이 "병목부터"로 내려오는 것이지 폐기가 아니다.

## §2 홍보 위치 계약 개정 (FEATURE §12 반영 필요 — 구현 완료 시)

| 구간 | 자사명 | 비고 |
|---|---|---|
| 표지 · 들은 것 · 칭찬 · 짚임 · 축별 판정 | **0 (불변)** | 진단의 신뢰 구간 |
| **병목 카드 — 채움 킥(신설)** | 카드당 1줄 · 최대 3 | "바꾸는 방법" 아래. 이 문서 §4 원장 |
| 30일 실행 각주 | **폐지** | 킥과 중복 노출 방지 — FOOTNOTES 상수·조립·렌더 제거 |
| 견적 pitch_note | 유지(전문 툴 사용자 1줄) | |
| 판정 기준 | **삭제 테스트 유지** | 킥·견적을 지워도 진단(관찰~처방)이 성립해야 한다 |

## §3 데이터 계약

- `DiagnosisGapV2`에 `fill: string` 추가(인과 4박자째 — heard→cause→effect→direction→**fill**).
- 조립 = report CT의 gaps 루프에서 `HANJUL_FILLS[axis]`를 PRESCRIPTIONS와 같은 변형 매칭(`${질문key}:${답key}` 순서 = 우선순위, 첫 매칭)으로 선택. `fillTouch` 슬롯 치환 동일.
- 퍼널 B preview는 gaps를 통째로 내보내므로 **킥이 폼 앞에 자동 노출**된다(의도 — 가입 이유가 이것이다). 수치 0 원칙은 fill 문장에도 그대로(원·%·회 금지).
- **업종 예시 목업 복귀(★Harold 지적 "좋은 예시 어디 갔냐")** — v3 회의가 예시를 폼 뒤로 옮겨 B 미리보기에서 사라졌다.
  개정 = preview 허용 필드에 `examples`(업종 코드 문자열뿐 — 역산·개인정보 재료 아님) 추가, V2View의 예시 블록을
  previewMode에서도 렌더(위치 = 병목·plan_note 뒤 = 폼 직전의 확신 재료. 「그 외」 업종 생략·캡션 의무 불변).
- 스냅샷 호환: fill은 신규 필드 — 구 스냅샷(v2 result에 fill 없음)은 렌더러가 옵셔널 처리(없으면 킥 미표시). 백필 없음.

## §4 채움 킥 문구 원장 — `HANJUL_FILLS` 전문 (copy CT에 이대로 붙여넣기)

집필 규약: ①문장은 "한줄로는/한줄로에서는"으로 시작해 **기능이 실제로 하는 동작**만 말한다(과장·수치 추정 금지 — 전부 실존 기능: 고객 통합·세그먼트·AI 문안/이미지·자동 발송·발송 결과·자사몰 연동·싱크에이전트) ②45자 내외 ③대시 금지 ④{t} 슬롯 허용(2단 규약과 동일).

```ts
/**
 * v6 — 병목 채움 킥("이 부족함을 한줄로는 이렇게 채워드립니다" — Harold 확정 2026-08-16).
 * 변형 키 순서 = 매칭 우선순위(구체 판정 먼저). 문장은 실존 기능의 동작만 — 수치 약속 금지.
 */
export const HANJUL_FILLS: Record<DiagnosisAxis, { default: string; variants?: Record<string, string> }> = {
  list: {
    default: '한줄로는 포스기·쇼핑몰·엑셀의 고객을 자동으로 한 명단으로 모아, 모으는 손이 멈춰도 명단이 계속 자랍니다.',
    variants: {
      'locked_tool:platform': '한줄로는 매장에서 남긴 연락처가 바로 발송 가능한 내 명단이 되게 합니다. 플랫폼에 기대지 않는 재{t} 통로가 생겨요.',
      'locked_tool:erp': '한줄로는 자체 시스템의 고객 명단을 자동으로 동기화해, 내보내기 없이 바로 발송 대상으로 씁니다.',
      'unified_tool:erp': '한줄로는 자체 시스템의 고객 명단을 자동으로 동기화해, 내보내기 없이 바로 발송 대상으로 씁니다.',
      'unified_tool:excel': '한줄로는 엑셀 명단을 올리는 순간부터 새 고객이 자동으로 쌓이는 명단으로 바꿔 줍니다.',
    },
  },
  targeting: {
    default: '한줄로는 구매 이력과 방문일로 받을 사람을 클릭 몇 번에 고르고, 그 조건을 저장해 다음에도 그대로 씁니다.',
    variants: {
      'unified_tool:crm': '한줄로는 CRM에서 하던 고객 구분을 발송까지 한 번에 잇습니다. 고른 대상이 그대로 발송 명단이 돼요.',
    },
  },
  sending: {
    default: '한줄로는 문안 작성부터 발송·결과 확인까지 한 화면에서 끝납니다. 문안이 막히면 AI가 대신 써 드려요.',
    variants: {
      'no_send_reason:no_copy': '한줄로는 무엇을 팔지와 혜택만 고르면 AI가 문안을 대신 써 드립니다. 백지에서 시작하지 않아도 돼요.',
      'no_send_reason:no_time': '한줄로는 만들고 보내는 과정을 한 화면으로 줄여, 한 번의 발송이 30분이 아니라 몇 분이면 됩니다.',
      'send_tool:mixed': '한줄로는 문자·알림톡·이메일·모바일 DM을 한곳에서 보내고 결과도 한곳에 모읍니다.',
    },
  },
  production: {
    default: '한줄로는 보낼 이미지와 안내 화면을 AI가 만들어 줍니다. 상품과 문구만 고르면 완성돼요.',
    variants: {
      'prod_refit:yes': '한줄로는 한 번 만든 콘텐츠를 채널에 맞는 형태로 바로 내보내, 채널마다 다시 만드는 일이 없어집니다.',
      'prod_leadtime:week': '한줄로는 요청하고 기다리는 대신 그 자리에서 AI로 만들어, 당일 행사도 당일에 나갑니다.',
      'prod_leadtime:varies': '한줄로는 요청하고 기다리는 대신 그 자리에서 AI로 만들어, 발송 달력을 내 일정대로 짤 수 있어요.',
    },
  },
  repeat: {
    default: '한줄로는 생일·재{t} 안내를 조건만 정하면 자동으로 보냅니다. 사람 기억이 아니라 시스템이 챙겨요.',
    variants: {
      'manual_count:c6_10': '한줄로는 매달 손으로 챙기던 그 발송들을 조건 한 번 설정으로 자동으로 돌립니다.',
      'manual_count:c10p': '한줄로는 매달 손으로 챙기던 그 발송들을 조건 한 번 설정으로 자동으로 돌립니다.',
    },
  },
  measure: {
    default: '한줄로는 보낸 뒤 클릭과 방문까지 발송 결과에 자동으로 잡아, 다음 발송을 바꿀 근거가 쌓입니다.',
    variants: {
      'measure_reason:dont_know': '한줄로는 발송이 끝나면 결과가 같은 화면에 바로 떠서, 찾아다닐 필요가 없습니다.',
      'measure_reason:no_time': '한줄로는 결과를 찾아보는 게 아니라 보이는 곳에 두어, 스치듯 봐도 흐름이 잡힙니다.',
    },
  },
};
```

⚠ 병목 0(고도화 경로)의 plan30에는 킥을 넣지 않는다(팔 병목이 없는 회사 — 견적 pitch_note만).

## §5 렌더 스펙 (ReportV2View — 병목 카드 안)

`direction` 블록(border-l-2 "이렇게 바꿔 보세요") **아래**에:

```tsx
{g.fill && (
  <div className="mt-3 border-t border-white/10 pt-2.5">
    <p className="text-[11px] font-semibold text-sky-300/70">한줄로는 이렇게 채워드립니다</p>
    <p className="mt-0.5 text-sm leading-relaxed text-white/80">{g.fill}</p>
  </div>
)}
```

- 라벨만 sky 톤 소형(위치 식별용) · 본문은 일반 명도 — 배너화 금지(브랜드 그라데이션·버튼·아이콘 0).
- 30일 실행의 `footnote` 렌더 블록은 제거(카드 구조는 유지).

## §6 구현 체크리스트 (파일별 — 이 순서대로)

1. `packages/backend/src/utils/marketing-diagnosis-copy.ts` — §4 원장 추가 · `FOOTNOTES` 상수 삭제.
2. `packages/backend/src/utils/marketing-diagnosis-report.ts` — `DiagnosisGapV2.fill` 추가 · gaps 루프에서 fill 선택(변형 매칭 헬퍼는 PRESCRIPTIONS 선택 로직을 함수로 추출해 공용화: `pickVariant(table, answers)` — 중복 두 벌 금지) · plan30 footnote 조립 제거(`footnotesUsed` 카운터 포함).
3. `packages/backend/src/routes/marketing-diagnosis-public.ts` — preview 허용 필드 조립에 `examples: full.examples` 추가.
4. `packages/frontend/src/components/marketing-diagnosis/diagnosisApi.ts` — `DiagnosisGapDto.fill?: string`.
4. `packages/frontend/src/components/marketing-diagnosis/ReportV2View.tsx` — §5 렌더 + footnote 렌더 제거.
5. 테스트 `marketing-diagnosis-v3.test.ts` 개정:
   - 기존 「홍보 위치 계약」 테스트 → **킥 계약으로 교체**: 자사명 등장 = `gaps[].fill`(≤3) + `pitch_note` + (`plan30` 0) · cover·observation·praises·axes·insights·heard/cause/effect/direction에 0.
   - 신규: 변형 매칭(플랫폼 → "플랫폼에 기대지 않는" / no_copy → "AI가 문안을" / prod_refit:yes → "다시 만드는 일이 없어집니다") · fill 없는 병목 0(전 축에 default 있으므로 gaps에는 항상 fill) · 고도화 경로 plan30에 자사명 0.
   - 삭제 테스트 유지 단언: fill·pitch_note 제거해도 gaps의 4필드(heard·cause·effect·direction)가 성립.
6. tsc 양쪽 0 → vitest 전체 → 금지어 grep(대시·모델명) → Codex는 **불요**(조회·표시 축뿐 — 쓰기 경로·DDL 0. `feedback_codex_scope_write_path_or_ddl_only`).
7. 문서: FEATURE §12에 §2 개정 반영 · v3 설계서 §8-1 아래 v6 행 · STATUS ⓪ 갱신.

## §7 배포 (다음 세션 종료 시 Harold 안내문 — OPS.md §2-2 그대로)

```bash
tp-push "0817(1) 마케팅 진단 v6 — 병목 채움 킥(답변별 한줄로 연결) · 각주 폐지"
```
서버: `cd /home/administrator/targetup-app && git pull` → `cd packages/backend && npm run build:safe` →
`cd ../frontend && npm run build:safe` → `pm2 reload targetup-backend`. **seed 실행 없음(코드만).**

## §8 SQL 길이 운영 방침 (Harold 질문 답 — 확정)

- seed는 **scripts/sql/ 파일 + `docker exec -i … psql < 파일`**이 표준이다(0816 붙여넣기 사고로 확정 —
  `.gitignore` `*.sql`에 `!scripts/sql/*.sql` 예외 있음). 파일 실행이라 **길이 상한이 사실상 없다** — 문항이 100개가 돼도 같다.
- 터미널 직접 붙여넣기는 금지(잘림 사고 재발 경로). 확인은 `jsonb_array_length` SELECT 한 줄.
- 리포트 문장(킥·처방·칭찬)은 seed가 아니라 **코드 원장**이므로 SQL을 더 키우지 않는다 — 문장 수정 = 코드 배포,
  문항·분기 수정 = seed 파일. 이 분업이 길이 문제의 구조적 답이다.

## §9 검증 시나리오 (구현 후 실측)

| # | 시나리오 |
|---|---|
| K-1 | 퍼널 B: 플랫폼 접점 + 명단 없음 완주 → **폼 앞** 병목 카드에 킥("플랫폼에 기대지 않는") 노출 |
| K-2 | 문안 몰라서 발송 0 경로 → sending 킥이 "AI가 문안을 대신" 변형 |
| K-3 | 채널 재작업 있음 경로 → production 킥이 "다시 만드는 일이 없어집니다" 변형 |
| K-4 | 30일 실행 카드에 각주(이탤릭 자사 줄) 0 |
| K-5 | 전 축 상위(병목 0) → 리포트 자사명 = 견적 구간뿐 |
| K-6 | v5로 제출된 기존 행 재열람 → 킥 없이 정상(스냅샷 호환) |
| K-7 | 퍼널 B 미리보기(폼 앞)에 업종 예시 3종 노출 · 「그 외」 업종은 생략 · 캡션 실존 |

## §10 구현 결과 — 설계서와 달라진 것 (2026-08-16 구현 세션)

**§4 원장의 변형 5종은 현행 seed에서 도달 불가라 넣지 않았다.** 킥은 병목(축 level ≤ 1)인 카드에만 붙는데,
그 변형들이 걸린 심화 문항은 **그 축이 상위 등급일 때만 열린다** — 그래서 절대 선택되지 않는다.

| 축 | 설계서 변형 | 왜 안 나가나 | 대체 |
|---|---|---|---|
| list | `unified_tool:erp` · `unified_tool:excel` | `unified_tool`은 list=`unified`(level **3**)에서만 열린다 = 병목 아님 | `locked_tool:platform`·`locked_tool:erp`(list=locked, level 1) + `inflow_capture:no_capture` |
| production | `prod_refit:yes` · `prod_leadtime:week` · `prod_leadtime:varies` | `prod_refit`은 `self`, `prod_leadtime`은 `outsource`에서만 열린다(둘 다 level **2**) | `copy_how:*` — production=`none`(level 0)에서만 열리는 **유일한** 분기 |

- 그래서 **K-3(채널 재작업 → production 킥)은 성립하지 않는다** — 폐기. 대신 "문구를 어떻게 준비하는지"가 제작 병목의 분화 축이다.
- 재발 차단 = `marketing-diagnosis-seed-v3.test.ts`의 **도달 가능성 계약 테스트**(seed 원문 대조). 원장에 죽은 문장이 들어가면 배포 전에 빨간불이 난다.
- **범위 밖 발견(착수 안 함)** — 같은 결함이 `PRESCRIPTIONS`에 7종 있다(list `unified_tool:*` 2 · production `prod_*` 5).
  뿌리는 문구가 아니라 판정 축이다: "직접 만드는데 재작업이 잦다"는 병목이 아니라 **짚임(insights)** 자리다. 처리 = FEATURE 문서 §12 「추가 과제」.
- §2 표의 "30일 실행 각주 폐지"·§5 렌더 스펙·§6 체크리스트는 **설계서대로 이행**했다. 같은 세션에 리포트 장 넘김(v7)도 함께 구현했다(FEATURE §12).
