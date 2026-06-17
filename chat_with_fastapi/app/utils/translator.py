import json
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

translations = {
    "en": json.load(open(BASE_DIR / "locales/en.json", encoding="utf-8")),
    "vi": json.load(open(BASE_DIR / "locales/vi.json", encoding="utf-8")),
}


def translate(lang: str, key: str):
    return translations.get(lang, translations["en"]).get(key, key)