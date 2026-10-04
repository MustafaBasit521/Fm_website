def format_price(paisa: int) -> str:
    """Rs 1,250.50 from 125050. Integer math only (no floating point)."""
    rupees, rest = divmod(paisa, 100)
    whole = f"{rupees:,}"
    return f"Rs {whole}" if rest == 0 else f"Rs {whole}.{rest:02d}"
