import type { TabCardsProps, TabCardItem } from '../../../../utils/dm-section-defaults';
import { Field, TextInput, TextArea, Select, ColorOverride, ImageUploader } from '../FormControls';
import { RepeatableList } from '../RepeatableList';
import type { EditorProps } from '../SectionPropsEditor';
// ★ 2026-08-31 상품 목록 탭이 지금 몇 개를 인식했는지 그 자리에서 보여준다 — 발행 SSR이 쓰는 파서와 같은 규칙
//   (backend `dm-tab-content.parseTabProductList`의 프론트 원본. 교차 일치는 dm-editor-parity가 고정).
import { parsePastedProducts } from '../../../../utils/product-paste';

/**
 * TabCardsEditor — 탭 카드 편집기
 *
 * ★ 2026-08-31 (임은지 접수 cmtgmu3ws0536jnotc8z54i1c) **유형을 바꿔도 입력칸이 그대로였다.**
 *   발행·미리보기는 2026-07-22(F8)부터 유형별로 다르게 렌더하는데(이미지=<img> / 상품 목록=상품 행 +
 *   링크 / 텍스트=글), 편집기만 어떤 유형이든 placeholder "내용"인 글상자 하나였다. 그래서 무엇을 넣어야
 *   그 렌더가 나오는지 알 방법이 없었다("3가지 모두 같은 기능으로 보여서 활용이 어렵다" = 접수 원문).
 *   → 유형마다 칸을 갈라 준다: 이미지 = 업로더 + 이동 주소 / 상품 목록 = 예시가 든 글상자 + 인식 결과 /
 *     텍스트 = 글상자. 여기에 이미지 링크(`link_url`)를 신설했다(상품 목록만 링크가 되던 비대칭).
 * ⛔ 유형을 바꿀 때 이미 쓴 내용을 지우지 않는다(비파괴). 새 유형에 안 맞는 값이면 **안내만** 하고
 *   교체는 사용자가 한다 — 되돌리려고 유형을 다시 눌렀을 때 원고가 사라지면 그게 더 큰 사고다.
 */

/** 유형별 안내 한 줄. 이 문장이 없으면 셋 다 같은 칸으로 보인다(접수 원인). */
const TYPE_HINT: Record<TabCardItem['content_type'], string> = {
  text: '탭을 눌렀을 때 보여줄 글귀를 씁니다.',
  image: '이미지를 올립니다. 이동할 주소를 함께 넣으면 이미지를 눌러 그 주소로 갑니다.',
  product_list: '상품 슬라이드와 같은 형식입니다. 상품마다 이름·가격·주소를 줄로 나눠 넣으면 상품 행으로 나가고, 주소가 있으면 눌러서 이동합니다.',
};

/** 상품 목록 예시. 사용자가 이미 아는 상품 붙여넣기와 같은 모양이라 따로 배울 것이 없다. */
const PRODUCT_PLACEHOLDER = [
  '글로우 파운데이션',
  '85,000원 → 15% 72,250원',
  'https://shop.example.com/p/1',
  '',
  '리치 립밤',
  '22,000원',
  'https://shop.example.com/p/2',
].join('\n');

const HINT_STYLE = { fontSize: 10, color: 'var(--dm-neutral-500)', marginTop: 3, lineHeight: 1.5 } as const;
const OK_STYLE = { fontSize: 10, color: 'var(--dm-neutral-700)', marginTop: 3, fontWeight: 600 } as const;
const WARN_STYLE = { fontSize: 10, color: 'var(--dm-error)', marginTop: 3, lineHeight: 1.5 } as const;

/** 이미지 자리에 이미지가 아닌 값이 남아 있는가(유형 전환 뒤 옛 글이 남은 경우). 빈 값은 아직 안 올린 정상 상태다. */
function looksLikeImageValue(v: string | undefined): boolean {
  const s = String(v || '').trim();
  return !s || /^https?:\/\//i.test(s) || s.startsWith('/');
}

