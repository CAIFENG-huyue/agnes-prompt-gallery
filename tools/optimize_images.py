import hashlib
import io
import json
import sys
from pathlib import Path
from urllib.parse import unquote, urlparse

from PIL import Image, ImageOps

PROJECT_ROOT = Path(__file__).resolve().parent.parent
CASE_IMAGES_ROOT = Path("repos/awesome-gpt-image-2/data/images")
EXPERIMENT_IMAGES_ROOT = Path("agent/agnes/experiments/images")
SOURCE_ASSETS_PATH = PROJECT_ROOT / "content/source-assets.json"
PUBLIC_ROOT = PROJECT_ROOT / "public"
ASSET_ROOT = PUBLIC_ROOT / "assets"
MANIFEST_PATH = PROJECT_ROOT / "generated/assets.json"
REPORT_PATH = PROJECT_ROOT / "reports/assets.json"
TIERS = (
    {"name": "360w", "width": 360, "quality": 72, "max_bytes": 45_000},
    {"name": "640w", "width": 640, "quality": 78, "max_bytes": 90_000},
    {"name": "960w", "width": 960, "quality": 80, "max_bytes": 150_000},
)
EXPECTED_COUNTS = {"cases": 541, "h1": 100, "h2": 22}


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def serialize(value):
    return json.dumps(value, ensure_ascii=False, indent=2) + "\n"


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(serialize(value), encoding="utf-8")


def sha256_bytes(data):
    return hashlib.sha256(data).hexdigest()


def source_path_from_uri(uri):
    parsed = urlparse(uri)
    require(parsed.scheme == "file", f"来源资产不是 file URI：{uri}")
    return Path(unquote(parsed.path))


def inspect_source(path):
    data = path.read_bytes()
    with Image.open(path) as image:
        require(not getattr(image, "is_animated", False), f"不支持动画源图：{path}")
        oriented = ImageOps.exif_transpose(image)
        width, height = oriented.size
    require(width > 0 and height > 0, f"源图尺寸无效：{path}")
    return {"sha256": sha256_bytes(data), "bytes": len(data), "width": width, "height": height}


def experiment_files(group):
    directory = EXPERIMENT_IMAGES_ROOT / group
    files = sorted(
        (path for path in directory.iterdir() if path.is_file() and path.suffix.lower() in {".jpg", ".jpeg", ".png"}),
        key=lambda path: path.name,
    )
    require(len(files) == EXPECTED_COUNTS[group], f"{group} 源图数量应为 {EXPECTED_COUNTS[group]}，实际为 {len(files)}")
    return files


def collect_sources():
    source_assets = json.loads(SOURCE_ASSETS_PATH.read_text(encoding="utf-8"))
    require(isinstance(source_assets, list) and len(source_assets) == EXPECTED_COUNTS["cases"], "T03 来源资产必须为 541 条")
    sources = []
    for item in source_assets:
        path = source_path_from_uri(item["uri"])
        require(path.parent == CASE_IMAGES_ROOT and path.is_file(), f"案例源图缺失或越界：{path}")
        metadata = inspect_source(path)
        require(metadata["sha256"] == item["sha256"], f"案例源图哈希与 T03 清单不一致：{path}")
        sources.append({
            "source_asset_id": item["asset_id"],
            "group": "cases",
            "path": path,
            "uri": item["uri"],
            "source_url": item["source_url"],
            **metadata,
        })
    for group in ("h1", "h2"):
        for path in experiment_files(group):
            metadata = inspect_source(path)
            sources.append({
                "source_asset_id": path.stem,
                "group": group,
                "path": path,
                "uri": path.resolve().as_uri(),
                "source_url": path.resolve().as_uri(),
                **metadata,
            })
    source_ids = [source["source_asset_id"] for source in sources]
    require(len(sources) == sum(EXPECTED_COUNTS.values()), "源图总数不是 663")
    require(len(set(source_ids)) == len(source_ids), "来源资产 ID 存在重复")
    return sources


def source_record(source):
    return {
        "source_asset_id": source["source_asset_id"],
        "group": source["group"],
        "uri": source["uri"],
        "sha256": source["sha256"],
        "bytes": source["bytes"],
        "width": source["width"],
        "height": source["height"],
    }


def output_location(source, tier):
    if source["group"] == "cases":
        relative = Path("assets/cases") / f"{source['path'].stem}-{tier['width']}.webp"
    else:
        relative = Path("assets/experiments") / source["group"] / f"{source['path'].stem}-{tier['width']}.webp"
    return PUBLIC_ROOT / relative, "/" + relative.as_posix()


