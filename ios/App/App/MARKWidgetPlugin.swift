import Capacitor
import WebKit
import WidgetKit

// Scene callbacks run on the main thread. Keep the cold-start link until JS can consume it.
enum WidgetOpening {
    static var pending: [String: String]?
    static let notification = Notification.Name("MARKWidgetOpen")
    static func receive(_ url: URL) {
        guard url.scheme == "mark", url.host == "widget", let c = URLComponents(url: url, resolvingAgainstBaseURL: false),
              let user = c.queryItems?.first(where: { $0.name == "user" })?.value, user.count <= 100 else { return }
        var value = ["userId": user]
        if let screen = c.queryItems?.first(where: { $0.name == "screen" })?.value {
            guard screen == "assistant" else { return }
            value["screen"] = screen
        }
        if let task = c.queryItems?.first(where: { $0.name == "task" })?.value, task.count <= 100 { value["taskId"] = task }
        pending = value
        NotificationCenter.default.post(name: notification, object: nil)
    }
}

@objc(MARKWidgetPlugin)
class MARKWidgetPlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "MARKWidgetPlugin"
    let jsName = "MARKWidget"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "prepare", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "save", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "consumeOpen", returnType: CAPPluginReturnPromise)
    ]
    private var observer: NSObjectProtocol?
    override func load() {
        observer = NotificationCenter.default.addObserver(forName: WidgetOpening.notification, object: nil, queue: .main) { [weak self] _ in
            self?.notifyListeners("widgetOpen", data: [:])
        }
    }
    deinit { if let observer { NotificationCenter.default.removeObserver(observer) } }
    @objc func prepare(_ call: CAPPluginCall) {
        let user = call.getString("userId") ?? ""
        let old = WidgetStore.read()
        // Retain the same account's offline cache during startup; clear other accounts immediately.
        if old.userId != (user.isEmpty ? nil : user) {
            do {
                let blank = WidgetSnapshot(version: 1, userId: user.isEmpty ? nil : user, timezone: "UTC", updatedAt: "", days: [])
                try WidgetStore.write(JSONEncoder().encode(blank))
                WidgetCenter.shared.reloadAllTimelines()
            } catch { call.reject("Widget App Group unavailable"); return }
        }
        call.resolve()
    }
    @objc func save(_ call: CAPPluginCall) {
        guard let text = call.getString("snapshot"), let data = text.data(using: .utf8), data.count <= 524288,
              let value = try? JSONDecoder().decode(WidgetSnapshot.self, from: data), value.version == 1 else {
            call.reject("Invalid widget snapshot"); return
        }
        do { try WidgetStore.write(data); WidgetCenter.shared.reloadAllTimelines(); call.resolve() }
        catch { call.reject("Widget snapshot could not be saved") }
    }
    @objc func consumeOpen(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let value = WidgetOpening.pending ?? [:]
            WidgetOpening.pending = nil
            call.resolve(value)
        }
    }
}
class MARKBridgeViewController: CAPBridgeViewController {
    var assistantActive = false
    override var preferredStatusBarStyle: UIStatusBarStyle { assistantActive ? .lightContent : super.preferredStatusBarStyle }
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(MARKWidgetPlugin())
        bridge?.registerPluginInstance(MARKSpeechPlugin())
        webView?.hideFormAccessoryBar()
        let center = NotificationCenter.default
        center.addObserver(self, selector: #selector(keyboardWillChange(_:)), name: UIResponder.keyboardWillChangeFrameNotification, object: nil)
        center.addObserver(self, selector: #selector(keyboardWillHide(_:)), name: UIResponder.keyboardWillHideNotification, object: nil)
    }

    // The page learns the keyboard height when the keyboard starts moving, with its
    // duration, so bottom sheets rise together with it instead of jumping afterwards
    // (visualViewport reports only after the animation ends).
    @objc private func keyboardWillChange(_ note: Notification) {
        guard let webView, let end = (note.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? NSValue)?.cgRectValue else { return }
        let frame = webView.convert(end, from: nil)
        sendKeyboard(height: max(0, webView.bounds.maxY - frame.minY), note: note)
    }

    @objc private func keyboardWillHide(_ note: Notification) {
        sendKeyboard(height: 0, note: note)
    }

    private func sendKeyboard(height: CGFloat, note: Notification) {
        let duration = (note.userInfo?[UIResponder.keyboardAnimationDurationUserInfoKey] as? Double) ?? 0.25
        let h = Int(height.rounded())
        let js = "window.__markNativeKeyboard=true;var r=document.documentElement;r.style.setProperty('--kb-dur','\(duration)s');r.style.setProperty('--kb','\(h > 80 ? h : 0)px');r.classList.toggle('kb-open',\(h > 80));"
        webView?.evaluateJavaScript(js, completionHandler: nil)
    }
}

// Mark hides the system bar with arrows and «Done» above the keyboard: forms have
// their own buttons. Same technique as @capacitor/keyboard setAccessoryBarVisible(false).
private final class NoAccessoryView: NSObject {
    @objc var inputAccessoryView: AnyObject? { nil }
}

extension WKWebView {
    func hideFormAccessoryBar() {
        guard let content = scrollView.subviews.first(where: { String(describing: type(of: $0)).hasPrefix("WKContent") }),
              let base = object_getClass(content) else { return }
        let name = "\(NSStringFromClass(base))_MarkNoAccessory"
        var cls: AnyClass? = NSClassFromString(name)
        if cls == nil, let made = objc_allocateClassPair(base, name, 0) {
            if let method = class_getInstanceMethod(NoAccessoryView.self, #selector(getter: NoAccessoryView.inputAccessoryView)) {
                class_addMethod(made, #selector(getter: NoAccessoryView.inputAccessoryView), method_getImplementation(method), method_getTypeEncoding(method))
            }
            objc_registerClassPair(made)
            cls = made
        }
        if let cls { object_setClass(content, cls) }
    }
}
