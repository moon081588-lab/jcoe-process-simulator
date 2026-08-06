#!/usr/bin/env python3
"""JCOE 3D 시뮬레이터 빌드 — three.js 를 인라인 내장한 단일 HTML 을 저장소 루트에 씁니다.

    python3 source/build3d.py   →  ./JCOE_3D.html

source/vendor/three.min.js 가 없으면 `python3 source/tools/fetch_three.py` 를 먼저 실행하세요.
"""
import json, pathlib, sys
R = pathlib.Path(__file__).resolve().parent          # source/
OUT = R.parent                                        # 저장소 루트 — HTML 은 여기에 떨어집니다
three = R/'vendor/three.min.js'
if not three.exists():
    sys.exit('source/vendor/three.min.js 가 없습니다. `python3 source/tools/fetch_three.py` 를 먼저 실행하세요.')
tpl = (R/'src3d/shell3d.html').read_text(encoding='utf-8')
out = (tpl
  .replace('__THREE__',  three.read_text(encoding='utf-8'))
  .replace('__TABLES__', json.dumps(json.loads((R/'data/tables.json').read_text(encoding='utf-8')), ensure_ascii=False))
  .replace('__ORDERS__', json.dumps(json.loads((R/'data/orders.json').read_text(encoding='utf-8')), ensure_ascii=False))
  .replace('__XLSX__',     (R/'vendor/xlsx.full.min.js').read_text(encoding='utf-8'))
  .replace('__PLANLOAD__', (R/'src/planload.js').read_text(encoding='utf-8'))
  .replace('__ENGINE__', (R/'src/engine.js').read_text(encoding='utf-8'))
  .replace('__FLOW__',   (R/'src/flow.js').read_text(encoding='utf-8'))
  .replace('__SCENE__',  (R/'src3d/scene3d.js').read_text(encoding='utf-8')))
p = OUT/'JCOE_3D.html'
p.write_text(out, encoding='utf-8')
print(f'[built] {p}  {len(out)/1024:.0f} KB')
