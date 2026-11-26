"""QR 코드를 다시 만든다:  pip install segno pillow shapely  →  python3 qr/make_qr.py

만드는 것
  survey-qr.png / .svg          설문으로 바로 가는 QR
  guide-qr.png / .svg           관람 안내 페이지로 가는 QR
  guide-qr-stencil.svg / .png   스텐실용. 오려 내도 판이 조각나지 않게 필요한 곳에 다리를 냈다
그리고 guide.html(넓은 화면에서만 보임)과 handout.html(A4 배포용) 안의 설문 QR을 같은 주소로 다시 채운다.
A4 PDF는 이어서 node qr/make_handout.js 로 다시 만든다.

주소가 바뀌면 BASE만 고치고 다시 실행한다.
"""
import re
from pathlib import Path

import segno
from PIL import Image, ImageDraw
from shapely.geometry import Polygon, box
from shapely.ops import unary_union

BASE = 'https://suhkisoo.github.io/survey_not_a_robot/'
SURVEY_URL = BASE
GUIDE_URL = BASE + 'guide.html'

DARK, LIGHT = '#1D2321', '#FFFFFF'
BORDER = 4              # 둘레 흰 여백(칸 수). 줄이면 인식이 안 될 수 있다
STENCIL_GAP = 0.2       # 스텐실 다리의 폭(칸 크기 대비)
# 모서리 큰 네모의 다리만은 더 가늘게 한다. 여기가 넓으면 휴대폰이 QR을 못 찾는다.
# 촬영 조건을 흉내 낸 시험에서 0.12는 일반 QR과 판독률이 같았고, 0.15부터 떨어졌다.
FINDER_GAP = 0.12
FINDER_BRIDGES = 4      # 큰 네모 하나에 내는 다리 수(2 또는 4)
STENCIL_MM = 300        # 스텐실 SVG의 실제 크기(여백 포함 한 변, mm)

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent


def plain(url, name, error):
    q = segno.make(url, error=error)
    q.save(str(HERE / f'{name}.png'), scale=24, border=BORDER, dark=DARK, light=LIGHT)
    q.save(str(HERE / f'{name}.svg'), scale=10, border=BORDER, dark=DARK, light=LIGHT)
    return q


def finder_shapes(ox, oy, b, bridges):
    """모서리의 큰 네모(위치 찾기 무늬) 하나를 스텐실용 도형으로 만든다.

    바깥 테두리 안쪽의 흰 띠는 섬이라서, 테두리를 가로지르는 다리가 꼭 있어야 한다.
    다리는 판독에 쓰이는 가운데 세 줄을 피해 둘째 줄과 여섯째 줄에 둔다.
    """
    o = (1 - b) / 2
    if bridges == 4:
        ring = [
            [(0, 0), (5 + o, 0), (5 + o, 1), (1, 1), (1, 1 + o), (0, 1 + o)],
            [(5 + o + b, 0), (7, 0), (7, 5 + o), (6, 5 + o), (6, 1), (5 + o + b, 1)],
            [(7, 5 + o + b), (7, 7), (1 + o + b, 7), (1 + o + b, 6), (6, 6), (6, 5 + o + b)],
            [(0, 1 + o + b), (1, 1 + o + b), (1, 6), (1 + o, 6), (1 + o, 7), (0, 7)],
        ]
    else:  # 왼쪽 변과 오른쪽 변에 하나씩
        ring = [
            [(0, 0), (7, 0), (7, 5 + o), (6, 5 + o), (6, 1), (1, 1), (1, 1 + o), (0, 1 + o)],
            [(0, 1 + o + b), (1, 1 + o + b), (1, 6), (6, 6), (6, 5 + o + b), (7, 5 + o + b), (7, 7), (0, 7)],
        ]
    center = [(2, 2), (5, 2), (5, 5), (2, 5)]
    return [[(ox + x, oy + y) for x, y in p] for p in ring + [center]]


