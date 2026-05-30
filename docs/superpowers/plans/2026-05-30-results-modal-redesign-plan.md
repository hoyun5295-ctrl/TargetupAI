# 발송결과 모달 재설계 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 발송결과 모달(`ResultsModal.tsx`)을 대시보드 흰 톤 모던으로 재설계하고, 비대한 캠페인 상세를 `CampaignDetailModal.tsx`로 분리하며, 알림톡 캠페인에 템플릿코드/명/검수상태를 표시한다.

**Architecture:** backend는 `:id/messages`의 `alimtalkTemplateInfo`에 `status` 필드 1개만 추가(집계·구조 변경 X). frontend는 캠페인 상세를 신규 컴포넌트로 분리하고 흰 톤 카드/테이블로 전면 재설계, status→badge 매핑은 `formatDate.ts` 컨트롤타워 헬퍼로 단일화, draft 예약취소의 native dialog 3건은 흰 톤 확인 모달 흐름으로 교체한다.

**Tech Stack:** React + TypeScript, TailwindCSS, lucide-react, Express + PostgreSQL/MySQL.

**검증된 전제(db_column_verify 완료):**
- `kakao_templates.status` = `varchar(20)` 실재. `reject_reason text`, `template_code varchar(50)`, `template_name varchar(100)` 실재.
- 실제 status 값 분포: `APPROVED`(8), `DELETED`(3), `DRAFT`(1), `KREJ`(1).
- sync 코드(`alimtalk-jobs.ts`)상 향후 등장 가능 값: `REG`/`REQ`/`REV`/`REQUESTED`/`REVIEWING`/`KREQ`(검수중), `APR`/`APPROVED`/`APPROVAL`(승인), `REJ`/`REJECTED`/`KREJ`/`HREJ`(반려).
- JOIN/조회 키(`c.kakao_template_id = kt.id`, `company_id + template_code`)는 운영 중 코드라 검증됨.

**검증 방식:** 이 저장소는 frontend 단위 테스트 러너가 없음 → 검증 = backend `tsc --noEmit` 0 + frontend `tsc --noEmit` 0 + 자가 grep(박-단어/모델명/native dialog 0) + 배포 후 실데이터 화면 확인(Harold/직원). preview MCP·git 직접 실행 금지(영구 룰).

---

## File Structure

| 파일 | 변경 | 책임 |
|------|------|------|
| `packages/backend/src/routes/results.ts` | Modify ~742-783 | `alimtalkTemplateInfo`에 `status` 필드 추가 |
| `packages/frontend/src/utils/formatDate.ts` | Modify (export 추가) | `getAlimtalkTemplateStatus(status)` — status→{label,badgeClass} 단일 매핑 |
| `packages/frontend/src/components/CampaignDetailModal.tsx` | **Create** | 캠페인 상세 모달(분리 + 흰 톤 재설계 + 알림톡 검수상태 카드) |
| `packages/frontend/src/components/ResultsModal.tsx` | Modify | 상세 인라인 제거→컴포넌트 사용 + 요약 탭/채널테이블/필터바/테스트탭/발송내역 팝업 흰 톤 재설계 + native dialog 제거 |

---

## Task 1: backend — alimtalkTemplateInfo에 status 추가

**Files:**
- Modify: `packages/backend/src/routes/results.ts:742-783`

- [ ] **Step 1: 타입 + SELECT + 대입 3곳 수정**

`packages/backend/src/routes/results.ts` 742행 타입 선언을 status 포함으로 변경:

```typescript
    let alimtalkTemplateInfo: { code: string; name: string; status: string } | null = null;
```

755-758행 SELECT에 `status` 컬럼 추가:

```typescript
          const tplResult = await query(
            `SELECT template_code, template_name, status FROM kakao_templates
             WHERE company_id = $1::uuid AND template_code = $2 LIMIT 1`,
            [companyId, firstTemplateCode],
          );
```

759-767행 대입부 3개 분기 모두 status 포함(PG 발견 / PG 미발견 / catch):

```typescript
          if (tplResult.rows.length > 0) {
            alimtalkTemplateInfo = {
              code: tplResult.rows[0].template_code,
              name: tplResult.rows[0].template_name || '',
              status: tplResult.rows[0].status || '',
            };
          } else {
            // PG 미발견 — MySQL queue 영역 templateCode 만 응답
            alimtalkTemplateInfo = { code: firstTemplateCode, name: '', status: '' };
          }
        } catch (tplErr) {
          console.warn('[results messages] 알림톡 템플릿 조회 실패 — code 영역만 응답:', tplErr);
          alimtalkTemplateInfo = { code: firstTemplateCode, name: '', status: '' };
        }
```

