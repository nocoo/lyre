import Foundation

/// Shared constants used across the app.
enum Constants {
    /// Bundle identifier / os.Logger subsystem.
    static let subsystem = "ai.hexly.lyre"

    /// Cloudflare Access service token — lets the app pass through CF Access.
    /// Not a user secret; real auth is the per-user bearer device token.
    enum CFAccess {
        static let clientId = "317827a112aa2f246634e97b9e9f0920.access"
        static let clientSecret = "fc384251cbdf29902e284a990198bbe7b745bf1a4cf5eabf4843608044500a26"
    }

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
