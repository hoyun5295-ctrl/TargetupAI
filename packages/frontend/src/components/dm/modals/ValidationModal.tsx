/**
 * ValidationModal — 10영역 자동 검수 결과 표시 (D126 V2)
 *
 * 흐름:
 *  1. 모달 열릴 때 runValidation() 실행
 *  2. 10영역 items를 영역별로 그룹핑 + severity별 정렬
 *  3. 각 항목 클릭 시 해당 섹션 선택
 *  4. "재검수" / "발행" 버튼
 */
import { useEffect, useMemo, useState } from 'react';
import { useDmBuilderStore, selectAllSectionsFlat, type ValidationItem } from '../../../stores/dmBuilderStore';
import ModalBase, { ModalButton } from './ModalBase';
import ConfirmModal, { type ConfirmState } from '../../ConfirmModal';

const AREA_LABELS: Record<string, string> = {
  link: '링크',
  personalization: '개인화',
  coupon: '쿠폰',
  countdown: '카운트다운',
  layout: '레이아웃',
  style: '스타일',
  content: '콘텐츠',
  required_info: '필수정보',
  data: '데이터',
  operation: '운영',
};

const AREA_EMOJIS: Record<string, string> = {
  link: '🔗',
  personalization: '👤',
  coupon: '🎟️',
  countdown: '⏰',
  layout: '📐',
  style: '🎨',
  content: '📝',
  required_info: '📋',
  data: '📊',
  operation: '⚙️',
};

const SEVERITY_STYLE: Record<string, { color: string; bg: string; label: string }> = {
  fatal: { color: '#dc2626', bg: '#fef2f2', label: '치명' },
  recommend: { color: '#d97706', bg: '#fffbeb', label: '권장' },
  improve: { color: '#2563eb', bg: '#eff6ff', label: '개선' },
};