- [ ] **Step 2: backend tsc 검증**

Run: `cd packages/backend && npx tsc --noEmit`
Expected: 0 errors

---

## Task 2: frontend util — getAlimtalkTemplateStatus 단일 매핑 헬퍼

**Files:**
- Modify: `packages/frontend/src/utils/formatDate.ts` (named export 추가)

- [ ] **Step 1: 헬퍼 함수 추가**

`formatDate.ts` 끝에 추가(흰 톤 badge 클래스 포함, 단일 출처):

```typescript
/**
 * 알림톡 템플릿 검수상태 → 라벨 + 흰 톤 badge 클래스 매핑 (단일 출처).
 * 실제 값(APPROVED/DELETED/DRAFT/KREJ) + sync 진행 중 가능 값(REG/REQ/REV/REQUESTED/REVIEWING/KREQ/APR/APPROVAL/REJ/REJECTED/HREJ) 모두 포함.
 */
export function getAlimtalkTemplateStatus(
  status: string | null | undefined,
): { label: string; badgeClass: string } {
  const s = (status || '').toUpperCase();
  const NEUTRAL = 'bg-slate-100 text-slate-600 border border-slate-200';
  if (s === 'APPROVED' || s === 'APPROVAL' || s === 'APR') {
    return { label: '승인', badgeClass: 'bg-emerald-50 text-emerald-700 border border-emerald-200' };
  }
  if (s === 'REQUESTED' || s === 'REVIEWING' || s === 'REQ' || s === 'REV' || s === 'REG' || s === 'KREQ') {
    return { label: '검수중', badgeClass: 'bg-amber-50 text-amber-700 border border-amber-200' };
  }
  if (s === 'REJECTED' || s === 'REJ' || s === 'KREJ' || s === 'HREJ') {
    return { label: '반려', badgeClass: 'bg-rose-50 text-rose-700 border border-rose-200' };
  }
  if (s === 'DRAFT') return { label: '작성중', badgeClass: NEUTRAL };
  if (s === 'DELETED') return { label: '삭제됨', badgeClass: NEUTRAL };
  if (!s) return { label: '확인 중', badgeClass: NEUTRAL };
  return { label: s, badgeClass: NEUTRAL };
}
```

- [ ] **Step 2: frontend tsc 검증**

Run: `cd packages/frontend && npx tsc --noEmit`
Expected: 0 errors

---

## Task 3: CampaignDetailModal.tsx 생성 (분리 + 흰 톤 재설계 + 알림톡 카드)

**Files:**
- Create: `packages/frontend/src/components/CampaignDetailModal.tsx`

현재 `ResultsModal.tsx:776-964`(캠페인 상세 모달)를 분리하여 신규 컴포넌트로 만든다. props로 부모 상태를 받고, 흰 톤 모던으로 재구성한다.

- [ ] **Step 1: Props 인터페이스 + 골격**

```tsx
import { X, FileText, ExternalLink } from 'lucide-react';
import { calculateSmsBytes, formatCampaignMessageForDisplay, buildAdSubjectFront, getAlimtalkTemplateStatus } from '../utils/formatDate';
import MmsImagePreview from './shared/MmsImagePreview';

interface CampaignDetailModalProps {
  campaign: any;                       // selectedCampaign
  detail: any;                         // campaignDetail (charts)
  alimtalkTemplateInfo: { code: string; name: string; status: string } | null;
  firstMessageContent?: string;        // messages[0]?.msg_contents (실발송 텍스트 우선용)
  onClose: () => void;
  onShowMessages: () => void;          // 발송 내역 보기 → 부모가 팝업 오픈
  onImageClick: (url: string, filename: string) => void;
}

const MSG_TYPE_LABEL: Record<string, string> = { SMS: 'SMS', LMS: 'LMS', MMS: 'MMS', S: 'SMS', L: 'LMS', M: 'MMS', K: '알림톡', F: '친구톡' };

export default function CampaignDetailModal({ campaign, detail, alimtalkTemplateInfo, firstMessageContent, onClose, onShowMessages, onImageClick }: CampaignDetailModalProps) {
  const isAlimtalk = campaign.send_channel === 'alimtalk';
  const channelLabel = isAlimtalk ? '알림톡' : campaign.send_channel === 'kakao' ? '카카오' : (MSG_TYPE_LABEL[campaign.message_type] || campaign.message_type);
  const s = detail?.charts?.successFail;
  const denom = s ? (s.sent || (s.success + s.fail) || 1) : 1;
  const successRate = s ? Math.round((s.success / denom) * 100) : 0;
  const clickRate = (s && s.clicks && s.success) ? Math.round((s.clicks / s.success) * 100) : 0;
  // ... (Step 2~5의 JSX)
}
```

