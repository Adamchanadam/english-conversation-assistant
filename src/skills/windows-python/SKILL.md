---
name: windows-python-conda
description: Generate reliable Python scripts for Windows + Conda environment. Covers Bash tool usage, encoding, paths, and common pitfalls.
---

# Windows Python Conda Environment

Generate Python scripts optimized for Windows + Conda that avoid encoding errors, missing dependencies, and path issues.

## Runtime Environment

**Typical Setup:**
- **OS**: Windows 10/11
- **Shell**: PowerShell (user's terminal)
- **Conda Environment**: User's conda env (e.g., `adamlab4_env`) - usually already activated
- **Claude Code Bash Tool**: Runs in a shell context where conda env is inherited

## Claude Code Bash Tool Usage (CRITICAL)

When using the Bash tool in Claude Code on Windows:

### Key Principles:
1. **Conda env is usually active** - use `python` directly, not full path
2. **Use Windows-style paths** with double quotes
3. **Avoid Unix path formats** like `/c/Users/...`

### ✅ CORRECT Usage:
```bash
# Use python directly (conda env inherited)
python script.py
python -m pytest tests/ -v

# Change directory with quoted Windows path
cd "D:\path\to\project" && python script.py

# Node.js
node tests/test_app.js

# Pip install
pip install package_name
```

### ❌ WRONG Usage:
```bash
# DON'T use full exe path in Bash tool - causes path parsing issues
C:\Users\user\anaconda3\envs\myenv\python.exe script.py

# DON'T use Unix-style paths on Windows
/c/Users/user/project/script.py

# DON'T forget quotes for paths with backslashes or spaces
cd D:\My Projects   # Will fail
```

### Quick Reference:
| Task | Command |
|------|---------|
| Run Python script | `python script.py` |
| Run pytest | `python -m pytest tests/ -v` |
| Run specific test | `python -m pytest tests/test_foo.py -v` |
| Run JS tests | `node tests/test_app.js` |
| Install package | `pip install package_name` |
| Start server | `python src/main.py` |

## Core Requirements

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
from pathlib import Path

# ✅ Correct - Cross-platform
files = list(Path(".").glob("*.txt"))
path = Path("folder") / "subfolder" / "file.txt"

# ❌ Avoid - Windows-only or shell-dependent
import os
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
        print(f"Missing: {package_name}")
        print(f"   Run: pip install {package_name}")
        return False

# Check before importing
if not check_package("requests"):
    sys.exit(1)
import requests
```

### 4. Avoid PowerShell Quoting Pitfalls

Avoid `python -c` for multi-line logic (quoting/escaping is error-prone). Prefer writing a `.py` script:

```bash
# ✅ Preferred
python scripts/task.py

# ❌ Avoid for anything complex
python -c "import sys; print('line1'); print('line2')"
```

### 5. Subprocess Calls (Mandatory)

Always set encoding and timeout:
```python
import subprocess
import shutil

exe = shutil.which("tool")
if exe is None:
    raise FileNotFoundError("tool not found in PATH")

result = subprocess.run(
    [exe, "arg1", "arg2"],
    capture_output=True,
    text=True,
    encoding="utf-8",
    timeout=300,
    check=True
)
```

### 6. Error Handling (Mandatory)

Wrap external operations in try-except:
```python
try:
    content = Path("file.txt").read_text(encoding="utf-8")
    print("Success")
except FileNotFoundError:
    print("File not found")
except Exception as e:
    print(f"Error: {e}")
```

## Script Template

```python
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import sys
sys.stdout.reconfigure(encoding='utf-8')

from pathlib import Path

def main():
    print("Starting task...")

    output_dir = Path("output")
    output_dir.mkdir(exist_ok=True)

    try:
        # Your logic here
        result = output_dir / "result.txt"
        result.write_text("Task complete", encoding="utf-8")
        print(f"Saved to: {result}")
    except Exception as e:
        print(f"Failed: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
```

## Pre-Generation Checklist

Before generating scripts, verify:

- [ ] `sys.stdout.reconfigure(encoding='utf-8')` at start
- [ ] All file operations use `encoding="utf-8"`
- [ ] Using `pathlib.Path` instead of shell commands
- [ ] Package checks before imports
- [ ] Subprocess calls have `encoding="utf-8"` and `timeout`
- [ ] Try-except blocks around external operations

## Common Patterns

### Batch File Processing
```python
from pathlib import Path

files = list(Path(".").glob("*.txt"))
print(f"Found {len(files)} files")

for file in files:
    try:
        content = file.read_text(encoding="utf-8")
        # Process content...
        print(f"Processed: {file.name}")
    except Exception as e:
        print(f"Failed: {file.name} - {e}")
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
3. **Check** packages but let user install via pip/conda
4. **Use** `pathlib.Path` for cross-platform compatibility
5. **Add** timeout to all subprocess calls
6. **In Bash tool**: use `python` directly, not full exe path
7. **Quote** Windows paths in Bash tool commands
