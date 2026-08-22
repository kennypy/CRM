import sys
from pathlib import Path

# Resolve `import nexcrm_shared` (services/_shared) and `import src` for tests
# run from this service directory.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "_shared"))
sys.path.insert(0, str(Path(__file__).resolve().parent))
