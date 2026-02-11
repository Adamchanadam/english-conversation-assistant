#!/usr/bin/env python3
"""
Cloud Run startup script with error handling.
"""
import os
import sys
import traceback

def main():
    port = int(os.environ.get("PORT", 8080))
    print(f"[startup] Starting ECA on port {port}")
    print(f"[startup] Python version: {sys.version}")
    print(f"[startup] Working directory: {os.getcwd()}")
    print(f"[startup] Directory contents: {os.listdir('.')}")

    try:
        print("[startup] Importing uvicorn...")
        import uvicorn

        print("[startup] Importing FastAPI app...")
        from src.backend.main import app

        print("[startup] Starting server...")
        uvicorn.run(app, host="0.0.0.0", port=port)

    except Exception as e:
        print(f"[startup] ERROR: {e}")
        traceback.print_exc()
        sys.exit(1)

if __name__ == "__main__":
    main()