export default function ValidationModal({
  open,
  onClose,
  onOverridePublish,
}: {
  open: boolean;
  onClose: () => void;
  /**
   * ★ 2026-07-28 치명을 확인하고 그대로 발행 (서수란 접수).
   * 미전달이면 버튼 자체가 안 뜬다 — 발행 흐름을 가진 화면에서만 넘길 수 있다.
   */
  onOverridePublish?: (items: ValidationItem[]) => void;
}) {
  const runValidation = useDmBuilderStore((s) => s.runValidation);
  const result = useDmBuilderStore((s) => s.validationResult);
  const running = useDmBuilderStore((s) => s.validationRunning);
  const selectSection = useDmBuilderStore((s) => s.selectSection);
  /** 검수는 전체 DM(모든 페이지의 섹션) 대상 */
  const sections = useDmBuilderStore(selectAllSectionsFlat);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  useEffect(() => {
    if (!open) return;
    void runValidation();
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const grouped = useMemo(() => {
    if (!result?.items) return {};
    const groups: Record<string, typeof result.items> = {};
    for (const item of result.items) {
      const key = item.area;
      if (!groups[key]) groups[key] = [];
      groups[key].push(item);
    }
    // severity 순으로 정렬
    const order: Record<string, number> = { fatal: 0, recommend: 1, improve: 2 };
    for (const arr of Object.values(groups)) {
      arr.sort((a, b) => (order[a.severity] ?? 99) - (order[b.severity] ?? 99));
    }
    return groups;
  }, [result]);

  const stats = useMemo(() => {
    if (!result) return { fatal: 0, recommend: 0, improve: 0 };
    const s = { fatal: 0, recommend: 0, improve: 0 };
    for (const item of result.items) s[item.severity]++;
    return s;
  }, [result]);

  /**
   * ★ 2026-07-28 넘길 수 있는 치명 / 넘길 수 없는 치명.
   * 백엔드 stats.blocking을 그대로 쓰지 않고 items에서 다시 센다 — 옛 응답(stats 없음)이나
   * 저장돼 있던 예전 검수 결과가 그대로 들어와도 같은 판정이 나와야 하기 때문이다.
   * overridable 미지정 = 넘길 수 없음(안전한 쪽 기본값).
   */
  const { overridableFatals, blockingCount } = useMemo(() => {
    const fatals = (result?.items || []).filter((i) => i.severity === 'fatal');
    return {
      overridableFatals: fatals.filter((i) => i.overridable === true),
      blockingCount: fatals.filter((i) => i.overridable !== true).length,
    };
  }, [result]);

  /** 치명이 있는데 전부 넘길 수 있는 것뿐일 때만 그대로 발행할 수 있다. */
  const canOverride = !!onOverridePublish && stats.fatal > 0 && blockingCount === 0;

  const handleOverrideClick = () => {
    if (!onOverridePublish) return;
    setConfirm({
      mode: 'warning',
      title: '이 항목들을 확인하고 발행할까요?',
      description:
        `아래 ${overridableFatals.length}건을 수정하지 않고 발행합니다.\n\n`
        + overridableFatals.map((i) => `· ${i.message}`).join('\n')
        + '\n\n광고성 메시지의 고객센터·수신거부 표기 여부는 발송 주체가 판단할 영역이에요.'
        + '\n발행하면 무시한 항목과 시각이 기록으로 남습니다.',
      confirmLabel: '확인했어요 · 발행',
      cancelLabel: '돌아가서 수정',
      onConfirm: () => {
        setConfirm(null);
        onOverridePublish(overridableFatals);
      },
    });
  };

  const handleItemClick = (sectionId: string | undefined) => {
    if (sectionId && sections.find((s) => s.id === sectionId)) {
      selectSection(sectionId);
    }
  };

  const footer = (
    <>
      <ModalButton variant="ghost" onClick={onClose}>닫기</ModalButton>
      <ModalButton variant="secondary" onClick={() => runValidation()} loading={running}>
        재검수
      </ModalButton>
      {canOverride && (
        <ModalButton variant="primary" onClick={handleOverrideClick}>
          확인했어요 · 이대로 발행
        </ModalButton>
      )}
      {result?.can_publish && (
        <ModalButton variant="primary">✅ 발행 가능</ModalButton>
      )}
    </>
  );

  return (
    <ModalBase
      open={open}
      onClose={onClose}
      size="lg"
      title="DM 자동 검수"
      subtitle="10개 영역(링크/개인화/쿠폰/카운트다운/레이아웃/스타일/콘텐츠/필수정보/데이터/운영)을 한 번에 점검해요."
      badge={
        result ? (
          <span
            style={{
              fontSize: 11,
              padding: '2px 10px',
              borderRadius: 10,
              fontWeight: 700,
              background: result.level === 'pass' ? '#dcfce7' : result.level === 'warning' ? '#fef3c7' : '#fee2e2',
              color: result.level === 'pass' ? '#15803d' : result.level === 'warning' ? '#92400e' : '#991b1b',
            }}
          >
            {result.level === 'pass' ? '통과' : result.level === 'warning' ? '경고' : '오류'}
          </span>
        ) : null
      }
      footer={footer}
    >
      {running && !result && (
        <div style={{ padding: 40, textAlign: 'center', color: '#6b7280', fontSize: 13 }}>
          검수를 진행하고 있어요...
        </div>
      )}

      {result && (
        <>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: 10,
              marginBottom: 16,
            }}
          >
            <StatCard label="치명" count={stats.fatal} severity="fatal" />
            <StatCard label="권장" count={stats.recommend} severity="recommend" />
            <StatCard label="개선" count={stats.improve} severity="improve" />
          </div>

          {/* ★ 2026-07-28 넘길 수 있는 치명만 남았으면 "발행 불가"가 아니다 — 판단을 넘길 수 있다고 안내한다.
              (이미지만 올린 DM이 footer 부재로 영구히 막히던 것이 이 갈래의 계기다) */}
          {!result.can_publish && blockingCount > 0 && (
            <div
              style={{
                padding: 12,
                background: '#fef2f2',
                border: '1px solid #fca5a5',
                borderRadius: 8,
                color: '#991b1b',
                fontSize: 13,
                marginBottom: 16,
              }}
            >
              <strong>⚠️ 발행 불가:</strong> 치명 {blockingCount}건을 먼저 수정해야 해요.
              {overridableFatals.length > 0 && ` (그 외 ${overridableFatals.length}건은 확인 후 넘길 수 있어요)`}
            </div>
          )}

          {!result.can_publish && blockingCount === 0 && stats.fatal > 0 && (
            <div
              style={{
                padding: 12,
                background: '#fffbeb',
                border: '1px solid #fcd34d',
                borderRadius: 8,
                color: '#92400e',
                fontSize: 13,
                marginBottom: 16,
              }}
            >
              <strong>확인이 필요해요:</strong> 치명 {stats.fatal}건은 수정하거나, 내용을 확인한 뒤 그대로 발행할 수 있어요.
            </div>
          )}

          {result.items.length === 0 && (
            <div style={{ padding: 40, textAlign: 'center' }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>🎉</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#111827' }}>문제없이 통과!</div>
              <div style={{ fontSize: 13, color: '#6b7280', marginTop: 4 }}>바로 발행할 수 있어요.</div>
            </div>
          )}

          {Object.entries(grouped).map(([area, items]) => (
            <AreaGroup
              key={area}
              area={area}
              items={items}
              onItemClick={handleItemClick}
            />
          ))}
        </>
      )}
      {/* 확인 모달 — z-[2000] 인터럽트 티어(ConfirmModal 내장). 이 모달(ModalBase z-1000)보다 위에 뜬다. */}
      <ConfirmModal state={confirm} onClose={() => setConfirm(null)} />
    </ModalBase>
  );
}

function StatCard({ label, count, severity }: { label: string; count: number; severity: 'fatal' | 'recommend' | 'improve' }) {
  const style = SEVERITY_STYLE[severity];
  return (
    <div
      style={{
        padding: 12,
        background: style.bg,
        border: `1px solid ${style.color}22`,
        borderRadius: 8,
        textAlign: 'center',
      }}
    >
      <div style={{ fontSize: 22, fontWeight: 800, color: style.color }}>{count}</div>
      <div style={{ fontSize: 11, color: style.color, fontWeight: 600 }}>{label}</div>
    </div>
  );
}

function AreaGroup({
  area,
  items,
  onItemClick,
}: {
  area: string;
  items: { severity: string; section_id?: string; message: string; fix_suggestion?: string }[];
  onItemClick: (id: string | undefined) => void;
}) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <span style={{ fontSize: 13 }}>{AREA_EMOJIS[area] || '•'}</span>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#374151' }}>{AREA_LABELS[area] || area}</div>
        <span style={{ fontSize: 11, color: '#6b7280' }}>({items.length})</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {items.map((item, i) => {
          const s = SEVERITY_STYLE[item.severity];
          return (
            <div
              key={i}
              onClick={() => onItemClick(item.section_id)}
              style={{
                padding: 10,
                background: '#fff',
                border: `1px solid ${s.color}40`,
                borderRadius: 6,
                cursor: item.section_id ? 'pointer' : 'default',
                transition: 'background 120ms',
              }}
              onMouseEnter={(e) => { if (item.section_id) e.currentTarget.style.background = '#f9fafb'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = '#fff'; }}
            >
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <span
                  style={{
                    flex: '0 0 auto',
                    fontSize: 10,
                    padding: '2px 6px',
                    background: s.bg,
                    color: s.color,
                    borderRadius: 4,
                    fontWeight: 700,
                    marginTop: 1,
                  }}
                >
                  {s.label}
                </span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, color: '#111827' }}>{item.message}</div>
                  {item.fix_suggestion && (
                    <div style={{ fontSize: 11, color: '#6b7280', marginTop: 3 }}>
                      💡 {item.fix_suggestion}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
