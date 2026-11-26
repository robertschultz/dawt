import AppKit
import CoreAudio
import Foundation
import Darwin

private let port: UInt16 = 8176
private let virtualDJ = "com.atomixproductions.virtualdj"

private struct CaptureError: Error, CustomStringConvertible {
    let description: String
    init(_ description: String) { self.description = description }
}
private func check(_ status: OSStatus, _ operation: String) throws {
    guard status == noErr else { throw CaptureError("\(operation) failed (Core Audio \(status)).") }
}

private func processObject(_ pid: pid_t) throws -> AudioObjectID {
    var process = AudioObjectID(kAudioObjectUnknown)
    var input = pid
    var address = AudioObjectPropertyAddress(
        mSelector: kAudioHardwarePropertyTranslatePIDToProcessObject,
        mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
    var size = UInt32(MemoryLayout<AudioObjectID>.size)
    try check(AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject),
        &address, UInt32(MemoryLayout<pid_t>.size), &input, &size, &process), "Find VirtualDJ’s audio process")
    guard process != kAudioObjectUnknown else {
        throw CaptureError("VirtualDJ has no Core Audio process. Open VirtualDJ and initialize its audio output.")
    }
    return process
}

private func stringProperty(_ object: AudioObjectID, _ selector: AudioObjectPropertySelector,
                            _ operation: String) throws -> CFString {
    var address = AudioObjectPropertyAddress(mSelector: selector, mScope: kAudioObjectPropertyScopeGlobal,
                                             mElement: kAudioObjectPropertyElementMain)
    var value: CFString = "" as CFString
    var size = UInt32(MemoryLayout<CFString>.size)
    try withUnsafeMutablePointer(to: &value) { pointer in
        try check(AudioObjectGetPropertyData(object, &address, 0, nil, &size, pointer), operation)
    }
    return value
}

@available(macOS 14.2, *)
private final class Capture {
    private var tap = AudioObjectID(kAudioObjectUnknown)
    private var device = AudioObjectID(kAudioObjectUnknown)
    private var callback: AudioDeviceIOProcID?
    private var fd: Int32 = -1
    private let queue = DispatchQueue(label: "org.dot.afterhours.virtualdj.audio")
    private let generation = UInt16(truncatingIfNeeded: UInt32.random(in: 1...UInt32.max))
    private var sequence: UInt32 = 0
    private var observedSocketError = false
    private var observedInputShape = false
    private var observedNonzeroInput = false

