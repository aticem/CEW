"""
Simple language detection for EN/TR.
Detects Turkish based on common words and special characters.
"""
import re

# Common Turkish words and patterns
TURKISH_WORDS = [
    "ve", "veya", "için", "ile", "bu", "bir", "olan", "olarak",
    "da", "de", "mi", "mı", "ne", "nasıl", "neden", "kaç", "toplam",
    "tarafından", "göre", "arasında", "üzerinde", "altında", "sonra",
    "önce", "şu", "hangi", "kadar", "değil", "var", "yok", "evet",
    "hayır", "lütfen", "teşekkür", "merhaba", "günaydın", "iyi",
    "kötü", "büyük", "küçük", "çok", "az", "hepsi", "hiç", "bazı"
]

# Turkish-specific characters
TURKISH_CHARS_PATTERN = r'[şŞğĞüÜçÇöÖıİ]'


def detect_language(text: str) -> str:
    """
    Detect if text is Turkish or English.
    
    Args:
        text: Input text to analyze
        
    Returns:
        'tr' for Turkish, 'en' for English
    """
    if not text:
        return "en"
    
    text_lower = text.lower()
    
    # Check for Turkish-specific characters (strong signal)
    if re.search(TURKISH_CHARS_PATTERN, text):
        return "tr"
    
    # Check for common Turkish words
    words_in_text = set(re.findall(r'\b\w+\b', text_lower))
    turkish_word_count = len(words_in_text.intersection(TURKISH_WORDS))
    
    # If 2+ Turkish words found, classify as Turkish
    if turkish_word_count >= 2:
        return "tr"
    
    # Check for Turkish question patterns
    turkish_patterns = [
        r'\b(ne kadar|kaç tane|kac tane|kac|toplam ne|toplam kac|hangi|nedir)\b',
        r'\b(yapıldı|yapılmış|tamamlandı|bitti)\b',
        r'\b(taşeron|işçi|metre|gün)\b'
    ]
    
    for pattern in turkish_patterns:
        if re.search(pattern, text_lower):
            return "tr"
    
    return "en"


def get_fallback_message(language: str) -> str:
    """
    Get the appropriate fallback message for the detected language.
    
    Args:
        language: 'tr' or 'en'
        
    Returns:
        Fallback message in the appropriate language
    """
    if language == "tr":
        return "Bu bilgiyi mevcut kayıtlarda/belgelerde bulamıyorum."
    return "I cannot find this information in the provided records/documents."
