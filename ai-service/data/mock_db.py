"""
Mock database for progress data.
Strict schema: {date, subcontractor_code, worker_count, amount_done, unit}

In production, this would query a real database.
"""

PROGRESS_DATA = [
    # SUB-A: DC Cable Pulling
    {"date": "2026-01-03", "subcontractor_code": "SUB-A", "worker_count": 10, "amount_done": 320.5, "unit": "meters"},
    {"date": "2026-01-04", "subcontractor_code": "SUB-A", "worker_count": 12, "amount_done": 410.0, "unit": "meters"},
    {"date": "2026-01-05", "subcontractor_code": "SUB-A", "worker_count": 12, "amount_done": 450.5, "unit": "meters"},
    {"date": "2026-01-06", "subcontractor_code": "SUB-A", "worker_count": 15, "amount_done": 580.0, "unit": "meters"},
    {"date": "2026-01-07", "subcontractor_code": "SUB-A", "worker_count": 14, "amount_done": 520.0, "unit": "meters"},
    {"date": "2026-01-08", "subcontractor_code": "SUB-A", "worker_count": 11, "amount_done": 390.0, "unit": "meters"},
    {"date": "2026-01-09", "subcontractor_code": "SUB-A", "worker_count": 13, "amount_done": 480.0, "unit": "meters"},
    
    # SUB-B: MV Cable Pulling
    {"date": "2026-01-03", "subcontractor_code": "SUB-B", "worker_count": 8, "amount_done": 150.0, "unit": "meters"},
    {"date": "2026-01-04", "subcontractor_code": "SUB-B", "worker_count": 8, "amount_done": 180.0, "unit": "meters"},
    {"date": "2026-01-05", "subcontractor_code": "SUB-B", "worker_count": 10, "amount_done": 220.0, "unit": "meters"},
    {"date": "2026-01-06", "subcontractor_code": "SUB-B", "worker_count": 10, "amount_done": 240.0, "unit": "meters"},
    {"date": "2026-01-07", "subcontractor_code": "SUB-B", "worker_count": 9, "amount_done": 200.0, "unit": "meters"},
    {"date": "2026-01-08", "subcontractor_code": "SUB-B", "worker_count": 11, "amount_done": 260.0, "unit": "meters"},
    {"date": "2026-01-09", "subcontractor_code": "SUB-B", "worker_count": 10, "amount_done": 230.0, "unit": "meters"},
    
    # SUB-C: Trenching
    {"date": "2026-01-03", "subcontractor_code": "SUB-C", "worker_count": 20, "amount_done": 85.5, "unit": "cubic_meters"},
    {"date": "2026-01-04", "subcontractor_code": "SUB-C", "worker_count": 22, "amount_done": 95.0, "unit": "cubic_meters"},
    {"date": "2026-01-05", "subcontractor_code": "SUB-C", "worker_count": 18, "amount_done": 72.0, "unit": "cubic_meters"},
    {"date": "2026-01-06", "subcontractor_code": "SUB-C", "worker_count": 25, "amount_done": 110.0, "unit": "cubic_meters"},
    {"date": "2026-01-07", "subcontractor_code": "SUB-C", "worker_count": 24, "amount_done": 105.0, "unit": "cubic_meters"},
    {"date": "2026-01-08", "subcontractor_code": "SUB-C", "worker_count": 20, "amount_done": 88.0, "unit": "cubic_meters"},
    {"date": "2026-01-09", "subcontractor_code": "SUB-C", "worker_count": 23, "amount_done": 98.0, "unit": "cubic_meters"},
    
    # SUB-D: Fibre Optic
    {"date": "2026-01-05", "subcontractor_code": "SUB-D", "worker_count": 6, "amount_done": 1200.0, "unit": "meters"},
    {"date": "2026-01-06", "subcontractor_code": "SUB-D", "worker_count": 6, "amount_done": 1350.0, "unit": "meters"},
    {"date": "2026-01-07", "subcontractor_code": "SUB-D", "worker_count": 8, "amount_done": 1800.0, "unit": "meters"},
    {"date": "2026-01-08", "subcontractor_code": "SUB-D", "worker_count": 7, "amount_done": 1500.0, "unit": "meters"},
    {"date": "2026-01-09", "subcontractor_code": "SUB-D", "worker_count": 8, "amount_done": 1650.0, "unit": "meters"},
]


def get_all_progress() -> list[dict]:
    """Return all progress records."""
    return PROGRESS_DATA


def get_progress_by_subcontractor(code: str) -> list[dict]:
    """Return progress for a specific subcontractor."""
    return [r for r in PROGRESS_DATA if r["subcontractor_code"] == code]


def get_progress_by_date_range(start: str, end: str) -> list[dict]:
    """Return progress within a date range (inclusive)."""
    return [r for r in PROGRESS_DATA if start <= r["date"] <= end]


def get_unique_subcontractors() -> list[str]:
    """Return list of unique subcontractor codes."""
    return list(set(r["subcontractor_code"] for r in PROGRESS_DATA))
