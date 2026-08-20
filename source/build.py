#!/usr/bin/env python3
"""JCOE 시뮬레이터 빌드 — source/{src,src3d,data,vendor} 를 **단일 HTML** 로 합칩니다.

    python3 source/build.py     →  ./JCOE_Simulator.html

2D 화면과 3D 공장 뷰가 **한 파일**에 들어 있습니다.
종전에는 build3d.py 로 JCOE_3D.html 을 따로 만들었는데, 그러면
  · 엔진(engine/flow/planload)과 xlsx 880KB 가 두 파일에 중복되고
  · 3D 에는 기준정보·실적 검증 탭이 없어 **두 화면이 서로 다른 답**을 보여줄 수 있었습니다.
이제 계산은 2D 앱에서 한 번만 하고, 3D 는 그 결과(SIM)를 받아 그리기만 합니다.
"""
import json, pathlib
R = pathlib.Path(__file__).resolve().parent          # source/
OUT = R.parent                                        # 저장소 루트 — HTML 은 여기에 떨어집니다
tpl = (R/'src/shell.html').read_text(encoding='utf-8')
out = (tpl
  .replace('__TABLES__', json.dumps(json.loads((R/'data/tables.json').read_text(encoding='utf-8')), ensure_ascii=False))
  .replace('__ORDERS__', json.dumps(json.loads((R/'data/orders.json').read_text(encoding='utf-8')), ensure_ascii=False))
  .replace('__XLSX__',     (R/'vendor/xlsx.full.min.js').read_text(encoding='utf-8'))
  .replace('__PLANLOAD__', (R/'src/planload.js').read_text(encoding='utf-8'))
  .replace('__ENGINE__', (R/'src/engine.js').read_text(encoding='utf-8'))
  .replace('__FLOW__',   (R/'src/flow.js').read_text(encoding='utf-8'))
  .replace('__PRODLOG__',(R/'src/prodlog.js').read_text(encoding='utf-8'))
  .replace('__THREE__',  (R/'vendor/three.min.js').read_text(encoding='utf-8'))
  .replace('__SCENE3D__', (R/'src3d/scene3d.js').read_text(encoding='utf-8'))
  .replace('__UI__',     (R/'src/ui.js').read_text(encoding='utf-8')))
p = OUT/'JCOE_Simulator.html'
p.write_text(out, encoding='utf-8')
print(f'[built] {p}  {len(out)/1024:.0f} KB')
