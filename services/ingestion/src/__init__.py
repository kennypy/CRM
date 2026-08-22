import sys
from pathlib import Path

# Make `import nexcrm_shared` resolve when running from the repo checkout
# (services/_shared/nexcrm_shared). In Docker the package is copied next to
# src/ under /app, which is already on sys.path, so this insert is a no-op there.
_shared = Path(__file__).resolve().parent.parent.parent / "_shared"
if _shared.is_dir() and str(_shared) not in sys.path:
    sys.path.insert(0, str(_shared))
