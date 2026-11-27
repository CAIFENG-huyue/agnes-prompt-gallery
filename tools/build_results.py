import hashlib
import json
import sys
from pathlib import Path

from PIL import Image, ImageOps

PROJECT_ROOT = Path(__file__).resolve().parent.parent
SOURCE_DIR = Path("library/agnes")
OUTPUT_DIR = PROJECT_ROOT / "public" / "results"
MANIFEST_PATH = PROJECT_ROOT / "generated" / "results.json"
REPLACEMENTS_PATH = PROJECT_ROOT / "content" / "case-replacements.json"
TIERS = (
    {"suffix": "-640", "width": 640},
    {"suffix": "-960", "width": 960},
    {"suffix": "", "width": 1200},
)
QUALITY = 82


def serialize(value):
    return json.dumps(value, ensure_ascii=False, indent=2) + "\n"


def render(source, prefix):
    """Render one source image into the three WebP tiers, returning manifest data."""
    with Image.open(source) as opened:
        oriented = ImageOps.exif_transpose(opened)
        if oriented.mode not in {"RGB", "RGBA"}:
            oriented = oriented.convert("RGB")
        oriented.load()
        width, height = oriented.size
    variants = {}
    for tier in TIERS:
        target_width = min(tier["width"], width)
        target_height = max(1, round(height * target_width / width))
        resized = oriented.resize((target_width, target_height), Image.Resampling.LANCZOS)
        file_name = f"{prefix}{tier['suffix']}.webp"
        data = None
        quality = QUALITY
        if resized.mode == "RGBA":
            resized = resized.convert("RGB")
        from io import BytesIO

        for attempt_quality in range(QUALITY, 40, -2):
            buffer = BytesIO()
            resized.save(buffer, format="WEBP", quality=attempt_quality, method=6)
            data = buffer.getvalue()
            quality = attempt_quality
            if len(data) <= 160_000:
                break
        (OUTPUT_DIR / file_name).write_bytes(data)
        variants[tier["suffix"] or "1200"] = {
            "file": file_name,
            "width": target_width,
            "height": target_height,
            "bytes": len(data),
            "sha256": hashlib.sha256(data).hexdigest(),
            "quality": quality,
        }
    return width, height, variants


def main():
    cases = json.loads((PROJECT_ROOT / "content" / "cases.json").read_text(encoding="utf-8"))
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    replacements = {}
    if REPLACEMENTS_PATH.is_file():
        for item in json.loads(REPLACEMENTS_PATH.read_text(encoding="utf-8")):
            replacements[int(str(item["case_id"]).replace("case-", ""))] = item
    manifest = []
    missing = []
    total_files = 0
    for index, item in enumerate(cases, start=1):
        raw = str(item["case_id"])
        case_id = raw if raw.startswith("case-") else f"case-{raw}"
        number = int(case_id.replace("case-", ""))
        source = SOURCE_DIR / f"rep_{number}.png"
        if not source.is_file():
            missing.append(number)
            continue
        width, height, variants = render(source, case_id)
        total_files += len(variants)
        entry = {
            "case_id": case_id,
            "width": width,
            "height": height,
            "main": variants["1200"],
            "variants": variants,
        }
        replacement = replacements.get(number)
        if replacement:
            replacement_source = Path(replacement["source_image"])
            if not replacement_source.is_file():
                raise FileNotFoundError(f"替换图缺失：{replacement_source}")
            rw, rh, rvariants = render(replacement_source, f"{case_id}-replacement")
            total_files += len(rvariants)
            entry["replacement"] = {
                "width": rw,
                "height": rh,
                "main": rvariants["1200"],
                "variants": rvariants,
                "prompt_version": replacement.get("prompt_version"),
                "prompt_source": replacement.get("prompt_source"),
                "verdict": replacement.get("verdict", "PASS"),
                "note": replacement.get("note", ""),
                "reviewed_by": replacement.get("reviewed_by", "human"),
                "source_image": str(replacement_source),
            }
        manifest.append(entry)
        if index % 100 == 0:
            print(f"已处理 {index}/{len(cases)} 张", flush=True)

    manifest.sort(key=lambda entry: int(entry["case_id"].replace("case-", "")))
    MANIFEST_PATH.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST_PATH.write_text(serialize(manifest), encoding="utf-8")
    print(f"完成：{len(manifest)} 个案例 × {len(TIERS)} 档 = {total_files} 张 WebP（q{QUALITY}）")
    print(f"缺图 {len(missing)} 张：{', '.join(str(value) for value in missing)}")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1) from error
