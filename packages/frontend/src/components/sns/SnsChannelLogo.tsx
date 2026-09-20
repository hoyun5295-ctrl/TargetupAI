// SnsChannelLogo — 채널 로고 글리프 (2026-09-20 S1)
// 값(색·path)은 constants/sns-brand.ts 가 소유한다. 여기는 그리기만 한다.
import { SNS_GLYPH, snsBrandColor } from '../../constants/sns-brand';

interface Props {
  platform: string;
  size?: number;
  /** 아직 열리지 않은 채널은 색을 빼고 가라앉힌다 */
  muted?: boolean;
}

export default function SnsChannelLogo({ platform, size = 24, muted = false }: Props) {
  const glyph = SNS_GLYPH[platform];
  const color = muted ? 'rgba(255,255,255,0.45)' : snsBrandColor(platform);

  if (!glyph) {
    // 사전에 없는 채널은 그리지 않는다(빈 자리로 두는 편이 낯선 기호보다 낫다)
    return <span style={{ width: size, height: size, display: 'inline-block' }} />;
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={glyph.fill ? color : 'none'}
      stroke={glyph.fill ? 'none' : color}
      strokeWidth={glyph.fill ? 0 : 1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {glyph.paths.map((d, i) => <path key={i} d={d} />)}
      {glyph.dots?.map((dot, i) => <circle key={`d${i}`} cx={dot.cx} cy={dot.cy} r={dot.r} fill={color} stroke="none" />)}
    </svg>
  );
}
