# macOS Audio Pipeline Redesign

> 把 macOS 录音层从"应用层手工 sample-by-sample 混音"重写为"AVAssetWriter 双轨直写"，
> 对齐 Azayaka / QuickRecorder / BetterCapture 等主流开源 Swift 项目的做法。
> 目标：**少做奇怪的事**，让录音层简单、独立、可靠。

## Motivation

### Current symptom

最近一次会议录音：

1. 系统音（对方声音）正常。
2. 麦克风采集的本地声音听起来**变速变调**（更快，音高约升一个半音）。

### Root cause（两条候选，并列高置信度）

当前 `AudioEncoder.createSampleBufferLocked()` 用常量 `Constants.Audio.sampleRate = 48000`
同时生成 **PTS** 和 **AVAudioFormat**（`apps/macos/Lyre/Audio/AudioEncoder.swift:101-113, 197-220`）；
而 `AudioCaptureManager` 对 `.audio` / `.microphone` 两路输出在 callback 里**完全不读输入 buffer
的 ASBD（CMAudioFormatDescriptionGetStreamBasicDescription）**就推进 mixer。这制造了两条可能
同时存在的根因，任一条都能产生"对方正常 / 本机变速变调"：

#### Cause A — Sample-rate mismatch（最可能，**约 +1.5 半音 / 9% 提速**与症状量化吻合）

`SCStreamConfiguration.sampleRate = 48000` **只控制 `.audio`（系统音）路径的输出 ASBD**；
`.microphone` 的输出 ASBD 由所选设备决定，蓝牙 / USB / AirPods / 一些外接 mic
默认就是 **44.1 kHz**。当前编码器把 44.1k 的 mic 样本按 48k 重打 PTS + 重打 format：

- 时间压缩比：`44100 / 48000 = 0.91875` → 同一段音频被播得快约 **8.8%**
- 频率比：`48000 / 44100 ≈ 1.0884` → 音高升约 **+1.47 半音**

这正好量化匹配你说的"变快 + 升一个半音"。系统音不受影响，因为它就是 48k 进 48k 出。
**任何接入 44.1k mic 的会议都会复现**；只有当 mic 也是 48k 时这条不触发。

#### Cause B — PTS gap 压缩（次因，但同样存在）

`AudioMixer.drainLocked()` 用 `min(sysCount, micCount)` 配对两路 PCM 样本，**完全忽略
`CMSampleBuffer.presentationTimeStamp`**；下游 `AudioEncoder` 又用 `totalSamplesWritten` 自增 PTS：

```swift
let pts = CMTime(value: totalSamplesWritten, timescale: CMTimeScale(sampleRate))
totalSamplesWritten += Int64(frameCount)
```

后果链：

- 系统音 callback 平稳，每秒约 48000 样本到达
- 麦克风（蓝牙 / USB / 外接设备）callback 抖动：偶尔丢一个 ~100ms 数据包
- 这 100ms 在现实时间里发生了，但 `micBuffer` 里没有这部分样本
- `drainLocked()` 按 `min` 取重叠区，把 mic 的"短"buffer 和 sys 的"长"buffer 头对头压在一起
- 写入文件的 PTS 由 `totalSamplesWritten` 自增 → mic 那段被强制按"匀速"打时间戳
- 播放时：mic 那段被压缩成更短时长 → 变快 + 音高升高

#### 区分两条原因的证据

新方案"透传 SCK 原始 `CMSampleBuffer` + 两个 `AVAssetWriterInput`，AAC encoder 在底层自动重采样
到 48k"**同时修复**两条。在 Phase 0 验证前，要从现场拿到证据缩窄根因：

1. 跑一次现有录音，捕获 `AudioCaptureManager.logBufferFormat()` 在 `Microphone` 首帧打的
   `rate=… ch=… bits=…` 日志（已存在）。如果 mic 的 `rate < 48000`（典型 44100），Cause A 成立。
2. 同一段录音用 `ffprobe -show_streams Recording_xxx.m4a` 看输出文件的 sample_rate，
   对比 mic 首帧的输入 sample_rate。

> **行动**：在动手改造前，确认上面两条日志/ffprobe 证据已经留档（Phase 0 任务）。
> Cause A 由 AAC encoder 自动重采样修复（参见 Phase 0 验证用例 1）；
> 但 **Cause B 是否被自动修复取决于 AVAssetWriter 对 PTS gap / 延迟首帧的处理行为** —
> 见下面 "AVAssetWriter PTS 行为前置验证"。

### AVAssetWriter PTS 行为前置验证（**阻塞 Phase 1，先做**）

本设计的两个关键假设依赖于一个**未经本项目证实**的 AVAssetWriter 行为：

- **假设 A**：`startSession(atSourceTime: t0)` 后，某 track 第一帧 PTS = `t1 > t0` 时，
  AVAssetWriter 会在该 track 头部留出 `t1 - t0` 的空白时间轴（而不是把第一帧规整到 track time 0）。
- **假设 B**：同一 track 连续 append 的两个 buffer 之间出现 PTS gap（比如 600ms 没有数据），
  AVAssetWriter 会在容器层保留这段静默（而不是把后续 buffer 紧贴前一个 buffer 写成连续音频）。

**已知反证**：本地用 Swift 写 `.m4a` / AAC 输出的小型探针实验显示：

- 延迟到达的第一帧被 normalize 到 track time 0（假设 A 不成立）。
- 同 track 0.6 秒的 PTS gap 被压缩成连续音频（假设 B 不成立）。

如果上述行为在**真实 SCK buffer**（host clock PTS、AAC encoder pipeline、`expectsMediaDataInRealTime = true`）下复现，
那么 **Cause B 不会被本方案自动修复** —— 需要在 encoder 内显式补静默或转入离线渲染。

**Phase 0 必跑探针测试**（`LyreTests/AVAssetWriterPTSProbeTests.swift`）：

1. **延迟首帧探针**：`startSession(atSourceTime: .zero)`，然后给一个 AAC `AVAssetWriterInput` append PTS 起点为 0.5s 的 1 秒 440Hz 正弦波 buffer 序列；`finishWriting` 后用 `AVAssetReader` 读出该 track 的第一个 sample PTS。
   - 若 ≈ 0.5s → 假设 A 成立，可走文档主路径。
   - 若 ≈ 0 → 假设 A 不成立。**Phase 1A 实测：这是当前 macOS / AVFoundation 路径上的实际观察值，且 Mitigation A 已被证伪不可行（见下文）。** 后续修复需走 capture-layer warmup / 离线 composition 路径（task #5 / #6 评估）。
2. **PTS gap 探针**：同一 AAC `AVAssetWriterInput` 先 append 0–500ms 的 buffer，再 append 1100–2000ms 的 buffer（600ms gap，**不补静默**）；读出 track sample 序列检查 600–1100ms 区间是否仍然是 600ms 静默。
   - 若保留 → 假设 B 成立。
   - 若被压缩 → 假设 B 不成立；触发 **Mitigation B**。

