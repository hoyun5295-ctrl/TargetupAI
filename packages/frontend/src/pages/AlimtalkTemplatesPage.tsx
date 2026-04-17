/**
 * 알림톡 템플릿 관리 (고객사)
 *
 * - 템플릿 목록 (상태 배지: DRAFT/REQUESTED/REVIEWING/APPROVED/REJECTED/DORMANT)
 * - 신규 등록 (AlimtalkTemplateFormV2)
 * - 검수요청 / 검수취소 / 수정 / 삭제 / 휴면해제
 * - 알림 수신자 관리 모달
 * - 반려 사유 표시
 */

import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AlimtalkTemplateFormV2, {
  type TemplateFormData,
} from '../components/alimtalk/AlimtalkTemplateFormV2';
import AlarmUserManager from '../components/alimtalk/AlarmUserManager';

interface Template {
  id: string;
  template_code: string;
  template_key: string | null;
  template_name: string;
  profile_id: string;
  profile_key: string | null;
  profile_name: string | null;
  category: string | null;
  category_code?: string | null;
  message_type: string;
  emphasize_type: string;
  content: string;
  buttons: any[];
  quick_replies: any[];
  status: string;
  reject_reason: string | null;
  extra_content: string | null;
  emphasize_title: string | null;
  emphasize_subtitle: string | null;
  image_url: string | null;
  image_name: string | null;
  template_header: string | null;
  item_highlight: any;
  item_list: any;
  item_summary: any;
  preview_message: string | null;
  alarm_phone_numbers: string | null;
  service_mode: string;
  custom_template_code: string | null;
  security_flag: boolean;
  created_at: string;
  updated_at: string;
  last_synced_at: string | null;
}

interface Profile {
  id: string;
  profile_key: string;
  profile_name: string;
}

interface CategoryOption {
  category_code: string;
  name: string;
}

function getToken() {
  return localStorage.getItem('token') || '';
}

const STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  DRAFT:     { label: '초안',     cls: 'bg-gray-100 text-gray-600' },
  REQUESTED: { label: '검수요청', cls: 'bg-amber-100 text-amber-700' },
  REQ:       { label: '검수요청', cls: 'bg-amber-100 text-amber-700' },
  REVIEWING: { label: '검수중',   cls: 'bg-blue-100 text-blue-700' },
  REV:       { label: '검수중',   cls: 'bg-blue-100 text-blue-700' },
  APPROVED:  { label: '승인',     cls: 'bg-emerald-100 text-emerald-700' },
  APR:       { label: '승인',     cls: 'bg-emerald-100 text-emerald-700' },
  REJECTED:  { label: '반려',     cls: 'bg-red-100 text-red-700' },
  REJ:       { label: '반려',     cls: 'bg-red-100 text-red-700' },
  DORMANT:   { label: '휴면',     cls: 'bg-amber-100 text-amber-700' },
  DELETED:   { label: '삭제',     cls: 'bg-gray-200 text-gray-500' },
};

