import os
import sys
import shutil
import platform
import subprocess
from pathlib import Path

# Add python script's directory to path to locate daemon.py
SCRIPT_DIR = Path(__file__).parent.resolve()
DAEMON_PATH = SCRIPT_DIR / "desktop_daemon.py"
TAURI_SIDECAR_DIR = SCRIPT_DIR.parent / "src-tauri" / "sidecars"

def get_target_triple() -> str:
    """Determine the Rust target triple for the current system."""
    system = platform.system().lower()
    machine = platform.machine().lower()
    
    if system == "darwin":
        # macOS
        if "arm" in machine or "aarch64" in machine:
            return "aarch64-apple-darwin"
        else:
            return "x86_64-apple-darwin"
    elif system == "windows":
        # Windows
        if "arm" in machine or "aarch64" in machine:
            return "aarch64-pc-windows-msvc"
        else:
            return "x86_64-pc-windows-msvc"
    elif system == "linux":
        # Linux
        if "arm" in machine or "aarch64" in machine:
            return "aarch64-unknown-linux-gnu"
        else:
            return "x86_64-unknown-linux-gnu"
    else:
        raise ValueError(f"Unsupported operating system: {system}")

def build_sidecar():
    target_triple = get_target_triple()
    extension = ".exe" if platform.system().lower() == "windows" else ""
    binary_name = f"smriti-daemon-{target_triple}{extension}"
    
    print(f"Building sidecar daemon: {binary_name}")
    
    # Ensure PyInstaller is installed in the current environment
    try:
        import PyInstaller
    except ImportError:
        print("PyInstaller not found. Installing PyInstaller...")
        subprocess.run([sys.executable, "-m", "pip", "install", "pyinstaller"], check=True)

    # Clean up previous build directories if they exist
    build_dir = SCRIPT_DIR / "build"
    dist_dir = SCRIPT_DIR / "dist"
    
    if build_dir.exists():
        shutil.rmtree(build_dir)
    if dist_dir.exists():
        shutil.rmtree(dist_dir)
        
    # Compile using PyInstaller
    # --onefile: bundle everything into a single executable
    # --clean: clean cache
    cmd = [
        sys.executable,
        "-m",
        "PyInstaller",
        "--clean",
        "--onefile",
        "--name",
        f"smriti-daemon-{target_triple}",
        str(DAEMON_PATH)
    ]
    
    print(f"Running command: {' '.join(cmd)}")
    subprocess.run(cmd, cwd=str(SCRIPT_DIR), check=True)
    
    # Verify the output exists
    compiled_binary_path = dist_dir / binary_name
    if not compiled_binary_path.exists():
        raise FileNotFoundError(f"Compiled binary not found at expected location: {compiled_binary_path}")
        
    # Ensure Tauri sidecars directory exists
    TAURI_SIDECAR_DIR.mkdir(parents=True, exist_ok=True)
    
    # Copy the compiled executable to src-tauri/sidecars
    dest_path = TAURI_SIDECAR_DIR / binary_name
    print(f"Copying compiled binary to: {dest_path}")
    shutil.copy2(compiled_binary_path, dest_path)
    
    # Cleanup build artifacts
    if build_dir.exists():
        shutil.rmtree(build_dir)
    if dist_dir.exists():
        shutil.rmtree(dist_dir)
    spec_file = SCRIPT_DIR / f"smriti-daemon-{target_triple}.spec"
    if spec_file.exists():
        spec_file.unlink()
        
    print("Sidecar daemon build complete!")

if __name__ == "__main__":
    build_sidecar()