def expected_height(source, tier):
    return max(1, int(source["height"] * tier["width"] / source["width"] + 0.5))


def manifest_entry(source, tier, uri, data, height):
    return {
        "asset_id": f"{source['source_asset_id']}-{tier['width']}w",
        "uri": uri,
        "kind": "derived_case_image" if source["group"] == "cases" else "derived_experiment_image",
        "sha256": sha256_bytes(data),
        "width": tier["width"],
        "height": height,
        "source_url": source["source_url"],
        "source_asset_id": source["source_asset_id"],
        "format": "webp",
    }


def encode_webp(image, quality):
    buffer = io.BytesIO()
    image.save(buffer, format="WEBP", quality=quality, method=6)
    return buffer.getvalue()


def fit_budget(image, tier):
    initial_data = encode_webp(image, tier["quality"])
    initial_bytes = len(initial_data)
    if initial_bytes <= tier["max_bytes"]:
        return initial_data, tier["quality"], initial_bytes, 1
    low = 0
    high = tier["quality"] - 1
    best = None
    attempts = 1
    while low <= high:
        quality = (low + high) // 2
        data = encode_webp(image, quality)
        attempts += 1
        if len(data) <= tier["max_bytes"]:
            best = (data, quality)
            low = quality + 1
        else:
            high = quality - 1
    require(best is not None, f"{tier['name']} 在 quality=0 时仍超过 {tier['max_bytes']} 字节")
    data, quality = best
    return data, quality, initial_bytes, attempts


def generate(sources):
    for directory in (
        ASSET_ROOT / "cases",
        ASSET_ROOT / "experiments/h1",
        ASSET_ROOT / "experiments/h2",
    ):
        directory.mkdir(parents=True, exist_ok=True)
    manifest = []
    outcomes = []
    for index, source in enumerate(sources, start=1):
        with Image.open(source["path"]) as opened:
            oriented = ImageOps.exif_transpose(opened)
            oriented.load()
            if oriented.mode in {"RGBA", "LA"} or "transparency" in oriented.info:
                base = oriented.convert("RGBA")
            else:
                base = oriented.convert("RGB")
        for tier in TIERS:
            height = expected_height(source, tier)
            resized = base.resize((tier["width"], height), Image.Resampling.LANCZOS)
            data, quality, initial_bytes, attempts = fit_budget(resized, tier)
            output_path, uri = output_location(source, tier)
            output_path.write_bytes(data)
            entry = manifest_entry(source, tier, uri, data, height)
            manifest.append(entry)
            outcomes.append({
                "asset_id": entry["asset_id"],
                "source_asset_id": source["source_asset_id"],
                "tier": tier["name"],
                "uri": uri,
                "bytes": len(data),
                "sha256": entry["sha256"],
                "width": tier["width"],
                "height": height,
                "target_quality": tier["quality"],
                "quality": quality,
                "initial_bytes": initial_bytes,
                "initial_over_budget": initial_bytes > tier["max_bytes"],
                "recompressed": quality != tier["quality"],
                "compression_attempts": attempts,
                "over_budget": len(data) > tier["max_bytes"],
            })
        if index % 50 == 0 or index == len(sources):
            print(f"已处理 {index}/{len(sources)} 张源图", flush=True)
    return manifest, outcomes


def build_report(sources, manifest, outcomes):
    source_counts = {group: sum(source["group"] == group for source in sources) for group in EXPECTED_COUNTS}
    source_counts["total"] = len(sources)
    tier_reports = []
    for tier in TIERS:
        items = [item for item in outcomes if item["tier"] == tier["name"]]
        tier_reports.append({
            **tier,
            "generated_count": len(items),
            "total_bytes": sum(item["bytes"] for item in items),
            "max_output_bytes": max(item["bytes"] for item in items),
            "initial_over_budget_count": sum(item["initial_over_budget"] for item in items),
            "recompressed_count": sum(item["recompressed"] for item in items),
            "over_budget_count": sum(item["over_budget"] for item in items),
        })
    over_budget_count = sum(item["over_budget"] for item in outcomes)
    return {
        "task_id": "T08",
        "status": "passed" if over_budget_count == 0 else "failed",
        "generator": "tools/optimize_images.py",
        "source_counts": source_counts,
        "source_total_bytes": sum(source["bytes"] for source in sources),
        "generated_count": len(manifest),
        "total_bytes": sum(item["bytes"] for item in outcomes),
        "initial_over_budget_count": sum(item["initial_over_budget"] for item in outcomes),
        "recompressed_count": sum(item["recompressed"] for item in outcomes),
        "over_budget_count": over_budget_count,
        "tiers": tier_reports,
        "sources": [source_record(source) for source in sources],
        "outputs": outcomes,
        "manifest_sha256": sha256_bytes(serialize(manifest).encode("utf-8")),
    }


