"""Static safety tripwire: no production module may call trading APIs.

Uses AST, so prose/docstrings and the words in this test are not treated as
executed code. It is defense-in-depth, not formal network isolation.
"""
import ast
from pathlib import Path


def test_cloud_runtime_has_no_execution_methods():
    root=Path(__file__).resolve().parents[1]/'cloud_alerts'
    forbidden={'place_order','modify_order','cancel_order','exit_order',
               'convert_position','basket_order','basket_orders','place_gtt',
               'modify_gtt','delete_gtt','trigger_range'}
    assert root.is_dir()
    examined=0
    for file in root.rglob('*.py'):
        tree=ast.parse(file.read_text(encoding='utf-8'),filename=str(file))
        examined+=1
        for node in ast.walk(tree):
            if isinstance(node,ast.Call):
                callee=node.func
                if isinstance(callee,ast.Attribute) and callee.attr in forbidden:
                    raise AssertionError('Real broker order call forbidden: '+str(file.name))
                if isinstance(callee,ast.Name) and callee.id in forbidden:
                    raise AssertionError('Real broker execution function forbidden: '+str(file.name))
    assert examined>=20


def test_kite_wrapper_exposes_only_read_only_market_methods():
    from cloud_alerts.kite_readonly import KiteReadOnly
    listed={x for x in vars(KiteReadOnly) if not x.startswith('_')}
    assert listed=={'instruments_nfo','historical','full_quote','close'}
