/**
 * BrandSendModal — 브랜드메시지 발송 풀 화면 (★ 2026-07-29 신설 / 2026-07-31 셸 교체)
 *
 * 왜 알림톡 모달과 따로인가:
 *   알림톡은 **검수 승인된 템플릿을 골라야만** 발송이 성립한다(템플릿이 없으면 보낼 방법이 없다).
 *   브랜드메시지는 **발신프로필만 있으면 전화번호로 바로** 나간다 — 자유형은 템플릿 코드를 요구하지 않고,
 *   기본형의 '템플릿'도 문안 검수가 아니라 변수 치환 발송 방식이다.
 *   그래서 진입 성격이 다르다: 알림톡 버튼 = 문안 고르러 가기 / 브랜드 버튼 = 이 수신자에게 바로 쓰기.
 *
 * 수신자 3방식 — 직접발송과 같은 축이되 세 번째만 다르다:
 *   직접입력 · 파일등록 = 전체 개방
 *   AI 타겟추출(주소록 자리) = 유료 요금제. 게이팅은 스팸필터·AI 다듬기와 **같은 기준**을 쓴다
 *   (새 축을 만들지 않는다). 잠긴 회사가 누르면 기존 PlanUpgradeModal이 그대로 뜬다.
 *
 * 타겟 추출은 `POST /api/customers/generate-from-text`를 재사용한다 —
 * 이미 `requirePlanFeature('ai_messaging')`로 게이팅된 CT다. 새 엔드포인트를 만들지 않는다.
 *
 * ★ 2026-07-31 셸을 `shared/SendWorkspaceShell`로 교체(화이트 고급형). 발송 로직·상태는 무변경 —
 *   바뀐 것은 표현뿐이다.
 */

import { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Megaphone, PencilLine, Upload, Lock, Trash2, Users, X, Search, Contact, Target } from 'lucide-react';
import BrandMessageEditor from './BrandMessageEditor';
import { WorkspaceNotice } from './shared/SendWorkspaceShell';
import KakaoSendHeader from './kakao-send/KakaoSendHeader';
import '../styles/direct-send.css';
import RecipientDirectInputModal, { type PastePreview } from './direct-send/RecipientDirectInputModal';
import {
  checkAlimtalkPaste, planAppend, pickPhoneColumn, phonesFromColumn, pickNameColumn,
  recipientFieldLabels, fieldsByPhone, firstFilledRecord, columnPhoneOf, RECIPIENT_NAME_LABEL,
} from '../utils/recipient-paste';
import { extractionFieldTable } from '../utils/customerFilterBuild';
import { DIRECT_FIELD_LABELS } from '../utils/formatDate';
import AddressBookModal from './AddressBookModal';
import DirectTargetFilterModal, { type FieldMeta } from './DirectTargetFilterModal';
import { fetchTargetExtractionRows, type TargetExtraction } from '../utils/target-extraction';
import ConfirmDialogShell, { DialogHeadline, DialogRow, DialogCaution } from './shared/ConfirmDialogShell';
import { BRAND_SPEC } from '../constants/brand-message-spec';

// ★ 2026-11-05 C107 D-05 · D-08 · D-09 — 받는 사람 4칸(문자 직접발송과 같은 칸 · 옛 「AI 타겟추출」 탭은 타겟추출 창 안 말로 고르기로 합침)
type RecipientMode = 'manual' | 'file' | 'address' | 'target';
type AddrRow = { phone: string; name: string; extra1: string; extra2: string; extra3: string };
const toAddrRow = (phone: string): AddrRow => ({ phone, name: '', extra1: '', extra2: '', extra3: '' });
const digitsOnly = (v: unknown) => String(v ?? '').replace(/\D/g, '');

/** ★ 2026-11-08 C117 D8 · ★1109 R86 — 인계 명단 한 행(번호 + 보기 칸 · 칸 이름 → 값 · 발송 글에 쓰지 않는다) */
export interface BrandRecipientSeed { phone: string; fields?: Record<string, string> }
/** 번호 → 칸 이름 → 값(보기 전용) */
type RecipientFieldMap = Record<string, Record<string, string>>;

export interface BrandSendModalProps {
  show: boolean;
  onClose: () => void;
  /** 발신프로필 목록. 비어 있으면 채널 연동 안내를 띄운다(요금제가 아니라 기술적 전제다) */
  profiles: any[];
  /**
   * 창 밖에서 들고 오는 명단(직접발송 · 직접 타겟 발송 · 알림톡 전환).
   * ★ 2026-11-08 C117 D8 — 번호와 보기용 이름을 한 행으로(Codex 설계 2R · 짝이 따로 어긋날 길 0 · 비우기 = 빈 배열 하나)
   */
  initialRecipients?: BrandRecipientSeed[];
  /** ★ 2026-11-05 C107 D-05 — 「타겟추출」 칸 잠김 = 문자 직접발송과 같은 축(고객 DB 잠금 · 대시보드 isCustomerDbLocked) */
  targetExtractLocked: boolean;
  /** 잠긴 「타겟추출」 칸을 눌렀다 — 대시보드가 잠금 창을 고른다(문자 직접발송과 같은 함수) */
  onTargetExtractLocked: () => void;
  /** 타겟추출 창의 말로 고르기 줄 숨김(대시보드 hideAi · 문자 직접발송과 같은 값) */
  hideAi?: boolean;
  /** ★ 2026-11-05 C107 D-18 — 대체 문자 보내는 번호 목록(등록 회신번호 · 대시보드가 받아 둔 값) */
  callbackNumbers?: Array<{ phone: string; label?: string; is_default?: boolean }>;
  /** 실제 발송 — BrandMessageEditor가 만든 payload에 수신자를 얹어 부모가 보낸다 */
  onSend: (payload: any) => Promise<void> | void;
  sending?: boolean;
  /**
   * ★ 2026-08-21 진입 출처. 기본 'direct'(직접발송 패널, violet · 수신자 3방식 그대로).
   *   'target' = 직접 타겟 발송에서 추출된 수신자를 들고 넘어온 경우: 인디고(콘솔 톤) + 수신자 입력 3방식을 숨기고
   *   **가져온 목록만** 보여준다(빼기만 가능). 알림톡 인계와 같은 "리스트 그대로 가져가기" 축.
   */
  entry?: 'direct' | 'target';
  /**
   * ★ 2026-09-20 설정에 등록된 080 수신거부 번호 — 부모(Dashboard)가 `/api/companies/settings`에서
   *   이미 받아 둔 값을 그대로 넘긴다(문자 직접발송과 같은 값). 편집기가 이 값으로 080 칸을 채워 잠근다.
   */
  optOutNumber?: string;
  /** ★ 2026-09-25 머리의 채널 전환(문자 발송 · 알림톡 발송) — 주면 버튼이 보인다. phones = 지금 명단(넘겨 쓰도록) */
  onSwitchChannel?: (to: 'sms' | 'alimtalk', phones: string[]) => void;
}

