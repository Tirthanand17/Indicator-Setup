"""Daily single-purpose token handoff. No broker API secret travels to cloud.

All durable tokens are encrypted using a *separate* operator-controlled Fernet key.
The code deliberately never prints the token, Authorization header, or signed body.
"""
from __future__ import annotations
from dataclasses import dataclass
from datetime import datetime,timedelta,time
from zoneinfo import ZoneInfo
import hashlib,hmac,json,os,tempfile
from pathlib import Path
from cryptography.fernet import Fernet,InvalidToken
IST=ZoneInfo('Asia/Kolkata')


def signature(relay_key:str,timestamp:str,nonce:str,raw_body:bytes)->str:
    body=timestamp.encode()+b'\n'+nonce.encode()+b'\n'+raw_body
    return hmac.new(relay_key.encode(),body,hashlib.sha256).hexdigest()


def verify_relay(key:str,timestamp:str,nonce:str,digest:str,raw_body:bytes,now:datetime,max_skew_seconds:int=90)->bool:
    if not key or len(key)<32 or len(nonce)<24 or len(nonce)>128 or not nonce.isascii():return False
    if len(raw_body)>2048 or len(digest)!=64:return False
    try:
        moment=datetime.fromtimestamp(int(timestamp),IST)
        if abs((now.astimezone(IST)-moment).total_seconds())>max_skew_seconds:return False
    except (ValueError,OverflowError,TypeError):return False
    return hmac.compare_digest(digest,signature(key,timestamp,nonce,raw_body))


def next_expiry(now:datetime)->datetime:
    local=now.astimezone(IST)
    boundary=datetime.combine(local.date(),time(6),tzinfo=IST)
    if local>=boundary:boundary+=timedelta(days=1)
    return boundary

@dataclass
class TokenVault:
    """Encrypted-at-rest cloud credential; persistence path must be on durable volume."""
    file_path:Path
    vault_key:str
    _token:str|None=None
    _expires:datetime|None=None

    def __post_init__(self):
        if not self.vault_key:raise ValueError('TOKEN_VAULT_KEY required')
        Fernet(self.vault_key.encode())

    def put(self,token:str,now:datetime)->None:
        if not (20<=len(token)<=1024 and token.isascii() and not any(ch.isspace() for ch in token)):
            raise ValueError('invalid daily token syntax')
        expiry=next_expiry(now)
        payload=json.dumps({'access_token':token,'expires':expiry.isoformat()},separators=(',',':')).encode()
        encrypted=Fernet(self.vault_key.encode()).encrypt(payload)
        self.file_path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
        fd,name=tempfile.mkstemp(dir=self.file_path.parent,prefix='.token-',suffix='.tmp')
        try:
            os.fchmod(fd,0o600)
            with os.fdopen(fd,'wb') as f:
                f.write(encrypted);f.flush();os.fsync(f.fileno())
            os.replace(name,self.file_path)
        finally:
            if os.path.exists(name):os.unlink(name)
        self._token=token;self._expires=expiry

    def load(self,now:datetime)->bool:
        try:
            raw=Fernet(self.vault_key.encode()).decrypt(self.file_path.read_bytes())
            stored=json.loads(raw)
            expiry=datetime.fromisoformat(stored['expires'])
            if now.astimezone(IST)>=expiry:
                self._token=None;self._expires=None;return False
            token=stored['access_token']
            if not isinstance(token,str) or len(token)<20:raise ValueError('token invalid')
            self._token=token;self._expires=expiry
            return True
        except (FileNotFoundError,InvalidToken,KeyError,ValueError,TypeError,json.JSONDecodeError):
            self._token=None;self._expires=None;return False

    def get(self,now:datetime)->str|None:
        if self._expires is not None and now.astimezone(IST)<self._expires:return self._token
        self._token=None;self._expires=None;return None
