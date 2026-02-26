import Foundation

/// Shared constants used across the app.
enum Constants {
    /// Bundle identifier / os.Logger subsystem.
    static let subsystem = "com.lyre.app"

    /// Audio format settings — must be consistent between capture and encoding.
    enum Audio {
        static let sampleRate: Double = 48000
        static let sampleRateInt: Int = 48000
        static let channelCount: UInt32 = 1
        static let channelCountInt: Int = 1
        static let aacBitRate: Int = 128_000
        static let mimeType = "audio/x-m4a"
        static let fileExtension = "m4a"
    }
}
