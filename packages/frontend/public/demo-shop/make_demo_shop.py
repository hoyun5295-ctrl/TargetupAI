"""사내 시연 쇼핑몰(가상 브랜드 3곳) 페이지 생성기 — ★ 2026-10-22 한줄 CT 시연(설계서 docs/2026-10-22-oneline-ct-design.md §11-1)

비연동 회사가 「상품 · 행사 페이지 주소 하나」를 붙였을 때 한줄로 페이지 읽기가 상품(이름 · 사진 · 링크) · 사진을 뽑아 재료 칸을 채우는 것을 보여 준다.
사진 = 저장소 정적 예시(/diagnosis-examples/assets) · 가상 브랜드(온결 · 소목 · 한상) · 실제 판매 0 · 결제 · 입력 칸 0.
다시 만들기: python make_demo_shop.py (이 폴더에서)
"""
import html, io, os

A = '/diagnosis-examples/assets'
SHOPS = {
    'beauty': {
        'brand': '온결', 'tag': '민감 피부를 위한 순한 스킨케어', 'color': '#be185d', 'tint': '#fdf2f8',
        'title': '온결 진정 앰플 신제품 출시', 'banner': '/demo-shop/beauty-hero.jpg',
        'event': ('신제품 출시 기념', '진정 앰플을 가장 먼저 만나 보세요', '출시 기념 20% 할인'),
        'products': [
            ('온결 진정 앰플 30ml', 38000, 30400, f'{A}/beauty-inapp.png', 'ampoule'),
            ('온결 진정 라인 세트', 72000, 57600, f'{A}/beauty-email-hero.png', 'set'),
        ],
        'reviews': [('김**', '끈적임 없이 수분이 꽉 차요. 아침 화장이 잘 먹어요'), ('이**', '민감한 피부인데 자극 없이 진정돼서 재구매했어요'), ('박**', '향이 순하고 흡수가 빨라요')],
        'store': None,
    },
    'fashion': {
        'brand': '소목', 'tag': '오래 입는 가을 옷', 'color': '#b91c1c', 'tint': '#fef2f2',
        'title': '소목 가을 시즌오프', 'banner': '/demo-shop/fashion-hero.jpg',
        'event': ('SEASON OFF', '올해 가장 좋은 가격으로 만나 보세요', '가을 시즌오프 최대 30%'),
        'products': [
            ('케이블 울 니트', 59000, 41300, f'{A}/fashion-p1.png', 'knit'),
            ('울 블렌드 재킷', 129000, 90300, f'{A}/fashion-p2.png', 'jacket'),
            ('플리츠 롱 원피스', 79000, 55300, f'{A}/fashion-p3.png', 'dress'),
            ('레더 숄더백', 99000, 69300, f'{A}/fashion-p4.png', 'bag'),
            ('클래식 스니커즈', 89000, 62300, f'{A}/fashion-p5.png', 'sneakers'),
        ],
        'reviews': [('최**', '니트가 도톰하고 따뜻해요. 한 치수 크게 샀어요'), ('정**', '재킷 핏이 깔끔해서 출근할 때 매일 입어요')],
        'store': None,
        'gallery': [f'{A}/fashion-email-hero.png', f'{A}/fashion-inapp.png'],
    },
    'food': {
        'brand': '한상', 'tag': '매일 만드는 한 그릇', 'color': '#9a3412', 'tint': '#fff7ed',
        'title': '한상 가을 신메뉴', 'banner': '/demo-shop/fnb-hero.jpg',
        'event': ('가을 신메뉴', '제철 재료로 만든 새 메뉴가 나왔어요', '첫 주 음료 무료'),
        'products': [
            ('트러플 크림 파스타', 18000, None, f'{A}/fnb-p1.png', 'pasta'),
            ('리코타 제철 샐러드', 14000, None, f'{A}/fnb-p2.png', 'salad'),
            ('딸기 생크림 케이크', 7500, None, f'{A}/fnb-inapp.png', 'cake'),
        ],
        'reviews': [('윤**', '파스타 소스가 진하고 면이 쫄깃해요'), ('한**', '샐러드가 신선하고 양이 넉넉해요')],
        'store': ('서울 마포구 한줄로 12', '매일 11:00 ~ 22:00', '02-000-0000'),
        'gallery': [f'{A}/fnb-email-hero.png'],
    },
}

won = lambda n: f'{n:,}원'
e = html.escape