- [ ] **Step 2: 셸 + 헤더(캠페인명 + 채널 chip + 상태 badge + 발송일시)**

흰 톤 `bg-white rounded-2xl shadow-2xl`, sticky 헤더. 채널 chip 색: 알림톡 emerald / 카카오 yellow / SMS·LMS·MMS violet. 상태 badge는 기존 `getStatusColor` 로직을 컴포넌트 내 동일 흰 톤으로 재현(완료 emerald / 예약 blue / 발송중 amber / 취소 slate / 실패 rose).

```tsx
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-2 md:p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[860px] max-h-[92vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-start gap-3 px-6 py-4 border-b border-slate-200 bg-white sticky top-0 z-10">
          <div className="min-w-0">
            <h3 className="font-bold text-slate-900 truncate">{campaign.campaign_name}</h3>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <span className={`px-2 py-0.5 rounded-md text-[11px] font-medium ${isAlimtalk ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : campaign.send_channel === 'kakao' ? 'bg-yellow-50 text-yellow-700 border border-yellow-200' : 'bg-violet-50 text-violet-700 border border-violet-200'}`}>{channelLabel}</span>
              <span className="text-xs text-slate-400">{campaign.sent_at ? new Date(campaign.sent_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-'}</span>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors shrink-0"><X className="w-5 h-5" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Step 3: 요약 카드 */}
          {/* Step 4: 알림톡 검수상태 카드 (isAlimtalk 시) */}
          {/* Step 5: 폰 미리보기 + 정보 + 분포 */}
        </div>
      </div>
    </div>
  );
```

- [ ] **Step 3: 상단 요약 카드(성공률/클릭률/전송·성공·실패·대기) — 흰 톤 compact**

`grid grid-cols-2 md:grid-cols-4 gap-3`. 각 카드 `rounded-2xl border border-slate-200 bg-white shadow-sm p-4`. 성공률 = 큰 숫자(emerald/rose) + 미니 프로그레스바. 클릭률 = violet + "N 클릭". 전송/성공/실패/대기 compact 수치(기존 `s.sent/s.success/s.fail` 활용, 대기 = max(0, sent-success-fail)).

- [ ] **Step 4: 알림톡 검수상태 카드 (isAlimtalk && alimtalkTemplateInfo)**

emerald 액센트 카드. 템플릿명(굵게) + 템플릿코드(mono) + 검수상태 badge(`getAlimtalkTemplateStatus` 사용).

```tsx
{isAlimtalk && alimtalkTemplateInfo && (() => {
  const st = getAlimtalkTemplateStatus(alimtalkTemplateInfo.status);
  return (
    <div className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-4">
      <div className="flex items-center gap-2 mb-2">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-sm"><FileText className="w-5 h-5 text-white" /></div>
        <div className="min-w-0">
          <div className="text-xs text-emerald-700/70">알림톡 템플릿</div>
          <div className="font-bold text-slate-900 truncate">{alimtalkTemplateInfo.name || '(템플릿명 미설정)'}</div>
        </div>
        <span className={`ml-auto px-2 py-0.5 rounded-md text-xs font-medium ${st.badgeClass}`}>{st.label}</span>
      </div>
      <div className="text-xs text-slate-500">템플릿코드 <span className="font-mono text-slate-700">{alimtalkTemplateInfo.code || '-'}</span></div>
    </div>
  );
})()}
```

- [ ] **Step 5: 폰 미리보기(흰 톤 카드화) + 캠페인 정보(key-value) + 통신사별/실패사유 분포(모던 바) + Source caption + 발송 내역 보기 버튼**

2열(`flex flex-col md:flex-row gap-5`). 좌 = 폰 미리보기(기존 `ResultsModal.tsx:860-911` 구조 유지, MMS 클릭 시 `onImageClick` 호출). 우 = 캠페인 정보(기존 `918-945`의 key-value 그대로, 단 `divide-slate-200`/흰 톤) + 통신사별 분포 바(`detail.charts.carriers`) + 실패사유 분포 바(`detail.charts.errors`). 각 분포 하단 Source caption `text-[10px] text-slate-400 italic`. 하단 "발송 내역 보기" 버튼 = emerald, onClick={onShowMessages}.

