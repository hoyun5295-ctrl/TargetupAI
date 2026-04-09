import { useState, useEffect, useRef } from 'react';
import { API_BASE, apiFetch } from '../App';
import AlertModal from '../components/AlertModal';
import { SectionCard, Button, Input, Badge } from '../components/ui';

interface SenderRequest { id: string; phone: string; label?: string; status: string; reject_reason?: string; created_at: string; }

export default function SettingsPage({ token }: { token: string }) {
  const [settings, setSettings] = useState<any>(null);
  const [callbackNumbers, setCallbackNumbers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // 발신번호 등록 신청
  const [showRegister, setShowRegister] = useState(false);
  const [regPhone, setRegPhone] = useState('');
  const [regLabel, setRegLabel] = useState('');
  const [regNote, setRegNote] = useState('');
  const [regFiles, setRegFiles] = useState<File[]>([]);
  const [registering, setRegistering] = useState(false);
  const [requests, setRequests] = useState<SenderRequest[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const [alert, setAlert] = useState<{ show: boolean; title: string; message: string; type: 'success' | 'error' | 'info' }>({ show: false, title: '', message: '', type: 'info' });
  // apiFetch가 자동으로 Authorization 헤더 추가

  useEffect(() => {
    (async () => {
      try {
        const [settRes, cbRes, reqRes] = await Promise.all([
          apiFetch(`${API_BASE}/api/flyer/companies`),
          apiFetch(`${API_BASE}/api/flyer/companies/callback-numbers`),
          apiFetch(`${API_BASE}/api/flyer/companies/sender-registration/my`).catch(() => null),
        ]);
        if (settRes.ok) setSettings(await settRes.json());
        if (cbRes.ok) { const d = await cbRes.json(); setCallbackNumbers(d.numbers || d || []); }
        if (reqRes?.ok) { const d = await reqRes.json(); setRequests(Array.isArray(d) ? d : d.requests || []); }
      } catch (err) { console.error(err); }
      finally { setLoading(false); }
    })();
  }, [token]);

  const formatPhone = (p: string) => {
    if (!p) return '-';
    const n = p.replace(/-/g, '');
    if (n.length === 11) return `${n.slice(0,3)}-${n.slice(3,7)}-${n.slice(7)}`;
    if (n.length === 10) return `${n.slice(0,3)}-${n.slice(3,6)}-${n.slice(6)}`;
    return p;
  };

  const handleRegister = async () => {
    const phone = regPhone.replace(/-/g, '').trim();
    if (phone.length < 9) { setAlert({ show: true, title: '입력 오류', message: '올바른 전화번호를 입력해주세요.', type: 'error' }); return; }

    setRegistering(true);
    try {
      const formData = new FormData();
      formData.append('phone', phone);
      if (regLabel.trim()) formData.append('label', regLabel.trim());
      if (regNote.trim()) formData.append('requestNote', regNote.trim());
      formData.append('numberType', 'company');
      formData.append('documentTypes', JSON.stringify(regFiles.map(() => 'telecom_cert')));
      regFiles.forEach(f => formData.append('documents', f));

      const res = await apiFetch(`${API_BASE}/api/flyer/companies/sender-registration`, {
        method: 'POST', body: formData,
      });
      if (res.ok) {
        setAlert({ show: true, title: '등록 신청 완료', message: '발신번호 등록 신청이 접수되었습니다.\n관리자 승인 후 사용 가능합니다.', type: 'success' });
        setShowRegister(false); setRegPhone(''); setRegLabel(''); setRegNote(''); setRegFiles([]);
      } else {
        const e = await res.json();
        setAlert({ show: true, title: '신청 실패', message: e.error || '등록 신청에 실패했습니다.', type: 'error' });
      }
    } catch { setAlert({ show: true, title: '오류', message: '네트워크 오류', type: 'error' }); }
    finally { setRegistering(false); }
  };

  const statusBadge = (status: string) => {
    const map: Record<string, { variant: 'success' | 'error' | 'warn' | 'neutral'; label: string }> = {
      approved: { variant: 'success', label: '승인' },
      pending: { variant: 'warn', label: '심사중' },
      rejected: { variant: 'error', label: '반려' },
    };
    const m = map[status] || { variant: 'neutral' as const, label: status };
    return <Badge variant={m.variant}>{m.label}</Badge>;
  };

  if (loading) return <div className="text-center py-20 text-text-muted">로딩 중...</div>;

  return (
    <>
      <h2 className="text-lg font-bold text-text mb-6">설정</h2>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 max-w-4xl">
        {/* 기본 정보 */}
        <SectionCard title="기본 정보">
          <div className="space-y-3">
            {[
              { label: '브랜드명', value: settings?.brand_name || settings?.name },
              { label: '업종', value: settings?.industry },
              { label: '요금제', value: settings?.plan_name },
              { label: '과금 방식', value: settings?.billing_type === 'prepaid' ? '선불' : '후불' },
            ].map(item => (
              <div key={item.label} className="flex items-center justify-between py-1">
                <span className="text-sm text-text-secondary">{item.label}</span>
                <span className="text-sm font-semibold text-text">{item.value || '-'}</span>
              </div>
            ))}
          </div>
        </SectionCard>

        {/* 080 수신거부번호 — 직접 설정 가능 */}
        <SectionCard title="080 수신거부번호">
          <div className="space-y-3">
            <Input
              value={settings?.reject_number || ''}
              onChange={e => setSettings({ ...settings, reject_number: e.target.value })}
              placeholder="예: 080-123-4567"
            />
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={async () => {
                const phone = (settings?.reject_number || '').trim();
                if (!phone) { setAlert({ show: true, title: '입력 오류', message: '080 번호를 입력해주세요.', type: 'error' }); return; }
                try {
                  const res = await apiFetch(`${API_BASE}/api/flyer/companies`, {
                    method: 'PUT', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ reject_number: phone }),
                  });
                  if (res.ok) {
                    setAlert({ show: true, title: '저장 완료', message: '080 수신거부번호가 저장되었습니다.', type: 'success' });
                  } else {
                    setAlert({ show: true, title: '저장 실패', message: '저장에 실패했습니다.', type: 'error' });
                  }
                } catch { setAlert({ show: true, title: '오류', message: '네트워크 오류', type: 'error' }); }
              }}>저장</Button>
              <span className="text-xs text-text-muted">광고 문자 발송 시 자동 삽입됩니다</span>
            </div>
          </div>
        </SectionCard>

        {/* 등록 회신번호 */}
        <SectionCard title="등록 회신번호" className="lg:col-span-2" action={
          <Button size="sm" variant="secondary" onClick={() => setShowRegister(!showRegister)}>
            {showRegister ? '닫기' : '번호 등록 신청'}
          </Button>
        }>
          {/* 등록 신청 폼 */}
          {showRegister && (
            <div className="mb-4 p-4 bg-primary-50 rounded-xl border border-primary-500/20">
              <h4 className="text-sm font-bold text-text mb-3">발신번호 등록 신청</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                <Input label="전화번호 *" value={regPhone} onChange={e => setRegPhone(e.target.value)} placeholder="01012345678" />
                <Input label="라벨 (표시명)" value={regLabel} onChange={e => setRegLabel(e.target.value)} placeholder="예: 본사 대표번호" />
              </div>
              <div className="mb-3">
                <Input label="메모" value={regNote} onChange={e => setRegNote(e.target.value)} placeholder="참고 사항 (선택)" />
              </div>
              <div className="mb-4">
                <label className="block text-xs font-medium text-text-secondary mb-1.5">증빙 서류 (선택, 최대 5개)</label>
                <input ref={fileRef} type="file" multiple accept=".pdf,.jpg,.jpeg,.png" className="hidden" onChange={e => {
                  if (e.target.files) setRegFiles(prev => [...prev, ...Array.from(e.target.files!)].slice(0, 5));
                  e.target.value = '';
                }} />
                <div className="flex flex-wrap gap-2 items-center">
                  <button onClick={() => fileRef.current?.click()} className="px-3 py-1.5 text-xs border border-dashed border-border rounded-lg text-text-secondary hover:border-primary-500 hover:text-primary-600 transition-colors">+ 파일 추가</button>
                  {regFiles.map((f, i) => (
                    <span key={i} className="inline-flex items-center gap-1 px-2 py-1 bg-bg rounded-md text-xs text-text-secondary">
                      {f.name.length > 20 ? f.name.slice(0, 17) + '...' : f.name}
                      <button onClick={() => setRegFiles(regFiles.filter((_, j) => j !== i))} className="text-error-500 hover:text-error-600">✕</button>
                    </span>
                  ))}
                </div>
                <p className="text-[10px] text-text-muted mt-1">.pdf, .jpg, .png 파일 지원</p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" disabled={registering} onClick={handleRegister}>{registering ? '신청 중...' : '등록 신청'}</Button>
                <Button size="sm" variant="ghost" onClick={() => { setShowRegister(false); setRegPhone(''); setRegLabel(''); setRegNote(''); setRegFiles([]); }}>취소</Button>
              </div>
            </div>
          )}

          {/* 신청 내역 */}
          {requests.length > 0 && (
            <div className="mb-4">
              <p className="text-xs font-semibold text-text-secondary mb-2">신청 내역</p>
              <div className="space-y-2">
                {requests.map((r) => (
                  <div key={r.id} className="flex items-center justify-between py-2 px-3 bg-bg rounded-lg border border-border">
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-mono text-text">{formatPhone(r.phone)}</span>
                      {r.label && <span className="text-xs text-text-secondary">{r.label}</span>}
                    </div>
                    <div className="flex items-center gap-2">
                      {statusBadge(r.status)}
                      {r.reject_reason && <span className="text-[10px] text-error-500">{r.reject_reason}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 승인된 번호 목록 */}
          <p className="text-xs text-text-muted mb-3">승인 완료된 발신번호 목록입니다.</p>
          {callbackNumbers.length === 0 ? (
            <p className="text-sm text-text-muted text-center py-4">등록된 회신번호가 없습니다.</p>
          ) : (
            <div className="space-y-2">
              {callbackNumbers.map((cb: any, idx: number) => (
                <div key={idx} className="flex items-center justify-between py-2.5 px-4 bg-bg rounded-lg border border-border">
                  <span className="text-sm font-mono text-text">{formatPhone(cb.phone || cb.phone_number || cb)}</span>
                  <div className="flex items-center gap-2">
                    {cb.label && <span className="text-xs text-text-secondary">{cb.label}</span>}
                    {cb.is_default && <span className="text-xs bg-success-50 text-success-600 px-2 py-0.5 rounded-full font-medium">기본</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        {/* 요금 설정 */}
        {settings && (
          <SectionCard title="요금 설정" className="lg:col-span-2">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: 'SMS 단가', value: settings.sms_unit_price },
                { label: 'LMS 단가', value: settings.lms_unit_price },
                { label: 'MMS 단가', value: settings.mms_unit_price },
                { label: '카카오 단가', value: settings.kakao_unit_price },
              ].map(item => (
                <div key={item.label} className="bg-bg rounded-lg p-3">
                  <p className="text-xs text-text-secondary mb-1">{item.label}</p>
                  <p className="text-lg font-bold text-text">{item.value != null ? `${item.value}원` : '-'}</p>
                </div>
              ))}
            </div>
            <p className="text-xs text-text-muted mt-3">* 단가는 관리자가 설정합니다</p>
          </SectionCard>
        )}
      </div>

      <AlertModal alert={alert} onClose={() => setAlert({ ...alert, show: false })} />
    </>
  );
}
