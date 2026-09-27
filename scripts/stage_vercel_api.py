"""Stage current API source and its hosted entrypoint without local credentials."""

import argparse
import shutil
from pathlib import Path


def stage(destination: Path):
    root = Path(__file__).resolve().parents[1]
    destination.mkdir(parents=True, exist_ok=False)
    for source in (root / "deploy/api").iterdir():
        if source.is_file():
            shutil.copy2(source, destination / source.name)
    shutil.copytree(
        root / "services/api/sidebyside_api",
        destination / "services/api/sidebyside_api",
        ignore=shutil.ignore_patterns("__pycache__", "*.pyc", ".env*"),
    )
    for asset in ("ml/policies/online-topic-boundaries-v6.json", "shared/topic-boundaries.json"):
        path = Path(asset)
        (destination / path).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(root / path, destination / path)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("destination", type=Path, help="A new deployment directory")
    stage(parser.parse_args().destination.resolve())
