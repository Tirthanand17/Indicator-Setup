"""Single-process admission only; no distributed perimeter or cost guarantee."""
import time


class TokenAdmission:
    def __init__(self):
        self.started = time.monotonic()
        self.attempts = 0
        self.active = 0

    def claim(self) -> bool:
        now = time.monotonic()
        if now - self.started >= 60:
            self.started = now
            self.attempts = 0
        if now < self.started or self.attempts >= 60 or self.active >= 4:
            return False
        self.attempts += 1
        self.active += 1
        return True

    def release(self) -> None:
        self.active -= 1
