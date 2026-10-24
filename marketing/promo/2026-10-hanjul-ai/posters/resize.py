# 생성 원본(raw/ · 2K PNG) → 영상용 크기로 줄인다 · 포스터 1080×1440 JPG · 원본 사진 1024 JPG · 누끼 1024 PNG(투명 유지)
# 실행: python posters/resize.py
import pathlib
from PIL import Image

here = pathlib.Path(__file__).parent
raw = here / 'raw'
for f in sorted(raw.glob('*.png')):
    im = Image.open(f)
    if f.stem.startswith('cut-'):
        im.thumbnail((1024, 1024), Image.LANCZOS)
        im.save(here / f'{f.stem}.png', optimize=True)
    elif f.stem.startswith('src-'):
        im.convert('RGB').resize((1024, 1024), Image.LANCZOS).save(here / f'{f.stem}.jpg', quality=90)
    else:
        im.convert('RGB').resize((1080, 1440), Image.LANCZOS).save(here / f'{f.stem}.jpg', quality=88)
    print('ok', f.stem)
