//! macOS: a VST3 module is a bundle, loaded through CoreFoundation the way the VST3 SDK's Mac module does it: create
//! the CFBundle from the .vst3 path, load its executable, call `bundleEntry` with the bundle (the plugin keeps it to
//! find its resources) before `GetPluginFactory`, and on the way out call `bundleExit` and release the bundle.
//! CoreFoundation is part of macOS; its few functions are declared here rather than through a crate.

use std::ffi::{c_char, c_void, CString};
use std::path::Path;
use std::ptr;

type CFTypeRef = *const c_void;
type CFAllocatorRef = *const c_void;
type CFURLRef = *const c_void;
type CFStringRef = *const c_void;
type CFBundleRef = *mut c_void;

const UTF8: u32 = 0x0800_0100; // kCFStringEncodingUTF8

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFURLCreateFromFileSystemRepresentation(allocator: CFAllocatorRef, buffer: *const u8, length: isize, is_directory: u8) -> CFURLRef;
    fn CFBundleCreate(allocator: CFAllocatorRef, url: CFURLRef) -> CFBundleRef;
    fn CFBundleLoadExecutable(bundle: CFBundleRef) -> u8;
    fn CFBundleGetFunctionPointerForName(bundle: CFBundleRef, name: CFStringRef) -> *mut c_void;
    fn CFStringCreateWithCString(allocator: CFAllocatorRef, text: *const c_char, encoding: u32) -> CFStringRef;
    fn CFRelease(object: CFTypeRef);
}

pub struct Bundle(CFBundleRef);

impl Bundle {
    /// Creates the bundle and loads its executable.
    pub unsafe fn open(path: &Path) -> Result<Bundle, String> {
        let bytes = path.as_os_str().as_encoded_bytes();
        let url = CFURLCreateFromFileSystemRepresentation(ptr::null(), bytes.as_ptr(), bytes.len() as isize, 1);
        if url.is_null() {
            return Err(format!("{} is not a path CoreFoundation accepts", path.display()));
        }
        let bundle = CFBundleCreate(ptr::null(), url);
        CFRelease(url);
        if bundle.is_null() {
            return Err(format!("{} is not a bundle", path.display()));
        }
        let bundle = Bundle(bundle);
        if CFBundleLoadExecutable(bundle.0) == 0 {
            return Err(format!("the executable in {} would not load", path.display()));
        }
        Ok(bundle)
    }

    pub fn as_ptr(&self) -> *mut c_void {
        self.0
    }

    /// A function exported by the bundle's executable, or null.
    pub unsafe fn symbol(&self, name: &str) -> *mut c_void {
        let Ok(name) = CString::new(name) else { return ptr::null_mut() };
        let cf = CFStringCreateWithCString(ptr::null(), name.as_ptr(), UTF8);
        if cf.is_null() {
            return ptr::null_mut();
        }
        let found = CFBundleGetFunctionPointerForName(self.0, cf);
        CFRelease(cf);
        found
    }
}

impl Drop for Bundle {
    fn drop(&mut self) {
        unsafe { CFRelease(self.0 as CFTypeRef) }
    }
}
