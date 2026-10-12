#!/usr/bin/env python3
"""Verify Jazz Android Launcher icon survives a real APK build as valid PNG."""
import pathlib
import struct
import sys
import zipfile

apk = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "apps/android-companion/app/build/outputs/apk/debug/app-debug.apk")
signature = b"\x89PNG\r\n\x1a\n"
with zipfile.ZipFile(apk) as archive:
    matches = [name for name in archive.namelist() if name.endswith("/jazz_icon.png")]
    if len(matches) != 1:
        raise SystemExit(f"Expected one packaged Jazz launcher PNG, found {matches}")
    name = matches[0]
    data = archive.read(name)
    if not data.startswith(signature) or data[12:16] != b"IHDR":
        raise SystemExit("Jazz launcher icon is not a valid PNG file")
    width, height = struct.unpack(">II", data[16:24])
    if width < 192 or height < 192:
        raise SystemExit(f"Jazz launcher icon is too small: {width}x{height}")
    if any(name.endswith("/jazz_icon.jpg") for name in archive.namelist()):
        raise SystemExit("Old corrupt Jazz JPEG is still packaged")
    print(f"PASS: APK contains valid Jazz launcher icon: {name}, {width}x{height}, {len(data):,} bytes")
