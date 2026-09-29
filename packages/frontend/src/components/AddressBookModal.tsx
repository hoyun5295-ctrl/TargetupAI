import React, { useState } from 'react';
import {
  Contact, Plus, X, ArrowDownToLine, UserPlus, FileSpreadsheet, Trash2, Search, ChevronLeft,
  PencilLine, Upload, Users, Check, Info, Loader2, Inbox,
} from 'lucide-react';
import { cellToString } from '../utils/formatDate';
import ConfirmModal, { type ConfirmState } from './ConfirmModal';

/**
 * ★ 2026-09-27 한줄로 V2 R061 — 주소록 그룹 = (주인, 이름). 이름은 사용자마다 따로 만들어지므로 관리자 화면에는
 *   같은 이름이 여러 줄일 수 있다(owner_name으로 구분). 서버 요청마다 주인(owner)을 함께 보낸다 — 옛: 이름만 보내
 *   관리자 조회·추가·삭제가 여러 사람의 같은 이름 그룹에 한꺼번에 닿았다. owner 없는 옛 행 = 'none'.
 */
type AddressGroup = { group_name: string; count: number | string; owner_id?: string | null; owner_name?: string | null };
const groupKey = (g: AddressGroup) => `${g.owner_id ?? 'none'}::${g.group_name}`;
const ownerParam = (g: AddressGroup) => `owner=${encodeURIComponent(g.owner_id ?? 'none')}`;
// PG COUNT 는 문자열로 온다 — 합계·자리 표시 전에 숫자로 바꾼다
const groupCount = (g: AddressGroup) => Number(g.count) || 0;

type Contact5 = { phone: string; name: string; extra1: string; extra2: string; extra3: string };
const emptyRows = (n = 5): Contact5[] => Array.from({ length: n }, () => ({ phone: '', name: '', extra1: '', extra2: '', extra3: '' }));

/**
 * ★ 2026-09-29 주소록 창 개편(Harold "모달이 너무 올드하다 · 직접발송 디자인과 맞춰라" · 목업 승인).
 *   왼쪽 = 저장된 주소록(여러 개 고르기) · 오른쪽 = 고른 주소록 미리보기(앞 10명 · 서버 검색) · [새 주소록] = 직접 입력 · 파일 · 지금 수신자 세 탭.
 *   서버 요청(저장·추가·불러오기·받기·삭제)은 옛 창과 한 글자도 다르지 않다 — 화면 구성만 바뀌었다.
 */
type Panel = { kind: 'view' } | { kind: 'create'; tab: 'direct' | 'file' | 'current' } | { kind: 'append' };

// 직접발송 창(styles/direct-send.css · stone/emerald/amber · Pretendard)과 같은 색·모양
const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500';
const BTN = `inline-flex items-center justify-center gap-[7px] h-[38px] px-3.5 rounded-[10px] border text-[13.5px] font-bold whitespace-nowrap transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${FOCUS}`;
const BTN_EM = `${BTN} border-transparent bg-emerald-600 text-white shadow-[0_1px_2px_rgb(5_150_105/.25)] hover:bg-emerald-700`;
const BTN_LINE = `${BTN} border-stone-200 bg-white text-stone-700 hover:border-stone-300 hover:bg-stone-50`;
const BTN_DARK = `${BTN} border-transparent bg-stone-900 text-white hover:bg-black`;
const BTN_GHOST_RO = `${BTN} border-transparent bg-transparent text-rose-600 px-2.5 hover:bg-rose-50`;
const ICON_BTN = `w-9 h-9 rounded-[10px] grid place-items-center text-stone-500 hover:bg-stone-100 hover:text-stone-800 disabled:opacity-30 disabled:cursor-not-allowed ${FOCUS}`;
const SCROLL = '[&::-webkit-scrollbar]:w-2.5 [&::-webkit-scrollbar]:h-2.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-stone-200 [&::-webkit-scrollbar-thumb]:border-[3px] [&::-webkit-scrollbar-thumb]:border-solid [&::-webkit-scrollbar-thumb]:border-transparent [&::-webkit-scrollbar-thumb]:bg-clip-content';
const INPUT = `h-[42px] px-[13px] rounded-[11px] border border-stone-200 bg-white text-[14px] text-stone-900 placeholder:text-stone-400 ${FOCUS}`;
const TH = 'sticky top-0 z-[1] bg-stone-50 text-left text-[12px] font-bold text-stone-500 px-3.5 py-2.5 border-b border-stone-150 whitespace-nowrap';
const FILE_FIELDS: Array<{ key: keyof Contact5; label: string; required?: boolean }> = [
  { key: 'phone', label: '수신번호', required: true },
  { key: 'name', label: '이름' },
  { key: 'extra1', label: '기타1' },
  { key: 'extra2', label: '기타2' },
  { key: 'extra3', label: '기타3' },
];

interface AddressBookModalProps {
  show: boolean;
  onClose: () => void;
  directRecipients: { phone: string; name: string; extra1: string; extra2: string; extra3: string }[];
  setDirectRecipients: React.Dispatch<React.SetStateAction<{ phone: string; name: string; extra1: string; extra2: string; extra3: string }[]>>;
  setToast: (t: { show: boolean; type: 'error' | 'success'; message: string }) => void;
}

