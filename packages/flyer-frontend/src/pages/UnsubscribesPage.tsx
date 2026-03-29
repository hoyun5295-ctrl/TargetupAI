import { useState, useEffect } from 'react';
import { API_BASE } from '../App';
import AlertModal from '../components/AlertModal';

interface Unsubscribe {
  id: string;
  phone: string;
  source: string;
  created_at: string;
}

export default function UnsubscribesPage({ token }: { token: string }) {
  const [list, setList] = useState<Unsubscribe[]>([]);
  const [loading, setLoading] = useState(true);
  const [phone, setPhone] = useState('');
  const [alert, setAlert] = useState<{ show: boolean; title: string; message: string; type: 'success' | 'error' | 'info' }>({ show: false, title: '', message: '', type: 'info' });

  const headers = { Authorization: `Bearer ${token}` };

  const loadList = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/unsubscribes`, { headers });
      if (res.ok) {
        const data = await res.json();
        setList(data.unsubscribes || data || []);
      }
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  useEffect(() => { loadList(); }, [token]);

  const handleAdd = async () => {
    const cleaned = phone.trim().replace(/-/g, '');
    if (cleaned.length < 10) { setAlert({ show: true, title: '입력 오류', message: '유효한 전화번호를 입력해주세요.', type: 'error' }); return; }

    try {
      const res = await fetch(`${API_BASE}/api/unsubscribes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ phone: cleaned }),
      });
      if (res.ok) {
        setAlert({ show: true, title: '등록 완료', message: '수신거부가 등록되었습니다.', type: 'success' });
        setPhone('');
        loadList();
      } else {
        const err = await res.json();
        setAlert({ show: true, title: '오류', message: err.error || '등록 실패', type: 'error' });
      }
    } catch { setAlert({ show: true, title: '오류', message: '네트워크 오류', type: 'error' }); }
  };

  const fmtDate = (d: string) => { const dt = new Date(d); return `${dt.getFullYear()}.${dt.getMonth()+1}.${dt.getDate()}`; };
  const fmtSource = (s: string) => {
    if (s === '080_ars') return '080 ARS';
    if (s === '080_ars_sync') return '080 자동연동';
    if (s === 'manual') return '수동 등록';
    if (s === 'upload') return '파일 업로드';
    return s || '-';
  };

  return (
    <>
      <h2 className="text-lg font-bold text-gray-800 mb-6">수신거부 관리</h2>

      {/* 수동 등록 */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6 max-w-md">
        <h3 className="text-sm font-bold text-gray-700 mb-3">수신거부 번호 등록</h3>
        <div className="flex gap-2">
          <input type="text" value={phone} onChange={e => setPhone(e.target.value)} placeholder="01012345678" className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <button onClick={handleAdd} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium">등록</button>
        </div>
      </div>

      {/* 목록 */}
      {loading ? <div className="text-center py-12 text-gray-400">로딩 중...</div> :
        list.length === 0 ? <div className="text-center py-12 text-gray-500">수신거부 내역이 없습니다</div> : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">전화번호</th>
                <th className="text-center px-4 py-3 font-medium text-gray-600">등록 경로</th>
                <th className="text-center px-4 py-3 font-medium text-gray-600">등록일</th>
              </tr>
            </thead>
            <tbody>
              {list.map(u => (
                <tr key={u.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-800 font-mono">{u.phone}</td>
                  <td className="px-4 py-3 text-center text-gray-500">{fmtSource(u.source)}</td>
                  <td className="px-4 py-3 text-center text-gray-400">{fmtDate(u.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <AlertModal alert={alert} onClose={() => setAlert({ ...alert, show: false })} />
    </>
  );
}
