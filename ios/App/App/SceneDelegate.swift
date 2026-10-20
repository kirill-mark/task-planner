import UIKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = MARKBridgeViewController()
        window?.makeKeyAndVisible()

        for context in connectionOptions.urlContexts { WidgetOpening.receive(context.url) }
        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        for context in URLContexts { WidgetOpening.receive(context.url) }
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }

    func sceneDidEnterBackground(_ scene: UIScene) {
        publishAppState(active: false)
    }

    func sceneDidBecomeActive(_ scene: UIScene) {
        publishAppState(active: true)
    }

    private func publishAppState(active: Bool) {
        let value = active ? "true" : "false"
        (window?.rootViewController as? CAPBridgeViewController)?.bridge?.webView?.evaluateJavaScript(
            "window.dispatchEvent(new CustomEvent('mark:app-state', {detail: {active: \(value)}}))",
            completionHandler: nil
        )
    }
}
