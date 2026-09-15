import ScreenCaptureKit

/// Verifies access through the same API used by the recorder. This may show
/// macOS consent UI, so only explicit permission / recording actions call it.
enum ScreenCapturePermissionProbe {
    enum Result: Sendable, Equatable {
        case granted
        case denied
        case unavailable(String)
    }

    typealias Completion = @Sendable (Result) -> Void
    typealias Query = @Sendable (@escaping Completion) -> Void

    @MainActor static func check(
        timeout: Duration = .seconds(6), query: @escaping Query = queryContent
    ) async -> Result {
        await Request().run(timeout: timeout, query: query)
    }

    static func result(for error: Error) -> Result {
        let error = error as NSError
        if error.domain == SCStreamErrorDomain && error.code == SCStreamError.userDeclined.rawValue {
            return .denied
        }
        return .unavailable(error.localizedDescription)
    }

    private static func queryContent(completion: @escaping Completion) {
        SCShareableContent.getExcludingDesktopWindows(true, onScreenWindowsOnly: false) { content, error in
            if let error {
                completion(result(for: error))
            } else if content != nil {
                // Empty content can mean no attached display, not denied access.
                completion(.granted)
            } else {
                completion(.unavailable("macOS returned no capture information. Try checking access again."))
            }
        }
    }

    /// A callback can arrive after a timeout or cancellation. Resume the caller
    /// once, without waiting for an unresponsive framework callback to finish.
    @MainActor private final class Request {
        private var continuation: CheckedContinuation<Result, Never>?
        private var timeoutTask: Task<Void, Never>?

        func run(timeout: Duration, query: @escaping Query) async -> Result {
            await withTaskCancellationHandler {
                await withCheckedContinuation { continuation in
                    self.continuation = continuation
                    guard !Task.isCancelled else { finish(.unavailable("Access check cancelled.")); return }
                    timeoutTask = Task { [weak self] in
                        do { try await Task.sleep(for: timeout) } catch { return }
                        self?.finish(.unavailable("macOS did not respond. Try checking access again."))
                    }
                    query { [weak self] result in
                        Task { @MainActor in self?.finish(result) }
                    }
                }
            } onCancel: {
                Task { @MainActor in self.finish(.unavailable("Access check cancelled.")) }
            }
        }

        private func finish(_ result: Result) {
            guard let continuation else { return }
            self.continuation = nil
            timeoutTask?.cancel()
            timeoutTask = nil
            continuation.resume(returning: result)
        }
    }
}
