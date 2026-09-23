import Cocoa
import FlutterMacOS

/// Carpeta COROC en macOS (§16.2): la app vive en el sandbox, así que conserva el acceso a la carpeta elegida con un
/// marcador de seguridad (security-scoped bookmark) que abre en cada inicio.
public class CorocBookmarksPlugin: NSObject, FlutterPlugin {
  private var accessed: [String: URL] = [:]

  public static func register(with registrar: FlutterPluginRegistrar) {
    let channel = FlutterMethodChannel(name: "co.coroc/bookmarks", binaryMessenger: registrar.messenger)
    registrar.addMethodCallDelegate(CorocBookmarksPlugin(), channel: channel)
  }

  public func handle(_ call: FlutterMethodCall, result: @escaping FlutterResult) {
    let args = call.arguments as? [String: Any] ?? [:]
    switch call.method {
    case "pickDirectory":
      DispatchQueue.main.async {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.canCreateDirectories = true
        panel.allowsMultipleSelection = false
        if let message = args["message"] as? String { panel.message = message }
        if let prompt = args["prompt"] as? String { panel.prompt = prompt }
        if let initial = args["initialPath"] as? String { panel.directoryURL = URL(fileURLWithPath: initial, isDirectory: true) }
        guard panel.runModal() == .OK, let url = panel.url else {
          result(nil)
          return
        }
        do {
          let data = try url.bookmarkData(options: [.withSecurityScope], includingResourceValuesForKeys: nil, relativeTo: nil)
          result(["path": url.path, "bookmark": data.base64EncodedString()])
        } catch {
          result(FlutterError(code: "bookmark", message: error.localizedDescription, details: nil))
        }
      }
    case "resolve":
      guard let b64 = args["bookmark"] as? String, let data = Data(base64Encoded: b64) else {
        result(FlutterError(code: "args", message: "bookmark", details: nil))
        return
      }
      do {
        var stale = false
        let url = try URL(resolvingBookmarkData: data, options: [.withSecurityScope], relativeTo: nil, bookmarkDataIsStale: &stale)
        guard url.startAccessingSecurityScopedResource() else {
          result(nil)
          return
        }
        accessed[url.path] = url
        var current = b64
        if stale, let fresh = try? url.bookmarkData(options: [.withSecurityScope], includingResourceValuesForKeys: nil, relativeTo: nil) {
          current = fresh.base64EncodedString()
        }
        result(["path": url.path, "bookmark": current, "stale": stale])
      } catch {
        result(nil)
      }
    case "stop":
      if let path = args["path"] as? String, let url = accessed.removeValue(forKey: path) {
        url.stopAccessingSecurityScopedResource()
      }
      result(nil)
    default:
      result(FlutterMethodNotImplemented)
    }
  }
}
