#!/bin/bash
# Packaging script for Whisper Transcriber GNOME Extension

# Get directory of the script
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
EXT_UUID="whisper-transcriber@opreto.com"
EXT_NAME="Whisper Transcriber"
VERSION=$(grep -oP '"version": "\K[^"]+' "${SCRIPT_DIR}/metadata.json")

echo "Packaging ${EXT_NAME} v${VERSION}..."

# Check for required files
required_files=(
  "extension.js"
  "prefs.js"
  "metadata.json"
  "LICENSE"
  "PRIVACY.md"
  "README.md"
  "stylesheet.css"
  "po/POTFILES.in"
  "po/LINGUAS"
  "po/whisper-transcriber.pot"
  "schemas/org.gnome.shell.extensions.whisper-transcriber.gschema.xml"
  "schemas/gschemas.compiled"
)

for file in "${required_files[@]}"; do
  if [ ! -f "${SCRIPT_DIR}/${file}" ]; then
    echo "Error: Required file ${file} not found!"
    exit 1
  fi
done

# Ensure schemas are compiled
if [ ! -f "${SCRIPT_DIR}/schemas/gschemas.compiled" ]; then
  echo "Compiling schemas..."
  glib-compile-schemas "${SCRIPT_DIR}/schemas/"
  if [ $? -ne 0 ]; then
    echo "Error: Failed to compile schemas!"
    exit 1
  fi
fi

# Create po directory if it doesn't exist
if [ ! -d "${SCRIPT_DIR}/po" ]; then
  echo "Creating po directory structure..."
  mkdir -p "${SCRIPT_DIR}/po"
  echo "extension.js" > "${SCRIPT_DIR}/po/POTFILES.in"
  echo "prefs.js" >> "${SCRIPT_DIR}/po/POTFILES.in"
  touch "${SCRIPT_DIR}/po/LINGUAS"
fi

# Ensure .pot file exists
if [ ! -f "${SCRIPT_DIR}/po/whisper-transcriber.pot" ]; then
  echo "Generating .pot file..."
  xgettext --from-code=UTF-8 --language=JavaScript -o "${SCRIPT_DIR}/po/whisper-transcriber.pot" \
    "${SCRIPT_DIR}/extension.js" "${SCRIPT_DIR}/prefs.js"
  if [ $? -ne 0 ]; then
    echo "Error: Failed to generate whisper-transcriber.pot!"
    exit 1
  fi
fi

# Create build directory
BUILD_DIR="/tmp/${EXT_UUID}-build"
rm -rf "${BUILD_DIR}"
mkdir -p "${BUILD_DIR}"

# Copy files to build directory
echo "Copying files to build directory..."
cp -r "${SCRIPT_DIR}/"* "${BUILD_DIR}/"

# Remove any git or development files
rm -rf "${BUILD_DIR}/.git"
rm -rf "${BUILD_DIR}/.github"
rm -f "${BUILD_DIR}/.gitignore"
rm -f "${BUILD_DIR}/package.sh"
rm -f "${BUILD_DIR}/${EXT_UUID}.zip"

# Create the ZIP file (without nesting the directory inside)
echo "Creating ZIP package..."
cd "${BUILD_DIR}" && zip -r "${SCRIPT_DIR}/${EXT_UUID}.zip" .

echo "Package created: ${SCRIPT_DIR}/${EXT_UUID}.zip"
echo "You can now upload this file to extensions.gnome.org"

