"""Synthetic PNG smoke test for the bundled ExifTool.
No photographs, machine metadata, timestamps or paths are logged.
"""
import struct
import subprocess
import sys
import tempfile
from pathlib import Path
from zlib import compress, crc32


def chunk(name: bytes, payload: bytes) -> bytes:
    checksum = crc32(name + payload) & 0xFFFFFFFF
    return struct.pack(">I", len(payload)) + name + payload + struct.pack(">I", checksum)


def tiny_png() -> bytes:
    header = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", 2, 2, 8, 2, 0, 0, 0)
    # One PNG filter-byte per row followed by two RGB pixels.
    pixels = b"\x00" + b"\x88\x99\xbb" * 2
    return header + chunk(b"IHDR", ihdr) + chunk(b"IDAT", compress(pixels * 2)) + chunk(b"IEND", b"")


def main() -> None:
    binary = sys.argv[1]
    with tempfile.TemporaryDirectory() as temporary:
        picture = Path(temporary) / "synthetic.png"
        picture.write_bytes(tiny_png())
        target = "2099:12:31 23:59:59"
        written = subprocess.run(
            [binary, "-overwrite_original_in_place", "-P",
             f"-EXIF:DateTimeOriginal={target}", f"-EXIF:CreateDate={target}", str(picture)],
            text=True, capture_output=True, check=False,
        )
        if written.returncode:
            raise SystemExit("ExifTool cannot write EXIF to a generated PNG")
        read = subprocess.run(
            [binary, "-s3", "-EXIF:DateTimeOriginal", str(picture)],
            text=True, capture_output=True, check=False,
        )
        if read.returncode or read.stdout.strip() != target:
            raise SystemExit("ExifTool EXIF readback mismatch")
        print("Synthetic PNG EXIF write/readback passed.")


if __name__ == "__main__":
    main()
