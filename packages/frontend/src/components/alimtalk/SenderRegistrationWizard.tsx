/**
 * 발신프로필 등록 3-Step 위저드
 *
 * Step 1: 채널ID + 전화번호 + 카테고리 선택 + 회사 귀속
 * Step 2: 인증번호 요청 (카톡으로 6자리 수신)
 * Step 3: 인증번호 입력 + 최종 등록
 *
 * companies.length === 1 → 고객사 관리자 모드 (귀속 회사 드롭다운 숨김 + 자동 선택)
 * companies.length  >= 2 → 슈퍼관리자 모드 (드롭다운 노출)
 */

import { useEffect, useState } from 'react';

interface CategoryNode {
  category_code: string;
  parent_code: string | null;
  level: 1 | 2 | 3;
  name: string;
}

interface CompanyOption {
  id: string;
  company_name: string;
}

interface Props {
  companies: CompanyOption[];
  onClose: () => void;
  onSuccess: () => void;
}

function getToken() {
  return localStorage.getItem('token') || '';
}

export default function SenderRegistrationWizard({
  companies,
  onClose,
  onSuccess,
}: Props) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // companies가 1개만 전달되면 고객사 관리자 모드 — 자동 선택 + 드롭다운 숨김
  const singleCompany = companies.length === 1 ? companies[0] : null;

  // Step 1
  const [targetCompanyId, setTargetCompanyId] = useState(singleCompany?.id || '');
  const [profileName, setProfileName] = useState('');
  const [yellowId, setYellowId] = useState('@');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [categoryCode, setCategoryCode] = useState('');

  // Step 3
  const [token, setToken] = useState('');
  // D131: customSenderKey 필드 제거. 휴머스온 IMC가 senderKey를 API로 자동 발급하므로
  //       고객사 직접 입력 항목 불필요 (기존 고객사는 인비토가 일괄 등록).

  // 카테고리 (3단 트리)
  const [categories, setCategories] = useState<CategoryNode[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/alimtalk/categories/sender', {
          headers: { Authorization: `Bearer ${getToken()}` },
        });
        const data = await res.json();
        if (res.ok && data.success) setCategories(data.categories || []);
      } catch {
        /* ignore */
      }
    })();
  }, []);

  const level1 = categories.filter((c) => c.level === 1);
  const level1Code = categoryCode.slice(0, 3);
  const level2 = categories.filter(
    (c) => c.level === 2 && c.parent_code === level1Code,
  );
  const level2Code = categoryCode.slice(0, 7);
  const level3 = categories.filter(
    (c) => c.level === 3 && c.parent_code === level2Code,
  );

  const reqToken = async () => {
    setErr(null);
    if (!yellowId || yellowId === '@') return setErr('채널 ID(@시작)를 입력하세요');
    if (!/^010\d{8}$/.test(phoneNumber))
      return setErr('휴대폰 번호 11자리 (01012345678)');
    if (!targetCompanyId) return setErr('귀속 회사를 선택하세요');
    if (!categoryCode || categoryCode.length !== 11)
      return setErr('카테고리를 3단계 모두 선택하세요');

    setSaving(true);
    try {
      const res = await fetch('/api/alimtalk/senders/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getToken()}`,
        },
        body: JSON.stringify({ yellowId, phoneNumber }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setErr(data?.error || '인증번호 요청 실패');
        return;
      }
      setStep(3);
    } catch (e: any) {
      setErr(e?.message || '서버 오류');
    } finally {
      setSaving(false);
    }
  };

  const register = async () => {
    setErr(null);
    if (!/^\d{6}$/.test(token)) return setErr('인증번호 6자리');

    setSaving(true);
    try {
      const res = await fetch('/api/alimtalk/senders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getToken()}`,
        },
        body: JSON.stringify({
          token,
          yellowId,
          phoneNumber,
          categoryCode,
          companyId: targetCompanyId,
          profileName: profileName || yellowId,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setErr(data?.error || '등록 실패');
        return;
      }
      onSuccess();
    } catch (e: any) {
      setErr(e?.message || '서버 오류');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl overflow-hidden flex flex-col">
        <div className="px-6 py-4 border-b bg-gradient-to-r from-green-50 to-white flex justify-between items-center">
          <div>
            <h2 className="text-lg font-bold text-gray-900">발신프로필 등록</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Step {step} / 3 — 카카오 비즈니스채널 인증
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-2xl"
          >
            &times;
          </button>
        </div>

        <div className="px-6 py-4 space-y-4 overflow-y-auto">
          {/* Step 1 */}
          {step === 1 && (
            <>
              {/* 귀속 회사: 고객사 admin은 본인 회사 자동 고정(UI 미노출), 슈퍼관리자만 드롭다운 */}
              {!singleCompany && companies.length >= 2 && (
                <StepGrid label="귀속 회사">
                  <select
                    value={targetCompanyId}
                    onChange={(e) => setTargetCompanyId(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
                  >
                    <option value="">선택</option>
                    {companies.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.company_name}
                      </option>
                    ))}
                  </select>
                </StepGrid>
              )}
              {companies.length === 0 && (
                <p className="text-[11px] text-red-600">
                  회사 정보를 불러오지 못했습니다. 로그아웃 후 다시 로그인해주세요.
                </p>
              )}

              <StepGrid label="프로필 이름 (관리용)">
                <input
                  value={profileName}
                  onChange={(e) => setProfileName(e.target.value)}
                  placeholder="내부 관리용 이름"
                  className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
                />
              </StepGrid>

              <StepGrid label="카카오 채널 ID (@시작)">
                <input
                  value={yellowId}
                  onChange={(e) =>
                    setYellowId(e.target.value.startsWith('@') ? e.target.value : `@${e.target.value}`)
                  }
                  placeholder="@humuson"
                  className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
                />
              </StepGrid>

              <StepGrid label="채널 관리자 휴대폰">
                <input
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value.replace(/\D/g, ''))}
                  placeholder="01012345678 (11자리)"
                  maxLength={11}
                  className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
                />
              </StepGrid>

              <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 space-y-2">
                <p className="text-xs font-semibold text-gray-600">카테고리 (3단)</p>
                <div className="grid grid-cols-3 gap-2">
                  <select
                    value={level1Code}
                    onChange={(e) => setCategoryCode(e.target.value.padEnd(11, ''))}
                    className="border border-gray-300 rounded px-2 py-1 text-sm"
                  >
                    <option value="">대분류</option>
                    {level1.map((c) => (
                      <option key={c.category_code} value={c.category_code}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <select
                    value={level2Code.slice(3) || ''}
                    onChange={(e) =>
                      setCategoryCode(level1Code + e.target.value + (categoryCode.slice(7) || ''))
                    }
                    disabled={!level1Code}
                    className="border border-gray-300 rounded px-2 py-1 text-sm disabled:bg-gray-100"
                  >
                    <option value="">중분류</option>
                    {level2.map((c) => (
                      <option key={c.category_code} value={c.category_code.slice(3)}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <select
                    value={categoryCode.slice(7) || ''}
                    onChange={(e) => setCategoryCode(level2Code + e.target.value)}
                    disabled={!level2Code}
                    className="border border-gray-300 rounded px-2 py-1 text-sm disabled:bg-gray-100"
                  >
                    <option value="">소분류</option>
                    {level3.map((c) => (
                      <option key={c.category_code} value={c.category_code.slice(7)}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                {categories.length === 0 && (
                  <p className="text-[11px] text-amber-600">
                    {singleCompany
                      ? '카테고리 정보가 준비 중입니다. 잠시 후 다시 시도하거나 관리자에게 문의하세요.'
                      : '카테고리 캐시가 비어 있습니다. 상단 "카테고리 동기화" 버튼을 실행 후 다시 시도하세요.'}
                  </p>
                )}
              </div>

            </>
          )}

          {step === 2 && (
            <div className="text-center py-10 text-sm text-gray-500">
              <p>채널 관리자 카톡으로 인증번호가 전송됩니다.</p>
              <p className="mt-1">수신 확인 후 다음 단계로 진행하세요.</p>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <StepGrid label="카카오톡으로 받은 인증번호 (6자리)">
                <input
                  value={token}
                  onChange={(e) => setToken(e.target.value.replace(/\D/g, ''))}
                  placeholder="123456"
                  maxLength={6}
                  className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm tracking-widest"
                />
              </StepGrid>
              <p className="text-xs text-gray-500">
                인증번호 유효시간은 1분입니다. 만료되었으면 Step 1로 돌아가 재요청하세요.
              </p>
            </div>
          )}

          {err && (
            <p className="text-xs text-red-500 border border-red-200 bg-red-50 rounded p-2">
              {err}
            </p>
          )}
        </div>

        <div className="px-6 py-3 border-t bg-gray-50 flex justify-between">
          <button
            type="button"
            onClick={() => (step === 1 ? onClose() : setStep((step - 1) as 1 | 2 | 3))}
            className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm"
          >
            {step === 1 ? '취소' : '이전'}
          </button>

          <button
            type="button"
            disabled={saving}
            onClick={() => {
              if (step === 1) setStep(2);
              else if (step === 2) reqToken();
              else register();
            }}
            className="px-5 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium disabled:opacity-50"
          >
            {saving
              ? '처리 중...'
              : step === 1
                ? '다음'
                : step === 2
                  ? '인증번호 요청'
                  : '등록 완료'}
          </button>
        </div>
      </div>
    </div>
  );
}

function StepGrid({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      {children}
    </div>
  );
}
