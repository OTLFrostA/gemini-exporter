"""Locate the installed Google Chrome used by native browser tests."""

import os
import shutil
import sys
from pathlib import Path


def installed_chrome():
    if sys.platform == "darwin":
        candidates = [Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")]
    elif sys.platform == "win32":
        candidates = [
            Path(os.environ[base]) / "Google/Chrome/Application/chrome.exe"
            for base in ("ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA")
            if base in os.environ
        ]
    else:
        candidates = [
            Path(path) for binary in ("google-chrome", "google-chrome-stable")
            if (path := shutil.which(binary))
        ]
    for path in candidates:
        if path.is_file():
            return str(path)
    raise FileNotFoundError("Install stable Google Chrome to run the native browser tests.")
