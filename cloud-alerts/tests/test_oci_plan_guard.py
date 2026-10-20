"""Offline policy tests only; no Oracle account, network or broker access."""
import copy
import json
from cloud_alerts.oci_plan_guard import review, main


def valid_plan():
    return {
        'provider': 'OCI', 'account_mode': 'ALWAYS_FREE_ONLY',
        'home_region': 'ap-mumbai-1', 'selected_region': 'ap-mumbai-1',
        'shape': 'VM.Standard.A1.Flex', 'requested_ocpu': 1,
        'existing_a1_ocpu': 0, 'requested_memory_gb': 4,
        'existing_a1_memory_gb': 0, 'requested_boot_volume_gb': 50,
        'existing_boot_block_volume_gb': 0,
        'always_free_shape_badge_confirmed': True,
        'always_free_image_confirmed': True,
        'storage_free_eligibility_confirmed': True,
        'zero_cost_public_ipv4_confirmed': True,
        'zero_cost_network_confirmed': True,
        'zero_cost_dns_confirmed': True,
        'no_paid_addons_confirmed': True,
        'idle_reclamation_risk_acknowledged': True,
    }


def test_review_never_authorizes_provision_even_when_structurally_eligible():
    r=review(valid_plan())
    assert r['result']=='STRUCTURAL_PLAN_REVIEW_PASS' and not r['blockers']
    assert r['approved_to_provision'] is False
    assert r['free_cost_guaranteed'] is False
    assert r['instance_provisioned'] is False
    assert r['user_declarations_independently_verified'] is False


def test_rejects_account_trial_paid_and_other_region():
    for field,value in [('account_mode','FREE_TRIAL'),('account_mode','PAYG'),('selected_region','ap-hyderabad-1'),('home_region','unknown')]:
        p=valid_plan();p[field]=value
        assert review(p)['result']=='BLOCKED'


def test_rejects_overfree_ocpu_memory_and_disk_including_existing_usage():
    for field,value in [('requested_ocpu',3),('existing_a1_ocpu',2),
                        ('requested_memory_gb',13),('existing_a1_memory_gb',11),
                        ('requested_boot_volume_gb',49),('requested_boot_volume_gb',201),
                        ('existing_boot_block_volume_gb',151)]:
        p=valid_plan();p[field]=value
        assert review(p)['result']=='BLOCKED', field


def test_rejects_unverified_billable_ipv4_dns_network_image_or_idle_reclaim():
    for key in valid_plan():
        if key.endswith('_confirmed') or key.endswith('_acknowledged'):
            p=valid_plan();p[key]=False
            assert review(p)['result']=='BLOCKED',key


def test_invalid_fields_and_secret_never_echoed():
    p=valid_plan();p['TOKEN_RELAY_HMAC_KEY']='TOP_SECRET_FAKE'
    r=review(p)
    assert r['result']=='BLOCKED'
    assert 'TOP_SECRET_FAKE' not in json.dumps(r)
    p=valid_plan();del p['requested_ocpu']
    assert review(p)['result']=='BLOCKED'


def test_rejects_boolean_as_integer_and_string_numbers():
    for field,value in [('requested_ocpu',True),('requested_memory_gb','4'),
                        ('requested_boot_volume_gb',-1),('existing_a1_ocpu',None)]:
        p=valid_plan();p[field]=value
        assert review(p)['result']=='BLOCKED'


def test_rejects_micro_or_unsupported_shape():
    p=valid_plan();p['shape']='VM.Standard.E2.1.Micro'
    assert review(p)['result']=='BLOCKED'


def test_cli_reads_synthetic_plan_without_network(tmp_path,capsys):
    path=tmp_path/'nonsecret-plan.json';path.write_text(json.dumps(valid_plan()))
    assert main(['--plan',str(path),'--json'])==0
    output=json.loads(capsys.readouterr().out)
    assert output['result']=='STRUCTURAL_PLAN_REVIEW_PASS'
    assert path.read_text()==json.dumps(valid_plan())


def test_cli_invalid_json_is_nonzero_and_safe(tmp_path,capsys):
    path=tmp_path/'invalid.json';path.write_text('{some SECRET value not valid json')
    assert main(['--plan',str(path),'--json'])==2
    assert 'SECRET' not in capsys.readouterr().out


def test_cli_missing_path_is_nonzero(tmp_path,capsys):
    assert main(['--plan',str(tmp_path/'missing.json'),'--json'])==2
    assert json.loads(capsys.readouterr().out)['result']=='BLOCKED'
