# Local transcription

The macOS app runs whisper.cpp before both manual and automatic uploads. Local
STT and automatic uploads are enabled by default. Automatic upload applies after
stopping a newly recorded file longer than five minutes; it does not scan old
recordings or upload an unfinished recording. An explicitly saved disabled
setting stays disabled.

## Settings and files

Open **Settings → Local STT** to configure the executable, model, language, CPU
threads and Metal GPU. Defaults are:

| Setting | Default |
| --- | --- |
| Executable | `~/workspace/references/whisper.cpp/build/bin/whisper-cli` |
| Model | `~/workspace/references/whisper.cpp/models/ggml-large-v3.bin` |
| Language | `auto` |
| CPU threads | `4` |
| Metal GPU | Enabled |

AVFoundation mixes every audio track on its original timeline and converts it to
16 kHz mono PCM WAV. The recognizer receives separate process arguments:

```bash
whisper-cli -m MODEL -f mixed.wav -l auto -t 4 -otxt -osrt -oj -pp -of transcript
```

Disabling Metal adds `-ng`. The application does not invoke a shell. It retains
`mixed.wav`, `transcript.json`, `transcript.txt`, `transcript.srt` and `stderr.log`
under `.lyre-stt` beside the original recording. **Show STT files** opens this
directory. Attempts use `.lyre-stt/<source fingerprint>/run-UUID/`. Successful results are reused
when the source path, size, modification time and recognition settings match.
Upload IDs are persisted separately for each source/server pair.

The uploaded audio remains a browser-playable M4A with the same timeline. Local
recognition failure shows a warning and requests cloud transcription after
upload. Cancelling stops the pipeline without requesting cloud recognition.

## API and browser

`POST /api/upload/presign` accepts an optional `recordingId` so retries can renew
the URL for the same upload. The recording ID, user and filename determine its
OSS key. `POST /api/recordings` accepts `localTranscription`, a whisper.cpp JSON
object, and `autoTranscribe`. The latter requests cloud recognition only when
no local result is supplied.

```json
{
  "result": { "language": "zh" },
  "model": { "type": "large" },
  "transcription": [
    { "offsets": { "from": 900, "to": 4400 }, "text": "First sentence." },
    { "offsets": { "from": 7900, "to": 9100 }, "text": "Second sentence." }
  ]
}
```

Offsets are milliseconds from the beginning of the original recording, including
silence. Validation limits the JSON to 5 MiB and 50,000 segments; timestamps must
be monotonic safe integers within the recording duration plus a one-second
encoding tolerance. Empty silence results are valid. A local import atomically
writes the recording, sentences and a completed job whose task ID starts with
`local:whisper.cpp:`. It never submits a cloud job or enters ASR polling.

Identical create retries reuse the recording. Different owners, upload keys or
local text/timestamps cannot overwrite it. Ordinary transcription requests reuse
the existing task; **Re-transcribe** explicitly sends `force: true` to request a
new cloud attempt. Concurrent submissions claim the recording before contacting
the provider.

The web upload dialog also accepts the corresponding Whisper JSON file and
validates it before transferring audio. Retrying an interrupted response reuses
the recording ID and completed transcription job.
Locally transcribed recordings show **Local Whisper**; clicking a timestamp or
sentence seeks to its exact offset. Word timing is unavailable in standard
`-oj` output, so these recordings use sentence playback. No word timings are
inferred from text length.

Automatic summaries use the existing AI provider and **Auto-summarize** setting.
After local import, the API reserves the summary once and persists `running`
before returning. The browser polls that status even though the transcription
job is already complete. A summary failure leaves the transcript intact and
remains available for manual retry.

## Verification

Offline native tests use synthetic single/multiple-track audio and a fake
whisper executable. They check 16 kHz mono WAV output, delayed/unequal tracks,
output retention, cache reuse, cancellation and upload fallback. API tests cover
atomic import, concurrent retries, ownership, timestamp validation and summary
success/failure with a fake AI provider. Browser tests use synthetic audio and
verify sentence seeking, summary polling, JSON validation and upload-response
retries without a cloud ASR submission. Browser artifacts use `test-results/bdd`
so Playwright cleanup does not delete native results under `test-results/macos`.

These checks do not certify recognition quality on real meetings, microphone
permissions, cloud provider credentials or live AI output. Such tests require
their separate live-test scope.
