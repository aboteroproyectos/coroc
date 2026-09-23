package co.coroc.coroc_share

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.OpenableColumns
import io.flutter.embedding.engine.plugins.FlutterPlugin
import io.flutter.embedding.engine.plugins.activity.ActivityAware
import io.flutter.embedding.engine.plugins.activity.ActivityPluginBinding
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel
import io.flutter.plugin.common.PluginRegistry
import java.io.File
import java.util.UUID

/**
 * «Compartir con COROC» (§12.4): recibe ACTION_SEND y ACTION_SEND_MULTIPLE con imágenes y PDF, copia cada archivo a
 * la caché de la app (el permiso sobre el URI de otra app es temporal) y entrega las rutas a Dart.
 */
class CorocSharePlugin : FlutterPlugin, MethodChannel.MethodCallHandler, ActivityAware, PluginRegistry.NewIntentListener {
  private lateinit var channel: MethodChannel
  private var activity: Activity? = null
  private val pending = mutableListOf<String>()

  override fun onAttachedToEngine(binding: FlutterPlugin.FlutterPluginBinding) {
    channel = MethodChannel(binding.binaryMessenger, "co.coroc/share")
    channel.setMethodCallHandler(this)
  }

  override fun onDetachedFromEngine(binding: FlutterPlugin.FlutterPluginBinding) {
    channel.setMethodCallHandler(null)
  }

  override fun onMethodCall(call: MethodCall, result: MethodChannel.Result) {
    when (call.method) {
      "take" -> {
        result.success(ArrayList(pending))
        pending.clear()
      }
      else -> result.notImplemented()
    }
  }

  override fun onAttachedToActivity(binding: ActivityPluginBinding) {
    activity = binding.activity
    binding.addOnNewIntentListener(this)
    handle(binding.activity.intent, notify = false)
  }

  override fun onReattachedToActivityForConfigChanges(binding: ActivityPluginBinding) = onAttachedToActivity(binding)
  override fun onDetachedFromActivityForConfigChanges() { activity = null }
  override fun onDetachedFromActivity() { activity = null }

  override fun onNewIntent(intent: Intent): Boolean = handle(intent, notify = true)

  private fun handle(intent: Intent?, notify: Boolean): Boolean {
    val act = activity ?: return false
    if (intent == null || (intent.action != Intent.ACTION_SEND && intent.action != Intent.ACTION_SEND_MULTIPLE)) return false
    val uris = mutableListOf<Uri>()
    if (intent.action == Intent.ACTION_SEND) {
      stream(intent)?.let { uris.add(it) }
    } else {
      streams(intent)?.let { uris.addAll(it) }
    }
    val paths = uris.mapNotNull { copy(act, it) }
    // Una vez leído, el intento no se vuelve a procesar (por ejemplo, al girar la pantalla).
    act.intent = Intent(act.intent).setAction(Intent.ACTION_MAIN)
    if (paths.isEmpty()) return false
    if (notify) channel.invokeMethod("files", paths) else pending.addAll(paths)
    return true
  }

  @Suppress("DEPRECATION")
  private fun stream(intent: Intent): Uri? =
    if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java) else intent.getParcelableExtra(Intent.EXTRA_STREAM)

  @Suppress("DEPRECATION")
  private fun streams(intent: Intent): List<Uri>? =
    if (Build.VERSION.SDK_INT >= 33) intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri::class.java) else intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM)

  private fun copy(act: Activity, uri: Uri): String? = try {
    val resolver = act.contentResolver
    var name = "comprobante"
    resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
      if (c.moveToFirst() && !c.isNull(0)) name = c.getString(0)
    }
    val safe = name.replace(Regex("[^A-Za-z0-9._ -]"), "_").take(120)
    val dir = File(act.cacheDir, "coroc-share/${UUID.randomUUID()}").apply { mkdirs() }
    val out = File(dir, safe)
    resolver.openInputStream(uri)?.use { input -> out.outputStream().use { input.copyTo(it) } } ?: return null
    out.absolutePath
  } catch (e: Exception) {
    null
  }
}
