# Privacy Policy for Whisper Transcriber GNOME Extension

## No Warranty or Liability

The Whisper Transcriber GNOME extension is provided "as is" without any warranties or guarantees of any kind. By using this extension, you acknowledge and agree that the developers, maintainers, and contributors bear no responsibility for any consequences arising from its use. You assume all risks associated with its operation, including but not limited to data privacy, security, and compliance with applicable laws.

## Overview

The Whisper Transcriber GNOME extension provides speech-to-text functionality by recording audio from your microphone and sending it to OpenAI's Whisper API for transcription. This document explains what data is processed by the extension and how it operates.

## Data Processing

### Audio Recording

- Audio is recorded from your microphone **only** when you explicitly start recording by clicking "Record Audio" in the extension menu.
- Recording stops when you manually stop it.
- Audio is stored temporarily in the `/tmp` directory.
- The extension does not retain audio data after transcription is complete; temporary audio files are automatically deleted.
- Uninstalling the extension will not remove any cached local data, which may still exist in `/tmp` until cleared by the operating system or the user.

### API Communication

- Audio recordings are sent to OpenAI's Whisper API for transcription.
- The extension does not modify or analyze the audio before sending it.
- No additional personal data is collected, stored, or transmitted by the extension.

## API Key Handling

- An OpenAI API key is required for the extension to function.
- The API key is stored locally on your device using GNOME's built-in settings system.
- The key is never transmitted to any service other than OpenAI.
- You are solely responsible for managing and securing your API key.

## Third-Party Services

This extension relies on OpenAI's Whisper API for transcription. Users should review OpenAI's privacy policy at [https://openai.com/policies/privacy-policy](https://openai.com/policies/privacy-policy) to understand how their data is handled by OpenAI.

## User Responsibilities

- You are solely responsible for ensuring you have permission to record any conversations or speech that includes other individuals.
- You assume full responsibility for any data sent to OpenAI's Whisper API.
- You are responsible for securing your API key and preventing unauthorized access.
- Uninstalling the extension will not remove any cached local data, which may still exist in `/tmp` until cleared by the operating system or the user.

## Changes to This Privacy Policy

This privacy policy may be updated at any time without prior notice. It is your responsibility to review the latest version before using the extension.

Last updated: March 2025

