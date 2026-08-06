#!/usr/bin/env python3
"""three.js r160.1 의 빌드 파일을 npm 레지스트리에서 받아 vendor/ 에 넣습니다."""
import io, pathlib, subprocess, sys, tarfile, tempfile
VER = '0.160.1'
R = pathlib.Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory() as td:
    subprocess.run(['npm', 'pack', f'three@{VER}'], cwd=td, check=True,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    tgz = next(pathlib.Path(td).glob('three-*.tgz'))
    with tarfile.open(tgz) as t:
        f = t.extractfile('package/build/three.min.js')
        (R/'vendor').mkdir(exist_ok=True)
        (R/'vendor/three.min.js').write_bytes(f.read())
        lic = t.extractfile('package/LICENSE')
        (R/'vendor/three-LICENSE').write_bytes(lic.read())
print('[ok] vendor/three.min.js')
