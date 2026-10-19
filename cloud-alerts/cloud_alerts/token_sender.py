"""Opt-in read-only daily token relay from Nirala to independently running cloud.

Reads the existing protected .env file only. Never modifies it or prints secrets.
No traffic until --push or --watch is explicitly selected by operator.
"""
from __future__ import annotations
from pathlib import Path
import argparse,hashlib,hmac,json,os,secrets,time,urllib.parse,requests
from .security import signature


def read_env_values(path:Path)->dict[str,str]:
    result={}
    # Do NOT rewrite/edit/delete anything within this directory.
    for line in path.read_text(encoding='utf-8-sig',errors='strict').splitlines():
        line=line.strip()
        if not line or line.startswith('#') or '=' not in line:continue
        if line.startswith('export '):line=line[7:].strip()
        key,val=line.split('=',1)
        # Preserve value literals, strip optional single/double quotes only.
        val=val.strip()
        if len(val)>=2 and val[0]==val[-1] and val[0] in ('\"',"'"):val=val[1:-1]
        result[key.strip()]=val
    return result


def push_once(path:Path,endpoint:str,relay_key:str,expected_key:str)->str:
    if not endpoint.startswith('https://'):
        raise ValueError('Token handoff requires HTTPS (never a public HTTP endpoint).')
    u=urllib.parse.urlsplit(endpoint)
    if not u.hostname or u.username or u.password or u.fragment or u.query or u.path!='/internal/token':
        raise ValueError('Handoff URL must be exact https://host/internal/token')
    if len(relay_key)<32:raise ValueError('TOKEN_RELAY_HMAC_KEY is missing/too short')
    values=read_env_values(path)
    api_key=values.get('ZERODHA_KITE_API_KEY','')
    token=values.get('ZERODHA_KITE_ACCESS_TOKEN','')
    if not token or api_key!=expected_key:raise ValueError('Daily access token unavailable or wrong API key')
    raw=json.dumps({'api_key':api_key,'access_token':token},separators=(',',':')).encode()
    ts=str(int(time.time()));nonce=secrets.token_hex(20)
    headers={'X-Relay-Timestamp':ts,'X-Relay-Nonce':nonce,'X-Relay-Signature':signature(relay_key,ts,nonce,raw),'Content-Type':'application/json'}
    try:
        response=requests.post(endpoint,data=raw,headers=headers,timeout=10,allow_redirects=False)
        if response.status_code!=200:
            raise RuntimeError('Token relay rejected request (HTTP '+str(response.status_code)+')')
        if response.json().get('status')!='TOKEN_ACCEPTED':raise RuntimeError('Token relay did not confirm acceptance')
    except (requests.RequestException,ValueError) as exc:
        raise RuntimeError('Token relay unavailable; inspect cloud health without exposing token') from None
    return hashlib.sha256(token.encode()).hexdigest()[:12] # fingerprint only; never the token


def main():
    parser=argparse.ArgumentParser(description='Read-only Kite env token sender — no writes to trading folder')
    parser.add_argument('--env-file',required=True,type=Path)
    group=parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--check-only',action='store_true')
    group.add_argument('--push',action='store_true')
    group.add_argument('--watch',action='store_true')
    args=parser.parse_args()
    values=read_env_values(args.env_file)
    exists=bool(values.get('ZERODHA_KITE_API_KEY')) and bool(values.get('ZERODHA_KITE_ACCESS_TOKEN'))
    if args.check_only:
        print('KITE_ENV_KEY_NAMES_PRESENT='+str(exists)+'; no credentials printed or transmitted')
        return
    endpoint=os.environ.get('KITE_ALERT_TOKEN_ENDPOINT','')
    relay_key=os.environ.get('TOKEN_RELAY_HMAC_KEY','')
    expected=os.environ.get('KITE_API_KEY','')
    last=None
    while True:
        try:
            current=read_env_values(args.env_file).get('ZERODHA_KITE_ACCESS_TOKEN','')
            fp=hashlib.sha256(current.encode()).hexdigest() if current else None
            if current and fp!=last:
                push_once(args.env_file,endpoint,relay_key,expected)
                last=fp
                print('Token handoff accepted by cloud; token value never logged')
        except Exception:
            print('Token handoff waiting or failed; verify local .env and cloud configuration')
        if not args.watch:break
        time.sleep(45)

if __name__=='__main__':main()
