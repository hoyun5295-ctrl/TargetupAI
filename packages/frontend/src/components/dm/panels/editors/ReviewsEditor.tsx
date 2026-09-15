import type { ReviewsProps, ReviewItem } from '../../../../utils/dm-section-defaults';
import { Field, TextInput, TextArea, Toggle, ColorOverride } from '../FormControls';
import { RepeatableList } from '../RepeatableList';
import type { EditorProps } from '../SectionPropsEditor';

export default function ReviewsEditor({ props, onUpdate }: EditorProps<ReviewsProps>) {
  const reviews = props.reviews || [];
  const setItem = (i: number, patch: Partial<ReviewItem>) =>
    onUpdate({ reviews: reviews.map((r, idx) => (idx === i ? { ...r, ...patch } : r)) });
  const move = (from: number, to: number) => { const a = [...reviews]; const [m] = a.splice(from, 1); a.splice(to, 0, m); onUpdate({ reviews: a }); };
  return (
    <>
      <Field label="제목 (선택)"><TextInput value={props.title} onChange={(v) => onUpdate({ title: v })} placeholder="고객 리뷰" /></Field>
      <Field label="리뷰">
        <RepeatableList
          items={reviews}
          addLabel="+ 리뷰 추가"
          onAdd={() => onUpdate({ reviews: [...reviews, { rating: 5, author: '', body: '' }] })}
          onRemove={(i) => onUpdate({ reviews: reviews.filter((_, idx) => idx !== i) })}
          onMove={move}
          renderItem={(r, i) => (
            <>
              <div style={{ display: 'flex', gap: 6 }}>
                <TextInput type="number" min={1} max={5} value={r.rating} onChange={(v) => setItem(i, { rating: v ? Number(v) : 5 })} placeholder="별점 1-5" />
                <TextInput value={r.author} onChange={(v) => setItem(i, { author: v })} placeholder="작성자" />
              </div>
              <div style={{ height: 6 }} />
              <TextArea value={r.body} onChange={(v) => setItem(i, { body: v })} placeholder="리뷰 내용" rows={2} />
              <div style={{ height: 6 }} />
              <TextInput value={r.date} onChange={(v) => setItem(i, { date: v })} placeholder="날짜 (선택, 예: 2026.06)" />
            </>
          )}
        />
      </Field>
      {/* ★ 2026-09-15 임은지 접수(cmu2ao5qn02tjjnlu1spouqzy) · 별 색이 강조색에서만 와서 흰 강조색이면 안 보였고 고를 입구가 없었다 · DM·이메일 렌더러·캔버스가 함께 소비 */}
      <Field label="별점 색" hint="미지정 = 브랜드 강조색"><ColorOverride value={props.star_color} onChange={(v) => onUpdate({ star_color: v })} /></Field>
      <Field label="평균 별점 표시"><Toggle value={props.show_average_rating ?? true} onChange={(v) => onUpdate({ show_average_rating: v })} /></Field>
    </>
  );
}
