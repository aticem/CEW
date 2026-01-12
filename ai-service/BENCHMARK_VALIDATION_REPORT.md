# BENCHMARK VALIDATION REPORT

- Generated at: **2026-01-12T20:31:08**
- Base URL: `http://localhost:8000`
- Input: `validation_cew_strict_questions.json`
- Total: **120**
- Passed: **85**
- Pass rate: **70.8%**

## Fail reasons

| reason | count |
|---|---:|
| EXPECTED_FALLBACK_BUT_ANSWERED | 33 |
| NO_CITATION | 1 |
| MISSING_MENTIONS | 1 |

## Per-document pass rate

| doc_name | passed | failed | pass% |
|---|---:|---:|---:|
|  | 85 | 35 | 70.8% |

## Per-category pass rate

| category | passed | failed | pass% |
|---|---:|---:|---:|
| why_reasoning | 0 | 30 | 0.0% |
| definition | 2 | 4 | 33.3% |
| doc_fact | 82 | 1 | 98.8% |
| policy | 1 | 0 | 100.0% |

## Sample failures (first 10)

### VAL-0003 — EXPECTED_FALLBACK_BUT_ANSWERED

- question: `why 1500v dc kullanılmış bu projede`
- expected_doc_name: ``
- source: `Technical Description_Rev01.docx`
- answer_preview: `1500V DC, projede geniş bir çalışma aralığı sağlamak ve inverterlerin verimli çalışma bölgesini karşılamak amacıyla kullanılmıştır. Bu tasarım, soğuk hava koşullarında (sıcaklıklar -5°C'ye kadar) ve inverterlerin verimli çalışma bölgesinde bir dizi 27 modül ile sonuçlanmaktadır […`

### VAL-0004 — EXPECTED_FALLBACK_BUT_ANSWERED

- question: `string niye 27 panel why not 28`
- expected_doc_name: ``
- source: `Technical Description_Rev01.docx | TABLE: 8 | ROW: 4`
- answer_preview: `SECTION A — RELEVANT EXCERPTS (QUOTED)

1. "OVERVIEW PV PLANT CONFIGURATION: Nº PV MODULES PER STRING, OVERVIEW PV PLANT CONFIGURATION: 27" [Source: Technical Description_Rev01.docx | TABLE: 8 | ROW: 4]

2. "SUBSTATION 4: Modules / String, SUBSTATION 4: 27 Modules" [Source: Techn…`

### VAL-0005 — EXPECTED_FALLBACK_BUT_ANSWERED

- question: `sungrow inverter neden seçilmiş`
- expected_doc_name: ``
- source: `Technical Description_Rev01.docx`
- answer_preview: `Bu bilgiyi mevcut belgelerde/kayıtlarda bulamıyorum. [Kaynak: Technical Description_Rev01.docx]`

### VAL-0012 — EXPECTED_FALLBACK_BUT_ANSWERED

- question: `why bifacial module kullanılmış`
- expected_doc_name: ``
- source: `Technical Description_Rev01.docx`
- answer_preview: `Bu bilgiyi mevcut belgelerde/kayıtlarda bulamıyorum. [Kaynak: Technical Description_Rev01.docx]`

### VAL-0013 — EXPECTED_FALLBACK_BUT_ANSWERED

- question: `570 wp ile 575 wp neden mix`
- expected_doc_name: ``
- source: `Technical Description_Rev01.docx`
- answer_preview: `SECTION A — RELEVANT EXCERPTS (QUOTED)

1. "SOURCE: Technical Description_Rev01.docx | TABLE: 16 | ROW: 3 | DATA: Module Type: Maximum Power (Pmax), JKM570-N72HL4-BDV: 570 Wp, JKM575-N72HL4-BDV: 575 Wp"

2. "SOURCE: Technical Description_Rev01.docx | SECTION: DC/AC RATIO | CONTEN…`

### VAL-0016 — EXPECTED_FALLBACK_BUT_ANSWERED

- question: `mppt voltage window nedir`
- expected_doc_name: ``
- source: `Technical Description_Rev01.docx | SECTION: MPPT SIZING`
- answer_preview: `SECTION A — RELEVANT EXCERPTS (QUOTED)

1. "The MPPT Operating Voltage Range of each Inverter is 500V ~ 1500V." [Source: Technical Description_Rev01.docx | SECTION: MPPT SIZING]

2. "SUNGROW SG350HX: MPPT Operating Voltage, SUNGROW SG350HX: 500 to 1500 V" [Source: Technical Descr…`

### VAL-0018 — EXPECTED_FALLBACK_BUT_ANSWERED

- question: `short circuit current neden önemli`
- expected_doc_name: ``
- source: `Technical Description_Rev01.docx`
- answer_preview: `Bu bilgiyi mevcut belgelerde/kayıtlarda bulamıyorum. [Kaynak: Technical Description_Rev01.docx]`

### VAL-0021 — EXPECTED_FALLBACK_BUT_ANSWERED

- question: `tilt angle neden 20 derece`
- expected_doc_name: ``
- source: `Technical Description_Rev01.docx`
- answer_preview: `Bu bilgiyi mevcut belgelerde/kayıtlarda bulamıyorum. [Kaynak: Technical Description_Rev01.docx]`

### VAL-0022 — NO_CITATION

- question: `pv syst analysis neye göre yapılmış`
- expected_doc_name: ``
- source: `None`
- answer_preview: `Error generating answer: Error code: 429 - {'error': {'message': 'Rate limit reached for gpt-4o in organization org-VWl5N9KaVobNGSkzY1SJnGPK on tokens per min (TPM): Limit 30000, Used 25242, Requested 4977. Please try again in 438ms. Visit https://platform.openai.com/account/rate…`

### VAL-0024 — EXPECTED_FALLBACK_BUT_ANSWERED

- question: `1500v dc riskli mi değil mi`
- expected_doc_name: ``
- source: `Technical Description_Rev01.docx`
- answer_preview: `Bu bilgiyi mevcut belgelerde/kayıtlarda bulamıyorum. [Kaynak: Technical Description_Rev01.docx]`

