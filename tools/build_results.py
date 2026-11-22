import hashlib
import json
import sys
from pathlib import Path

from PIL import Image, ImageOps

PROJECT_ROOT = Path(__file__).resolve().parent.parent
SOURCE_DIR = Path("/workspace/library/agnes")
OUTPUT_DIR = PROJECT_ROOT / "public" / "results"
MANIFEST_PATH = PROJECT_ROOT / "generated" / "results.json"
TIERS = (
    {"suffix": "-640", "width": 640},
    {"suffix": "-960", "width": 960},
    {"suffix": "", "width": 1200},
)
QUALITY = 82


def serialize(value):
    return json.dumps(value, ensure_ascii=False, indent=2) + "\n"


def main():
    cases = json.loads((PROJECT_ROOT / "content" / "cases.json").read_text(encoding="utf-8"))
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
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
            file_name = f"{case_id}{tier['suffix']}.webp"
            data = None
            quality = QUALITY
            if resized.mode == "RGBA":
                resized = resized.convert("RGB")
            for attempt_quality in range(QUALITY, 40, -2):
                from io import BytesIO

                buffer = BytesIO()
                resized.save(buffer, format="WEBP", quality=attempt_quality, method=6)
                data = buffer.getvalue()
                quality = attempt_quality
                if len(data) <= 160_000:
                    break
            (OUTPUT_DIR / file_name).write_bytes(data)
            total_files += 1
            variants[tier["suffix"] or "1200"] = {
                "file": file_name,
                "width": target_width,
                "height": target_height,
                "bytes": len(data),
                "sha256": hashlib.sha256(data).hexdigest(),
                "quality": quality,
            }
        manifest.append({
            "case_id": case_id,
            "width": width,
            "height": height,
            "main": variants["1200"],
            "variants": variants,
        })
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