> 폰 미리보기 알림톡 분기는 기존 동작 유지(템플릿명/코드 표시). `messages[0]?.msg_contents` 대신 prop `firstMessageContent`를 `formatCampaignMessageForDisplay(campaign, firstMessageContent)`로 전달.

- [ ] **Step 6: frontend tsc 검증**

Run: `cd packages/frontend && npx tsc --noEmit`
Expected: 0 errors (ResultsModal에서 아직 import 안 했으면 unused 경고는 없음 — 본 컴포넌트 자체 타입만 확인)

---

## Task 4: ResultsModal — CampaignDetailModal 연결 (상세 인라인 제거)

**Files:**
- Modify: `packages/frontend/src/components/ResultsModal.tsx` (import 추가, 776-964 교체)

- [ ] **Step 1: import 추가 + 인라인 상세 모달 교체**

상단 import에 `import CampaignDetailModal from './CampaignDetailModal';` 추가.
`alimtalkTemplateInfo` state 타입(88행)을 `{ code: string; name: string; status: string } | null`로 변경.
776-964행(캠페인 상세 모달 블록)을 다음으로 교체:

```tsx
        {selectedCampaign && (
          <CampaignDetailModal
            campaign={selectedCampaign}
            detail={campaignDetail}
            alimtalkTemplateInfo={alimtalkTemplateInfo}
            firstMessageContent={messages[0]?.msg_contents}
            onClose={() => { setSelectedCampaign(null); setShowSendDetail(false); }}
            onShowMessages={() => {
              setShowSendDetail(true);
              setMessagePage(1);
              setMessageSearchValue('');
              setMessageStatus('all');
              fetchMessages(selectedCampaign.id, 1, { status: 'all', searchValue: '' });
            }}
            onImageClick={(url, filename) => setEnlargedImage({ url, filename })}
          />
        )}
```

- [ ] **Step 2: frontend tsc 검증**

Run: `cd packages/frontend && npx tsc --noEmit`
Expected: 0 errors. `buildAdSubjectFront`/`MmsImagePreview` 등 상세에서만 쓰던 import가 ResultsModal에서 미사용이 되면 unused 경고 → 미사용분 import 정리.

---

## Task 5: ResultsModal — 요약 탭 재설계 + native dialog 제거

**Files:**
- Modify: `packages/frontend/src/components/ResultsModal.tsx` (요약 탭 300-569, draft 취소 499-523)

- [ ] **Step 1: 5 메트릭 카드 재설계 (371-385 교체)**

상단 import에 lucide 추가: `import { Send, CheckCircle2, XCircle, TrendingUp, Wallet } from 'lucide-react';`
평면 색박스를 대시보드 카드형으로 교체(아이콘 칩 10x10 그라데이션 + 라벨 + 큰 숫자 + 성공률 미니 프로그레스바):

