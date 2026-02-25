fn main() {
    tauri_build::build();

    // The screencapturekit crate's Swift bridge links against
    // @rpath/libswift_Concurrency.dylib. The crate emits rpath link args, but
    // cargo:rustc-link-arg from dependencies only applies to lib targets, not
    // the final binary. Re-emit the rpath entries so the bin target can resolve
    // Swift runtime libraries at runtime (especially on macOS 26+ where these
    // live in the dyld shared cache).
    println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");
}
