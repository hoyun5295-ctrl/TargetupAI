import type { SurveyProps, SurveyQuestion } from '../../../../utils/dm-section-defaults';
import { Field, TextInput, TextArea, Select, Toggle } from '../FormControls';
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
                  <TextArea
                    value={(q.options || []).join('\n')}
                    onChange={(v) => setItem(i, { options: v.split('\n').map((s) => s.trim()).filter(Boolean) })}
                    placeholder="선택지 (한 줄에 하나)"
                    rows={2}
                  />
                </>
              )}
              <div style={{ height: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 11, color: 'var(--dm-neutral-600)' }}>필수</span>
                <Toggle value={q.required ?? false} onChange={(v) => setItem(i, { required: v })} labelOn="필수" labelOff="선택" />
              </div>
            </>
          )}
        />
      </Field>
      <Field label="진행률 표시"><Toggle value={props.show_progress ?? true} onChange={(v) => onUpdate({ show_progress: v })} /></Field>
      <Field label="완료 보상 문구 (선택)" hint="회사가 직접 작성"><TextInput value={props.completion_reward_text} onChange={(v) => onUpdate({ completion_reward_text: v })} placeholder="설문 완료 시 혜택 안내" /></Field>
    </>
  );
}
