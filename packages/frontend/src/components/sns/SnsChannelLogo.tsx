// SnsChannelLogo — 채널 로고 글리프 (2026-09-20 S1)
// 값(색·path)은 constants/sns-brand.ts 가 소유한다. 여기는 그리기만 한다.
// ★ 2026-09-30 AI 존 대개편(Harold "로고 없이 저렇게만 있으니 허접 … 해당 채널 로고를 넣어 임팩트 있게"):
//   `tile` = 브랜드 바탕 타일 + 흰 글리프(채널 카드·올릴 채널 고르기·기록 카드). 글리프는 원장 그대로(공식 파일 복제 아님).
import { SNS_GLYPH, SNS_TILE_BG, snsBrandColor } from '../../constants/sns-brand';

interface Props {
  platform: string;
  size?: number;
  /** 아직 열리지 않은 채널은 색을 빼고 가라앉힌다 */
  muted?: boolean;
  /** 브랜드 바탕 타일로 그린다(타일 한 변 = size × 1.75) */
  tile?: boolean;
}

export default function SnsChannelLogo({ platform, size = 24, muted = false, tile = false }: Props) {
  const glyph = SNS_GLYPH[platform];
  const color = tile ? '#ffffff' : muted ? 'rgba(15,23,42,0.35)' : snsBrandColor(platform);

  if (!glyph) {
    // 사전에 없는 채널은 그리지 않는다(빈 자리로 두는 편이 낯선 기호보다 낫다)
    return <span style={{ width: size, height: size, display: 'inline-block' }} />;
  }

  const svg = (
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
  if (!tile) return svg;
  const box = Math.round(size * 1.75);
  return (
    <span
      className="inline-flex items-center justify-center shrink-0"
      style={{ width: box, height: box, borderRadius: Math.round(box * 0.28), background: muted ? '#CBD5E1' : (SNS_TILE_BG[platform] || snsBrandColor(platform)) }}
      aria-hidden="true"
    >
      {svg}
    </span>
  );
}
