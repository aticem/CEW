# ============================================================================
# CEW AI Service - Setup Script (Windows PowerShell)
# ============================================================================
# This script sets up the development environment for the AI service.
# Run from the ai-service directory: .\scripts\setup.ps1
# ============================================================================

$ErrorActionPreference = "Stop"

# Colors (using Write-Host with -ForegroundColor)
function Write-Step($message) {
    Write-Host "▶ " -NoNewline -ForegroundColor Blue
    Write-Host $message
}

function Write-Success($message) {
    Write-Host "✓ " -NoNewline -ForegroundColor Green
    Write-Host $message
}

function Write-Warning($message) {
    Write-Host "⚠ " -NoNewline -ForegroundColor Yellow
    Write-Host $message
}

function Write-Error($message) {
    Write-Host "✗ " -NoNewline -ForegroundColor Red
    Write-Host $message
}

Write-Host ""
Write-Host "╔══════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║           CEW AI Service - Environment Setup                 ║" -ForegroundColor Cyan
Write-Host "╚══════════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# ============================================================================
# Step 1: Check Node.js version
# ============================================================================
Write-Step "Checking Node.js version..."

try {
    $nodeVersion = node -v
    $majorVersion = [int]($nodeVersion -replace 'v(\d+)\..*', '$1')
    
    if ($majorVersion -lt 18) {
        Write-Error "Node.js version must be 18 or higher (found: $nodeVersion)"
        Write-Host "    Please upgrade Node.js from: https://nodejs.org/"
        exit 1
    }
    
    Write-Success "Node.js $nodeVersion detected"
}
catch {
    Write-Error "Node.js is not installed!"
    Write-Host "    Please install Node.js 18 or later from: https://nodejs.org/"
    exit 1
}

# ============================================================================
# Step 2: Check npm availability
# ============================================================================
Write-Step "Checking npm..."

try {
    $npmVersion = npm -v
    Write-Success "npm $npmVersion detected"
}
catch {
    Write-Error "npm is not installed!"
    Write-Host "    npm should come with Node.js. Please reinstall Node.js."
    exit 1
}

# ============================================================================
# Step 3: Navigate to ai-service directory
# ============================================================================
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$aiServiceDir = Split-Path -Parent $scriptDir

Write-Step "Changing to ai-service directory..."
Set-Location $aiServiceDir
Write-Success "Working in: $(Get-Location)"

# ============================================================================
# Step 4: Install dependencies
# ============================================================================
Write-Step "Installing npm dependencies..."

try {
    npm install
    Write-Success "Dependencies installed successfully"
}
catch {
    Write-Error "Failed to install dependencies"
    exit 1
}

# ============================================================================
# Step 5: Ensure required folders exist
# ============================================================================
Write-Step "Creating required directories..."

if (-not (Test-Path "documents")) {
    New-Item -ItemType Directory -Path "documents" | Out-Null
}
Write-Success "Created: documents/"

if (-not (Test-Path "index-store")) {
    New-Item -ItemType Directory -Path "index-store" | Out-Null
}
Write-Success "Created: index-store/"

# ============================================================================
# Step 6: Setup .env file
# ============================================================================
Write-Step "Checking environment configuration..."

if (Test-Path ".env") {
    Write-Success ".env file already exists"
}
else {
    if (Test-Path ".env.example") {
        Copy-Item ".env.example" ".env"
        Write-Success "Created .env from .env.example"
        Write-Warning "IMPORTANT: Edit .env and add your OPENAI_API_KEY!"
    }
    else {
        Write-Warning ".env.example not found, creating basic .env..."
        
        $envContent = @"
# CEW AI Service Configuration
# REQUIRED: Add your OpenAI API key below
OPENAI_API_KEY=

# Server
PORT=3001

# Paths
DOCUMENTS_PATH=./documents
INDEX_STORE_PATH=./index-store

# LLM Settings
LLM_MODEL=gpt-4o-mini
LLM_TEMPERATURE=0.1
LLM_MAX_TOKENS=1000
EMBEDDING_MODEL=text-embedding-3-small

# Chunking
CHUNK_SIZE=1000
CHUNK_OVERLAP=200
"@
        
        $envContent | Out-File -FilePath ".env" -Encoding UTF8
        Write-Success "Created .env file"
        Write-Warning "IMPORTANT: Edit .env and add your OPENAI_API_KEY!"
    }
}

# ============================================================================
# Final Summary
# ============================================================================
Write-Host ""
Write-Host "╔══════════════════════════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "║                    Setup Complete! 🎉                        ║" -ForegroundColor Green
Write-Host "╚══════════════════════════════════════════════════════════════╝" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:"
Write-Host ""
Write-Host "  1. Add your OpenAI API key to .env:"
Write-Host "     " -NoNewline
Write-Host "notepad .env" -ForegroundColor Yellow
Write-Host ""
Write-Host "  2. Add documents to the documents/ folder"
Write-Host ""
Write-Host "  3. Run document ingestion:"
Write-Host "     " -NoNewline
Write-Host "npx ts-node src/scripts/ingest.ts" -ForegroundColor Cyan
Write-Host ""
Write-Host "  4. Start the server:"
Write-Host "     " -NoNewline
Write-Host "npm run dev" -ForegroundColor Cyan
Write-Host ""
Write-Host "  5. Test the API:"
Write-Host "     " -NoNewline
Write-Host "curl http://localhost:3001/health" -ForegroundColor Cyan
Write-Host ""