export default function TabCardsEditor({ props, onUpdate }: EditorProps<TabCardsProps>) {
  const tabs = props.tabs || [];
  const setItem = (i: number, patch: Partial<TabCardItem>) =>
    onUpdate({ tabs: tabs.map((it, idx) => (idx === i ? { ...it, ...patch } : it)) });
  const move = (from: number, to: number) => { const a = [...tabs]; const [m] = a.splice(from, 1); a.splice(to, 0, m); onUpdate({ tabs: a }); };
  return (
    <>
      <Field label="탭">
        <RepeatableList
          items={tabs}
          addLabel="+ 탭 추가"
          onAdd={() => onUpdate({ tabs: [...tabs, { label: '탭', content_type: 'text', content: '' }] })}
          onRemove={(i) => onUpdate({ tabs: tabs.filter((_, idx) => idx !== i) })}
          onMove={move}
          renderItem={(it, i) => {
            const type = it.content_type || 'text';
            return (
              <>
                <TextInput value={it.label} onChange={(v) => setItem(i, { label: v })} placeholder="탭 이름" />
                <div style={{ height: 6 }} />
                <Select
                  value={type}
                  onChange={(v) => setItem(i, { content_type: v as TabCardItem['content_type'] })}
                  options={[
                    { value: 'text', label: '텍스트' },
                    { value: 'image', label: '이미지' },
                    { value: 'product_list', label: '상품 목록' },
                  ]}
                />
                <div style={HINT_STYLE}>{TYPE_HINT[type] || TYPE_HINT.text}</div>
                <div style={{ height: 6 }} />

                {type === 'image' ? (
                  <>
                    <ImageUploader value={it.content} onChange={(url) => setItem(i, { content: url })} label="탭 이미지" />
                    {!looksLikeImageValue(it.content) && (
                      <div style={WARN_STYLE}>
                        지금 들어 있는 값은 이미지가 아니에요. 이미지를 올리면 이 값이 바뀝니다.
                      </div>
                    )}
                    <div style={{ height: 6 }} />
                    <TextInput
                      type="url"
                      value={it.link_url}
                      onChange={(v) => setItem(i, { link_url: v })}
                      placeholder="눌렀을 때 이동할 주소 (선택)"
                    />
                  </>
                ) : type === 'product_list' ? (
                  <>
                    <TextArea
                      value={it.content}
                      onChange={(v) => setItem(i, { content: v })}
                      placeholder={PRODUCT_PLACEHOLDER}
                      rows={7}
                    />
                    {(() => {
                      const found = parsePastedProducts(it.content || '').length;
                      return found > 0
                        ? <div style={OK_STYLE}>상품 {found}개를 인식했어요. 이대로 상품 행으로 나갑니다.</div>
                        : <div style={WARN_STYLE}>아직 인식된 상품이 없어요. 상품명·가격·주소를 줄로 나눠 넣어 주세요.</div>;
                    })()}
                  </>
                ) : (
                  <TextArea
                    value={it.content}
                    onChange={(v) => setItem(i, { content: v })}
                    placeholder="탭을 눌렀을 때 보여줄 글귀"
                    rows={3}
                  />
                )}
              </>
            );
          }}
        />
      </Field>

      <Field label="탭 버튼 배경색" hint="선택된 탭 버튼 색 (미지정 = 기본 검정)">
        <ColorOverride value={props.tab_active_bg} onChange={(v) => onUpdate({ tab_active_bg: v })} />
      </Field>

      <Field label="탭 버튼 글씨색" hint="선택된 탭 버튼 글씨 (미지정 = 기본 흰색). 탭 글씨 크기 = 아래 ‘제목 크기’, 탭 내용 크기 = ‘본문 크기’">
        <ColorOverride value={props.tab_active_text_color} onChange={(v) => onUpdate({ tab_active_text_color: v })} />
      </Field>
    </>
  );
}
