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


class TokenRollbackError(ValueError):
    """A signed but older daily relay must not replace a newer credential."""


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
    _relay_at:int|None=None

    def __post_init__(self):
        if not self.vault_key:raise ValueError('TOKEN_VAULT_KEY required')
        Fernet(self.vault_key.encode())

    def put(self,token:str,now:datetime, *, relay_at:int|None=None)->None:
        """Persist a token only if its authenticated relay is not older.

        relay_at is the unix timestamp in the HMAC-signed request. Comparing
        receive time cannot guard against requests arriving out of order.
        Equal-time, equal-token retransmissions are idempotent; equal-time
        different tokens are ambiguous and rejected.
        """
        if not isinstance(now,datetime) or now.tzinfo is None or now.utcoffset() is None:
            raise ValueError('aware receive timestamp required')
        if not (isinstance(token,str) and 20<=len(token)<=1024 and token.isascii()
                and not any(ch.isspace() for ch in token)):
            raise ValueError('invalid daily token syntax')
        if relay_at is None:
            relay_at=int(now.timestamp())  # compatibility for direct offline consumers
        if type(relay_at) is not int or relay_at < 1 or relay_at > 2**63-1:
            raise ValueError('invalid signed relay timestamp')
        now_ist=now.astimezone(IST)
        # A signed request from *before* the 06:00 IST broker expiry must
        # never be reclassified as next-day valid simply because it arrived
        # inside the 90-second authenticated clock-skew window after 06:00.
        expiry=next_expiry(datetime.fromtimestamp(relay_at,IST))
        if now_ist>=expiry:
            raise TokenRollbackError('signed relay refers to an expired session')
        # Expired credentials have no ordering authority over a new session.
        if self._expires is not None and now_ist>=self._expires:
            self._token=None;self._expires=None;self._relay_at=None
        if self._relay_at is not None:
            if relay_at < self._relay_at:
                raise TokenRollbackError('older signed relay rejected')
            if relay_at == self._relay_at:
                if self._token==token:
                    return  # same signed second and token, no second write
                raise TokenRollbackError('ambiguous equal-time relay rejected')
        payload=json.dumps({'access_token':token,'expires':expiry.isoformat(),
                            'relay_at':relay_at},separators=(',',':')).encode()
        encrypted=Fernet(self.vault_key.encode()).encrypt(payload)
        self.file_path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
        fd,name=tempfile.mkstemp(dir=self.file_path.parent,prefix='.token-',suffix='.tmp')
        try:
            os.fchmod(fd,0o600)
            with os.fdopen(fd,'wb') as f:
                f.write(encrypted);f.flush();os.fsync(f.fileno())
            os.replace(name,self.file_path)
            # fsync the containing directory to make the replace durable on
            # POSIX hosts. Windows does not expose O_DIRECTORY in the same way.
            if os.name=='posix' and hasattr(os,'O_DIRECTORY'):
                directory_fd=os.open(self.file_path.parent,os.O_RDONLY|os.O_DIRECTORY)
                try:os.fsync(directory_fd)
                finally:os.close(directory_fd)
        finally:
            if os.path.exists(name):os.unlink(name)
        self._token=token;self._expires=expiry;self._relay_at=relay_at

    def load(self,now:datetime)->bool:
        try:
            raw=Fernet(self.vault_key.encode()).decrypt(self.file_path.read_bytes())
            stored=json.loads(raw)
            expiry=datetime.fromisoformat(stored['expires'])
            if expiry.tzinfo is None or expiry.utcoffset() is None:
                raise ValueError('invalid stored expiry')
            if now.astimezone(IST)>=expiry:
                self._token=None;self._expires=None;self._relay_at=None;return False
            token=stored['access_token']
            if (not isinstance(token,str) or not 20<=len(token)<=1024
                    or not token.isascii() or any(ch.isspace() for ch in token)):
                raise ValueError('token invalid')
            relay_at=stored.get('relay_at')  # legacy encrypted vaults remain readable
            if relay_at is not None and (type(relay_at) is not int or relay_at<1):
                raise ValueError('invalid stored relay timestamp')
            self._token=token;self._expires=expiry;self._relay_at=relay_at
            return True
        except (FileNotFoundError,InvalidToken,KeyError,ValueError,TypeError,json.JSONDecodeError):
            self._token=None;self._expires=None;self._relay_at=None;return False

    def get(self,now:datetime)->str|None:
        if self._expires is not None and now.astimezone(IST)<self._expires:return self._token
        self._token=None;self._expires=None;self._relay_at=None;return None
