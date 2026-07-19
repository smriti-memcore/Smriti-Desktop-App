"""
sidecar_build.py
─────────────────
Builds a fully self-contained smriti-daemon binary using PyInstaller.

Strategy
────────
1. Create a temporary, isolated venv inside sidecars/build_venv/
2. Install smriti-memcore (from PyPI) + all runtime deps into that venv
3. Run PyInstaller from that venv so every dependency is bundled into the
   single-file executable — no Python, no pip, no local repo needed on the
   end-user's machine
4. Copy the resulting binary to src-tauri/sidecars/ with the correct
   Tauri target-triple suffix
5. Clean up the build venv and PyInstaller artifacts

Usage
─────
    # macOS arm64 (Apple Silicon) — run inside SMRITI's virtualenv
    python3 sidecars/sidecar_build.py

    # optionally pin a specific smriti-memcore version
    python3 sidecars/sidecar_build.py --smriti-version 1.4.15
"""

import argparse
import os
import platform
import shutil
import subprocess
import sys
from pathlib import Path

# ── Paths ──────────────────────────────────────────────────────────────────
SCRIPT_DIR = Path(__file__).parent.resolve()
DAEMON_PATH = SCRIPT_DIR / "desktop_daemon.py"
TAURI_SIDECAR_DIR = SCRIPT_DIR.parent / "src-tauri" / "sidecars"
BUILD_VENV_DIR = SCRIPT_DIR / "build_venv"

# Runtime dependencies that must be bundled.
# sentence-transformers pulls in torch/transformers which PyInstaller needs help with.
RUNTIME_DEPS = [
    "smriti-memcore",
    "pyinstaller",
    "sentence-transformers",
    "requests",
    "numpy",
]


# ── Helpers ────────────────────────────────────────────────────────────────
def get_target_triple() -> str:
    system = platform.system().lower()
    machine = platform.machine().lower()

    if system == "darwin":
        return "aarch64-apple-darwin" if ("arm" in machine or "aarch64" in machine) else "x86_64-apple-darwin"
    elif system == "windows":
        return "aarch64-pc-windows-msvc" if ("arm" in machine or "aarch64" in machine) else "x86_64-pc-windows-msvc"
    elif system == "linux":
        return "aarch64-unknown-linux-gnu" if ("arm" in machine or "aarch64" in machine) else "x86_64-unknown-linux-gnu"
    else:
        raise ValueError(f"Unsupported OS: {system}")


def run(cmd: list, **kwargs):
    """Run a subprocess, streaming output, raising on failure."""
    print(f"\n$ {' '.join(str(c) for c in cmd)}\n")
    subprocess.run(cmd, check=True, **kwargs)


def venv_python() -> Path:
    """Return the python executable inside the build venv."""
    if platform.system().lower() == "windows":
        return BUILD_VENV_DIR / "Scripts" / "python.exe"
    return BUILD_VENV_DIR / "bin" / "python3"


# ── Build steps ────────────────────────────────────────────────────────────
def create_build_venv():
    print("── Step 1/5: Creating isolated build venv …")
    if BUILD_VENV_DIR.exists():
        shutil.rmtree(BUILD_VENV_DIR)
    run([sys.executable, "-m", "venv", str(BUILD_VENV_DIR)])


def install_deps(smriti_version: str | None):
    print("── Step 2/5: Installing runtime dependencies …")
    deps = list(RUNTIME_DEPS)
    
    run(
        [str(venv_python()), "-m", "pip", "install", "--upgrade", "pip"],
    )
    
    local_path = Path("/Users/shivtatva/HomeProjects/Memory")
    if local_path.exists() and not smriti_version:
        print(f"   Installing local smriti-memcore from {local_path} …")
        deps = [d for d in deps if d != "smriti-memcore"]
        run(
            [str(venv_python()), "-m", "pip", "install", str(local_path)],
        )
    elif smriti_version:
        deps = [f"smriti-memcore=={smriti_version}" if d == "smriti-memcore" else d for d in deps]

    run(
        [str(venv_python()), "-m", "pip", "install", *deps],
    )


