# Jazz local Piper voice

Jazz uses Piper locally for neural speech. The repository intentionally does **not** commit the Piper binary or voice model because they are large runtime assets.

Default voice:

- `en_US-amy-medium` — English female voice
- Piper runs locally; no TTS API key is required.
- Override with `JAZZ_PIPER_MODEL` if you install another Piper voice.

Expected layout:

```text
tools/piper/
├── piper.exe                 # Windows
├── piper                     # Linux/macOS
└── voices/
    ├── en_US-amy-medium.onnx
    └── en_US-amy-medium.onnx.json
```

Run `powershell -ExecutionPolicy Bypass -File tools/piper/setup-windows.ps1` on Windows. The script downloads the Piper runtime and Amy voice model into this folder.
