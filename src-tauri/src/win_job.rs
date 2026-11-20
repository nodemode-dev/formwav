use std::os::windows::io::AsRawHandle;
use std::process::Child;
use std::sync::OnceLock;
use std::time::Duration;

use windows_sys::Win32::Foundation::{CloseHandle, HANDLE, WAIT_OBJECT_0};
use windows_sys::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation, SetInformationJobObject, TerminateJobObject,
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
};

pub const LEAVE_WAIT: Duration = Duration::from_secs(5);

static JOB: OnceLock<usize> = OnceLock::new();

fn create() -> usize {
    unsafe {
        let handle = CreateJobObjectW(std::ptr::null(), std::ptr::null());
        if handle.is_null() {
            return 0;
        }
        let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let set = SetInformationJobObject(
            handle,
            JobObjectExtendedLimitInformation,
            std::ptr::addr_of!(limits).cast(),
            std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        );
        if set == 0 {
            CloseHandle(handle);
            return 0;
        }
        handle as usize
    }
}

fn job() -> Option<HANDLE> {
    let raw = *JOB.get_or_init(create);
    (raw != 0).then_some(raw as HANDLE)
}

pub fn hold(child: &Child) -> bool {
    match job() {
        Some(handle) => unsafe { AssignProcessToJobObject(handle, child.as_raw_handle() as HANDLE) != 0 },
        None => false,
    }
}

pub fn hold_pid(pid: u32) -> bool {
    use windows_sys::Win32::System::Threading::{OpenProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE};

    let Some(handle) = job() else {
        return false;
    };
    unsafe {
        let process = OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, 0, pid);
        if process.is_null() {
            return false;
        }
        let held = AssignProcessToJobObject(handle, process) != 0;
        CloseHandle(process);
        held
    }
}

pub fn wait_gone(pid: u32, limit: Duration) -> bool {
    use windows_sys::Win32::System::Threading::{OpenProcess, WaitForSingleObject, PROCESS_SYNCHRONIZE};

    unsafe {
        let process = OpenProcess(PROCESS_SYNCHRONIZE, 0, pid);
        if process.is_null() {
            return true;
        }
        let millis = u32::try_from(limit.as_millis()).unwrap_or(u32::MAX);
        let gone = WaitForSingleObject(process, millis) == WAIT_OBJECT_0;
        CloseHandle(process);
        gone
    }
}

pub fn end() -> bool {
    match JOB.get().copied() {
        Some(raw) if raw != 0 => unsafe { TerminateJobObject(raw as HANDLE, 1) != 0 },
        _ => false,
    }
}