export default function AddressBookModal({
  show,
  onClose,
  directRecipients,
  setDirectRecipients,
  setToast,
}: AddressBookModalProps) {
  const [addressGroups, setAddressGroups] = useState<AddressGroup[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [panel, setPanel] = useState<Panel>({ kind: 'view' });
  // 휴대폰 폭 = 한 칸씩(목록 → 오른쪽 칸)
  const [mobileDetail, setMobileDetail] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [addressFileName, setAddressFileName] = useState('');
  const [addressFileHeaders, setAddressFileHeaders] = useState<string[]>([]);
  const [addressFileData, setAddressFileData] = useState<any[]>([]);
  const [addressColumnMapping, setAddressColumnMapping] = useState<{[key: string]: string}>({});
  const [fileDragOver, setFileDragOver] = useState(false);

  // ★ 2026-09-28 R060 — 조회 = 서버 검색 + 상위 10건 + 전체 건수(그룹 전체를 받지 않는다)
  const [addressViewGroup, setAddressViewGroup] = useState<string | null>(null);
  const [addressViewContacts, setAddressViewContacts] = useState<any[]>([]);
  const [addressViewSearch, setAddressViewSearch] = useState('');
  const [addressViewTotal, setAddressViewTotal] = useState(0);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewTick, setPreviewTick] = useState(0);
  const addressViewTargetRef = React.useRef<AddressGroup | null>(null);
  const addressViewSeqRef = React.useRef(0);
  const loadAddressView = async (g: AddressGroup, q: string) => {
    const seq = ++addressViewSeqRef.current;
    setPreviewLoading(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/address-books/${encodeURIComponent(g.group_name)}?${ownerParam(g)}&limit=10&q=${encodeURIComponent(q)}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (seq !== addressViewSeqRef.current) return;
      if (!data.success) {
        setAddressViewContacts([]);
        setAddressViewTotal(0);
        setPreviewError(data.error || '명단을 읽지 못했어요.');
        return;
      }
      setPreviewError(null);
      setAddressViewContacts(data.contacts || []);
      setAddressViewTotal(Number(data.total) || 0);
    } catch {
      if (seq === addressViewSeqRef.current) setPreviewError('명단을 읽지 못했어요. 주소록을 다시 골라 주세요.');
    } finally {
      if (seq === addressViewSeqRef.current) setPreviewLoading(false);
    }
  };
  // 고른 주소록이 바뀌면 바로, 찾는 글이 바뀌면 0.3초 뒤에 미리보기를 다시 읽는다(늦게 온 옛 응답은 세대로 버린다)
  React.useEffect(() => {
    const g = addressViewTargetRef.current;
    if (!show || !addressViewGroup || !g) return;
    const t = setTimeout(() => { void loadAddressView(g, addressViewSearch); }, addressViewSearch ? 300 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, addressViewGroup, addressViewSearch, previewTick]);
  const selectGroup = (g: AddressGroup | null) => {
    addressViewTargetRef.current = g;
    addressViewSeqRef.current++;
    setAddressViewSearch('');
    setAddressViewContacts([]);
    setAddressViewTotal(0);
    setPreviewError(null);
    setPreviewLoading(!!g);
    setAddressViewGroup(g ? groupKey(g) : null);
    setPreviewTick((t) => t + 1);
  };

  // ★ D144 P3 (2026-05-06): 다중 선택 + 직접 입력
  const [selectedGroupNames, setSelectedGroupNames] = useState<Set<string>>(new Set());
  const [directInputRows, setDirectInputRows] = useState<Contact5[]>(emptyRows());

  // ★ D185 (2026-05-20): 사용자 신고 — 대량 업로드(130,962건+) 시 로딩 안내 영역 누락 사고
  //   업로드 4 영역(직접입력 등록 / 파일 파싱 / 컬럼 매핑 저장 / 현재 수신자 저장) 영역에 로딩 오버레이 적용
  //   업로드 중 영역 = 모달 close 영역 차단 (중간 X 사고 영구 안전망)
  const [isUploading, setIsUploading] = useState(false);
  const [uploadingMsg, setUploadingMsg] = useState('주소록을 처리하고 있어요');
  /**
   * ★ 2026-09-25 명단 불러오기(그룹 [불러오기] · 선택 그룹 일괄) — 불러오는 동안 가림막 + [불러오기 취소].
   *   예전에는 응답을 기다리는 동안 창을 닫으면, 닫은 뒤 늦게 온 응답이 그 사이 사람이 고친 발송 명단을 통째로 덮었다
   *   (브랜드·알림톡 창의 늦은 응답 규칙과 같은 뿌리 · Harold "주소록 경합도 같이").
   *   세대: 취소하거나 창이 닫히거나(숨김·언마운트) 새 불러오기가 시작되면 앞 응답은 명단에 쓰지 않는다.
   *   ⛔ 닫기를 잠그지 않는다 — 응답이 끝나지 않으면 영구히 갇힌다(Codex 12R). 닫기 = 취소다.
   */
  const [listLoading, setListLoading] = useState(false);
  const [listLoadingLabel, setListLoadingLabel] = useState('');
  const loadSeqRef = React.useRef(0);
  React.useEffect(() => () => { loadSeqRef.current++; }, []);

  // ★ D219+ Part 2 (2026-05-27): 박과장님 신고 — 기존 그룹에 번호 추가 모드
  //   null = 신규 그룹 신설 모드 / 그룹 = 기존 그룹 (append endpoint 호출 분기 · ★ R061 주인 포함)
  const [appendingGroup, setAppendingGroup] = useState<AddressGroup | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  const showError = (message: string) => {
    setToast({ show: true, type: 'error', message });
    setTimeout(() => setToast({ show: false, type: 'error', message: '' }), 3000);
  };
  const showSuccess = (message: string) => {
    setToast({ show: true, type: 'success', message });
    setTimeout(() => setToast({ show: false, type: 'success', message: '' }), 3000);
  };

  /** 그룹 목록 다시 읽기 → 고를 주소록: 방금 저장한 이름 → 지금 고른 것 → 맨 위 */
  const refreshGroups = async (prefer?: { key?: string; name?: string }) => {
    const token = localStorage.getItem('token');
    const groupRes = await fetch('/api/address-books/groups', { headers: { Authorization: `Bearer ${token}` } });
    const groupData = await groupRes.json();
    if (!groupData.success) return;
    const gs: AddressGroup[] = groupData.groups || [];
    setAddressGroups(gs);
    const next = (prefer?.key && gs.find((g) => groupKey(g) === prefer.key))
      || (prefer?.name && gs.find((g) => g.group_name === prefer.name))
      || (addressViewGroup && gs.find((g) => groupKey(g) === addressViewGroup))
      || gs[0] || null;
    selectGroup(next);
  };

  const resetForms = () => {
    setNewGroupName('');
    setAddressFileName('');
    setAddressFileHeaders([]);
    setAddressFileData([]);
    setAddressColumnMapping({});
    setDirectInputRows(emptyRows());
    setAppendingGroup(null);
  };
  const openCreate = (tab: 'direct' | 'file' | 'current') => {
    resetForms();
    setPanel({ kind: 'create', tab });
    setMobileDetail(true);
  };
  const backToView = () => {
    resetForms();
    setPanel({ kind: 'view' });
  };

  // ★ D219+ Part 2 (2026-05-27): 박과장님 신고 — 그룹 단위 xlsx 다운로드
  const handleDownloadGroup = async (group: AddressGroup) => {
    const groupName = group.group_name;
    try {
      setIsUploading(true);
      setUploadingMsg(`${groupName} 엑셀 파일을 만들고 있어요`);
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/address-books/${encodeURIComponent(groupName)}/export?${ownerParam(group)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: '다운로드 실패' }));
        showError(errData.error || '다운로드 실패');
        return;
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${groupName}_${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      showSuccess(`${groupName} 다운로드 완료`);
    } catch (err: any) {
      showError(`다운로드 오류: ${err?.message || err}`);
    } finally {
      setIsUploading(false);
    }
  };

  // ★ D219+ Part 2 (2026-05-27): 박과장님 신고 — 기존 그룹 안 번호 추가 모드 진입
  const handleStartAppend = (group: AddressGroup) => {
    resetForms();
    setAppendingGroup(group);
    setNewGroupName(group.group_name); // 표시용 (read-only)
    setPanel({ kind: 'append' });
    setMobileDetail(true);
  };

  // 업로드 중 영역 close 차단 영역 (사용자가 중간 X 영역 사고 차단)
  const safeOnClose = () => {
    if (isUploading) return;
    onClose();
  };
  const cancelListLoad = () => {
    loadSeqRef.current++;
    setListLoading(false);
  };

  const toggleGroupSelection = (key: string) => {
    setSelectedGroupNames(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  // 그룹 하나 → 발송 목록(옛 [불러오기])
  const loadGroupIntoRecipients = async (group: AddressGroup) => {
    const seq = ++loadSeqRef.current;
    setListLoadingLabel(`${group.group_name} · ${groupCount(group).toLocaleString()}명`);
    setListLoading(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/address-books/${encodeURIComponent(group.group_name)}?${ownerParam(group)}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (seq !== loadSeqRef.current) return;   // 그 사이 창이 닫혔다 — 명단에 쓰지 않는다
      if (data.success) {
        setDirectRecipients(data.contacts.map((c: any) => ({
          // ★ D150-3 (2026-05-09) PDF #5: 0/'0' 보존
          phone: c.phone,
          name: cellToString(c.name),
          extra1: cellToString(c.extra1),
          extra2: cellToString(c.extra2),
          extra3: cellToString(c.extra3)
        })));
        onClose();
        showSuccess(`${data.contacts.length}명 불러오기 완료`);
      } else {
        showError(data.error || '주소록을 불러오지 못했습니다.');
      }
    } catch {
      // 가림막이 떴다 사라지기만 하면 왜 안 됐는지 모른다 — 실패를 알린다
      if (seq === loadSeqRef.current) showError('주소록을 불러오지 못했습니다.');
    } finally {
      if (seq === loadSeqRef.current) setListLoading(false);
    }
  };

  const handleLoadMultipleGroups = async () => {
    if (selectedGroupNames.size === 0) return;
    const seq = ++loadSeqRef.current;
    const picked = addressGroups.filter((x) => selectedGroupNames.has(groupKey(x)));
    setListLoadingLabel(`고른 ${picked.length}개 · 최대 ${picked.reduce((a, g) => a + groupCount(g), 0).toLocaleString()}명`);
    setListLoading(true);
    try {
      const token = localStorage.getItem('token');
      const allContacts: Contact5[] = [];
      const seenPhones = new Set<string>();
      for (const g of picked) {
        try {
          const res = await fetch(`/api/address-books/${encodeURIComponent(g.group_name)}?${ownerParam(g)}`, {
            headers: { Authorization: `Bearer ${token}` }
          });
          const data = await res.json();
          if (data.success && Array.isArray(data.contacts)) {
            for (const c of data.contacts) {
              const phone = String(c.phone || '').trim();
              if (!phone || seenPhones.has(phone)) continue;
              seenPhones.add(phone);
              allContacts.push({
                // ★ D150-3 (2026-05-09) PDF #5: 0/'0' 보존
                phone, name: cellToString(c.name), extra1: cellToString(c.extra1), extra2: cellToString(c.extra2), extra3: cellToString(c.extra3)
              });
            }
          }
        } catch (e) { /* 한 그룹 실패해도 다음 진행 */ }
      }
      if (seq !== loadSeqRef.current) return;   // 그 사이 창이 닫혔다 — 명단에 쓰지 않는다
      setDirectRecipients(allContacts);
      setSelectedGroupNames(new Set());
      onClose();
      showSuccess(`${selectedGroupNames.size}개 그룹 ${allContacts.length}명 불러오기 완료 (중복 제거)`);
    } finally {
      if (seq === loadSeqRef.current) setListLoading(false);
    }
  };

  const askDelete = (group: AddressGroup) => setConfirm({
    mode: 'danger',
    title: '주소록 삭제',
    description: `"${group.group_name}" 주소록을 삭제하시겠습니까?`,
    confirmLabel: '삭제',
    onConfirm: async () => {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/address-books/${encodeURIComponent(group.group_name)}?${ownerParam(group)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) {
        const rest = addressGroups.filter(g => groupKey(g) !== groupKey(group));
        setAddressGroups(rest);
        setSelectedGroupNames(prev => { const next = new Set(prev); next.delete(groupKey(group)); return next; });
        if (addressViewGroup === groupKey(group)) {
          selectGroup(rest[0] || null);
          setMobileDetail(false);
        }
        showSuccess('삭제되었습니다');
      }
    },
  });

  // 직접 입력 저장 · 기존 그룹에 번호 추가
  const saveDirectRows = async () => {
    const valid = directInputRows.filter(r => r.phone.trim().replace(/\D/g, '').length >= 10);
    if (valid.length === 0) { showError('유효한 번호를 1건 이상 입력하세요'); return; }
    if (!appendingGroup && !newGroupName.trim()) { showError('그룹명을 입력하세요'); return; }
    const token = localStorage.getItem('token');
    setIsUploading(true);
    setUploadingMsg(`주소록 ${appendingGroup ? '추가' : '등록'} 중이에요 · ${valid.length.toLocaleString()}건`);
    try {
      // ★ D219+ Part 2 박과장님 신고: appendingGroup 분기 — append endpoint 호출
      const url = appendingGroup
        ? `/api/address-books/${encodeURIComponent(appendingGroup.group_name)}/append?${ownerParam(appendingGroup)}`
        : '/api/address-books';
      const body = appendingGroup
        ? { contacts: valid }
        : { groupName: newGroupName.trim(), contacts: valid };
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (data.success) {
        showSuccess(data.message);
        const prefer = appendingGroup ? { key: groupKey(appendingGroup) } : { name: newGroupName.trim() };
        backToView();
        await refreshGroups(prefer);
      } else { showError(data.error || '저장 실패'); }
    } catch (err: any) {
      showError(`네트워크 오류: ${err?.message || err}`);
    } finally {
      setIsUploading(false);
    }
  };

  // 파일 읽기(엑셀·CSV) → 칸 연결
  const parseAddressFile = async (file: File) => {
    if (!/\.(xlsx|xls|csv)$/i.test(file.name)) { showError('엑셀(xlsx·xls)이나 CSV 파일만 올릴 수 있어요'); return; }
    const formData = new FormData();
    formData.append('file', file);
    setIsUploading(true);
    setUploadingMsg(`파일을 읽고 있어요 · ${(file.size / 1024 / 1024).toFixed(1)}MB`);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/upload/parse?includeData=true', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: formData });
      const data = await res.json();
      if (data.success) {
        setAddressFileName(file.name);
        setAddressFileHeaders(data.headers || []);
        setAddressFileData(data.allData || data.preview || []);
        setAddressColumnMapping({});
      } else {
        showError(data.error || '파일 파싱 실패');
      }
    } catch (err: any) {
      showError(`파일 파싱 실패: ${err?.message || err}`);
    } finally {
      setIsUploading(false);
    }
  };

  const saveFileMapping = async () => {
    if (!addressColumnMapping.phone) {
      showError('수신번호 컬럼을 선택하세요');
      return;
    }
    if (!newGroupName.trim()) {
      showError('그룹명을 입력하세요');
      return;
    }
    const contacts = addressFileData.map((row: any) => ({
      // ★ D150-3 (2026-05-09) PDF #5: 엑셀 0 값 보존
      phone: cellToString(row[addressColumnMapping.phone]),
      name: cellToString(row[addressColumnMapping.name]),
      extra1: cellToString(row[addressColumnMapping.extra1]),
      extra2: cellToString(row[addressColumnMapping.extra2]),
      extra3: cellToString(row[addressColumnMapping.extra3]),
    }));
    const token = localStorage.getItem('token');
    setIsUploading(true);
    setUploadingMsg(`주소록 등록 중이에요 · ${contacts.length.toLocaleString()}건은 수십 초에서 몇 분 걸려요`);
    try {
      const res = await fetch('/api/address-books', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ groupName: newGroupName, contacts })
      });
      const data = await res.json();
      if (data.success) {
        showSuccess(data.message);
        const prefer = { name: newGroupName.trim() };
        backToView();
        await refreshGroups(prefer);
      } else {
        showError(data.error || '저장 실패');
      }
    } catch (err: any) {
      showError(`네트워크 오류: ${err?.message || err}`);
    } finally {
      setIsUploading(false);
    }
  };

  const saveCurrentRecipients = async () => {
    if (!newGroupName.trim()) {
      showError('그룹명을 입력하세요');
      return;
    }
    const token = localStorage.getItem('token');
    setIsUploading(true);
    setUploadingMsg(`주소록 저장 중이에요 · ${directRecipients.length.toLocaleString()}건`);
    try {
      const res = await fetch('/api/address-books', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ groupName: newGroupName, contacts: directRecipients })
      });
      const data = await res.json();
      if (data.success) {
        showSuccess(data.message);
        const prefer = { name: newGroupName.trim() };
        backToView();
        await refreshGroups(prefer);
      } else {
        showError(data.error || '저장 실패');
      }
    } catch (err: any) {
      showError(`네트워크 오류: ${err?.message || err}`);
    } finally {
      setIsUploading(false);
    }
  };

  // 모달 열릴 때 그룹 로드
  React.useEffect(() => {
    if (show && !loaded) {
      const token = localStorage.getItem('token');
      fetch('/api/address-books/groups', { headers: { Authorization: `Bearer ${token}` } })
        .then(res => res.json())
        .then(data => {
          if (data.success) {
            const gs: AddressGroup[] = data.groups || [];
            setAddressGroups(gs);
            selectGroup(gs[0] || null);   // 열자마자 맨 위 주소록 미리보기(앞 10명)
          }
          setLoaded(true);
        })
        .catch(() => setLoaded(true));
    }
    if (!show) {
      // 닫히면 진행 중인 명단 불러오기 응답은 버린다(늦게 와서 사람이 고친 명단을 덮지 않게) · 가림막도 내린다
      loadSeqRef.current++;
      addressViewSeqRef.current++;
      addressViewTargetRef.current = null;
      setListLoading(false);
      setLoaded(false);
      setPanel({ kind: 'view' });
      setMobileDetail(false);
      resetForms();
      setAddressViewGroup(null);
      setAddressViewContacts([]);
      setAddressViewSearch('');
      setAddressViewTotal(0);
      setPreviewError(null);
      setPreviewLoading(false);
      // ★ D144 P3: 다중 선택 reset
      setSelectedGroupNames(new Set());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show]);

  if (!show) return null;

  const viewGroup = addressGroups.find((g) => groupKey(g) === addressViewGroup) || null;
  const pickedGroups = addressGroups.filter((g) => selectedGroupNames.has(groupKey(g)));
  const pickedTotal = pickedGroups.reduce((a, g) => a + groupCount(g), 0);
  const validDirectCount = directInputRows.filter(r => r.phone.trim()).length;
  const isForm = panel.kind !== 'view';
  const createTab = panel.kind === 'create' ? panel.tab : null;
  const searching = addressViewSearch.trim().length > 0;
  // 휴대폰 폭에서 오른쪽 칸을 보일 때: 고른 뒤 · 새로 만들 때 · 주소록이 하나도 없을 때(첫 주소록 만들기 안내가 오른쪽에 있다)
  const rightOnMobile = mobileDetail || (loaded && addressGroups.length === 0);

  // ── 아래 막대 ──
  let footer: React.ReactNode;
  if (isForm) {
    const primary = panel.kind === 'append'
      ? { label: '번호 추가 저장', onClick: saveDirectRows, disabled: false }
      : createTab === 'file'
        ? { label: addressFileData.length > 0 ? `${addressFileData.length.toLocaleString()}명 주소록으로 저장` : '파일을 먼저 골라 주세요', onClick: saveFileMapping, disabled: addressFileData.length === 0 }
        : createTab === 'current'
          ? { label: `${directRecipients.length.toLocaleString()}명 주소록으로 저장`, onClick: saveCurrentRecipients, disabled: false }
          : { label: '주소록 저장', onClick: saveDirectRows, disabled: false };
    footer = (
      <footer className="flex items-center gap-3 px-4 md:px-[22px] py-3 md:py-3.5 border-t border-stone-150 bg-stone-50">
        <div className="flex-1 min-w-0" />
        <button type="button" className={BTN_LINE} onClick={backToView} disabled={isUploading}>돌아가기</button>
        <button type="button" className={BTN_EM} onClick={primary.onClick} disabled={isUploading || primary.disabled}>{primary.label}</button>
      </footer>
    );
  } else if (selectedGroupNames.size > 0) {
    footer = (
      <footer className="flex items-center gap-3 px-4 md:px-[22px] py-3 md:py-3.5 border-t border-stone-900 bg-stone-900 text-white">
        <div className="flex-1 min-w-0 text-[13px] text-stone-300 leading-snug">
          <b className="text-white">{selectedGroupNames.size}개</b> 골랐어요
          <span className="hidden sm:inline"> · {selectedGroupNames.size > 1 ? '합치면 최대 ' : ''}<b className="text-white tabular-nums">{pickedTotal.toLocaleString()}</b>명{selectedGroupNames.size > 1 ? ' · 겹치는 번호는 한 번만 들어가요' : ''}</span>
        </div>
        <button type="button" className={`${BTN} border-stone-600 bg-transparent text-stone-200 hover:bg-stone-800`} onClick={() => setSelectedGroupNames(new Set())}>고르기 풀기</button>
        <button type="button" className={BTN_EM} onClick={handleLoadMultipleGroups}>
          {selectedGroupNames.size > 1 ? `고른 ${selectedGroupNames.size}개 합쳐서 불러오기` : '고른 1개 불러오기'}
        </button>
      </footer>
    );
  } else {
    footer = (
      <footer className="flex items-center gap-3 px-4 md:px-[22px] py-3 md:py-3.5 border-t border-stone-150 bg-stone-50">
        <div className="flex-1 min-w-0 text-[13px] text-stone-600 leading-snug hidden sm:block">
          {addressGroups.length > 1 ? '왼쪽 네모를 눌러 여러 개를 고르면 합쳐서 한 번에 불러올 수 있어요' : ''}
        </div>
        <div className="flex-1 sm:hidden" />
        <button type="button" className={BTN_LINE} onClick={safeOnClose} disabled={isUploading}>닫기</button>
      </footer>
    );
  }

  // ── 오른쪽: 새 주소록 · 번호 추가 ──
  const formPane = isForm && (
    <div className={`flex-1 min-h-0 overflow-y-auto ${SCROLL} px-4 md:px-6 pt-4 md:pt-5 pb-4 flex flex-col gap-4`}>
      <div className="flex items-center gap-2">
        <button type="button" className={`${ICON_BTN} md:hidden -ml-2`} onClick={() => { backToView(); setMobileDetail(false); }} aria-label="목록으로">
          <ChevronLeft className="w-[19px] h-[19px]" />
        </button>
        <h2 className="text-[21px] font-extrabold tracking-[-0.025em] text-stone-900 min-w-0 truncate">
          {panel.kind === 'append' ? `${appendingGroup?.group_name ?? ''}에 번호 추가` : '새 주소록'}
        </h2>
      </div>

      {panel.kind === 'create' && (
        <div className="inline-flex self-start max-w-full overflow-x-auto p-1 rounded-xl bg-stone-100 gap-0.5" role="tablist" aria-label="만드는 방법">
          {([
            { tab: 'direct' as const, label: '직접 입력', icon: <PencilLine className="w-[15px] h-[15px]" /> },
            { tab: 'file' as const, label: '파일 올리기', icon: <Upload className="w-[15px] h-[15px]" /> },
            ...(directRecipients.length > 0 ? [{ tab: 'current' as const, label: <><span className="sm:hidden">지금 수신자</span><span className="hidden sm:inline">지금 수신자 {directRecipients.length.toLocaleString()}명 저장</span></>, icon: <Users className="w-[15px] h-[15px]" /> }] : []),
          ]).map((t) => (
            <button
              key={t.tab}
              type="button"
              role="tab"
              aria-selected={createTab === t.tab}
              onClick={() => setPanel({ kind: 'create', tab: t.tab })}
              className={`h-[34px] px-3.5 rounded-[9px] inline-flex items-center gap-1.5 text-[13px] font-bold whitespace-nowrap transition-colors ${FOCUS} ${createTab === t.tab ? 'bg-white text-stone-900 shadow-[0_1px_2px_rgb(0_0_0/.06),0_2px_6px_rgb(0_0_0/.06)]' : 'text-stone-500 hover:text-stone-700'}`}
            >{t.icon}{t.label}</button>
          ))}
        </div>
      )}

      {panel.kind === 'create' ? (
        <label className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-bold text-stone-600">주소록 이름<em className="not-italic text-rose-600 ml-0.5">*</em></span>
          <input
            type="text"
            value={newGroupName}
            onChange={(e) => setNewGroupName(e.target.value)}
            placeholder="예: VIP 고객, 9월 행사 참여자"
            className={INPUT}
          />
        </label>
      ) : (
        /* ★ D219+ Part 2 (2026-05-27) 박과장님 신고: 기존 그룹 안내(이름은 바꿀 수 없다) */
        <div className="flex gap-2 items-start px-[13px] py-[11px] rounded-xl bg-amber-50 text-amber-700 text-[12.5px] leading-[1.55] ring-1 ring-inset ring-amber-200">
          <Info className="w-4 h-4 shrink-0 mt-px" />
          <span>‘{appendingGroup?.group_name}’에 번호를 더해요. 이미 들어 있는 번호는 저장할 때 자동으로 빠져요.</span>
        </div>
      )}

      {/* 직접 입력(새 주소록 · 번호 추가 공용) */}
      {(panel.kind === 'append' || createTab === 'direct') && (
        <div className="flex flex-col gap-2 min-h-0">
          <div className="flex items-center justify-between">
            <span className="text-[12.5px] text-stone-500">번호를 넣은 줄 <b className="text-stone-800 tabular-nums">{validDirectCount}</b>건</span>
            <button
              type="button"
              onClick={() => setDirectInputRows(prev => [...prev, { phone: '', name: '', extra1: '', extra2: '', extra3: '' }])}
              className={`inline-flex items-center gap-1.5 h-8 px-2.5 rounded-[9px] text-emerald-700 text-[13px] font-bold hover:bg-emerald-50 ${FOCUS}`}
            ><Plus className="w-[15px] h-[15px]" />줄 추가</button>
          </div>
          <div className={`border border-stone-150 rounded-[14px] overflow-auto max-h-[340px] ${SCROLL}`}>
            {/* 칸 폭 고정(번호가 가장 넓다) · 좁은 화면은 이 표 안에서만 가로로 넘긴다 */}
            <table className="w-full table-fixed border-collapse text-[13.5px] min-w-[608px]">
              <colgroup><col className="w-[140px]" /><col className="w-[108px]" /><col /><col /><col /><col className="w-11" /></colgroup>
              <thead>
                <tr>
                  <th className={TH}>번호 <span className="text-rose-600">*</span></th>
                  <th className={TH}>이름</th>
                  <th className={TH}>기타1</th>
                  <th className={TH}>기타2</th>
                  <th className={TH}>기타3</th>
                  <th className={`${TH} w-11`}><span className="sr-only">지우기</span></th>
                </tr>
              </thead>
              <tbody>
                {directInputRows.map((row, idx) => (
                  <tr key={idx} className="border-b border-stone-100 last:border-b-0">
                    {(['phone', 'name', 'extra1', 'extra2', 'extra3'] as const).map((k) => (
                      <td key={k} className="p-0">
                        <input
                          type="text"
                          value={row[k]}
                          onChange={(e) => setDirectInputRows(prev => prev.map((r, i) => i === idx ? { ...r, [k]: e.target.value } : r))}
                          placeholder={k === 'phone' ? '01012345678' : ''}
                          aria-label={`${idx + 1}번째 줄 ${k === 'phone' ? '번호' : k === 'name' ? '이름' : `기타${k.slice(-1)}`}`}
                          className={`w-full h-[42px] px-3.5 bg-transparent text-stone-900 placeholder:text-stone-400 outline-none focus:bg-emerald-50 focus:shadow-[inset_0_0_0_2px_#10B981] focus:rounded-md ${k === 'phone' ? 'tabular-nums' : ''}`}
                        />
                      </td>
                    ))}
                    <td className="w-11 text-center">
                      {directInputRows.length > 1 && (
                        <button
                          type="button"
                          onClick={() => setDirectInputRows(prev => prev.filter((_, i) => i !== idx))}
                          className={`w-7 h-7 rounded-lg inline-grid place-items-center text-stone-400 hover:bg-rose-50 hover:text-rose-600 ${FOCUS}`}
                          aria-label={`${idx + 1}번째 줄 지우기`}
                        ><X className="w-[15px] h-[15px]" /></button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 파일 올리기 → 칸 연결 */}
      {createTab === 'file' && (addressFileData.length === 0 ? (
        <div
          onDragOver={(e) => { e.preventDefault(); if (!fileDragOver) setFileDragOver(true); }}
          onDragLeave={() => setFileDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setFileDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) void parseAddressFile(f); }}
          className={`rounded-2xl border-[1.5px] border-dashed px-5 py-[34px] text-center transition-colors ${fileDragOver ? 'border-emerald-500 bg-emerald-50' : 'border-stone-300 bg-stone-50'}`}
        >
          <div className="w-12 h-12 mx-auto mb-3 rounded-[14px] bg-amber-100 text-amber-700 grid place-items-center"><FileSpreadsheet className="w-[22px] h-[22px]" /></div>
          <h4 className="text-[15px] font-extrabold text-stone-900 mb-1">엑셀이나 CSV 파일을 놓아 주세요</h4>
          <p className="text-[12.5px] text-stone-500 mb-3.5">첫 줄은 칸 이름으로 읽어요 · 주소록은 회사 전체 합쳐 10만 명까지</p>
          <label className={`${BTN_DARK} cursor-pointer`}>
            파일 고르기
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              className="sr-only"
              disabled={isUploading}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void parseAddressFile(f); e.target.value = ''; }}
            />
          </label>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          <div className="flex flex-wrap items-center gap-2 text-[13px] text-stone-600">
            <span className="inline-flex items-center h-6 px-2.5 rounded-full text-[12px] font-semibold bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200 max-w-full truncate">{addressFileName || '올린 파일'}</span>
            <span><b className="text-stone-900 tabular-nums">{addressFileData.length.toLocaleString()}</b>명을 읽었어요 · 어느 칸이 무엇인지 골라 주세요</span>
            <button type="button" onClick={() => { setAddressFileName(''); setAddressFileHeaders([]); setAddressFileData([]); setAddressColumnMapping({}); }} className={`ml-auto text-[12.5px] font-bold text-stone-500 hover:text-stone-800 rounded-md px-1.5 py-1 ${FOCUS}`}>다른 파일</button>
          </div>
          <div className="border border-stone-150 rounded-[14px] overflow-hidden">
            <div className="grid grid-cols-[96px_1fr] md:grid-cols-[120px_1fr_1fr] gap-3 px-3.5 py-[9px] bg-stone-50 border-b border-stone-150 text-[12px] font-bold text-stone-500">
              <span>한줄로 칸</span><span>파일의 칸</span><span className="hidden md:block">첫 줄 값</span>
            </div>
            {FILE_FIELDS.map((field) => {
              const col = addressColumnMapping[field.key] || '';
              const sample = col ? cellToString(addressFileData[0]?.[col]) : '';
              return (
                <div key={field.key} className="grid grid-cols-[96px_1fr] md:grid-cols-[120px_1fr_1fr] gap-3 items-center px-3.5 py-2.5 border-b border-stone-100 last:border-b-0">
                  <span className="text-[13.5px] font-bold text-stone-900">{field.label}{field.required && <em className="not-italic text-rose-600 ml-0.5">*</em>}</span>
                  <select
                    value={col}
                    onChange={(e) => setAddressColumnMapping(prev => ({ ...prev, [field.key]: e.target.value }))}
                    className={`h-[38px] px-2.5 rounded-[10px] border border-stone-200 bg-white text-[13.5px] text-stone-900 min-w-0 ${FOCUS}`}
                    aria-label={`${field.label} 칸으로 쓸 파일의 칸`}
                  >
                    <option value="">{field.required ? '칸을 골라 주세요' : '쓰지 않음'}</option>
                    {addressFileHeaders.map((h) => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </select>
                  <span className="hidden md:block text-[12.5px] truncate">
                    {col ? (sample ? <b className="font-semibold text-stone-800">{sample}</b> : <span className="text-stone-400">첫 줄이 비어 있어요</span>) : <span className="text-stone-400">{field.required ? '골라야 저장할 수 있어요' : '비워 둬요'}</span>}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {/* 지금 발송 목록 저장 */}
      {createTab === 'current' && (
        <div className="border border-stone-150 rounded-2xl p-[18px] flex gap-3.5 items-center">
          <div className="w-11 h-11 rounded-[13px] bg-emerald-50 text-emerald-700 grid place-items-center shrink-0"><Users className="w-[21px] h-[21px]" /></div>
          <div className="min-w-0">
            <b className="text-[15px] text-stone-900">지금 발송 목록의 <span className="tabular-nums">{directRecipients.length.toLocaleString()}</span>명</b>
            <p className="mt-0.5 text-[12.5px] text-stone-500">이름·기타 칸까지 그대로 새 주소록으로 저장해요. 다음부터는 불러오기 한 번이면 돼요.</p>
          </div>
        </div>
      )}
    </div>
  );

  // ── 오른쪽: 미리보기 ──
  const viewPane = !isForm && (
    addressGroups.length === 0 ? (
      <div className="flex-1 grid place-items-center p-6">
        {loaded ? (
          <div className="text-center max-w-[360px]">
            <div className="w-[52px] h-[52px] mx-auto mb-3.5 rounded-2xl bg-stone-100 text-stone-400 grid place-items-center"><Contact className="w-6 h-6" /></div>
            <h4 className="text-[16px] font-extrabold text-stone-900 mb-1.5">첫 주소록을 만들어 볼까요</h4>
            <p className="text-[13.5px] text-stone-500 leading-relaxed">자주 보내는 명단을 저장해 두면 다음부터 한 번에 불러와요. 직접 입력하거나 엑셀 파일을 올리면 돼요.</p>
            <div className="mt-4 flex flex-wrap gap-2 justify-center">
              <button type="button" className={BTN_DARK} onClick={() => openCreate('file')}><Upload className="w-4 h-4" />파일 올리기</button>
              <button type="button" className={BTN_LINE} onClick={() => openCreate('direct')}><PencilLine className="w-4 h-4" />직접 입력</button>
              {directRecipients.length > 0 && (
                <button type="button" className={BTN_LINE} onClick={() => openCreate('current')}><Users className="w-4 h-4" />지금 수신자 {directRecipients.length.toLocaleString()}명 저장</button>
              )}
            </div>
          </div>
        ) : (
          <Loader2 className="w-6 h-6 text-stone-300 animate-spin" aria-label="주소록을 읽는 중" />
        )}
      </div>
    ) : viewGroup ? (
      <div className="flex-1 min-h-0 flex flex-col">
        <div className="flex items-start gap-3 px-4 md:px-6 pt-4 md:pt-[18px] pb-3.5">
          <button type="button" className={`${ICON_BTN} md:hidden -ml-2`} onClick={() => setMobileDetail(false)} aria-label="목록으로">
            <ChevronLeft className="w-[19px] h-[19px]" />
          </button>
          <div className="flex-1 min-w-0">
            <h2 className="text-[21px] font-extrabold tracking-[-0.025em] text-stone-900 truncate">{viewGroup.group_name}</h2>
            <div className="mt-1 flex items-center gap-2 text-[13px] text-stone-500">
              <span className="tabular-nums">{groupCount(viewGroup).toLocaleString()}명</span>
              {viewGroup.owner_name && <span className="inline-flex items-center h-6 px-2.5 rounded-full text-[12px] font-semibold bg-stone-100 text-stone-600">{viewGroup.owner_name}</span>}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 items-center px-4 md:px-6 pb-3.5">
          <button type="button" className={BTN_EM} onClick={() => loadGroupIntoRecipients(viewGroup)} disabled={isUploading}>
            <ArrowDownToLine className="w-4 h-4" />발송 목록으로 불러오기
          </button>
          {/* ★ D219+ Part 2 (2026-05-27): 박과장님 신고 — 추가 · 다운로드(xlsx) */}
          <button type="button" className={BTN_LINE} onClick={() => handleStartAppend(viewGroup)} disabled={isUploading}>
            <UserPlus className="w-4 h-4" />번호 추가
          </button>
          <button type="button" className={BTN_LINE} onClick={() => handleDownloadGroup(viewGroup)} disabled={isUploading}>
            <FileSpreadsheet className="w-4 h-4" />엑셀로 받기
          </button>
          <span className="flex-1" />
          <button type="button" className={BTN_GHOST_RO} onClick={() => askDelete(viewGroup)} disabled={isUploading}>
            <Trash2 className="w-4 h-4" />삭제
          </button>
        </div>
        <div className="relative mx-4 md:mx-6 mb-2.5">
          <Search className="absolute left-[13px] top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400 pointer-events-none" />
          <input
            type="search"
            value={addressViewSearch}
            onChange={(e) => setAddressViewSearch(e.target.value)}
            placeholder="번호, 이름, 기타 칸으로 찾기"
            aria-label="이 주소록에서 찾기"
            className={`w-full ${INPUT} pl-[38px] rounded-xl`}
          />
        </div>
        <div className={`relative mx-4 md:mx-6 border border-stone-150 rounded-[14px] overflow-auto flex-1 min-h-[160px] ${SCROLL}`}>
          <table className="w-full border-collapse text-[13.5px]">
            <thead>
              <tr><th className={TH}>번호</th><th className={TH}>이름</th><th className={TH}>기타1</th><th className={TH}>기타2</th><th className={TH}>기타3</th></tr>
            </thead>
            <tbody>
              {addressViewContacts.map((c, i) => (
                <tr key={i} className="hover:bg-stone-50">
                  <td className="px-3.5 py-[11px] border-b border-stone-100 text-stone-800 whitespace-nowrap tabular-nums">{c.phone}</td>
                  {(['name', 'extra1', 'extra2', 'extra3'] as const).map((k) => {
                    const v = cellToString(c[k]);
                    return <td key={k} className={`px-3.5 py-[11px] border-b border-stone-100 whitespace-nowrap ${v ? 'text-stone-800' : 'text-stone-400'}`}>{v || '-'}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          {!previewLoading && addressViewContacts.length === 0 && (
            <div className="py-10 text-center text-[13px] text-stone-500">
              {previewError ? <span className="text-rose-600">{previewError}</span> : searching ? '찾는 번호나 이름이 없어요' : '이 주소록에 번호가 없어요'}
            </div>
          )}
          {previewLoading && (
            <div className="absolute inset-x-0 top-[41px] bottom-0 grid place-items-center bg-white/70">
              <Loader2 className="w-5 h-5 text-emerald-600 animate-spin" aria-label="명단을 읽는 중" />
            </div>
          )}
        </div>
        <div className="mx-4 md:mx-6 mt-2.5 mb-4 md:mb-[18px] flex items-center gap-2 text-[12.5px] text-stone-500 min-h-6">
          {!previewError && addressViewContacts.length > 0 && (
            <>
              <span className="inline-flex items-center h-6 px-2.5 rounded-full text-[12px] font-semibold bg-stone-100 text-stone-600 shrink-0">미리보기</span>
              <span className="min-w-0">
                {searching
                  ? <>찾은 <b className="text-stone-800 tabular-nums">{addressViewTotal.toLocaleString()}</b>명{addressViewTotal > addressViewContacts.length ? ` 중 앞의 ${addressViewContacts.length}명` : ''}</>
                  : addressViewTotal > addressViewContacts.length
                    ? <>앞의 {addressViewContacts.length}명만 보여요 · 전체 <b className="text-stone-800 tabular-nums">{addressViewTotal.toLocaleString()}</b>명은 불러오면 모두 들어가요</>
                    : <>전체 <b className="text-stone-800 tabular-nums">{addressViewTotal.toLocaleString()}</b>명</>}
              </span>
            </>
          )}
        </div>
      </div>
    ) : (
      <div className="flex-1 grid place-items-center p-6 text-[13.5px] text-stone-500">왼쪽에서 주소록을 골라 주세요</div>
    )
  );

  return (
    <div className="fixed inset-0 bg-stone-900/50 flex items-center justify-center z-[60] md:p-4 selection:bg-amber-200 selection:text-stone-900">
      <ConfirmModal state={confirm} onClose={() => setConfirm(null)} />
      <div
        className="relative w-full md:w-[min(1040px,100%)] h-[100dvh] md:h-[min(760px,calc(100vh_-_32px))] bg-white md:rounded-[18px] overflow-hidden flex flex-col text-stone-900 tracking-[-0.01em] break-keep shadow-[0_1px_2px_rgb(0_0_0/.05),0_24px_64px_rgb(0_0_0/.22),0_4px_12px_rgb(0_0_0/.06)]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="address-book-title"
      >
        {/* ★ D185: 업로드 · ★0925 불러오기 가림막(창 안) — 불러오기는 [불러오기 취소], 업로드는 닫기를 막는다 */}
        {(isUploading || listLoading) && (
          <div className="absolute inset-0 z-[5] bg-white/90 backdrop-blur-[3px] grid place-items-center" role="status" aria-live="polite">
            <div className="text-center px-8">
              <div className="w-11 h-11 mx-auto mb-4 rounded-full border-[3.5px] border-emerald-100 border-t-emerald-600 animate-spin" aria-hidden />
              <h4 className="text-[16px] font-extrabold text-stone-900 mb-1">{listLoading ? '주소록을 불러오는 중이에요' : uploadingMsg}</h4>
              {listLoading ? (
                <>
                  <p className="text-[13px] text-stone-500 mb-4">{listLoadingLabel}</p>
                  <button type="button" onClick={cancelListLoad} className={BTN_LINE}>불러오기 취소</button>
                </>
              ) : (
                <p className="text-[13px] text-stone-500">창을 닫지 마세요. 끝나면 바로 알려 드려요.</p>
              )}
            </div>
          </div>
        )}

        <header className="flex items-center gap-3.5 px-4 md:px-[22px] pt-3.5 md:pt-[18px] pb-3.5 md:pb-4 border-b border-stone-150">
          <div className="w-[42px] h-[42px] rounded-xl bg-amber-500 text-white grid place-items-center shrink-0 shadow-[0_2px_6px_rgb(217_119_6/.28)]" aria-hidden>
            <Contact className="w-[21px] h-[21px]" />
          </div>
          <div className="flex-1 min-w-0">
            <div id="address-book-title" className="text-[18px] font-extrabold tracking-[-0.02em] leading-tight">주소록</div>
            <div className="hidden sm:block text-[12.5px] text-stone-500 mt-0.5 truncate">저장해 둔 명단을 발송 목록으로 불러와요</div>
          </div>
          <button type="button" className={BTN_LINE} onClick={() => openCreate('direct')} disabled={isUploading} aria-label="새 주소록">
            <Plus className="w-4 h-4" /><span className="hidden sm:inline">새 주소록</span>
          </button>
          <button
            type="button"
            onClick={safeOnClose}
            disabled={isUploading}
            className={ICON_BTN}
            aria-label="닫기"
            title={isUploading ? '처리하는 동안에는 닫을 수 없어요' : '닫기'}
          ><X className="w-[19px] h-[19px]" /></button>
        </header>

        <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-[328px_minmax(0,1fr)]">
          {/* 왼쪽: 저장된 주소록 */}
          <aside className={`${rightOnMobile ? 'hidden md:flex' : 'flex'} flex-col min-h-0 bg-stone-50 md:border-r border-stone-150`} aria-label="저장된 주소록">
            <div className="flex items-baseline justify-between px-[18px] pt-4 pb-2.5">
              <h3 className="text-[13.5px] font-extrabold text-stone-800">저장된 주소록</h3>
              <span className="text-[12px] text-stone-500 tabular-nums">{addressGroups.length.toLocaleString()}개</span>
            </div>
            <div className={`flex-1 overflow-y-auto px-2.5 pb-3 flex flex-col gap-1 ${SCROLL}`}>
              {!loaded && addressGroups.length === 0 ? (
                <div className="py-6 grid place-items-center"><Loader2 className="w-5 h-5 text-stone-300 animate-spin" aria-label="주소록을 읽는 중" /></div>
              ) : addressGroups.length === 0 ? (
                <div className="px-2.5 py-6 text-center text-[13px] text-stone-500 leading-relaxed">
                  <Inbox className="w-5 h-5 mx-auto mb-2 text-stone-300" />
                  아직 저장한 주소록이 없어요
                </div>
              ) : addressGroups.map((group) => {
                const key = groupKey(group);
                const on = !isForm && addressViewGroup === key;
                const checked = selectedGroupNames.has(key);
                return (
                  <div
                    key={key}
                    className={`flex items-center gap-3 px-3 py-[11px] rounded-xl border transition-colors ${on ? 'bg-white border-stone-200 shadow-[0_1px_2px_rgb(0_0_0/.04),0_4px_12px_rgb(0_0_0/.05)]' : 'border-transparent hover:bg-white hover:border-stone-150'}`}
                  >
                    {/* ★ D144 P3-(b): 다중 선택 */}
                    <button
                      type="button"
                      onClick={() => toggleGroupSelection(key)}
                      aria-pressed={checked}
                      aria-label={`${group.group_name} 고르기`}
                      className={`w-5 h-5 rounded-md border-[1.5px] grid place-items-center shrink-0 transition-colors ${FOCUS} ${checked ? 'bg-emerald-600 border-emerald-600' : 'bg-white border-stone-300 hover:border-stone-400'}`}
                    >
                      <Check className={`w-[13px] h-[13px] text-white ${checked ? 'opacity-100' : 'opacity-0'}`} strokeWidth={3.2} />
                    </button>
                    <button
                      type="button"
                      onClick={() => { if (isForm) backToView(); if (!on) selectGroup(group); setMobileDetail(true); }}
                      className={`flex-1 min-w-0 text-left rounded-md ${FOCUS}`}
                    >
                      <div className="text-[14.5px] font-bold text-stone-900 truncate">{group.group_name}</div>
                      <div className="text-[12px] text-stone-500 mt-0.5 flex items-center gap-1.5 min-w-0">
                        <span className="tabular-nums shrink-0">{groupCount(group).toLocaleString()}명</span>
                        {group.owner_name && <><span className="w-[3px] h-[3px] rounded-full bg-stone-300 shrink-0" /><span className="truncate">{group.owner_name}</span></>}
                      </div>
                    </button>
                  </div>
                );
              })}
            </div>
          </aside>

          {/* 오른쪽 */}
          <section className={`${rightOnMobile ? 'flex' : 'hidden md:flex'} flex-col min-h-0 min-w-0`}>
            {formPane}
            {viewPane}
          </section>
        </div>

        {footer}
      </div>
    </div>
  );
}
