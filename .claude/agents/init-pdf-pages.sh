#!/bin/bash
# Convert proprietary PDFs to page images for Claude agents
#
# Usage:
#   ./init-pdf-pages.sh           # Convert all PDFs
#   ./init-pdf-pages.sh pn532     # Convert only PN532 datasheet
#   ./init-pdf-pages.sh ntag424   # Convert only NTAG424 documents
#
# Prerequisites:
#   sudo apt-get install poppler-utils
#
# Source PDFs expected in: docs/proprietary/
# Output pages stored in: .claude/agents/*/pages/

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
DOCS_DIR="$PROJECT_ROOT/docs/proprietary"

# Check for poppler-utils
if ! command -v pdftoppm &> /dev/null; then
    echo "Error: pdftoppm not found. Install with:"
    echo "  sudo apt-get install poppler-utils"
    exit 1
fi

convert_pdf() {
    local pdf_path="$1"
    local output_dir="$2"
    local name="$3"

    if [[ ! -f "$pdf_path" ]]; then
        echo "Warning: PDF not found: $pdf_path"
        return 1
    fi

    echo "Converting $name..."
    mkdir -p "$output_dir"
    pdftoppm -png -r 150 "$pdf_path" "$output_dir/page"

    local count=$(ls "$output_dir"/*.png 2>/dev/null | wc -l)
    echo "  Created $count page images in $output_dir"
}

convert_pn532() {
    local pdf="$DOCS_DIR/Pn532um.pdf"
    local output="$SCRIPT_DIR/pn532-expert/pages"
    convert_pdf "$pdf" "$output" "PN532 User Manual"
}

convert_ntag424() {
    # Main datasheet
    local pdf1="$DOCS_DIR/NTAG_424.pdf"
    local output1="$SCRIPT_DIR/ntag424-expert/pages/datasheet"
    convert_pdf "$pdf1" "$output1" "NTAG 424 DNA Datasheet"

    # Application note AN12196
    local pdf2="$DOCS_DIR/AN12196_NTAG 424 DNA and NTAG 424 DNA TagTamper features and hints.pdf"
    local output2="$SCRIPT_DIR/ntag424-expert/pages/an12196"
    convert_pdf "$pdf2" "$output2" "AN12196 Application Note"
}

case "${1:-all}" in
    pn532)
        convert_pn532
        ;;
    ntag424)
        convert_ntag424
        ;;
    all)
        echo "Converting all proprietary PDFs to page images..."
        echo ""
        convert_pn532 || true
        echo ""
        convert_ntag424 || true
        echo ""
        echo "Done. Page images are gitignored and can be regenerated anytime."
        ;;
    *)
        echo "Usage: $0 [pn532|ntag424|all]"
        exit 1
        ;;
esac