/**
 * ★ 2026-08-04 Harold 지정 — 화면에 펼치는 수신자 상한.
 *
 * AI 타겟추출은 조건에 맞는 대상을 **전량** 담는다(발송이 번호 배열을 그대로 받는 구조).
 * 그런데 그 전량을 textarea에 부으면 타이핑 한 번마다 목록 전체를 다시 파싱해 수만 명에서 멈춘다.
 * 데이터(phones)는 그대로 두고 **렌더만** 바꾼다 — 상한을 넘으면 편집 대신 확인용 목록을 보여준다.
 * 화면과 실제 발송 대상이 갈리지 않도록, 담긴 총 인원과 추출 조건을 함께 적는다.
 */
const RECIPIENT_EDIT_LIMIT = 1000;

// 번호 읽기 규칙 = utils/recipient-paste.ts checkAlimtalkPaste(★1105 C107 D-16 · 알림톡과 같은 읽기)
//   — 직접입력 창의 검수와 더하기가 같은 함수를 써야 "보인 수 = 더해진 수"(★ 2026-09-25).

export default function BrandSendModal({
  show, onClose, profiles, initialRecipients, targetExtractLocked, onTargetExtractLocked, hideAi = false, onSend, sending,
  entry = 'direct', optOutNumber, onSwitchChannel, callbackNumbers,
}: BrandSendModalProps) {
  const isTarget = entry === 'target';
  const accent = isTarget ? 'indigo' : 'violet';
  /** 강조색 표 — 좌측 수신자 패널에서 색이 드러나는 자리만. 값은 여기 하나만 갖는다 */
  const A = isTarget
    ? { count: 'text-indigo-600', badge: 'bg-indigo-600', focus: 'focus-within:ring-indigo-500/50' }
    : { count: 'text-violet-600', badge: 'bg-gradient-to-br from-violet-500 to-fuchsia-500', focus: 'focus-within:ring-violet-500/50' };
  const [mode, setMode] = useState<RecipientMode>('manual');
  /** target 진입: 넘어온 원래 인원(제외 수 표시용) + 목록 검색어 */
  const [seededCount, setSeededCount] = useState(0);
  const [listQuery, setListQuery] = useState('');
  /** 입력 중인 번호 — [수신자로 추가]를 눌러야 확정 목록(phones)에 들어간다(알림톡과 같은 축) */
  // ★ 2026-09-25 직접입력 = 공용 창(입력칸은 수신자 열에서 걷었다 · Harold 목업 v2)
  const [directInputOpen, setDirectInputOpen] = useState(false);
  const [addNotice, setAddNotice] = useState('');
  const [phones, setPhones] = useState<string[]>([]);
  /**
   * ★ 2026-11-08 C117 D8(Harold H2) → ★1109 R86 — 보기 칸(번호 숫자 → 칸 이름 → 값 · 파일 · 주소록 · 타겟추출 · 인계가 가진 칸 그대로)
   *   발송 · 중복 · 세대 규칙은 phones 하나 그대로 · 열 때 다시 만든다 · 칸 이름은 원천마다 CT(recipientFieldLabels) 한 번.
   */
  const [fields, setFields] = useState<RecipientFieldMap>({});
  // ★ C117 Codex 구현 1R #2 → ★1109 행 단위 — 값이 있는 번호의 묶음은 덮지도 섞지도 않는다(칸 바꾸기 · 겹친 번호가 다른 원천 값으로 바뀌거나 두 사람 값이 섞이지 않게 · 공용 규칙 firstFilledRecord) · 명단에서 빠진 번호의 칸은 아래 effect 가 걷는다(지운 뒤 다시 넣어도 옛 값 0)
  const mergeFields = (add: RecipientFieldMap) => {
    if (Object.keys(add).length === 0) return;
    setFields((prev) => {
      const next = { ...prev };
      for (const [p, f] of Object.entries(add)) next[p] = firstFilledRecord(prev[p], f);
      return next;
    });
  };
  useEffect(() => {
    setFields((prev) => {
      const keep = new Set(phones);
      const keys = Object.keys(prev);
      if (keys.every((k) => keep.has(k))) return prev;
      const next: RecipientFieldMap = {};
      for (const k of keys) if (keep.has(k)) next[k] = prev[k];
      return next;
    });
  }, [phones]);
  /**
   * ★ 2026-08-15 발송 확인 — 이 화면만 확인 없이 바로 나갔다(Harold 지적).
   *   문자·알림톡은 건수를 보여주는 확인 단계를 거치는데 브랜드만 버튼 한 번에 발송돼,
   *   광고성 메시지가 몇 명에게 나가는지 못 보고 누르는 구조였다. payload를 잡아 두고 확인 후 넘긴다.
   */
  const [pending, setPending] = useState<any | null>(null);
  /**
   * ★ 2026-09-25 확인 창을 연 순간의 명단(Codex 10R·11R). 확인 창의 건수와 실제 발송은 **이 명단만** 쓴다.
   *   확인 창이 떠 있는 동안 늦게 끝난 담기나 키보드로 닿는 뒤쪽 버튼이 화면 명단을 바꿔도, 나가는 것은 확인한 명단이다
   *   (문자·알림톡 = 명단을 먼저 적재하고 확인 창은 그 적재분만 확정하는 것과 같은 계약).
   */
  const [pendingPhones, setPendingPhones] = useState<string[]>([]);

  // ★ 2026-11-05 C107 — 중복제거(켜고 끔 · 기본 켬 · 알림톡 창과 같은 규칙 R31) · 주소록 · 타겟추출 · 파일 번호 칸 고르기 · 확인 창 수신거부 점검
  const [dedupEnabled, setDedupEnabled] = useState(true);
  const [showAddressBook, setShowAddressBook] = useState(false);
  const [showTargetExtract, setShowTargetExtract] = useState(false);
  const [targetLoading, setTargetLoading] = useState(false);
  /** 파일 번호 칸 고르기 — 표(머리 · 행)와 후보 · 마지막으로 쓴 칸(「다른 칸 고르기」) */
  /**
   * 파일 번호 칸 고르기 상태. used = 이미 담은 칸 · base = 그 칸을 담기 전 명단 · seq = 담은 직후 명단 세대.
   * ★ Codex 구현 2R(범위 밖 → 이번 축 D-08) — [다른 칸 고르기] = 앞서 담은 칸 번호를 **바꾼다**(base 에 새 칸을 더함 · 옛: 앞 칸 번호 위에 새 칸을 또 더했다).
   *   담은 뒤 명단이 바뀌었으면(seq 다름) 바꿀 근거가 없어 [다른 칸 고르기]를 감춘다.
   */
  const [colPick, setColPick] = useState<{ headers: string[]; rows: Record<string, unknown>[]; candidates: string[]; open: boolean; used?: string; base?: string[]; seq?: number } | null>(null);
  /** 확인 창 수신거부 점검(떠 둔 명단 기준 · null = 점검 전/실패) */
  const [unsubCheck, setUnsubCheck] = useState<{ excluded: number; dup: number } | null>(null);
  const checkSeqRef = useRef(0);
  /** 명단 세대 — 늦게 도착한 담기·파일 읽기 응답이 그 사이 바뀐 리스트를 덮어쓰는 것을 막는다(일괄발급 bulkReqSeqRef와 같은 방식) */
  const reqSeqRef = useRef(0);

  /**
   * ★ 2026-07-29 열릴 때 **전 상태를 되돌린다**(적대검증 high 수용).
   *   이 모달은 Dashboard에 계속 마운트된 채 show만 토글된다. 초기화하는 주인이 없으면
   *   직전 발송의 수신자가 그대로 남아, 빈 목록으로 다시 열어도 발송 가능 상태가 된다 = 오발송.
   *   진행 중이던 요청도 세대를 올려 무효화한다.
   */
  useEffect(() => {
    if (!show) return;
    reqSeqRef.current++;
    checkSeqRef.current++;
    const seeded = Array.from(new Set(
      (initialRecipients || []).map((r) => String(r?.phone ?? '').replace(/[^0-9]/g, '')).filter(Boolean),
    ));
    setPhones(seeded);
    // ★1109 R86 — 인계 행의 보기 칸(같은 번호 여러 행 = 값이 있는 앞 행 통째 · 공용 규칙 firstFilledRecord)
    const seededFields: RecipientFieldMap = {};
    for (const r of initialRecipients || []) {
      const p = String(r?.phone ?? '').replace(/[^0-9]/g, '');
      if (p) seededFields[p] = firstFilledRecord(seededFields[p], r?.fields ?? {});
    }
    setFields(seededFields);
    setSeededCount(seeded.length);
    setListQuery('');
    setDirectInputOpen(false); setAddNotice('');
    setMode('manual');
    setPending(null); setPendingPhones([]);
    setDedupEnabled(true); setShowAddressBook(false); setShowTargetExtract(false); setTargetLoading(false);
    setColPick(null); setUnsubCheck(null);
  }, [show]); // eslint-disable-line react-hooks/exhaustive-deps

  const hasProfile = (profiles || []).length > 0;
  const canSend = hasProfile && phones.length > 0;

  /**
   * ★ 사람이 수신자를 바꾸는 **유일한 통로**. 여기서만 세대를 올린다.
   *
   * 경로마다 손으로 무효화를 적으면 반드시 하나를 빠뜨린다 — 실제로 `비우기`와 `파일등록`이
   * 빠져서, AI 추출 중에 목록을 비워도 늦게 온 응답이 지운 수신자를 되살렸다(적대검증 실측).
   * 그건 오발송이다. 그래서 변경 경로를 하나로 좁힌다.
   */
  const setRecipients = (list: string[]) => {
    reqSeqRef.current++;          // 진행 중인 파일 읽기 · 타겟추출 담기 응답을 무효화한다
    setTargetLoading(false);
    setPhones(list);
  };
  /** 그 순간의 명단(prev)으로 정하는 갱신(주소록 불러오기 = appendUpdater · R31 「판정 = 갱신 함수 하나」) — 같은 세대 규칙 */
  const updateRecipients = (fn: (prev: string[]) => string[]) => {
    reqSeqRef.current++;
    setTargetLoading(false);
    setPhones((prev) => fn(prev));
  };

  /**
   * 입력창의 번호를 확정 목록에 **더한다**(덮어쓰지 않는다).
   * 여러 곳에서 모은 번호를 이어 붙일 수 있어야 해서 병합이 기본이고, 이미 담긴 번호는 조용히 버리지 않고
   * 몇 건이 중복이었는지 알린다 — 넣었는데 수가 안 늘면 사용자는 버튼이 고장난 줄로 읽는다.
   */
  //   ★ 2026-09-25 직접입력 창이 입력하는 동안 같은 식으로 검수를 보여 준다(planDraft 한 벌).
  // ★ 2026-11-05 C107 D-16 · R31 — 붙여넣기 = 알림톡과 같은 읽기(checkAlimtalkPaste · 10자리 이상) · 더하기 = planAppend(중복제거 켜고 끔)
  const planDraft = (text: string) => {
    const check = checkAlimtalkPaste(text);
    const plan = planAppend(check.phones, phones, dedupEnabled);
    return { check, added: plan.add, dupes: plan.dup };
  };
  const previewDraft = (text: string): PastePreview => {
    const { check, added, dupes } = planDraft(text);
    return {
      add: added.length,
      notes: dupes > 0
        ? [dedupEnabled
          ? { text: `중복 ${dupes.toLocaleString()} 제외`, tone: 'neutral' as const }
          : { text: `같은 번호 ${dupes.toLocaleString()} · 중복제거가 꺼져 있어 여러 번 나가요`, tone: 'warn' as const }]
        : [],
      invalid: check.invalid,
    };
  };
  const addFromDraft = (text: string) => {
    const { check, added, dupes } = planDraft(text);
    if (check.phones.length === 0) {
      setAddNotice(text.trim() ? '유효한 번호를 찾지 못했습니다 (10자리 이상 숫자).' : '번호를 입력해 주세요.');
      return;
    }
    setRecipients([...phones, ...added]);
    setAddNotice(
      added.length === 0
        ? `이미 담긴 번호입니다 (중복 ${dupes.toLocaleString()}건).`
        : `${added.length.toLocaleString()}명 추가${dedupEnabled && dupes > 0 ? ` · 중복 ${dupes.toLocaleString()}건 제외` : ''}`,
    );
  };

  /**
   * 고른 번호 칸에서 명단에 더한다(파일 = base 명단에 더하기 · 붙여넣기와 같은 중복 규칙) · 돌려줌 = 담은 뒤 상태(base · seq).
   *   base = 처음 담기면 지금 명단 · [다른 칸 고르기]면 앞 칸을 담기 전 명단(앞 칸 번호를 새 칸으로 바꾼다).
   */
  const addFromColumn = (column: string, rows: Record<string, unknown>[], base: string[], headers: readonly string[]): { base: string[]; seq: number } => {
    const list = phonesFromColumn(column, rows);
    // ★1109 R86 — 파일의 모든 칸(보기용 · 이름 칸 = 「이름」 · 고른 번호 칸 = 뺌 · 칸 이름은 이 파일 한 장에 한 번)
    mergeFields(fieldsByPhone(rows, columnPhoneOf(column), recipientFieldLabels(rows, { phoneKey: column, nameKey: pickNameColumn(headers) })));
    const plan = planAppend(list, base, dedupEnabled);
    setRecipients([...base, ...plan.add]);
    setAddNotice(list.length === 0
      ? `'${column}' 칸에서 휴대폰 번호를 찾지 못했어요. 다른 칸을 골라 주세요.`
      : `'${column}' 칸에서 ${plan.add.length.toLocaleString()}명 추가${dedupEnabled && plan.dup > 0 ? ` · 중복 ${plan.dup.toLocaleString()}건 제외` : ''}`);
    setMode('manual');
    return { base, seq: reqSeqRef.current };   // setRecipients 가 세대를 올린 뒤 값
  };
  /** 칸 고르기 창에서 칸 하나를 골랐다 — 이미 담은 칸이 있고 그 뒤 명단이 그대로면 그 칸을 바꾸고, 아니면 지금 명단에 더한다 */
  const pickColumn = (h: string) => {
    if (!colPick) return;
    const replace = !!colPick.used && colPick.seq === reqSeqRef.current && !!colPick.base;
    const done = addFromColumn(h, colPick.rows, replace ? colPick.base! : phones, colPick.headers);
    setColPick({ ...colPick, open: false, used: h, ...done });
  };

  const handleFile = async (file: File | null) => {
    if (!file) return;
    // 읽는 동안 명단이 바뀌면(삭제 · 추가 · 다른 불러오기 · 창 닫힘) 이 읽기 결과는 버린다(명단 세대 · 지운 번호가 되살아나지 않게).
    const seq = reqSeqRef.current;
    if (/\.txt$/i.test(file.name)) {
      const text = await file.text();
      if (seq !== reqSeqRef.current) { setAddNotice('파일을 읽는 동안 명단이 바뀌어 이번 파일은 넣지 않았어요. 다시 올려 주세요.'); return; }
      addFromDraft(text);
      setMode('manual');
      return;
    }
    // ★ 2026-11-05 C107 D-08 — 엑셀 · CSV = 문자 · 알림톡과 같은 입구(업로드 분석) → 번호 칸 하나만(D-16 · 매장 전화 · 회원번호 칸 제외)
    const form = new FormData();
    form.append('file', file);
    try {
      const res = await fetch('/api/upload/parse?includeData=true', { method: 'POST', headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` }, body: form });
      const data = await res.json();
      if (seq !== reqSeqRef.current) { setAddNotice('파일을 읽는 동안 명단이 바뀌어 이번 파일은 넣지 않았어요. 다시 올려 주세요.'); return; }
      if (!res.ok || !data?.success) { setAddNotice(data?.error || '파일을 읽지 못했어요.'); return; }
      const headers: string[] = data.headers || [];
      const rows: Record<string, unknown>[] = data.allData || data.preview || [];
      if (headers.length === 0) { setAddNotice('파일에서 칸을 찾지 못했어요.'); return; }
      const pick = pickPhoneColumn(headers, rows);
      if (pick.column) {
        const done = addFromColumn(pick.column, rows, phones, headers);
        setColPick({ headers, rows, candidates: pick.candidates, open: false, used: pick.column, ...done });
      } else {
        setColPick({ headers, rows, candidates: pick.candidates, open: true });
      }
    } catch {
      if (seq === reqSeqRef.current) setAddNotice('파일을 올리지 못했어요. 잠시 뒤 다시 시도해 주세요.');
    }
  };

  /** 주소록 창이 쓰는 줄 모양 ↔ 이 창의 번호 명단(불러오기 = 그 순간 명단에 더하기 · ★ C117 D8 이름은 보기용으로 함께 둔다) */
  const addrRows = useMemo(() => phones.map((p) => ({ ...toAddrRow(p), name: fields[p]?.[RECIPIENT_NAME_LABEL] || '' })), [phones, fields]);
  const setAddrRows: React.Dispatch<React.SetStateAction<AddrRow[]>> = (action) => {
    updateRecipients((prev) => {
      const next = typeof action === 'function' ? action(prev.map(toAddrRow)) : action;
      // ★1109 R86 — 주소록 칸(이름 · 기타1~3 · 문자 창과 같은 칸 이름) · 불러오기 한 번 = 원천 하나
      mergeFields(fieldsByPhone(next, (r) => digitsOnly(r.phone), recipientFieldLabels(next, { phoneKey: 'phone', nameKey: 'name', labelOf: (k) => DIRECT_FIELD_LABELS[k] })));
      return next.map((r) => digitsOnly(r.phone)).filter(Boolean);
    });
  };

  /**
   * ★ 2026-11-05 C107 D-05 — 타겟추출(문자 직접발송과 같은 창) 담기 = 조건으로 뽑은 대상 = 명단을 그것으로 바꾼다(옛 AI 타겟추출과 같은 규칙)
   * ★1109 R86 — 추출 창이 넘기는 항목(meta)으로 문자 · 알림톡 창과 같은 표(extractionRowsToTable · 같은 항목 이름 · 같은 표기)를 만들어 칸으로 둔다 · 명단 교체 = 칸도 교체
   */
  const handleTargetExtracted = async (ext: TargetExtraction, meta: FieldMeta[]) => {
    setShowTargetExtract(false);
    const seq = ++reqSeqRef.current;
    setTargetLoading(true);
    try {
      const r = await fetchTargetExtractionRows(ext);
      if (seq !== reqSeqRef.current) return;
      if (!r.ok) { setAddNotice(r.expired ? '담은 명단의 보관 시간이 지났습니다. 다시 추출해 주세요.' : (r.error || '명단을 불러오지 못했습니다.')); return; }
      const raw: any[] = r.data.recipients || [];
      const phoneAt = (i: number) => digitsOnly(raw[i]?.[ext.phoneField] ?? raw[i]?.phone);
      const list = raw.map((_, i) => phoneAt(i)).filter((p: string) => p.length >= 10);
      // 표 행 i = 원행 i(extractionRowsToTable = rows.map 1:1) → 번호는 원행 읽기 그대로 · 이름 항목이 없는 meta = 원행 이름 보존(CT)
      const t = extractionFieldTable(raw, meta);
      setFields(fieldsByPhone(t.rows, (_, i) => phoneAt(i), recipientFieldLabels(t.rows, { phoneKey: t.phoneKey, nameKey: t.nameKey })));
      const finalList = dedupEnabled ? Array.from(new Set(list)) as string[] : list;
      setRecipients(finalList);
      setAddNotice(`조건에 맞는 ${finalList.length.toLocaleString()}명을 담았습니다.${ext.skippedNoPhone > 0 ? ` (휴대폰 번호가 없는 ${ext.skippedNoPhone.toLocaleString()}명 제외)` : ''}`);
      setMode('manual');
    } finally {
      if (seq === reqSeqRef.current) setTargetLoading(false);
    }
  };

  /**
   * ★ 2026-11-05 C107 D-06 — 확인 창 수신거부 점검. 서버 거름(brand-message filterUnsubscribed)이 **출현마다** 빼므로
   *   돌려받은 번호 집합으로 떠 둔 명단의 출현을 센다(중복 허용 명단 [A, A, B] 에서 A 거부 = 실제 1건 · Codex 설계 1R #7).
   *   판정 CT = 서버 /api/unsubscribes/check(getUnsubscribedPhones · 발송과 같은 비교). 실패 = 안내 없이 진행(서버가 늘 거른다).
   */
  const runUnsubCheck = async (snap: string[]) => {
    const seq = ++checkSeqRef.current;
    setUnsubCheck(null);
    try {
      const res = await fetch('/api/unsubscribes/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
        body: JSON.stringify({ phones: snap }),
      });
      const data = await res.json();
      if (seq !== checkSeqRef.current || !res.ok) return;
      const blocked = new Set((data?.unsubscribePhones || []).map((x: any) => digitsOnly(x)));
      const excluded = snap.filter((x) => blocked.has(digitsOnly(x))).length;
      const dup = snap.length - new Set(snap.map((x) => digitsOnly(x))).size;
      setUnsubCheck({ excluded, dup });
    } catch { /* 안내 없이 진행 */ }
  };

  const modeTabs = useMemo(() => ([
    { key: 'manual' as RecipientMode, label: '직접입력', icon: PencilLine, locked: false },
    { key: 'file' as RecipientMode, label: '파일등록', icon: Upload, locked: false },
    { key: 'address' as RecipientMode, label: '주소록', icon: Contact, locked: false },
    { key: 'target' as RecipientMode, label: targetLoading ? '불러오는 중' : '타겟추출', icon: Target, locked: targetExtractLocked },
  ]), [targetExtractLocked, targetLoading]);
  // ★ 2026-09-25 카카오 발송 창 틀(Harold 목업 v2) — 수신자 열을 직접발송과 같은 모양으로(탭 · 합계 · 검색 · 10줄 목록 · 선택삭제).
  //   수신자를 바꾸는 길은 위 setRecipients 하나 그대로다(늦게 온 AI 응답 무효화 포함). 여기는 보여 주는 방식만 다르다.
  const [listPage, setListPage] = useState(0);
  const [listSelected, setListSelected] = useState<Set<number>>(new Set());
  const [dragActive, setDragActive] = useState(false);
  const dropInputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => { setListSelected(new Set()); setListPage(0); }, [phones]);
  // ESC 닫기 — 옛 공용 틀(SendWorkspaceShell)이 하던 일 그대로. 안쪽 풍선·고르기 창은 캡처 단계에서 먼저 잡는다.
  useEffect(() => {
    if (!show) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [show, onClose]);

  const removedCount = Math.max(0, seededCount - phones.length);
  const LIST_PAGE_SIZE = 10;
  const listDigits = listQuery.replace(/[^0-9]/g, '');
  // ★ C117 D8 → ★1109 R86 — 검색 = 번호 또는 칸 값
  const listText = listQuery.trim();
  const listFiltered = phones.map((p, idx) => ({ p, idx })).filter((r) => !listText || (listDigits && r.p.includes(listDigits)) || Object.values(fields[r.p] || {}).some((v) => v.includes(listText)));
  /** ★1109 R86 — 표 칸 = 「이름」 맨 앞(늘 둔다 · C117 과 같게) + 지금 명단 번호 순서로 처음 나온 칸 이름 */
  const fieldCols = useMemo(() => {
    const cols = [RECIPIENT_NAME_LABEL];
    const seen = new Set(cols);
    for (const p of phones) for (const k of Object.keys(fields[p] || {})) if (!seen.has(k)) { seen.add(k); cols.push(k); }
    return cols;
  }, [phones, fields]);
  const listTotalPages = Math.max(1, Math.ceil(listFiltered.length / LIST_PAGE_SIZE));
  const listCurrentPage = Math.min(listPage, listTotalPages - 1);
  const listPageItems = listFiltered.slice(listCurrentPage * LIST_PAGE_SIZE, (listCurrentPage + 1) * LIST_PAGE_SIZE);
  // ★Codex 3R — 선택 범위 = 지금 보이는 목록(검색 결과). 머리 체크박스가 숨은 줄까지 고르면 선택 제외가 안 보이는 번호를 지운다
  const listVisibleIdx = listFiltered.map((r) => r.idx);
  const listAllVisibleChecked = listVisibleIdx.length > 0 && listVisibleIdx.every((i) => listSelected.has(i));

  const recipientsPanel = (
    <section className="ds-recipients ks-recipients">
      {isTarget ? (
        // target 진입 = 가져온 목록만. 번호를 더 넣는 길을 열면 "조건 = 대상"이 깨진다 → 빼기만 둔다.
        <div className="rounded-2xl bg-white ring-1 ring-slate-900/5 shadow-sm px-4 py-3 flex items-center gap-3">
          <div className={`h-9 w-9 rounded-xl ${A.badge} text-white grid place-items-center shrink-0`}>
            <Users size={16} strokeWidth={1.9} />
          </div>
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-slate-900">직접 타겟 발송에서 가져온 수신자</p>
            <p className="text-[11.5px] text-slate-500 mt-0.5">
              추출된 {seededCount.toLocaleString()}명{removedCount > 0 ? ` · ${removedCount.toLocaleString()}명 제외` : ''} · 여기서는 빼기만 할 수 있습니다
            </p>
          </div>
        </div>
      ) : (
        <div className="ds-rtab-group">
          {modeTabs.map((t) => (t.key === 'file' ? (
            <label key={t.key} className={`ds-rtab ds-rtab--label ${mode === 'file' ? 'ds-rtab--on' : ''}`}>
              <t.icon size={17} strokeWidth={1.75} />
              <span>{t.label}</span>
              <input type="file" accept=".xlsx,.xls,.csv,.txt" className="hidden"
                onChange={(e) => { setMode('file'); handleFile(e.target.files?.[0] || null); e.target.value = ''; }} />
            </label>
          ) : (
            <button key={t.key} type="button"
              className={`ds-rtab ${mode === t.key ? 'ds-rtab--on' : ''}`}
              onClick={() => {
                if (t.key === 'target' && t.locked) { onTargetExtractLocked(); return; }
                setMode(t.key);
                if (t.key === 'manual') setDirectInputOpen(true);
                if (t.key === 'address') setShowAddressBook(true);
                if (t.key === 'target') setShowTargetExtract(true);
              }}>
              <t.icon size={17} strokeWidth={1.75} />
              <span>{t.label}</span>
              {t.locked && <Lock size={12} strokeWidth={2.2} className="text-slate-300" />}
            </button>
          )))}
        </div>
      )}

      {/* ★ 2026-09-25 직접입력은 창으로(수신자 열에 입력칸 없음). 더한 결과 안내는 방식과 무관하게 보인다 —
          예전엔 직접입력 방식일 때만 보여 파일 읽기 중단 안내가 파일 방식에서 가려졌다. */}
      {!isTarget && addNotice && <p className="text-[11.5px] text-violet-600 px-0.5 m-0">{addNotice}</p>}
      {!isTarget && colPick && !colPick.open && colPick.used && colPick.seq === reqSeqRef.current && (
        <button type="button" onClick={() => setColPick({ ...colPick, open: true })}
          className="self-start text-[11.5px] font-semibold text-violet-600 underline underline-offset-2 m-0 p-0 bg-transparent">
          다른 칸 고르기
        </button>
      )}

      {!isTarget && mode === 'file' && (
        <p className="ks-note">엑셀 · CSV · TXT 파일에서 휴대폰 번호 칸을 골라 목록에 더해요. 위 [파일등록]을 누르거나 아래 칸에 끌어다 놓으세요.</p>
      )}

      {/* ★ 2026-11-05 C107 D-04 · D-06(접수 T4) — 중복제거(켜고 끔) · 수신거부제거(브랜드는 서버가 늘 뺀다 = 잠긴 켬) */}
      {!isTarget && (
        <div className="ds-filter-row">
          <label>
            <input type="checkbox" className="ds-chk ds-chk--purple" checked={dedupEnabled} onChange={(e) => setDedupEnabled(e.target.checked)} />
            <span>중복제거</span>
          </label>
          <label title="브랜드메시지는 수신거부한 번호를 늘 빼고 보냅니다">
            <input type="checkbox" className="ds-chk ds-chk--purple" checked disabled readOnly />
            <span>수신거부제거 · 브랜드는 항상</span>
          </label>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="ds-count-wrap">
          <span className="ds-count-label">총</span>
          <span className="ds-count-num">{phones.length.toLocaleString()}</span>
          <span className="ds-count-label">명</span>
        </div>
        <div className="ds-search-wrap">
          <Search size={15} strokeWidth={1.75} />
          <input type="text" className="ds-search-in" placeholder="번호 · 이름 · 항목 검색" value={listQuery}
            onChange={(e) => { setListQuery(e.target.value); setListPage(0); setListSelected(new Set()); }} />
        </div>
      </div>

      <div className="ds-list-frame">
        {/* ★1109 R86 · R85 — 머리 · 줄 = 한 그릇(가로 · 세로 · 머리는 위에 붙음) · 격자 = 칸 수만큼(direct-send.css .ks-list-scroll) */}
        <div className="ks-list-scroll" style={{ '--ks-cols': fieldCols.length } as React.CSSProperties}>
        <div className="ds-list-head">
          <label className="flex items-center cursor-pointer">
            <input type="checkbox" className="ds-chk ds-chk--lg ds-chk--purple"
              checked={listAllVisibleChecked}
              disabled={listVisibleIdx.length === 0}
              onChange={(e) => setListSelected(e.target.checked
                ? new Set([...listSelected, ...listVisibleIdx])
                : new Set([...listSelected].filter((i) => !listVisibleIdx.includes(i))))}
              aria-label="전체 선택" />
          </label>
          <span>수신번호</span>
          {fieldCols.map((c) => <span key={c} title={c}>{c}</span>)}
        </div>
        {phones.length === 0 ? (
          <div className="ds-list-empty">
            {isTarget ? (
              <p className="m-auto text-[12.5px] text-slate-500 text-center">수신자가 모두 제외됐습니다. 창을 닫고 타겟을 다시 가져오세요.</p>
            ) : (
              <>
                <div
                  className={`ds-dropzone ds-t w-full ${dragActive ? 'ds-dropzone--active' : ''}`}
                  onClick={() => dropInputRef.current?.click()}
                  onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setDragActive(true); }}
                  onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragActive(true); }}
                  onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setDragActive(false); }}
                  onDrop={(e) => {
                    e.preventDefault(); e.stopPropagation();
                    setDragActive(false);
                    handleFile(e.dataTransfer?.files?.[0] || null);
                  }}
                >
                  <div>
                    <div className="text-[14px] font-semibold text-stone-800">번호를 넣거나 파일을 올려 주세요</div>
                    <div className="text-[12.5px] text-stone-500 mt-1">엑셀 · CSV · TXT에서 휴대폰 번호 칸을 골라 읽어요 · 주소록 · 타겟추출로 불러올 수도 있어요</div>
                  </div>
                  <div className="flex items-center justify-center flex-wrap gap-x-2 gap-y-1 mt-1">
                    <span className="ds-btn-sec px-4 pointer-events-none whitespace-nowrap border border-violet-200 bg-violet-50 text-violet-700">
                      <Upload size={14} strokeWidth={1.75} />
                      <span>파일 선택</span>
                    </span>
                    <span className="text-[12px] text-stone-400 whitespace-nowrap">또는 여기로 드래그</span>
                  </div>
                </div>
                <input ref={dropInputRef} type="file" accept=".xlsx,.xls,.csv,.txt" className="hidden"
                  onChange={(e) => { handleFile(e.target.files?.[0] || null); e.target.value = ''; }} />
              </>
            )}
          </div>
        ) : (
            <div className="ds-list-body">
              {listPageItems.length === 0 ? (
                <div className="py-12 text-center text-stone-400 text-[13px]">"{listQuery}" 검색 결과가 없어요</div>
              ) : (
                listPageItems.map(({ p, idx }) => (
                  <div key={`${p}-${idx}`} className="ds-list-row">
                    <label className="flex items-center cursor-pointer">
                      <input type="checkbox" className="ds-chk ds-chk--purple" checked={listSelected.has(idx)}
                        onChange={(e) => {
                          const next = new Set(listSelected);
                          if (e.target.checked) next.add(idx); else next.delete(idx);
                          setListSelected(next);
                        }}
                        aria-label={`${p} 선택`} />
                    </label>
                    <span className="ds-num text-stone-800 font-medium">{p}</span>
                    {fieldCols.map((c) => {
                      const v = fields[p]?.[c] || '';
                      return <span key={c} className="text-[13px] text-stone-600" title={v || undefined}>{v || '-'}</span>;
                    })}
                  </div>
                ))
              )}
            </div>
        )}
        </div>
        {phones.length > 0 && listTotalPages > 1 && (
          <div className="ds-page">
            <button type="button" onClick={() => setListPage((n) => Math.max(0, n - 1))} disabled={listCurrentPage === 0}>이전</button>
            <span className="ds-page-num">{listCurrentPage + 1} / {listTotalPages}</span>
            <button type="button" onClick={() => setListPage((n) => Math.min(listTotalPages - 1, n + 1))} disabled={listCurrentPage >= listTotalPages - 1}>다음</button>
          </div>
        )}
      </div>

      <div className="ds-bottom-actions">
        <div className="flex items-center gap-1">
          <button type="button" className="ds-ter ds-ter--danger ds-t" disabled={listSelected.size === 0}
            onClick={() => { setRecipients(phones.filter((_, i) => !listSelected.has(i))); }}>
            <Trash2 size={13} strokeWidth={1.75} />
            <span>{isTarget ? '선택 제외' : '선택삭제'}</span>
          </button>
          {!isTarget && (
            <button type="button" className="ds-ter ds-ter--danger ds-t" disabled={phones.length === 0}
              onClick={() => { setRecipients([]); setAddNotice(''); }}>
              <X size={13} strokeWidth={1.75} />
              <span>전체삭제</span>
            </button>
          )}
        </div>
      </div>
    </section>
  );

  // 확인 다이얼로그에 적을 유형 — payload가 화면 선택값을 그대로 갖고 있다
  //   유형은 규격 사본의 한글 이름으로 적는다 — 내부 코드(CAROUSEL_FEED 등)를 화면에 내지 않는다
  const pendingTypeLabel = pending
    ? `브랜드메시지 ${pending.mode === 'template' ? '기본형' : (BRAND_SPEC[String(pending.bubbleType || 'TEXT')]?.label || '텍스트')}`
    : '';

  if (!show) return null;

  return createPortal(
    // 겹침 2000 = 옛 공용 틀과 같은 층(요금제 안내 · 확인 창 2100이 이 위에 뜬다)
    <div
      className="ds-scope ds-backdrop"
      style={{ zIndex: 2000 }}
      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
      onDrop={(e) => { e.preventDefault(); e.stopPropagation(); }}
    >
      <div className="ds-modal" role="dialog" aria-modal="true" aria-label="브랜드메시지 발송">
        <KakaoSendHeader
          channel="brand"
          title="브랜드메시지 발송"
          subtitle={isTarget
            ? `추출된 ${phones.length.toLocaleString()}명에게 브랜드메시지를 발송합니다`
            : '검수 없이 바로 보내요 · 발신프로필이 연동돼 있으면 전화번호로 도착해요'}
          onSwitch={onSwitchChannel ? (to) => onSwitchChannel(to === 'alimtalk' ? 'alimtalk' : 'sms', phones) : undefined}
          onClose={onClose}
        />
        {!hasProfile && (
          <div className="shrink-0 px-6 pt-3">
            <WorkspaceNotice>
              카카오 채널 연동(발신프로필 등록)이 필요합니다. 발신프로필이 등록되면 요금제와 무관하게 바로 사용할 수 있습니다.
            </WorkspaceNotice>
          </div>
        )}
        <BrandMessageEditor
        profiles={profiles}
        sending={!!sending}
        accent={accent}
        recipientCount={phones.length}
        defaultUnsubPhone={optOutNumber}
        callbackNumbers={callbackNumbers}
        onSend={(payload: any) => {
          if (!canSend) return;
          // ★ 2026-09-25 확인을 기다리는 동안은 새 보내기를 받지 않는다(Codex 12R) — 확인 창은 포커스를 옮기지 않아
          //   Enter 가 뒤쪽 보내기 버튼으로 다시 들어가면 떠 둔 명단이 그 사이 바뀐 명단으로 교체됐다(건수가 같으면 알 수 없음).
          if (pending) return;
          // 바로 보내지 않는다 — 건수를 보여주고 확인을 받는다(문자·알림톡과 같은 계약)
          // ★ 2026-09-25 확인 창을 연 순간의 명단을 떠 둔다 — 건수 표시와 발송은 이 명단만 쓴다(Codex 10R·11R)
          const snap = phones.slice();
          setPendingPhones(snap);
          setPending(payload);
          void runUnsubCheck(snap);
        }}
          recipientsPanel={recipientsPanel}
        />
      </div>

      <RecipientDirectInputModal
        open={directInputOpen && !isTarget}
        onClose={() => setDirectInputOpen(false)}
        tone="violet"
        unit="명"
        currentCount={phones.length}
        pasteHint="메모장·엑셀에서 복사해 붙여넣기 · 줄바꿈·쉼표로 구분"
        pastePlaceholder={'01012345678\n01087654321\n01011112222'}
        previewPaste={previewDraft}
        onSubmitPaste={addFromDraft}
      />

      {/* ★ 2026-11-05 C107 D-09 — 주소록(번호만 · 불러오기 = 지금 명단에 더하기 · 중복 규칙 = 이 창 [중복제거] · R31) */}
      <AddressBookModal
        show={showAddressBook && !isTarget}
        onClose={() => setShowAddressBook(false)}
        directRecipients={addrRows}
        setDirectRecipients={setAddrRows}
        setToast={(t) => setAddNotice(t.message)}
        dedupOnAdd={dedupEnabled}
      />

      {/* ★ 2026-11-05 C107 D-05 — 타겟추출(문자 직접발송과 같은 창 · 말로 고르기 줄 포함) */}
      {showTargetExtract && !isTarget && (
        <DirectTargetFilterModal
          show
          onClose={() => setShowTargetExtract(false)}
          onExtracted={(ext, meta) => { void handleTargetExtracted(ext, meta); }}
          hideAi={hideAi}
        />
      )}

      {/* ★ 2026-11-05 C107 D-08 — 파일 번호 칸 고르기(휴대폰 꼴 칸이 하나가 아니거나 [다른 칸 고르기]) */}
      {colPick?.open && !isTarget && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/45 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) setColPick({ ...colPick, open: false }); }}>
          <div role="dialog" aria-modal="true" aria-label="휴대폰 번호 칸 고르기" className="w-full max-w-[460px] rounded-2xl bg-white p-5 shadow-2xl">
            <p className="m-0 text-[15px] font-bold text-slate-900">어느 칸이 휴대폰 번호인가요?</p>
            <p className="m-0 mt-1 text-[12px] text-slate-500">{colPick.used ? `지금 '${colPick.used}' 칸 번호가 담겨 있어요. 고른 칸 번호로 바꿉니다.` : colPick.candidates.length === 0 ? '휴대폰 번호로 보이는 칸을 찾지 못했어요. 번호 칸을 골라 주세요.' : '보낼 번호 칸 하나를 골라 주세요. 휴대폰 번호로 보이는 칸을 표시했어요.'}</p>
            <div className="mt-3 flex max-h-[50vh] flex-col gap-1.5 overflow-y-auto">
              {colPick.headers.map((h) => (
                <button key={h} type="button"
                  onClick={() => pickColumn(h)}
                  className={`rounded-xl border px-3 py-2 text-left transition hover:border-violet-300 ${colPick.candidates.includes(h) ? 'border-violet-200 bg-violet-50/50' : 'border-slate-200 bg-white'}`}>
                  <span className="block text-[13px] font-semibold text-slate-800">{h}</span>
                  <span className="block truncate text-[11.5px] text-slate-500">{colPick.rows.slice(0, 3).map((r) => String(r?.[h] ?? '')).filter(Boolean).join(' · ') || '(값 없음)'}</span>
                </button>
              ))}
            </div>
            <div className="mt-4 flex justify-end">
              <button type="button" onClick={() => setColPick({ ...colPick, open: false })} className="h-9 rounded-xl px-4 text-[13px] font-semibold text-slate-600 hover:bg-slate-100">닫기</button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialogShell
        show={!!pending}
        tone={accent}
        icon={<Megaphone size={18} strokeWidth={1.9} className="text-white" />}
        title="지금 바로 발송합니다"
        subtitle="광고성 메시지입니다. 누르는 즉시 나가며 회수할 수 없습니다."
        cancelLabel="취소"
        onCancel={() => { checkSeqRef.current++; setPending(null); setPendingPhones([]); setUnsubCheck(null); }}
        confirmLabel="즉시 발송"
        onConfirm={async () => {
          const payload = pending;
          const sendPhones = pendingPhones;
          if (!payload) return;
          checkSeqRef.current++;
          setPending(null); setPendingPhones([]); setUnsubCheck(null);
          await onSend({ ...payload, phones: sendPhones });
        }}
        busy={!!sending}
        busyLabel="접수 중..."
        confirmDisabled={pendingPhones.length === 0}
      >
        <DialogHeadline label="발송 대상" value={pendingPhones.length} unit="명" tone={accent} />
        <div className="mt-3">
          {unsubCheck && unsubCheck.excluded > 0 && (
            <>
              <DialogRow label="수신거부로 빠짐" value={`${unsubCheck.excluded.toLocaleString()}건`} accent="amber" />
              <DialogRow label="실제 발송" value={`${Math.max(0, pendingPhones.length - unsubCheck.excluded).toLocaleString()}건`} />
            </>
          )}
          {unsubCheck && unsubCheck.dup > 0 && (
            <DialogRow label="같은 번호" value={`${unsubCheck.dup.toLocaleString()}건 · 여러 번 나갑니다`} accent="amber" />
          )}
          <DialogRow label="메시지 유형" value={pendingTypeLabel} />
          <DialogRow
            label="광고 표기"
            value={pending?.isAd === false ? '표기 안 함' : '(광고) 표기'}
            accent={pending?.isAd === false ? 'amber' : 'slate'}
          />
          {pending?.resendType && pending.resendType !== 'NO' && (
            <DialogRow label="실패 시 대체발송" value={pending.resendType === 'LM' ? 'LMS' : 'SMS'} />
          )}
        </div>
        <DialogCaution tone="rose">
          발송이 시작되면 중간에 멈추거나 되돌릴 수 없습니다. 문구와 수신자를 다시 한번 확인해 주세요.
        </DialogCaution>
      </ConfirmDialogShell>
    </div>,
    document.body,
  );
}