def check_existing(sources):
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    report = json.loads(REPORT_PATH.read_text(encoding="utf-8"))
    require(isinstance(manifest, list) and len(manifest) == len(sources) * len(TIERS), "派生清单数量不是 1989")
    require(isinstance(report.get("outputs"), list) and len(report["outputs"]) == len(manifest), "报告输出数量不是 1989")
    expected_manifest = []
    expected_paths = set()
    normalized_outcomes = []
    for source in sources:
        for tier in TIERS:
            index = len(expected_manifest)
            output_path, uri = output_location(source, tier)
            expected_paths.add(output_path)
            data = output_path.read_bytes()
            height = expected_height(source, tier)
            with Image.open(io.BytesIO(data)) as image:
                require(image.format == "WEBP", f"输出不是 WebP：{output_path}")
                require(image.size == (tier["width"], height), f"输出尺寸错误：{output_path}")
            entry = manifest_entry(source, tier, uri, data, height)
            expected_manifest.append(entry)
            outcome = report["outputs"][index]
            fixed_fields = {
                "asset_id": entry["asset_id"],
                "source_asset_id": source["source_asset_id"],
                "tier": tier["name"],
                "uri": uri,
                "bytes": len(data),
                "sha256": entry["sha256"],
                "width": tier["width"],
                "height": height,
                "target_quality": tier["quality"],
            }
            for key, value in fixed_fields.items():
                require(outcome.get(key) == value, f"报告字段不匹配：{entry['asset_id']} {key}")
            quality = outcome.get("quality")
            initial_bytes = outcome.get("initial_bytes")
            attempts = outcome.get("compression_attempts")
            require(isinstance(quality, int) and 0 <= quality <= tier["quality"], f"实际质量无效：{entry['asset_id']}")
            require(isinstance(initial_bytes, int) and initial_bytes > 0, f"初始体积无效：{entry['asset_id']}")
            require(isinstance(attempts, int) and attempts >= 1, f"压缩次数无效：{entry['asset_id']}")
            normalized = {
                **fixed_fields,
                "quality": quality,
                "initial_bytes": initial_bytes,
                "initial_over_budget": initial_bytes > tier["max_bytes"],
                "recompressed": quality != tier["quality"],
                "compression_attempts": attempts,
                "over_budget": len(data) > tier["max_bytes"],
            }
            for key, value in normalized.items():
                require(outcome.get(key) == value, f"报告统计不一致：{entry['asset_id']} {key}")
            normalized_outcomes.append(normalized)
    require(manifest == expected_manifest, "generated/assets.json 与实际图片或来源不一致")
    actual_paths = {path for path in ASSET_ROOT.rglob("*") if path.is_file()}
    require(actual_paths == expected_paths, "public/assets 存在缺图或额外文件")
    expected_report = build_report(sources, expected_manifest, normalized_outcomes)
    actual_report = {key: value for key, value in report.items() if key != "validation"}
    require(actual_report == expected_report, "reports/assets.json 汇总或明细不一致")
    require(report["over_budget_count"] == 0 and report["status"] == "passed", "仍存在超预算图片")
    return report


def main():
    args = sys.argv[1:]
    require(args in ([], ["--check"]), "用法：python3 tools/optimize_images.py [--check]")
    sources = collect_sources()
    if args == ["--check"]:
        report = check_existing(sources)
        print(f"通过：{report['generated_count']} 张 WebP，总体积 {report['total_bytes']} 字节，超限 {report['over_budget_count']} 张")
        return
    manifest, outcomes = generate(sources)
    report = build_report(sources, manifest, outcomes)
    write_json(MANIFEST_PATH, manifest)
    write_json(REPORT_PATH, report)
    require(report["over_budget_count"] == 0, f"仍有 {report['over_budget_count']} 张图片超预算")
    print(f"完成：{report['generated_count']} 张 WebP，总体积 {report['total_bytes']} 字节，超限 {report['over_budget_count']} 张")
    print(f"目标质量初试超限 {report['initial_over_budget_count']} 张，已全部再压缩并记录")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1) from error