def page(key, s):
    c = s['color']
    items = []
    for name, price, sale, img, slug in s['products']:
        price_html = (f'<span class="rate">{round((1 - sale / price) * 100)}%</span><b>{won(sale)}</b><s>{won(price)}</s>' if sale else f'<b>{won(price)}</b>')
        items.append(f'''<li><a class="card" href="/demo-shop/{key}.html#{slug}"><img src="{img}" alt="{e(name)}" width="600" height="600"><span class="name">{e(name)}</span><span class="price">{price_html}</span></a></li>''')
    reviews = ''.join(f'<li><span class="stars">★★★★★</span><p>{e(b)}</p><span class="who">{e(a)}</span></li>' for a, b in s['reviews'])
    gallery = ''.join(f'<img src="{u}" alt="" width="1024" height="1024">' for u in s.get('gallery', []))
    store = ''
    if s['store']:
        addr, hours, tel = s['store']
        store = f'<section class="store"><h2>매장 안내</h2><dl><dt>주소</dt><dd>{e(addr)}</dd><dt>영업</dt><dd>{e(hours)}</dd><dt>전화</dt><dd>{e(tel)}</dd></dl></section>'
    eb, eh, ebenefit = s['event']
    return f'''<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{e(s['title'])} · {e(s['brand'])}</title>
<meta property="og:title" content="{e(s['title'])}"><meta property="og:image" content="{s['banner']}"><meta name="theme-color" content="{c}">
<meta name="robots" content="noindex">
<style>
:root{{--c:{c};--t:{s['tint']};--ink:#1c1917;--mute:#78716c;--line:#e7e5e4}}
*{{box-sizing:border-box}}body{{margin:0;font-family:"Pretendard","Apple SD Gothic Neo","Malgun Gothic",sans-serif;color:var(--ink);background:#fff}}
header{{position:sticky;top:0;background:#fff;border-bottom:1px solid var(--line);padding:14px 20px;display:flex;align-items:center;gap:10px;z-index:2}}
header b{{font-size:20px;letter-spacing:-.02em}}header span{{color:var(--mute);font-size:13px}}
.hero{{position:relative;max-width:1080px;margin:0 auto}}.hero img{{width:100%;height:auto;display:block;max-height:560px;object-fit:cover}}
.event{{max-width:1080px;margin:0 auto;padding:28px 20px;background:var(--t);display:flex;flex-direction:column;gap:6px}}
.event small{{color:var(--c);font-weight:800;letter-spacing:.12em}}.event h1{{margin:0;font-size:28px;letter-spacing:-.03em}}.event p{{margin:0;color:var(--mute)}}
.event em{{font-style:normal;display:inline-block;margin-top:8px;background:var(--c);color:#fff;font-weight:800;padding:8px 14px;border-radius:999px;width:max-content}}
main{{max-width:1080px;margin:0 auto;padding:28px 20px}}h2{{font-size:20px;margin:0 0 14px}}
ul.grid{{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:16px}}
.card{{display:flex;flex-direction:column;gap:6px;text-decoration:none;color:inherit}}.card img{{width:100%;height:auto;aspect-ratio:1;object-fit:cover;border-radius:14px;background:#f5f5f4}}
.name{{font-weight:700}}.price{{display:flex;gap:6px;align-items:baseline}}.rate{{color:#dc2626;font-weight:800}}.price s{{color:var(--mute);font-size:13px}}
.gallery{{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px;margin-top:28px}}.gallery img{{width:100%;height:auto;border-radius:14px}}
.reviews{{margin-top:32px}}.reviews ul{{list-style:none;padding:0;margin:0;display:grid;gap:10px}}.reviews li{{border:1px solid var(--line);border-radius:14px;padding:14px}}
.stars{{color:var(--c)}}.reviews p{{margin:6px 0}}.who{{color:var(--mute);font-size:13px}}
.store{{margin-top:32px}}.store dl{{display:grid;grid-template-columns:60px 1fr;gap:6px 12px;margin:0}}.store dt{{color:var(--mute)}}.store dd{{margin:0}}
footer{{border-top:1px solid var(--line);padding:20px;color:var(--mute);font-size:12px;text-align:center}}
</style></head>
<body>
<header><b>{e(s['brand'])}</b><span>{e(s['tag'])}</span></header>
<div class="hero"><img src="{s['banner']}" alt="{e(s['title'])}" width="1200" height="1200"></div>
<section class="event"><small>{e(eb)}</small><h1>{e(eh)}</h1><p>{e(s['title'])}</p><em>{e(ebenefit)}</em></section>
<main>
<h2>지금 만나는 상품</h2>
<ul class="grid">{''.join(items)}</ul>
{f'<div class="gallery">{gallery}</div>' if gallery else ''}
<section class="reviews"><h2>고객 후기</h2><ul>{reviews}</ul></section>
{store}
</main>
<footer>한줄로 사내 시연용 가상 쇼핑몰입니다 · 실제로 판매하지 않아요 · {e(s['brand'])}</footer>
</body></html>
'''


here = os.path.dirname(os.path.abspath(__file__))
for k, s in SHOPS.items():
    io.open(os.path.join(here, f'{k}.html'), 'w', encoding='utf-8', newline='\n').write(page(k, s))
    print('wrote', k)
