"""Explicit read-only daily Kite token handoff from the operator's machine.

Only the two necessary Kite variables are parsed; the broker API secret is
never loaded. No request is made during --check-only. --push fails NONZERO on
failure rather than silently exiting successfully. Cloud hosting is opt-in.
"""
from __future__ import annotations
from pathlib import Path
import argparse,hashlib,json,os,secrets,sys,time,urllib.parse,requests
from .security import signature
from .https_acceptance import validate_public_endpoint

KITE_KEYS=frozenset({'ZERODHA_KITE_API_KEY','ZERODHA_KITE_ACCESS_TOKEN'})
MAX_ENV_BYTES=1024*1024


def read_env_values(path:Path)->dict[str,str]:
    """Read a bounded existing .env WITHOUT writing to it or reading API secret.

    The file is allowed to contain unrelated credentials, but only two Kite
    variable names are retained and returned to the caller.
    """
    path=Path(path)
    if not path.is_file() or path.stat().st_size>MAX_ENV_BYTES:
        raise ValueError('Trading .env unavailable or unexpectedly large')
    result={}
    with path.open('r',encoding='utf-8-sig',errors='strict') as stream:
        for line in stream:
            line=line.strip()
            if not line or line.startswith('#') or '=' not in line:continue
            if line.startswith('export '):line=line[7:].strip()
            key,val=line.split('=',1)
            key=key.strip()
            if key not in KITE_KEYS:continue
            val=val.strip()
            if len(val)>=2 and val[0]==val[-1] and val[0] in ('"',"'"):val=val[1:-1]
            result[key]=val
    return result


def validate_endpoint(endpoint:str)->None:
    """Reject nonpublic/ambiguous hosts; match the production HTTPS probe policy.

    This is structural URL validation, not host approval or proof of DNS safety.
    """
    try:
        validate_public_endpoint(endpoint)
    except (TypeError, ValueError):
        raise ValueError('Token handoff requires approved public HTTPS 443 FQDN /internal/token') from None


def push_once(path:Path,endpoint:str,relay_key:str,expected_key:str)->str:
    validate_endpoint(endpoint)
    if len(relay_key)<32:raise ValueError('TOKEN_RELAY_HMAC_KEY is missing/too short')
    if not expected_key:raise ValueError('KITE_API_KEY not configured')
    values=read_env_values(path)
    api_key=values.get('ZERODHA_KITE_API_KEY','')
    token=values.get('ZERODHA_KITE_ACCESS_TOKEN','')
    if not token or api_key!=expected_key:raise ValueError('Daily token unavailable or API identity mismatch')
    if not (20<=len(token)<=1024 and token.isascii() and not any(c.isspace() for c in token)):
        raise ValueError('Daily token syntax invalid')
    raw=json.dumps({'api_key':api_key,'access_token':token},separators=(',',':')).encode()
    if len(raw)>2048:raise ValueError('Token handoff request too large')
    ts=str(int(time.time()));nonce=secrets.token_hex(20)
    headers={'X-Relay-Timestamp':ts,'X-Relay-Nonce':nonce,
             'X-Relay-Signature':signature(relay_key,ts,nonce,raw),
             'Content-Type':'application/json'}
    try:
        # Do not forward the daily bearer token through ambient HTTP(S)/ALL_PROXY.
        # No redirects, user CA overrides or unverified TLS.
        with requests.Session() as session:
            session.trust_env = False
            response=session.post(endpoint,data=raw,headers=headers,timeout=10,
                                  allow_redirects=False,verify=True)
            if response.status_code!=200 or response.json().get('status')!='TOKEN_ACCEPTED':
                raise RuntimeError('Cloud did not confirm token acceptance')
    except (requests.RequestException,ValueError) as exc:
        raise RuntimeError('Cloud token relay unavailable') from None
    return hashlib.sha256(token.encode()).hexdigest()[:12]


def run(argv:list[str]|None=None)->int:
    parser=argparse.ArgumentParser(description='Read-only Kite env token sender — no protected-folder writes')
    parser.add_argument('--env-file',required=True,type=Path)
    group=parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--check-only',action='store_true')
    group.add_argument('--push',action='store_true')
    group.add_argument('--watch',action='store_true')
    args=parser.parse_args(argv)
    if args.check_only:
        try:
            found=read_env_values(args.env_file)
            present=bool(found.get('ZERODHA_KITE_API_KEY')) and bool(found.get('ZERODHA_KITE_ACCESS_TOKEN'))
        except (OSError,UnicodeError,ValueError):
            present=False
        print('KITE_ENV_KEY_NAMES_PRESENT='+str(present)+'; no credentials printed or transmitted')
        return 0 if present else 2

    endpoint=os.environ.get('KITE_ALERT_TOKEN_ENDPOINT','')
    relay_key=os.environ.get('TOKEN_RELAY_HMAC_KEY','')
    expected=os.environ.get('KITE_API_KEY','')
    last_accepted=None
    while True:
        try:
            current=read_env_values(args.env_file).get('ZERODHA_KITE_ACCESS_TOKEN','')
            fingerprint=hashlib.sha256(current.encode()).hexdigest() if current else None
            if not current:raise ValueError('Daily token missing')
            if fingerprint!=last_accepted:
                push_once(args.env_file,endpoint,relay_key,expected)
                last_accepted=fingerprint
                print('Token handoff accepted by cloud; no credential value logged')
        except (OSError,UnicodeError,ValueError,RuntimeError,requests.RequestException):
            print('Token handoff NOT CONFIRMED; check local token and approved cloud configuration',file=sys.stderr)
            if args.push:return 2
        if args.push:return 0
        time.sleep(45)


def main()->None:
    raise SystemExit(run())

if __name__=='__main__':main()
