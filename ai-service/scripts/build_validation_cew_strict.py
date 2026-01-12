#!/usr/bin/env python3
"""
Build CEW-strict validation set from a curated question list.

Outputs:
  - ai-service/scripts/validation_cew_strict_questions.json

Policy:
  - CEW strict: If doc does not explicitly support, expect FALLBACK.
  - Validation PASS:
      - expected_behavior=ANSWER: must NOT be fallback, must have citation.
      - expected_behavior=FALLBACK: must be fallback (citation optional but allowed).

Usage:
  cd ai-service
  .\\venv\\Scripts\\Activate.ps1
  python scripts/build_validation_cew_strict.py
"""

import json
import re
import sys
from pathlib import Path

# Fix Windows console encoding for Unicode
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

ROOT = Path(__file__).parent.parent
OUT = Path(__file__).parent / "validation_cew_strict_questions.json"


RAW_QUESTIONS = r"""
what is mc4
mc4 ne işe yarıyo tam olarak
why 1500v dc kullanılmış bu projede
string niye 27 panel why not 28
sungrow inverter neden seçilmiş
mppt kaç tane var sg350hx
dc/ac ratio bu projede kaç
dc ac ratio high mi low mu
max string voltage kaç oluyor
-5 derecede voc kaç çıkar
mppt current limit neydi
why bifacial module kullanılmış
570 wp ile 575 wp neden mix
inverter ac power kaç kva
320 kva mı 350 mi bu inverter
mppt voltage window nedir
module temp coefficient ne işe yarar
short circuit current neden önemli
mppt başına kaç string bağlanmış
2v14 vs 2v27 difference ne
tilt angle neden 20 derece
pv syst analysis neye göre yapılmış
shading nasıl avoid edilmiş
1500v dc riskli mi değil mi
inverter dc side surge var mı
ac side protection nasıl yapılmış
grounding olmazsa ne olur
earthing resistance target kaç
lightning protection var mı
inverter shutdown scenario nedir
total kaç panel var projede
toplam inverter sayısı kaç
kaç tane power station mevcut
substation sayısı kaç
570wp kaç adet kullanılmış
575wp kaç adet var
total dc capacity kaç mwp
total ac capacity kaç mw
mv cable kaç mm2
solar cable cross section ne
lv ac cable kesiti ne
trench depth min kaç cm
trench width lv için kaç
mv trench deeper mı
structure toplam kaç adet
2v27 kaç tane
2v14 kaç tane
fencing toplam uzunluk kaç
kaç tane gate var
access road width kaç
turning radius kaç metre
gravel mi asfalt mı road
grounding conductor copper mı
earthing ring var mı
weather station kaç tane
meteo sensors neler
ptz camera var mı
fibre optic kullanılmış mı
container office var mı
compound area nerede
grange kim amk
tyler grange ne iş yapıyor
lemp ne demek
buffer zone kaç metre
hedge buffer kaç metre
watercourse buffer neden 5m
construction exclusion zone ne
bramble ne lan
bramble nasıl temizleniyor
neden 2m strip strip kesiliyor
reptile için neden bekleniyor
nesting season ne zaman
feb to july neden yasak
mowing hangi aylarda yapılmaz
glyphosate nerede allowed
pesticide neden yasak
biodiversity net gain ne
bat box nereye konuluyor
bird box nereye asılıyor
wildflower neden ekiliyor
emorsgate eh1 nedir
long grass neden bırakılıyor
%50 cut %50 leave ne demek
invasive species hangileri
dock thistle ragwort ne
arable loss neden önemsiz
ecological impact report kim yazmış
lemp ne zaman başlıyor
lemp kim sorumlu
lemp uygulanmazsa ne olur
mc4 erkek dişi fark eder mi
paneli ters bağlarsak what happens
inverter yanarsa kim suçlu
27 yerine 28 bağlarsak nolur
mppt patlarsa sistem çöker mi
grounding yok ama çalışıyor olur mu
hedge kesersek ceza var mı
buffer zone’a kamyon girerse ne olur
bramble keserken hayvan çıkarsa
july’de mowing yaparsak problem mi
glyphosate her yere sıkılır mı
bat box koymazsak issue olur mu
bird box kırmak illegal mi
fencing olmasa site çalışır mı
camera çalışmazsa problem mi
fibre koparsa scada gider mi
dc cable güneş görürse zarar mı
mv cable üstünden truck geçerse
trench sığ kazılırsa risk ne
inverter grounding unutulursa
structure yamuk olursa ne olur
tilt 25 derece yapsak daha iyi mi
dc ac ratio 2 olursa
string farklı uzunlukta olursa
mppt tek string kalırsa
substation offline olursa
lemp ignore edersek ne olur
ecology rapor yanlış çıkarsa
planning condition bozulursa
bu soruya cevap yoksa ne yapman lazım
"""


def categorize(q: str) -> tuple[str, str, bool]:
    """
    Returns: (category, expected_behavior, mention_required)
    """
    ql = q.lower().strip()

    # policy question about how the assistant should behave
    if "bu soruya cevap yoksa" in ql:
        return ("policy", "ANSWER", False)

    is_definition = bool(re.search(r"\b(what is|who is|nedir|ne demek|kimdir)\b", ql))
    if is_definition:
        # strict: if no explicit definition, fallback; mention list is desirable
        return ("definition", "FALLBACK", True)

    # numeric/doc-fact type
    if re.search(r"\b(kaç|kac|how many|total|toplam|ratio|dc/ac|mwp|mw|kva|kv|voc|mppt|voltage|capacity|mm2|mm²|cm|metre|m)\b", ql):
        return ("doc_fact", "ANSWER", False)

    # why/what happens/risk/legal — strict default is fallback unless doc explicitly explains (we’ll treat as fallback).
    if re.search(
        r"\b(why|neden|niye|riskli|ne olur|nolur|what happens|illegal|ceza|yasak|sorumlu|suçlu|issue|problem|ignore)\b",
        ql,
    ):
        return ("why_reasoning", "FALLBACK", False)

    # default
    return ("doc_fact", "ANSWER", False)


def main() -> int:
    questions = []
    for line in RAW_QUESTIONS.splitlines():
        s = line.strip()
        if not s:
            continue
        if s in {"q", "answers", "answers:"}:
            continue
        if s.startswith("#"):
            continue
        questions.append(s)

    items = []
    for idx, q in enumerate(questions, start=1):
        category, expected_behavior, mention_required = categorize(q)
        items.append(
            {
                "id": f"VAL-{idx:04d}",
                "question": q,
                "category": category,
                "expected_behavior": expected_behavior,
                "mention_required": mention_required,
                # Optional constraints (fill later as we refine)
                "expected_doc_names": [],
                "expected_keywords": [],
            }
        )

    payload = {
        "name": "CEW_STRICT_VALIDATION",
        "policy": {
            "strict_source_only": True,
            "pass_on_fallback_when_no_evidence": True,
        },
        "tests": items,
    }

    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {OUT} ({len(items)} tests)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

