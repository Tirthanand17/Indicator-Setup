"""Offline whole-tree inventory, Python parsing and local import-cycle checks.

Reports paths and counts only, never source text or credential values.
This is static evidence, not a claim that every branch has been manually reviewed.
"""
from pathlib import Path
import ast
import hashlib
import json
import subprocess

ROOT=Path(__file__).resolve().parents[1]
files=subprocess.check_output(['git','ls-files','-z'],cwd=ROOT).decode().split('\0')
files=sorted(p for p in files if p)
graph={}
inventory=[]
for name in files:
    path=ROOT/name
    raw=path.read_bytes()
    record={'path':name,'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()}
    if path.suffix=='.py':
        tree=ast.parse(raw.decode('utf-8-sig'),filename=name)
        if path.parent.name=='cloud_alerts':
            graph[path.stem]=sorted({n.module.split('.')[0] for n in ast.walk(tree)
                if isinstance(n,ast.ImportFrom) and n.level==1 and n.module})
        record['functions']=sum(isinstance(n,(ast.FunctionDef,ast.AsyncFunctionDef)) for n in ast.walk(tree))
    inventory.append(record)
cycles=set()
def walk(node,trail):
    if node in trail:
        cycles.add(tuple(trail[trail.index(node):]+[node]));return
    for target in graph.get(node,[]):
        walk(target,trail+[node])
for node in graph:walk(node,[])
report={'tracked_files':len(files),'python_files':sum(x['path'].endswith('.py') for x in inventory),
        'local_import_cycles':[list(x) for x in sorted(cycles)],'inventory':inventory}
output=ROOT/'audit'/'repository-inventory.json'
output.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
print(json.dumps({k:v for k,v in report.items() if k!='inventory'}))
