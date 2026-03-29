import { useState, useEffect } from 'react';
import { API_BASE } from '../App';
import { SectionCard } from '../components/ui';

export default function SettingsPage({ token }: { token: string }) {
  const [settings, setSettings] = useState<any>(null);
  const [callbackNumbers, setCallbackNumbers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    (async () => {
      try {
        // 한줄로와 동일한 API 경로 사용
        const [settRes, cbRes] = await Promise.all([
          fetch(`${API_BASE}/api/companies/settings`, { headers }),
          fetch(`${API_BASE}/api/companies/callback-numbers`, { headers }),
        ]);
        if (settRes.ok) setSettings(await settRes.json());
        if (cbRes.ok) {
          const d = await cbRes.json();
          setCallbackNumbers(d.numbers || d || []);
        }
      } catch (err) { console.error(err); }
      finally { setLoading(false); }
    })();
  }, [token]);

  if (loading) return <div className="text-center py-20 text-text-muted">로딩 중...</div>;

  const formatPhone = (p: string) => {
    if (!p) return '-';
    const n = p.replace(/-/g, '');
    if (n.length === 11) return `${n.slice(0,3)}-${n.slice(3,7)}-${n.slice(7)}`;
    if (n.length === 10) return `${n.slice(0,3)}-${n.slice(3,6)}-${n.slice(6)}`;
    return p;
  };

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

        {/* 080 수신거부번호 */}
        <SectionCard title="080 수신거부번호">
          <p className="text-sm font-mono text-text">{settings?.opt_out_080_number ? formatPhone(settings.opt_out_080_number) : '미설정'}</p>
          <p className="text-xs text-text-muted mt-2">080 수신거부번호 변경은 관리자에게 문의해주세요.</p>
        </SectionCard>

        {/* 등록 회신번호 */}
        <SectionCard title="등록 회신번호" className="lg:col-span-2">
          <p className="text-xs text-text-muted mb-3">승인 완료된 발신번호 목록입니다. 새 번호 등록은 관리자에게 문의해주세요.</p>
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
    </>
  );
}
