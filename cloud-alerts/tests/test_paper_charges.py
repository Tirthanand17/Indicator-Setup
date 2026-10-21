"""Phase 42: synthetic fees against dated published NSE equity-option tariff."""
from datetime import date
import pytest
from cloud_alerts.paper_charges import estimate_nse_option_leg, POLICY


def test_buy_fee_parts_one_lot():
    leg=estimate_nse_option_leg(100.08,65,'BUY',on_date=date(2026,10,21))
    assert leg.brokerage_paise==2000 and leg.stt_paise==0
    assert leg.stamp_paise>0 and leg.exchange_paise>0 and leg.gst_paise>0
    assert leg.total_paise==sum((leg.brokerage_paise,leg.exchange_paise,leg.sebi_paise,
                                 leg.gst_paise,leg.stamp_paise,leg.stt_paise))
    assert leg.policy==POLICY and leg.audited is False


def test_sell_fee_stt_rounded_and_no_stamp():
    # 65 x Rs142 = Rs 9230; STT = Rs13.845 => Rs14
    leg=estimate_nse_option_leg(142,65,'SELL')
    assert leg.stt_paise==1400 and leg.stamp_paise==0
    assert leg.brokerage_paise==2000


def test_quantity_does_not_change_flat_brokerage():
    one=estimate_nse_option_leg(100,65,'SELL')
    two=estimate_nse_option_leg(100,130,'SELL')
    assert one.brokerage_paise==two.brokerage_paise==2000
    assert two.total_paise>one.total_paise


def test_reject_invalid_side_price_quantity_and_old_policy_date():
    for x in ('NaN','Infinity',0,-1,None):
        with pytest.raises(ValueError):estimate_nse_option_leg(x,65,'BUY')
    for qty in (0,True,100001):
        with pytest.raises(ValueError):estimate_nse_option_leg(100,qty,'BUY')
    with pytest.raises(ValueError):estimate_nse_option_leg(100,65,'EXERCISE')
    with pytest.raises(ValueError):
        estimate_nse_option_leg(100,65,'SELL',on_date=date(2025,1,1))