def stencil_polys(q, b=STENCIL_GAP, finder_b=None, finder_bridges=FINDER_BRIDGES, data_bridges=True):
    """스텐실 도형(검은 부분 = 오려 낼 구멍)을 칸 좌표의 다각형 목록으로 돌려준다.

    보통 QR을 그대로 오리면 검은 칸에 둘러싸인 흰 조각(섬)이 떨어져 나간다.
    그렇다고 칸을 전부 떨어뜨리면 잘 안 읽힌다(시험해서 확인함).
    그래서 원래 모양을 거의 그대로 두고, 섬이 생기는 곳에만 가는 다리를 낸다.
    다리는 칸의 가장자리에 붙여서, 판독기가 보는 칸 한가운데는 건드리지 않는다.
    """
    rows = [[bool(v) for v in r] for r in q.matrix]
    n = len(rows)
    finders = [(0, 0), (n - 7, 0), (0, n - 7)]
    in_finder = lambda x, y: any(fx <= x < fx + 7 and fy <= y < fy + 7 for fx, fy in finders)
    dark = lambda x, y: rows[y][x]

    # 1) 흰 칸을 변끼리 맞닿은 덩어리로 묶는다. 'OUT'은 둘레 여백과 이어진 덩어리.
    parent = {}

    def find(a):
        while parent.setdefault(a, a) != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    def union(a, c):
        parent[find(a)] = find(c)

    for y in range(n):
        for x in range(n):
            if dark(x, y):
                continue
            if x in (0, n - 1) or y in (0, n - 1) or in_finder(x, y):
                union((x, y), 'OUT')      # 큰 네모 안의 흰 띠는 finder_shapes의 다리로 이어진다
            if x + 1 < n and not dark(x + 1, y):
                union((x, y), (x + 1, y))
            if y + 1 < n and not dark(x, y + 1):
                union((x, y), (x, y + 1))

    # 2) 다리 후보: 양 끝이 흰 칸(또는 여백)인, 한 줄로 이어진 검은 칸들
    cands = []
    for horizontal in (True, False):
        cell = (lambda j, k: (k, j)) if horizontal else (lambda j, k: (j, k))
        for j in range(n):
            i = 0
            while i < n:
                if not dark(*cell(j, i)):
                    i += 1
                    continue
                k = i
                while k + 1 < n and dark(*cell(j, k + 1)):
                    k += 1
                run = [cell(j, t) for t in range(i, k + 1)]
                if not any(in_finder(*c) for c in run):
                    e1 = cell(j, i - 1) if i > 0 else 'OUT'
                    e2 = cell(j, k + 1) if k + 1 < n else 'OUT'
                    cands.append((len(run), horizontal, run, e1, e2))
                i = k + 1
    cands.sort(key=lambda c: c[0])

    islands = {find(c) for c in list(parent) if find(c) != find('OUT')}
    count = {i: 0 for i in islands}       # 섬마다 걸린 다리 수
    orig = {c: find(c) for c in list(parent)}
    strips = []

    def add(c):
        strips.append(c)
        for e in (c[3], c[4]):
            if orig.get(e) in count:
                count[orig[e]] += 1

    if data_bridges:
        # 2-1) 모든 섬이 여백까지 이어지도록 짧은 다리부터 고른다
        for c in cands:
            if find(c[3]) != find(c[4]):
                union(c[3], c[4])
                add(c)
        assert all(find(i) == find('OUT') for i in islands), '이어지지 않은 섬이 남았습니다'
        # 2-2) 다리가 하나뿐인 섬에는 하나 더 건다(한쪽만 붙으면 들뜬다)
        for c in cands:
            if c in strips or c[0] > 2:
                continue
            ends = [orig.get(e) for e in (c[3], c[4])]
            if ends[0] != ends[1] and any(e in count and count[e] < 2 for e in ends):
                add(c)

    # 3) 도형: (검은 칸 + 큰 네모) - 다리
    fb = FINDER_GAP if finder_b is None else finder_b
    if finder_bridges:
        shapes = [Polygon(p) for fx, fy in finders for p in finder_shapes(fx, fy, fb, finder_bridges)]
        shapes += [box(x, y, x + 1, y + 1) for y in range(n) for x in range(n) if dark(x, y) and not in_finder(x, y)]
    else:
        shapes = [box(x, y, x + 1, y + 1) for y in range(n) for x in range(n) if dark(x, y)]
    cuts = []
    for _, horizontal, run, _, _ in strips:
        (x1, y1), (x2, y2) = run[0], run[-1]
        cuts.append(box(x1, y1, x2 + 1, y1 + b) if horizontal else box(x1, y1, x1 + b, y2 + 1))
    geom = unary_union(shapes)
    if cuts:
        geom = geom.difference(unary_union(cuts))
    polys = list(geom.geoms) if geom.geom_type == 'MultiPolygon' else [geom]
    if data_bridges and finder_bridges:
        assert not any(p.interiors for p in polys), '판에서 떨어져 나갈 조각이 있습니다'
    out = []
    for p in polys:   # 구멍이 있는 도형(시험용 설정에서만 생김)은 바깥선과 안쪽선을 함께 넘긴다
        out.append([list(p.exterior.coords)[:-1]] + [list(r.coords)[:-1] for r in p.interiors])
    return n, out, len(strips) + finder_bridges * len(finders)


