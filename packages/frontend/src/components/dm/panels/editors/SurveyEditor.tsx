import type { SurveyProps, SurveyQuestion } from '../../../../utils/dm-section-defaults';
import { Field, TextInput, Select, Toggle, LineListInput } from '../FormControls';
import { RepeatableList } from '../RepeatableList';
import type { EditorProps } from '../SectionPropsEditor';

const genId = () => 'q-' + Math.random().toString(36).slice(2, 9);

export default function SurveyEditor({ props, onUpdate }: EditorProps<SurveyProps>) {
  const questions = props.questions || [];
  const setItem = (i: number, patch: Partial<SurveyQuestion>) =>
    onUpdate({ questions: questions.map((q, idx) => (idx === i ? { ...q, ...patch } : q)) });
  const move = (from: number, to: number) => { const a = [...questions]; const [m] = a.splice(from, 1); a.splice(to, 0, m); onUpdate({ questions: a }); };
  return (
    <>
      <Field label="제목 (선택)"><TextInput value={props.title} onChange={(v) => onUpdate({ title: v })} placeholder="고객 만족도 설문" /></Field>
      <Field label="질문">
        <RepeatableList
          items={questions}
          addLabel="+ 질문 추가"
          onAdd={() => onUpdate({ questions: [...questions, { id: genId(), type: 'single', question: '', required: false }] })}
          onRemove={(i) => onUpdate({ questions: questions.filter((_, idx) => idx !== i) })}
          onMove={move}
          renderItem={(q, i) => (
            <>
              <TextInput value={q.question} onChange={(v) => setItem(i, { question: v })} placeholder="질문 내용" />
              <div style={{ height: 6 }} />
              <Select
                value={q.type}
                onChange={(v) => setItem(i, { type: v as SurveyQuestion['type'] })}
                options={[
                  { value: 'single', label: '단일 선택' },
                  { value: 'multiple', label: '복수 선택' },
                  { value: 'text', label: '주관식' },
                  { value: 'rating', label: '별점' },
                ]}
              />
              {(q.type === 'single' || q.type === 'multiple') && (
                <>
                  <div style={{ height: 6 }} />
                  {/* ★ 2026-10-14 (임은지 접수 ①) 줄 목록은 LineListInput 하나 — 옛 split·trim·filter 직접 저장은 Enter·공백을 깨뜨렸다. key = 문항 id(초안 state가 문항을 따라간다) */}
                  <LineListInput
                    key={q.id ?? i}
                    value={q.options}
                    onChange={(lines) => setItem(i, { options: lines })}
                    placeholder="선택지를 한 줄에 하나씩 (Enter = 다음 줄)"
                    hint="빈 줄은 빠져요"
                    rows={3}
                  />
                </>
              )}
              <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 11, color: 'var(--dm-neutral-600)' }}>필수</span>
                <Toggle value={q.required ?? false} onChange={(v) => setItem(i, { required: v })} labelOn="필수" labelOff="선택" />
              </div>
            </>
          )}
        />
      </Field>
      {/* ★ 2026-10-14 표시 기본값 = 미지정 렌더(발행물은 키 없으면 진행률을 안 그린다 · 커버리지 테스트 고정) */}
      <Field label="진행률 표시"><Toggle value={props.show_progress ?? false} onChange={(v) => onUpdate({ show_progress: v })} /></Field>
      {/* ★ 2026-10-14 (임은지 접수 ②) 이 칸은 제출 버튼 위 정적 줄 · 완료 문구는 아래 공용 칸(SectionPropsEditor DoneTextField) · 공용 칸이 비면 이 문구가 완료 문구로도 뜬다(renderer doneTextOf) */}
      <Field label="제출 전 안내 (선택)" hint="제출 버튼 위에 보여요 · 아래 '완료 문구'가 비어 있으면 완료 때도 이 문구가 떠요"><TextInput value={props.completion_reward_text} onChange={(v) => onUpdate({ completion_reward_text: v })} placeholder="설문 완료 시 혜택 안내" /></Field>
    </>
  );
}