export default function AlimtalkTemplatesPage() {
  const navigate = useNavigate();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('ALL');
  const [editing, setEditing] = useState<Partial<TemplateFormData> | null | undefined>(undefined);
  const [showAlarm, setShowAlarm] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const headers = { Authorization: `Bearer ${getToken()}` };
      const [tRes, pRes, cRes] = await Promise.all([
        fetch('/api/alimtalk/templates', { headers }),
        fetch('/api/alimtalk/senders', { headers }),
        fetch('/api/alimtalk/categories/template', { headers }),
      ]);
      const tData = await tRes.json();
      if (tRes.ok && tData.success) setTemplates(tData.templates || []);

      const pData = await pRes.json();
      if (pRes.ok && pData.success) setProfiles(pData.profiles || []);

      const cData = await cRes.json();
      if (cRes.ok && cData.success) setCategories(cData.categories || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    if (filter === 'ALL') return templates;
    return templates.filter((t) => t.status === filter || t.status === filter.slice(0, 3));
  }, [templates, filter]);

  const inspect = async (t: Template) => {
    if (t.status !== 'DRAFT' && t.status !== 'REJECTED' && t.status !== 'REJ') {
      return alert('초안/반려 상태만 검수요청이 가능합니다');
    }
    const res = await fetch(`/api/alimtalk/templates/${t.template_code}/inspect`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${getToken()}`,
      },
      body: JSON.stringify({ comment: '' }),
    });
    const data = await res.json();
    setToast(data.success ? '검수요청 완료' : data?.error || '실패');
    load();
  };

  const cancelInspect = async (t: Template) => {
    if (!confirm('검수요청을 취소할까요?')) return;
    const res = await fetch(
      `/api/alimtalk/templates/${t.template_code}/cancel-inspect`,
      { method: 'PUT', headers: { Authorization: `Bearer ${getToken()}` } },
    );
    const data = await res.json();
    setToast(data.success ? '검수요청 취소' : data?.error || '실패');
    load();
  };

  const remove = async (t: Template) => {
    if (!confirm(`'${t.template_name || t.template_code}' 템플릿을 삭제할까요?`)) return;
    const res = await fetch(`/api/alimtalk/templates/${t.template_code}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    const data = await res.json();
    setToast(data.success ? '삭제 완료' : data?.error || '실패');
    load();
  };

  // DB row → 폼 데이터 어댑터
  const toFormData = (t: Template): Partial<TemplateFormData> => ({
    id: t.id,
    template_code: t.template_code,
    template_key: t.template_key || undefined,
    profile_id: t.profile_id,
    manageName: t.template_name,
    customTemplateCode: t.custom_template_code || '',
    serviceMode: (t.service_mode as 'PRD' | 'STG') || 'PRD',
    categoryCode: t.category_code || t.category || '',
    messageType: t.message_type as any,
    emphasizeType: t.emphasize_type as any,
    content: t.content || '',
    previewMessage: t.preview_message || '',
    extra: t.extra_content || '',
    templateTitle: t.emphasize_title || '',
    templateSubtitle: t.emphasize_subtitle || '',
    imageUrl: t.image_url || '',
    imageName: t.image_name || '',
    header: t.template_header || '',
    highlight: t.item_highlight || null,
    itemList: Array.isArray(t.item_list) ? t.item_list : [],
    summary: t.item_summary || null,
    buttons: Array.isArray(t.buttons) ? t.buttons : [],
    quickReplies: Array.isArray(t.quick_replies) ? t.quick_replies : [],
    securityFlag: t.security_flag || false,
    alarmPhoneNumber: t.alarm_phone_numbers || '',
  });

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-gray-900">알림톡 템플릿 관리</h1>
          <p className="text-xs text-gray-500">
            휴머스온 IMC 검수 · 승인된 템플릿은 즉시 발송에 사용 가능
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => navigate('/')}
            className="px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded-lg"
          >
            대시보드
          </button>
          <button
            type="button"
            onClick={() => setShowAlarm(true)}
            className="px-3 py-1.5 text-sm bg-amber-100 hover:bg-amber-200 text-amber-700 rounded-lg"
          >
            검수 알림 수신자
          </button>
          <button
            type="button"
            onClick={() => setEditing(null)}
            disabled={profiles.length === 0}
            className="px-3 py-1.5 text-sm bg-amber-600 hover:bg-amber-700 text-white rounded-lg disabled:opacity-50"
          >
            + 템플릿 등록
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6 space-y-4">
        {profiles.length === 0 && (
          <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 text-sm text-amber-800">
            등록된 발신프로필이 없습니다. 슈퍼관리자에게 발신프로필 등록을 요청하세요.
          </div>
        )}

        {/* 상태 필터 */}
        <div className="flex gap-1 text-xs">
          {(['ALL', 'DRAFT', 'REQUESTED', 'REVIEWING', 'APPROVED', 'REJECTED', 'DORMANT'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setFilter(s)}
              className={`px-3 py-1 rounded-lg ${
                filter === s
                  ? 'bg-gray-900 text-white'
                  : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
            >
              {s === 'ALL' ? '전체' : STATUS_LABELS[s]?.label || s}
            </button>
          ))}
        </div>

        {loading ? (
          <p className="text-center text-sm text-gray-400 py-10">로딩 중...</p>
        ) : filtered.length === 0 ? (
          <div className="bg-white rounded-2xl p-12 text-center border border-gray-200">
            <p className="text-sm text-gray-500">
              해당 상태의 템플릿이 없습니다.
            </p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500">
                <tr>
                  <th className="text-left px-4 py-2">템플릿</th>
                  <th className="text-left px-4 py-2">프로필</th>
                  <th className="text-center px-4 py-2">유형</th>
                  <th className="text-center px-4 py-2">상태</th>
                  <th className="text-left px-4 py-2">최종 업데이트</th>
                  <th className="text-right px-4 py-2">관리</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((t) => {
                  const st = STATUS_LABELS[t.status] || {
                    label: t.status,
                    cls: 'bg-gray-100 text-gray-500',
                  };
                  const canInspect = ['DRAFT', 'REJECTED', 'REJ'].includes(t.status);
                  const canCancel = ['REQUESTED', 'REQ', 'REVIEWING', 'REV'].includes(t.status);
                  return (
                    <tr key={t.id} className="border-t border-gray-100 hover:bg-gray-50">
                      <td className="px-4 py-2">
                        <div className="font-medium text-gray-900">
                          {t.template_name}
                        </div>
                        <div className="text-[11px] text-gray-400 font-mono truncate max-w-[240px]">
                          {t.template_code}
                        </div>
                        {t.status === 'REJECTED' && t.reject_reason && (
                          <div className="text-[11px] text-red-500 mt-0.5">
                            사유: {t.reject_reason}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-2 text-xs text-gray-600">
                        {t.profile_name || '-'}
                      </td>
                      <td className="text-center px-4 py-2 text-xs text-gray-600">
                        {t.message_type}/{t.emphasize_type}
                      </td>
                      <td className="text-center px-4 py-2">
                        <span className={`inline-block text-[11px] px-2 py-0.5 rounded ${st.cls}`}>
                          {st.label}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-xs text-gray-500">
                        {t.updated_at
                          ? new Date(t.updated_at).toLocaleString('ko-KR')
                          : '-'}
                      </td>
                      <td className="text-right px-4 py-2 space-x-1">
                        <button
                          type="button"
                          onClick={() => setEditing(toFormData(t))}
                          className="text-[11px] px-2 py-0.5 bg-gray-100 hover:bg-gray-200 rounded"
                        >
                          상세
                        </button>
                        {canInspect && (
                          <button
                            type="button"
                            onClick={() => inspect(t)}
                            className="text-[11px] px-2 py-0.5 bg-amber-50 hover:bg-amber-100 text-amber-700 rounded"
                          >
                            검수요청
                          </button>
                        )}
                        {canCancel && (
                          <button
                            type="button"
                            onClick={() => cancelInspect(t)}
                            className="text-[11px] px-2 py-0.5 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded"
                          >
                            검수취소
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => remove(t)}
                          className="text-[11px] px-2 py-0.5 bg-red-50 hover:bg-red-100 text-red-600 rounded"
                        >
                          삭제
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>

      {editing !== undefined && (
        <AlimtalkTemplateFormV2
          template={editing}
          profiles={profiles}
          categories={categories}
          onClose={() => setEditing(undefined)}
          onSuccess={() => {
            setEditing(undefined);
            setToast('저장 완료');
            load();
          }}
        />
      )}

      {showAlarm && <AlarmUserManager onClose={() => setShowAlarm(false)} />}

      {toast && (
        <div
          className="fixed bottom-6 right-6 bg-gray-900 text-white text-sm px-4 py-2 rounded-lg shadow-lg z-[60]"
          onClick={() => setToast(null)}
        >
          {toast}
        </div>
      )}
    </div>
  );
}
