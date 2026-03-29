import { useState, useEffect } from 'react';
import { API_BASE } from '../App';
import { SectionCard } from '../components/ui';

export default function SettingsPage({ token }: { token: string }) {
  const [company, setCompany] = useState<any>(null);
  const [senderNumbers, setSenderNumbers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    (async () => {
      try {
        const [cRes, sRes] = await Promise.all([
          fetch(`${API_BASE}/api/companies/my`, { headers }),
          fetch(`${API_BASE}/api/companies/sender-numbers`, { headers }),
        ]);
        if (cRes.ok) setCompany(await cRes.json());
        if (sRes.ok) { const d = await sRes.json(); setSenderNumbers(d.senderNumbers || d || []); }
      } catch {}
      finally { setLoading(false); }
    })();
  }, [token]);

  if (loading) return <div className="text-center py-20 text-text-muted">로딩 중...</div>;

  return (
    <>
      <h2 className="text-lg font-bold text-text mb-6">설정</h2>

      <div className="max-w-lg space-y-4">
        <SectionCard title="회사 정보">
          <div className="space-y-3">
            {[
              { label: '회사명', value: company?.name },
              { label: '요금제', value: company?.plan_name },
              { label: '과금 방식', value: company?.billing_type === 'prepaid' ? '선불' : '후불' },
            ].map(item => (
              <div key={item.label} className="flex items-center justify-between py-1">
                <span className="text-sm text-text-secondary">{item.label}</span>
                <span className="text-sm font-semibold text-text">{item.value || '-'}</span>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="등록된 발신번호">
          {senderNumbers.length === 0 ? (
            <p className="text-sm text-text-muted text-center py-3">등록된 발신번호가 없습니다.</p>
          ) : (
            <div className="space-y-2">
              {senderNumbers.map((sn: any, idx: number) => (
                <div key={idx} className="flex items-center justify-between py-2.5 px-3.5 bg-bg rounded-lg">
                  <span className="text-sm font-mono text-text">{sn.phone_number || sn}</span>
                  {sn.status && <span className="text-xs text-success-600 font-medium">{sn.status === 'approved' ? '승인됨' : sn.status}</span>}
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard title="080 수신거부번호">
          <div className="flex items-center justify-between">
            <span className="text-sm font-mono text-text">{company?.opt_out_080_number || '미설정'}</span>
          </div>
          <p className="text-xs text-text-muted mt-2">080 수신거부번호 변경은 관리자에게 문의해주세요.</p>
        </SectionCard>
      </div>
    </>
  );
}
