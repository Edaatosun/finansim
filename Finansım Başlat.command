#!/bin/bash
cd "$(dirname "$0")"
open "http://localhost:8080" >/dev/null 2>&1 &
python3 server.py 8080
