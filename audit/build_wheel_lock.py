"""Build a platform-specific hashed QA lock from downloaded, pinned wheels."""
import hashlib
import re
import sys
from pathlib import Path
from zipfile import ZipFile
from email.parser import BytesParser

root = Path(__file__).resolve().parents[1]
normalize = lambda name: re.sub(r"[-_.]+", "-", name).lower()
pins = {}
for line in (root / "cloud-alerts/requirements-linux-test.lock").read_text().splitlines():
    if line and not line.startswith("#"):
        name, version = line.split("==")
        pins[normalize(name)] = version
found = {}
for wheel in Path(sys.argv[1]).glob("*.whl"):
    with ZipFile(wheel) as archive:
        names = [n for n in archive.namelist() if n.endswith(".dist-info/METADATA")]
        if len(names) != 1:
            raise ValueError("ambiguous wheel metadata")
        metadata = BytesParser().parsebytes(archive.read(names[0]))
    name, version = normalize(metadata["Name"]), metadata["Version"]
    if name not in pins or pins[name] != version or name in found:
        raise ValueError("unexpected or duplicate wheel")
    found[name] = hashlib.sha256(wheel.read_bytes()).hexdigest()
if found.keys() != pins.keys():
    raise ValueError("missing pinned wheels")
output = root / "cloud-alerts/requirements-linux-test.hashed.lock"
output.write_text("# Python3.12 Linux x86_64 wheels only; install with --require-hashes.\n" +
    "".join(f"{name}=={pins[name]} --hash=sha256:{found[name]}\n" for name in sorted(pins)))
print(f"Hashed {len(pins)} exact wheel artifacts")