def stencil_image(n, polys, px=30):
    size = n + 2 * BORDER
    im = Image.new('RGB', (size * px, size * px), LIGHT)
    d = ImageDraw.Draw(im)
    for rings in polys:
        d.polygon([((x + BORDER) * px, (y + BORDER) * px) for x, y in rings[0]], fill=DARK)
        for hole in rings[1:]:
            d.polygon([((x + BORDER) * px, (y + BORDER) * px) for x, y in hole], fill=LIGHT)
    return im


def stencil(q, name):
    n, polys, bridges = stencil_polys(q)
    size = n + 2 * BORDER
    d = lambda ring: 'M' + 'L'.join(f'{x + BORDER:.2f} {y + BORDER:.2f}' for x, y in ring) + 'Z'
    paths = ''.join('<path d="' + ''.join(d(r) for r in rings) + '"/>' for rings in polys)
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{STENCIL_MM}mm" height="{STENCIL_MM}mm" '
           f'viewBox="0 0 {size} {size}"><rect width="{size}" height="{size}" fill="{LIGHT}"/>'
           f'<g fill="{DARK}" fill-rule="evenodd">{paths}</g></svg>\n')
    (HERE / f'{name}.svg').write_text(svg, encoding='utf-8')
    stencil_image(n, polys).save(HERE / f'{name}.png')
    return n, len(polys), bridges


def inline_into_pages(q):
    svg = q.svg_inline(scale=1, border=BORDER, dark=DARK, light=LIGHT, omitsize=True)
    svg = svg.replace('<svg ', '<svg role="img" aria-label="설문으로 가는 QR 코드" ', 1)
    for page in ('guide.html', 'handout.html'):
        _fill(ROOT / page, svg)


def _fill(p, svg):
    s = p.read_text(encoding='utf-8')
    s, k = re.subn(r'(<!-- QR:survey:start[^>]*-->).*?(<!-- QR:survey:end -->)',
                   lambda m: m.group(1) + '\n      ' + svg + '\n      ' + m.group(2), s, count=1, flags=re.S)
    assert k == 1, f'{p.name}에서 QR 자리를 찾지 못했습니다'
    p.write_text(s, encoding='utf-8')


if __name__ == '__main__':
    survey = plain(SURVEY_URL, 'survey-qr', 'q')
    guide = plain(GUIDE_URL, 'guide-qr', 'm')
    n, holes, bridges = stencil(guide, 'guide-qr-stencil')
    inline_into_pages(survey)
    cell = STENCIL_MM / (n + 2 * BORDER)
    print(f'survey {survey.designator}  {SURVEY_URL}')
    print(f'guide  {guide.designator}  {GUIDE_URL}')
    print(f'stencil {n}x{n}칸, 구멍 {holes}개, 다리 {bridges}개, {STENCIL_MM}mm일 때 칸 {cell:.1f}mm · 다리 폭 {cell * STENCIL_GAP:.1f}mm(큰 네모는 {cell * FINDER_GAP:.1f}mm)')
