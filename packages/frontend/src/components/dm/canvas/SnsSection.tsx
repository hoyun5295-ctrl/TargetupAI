/**
 * SnsSection — SNS (인스타/유튜브/카카오 등)
 * ★ 2026-07-07(5) 디자인 2.0 — 이모지 아이콘 폐기 → 브랜드색 점 + 라벨 알약 칩 (backend dm-section-renderer 미러 동기)
 */
import type { SnsProps } from '../../../utils/dm-section-defaults';

const SNS_LABELS: Record<string, string> = {
  instagram: 'Instagram', youtube: 'YouTube', kakao: '카카오',
  naver: 'Naver', facebook: 'Facebook', twitter: 'Twitter',
};
const SNS_COLORS: Record<string, string> = {
  instagram: '#e1306c', youtube: '#ff0000', kakao: '#f5c400',
  naver: '#03c75a', facebook: '#1877f2', twitter: '#1da1f2',
};

export default function SnsSection({ props }: { props: SnsProps }) {
  const channels = Array.isArray(props.channels) ? props.channels : [];
  if (channels.length === 0) return null;

  const isIconMode = (props.layout || 'icons') === 'icons';

  return (
    <div className="dm-section dm-sns" style={{ padding: 'var(--dm-sp-5)', background: 'var(--dm-bg)' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--dm-sp-3)', justifyContent: 'center', flexDirection: isIconMode ? 'row' : 'column' }}>
        {channels.map((ch, i) => {
          const color = SNS_COLORS[ch.type] || 'var(--dm-neutral-700)';
          const label = SNS_LABELS[ch.type] || ch.type;
          const dot = <span style={{ width: 7, height: 7, borderRadius: 999, background: color, flexShrink: 0 }} />;
          return isIconMode ? (
            <a key={i} href={ch.url || '#'} target="_blank" rel="noreferrer" title={label}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 18px', borderRadius: 999, background: 'var(--dm-neutral-100)', border: '1px solid var(--dm-neutral-200)', color: 'var(--dm-neutral-800)', fontSize: 'var(--dm-fs-small)', fontWeight: 700, textDecoration: 'none' }}>
              {dot}
              <span>{label}</span>
            </a>
          ) : (
            <a key={i} href={ch.url || '#'} target="_blank" rel="noreferrer"
              style={{ display: 'flex', alignItems: 'center', gap: 'var(--dm-sp-2)', padding: 'var(--dm-sp-3) var(--dm-sp-5)', borderRadius: 999, background: 'var(--dm-neutral-100)', border: '1px solid var(--dm-neutral-200)', color: 'var(--dm-neutral-800)', textDecoration: 'none', fontWeight: 700 }}>
              {dot}
              <span>{label}</span>
              {ch.handle && <span style={{ color: 'var(--dm-neutral-500)', fontWeight: 500 }}>@{ch.handle}</span>}
            </a>
          );
        })}
      </div>
    </div>
  );
}