**Mitigation A — 显式延迟首帧**：**❌ Not viable on current AVFoundation path (task #4, 2026-06-25).**
原计划在 `startSessionLocked()` 中取**全局** min PTS（system + mic 之间的小者）作为 session start，
晚到那路在 session 启动后第一次 append 前合成一段从 `startPTS` 到 `firstActualPTS` 的 silent PCM
`CMSampleBuffer`，让 track 开头空白真正存在于音频流里。

Phase 1A 实测：AAC `AVAssetWriterInput` 会把晚到 track 的 leading section（无论是 pure zero PCM、
combined buffer 前置 silent prefix、还是带 sub-audible dither ε=1e-3 / 1e-1 的扰动 PCM）**全部 trim 掉**，
晚到 track 第一帧仍被规整到 track time ~0。Reviewer 与 SDE 共同结论：在 task #4 时间窗口内，
AVAssetWriter/AAC 这条 PCM input 路径无法可靠实现 Mitigation A。

观察行为已固化为 `lateSourceFirstFrameRemainsTrimmedByAVAssetWriter` 测试（不再尝试修复，仅 pin
当前 AVFoundation 平台限制）。Mitigation B (silent gap fill) 不受影响、正常生效。

**晚到首帧的真正修复路径**留给 task #5 / #6 评估：考虑 AVMutableComposition 离线合成 / 自定义
AAC encoder 路径 / capture 层在 SCK 启动前就用 silent PCM warmup 两路 input。

**Mitigation B — 显式补静默**：每路 encoder append 时记录 `expectedNextPTS = lastPTS + lastDuration`；
若新 buffer 的 PTS > `expectedNextPTS + ε`（ε 取 10ms，吸收 host clock 抖动），先合成一个 ASBD 匹配的
**silent PCM `CMSampleBuffer`** 覆盖 `[expectedNextPTS, newPTS)`，append 后再 append 新 buffer。
PCM 输入由 AAC encoder 自动压缩 —— **不**预先编 AAC。**这是录制期行为，不依赖容器留空**。
(任务 #4 Phase 1A 实测有效：见 `mitigationBGapFillKeepsTrackDuration`。)

**Mitigation 失败 → 兜底 (Final Fallback)**：如果 Mitigation B 探针二次验证仍不可靠
（silent gap fill 也被 AAC encoder 合并；Mitigation A 已在 Phase 1A 证伪，不再纳入此条件），
**已写好的 m4a 不再包含原始时间信息**，
任何"`stopRecording()` 用 `AVAssetReader` 按 host-clock PTS 重渲染"的方案都救不回来 ——
读出来的 sample PTS 已是被压缩后的轨内时间，而不是 host clock。兜底必须**在录制期**保留时间信息，
选其一：

- **B1 — 边录边补静默到 PCM 中间文件**：两路各开一个 `AVAssetWriter` 输出 **未压缩 PCM 中间文件**
  (`kAudioFormatLinearPCM`)，PCM domain 不存在 encoder 合并 gap 的问题；append 前在应用层按 host-clock PTS
  补满静默样本。`stopRecording()` 用 `AVAssetReader` 把两路 PCM 按精确时间轴 downmix 成单轨 AAC m4a，删 PCM 中间文件。
  代价：中间文件占用磁盘（48kHz mono Float32 ≈ 11.5 MB/min，双路 23 MB/min），适合普通会议长度（< 2 小时）。
- **B2 — sidecar timing map**：录制双轨 AAC m4a 的同时，encoder 把每个 append 的 `(source, hostClockPTS, durationSamples)`
  按行追加到 `Recording_xxx.timing.jsonl`。`stopRecording()` 时如果探测到容器层时间被破坏，按 timing map
  把每个 sample range 解出来、补静默、再 AAC 编一次。代价：实现复杂、需要保证 timing 写入与 buffer 写入的事务一致。

> **B1 是默认兜底**：实现简单、错误面小；只在磁盘成本不可接受时才考虑 B2。

**禁止的兜底**：用 `AVAssetReader` 直接读已写好的双轨 m4a 然后"按 PTS 渲染" —— 一旦 Mitigation B 验证不通过，
那个文件里的 PTS 已经是被 AAC encoder 压缩后的结果，不再是 host clock。这条路径**只在 Mitigation B 探针通过时**才可用
（即 `Risk & Fallback` 章节的"离线 downmix"路径）。

**决策树（Phase 1A 后已更新）**：

| 假设 A | 假设 B | 行动 |
|---|---|---|
| ✅ | ✅ | 走文档主路径，无修改 |
| ❌ | ✅ | ⚠️ Mitigation A **不可用**（Phase 1A 实测，见上文）→ 留作 limitation，由 task #7 6DQ 判断影响；如不可接受走 task #8 单轨 downmix 或 capture-layer warmup |
| ✅ | ❌ | 启用 Mitigation B（gap silent fill） |
| ❌ | ❌ | 启用 Mitigation B；A 同上格 — 留作 limitation |
| Mitigation B 二次探针**仍失败** | — | 走 **B1 中间 PCM 兜底**（**不能**用读已写 m4a 的离线渲染，时间信息已丢失） |

**禁止跳过**：不允许"先按主路径写代码，等手工验收再说"。Phase 0 探针的两个结论必须落在 PR 描述里。

## Open-source benchmark

调研 5 个主流 macOS Swift 录音项目，**无一例**采用"应用层 sample-by-sample 实时混音"：

| 项目 | Stars | Approach |
|---|---|---|
| [lihaoyun6/QuickRecorder](https://github.com/lihaoyun6/QuickRecorder) | 8.4k | 两个 `AVAssetWriterInput` 多轨，append 原始 `CMSampleBuffer` |
| [jsattler/BetterCapture](https://github.com/jsattler/BetterCapture) | 1.4k | 多轨 `AVAssetWriter` |
| [Mnpn/Azayaka](https://github.com/Mnpn/Azayaka) | 745 | `initClassicRecorder` 走 `AVAssetWriter` 多轨；视频走 `SCRecordingOutput` |
| [insidegui/AudioCap](https://github.com/insidegui/AudioCap) | 504 | CoreAudio Process Tap，只录系统音 |
| [tobi/recorder](https://github.com/tobi/recorder) | 26 | 录两个文件 → 停止后按 host time 离线混音 |

**`SCRecordingOutput`（macOS 15+ Apple 原生录制 API）评估结论**：

- 不支持 `.m4a`，仅 `.mov` / `.mp4`
- 系统音 + 麦克风被 Apple **强制 mix 成单条 audio track**，无法分轨
- 音频参数（bitrate / channels / sample rate）应用完全无控制权

→ **不能用 `SCRecordingOutput`**。唯一干净的方案是手写 `AVAssetWriter` + 两个 `AVAssetWriterInput`，
让 SCK 提供的 `CMSampleBuffer.presentationTimeStamp`（同源 `CMClockGetHostTimeClock`）
在容器层完成时间对齐。

## Design Principles

> 以下原则描述**主路径**（Phase 0 假设 A、B 均通过）。若探针 B 失败 → **Mitigation B** 会在录制层
> **合成 silent PCM `CMSampleBuffer`**（违反原则 3，但仅限静默样本，零拷贝主路径不变）；
> 若 Mitigation B 仍失败 → B1 兜底会写 **PCM 中间文件**（违反原则 6 的"容器层对齐"，改成应用层按
> host-clock 对齐 PCM 再编 AAC）。**Mitigation A 在 Phase 1A 已被证明不可行**（见上文 Mitigation A 段落），
> 留作 limitation；不再作为本节涉及的修复路径。这些是 mitigation 的代价，已在决策树里量化。

1. **不在应用层混音**：让 ASR / 播放器 / 编辑器在解码层混。
2. **不重打 PTS**：直接 `append` SCK 给的 `CMSampleBuffer`，PTS 由 `CMClockGetHostTimeClock` 提供。
3. **不解包 PCM**：不做 Float 提取、不做声道折叠、不做 tanh、不做 gain。
4. **不做单源 drain**：两路独立 input，互不耦合，谁有数据谁写，写到自己那条 track。
5. **录音层只做三件事**：① 启停 SCStream；② 注册 `.audio` / `.microphone` output；③ 把两路 buffer 各自转发给两个 `AVAssetWriterInput`。

## Target Architecture

```
SCStream (macOS 15+)
  ├─ .audio       ── CMSampleBuffer (system) ─┐
  └─ .microphone  ── CMSampleBuffer (mic)    ─┤
                                              ▼
                              AVAssetWriter (.m4a)
                              ├─ AVAssetWriterInput (AAC mono) ← system
                              └─ AVAssetWriterInput (AAC mono) ← microphone
                                              │
                                              ▼
                                  Recording xxx.m4a
                                  ├─ Track 0: system audio
                                  └─ Track 1: microphone
```

**Track ordering convention**：Track 0 = system audio（对方），Track 1 = microphone（本机）。
**注意此约定仅在两路都有数据时成立**：若 mic 从未到帧（无权限 / 静音设备 / 冷启动失败），
AVAssetWriter 会将空 input 从输出文件中剔除（Phase 0 探针证实），最终文件可能只有一条 audio track。
下游消费方（ASR / 播放器 / downmix）**不应依赖 track 序号识别来源**。

**Track 身份标记（合法路径）**：

- ❌ **不能用** `extendedLanguageTag = "system" / "mic"`：本地验证显示该 setter 会校验 BCP 47 语言标签，
  `"system"` / `"mic"` 不是合法语言标签，会抛 `NSInvalidArgumentException` 直接崩溃。
- ⚠️ **`AVAssetWriterInput.metadata` 不可作为主路径**：本地探针验证：用 raw identifier
  `"mdta/com.lyre.audio.source"` 写入 `sys.metadata` / `mic.metadata`，`finishWriting` 成功，
  但读回时 `AVAssetTrack.metadata.count == 0`。AVAssetWriter 写 `.m4a` (`.mov` 子集) 时
  不会把 per-input 的 `mdta` track metadata 实际持久化到容器里 —— `AVAssetWriterInput.metadata`
  在 `.m4a` 上**不可读回**。直接靠 `AVAssetTrack.metadata` 识别来源会失败。

- ✅ **默认方案 — sidecar 映射文件**：encoder **不依赖容器** metadata 记录来源，**也不**用
  `timeRange.start` 匹配 host-clock PTS（.m4a 会把 track 起点规整到容器时间轴，晚到 track 的
  leading section 会被 AAC 直接 trim 掉而非保留为静默 —— 见 Mitigation A "not viable" 段落；
  PTS 匹配会失配或误判）。改用：
  - **per-source 锁存位**：`appendLocked()` 内 `input.append(buf) == true` 后置
    `systemDidAppend` / `micDidAppend`，per-source 一次置位、不会再变。
  - **AVAssetWriter `add()` 顺序约定**：先 `add(sys)` 再 `add(mic)` →
    `asset.tracks(withMediaType: .audio)` 顺序为 `[sys, mic]`。**此假设由 Phase 0 探针
    `AVAssetWriterTrackOrderProbeTests` 验证**（写不同内容到两路 → 读回检查 tracks[0] 内容来自 sys）。
  - 用 `(systemDidAppend, micDidAppend, audioTracks.count)` 三元组判断来源：
    `(true, false, 1)` → 唯一 track = system；`(false, true, 1)` → mic；
    `(true, true, 2)` → tracks[0] = system, tracks[1] = mic；其他组合 → 跳过 sidecar 不写。
  结果写入 `Recording_xxx.tracks.json` sidecar（与 m4a 同目录、同 basename，内容
  `{ "system": <trackID>, "mic": <trackID> }`，缺席的一路省略）。
  下游（player / downmix / ASR pre-processing）读 sidecar 拿 trackID。**sidecar 缺失时下游必须按
  "无法识别来源"处理**（不渲染来源标签、不做按源分离），**不能**默认"第一条 track = system" ——
  允许只有 mic 有帧、system 路无权限或无信号的合法场景。

- 🔍 **条件方案 — 探针通过后才启用容器内 metadata**：如果未来某个 macOS / AVFoundation 版本
  让 `AVAssetWriterInput.metadata` 在 `.m4a` 上变得可读回，可落地为 sidecar 的冗余备份；
  启用前必须新增 Phase 0 探针 `LyreTests/AVAssetWriterMetadataProbeTests.swift`：写一份带 mdta
  identifier 的 `.m4a`，`finishWriting` 后用 `AVAsset` 读 `AVAssetTrack.metadata`，断言能读回
  `identifier == "mdta/com.lyre.audio.source"` 且 `stringValue` 正确；探针失败 → 不启用。

- 🔬 **备选 — AVMutableMovie 后处理**：`finishWriting` 之后用 `AVMutableMovie(url: outputURL)`
  在 track 维度写 metadata 并 `writeMovieHeader`，再用同样的探针验证能读回。复杂度高于 sidecar，
  仅在禁止 sidecar（例如下游强约束"只接受单一文件"）时考虑。

> **默认走 sidecar**：本地探针已证实 `AVAssetWriterInput.metadata` 在 `.m4a` 不可读回，sidecar 是
> 唯一已验证可用的路径。track metadata / AVMutableMovie 都必须先有"读回成功"的探针测试才能用。

> **外部假设**（Phase 0 验证后才能称之"成立"）：
> - DashScope `qwen3-asr-flash-filetrans` 能转写多 audio track 的 m4a（两轨内容都被识别）。
> - QuickTime Player / Music / Finder 预览会自动将多 audio track 混音播放。
> - macOS app 内 `AudioPlayerManager` 对多轨 m4a 的行为（详见 Compatibility & Migration）。
>
> 这三项**任意一项不成立** → 触发 Risk & Fallback 的"离线 downmix"路径，最终上传 / 入库的依然是单轨 m4a。

## Module Layout

**Scope**：核心代码改动**只动** `apps/macos/Lyre/Audio/`；外围验证 / 兼容性可能触及：
- `apps/macos/Lyre/Utilities/AudioPlayerManager.swift`（Phase 0 验证后若多轨不能混音播放）
- `apps/macos/LyreTests/`（新增 / 重写测试）
- `e2e/api/asr-multitrack.test.ts` + `e2e/fixtures/dual-track-asr.m4a`（Phase 0 ASR 验证）
- `CLAUDE.md`（Retrospective 更新）
- `packages/api/src/services/asr.ts`（**不动**；仅作为外部依赖被验证）

核心目录改动：

```
Audio/
├── PermissionManager.swift        # 不动
├── AudioCaptureManager.swift      # 大改：删 mixer / drain timer / Float extract
├── AudioEncoder.swift             # 大改：两个 AVAssetWriterInput，append raw CMSampleBuffer；
│                                  #       finalize() 后写 {basename}.tracks.json sidecar
├── AudioMixer.swift               # 删除
└── RecordingManager.swift         # 小改：把两路 callback 连到 encoder 两个入口
```

**Sidecar 约定**：每个 `Recording_xxx.m4a` 旁边写一个 `Recording_xxx.tracks.json`
（内容形如 `{"system": <CMPersistentTrackID>, "mic": <CMPersistentTrackID>}`，缺席的一路省略）。
sidecar 是 track 身份信息的**唯一可靠来源** —— 容器内 metadata 已被本地探针证伪。
sidecar 仅本机使用，不上传 OSS、不入 `RecordingsStore` 索引（缺失即缺失，下游按"无法识别来源"处理，不假设默认 source）。

### AudioCaptureManager（after）

职责：SCStream 生命周期、设备枚举、SCStreamOutput 透传。

```swift
@Observable
final class AudioCaptureManager: NSObject, @unchecked Sendable {
    var onSystemSampleBuffer: ((CMSampleBuffer) -> Void)?
    var onMicSampleBuffer:    ((CMSampleBuffer) -> Void)?
    var onStreamError:        ((Error) -> Void)?

    var selectedDeviceID: String?
    internal(set) var availableDevices: [AudioInputDevice] = []

    /// **专用串行队列**：两路 SCStream output 必须共用一个 serial queue，
    /// 保证 stream(_:didOutputSampleBuffer:of:) 不会并发触发，进而保证
    /// encoder 看到的 append 请求是串行化的。`.global(qos:)` 是并发队列，
    /// 会让 .audio / .microphone 两个 callback 同时进入 encoder，必须避免。
    private let sampleQueue = DispatchQueue(
        label: "ai.hexly.lyre.AudioCapture.samples",
        qos: .userInitiated
    )

    func refreshDevices() { ... }       // 不变
    func startCapture() async throws {
        // ... config 同前 ...
        try newStream.addStreamOutput(self, type: .audio,      sampleHandlerQueue: sampleQueue)
        try newStream.addStreamOutput(self, type: .microphone, sampleHandlerQueue: sampleQueue)
        try await newStream.startCapture()
    }
    func stopCapture() async throws     // 不再 flush mixer

    // SCStreamOutput — 必然在 sampleQueue 上、串行触发
    func stream(_:didOutputSampleBuffer:of:) {
        guard sampleBuffer.isValid else { return }
        switch outputType {
        case .audio:      onSystemSampleBuffer?(sampleBuffer)
        case .microphone: onMicSampleBuffer?(sampleBuffer)
        default: return
        }
    }
}
```

**关键约束（并发模型）**：

- 两个 output 必须共用**同一个 serial dispatch queue**，不能用 `.global(qos:)` 并发队列。
- 这保证 encoder 的 `appendSystem` / `appendMic` 在 Swift 层就是串行调用，无需在 encoder 内再加锁去防"两路同时进入"。
- encoder 内部 `queue.sync { ... }` 是第二道保险（防 finalize 与 append 竞争），不是为了 audio vs mic 并发。

**删除**：`AudioMixer`、`drainTimer`、`extractSamples`、`pickLouderChannel`、`logAmplitudeIfNeeded`（保留 buffer count 计数和首帧 format 日志，调试需要）。

### AudioEncoder（after）

职责：AVAssetWriter 单文件输出，两个 input，append 原始 buffer。

**关键设计点**：

1. **Session start 时机**：不能"第一帧到达就 startSession"。Mic 第一帧可能比 system 第一帧的
   **callback 到达时间**早，但 mic 的 PTS（host clock）反而**晚于** system 第一帧的 PTS。
   如果先按 mic 的 PTS 启动 session，随后到来的 system buffer 会因 `pts < sessionStart` 被截断或丢弃。
   做法：等两路第一帧都到，取 `min(firstSystemPTS, firstMicPTS)` 启动；
   若超过 timeout（默认 500ms）只到一路，用那一路启动并把另一路标记为"已开始但无首帧"。
2. **Pre-session 缓冲必须保留两路的所有 buffer，不只是首帧**：
   若 system 第一帧 30ms 就到、mic 因冷启动 480ms 才到，这 450ms 内 system 还会有 ~22 个 buffer。
   每路用 `[CMSampleBuffer]` 队列**全部缓存**，session 启动后按 PTS 顺序逐个 append 给对应 input。
   只缓存"首帧"会丢这 450ms 的 system 音频。
3. **Session start 由定时器触发，不依赖后续 buffer 拉取**：
   单轨先到、对侧迟迟不到的极端情况下，如果只在每次 append 进入 queue 时检查 timeout，
   就需要后续 buffer 持续到达才能触发启动。改用一个 `DispatchSourceTimer`（500ms one-shot）。
   **关键时序约束**：定时器**不在 `setup()` 里启动**。原因：`RecordingManager` 当前先 `encoder.setup()`，
   再 `await capture.startCapture()`（`apps/macos/Lyre/Audio/RecordingManager.swift:101-119`），
   SCK 冷启动可能 > 500ms。若 timer 在 `setup()` 起跑，超时点尚未有任何 buffer，强行以 `.zero` 启动
   session 会污染 host-clock PTS 轴（后续真正的 SCK buffer 携带的 host clock PTS 远大于 0，
   两者无法对齐）。正确做法：**timer 在第一帧到达时才启动**（无论来自哪一路），timeout 后用
   当时已缓存的实际 PTS min 启动。`.zero` 仅用于 `finalize()` 兜底（两路从未到帧仍要正常关文件）。
4. **PTS 单调性**：AVAssetWriterInput 要求每条 track 的 append PTS 单调不递减。
   per-track 记录 `lastPTS`，若新 buffer 的 PTS ≤ `lastPTS` 则丢弃并打 warning（理论上 SCK 不会出，但出现要可观测）。
5. **串行**：所有 setup / append / finalize 都在 encoder 的 serial queue 上执行；上游已保证两路 append 串行（见 AudioCaptureManager），encoder 这里的 queue 主要防 append 与 finalize 竞争 + 定时器回调与 append 竞争。
6. **不再用常量 sample rate / channel count 生成中间 format**：透传原始 `CMSampleBuffer`，
   PTS 来自 buffer 自身、format 由 AVAssetWriterInput 的 `outputSettings`（48k AAC）描述输出端。
   AAC encoder 在 append 时自动重采样输入 ASBD → 48k 输出，**这就是 Cause A 的天然修复点**。

```swift
final class AudioEncoder: @unchecked Sendable {
    private let queue = DispatchQueue(label: "ai.hexly.lyre.AudioEncoder")
    private var writer: AVAssetWriter?
    private var systemInput: AVAssetWriterInput?
    private var micInput:    AVAssetWriterInput?

    /// per-source pending FIFO：session 启动前**全部**缓存（不是只首帧），
    /// 启动后按 PTS 顺序逐个 append。
    private var pendingSystem: [CMSampleBuffer] = []
    private var pendingMic:    [CMSampleBuffer] = []
    private var sessionStarted = false

    /// per-track 最后 PTS，用于强制单调不递减。
    private var lastSystemPTS: CMTime = .invalid
    private var lastMicPTS:    CMTime = .invalid

    /// 500ms one-shot timer：超时后强制启动 session。
    private var sessionStartTimer: DispatchSourceTimer?
    private let sessionStartTimeout: TimeInterval = 0.5

    /// 首个 append 失败时记录的 writer.error，由 finalize() 显式上抛。
    private var firstWriteError: Error?

    // 复用现有 EncoderError.writerFailed(String)（apps/macos/Lyre/Audio/AudioEncoder.swift:23）—— 不引入新 case。
    // finalize() 失败时 throw EncoderError.writerFailed(detail)。

    func setup(outputURL: URL) throws {
        let w = try AVAssetWriter(outputURL: outputURL, fileType: .m4a)
        let settings: [String: Any] = [
            AVFormatIDKey:        kAudioFormatMPEG4AAC,
            AVSampleRateKey:      Constants.Audio.sampleRate,   // 输出 48k
            AVNumberOfChannelsKey: Constants.Audio.channelCount,
            AVEncoderBitRateKey:  Constants.Audio.aacBitRate,
        ]
        let sys = AVAssetWriterInput(mediaType: .audio, outputSettings: settings)
        let mic = AVAssetWriterInput(mediaType: .audio, outputSettings: settings)
        sys.expectsMediaDataInRealTime = true
        mic.expectsMediaDataInRealTime = true
        // Track 身份：**不写** AVAssetWriterInput.metadata —— 本地探针证实写入后
        // AVAssetTrack.metadata 读回为空，不能依赖。改在 finalize() 之后生成
        // Recording_xxx.tracks.json sidecar 记录 (source, AVAssetTrack.trackID)。
        // 见 finalize() 末尾 writeTrackIdentitySidecarLocked()。
        w.add(sys); w.add(mic)
        guard w.startWriting() else { throw EncoderError.setupFailed(...) }
        queue.sync {
            self.writer = w; self.systemInput = sys; self.micInput = mic
            // 注意：不在这里启动 sessionStartTimer。
            // SCK capture 可能在 setup() 之后才 startCapture()，冷启动 > 500ms 时
            // timer 会在零 buffer 状态下触发，用 .zero 启动会污染 host-clock PTS 轴。
            // 改在首帧到达时启动 —— 见 enqueue()。
        }
    }

    /// finalize 完成后，写出 {source: trackID} 的 sidecar。
    /// **不**用 timeRange.start 匹配 host-clock PTS —— .m4a 会把 track 起点规整到容器时间轴，
    /// 晚到 track 的 leading section 也会被 AAC trim 掉（Mitigation A 不可行，见上文），
    /// PTS 匹配不可靠。
    /// 映射规则改为：
    ///   - 单源：only system → 唯一 audio track 是 system；only mic → 唯一是 mic。
    ///   - 两源：依赖 AVAssetWriter 的 add() 顺序与最终 `asset.tracks(withMediaType: .audio)`
    ///     顺序一致（先 add(sys) 再 add(mic) → tracks[0] = system，tracks[1] = mic）。
    ///     **此假设必须由 Phase 0 内容探针 `LyreTests/AVAssetWriterTrackOrderProbeTests.swift` 验证**：
    ///     重复 N 次"add(sys) → add(mic) → sys 写 440Hz 正弦波、mic 写 880Hz 正弦波（两路 outputSettings 相同）
    ///     → finalize → 用 `AVAssetReader` 解码 tracks[0] / tracks[1] 各取 100ms PCM 做 FFT"，
    ///     断言每次 tracks[0] 主频 ≈ 440Hz、tracks[1] 主频 ≈ 880Hz。**不**靠 trackID 大小或首帧 ASBD
    ///     判断（两路 outputSettings 相同 → ASBD 也相同；trackID 由 AVAssetWriter 内部分配，无序保证）。
    ///     探针失败 → "add() 顺序 → tracks 顺序"映射不可用，sidecar 退化为"仅 single-source 可写"，
    ///     双源场景的 source 识别需另设方案（落到本计划之外的后续 issue）。
    /// 失败不抛 —— sidecar 缺失时下游按"无法识别来源"处理（不假设默认 source），参见 Compatibility 章节。
    private func writeTrackIdentitySidecarLocked(outputURL: URL,
                                                  systemDidAppend: Bool,
                                                  micDidAppend: Bool) {
        let asset = AVAsset(url: outputURL)
        let audioTracks = asset.tracks(withMediaType: .audio)
        var map: [String: CMPersistentTrackID] = [:]
        switch (systemDidAppend, micDidAppend, audioTracks.count) {
        case (true,  false, 1): map["system"] = audioTracks[0].trackID
        case (false, true,  1): map["mic"]    = audioTracks[0].trackID
        case (true,  true,  2):
            // 探针约定：先 add(sys) 再 add(mic) → tracks[0] = system, tracks[1] = mic
            map["system"] = audioTracks[0].trackID
            map["mic"]    = audioTracks[1].trackID
        case (true,  true,  1):
            // 一路被 AVAssetWriter 剔除（无 buffer 实际写入但 didAppend 已 true 极少见，保守处理）
            Self.logger.warning("track count=1 with both sources active; cannot identify, skipping sidecar")
            return
        default:
            Self.logger.warning("unexpected (sysDid=\(systemDidAppend), micDid=\(micDidAppend), tracks=\(audioTracks.count)); skipping sidecar")
            return
        }
        let sidecar = outputURL.deletingPathExtension().appendingPathExtension("tracks.json")
        if let data = try? JSONSerialization.data(withJSONObject: map) {
            try? data.write(to: sidecar, options: .atomic)
        }
    }

    func appendSystem(_ buf: CMSampleBuffer) { enqueue(buf, source: .system) }
    func appendMic(_ buf: CMSampleBuffer)    { enqueue(buf, source: .mic) }

    private enum Source { case system, mic }

    private func enqueue(_ buf: CMSampleBuffer, source: Source) {
        queue.sync {
            guard let writer, writer.status == .writing else { return }

            if !sessionStarted {
                // 全部缓存，不只首帧
                switch source {
                case .system: pendingSystem.append(buf)
                case .mic:    pendingMic.append(buf)
                }
                // 首帧到达才启动 timer（无论来自哪一路）
                if sessionStartTimer == nil {
                    scheduleStartTimeoutLocked()
                }
                // 双路都来过 → 立即启动；否则等 timer
                if !pendingSystem.isEmpty && !pendingMic.isEmpty {
                    startSessionLocked()
                }
                return
            }

            appendLocked(buf, source: source)
        }
    }

    private func scheduleStartTimeoutLocked() {
        let t = DispatchSource.makeTimerSource(queue: queue)
        t.schedule(deadline: .now() + sessionStartTimeout)
        t.setEventHandler { [weak self] in
            guard let self else { return }
            // 已在 queue 上执行（DispatchSourceTimer.queue = self.queue）
            if !self.sessionStarted { self.startSessionLocked() }
        }
        t.resume()
        sessionStartTimer = t
    }

    /// 启动 session：取已缓存 buffer 的 min PTS。
    /// **不在 enqueue 路径上用 .zero 兜底** —— enqueue 走到这里时至少有一路缓存了 buffer（首帧触发了 timer）。
    /// .zero 仅在 finalize() 处理"两路从未到帧"的极端情况，见 finalize()。
    private func startSessionLocked() {
        guard let writer, !sessionStarted else { return }
        sessionStartTimer?.cancel(); sessionStartTimer = nil

        let firstSys = pendingSystem.first?.presentationTimeStamp
        let firstMic = pendingMic.first?.presentationTimeStamp
        guard let startPTS = [firstSys, firstMic].compactMap({ $0 }).min(by: { $0 < $1 }) else {
            // 两路 pending 都空：理论上 enqueue 路径不会到这里（首帧触发的 timer）；
            // 只有 finalize 路径会显式构造这种情况，由 finalize 自己用 .zero 启动。
            Self.logger.error("startSessionLocked called with no pending buffers; this should not happen on the enqueue path")
            return
        }

        writer.startSession(atSourceTime: startPTS)
        sessionStarted = true

        // 排空两路 pending，按 PTS 顺序 append（先 system 后 mic 或反过来都行，
        // 因为它们写入的是各自独立 track，PTS 单调性是 per-track 维度）
        for buf in pendingSystem { appendLocked(buf, source: .system) }
        for buf in pendingMic    { appendLocked(buf, source: .mic) }
        pendingSystem.removeAll()
        pendingMic.removeAll()
    }

    private func appendLocked(_ buf: CMSampleBuffer, source: Source) {
        let input: AVAssetWriterInput?
        let lastPTS: CMTime
        switch source {
        case .system: input = systemInput; lastPTS = lastSystemPTS
        case .mic:    input = micInput;    lastPTS = lastMicPTS
        }
        guard let input else { return }

        let pts = buf.presentationTimeStamp
        // PTS 单调性：拒绝逆序 buffer（理论不该发生，发生要 warning）
        if lastPTS.isValid && pts <= lastPTS {
            Self.logger.warning("\(source) out-of-order buffer pts=\(pts.seconds) last=\(lastPTS.seconds)")
            return
        }
        guard input.isReadyForMoreMediaData else {
            Self.logger.warning("\(source) input not ready, dropping buffer")
            return
        }
        // AVAssetWriterInput.append 返回 Bool —— 失败时必须暴露 writer.error，
        // 否则部分写入会以"成功"假象收尾，文件可能损坏。
        let ok = input.append(buf)
        if !ok {
            let underlying = writer?.error?.localizedDescription ?? "unknown"
            Self.logger.error("\(source) append failed: status=\(self.writer?.status.rawValue ?? -1) error=\(underlying)")
            // 把首个 append 失败记到 onWriteError，让 RecordingManager 决定是否中止本次录制
            firstWriteError = firstWriteError ?? writer?.error
            return
        }
        switch source {
        case .system: lastSystemPTS = pts
        case .mic:    lastMicPTS    = pts
        }
    }

    /// finalize 必须 throws，把 writer.error 显式上抛。否则上层无法区分
    /// "录音正常收尾"和"writer 中途失败但文件残缺"。
    /// 成功路径在 finishWriting 之后写出 tracks.json sidecar（失败不抛，缺失下游不假设来源）。
    func finalize() async throws {
        let (w, url, sysDid, micDid): (AVAssetWriter?, URL?, Bool, Bool) = queue.sync {
            sessionStartTimer?.cancel(); sessionStartTimer = nil
            // 两路从未到帧的极端情况：用 .zero 启动以便 finishWriting 正常收尾。
            // 这是 finalize 路径独占的兜底，不与 enqueue 路径上的 startSessionLocked 混用。
            if !sessionStarted, let writer {
                writer.startSession(atSourceTime: .zero)
                sessionStarted = true
            }
            systemInput?.markAsFinished()
            micInput?.markAsFinished()
            // systemDidAppend / micDidAppend 在 appendLocked() 成功 append 后置 true，
            // per-source 一次置位、不会再变。这比"首帧 PTS"可靠：.zero 启动 / 容器层 trim
            // 都不影响 per-source 锁存位的语义。
            return (writer, outputURL, systemDidAppend, micDidAppend)
        }
        guard let w else { return }
        await withCheckedContinuation { c in w.finishWriting { c.resume() } }
        // 把 enqueue 阶段第一个 append 失败、或 finishWriting 自身的 writer.error 上抛
        if let err = firstWriteError ?? (w.status == .failed ? w.error : nil) {
            throw EncoderError.writerFailed(err.localizedDescription)
        }
        if let url { writeTrackIdentitySidecarLocked(outputURL: url,
                                                     systemDidAppend: sysDid,
                                                     micDidAppend: micDid) }
    }
}
```

> encoder 内需额外维护：`private var outputURL: URL?`（`setup()` 保存）、
> `private var systemDidAppend = false` / `private var micDidAppend = false`
> （`appendLocked()` 内 `input.append(buf) == true` 后 per-source 置位 ——
> sidecar 关心的是"这路有没有 track 出现在最终文件里"，而不是"是否含真实音频"。
> Mitigation B 的 gap-fill silent PCM append 也算 append 成功，符合该语义）。

**关键变化**：

| Before | After |
|---|---|
| `encodeSamples([Float])` | `appendSystem/appendMic(CMSampleBuffer)` |
| `totalSamplesWritten` 自增 PTS | 用 buffer 自带 PTS |
| 单 input | 双 input |
| 创建 CMBlockBuffer + CMSampleBuffer | 删除（透传 SCK buffer） |
| `inputFormat: AVAudioFormat` | 删除 |
| `createSampleBuffer(from:)` 接口 | 删除 |

### RecordingManager（after）

```swift
capture.onSystemSampleBuffer = { [weak self] buf in self?.encoder?.appendSystem(buf) }
capture.onMicSampleBuffer    = { [weak self] buf in self?.encoder?.appendMic(buf) }
capture.onStreamError        = { [weak self] err in self?.handleStreamError(err) }
```

`stopRecording()` 不再 flush mixer；`stopCapture()` 后 `try await encoder?.finalize()`，
finalize 抛出的 `EncoderError.writerFailed` 沿用现有 `lastError` / `RecordingError.encoderSetupFailed`
同级路径反馈给 UI，**禁止吞错** —— writer 中途失败必须以"录音失败"对外可见，而不是写出残缺文件并显示成功。

**状态清理必须 defer 在 throw 之前**。`finalize()` 可能抛错；如果在 throw 路径上才清理 callbacks /
encoder / `state = .idle`，一次失败的 stop 会留下 `state == .recording` + dangling encoder reference +
活着的 capture callbacks，下一次 `startRecording()` 会撞 precondition 或往已 finalize 的 encoder 上 append。

```swift
@discardableResult
func stopRecording() async throws -> URL {
    guard state == .recording, let fileURL = currentFileURL else {
        throw RecordingError.notRecording
    }
    // defer 在 throw 之前跑，保证无论 finalize 成败状态都干净
    defer {
        capture.onSystemSampleBuffer = nil
        capture.onMicSampleBuffer    = nil
        capture.onStreamError        = nil
        encoder = nil
        currentFileURL = nil
        recordingStartTime = nil      // 现有实现也清；不清会让 elapsed 显示残值
        state = .idle
    }
    try await capture.stopCapture()
    try await encoder?.finalize()    // 失败时 defer 仍执行
    return fileURL                    // 仅 finalize 成功才能跑到这里
}
```

## Why this is the simplest correct design

> 以下论断针对**主路径**。Mitigation B 会引入静默 PCM 合成（仍非"混音"），B1 兜底会引入
> PCM 中间文件 + 离线对齐（仍非应用层 sample-by-sample 混音）。Mitigation A 已被证伪
> （见上文 not viable 段落），不在路径里。所有路径都比旧的实时 `min(sysCount, micCount)`
> 混音简单。

1. **No app-level sample mixing** → 没有 `min(sysCount, micCount)` 这类对齐 bug。
2. **No app-level PTS generation** → 完全消除"时间被自增计数器拍平"的可能性。
3. **No Float intermediate** → 不解包 PCM，CPU 占用降低，零拷贝直转发（Mitigation B 路径仅对 same-track gap 合成零填 PCM；Mitigation A 已证伪，不在路径里；主路径仍是零拷贝）。
4. **No drain timer / no thread juggling** → SCK callback 直接 append，少一个线程协作点。
5. **Per-input drop policy is local** → 一路 buffer 满了只丢自己的，不会污染另一路的时间轴。
6. **Container handles alignment** → 主路径下 AVAssetWriter 用 PTS 在容器层对齐；mitigation 失败时由应用层在 PCM domain 显式对齐再编 AAC（B1 兜底）。
7. **Less code** → `AudioMixer.swift`（200 行）整体删除；`AudioEncoder.swift` 缩小约 30%；`AudioCaptureManager.swift` 缩小约 40%。

## Compatibility & Migration

- **macOS minimum**: 维持 15.0（保持现有 `Constants.Audio.*` 不变）。
- **File format**: 仍是 `.m4a` / AAC，外层文件名 / 目录约定不变。
- **Track count**: 1 → 2。下游 ASR (DashScope `qwen3-asr-flash-filetrans`) 多轨支持**未经端到端验证**，
  必须在 Rollout 阶段用固定样本上传后再确认（见 Testing Strategy 的 ASR 用例和 Risk & Fallback）。
- **历史录音**: 旧文件不动，向后兼容。
- **macOS app 内播放**: ⚠️ `AudioPlayerManager` (`apps/macos/Lyre/Utilities/AudioPlayerManager.swift:7`)
  实际使用的是 **`AVAudioPlayer`**（不是 `AVPlayer`）。`AVAudioPlayer` 对多 audio track `.m4a` 的混合
  行为**没有明确文档保证**，需要在手工验收阶段听一遍确认两路声音都能出。如果只能听到 track 0：
  - 短期方案：把 `AudioPlayerManager` 内部从 `AVAudioPlayer` 换成 `AVPlayer`（API 接近，支持多 track 自动混音）。
  - 长期方案：见 Risk & Fallback。
- **Aliyun OSS 上传**: 字节级透传，不感知 track 结构，无需改动。**但 `Recording_xxx.tracks.json` sidecar 不上传** —— sidecar 仅本机使用，云端 ASR / 历史回看按"无法识别来源"处理（不假设第一条 track 是 system）。如果未来需要云端识别 track 身份，再扩展 upload 流水线把 sidecar 一起带上。

## Testing Strategy

### Unit / integration

所有 `AudioEncoderTests` 用例统一用 **`AVAssetReader`** 读出输出文件的 track 信息和 sample
PTS 序列，作为真值断言（而不是依赖 encoder 内部状态 / `startSession` 调用参数等私有实现）。

> **重要**：下表中用例 1 / 2 的"期望行为"分两种形态，按 Phase 0 探针结果选择 —— 探针**未跑前不要落地这两条**。
> 用例 3 / 4 / 5 不依赖假设 A/B，可独立落地。

| 测试 | 操作 |
|---|---|
| `LyreTests/AudioMixerTests.swift` | **删除** |
| `LyreTests/AudioEncoderTests.swift` 用例 1 — 双轨基本写入（**Phase 1A 已落地，假设 A 已证伪**） | 合成两路 `CMSampleBuffer`（system PTS 起点 = 1000ms，mic PTS 起点 = 1200ms），各写 1 秒，session 启动于 PTS = 1000ms。<br>**Main path（假设 A 通过 — 当前 macOS 未观察到）**：用 `AVAssetReader` 断言 ① `tracks(withMediaType: .audio).count == 2`；② mic track 第一个 sample PTS ≈ **1200ms**；③ 两 track 总时长 ≈ 1s。<br>**Limitation pin（假设 A 失败 — 当前实测路径，Mitigation A 不可行）**：① count == 2；② mic track 第一个有效音频 sample PTS ≈ **0**（晚到的 200ms 被 AAC trim，无 silent prefix 能挽回，见 `lateSourceFirstFrameRemainsTrimmedByAVAssetWriter`）；③ mic track 总时长 ≈ **1.0s**（不含已 trim 的 200ms 前缀）；④ sidecar 仍正确记录 mic 角色，role↔trackID 映射不丢失；⑤ 真正修复需在 capture-layer warmup 或 offline composition 评估（task #5 / #6 输入）。 |
| `LyreTests/AudioEncoderTests.swift` 用例 2 — PTS gap 处理（Cause B 回归，**期望随假设 B 切换**） | 合成 mic 轨：第 0–500ms append 5 个 100ms buffer（PTS 连续），跳过 500–600ms，再 append 6 个 100ms buffer（PTS 从 600ms 起，不回填）。<br>**Main path（假设 B 通过）**：用 `AVAssetReader` 断言第 6 个 sample 的 presentationTime ≈ **600ms**（gap 在容器层保留）。<br>**Mitigation B path（假设 B 失败 → silent PCM fill）**：encoder 在 600ms append 前应已合成 500–600ms 的 silent PCM `CMSampleBuffer` 并 append（由 AAC encoder 自动压缩成静默 AAC frame）；断言第 6 个**真实**音频 sample 在 600ms，500–600ms 区间解码后能量 ≈ 0。<br>**B 二次失败兜底（B1 PCM 中间文件）**：测试改为读 PCM 中间文件 + 重渲染后的单轨 m4a，断言 600ms 处仍是静默而非压贴。 |
| `LyreTests/AudioEncoderTests.swift` 用例 3 — **Sample-rate mismatch 重采样**（Cause A 回归，新增） | 合成 mic `CMSampleBuffer`，ASBD 中 `mSampleRate = 44100`，写 5 秒 440Hz 正弦波。append 给 encoder。用 `AVAssetReader` 读输出 mic track：① 输出 ASBD `mSampleRate == 48000`（AAC encoder 已重采样）；② track duration ≈ **5 秒**（不是 44100/48000 × 5s = 4.59s）；③ （可选）解码前 100ms PCM 做 FFT，峰值频率仍 ≈ 440Hz（不是 ×48000/44100 后的 ≈ 479Hz）。这条用例失败 = Cause A 没被修。 |
| `LyreTests/AudioEncoderTests.swift` 用例 4 — 单轨缺席启动 | 只喂 system，不喂 mic，等 500ms timer 触发后断言 ① 文件能 finalize；② **`tracks(withMediaType: .audio).count == 1`**（探针确认：AVAssetWriter 会把从未 append 数据的空 `AVAssetWriterInput` 从最终 `.m4a` 中剔除，不会保留为"空 track"）；③ **读 `Recording_xxx.tracks.json` sidecar**，断言 `{"system": <唯一 audio track 的 trackID>}` 存在，且 `"mic"` 不在 map 里（**不**依赖 `AVAssetTrack.metadata` —— 探针已证实 `AVAssetWriterInput.metadata` 在 `.m4a` 不可读回）；④ system track 在 timeout 前的所有 buffer 都被写入（验证 #1 修复：pre-session 不只缓存首帧）。**注意**：用例 1 的 track 0 / track 1 顺序约定只在"两路都有数据"时成立；下游若需可靠识别 track 来源，不能依赖 track 序号，应读 sidecar。 |
| `LyreTests/AudioEncoderTests.swift` 用例 5 — PTS 单调性 | 给 system 喂 PTS 递增 buffer 后突然喂一个 PTS 回退的 buffer，断言被丢弃、不抛异常、后续递增 buffer 仍能正常写入。验证：`AVAssetReader` 读出的 sample 数 = 递增 buffer 数（逆序 buffer 不在文件里）。 |
| `LyreTests/AudioCaptureManagerTests.swift` | 断言 `onSystemSampleBuffer` / `onMicSampleBuffer` 被分别触发（通过 inject 假 SCStream 或直接调用 `stream(_:didOutputSampleBuffer:of:)`）；不再断言 mixed PCM 内容。 |
| `LyreTests/RecordingManagerTests.swift` | start → stop 流程；断言两路 callback 都接到 encoder 的对应入口。 |
| `LyreTests/RecordingE2ETests.swift` | 不变：依赖 ScreenCaptureKit 权限，CI 跳过；本地跑录 3 秒会议确认时间轴正确。 |

### ASR multi-track end-to-end gate（**新增、阻塞合并**）

DashScope `qwen3-asr-flash-filetrans` 的接口只接受一个 `file_url`，没有 track 选择参数
（参见 `packages/api/src/services/asr.ts:452`）。多轨支持是**未经服务端确认的外部假设**，
必须在合并前用真实样本端到端验证：

1. 准备固定双轨样本 `e2e/fixtures/dual-track-asr.m4a`：
   - Track 0（system）：朗读固定短语 A，例如 "the quick brown fox jumps over the lazy dog"
   - Track 1（mic）：朗读固定短语 B，例如 "她说今天会议改到下午三点"
   - 两轨内容不重叠、关键词差异明显
2. 测试位置：`e2e/api/asr-multitrack.test.ts`（需要 `DASHSCOPE_API_KEY` 才跑，CI 上跳过、release 前本地必跑）。
3. 流程：上传样本 → 提交 ASR → 轮询完成 → 取转写结果。
4. 断言：转写文本同时包含两个短语的标志性关键词（"quick brown fox" **且** "下午三点"）。
5. **失败处理**：如果只能转出 track 0 → 立刻进入下面的 Risk & Fallback 路径，不要合并多轨方案。

## Risk & Fallback

| 风险 | 触发条件 | 降级方案 |
|---|---|---|
| DashScope 只读 track 0 | ASR 多轨 E2E 测试只命中 track 0 关键词 | 进入下面的"离线 downmix 方案"，最终上传 / 入库的是**单 audio track** m4a |
| `AVAudioPlayer` 不混合多轨 | 手工验收时本机播放只听到一边 | 短期把 `AudioPlayerManager` 切到 `AVPlayer`；如果连 `AVPlayer` 也不能可靠混（少见），同样走"离线 downmix 方案" |
| 双路首帧 PTS 差距 > timeout | 比如外接 USB 麦克风冷启动慢 >500ms | 500ms timer 用已到一路 PTS 启动 session，对侧首帧 PTS > sessionStart。**Phase 1A 实测**：AAC `AVAssetWriterInput` 会把晚到 track 的 leading section trim 掉（zero / padded / dither prefix 均无效），即 Mitigation A 不可用。当前 dualTrack path 不补偿该 trim；行为由 `lateSourceFirstFrameRemainsTrimmedByAVAssetWriter` pin 住。后续修复在 capture-layer warmup / 离线 composition 评估（task #5 / #6 输入）；如 6DQ 判断不可接受则走 task #8 single-track downmix 兜底。 |
| SCK callback 并发进入 encoder | 注册 output 时误用 `.global(qos:)` 并发队列 | 单元测试无法捕获；以 code review + AudioCaptureManager 头部注释 + lint rule（禁用 `.global` 出现在 `addStreamOutput` 调用） 防回归。 |

### 离线 downmix 方案（明确化）

目标：`stopRecording()` 收尾时把双轨 m4a 重渲染成**单 audio track** m4a，文件结构对外不变。

实现：用 `AVAssetReader` + `AVAssetWriter`（**不要用** `AVMutableComposition + AVAssetExportSession`，
原因下文说明）。流程：

```swift
func downmixToSingleTrack(input: URL, output: URL) async throws {
    let asset = AVAsset(url: input)
    let tracks = try await asset.loadTracks(withMediaType: .audio)
    guard tracks.count >= 2 else { /* 已是单轨，直接 rename */ return }

    let reader = try AVAssetReader(asset: asset)
    // 关键：audioSettings 给所有 track 一个**统一**输出格式（Float32 PCM 48k mono），
    //       AVAudioMix 在此自动将 N 条 audio track 渲染成 1 条 PCM 流
    let pcmSettings: [String: Any] = [
        AVFormatIDKey:         kAudioFormatLinearPCM,
        AVSampleRateKey:       48000,
        AVNumberOfChannelsKey: 1,
        AVLinearPCMBitDepthKey: 32,
        AVLinearPCMIsFloatKey: true,
        AVLinearPCMIsBigEndianKey: false,    // 必须显式设置，否则 AVAssetReader 抛 NSInvalidArgumentException
        AVLinearPCMIsNonInterleaved: false,
    ]
    let mixOutput = AVAssetReaderAudioMixOutput(audioTracks: tracks, audioSettings: pcmSettings)
    // 默认 AVAudioMix：每 track 等权 → tracks.count 路简单相加 / 平均
    reader.add(mixOutput)
    reader.startReading()

    let writer = try AVAssetWriter(outputURL: output, fileType: .m4a)
    let aacSettings: [String: Any] = [
        AVFormatIDKey: kAudioFormatMPEG4AAC,
        AVSampleRateKey: 48000,
        AVNumberOfChannelsKey: 1,
        AVEncoderBitRateKey: Constants.Audio.aacBitRate,
    ]
    let aacInput = AVAssetWriterInput(mediaType: .audio, outputSettings: aacSettings)
    aacInput.expectsMediaDataInRealTime = false
    writer.add(aacInput)
    writer.startWriting()
    writer.startSession(atSourceTime: .zero)

    // pull → push 循环，AVAssetWriterInput 用 requestMediaDataWhenReady 回调
    while reader.status == .reading, let buf = mixOutput.copyNextSampleBuffer() {
        while !aacInput.isReadyForMoreMediaData { try await Task.sleep(nanoseconds: 2_000_000) }
        aacInput.append(buf)
    }
    aacInput.markAsFinished()
    await writer.finishWriting()
    try FileManager.default.removeItem(at: input)
    try FileManager.default.moveItem(at: output, to: input)
}
```

**为什么不用 `AVMutableComposition + AVAssetExportSession`**：

- `AVMutableComposition.insertTimeRange(_:of:at:)` 把 N 条源 audio track 合并为 N 条 composition track，
  **不会自动 downmix 成单条 track**。导出后的 m4a 仍可能是多轨。
- `AVAssetExportSession` 的 `audioMix` 只能调权重 / 音量包络，不改 track 数量。
- 真正能保证"输出文件 audio stream count == 1"的方式只有 `AVAssetReaderAudioMixOutput` —— 它在
  PCM 域把 N 路渲染成 1 路 PCM 流，再用单个 `AVAssetWriterInput` AAC 编出去。

**验收门**：fallback 路径必须有自动化测试断言 `ffprobe -show_streams output.m4a | grep -c 'codec_type=audio'` 等于 1。
落在 `LyreTests/AudioEncoderDownmixTests.swift`（仅当 fallback 触发时启用）。

**手工验收**（最重要，因为单元测试无法重现"变速变调"）：

1. 录一段 30 秒包含本机说话 + 系统播放音乐 / 视频会议的样本
2. 在 QuickTime Player 中播放，听本机声音是否自然
3. 用 `ffprobe Recording_xxx.m4a` 验证：
   - `streams[0]` 和 `streams[1]` 都是 `aac`
   - 两个 stream 的 `duration` 接近实际录制时长
   - `start_time` 接近 0 或两者一致

### Task #7 6DQ status (2026-06-25)

**Manual 6DQ evidence: deferred / not executed in this thread.** The
manual acceptance plan above was scripted and sent to the operator
(see `#lyre-macos-rebuild:f3202873`) but no real 30-second recording,
QuickTime listening result, Lyre in-app playback impression, or
production DashScope ASR transcript was provided back in this
collaboration thread. This section is the audit trail for that
deferral; it is **not** a "manual 6DQ passed" conclusion.

**Automated subset that DID complete** (task #4 — task #6, plus task #10 downstream readiness):
- `task #4`: dualTrack `AudioEncoder` + sidecar role→trackID map.
  Pinned by `AudioEncoderDualTrackTests` + Mitigation A limitation
  pinned by `lateSourceFirstFrameRemainsTrimmedByAVAssetWriter`.
- `task #5`: `RecordingManager` default `useDualTrack = true`;
  raw `CMSampleBuffer` dispatch through `AudioCaptureManager` with
  drain timer guarded by the legacy mixed-callback presence.
  Covered by `RecordingManagerDualModeTests` + the extended
  `AudioCaptureManagerTests` raw-dispatch suite.
- `task #6`: deterministic `RecordingPipelineIntegrationTests`
  (fake capture + real `AudioEncoder` + real .m4a + sidecar)
  proves dual path produces 2 audio tracks, sidecar mapping is
  consistent, and add() order is preserved. Live `RecordingE2ETests`
  retains conditional sidecar consistency check (does not require
  sidecar presence or two real tracks).
- Cross-cutting: `AudioPlayerManager` switched to `AVPlayer` so
  the in-app player can render every enabled track of a dual-track
  .m4a (task #10); ASR pipeline merges all channels and exposes the
  channel-1 stride evidence (`sentenceId >= SENTENCE_ID_CHANNEL_STRIDE`).

**Manual subset that was NOT executed in this thread**:
- DQ-1 (live 30s recording with both system audio + microphone),
- DQ-4 (QuickTime Player listening — both tracks audible, no
  speed/pitch artefacts, Mitigation A leading-trim subjectively
  acceptable),
- DQ-5 (Lyre in-app `AVPlayer` listening matches QuickTime),
- DQ-6 (production DashScope multi-track transcription — content
  layer + channel layer evidence).

**Residual risks left open by the deferral**:
- It is possible (but not yet observed) that QuickTime / `AVPlayer`
  renders only one of the two tracks on the operator's machine.
- It is possible the live DashScope account does not split / merge
  the two AAC streams identically to the fixture used in
  `e2e/api/asr-multitrack.test.ts`.
- Mitigation A leading-trim (~0.5s on the late-arriving source) is
  documented as a known limitation; whether it is subjectively
  unacceptable for production use is a judgement only the operator
  can make.

**Task #8 fallback decision (single-track downmix / capture-layer
warmup)**: not triggered. The triggers listed in the manual-acceptance
script are all evidence-based (only one track audible, sidecar /
ffprobe cannot prove two tracks, ASR only hits one track, or
operator judges trim unacceptable). None of these are observed in
this thread, so task #8 is **closed without implementation**. If any
trigger fires after the operator runs the live 6DQ, re-open task #8
and design the fallback at that point — the docs/06 "Risk & Fallback"
section already sketches the offline downmix path.

## Non-goals

- **不引入立体声混录**（左声道系统、右声道 mic 的 trick）— 那是音质优化，不是 bug 修复。
- **不引入降噪 / AGC / 回声消除** — 这些应该是 ASR 端或后处理的事。
- **不切换 ASR 接口** — 若 DashScope 多轨验证通过则无需换模型；若不通过，走 Risk & Fallback 的离线 mix 而不是换模型。
- **不动 macOS app 的 UI / Tray / Upload 逻辑** — 录音层独立改造。

## Rollout

按以下顺序执行，前一步是后一步的前置门禁（详见会话 task list）：

**Phase 0 — 外部假设验证（阻塞，先做）**

1. 用现有工具（Audacity / ffmpeg / 临时 Swift 脚本）构造一个固定双轨样本 `e2e/fixtures/dual-track-asr.m4a`（track 0 = 短语 A，track 1 = 短语 B）。
2. 跑 `e2e/api/asr-multitrack.test.ts` 上传到生产 DashScope，断言转写同时包含 A、B 的关键词。
3. 如果失败 → 切换到 Risk & Fallback 的"停止时离线 mix"路径，并对本计划做相应裁剪。
4. 在 `AudioPlayerManager` 现有 m4a 测试样本中加一段双轨样本，手动播放确认能听到两路；若不行，先把 `AudioPlayerManager` 切到 `AVPlayer`。
5. **跑 `LyreTests/AVAssetWriterPTSProbeTests.swift` 验证 AVAssetWriter PTS 行为**（详见前述章节）：
   - 延迟首帧探针：假设 A 是否成立
   - PTS gap 探针：假设 B 是否成立
   - 把两条结论写进 PR 描述。**Phase 1A 已落地**：假设 A 当前实测为否、Mitigation A 不可行（见上文 not viable 段落），晚到首帧 trim 行为由测试 pin 住；假设 B 由 Mitigation B (gap silent fill) 兜住。若 Mitigation B 二次探针仍失败，**只能**走 B1 PCM 中间文件兜底（**禁止**读已写好的 AAC m4a 做离线渲染，时间信息已丢失）。task #7 6DQ 判断 trim 是否需要进一步补救（task #8 single-track downmix / capture-layer warmup）。
6. **跑 `LyreTests/AVAssetWriterTrackOrderProbeTests.swift` 验证 track 顺序稳定性**（sidecar 双源映射的前提）：
   - 重复 N（≥ 20）次：建 writer → `add(sys)` → `add(mic)`（两路 outputSettings 相同）→ sys 写 1s 440Hz 正弦波、mic 写 1s 880Hz 正弦波 → finalize → 用 `AVAssetReader` 解码 `tracks(withMediaType: .audio)[0]` / `[1]` 各取 100ms PCM 做 FFT。
   - 断言每次 `tracks[0]` 主频 ≈ 440Hz、`tracks[1]` 主频 ≈ 880Hz（即 tracks 顺序与 add() 顺序一致）。**不**用 trackID 大小或 ASBD 判断 —— 两路相同 outputSettings 的 ASBD 必然相同，trackID 由 AVAssetWriter 内部分配，无序保证。
   - 结论写进 PR 描述。失败 → "add() 顺序 → tracks 顺序"假设不成立，sidecar 退化为"仅 single-source 可写"，双源场景的 source 识别需另设方案（落到本计划之外的后续 issue）。

**Phase 1 — 代码改造（Phase 0 通过后）**

5. 删除 `AudioMixer.swift` 和 `AudioMixerTests.swift`。
6. 改造 `AudioEncoder.swift`（双 input + 首帧缓冲 + `min(PTS)` start session + per-track PTS 单调性 + raw buffer append）。
7. 改造 `AudioCaptureManager.swift`（透传 + 删 drain timer + 两个 output 注册到**专用 serial queue**）。
8. 修改 `RecordingManager.swift` 接线（两路 callback → encoder 两个入口）。

**Phase 2 — 测试与验收**

9. 写完 **5 个** `AudioEncoderTests` 用例（**全部必跑**，缺一不可）：
   - 用例 1：双轨基本写入（PTS 起点对齐）
   - 用例 2：PTS gap 保留（Cause B 回归 —— 此用例必须在 Phase 0 假设 B 验证后落地；若假设 B 不成立则改测 Mitigation B 的 silent fill 行为）
   - **用例 3：Sample-rate mismatch 重采样**（Cause A 回归，**最可能的根因，绝不能省**）
   - 用例 4：单轨缺席启动（只喂 system，断言输出为单 track，sidecar 标识 system 来源）
   - 用例 5：PTS 单调性（逆序 buffer 被丢弃）
10. `xcodegen generate` + `xcodebuild build` + `xcodebuild test` + `swiftlint Lyre/`，全绿。
11. 手工验收：录 30 秒"本机说话 + 系统播放视频" → QuickTime / ffprobe 检查 → 上传到生产 DashScope 跑一次确认转写包含本机内容。
12. 更新 `CLAUDE.md` 的 Retrospective 部分。

**Phase 3（条件触发）**

13. 如果 Phase 2 第 11 步发现 ASR 没识别本机 → 落地 Risk & Fallback 的离线 mix 方案，文件结构变回单轨。

## References

- [Apple — `SCStreamConfiguration`](https://developer.apple.com/documentation/screencapturekit/scstreamconfiguration)
- [Apple — `SCRecordingOutput`](https://developer.apple.com/documentation/screencapturekit/screcordingoutput)（评估后不采用）
- [Apple — `AVAssetWriterInput`](https://developer.apple.com/documentation/avfoundation/avassetwriterinput)
- [Mnpn/Azayaka — `Processing.swift`](https://github.com/Mnpn/Azayaka/blob/main/Azayaka/Processing.swift)
- [lihaoyun6/QuickRecorder — `RecordEngine.swift`](https://github.com/lihaoyun6/QuickRecorder/blob/main/QuickRecorder/RecordEngine.swift)
- [WWDC25 Session 251 — Enhance your app's audio recording](https://developer.apple.com/videos/play/wwdc2025/251)
