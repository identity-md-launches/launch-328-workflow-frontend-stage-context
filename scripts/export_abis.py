#!/usr/bin/env python3
"""Export deterministic compiler ABIs, or verify delivered exports with --check."""

import argparse
import json
from pathlib import Path
import subprocess


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    for name in ("LaunchToken", "RentableNFT"):
        result = subprocess.run(
            ["forge", "inspect", f"src/{name}.sol:{name}", "abi", "--json"],
            cwd=root,
            check=True,
            text=True,
            capture_output=True,
        )
        exported = json.dumps(json.loads(result.stdout), indent=2) + "\n"
        destination = root / "docs" / "abi" / f"{name}.json"
        if args.check:
            if not destination.is_file() or destination.read_text() != exported:
                raise SystemExit(f"ABI mismatch: {destination.relative_to(root)}")
            print(f"Verified {destination.relative_to(root)}")
        else:
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_text(exported)
            print(f"Exported {destination.relative_to(root)}")


if __name__ == "__main__":
    main()
