import { useState, useEffect } from 'react';
import { API_BASE, apiFetch } from '../App';
import AlertModal from '../components/AlertModal';
import { Button, Input, DataTable, Badge } from '../components/ui';

interface Unsub { id: string; phone: string; source: string; created_at: string; }

export default function UnsubscribesPage({ token }: { token: string }) {
  const [list, setList] = useState<Unsub[]>([]);
  const [loading, setLoading] = useState(true);
  const [phone, setPhone] = useState('');
  const [alert, setAlert] = useState<{ show: boolean; title: string; message: string; type: 'success' | 'error' | 'info' }>({ show: false, title: '', message: '', type: 'info' });

  const loadList = async () => {
    try { const res = await apiFetch(`${API_BASE}/api/flyer/unsubscribes`); if (res.ok) { const d = await res.json(); setList(d.unsubscribes || d || []); } }
    catch {} finally { setLoading(false); }
  };
  useEffect(() => { loadList(); }, [token]);

  const handleAdd = async () => {
    const cleaned = phone.trim().replace(/-/g, '');
    if (cleaned.length < 10) { setAlert({ show: true, title: '입력 오류', message: '유효한 전화번호를 입력해주세요.', type: 'error' }); return; }
    try {
      const res = await apiFetch(`${API_BASE}/api/flyer/unsubscribes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: cleaned }) });
      if (res.ok) { setAlert({ show: true, title: '등록 완료', message: '수신거부가 등록되었습니다.', type: 'success' }); setPhone(''); loadList(); }
      else { const e = await res.json(); setAlert({ show: true, title: '오류', message: e.error || '등록 실패', type: 'error' }); }
    } catch { setAlert({ show: true, title: '오류', message: '네트워크 오류', type: 'error' }); }
  };

  const fmtDate = (d: string) => { const dt = new Date(d); return `${dt.getMonth()+1}/${dt.getDate()}`; };
  const fmtSource = (s: string) => {
    const map: Record<string, { label: string; variant: 'success' | 'neutral' | 'brand' | 'warn' }> = {
      '080_ars': { label: '080 ARS', variant: 'brand' },
      '080_ars_sync': { label: '080 자동연동', variant: 'brand' },
      'manual': { label: '수동 등록', variant: 'neutral' },
      'upload': { label: '파일 업로드', variant: 'warn' },
    };
    return map[s] || { label: s || '-', variant: 'neutral' as const };
  };

  return (
    <>
      <h2 className="text-lg font-bold text-text mb-6">수신거부 관리</h2>

      <div className="bg-surface border border-border rounded-xl p-5 mb-6 max-w-md shadow-card">
        <h3 className="text-sm font-semibold text-text mb-3">수신거부 번호 등록</h3>
        <div className="flex gap-2">
          <Input value={phone} onChange={e => setPhone(e.target.value)} placeholder="01012345678" className="flex-1" />
          <Button onClick={handleAdd}>등록</Button>
        </div>
      </div>

      {loading ? <div className="text-center py-12 text-text-muted">로딩 중...</div> : (
        <DataTable
          emptyMessage="수신거부 내역이 없습니다"
          columns={[
            { key: 'phone', label: '전화번호', render: (v) => <span className="font-mono text-sm text-text">{v}</span> },
            { key: 'source', label: '등록 경로', align: 'center', render: (v) => { const s = fmtSource(v); return <Badge variant={s.variant}>{s.label}</Badge>; } },
            { key: 'created_at', label: '등록일', align: 'center', render: (v) => <span className="text-text-muted">{fmtDate(v)}</span> },
          ]}
          rows={list}
        />
      )}

      <AlertModal alert={alert} onClose={() => setAlert({ ...alert, show: false })} />
    </>
  );
}
