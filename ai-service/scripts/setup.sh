#!/bin/bash
# ============================================================================
# CEW AI Service - Setup Script (Linux / macOS)
# ============================================================================
# This script sets up the development environment for the AI service.
# Run from the ai-service directory: ./scripts/setup.sh
# ============================================================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Print with color
print_step() {
    echo -e "${BLUE}▶${NC} $1"
}

print_success() {
    echo -e "${GREEN}✓${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║           CEW AI Service - Environment Setup                 ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

# ============================================================================
# Step 1: Check Node.js version
# ============================================================================
print_step "Checking Node.js version..."

if ! command -v node &> /dev/null; then
    print_error "Node.js is not installed!"
    echo "    Please install Node.js 18 or later from: https://nodejs.org/"
    exit 1
fi

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    print_error "Node.js version must be 18 or higher (found: $(node -v))"
    echo "    Please upgrade Node.js from: https://nodejs.org/"
    exit 1
fi

print_success "Node.js $(node -v) detected"

# ============================================================================
# Step 2: Check npm availability
# ============================================================================
print_step "Checking npm..."

if ! command -v npm &> /dev/null; then
    print_error "npm is not installed!"
    echo "    npm should come with Node.js. Please reinstall Node.js."
    exit 1
fi

print_success "npm $(npm -v) detected"

# ============================================================================
# Step 3: Navigate to ai-service directory
# ============================================================================
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AI_SERVICE_DIR="$(dirname "$SCRIPT_DIR")"

print_step "Changing to ai-service directory..."
cd "$AI_SERVICE_DIR"
print_success "Working in: $(pwd)"

# ============================================================================
# Step 4: Install dependencies
# ============================================================================
print_step "Installing npm dependencies..."

if npm install; then
    print_success "Dependencies installed successfully"
else
    print_error "Failed to install dependencies"
    exit 1
fi

# ============================================================================
# Step 5: Ensure required folders exist
# ============================================================================
print_step "Creating required directories..."

mkdir -p documents
mkdir -p index-store

print_success "Created: documents/"
print_success "Created: index-store/"

# ============================================================================
# Step 6: Setup .env file
# ============================================================================
print_step "Checking environment configuration..."

if [ -f ".env" ]; then
    print_success ".env file already exists"
else
    if [ -f ".env.example" ]; then
        cp .env.example .env
        print_success "Created .env from .env.example"
        print_warning "IMPORTANT: Edit .env and add your OPENAI_API_KEY!"
    else
        print_warning ".env.example not found, creating basic .env..."
        cat > .env << 'EOF'
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
EOF
        print_success "Created .env file"
        print_warning "IMPORTANT: Edit .env and add your OPENAI_API_KEY!"
    fi
fi

# ============================================================================
# Final Summary
# ============================================================================
echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║                    Setup Complete! 🎉                        ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
echo "Next steps:"
echo ""
echo "  1. Add your OpenAI API key to .env:"
echo "     ${YELLOW}nano .env${NC}"
echo ""
echo "  2. Add documents to the documents/ folder"
echo ""
echo "  3. Run document ingestion:"
echo "     ${BLUE}npx ts-node src/scripts/ingest.ts${NC}"
echo ""
echo "  4. Start the server:"
echo "     ${BLUE}npm run dev${NC}"
echo ""
echo "  5. Test the API:"
echo "     ${BLUE}curl http://localhost:3001/health${NC}"
echo ""
