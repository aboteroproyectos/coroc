import Flutter
import UIKit

/// «Compartir con COROC» (§12.4): COROC aparece para abrir imágenes y PDF. El archivo llega por la escena (en frío o
/// con la app abierta); se copia a la carpeta temporal de la app y la ruta pasa a Dart.
public class CorocSharePlugin: NSObject, FlutterPlugin, FlutterSceneLifeCycleDelegate {
  private var channel: FlutterMethodChannel?
  private var pending: [String] = []

  public static func register(with registrar: FlutterPluginRegistrar) {
    let instance = CorocSharePlugin()
    let channel = FlutterMethodChannel(name: "co.coroc/share", binaryMessenger: registrar.messenger())
    instance.channel = channel
    registrar.addMethodCallDelegate(instance, channel: channel)
    registrar.addSceneDelegate(instance)
    registrar.addApplicationDelegate(instance)
  }

  public func handle(_ call: FlutterMethodCall, result: @escaping FlutterResult) {
    switch call.method {
    case "take":
      result(pending)
      pending.removeAll()
    default:
      result(FlutterMethodNotImplemented)
    }
  }

  public func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions?) -> Bool {
    let urls = connectionOptions?.urlContexts.map { $0.url } ?? []
    return receive(urls, notify: false)
  }

  public func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) -> Bool {
    return receive(URLContexts.map { $0.url }, notify: true)
  }

  // Sin escenas (iOS antiguos o configuraciones sin UIScene).
  public func application(_ application: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
    return receive([url], notify: true)
  }

  private func receive(_ urls: [URL], notify: Bool) -> Bool {
    let paths = urls.filter { $0.isFileURL }.compactMap(copy)
    if paths.isEmpty { return false }
    if notify, let channel = channel {
      channel.invokeMethod("files", arguments: paths)
    } else {
      pending.append(contentsOf: paths)
    }
    return true
  }

  private func copy(_ url: URL) -> String? {
    let scoped = url.startAccessingSecurityScopedResource()
    defer { if scoped { url.stopAccessingSecurityScopedResource() } }
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent("coroc-share/\(UUID().uuidString)", isDirectory: true)
    do {
      try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
      let target = dir.appendingPathComponent(url.lastPathComponent)
      try FileManager.default.copyItem(at: url, to: target)
      // Si llegó por la bandeja Inbox de la app, se retira el original para no acumular copias.
      if url.path.contains("/Documents/Inbox/") { try? FileManager.default.removeItem(at: url) }
      return target.path
    } catch {
      return nil
    }
  }
}