```tsx
                const cards = [
                  { key: 'sent', label: '총 발송', value: totalSent.toLocaleString(), Icon: Send, grad: 'from-violet-500 to-violet-600', cls: 'text-slate-900' },
                  { key: 'success', label: '성공', value: totalSuccess.toLocaleString(), Icon: CheckCircle2, grad: 'from-emerald-500 to-emerald-600', cls: 'text-emerald-600' },
                  { key: 'fail', label: '실패', value: totalFail.toLocaleString(), Icon: XCircle, grad: 'from-rose-500 to-rose-600', cls: 'text-rose-600' },
                  { key: 'rate', label: '성공률', value: `${successRate}%`, Icon: TrendingUp, grad: 'from-violet-500 to-fuchsia-600', cls: 'text-violet-600', progress: successRate },
                  { key: 'cost', label: '예상 비용', value: `₩${Math.round(estimatedCost).toLocaleString()}`, Icon: Wallet, grad: 'from-amber-500 to-orange-500', cls: 'text-amber-600' },
                ];
                return (
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                    {cards.map(card => (
                      <div key={card.key} className="rounded-2xl border border-slate-200 bg-white shadow-sm p-4">
                        <div className="flex items-center gap-2 mb-2">
                          <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${card.grad} flex items-center justify-center shadow-sm`}>
                            <card.Icon className="w-5 h-5 text-white" />
                          </div>
                          <span className="text-xs text-slate-500">{card.label}</span>
                        </div>
                        <div className={`text-2xl font-bold ${card.cls}`}>{card.value}</div>
                        {card.progress !== undefined && (
                          <div className="mt-2 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                            <div className="h-full bg-gradient-to-r from-violet-500 to-fuchsia-500 rounded-full" style={{ width: `${Math.min(100, card.progress)}%` }} />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                );
```

- [ ] **Step 2: 채널통합 테이블 흰 톤 모던 (388-567 정리)**

컨테이너 `rounded-2xl border border-slate-200`. thead `bg-slate-50 sticky top-0`. row hover `hover:bg-slate-50`. 채널 = 색 chip(SMS·LMS·MMS violet / 알림톡 emerald / 카카오 yellow), 유형 = badge(수동 slate / AI violet), 상태 = pill(완료 emerald / 예약 blue / 발송중 amber / 취소 slate / 실패 rose). 성공/실패/대기 색 숫자 유지, 성공률 = 미니 프로그레스바 + %. 페이지네이션 버튼 흰 톤 정리(active = violet). 하단 Source caption `text-[10px] text-slate-400 italic`. md 미만 = 카드형 스택(`md:hidden` 카드 + `hidden md:table` 테이블 — 주요 필드: 캠페인/채널/상태/전송/성공률/상세).

- [ ] **Step 3: 필터 바 흰 톤 정리 (302-347)**

input/select `rounded-lg border-slate-300 focus:ring-violet-200 focus:border-violet-400`. 조회 버튼 violet(`bg-violet-500 hover:bg-violet-600`). 캘린더 버튼(285-298)도 violet 유지하되 톤 통일. `flex-wrap` 유지(모바일).

- [ ] **Step 4: native dialog 제거 — draft 예약취소 (499-523)**

신규 state 추가: `const [draftCancelTarget, setDraftCancelTarget] = useState<any>(null);`
draft 취소 버튼 onClick을 `setDraftCancelTarget(c)`로 변경(인라인 confirm/alert 제거). 그리고 기존 흰 톤 `cancelTarget` 확인 모달(1134-1178) 아래에 동일 톤의 draft 확인 모달을 추가:

```tsx
        {draftCancelTarget && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4" onClick={() => setDraftCancelTarget(null)}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[400px] overflow-hidden" onClick={(e) => e.stopPropagation()}>
              <div className="bg-rose-50 px-6 py-4 border-b border-rose-100"><h3 className="text-lg font-bold text-rose-700">예약 취소</h3></div>
              <div className="p-6">
                <p className="text-slate-700">"{draftCancelTarget.campaign_name}" 예약을 취소하시겠습니까?</p>
                <p className="text-xs text-rose-500 mt-3">* 취소된 예약은 복구할 수 없습니다.</p>
              </div>
              <div className="flex border-t border-slate-200">
                <button onClick={() => setDraftCancelTarget(null)} className="flex-1 py-3 text-slate-600 hover:bg-slate-50 font-medium transition-colors">닫기</button>
                <button
                  onClick={async () => {
                    const c = draftCancelTarget;
                    try {
                      const tk = localStorage.getItem('token');
                      const res = await fetch(`/api/campaigns/${c.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${tk}` } });
                      const data = await res.json();
                      if (data.success) {
                        setCampaigns((prev: any[]) => prev.map((x: any) => x.id === c.id ? { ...x, status: 'cancelled' } : x));
                        setDraftCancelTarget(null);
                        showToast('success', '예약이 취소되었습니다.');
                      } else {
                        showToast('error', data.error || '취소에 실패했습니다');
                      }
                    } catch {
                      showToast('error', '서버 연결 오류가 발생했습니다.');
                    }
                  }}
                  className="flex-1 py-3 bg-rose-500 text-white hover:bg-rose-600 font-medium transition-colors"
                >예약 취소</button>
              </div>
            </div>
          </div>
        )}
