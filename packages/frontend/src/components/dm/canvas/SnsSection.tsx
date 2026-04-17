/**
 * SnsSection — SNS (인스타/유튜브/카카오 등)
 */
import type { SnsProps } from '../../../utils/dm-section-defaults';

const SNS_LABELS: Record<string, string> = {
  instagram: 'Instagram', youtube: 'YouTube', kakao: '카카오',
  naver: 'Naver', facebook: 'Facebook', twitter: 'Twitter',
};
const SNS_EMOJIS: Record<string, string> = {
  instagram: '📷', youtube: '▶️', kakao: '💬',
  naver: 'N', facebook: 'f', twitter: '🐦',
};
const SNS_COLORS: Record<string, string> = {
  instagram: '#e1306c', youtube: '#ff0000', kakao: '#fee500',
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
          const emoji = SNS_EMOJIS[ch.type] || '🔗';
          return isIconMode ? (
            <a key={i} href={ch.url || '#'} target="_blank" rel="noreferrer" title={label}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 44, height: 44, borderRadius: 'var(--dm-radius-full)', background: 'var(--dm-bg)', color, fontSize: 18, textDecoration: 'none', boxShadow: 'var(--dm-shadow-sm)' }}>
              {emoji}
            </a>
          ) : (
            <a key={i} href={ch.url || '#'} target="_blank" rel="noreferrer"
              style={{ display: 'flex', alignItems: 'center', gap: 'var(--dm-sp-2)', padding: 'var(--dm-sp-3) var(--dm-sp-4)', borderRadius: 'var(--dm-radius-md)', background: color, color: '#fff', textDecoration: 'none', fontWeight: 600 }}>
              <span>{emoji}</span>
              <span>{label}</span>
              {ch.handle && <span style={{ opacity: 0.8, fontWeight: 400 }}>@{ch.handle}</span>}
            </a>
          );
        })}
      </div>
    </div>
  );
}
