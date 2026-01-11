# API Keys ve Modeller - CEW AI Service

Bu doküman, CEW AI Service'in kullandığı API key'leri ve modelleri açıklar.

---

## 📋 Özet Tablo

| Servis | API Key | Model | Kullanım Yeri | Amaç |
|--------|---------|-------|---------------|------|
| **Anthropic** | `ANTHROPIC_API_KEY` | `claude-sonnet-4-5` (preferred) | `src/query/llm/llmService.js` | Soru-Cevap (LLM) |
| | | `claude-3-5-sonnet-20241022` (fallback) | | |
| **OpenAI** | `OPENAI_API_KEY` | `text-embedding-3-small` | `src/ingest/embeddings/embeddingService.js` | Embedding oluşturma |
| **Qdrant** | `QDRANT_API_KEY` | - | `src/vector/providers/qdrantProvider.js` | Vector DB |

---

## 🎯 Detaylı Açıklama

### 1️⃣ Anthropic (LLM - Soru Cevaplama)

```env
ANTHROPIC_API_KEY=sk-ant-api03-...
ANTHROPIC_PREFERRED_MODEL=claude-sonnet-4-5
ANTHROPIC_FALLBACK_MODEL=claude-3-5-sonnet-20241022
```

**Kullanım:**
- Kullanıcı sorularını cevaplar
- RAG (Retrieval Augmented Generation) ile dokümanlardan bilgi çeker
- Otomatik fallback mekanizması: Preferred model çalışmazsa fallback modele geçer

**Dosya:** `src/query/llm/llmService.js`

---

### 2️⃣ OpenAI (Embeddings - Vektör Arama)

```env
OPENAI_API_KEY=sk-proj-...
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
```

**Kullanım:**
- Dokümanları vektöre (1536 boyutlu) çevirir
- Kullanıcı sorgularını vektöre çevirir
- Similarity search için kullanılır

**Dosya:** `src/ingest/embeddings/embeddingService.js`

---

### 3️⃣ Qdrant (Vector Database)

```env
QDRANT_URL=http://localhost:6333
QDRANT_API_KEY=
QDRANT_COLLECTION_NAME=cew_documents
```

**Kullanım:**
- Embedding vektörlerini saklar
- Benzerlik araması yapar
- Localhost için API key gerekmez

**Dosya:** `src/vector/providers/qdrantProvider.js`

---

## 🔧 Config Dosyası

Tüm konfigürasyon `src/config/env.js` dosyasında tanımlanır:

```javascript
// Anthropic (LLM)
anthropic: {
  apiKey: process.env.ANTHROPIC_API_KEY,
  preferredModel: process.env.ANTHROPIC_PREFERRED_MODEL || 'claude-sonnet-4-5',
  fallbackModel: process.env.ANTHROPIC_FALLBACK_MODEL || 'claude-3-5-sonnet-20241022',
}

// OpenAI (Embeddings)
openai: {
  apiKey: process.env.OPENAI_API_KEY,
  embeddingModel: process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small',
}

// Qdrant (Vector DB)
vectorDb: {
  qdrant: {
    url: process.env.QDRANT_URL || 'http://localhost:6333',
    apiKey: process.env.QDRANT_API_KEY || '',
    collectionName: process.env.QDRANT_COLLECTION_NAME || 'cew_documents',
  }
}
```

---

## ⚠️ Zorunlu API Key'ler

| API Key | Zorunlu mu? | Neden? |
|---------|-------------|--------|
| `ANTHROPIC_API_KEY` | ✅ Evet | LLM cevapları için gerekli |
| `OPENAI_API_KEY` | ✅ Evet | Embedding oluşturma için gerekli |
| `QDRANT_API_KEY` | ❌ Hayır | Sadece uzak Qdrant sunucusu için |

---

## 📁 .env Örneği

```env
# Anthropic Configuration (for LLM ONLY - answer generation)
ANTHROPIC_API_KEY=sk-ant-api03-...
ANTHROPIC_PREFERRED_MODEL=claude-sonnet-4-5
ANTHROPIC_FALLBACK_MODEL=claude-3-5-sonnet-20241022

# OpenAI Configuration (for EMBEDDINGS ONLY - vector search)
OPENAI_API_KEY=sk-proj-...
OPENAI_EMBEDDING_MODEL=text-embedding-3-small

# Qdrant Configuration
QDRANT_URL=http://localhost:6333
QDRANT_API_KEY=
QDRANT_COLLECTION_NAME=cew_documents
```

---

## 🔄 Data Flow

```
[Kullanıcı Sorusu]
        │
        ▼
[OpenAI Embedding] ─── text-embedding-3-small
        │
        ▼
[Qdrant Search] ─── Benzer dokümanları bul
        │
        ▼
[Anthropic LLM] ─── claude-sonnet-4-5 / claude-3-5-sonnet-20241022
        │
        ▼
[Cevap]
```

---

*Son güncelleme: 11 Ocak 2026*
