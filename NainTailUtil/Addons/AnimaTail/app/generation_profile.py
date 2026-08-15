from __future__ import annotations

import json
from pathlib import Path


PROFILE_PATH = Path(__file__).resolve().parents[1] / "config" / "generation-profile.json"
with PROFILE_PATH.open("r", encoding="utf-8") as profile_file:
    PROFILE = json.load(profile_file)

SAMPLERS = tuple(PROFILE["sampling"]["samplers"])
SCHEDULERS = tuple(PROFILE["sampling"]["schedulers"])
DEFAULT_SAMPLER = PROFILE["sampling"]["defaultSampler"]
DEFAULT_SCHEDULER = PROFILE["sampling"]["defaultScheduler"]
SAMPLER_MINIMUM_STEPS = dict(PROFILE["sampling"]["minimumSteps"])
OUTPUT_NAMING = dict(PROFILE["outputNaming"])
GENERATION_LIMITS = PROFILE["limits"]
TURBO_LORA_PREFIX = PROFILE["turboLoraPrefix"]


def is_turbo_lora_path(relative_path: str) -> bool:
    return str(relative_path or "").replace("\\", "/").startswith(TURBO_LORA_PREFIX)