```

- [ ] **Step 5: native dialog 0건 자가 grep**

Run: `grep -nE "window\.confirm|[^.]\balert\(|prompt\(" packages/frontend/src/components/ResultsModal.tsx`
Expected: 0건

- [ ] **Step 6: frontend tsc 검증**

Run: `cd packages/frontend && npx tsc --noEmit`
Expected: 0 errors

---

## Task 6: ResultsModal — 테스트 탭 + 발송내역 팝업 흰 톤 정리

**Files:**
- Modify: `packages/frontend/src/components/ResultsModal.tsx` (테스트 탭 571-772, 발송내역 팝업 966-1132)

- [ ] **Step 1: 테스트 탭 카드/테이블 흰 톤 정리**

3 요약 카드 컨테이너 `rounded-2xl border border-slate-200 shadow-sm`(색 액센트 유지: amber/orange/violet). 두 이력 테이블 컨테이너 `rounded-2xl border border-slate-200`, thead `bg-slate-50`. 데이터·페이지네이션 동작·파라미터 변경 X. 조회 버튼 톤 유지(orange).

- [ ] **Step 2: 발송내역 팝업 흰 톤 정리 (966-1132)**

컨테이너 `rounded-2xl`. thead `bg-slate-50 sticky`. 검색/필터/다운로드 바 `bg-slate-50 border-slate-200`. 검색·성공/실패 필터 버튼 톤 통일(active = violet/emerald/rose). 페이지네이션 active = violet. 동작·파라미터·엑셀 다운로드 로직 변경 X. (이 팝업은 ResultsModal에 잔존 — CampaignDetailModal의 onShowMessages가 부모 state로 오픈.)

- [ ] **Step 3: frontend tsc 검증**

Run: `cd packages/frontend && npx tsc --noEmit`
Expected: 0 errors

---

## Task 7: 통합 검증

- [ ] **Step 1: backend tsc**

Run: `cd packages/backend && npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 2: frontend tsc**

Run: `cd packages/frontend && npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 3: 자가 grep (박-단어 / 모델명 / native dialog) — 신규·수정 2 파일**

Run:
```
grep -nE "박음|박힘|박는|박지|박을|박혀|박힌|박혔|박힐|박았|옛|정합|매트릭스" packages/frontend/src/components/CampaignDetailModal.tsx packages/frontend/src/components/ResultsModal.tsx
grep -niE "opus|sonnet|haiku|gpt|claude|anthropic" packages/frontend/src/components/CampaignDetailModal.tsx packages/frontend/src/components/ResultsModal.tsx
grep -nE "window\.confirm|[^.]\balert\(|prompt\(" packages/frontend/src/components/CampaignDetailModal.tsx packages/frontend/src/components/ResultsModal.tsx
```
Expected: 전부 0건

- [ ] **Step 4: 알림톡 status 흐름 사실 확인(grep)**

Run: `grep -n "status" packages/backend/src/routes/results.ts | grep -i alimtalk -A2 -B2` (또는 742-783 구간 재확인)
Expected: `alimtalkTemplateInfo` 타입·대입 3곳 모두 status 포함.

---

## Task 8: codex 이중 검증

- [ ] **Step 1: `/codex:review`**

UI 신설/전면 재작성(5분+ 작업) → codex_review_after_code_change 룰. 이슈 발견 시 최대 5라운드 정정.

---

## Self-Review (작성자 점검)

**Spec coverage:**
- §3-1 셸/톤 → Task 3 Step 2, Task 5/6 (흰 베이스 + rounded-2xl + 아이콘 칩). ✓
- §3-2 메트릭 5 카드 → Task 5 Step 1. ✓
- §3-3 채널 테이블 → Task 5 Step 2 (chip/badge/pill/프로그레스바/모바일 카드). ✓
- §3-4 CampaignDetailModal 분리 + 알림톡 카드 → Task 3 + Task 4. ✓
- §3-5 status 데이터(backend) → Task 1 (information_schema 검증 완료). ✓
- §3-6 테스트 탭 → Task 6 Step 1. ✓
- §4 규칙(native dialog 0/모델명 0/모바일/Source caption/인라인 헬퍼 금지) → Task 2(헬퍼 CT), Task 5 Step 4-5, Task 7 Step 3. ✓

**Placeholder scan:** 모든 코드 스텝에 실제 코드 포함. 기계적 톤 swap 스텝(Task 5 Step 2/3, Task 6)은 적용 클래스·범위를 구체 명시(인라인 구현 시 파일이 컨텍스트에 있음). 추상 "에러 처리 추가" 류 없음.

**Type consistency:** `alimtalkTemplateInfo: { code; name; status }` — backend(Task 1)·state(Task 4)·props(Task 3) 3곳 동일. `getAlimtalkTemplateStatus` 반환 `{ label, badgeClass }` — 정의(Task 2)·사용(Task 3 Step 4) 일치. `onShowMessages`/`onImageClick`/`firstMessageContent` props — 정의(Task 3)·전달(Task 4) 일치.

**범위 밖(건드리지 않음):** endpoint 신규·집계 로직·발송결과 속도 H1~H6.
