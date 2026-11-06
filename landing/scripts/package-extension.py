"""Package the current built extension without browser profiles or local data."""
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

project = Path(__file__).resolve().parents[1]
dist = project.parent / "apps" / "extension" / "dist"
target = project / "public" / "bound-extension.zip"
if not (dist / "manifest.json").is_file():
    raise SystemExit("Build the extension first: node apps/extension/build.mjs")

files = [
    p.relative_to(dist).as_posix()
    for p in dist.rglob("*")
    if p.is_file() and not p.is_symlink() and not p.name.startswith(".")
]
target.parent.mkdir(parents=True, exist_ok=True)
with ZipFile(target, "w", ZIP_DEFLATED) as archive:
    for name in sorted(files):
        archive.write(dist / name, name)
    archive.writestr("INSTALL.txt", "BOUND prototype: extract this ZIP, open chrome://extensions (or edge://extensions), enable Developer mode, and choose Load unpacked. Select the extracted folder containing manifest.json. This prototype requires configuration and its live integrations have not been fully verified.\n")
print(f"Packaged {len(files)} extension files in {target}")