    func start() throws {
        guard let application = NSRunningApplication.runningApplications(withBundleIdentifier: virtualDJ).first else {
            throw CaptureError("VirtualDJ must be open to send its audio to Dot Afterhours.")
        }
        let process = try processObject(application.processIdentifier)
        let description = CATapDescription(stereoMixdownOfProcesses: [process])
        description.uuid = UUID()
        description.name = "Dot Afterhours VirtualDJ audio"
        description.isPrivate = true
        description.muteBehavior = .unmuted
        try check(AudioHardwareCreateProcessTap(description, &tap), "Create the VirtualDJ process tap")
        var format = AudioStreamBasicDescription()
        var size = UInt32(MemoryLayout<AudioStreamBasicDescription>.size)
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioTapPropertyFormat, mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain)
        try check(AudioObjectGetPropertyData(tap, &address, 0, nil, &size, &format), "Read tap format")
        guard format.mFormatID == kAudioFormatLinearPCM,
              format.mFormatFlags & kAudioFormatFlagIsFloat != 0,
              format.mBitsPerChannel == 32,
              format.mChannelsPerFrame == 2,
              (32000...96000).contains(format.mSampleRate) else {
            throw CaptureError("The process tap did not provide stereo floating-point audio.")
        }
        let tapUID = try stringProperty(tap, kAudioTapPropertyUID, "Read the VirtualDJ tap UID")
        let configuration: [String: Any] = [
            kAudioAggregateDeviceUIDKey: UUID().uuidString,
            kAudioAggregateDeviceNameKey: "Dot Afterhours VirtualDJ input",
            kAudioAggregateDeviceIsPrivateKey: true,
            kAudioAggregateDeviceIsStackedKey: false,
            kAudioAggregateDeviceTapAutoStartKey: true,
            kAudioAggregateDeviceTapListKey: [
                [kAudioSubTapUIDKey: tapUID, kAudioSubTapDriftCompensationKey: true]
            ]
        ]
        try check(AudioHardwareCreateAggregateDevice(configuration as CFDictionary, &device),
                  "Create a private audio input")
        fd = socket(AF_INET, SOCK_DGRAM, 0)
        guard fd >= 0, fcntl(fd, F_SETFL, O_NONBLOCK) == 0 else {
            throw CaptureError("Could not open the local audio socket.")
        }
        var destination = sockaddr_in()
        destination.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        destination.sin_family = sa_family_t(AF_INET)
        destination.sin_port = port.bigEndian
        destination.sin_addr = in_addr(s_addr: inet_addr("127.0.0.1"))
        let connected = withUnsafePointer(to: &destination) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                Darwin.connect(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        }
        guard connected == 0 else { throw CaptureError("Could not connect to the local Unreal audio socket.") }
        let rate = UInt32(format.mSampleRate.rounded())
        try check(AudioDeviceCreateIOProcIDWithBlock(&callback, device, queue) { [weak self] _, input, _, _, _ in
            self?.write(UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: input)), rate: rate)
        }, "Open the tap input")
        try check(AudioDeviceStart(device, callback), "Start the VirtualDJ tap")
        print("VirtualDJ audio tap ready at \(rate) Hz. The current VirtualDJ output remains active.")
        fflush(stdout)
    }

    private func write(_ list: UnsafeMutableAudioBufferListPointer, rate: UInt32) {
        if !observedInputShape {
            observedInputShape = true
            let shapes = list.map { "\($0.mNumberChannels)ch/\($0.mDataByteSize) bytes" }.joined(separator: ", ")
            DispatchQueue.main.async { print("VirtualDJ tap input buffers: \(shapes)"); fflush(stdout) }
        }
        let available = list.filter { $0.mData != nil && $0.mDataByteSize > 0 && $0.mNumberChannels > 0 }
        guard let first = available.first(where:{ $0.mNumberChannels == 2 }) ?? available.first,
              let input = first.mData?.assumingMemoryBound(to: Float.self) else { return }
        let channels = Int(first.mNumberChannels)
        let rightBuffer = channels == 1 ? available.dropFirst().first : nil
        let right = rightBuffer?.mData?.assumingMemoryBound(to: Float.self)
        let leftFrames = Int(first.mDataByteSize) / (MemoryLayout<Float>.size * channels)
        let frames = rightBuffer.map { min(leftFrames, Int($0.mDataByteSize) / MemoryLayout<Float>.size) } ?? leftFrames
        guard frames > 0 else { return }
        var packet = [UInt8](repeating: 0, count: 16 + 4 * 240)
        packet[0] = 67; packet[1] = 87; packet[2] = 80; packet[3] = 67
        func copy<T: FixedWidthInteger>(_ value: T, at: Int) {
            let little = value.littleEndian
            packet.withUnsafeMutableBytes { $0.storeBytes(of: little, toByteOffset: at, as: T.self) }
        }
        copy(rate, at: 4)
        copy(generation, at: 12)
        for start in stride(from: 0, to: frames, by: 240) {
            let count = min(240, frames - start)
            copy(sequence, at: 8); sequence &+= 1
            copy(UInt16(count), at: 14)
            for frame in 0..<count {
                let i = start + frame
                let leftSample = input[i * channels]
                let rightSample = right?[i] ?? input[i * channels + min(1,channels-1)]
                if !observedNonzeroInput && (abs(leftSample) > 0.01 || abs(rightSample) > 0.01) {
                    observedNonzeroInput = true
                    DispatchQueue.main.async { print("VirtualDJ tap has nonzero master signal."); fflush(stdout) }
                }
                func pcm(_ x: Float) -> Int16 {
                    guard x.isFinite else { return 0 }
                    return Int16((max(-1.0, min(1.0, x)) * 32767.0).rounded())
                }
                copy(pcm(leftSample), at: 16+frame*4)
                copy(pcm(rightSample), at: 18+frame*4)
            }
            let sent = packet.withUnsafeBytes { Darwin.send(fd, $0.baseAddress, 16 + count*4, MSG_DONTWAIT) }
            if sent < 0 && errno != EAGAIN && !observedSocketError {
                let code = errno
                observedSocketError = true
                DispatchQueue.main.async { fputs("Local PCM socket error \(code).\n", stderr) }
            }
        }
    }

    func stop() {
        if let callback {
            AudioDeviceStop(device, callback)
            AudioDeviceDestroyIOProcID(device, callback)
            self.callback = nil
        }
        if device != kAudioObjectUnknown { AudioHardwareDestroyAggregateDevice(device); device = kAudioObjectUnknown }
        if tap != kAudioObjectUnknown { AudioHardwareDestroyProcessTap(tap); tap = kAudioObjectUnknown }
        if fd >= 0 { Darwin.close(fd); fd = -1 }
    }
    deinit { stop() }
}

guard #available(macOS 14.2, *) else { fatalError("Dot Afterhours audio requires macOS 14.2 or newer.") }
private let capture = Capture()
do {
    if Bundle.main.bundleURL.pathExtension == "app" {
        let pidPath = Bundle.main.bundleURL.deletingLastPathComponent().appendingPathComponent("vdj-audio.pid")
        try String(getpid()).write(to: pidPath, atomically: true, encoding: .utf8)
    }
    try capture.start()
    signal(SIGTERM, SIG_IGN)
    signal(SIGINT, SIG_IGN)
    let terms = [SIGTERM, SIGINT].map { number -> DispatchSourceSignal in
        let source = DispatchSource.makeSignalSource(signal: number, queue: .main)
        source.setEventHandler { capture.stop(); exit(0) }
        source.resume()
        return source
    }
    withExtendedLifetime(terms) { dispatchMain() }
} catch {
    fputs("\(error)\n", stderr)
    exit(1)
}
