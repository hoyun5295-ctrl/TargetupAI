import { useState, useEffect } from 'react';
import { API_BASE } from '../App';

export default function SettingsPage({ token }: { token: string }) {
  const [company, setCompany] = useState<any>(null);
  const [senderNumbers, setSenderNumbers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    (async () => {
      try {
        const compRes = await fetch(`${API_BASE}/api/companies/my`, { headers });
        if (compRes.ok) setCompany(await compRes.json());

        const snRes = await fetch(`${API_BASE}/api/companies/sender-numbers`, { headers });
        if (snRes.ok) {
          const data = await snRes.json();
          setSenderNumbers(data.senderNumbers || data || []);
        }
      } catch (err) { console.error(err); }
      finally { setLoading(false); }
    })();
  }, [token]);

  if (loading) return <div className="text-center py-20 text-gray-400">로딩 중...</div>;

  return (
    <>
      <h2 className="text-lg font-bold text-gray-800 mb-6">설정</h2>

      <div className="max-w-lg space-y-4">
        {/* 회사 정보 */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-bold text-gray-700 mb-3">회사 정보</h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-gray-500">회사명</span><span className="text-gray-800 font-medium">{company?.name || '-'}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">요금제</span><span className="text-gray-800 font-medium">{company?.plan_name || '-'}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">과금 방식</span><span className="text-gray-800 font-medium">{company?.billing_type === 'prepaid' ? '선불' : '후불'}</span></div>
          </div>
        </div>

        {/* 발신번호 */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-bold text-gray-700 mb-3">등록된 발신번호</h3>
          {senderNumbers.length === 0 ? (
            <p className="text-sm text-gray-500">등록된 발신번호가 없습니다.</p>
          ) : (
            <div className="space-y-2">
              {senderNumbers.map((sn: any, idx: number) => (
                <div key={idx} className="flex items-center justify-between py-2 px-3 bg-gray-50 rounded-lg">
                  <span className="text-sm font-mono text-gray-800">{sn.phone_number || sn}</span>
                  <span className="text-xs text-gray-400">{sn.status === 'approved' ? '승인됨' : sn.status || ''}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 080 수신거부번호 */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-bold text-gray-700 mb-3">080 수신거부번호</h3>
          <p className="text-sm text-gray-800 font-mono">{company?.opt_out_080_number || '미설정'}</p>
          <p className="text-xs text-gray-400 mt-1">080 수신거부번호 변경은 관리자에게 문의해주세요.</p>
        </div>
      </div>
    </>
  );
}
