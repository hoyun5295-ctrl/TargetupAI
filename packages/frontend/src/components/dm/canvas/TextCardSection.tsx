/**
 * TextCardSection — 텍스트 카드 (태그 + 헤드라인 + 본문 + 이미지 조합)
 * 2026-07-09: 구도(treatment) 캔버스 미러 — 발행 SSR renderTextCard*(classic/lead/framed)와 동일. classic 골든 보존.
 */
import type { CSSProperties } from 'react';
import type { TextCardProps } from '../../../utils/dm-section-defaults';
import { dmImageUrl } from '../../../utils/dm-image-url';
import InlineEditable from './InlineEditable';
import type { EditHandler } from './SectionRenderer';

const FW_HERO = 'var(--dm-fw-hero)' as any;

export default function TextCardSection({ props, onEdit, treatment }: { props: TextCardProps; onEdit?: EditHandler; treatment?: string }) {
  const pos = props.image_position || 'top';
  const align = props.align || 'left';
  const isHoriz = pos === 'left' || pos === 'right';
  const flexDir = pos === 'bottom' ? 'column-reverse' : pos === 'left' ? 'row' : pos === 'right' ? 'row-reverse' : 'column';
  const outerPadding = pos === 'top' || pos === 'bottom' ? '0' : 'var(--dm-sp-4) var(--dm-sp-5)';
  const editable = !!onEdit;
  const t = treatment || 'classic';
  const imgSrc = props.image_url ? dmImageUrl(props.image_url) : '';

  const tagNode = (style: CSSProperties) => (props.tag || editable) ? (
    <InlineEditable style={style} value={props.tag || ''} placeholder="태그" onChange={(v) => onEdit?.({ tag: v } as Partial<TextCardProps>)} disabled={!editable} maxLength={20} />
  ) : null;
  const headNode = (style: CSSProperties, className?: string) => (props.headline || editable) ? (
    <InlineEditable className={className} style={{ ...style, ...(props.headline_size ? { fontSize: props.headline_size } : {}), ...(props.headline_color ? { color: props.headline_color } : {}) }} value={props.headline || ''} placeholder="제목" onChange={(v) => onEdit?.({ headline: v } as Partial<TextCardProps>)} disabled={!editable} maxLength={60} />
  ) : null;
  const bodyNode = (style: CSSProperties, className?: string) => (props.body || editable) ? (
    <InlineEditable className={className} style={{ ...style, whiteSpace: 'pre-wrap', ...(props.body_size ? { fontSize: props.body_size } : {}), ...(props.body_color ? { color: props.body_color } : {}) }} value={props.body || ''} placeholder="본문 내용을 입력하세요" onChange={(v) => onEdit?.({ body: v } as Partial<TextCardProps>)} disabled={!editable} multiline maxLength={500} />
  ) : null;

  const tagChip: CSSProperties = { display: 'inline-block', background: 'var(--dm-primary-light)', color: 'var(--dm-primary)', padding: 'var(--dm-sp-1) var(--dm-sp-2)', borderRadius: 'var(--dm-radius-sm)', fontSize: 'var(--dm-fs-tiny)', fontWeight: 700, marginBottom: 'var(--dm-sp-2)' };

  // ── 리드: 대형 헤드라인 + 규칙선 (이미지 비중 낮춤) ──
  if (t === 'lead') {
    return (
      <div className="dm-section dm-text-card" style={{ background: 'var(--dm-bg)', padding: 'calc(var(--dm-sp-8) * var(--dm-section-pad-scale)) var(--dm-sp-5)', textAlign: align as 'left' | 'center' }}>
        {tagNode({ fontSize: 'var(--dm-fs-tiny)', fontWeight: 700, letterSpacing: 2, color: 'var(--dm-primary)', marginBottom: 'var(--dm-sp-3)' })}
        {headNode({ fontSize: 'var(--dm-fs-h1)', fontWeight: FW_HERO, letterSpacing: 'var(--dm-ls-hero)', lineHeight: 1.25, fontFamily: 'var(--dm-font-display)', color: 'var(--dm-neutral-900)' })}
        <div style={{ height: 2, width: 40, background: 'var(--dm-primary)', margin: `var(--dm-sp-4) ${align === 'center' ? 'auto' : '0'}` }} />
        {bodyNode({ fontSize: 'var(--dm-fs-body)', lineHeight: 1.7, color: 'var(--dm-neutral-700)' })}
      </div>
    );
  }

  // ── 프레임: 좌측 악센트 + 테두리 카드 ──
  if (t === 'framed') {
    return (
      <div className="dm-section dm-text-card" style={{ background: 'var(--dm-bg)', padding: 'var(--dm-sp-5)' }}>
        <div style={{ border: '1px solid var(--dm-neutral-200)', borderLeft: '4px solid var(--dm-primary)', borderRadius: 'var(--dm-radius-lg)', overflow: 'hidden', textAlign: align as 'left' | 'center' }}>
          {imgSrc && <img src={imgSrc} alt={props.headline || ''} style={{ width: '100%', display: 'block' }} />}
          <div style={{ padding: 'var(--dm-sp-5)' }}>
            {tagNode(tagChip)}
            {headNode({ fontSize: 'var(--dm-fs-h2)', fontWeight: 700, color: 'var(--dm-neutral-900)', marginBottom: 'var(--dm-sp-2)', fontFamily: 'var(--dm-font-display)' })}
            {bodyNode({ fontSize: 'var(--dm-fs-body)', lineHeight: 1.65, color: 'var(--dm-neutral-700)' })}
          </div>
        </div>
      </div>
    );
  }

  // ── classic (기존 — 골든 보존) ──
  return (
    <div className="dm-section dm-text-card" style={{ padding: 0, background: 'var(--dm-bg)' }}>
      <div style={{ display: 'flex', flexDirection: flexDir as any, gap: isHoriz ? 'var(--dm-sp-3)' : '0', padding: outerPadding }}>
        {props.image_url && (
          <div style={{ flex: isHoriz ? '0 0 40%' : '0 0 auto', width: isHoriz ? undefined : '100%' }}>
            <img
              src={dmImageUrl(props.image_url)}
              alt={props.headline || ''}
              style={{ width: '100%', display: 'block', borderRadius: pos === 'top' ? 0 : 'var(--dm-radius-md)' }}
            />
          </div>
        )}
        <div style={{ flex: 1, padding: 'var(--dm-sp-4) var(--dm-sp-5)', textAlign: align as 'left' | 'center' }}>
          {(props.tag || editable) && (
            <InlineEditable
              style={{ display: 'inline-block', background: 'var(--dm-primary-light)', color: 'var(--dm-primary)', padding: 'var(--dm-sp-1) var(--dm-sp-2)', borderRadius: 'var(--dm-radius-sm)', fontSize: 'var(--dm-fs-tiny)', fontWeight: 700, marginBottom: 'var(--dm-sp-2)' }}
              value={props.tag || ''}
              placeholder="태그"
              onChange={(v) => onEdit?.({ tag: v } as Partial<TextCardProps>)}
              disabled={!editable}
              maxLength={20}
            />
          )}
          {(props.headline || editable) && (
            <InlineEditable
              className="dm-text-h2"
              style={{
                color: props.headline_color || 'var(--dm-neutral-900)',
                marginBottom: 'var(--dm-sp-2)',
                // ★ 2026-07-02(2) 폰트 크기·색상 직접 지정 — 뷰어 SSR과 동일 규칙
                ...(props.headline_size ? { fontSize: props.headline_size } : {}),
              }}
              value={props.headline || ''}
              placeholder="제목"
              onChange={(v) => onEdit?.({ headline: v } as Partial<TextCardProps>)}
              disabled={!editable}
              maxLength={60}
            />
          )}
          {(props.body || editable) && (
            <InlineEditable
              className="dm-text-body"
              style={{
                color: props.body_color || 'var(--dm-neutral-700)',
                ...(props.body_size ? { fontSize: props.body_size } : {}),
              }}
              value={props.body || ''}
              placeholder="본문 내용을 입력하세요"
              onChange={(v) => onEdit?.({ body: v } as Partial<TextCardProps>)}
              disabled={!editable}
              multiline
              maxLength={500}
            />
          )}
        </div>
      </div>
    </div>
  );
}
