import AppKit
import SwiftUI

@MainActor
protocol AlertPresenting {
    /// Nonblocking, dismissible reminder. Only an explicit primary choice is true.
    func presentChoice(title: String, message: String, primary: String, secondary: String) async -> Bool
    func dismissChoice()
    func presentError(title: String, message: String)
}

/// A nonactivating panel for optional reminders; app errors use a sheet when
/// the main window is active. No nested run loops and no focus-stealing activation.
@MainActor
final class LyreAlertPresenter: AlertPresenting {
    private var choicePanel: NSPanel?
    private var choiceID: UUID?
    private var choiceContinuation: CheckedContinuation<Bool, Never>?
    private var expiryTask: Task<Void, Never>?
    private var errorPanel: NSPanel?
    private var errors: [(title: String, message: String)] = []

    func presentChoice(title: String, message: String, primary: String, secondary: String) async -> Bool {
        guard !Task.isCancelled, errorPanel == nil else { return false }
        dismissChoice()
        let id = UUID()
        return await withTaskCancellationHandler {
            await withCheckedContinuation { continuation in
                guard !Task.isCancelled else { continuation.resume(returning: false); return }
                choiceID = id
                choiceContinuation = continuation
                let view = LyreDialogView(
                    title: title, message: message, symbol: "video", eyebrow: "MICROSOFT TEAMS",
                    isReminder: true, primary: primary, secondary: secondary,
                    onPrimary: { [weak self] in self?.finishChoice(id: id, accepted: true) },
                    onSecondary: { [weak self] in self?.finishChoice(id: id, accepted: false) }
                )
                let panel = makePanel(view)
                choicePanel = panel
                positionReminder(panel)
                panel.orderFrontRegardless()
                expiryTask = Task { @MainActor [weak self] in
                    do { try await Task.sleep(for: .seconds(20)) } catch { return }
                    self?.finishChoice(id: id, accepted: false)
                }
            }
        } onCancel: {
            Task { @MainActor [weak self] in self?.finishChoice(id: id, accepted: false) }
        }
    }

    func dismissChoice() {
        guard let choiceID else { return }
        finishChoice(id: choiceID, accepted: false)
    }

    private func finishChoice(id: UUID, accepted: Bool) {
        guard choiceID == id else { return }
        expiryTask?.cancel()
        expiryTask = nil
        choicePanel?.orderOut(nil)
        choicePanel = nil
        choiceID = nil
        let continuation = choiceContinuation
        choiceContinuation = nil
        continuation?.resume(returning: accepted)
    }

    func presentError(title: String, message: String) {
        dismissChoice()
        guard !errors.contains(where: { $0.title == title && $0.message == message }) else { return }
        errors.append((title, message))
        if errorPanel == nil { showNextError() }
    }

    private func showNextError() {
        guard let error = errors.first else { return }
        let view = LyreDialogView(
            title: error.title, message: error.message, symbol: "exclamationmark.octagon.fill",
            eyebrow: "RECORDING", tone: .error, primary: "Close", primarySymbol: "xmark",
            onPrimary: { [weak self] in self?.dismissError() }
        )
        let panel = makePanel(view)
        errorPanel = panel
        if NSApp.isActive, let parent = NSApp.mainWindow, parent.isVisible, parent.attachedSheet == nil {
            parent.beginSheet(panel)
        } else {
            positionReminder(panel)
            panel.orderFrontRegardless()
        }
    }

    func dismissError() {
        if let panel = errorPanel {
            panel.sheetParent?.endSheet(panel)
            panel.orderOut(nil)
        }
        errorPanel = nil
        if !errors.isEmpty { errors.removeFirst() }
        showNextError()
    }

    private func makePanel(_ view: LyreDialogView) -> NSPanel {
        let host = NSHostingView(rootView: view)
        let panel = LyreNoticePanel(
            contentRect: NSRect(origin: .zero, size: host.fittingSize),
            styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false
        )
        panel.contentView = host
        panel.isReleasedWhenClosed = false
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.isFloatingPanel = true
        panel.becomesKeyOnlyIfNeeded = true
        panel.hidesOnDeactivate = false
        panel.level = .floating
        panel.collectionBehavior = [.moveToActiveSpace, .fullScreenAuxiliary]
        panel.title = "Lyre"
        return panel
    }

    private func positionReminder(_ panel: NSPanel) {
        let screen = NSScreen.screens.first { $0.frame.contains(NSEvent.mouseLocation) } ?? NSScreen.main
        guard let frame = screen?.visibleFrame else { return }
        panel.setFrameTopLeftPoint(NSPoint(x: frame.maxX - panel.frame.width - 20, y: frame.maxY - 20))
    }
}

private final class LyreNoticePanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
}
