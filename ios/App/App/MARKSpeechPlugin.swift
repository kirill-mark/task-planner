import Capacitor
import Speech
import AVFoundation

@objc(MARKSpeechPlugin)
class MARKSpeechPlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "MARKSpeechPlugin"
    let jsName = "MARKSpeech"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancel", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setScreenActive", returnType: CAPPluginReturnPromise)
    ]
    private let engine = AVAudioEngine()
    private let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "ru-RU"))
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var timer: Timer?
    private var backgroundObserver: NSObjectProtocol?
    private var token = 0
    private var generation = 0
    private var text = ""
    private var tapped = false
    private var recording = false

    override func load() {
        backgroundObserver = NotificationCenter.default.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { [weak self] _ in
            guard let self else { return }
            self.token += 1
            self.finish(error: "")
        }
    }
    deinit { if let backgroundObserver { NotificationCenter.default.removeObserver(backgroundObserver) } }

    @objc func setScreenActive(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let active = call.getBool("active") ?? false
            (self.bridge?.viewController as? MARKBridgeViewController)?.assistantActive = active
            self.bridge?.viewController?.setNeedsStatusBarAppearanceUpdate()
            if !active { self.token += 1; self.finish(error: "") }
            call.resolve()
        }
    }
    @objc func start(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.token += 1
            self.finish(error: "", emit: false)
            let expected = self.token
            self.generation = call.getInt("generation") ?? 0
            self.text = ""
            SFSpeechRecognizer.requestAuthorization { authorization in
                DispatchQueue.main.async {
                    guard self.token == expected else { call.resolve(); return }
                    guard authorization == .authorized else { self.finish(error: "Разреши распознавание речи для MARK в настройках iPhone."); call.resolve(); return }
                    AVAudioSession.sharedInstance().requestRecordPermission { permitted in
                        DispatchQueue.main.async {
                            guard self.token == expected else { call.resolve(); return }
                            guard permitted else { self.finish(error: "Разреши доступ к микрофону для MARK в настройках iPhone."); call.resolve(); return }
                            do { try self.begin(expected: expected); call.resolve() }
                            catch { self.finish(error: "Не удалось начать запись. Попробуй ещё раз."); call.resolve() }
                        }
                    }
                }
            }
        }
    }
    private func begin(expected: Int) throws {
        guard let recognizer, recognizer.isAvailable else { finish(error: "Распознавание сейчас недоступно. Проверь связь и попробуй ещё раз."); return }
        let audio = AVAudioSession.sharedInstance()
        try audio.setCategory(.record, mode: .measurement, options: .duckOthers)
        try audio.setActive(true, options: .notifyOthersOnDeactivation)
        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        request.requiresOnDeviceRecognition = recognizer.supportsOnDeviceRecognition
        self.request = request
        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else { throw NSError(domain: "MARKSpeech", code: 1) }
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in request.append(buffer) }
        tapped = true
        task = recognizer.recognitionTask(with: request) { result, error in
            DispatchQueue.main.async {
                guard self.token == expected else { return }
                if let result {
                    self.text = String(result.bestTranscription.formattedString.prefix(2000))
                    self.emit(phase: self.recording ? "recording" : "finishing")
                    if result.isFinal { self.finish(error: ""); return }
                }
                if error != nil { self.finish(error: self.text.isEmpty ? "Речь не распознана. Попробуй ещё раз." : "") }
            }
        }
        engine.prepare()
        try engine.start()
        recording = true
        emit(phase: "recording")
        timer = Timer.scheduledTimer(withTimeInterval: 60, repeats: false) { [weak self] _ in self?.stopAudio() }
    }
    private func emit(phase: String, error: String = "") {
        notifyListeners("speech", data: ["generation": generation, "phase": phase, "text": text, "error": error])
    }
    private func stopAudio() {
        timer?.invalidate()
        recording = false
        engine.stop()
        if tapped { engine.inputNode.removeTap(onBus: 0); tapped = false }
        request?.endAudio()
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        emit(phase: "finishing")
        // Some recognition services never produce a final callback after silence.
        timer = Timer.scheduledTimer(withTimeInterval: 3, repeats: false) { [weak self] _ in self?.finish(error: "") }
    }
    private func finish(error: String, emit shouldEmit: Bool = true) {
        token += 1
        timer?.invalidate(); timer = nil
        recording = false
        engine.stop()
        if tapped { engine.inputNode.removeTap(onBus: 0); tapped = false }
        request?.endAudio()
        task?.cancel(); task = nil; request = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        if shouldEmit { emit(phase: "idle", error: error) }
    }
    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async { if self.recording { self.stopAudio() }; call.resolve() }
    }
    @objc func cancel(_ call: CAPPluginCall) {
        DispatchQueue.main.async { self.token += 1; self.finish(error: "", emit: false); call.resolve() }
    }
}
