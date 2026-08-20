#!/usr/bin/env python3
"""엑셀에 **이미지로만** 들어 있는 내용을 찾아 꺼냅니다.

    python3 tools/extract_images.py "★JCOE 공정 생산 표준 시간 분석 ....xlsx" [-o out_dir]

왜 필요한가
-----------
2026-08-06 확인 요청 ①에서 「Expander(2호기) 시트가 966행 × 62열인데 값이 있는 셀이
0개」라고 보고했습니다. 2026-08-14 세아제강 회신 — **내용이 이미지로 붙어 있어서**
텍스트 추출로는 보이지 않았던 것입니다.

xlsx 는 ZIP 이고 그림은 `xl/media/*` 에, 붙은 위치는 `xl/drawings/drawing*.xml` 에
따로 들어 있어 openpyxl 의 셀 순회로는 절대 잡히지 않습니다. 그래서 시트를 "비어 있다"
고 판정하기 전에 이 스크립트를 먼저 돌려야 합니다.

출력
----
  out_dir/<시트명>__<셀>__<파일명>.png   시트·앵커 셀 이름을 붙여 저장
  표준출력                                시트별 [값 있는 셀 수 / 이미지 수 / 메모 수]

실제로 이 스크립트로 찾아낸 것 (20251231 송부본)
  Total Summary!S22  Expander 1호기 — 확관 Step Size = 다이 Size − 150,
                     N = ROUNDUP(L / StepSize),  예: 12,802/(550−150) = 33회
  Total Summary!S23  Expander 2호기 — N = ROUNDUP((L−(S_start+S_end))/(F−O)) + 2 + α
  Expander(RB)!J4    R/B          — 확관 Step Size = 다이 Size − 90
"""
import argparse
import pathlib
import posixpath
import re
import sys
import zipfile


def resolve(base_path: str, target: str) -> str:
    """rels 의 상대 Target(../media/image1.png) 을 ZIP 안 절대 경로로 편다"""
    return posixpath.normpath(posixpath.join(posixpath.dirname(base_path), target))

NS_R = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'


def col_name(idx: int) -> str:
    s = ''
    idx += 1
    while idx:
        idx, r = divmod(idx - 1, 26)
        s = chr(65 + r) + s
    return s


def sheet_names(z: zipfile.ZipFile):
    """workbook.xml + rels → [(시트명, 'xl/worksheets/sheetN.xml'), ...] 순서대로"""
    import xml.etree.ElementTree as ET
    wb = ET.fromstring(z.read('xl/workbook.xml'))
    rels = ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))
    tgt = {r.get('Id'): r.get('Target') for r in rels}
    out = []
    for sh in wb.iter():
        if sh.tag.endswith('}sheet'):
            t = tgt.get(sh.get(NS_R + 'id'), '')
            out.append((sh.get('name'), resolve('xl/workbook.xml', t)))
    return out


def anchors(z: zipfile.ZipFile, drawing_path: str):
    """drawing XML → [(col, row, media 경로), ...]"""
    import xml.etree.ElementTree as ET
    try:
        xml = z.read(drawing_path).decode('utf-8')
    except KeyError:
        return []
    rels_path = resolve(drawing_path, '_rels/' + posixpath.basename(drawing_path) + '.rels')
    rid = {}
    try:
        for r in ET.fromstring(z.read(rels_path)):
            rid[r.get('Id')] = resolve(drawing_path, r.get('Target'))
    except KeyError:
        pass
    out = []
    for m in re.finditer(r'<xdr:(twoCell|oneCell|absolute)Anchor.*?</xdr:\1Anchor>', xml, re.S):
        blk = m.group(0)
        fr = re.search(r'<xdr:from>\s*<xdr:col>(\d+)</xdr:col>.*?<xdr:row>(\d+)</xdr:row>', blk, re.S)
        emb = re.search(r'r:embed="(rId\d+)"', blk)
        if not emb:
            continue
        tgt = rid.get(emb.group(1), '')
        out.append(((int(fr.group(1)) if fr else 0), (int(fr.group(2)) if fr else 0), tgt))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('xlsx')
    ap.add_argument('-o', '--out', default='xlsx_images')
    a = ap.parse_args()

    path = pathlib.Path(a.xlsx)
    if not path.exists():
        sys.exit(f'파일이 없습니다: {path}')
    out = pathlib.Path(a.out)
    out.mkdir(parents=True, exist_ok=True)

    z = zipfile.ZipFile(path)
    import xml.etree.ElementTree as ET

    n_img = 0
    print(f'== {path.name}')
    for name, sheet_path in sheet_names(z):
        try:
            body = z.read(sheet_path).decode('utf-8')
        except KeyError:
            continue
        cells = len(re.findall(r'<c\b[^>]*>\s*<(v|is|f)\b', body))
        rels_path = resolve(sheet_path, '_rels/' + posixpath.basename(sheet_path) + '.rels')
        drawings, comments = [], 0
        try:
            for r in ET.fromstring(z.read(rels_path)):
                t = r.get('Type', '')
                tg = resolve(sheet_path, r.get('Target'))
                if t.endswith('/drawing'):
                    drawings.append(tg)
                elif t.endswith('/comments'):
                    comments = len(re.findall(r'<comment\b', z.read(tg).decode('utf-8')))
        except KeyError:
            pass

        imgs = [x for d in drawings for x in anchors(z, d)]
        flag = '  ← 값 0 · 이미지 있음 (텍스트 추출로는 안 보임)' if cells == 0 and imgs else ''
        print(f'  {name:<24} 값 {cells:>6} 셀 · 이미지 {len(imgs)} · 메모 {comments}{flag}')
        for col, row, media in imgs:
            try:
                data = z.read(media)
            except KeyError:
                continue
            safe = re.sub(r'[^\w가-힣().-]', '_', name)
            fn = out / f'{safe}__{col_name(col)}{row + 1}__{pathlib.PurePosixPath(media).name}'
            fn.write_bytes(data)
            n_img += 1
            print(f'      → {fn}')

    print(f'\n이미지 {n_img}개를 {out}/ 에 저장했습니다.')
    print('시트가 "비어 있다" 고 판정하기 전에 반드시 이 목록을 먼저 확인하세요.')


if __name__ == '__main__':
    main()
