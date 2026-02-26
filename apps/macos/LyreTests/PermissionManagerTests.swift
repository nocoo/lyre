import Testing
@testable import Lyre

@Test func permissionManagerInitialState() {
    let manager = PermissionManager()
    #expect(manager.screenRecording == .unknown)
    #expect(manager.microphone == .unknown)
    #expect(manager.allGranted == false)
    #expect(manager.needsSetup == true)
}

@Test func allGrantedRequiresBothPermissions() {
    let manager = PermissionManager()
    // Simulate: only screen recording granted
    manager.screenRecording = .granted
    #expect(manager.allGranted == false)
    #expect(manager.needsSetup == true)

    // Simulate: both granted
    manager.microphone = .granted
    #expect(manager.allGranted == true)
    #expect(manager.needsSetup == false)
}

@Test func deniedMeansNeedsSetup() {
    let manager = PermissionManager()
    manager.screenRecording = .granted
    manager.microphone = .denied
    #expect(manager.allGranted == false)
    #expect(manager.needsSetup == true)
}

@Test func statusEquality() {
    let a: PermissionManager.Status = .granted
    let b: PermissionManager.Status = .granted
    let c: PermissionManager.Status = .denied
    #expect(a == b)
    #expect(a != c)
}
