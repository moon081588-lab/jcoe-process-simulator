#!/usr/bin/env python3
"""three.js r160.1 빌드를 npm 레지스트리에서 받아 vendor/ 에 넣습니다.

★ `build/three.min.js`(UMD) 는 r150+ 에서 **deprecated** 이고 r160 에서 제거 예정이라,
  파일 자체가 콘솔에 경고를 찍습니다:

      Warning: Scripts "build/three.js" and "build/three.min.js" are deprecated with r150+,
      and will be removed with r160. Please use ES Modules or alternatives.

  이 시뮬레이터는 **의존성 없는 단일 HTML 파일**이라 `<script type="module">` 을 쓸 수 없습니다
  (모듈 스크립트는 defer 라 뒤따르는 일반 스크립트보다 늦게 실행돼 scene3d.js 가 THREE 를 못 봅니다).

  → 권장 빌드인 **`build/three.module.min.js`(ESM)** 을 받아, 파일 맨 끝의 `export{…}` 한 줄만
    `window.THREE={…}` 로 바꿔 **일반 스크립트로 쓸 수 있는 전역 빌드**를 만듭니다.
    코드 본문은 한 글자도 건드리지 않으므로 three.js 의 동작은 ESM 빌드와 동일합니다.
    (2026-08-19 — 콘솔 경고 제거)
"""
import io, pathlib, re, subprocess, tarfile, tempfile

VER = '0.160.1'
R = pathlib.Path(__file__).resolve().parents[1]


def to_global(src: str) -> str:
    """ESM 빌드의 마지막 `export{a as A, b as B};` 를 `window.THREE={A:a,B:b};` 로 바꾼다."""
    assert src.count('export{') == 1, f'export 문이 1개가 아닙니다 ({src.count("export{")}개)'
    i = src.rindex('export{')
    head, body = src[:i], src[i + len('export{'):].rstrip()
    assert body.endswith('};'), '마지막 export 문이 };  로 끝나지 않습니다'
    pairs = []
    for item in body[:-2].split(','):
        item = item.strip()
        m = re.fullmatch(r'(\S+)\s+as\s+(\S+)', item)
        if m:
            pairs.append(f'{m.group(2)}:{m.group(1)}')
        else:                                   # `export{Foo}` 형태
            assert re.fullmatch(r'\w+', item), f'해석할 수 없는 export 항목: {item!r}'
            pairs.append(f'{item}:{item}')
    assert pairs, 'export 항목이 없습니다'
    # ★ IIFE 로 감싼다.
    #   ESM 빌드는 최상위에 `const t="160"` 같은 한 글자 이름을 수백 개 선언한다.
    #   모듈 스코프에서는 안전하지만, 이 파일은 단일 HTML 안의 **일반 <script>** 로 들어가므로
    #   그대로 두면 뒤따르는 engine/flow/ui/scene3d 의 최상위 선언과 이름이 겹쳐
    #   「Identifier 't' has already been declared」 로 페이지 전체가 죽는다.
    #   (종전 UMD 빌드는 자체적으로 IIFE 였다.)
    #   ESM 은 항상 strict 이므로 'use strict' 도 함께 넣어 원래 의미를 유지한다.
    return ('/* three.js r' + VER.split(".")[1] + '.' + VER.split(".")[2]
            + ' — build/three.module.min.js (ESM) 의 마지막 export 문만 전역 할당으로 바꾸고\n'
              '   IIFE 로 감싼 것. 본문은 원본 그대로다 — tools/fetch_three.py 참조.\n'
              '   (UMD build/three.min.js 는 r150+ deprecated 라 콘솔 경고를 찍는다) */\n'
            + '(function(){"use strict";\n'
            + head
            + '\nwindow.THREE={' + ','.join(pairs) + '};\n})();\n')


def main():
    with tempfile.TemporaryDirectory() as td:
        subprocess.run(['npm', 'pack', f'three@{VER}'], cwd=td, check=True,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        tgz = next(pathlib.Path(td).glob('three-*.tgz'))
        with tarfile.open(tgz) as t:
            esm = t.extractfile('package/build/three.module.min.js').read().decode('utf-8')
            lic = t.extractfile('package/LICENSE').read()
    out = to_global(esm)
    n = out.count('window.THREE={')
    assert n == 1, f'전역 할당이 1개가 아닙니다 ({n}개)'
    assert 'are deprecated with r150' not in out, 'deprecated 경고 문자열이 남아 있습니다'
    assert out.lstrip().startswith('/*') and '(function(){"use strict";' in out, 'IIFE 로 감싸지지 않았습니다'
    assert out.rstrip().endswith('})();'), 'IIFE 가 닫히지 않았습니다'
    (R / 'vendor').mkdir(exist_ok=True)
    (R / 'vendor/three.min.js').write_text(out, encoding='utf-8')
    (R / 'vendor/three-LICENSE').write_bytes(lic)
    print(f'[ok] vendor/three.min.js  ({len(out)/1024:.0f} KB · export {out.count(":")and ""}'
          f'{len(re.findall(r",", out[out.rindex("window.THREE={"):]))+1}개 전역화)')


if __name__ == '__main__':
    main()