def compile_binary(target_triple: str) -> Path:
    print("── Step 3/5: Compiling with PyInstaller …")

    build_dir = SCRIPT_DIR / "build"
    dist_dir = SCRIPT_DIR / "dist"
    for d in (build_dir, dist_dir):
        if d.exists():
            shutil.rmtree(d)

    binary_name = f"smriti-daemon-{target_triple}"

    # --collect-all smriti_memcore: bundle every submodule + data file
    # --collect-all sentence_transformers: needed for transformer pipelines
    # --hidden-import: modules dynamically imported at runtime
    cmd = [
        str(venv_python()),
        "-m",
        "PyInstaller",
        "--clean",
        "--onefile",
        "--name", binary_name,
        "--collect-all", "smriti_memcore",
        "--collect-all", "sentence_transformers",
        "--collect-all", "transformers",
        "--hidden-import", "smriti_memcore.core",
        "--hidden-import", "smriti_memcore.models",
        "--hidden-import", "smriti_memcore.palace",
        "--hidden-import", "smriti_memcore.consolidation",
        "--hidden-import", "smriti_memcore.episode_buffer",
        "--hidden-import", "smriti_memcore.vector_store",
        "--hidden-import", "smriti_memcore.working_memory",
        "--hidden-import", "smriti_memcore.llm_interface",
        "--hidden-import", "smriti_memcore.retrieval",
        "--hidden-import", "smriti_memcore.metrics",
        "--hidden-import", "smriti_memcore.attention_gate",
        "--hidden-import", "smriti_memcore.meta_memory",
        str(DAEMON_PATH),
    ]

    run(cmd, cwd=str(SCRIPT_DIR))

    ext = ".exe" if platform.system().lower() == "windows" else ""
    compiled = dist_dir / f"{binary_name}{ext}"
    if not compiled.exists():
        raise FileNotFoundError(f"Expected binary not found: {compiled}")
    return compiled


def copy_to_tauri(compiled: Path, target_triple: str):
    print("── Step 4/5: Copying binary to src-tauri/sidecars/ …")
    TAURI_SIDECAR_DIR.mkdir(parents=True, exist_ok=True)
    ext = ".exe" if platform.system().lower() == "windows" else ""
    dest = TAURI_SIDECAR_DIR / f"smriti-daemon-{target_triple}{ext}"
    shutil.copy2(compiled, dest)
    os.chmod(dest, 0o755)
    size_mb = dest.stat().st_size / (1024 * 1024)
    print(f"   ✓ {dest}  ({size_mb:.1f} MB)")


def cleanup():
    print("── Step 5/5: Cleaning up build artifacts …")
    for path in (
        SCRIPT_DIR / "build",
        SCRIPT_DIR / "dist",
        BUILD_VENV_DIR,
    ):
        if path.exists():
            shutil.rmtree(path)
    for spec in SCRIPT_DIR.glob("*.spec"):
        spec.unlink()
    print("   ✓ Done.")


# ── Entry point ────────────────────────────────────────────────────────────
def build_sidecar(smriti_version: str | None = None):
    target_triple = get_target_triple()
    print(f"\n╔══ SMRITI Sidecar Build ══════════════════════════════╗")
    print(f"  Target triple : {target_triple}")
    print(f"  smriti-memcore: {'latest' if not smriti_version else smriti_version}")
    print(f"  Daemon        : {DAEMON_PATH}")
    print(f"╚═════════════════════════════════════════════════════╝\n")

    create_build_venv()
    install_deps(smriti_version)
    compiled = compile_binary(target_triple)
    copy_to_tauri(compiled, target_triple)
    cleanup()

    print(f"\n✅  Sidecar build complete → src-tauri/sidecars/smriti-daemon-{target_triple}")
    print("   Run `npm run tauri build` to package the full app.\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Build the SMRITI sidecar daemon binary.")
    parser.add_argument(
        "--smriti-version",
        default=None,
        help="Pin a specific smriti-memcore PyPI version (e.g. 1.4.15). Defaults to latest.",
    )
    args = parser.parse_args()
    build_sidecar(smriti_version=args.smriti_version)
