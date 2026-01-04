# CEW AI Service

Bu servis CEW için AI backend'ini implement eder.

## Kurulum

```bash
cd ai-service
npm install
```

## Çalıştırma

### Development Server (API)
```bash
npm run dev
```

Server `http://localhost:3001` üzerinde çalışır.

### Sadece Ingest (CLI)
```bash
npm run ingest
```

## API Endpoints

### Health Check
```
GET /health
```

### İstatistikler
```
GET /api/stats
```

### Doküman İngest (Manuel Tetikleme)
```
POST /api/ingest
```

### Soru Sor (Ana AI Endpoint)
```
POST /api/query
Content-Type: application/json

{
  "question": "Hangi MV connector kullanılmalı?",
  "scope": "BOM_BOQ"  // opsiyonel
}
```

**Response:**
```json
{
  "success": true,
  "question": "...",
  "routeType": "DOC",
  "answer": "...",
  "sources": [...],
  "guardResult": { "passed": true, "flags": [] }
}
```

### Doküman Ara
```
GET /api/search?q=connector&type=EXCEL_BOM&folder=BOM&limit=10
```

### Tüm Dokümanları Listele
```
GET /api/documents
```

### Doküman Chunk'larını Getir
```
GET /api/documents/:docId/chunks
```

## Mimari

```
src/
├── api/           # Express API server
│   ├── server.js
│   ├── ingestHandler.js
│   └── index.js
├── guard/         # Safety/accuracy checks
│   ├── guardRules.js
│   └── index.js
├── ingest/        # Document ingestion
│   ├── classify.js
│   ├── ingestOne.js
│   ├── mockDrive.js
│   └── parsers/
├── llm/           # LLM integration
│   ├── llmClient.js
│   ├── promptTemplates.js
│   └── index.js
├── query/         # Question routing
│   ├── keywordSearch.js
│   ├── queryRouter.js
│   └── index.js
├── store/         # Chunk storage
│   ├── chunkStore.js
│   └── index.js
├── index.js       # CLI ingest entry
└── server.js      # API server entry
```

## Modüller

### Store (chunkStore.js)
- In-memory chunk storage
- Doküman bazlı indexleme
- Arama ve filtreleme

### Guard (guardRules.js)
- Speculation kontrolü
- Compliance claim kontrolü
- Source presence kontrolü
- OCR flag kontrolü

### LLM (llmClient.js)
- OpenAI/Anthropic API entegrasyonu
- Mock mode (test için)
- Guard entegrasyonu

### Query (queryRouter.js)
- Soru sınıflandırma (DOC/CEW_DATA/HYBRID/REFUSE)
- Klasör algılama
- Evidence retrieval

### API (server.js)
- Express REST API
- CORS enabled
- Error handling

## Ortam Değişkenleri

```bash
# Server
PORT=3001

# LLM Configuration
LLM_PROVIDER=mock  # 'openai', 'anthropic', 'mock'
LLM_API_KEY=your-api-key
LLM_MODEL=gpt-4
LLM_MAX_TOKENS=1024
LLM_TEMPERATURE=0.1
```

## Route Türleri

| Route | Açıklama | Örnek Sorular |
|-------|----------|---------------|
| DOC | Drive dokümanları | "Hangi connector?", "Torque değeri?" |
| CEW_DATA | Sistem metrikleri | "Panel %?", "Açık NCR?" |
| HYBRID | Her ikisi | "ITP frequency?" |
| REFUSE | Kapsam dışı | "Onaylanmış mı?", "Güvenli mi?" |

## Guard Kuralları

1. **No Speculation**: "probably", "likely" gibi ifadeler engellenir
2. **No Compliance Claims**: Onay/uygunluk kararları verilmez
3. **Source Required**: Her cevabın kaynağı olmalı
4. **OCR Disclaimer**: Drawing'lerden ölçü çıkarılamaz

## MVP Sınırları

- ✅ PDF text extraction
- ✅ DOCX text extraction
- ✅ Excel stub (gerçek okuma eklenmedi)
- ✅ Keyword search
- ✅ Guard checks
- ❌ OCR yok
- ❌ DWG/CAD yok
- ❌ Auto-ingest yok
- ❌ Vector search yok (keyword only)
