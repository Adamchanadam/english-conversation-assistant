---
name: windows-python-conda
description: Generate reliable Python scripts for Windows + Conda (adamlab4_env). Run via explicit env interpreter (avoid base python) and avoid multi-line python -c on PowerShell.
---

# Windows Python Conda Environment

Generate Python scripts optimized for Windows + Conda (adamlab4_env) that avoid encoding errors, missing dependencies, and path issues.

## Core Requirements

### 0. Interpreter Selection (Mandatory)

Always run scripts using the target Conda env interpreter, not the base Python.

- Prefer an explicit interpreter path:

```powershell
C:\Users\adam\anaconda3\envs\adamlab4_env\python.exe .\scripts\your_script.py
```

- Avoid relying on `python` resolving to base Python in PATH.

### 1. UTF-8 Encoding Setup (Mandatory)

Every script must start with:
```python
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import sys
sys.stdout.reconfigure(encoding='utf-8')
```

All file operations must specify encoding:
```python
from pathlib import Path

# Read/Write
content = Path("file.txt").read_text(encoding="utf-8")
Path("output.txt").write_text(content, encoding="utf-8")
```

### 2. Path Handling (Mandatory)

Use `pathlib` instead of shell commands:
```python
import os
from pathlib import Path

# ✅ Correct - Cross-platform
files = list(Path(".").glob("*.txt"))
path = Path("folder") / "subfolder" / "file.txt"

# ❌ Avoid - Windows-only or shell-dependent
os.system("dir")
path = "folder\\subfolder\\file.txt"
```

**Quick Reference:**

| Operation | Python Code |
|-----------|-------------|
| List files | `list(Path(".").iterdir())` |
| Read file | `Path("file").read_text(encoding="utf-8")` |
| Delete file | `Path("file").unlink()` |
| Create directory | `Path("folder").mkdir(exist_ok=True)` |

### 3. Package Management (Mandatory)

Check packages but DO NOT auto-install:
```python
def check_package(package_name, import_name=None):
    if import_name is None:
        import_name = package_name
    try:
        __import__(import_name)
        return True
    except ImportError:
        print(f"⚠️ Missing: {package_name}")
        print(f"   Run: conda install -c conda-forge {package_name}")
        return False

# Check before importing
if not check_package("requests"):
    sys.exit(1)
import requests
```

### 3.1 Avoid PowerShell quoting pitfalls (Mandatory)

Avoid `python -c` for multi-line logic in PowerShell (quoting/escaping is error-prone). Prefer writing a `.py` script and running it with the explicit Conda env interpreter.

- ✅ Preferred:

```powershell
C:\Users\adam\anaconda3\envs\adamlab4_env\python.exe .\scripts\task.py
```

- ❌ Avoid for anything beyond simple one-liners:

```powershell
python -c "...multi-line or complex quoting..."
```

### 4. Subprocess Calls (Mandatory)

Always set encoding and timeout:
```python
import subprocess
import shutil

claude_exe = shutil.which("claude")
if claude_exe is None:
    raise FileNotFoundError("claude not found in PATH")

result = subprocess.run(
    [claude_exe, "-p", "--output-format", "json", "Describe what this script does."],
    capture_output=True,
    text=True,
    encoding="utf-8",
    timeout=300,
    check=True
)

gemini_exe = shutil.which("gemini")
if gemini_exe is None:
    raise FileNotFoundError("gemini not found in PATH")

gemini_result = subprocess.run(
    [gemini_exe, "--output-format", "json", "Describe what this script does."],
    capture_output=True,
    text=True,
    encoding="utf-8",
    timeout=300,
    check=True
)
```

**Notes:**

- **Claude CLI JSON output**: `--output-format json` returns a JSON envelope, but the `result` field may contain Markdown code fences (e.g. ```json ... ```). Strip/extract if you need machine-parseable JSON.
- **Gemini CLI JSON output**: `--output-format json` returns JSON on stdout, but stderr may include informational messages (e.g. API key selection, extension loading). Use `returncode` to determine success.

### 5. Error Handling (Mandatory)

Wrap external operations in try-except with emoji feedback:
```python
try:
    content = Path("file.txt").read_text(encoding="utf-8")
    print("✅ Success")
except FileNotFoundError:
    print("❌ File not found")
except Exception as e:
    print(f"❌ Error: {e}")
```

**Emoji Guide:** 🔄 Processing | ✅ Success | ❌ Error | ⚠️ Warning | 💡 Info

## Script Template
```python
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import sys
sys.stdout.reconfigure(encoding='utf-8')

from pathlib import Path

def check_package(package_name, import_name=None):
    if import_name is None:
        import_name = package_name
    try:
        __import__(import_name)
        return True
    except ImportError:
        print(f"⚠️ Missing: {package_name}")
        print(f"   conda install -c conda-forge {package_name}")
        return False

def main():
    print("🔄 Starting task...")
    
    output_dir = Path("output")
    output_dir.mkdir(exist_ok=True)
    
    try:
        # Your logic here
        result = output_dir / "result.txt"
        result.write_text("Task complete", encoding="utf-8")
        print(f"✅ Saved to: {result}")
    except Exception as e:
        print(f"❌ Failed: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
```

## Pre-Generation Checklist

Before generating scripts, verify:

- [ ] Follow mandatory sections 0 and 3.1
- [ ] `sys.stdout.reconfigure(encoding='utf-8')` at start
- [ ] All file operations use `encoding="utf-8"`
- [ ] Using `pathlib.Path` instead of shell commands
- [ ] Package checks before imports
- [ ] Subprocess calls have `encoding="utf-8"` and `timeout`
- [ ] Try-except blocks around external operations
- [ ] Emoji progress indicators

## Common Patterns

### Batch File Processing
```python
from pathlib import Path

files = list(Path(".").glob("*.txt"))
print(f"🔍 Found {len(files)} files")

for file in files:
    try:
        content = file.read_text(encoding="utf-8")
        # Process content...
        print(f"✅ Processed: {file.name}")
    except Exception as e:
        print(f"❌ Failed: {file.name} - {e}")
```

### CLI Tool Integration
```python
import subprocess
from pathlib import Path

result = subprocess.run(
    ["tool", "command"],
    capture_output=True,
    text=True,
    encoding="utf-8",
    timeout=600
)

Path("output.txt").write_text(result.stdout, encoding="utf-8")
```

## Critical Reminders

1. **Never** use `os.system()` or shell commands for file operations
2. **Always** specify `encoding="utf-8"` for text file I/O
3. **Check** packages but let user install via conda
4. **Use** `pathlib.Path` for cross-platform compatibility
5. **Add** timeout to all subprocess calls
6. **Provide** clear emoji-based progress feedback
7. **Follow** mandatory sections 0 and 3.1